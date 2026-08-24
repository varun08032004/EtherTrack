'use strict';

// Minimal SettlementEngine for cron jobs - pure JavaScript
// Only implements methods needed by cron jobs

const { v4: uuidv4 } = require('uuid');
const { safeQuery: query, withTransaction } = require('./db/pool.js');

class SettlementEngineCron {
  async getTradeForTransition(tradeId) {
    const { rows } = await query('SELECT * FROM trades WHERE id = $1', [tradeId]);
    if (!rows.length) throw new Error('Trade not found');
    return rows[0];
  }

  async executeStateTransition(tradeId, targetState, action) {
    await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM trades WHERE id = $1 FOR UPDATE', [tradeId]);
      if (!rows.length) throw new Error('Trade not found');
      const trade = rows[0];
      
      await action(client, trade);
      
      await client.query(
        'UPDATE trades SET settlement_state = $1, updated_at = NOW() WHERE id = $2',
        [targetState, tradeId]
      );
    });
  }

  async recordSettlementOperation(client, op) {
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

  async transitionToPaymentSettled(tradeId, paymentDetails) {
    await this.executeStateTransition(tradeId, 'PAYMENT_SETTLED', async (client, trade) => {
      await client.query(
        `UPDATE payments 
         SET status = 'SETTLED', provider_reference = $1, completed_at = $2, updated_at = NOW()
         WHERE payment_id = $3`,
        [paymentDetails.providerReference, paymentDetails.capturedAt, trade.payment_id]
      );

      await client.query(
        `INSERT INTO payment_attempts (attempt_id, payment_id, provider_reference, status, created_at, completed_at)
         VALUES ($1,$2,$3,'SUCCESS',$2,$2)`,
        [uuidv4(), trade.payment_id, paymentDetails.providerReference, paymentDetails.capturedAt]
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

  async transitionToSellerPaid(tradeId) {
    await this.executeStateTransition(tradeId, 'SELLER_PAID', async (client, trade) => {
      const { rows: sellerFee } = await client.query(
        `SELECT amount, tax_amount FROM fees WHERE trade_id = $1 AND type = 'SELLER_TRANSACTION_FEE'`,
        [trade.id]
      );
      const sellerFeeAmount = sellerFee.length ? Number(sellerFee[0].amount) + Number(sellerFee[0].tax_amount) : 0;
      const sellerNetAmount = Number(trade.seller_gross) - sellerFeeAmount;

      await client.query(
        `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
        [sellerNetAmount, trade.seller_id]
      );

      const { rows: seller } = await client.query('SELECT inr_balance FROM users WHERE id = $1', [trade.seller_id]);
      const sellerBalance = Number(seller[0]?.inr_balance || 0);

      await client.query(
        `INSERT INTO wallet_transactions (
          transaction_id, user_id, type, method, amount, balance_before, balance_after,
          reference, trade_id, payment_id, notes, status
        ) VALUES ($1,$2,'credit','inr',$3,$4,$5,$6,$7,$8,$9,'success')`,
        [
          uuidv4(), trade.seller_id, sellerNetAmount, sellerBalance - sellerNetAmount, sellerBalance,
          `trade:${trade.id}:payment`, trade.payment_id,
          `Net payment received for trade ${trade.id} (after fees/taxes)`
        ]
      );

      await client.query(
        `UPDATE payments SET status = 'SETTLED', completed_at = NOW(), updated_at = NOW() WHERE payment_id = $1`,
        [trade.payment_id]
      );

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

  async transitionToBuyerCredited(tradeId) {
    await this.executeStateTransition(tradeId, 'BUYER_CREDITED', async (client, trade) => {
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

  async transitionToCreditTransferConfirmed(tradeId) {
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

  async transitionToSettled(tradeId) {
    await this.executeStateTransition(tradeId, 'SETTLED', async (client, trade) => {
      await client.query(
        `UPDATE trades SET settlement_state = 'SETTLED', settled_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [tradeId]
      );

      await this.recordSettlementOperation(client, {
        operationId: uuidv4(),
        tradeId,
        type: 'CREDIT_BUYER',
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

  async transitionToFeesCollected(tradeId) {
    await this.executeStateTransition(tradeId, 'FEES_COLLECTED', async (client, trade) => {
      await client.query(
        `UPDATE fees SET status = 'COLLECTED', collected_at = NOW() WHERE trade_id = $1`,
        [tradeId]
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
}

module.exports = { SettlementEngine: SettlementEngineCron };