// Fee Service - Calculates, collects, and reconciles platform fees

import crypto from 'crypto';
import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import { 
  Fee, 
  PlatformFee, 
  FeeType, 
  TaxType,
  TaxCalculator,
  TaxContext,
  TaxBreakdown,
  defaultTaxCalculator,
  PaymentMode
} from '../../domain/types.ts';

export class FeeService {
  private taxCalculator: TaxCalculator;
  private platformFeeBps: number;
  private platformGstin: string;
  private placeOfSupply: string;

  constructor(
    taxCalculator: TaxCalculator = defaultTaxCalculator,
    platformFeeBps: number = 100,
    platformGstin: string = process.env.PLATFORM_GSTIN || '27AAAAA0000A1Z5',
    placeOfSupply: string = '27'
  ) {
    this.taxCalculator = taxCalculator;
    this.platformFeeBps = platformFeeBps;
    this.platformGstin = platformGstin;
    this.placeOfSupply = placeOfSupply;
  }

  calculateFees(grossAmount: number, buyerFeeBps: number, sellerFeeBps: number): {
    buyerFee: number;
    sellerFee: number;
    buyerTax: TaxBreakdown;
    sellerTax: TaxBreakdown;
    buyerTotalDebit: number;
    sellerNetCredit: number;
    platformRevenue: number;
    platformTaxLiability: number;
  } {
    const buyerFee = Math.floor((grossAmount * buyerFeeBps) / 10000);
    const sellerFee = Math.floor((grossAmount * sellerFeeBps) / 10000);

    const taxContext: TaxContext = {
      buyerGstin: null,
      sellerGstin: null,
      platformGstin: this.platformGstin,
      placeOfSupply: this.placeOfSupply,
      transactionType: 'B2B'
    };

    const buyerTax = this.taxCalculator.calculate(buyerFee, 'BUYER', taxContext);
    const sellerTax = this.taxCalculator.calculate(sellerFee, 'SELLER', taxContext);

    const buyerTotalDebit = grossAmount + buyerFee + buyerTax.totalTax;
    const sellerNetCredit = grossAmount - sellerFee - sellerTax.totalTax;
    const platformRevenue = buyerFee + sellerFee;
    const platformTaxLiability = buyerTax.totalTax + sellerTax.totalTax;

    return {
      buyerFee,
      sellerFee,
      buyerTax,
      sellerTax,
      buyerTotalDebit,
      sellerNetCredit,
      platformRevenue,
      platformTaxLiability
    };
  }

  async createFeeRecords(tradeId: string, fees: {
    buyerFee: number;
    sellerFee: number;
    buyerTax: TaxBreakdown;
    sellerTax: TaxBreakdown;
  }): Promise<{ buyerFeeId: string; sellerFeeId: string }> {
    const buyerFeeId = crypto.randomUUID();
    const sellerFeeId = crypto.randomUUID();

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO fees (fee_id, trade_id, type, amount, currency, tax_amount, tax_type, cgst_amount, sgst_amount, igst_amount, status)
         VALUES ($1,$2,'BUYER_TRANSACTION_FEE',$3,'INR',$4,$5,$6,$7,$8,'PENDING')`,
        [buyerFeeId, tradeId, fees.buyerFee, fees.buyerTax.totalTax, fees.buyerTax.taxType, 
         fees.buyerTax.cgst, fees.buyerTax.sgst, fees.buyerTax.igst]
      );

      await client.query(
        `INSERT INTO fees (fee_id, trade_id, type, amount, currency, tax_amount, tax_type, cgst_amount, sgst_amount, igst_amount, status)
         VALUES ($1,$2,'SELLER_TRANSACTION_FEE',$3,'INR',$4,$5,$6,$7,$8,'PENDING')`,
        [sellerFeeId, tradeId, fees.sellerFee, fees.sellerTax.totalTax, fees.sellerTax.taxType,
         fees.sellerTax.cgst, fees.sellerTax.sgst, fees.sellerTax.igst]
      );
    });

    return { buyerFeeId, sellerFeeId };
  }

  async markFeesCollected(tradeId: string): Promise<void> {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE fees SET status = 'COLLECTED', collected_at = NOW() WHERE trade_id = $1`,
        [tradeId]
      );

      const { rows: feeRows } = await client.query(
        `SELECT 
           SUM(CASE WHEN type = 'BUYER_TRANSACTION_FEE' THEN amount ELSE 0 END) as buyer_fee,
           SUM(CASE WHEN type = 'SELLER_TRANSACTION_FEE' THEN amount ELSE 0 END) as seller_fee,
           SUM(tax_amount) as total_tax
         FROM fees WHERE trade_id = $1`,
        [tradeId]
      );

      const fees = feeRows[0];
      const buyerFee = Number(fees.buyer_fee || 0);
      const sellerFee = Number(fees.seller_fee || 0);
      const totalFee = buyerFee + sellerFee;
      const gstAmount = Number(fees.total_tax || 0);
      const platformNet = totalFee - gstAmount;

      await client.query(
        `INSERT INTO platform_fees (
          platform_fee_id, trade_id, buyer_fee_amount, seller_fee_amount,
          total_fee_amount, gst_amount, platform_net_amount, fee_eth, eth_rate,
          payment_mode, status, gst_type, cgst_amount, sgst_amount, igst_amount
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'collected',$11,$12,$13,$14)`,
        [
          crypto.randomUUID(), tradeId, buyerFee, sellerFee,
          totalFee, gstAmount, platformNet, null, null,
          'INR', 'CGST_SGST', 
          Number(fees.buyer_fee) / 2, Number(fees.seller_fee) / 2, 0
        ]
      );
    });
  }

  async getTradeFees(tradeId: string): Promise<Fee[]> {
    const { rows } = await query('SELECT * FROM fees WHERE trade_id = $1', [tradeId]);
    return rows.map(this.mapRowToFee);
  }

  async getPlatformFees(filters: { 
    startDate?: Date; 
    endDate?: Date; 
    paymentMode?: PaymentMode;
  } = {}): Promise<PlatformFee[]> {
    let sql = 'SELECT * FROM platform_fees WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.startDate) {
      sql += ` AND created_at >= $${paramIndex++}`;
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ` AND created_at <= $${paramIndex++}`;
      params.push(filters.endDate);
    }
    if (filters.paymentMode) {
      sql += ` AND payment_mode = $${paramIndex++}`;
      params.push(filters.paymentMode);
    }

    sql += ' ORDER BY created_at DESC';

    const { rows } = await query(sql, params);
    return rows.map(this.mapRowToPlatformFee);
  }

  async getFeeReconciliation(date: Date): Promise<{
    tradeFeesTotal: number;
    platformFeesTotal: number;
    mismatch: number;
  }> {
    const dateStr = date.toISOString().split('T')[0];
    
    const [tradeFees, platformFees] = await Promise.all([
      query(
        `SELECT COALESCE(SUM(total_fee_inr), 0) as total 
         FROM trades 
         WHERE DATE(created_at) = $1 AND status = 'completed'`,
        [dateStr]
      ),
      query(
        `SELECT COALESCE(SUM(total_fee_amount), 0) as total 
         FROM platform_fees 
         WHERE DATE(created_at) = $1 AND status = 'collected'`,
        [dateStr]
      )
    ]);

    const tradeFeesTotal = parseFloat(tradeFees.rows[0].total);
    const platformFeesTotal = parseFloat(platformFees.rows[0].total);

    return {
      tradeFeesTotal,
      platformFeesTotal,
      mismatch: tradeFeesTotal - platformFeesTotal
    };
  }

  async getUserFeeSummary(userId: string): Promise<{
    feesPaidAsBuyer: number;
    feesPaidAsSeller: number;
    totalTrades: number;
  }> {
    const { rows } = await query(
      `SELECT 
         SUM(CASE WHEN buyer_id = $1 THEN buyer_fee_inr ELSE 0 END) as buyer_fees,
         SUM(CASE WHEN seller_id = $1 THEN seller_fee_inr ELSE 0 END) as seller_fees,
         COUNT(*) as total_trades
       FROM trades 
       WHERE (buyer_id = $1 OR seller_id = $1) AND status = 'completed'`,
      [userId]
    );

    return {
      feesPaidAsBuyer: parseFloat(rows[0]?.buyer_fees || '0'),
      feesPaidAsSeller: parseFloat(rows[0]?.seller_fees || '0'),
      totalTrades: parseInt(rows[0]?.total_trades || '0')
    };
  }

  private mapRowToFee(row: any): Fee {
    return {
      feeId: row.fee_id,
      tradeId: row.trade_id,
      type: row.type,
      amount: Number(row.amount),
      currency: row.currency,
      taxAmount: Number(row.tax_amount),
      taxType: row.tax_type,
      cgstAmount: Number(row.cgst_amount),
      sgstAmount: Number(row.sgst_amount),
      igstAmount: Number(row.igst_amount),
      status: row.status,
      collectedAt: row.collected_at,
      createdAt: row.created_at
    };
  }

  private mapRowToPlatformFee(row: any): PlatformFee {
    return {
      platformFeeId: row.platform_fee_id,
      tradeId: row.trade_id,
      buyerFeeAmount: Number(row.buyer_fee_amount),
      sellerFeeAmount: Number(row.seller_fee_amount),
      totalFeeAmount: Number(row.total_fee_amount),
      gstAmount: Number(row.gst_amount),
      platformNetAmount: Number(row.platform_net_amount),
      feeEth: row.fee_eth ? Number(row.fee_eth) : null,
      ethRate: row.eth_rate ? Number(row.eth_rate) : null,
      paymentMode: row.payment_mode,
      status: row.status,
      gstType: row.gst_type,
      cgstAmount: Number(row.cgst_amount),
      sgstAmount: Number(row.sgst_amount),
      igstAmount: Number(row.igst_amount),
      razorpayPaymentId: row.razorpay_payment_id,
      createdAt: row.created_at
    };
  }
}