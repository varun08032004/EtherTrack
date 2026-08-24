// Payment Service - Handles payment authorization, capture, verification, refunds

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import Razorpay from 'razorpay';
import { 
  Payment, 
  PaymentAttempt, 
  PaymentMode, 
  PaymentProvider, 
  PaymentStatus,
  WalletTransaction 
} from '../../domain/types';

export class PaymentService {
  private razorpay: Razorpay | null = null;
  private razorpayKeyId: string;
  private razorpayKeySecret: string;

  constructor() {
    this.razorpayKeyId = process.env.RAZORPAY_KEY_ID!;
    this.razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET!;
    
    if (this.razorpayKeyId && this.razorpayKeySecret) {
      this.razorpay = new Razorpay({
        key_id: this.razorpayKeyId,
        key_secret: this.razorpayKeySecret,
      });
    }
  }

  // ============================================================
  // RAZORPAY PAYMENTS
  // ============================================================

  async createRazorpayOrder(input: {
    paymentId: string;
    amount: number; // in paise
    buyerId: string;
    sellerId: string;
    transfers?: Array<{ account: string; amount: number; notes?: any }>;
    notes?: Record<string, string>;
  }): Promise<{ orderId: string; amount: number; currency: string }> {
    if (!this.razorpay) {
      throw new Error('Razorpay not configured');
    }

    const order = await this.razorpay.orders.create({
      amount: input.amount,
      currency: 'INR',
      transfers: input.transfers || [],
      notes: {
        payment_id: input.paymentId,
        buyer_id: input.buyerId,
        seller_id: input.sellerId,
        ...input.notes
      },
    });

    // Update payment with Razorpay order ID
    await query(
      `UPDATE payments SET provider_reference = $1, updated_at = NOW() WHERE payment_id = $2`,
      [order.id, input.paymentId]
    );

    // Record payment attempt
    await query(
      `INSERT INTO payment_attempts (attempt_id, payment_id, provider_reference, status, created_at)
       VALUES ($1,$2,$3,'PENDING',NOW())`,
      [uuidv4(), input.paymentId, order.id]
    );

    return { orderId: order.id, amount: order.amount, currency: order.currency };
  }

  async verifyRazorpayPayment(paymentId: string, razorpayPaymentId: string, razorpaySignature: string): Promise<{ verified: boolean; payment: Payment }> {
    const { rows } = await query('SELECT * FROM payments WHERE payment_id = $1', [paymentId]);
    if (!rows.length) throw new Error('Payment not found');

    const payment = rows[0];
    const orderId = payment.provider_reference;

    if (!orderId) {
      throw new Error('No Razorpay order ID associated with this payment');
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', this.razorpayKeySecret)
      .update(`${orderId}|${razorpayPaymentId}`)
      .digest('hex');

    const verified = expectedSignature === razorpaySignature;

    await withTransaction(async (client) => {
      if (verified) {
        await client.query(
          `UPDATE payments 
           SET status = 'CAPTURED', provider_reference = $1, completed_at = NOW(), updated_at = NOW()
           WHERE payment_id = $2`,
          [razorpayPaymentId, paymentId]
        );

        await client.query(
          `INSERT INTO payment_attempts (attempt_id, payment_id, provider_reference, status, completed_at)
           VALUES ($1,$2,$3,'SUCCESS',NOW())`,
          [uuidv4(), paymentId, razorpayPaymentId]
        );
      } else {
        await client.query(
          `UPDATE payments SET status = 'FAILED', updated_at = NOW() WHERE payment_id = $1`,
          [paymentId]
        );

        await client.query(
          `INSERT INTO payment_attempts (attempt_id, payment_id, provider_reference, status, error_message, completed_at)
           VALUES ($1,$2,$3,'FAILED','Invalid signature',NOW())`,
          [uuidv4(), paymentId, razorpayPaymentId]
        );
      }
    });

    const { rows: updatedRows } = await query('SELECT * FROM payments WHERE payment_id = $1', [paymentId]);
    return { verified, payment: this.mapRowToPayment(updatedRows[0]) };
  }

  async captureRazorpayPayment(paymentId: string, amount?: number): Promise<Payment> {
    if (!this.razorpay) throw new Error('Razorpay not configured');

    const { rows } = await query('SELECT * FROM payments WHERE payment_id = $1', [paymentId]);
    if (!rows.length) throw new Error('Payment not found');

    const payment = rows[0];
    const orderId = payment.provider_reference;

    if (!orderId) throw new Error('No Razorpay order ID');

    // Razorpay auto-captures by default, but we can explicitly capture if needed
    if (amount) {
      await this.razorpay.payments.capture(razorpayPaymentId, amount);
    }

    await query(
      `UPDATE payments SET status = 'SETTLED', completed_at = NOW(), updated_at = NOW() WHERE payment_id = $1`,
      [paymentId]
    );

    const { rows: settledRows } = await query('SELECT * FROM payments WHERE payment_id = $1', [paymentId]);
    return this.mapRowToPayment(rows[0]);
  }

  async refundRazorpayPayment(paymentId: string, amount?: number, reason?: string): Promise<Payment> {
    if (!this.razorpay) throw new Error('Razorpay not configured');

    const { rows } = await query('SELECT * FROM payments WHERE payment_id = $1', [paymentId]);
    if (!rows.length) throw new Error('Payment not found');

    const payment = rows[0];
    
    // Find the captured payment ID from attempts
    const { rows: attempts } = await query(
      `SELECT provider_reference FROM payment_attempts 
       WHERE payment_id = $1 AND status = 'SUCCESS' 
       ORDER BY created_at DESC LIMIT 1`,
      [paymentId]
    );

    if (!attempts.length) throw new Error('No successful payment attempt found to refund');

    const razorpayPaymentId = attempts[0].provider_reference;
    
    const refund = await this.razorpay.payments.refund(razorpayPaymentId, {
      amount: amount ? amount * 100 : undefined, // Razorpay expects paise
      notes: { reason: reason || 'Refund requested' }
    });

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE payments SET status = 'REFUNDED', updated_at = NOW() WHERE payment_id = $1`,
        [paymentId]
      );

      await client.query(
        `INSERT INTO payment_attempts (attempt_id, payment_id, provider_reference, status, error_message, completed_at)
         VALUES ($1,$2,$3,'SUCCESS',$4,NOW())`,
        [uuidv4(), paymentId, refund.id, `Refund: ${refund.status}`]
      );
    });

    const { rows: refundedRows } = await query('SELECT * FROM payments WHERE payment_id = $1', [paymentId]);
    return this.mapRowToPayment(refundedRows[0]);
  }

  // ============================================================
  // INR WALLET PAYMENTS
  // ============================================================

  async authorizeInrWalletPayment(paymentId: string, buyerId: string): Promise<void> {
    await withTransaction(async (client) => {
      const { rows: payment } = await client.query('SELECT * FROM payments WHERE payment_id = $1', [paymentId]);
      if (!payment.length) throw new Error('Payment not found');

      const { rows: buyer } = await client.query(
        'SELECT inr_balance FROM users WHERE id = $1 FOR UPDATE',
        [buyerId]
      );

      if (!buyer.length) throw new Error('Buyer not found');

      const balance = Number(buyer[0].inr_balance);
      const amount = Number(payment[0].amount);

      if (balance < amount) {
        throw new Error(`Insufficient INR balance: ${balance} < ${amount}`);
      }

      // Debit buyer
      await client.query(
        `UPDATE users SET inr_balance = inr_balance - $1, updated_at = NOW() WHERE id = $2`,
        [amount, buyerId]
      );

      await client.query(
        `INSERT INTO wallet_transactions (
          transaction_id, user_id, type, method, amount, balance_before, balance_after,
          reference, trade_id, payment_id, notes, status
        ) VALUES ($1,$2,'debit','inr',$3,$4,$5,$6,$7,$8,$9,'success')`,
        [
          uuidv4(), buyerId, amount, balance, balance - amount,
          `trade:${payment[0].trade_id}:payment`, payment[0].trade_id, paymentId,
          `Payment for trade ${payment[0].trade_id}`
        ]
      );

      await client.query(
        `UPDATE payments SET status = 'AUTHORIZED', updated_at = NOW() WHERE payment_id = $1`,
        [paymentId]
      );
    });
  }

  async captureInrWalletPayment(paymentId: string, sellerId: string): Promise<void> {
    await withTransaction(async (client) => {
      const { rows: payment } = await client.query('SELECT * FROM payments WHERE payment_id = $1', [paymentId]);
      if (!payment.length) throw new Error('Payment not found');

      const amount = Number(payment[0].amount);

      // Credit seller
      await client.query(
        `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
        [amount, sellerId]
      );

      const { rows: seller } = await client.query('SELECT inr_balance FROM users WHERE id = $1', [sellerId]);
      const sellerBalance = Number(seller[0]?.inr_balance || 0);

      await client.query(
        `INSERT INTO wallet_transactions (
          transaction_id, user_id, type, method, amount, balance_before, balance_after,
          reference, trade_id, payment_id, notes, status
        ) VALUES ($1,$2,'credit','inr',$3,$4,$5,$6,$7,$8,$9,'success')`,
        [
          uuidv4(), sellerId, amount, sellerBalance - amount, sellerBalance,
          `trade:${payment[0].trade_id}:payment`, payment[0].trade_id, paymentId,
          `Payment received for trade ${payment[0].trade_id}`
        ]
      );

      await client.query(
        `UPDATE payments SET status = 'SETTLED', completed_at = NOW(), updated_at = NOW() WHERE payment_id = $1`,
        [paymentId]
      );
    });
  }

  async captureInrWalletPaymentNet(paymentId: string, sellerId: string, netAmount: number): Promise<void> {
    await withTransaction(async (client) => {
      const { rows: payment } = await client.query('SELECT * FROM payments WHERE payment_id = $1', [paymentId]);
      if (!payment.length) throw new Error('Payment not found');

      // Credit seller with NET amount (after fees/taxes)
      await client.query(
        `UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`,
        [netAmount, sellerId]
      );

      const { rows: seller } = await client.query('SELECT inr_balance FROM users WHERE id = $1', [sellerId]);
      const sellerBalance = Number(seller[0]?.inr_balance || 0);

      await client.query(
        `INSERT INTO wallet_transactions (
          transaction_id, user_id, type, method, amount, balance_before, balance_after,
          reference, trade_id, payment_id, notes, status
        ) VALUES ($1,$2,'credit','inr',$3,$4,$5,$6,$7,$8,$9,'success')`,
        [
          uuidv4(), sellerId, netAmount, sellerBalance - netAmount, sellerBalance,
          `trade:${payment[0].trade_id}:payment`, payment[0].trade_id, paymentId,
          `Net payment received for trade ${payment[0].trade_id} (after fees/taxes)`
        ]
      );

      await client.query(
        `UPDATE payments SET status = 'SETTLED', completed_at = NOW(), updated_at = NOW() WHERE payment_id = $1`,
        [paymentId]
      );
    });
  }

  // ============================================================
  // ETH PAYMENTS
  // ============================================================

  async recordEthPayment(paymentId: string, txHash: string): Promise<void> {
    await query(
      `UPDATE payments SET provider_reference = $1, status = 'AUTHORIZED', updated_at = NOW() WHERE payment_id = $2`,
      [txHash, paymentId]
    );

    await query(
      `INSERT INTO payment_attempts (attempt_id, payment_id, provider_reference, status, created_at)
       VALUES ($1,$2,$3,'PENDING',NOW())`,
      [uuidv4(), paymentId, txHash]
    );
  }

  async confirmEthPayment(paymentId: string): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE payments SET status = 'SETTLED', completed_at = NOW(), updated_at = NOW() WHERE payment_id = $1`,
        [paymentId]
      );

      await client.query(
        `UPDATE payment_attempts SET status = 'SUCCESS', completed_at = NOW() 
         WHERE payment_id = $1 AND status = 'PENDING'`,
        [paymentId]
      );
    });
  }

  // ============================================================
  // GENERIC PAYMENT OPERATIONS
  // ============================================================

  async getPayment(paymentId: string): Promise<Payment | null> {
    const { rows } = await query('SELECT * FROM payments WHERE payment_id = $1', [paymentId]);
    return rows.length ? this.mapRowToPayment(rows[0]) : null;
  }

  async getPaymentAttempts(paymentId: string): Promise<PaymentAttempt[]> {
    const { rows } = await query(
      'SELECT * FROM payment_attempts WHERE payment_id = $1 ORDER BY created_at DESC',
      [paymentId]
    );
    return rows.map(this.mapRowToAttempt);
  }

  async getPaymentsByTrade(tradeId: string): Promise<Payment[]> {
    const { rows } = await query('SELECT * FROM payments WHERE trade_id = $1', [tradeId]);
    return rows.map(this.mapRowToPayment);
  }

  private mapRowToPayment(row: any): Payment {
    return {
      paymentId: row.payment_id,
      tradeId: row.trade_id,
      payerId: row.payer_id,
      payeeId: row.payee_id,
      amount: Number(row.amount),
      currency: row.currency,
      paymentMode: row.payment_mode,
      provider: row.provider,
      providerReference: row.provider_reference,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      updatedAt: row.updated_at
    };
  }

  private mapRowToAttempt(row: any): PaymentAttempt {
    return {
      attemptId: row.attempt_id,
      paymentId: row.payment_id,
      providerReference: row.provider_reference,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      completedAt: row.completed_at
    };
  }
}