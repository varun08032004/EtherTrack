// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title HSMAdapter
 * @notice Abstract interface for Hardware Security Module integration
 *         Supports AWS CloudHSM, Azure Dedicated HSM, and generic PKCS#11
 */
abstract contract HSMAdapter is Ownable, AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant HSM_ADMIN_ROLE = keccak256("HSM_ADMIN_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("HSM_SIGNER_ROLE");
    bytes32 public constant KEY_MANAGER_ROLE = keccak256("HSM_KEY_MANAGER_ROLE");

    // ─────────────────────────────────────────────────────────────
    // Key Storage
    // ─────────────────────────────────────────────────────────────

    struct HSMKey {
        bytes32 keyId;
        string label;
        KeyAlgorithm algorithm;
        KeyUsage usage;
        KeySource source;           // LOCAL, AWS_CLOUDHSM, AZURE_DEDICATED_HSM, PKCS11
        string hsmKeyHandle;       // HSM-specific key handle/reference
        string hsmClusterId;       // HSM cluster/partition ID
        string keyCheckValue;      // KCV for verification
        bool exportable;           // Whether key can be exported
        bool active;
        uint256 createdAt;
        uint256 rotatedAt;
        uint256 expiresAt;
    }

    enum KeyAlgorithm {
        SECP256K1,      // Ethereum/Bitcoin
        SECP256R1,      // NIST P-256
        SECP384R1,      // NIST P-384
        ED25519,        // EdDSA
        RSA_2048,       // RSA 2048-bit
        RSA_3072,       // RSA 3072-bit
        RSA_4096,       // RSA 4096-bit
        AES_256_GCM     // AES-256-GCM
    }

    enum KeyUsage {
        SIGNING,        // Digital signatures
        ENCRYPTION,     // Encryption/decryption
        KEY_AGREEMENT,  // ECDH key exchange
        WRAPPING,       // Key wrapping/unwrapping
        MAC,            // Message authentication
        DERIVATION      // Key derivation
    }

    enum KeySource {
        LOCAL,              // Software keystore
        AWS_CLOUDHSM,       // AWS CloudHSM
        AZURE_DEDICATED_HSM, // Azure Dedicated HSM
        GOOGLE_CLOUD_HSM,   // Google Cloud HSM
        PKCS11,             // Generic PKCS#11
        SOFTWARE            // Software fallback
    }

    // ─────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────

    mapping(bytes32 => HSMKey) public keys;
    bytes32[] public keyIds;
    mapping(bytes32 => string) public keyLabels;  // Human-readable labels

    // HSM Connection
    address public hsmClient;          // Off-chain HSM client address
    string public hsmEndpoint;         // HSM endpoint URL
    string public hsmClusterId;        // HSM cluster/partition identifier
    string public hsmPartition;        // HSM partition name
    uint256 public hsmPort;            // HSM port (typically 2225/2226)

    // Session management
    mapping(address => uint256) public hsmSessions;  // Active sessions per user
    uint256 public maxSessionDuration = 1 hours;
    uint256 public maxConcurrentSessions = 10;

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event KeyGenerated(
        bytes32 indexed keyId,
        string label,
        KeyAlgorithm algorithm,
        KeyUsage usage,
        KeySource source,
        address indexed creator
    );

    event KeyImported(
        bytes32 indexed keyId,
        string label,
        KeySource source,
        address indexed importer
    );

    event KeyRotated(
        bytes32 indexed oldKeyId,
        bytes32 indexed newKeyId,
        address indexed rotator
    );

    event KeyRevoked(
        bytes32 indexed keyId,
        address indexed revoker,
        string reason
    );

    event KeyWrapped(
        bytes32 indexed keyId,
        bytes32 wrappingKeyId,
        bytes wrappedKey
    );

    event KeyUnwrapped(
        bytes32 indexed wrappingKeyId,
        bytes32 indexed keyId,
        address indexed unwrapper
    );

    event SignatureGenerated(
        bytes32 indexed keyId,
        bytes32 indexed dataHash,
        bytes signature,
        address indexed signer
    );

    event SignatureVerified(
        bytes32 indexed keyId,
        bytes32 indexed dataHash,
        bool valid,
        address indexed verifier
    );

    event EncryptionPerformed(
        bytes32 indexed keyId,
        bytes32 indexed dataHash,
        address indexed encryptor
    );

    event DecryptionPerformed(
        bytes32 indexed keyId,
        bytes32 indexed dataHash,
        address indexed decryptor
    );

    event KeyWrappingPerformed(
        bytes32 indexed wrappingKeyId,
        bytes32 indexed keyId,
        address indexed wrapper
    );

    event KeyUnwrappingPerformed(
        bytes32 indexed wrappingKeyId,
        bytes32 indexed keyId,
        address indexed unwrapper
    );

    event HSMHealthCheck(
        bool healthy,
        uint256 latencyMs,
        string details
    );

    event HSMClusterChanged(
        string oldClusterId,
        string newClusterId,
        address indexed changer
    );

    event HMSSessionCreated(
        address indexed user,
        uint256 sessionId,
        uint256 expiresAt
    );

    event HMSSessionRevoked(
        address indexed user,
        uint256 sessionId,
        string reason
    );

    // ─────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyHSMAdmin() {
        require(hasRole(HSM_ADMIN_ROLE, msg.sender), "HSMAdapter: not HSM admin");
        _;
    }

    modifier onlySigner() {
        require(hasRole(SIGNER_ROLE, msg.sender), "HSMAdapter: not signer");
        _;
    }

    modifier onlyKeyManager() {
        require(hasRole(KEY_MANAGER_ROLE, msg.sender), "HSMAdapter: not key manager");
        _;
    }

    modifier validSession() {
        uint256 sessionId = hsmSessions[msg.sender];
        require(sessionId > 0, "HSMAdapter: no active session");
        // In production, would check session expiry
        _;
    }

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address initialOwner,
        string calldata _hsmEndpoint,
        string calldata _hsmClusterId,
        string calldata _hsmPartition,
        uint256 _hsmPort
    ) Ownable(initialOwner) {
        _setRoleAdmin(HSM_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(SIGNER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(KEY_MANAGER_ROLE, DEFAULT_ADMIN_ROLE);

        grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        grantRole(HSM_ADMIN_ROLE, initialOwner);
        grantRole(SIGNER_ROLE, initialOwner);
        grantRole(KEY_MANAGER_ROLE, initialOwner);

        hsmEndpoint = _hsmEndpoint;
        hsmClusterId = _hsmClusterId;
        hsmPartition = _hsmPartition;
        hsmPort = _hsmPort;
    }

    // ─────────────────────────────────────────────────────────────
    // Key Management
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Generate a new key in the HSM
     */
    function generateKey(
        string calldata label,
        KeyAlgorithm algorithm,
        KeyUsage usage,
        KeySource source,
        bool exportable,
        uint256 expiresAt
    ) external onlyKeyManager whenNotPaused returns (bytes32) {
        bytes32 keyId = keccak256(abi.encodePacked(label, block.timestamp, msg.sender));
        require(keys[keyId].label.length == 0, "HSMAdapter: key already exists");

        HSMKey storage key = keys[keyId];
        key.keyId = keccak256(abi.encodePacked(label, block.timestamp, msg.sender));
        key.label = label;
        key.algorithm = algorithm;
        key.usage = usage;
        key.source = source;
        key.hsmClusterId = hsmClusterId;
        key.keyCheckValue = "";  // Set after generation
        key.exportable = exportable;
        key.active = true;
        key.createdAt = block.timestamp;
        key.rotatedAt = block.timestamp;
        key.expiresAt = expiresAt;

        // In production, would call HSM to generate key
        // key.hsmKeyHandle = hsmClient.generateKey(algorithm, usage, exportable);

        // Placeholder for KCV (Key Check Value)
        key.keyCheckValue = "PENDING_HSM_GENERATION";

        keyIds.push(keyId);
        keyLabels[key.keyId] = label;

        emit KeyGenerated(keyId, label, algorithm, usage, source, msg.sender);
        return key.keyId;
    }

    /**
     * @notice Import a key into the HSM (wrapped)
     */
    function importKey(
        string calldata label,
        KeyAlgorithm algorithm,
        KeyUsage usage,
        bytes calldata wrappedKey,
        bytes32 wrappingKeyId,
        string calldata wrappingKeyHandle,
        uint256 expiresAt
    ) external onlyKeyManager whenNotPaused returns (bytes32) {
        bytes32 keyId = keccak256(abi.encodePacked(label, block.timestamp, msg.sender));
        require(keys[keyId].label.length == 0, "HSMAdapter: key already exists");

        // Verify wrapping key
        require(keys[wrappingKeyId].active, "HSMAdapter: wrapping key not active");
        require(keys[wrappingKeyId].usage == KeyUsage.WRAPPING, "HSMAdapter: wrapping key not for wrapping");

        // In production: unwrap key using HSM
        // bytes memory unwrappedKey = hsmClient.unwrapKey(wrappingKeyHandle, wrappedKey, algorithm);

        HSMKey storage key = keys[keyId];
        key.keyId = keccak256(abi.encodePacked(label, block.timestamp, msg.sender));
        key.label = label;
        key.algorithm = algorithm;
        key.usage = usage;
        key.source = KeySource.LOCAL;  // Imported keys are local initially
        key.hsmKeyHandle = "IMPORTED_" + label;
        key.hsmClusterId = hsmClusterId;
        key.exportable = true;
        key.active = true;
        key.createdAt = block.timestamp;
        key.rotatedAt = block.timestamp;
        key.expiresAt = expiresAt;

        keyIds.push(keyId);
        keyLabels[key.keyId] = label;

        emit KeyImported(keyId, label, KeySource.LOCAL, msg.sender);
        return keyId;
    }

    /**
     * @notice Export a key (wrapped)
     */
    function wrapKey(
        bytes32 keyId,
        bytes32 wrappingKeyId
    ) external onlyKeyManager whenNotPaused returns (bytes memory) {
        require(keys[keyId].active, "HSMAdapter: key not active");
        require(keys[keyId].exportable, "HSMAdapter: key not exportable");
        require(keys[wrappingKeyId].active, "HSMAdapter: wrapping key not active");
        require(keys[wrappingKeyId].usage == KeyUsage.WRAPPING, "HSMAdapter: wrapping key not for wrapping");

        // In production: call HSM to wrap key
        // bytes memory wrappedKey = hsmClient.wrapKey(
        //     keys[keyId].hsmKeyHandle,
        //     keys[wrappingKeyId].hsmKeyHandle
        // );

        bytes memory wrappedKey = abi.encodePacked("WRAPPED_", keyId, "_WITH_", wrappingKeyId);

        emit KeyWrapped(keyId, wrappingKeyId, wrappedKey);
        return wrappedKey;
    }

    /**
     * @notice Unwrap a key
     */
    function unwrapKey(
        bytes32 wrappingKeyId,
        bytes calldata wrappedKey
    ) external onlyKeyManager whenNotPaused returns (bytes32) {
        require(keys[wrappingKeyId].active, "HSMAdapter: wrapping key not active");
        require(keys[wrappingKeyId].usage == KeyUsage.WRAPPING, "HSMAdapter: wrapping key not for unwrapping");

        // In production: call HSM to unwrap
        // bytes32 keyId = hsmClient.unwrapKey(keys[wrappingKeyId].hsmKeyHandle, wrappedKey);

        bytes32 keyId = keccak256(abi.encodePacked("UNWRAPPED_", wrappingKeyId, block.timestamp));

        emit KeyUnwrapped(wrappingKeyId, keyId, msg.sender);
        return keyId;
    }

    // ─────────────────────────────────────────────────────────────
    // Cryptographic Operations
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Sign data with HSM key
     */
    function sign(
        bytes32 keyId,
        bytes calldata data
    ) external onlySigner whenNotPaused returns (bytes memory) {
        require(keys[keyId].active, "HSMAdapter: key not active");
        require(keys[keyId].algorithm == KeyAlgorithm.SECP256K1 || 
                keys[keyId].algorithm == KeyAlgorithm.ED25519,
            "HSMAdapter: key algorithm not supported for signing");

        // In production: call HSM to sign
        // bytes memory signature = hsmClient.sign(keys[keyId].hsmKeyHandle, data);

        // EIP-191 message hashing
        bytes32 messageHash = keccak256(abi.encodePacked(
            "\x19Ethereum Signed Message:\n",
            Bytes(data).length,
            data
        ));

        // Placeholder signature
        bytes memory signature = abi.encodePacked("HSM_SIGNATURE_", keyId, "_", keccak256(data));

        emit SignatureGenerated(keyId, keccak256(data), signature, msg.sender);
        return signature;
    }

    /**
     * @notice Verify a signature
     */
    function verify(
        bytes32 keyId,
        bytes calldata data,
        bytes calldata signature
    ) external view returns (bool) {
        // In production, would use HSM or ecrecover for verification
        // This is a placeholder
        return true;
    }

    /**
     * @notice Encrypt data with HSM key
     */
    function encrypt(
        bytes32 keyId,
        bytes calldata plaintext,
        bytes calldata aad
    ) external onlySigner whenNotPaused returns (bytes memory) {
        require(keys[keyId].active, "HSMAdapter: key not active");
        require(keys[keyId].usage == KeyUsage.ENCRYPTION || 
                keys[keyId].usage == KeyUsage.KEY_AGREEMENT,
            "HSMAdapter: key not for encryption");

        // In production: call HSM to encrypt
        // bytes memory ciphertext = hsmClient.encrypt(keys[keyId].hsmKeyHandle, plaintext, aad);

        bytes memory ciphertext = abi.encodePacked("ENCRYPTED_", keccak256(data));
        emit EncryptionPerformed(keyId, keccak256(data), msg.sender);
        return ciphertext;
    }

    /**
     * @notice Decrypt data with HSM key
     */
    function decrypt(
        bytes32 keyId,
        bytes calldata ciphertext,
        bytes calldata aad
    ) external onlySigner whenNotPaused returns (bytes memory) {
        require(keys[keyId].active, "HSMAdapter: key not active");
        require(keys[keyId].usage == KeyUsage.ENCRYPTION ||
                keys[keyId].usage == KeyUsage.KEY_AGREEMENT,
            "HSMAdapter: key not for decryption");

        // In production: call HSM to decrypt
        // bytes memory plaintext = hsmClient.decrypt(keys[keyId].hsmKeyHandle, ciphertext, aad);

        bytes memory plaintext = abi.encodePacked("DECRYPTED_", keccak256(ciphertext));
        emit DecryptionPerformed(keyId, keccak256(ciphertext), msg.sender);
        return plaintext;
    }

    // ─────────────────────────────────────────────────────────────
    // Key Wrapping/Unwrapping
    // ─────────────────────────────────────────────────────────────

    function wrapKey(
        bytes32 keyId,
        bytes32 wrappingKeyId
    ) external onlyKeyManager whenNotPaused returns (bytes memory) {
        require(keys[keyId].active, "HSMAdapter: key not active");
        require(keys[keyId].exportable, "HSMAdapter: key not exportable");
        require(keys[wrappingKeyId].active, "HSMAdapter: wrapping key not active");
        require(keys[wrappingKeyId].usage == KeyUsage.WRAPPING, "HSMAdapter: wrapping key not for wrapping");

        // In production: call HSM to wrap key
        bytes memory wrappedKey = abi.encodePacked("WRAPPED_", keyId, "_WITH_", wrappingKeyId);

        emit KeyWrappingPerformed(wrappingKeyId, keyId, msg.sender);
        return wrappedKey;
    }

    function unwrapKey(
        bytes32 wrappingKeyId,
        bytes calldata wrappedKey
    ) external onlyKeyManager whenNotPaused returns (bytes32) {
        require(keys[wrappingKeyId].active, "HSMAdapter: wrapping key not active");
        require(keys[wrappingKeyId].usage == KeyUsage.WRAPPING, "HSMAdapter: wrapping key not for unwrapping");

        // In production: call HSM to unwrap
        bytes32 keyId = keccak256(abi.encodePacked("UNWRAPPED_", wrappingKeyId, block.timestamp));

        emit KeyUnwrappingPerformed(wrappingKeyId, keyId, msg.sender);
        return keyId;
    }

    // ─────────────────────────────────────────────────────────────
    // Key Lifecycle
    // ─────────────────────────────────────────────────────────────

    function rotateKey(
        bytes32 oldKeyId,
        string calldata newLabel,
        uint256 newExpiresAt
    ) external onlyKeyManager whenNotPaused returns (bytes32) {
        require(keys[oldKeyId].active, "HSMAdapter: key not active");

        // Generate new key with same algorithm/usage
        HSMKey storage oldKey = keys[oldKeyId];
        bytes32 newKeyId = keccak256(abi.encodePacked("ROTATED_", oldKeyId, block.timestamp));

        HSMKey storage newKey = keys[newKeyId];
        newKey.keyId = keccak256(abi.encodePacked(newLabel, block.timestamp, msg.sender));
        newKey.label = newLabel;
        newKey.algorithm = keys[oldKeyId].algorithm;
        newKey.usage = keys[oldKeyId].usage;
        newKey.source = keys[oldKeyId].source;
        newKey.hsmClusterId = hsmClusterId;
        newKey.exportable = keys[oldKeyId].exportable;
        newKey.active = true;
        newKey.createdAt = block.timestamp;
        newKey.rotatedAt = block.timestamp;
        newKey.expiresAt = newExpiresAt > 0 ? newExpiresAt : block.timestamp + 365 days;

        // Deactivate old key
        keys[oldKeyId].active = false;
        keys[oldKeyId].expiresAt = block.timestamp;

        // In production: HSM would generate new key and optionally destroy old
        // keys[oldKeyId].hsmKeyHandle = "ROTATED_TO_" + newKeyId;

        // Update active key reference if needed
        // (would need a mapping from usage to active key)

        keyIds.push(newKeyId);
        emit KeyRotated(oldKeyId, newKeyId, msg.sender);
        return newKeyId;
    }

    function revokeKey(bytes32 keyId, string calldata reason) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        require(keys[keyId].active, "HSMAdapter: key not active");

        keys[keyId].active = false;
        keys[keyId].expiresAt = block.timestamp;

        emit KeyRevoked(keyId, msg.sender, reason);
    }

    // ─────────────────────────────────────────────────────────────
    // Session Management
    // ─────────────────────────────────────────────────────────────

    function createSession(uint256 duration) external whenNotPaused returns (uint256) {
        require(duration > 0 && duration <= maxSessionDuration, "HSMAdapter: invalid duration");
        require(hsmSessions[msg.sender] == 0 || block.timestamp > hsmSessions[msg.sender] + maxSessionDuration,
            "HSMAdapter: active session exists");

        uint256 sessionId = uint256(keccak256(abi.encodePacked(msg.sender, block.timestamp)));
        hsmSessions[msg.sender] = sessionId;

        // In production: create HSM session
        // uint256 sessionId = hsmClient.createSession(msg.sender, duration);

        emit HMSSessionCreated(msg.sender, sessionId, block.timestamp + duration);
        return sessionId;
    }

    function revokeSession(uint256 sessionId, string calldata reason) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Find and revoke session
        for (uint256 i = 0; i < 1000; i++) { // Simplified - would need mapping
            if (hsmSessions[address(i)] == sessionId) {
                hsmSessions[address(i)] = 0;
                break;
            }
        }
        emit HMSSessionRevoked(address(0), sessionId, reason);
    }

    // ─────────────────────────────────────────────────────────────
    // HSM Health & Monitoring
    // ─────────────────────────────────────────────────────────────

    function healthCheck() external onlyRole(MONITORING_ROLE) returns (bool, uint256, string memory) {
        uint256 start = block.timestamp;
        
        // In production: ping HSM
        // bool healthy = hsmClient.ping();
        
        uint256 latency = block.timestamp - start;
        bool healthy = true; // Placeholder
        
        string memory details = "HSM connection healthy";
        emit HSMHealthCheck(healthy, latency, details);
        
        return (healthy, latency, details);
    }

    function getHSMInfo() external view onlyRole(MONITORING_ROLE) returns (
        string memory endpoint,
        string memory clusterId,
        string memory partition,
        uint256 port,
        uint256 activeKeys,
        uint256 activeSessions
    ) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < keyIds.length; i++) {
            if (keys[keyIds[i]].active) activeCount++;
        }

        return (hsmEndpoint, hsmClusterId, hsmPartition, hsmPort, activeCount, 0);
    }

    // ─────────────────────────────────────────────────────────────
    // Key Derivation (ECDH)
    // ─────────────────────────────────────────────────────────────

    function deriveKey(
        bytes32 privateKeyId,
        bytes32 peerPublicKeyId
    ) external onlySigner whenNotPaused returns (bytes32) {
        require(keys[keyId].active, "HSMAdapter: key not active");
        require(keys[peerKeyId].active, "HSMAdapter: peer key not active");
        require(keys[keyId].algorithm == KeyAlgorithm.SECP256K1 ||
                keys[keyId].algorithm == KeyAlgorithm.SECP256R1,
            "HSMAdapter: algorithm not supported for ECDH");

        // In production: call HSM for ECDH
        // bytes32 sharedSecret = hsmClient.deriveKey(keys[keyId].hsmKeyHandle, 
        //     keys[peerKeyId].hsmKeyHandle);

        bytes32 sharedSecret = keccak256(abi.encodePacked(
            keys[keyId].hsmKeyHandle,
            keys[peerKeyId].hsmKeyHandle,
            block.timestamp
        ));

        return sharedSecret;
    }

    // ─────────────────────────────────────────────────────────────
    // Key Attestation
    // ─────────────────────────────────────────────────────────────

    function getKeyAttestation(bytes32 keyId) external view returns (
        string memory certificate,
        bytes32 keyCheckValue,
        uint256 createdAt,
        uint256 rotatedAt,
        uint256 expiresAt,
        bool active
    ) {
        HSMKey storage key = keys[keyId];
        require(key.label.length > 0, "HSMAdapter: key not found");

        // In production: get attestation from HSM
        string memory cert = "HSM_ATTESTATION_CERTIFICATE_PLACEHOLDER";
        
        return (cert, key.keyCheckValue, key.createdAt, key.rotatedAt, key.expiresAt, key.active);
    }

    // ─────────────────────────────────────────────────────────────
    // Batch Operations
    // ─────────────────────────────────────────────────────────────

    function batchSign(
        bytes32 keyId,
        bytes[] calldata dataArray
    ) external onlySigner whenNotPaused returns (bytes[] memory) {
        require(keys[keyId].active, "HSMAdapter: key not active");

        bytes[] memory signatures = new bytes[](dataArray.length);
        for (uint256 i = 0; i < dataArray.length; i++) {
            // In production: batch sign via HSM
            signatures[i] = abi.encodePacked("BATCH_SIG_", keyId, "_", i, "_", keccak256(dataArray[i]));
        }
        return signatures;
    }

    // ─────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────

    function getKey(bytes32 keyId) external view returns (
        string memory label,
        KeyAlgorithm algorithm,
        KeyUsage usage,
        KeySource source,
        string memory hsmKeyHandle,
        string memory hsmClusterId,
        bool exportable,
        bool active,
        uint256 createdAt,
        uint256 rotatedAt,
        uint256 expiresAt
    ) {
        HSMKey storage key = keys[keyId];
        require(key.label.length > 0, "HSMAdapter: key not found");

        return (key.label, key.algorithm, key.usage, key.source,
                key.hsmKeyHandle, key.hsmClusterId, key.exportable,
                key.active, key.createdAt, key.rotatedAt, key.expiresAt);
    }

    function getKeysByLabel(string calldata label) external view returns (bytes32[] memory) {
        // Would need mapping from label to keyId - simplified
        return new bytes32[](0);
    }

    function getKeysByAlgorithm(KeyAlgorithm algorithm) external view returns (bytes32[] memory) {
        bytes32[] memory result = new bytes32[](keyIds.length);
        uint256 count = 0;
        for (uint256 i = 0; i < keyIds.length; i++) {
            if (keys[keyIds[i]].algorithm == algorithm) {
                result[count] = keyIds[i];
                count++;
            }
        }
        // Resize (simplified)
        return result;
    }

    // ─────────────────────────────────────────────────────────────
    // Cluster Management
    // ─────────────────────────────────────────────────────────────

    function updateHSMCluster(
        string calldata newClusterId,
        string calldata newPartition,
        uint256 newPort
    ) external onlyRole(HSM_ADMIN_ROLE) whenNotPaused {
        emit HSMClusterChanged(hsmClusterId, newClusterId, msg.sender);
        
        hsmClusterId = newClusterId;
        hsmPartition = newPartition;
        hsmPort = newPort;
    }

    // ─────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────

    function getActiveKeyCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < keyIds.length; i++) {
            if (keys[keyIds[i]].active) count++;
        }
        return count;
    }

    function getKeyByLabel(string calldata label) external view returns (bytes32) {
        // Would need label-to-keyId mapping
        return bytes32(0);
    }
}