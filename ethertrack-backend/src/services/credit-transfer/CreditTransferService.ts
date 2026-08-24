// Credit Transfer Service - Executes credit transfers across custody types

import crypto from 'crypto';
import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import { CustodyAdapterFactory } from '../custody';
import { 
  CreditTransfer, 
  CreditTransferOperation, 
  CreditTransferOperationType,
  CreditTransferStatus,
  CustodyType,
  Trade
} from '../../domain/types';

export class CreditTransferService {
  async executeTransfer(trade: Trade): Promise<CreditTransferOperation[]> {
    const operations: CreditTransferOperation[] = [];

    // Determine transfer pattern based on custody types
    const { sellerCustodyType, buyerCustodyType } = trade;

    if (sellerCustodyType === 'onchain' && buyerCustodyType === 'onchain') {
      // On-chain to on-chain: Marketplace.sol handles via buyCredit or settleINRTrade
      // The actual transfer happens on-chain, we just record it
      operations.push(await this.recordOnChainTransfer(trade));
    } 
    else if (sellerCustodyType === 'ledger' && buyerCustodyType === 'ledger') {
      // Ledger to ledger: Atomic DB transaction with CreditLedger.sol logs
      operations.push(...await this.executeLedgerToLedgerTransfer(trade));
    } 
    else if (sellerCustodyType === 'onchain' && buyerCustodyType === 'ledger') {
      // On-chain seller to ledger buyer: settleINRTrade + CreditLedger BUY log
      operations.push(...await this.executeOnChainToLedgerTransfer(trade));
    } 
    else if (sellerCustodyType === 'ledger' && buyerCustodyType === 'onchain') {
      // Ledger seller to on-chain buyer: CreditLedger SELL + Marketplace buyCredit/settleINRTrade
      operations.push(...await this.executeLedgerToOnChainTransfer(trade));
    }

    // Update credit transfer record
    await query(
      `UPDATE credit_transfers SET status = 'CONFIRMED', completed_at = NOW(), updated_at = NOW() WHERE transfer_id = $1`,
      [trade.credit_transfer_id]
    );

    return operations;
  }

  private async recordOnChainTransfer(trade: Trade): Promise<CreditTransferOperation> {
    const operationId = crypto.randomUUID();
    
    await query(
      `INSERT INTO credit_transfer_operations (
        operation_id, transfer_id, type, custody_type,
        from_address, to_address, blockchain_tx_hash, blockchain_log_index,
        chain_id, contract_address, status
      ) VALUES ($1,$2,'ERC1155_TRANSFER','onchain',$3,$4,$5,$6,$7,$8,'CONFIRMED')`,
      [
        operationId, trade.credit_transfer_id,
        trade.seller_id, // would be wallet address
        trade.buyer_id,  // would be wallet address
        trade.chain_tx_hash,
        trade.chain_log_index,
        process.env.CHAIN_ID || '80001',
        process.env.MARKETPLACE_ADDRESS
      ]
    );

    return {
      operationId,
      transferId: trade.credit_transfer_id,
      type: 'ERC1155_TRANSFER',
      custodyType: 'onchain',
      fromAddress: trade.seller_id,
      toAddress: trade.buyer_id,
      blockchainTxHash: trade.chain_tx_hash,
      blockchainLogIndex: trade.chain_log_index,
      chainId: parseInt(process.env.CHAIN_ID || '80001'),
      contractAddress: process.env.MARKETPLACE_ADDRESS!,
      status: 'CONFIRMED',
      confirmedAt: new Date()
    };
  }

  private async executeLedgerToLedgerTransfer(trade: Trade): Promise<CreditTransferOperation[]> {
    const sellerAdapter = CustodyAdapterFactory.getAdapter('ledger');
    const buyerAdapter = CustodyAdapterFactory.getAdapter('ledger');

    // Execute SELL (debit seller)
    const sellOp: CreditTransferOperation = {
      operationId: crypto.randomUUID(),
      transferId: trade.credit_transfer_id,
      type: 'LEDGER_SELL',
      custodyType: 'ledger',
      fromAddress: trade.seller_id,
      toAddress: null,
      blockchainTxHash: null,
      blockchainLogIndex: null,
      chainId: parseInt(process.env.CHAIN_ID || '80001'),
      contractAddress: process.env.CREDIT_LEDGER_ADDRESS!,
      status: 'SUBMITTED'
    };

    // Execute BUY (credit buyer)
    const buyOp: CreditTransferOperation = {
      operationId: crypto.randomUUID(),
      transferId: trade.credit_transfer_id,
      type: 'LEDGER_BUY',
      custodyType: 'ledger',
      fromAddress: null,
      toAddress: trade.buyer_id,
      blockchainTxHash: null,
      blockchainLogIndex: null,
      chainId: parseInt(process.env.CHAIN_ID || '80001'),
      contractAddress: process.env.CREDIT_LEDGER_ADDRESS!,
      status: 'SUBMITTED'
    };

    // Execute atomically via custody adapters
    const [sellResult, buyResult] = await Promise.all([
      sellerAdapter.executeSell(trade.credit_transfer_id, trade.seller_id, trade.asset_id, trade.quantity, sellOp),
      buyerAdapter.executeBuy(trade.credit_transfer_id, trade.buyer_id, trade.asset_id, trade.quantity, buyOp)
    ]);

    return [sellResult, buyResult];
  }

  private async executeOnChainToLedgerTransfer(trade: Trade): Promise<CreditTransferOperation[]> {
    const operations: CreditTransferOperation[] = [];

    // 1. On-chain escrow release to custody wallet (via settleINRTrade)
    // This is handled by SettlementEngine calling OnChainCustodyAdapter.executeBuy
    // We record the operation
    const onChainOp: CreditTransferOperation = {
      operationId: crypto.randomUUID(),
      transferId: trade.credit_transfer_id,
      type: 'ESCROW_RELEASE',
      custodyType: 'onchain',
      fromAddress: trade.seller_id,
      toAddress: process.env.CUSTODY_WALLET_ADDRESS!,
      blockchainTxHash: trade.chain_tx_hash,
      blockchainLogIndex: trade.chain_log_index,
      chainId: parseInt(process.env.CHAIN_ID || '80001'),
      contractAddress: process.env.MARKETPLACE_ADDRESS!,
      status: 'CONFIRMED',
      confirmedAt: new Date()
    };
    operations.push(onChainOp);

    // 2. CreditLedger BUY log for buyer
    const buyerAdapter = CustodyAdapterFactory.getAdapter('ledger');
    const buyOp: CreditTransferOperation = {
      operationId: crypto.randomUUID(),
      transferId: trade.credit_transfer_id,
      type: 'LEDGER_BUY',
      custodyType: 'ledger',
      fromAddress: null,
      toAddress: trade.buyer_id,
      blockchainTxHash: null,
      blockchainLogIndex: null,
      chainId: parseInt(process.env.CHAIN_ID || '80001'),
      contractAddress: process.env.CREDIT_LEDGER_ADDRESS!,
      status: 'SUBMITTED'
    };

    const buyResult = await buyerAdapter.executeBuy(
      trade.credit_transfer_id, 
      trade.buyer_id, 
      trade.asset_id, 
      trade.quantity, 
      buyOp
    );
    operations.push(buyResult);

    return operations;
  }

  private async executeLedgerToOnChainTransfer(trade: Trade): Promise<CreditTransferOperation[]> {
    const operations: CreditTransferOperation[] = [];

    // 1. CreditLedger SELL log for seller
    const sellerAdapter = CustodyAdapterFactory.getAdapter('ledger');
    const sellOp: CreditTransferOperation = {
      operationId: crypto.randomUUID(),
      transferId: trade.credit_transfer_id,
      type: 'LEDGER_SELL',
      custodyType: 'ledger',
      fromAddress: trade.seller_id,
      toAddress: null,
      blockchainTxHash: null,
      blockchainLogIndex: null,
      chainId: parseInt(process.env.CHAIN_ID || '80001'),
      contractAddress: process.env.CREDIT_LEDGER_ADDRESS!,
      status: 'SUBMITTED'
    };

    const sellResult = await sellerAdapter.executeSell(
      trade.credit_transfer_id,
      trade.seller_id,
      trade.asset_id,
      trade.quantity,
      sellOp
    );
    operations.push(sellResult);

    // 2. On-chain transfer to buyer (via Marketplace.sol buyCredit or settleINRTrade)
    const onChainOp: CreditTransferOperation = {
      operationId: crypto.randomUUID(),
      transferId: trade.credit_transfer_id,
      type: 'ERC1155_TRANSFER',
      custodyType: 'onchain',
      fromAddress: process.env.CUSTODY_WALLET_ADDRESS!,
      toAddress: trade.buyer_id,
      blockchainTxHash: trade.chain_tx_hash,
      blockchainLogIndex: trade.chain_log_index,
      chainId: parseInt(process.env.CHAIN_ID || '80001'),
      contractAddress: process.env.MARKETPLACE_ADDRESS!,
      status: 'CONFIRMED',
      confirmedAt: new Date()
    };
    operations.push(onChainOp);

    return operations;
  }

  async getCreditTransfer(transferId: string): Promise<CreditTransfer | null> {
    const { rows } = await query('SELECT * FROM credit_transfers WHERE transfer_id = $1', [transferId]);
    if (!rows.length) return null;
    return this.mapRowToCreditTransfer(rows[0]);
  }

  async getTransferOperations(transferId: string): Promise<CreditTransferOperation[]> {
    const { rows } = await query(
      'SELECT * FROM credit_transfer_operations WHERE transfer_id = $1 ORDER BY created_at',
      [transferId]
    );
    return rows.map(this.mapRowToOperation);
  }

  async getTransfersByTrade(tradeId: string): Promise<CreditTransfer[]> {
    const { rows } = await query('SELECT * FROM credit_transfers WHERE trade_id = $1', [tradeId]);
    return rows.map(this.mapRowToCreditTransfer);
  }

  private mapRowToCreditTransfer(row: any): CreditTransfer {
    return {
      transferId: row.transfer_id,
      tradeId: row.trade_id,
      assetId: row.asset_id,
      quantity: Number(row.quantity),
      fromCustodyType: row.from_custody_type,
      toCustodyType: row.to_custody_type,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      updatedAt: row.updated_at
    };
  }

  private mapRowToOperation(row: any): CreditTransferOperation {
    return {
      operationId: row.operation_id,
      transferId: row.transfer_id,
      type: row.type,
      custodyType: row.custody_type,
      fromAddress: row.from_address,
      toAddress: row.to_address,
      blockchainTxHash: row.blockchain_tx_hash,
      blockchainLogIndex: row.blockchain_log_index,
      chainId: row.chain_id,
      contractAddress: row.contract_address,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at
    };
  }
}