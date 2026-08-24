// Ledger Custody Adapter - Interacts with CreditLedger.sol for wallet-free users

import { ethers } from 'ethers';
import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import { 
  CustodyAdapter, 
  CustodyAdapterConfig, 
  CustodyType,
  CreditTransferOperationType,
  CreditTransferOperation,
  CarbonAsset,
  InsufficientBalanceError,
  TransferFailedError,
  BalanceMismatchError
} from './CustodyAdapter';

const LEDGER_ABI = [
  'function logOwnershipChange(bytes32 userId, uint256 tokenId, int256 amountDelta, uint8 actionType, bytes32 refHash, string calldata note) external returns (uint256 logId)',
  'function logRetirement(bytes32 userId, uint256 tokenId, uint256 amount, bytes32 refHash) external returns (uint256 logId)',
  'function getUserBalance(bytes32 userId, uint256 tokenId) view returns (uint256)',
  'function getUserReserved(bytes32 userId, uint256 tokenId) view returns (uint256)',
  'function getUserAvailable(bytes32 userId, uint256 tokenId) view returns (uint256)',
  'function getUserRetired(bytes32 userId, uint256 tokenId) view returns (uint256)',
  'function computeUserId(string calldata userUuid) view returns (bytes32)',
  'event OwnershipLogged(uint256 indexed logId, bytes32 indexed userId, uint256 indexed tokenId, int256 amountDelta, uint8 actionType, bytes32 refHash)',
  'event CreditRetiredLogged(uint256 indexed logId, bytes32 indexed userId, uint256 tokenId, uint256 amount, bytes32 refHash)',
];

const ACTION_TYPE = { MINT: 0, LIST: 1, DELIST: 2, BUY: 3, SELL: 4, RETIRE: 5, WITHDRAW_TO_WALLET: 6, RESERVE: 7, RELEASE_RESERVE: 8 };

export class LedgerCustodyAdapter implements CustodyAdapter {
  readonly custodyType: CustodyType = 'ledger';
  
  private provider: ethers.JsonRpcProvider;
  private custodyWallet: ethers.Wallet;
  private ledger: ethers.Contract;
  private config: CustodyAdapterConfig;

  constructor(config: CustodyAdapterConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.custodyWallet = new ethers.Wallet(config.custodyWallet.privateKey, this.provider);
    this.ledger = new ethers.Contract(config.contracts.creditLedger, LEDGER_ABI, this.custodyWallet);
  }

  // Deterministic user ID hash (matches CreditLedger.sol computeUserId)
  private computeUserIdHash(userUuid: string): string {
    return ethers.keccak256(ethers.toUtf8Bytes(userUuid));
  }

  private async getOrCreateUserIdHash(userId: string): Promise<string> {
    const { rows } = await query('SELECT user_id_hash FROM users WHERE id = $1', [userId]);
    if (rows[0]?.user_id_hash) return rows[0].user_id_hash;

    const hash = this.computeUserIdHash(userId);
    await query('UPDATE users SET user_id_hash = $1 WHERE id = $2', [hash, userId]);
    return hash;
  }

  private computeRefHash(
    userIdHash: string, 
    tokenId: number, 
    amountDelta: number, 
    actionType: string, 
    refTable: string | null, 
    refId: string | null
  ): string {
    return ethers.keccak256(ethers.toUtf8Bytes(
      `${userIdHash}:${tokenId}:${amountDelta}:${actionType}:${refTable || ''}:${refId || ''}`
    ));
  }

  async getOwnedBalance(userId: string, assetId: string): Promise<number> {
    const { rows: assetRows } = await query(
      `SELECT token_id FROM carbon_assets WHERE asset_id = $1`,
      [assetId]
    );
    if (!assetRows.length) return 0;
    
    const tokenId = assetRows[0].token_id;
    const userIdHash = await this.getOrCreateUserIdHash(userId);
    
    const onChainBalance = await this.ledger.getUserBalance(userIdHash, tokenId);
    return Number(onChainBalance);
  }

  async getReservedBalance(userId: string, assetId: string): Promise<number> {
    const { rows: assetRows } = await query(
      `SELECT token_id FROM carbon_assets WHERE asset_id = $1`,
      [assetId]
    );
    if (!assetRows.length) return 0;
    
    const tokenId = assetRows[0].token_id;
    const userIdHash = await this.getOrCreateUserIdHash(userId);
    
    const onChainReserved = await this.ledger.getUserReserved(userIdHash, tokenId);
    return Number(onChainReserved);
  }

  async getAvailableBalance(userId: string, assetId: string): Promise<number> {
    const { rows: assetRows } = await query(
      `SELECT token_id FROM carbon_assets WHERE asset_id = $1`,
      [assetId]
    );
    if (!assetRows.length) return 0;
    
    const tokenId = assetRows[0].token_id;
    const userIdHash = await this.getOrCreateUserIdHash(userId);
    
    const onChainAvailable = await this.ledger.getUserAvailable(userIdHash, tokenId);
    return Number(onChainAvailable);
  }

  async reserveCredits(userId: string, assetId: string, quantity: number, listingId: string): Promise<void> {
    const { rows } = await query(
      `SELECT clb.balance, ca.token_id
       FROM credit_ledger_balances clb
       JOIN carbon_assets ca ON ca.token_id = clb.token_id
       WHERE clb.user_id = $1 AND ca.asset_id = $2`,
      [userId, assetId]
    );
    
    if (!rows.length) {
      throw new InsufficientBalanceError(this.custodyType, userId, assetId, quantity, 0);
    }
    
    const available = Number(rows[0].balance);
    const tokenId = rows[0].token_id;
    
    // Verify on-chain balance matches DB
    const verified = await this.verifyBalance(userId, assetId);
    if (!verified.matches) {
      throw new BalanceMismatchError(this.custodyType, userId, assetId, verified.onChain, verified.db);
    }
    
    if (available < quantity) {
      throw new InsufficientBalanceError(this.custodyType, userId, assetId, quantity, available);
    }
    
    // Check for existing active listing (enforced by unique constraint)
    const { rows: existing } = await query(
      `SELECT 1 FROM listings WHERE position_id = (
         SELECT position_id FROM ownership_positions WHERE owner_id = $1 AND asset_id = $2 AND custody_type = 'ledger'
       ) AND status = 'active'`,
      [userId, assetId]
    );
    
    if (existing.length) {
      throw new TransferFailedError(this.custodyType, userId, assetId, quantity, 'LIST', 
        new Error('Active listing already exists for this asset'));
    }
    
    // Log LIST action to CreditLedger (reservation) - positive amountDelta to reserve
    await this.logOwnershipChange({
      userId,
      tokenId,
      amountDelta: quantity, // Positive to reserve credits
      actionType: 'LIST',
      refTable: 'listings',
      refId: listingId,
      note: `Listing created: ${listingId}`
    });
  }

  async releaseReservation(userId: string, assetId: string, quantity: number, listingId: string): Promise<void> {
    const { rows } = await query(
      `SELECT ca.token_id FROM carbon_assets ca WHERE ca.asset_id = $1`,
      [assetId]
    );
    
    if (!rows.length) return;
    
    const tokenId = rows[0].token_id;
    
    // Log DELIST action to CreditLedger - negative amountDelta to release reservation
    await this.logOwnershipChange({
      userId,
      tokenId,
      amountDelta: -quantity, // Negative to release reservation
      actionType: 'DELIST',
      refTable: 'listings',
      refId: listingId,
      note: `Listing cancelled: ${listingId}`
    });
  }

  async executeSell(
    transferId: string, 
    sellerId: string, 
    assetId: string, 
    quantity: number, 
    operation: CreditTransferOperation
  ): Promise<CreditTransferOperation> {
    const { rows } = await query(
      `SELECT ca.token_id FROM carbon_assets ca WHERE ca.asset_id = $1`,
      [assetId]
    );
    
    if (!rows.length) {
      throw new TransferFailedError(this.custodyType, sellerId, assetId, quantity, 'LEDGER_SELL', 
        new Error('Asset not found'));
    }
    
    const tokenId = rows[0].token_id;
    
    // Verify seller has sufficient reserved balance
    const reserved = await this.getReservedBalance(sellerId, assetId);
    if (reserved < quantity) {
      throw new InsufficientBalanceError(this.custodyType, sellerId, assetId, quantity, reserved);
    }
    
    try {
      const result = await this.logOwnershipChange({
        userId: sellerId,
        tokenId,
        amountDelta: -quantity, // Negative: sell from reserved balance
        actionType: 'SELL',
        refTable: 'credit_transfer_operations',
        refId: operation.operationId,
        note: `Sell for transfer ${transferId}`
      });
      
      return {
        ...operation,
        blockchainTxHash: result.txHash,
        blockchainLogIndex: result.onchainLogIndex,
        chainId: this.config.chainId,
        contractAddress: this.config.contracts.creditLedger,
        status: 'CONFIRMED',
        confirmedAt: new Date()
      };
    } catch (error) {
      throw new TransferFailedError(this.custodyType, sellerId, assetId, quantity, 'LEDGER_SELL', error as Error);
    }
  }

  async executeBuy(
    transferId: string, 
    buyerId: string, 
    assetId: string, 
    quantity: number, 
    operation: CreditTransferOperation
  ): Promise<CreditTransferOperation> {
    const { rows } = await query(
      `SELECT ca.token_id FROM carbon_assets ca WHERE ca.asset_id = $1`,
      [assetId]
    );
    
    if (!rows.length) {
      throw new TransferFailedError(this.custodyType, buyerId, assetId, quantity, 'LEDGER_BUY', 
        new Error('Asset not found'));
    }
    
    const tokenId = rows[0].token_id;
    
    try {
      const result = await this.logOwnershipChange({
        userId: buyerId,
        tokenId,
        amountDelta: quantity, // Positive: credit to available balance
        actionType: 'BUY',
        refTable: 'credit_transfer_operations',
        refId: operation.operationId,
        note: `Buy for transfer ${transferId}`
      });
      
      return {
        ...operation,
        blockchainTxHash: result.txHash,
        blockchainLogIndex: result.onchainLogIndex,
        chainId: this.config.chainId,
        contractAddress: this.config.contracts.creditLedger,
        status: 'CONFIRMED',
        confirmedAt: new Date()
      };
    } catch (error) {
      throw new TransferFailedError(this.custodyType, buyerId, assetId, quantity, 'LEDGER_BUY', error as Error);
    }
  }

  async retireCredits(userId: string, assetId: string, quantity: number, retirementId: string): Promise<{ txHash: string; logIndex: number }> {
    const { rows } = await query(
      `SELECT clb.balance, ca.token_id
       FROM credit_ledger_balances clb
       JOIN carbon_assets ca ON ca.token_id = clb.token_id
       WHERE clb.user_id = $1 AND ca.asset_id = $2`,
      [userId, assetId]
    );
    
    if (!rows.length || Number(rows[0].balance) < quantity) {
      throw new InsufficientBalanceError(this.custodyType, userId, assetId, quantity, Number(rows[0]?.balance || 0));
    }
    
    const tokenId = rows[0].token_id;
    
    try {
      const userIdHash = await this.getOrCreateUserIdHash(userId);
      const refHash = this.computeRefHash(userIdHash, tokenId, -quantity, 'RETIRE', 'retirements', retirementId);
      
      const tx = await this.ledger.logRetirement(userIdHash, tokenId, quantity, refHash);
      const receipt = await tx.wait();
      
      if (receipt.status !== 1) {
        throw new Error(`logRetirement reverted: ${tx.hash}`);
      }
      
      // Update DB balances
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO credit_ledger_entries
             (onchain_log_id, user_id, user_id_hash, token_id, amount_delta, action_type,
              ref_hash, ref_table, ref_id, tx_hash, block_number, chain_status)
           VALUES ($1,$2,$3,$4,$5,'RETIRE',$6,$7,$8,$9,$10,'confirmed')`,
          [
            null, // will be filled from event
            userId, userIdHash, tokenId, -quantity,
            refHash, 'retirements', retirementId,
            tx.hash, receipt.blockNumber
          ]
        );
        
        await client.query(
          `INSERT INTO credit_ledger_balances (user_id, token_id, balance, total_retired)
           VALUES ($1, $2, 0, $3)
           ON CONFLICT (user_id, token_id)
           DO UPDATE SET
             balance = GREATEST(credit_ledger_balances.balance - $3, 0),
             total_retired = credit_ledger_balances.total_retired + $3,
             updated_at = NOW()`,
          [userId, tokenId, quantity]
        );
      });
      
      const logIndex = receipt.logs.findIndex(l => {
        try {
          const parsed = this.ledger.interface.parseLog(l);
          return parsed?.name === 'CreditRetiredLogged';
        } catch { return false; }
      });
      
      return { txHash: tx.hash, logIndex: Math.max(0, logIndex) };
    } catch (error) {
      throw new TransferFailedError(this.custodyType, userId, assetId, quantity, 'LEDGER_BUY', error as Error);
    }
  }

  async verifyBalance(userId: string, assetId: string): Promise<{ matches: boolean; onChain: number; db: number }> {
    const { rows: assetRows } = await query(
      `SELECT token_id FROM carbon_assets WHERE asset_id = $1`,
      [assetId]
    );
    
    if (!assetRows.length) return { matches: false, onChain: 0, db: 0 };
    
    const tokenId = assetRows[0].token_id;
    const userIdHash = await this.getOrCreateUserIdHash(userId);
    
    // Use new contract view functions
    const [onChainBalance, onChainReserved, onChainAvailable] = await Promise.all([
      this.ledger.getUserBalance(userIdHash, tokenId),
      this.ledger.getUserReserved(userIdHash, tokenId),
      this.ledger.getUserAvailable(userIdHash, tokenId),
    ]);
    
    const onChain = Number(onChainBalance);
    const onChainReservedNum = Number(onChainReserved);
    const onChainAvailableNum = Number(onChainAvailable);
    
    const { rows: dbRows } = await query(
      `SELECT balance FROM credit_ledger_balances WHERE user_id = $1 AND token_id = $2`,
      [userId, tokenId]
    );
    const db = dbRows[0] ? Number(dbRows[0].balance) : 0;
    
    // Check both total balance and available balance
    const balanceMatches = onChain === db;
    const availableMatches = onChainAvailableNum === (db - (await this.getReservedBalance(userId, assetId)));
    
    return { 
      matches: balanceMatches && availableMatches, 
      onChain, 
      db 
    };
  }

  async getAssetInfo(assetId: string): Promise<CarbonAsset | null> {
    const { rows } = await query(
      `SELECT ca.*, cb.token_id
       FROM carbon_assets ca
       JOIN credit_ledger_balances clb ON clb.token_id = cb.token_id
       WHERE ca.asset_id = $1
       LIMIT 1`,
      [assetId]
    );
    
    if (!rows.length) return null;
    
    const row = rows[0];
    return {
      assetId: row.asset_id,
      tokenId: row.token_id,
      projectId: row.project_id,
      registry: row.registry,
      vintage: row.vintage,
      methodology: row.methodology,
      serialNumber: row.serial_number,
      totalSupply: row.total_supply,
      retiredSupply: row.retired_supply,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // Private helper methods
  private async getLedgerBalance(userId: string, tokenId: number): Promise<number> {
    const { rows } = await query(
      'SELECT balance FROM credit_ledger_balances WHERE user_id = $1 AND token_id = $2',
      [userId, tokenId]
    );
    return rows[0] ? Number(rows[0].balance) : 0;
  }

  private async logOwnershipChange(params: {
    userId: string;
    tokenId: number;
    amountDelta: number;
    actionType: keyof typeof ACTION_TYPE;
    refTable: string | null;
    refId: string | null;
    note: string;
  }): Promise<{ txHash: string; onchainLogId: number; onchainLogIndex: number }> {
    const userIdHash = await this.getOrCreateUserIdHash(params.userId);
    const refHash = this.computeRefHash(
      userIdHash, 
      params.tokenId, 
      params.amountDelta, 
      params.actionType, 
      params.refTable, 
      params.refId
    );

    const tx = await this.ledger.logOwnershipChange(
      userIdHash, 
      params.tokenId, 
      params.amountDelta, 
      ACTION_TYPE[params.actionType], 
      refHash, 
      params.note
    );
    const receipt = await tx.wait();
    
    if (receipt.status !== 1) {
      throw new Error(`logOwnershipChange reverted: ${tx.hash}`);
    }

    let onchainLogId = 0;
    let onchainLogIndex = 0;
    
    for (let i = 0; i < receipt.logs.length; i++) {
      try {
        const parsed = this.ledger.interface.parseLog(receipt.logs[i]);
        if (parsed?.name === 'OwnershipLogged') {
          onchainLogId = Number(parsed.args.logId);
          onchainLogIndex = i;
          break;
        }
      } catch { continue; }
    }

    // Update DB
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO credit_ledger_entries
           (onchain_log_id, user_id, user_id_hash, token_id, amount_delta, action_type,
            ref_hash, ref_table, ref_id, note, tx_hash, block_number, chain_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'confirmed')`,
        [onchainLogId, params.userId, userIdHash, params.tokenId, params.amountDelta, params.actionType,
         refHash, params.refTable, params.refId, params.note, tx.hash, receipt.blockNumber]
      );

      if (params.amountDelta !== 0) {
        await client.query(
          `INSERT INTO credit_ledger_balances (user_id, token_id, balance)
           VALUES ($1, $2, GREATEST($3, 0))
           ON CONFLICT (user_id, token_id)
           DO UPDATE SET balance = GREATEST(credit_ledger_balances.balance + $3, 0), updated_at = NOW()`,
          [params.userId, params.tokenId, params.amountDelta]
        );
      }
    });

    return { txHash: tx.hash, onchainLogId, onchainLogIndex };
  }

  getLedgerContract(): ethers.Contract {
    return this.ledger;
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  getCustodyWalletAddress(): string {
    return this.custodyWallet.address;
  }
}