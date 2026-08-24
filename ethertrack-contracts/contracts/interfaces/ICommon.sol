// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Interfaces for Carbon Bridge Contracts
 * @dev Shared interfaces used across bridge contracts
 */

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
    function getMessageStatus(bytes32 messageId) external view returns (uint8);
    function getMessageInfo(bytes32 messageId) external view returns (MessageInfo memory);
    function getChainId(string calldata chainName) external view returns (uint256);
    function getGatewayAddress(string calldata chainName) external view returns (address);
}

interface ICCTSRegistry {
    function registerOffsetCCC(uint256 batchId, uint256 amount, address recipient) external returns (uint256);
    function isComplianceEligible(uint256 batchId) external view returns (bool);
    function surrenderCCC(uint256 amount, string calldata reason) external;
}

interface ICCTSOffsetToken {
    function mint(uint256 batchId, address to, uint256 amount) external;
    function burn(uint256 batchId, uint256 amount, string calldata reason) external.
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external.
    function safeBatchTransferFrom(address from, address to, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata data) external.
    function balanceOf(address account, uint256 id) view returns (uint256).
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) view returns (uint256[] memory).
    function totalSupply(uint256 id) view returns (uint256).
    function exists(uint256 id) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getBatchInfo(uint256 batchId) view returns (tuple(string name, string standard, uint256 vintage, uint256 totalSupply, uint256 availableSupply, uint256 retiredSupply, string registry, string methodology, string projectType, string geography, bool complianceEligible, bool active)).
    function getBatchBalance(address account, uint256 batchId) view returns (uint256).
    function getBatchTotalSupply(uint256 batchId) view returns (uint256).
    function getBatchAvailableSupply(uint256 batchId) view returns (uint256).
    function getBatchRetiredSupply(uint256 batchId) view returns (uint256).
    function isBatchActive(uint256 batchId) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getTotalSupply() view returns (uint256).
    function getTotalBatches() view returns (uint256).
    function getAllActiveBatches() view returns (uint256[] memory).
}

interface IMessageRelay {
    function sendMessage(string calldata destinationChain, bytes calldata message) external.
    function relayMessage(string calldata sourceChain, bytes calldata message) external.
    function getMessageStatus(bytes32 messageId) external view returns (uint8).
    function getMessageInfo(bytes32 messageId) external view returns (MessageInfo memory).
    function getChainId(string calldata chainName) external view returns (uint256).
    function getGatewayAddress(string calldata chainName) external view returns (address).
}

interface ICCTSRegistry {
    function registerOffsetCCC(uint256 batchId, uint256 amount, address recipient) external returns (uint256).
    function isComplianceEligible(uint256 batchId) external view returns (bool).
    function surrenderCCC(uint256 amount, string calldata reason) external.
}

interface ICCTSOffsetToken {
    function mint(uint256 batchId, address to, uint256 amount) external.
    function burn(uint256 batchId, uint256 amount, string calldata reason) external.
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external.
    function safeBatchTransferFrom(address from, address to, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata data) external.
    function balanceOf(address account, uint256 id) view returns (uint256).
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) view returns (uint256[] memory).
    function totalSupply(uint256 id) view returns (uint256).
    function exists(uint256 id) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getBatchInfo(uint256 batchId) view returns (tuple(string name, string standard, uint256 vintage, uint256 totalSupply, uint256 availableSupply, uint256 retiredSupply, string registry, string methodology, string projectType, string geography, bool complianceEligible, bool active)).
    function getBatchBalance(address account, uint256 batchId) view returns (uint256).
    function getBatchTotalSupply(uint256 batchId) view returns (uint256).
    function getBatchAvailableSupply(uint256 batchId) view returns (uint256).
    function getBatchRetiredSupply(uint256 batchId) view returns (uint256).
    function isBatchActive(uint256 batchId) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getTotalSupply() view returns (uint256).
    function getTotalBatches() view returns (uint256).
    function getAllActiveBatches() view returns (uint256[] memory).
}

interface IMessageRelay {
    function sendMessage(string calldata destinationChain, bytes calldata message) external.
    function relayMessage(string calldata sourceChain, bytes calldata message) external.
    function getMessageStatus(bytes32 messageId) external view returns (uint8).
    function getMessageInfo(bytes32 messageId) external view returns (MessageInfo memory).
    function getChainId(string calldata chainName) external view returns (uint256).
    function getGatewayAddress(string calldata chainName) external view returns (address).
}

interface ICCTSRegistry {
    function registerOffsetCCC(uint256 batchId, uint256 amount, address recipient) external returns (uint256).
    function isComplianceEligible(uint256 batchId) external view returns (bool).
    function surrenderCCC(uint256 amount, string calldata reason) external.
}

interface ICCTSOffsetToken {
    function mint(uint256 batchId, address to, uint256 amount) external.
    function burn(uint256 batchId, uint256 amount, string calldata reason) external.
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external.
    function safeBatchTransferFrom(address from, address to, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata data) external.
    function balanceOf(address account, uint256 id) view returns (uint256).
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) view returns (uint256[] memory).
    function totalSupply(uint256 id) view returns (uint256).
    function exists(uint256 id) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getBatchInfo(uint256 batchId) view returns (tuple(string name, string standard, uint256 vintage, uint256 totalSupply, uint256 availableSupply, uint256 retiredSupply, string registry, string methodology, string projectType, string geography, bool complianceEligible, bool active)).
    function getBatchBalance(address account, uint256 batchId) view returns (uint256).
    function getBatchTotalSupply(uint256 batchId) view returns (uint256).
    function getBatchAvailableSupply(uint256 batchId) view returns (uint256).
    function getBatchRetiredSupply(uint256 batchId) view returns (uint256).
    function isBatchActive(uint256 batchId) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getTotalSupply() view returns (uint256).
    function getTotalBatches() view returns (uint256).
    function getAllActiveBatches() view returns (uint256[] memory).
}

interface IMessageRelay {
    function sendMessage(string calldata destinationChain, bytes calldata message) external.
    function relayMessage(string calldata sourceChain, bytes calldata message) external.
    function getMessageStatus(bytes32 messageId) external view returns (uint8).
    function getMessageInfo(bytes32 messageId) external view returns (MessageInfo memory).
    function getChainId(string calldata chainName) external view returns (uint256).
    function getGatewayAddress(string calldata chainName) external view returns (address).
}

interface ICCTSRegistry {
    function registerOffsetCCC(uint256 batchId, uint256 amount, address recipient) external returns (uint256).
    function isComplianceEligible(uint256 batchId) external view returns (bool).
    function surrenderCCC(uint256 amount, string calldata reason) external.
}

interface ICCTSOffsetToken {
    function mint(uint256 batchId, address to, uint256 amount) external.
    function burn(uint256 batchId, uint256 amount, string calldata reason) external.
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external.
    function safeBatchTransferFrom(address from, address to, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata data) external.
    function balanceOf(address account, uint256 id) view returns (uint256).
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) view returns (uint256[] memory).
    function totalSupply(uint256 id) view returns (uint256).
    function exists(uint256 id) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getBatchInfo(uint256 batchId) view returns (tuple(string name, string standard, uint256 vintage, uint256 totalSupply, uint256 availableSupply, uint256 retiredSupply, string registry, string methodology, string projectType, string geography, bool complianceEligible, bool active)).
    function getBatchBalance(address account, uint256 batchId) view returns (uint256).
    function getBatchTotalSupply(uint256 batchId) view returns (uint256).
    function getBatchAvailableSupply(uint256 batchId) view returns (uint256).
    function getBatchRetiredSupply(uint256 batchId) view returns (uint256).
    function isBatchActive(uint256 batchId) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getTotalSupply() view returns (uint256).
    function getTotalBatches() view returns (uint256).
    function getAllActiveBatches() view returns (uint256[] memory).
}

interface IMessageRelay {
    function sendMessage(string calldata destinationChain, bytes calldata message) external.
    function relayMessage(string calldata sourceChain, bytes calldata message) external.
    function getMessageStatus(bytes32 messageId) external view returns (uint8).
    function getMessageInfo(bytes32 messageId) external view returns (MessageInfo memory).
    function getChainId(string calldata chainName) external view returns (uint256).
    function getGatewayAddress(string calldata chainName) external view returns (address).
}

interface ICCTSRegistry {
    function registerOffsetCCC(uint256 batchId, uint256 amount, address recipient) external returns (uint256).
    function isComplianceEligible(uint256 batchId) external view returns (bool).
    function surrenderCCC(uint256 amount, string calldata reason) external.
}

interface ICCTSOffsetToken {
    function mint(uint256 batchId, address to, uint256 amount) external.
    function burn(uint256 batchId, uint256 amount, string calldata reason) external.
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external.
    function safeBatchTransferFrom(address from, address to, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata data) external.
    function balanceOf(address account, uint256 id) view returns (uint256).
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) view returns (uint256[] memory).
    function totalSupply(uint256 id) view returns (uint256).
    function exists(uint256 id) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getBatchInfo(uint256 batchId) view returns (tuple(string name, string standard, uint256 vintage, uint256 totalSupply, uint256 availableSupply, uint256 retiredSupply, string registry, string methodology, string projectType, string geography, bool complianceEligible, bool active)).
    function getBatchBalance(address account, uint256 batchId) view returns (uint256).
    function getBatchTotalSupply(uint256 batchId) view returns (uint256).
    function getBatchAvailableSupply(uint256 batchId) view returns (uint256).
    function getBatchRetiredSupply(uint256 batchId) view returns (uint256).
    function isBatchActive(uint256 batchId) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getTotalSupply() view returns (uint256).
    function getTotalBatches() view returns (uint256).
    function getAllActiveBatches() view returns (uint256[] memory).
}

interface IMessageRelay {
    function sendMessage(string calldata destinationChain, bytes calldata message) external.
    function relayMessage(string calldata sourceChain, bytes calldata message) external.
    function getMessageStatus(bytes32 messageId) external view returns (uint8).
    function getMessageInfo(bytes32 messageId) external view returns (MessageInfo memory).
    function getChainId(string calldata chainName) external view returns (uint256).
    function getGatewayAddress(string calldata chainName) external view returns (address).
}

interface ICCTSRegistry {
    function registerOffsetCCC(uint256 batchId, uint256 amount, address recipient) external returns (uint256).
    function isComplianceEligible(uint256 batchId) external view returns (bool).
    function surrenderCCC(uint256 amount, string calldata reason) external.
}

interface ICCTSOffsetToken {
    function mint(uint256 batchId, address to, uint256 amount) external.
    function burn(uint256 batchId, uint256 amount, string calldata reason) external.
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external.
    function safeBatchTransferFrom(address from, address to, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata data) external.
    function balanceOf(address account, uint256 id) view returns (uint256).
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) view returns (uint256[] memory).
    function totalSupply(uint256 id) view returns (uint256).
    function exists(uint256 id) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getBatchInfo(uint256 batchId) view returns (tuple(string name, string standard, uint256 vintage, uint256 totalSupply, uint256 availableSupply, uint256 retiredSupply, string registry, string methodology, string projectType, string geography, bool complianceEligible, bool active)).
    function getBatchBalance(address account, uint256 batchId) view returns (uint256).
    function getBatchTotalSupply(uint256 batchId) view returns (uint256).
    function getBatchAvailableSupply(uint256 batchId) view returns (uint256).
    function getBatchRetiredSupply(uint256 batchId) view returns (uint256).
    function isBatchActive(uint256 batchId) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getTotalSupply() view returns (uint256).
    function getTotalBatches() view returns (uint256).
    function getAllActiveBatches() view returns (uint256[] memory).
}

interface IMessageRelay {
    function sendMessage(string calldata destinationChain, bytes calldata message) external.
    function relayMessage(string calldata sourceChain, bytes calldata message) external.
    function getMessageStatus(bytes32 messageId) external view returns (uint8).
    function getMessageInfo(bytes32 messageId) external view returns (MessageInfo memory).
    function getChainId(string calldata chainName) external view returns (uint256).
    function getGatewayAddress(string calldata chainName) external view returns (address).
}

interface ICCTSRegistry {
    function registerOffsetCCC(uint256 batchId, uint256 amount, address recipient) external returns (uint256).
    function isComplianceEligible(uint256 batchId) external view returns (bool).
    function surrenderCCC(uint256 amount, string calldata reason) external.
}

interface ICCTSOffsetToken {
    function mint(uint256 batchId, address to, uint256 amount) external.
    function burn(uint256 batchId, uint256 amount, string calldata reason) external.
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external.
    function safeBatchTransferFrom(address from, address to, uint256[] calldata ids, uint256[] calldata amounts, bytes calldata data) external.
    function balanceOf(address account, uint256 id) view returns (uint256).
    function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) view returns (uint256[] memory).
    function totalSupply(uint256 id) view returns (uint256).
    function exists(uint256 id) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getBatchInfo(uint256 batchId) view returns (tuple(string name, string standard, uint256 vintage, uint256 totalSupply, uint256 availableSupply, uint256 retiredSupply, string registry, string methodology, string projectType, string geography, bool complianceEligible, bool active)).
    function getBatchBalance(address account, uint256 batchId) view returns (uint256).
    function getBatchTotalSupply(uint256 batchId) view returns (uint256).
    function getBatchAvailableSupply(uint256 batchId) view returns (uint256).
    function getBatchRetiredSupply(uint256 batchId) view returns (uint256).
    function isBatchActive(uint256 batchId) view returns (bool).
    function isComplianceEligible(uint256 batchId) view returns (bool).
    function getTotalSupply() view returns (uint256).
    function getTotalBatches() view returns (uint256).
    function getAllActiveBatches() view returns (uint256[] memory).
}

interface IMessageRelay {
    function sendMessage(string calldata destinationChain, bytes calldata message) external.
    function relayMessage(string calldata sourceChain, bytes calldata message) external.
    function getMessageStatus(bytes32 messageId) external view returns (uint8).
    function getMessageInfo(bytes32 messageId) external view returns (MessageInfo memory).
    function getChainId(string calldata chainName) external view returns (uint256).
    function getGatewayAddress(string calldata chainName) external view returns (address).
}