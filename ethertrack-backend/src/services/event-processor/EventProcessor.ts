// Event Processor - Processes blockchain events idempotently

import { ethers } from 'ethers';
import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import { CustodyAdapterFactory } from '../custody';
import { 
  BlockchainEvent, 
  BlockchainEventStatus,
  Listing,
  Trade,
  OwnershipPosition,
  CreditTransferOperation 
} from '../../domain/types';

export class EventProcessor {
  private provider: ethers.JsonRpcProvider;
  private marketplace: ethers.Contract;
  private token: ethers.Contract;
  private ledger: ethers.Contract;
  private chainId: number;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC);
    this.chainId = parseInt(process.env.CHAIN_ID || '80001');
    
    this.marketplace = new ethers.Contract(
      process.env.MARKETPLACE_ADDRESS!,
      [
        'event CreditListed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR)',
        'event CreditTraded(uint256 indexed tradeId, uint256 indexed listingId, uint256 indexed buyOrderId, address buyer, address seller, uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR, uint256 totalPrice, uint256 buyerFee, uint256 sellerFee, uint256 totalFee, bool isAMM)',
        'event ListingCancelled(uint256 indexed listingId, address indexed seller)',
        'event INRTradeLogged(bytes32 indexed tradeId, uint256 indexed tokenId, uint256 quantity, uint256 priceINR, uint8 payMode, address buyer, address seller, bytes32 tradeHash, uint256 timestamp)',
      ],
      this.provider
    );

    this.token = new ethers.Contract(
      process.env.CARBON_CREDIT_TOKEN_ADDRESS!,
      [
        'event CreditMinted(uint256 indexed tokenId, address indexed to, uint256 amount, string projectName, uint8 standard, string serialNumber)',
        'event CreditRetired(uint256 indexed tokenId, address indexed retiredBy, uint256 amount, string projectName)',
      ],
      this.provider
    );

    this.ledger = new ethers.Contract(
      process.env.CREDIT_LEDGER_ADDRESS!,
      [
        'event OwnershipLogged(uint256 indexed logId, bytes32 indexed userId, uint256 indexed tokenId, int256 amountDelta, uint8 actionType, bytes32 refHash)',
        'event CreditRetiredLogged(uint256 indexed logId, bytes32 indexed userId, uint256 tokenId, uint256 amount, bytes32 refHash)',
      ],
      this.provider
    );
  }

  async processEvent(event: BlockchainEvent): Promise<void> {
    // Check if already processed (idempotency)
    const { rows: existing } = await query(
      'SELECT 1 FROM blockchain_events WHERE chain_id = $1 AND contract_address = $2 AND tx_hash = $3 AND log_index = $4',
      [event.chainId, event.contractAddress.toLowerCase(), event.txHash, event.logIndex]
    );

    if (existing.length) {
      await query(
        `UPDATE blockchain_events SET processing_status = 'DUPLICATE', processed_at = NOW() 
         WHERE chain_id = $1 AND contract_address = $2 AND tx_hash = $3 AND log_index = $4`,
        [event.chainId, event.contractAddress.toLowerCase(), event.txHash, event.logIndex]
      );
      return;
    }

    try {
      await this.handleEvent(event);
      
      await query(
        `UPDATE blockchain_events SET processing_status = 'PROCESSED', processed_at = NOW() 
         WHERE chain_id = $1 AND contract_address = $2 AND tx_hash = $3 AND log_index = $4`,
        [event.chainId, event.contractAddress.toLowerCase(), event.txHash, event.logIndex]
      );
    } catch (error) {
      await query(
        `UPDATE blockchain_events SET processing_status = 'FAILED', error_message = $1, processed_at = NOW() 
         WHERE chain_id = $2 AND contract_address = $3 AND tx_hash = $4 AND log_index = $5`,
        [error instanceof Error ? error.message : 'Unknown error', event.chainId, event.contractAddress.toLowerCase(), event.txHash, event.logIndex]
      );
      throw error;
    }
  }

  private async handleEvent(event: BlockchainEvent): Promise<void> {
    const contractAddr = event.contractAddress.toLowerCase();
    const marketplaceAddr = process.env.MARKETPLACE_ADDRESS!.toLowerCase();
    const tokenAddr = process.env.CARBON_CREDIT_TOKEN_ADDRESS!.toLowerCase();
    const ledgerAddr = process.env.CREDIT_LEDGER_ADDRESS!.toLowerCase();

    if (contractAddr === marketplaceAddr) {
      await this.handleMarketplaceEvent(event);
    } else if (contractAddr === tokenAddr) {
      await this.handleTokenEvent(event);
    } else if (contractAddr === ledgerAddr) {
      await this.handleLedgerEvent(event);
    }
  }

  private async handleMarketplaceEvent(event: BlockchainEvent): Promise<void> {
    switch (event.eventName) {
      case 'CreditListed':
        await this.handleCreditListed(event);
        break;
      case 'CreditTraded':
        await this.handleCreditTraded(event);
        break;
      case 'ListingCancelled':
        await this.handleListingCancelled(event);
        break;
      case 'INRTradeLogged':
        await this.handleINRTradeLogged(event);
        break;
    }
  }

  private async handleCreditListed(event: BlockchainEvent): Promise<void> {
    const { listingId, seller, tokenId, amount, pricePerUnit, pricePerUnitINR } = event.decodedArgs;
    
    await withTransaction(async (client) => {
      // Find carbon_asset and ownership_position
      const { rows: assetRows } = await client.query(
        `SELECT ca.asset_id, op.position_id, op.owner_id
         FROM carbon_assets ca
         JOIN ownership_positions op ON op.asset_id = ca.asset_id AND op.owner_id = (
           SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1)
         )
         WHERE ca.token_id = $2 AND op.custody_type = 'onchain'
         LIMIT 1`,
        [seller, Number(tokenId)]
      );

      if (!assetRows.length) {
        console.warn(`No matching position for CreditListed: seller=${seller}, tokenId=${tokenId}`);
        return;
      }

      const asset = assetRows[0];
      const priceINR = Number(pricePerUnitINR);
      const qty = Number(amount);

      // Update listing with on-chain data
      await client.query(
        `UPDATE listings 
         SET onchain_listing_id = $1, price_per_unit = $2, price_per_unit_inr = $3,
             remaining_quantity = $4, updated_at = NOW()
         WHERE position_id = $5 AND status = 'active' AND onchain_listing_id IS NULL`,
        [Number(listingId), Number(pricePerUnit), priceINR, qty, asset.position_id]
      );

      // Update position reserved quantity (already reserved at listing creation, just sync)
      await client.query(
        `UPDATE ownership_positions 
         SET reserved_quantity = $1, updated_at = NOW()
         WHERE position_id = $2`,
        [qty, asset.position_id]
      );

      // Record registry transaction
      await client.query(
        `INSERT INTO registry_transactions (type, token_id, asset_id, listing_id, from_wallet, from_user_id, amount, price_eth, price_inr)
         VALUES ('LIST', $1, $2, $3, $4, $5, $6, $7, $8)`,
        [Number(tokenId), asset.asset_id, Number(listingId), seller, asset.owner_id, qty, 
         ethers.formatEther(pricePerUnit), priceINR]
      );
    });
  }

  private async handleCreditTraded(event: BlockchainEvent): Promise<void> {
    const { tradeId, listingId, buyOrderId, buyer, seller, tokenId, amount, pricePerUnit, pricePerUnitINR, totalPrice, buyerFee, sellerFee, totalFee, isAMM } = event.decodedArgs;
    
    await withTransaction(async (client) => {
      // Find trade in our DB
      const { rows: tradeRows } = await client.query(
        `SELECT t.*, l.asset_id, op_seller.position_id as seller_position_id, op_buyer.position_id as buyer_position_id
         FROM trades t
         LEFT JOIN listings l ON l.listing_id = t.listing_id
         LEFT JOIN ownership_positions op_seller ON op_seller.owner_id = t.seller_id AND op_seller.asset_id = l.asset_id AND op_seller.custody_type = 'onchain'
         LEFT JOIN ownership_positions op_buyer ON op_buyer.owner_id = t.buyer_id AND op_buyer.asset_id = l.asset_id AND op_buyer.custody_type = 'onchain'
         WHERE t.listing_id_onchain = $1 AND t.chain_status = 'pending'
         LIMIT 1`,
        [Number(listingId)]
      );

      if (!tradeRows.length) {
        // Try to find by tx_hash
        const { rows: byTx } = await client.query(
          `SELECT t.*, l.asset_id, op_seller.position_id as seller_position_id, op_buyer.position_id as buyer_position_id
           FROM trades t
           LEFT JOIN listings l ON l.listing_id = t.listing_id
           LEFT JOIN ownership_positions op_seller ON op_seller.owner_id = t.seller_id AND op_seller.asset_id = l.asset_id AND op_seller.custody_type = 'onchain'
           LEFT JOIN ownership_positions op_buyer ON op_buyer.owner_id = t.buyer_id AND op_buyer.asset_id = l.asset_id AND op_buyer.custody_type = 'onchain'
           WHERE t.tx_hash = $1 OR t.chain_tx_hash = $1
           LIMIT 1`,
        [event.txHash]
        );

        if (!byTx.length) {
          console.warn(`No matching trade for CreditTraded: listingId=${listingId}, txHash=${event.txHash}`);
          return;
        }
        tradeRows.push(byTx[0]);
      }

      const trade = tradeRows[0];
      const qty = Number(amount);
      const priceINR = Number(pricePerUnitINR);

      // Update trade with on-chain confirmation
      await client.query(
        `UPDATE trades 
         SET chain_status = 'confirmed', chain_tx_hash = $1, chain_block = $2, chain_log_index = $3, settled_at = NOW(), updated_at = NOW()
         WHERE trade_id = $4`,
        [event.txHash, event.blockNumber, event.logIndex, trade.trade_id]
      );

      // Update listing remaining quantity
      await client.query(
        `UPDATE listings 
         SET remaining_quantity = GREATEST(0, remaining_quantity - $1),
             status = CASE WHEN remaining_quantity - $1 = 0 THEN 'filled' ELSE 'active' END,
             updated_at = NOW()
         WHERE listing_id = $2`,
        [qty, trade.listing_id]
      );

      // Update seller position (release reservation, reduce owned)
      if (trade.seller_position_id) {
        await client.query(
          `UPDATE ownership_positions 
           SET owned_quantity = owned_quantity - $1,
               reserved_quantity = GREATEST(0, reserved_quantity - $1),
               updated_at = NOW()
           WHERE position_id = $2`,
          [qty, trade.seller_position_id]
        );
      }

      // Create/update buyer position
      if (trade.buyer_position_id) {
        await client.query(
          `UPDATE ownership_positions 
           SET owned_quantity = owned_quantity + $1, updated_at = NOW()
           WHERE position_id = $2`,
          [qty, trade.buyer_position_id]
        );
      } else if (trade.asset_id) {
        // Create new position for buyer
        await client.query(
          `INSERT INTO ownership_positions (position_id, owner_id, asset_id, custody_type, owned_quantity, reserved_quantity)
           VALUES ($1, $2, $3, 'onchain', $4, 0)
           ON CONFLICT (owner_id, asset_id, custody_type) DO UPDATE
           SET owned_quantity = ownership_positions.owned_quantity + $4, updated_at = NOW()`,
          [crypto.randomUUID(), trade.buyer_id, trade.asset_id, qty]
        );
      }

      // Record registry transaction
      await client.query(
        `INSERT INTO registry_transactions (
          type, token_id, asset_id, listing_id, trade_id, 
          from_wallet, to_wallet, from_user_id, to_user_id,
          amount, price_eth, price_inr, buyer_fee_eth, seller_fee_eth, total_fee_eth, total_price_eth,
          payment_mode, tx_hash
        ) VALUES ('TRADE', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          Number(tokenId), trade.asset_id, Number(listingId), trade.trade_id,
          seller, buyer, trade.seller_id, trade.buyer_id,
          qty, ethers.formatEther(pricePerUnit), priceINR,
          ethers.formatEther(buyerFee), ethers.formatEther(sellerFee), ethers.formatEther(totalFee),
          ethers.formatEther(totalPrice), isAMM ? 'amm' : 'eth', event.txHash
        ]
      );

      // Credit seller INR (for ETH trades, seller gets ~99.5% in INR)
      if (trade.seller_id && priceINR > 0) {
        const sellerGetsINR = Math.round(priceINR * qty * 0.995);
        if (sellerGetsINR > 0) {
          await client.query(`UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`, [sellerGetsINR, trade.seller_id]);
          await client.query(
            `INSERT INTO wallet_transactions (user_id, type, method, amount, status, notes, trade_type) 
             VALUES ($1, 'credit', 'eth', $2, 'success', $3, 'sell_credit')`,
            [trade.seller_id, sellerGetsINR, `Sale of ${qty} × Token #${Number(tokenId)} @ ₹${priceINR}/credit (ETH tradeId:${Number(tradeId)})`]
          );
        }
      }
    });
  }

  private async handleListingCancelled(event: BlockchainEvent): Promise<void> {
    const { listingId, seller } = event.decodedArgs;
    
    await withTransaction(async (client) => {
      // Find and cancel listing
      const { rows: listingRows } = await client.query(
        `SELECT l.*, op.position_id, op.reserved_quantity
         FROM listings l
         JOIN ownership_positions op ON op.position_id = l.position_id
         WHERE l.onchain_listing_id = $1 AND l.status = 'active'
         FOR UPDATE`,
        [Number(listingId)]
      );

      if (!listingRows.length) {
        console.warn(`No active listing found for cancellation: ${listingId}`);
        return;
      }

      const listing = listingRows[0];
      const releasedQty = Number(listing.remaining_quantity);

      // Cancel listing
      await client.query(
        `UPDATE listings SET status = 'cancelled', onchain_listing_id = NULL, updated_at = NOW() WHERE listing_id = $1`,
        [listing.listing_id]
      );

      // Release reservation
      await client.query(
        `UPDATE ownership_positions 
         SET reserved_quantity = GREATEST(0, reserved_quantity - $1), updated_at = NOW()
         WHERE position_id = $2`,
        [releasedQty, listing.position_id]
      );

      // Record registry transaction
      await client.query(
        `INSERT INTO registry_transactions (type, listing_id, from_wallet) VALUES ('DELIST', $1, $2)`,
        [Number(listingId), seller]
      );
    });
  }

  private async handleINRTradeLogged(event: BlockchainEvent): Promise<void> {
    const { tradeId, tokenId, quantity, priceINR, payMode, buyer, seller, tradeHash, timestamp } = event.decodedArgs;
    
    await withTransaction(async (client) => {
      // Find trade by tradeId hash
      const { rows: tradeRows } = await client.query(
        `SELECT t.*, l.asset_id FROM trades t
         LEFT JOIN listings l ON l.listing_id = t.listing_id
         WHERE t.chain_tx_hash = $1 OR encode(digest(t.trade_id::text, 'sha256'), 'hex') = $2`,
        [event.txHash, tradeHash.replace('0x', '')]
      );

      if (!tradeRows.length) {
        console.warn(`No matching trade for INRTradeLogged: tradeHash=${tradeHash}`);
        return;
      }

      const trade = tradeRows[0];
      const qty = Number(quantity);

      // Update trade confirmation
      await client.query(
        `UPDATE trades 
         SET chain_status = 'confirmed', chain_tx_hash = $1, chain_block = $2, chain_log_index = $3, settled_at = NOW(), updated_at = NOW()
         WHERE trade_id = $4`,
        [event.txHash, event.blockNumber, event.logIndex, trade.trade_id]
      );

      // Update listing
      await client.query(
        `UPDATE listings 
         SET remaining_quantity = GREATEST(0, remaining_quantity - $1),
             status = CASE WHEN remaining_quantity - $1 = 0 THEN 'filled' ELSE 'active' END,
             updated_at = NOW()
         WHERE listing_id = $2`,
        [qty, trade.listing_id]
      );

      // Update positions
      if (trade.seller_position_id) {
        await client.query(
          `UPDATE ownership_positions 
           SET owned_quantity = owned_quantity - $1, reserved_quantity = GREATEST(0, reserved_quantity - $1), updated_at = NOW()
           WHERE position_id = $2`,
          [qty, trade.seller_position_id]
        );
      }

      // Credit buyer
      if (trade.asset_id) {
        await client.query(
          `INSERT INTO ownership_positions (position_id, owner_id, asset_id, custody_type, owned_quantity, reserved_quantity)
           VALUES ($1, $2, $3, 'onchain', $4, 0)
           ON CONFLICT (owner_id, asset_id, custody_type) DO UPDATE
           SET owned_quantity = ownership_positions.owned_quantity + $4, updated_at = NOW()`,
          [crypto.randomUUID(), trade.buyer_id, trade.asset_id, qty]
        );
      }

      // Credit seller INR
      if (trade.seller_id && Number(priceINR) > 0) {
        const sellerGetsINR = Math.round(Number(priceINR) * qty * 0.995);
        if (sellerGetsINR > 0) {
          await client.query(`UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`, [sellerGetsINR, trade.seller_id]);
        }
      }
    });
  }

  private async handleTokenEvent(event: BlockchainEvent): Promise<void> {
    switch (event.eventName) {
      case 'CreditMinted':
        await this.handleCreditMinted(event);
        break;
      case 'CreditRetired':
        await this.handleCreditRetired(event);
        break;
    }
  }

  private async handleCreditMinted(event: BlockchainEvent): Promise<void> {
    const { tokenId, to, amount, projectName, standard, serialNumber } = event.decodedArgs;
    
    await query(
      `UPDATE carbon_batches 
       SET token_id = $1, status = 'tokenised', tokenised_at = NOW(), updated_at = NOW()
       WHERE registry_serial = $2 OR token_id = $3`,
      [Number(tokenId), serialNumber, Number(tokenId)]
    );
  }

  private async handleCreditRetired(event: BlockchainEvent): Promise<void> {
    const { tokenId, retiredBy, amount, projectName } = event.decodedArgs;
    const qty = Number(amount);
    
    await withTransaction(async (client) => {
      const { rows: batchRows } = await client.query(
        `SELECT cb.id, cb.asset_id, op.position_id 
         FROM carbon_batches cb
         LEFT JOIN ownership_positions op ON op.asset_id = cb.asset_id AND op.owner_id = (
           SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1)
         ) AND op.custody_type = 'onchain'
         WHERE cb.token_id = $2`,
        [retiredBy, Number(tokenId)]
      );

      if (batchRows.length) {
        const batch = batchRows[0];
        
        await client.query(
          `UPDATE carbon_batches SET retired_credits = retired_credits + $1, available_credits = GREATEST(0, available_credits - $1), updated_at = NOW() WHERE id = $2`,
          [qty, batch.id]
        );

        if (batch.position_id) {
          await client.query(
            `UPDATE ownership_positions SET owned_quantity = owned_quantity - $1, updated_at = NOW() WHERE position_id = $2`,
            [qty, batch.position_id]
          );
        }
      }
    });
  }

  private async handleLedgerEvent(event: BlockchainEvent): Promise<void> {
    switch (event.eventName) {
      case 'OwnershipLogged':
        await this.handleOwnershipLogged(event);
        break;
      case 'CreditRetiredLogged':
        await this.handleCreditRetiredLogged(event);
        break;
    }
  }

  private async handleOwnershipLogged(event: BlockchainEvent): Promise<void> {
    const { logId, userId, tokenId, amountDelta, actionType, refHash } = event.decodedArgs;
    const delta = Number(amountDelta);
    
    await withTransaction(async (client) => {
      // Find user by userIdHash
      const { rows: userRows } = await client.query(
        'SELECT id FROM users WHERE user_id_hash = $1',
        [userId]
      );
      if (!userRows.length) return;
      const userId = userRows[0].id;

      // Find asset by tokenId
      const { rows: assetRows } = await client.query(
        'SELECT asset_id FROM carbon_assets WHERE token_id = $1',
        [Number(tokenId)]
      );
      if (!assetRows.length) return;
      const assetId = assetRows[0].asset_id;

      // Update ledger balance
      await client.query(
        `INSERT INTO credit_ledger_balances (user_id, token_id, balance)
         VALUES ($1, $2, GREATEST($3, 0))
         ON CONFLICT (user_id, token_id) DO UPDATE 
         SET balance = GREATEST(credit_ledger_balances.balance + $3, 0), updated_at = NOW()`,
        [userId, Number(tokenId), delta]
      );

      // Record ledger entry
      await client.query(
        `INSERT INTO credit_ledger_entries (
          onchain_log_id, user_id, user_id_hash, token_id, amount_delta, action_type,
          ref_hash, tx_hash, block_number, chain_status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed')
        ON CONFLICT DO NOTHING`,
        [Number(logId), userId, userId, Number(tokenId), delta, actionType, refHash, event.txHash, event.blockNumber]
      );
    });
  }

  private async handleCreditRetiredLogged(event: BlockchainEvent): Promise<void> {
    const { logId, userId, tokenId, amount, refHash } = event.decodedArgs;
    const qty = Number(amount);
    
    await withTransaction(async (client) => {
      const { rows: userRows } = await client.query(
        'SELECT id FROM users WHERE user_id_hash = $1',
        [userId]
      );
      if (!userRows.length) return;
      const dbUserId = userRows[0].id;

      await client.query(
        `INSERT INTO credit_ledger_balances (user_id, token_id, balance, total_retired)
         VALUES ($1, $2, 0, $3)
         ON CONFLICT (user_id, token_id) DO UPDATE
         SET balance = GREATEST(credit_ledger_balances.balance - $3, 0),
             total_retired = credit_ledger_balances.total_retired + $3,
             updated_at = NOW()`,
        [dbUserId, Number(tokenId), qty]
      );

      await client.query(
        `INSERT INTO credit_ledger_entries (
          onchain_log_id, user_id, user_id_hash, token_id, amount_delta, action_type,
          ref_hash, tx_hash, block_number, chain_status
        ) VALUES ($1,$2,$3,$4,$5,'RETIRE',$6,$7,$8,'confirmed')
        ON CONFLICT DO NOTHING`,
        [Number(logId), dbUserId, userId, Number(tokenId), -qty, refHash, event.txHash, event.blockNumber]
      );
    });
  }

  // Batch processing for historical sync
  async processBlockRange(fromBlock: number, toBlock: number): Promise<{ processed: number; failed: number }> {
    let processed = 0;
    let failed = 0;

    const contracts = [
      { contract: this.marketplace, name: 'Marketplace' },
      { contract: this.token, name: 'CarbonCreditToken' },
      { contract: this.ledger, name: 'CreditLedger' }
    ];

    for (const { contract } of contracts) {
      try {
        const events = await contract.queryFilter(contract.filters, fromBlock, toBlock);
        for (const ev of events) {
          const block = await this.provider.getBlock(ev.blockNumber);
          const event: BlockchainEvent = {
            eventId: crypto.randomUUID(),
            chainId: this.chainId,
            contractAddress: contract.target as string,
            txHash: ev.transactionHash,
            logIndex: ev.index,
            blockNumber: ev.blockNumber,
            eventName: ev.fragment?.name || 'Unknown',
            decodedArgs: ev.args ? Object.fromEntries(ev.args) : {},
            processedAt: null,
            processingStatus: 'PENDING',
            errorMessage: null,
            idempotencyKey: `${this.chainId}:${contract.target}:${ev.transactionHash}:${ev.index}`,
            createdAt: new Date(block.timestamp * 1000)
          };

          try {
            await this.processEvent(event);
            processed++;
          } catch (e) {
            failed++;
            console.error(`Failed to process ${event.eventName}:`, e);
          }
        }
      } catch (e) {
        console.error(`Error querying ${contract.name} events:`, e);
      }
    }

    return { processed, failed };
  }
}

import crypto from 'crypto';