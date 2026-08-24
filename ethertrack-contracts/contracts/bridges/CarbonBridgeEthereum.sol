// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ICCTSRegistry.sol";
import "./interfaces/ICCTSOffsetToken.sol";
import "./interfaces/IMessageRelay.sol";

/**
 * @title CarbonBridgeEthereum
 * @dev Ethereum side of the carbon credit bridge.
 * Receives cross-chain messages from Polygon, mints CCTS Offset CCCs (ERC-20).
 * Interfaces with CCTS Registry for compliance tracking.
 */
contract CarbonBridgeEthereum is ERC20, ERC20Burnable, Ownable, AccessControl, Pausable, ReentrancyGuard {
    
    // Role definitions
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant BRIDGE_OPERATOR_ROLE = keccak256("BRIDGE_OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    
    // State
    IMessageRelay public immutable messageRelay;
    ICCTSRegistry public cctsRegistry;
    ICCTSOffsetToken public cctsOffsetToken;
    
    // State
    mapping(bytes32 => LockInfo) public processedLocks;
    mapping(address => uint256) public userDailyMinted;
    uint256 public dailyMintLimit = 100000 ether;
    uint256 public dailyMintedAmount;
    uint256 public lastDailyReset;
    uint256 public maxMintPerTx = 100000 ether;
    
    // Events
    event CCMinted(
        uint256 indexed mintId,
        address indexed recipient,
        uint256 amount,
        uint256 batchId,
        string sourceChain,
        uint256 timestamp,
        bytes32 sourceTxHash
    );
    
    event CCBurned(
        uint256 indexed burnId,
        address indexed burner,
        uint256 amount,
        uint256 batchId,
        string destinationChain,
        uint256 timestamp
    );
    
    event DailyMintLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event EmergencyPauseTriggered(address by);
    event EmergencyUnpauseTriggered(address by);
    event ConfigUpdated(string param, string oldValue, string newValue);
    
    // Mappings
    mapping(bytes32 => LockInfo) public processedLocks;
    mapping(address => uint256) public userDailyMinted;
    uint256 public mintCounter;
    
    struct LockInfo {
        uint256 lockId;
        address recipient;
        uint256 amount;
        uint256 batchId;
        string sourceChain;
        bytes32 sourceTxHash;
        uint256 timestamp;
        bool processed;
    }
    
    // Mappings
    mapping(bytes32 => LockInfo) public processedLocks;
    mapping(address => uint256) public userDailyMinted;
    uint256 public mintCounter;
    
    struct LockInfo {
        uint256 lockId;
        address recipient;
        uint256 amount;
        uint256 batchId;
        string sourceChain;
        bytes32 sourceTxHash;
        uint256 timestamp;
        bool processed;
    }
    
    mapping(bytes32 => LockInfo) public processedLocks;
    mapping(address => uint256) public userDailyMinted;
    uint256 public mintCounter;
    
    // State
    IMessageRelay public immutable messageRelay;
    ICCTSRegistry public cctsRegistry;
    ICCTSOffsetToken public cctsOffsetToken;
    
    // Configuration
    uint256 public maxMintPerTx = 100000 ether;
    uint256 public minMintAmount = 1 ether;
    uint256 public dailyMintLimit = 100000 ether;
    uint256 public dailyMintedAmount;
    uint256 public lastDailyReset;
    uint256 public maxMintPerTx = 100000 ether;
    uint256 public minMintAmount = 1 ether;
    
    // Role definitions
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant BRIDGE_OPERATOR_ROLE = keccak256("BRIDGE_OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    
    // Events
    event CCMinted(
        uint256 indexed mintId,
        address indexed recipient,
        uint256 amount,
        uint256 batchId,
        string sourceChain,
        uint256 timestamp,
        bytes32 sourceTxHash
    );
    
    event CCBurned(
        uint256 indexed burnId,
        address indexed burner,
        uint256 amount,
        uint256 batchId,
        string destinationChain,
        uint256 timestamp
    );
    
    event DailyMintLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event EmergencyPauseTriggered(address by);
    event EmergencyUnpauseTriggered(address by);
    event ConfigUpdated(string param, string oldValue, string newValue);
    
    // Mappings
    mapping(bytes32 => LockInfo) public processedLocks;
    mapping(address => uint256) public userDailyMinted;
    uint256 public mintCounter;
    
    struct LockInfo {
        uint256 lockId;
        address recipient;
        uint256 amount;
        uint256 batchId;
        string sourceChain;
        bytes32 sourceTxHash;
        uint256 timestamp;
        bool processed;
    }
    
    // State
    IMessageRelay public immutable messageRelay;
    ICCTSRegistry public cctsRegistry;
    ICCTSOffsetToken public cctsOffsetToken;
    
    // Role definitions
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant BRIDGE_OPERATOR_ROLE = keccak256("BRIDGE_OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    
    // Modifiers
    modifier onlyRelayer() {
        require(hasRole(RELAYER_ROLE, msg.sender) || hasRole(BRIDGE_OPERATOR_ROLE, msg.sender), "Only relayer");
        _;
    }
    
    modifier onlyMinter() {
        require(hasRole(MINTER_ROLE, msg.sender) || hasRole(RELAYER_ROLE, msg.sender), "Only minter");
        _;
    }
    
    // Constructor
    constructor(
        address _cctsOffsetToken,
        address _messageRelay,
        address _cctsRegistry,
        address _initialOwner
    ) ERC20("CCTS Offset CCC", "ctCCC") ERC20Burnable("CCTS Offset CCC") Ownable(_initialOwner) {
        cctsOffsetToken = ICCTSOffsetToken(_cctsOffsetToken);
        messageRelay = IMessageRelay(_messageRelay);
        cctsRegistry = ICCTSRegistry(_cctsRegistry);
        
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(RELAYER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(BRIDGE_OPERATOR_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(MINTER_ROLE, DEFAULT_ADMIN_ROLE);
        
        grantRole(DEFAULT_ADMIN_ROLE, _initialOwner);
        grantRole(RELAYER_ROLE, _initialOwner);
        grantRole(BRIDGE_OPERATOR_ROLE, _initialOwner);
        grantRole(EMERGENCY_GUARDIAN_ROLE, _initialOwner);
        grantRole(MINTER_ROLE, _initialOwner);
        
        lastDailyReset = block.timestamp;
    }
    
    /**
     * @dev Process cross-chain lock message from Polygon
     * Called by relayer after receiving message from Polygon
     */
    function relayLockMessage(
        bytes32 lockId,
        address recipient,
        uint256 amount,
        uint256 batchId,
        string calldata sourceChain,
        bytes32 sourceTxHash
    ) external onlyRelayer whenNotPaused nonReentrant returns (uint256) {
        require(!processedLocks[lockId], "Lock already processed");
        
        // Check daily mint limit
        _checkDailyMintLimit(amount);
        
        // Verify lock not already processed
        require(!processedLocks[lockId].processed, "Lock already processed");
        
        // Check daily mint limit
        _checkDailyMintLimit(amount);
        
        // Mint CCTS Offset CCCs to recipient
        _mint(recipient, amount);
        
        // Record processed lock
        mintCounter++;
        uint256 mintId = mintCounter;
        
        processedLocks[lockId] = LockInfo({
            lockId: lockId,
            recipient: recipient,
            amount: amount,
            batchId: batchId,
            sourceChain: sourceChain,
            sourceTxHash: sourceTxHash,
            timestamp: block.timestamp,
            processed: true
        });
        
        // Update daily mint tracking
        _updateDailyMinted(amount);
        userDailyMinted[recipient] += amount;
        
        emit CCMinted(
            mintId,
            recipient,
            amount,
            batchId,
            "Polygon",
            block.timestamp,
            sourceTxHash
        );
        
        // Register with CCTS Registry if compliance eligible
        if (cctsRegistry.isComplianceEligible(batchId)) {
            cctsRegistry.registerOffsetCCC(batchId, amount, recipient);
        }
        
        return mintId;
    }
    
    /**
     * @dev Burn CCTS Offset CCCs and unlock on Polygon
     */
    function burnAndUnlock(
        uint256 batchId,
        uint256 amount,
        string calldata destinationChain,
        string calldata destinationAddress
    ) external whenNotPaused nonReentrant onlyRole(MINTER_ROLE) returns (uint256) {
        require(amount >= minMintAmount, "Amount below minimum");
        require(amount <= maxMintPerTx, "Amount exceeds maximum");
        
        // Check user balance
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        
        // Burn CCTS Offset CCCs
        _burn(msg.sender, amount);
        
        // Record burn
        uint256 burnId = ++mintCounter;
        
        // Send unlock message to Polygon
        bytes32 burnIdHash = keccak256(abi.encodePacked(burnId));
        bytes memory message = abi.encode(
            batchId, amount, destinationChain, destinationAddress
        );
        
        messageRelay.sendMessage(destinationChain, message);
        
        emit CCBurned(
            burnId,
            msg.sender,
            amount,
            batchId,
            destinationChain,
            block.timestamp
        );
        
        return burnId;
    }
    
    /**
     * @dev Claim CCTS Offset CCCs on behalf of recipient (relayer call)
     */
    function claimCCC(
        address recipient,
        uint256 amount,
        uint256 batchId,
        string calldata sourceChain,
        bytes32 sourceTxHash
    ) external onlyRole(RELAYER_ROLE) whenNotPaused nonReentrant {
        _checkDailyMintLimit(amount);
        
        bytes32 lockId = keccak256(abi.encodePacked(negotiationId));
        
        require(!processedLocks[lockId], "Lock already processed");
        
        // Mint tokens to recipient
        _mint(recipient, amount);
        
        // Record processed lock
        mintCounter++;
        uint256 mintId = mintCounter;
        
        processedLocks[keccak256(abi.encodePacked(negotiationId))] = LockInfo({
            lockId: keccak256(abi.encodePacked(negotiationId)),
            recipient: recipient,
            amount: amount,
            batchId: batchId,
            sourceChain: sourceChain,
            sourceTxHash: sourceTxHash,
            timestamp: block.timestamp,
            processed: true
        });
        
        // Update daily mint tracking
        _updateDailyMinted(amount);
        userDailyMinted[recipient] += amount;
        
        emit CCMinted(
            mintId,
            recipient,
            amount,
            batchId,
            sourceChain,
            block.timestamp,
            sourceTxHash
        );
        
        // Register with CCTS Registry if compliance eligible
        if (cctsRegistry.isComplianceEligible(batchId)) {
            cctsRegistry.registerOffsetCCC(batchId, amount, recipient);
        }
        
        return mintId;
    }
    
    /**
     * @dev Burn CCTS Offset CCCs to unlock on Polygon
     */
    function burnCCC(
        uint256 batchId,
        uint256 amount,
        string calldata destinationChain,
        string calldata destinationAddress
    ) external whenNotPaused nonReentrant onlyRole(MINTER_ROLE) returns (uint256) {
        require(amount >= minMintAmount, "Amount below minimum");
        require(amount <= maxMintPerTx, "Amount exceeds maximum");
        
        // Check user balance
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        
        // Burn CCTS Offset CCCs
        _burn(msg.sender, amount);
        
        // Record burn
        uint256 burnId = ++mintCounter;
        
        // Send unlock message to Polygon
        bytes32 burnIdHash = keccak256(abi.encodePacked(burnId));
        bytes memory message = abi.encode(
            batchId, amount, destinationChain, destinationAddress
        );
        
        messageRelay.sendMessage(destinationChain, message);
        
        emit CCBurned(
            burnId,
            msg.sender,
            amount,
            batchId,
            destinationChain,
            block.timestamp
        );
        
        return burnId;
    }
    
    /**
     * @dev Register CCTS Offset CCC batch with registry
     */
    function registerOffsetCCC(
        uint256 batchId,
        uint256 amount,
        address recipient
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        return cctsRegistry.registerOffsetCCC(batchId, amount, recipient);
    }
    
    /**
     * @dev Surrender CCTS Compliance CCCs for compliance
     */
    function surrenderCCC(
        uint256 amount,
        string calldata reason
    ) external whenNotPaused {
        require(amount > 0, "Amount must be positive");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        
        _burn(msg.sender, amount);
        
        uint256 burnId = ++mintCounter;
        
        emit CCBurned(
            burnId,
            msg.sender,
            amount,
            0, // batchId not applicable for compliance surrender
            block.timestamp
        );
        
        // Register surrender with CCTS Registry
        cctsRegistry.surrenderCCC(amount, reason);
        
        emit CCBurned(
            burnId,
            msg.sender,
            amount,
            0,
            block.timestamp
        );
    }
    
    // Configuration
    function setDailyMintLimit(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldLimit = dailyMintLimit;
        dailyMintLimit = newLimit;
        emit DailyMintLimitUpdated(oldLimit, newLimit);
        emit ConfigUpdated("dailyMintLimit", oldLimit.toString(), newLimit.toString());
    }
    
    function setMaxMintPerTx(uint256 newMax) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMax >= minMintAmount, "Max must be >= min");
        uint256 oldMax = maxMintPerTx;
        maxMintPerTx = newMax;
        emit ConfigUpdated("maxMintPerTx", oldMax.toString(), newMax.toString());
    }
    
    function setMinMintAmount(uint256 newMin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMin <= maxMintPerTx, "Min must be <= max");
        uint256 oldMin = minMintAmount;
        minMintAmount = newMin;
        emit ConfigUpdated("minMintAmount", oldMin.toString(), newMin.toString());
    }
    
    // Emergency controls
    function pause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _pause();
        emit EmergencyPauseTriggered(msg.sender);
    }
    
    function unpause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _unpause();
        emit EmergencyUnpauseTriggered(msg.sender);
    }
    
    // View functions
    function getDailyMintLimit() external view returns (uint256) {
        return dailyMintLimit;
    }
    
    function getDailyMintedAmount() external view returns (uint256) {
        if (block.timestamp > lastDailyReset + 1 days) {
            return 0;
        }
        return dailyMintedAmount;
    }
    
    function getUserDailyMinted(address user) external view returns (uint256) {
        if (block.timestamp > lastDailyReset + 1 days) {
            return 0;
        }
        return userDailyMinted[user];
    }
    
    function getMintCounter() external view returns (uint256) {
        return mintCounter;
    }
    
    function getLockInfo(bytes32 lockId) external view returns (LockInfo memory) {
        return processedLocks[lockId];
    }
    
    // Internal helpers
    function _checkDailyMintLimit(uint256 amount) internal {
        if (block.timestamp > lastDailyReset + 1 days) {
            dailyMintedAmount = 0;
            lastDailyReset = block.timestamp;
        }
        require(dailyMintedAmount + amount <= dailyMintLimit, "Daily mint limit exceeded");
    }
    
    function _updateDailyMinted(uint256 amount) internal {
        if (block.timestamp > lastDailyReset + 1 days) {
            dailyMintedAmount = 0;
            lastDailyReset = block.timestamp;
        }
        dailyMintedAmount += amount;
        userDailyMinted[msg.sender] += amount;
    }
    
    function _checkAmount(uint256 amount) internal view {
        require(amount >= minMintAmount, "Amount below minimum");
        require(amount <= maxMintPerTx, "Amount exceeds maximum");
    }
    
    function _checkBatchExists(uint256 batchId) internal view {
        require(cctsOffsetToken.exists(batchId), "Batch does not exist");
    }
    
    function _checkRecipientBalance(address user, uint256 batchId, uint256 amount) internal view {
        uint256 balance = cctsOffsetToken.balanceOf(user, batchId);
        require(balance >= amount, "Insufficient balance");
    }
    
    function _checkAllowance(address user, uint256 batchId, uint256 amount) internal {
        uint256 allowance = cctsOffsetToken.allowance(user, address(this));
        require(allowance >= amount, "Insufficient allowance");
    }
}

interface ICCTSOffsetToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function exists(uint256 id) external view returns (bool);
    function isComplianceEligible(uint256 batchId) external view returns (bool);
}

interface IMessageRelay {
    function sendMessage(string calldata destinationChain, bytes calldata message) external;
    function relayMessage(string calldata sourceChain, bytes calldata message) external;
}

interface ICCTSRegistry {
    function registerOffsetCCC(uint256 batchId, uint256 amount, address recipient) external returns (uint256);
    function isComplianceEligible(uint256 batchId) external view returns (bool);
    function surrenderCCC(uint256 amount, string calldata reason) external;
}

interface IMessageRelay {
    function sendMessage(string calldata destinationChain, bytes calldata message) external;
    function relayMessage(string calldata sourceChain, bytes calldata message) external;
}