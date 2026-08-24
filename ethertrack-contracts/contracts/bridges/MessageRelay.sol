// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title MessageRelay
 * @dev Cross-chain message relay for Polygon <-> Ethereum communication.
 * Uses Axelar/Wormhole/CCIP as underlying transport (pluggable).
 */
contract MessageRelay is AccessControl, Ownable, Pausable {
    
    // Role definitions
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant GATEWAY_ROLE = keccak256("GATEWAY_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    
    // Supported chains
    mapping(string => uint256) public chainIds;
    mapping(string => address) public gatewayAddresses;
    
    // Message tracking
    mapping(bytes32 => MessageInfo) public messages;
    mapping(bytes32 => uint256) public messageStatus; // 0=pending, 1=relayed, 2=failed
    uint256 public messageCounter;
    
    // Events
    event MessageSent(
        bytes32 indexed messageId,
        string indexed destinationChain,
        address indexed sender,
        uint256 timestamp
    );
    
    event MessageRelayed(
        bytes32 indexed messageId,
        string indexed sourceChain,
        address indexed recipient,
        uint256 timestamp
    );
    
    event MessageFailed(
        bytes32 indexed messageId,
        string reason,
        uint256 timestamp
    );
    
    event GatewayRegistered(string chain, address gateway);
    event GatewayUpdated(string chain, address oldGateway, address newGateway);
    
    // Message status
    uint8 public constant STATUS_PENDING = 0;
    uint8 public constant STATUS_RELAYED = 1;
    uint8 public constant STATUS_FAILED = 2;
    
    struct MessageInfo {
        bytes32 messageId;
        string destinationChain;
        address sender;
        bytes payload;
        uint256 timestamp;
        uint8 status;
    }
    
    mapping(bytes32 => MessageInfo) public messages;
    mapping(bytes32 => uint8) public messageStatus;
    uint256 public messageCounter;
    
    // Role definitions
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant GATEWAY_ROLE = keccak256("GATEWAY_ROLE");
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    
    // Constructor
    constructor(address _initialOwner) Ownable(_initialOwner) {
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(RELAYER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(GATEWAY_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_GUARDIAN_ROLE, DEFAULT_ADMIN_ROLE);
        
        grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        grantRole(RELAYER_ROLE, msg.sender);
        grantRole(GATEWAY_ROLE, msg.sender);
        grantRole(EMERGENCY_GUARDIAN_ROLE, msg.sender);
    }
    
    // Supported chains configuration
    function setChainConfig(string calldata chainName, uint256 chainId, address gateway) external onlyRole(DEFAULT_ADMIN_ROLE) {
        chainIds[chainName] = chainId;
        gatewayAddresses[chainName] = gateway;
        emit GatewayRegistered(chainName, gateway);
    }
    
    function updateGateway(string calldata chainName, address newGateway) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address oldGateway = gatewayAddresses[chainName];
        gatewayAddresses[chainName] = newGateway;
        emit GatewayUpdated(chainName, oldGateway, newGateway);
    }
    
    function getChainId(string calldata chainName) external view returns (uint256) {
        return chainIds[chainName];
    }
    
    function getGatewayAddress(string calldata chainName) external view returns (address) {
        return gatewayAddresses[chainName];
    }
    
    // Core message sending
    function sendMessage(
        string calldata destinationChain,
        bytes calldata message
    ) external onlyRole(RELAYER_ROLE) whenNotPaused returns (bytes32) {
        require(gatewayAddresses[destinationChain] != address(0), "Chain not configured");
        
        messageCounter++;
        bytes32 messageId = keccak256(abi.encodePacked(msg.sender, messageCounter, block.timestamp));
        
        messages[messageId] = MessageInfo({
            messageId: messageId,
            destinationChain: destinationChain,
            sender: msg.sender,
            payload: message,
            timestamp: block.timestamp,
            status: 0 // PENDING
        });
        
        messageStatus[messageId] = 0; // PENDING
        messageCounter++;
        
        // In production, would call actual gateway contract
        // For now, emit event for relayer to pick up
        emit MessageSent(messageId, destinationChain, msg.sender, block.timestamp);
        
        // Auto-relay if gateway is available (simulated)
        _relayMessageInternal(messageId, destinationChain);
        
        return messageId;
    }
    
    function _relayMessageInternal(bytes32 messageId, string calldata destinationChain) internal {
        address gateway = gatewayAddresses[destinationChain];
        require(gateway != address(0), "No gateway for chain");
        
        // In production: call actual gateway contract
        // IGateway(gateway).sendMessage(destinationChain, messages[messageId].payload);
        
        // Simulate relay for now
        messageStatus[messageId] = 1; // RELAYED
        messages[messageId].status = 1;
        
        emit MessageRelayed(messageId, "", address(0), block.timestamp);
    }
    
    // Receive message from another chain
    function relayMessage(
        string calldata sourceChain,
        bytes calldata message
    ) external onlyRole(GATEWAY_ROLE) whenNotPaused {
        messageCounter++;
        bytes32 messageId = keccak256(abi.encodePacked(sourceChain, messageCounter, block.timestamp));
        
        messages[messageId] = MessageInfo({
            messageId: messageId,
            destinationChain: "Ethereum", // This contract is on Ethereum
            sender: address(0), // Unknown from other chain
            payload: message,
            timestamp: block.timestamp,
            status: 1 // RELAYED
        });
        
        messageStatus[messageId] = 1; // RELAYED
        
        emit MessageRelayed(messageId, sourceChain, address(0), block.timestamp);
    }
    
    // Check message status
    function getMessageStatus(bytes32 messageId) external view returns (uint8) {
        return messageStatus[messageId];
    }
    
    function getMessageInfo(bytes32 messageId) external view returns (MessageInfo memory) {
        return messages[messageId];
    }
    
    // Retry failed message
    function retryMessage(bytes32 messageId) external onlyRole(RELAYER_ROLE) {
        require(messageStatus[messageId] == 2, "Message not in failed state");
        messageStatus[messageId] = 0; // PENDING
        
        // Retry relay
        _relayMessageInternal(messageId, messages[messageId].destinationChain);
    }
    
    // Emergency pause
    function pause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _pause();
    }
    
    function unpause() external onlyRole(EMERGENCY_GUARDIAN_ROLE) {
        _unpause();
    }
    
    // Getters
    function getChainId(string calldata chainName) external view returns (uint256) {
        return chainIds[chainName];
    }
    
    function getGatewayAddress(string calldata chainName) external view returns (address) {
        return gatewayAddresses[chainName];
    }
    
    function getMessageCount() external view returns (uint256) {
        return messageCounter;
    }
    
    // State
    mapping(string => uint256) public chainIds;
    mapping(string => address) public gatewayAddresses;
    mapping(bytes32 => MessageInfo) public messages;
    mapping(bytes32 => uint8) public messageStatus;
    uint256 public messageCounter;
    
    struct MessageInfo {
        bytes32 messageId;
        string destinationChain;
        address sender;
        bytes payload;
        uint256 timestamp;
        uint8 status;
    }
    
    // Events
    event MessageSent(
        bytes32 indexed messageId,
        string indexed destinationChain,
        address indexed sender,
        uint256 timestamp
    );
    
    event MessageRelayed(
        bytes32 indexed messageId,
        string indexed sourceChain,
        address indexed recipient,
        uint256 timestamp
    );
    
    event MessageFailed(
        bytes32 indexed messageId,
        string reason,
        uint256 timestamp
    );
    
    event GatewayRegistered(string chain, address gateway);
    event GatewayUpdated(string chain, address oldGateway, address newGateway);
}

interface IMessageRelay {
    function sendMessage(string calldata destinationChain, bytes calldata message) external returns (bytes32);
    function relayMessage(string calldata sourceChain, bytes calldata message) external;
    function getMessageStatus(bytes32 messageId) external view returns (uint8);
    function getMessageInfo(bytes32 messageId) external view returns (MessageInfo memory);
    function getChainId(string calldata chainName) external view returns (uint256);
    function getGatewayAddress(string calldata chainName) external view returns (address);
}