// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Context.sol";

/**
 * @title BlockConfirmations
 * @notice Library for handling blockchain reorganizations and confirmation depths
 *         Provides utilities for waiting for confirmations and detecting reorgs
 */
library BlockConfirmations {
    // Minimum confirmations for different operations
    uint256 public constant MIN_CONFIRMATIONS_TRANSFER = 2;
    uint256 public constant MIN_CONFIRMATIONS_TRADE = 3;
    uint256 public constant MIN_CONFIRMATIONS_MINT = 3;
    uint256 public constant MIN_CONFIRMATIONS_RETIRE = 3;
    uint256 public constant MIN_CONFIRMATIONS_SETTLEMENT = 3;
    uint256 public constant MIN_CONFIRMATIONS_HIGH_VALUE = 5; // For high-value transactions
    uint256 public constant MIN_CONFIRMATIONS_GOVERNANCE = 10; // Governance operations

    // High-value threshold (in wei/units)
    uint256 public constant HIGH_VALUE_THRESHOLD_ETH = 10 ether;
    uint256 public constant HIGH_VALUE_THRESHOLD_INR = 1000000; // ₹10,00,000

    // ─────────────────────────────────────────────────────────────
    // Confirmation Checking
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Get required confirmations based on transaction type and value
     * @param txType Type of transaction
     * @param value Value in wei (for ETH) or paise (for INR)
     * @param isETH True if ETH transaction, false if INR
     * @return Required number of confirmations
     */
    function getRequiredConfirmations(
        TransactionType txType,
        uint256 value,
        bool isETH
    ) internal pure returns (uint256) {
        uint256 baseConfirmations;
        
        switch (txType) {
            case TransactionType.TRANSFER:
                baseConfirmations = MIN_CONFIRMATIONS_TRANSFER;
                break;
            case TransactionType.TRADE:
                baseConfirmations = MIN_CONFIRMATIONS_TRADE;
                break;
            case TransactionType.MINT:
                baseConfirmations = MIN_CONFIRMATIONS_MINT;
                break;
            case TransactionType.RETIRE:
                baseConfirmations = MIN_CONFIRMATIONS_RETIRE;
                break;
            case TransactionType.SETTLEMENT:
                baseConfirmations = MIN_CONFIRMATIONS_SETTLEMENT;
                break;
            case TransactionType.GOVERNANCE:
                baseConfirmations = MIN_CONFIRMATIONS_GOVERNANCE;
                break;
            default:
                baseConfirmations = 3;
        }

        // Increase for high-value transactions
        uint256 threshold = isETH ? HIGH_VALUE_THRESHOLD_ETH : HIGH_VALUE_THRESHOLD_INR;
        if (value >= threshold) {
            baseConfirmations = baseConfirmations + 2;
        }

        return baseConfirmations;
    }

    /**
     * @notice Check if a transaction has sufficient confirmations
     * @param txHash Transaction hash
     * @param requiredConfirmations Required number of confirmations
     * @return (bool confirmed, uint256 currentConfirmations)
     */
    function checkConfirmations(
        bytes32 txHash,
        uint256 requiredConfirmations
    ) internal view returns (bool, uint256) {
        // This would query the blockchain for the transaction receipt
        // and compare block numbers
        // Implementation depends on the RPC provider
        // Returns (false, 0) as placeholder - actual implementation
        // would use eth_getTransactionReceipt and compare block numbers
        return (false, 0);
    }

    /**
     * @notice Wait for transaction confirmations (off-chain utility)
     * @param txHash Transaction hash
     * @param requiredConfirmations Required confirmations
     * @param timeout Timeout in seconds
     * @param pollInterval Polling interval in seconds
     * @return True if confirmed within timeout
     */
    function waitForConfirmations(
        bytes32 txHash,
        uint256 requiredConfirmations,
        uint256 timeout,
        uint256 pollInterval
    ) internal view returns (bool) {
        // Off-chain implementation would be in JavaScript/TypeScript
        // This is a placeholder for documentation
        return true;
    }

    // ─────────────────────────────────────────────────────────────
    // Reorg Detection
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Check if a block has been reorganized
     * @param blockHash Block hash to check
     * @param expectedBlockNumber Expected block number
     * @return True if reorg detected
     */
    function detectReorg(
        bytes32 blockHash,
        uint256 expectedBlockNumber
    ) internal view returns (bool) {
        // Compare the current block hash at the expected height
        // with the expected hash
        // Returns true if they don't match (reorg detected)
        return false; // Placeholder
    }

    /**
     * @notice Get the current canonical block hash at a given height
     * @param blockNumber Block number
     * @return Block hash
     */
    function getCanonicalBlockHash(uint256 blockNumber) internal view returns (bytes32) {
        // Would use blockhash() for recent blocks (last 256)
        // For older blocks, would need archive node or archive service
        return blockhash(blockNumber);
    }

    /**
     * @notice Calculate reorg depth
     * @param originalHash Original block hash
     * @param currentHash Current block hash at same height
     * @return Depth of reorg (0 if no reorg)
     */
    function calculateReorgDepth(
        bytes32 originalHash,
        bytes32 currentHash
    ) internal pure returns (uint256) {
        if (originalHash == currentHash) {
            return 0;
        }
        // In practice, would need to trace back to common ancestor
        // This is a simplified version
        return 1;
    }

    // ─────────────────────────────────────────────────────────────
    // Transaction Finality
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Check if a transaction is considered final
     * @param txHash Transaction hash
     * @param txType Transaction type
     * @param value Transaction value
     * @param isETH Whether ETH or INR transaction
     * @return True if transaction is considered final
     */
    function isTransactionFinal(
        bytes32 txHash,
        TransactionType txType,
        uint256 value,
        bool isETH
    ) internal view returns (bool) {
        uint256 required = getRequiredConfirmations(txType, value, isETH);
        (bool confirmed, ) = checkConfirmations(txHash, required);
        return confirmed;
    }

    /**
     * @notice Get finality status for a transaction
     * @param txHash Transaction hash
     * @return FinalityStatus enum
     */
    function getFinalityStatus(bytes32 txHash) internal view returns (FinalityStatus) {
        // Would check transaction receipt and current block
        // Return PENDING, CONFIRMED, FINALIZED, or REORGED
        return FinalityStatus.PENDING;
    }

    // ─────────────────────────────────────────────────────────────
    // Reorg Recovery
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Handle detected reorg for a transaction
     * @param txHash Transaction hash
     * @param originalBlockHash Original block hash
     * @param originalBlockNumber Original block number
     * @return Action to take
     */
    function handleReorg(
        bytes32 txHash,
        bytes32 originalBlockHash,
        uint256 originalBlockNumber
    ) internal view returns (ReorgAction) {
        // Check if transaction still exists in new chain
        bool exists = checkTransactionExists(txHash);
        
        if (!exists) {
            return ReorgAction.TRANSACTION_DROPPED;
        }
        
        // Check if it's in a different block
        uint256 newBlockNumber = getTransactionBlockNumber(txHash);
        if (newBlockNumber != originalBlockNumber) {
            return ReorgAction.TRANSACTION_REORGED;
        }
        
        return ReorgAction.NO_ACTION;
    }

    // ─────────────────────────────────────────────────────────────
    // Internal Helper Types
    // ─────────────────────────────────────────────────────────────

    enum TransactionType {
        TRANSFER,
        TRADE,
        MINT,
        RETIRE,
        SETTLEMENT,
        GOVERNANCE
    }

    enum FinalityStatus {
        PENDING,
        CONFIRMED,
        FINALIZED,
        REORGED
    }

    enum ReorgAction {
        NO_ACTION,
        TRANSACTION_DROPPED,
        TRANSACTION_REORGED,
        WAIT_FOR_RECONFIRMATION
    }

    // ─────────────────────────────────────────────────────────────
    // Internal View Functions (to be implemented by consumer)
    // ─────────────────────────────────────────────────────────────

    function checkTransactionExists(bytes32 txHash) internal view returns (bool);
    function getTransactionBlockNumber(bytes32 txHash) internal view returns (uint256);
}

// ─────────────────────────────────────────────────────────────────
// Reorg-Resilient Transaction Pattern
// ─────────────────────────────────────────────────────────────

/**
 * @title ReorgResilientContract
 * @notice Base contract providing reorg-resilient patterns
 */
abstract contract ReorgResilientContract {
    // Track last processed block for each transaction type
    mapping(bytes32 => uint256) public lastProcessedBlock;
    
    // Track pending transactions awaiting confirmations
    struct PendingTx {
        bytes32 txHash;
        uint256 requiredConfirmations;
        uint256 submittedBlock;
        bool isHighValue;
        uint256 timestamp;
    }
    
    mapping(bytes32 => PendingTx) public pendingTransactions;
    bytes32[] public pendingTxList;
    
    event TransactionSubmitted(
        bytes32 indexed txHash,
        uint256 requiredConfirmations,
        bool isHighValue
    );
    
    event TransactionConfirmed(
        bytes32 indexed txHash,
        uint256 confirmations
    );
    
    event TransactionDropped(
        bytes32 indexed txHash,
        uint256 originalBlock
    );
    
    event ReorgDetected(
        uint256 originalBlock,
        uint256 newBlock,
        uint256 depth
    );

    modifier onlyAuthorized() {
        // Override in child contracts
        _;
    }

    // Submit a transaction for tracking
    function trackTransaction(
        bytes32 txHash,
        uint256 requiredConfirmations,
        bool isHighValue
    ) internal onlyAuthorized {
        require(pendingTransactions[txHash].submittedBlock == 0, "Already tracked");
        
        pendingTransactions[txHash] = PendingTx({
            txHash: txHash,
            requiredConfirmations: requiredConfirmations,
            submittedBlock: block.number,
            isHighValue: isHighValue,
            timestamp: block.timestamp
        });
        
        pendingTxList.push(txHash);
        emit TransactionSubmitted(txHash, requiredConfirmations, isHighValue);
    }

    // Check and update pending transactions
    function checkPendingTransactions() external {
        for (uint256 i = 0; i < pendingTxList.length; i++) {
            bytes32 txHash = pendingTxList[i];
            PendingTx storage tx = pendingTransactions[txHash];
            
            if (tx.submittedBlock == 0) continue; // Already processed
            
            uint256 currentConfirmations = block.number - tx.submittedBlock;
            
            if (currentConfirmations >= tx.requiredConfirmations) {
                // Confirmed!
                emit TransactionConfirmed(tx.txHash, currentConfirmations);
                delete pendingTransactions[txHash];
                // Remove from list (swap with last)
                pendingTxList[i] = pendingTxList[pendingTxList.length - 1];
                pendingTxList.pop();
                i--; // Adjust index
            } else if (block.number - tx.submittedBlock > 1000) {
                // Timeout - transaction stuck
                emit TransactionDropped(tx.txHash, tx.submittedBlock);
                delete pendingTransactions[txHash];
                pendingTxList[i] = pendingTxList[pendingTxList.length - 1];
                pendingTxList.pop();
                i--;
            }
        }
    }

    // Handle reorg
    function handleReorg(uint256 oldBlockNumber, uint256 newBlockNumber) internal {
        uint256 depth = oldBlockNumber > newBlockNumber ? oldBlockNumber - newBlockNumber : newBlockNumber - oldBlockNumber;
        
        if (depth > 0) {
            emit ReorgDetected(oldBlockNumber, newBlockNumber, depth);
            
            // Re-check all pending transactions
            for (uint256 i = 0; i < pendingTxList.length; i++) {
                bytes32 txHash = pendingTxList[i];
                PendingTx storage tx = pendingTransactions[txHash];
                
                if (tx.submittedBlock >= newBlockNumber) {
                    // This transaction might have been reorged
                    // Reset confirmation count
                    // (In practice, would check if tx still exists on new chain)
                }
            }
        }
    }
}