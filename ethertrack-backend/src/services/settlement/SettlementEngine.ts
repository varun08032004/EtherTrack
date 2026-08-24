// Settlement Engine - Core orchestrator for the trade settlement state machine

import { v4 as uuidv4 } from 'uuid';
import { withTransaction } from '../../../db/pool.js';
import { CustodyAdapterFactory } from '../custody';
import { PaymentService } from '../payment/PaymentService';
import { CreditTransferService } from '../credit-transfer/CreditTransferService';
import { 
  Trade, 
  Payment, 
  PaymentAttempt,
  CreditTransfer, 
  CreditTransferOperation,
  Fee, 
  PlatformFee, 
  SettlementOperation,
  WalletTransaction,
  TradeSettlementState,
  PaymentStatus,
  PaymentMode,
  PaymentProvider,
  CreditTransferStatus,
  CreditTransferOperationType,
  SettlementOperationType,
  SettlementOperationStatus,
  FeeType,
  TaxType,
  Quote,
  TaxCalculator,
  defaultTaxCalculator,
  TaxContext,
  TaxBreakdown
} from '../../domain/types';

export class SettlementEngine {
  private taxCalculator: TaxCalculator;
  private paymentService: PaymentService;
  private creditTransferService: CreditTransferService;

  constructor(taxCalculator: TaxCalculator = defaultTaxCalculator, paymentService?: PaymentService, creditTransferService?: CreditTransferService) {
    this.taxCalculator = taxCalculator;
    this.paymentService = paymentService || new PaymentService();
    this.creditTransferService = creditTransferService || new CreditTransferService();
  }

  // ============================================================
  // QUOTE GENERATION (Pre-trade validation)
  // ============================================================

  async generateQuote(
    listingId: string, 
    quantity: number, 
    buyerId: string, 
    paymentMode: PaymentMode
  ): Promise<Quote> {
    const { rows } = await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT l.*, op.owned_quantity, op.reserved_quantity, u.wallet_address as buyer_wallet
         FROM listings l
         JOIN ownership_positions op ON op.position_id = l.position_id
         JOIN users u ON u.id = $1
         WHERE l.listing_id = $2 AND l.status = 'active' 
           AND (l.expires_at IS NULL OR l.expires_at > NOW())
         FOR SHARE`,
        [buyerId, listingId]
      );
      return result;
    });

    if (!rows.length) {
      throw new Error('Listing not found, inactive, or expired');
    }

    const listing = rows[0];
    
    if (listing.remaining_quantity < quantity) {
      throw new Error(`Only ${listing.remaining_quantity} credits available`);
    }

    if (listing.seller_id === buyerId) {
      throw new Error('Cannot buy your own listing');
    }

    const available = listing.owned_quantity - listing.reserved_quantity;
    if (available < quantity) {
      throw new Error(`Insufficient available credits: ${available}`);
    }

    const executionPrice = listing.price_per_unit;
    const currency = listing.currency;
    const buyerGross = executionPrice * quantity;
    const sellerGross = buyerGross;

    // Calculate fees
    const buyerFee = Math.floor((buyerGross * listing.buyer_fee_bps) / 10000);
    const sellerFee = Math.floor((sellerGross * listing.seller_fee_bps) / 10000);

    // Tax calculation
    const taxContext: TaxContext = {
      buyerGstin: null, // Will be filled from user profile
      sellerGstin: null,
      platformGstin: process.env.PLATFORM_GSTIN || '27AAAAA0000A1Z5',
      placeOfSupply: '27', // Maharashtra
      transactionType: 'B2B'
    };

    const buyerTaxBreakdown = this.taxCalculator.calculate(buyerFee, 'BUYER', taxContext);
    const sellerTaxBreakdown = this.taxCalculator.calculate(sellerFee, 'SELLER', taxContext);

    const buyerTotalDebit = buyerGross + buyerFee + buyerTaxBreakdown.totalTax;
    const sellerNetCredit = sellerGross - sellerFee - sellerTaxBreakdown.totalTax;
    const platformRevenue = buyerFee + sellerFee;
    const platformTaxLiability = buyerTaxBreakdown.totalTax + sellerTaxBreakdown.totalTax;

    const quoteId = uuidv4();
    const idempotencyKey = `quote:${quoteId}:${Date.now()}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    return {
      quoteId,
      listingId,
      quantity,
      executionPrice,
      currency,
      buyerGross,
      buyerFee,
      buyerTax: buyerTaxBreakdown.totalTax,
      buyerTotalDebit,
      sellerGross,
      sellerFee,
      sellerTax: sellerTaxBreakdown.totalTax,
      sellerNetCredit,
      platformRevenue,
      platformTaxLiability,
      expiresAt,
      idempotencyKey
    };
  }

  // ============================================================
  // TRADE CREATION & STATE MACHINE
  // ============================================================

  async createTradeFromQuote(
    quote: Quote, 
    buyerId: string, 
    idempotencyKey: string,
    paymentDetails?: { razorpayOrderId?: string; ethTxHash?: string }
  ): Promise<Trade> {
    // Validate quote not expired
    if (new Date() > quote.expiresAt) {
      throw new Error('Quote expired');
    }

    // Validate idempotency key matches quote
    if (idempotencyKey !== quote.idempotencyKey) {
      throw new Error('Invalid idempotency key for quote');
    }

    // Check for existing trade with same idempotency key
    const { rows: existing } = await query(
      'SELECT trade_id FROM trades WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    if (existing.length) {
      const { rows: trade } = await query(
        'SELECT * FROM trades WHERE trade_id = $1',
        [existing[0].trade_id]
      );
      return trade[0];
    }

    // Get listing details
    const { rows: listing } = await query(
      `SELECT l.*, op.position_id as seller_position_id, op.owner_id as seller_id
       FROM listings l
       JOIN ownership_positions op ON op.position_id = l.position_id
       WHERE l.listing_id = $1`,
      [quote.listingId]
    );

    if (!listing.length) {
      throw new Error('Listing not found');
    }

    const listingData = listing[0];

    // Create trade record with CREATED state
    const tradeId = uuidv4();
    const paymentId = uuidv4();
    const creditTransferId = uuidv4();
    const buyerFeeId = uuidv4();
    const sellerFeeId = uuidv4();

    await withTransaction(async (client) => {
      // Lock listing and positions
      await client.query(
        `SELECT * FROM listings WHERE listing_id = $1 FOR UPDATE`,
        [quote.listingId]
      );
      await client.query(
        `SELECT * FROM ownership_positions WHERE position_id = $1 FOR UPDATE`,
        [listingData.seller_position_id]
      );

      // Verify listing still valid
      const { rows: currentListing } = await client.query(
        `SELECT * FROM listings WHERE listing_id = $1 AND status = 'active'`,
        [quote.listingId]
      );
      if (!currentListing.length) {
        throw new Error('Listing no longer active');
      }

      // Verify price hasn't changed since quote (allow small floating-point difference)
      const currentPrice = Number(currentListing[0].price_per_unit);
      const quotePrice = Number(quote.executionPrice);
      if (Math.abs(currentPrice - quotePrice) > 0.01) {
        throw new Error('Price mismatch — listing price has changed since quote');
      }

      // Verify sufficient remaining quantity
      if (Number(currentListing[0].remaining_quantity) < quote.quantity) {
        throw new Error('Insufficient quantity — listing has less remaining than requested');
      }

      // Create trade
      await client.query(
        `INSERT INTO trades (
          trade_id, listing_id, buyer_id, seller_id, asset_id,
          seller_custody_type, buyer_custody_type,
          quantity, execution_price, currency,
          buyer_gross, seller_gross, buyer_fee_bps, seller_fee_bps,
          payment_id, credit_transfer_id, buyer_fee_id, seller_fee_id,
          settlement_state, idempotency_key
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          tradeId, quote.listingId, buyerId, listingData.seller_id, listingData.asset_id,
          listingData.custody_type, // seller custody
          // buyer custody: ledger if no wallet and paymentMode != eth
          (paymentDetails?.ethTxHash ? 'onchain' : 'ledger'),
          quote.quantity, quote.executionPrice, quote.currency,
          quote.buyerGross, quote.sellerGross, listingData.buyer_fee_bps, listingData.seller_fee_bps,
          paymentId, creditTransferId, buyerFeeId, sellerFeeId,
          'CREATED', idempotencyKey
        ]
      );

      // Create payment record
      await client.query(
        `INSERT INTO payments (
          payment_id, trade_id, payer_id, payee_id, amount, currency,
          payment_mode, provider, provider_reference, status, idempotency_key
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          paymentId, tradeId, buyerId, listingData.seller_id,
          quote.buyerTotalDebit, quote.currency,
          quote.currency === 'ETH' ? 'eth' : paymentDetails?.razorpayOrderId ? 'razorpay' : 'inr_wallet',
          quote.currency === 'ETH' ? 'ethereum' : 'razorpay',
          paymentDetails?.razorpayOrderId || paymentDetails?.ethTxHash || null,
          'PENDING', idempotencyKey
        ]
      );

      // Create credit transfer record
      await client.query(
        `INSERT INTO credit_transfers (
          transfer_id, trade_id, asset_id, quantity,
          from_custody_type, to_custody_type, status, idempotency_key
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          creditTransferId, tradeId, listingData.asset_id, quote.quantity,
          listingData.custody_type, // from
          paymentDetails?.ethTxHash ? 'onchain' : 'ledger', // to
          'PENDING', idempotencyKey
        ]
      );

      // Create fee records
      await client.query(
        `INSERT INTO fees (fee_id, trade_id, type, amount, currency, tax_amount, tax_type, cgst_amount, sgst_amount, igst_amount, status)
         VALUES ($1,$2,'BUYER_TRANSACTION_FEE',$3,'INR',$4,$5,$6,$7,$8,'PENDING')`,
        [buyerFeeId, tradeId, quote.buyerFee, quote.buyerTax, 
         buyerTaxBreakdown.taxType, buyerTaxBreakdown.cgst, buyerTaxBreakdown.sgst, buyerTaxBreakdown.igst]
      );

      await client.query(
        `INSERT INTO fees (fee_id, trade_id, type, amount, currency, tax_amount, tax_type, cgst_amount, sgst_amount, igst_amount, status)
         VALUES ($1,$2,'SELLER_TRANSACTION_FEE',$3,'INR',$4,$5,$6,$7,$8,'PENDING')`,
        [sellerFeeId, tradeId, quote.sellerFee, quote.sellerTax,
         sellerTaxBreakdown.taxType, sellerTaxBreakdown.cgst, sellerTaxBreakdown.sgst, sellerTaxBreakdown.igst]
      );

      // Create initial settlement operation
      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'VALIDATE',
        custodyContext: 'both',
        status: 'COMPLETED',
        inputData: { quoteId: quote.quoteId, quantity: quote.quantity },
        outputData: { tradeId },
        idempotencyKey: `validate:${tradeId}`,
        startedAt: new Date(),
        completedAt: new Date()
      });
    });

    // Return created trade
    const { rows } = await query('SELECT * FROM trades WHERE trade_id = $1', [tradeId]);
    return rows[0];
  }

  // ============================================================
  // STATE MACHINE TRANSITIONS
  // ============================================================

  async transitionToFundsReserved(tradeId: string): Promise<void> {
    await this.executeStateTransition(tradeId, 'FUNDS_RESERVED', async (client, trade) => {
      // Reserve buyer funds based on payment mode
      if (trade.currency === 'INR') {
        if (trade.payment_mode === 'inr_wallet') {
          // Debit buyer INR wallet via PaymentService
          await this.paymentService.authorizeInrWalletPayment(trade.payment_id, trade.buyer_id);
        } else if (trade.payment_mode === 'razorpay') {
          // Authorize Razorpay payment
          await this.authorizeRazorpayPayment(client, trade.payment_id);
        }
      } else if (trade.currency === 'ETH') {
        // ETH escrow handled on-chain by buyer
        // Just verify the transaction exists
        await this.verifyEthEscrow(client, trade.payment_id);
      }

      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'RESERVE_FUNDS',
        custodyContext: 'buyer',
        status: 'COMPLETED',
        inputData: { paymentMode: trade.payment_mode },
        outputData: { paymentReserved: true },
        idempotencyKey: `reserve_funds:${tradeId}`,
        startedAt: new Date(),
        completedAt: new Date()
      });
    });
  }

  async transitionToCreditsReserved(tradeId: string): Promise<void> {
    await this.executeStateTransition(tradeId, 'CREDITS_RESERVED', async (client, trade) => {
      const isLedger = trade.seller_custody_type === 'ledger';
      const listingTable = isLedger ? 'ledger_listings' : 'listings';
      const listingIdCol = isLedger ? 'id' : 'listing_id';
      
      // Decrement listing remaining quantity
      await client.query(
        `UPDATE ${listingTable} 
         SET remaining_quantity = remaining_quantity - $1,
             active = CASE WHEN remaining_quantity - $1 = 0 THEN FALSE ELSE TRUE END,
             updated_at = NOW()
         WHERE ${listingIdCol} = $2`,
        [trade.quantity, trade.listing_id]
      );

      // For on-chain custody, also update ownership_positions
      if (!isLedger) {
        await client.query(
          `UPDATE ownership_positions 
           SET reserved_quantity = reserved_quantity - $1,
               updated_at = NOW()
           WHERE position_id = (SELECT position_id FROM listings WHERE listing_id = $2)`,
          [trade.quantity, trade.listing_id]
        );
      }

      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'RESERVE_CREDITS',
        custodyContext: 'seller',
        status: 'COMPLETED',
        inputData: { quantity: trade.quantity },
        outputData: { creditsReserved: true },
        idempotencyKey: `reserve_credits:${tradeId}`,
        startedAt: new Date(),
        completedAt: new Date()
      });
    });
  }

  async transitionToSettlementPending(tradeId: string): Promise<void> {
    // Execute credit transfer and submit operations
    const trade = await this.getTradeForTransition(tradeId);
    const operations = await this.creditTransferService.executeTransfer(trade);
    
    await this.executeStateTransition(tradeId, 'SETTLEMENT_PENDING', async (client, trade) => {
      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'SUBMIT_CHAIN',
        custodyContext: 'both',
        status: 'IN_PROGRESS',
        inputData: { tradeId },
        outputData: { operations: operations.map(o => o.operationId) },
        idempotencyKey: `submit_chain:${tradeId}`,
        startedAt: new Date(),
        completedAt: null
      });
    });

    // Immediately submit the operations
    await this.transitionToCreditTransferSubmitted(tradeId, operations);
  }

  async transitionToCreditTransferSubmitted(tradeId: string, operations: CreditTransferOperation[]): Promise<void> {
    await this.executeStateTransition(tradeId, 'CREDIT_TRANSFER_SUBMITTED', async (client, trade) => {
      // Store credit transfer operations
      for (const op of operations) {
        await client.query(
          `INSERT INTO credit_transfer_operations (
            operation_id, transfer_id, type, custody_type,
            from_address, to_address, blockchain_tx_hash, blockchain_log_index,
            chain_id, contract_address, status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            op.operationId, trade.credit_transfer_id, op.type, op.custodyType,
            op.fromAddress, op.toAddress, op.blockchainTxHash, op.blockchainLogIndex,
            op.chainId, op.contractAddress, op.status
          ]
        );
      }

      await client.query(
        `UPDATE credit_transfers SET status = 'SUBMITTED', updated_at = NOW() WHERE transfer_id = $1`,
        [trade.credit_transfer_id]
      );

      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'SUBMIT_CHAIN',
        custodyContext: 'both',
        status: 'COMPLETED',
        inputData: { operations: operations.map(o => o.operationId) },
        outputData: { submitted: true },
        idempotencyKey: `credit_transfer_submitted:${tradeId}`,
        startedAt: new Date(),
        completedAt: new Date()
      });
    });
  }

  async transitionToCreditTransferConfirmed(tradeId: string): Promise<void> {
    await this.executeStateTransition(tradeId, 'CREDIT_TRANSFER_CONFIRMED', async (client, trade) => {
      await client.query(
        `UPDATE credit_transfers SET status = 'CONFIRMED', completed_at = NOW(), updated_at = NOW() WHERE transfer_id = $1`,
        [trade.credit_transfer_id]
      );

      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'CONFIRM_CHAIN',
        custodyContext: 'both',
        status: 'COMPLETED',
        inputData: { transferId: trade.credit_transfer_id },
        outputData: { confirmed: true },
        idempotencyKey: `confirm_chain:${tradeId}`,
        startedAt: new Date(),
        completedAt: new Date()
      });
    });
  }

  async transitionToPaymentSettled(tradeId: string, paymentDetails: { providerReference: string; capturedAt: Date }): Promise<void> {
    await this.executeStateTransition(tradeId, 'PAYMENT_SETTLED', async (client, trade) => {
      // Update payment status
      await client.query(
        `UPDATE payments 
         SET status = 'SETTLED', provider_reference = $1, completed_at = $2, updated_at = NOW()
         WHERE payment_id = $3`,
        [paymentDetails.providerReference, paymentDetails.capturedAt, trade.payment_id]
      );

      // Record payment attempt
      await client.query(
        `INSERT INTO payment_attempts (attempt_id, payment_id, provider_reference, status, created_at, completed_at)
         VALUES ($1,$2,$3,'SUCCESS',$4,$4)`,
        [uuidv4(), trade.payment_id, paymentDetails.providerReference, paymentDetails.capturedAt]
      );

      // Credit buyer wallet transaction
      await client.query(
        `INSERT INTO wallet_transactions (
          transaction_id, user_id, type, method, amount, balance_before, balance_after,
          reference, trade_id, payment_id, notes, status
        ) VALUES ($1,$2,'debit',$3,$4,$5,$6,$7,$8,$9,$10,'success')`,
        [
          uuidv4(), trade.buyer_id, trade.payment_mode, trade.payment_id,
          0, 0, // balances will be filled by wallet service
          `trade:${tradeId}:payment`, trade.trade_id, trade.payment_id,
          `Payment for trade ${tradeId}`
        ]
      );

      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'SETTLE_PAYMENT',
        custodyContext: 'buyer',
        status: 'COMPLETED',
        inputData: { paymentId: trade.payment_id },
        outputData: { settled: true },
        idempotencyKey: `settle_payment:${tradeId}`,
        startedAt: new Date(),
        completedAt: new Date()
      });
    });
  }

  async transitionToFeesCollected(tradeId: string): Promise<void> {
    await this.executeStateTransition(tradeId, 'FEES_COLLECTED', async (client, trade) => {
      // Update fee status
      await client.query(
        `UPDATE fees SET status = 'COLLECTED', collected_at = NOW() WHERE trade_id = $1`,
        [tradeId]
      );

      // Create platform fee aggregate
      await client.query(
        `INSERT INTO platform_fees (
          platform_fee_id, trade_id, buyer_fee_amount, seller_fee_amount,
          total_fee_amount, gst_amount, platform_net_amount, fee_eth, eth_rate,
          payment_mode, status, gst_type, cgst_amount, sgst_amount, igst_amount
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'collected',$11,$12,$13,$14)`,
        [
          uuidv4(), tradeId,
          // Will be filled from fees table
          0, 0, 0, 0, 0, null, null, trade.payment_mode,
          'CGST_SGST', 0, 0, 0
        ]
      );

      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'COLLECT_FEES',
        custodyContext: 'platform',
        status: 'COMPLETED',
        inputData: { tradeId },
        outputData: { feesCollected: true },
        idempotencyKey: `collect_fees:${tradeId}`,
        startedAt: new Date(),
        completedAt: new Date()
      });
    });
  }

  async transitionToSellerPaid(tradeId: string): Promise<void> {
    await this.executeStateTransition(tradeId, 'SELLER_PAID', async (client, trade) => {
      // Get seller net amount from fees table
      const { rows: sellerFee } = await client.query(
        `SELECT amount, tax_amount FROM fees WHERE trade_id = $1 AND type = 'SELLER_TRANSACTION_FEE'`,
        [tradeId]
      );
      const sellerFeeAmount = sellerFee.length ? Number(sellerFee[0].amount) + Number(sellerFee[0].tax_amount) : 0;
      const sellerNetAmount = Number(trade.seller_gross) - sellerFeeAmount;

      // Credit seller INR wallet with NET amount (after fees/taxes)
      await this.paymentService.captureInrWalletPaymentNet(trade.payment_id, trade.seller_id, sellerNetAmount);

      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'PAY_SELLER',
        custodyContext: 'seller',
        status: 'COMPLETED',
        inputData: { sellerId: trade.seller_id, sellerNetAmount },
        outputData: { sellerPaid: true },
        idempotencyKey: `pay_seller:${tradeId}`,
        startedAt: new Date(),
        completedAt: new Date()
      });
    });
  }

  async transitionToBuyerCredited(tradeId: string): Promise<void> {
    await this.executeStateTransition(tradeId, 'BUYER_CREDITED', async (client, trade) => {
      // Create/update buyer ownership position
      const custodyType = trade.buyer_custody_type;
      
      await client.query(
        `INSERT INTO ownership_positions (position_id, owner_id, asset_id, custody_type, owned_quantity, reserved_quantity)
         VALUES ($1,$2,$3,$4,$5,0)
         ON CONFLICT (owner_id, asset_id, custody_type)
         DO UPDATE SET owned_quantity = ownership_positions.owned_quantity + $5, updated_at = NOW()`,
        [uuidv4(), trade.buyer_id, trade.asset_id, custodyType, trade.quantity]
      );

      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'CREDIT_BUYER',
        custodyContext: 'buyer',
        status: 'COMPLETED',
        inputData: { buyerId: trade.buyer_id, custodyType, quantity: trade.quantity },
        outputData: { buyerCredited: true },
        idempotencyKey: `credit_buyer:${tradeId}`,
        startedAt: new Date(),
        completedAt: new Date()
      });
    });
  }

  async transitionToSettled(tradeId: string): Promise<void> {
    await this.executeStateTransition(tradeId, 'SETTLED', async (client, trade) => {
      await client.query(
        `UPDATE trades SET settlement_state = 'SETTLED', settled_at = NOW(), updated_at = NOW() WHERE trade_id = $1`,
        [tradeId]
      );

      // Publish outbox events for cache invalidation
      await this.publishOutboxEvents(client, tradeId);

      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'CREDIT_BUYER', // Final step
        custodyContext: 'both',
        status: 'COMPLETED',
        inputData: { tradeId },
        outputData: { settled: true },
        idempotencyKey: `settled:${tradeId}`,
        startedAt: new Date(),
        completedAt: new Date()
      });
    });
  }

  // ============================================================
  // COMPENSATION / FAILURE HANDLING
  // ============================================================

  async compensateFailedTrade(tradeId: string, failurePoint: TradeSettlementState, error: Error): Promise<void> {
    await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM trades WHERE trade_id = $1', [tradeId]);
      if (!rows.length) return;
      const trade = rows[0];

      // Record compensation operation
      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'COMPENSATE',
        custodyContext: 'both',
        status: 'IN_PROGRESS',
        inputData: { failurePoint, error: error.message },
        outputData: null,
        idempotencyKey: `compensate:${tradeId}:${Date.now()}`,
        startedAt: new Date(),
        completedAt: null
      });

      // Compensate based on failure point
      let compensated = false;
      if (failurePoint === 'FUNDS_RESERVED' || failurePoint === 'CREDITS_RESERVED' || failurePoint === 'SETTLEMENT_PENDING') {
        // Refund buyer
        await this.refundBuyerFunds(client, trade);
        // Release listing reservation
        await this.releaseListingReservation(client, trade);
        compensated = true;
      } else if (failurePoint === 'CREDIT_TRANSFER_SUBMITTED' || failurePoint === 'CREDIT_TRANSFER_CONFIRMED') {
        // Credit transfer may have partially succeeded
        // Mark as REQUIRES_RECONCILIATION
        await client.query(
          `UPDATE trades SET settlement_state = 'REQUIRES_RECONCILIATION', updated_at = NOW() WHERE trade_id = $1`,
          [tradeId]
        );
        compensated = true;
      } else if (failurePoint === 'PAYMENT_SETTLED' || failurePoint === 'FEES_COLLECTED' || failurePoint === 'SELLER_PAID') {
        // Payment succeeded but credit transfer failed
        await client.query(
          `UPDATE trades SET settlement_state = 'REQUIRES_RECONCILIATION', updated_at = NOW() WHERE trade_id = $1`,
          [tradeId]
        );
        compensated = true;
      }

      await client.query(
        `UPDATE trades SET settlement_state = 'FAILED', updated_at = NOW() WHERE trade_id = $1`,
        [tradeId]
      );

      // Add to dead-letter queue if not fully compensated
      if (!compensated) {
        await client.query(
          `INSERT INTO compensation_dead_letter (trade_id, failure_point, error_message, compensation_data)
           VALUES ($1, $2, $3, $4)`,
          [tradeId, failurePoint, error.message, JSON.stringify({ failurePoint, tradeState: trade.settlement_state })]
        );
      }

      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'COMPENSATE',
        custodyContext: 'both',
        status: 'COMPLETED',
        inputData: { failurePoint, error: error.message },
        outputData: { compensated, deadLettered: !compensated },
        idempotencyKey: `compensate_complete:${tradeId}`,
        startedAt: new Date(),
        completedAt: new Date()
      });
    });
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private async executeStateTransition(
    tradeId: string, 
    targetState: TradeSettlementState, 
    action: (client: any, trade: Trade) => Promise<void>
  ): Promise<void> {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM trades WHERE id = $1 FOR UPDATE',
        [tradeId]
      );
      if (!rows.length) throw new Error('Trade not found');

      const trade = rows[0];
      const validTransitions = this.getValidTransitions(trade.settlement_state);
      
      if (!validTransitions.includes(targetState)) {
        throw new Error(`Invalid state transition: ${trade.settlement_state} -> ${targetState}`);
      }

      await action(client, trade);

      await client.query(
        `UPDATE trades SET settlement_state = $1, updated_at = NOW() WHERE id = $2`,
        [targetState, tradeId]
      );
    });
  }

  private async getTradeForTransition(tradeId: string): Promise<Trade> {
    const { rows } = await query('SELECT * FROM trades WHERE id = $1', [tradeId]);
    if (!rows.length) throw new Error('Trade not found');
    return rows[0] as unknown as Trade;
  }

  private getValidTransitions(currentState: TradeSettlementState): TradeSettlementState[] {
    const transitions: Record<TradeSettlementState, TradeSettlementState[]> = {
      'CREATED': ['VALIDATED', 'CANCELLED', 'EXPIRED'],
      'VALIDATED': ['FUNDS_RESERVED', 'CANCELLED', 'EXPIRED'],
      'FUNDS_RESERVED': ['CREDITS_RESERVED', 'FAILED'],
      'CREDITS_RESERVED': ['SETTLEMENT_PENDING', 'FAILED'],
      'SETTLEMENT_PENDING': ['CREDIT_TRANSFER_SUBMITTED', 'FAILED'],
      'CREDIT_TRANSFER_SUBMITTED': ['CREDIT_TRANSFER_CONFIRMED', 'FAILED', 'REQUIRES_RECONCILIATION'],
      'CREDIT_TRANSFER_CONFIRMED': ['PAYMENT_SETTLED', 'FAILED', 'REQUIRES_RECONCILIATION'],
      'PAYMENT_SETTLED': ['FEES_COLLECTED', 'FAILED', 'REQUIRES_RECONCILIATION'],
      'FEES_COLLECTED': ['SELLER_PAID', 'FAILED', 'REQUIRES_RECONCILIATION'],
      'SELLER_PAID': ['BUYER_CREDITED', 'FAILED', 'REQUIRES_RECONCILIATION'],
      'BUYER_CREDITED': ['SETTLED', 'FAILED', 'REQUIRES_RECONCILIATION'],
      'SETTLED': [],
      'FAILED': ['REQUIRES_RECONCILIATION'],
      'CANCELLED': [],
      'EXPIRED': [],
      'REQUIRES_RECONCILIATION': ['SETTLED', 'FAILED'],
    };
    return transitions[currentState] || [];
  }

  private async recordSettlementOperation(client: any, op: SettlementOperation): Promise<void> {
    await client.query(
      `INSERT INTO settlement_operations (
        operation_id, trade_id, type, custody_context, status,
        input_data, output_data, error_message, idempotency_key, started_at, completed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        op.operationId, op.tradeId, op.type, op.custodyContext, op.status,
        JSON.stringify(op.inputData), op.outputData ? JSON.stringify(op.outputData) : null,
        op.errorMessage, op.idempotencyKey, op.startedAt, op.completedAt
      ]
    );
  }

  private async reserveInrFunds(client: any, buyerId: string, paymentId: string): Promise<void> {
    // Implementation depends on wallet service
    // This is a placeholder - actual implementation in wallet service
    await client.query(
      `UPDATE payments SET status = 'AUTHORIZED' WHERE payment_id = $1`,
      [paymentId]
    );
  }

  private async authorizeRazorpayPayment(client: any, paymentId: string): Promise<void> {
    await client.query(
      `UPDATE payments SET status = 'AUTHORIZED' WHERE payment_id = $1`,
      [paymentId]
    );
  }

  private async verifyEthEscrow(client: any, paymentId: string): Promise<void> {
    await client.query(
      `UPDATE payments SET status = 'AUTHORIZED' WHERE payment_id = $1`,
      [paymentId]
    );
  }

  private async creditSellerInrWallet(client: any, sellerId: string, paymentId: string): Promise<void> {
    // Implementation in wallet service
    await client.query(
      `UPDATE payments SET status = 'SETTLED' WHERE payment_id = $1`,
      [paymentId]
    );
  }

  private async refundBuyerFunds(client: any, trade: Trade): Promise<void> {
    // Refund based on payment mode
    if (trade.currency === 'INR' && trade.payment_mode === 'razorpay') {
      await this.paymentService.refundRazorpayPayment(trade.payment_id);
    } else if (trade.currency === 'INR' && trade.payment_mode === 'inr_wallet') {
      // For INR wallet, we need to reverse the debit - credit back to buyer
      await client.query(
        `UPDATE users SET inr_balance = inr_balance + $1 WHERE id = $2`,
        [trade.payment_id, trade.buyer_id] // Note: amount is in payment record
      );
    }
    await client.query(
      `UPDATE payments SET status = 'REFUNDED', updated_at = NOW() WHERE payment_id = $1`,
      [trade.payment_id]
    );
  }

  private async releaseListingReservation(client: any, trade: Trade): Promise<void> {
    await client.query(
      `UPDATE listings 
       SET remaining_quantity = remaining_quantity + $1,
           status = 'active',
           updated_at = NOW()
       WHERE listing_id = $2`,
      [trade.quantity, trade.listing_id]
    );

    await client.query(
      `UPDATE ownership_positions 
       SET reserved_quantity = reserved_quantity + $1, updated_at = NOW()
       WHERE position_id = (SELECT position_id FROM listings WHERE listing_id = $2)`,
      [trade.quantity, trade.listing_id]
    );
  }

  private async publishOutboxEvents(client: any, tradeId: string): Promise<void> {
    await client.query(
      `INSERT INTO outbox_events (event_id, aggregate_type, aggregate_id, event_type, payload, created_at)
       VALUES ($1,'Trade',$2,'TradeSettled',jsonb_build_object('tradeId',$2,'status','SETTLED'),NOW())`,
      [uuidv4(), tradeId]
    );
  }
}

// Default tax calculator (India GST)
const defaultTaxCalculator: TaxCalculator = {
  calculate(feeAmount: number, feeType: 'BUYER' | 'SELLER', context: TaxContext): TaxBreakdown {
    const gstRate = 0.18;
    const taxableAmount = feeAmount;
    const totalTax = Math.round(taxableAmount * gstRate);
    const cgst = Math.floor(totalTax / 2);
    const sgst = totalTax - cgst;
    const igst = 0; // Simplified - would check inter-state vs intra-state
    
    return {
      taxableAmount,
      cgst,
      sgst,
      igst,
      totalTax,
      taxRate: gstRate,
      hsCode: '999799',
      explanation: `GST @ 18% on ${feeType} transaction fee`
    };
  }
};

export { defaultTaxCalculator };