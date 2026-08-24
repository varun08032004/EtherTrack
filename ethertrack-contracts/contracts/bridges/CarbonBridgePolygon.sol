// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ICarbonBridge.sol";
import "./interfaces/ICCTSRegistry.sol";
import "./interfaces/IMessageRelay.sol";

/**
 * @title CarbonBridgePolygon
 * @dev Polygon side of the carbon credit bridge.
 * Locks VCM credits (ERC-1155) on Polygon, emits events for cross-chain relay
 * to mint corresponding CCTS Offset CCCs on Ethereum.
 */
contract CarbonBridgePolygon is ERC1155, ERC1155Burnable, Ownable, AccessControl, Pausable, ReentrancyGuard, ICrossChainBridge {
    
    // Role definitions
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant BRIDGE_OPERATOR_ROLE = keccak256("BRIDGE_OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    
    // State
    IMessageRelay public immutable messageRelay;
    ICCTSRegistry public cctsRegistry;
    address public immutable carbonCreditToken;
    
    // Configuration
    uint256 public maxLockAmount = 1000000 ether; // Max 1M credits per tx
    uint256 public minLockAmount = 1 ether; // Min 1 credit
    uint256 public dailyLockLimit = 50000 ether; // Daily limit
    uint256 public dailyLockedAmount;
    uint256 public lastDailyReset;
    
    // Events
    event CreditsLocked(
        uint256 indexed lockId,
        address indexed user,
        uint256 indexed batchId,
        uint256 amount,
        uint256 timestamp,
        string destinationChain,
        string destinationAddress
    );
    
    event CreditsUnlocked(
        uint256 indexed unlockId,
        address indexed user,
        uint256 indexed batchId,
        uint256 amount,
        uint256 timestamp
    );
    
    event DailyLimitUpdated(uint256 oldLimit, uint256 newLimit);
    event EmergencyPauseTriggered(address by);
    event EmergencyUnpauseTriggered(address by);
    event ConfigUpdated(string param, string oldValue, string newValue);
    
    // Mappings
    mapping(uint256 => LockInfo) public locks;
    mapping(address => uint256) public userDailyLocked;
    uint256 public lockCounter;
    
    struct LockInfo {
        uint256 lockId;
        address user;
        uint256 batchId;
        uint256 amount;
        uint256 timestamp;
        string destinationChain;
        string destinationAddress;
        bool relayed;
        bool claimed;
    }
    
    // Mappings
    mapping(uint256 => LockInfo) public locks;
    mapping(address => uint256) public userDailyLocked;
    uint256 public lockCounter;
    
    struct LockInfo {
        uint256 lockId;
        address user;
        uint256 batchId;
        uint256 amount;
        uint256 timestamp;
        string destinationChain;
        string destinationAddress;
        bool relayed;
        bool claimed;
    }
    
    // Mappings
    mapping(uint256 => LockInfo) public locks;
    mapping(address => uint256) public userDailyLocked;
    uint256 public lockCounter;
    
    constructor(
        address _carbonCreditToken,
        address _messageRelay,
        address _cctsRegistry,
        address _initialOwner
    ) ERC1155("") Ownable(_initialOwner) {
        carbonCreditToken = _carbonCreditToken;
        messageRelay = IMessageRelay(_messageRelay);
        cctsRegistry = ICCTSRegistry(_cctsRegistry);
        
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(RELAYER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(BRIDGE_OPERATOR_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE);
        
        grantRole(DEFAULT_ADMIN_ROLE, _initialOwner);
        grantRole(RELAYER_ROLE, _messageRelay);
        grantRole(BRIDGE_OPERATOR_ROLE, _initialOwner);
        grantRole(EMERGENCY_GUARDIAN_ROLE, _initialOwner);
        
        lastDailyReset = block.timestamp;
    }
    
    /**
     * @dev Lock VCM credits on Polygon for cross-chain transfer to Ethereum
     * @param batchId The carbon batch ID (ERC-1155 tokenId)
     * @param amount Number of credits to lock
     * @param destinationAddress Ethereum address to receive CCTS Offset CCCs
     * @return lockId Unique identifier for this lock operation
     */
    function lockCredits(
        uint256 batchId,
        uint256 amount,
        string calldata destinationAddress
    ) external whenNotPaused nonReentrant returns (uint256) {
        _checkDailyLimit(amount);
        _checkAmount(amount);
        _checkBatchExists(batchId);
        _checkUserBalance(msg.sender, batchId, amount);
        _checkAllowance(msg.sender, batchId, amount);
        
        // Transfer credits from user to bridge (escrow)
        _safeTransferFrom(msg.sender, address(this), batchId, amount, "");
        
        // Create lock record
        lockCounter++;
        uint256 lockId = lockCounter;
        
        locks[lockId] = LockInfo({
            lockId: lockId,
            user: msg.sender,
            batchId: batchId,
            amount: amount,
            timestamp: block.timestamp,
            destinationChain: "Ethereum",
            destinationAddress: destinationAddress,
            relayed: false,
            claimed: false
        });
        
        // Update daily limit tracking
        _updateDailyLimit(amount);
        
        // Emit event for relayer to pick up
        emit CreditsLocked(
            lockId,
            msg.sender,
            batchId,
            amount,
            block.timestamp,
            "Ethereum",
            destinationAddress
        );
        
        // Send cross-chain message via relayer
        bytes memory message = abi.encode(lockId, msg.sender, batchId, amount, destinationAddress);
        messageRelay.sendMessage("Ethereum", message);
        
        return lockId;
    }
    
    /**
     * @dev Unlock credits on Polygon (when transfer fails or is cancelled)
     * Only callable by relayer after failed Ethereum transaction
     */
    function unlockCredits(
        uint256 lockId,
        string calldata reason
    ) external onlyRole(RELAYER_ROLE) whenNotPaused {
        LockInfo storage lock = locks[lockId];
        require(!lock.claimed, "Already claimed");
        require(!lock.relayed, "Already relayed");
        require(lock.user == msg.sender || hasRole(RELAYER_ROLE, msg.sender), "Unauthorized");
        
        // Return credits to user
        _safeTransferFrom(address(this), lock.user, lock.batchId, lock.amount, "");
        
        lock.relayed = true; // Mark as processed (failed)
        lock.claimed = true;
        
        emit CreditsUnlocked(
            lockId,
            lock.user,
            lock.batchId,
            lock.amount,
            block.timestamp
        );
    }
    
    /**
     * @dev Claim credits on Ethereum side (called by relayer after successful mint)
     * This is called after Ethereum side confirms mint
     */
    function claimLock(
        uint256 lockId,
        bytes32 ethTxHash
    ) external onlyRole(RELAYER_ROLE) whenNotPaused {
        LockInfo storage lock = locks[lockId];
        require(!lock.claimed, "Already claimed");
        require(!lock.relayed, "Already relayed");
        
        lock.relayed = true;
        lock.claimed = true;
        
        emit CreditsUnlocked(
            lockId,
            lock.user,
            lock.batchId,
            lock.amount,
            block.timestamp
        );
    }
    
    /**
     * @dev Force unlock by emergency guardian (emergency only)
     */
    function forceUnlock(
        uint256 lockId,
        string calldata reason
    ) external onlyRole(EMERGENCY_GUARDIAN_ROLE) whenNotPaused {
        LockInfo storage lock = locks[lockId];
        require(!lock.claimed, "Already claimed");
        
        _safeTransferFrom(address(this), lock.user, lock.batchId, lock.amount, "");
        
        lock.relayed = true;
        lock.claimed = true;
        
        emit CreditsUnlocked(lockId, lock.user, lock.batchId, lock.amount, block.timestamp);
    }
    
    /**
     * @dev Update daily lock limit (admin only)
     */
    function setDailyLockLimit(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 oldLimit = dailyLockLimit;
        dailyLockLimit = newLimit;
        emit DailyLimitUpdated(oldLimit, newLimit);
        emit ConfigUpdated("dailyLockLimit", oldLimit.toString(), newLimit.toString());
    }
    
    /**
     * @dev Set max lock amount per transaction
     */
    function setMaxLockAmount(uint256 newMax) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMax >= minLockAmount, "Max must be >= min");
        uint256 oldMax = maxLockAmount;
        maxLockAmount = newMax;
        emit ConfigUpdated("maxLockAmount", oldMax.toString(), newMax.toString());
    }
    
    function setMinLockAmount(uint256 newMin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMin <= maxLockAmount, "Min must be <= max");
        uint256 oldMin = minLockAmount;
        minLockAmount = newMin;
        emit ConfigUpdated("minLockAmount", oldMin.toString(), newMin.toString());
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
    function getLockInfo(uint256 lockId) external view returns (LockInfo memory) {
        return locks[lockId];
    }
    
    function getUserDailyLocked(address user) external view returns (uint256) {
        if (block.timestamp > lastDailyReset + 1 days) {
            return 0;
        }
        return userDailyLocked[user];
    }
    
    function getDailyLockLimit() external view returns (uint256) {
        return dailyLockLimit;
    }
    
    function getDailyLockedAmount() external view returns (uint256) {
        if (block.timestamp > lastDailyReset + 1 days) {
            return 0;
        }
        return dailyLockedAmount;
    }
    
    function getLockCounter() external view returns (uint256) {
        return lockCounter;
    }
    
    // Internal helpers
    function _checkDailyLimit(uint256 amount) internal {
        if (block.timestamp > lastDailyReset + 1 days) {
            dailyLockedAmount = 0;
            lastDailyReset = block.timestamp;
        }
        require(dailyLockedAmount + amount <= dailyLockLimit, "Daily lock limit exceeded");
    }
    
    function _updateDailyLimit(uint256 amount) internal {
        if (block.timestamp > lastDailyReset + 1 days) {
            dailyLockedAmount = 0;
            lastDailyReset = block.timestamp;
        }
        dailyLockedAmount += amount;
        userDailyLocked[msg.sender] += amount;
    }
    
    function _checkAmount(uint256 amount) internal view {
        require(amount >= minLockAmount, "Amount below minimum");
        require(amount <= maxLockAmount, "Amount exceeds maximum");
    }
    
    function _checkBatchExists(uint256 batchId) internal view {
        require(carbonCreditToken.exists(batchId), "Batch does not exist");
    }
    
    function _checkUserBalance(address user, uint256 batchId, uint256 amount) internal view {
        uint256 balance = IERC1155(carbonCreditToken).balanceOf(msg.sender, batchId);
        require(balance >= amount, "Insufficient balance");
    }
    
    function _checkAllowance(address user, uint256 batchId, uint256 amount) internal {
        uint256 allowance = IERC1155(carbonCreditToken).allowance(user, address(this));
        require(allowance >= amount, "Insufficient allowance");
    }
    
    function _checkUserBalance(address user, uint256 batchId, uint256 amount) internal view {
        uint256 balance = IERC1155(carbonCreditToken).balanceOf(user, batchId);
        require(balance >= amount, "Insufficient balance");
    }
    
    function _safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) internal {
        IERC1155(carbonCreditToken).safeTransferFrom(from, to, id, amount, data);
    }
    
    function _safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) internal {
        IERC1155(carbonCreditToken).safeTransferFrom(from, to, id, amount, data);
    }
}

// Events
event CreditsLocked(
    uint256 indexed lockId,
    address indexed user,
    uint256 indexed batchId,
    uint256 amount,
    uint256 timestamp,
    string destinationChain,
    string destinationAddress
);

event CreditsUnlocked(
    uint256 indexed unlockId,
    address indexed user,
    uint256 indexed batchId,
    uint256 amount,
    uint256 timestamp
);

event DailyLimitUpdated(uint256 oldLimit, uint256 newLimit);
event EmergencyPauseTriggered(address by);
event EmergencyUnpauseTriggered(address by);
event ConfigUpdated(string param, string oldValue, string newValue);

// Interfaces
interface ICrossChainBridge {
    function lockCredits(uint256 batchId, uint256 amount, string calldata destinationAddress) external returns (uint256);
    function unlockCredits(uint256 lockId, string calldata reason) external;
    function claimLock(uint256 lockId, bytes32 ethTxHash) external;
    function forceUnlock(uint256 lockId, string calldata reason) external;
    function pause() external;
    function unpause() external;
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

interface ICCTSRegistry {
    function registerOffsetCCC(uint256 batchId, uint256 amount, address recipient) external returns (uint256);
    function isComplianceEligible(uint256 batchId) external view returns (bool);
    function surrenderCCC(uint256 amount, string calldata reason) external;
}

interface IMessageRelay {
    function sendMessage(string calldata destinationChain, bytes calldata message) external;
    function relayMessage(string calldata sourceChain, bytes calldata message) external;
}

interface ICreditToken {
    function exists(uint256 id) external view returns (bool);
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function allowance(address account, address operator) external view returns (uint256);
}