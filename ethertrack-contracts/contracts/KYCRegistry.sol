// SPDX-License-Identifier: MIT 


pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title KYCRegistry
 * @author EtherTrack
 * @notice Stores KYC verification status per wallet address.
 *         Only personal data hash stored on-chain (not raw PII).
 *         Actual KYC documents stored off-chain (Firebase/Backend).
 *
 * COMPLIANCE NOTE (FIU-IND / PMLA):
 *   Self-verification has been intentionally removed. Under PMLA 2002 and
 *   FIU-IND guidelines, the Reporting Entity (not the user) is responsible
 *   for identity verification. All KYC approvals must flow through an
 *   authorised KYC Operator via verifyKYC(). The correct flow is:
 *
 *     User submits docs → Backend/AdminDashboard reviews → Operator calls
 *     verifyKYC(wallet, hash) → wallet whitelisted on-chain.
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
    mapping(address => KYCRecord) private _kycRecords;

    // Authorized KYC operators (backend verifiers)
    mapping(address => bool) public kycOperators;

    uint256 public constant KYC_VALIDITY = 2 * 365 days;

    // ── Events ────────────────────────────────────────────
    event KYCVerified(address indexed wallet, address indexed operator, uint256 expiresAt);
    event KYCRevoked(address indexed wallet, address indexed operator, string reason);
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
     *         This is the ONLY path to whitelist a wallet.
     *
     * @param wallet       Wallet address to whitelist
     * @param kycDataHash  keccak256(idType:idNumber:phone:fullName)
     *                     Computed off-chain; raw PII never touches chain.
     *
     * Compliant flow (PMLA / FIU-IND):
     *   User submits KYC form → docs uploaded to Firebase
     *   → AdminDashboard.jsx operator reviews & approves
     *   → backend calls verifyKYC(wallet, hash) via onlyKYCOperator
     *   → wallet whitelisted on-chain
     *   → Portfolio button unlocks for user
     */
    function verifyKYC(
        address wallet,
        bytes32 kycDataHash
    ) external onlyKYCOperator whenNotPaused {
        require(wallet != address(0), "Invalid wallet address");
        _writeKYCRecord(wallet, kycDataHash, msg.sender);
    }

    /**
     * @notice Revoke KYC — fraud/compliance action.
     *         Can only be called by an authorised KYC Operator.
     *
     * @param wallet  Wallet whose KYC is to be revoked
     * @param reason  Human-readable reason (stored in event log)
     */
    function revokeKYC(
        address wallet,
        string calldata reason
    ) external onlyKYCOperator {
        require(_kycRecords[wallet].verified, "KYC not verified");
        _kycRecords[wallet].verified = false;
        emit KYCRevoked(wallet, msg.sender, reason);
    }

    // ── Internal ──────────────────────────────────────────
    function _writeKYCRecord(
        address wallet,
        bytes32 kycDataHash,
        address verifier
    ) internal {
        uint256 expiresAt = block.timestamp + KYC_VALIDITY;
        _kycRecords[wallet] = KYCRecord({
            verified:    true,
            verifiedAt:  block.timestamp,
            expiresAt:   expiresAt,
            kycDataHash: kycDataHash,
            verifiedBy:  verifier
        });
        emit KYCVerified(wallet, verifier, expiresAt);
    }

    // ── View Functions ────────────────────────────────────
    function isKYCVerified(address wallet) public view returns (bool) {
        KYCRecord memory record = _kycRecords[wallet];
        return record.verified && block.timestamp < record.expiresAt;
    }

    function getKYCRecord(address wallet) external view returns (KYCRecord memory) {
        return _kycRecords[wallet];
    }

    function getKYCExpiry(address wallet) external view returns (uint256) {
        return _kycRecords[wallet].expiresAt;
    }

    // ── Admin ─────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
