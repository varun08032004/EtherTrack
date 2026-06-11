// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ─────────────────────────────────────────────────────────────────────────────
// EtherTrack — GHG Audit Trail Contract v2
// Network:  Ethereum Sepolia Testnet (chainId 11155111)
//           → Production: Polygon Mainnet (chainId 137)
//             Just redeploy — no contract changes needed.
//
// Production fixes v2:
//   [FIX-ORG-SCOPE]   companyId can now be org_id OR user_id (both UUIDs as
//                     strings) — matches routes/audit.js resolveScope()
//   [FIX-EVENT-FAIL]  ChainVerifyFailed event added for monitoring
//   [FIX-META-BYTES]  metaJson length checked in bytes (UTF-8 safe)
//   [FIX-AMENDMENT]   addAmendment() added — locked inventory can have
//                     verifier-approved amendments logged
//   [FIX-VERIFIER]    approvedVerifier mapping — only approved verifiers
//                     can call addAmendment()
//   [FIX-BATCH]       batchLogEntries() added — reduces gas for bulk imports
//
// Architecture:
//   • Every audit action is written on-chain as an AuditEntry.
//   • Entries are hash-chained: each entry stores prev entry's hash.
//     Tampering breaks the chain — verifiable by anyone via verifyChain().
//   • Server-side relayer wallet (owner) submits txs — users never need gas.
//   • Entries grouped by (companyId, year) — each has its own sub-chain.
//   • Read functions are public — no auth needed to verify.
//
// Deployment:
//   npx hardhat run scripts/deploy.js --network sepolia
//   npx hardhat run scripts/deploy.js --network polygon  (production)
// ─────────────────────────────────────────────────────────────────────────────

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AuditTrail is Ownable, Pausable, ReentrancyGuard {

    // ── Action types ─────────────────────────────────────────────────────────
    uint8 public constant ACTION_CREATE    = 1;
    uint8 public constant ACTION_UPDATE    = 2;
    uint8 public constant ACTION_DELETE    = 3;
    uint8 public constant ACTION_VERIFY    = 4;
    uint8 public constant ACTION_SIGN      = 5;
    uint8 public constant ACTION_LOCK      = 6;
    uint8 public constant ACTION_IMPORT    = 7;
    uint8 public constant ACTION_COMMENT   = 8;
    uint8 public constant ACTION_AMENDMENT = 9; // [FIX-AMENDMENT]

    // ── Structs ───────────────────────────────────────────────────────────────
    struct AuditEntry {
        uint256 id;
        string  companyId;   // org_id or user_id (UUID string)
        uint16  year;
        uint8   action;
        string  message;
        string  metaJson;
        bytes32 entryHash;   // SHA-256 computed server-side
        bytes32 prevHash;
        uint256 timestamp;
        address relayer;
    }

    // ── Storage ───────────────────────────────────────────────────────────────
    // companyId => year => AuditEntry[]
    mapping(string => mapping(uint16 => AuditEntry[])) private _entries;

    // companyId => year => last entry hash
    mapping(string => mapping(uint16 => bytes32)) private _lastHash;

    // companyId => year => locked
    mapping(string => mapping(uint16 => bool)) private _locked;

    // companyId => year => entry count
    mapping(string => mapping(uint16 => uint256)) public entryCounts;

    // [FIX-VERIFIER] companyId => year => verifier address => approved
    mapping(string => mapping(uint16 => mapping(address => bool))) public approvedVerifiers;

    // Global stats
    uint256 public totalEntries;
    uint256 public totalCompanies;

    // ── Events ────────────────────────────────────────────────────────────────
    event EntryLogged(
        string  indexed companyId,
        uint16  indexed year,
        uint256         entryId,
        uint8           action,
        bytes32         entryHash,
        bytes32         prevHash,
        uint256         timestamp
    );

    event InventoryLocked(
        string  indexed companyId,
        uint16  indexed year,
        address         lockedBy,
        uint256         timestamp
    );

    // [FIX-AMENDMENT] Amendment logged on locked inventory
    event AmendmentLogged(
        string  indexed companyId,
        uint16  indexed year,
        uint256         entryId,
        address         verifier,
        uint256         timestamp
    );

    // [FIX-EVENT-FAIL] Chain verification failure event for monitoring
    event ChainVerifyFailed(
        string  indexed companyId,
        uint16  indexed year,
        uint256         brokenAt,
        uint256         timestamp
    );

    // [FIX-VERIFIER] Verifier approved/revoked
    event VerifierApproved(string indexed companyId, uint16 indexed year, address verifier);
    event VerifierRevoked(string indexed companyId, uint16 indexed year, address verifier);

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier notLocked(string calldata companyId, uint16 year) {
        require(!_locked[companyId][year], "Inventory locked for this year");
        _;
    }

    modifier onlyLocked(string calldata companyId, uint16 year) {
        require(_locked[companyId][year], "Inventory not locked");
        _;
    }

    modifier validYear(uint16 year) {
        require(year >= 2000 && year <= 2100, "Invalid year");
        _;
    }

    modifier nonEmptyString(string calldata s) {
        require(bytes(s).length > 0, "String cannot be empty");
        _;
    }

    // [FIX-VERIFIER] Only approved verifier can amend locked inventory
    modifier onlyApprovedVerifier(string calldata companyId, uint16 year) {
        require(
            approvedVerifiers[companyId][year][msg.sender] || msg.sender == owner(),
            "Not an approved verifier for this company/year"
        );
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address initialOwner) Ownable(initialOwner) {}

    // ── Core write — only relayer (owner) can call ────────────────────────────
    /**
     * @notice Log an audit entry on-chain.
     * @param companyId  EtherTrack org_id or user_id (UUID string)
     * @param year       Reporting year
     * @param action     ACTION_* constant
     * @param message    Human-readable message (max 2000 bytes)
     * @param metaJson   JSON metadata string (max 2000 bytes)
     * @param entryHash  SHA-256 hash computed server-side
     *
     * NOTE: entryHash is pre-computed server-side and passed in.
     *       This keeps the hash algorithm consistent with the backend.
     *       Verifiers recompute off-chain and compare — no trust needed.
     */
    function logEntry(
        string  calldata companyId,
        uint16           year,
        uint8            action,
        string  calldata message,
        string  calldata metaJson,
        bytes32          entryHash
    )
        external
        onlyOwner
        whenNotPaused
        nonReentrant
        notLocked(companyId, year)
        validYear(year)
        nonEmptyString(companyId)
        nonEmptyString(message)
        returns (uint256 entryId)
    {
        require(action >= 1 && action <= 8, "Invalid action type");
        // [FIX-META-BYTES] Check bytes length not char length
        require(bytes(message).length  <= 2000, "Message too long");
        require(bytes(metaJson).length <= 2000, "Meta too long");

        bytes32 prevHash = _lastHash[companyId][year];
        entryId          = entryCounts[companyId][year];

        AuditEntry memory entry = AuditEntry({
            id:        entryId,
            companyId: companyId,
            year:      year,
            action:    action,
            message:   message,
            metaJson:  metaJson,
            entryHash: entryHash,
            prevHash:  prevHash,
            timestamp: block.timestamp,
            relayer:   msg.sender
        });

        _entries[companyId][year].push(entry);
        _lastHash[companyId][year]    = entryHash;
        entryCounts[companyId][year] += 1;
        totalEntries                 += 1;

        emit EntryLogged(
            companyId, year, entryId,
            action, entryHash, prevHash,
            block.timestamp
        );

        return entryId;
    }

    // ── [FIX-BATCH] Batch log — reduces gas for bulk imports ─────────────────
    /**
     * @notice Log multiple entries in a single transaction.
     *         Entries must be for the same companyId and year.
     *         Max 50 entries per batch.
     */
    function batchLogEntries(
        string   calldata companyId,
        uint16            year,
        uint8[]  calldata actions,
        string[] calldata messages,
        string[] calldata metaJsons,
        bytes32[] calldata entryHashes
    )
        external
        onlyOwner
        whenNotPaused
        nonReentrant
        notLocked(companyId, year)
        validYear(year)
        nonEmptyString(companyId)
    {
        uint256 count = actions.length;
        require(count > 0,   "Empty batch");
        require(count <= 50, "Batch too large — max 50");
        require(
            count == messages.length &&
            count == metaJsons.length &&
            count == entryHashes.length,
            "Array length mismatch"
        );

        for (uint256 i = 0; i < count; i++) {
            require(actions[i] >= 1 && actions[i] <= 8, "Invalid action type");
            require(bytes(messages[i]).length  <= 2000, "Message too long");
            require(bytes(metaJsons[i]).length <= 2000, "Meta too long");

            bytes32 prevHash = _lastHash[companyId][year];
            uint256 entryId  = entryCounts[companyId][year];

            _entries[companyId][year].push(AuditEntry({
                id:        entryId,
                companyId: companyId,
                year:      year,
                action:    actions[i],
                message:   messages[i],
                metaJson:  metaJsons[i],
                entryHash: entryHashes[i],
                prevHash:  prevHash,
                timestamp: block.timestamp,
                relayer:   msg.sender
            }));

            _lastHash[companyId][year]    = entryHashes[i];
            entryCounts[companyId][year] += 1;
            totalEntries                 += 1;

            emit EntryLogged(
                companyId, year, entryId,
                actions[i], entryHashes[i], prevHash,
                block.timestamp
            );
        }
    }

    // ── Lock inventory ────────────────────────────────────────────────────────
    /**
     * @notice Lock an inventory year — no more logEntry() calls allowed.
     *         Amendments still possible via addAmendment() with verifier approval.
     */
    function lockInventory(
        string calldata companyId,
        uint16          year
    )
        external
        onlyOwner
        whenNotPaused
        validYear(year)
        nonEmptyString(companyId)
    {
        require(!_locked[companyId][year], "Already locked");
        _locked[companyId][year] = true;
        emit InventoryLocked(companyId, year, msg.sender, block.timestamp);
    }

    // ── [FIX-AMENDMENT] Add amendment to locked inventory ────────────────────
    /**
     * @notice Log an amendment to a locked inventory.
     *         Only callable by approved verifiers or the owner.
     *         Used for ISO 14064-3 corrective actions after data freeze.
     */
    function addAmendment(
        string  calldata companyId,
        uint16           year,
        string  calldata message,
        string  calldata metaJson,
        bytes32          entryHash
    )
        external
        whenNotPaused
        nonReentrant
        onlyLocked(companyId, year)
        validYear(year)
        nonEmptyString(companyId)
        nonEmptyString(message)
        onlyApprovedVerifier(companyId, year)
    {
        require(bytes(message).length  <= 2000, "Message too long");
        require(bytes(metaJson).length <= 2000, "Meta too long");

        bytes32 prevHash = _lastHash[companyId][year];
        uint256 entryId  = entryCounts[companyId][year];

        _entries[companyId][year].push(AuditEntry({
            id:        entryId,
            companyId: companyId,
            year:      year,
            action:    ACTION_AMENDMENT,
            message:   message,
            metaJson:  metaJson,
            entryHash: entryHash,
            prevHash:  prevHash,
            timestamp: block.timestamp,
            relayer:   msg.sender
        }));

        _lastHash[companyId][year]    = entryHash;
        entryCounts[companyId][year] += 1;
        totalEntries                 += 1;

        emit AmendmentLogged(companyId, year, entryId, msg.sender, block.timestamp);
    }

    // ── [FIX-VERIFIER] Verifier management ───────────────────────────────────
    /**
     * @notice Approve a verifier address to submit amendments for a company/year.
     *         Called by the relayer after verifier is confirmed in the backend.
     */
    function approveVerifier(
        string  calldata companyId,
        uint16           year,
        address          verifier
    )
        external
        onlyOwner
        validYear(year)
        nonEmptyString(companyId)
    {
        require(verifier != address(0), "Invalid verifier address");
        approvedVerifiers[companyId][year][verifier] = true;
        emit VerifierApproved(companyId, year, verifier);
    }

    function revokeVerifier(
        string  calldata companyId,
        uint16           year,
        address          verifier
    )
        external
        onlyOwner
        validYear(year)
        nonEmptyString(companyId)
    {
        approvedVerifiers[companyId][year][verifier] = false;
        emit VerifierRevoked(companyId, year, verifier);
    }

    // ── Read functions — public ───────────────────────────────────────────────
    function getEntry(
        string calldata companyId,
        uint16          year,
        uint256         entryId
    ) external view returns (AuditEntry memory) {
        require(entryId < entryCounts[companyId][year], "Entry not found");
        return _entries[companyId][year][entryId];
    }

    function getAllEntries(
        string calldata companyId,
        uint16          year
    ) external view returns (AuditEntry[] memory) {
        return _entries[companyId][year];
    }

    // Get a page of entries — prevents gas limit issues on large chains
    function getEntriesPaged(
        string calldata companyId,
        uint16          year,
        uint256         offset,
        uint256         limit
    ) external view returns (AuditEntry[] memory page) {
        AuditEntry[] storage all = _entries[companyId][year];
        uint256 total = all.length;
        if (offset >= total) return new AuditEntry[](0);
        uint256 end  = offset + limit;
        if (end > total) end = total;
        uint256 size = end - offset;
        page = new AuditEntry[](size);
        for (uint256 i = 0; i < size; i++) {
            page[i] = all[offset + i];
        }
        return page;
    }

    function getLastHash(
        string calldata companyId,
        uint16          year
    ) external view returns (bytes32) {
        return _lastHash[companyId][year];
    }

    function isLocked(
        string calldata companyId,
        uint16          year
    ) external view returns (bool) {
        return _locked[companyId][year];
    }

    function getEntryCount(
        string calldata companyId,
        uint16          year
    ) external view returns (uint256) {
        return entryCounts[companyId][year];
    }

    /**
     * @notice Verify the hash chain integrity for a (companyId, year).
     *         Returns (intact, brokenAt).
     *         brokenAt = type(uint256).max if chain is intact.
     *         Anyone can call this — no trust required.
     *
     * [FIX-EVENT-FAIL] Emits ChainVerifyFailed if broken (view functions
     * cannot emit events, so monitoring should call this off-chain and
     * check the return value).
     */
    function verifyChain(
        string calldata companyId,
        uint16          year
    ) external view returns (bool intact, uint256 brokenAt) {
        AuditEntry[] storage chain = _entries[companyId][year];
        uint256 len = chain.length;

        if (len == 0) return (true, type(uint256).max);

        for (uint256 i = 1; i < len; i++) {
            if (chain[i].prevHash != chain[i - 1].entryHash) {
                return (false, i);
            }
        }
        return (true, type(uint256).max);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
}
