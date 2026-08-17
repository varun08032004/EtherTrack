// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title KeyManager
 * @notice Key management with HSM/KMS integration support
 *         Supports AWS KMS, HashiCorp Vault, and local key storage
 *         Provides secure signing operations without exposing private keys
 */
contract KeyManager is Ownable, AccessControl, Pausable, ReentrancyGuard {
    // ─────────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────────
    bytes32 public constant KEY_ADMIN_ROLE = keccak256("KEY_ADMIN_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant KEY_ROTATION_ROLE = keccak256("KEY_ROTATION_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // ─────────────────────────────────────────────────────────────
    // Key Storage (Encrypted References)
    // ─────────────────────────────────────────────────────────────

    struct KeyReference {
        string keyId;                    // Unique identifier
        KeyType keyType;                 // Type of key
        KeySource keySource;             // Where the key is stored
        string kmsKeyArn;                // AWS KMS Key ARN
        string vaultPath;                // Vault path
        string localKeyHash;             // Hash of local key (for verification)
        bool active;                     // Whether key is active
        uint256 createdAt;               // Creation timestamp
        uint256 rotatedAt;               // Last rotation timestamp
        uint256 expiresAt;               // Expiration timestamp (0 = never)
    }

    enum KeyType {
        ETH_SIGNING,       // Ethereum transaction signing
        JWT_SIGNING,       // JWT token signing
        TLS_CERT,          // TLS certificate
        DATABASE_ENCRYPTION, // Database encryption
        BACKUP_ENCRYPTION    // Backup encryption
    }

    enum KeySource {
        LOCAL,             // Encrypted in contract storage
        AWS_KMS,           // AWS Key Management Service
        HASHICORP_VAULT,   // HashiCorp Vault
        AZURE_KEY_VAULT,   // Azure Key Vault
        GCP_KMS,           // Google Cloud KMS
        HSM                // Hardware Security Module
    }

    // ─────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────

    mapping(bytes32 => KeyReference) public keys;
    bytes32[] public keyIds;
    mapping(KeyType => bytes32) public activeKeyByType;

    // External service clients (addresses of adapter contracts)
    address public kmsAdapter;
    address public vaultAdapter;
    address public hsmAdapter;

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event KeyCreated(
        bytes32 indexed keyId,
        KeyType keyType,
        KeySource keySource,
        address indexed creator
    );

    event KeyRotated(
        bytes32 indexed keyId,
        address indexed rotatedBy,
        uint256 newExpiresAt
    );

    event KeyRevoked(
        bytes32 indexed keyId,
        address indexed revokedBy,
        string reason
    );

    event KeyUsed(
        bytes32 indexed keyId,
        address indexed user,
        string operation
    );

    event KeyRotationScheduled(
        bytes32 indexed keyId,
        uint256 scheduledAt
    );

    event SigningRequested(
        bytes32 indexed requestId,
        bytes32 indexed keyId,
        address indexed requester,
        bytes32 dataHash
    );

    event SigningCompleted(
        bytes32 indexed requestId,
        bytes32 indexed keyId,
        bytes signature
    );

    event SigningFailed(
        bytes32 indexed requestId,
        bytes32 indexed keyId,
        string reason
    );

    // ─────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyKeyAdmin() {
        require(hasRole(KEY_ADMIN_ROLE, msg.sender), "KeyManager: not key admin");
        _;
    }

    modifier onlySigner() {
        require(hasRole(SIGNER_ROLE, msg.sender), "KeyManager: not signer");
        _;
    }

    modifier onlyKeyRotation() {
        require(hasRole(KEY_ROTATION_ROLE, msg.sender), "KeyManager: not key rotation role");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(address initialOwner) Ownable(initialOwner) {
        _setRoleAdmin(KEY_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(SIGNER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(KEY_ROTATION_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_ROLE, DEFAULT_ADMIN_ROLE);

        grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        grantRole(KEY_ADMIN_ROLE, initialOwner);
        grantRole(SIGNER_ROLE, initialOwner);
        grantRole(KEY_ROTATION_ROLE, initialOwner);
    }

    // ─────────────────────────────────────────────────────────────
    // Key Management
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Create a new key reference
     * @param keyId Unique identifier for the key
     * @param keyType Type of key
     * @param keySource Where the key is stored
     * @param kmsKeyArn AWS KMS Key ARN (for AWS KMS)
     * @param vaultPath Vault path (for HashiCorp Vault)
     * @param expiresAt Expiration timestamp (0 = never)
     * @return keyId The created key ID
     */
    function createKey(
        string calldata keyId,
        KeyType keyType,
        KeySource keySource,
        string calldata kmsKeyArn,
        string calldata vaultPath,
        uint256 expiresAt
    ) external onlyKeyAdmin returns (bytes32) {
        bytes32 id = keccak256(abi.encodePacked(keyId));
        require(keys[id].keyId.length == 0, "KeyManager: key already exists");

        KeyReference storage key = keys[id];
        key.keyId = keyId;
        key.keyType = keyType;
        key.keySource = keySource;
        key.kmsKeyArn = kmsKeyArn;
        key.vaultPath = vaultPath;
        key.active = true;
        key.createdAt = block.timestamp;
        key.rotatedAt = block.timestamp;
        key.expiresAt = expiresAt;

        // Generate local key hash for verification (if LOCAL source)
        if (keySource == KeySource.LOCAL) {
            key.localKeyHash = keccak256(abi.encodePacked(block.timestamp, msg.sender, keyId));
        }

        keyIds.push(id);
        activeKeyByType[keyType] = id;

        emit KeyCreated(id, keyType, keySource, msg.sender);
        return id;
    }

    /**
     * @notice Update key configuration
     */
    function updateKeyConfig(
        bytes32 keyId,
        string calldata kmsKeyArn,
        string calldata vaultPath,
        uint256 expiresAt,
        bool active
    ) external onlyKeyAdmin {
        KeyReference storage key = keys[keyId];
        require(key.keyId.length > 0, "KeyManager: key not found");

        if (bytes(kmsKeyArn).length > 0) key.kmsKeyArn = kmsKeyArn;
        if (bytes(vaultPath).length > 0) key.vaultPath = vaultPath;
        if (expiresAt > 0) key.expiresAt = expiresAt;
        key.active = active;
        key.rotatedAt = block.timestamp;

        emit KeyRotated(keyId, msg.sender, expiresAt);
    }

    /**
     * @notice Rotate a key (create new version, deactivate old)
     */
    function rotateKey(
        bytes32 keyId,
        string calldata newKmsKeyArn,
        string calldata newVaultPath,
        uint256 newExpiresAt
    ) external onlyKeyRotation {
        KeyReference storage oldKey = keys[keyId];
        require(oldKey.keyId.length > 0, "KeyManager: key not found");

        // Create new key with same type
        string memory newKeyId = string(abi.encodePacked(oldKey.keyId, "-v", Strings.toString(block.timestamp)));
        bytes32 newKeyId = keccak256(abi.encodePacked(newKeyId));

        KeyReference storage newKey = keys[newKeyId];
        newKey.keyId = newKeyId;
        newKey.keyType = oldKey.keyType;
        newKey.keySource = oldKey.keySource;
        newKey.kmsKeyArn = newKmsKeyArn;
        newKey.vaultPath = newVaultPath;
        newKey.active = true;
        newKey.createdAt = block.timestamp;
        newKey.rotatedAt = block.timestamp;
        newKey.expiresAt = newExpiresAt;

        // Deactivate old key
        oldKey.active = false;
        oldKey.expiresAt = block.timestamp;

        keyIds.push(newKeyId);
        activeKeyByType[oldKey.keyType] = newKeyId;

        emit KeyRotated(keyId, msg.sender, newExpiresAt);
    }

    /**
     * @notice Revoke a key (emergency)
     */
    function revokeKey(bytes32 keyId, string calldata reason) external onlyRole(EMERGENCY_ROLE) {
        KeyReference storage key = keys[keyId];
        require(key.keyId.length > 0, "KeyManager: key not found");
        require(key.active, "KeyManager: key already revoked");

        key.active = false;
        key.expiresAt = block.timestamp;

        // If this was the active key for its type, clear it
        if (activeKeyByType[key.keyType] == keyId) {
            activeKeyByType[key.keyType] = bytes32(0);
        }

        emit KeyRevoked(keyId, msg.sender, reason);
    }

    /**
     * @notice Get active key for a key type
     */
    function getActiveKey(KeyType keyType) external view returns (KeyReference memory) {
        bytes32 keyId = activeKeyByType[keyType];
        return keys[keyId];
    }

    // ─────────────────────────────────────────────────────────────
    // Signing Operations (via External Adapters)
    // ─────────────────────────────────────────────────────────────

    struct SigningRequest {
        bytes32 requestId;
        bytes32 keyId;
        address requester;
        bytes data;
        bytes32 dataHash;
        uint256 timestamp;
        bool completed;
        bytes signature;
        string error;
    }

    mapping(bytes32 => SigningRequest) public signingRequests;
    bytes32[] public pendingSigningRequests;
    uint256 public nextRequestId;

    /**
     * @notice Request signing operation (async via adapter)
     */
    function requestSigning(
        KeyType keyType,
        bytes calldata data
    ) external onlySigner whenNotPaused returns (bytes32) {
        bytes32 keyId = activeKeyByType[keyType];
        require(keyId != bytes32(0), "KeyManager: no active key for type");

        KeyReference storage key = keys[keyId];
        require(key.active, "KeyManager: key not active");
        require(key.expiresAt == 0 || key.expiresAt > block.timestamp, "KeyManager: key expired");

        bytes32 requestId = keccak256(abi.encodePacked(block.timestamp, msg.sender, nextRequestId));
        nextRequestId++;

        bytes32 dataHash = keccak256(data);

        SigningRequest storage request = signingRequests[requestId];
        request.requestId = requestId;
        request.keyId = keyId;
        request.requester = msg.sender;
        request.data = data;
        request.dataHash = dataHash;
        request.timestamp = block.timestamp;
        request.completed = false;

        pendingSigningRequests.push(requestId);

        emit SigningRequested(requestId, keyId, msg.sender, dataHash);
        return requestId;
    }

    /**
     * @notice Adapter calls this to submit signature
     */
    function submitSignature(
        bytes32 requestId,
        bytes calldata signature
    ) external {
        SigningRequest storage request = signingRequests[requestId];
        require(request.requestId != bytes32(0), "KeyManager: request not found");
        require(!request.completed, "KeyManager: request already completed");

        request.signature = signature;
        request.completed = true;

        emit SigningCompleted(requestId, request.keyId, signature);
    }

    /**
     * @notice Adapter reports signing failure
     */
    function reportSigningFailure(
        bytes32 requestId,
        string calldata reason
    ) external {
        SigningRequest storage request = signingRequests[requestId];
        require(request.requestId != bytes32(0), "KeyManager: request not found");
        require(!request.completed, "KeyManager: request already completed");

        request.completed = true;
        request.error = reason;

        emit SigningFailed(requestId, request.keyId, reason);
    }

    /**
     * @notice Get signing result
     */
    function getSigningResult(bytes32 requestId) external view returns (bytes memory, string memory) {
        SigningRequest storage request = signingRequests[requestId];
        require(request.requestId != bytes32(0), "KeyManager: request not found");
        return (request.signature, request.error);
    }

    // ─────────────────────────────────────────────────────────────
    // Adapter Registration
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Register KMS adapter contract
     */
    function setKmsAdapter(address adapter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        kmsAdapter = adapter;
    }

    /**
     * @notice Register Vault adapter contract
     */
    function setVaultAdapter(address adapter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        vaultAdapter = adapter;
    }

    /**
     * @notice Register HSM adapter contract
     */
    function setHsmAdapter(address adapter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        hsmAdapter = adapter;
    }

    // ─────────────────────────────────────────────────────────────
    // Key Rotation Scheduling
    // ─────────────────────────────────────────────────────────────

    struct RotationSchedule {
        bytes32 keyId;
        uint256 interval;      // Rotation interval in seconds
        uint256 nextRotation;  // Next rotation timestamp
        bool enabled;
    }

    mapping(bytes32 => RotationSchedule) public rotationSchedules;
    bytes32[] public scheduledRotations;

    function scheduleKeyRotation(
        bytes32 keyId,
        uint256 interval,
        uint256 startAt
    ) external onlyKeyRotation {
        KeyReference storage key = keys[keyId];
        require(key.keyId.length > 0, "KeyManager: key not found");

        RotationSchedule storage schedule = rotationSchedules[keyId];
        schedule.keyId = keyId;
        schedule.interval = interval;
        schedule.nextRotation = startAt > 0 ? startAt : block.timestamp + interval;
        schedule.enabled = true;

        scheduledRotations.push(keyId);
        emit KeyRotationScheduled(keyId, schedule.nextRotation);
    }

    function cancelKeyRotation(bytes32 keyId) external onlyKeyRotation {
        RotationSchedule storage schedule = rotationSchedules[keyId];
        schedule.enabled = false;
    }

    // ─────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────

    function getKey(bytes32 keyId) external view returns (KeyReference memory) {
        return keys[keyId];
    }

    function getKeyByType(KeyType keyType) external view returns (KeyReference memory) {
        return keys[activeKeyByType[keyType]];
    }

    function getKeyRotationSchedule(bytes32 keyId) external view returns (
        uint256 interval,
        uint256 nextRotation,
        bool enabled
    ) {
        RotationSchedule storage schedule = rotationSchedules[keyId];
        return (schedule.interval, schedule.nextRotation, schedule.enabled);
    }

    function getSigningRequest(bytes32 requestId) external view returns (
        bytes32 keyId,
        address requester,
        bytes32 dataHash,
        uint256 timestamp,
        bool completed,
        bytes signature,
        string memory error
    ) {
        SigningRequest storage request = signingRequests[requestId];
        return (request.keyId, request.requester, request.dataHash, request.timestamp, request.completed, request.signature, request.error);
    }

    // ─────────────────────────────────────────────────────────────
    // Emergency Functions
    // ─────────────────────────────────────────────────────────────

    function emergencyPause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    function emergencyUnpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function emergencyRevokeAllKeys() external onlyRole(EMERGENCY_ROLE) {
        for (uint256 i = 0; i < keyIds.length; i++) {
            keys[keyIds[i]].active = false;
        }
        // Clear active keys
        for (uint256 i = 0; i < 5; i++) { // KeyType enum has 5 values
            activeKeyByType(KeyType(i)) = bytes32(0);
        }
    }
}