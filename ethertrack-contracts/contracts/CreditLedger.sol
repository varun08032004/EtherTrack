// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CreditLedger
 * @author EtherTrack
 * @notice Records carbon credit ownership changes (mint, list, delist, buy,
 *         sell, retire) as an immutable, tamper-evident on-chain audit trail
 *         — WITHOUT requiring each individual user to hold a personal
 *         Ethereum wallet.
 *
 *         All actual CarbonCreditToken (ERC-1155) balances are held in ONE
 *         pooled custody address (the platform Treasury / Marketplace
 *         escrow) — never distributed to individual user addresses. Real
 *         ownership — who owns how many credits of what — lives in
 *         EtherTrack's database, exactly as before. What THIS contract adds
 *         is a permanent, independently-verifiable, hashed record of every
 *         change to that ownership, so the database's claims can never be
 *         silently altered after the fact without it being detectable by
 *         anyone, using nothing but a block explorer.
 *
 *         This mirrors EmissionRegistry.sol's existing pattern exactly:
 *         logEmission()/recordOffset() don't move any tokens either — they
 *         just write structured, timestamped, hashed records. CreditLedger
 *         applies that same proven pattern to credit ownership instead of
 *         emissions data.
 *
 *         A user is identified here by `userId` — keccak256 of their
 *         internal platform user UUID, NOT a wallet address they need to
 *         generate, fund, or hold private keys for. This removes MetaMask/
 *         wallet-extension friction entirely for users who only ever trade
 *         via INR — while keeping every single action fully on-chain,
 *         timestamped, and tamper-evident.
 *
 *         Users who DO want true self-custody remain free to withdraw their
 *         credits to a real wallet of their own at any time (a genuine
 *         on-chain CarbonCreditToken transfer out of the pool to their
 *         address) — at which point they become a normal self-custody
 *         holder, verifiable the traditional way (their own balanceOf()).
 */
contract CreditLedger is Ownable, Pausable {

    // ── Action Types ───────────────────────────────────────
    enum ActionType { MINT, LIST, DELIST, BUY, SELL, RETIRE, WITHDRAW_TO_WALLET }

    // ── Structs ───────────────────────────────────────────
    struct OwnershipLog {
        bytes32     userId;       // keccak256(platform user UUID) — not a wallet
        uint256     tokenId;      // CarbonCreditToken tokenId
        int256      amountDelta;  // positive = credited, negative = debited
        ActionType  actionType;
        uint256     loggedAt;     // Unix timestamp
        bytes32     refHash;      // keccak256 of the canonical DB record —
                                  // lets anyone verify the DB row this log
                                  // corresponds to hasn't been altered since
        string      note;         // optional context (project name, trade id, etc.)
    }

    // ── State ─────────────────────────────────────────────
    OwnershipLog[] private _logs;

    // userId => log IDs
    mapping(bytes32 => uint256[]) public userLogs;
    // userId => tokenId => running balance (credits currently held)
    mapping(bytes32 => mapping(uint256 => uint256)) public userTokenBalance;
    // userId => tokenId => total ever retired
    mapping(bytes32 => mapping(uint256 => uint256)) public userTokenRetired;
    // tokenId => total held across all ledger users (should reconcile with
    // the pooled custody wallet's real on-chain CarbonCreditToken balance —
    // see reconciliation note at bottom of file)
    mapping(uint256 => uint256) public totalLedgerBalance;

    // ── [NEW] Operator role — same pattern as CarbonCreditToken.sol.
    // A backend-controlled wallet authorized to write ledger entries. Only
    // ever writes what the platform's own settlement logic determines
    // happened — this contract has no independent way to verify DB claims,
    // it only guarantees that whatever WAS logged cannot be altered
    // afterward. The trust boundary is "did the operator log honestly",
    // not "can the log be tampered with after the fact" (it cannot).
    address public operator;

    event OperatorUpdated(address indexed oldOperator, address indexed newOperator);

    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner(), "CreditLedger: not operator");
        _;
    }

    // ── Events ────────────────────────────────────────────
    event OwnershipLogged(
        uint256 indexed logId,
        bytes32 indexed userId,
        uint256 indexed tokenId,
        int256  amountDelta,
        ActionType actionType,
        bytes32 refHash
    );

    event CreditRetiredLogged(
        uint256 indexed logId,
        bytes32 indexed userId,
        uint256 tokenId,
        uint256 amount,
        bytes32 refHash
    );

    // ── Constructor ───────────────────────────────────────
    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Owner-only. Sets the backend wallet allowed to write ledger entries.
    function setOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "CreditLedger: zero address");
        emit OperatorUpdated(operator, _operator);
        operator = _operator;
    }

    // ── Core Functions ────────────────────────────────────

    /**
     * @notice Log a change in a user's credit ownership — mint, list,
     *         delist, buy, or sell. Does NOT move any real tokens; the
     *         actual CarbonCreditToken balance stays in pooled custody
     *         throughout. This is purely the tamper-evident record of what
     *         the platform's database claims happened.
     * @param userId       keccak256 of the platform user's internal UUID
     * @param tokenId      CarbonCreditToken tokenId this log concerns
     * @param amountDelta  positive = user gained credits, negative = user
     *                     gave up credits (list/sell) — reverts if a
     *                     negative delta would take the user's running
     *                     balance below zero, preventing an inconsistent
     *                     ledger from ever being written
     * @param actionType   MINT / LIST / DELIST / BUY / SELL / WITHDRAW_TO_WALLET
     *                     (use logRetirement() below for RETIRE, which has
     *                     its own dedicated event + running totals for
     *                     GHG Protocol / BRSR certificate purposes)
     * @param refHash      keccak256 of the canonical DB record fields for
     *                     this change (mirrors Marketplace.sol's
     *                     inrTradeHashes pattern) — lets anyone independently
     *                     verify the DB row hasn't been altered since
     * @param note         optional human-readable context
     */
    function logOwnershipChange(
        bytes32    userId,
        uint256    tokenId,
        int256     amountDelta,
        ActionType actionType,
        bytes32    refHash,
        string calldata note
    ) external onlyOperator whenNotPaused returns (uint256 logId) {
        require(userId != bytes32(0), "CreditLedger: zero userId");
        require(amountDelta != 0,      "CreditLedger: zero delta");
        require(actionType != ActionType.RETIRE, "CreditLedger: use logRetirement() for retirement");

        uint256 currentBalance = userTokenBalance[userId][tokenId];

        if (amountDelta < 0) {
            uint256 debit = uint256(-amountDelta);
            require(currentBalance >= debit, "CreditLedger: insufficient ledger balance");
            userTokenBalance[userId][tokenId] = currentBalance - debit;
            totalLedgerBalance[tokenId]       -= debit;
        } else {
            uint256 credit = uint256(amountDelta);
            userTokenBalance[userId][tokenId] = currentBalance + credit;
            totalLedgerBalance[tokenId]       += credit;
        }

        logId = _logs.length;
        _logs.push(OwnershipLog({
            userId:      userId,
            tokenId:     tokenId,
            amountDelta: amountDelta,
            actionType:  actionType,
            loggedAt:    block.timestamp,
            refHash:     refHash,
            note:        note
        }));

        userLogs[userId].push(logId);

        emit OwnershipLogged(logId, userId, tokenId, amountDelta, actionType, refHash);
    }

    /**
     * @notice Log a retirement — permanently reduces the user's ledger
     *         balance and records it via a dedicated event + running
     *         retired-total, separate from logOwnershipChange() above,
     *         because retirement certificates (GHG Protocol / BRSR) need
     *         a clean, unambiguous, independently-queryable trail distinct
     *         from ordinary buy/sell activity.
     */
    function logRetirement(
        bytes32 userId,
        uint256 tokenId,
        uint256 amount,
        bytes32 refHash
    ) external onlyOperator whenNotPaused returns (uint256 logId) {
        require(userId != bytes32(0), "CreditLedger: zero userId");
        require(amount > 0,           "CreditLedger: zero amount");

        uint256 currentBalance = userTokenBalance[userId][tokenId];
        require(currentBalance >= amount, "CreditLedger: insufficient ledger balance");

        userTokenBalance[userId][tokenId] = currentBalance - amount;
        totalLedgerBalance[tokenId]       -= amount;
        userTokenRetired[userId][tokenId] += amount;

        logId = _logs.length;
        _logs.push(OwnershipLog({
            userId:      userId,
            tokenId:     tokenId,
            amountDelta: -int256(amount),
            actionType:  ActionType.RETIRE,
            loggedAt:    block.timestamp,
            refHash:     refHash,
            note:        ""
        }));

        userLogs[userId].push(logId);

        emit CreditRetiredLogged(logId, userId, tokenId, amount, refHash);
    }

    // ── View Functions ────────────────────────────────────

    function getLog(uint256 logId) external view returns (OwnershipLog memory) {
        return _logs[logId];
    }

    function getUserLogs(bytes32 userId) external view returns (uint256[] memory) {
        return userLogs[userId];
    }

    function getUserBalance(bytes32 userId, uint256 tokenId) external view returns (uint256) {
        return userTokenBalance[userId][tokenId];
    }

    function getUserRetired(bytes32 userId, uint256 tokenId) external view returns (uint256) {
        return userTokenRetired[userId][tokenId];
    }

    function totalLogs() external view returns (uint256) {
        return _logs.length;
    }

    /// @notice Helper so the backend and any outside auditor compute the
    ///         same userId hash the same way, every time.
    function computeUserId(string calldata userUuid) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(userUuid));
    }

    // ── Admin ─────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// RECONCILIATION NOTE (not enforced on-chain — an operational discipline,
// same as any custodial ledger):
//
// totalLedgerBalance[tokenId] tracked by this contract should, at any point
// in time, equal the pooled custody wallet's actual
// CarbonCreditToken.balanceOf(poolAddress, tokenId) on-chain. If they ever
// diverge, that's an immediate, checkable signal something is wrong — worth
// building a scheduled job that compares these two numbers and alerts if
// they don't match, the same way a bank reconciles its ledger against its
// actual vault holdings.
// ─────────────────────────────────────────────────────────────────────────────
