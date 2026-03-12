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
 * BLOCKCHAIN MIGRATION: Replaces AuthContext kycCompleted flag
 */
contract KYCRegistry is Ownable, Pausable {

    // ── Structs ───────────────────────────────────────────
    struct KYCRecord {
        bool      verified;
        uint256   verifiedAt;    // timestamp
        uint256   expiresAt;     // KYC validity (2 years)
        bytes32   kycDataHash;   // keccak256 of off-chain KYC data
        address   verifiedBy;    // operator or self
    }

    // ── State ─────────────────────────────────────────────
    mapping(address => KYCRecord) private _kycRecords;

    // Authorized KYC operators (backend verifiers)
    mapping(address => bool) public kycOperators;

    // ── NEW: allow users to self-verify after Firebase KYC ──
    bool public selfVerificationEnabled = true;

    uint256 public constant KYC_VALIDITY = 2 * 365 days;

    // ── Events ────────────────────────────────────────────
    event KYCVerified(address indexed wallet, address indexed operator, uint256 expiresAt);
    event KYCRevoked(address indexed wallet, address indexed operator, string reason);
    event KYCOperatorAdded(address indexed operator);
    event KYCOperatorRemoved(address indexed operator);
    event SelfVerificationToggled(bool enabled);

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
        kycOperators[operator] = true;
        emit KYCOperatorAdded(operator);
    }

    function removeKYCOperator(address operator) external onlyOwner {
        kycOperators[operator] = false;
        emit KYCOperatorRemoved(operator);
    }

    // ── NEW: Toggle self-verification on/off ──────────────
    function setSelfVerificationEnabled(bool enabled) external onlyOwner {
        selfVerificationEnabled = enabled;
        emit SelfVerificationToggled(enabled);
    }

    // ── Core KYC Functions ────────────────────────────────

    /**
     * @notice Operator-verify a user — called by backend/admin
     */
    function verifyKYC(
        address wallet,
        bytes32 kycDataHash
    ) external onlyKYCOperator whenNotPaused {
        require(wallet != address(0), "Invalid wallet address");
        _writeKYCRecord(wallet, kycDataHash, msg.sender);
    }

    /**
     * @notice NEW: Self-verify — user calls this after completing
     *         Firebase KYC (OTP + document upload).
     *         No operator needed. User pays their own gas.
     *
     * @param kycDataHash  keccak256(idType:idNumber:phone:fullName)
     *                     Same hash computed in KYCForm.js
     *
     * Flow:
     *   KYCForm.js → OTP verified + docs uploaded to Firebase
     *   → user clicks SUBMIT KYC
     *   → KYCForm calls selfVerify(hash) via MetaMask
     *   → wallet whitelisted on-chain instantly
     *   → Portfolio button unlocks
     */
    function selfVerify(bytes32 kycDataHash) external whenNotPaused {
        require(selfVerificationEnabled, "Self-verification is disabled");
        require(msg.sender != address(0), "Invalid wallet");
        require(!isKYCVerified(msg.sender), "Already KYC verified");
        _writeKYCRecord(msg.sender, kycDataHash, msg.sender);
    }

    /**
     * @notice Revoke KYC — fraud/compliance
     */
    function revokeKYC(address wallet, string calldata reason) external onlyKYCOperator {
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
