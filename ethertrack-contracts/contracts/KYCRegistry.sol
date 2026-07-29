// SPDX-License-Identifier: MIT


pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title KYCRegistry
 * @author EtherTrack
 * @notice Stores KYC verification status keyed by a server-issued identity
 *         hash — NOT by wallet address. Only a personal data hash is
 *         stored on-chain (not raw PII). Actual KYC documents stay
 *         off-chain (IPFS/Backend).
 *
 * IDENTITY HASH CONVENTION (must match CreditLedger.sol/backend exactly):
 *   userIdHash = keccak256(abi.encodePacked(userUuid))
 *   In Solidity that's the same as JS `ethers.keccak256(ethers.toUtf8Bytes(userUuid))`
 *   — no prefix, no salt. This is the SAME derivation CreditLedger.sol's
 *   computeUserId() and services/creditLedger.js's computeUserIdHash()
 *   already use, and the same `users.user_id_hash` column already cached
 *   for that purpose is reused here — one identity hash, shared across
 *   every wallet-free on-chain contract on the platform.
 *
 * WHY IDENTITY-KEYED, NOT WALLET-KEYED:
 *   EtherTrack supports INR-only trading (wallet + Razorpay), so a user
 *   can be a fully verified, compliant trader without ever owning or
 *   connecting a crypto wallet. Keying KYC records by wallet address would
 *   mean KYC literally could not exist on-chain until a user connected
 *   MetaMask — an artificial dependency with no compliance basis. Keying
 *   by a stable server-issued identity hash means:
 *     - KYC is written on-chain the moment an operator approves it,
 *       regardless of whether the user has (or ever gets) a wallet.
 *     - If/when a wallet is later bound, it's linked via linkWallet() and
 *       isKYCVerified(wallet) keeps working exactly as before, so
 *       EmissionRegistry / Marketplace / CarbonCreditToken / AMMPool — all
 *       of which check kycRegistry.isKYCVerified(msg.sender) — require
 *       ZERO changes.
 *
 * COMPLIANCE NOTE (FIU-IND / PMLA):
 *   Self-verification is not possible. Under PMLA 2002 and FIU-IND
 *   guidelines, the Reporting Entity (not the user) is responsible for
 *   identity verification. All KYC approvals must flow through an
 *   authorised KYC Operator via verifyKYC(). This requirement concerns WHO
 *   authorises the write (only the backend operator, exactly as before) —
 *   it does not require the on-chain key to be a wallet address. Flow:
 *
 *     User submits docs → Backend/AdminDashboard reviews → Operator calls
 *     verifyKYC(userIdHash, dataHash) → identity verified on-chain
 *     → (optionally, whenever it happens) operator calls linkWallet()
 *       to associate a wallet once the user connects one.
 *
 * BLOCKCHAIN MIGRATION: Replaces AuthContext kycCompleted flag
 */
contract KYCRegistry is Ownable, Pausable {

    // ── Structs ───────────────────────────────────────────
    struct KYCRecord {
        bool      verified;
        uint256   verifiedAt;    // timestamp
        uint256   expiresAt;     // KYC validity (2 years)
        bytes32   kycDataHash;   // keccak256 of off-chain KYC data
        address   verifiedBy;    // authorised operator only
    }

    // ── State ─────────────────────────────────────────────
    // userIdHash = keccak256(userUuid) — see convention note above
    mapping(bytes32 => KYCRecord) private _kycRecords;

    // wallet => userIdHash, populated only once a user binds a wallet
    mapping(address => bytes32) public walletToUser;
    // userIdHash => wallet, reverse lookup (address(0) if none bound yet)
    mapping(bytes32 => address) public userToWallet;

    // Authorized KYC operators (backend verifiers)
    mapping(address => bool) public kycOperators;

    uint256 public constant KYC_VALIDITY = 2 * 365 days;

    // ── Events ────────────────────────────────────────────
    event KYCVerified(bytes32 indexed userIdHash, address indexed operator, uint256 expiresAt);
    event KYCRevoked(bytes32 indexed userIdHash, address indexed operator, string reason);
    event WalletLinked(bytes32 indexed userIdHash, address indexed wallet, address indexed operator);
    event WalletUnlinked(bytes32 indexed userIdHash, address indexed wallet, address indexed operator);
    event KYCOperatorAdded(address indexed operator);
    event KYCOperatorRemoved(address indexed operator);

    // ── Modifiers ─────────────────────────────────────────
    modifier onlyKYCOperator() {
        require(kycOperators[msg.sender] || msg.sender == owner(), "Not a KYC operator");
        _;
    }

    // ── Constructor ───────────────────────────────────────
    constructor(address initialOwner) Ownable(initialOwner) {
        kycOperators[initialOwner] = true;
    }

    // ── KYC Operator Management ───────────────────────────
    function addKYCOperator(address operator) external onlyOwner {
        require(operator != address(0), "Invalid operator address");
        kycOperators[operator] = true;
        emit KYCOperatorAdded(operator);
    }

    function removeKYCOperator(address operator) external onlyOwner {
        kycOperators[operator] = false;
        emit KYCOperatorRemoved(operator);
    }

    // ── Core KYC Functions ────────────────────────────────

    /**
     * @notice Verify a user's KYC — must be called by an authorised
     *         KYC Operator (backend/admin) after off-chain review.
     *         Requires NO wallet — identity is keyed by userIdHash alone,
     *         so this can (and should) fire the instant KYC is approved,
     *         whether or not the user has ever touched MetaMask.
     *
     * @param userIdHash   keccak256(userUuid) — see convention note above
     * @param kycDataHash  keccak256(idType:idNumber:phone:fullName) or business-KYC equivalent.
     *                     Computed off-chain; raw PII never touches chain.
     */
    function verifyKYC(
        bytes32 userIdHash,
        bytes32 kycDataHash
    ) external onlyKYCOperator whenNotPaused {
        require(userIdHash != bytes32(0), "Invalid userIdHash");
        _writeKYCRecord(userIdHash, kycDataHash, msg.sender);
    }

    /**
     * @notice Link a wallet to an already-verified identity. Optional —
     *         only relevant for users who choose to trade on-chain (ETH
     *         path). INR-only traders never need this called at all.
     *         Overwrites any previous link for this userIdHash.
     */
    function linkWallet(bytes32 userIdHash, address wallet) external onlyKYCOperator whenNotPaused {
        require(wallet != address(0), "Invalid wallet address");
        require(_kycRecords[userIdHash].verified, "Identity not KYC verified");

        // Clear a stale reverse-link if this wallet was previously linked elsewhere
        bytes32 prevUser = walletToUser[wallet];
        if (prevUser != bytes32(0) && prevUser != userIdHash) {
            userToWallet[prevUser] = address(0);
        }
        // Clear this identity's previous wallet link, if any
        address prevWallet = userToWallet[userIdHash];
        if (prevWallet != address(0)) {
            walletToUser[prevWallet] = bytes32(0);
        }

        walletToUser[wallet] = userIdHash;
        userToWallet[userIdHash] = wallet;
        emit WalletLinked(userIdHash, wallet, msg.sender);
    }

    /**
     * @notice Remove a wallet link — fraud/compliance action, or user
     *         requested a wallet change.
     */
    function unlinkWallet(address wallet) external onlyKYCOperator {
        bytes32 userIdHash = walletToUser[wallet];
        require(userIdHash != bytes32(0), "Wallet not linked");
        walletToUser[wallet] = bytes32(0);
        userToWallet[userIdHash] = address(0);
        emit WalletUnlinked(userIdHash, wallet, msg.sender);
    }

    /**
     * @notice Revoke KYC — fraud/compliance action.
     */
    function revokeKYC(
        bytes32 userIdHash,
        string calldata reason
    ) external onlyKYCOperator {
        require(_kycRecords[userIdHash].verified, "KYC not verified");
        _kycRecords[userIdHash].verified = false;
        emit KYCRevoked(userIdHash, msg.sender, reason);
    }

    // ── Internal ──────────────────────────────────────────
    function _writeKYCRecord(
        bytes32 userIdHash,
        bytes32 kycDataHash,
        address verifier
    ) internal {
        uint256 expiresAt = block.timestamp + KYC_VALIDITY;
        _kycRecords[userIdHash] = KYCRecord({
            verified:    true,
            verifiedAt:  block.timestamp,
            expiresAt:   expiresAt,
            kycDataHash: kycDataHash,
            verifiedBy:  verifier
        });
        emit KYCVerified(userIdHash, verifier, expiresAt);
    }

    // ── View Functions ────────────────────────────────────

    /**
     * @notice Backward-compatible wallet-keyed check. Used by
     *         EmissionRegistry / Marketplace / CarbonCreditToken / AMMPool
     *         via msg.sender — unchanged signature so those contracts need
     *         NO modification. Resolves wallet -> userIdHash -> record.
     */
    function isKYCVerified(address wallet) public view returns (bool) {
        bytes32 userIdHash = walletToUser[wallet];
        if (userIdHash == bytes32(0)) return false;
        return isKYCVerifiedById(userIdHash);
    }

    /**
     * @notice Identity-keyed check — for backend/off-chain use, works for
     *         users who have no wallet at all (INR-only traders).
     */
    function isKYCVerifiedById(bytes32 userIdHash) public view returns (bool) {
        KYCRecord memory record = _kycRecords[userIdHash];
        return record.verified && block.timestamp < record.expiresAt;
    }

    function getKYCRecord(bytes32 userIdHash) external view returns (KYCRecord memory) {
        return _kycRecords[userIdHash];
    }

    function getKYCRecordByWallet(address wallet) external view returns (KYCRecord memory) {
        return _kycRecords[walletToUser[wallet]];
    }

    function getKYCExpiry(bytes32 userIdHash) external view returns (uint256) {
        return _kycRecords[userIdHash].expiresAt;
    }

    /// @notice Helper so backend/auditors compute the identical hash every
    ///         time — mirrors CreditLedger.sol's computeUserId() exactly.
    function computeUserId(string calldata userUuid) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(userUuid));
    }

    // ── Admin ─────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
