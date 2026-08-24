// Reconciliation Engine - Automated verification and repair of system invariants

import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import { CustodyAdapterFactory } from '../custody';
import { ReconciliationResult, ReconciliationSeverity } from '../../domain/types';

export class ReconciliationEngine {
  async runAllChecks(): Promise<ReconciliationResult[]> {
    const results: ReconciliationResult[] = [];

    // Run all reconciliation checks in parallel
    const checks = await Promise.allSettled([
      this.checkPositionIntegrity(),
      this.checkListingConsistency(),
      this.checkTradeAccounting(),
      this.checkPaymentReconciliation(),
      this.checkFeeReconciliation(),
      this.checkRetirementConsistency(),
      this.checkLedgerBalances(),
      this.checkFinancialLedgerIntegrity(),
      this.checkCarbonLedgerIntegrity(),
      this.checkCarbonConservation(),
      this.checkOnChainListings(),
      this.checkBlockchainEvents()
    ]);

    checks.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(...result.value);
      } else {
        results.push({
          checkName: `check_${index}`,
          status: 'ERROR',
          mismatches: 1,
          severity: 'P1',
          details: { error: result.reason instanceof Error ? result.reason.message : 'Unknown error' },
          timestamp: new Date()
        });
      }
    });

    // Log results
    for (const r of results) {
      if (r.mismatches > 0) {
        console.error(`[RECONCILIATION] ${r.checkName}: ${r.mismatches} mismatches (${r.severity})`, r.details);
      } else {
        console.log(`[RECONCILIATION] ${r.checkName}: OK`);
      }
    }

    // Alert on critical mismatches
    const critical = results.filter(r => r.severity === 'P1' && r.mismatches > 0);
    if (critical.length > 0) {
      await this.alertCriticalMismatches(critical);
    }

    return results;
  }

  // ============================================================
  // INDIVIDUAL CHECKS
  // ============================================================

  async checkPositionIntegrity(): Promise<ReconciliationResult[]> {
    const { rows } = await query(
      `SELECT position_id, owner_id, asset_id, custody_type, owned_quantity, reserved_quantity
       FROM ownership_positions
       WHERE owned_quantity < reserved_quantity OR reserved_quantity < 0`
    );

    return [{
      checkName: 'position_integrity',
      status: rows.length > 0 ? 'FAIL' : 'PASS',
      mismatches: rows.length,
      severity: rows.length > 0 ? 'P1' : 'P0',
      details: { violations: rows.map(r => ({
        positionId: r.position_id,
        ownerId: r.owner_id,
        assetId: r.asset_id,
        custodyType: r.custody_type,
        owned: Number(r.owned_quantity),
        reserved: Number(r.reserved_quantity)
      })) },
      timestamp: new Date()
    }];
  }

  async checkListingConsistency(): Promise<ReconciliationResult[]> {
    // Check 1: Listing remaining <= quantity
    const { rows: remainingViolations } = await query(
      `SELECT listing_id, quantity, remaining_quantity 
       FROM listings WHERE remaining_quantity > quantity OR remaining_quantity < 0`
    );

    // Check 2: Position reserved = sum of active listing remaining
    const { rows: reservationMismatches } = await query(
      `SELECT op.position_id, op.owner_id, op.asset_id, op.reserved_quantity,
              COALESCE(SUM(l.remaining_quantity), 0) as actual_reserved
       FROM ownership_positions op
       LEFT JOIN listings l ON l.position_id = op.position_id AND l.status = 'active'
       GROUP BY op.position_id, op.owner_id, op.asset_id, op.reserved_quantity
       HAVING op.reserved_quantity != COALESCE(SUM(l.remaining_quantity), 0)`
    );

    // Check 3: Active listing remaining > available position
    const { rows: overallocation } = await query(
      `SELECT l.listing_id, l.position_id, l.remaining_quantity, 
              op.owned_quantity - op.reserved_quantity as available
       FROM listings l
       JOIN ownership_positions op ON op.position_id = l.position_id
       WHERE l.status = 'active' 
         AND l.remaining_quantity > (op.owned_quantity - op.reserved_quantity)`
    );

    const allViolations = [...remainingViolations, ...reservationMismatches, ...overallocation];

    return [{
      checkName: 'listing_consistency',
      status: allViolations.length > 0 ? 'FAIL' : 'PASS',
      mismatches: allViolations.length,
      severity: allViolations.length > 0 ? 'P1' : 'P0',
      details: {
        remainingViolations: remainingViolations.length,
        reservationMismatches: reservationMismatches.length,
        overallocation: overallocation.length,
        details: allViolations
      },
      timestamp: new Date()
    }];
  }

  async checkTradeAccounting(): Promise<ReconciliationResult[]> {
    const { rows } = await query(
      `SELECT trade_id, buyer_gross, seller_gross, quantity, execution_price,
              buyer_fee_inr, seller_fee_inr, total_fee_inr, gst_inr,
              buyer_pays_inr, seller_receives_inr, platform_net_inr
       FROM trades
       WHERE status = 'completed'
         AND (
           buyer_gross != seller_gross
           OR buyer_gross != quantity * execution_price
           OR buyer_pays_inr != buyer_gross + buyer_fee_inr + (gst_inr / 2)
           OR seller_receives_inr != seller_gross - seller_fee_inr - (gst_inr / 2)
           OR platform_net_inr != buyer_fee_inr + seller_fee_inr
           OR total_fee_inr != buyer_fee_inr + seller_fee_inr
         )`
    );

    return [{
      checkName: 'trade_accounting',
      status: rows.length > 0 ? 'FAIL' : 'PASS',
      mismatches: rows.length,
      severity: rows.length > 0 ? 'P1' : 'P0',
      details: { violations: rows.map(r => ({
        tradeId: r.trade_id,
        buyerGross: Number(r.buyer_gross),
        sellerGross: Number(r.seller_gross),
        expectedGross: Number(r.quantity) * Number(r.execution_price),
        buyerPays: Number(r.buyer_pays_inr),
        sellerReceives: Number(r.seller_receives_inr),
        platformNet: Number(r.platform_net_inr)
      })) },
      timestamp: new Date()
    }];
  }

  async checkPaymentReconciliation(): Promise<ReconciliationResult[]> {
    // Check: Completed trades have corresponding settled payments
    const { rows } = await query(
      `SELECT t.trade_id, t.payment_id, t.buyer_total_debit, t.payment_mode,
              p.status as payment_status, p.amount as payment_amount
       FROM trades t
       LEFT JOIN payments p ON p.payment_id = t.payment_id
       WHERE t.status = 'completed'
         AND (p.payment_id IS NULL OR p.status != 'SETTLED')`
    );

    return [{
      checkName: 'payment_reconciliation',
      status: rows.length > 0 ? 'FAIL' : 'PASS',
      mismatches: rows.length,
      severity: rows.length > 0 ? 'P1' : 'P0',
      details: { unsettledPayments: rows.map(r => ({
        tradeId: r.trade_id,
        paymentId: r.payment_id,
        expectedAmount: Number(r.buyer_total_debit),
        paymentStatus: r.payment_status,
        paymentMode: r.payment_mode
      })) },
      timestamp: new Date()
    }];
  }

  async checkFeeReconciliation(): Promise<ReconciliationResult[]> {
    // Daily fee reconciliation
    const today = new Date().toISOString().split('T')[0];
    
    const { rows } = await query(
      `WITH trade_fees AS (
         SELECT DATE(created_at) as date, SUM(total_fee_inr) as total
         FROM trades WHERE status = 'completed' AND DATE(created_at) = $1
         GROUP BY DATE(created_at)
       ), platform_fees AS (
         SELECT DATE(created_at) as date, SUM(total_fee_amount) as total
         FROM platform_fees WHERE status = 'collected' AND DATE(created_at) = $1
         GROUP BY DATE(created_at)
       )
       SELECT tf.date, tf.total as trade_total, pf.total as platform_total,
              (tf.total - pf.total) as mismatch
       FROM trade_fees tf
       FULL JOIN platform_fees pf ON tf.date = pf.date
       WHERE tf.total != pf.total OR pf.total IS NULL OR tf.total IS NULL`,
      [today]
    );

    return [{
      checkName: 'fee_reconciliation',
      status: rows.length > 0 ? 'FAIL' : 'PASS',
      mismatches: rows.length,
      severity: rows.length > 0 ? 'P1' : 'P0',
      details: { dailyMismatches: rows.map(r => ({
        date: r.date,
        tradeFees: Number(r.trade_total || 0),
        platformFees: Number(r.platform_total || 0),
        mismatch: Number(r.mismatch || 0)
      })) },
      timestamp: new Date()
    }];
  }

  async checkRetirementConsistency(): Promise<ReconciliationResult[]> {
    // Check: Retired credits not available
    const { rows } = await query(
      `SELECT r.retirement_id, r.asset_id, r.quantity, r.custody_type,
              op.owned_quantity as position_owned
       FROM retirements r
       LEFT JOIN ownership_positions op ON op.owner_id = r.owner_id 
         AND op.asset_id = r.asset_id AND op.custody_type = r.custody_type
       WHERE r.status = 'completed'
         AND (op.position_id IS NULL OR op.owned_quantity < 0)`
    );

    // Check: Double retirement across custody types
    const { rows: doubleRetire } = await query(
      `SELECT r1.serial_number, r1.asset_id, r1.quantity as q1, r2.quantity as q2
       FROM retirements r1
       JOIN retirements r2 ON r1.serial_number = r2.serial_number AND r1.retirement_id < r2.retirement_id
       WHERE r1.status = 'completed' AND r2.status = 'completed'`
    );

    const allViolations = [...rows, ...doubleRetire];

    return [{
      checkName: 'retirement_consistency',
      status: allViolations.length > 0 ? 'FAIL' : 'PASS',
      mismatches: allViolations.length,
      severity: allViolations.length > 0 ? 'P1' : 'P0',
      details: { 
        negativePosition: rows.length,
        doubleRetirement: doubleRetire.length,
        violations: allViolations
      },
      timestamp: new Date()
    }];
  }

  async checkLedgerBalances(): Promise<ReconciliationResult[]> {
    // Compare DB ledger balances with on-chain CreditLedger.sol
    const { rows: balances } = await query(
      `SELECT clb.user_id, clb.token_id, clb.balance as db_balance
       FROM credit_ledger_balances clb
       WHERE clb.balance > 0`
    );

    const mismatches = [];
    const ledgerAdapter = CustodyAdapterFactory.getAdapter('ledger');

    for (const balance of balances) {
      try {
        const verified = await ledgerAdapter.verifyBalance(balance.user_id, balance.token_id);
        if (!verified.matches) {
          mismatches.push({
            userId: balance.user_id,
            tokenId: balance.token_id,
            dbBalance: balance.db_balance,
            onChainBalance: verified.onChain
          });
        }
      } catch (e) {
        mismatches.push({
          userId: balance.user_id,
          tokenId: balance.token_id,
          error: e instanceof Error ? e.message : 'Verification failed'
        });
      }
    }

    return [{
      checkName: 'ledger_balances',
      status: mismatches.length > 0 ? 'FAIL' : 'PASS',
      mismatches: mismatches.length,
      severity: mismatches.length > 0 ? 'P1' : 'P0',
      details: { mismatches },
      timestamp: new Date()
    }];
  }

  // ============================================================
  // NEW FINANCIAL & CARBON LEDGER CHECKS
  // ============================================================

  async checkFinancialLedgerIntegrity(): Promise<ReconciliationResult[]> {
    // 1. Journal entry balance: Σ debits = Σ credits per entry
    const { rows: unbalanced } = await query(
      `SELECT je.entry_id, 
              SUM(jl.debit_amount) as total_debit,
              SUM(jl.credit_amount) as total_credit
       FROM journal_entries je
       JOIN journal_lines jl ON jl.entry_id = je.entry_id
       GROUP BY je.entry_id
       HAVING SUM(jl.debit_amount) != SUM(jl.credit_amount)`
    );
    
    // 2. Account balance matches journal lines
    const { rows: balanceMismatch } = await query(
      `SELECT ab.account_id, ab.balance as materialized,
              COALESCE(SUM(jl.credit_amount) - SUM(jl.debit_amount), 0) as computed
       FROM account_balances ab
       LEFT JOIN journal_lines jl ON jl.account_id = ab.account_id
       GROUP BY ab.account_id, ab.balance
       HAVING ab.balance != COALESCE(SUM(jl.credit_amount) - SUM(jl.debit_amount), 0)`
    );
    
    // 3. User INR balance matches Customer Deposits liability
    const { rows: userBalanceMismatch } = await query(
      `SELECT u.id, u.inr_balance as user_balance,
              ab.balance as ledger_balance
       FROM users u
       JOIN financial_accounts fa ON fa.account_code = '2200'
       JOIN account_balances ab ON ab.account_id = fa.account_id
       WHERE u.inr_balance != ab.balance`
    );

    const allViolations = [...unbalanced, ...balanceMismatch, ...userBalanceMismatch];

    return [{
      checkName: 'financial_ledger_integrity',
      status: allViolations.length > 0 ? 'FAIL' : 'PASS',
      mismatches: allViolations.length,
      severity: allViolations.length > 0 ? 'P0' : 'P0',
      details: { 
        unbalancedEntries: unbalanced.length,
        balanceMismatches: balanceMismatch.length,
        userBalanceMismatches: userBalanceMismatch.length,
        violations: allViolations
      },
      timestamp: new Date()
    }];
  }

  async checkCarbonLedgerIntegrity(): Promise<ReconciliationResult[]> {
    // 1. Carbon journal entry balance: Σ debits = Σ credits per entry
    const { rows: unbalanced } = await query(
      `SELECT cje.entry_id, 
              SUM(cjl.debit_quantity) as total_debit,
              SUM(cjl.credit_quantity) as total_credit
       FROM carbon_journal_entries cje
       JOIN carbon_journal_lines cjl ON cjl.entry_id = cje.entry_id
       GROUP BY cje.entry_id
       HAVING SUM(cjl.debit_quantity) != SUM(cjl.credit_quantity)`
    );
    
    // 2. Carbon account balance matches journal lines
    const { rows: balanceMismatch } = await query(
      `SELECT cab.account_id, cab.balance as materialized,
              COALESCE(SUM(cjl.credit_quantity) - SUM(cjl.debit_quantity), 0) as computed
       FROM carbon_account_balances cab
       LEFT JOIN carbon_journal_lines cjl ON cjl.account_id = cab.account_id
       GROUP BY cab.account_id, cab.balance
       HAVING cab.balance != COALESCE(SUM(cjl.credit_quantity) - SUM(cjl.debit_quantity), 0)`
    );
    
    // 3. Carbon account reserved <= balance
    const { rows: reservedExceeds } = await query(
      `SELECT ca.account_id, ca.account_code, cab.balance, ca.reserved_balance
       FROM carbon_accounts ca
       JOIN carbon_account_balances cab ON cab.account_id = ca.account_id
       WHERE cab.balance < ca.reserved_balance`
    );

    const allViolations = [...unbalanced, ...balanceMismatch, ...reservedExceeds];

    return [{
      checkName: 'carbon_ledger_integrity',
      status: allViolations.length > 0 ? 'FAIL' : 'PASS',
      mismatches: allViolations.length,
      severity: allViolations.length > 0 ? 'P1' : 'P0',
      details: { 
        unbalancedEntries: unbalanced.length,
        balanceMismatches: balanceMismatch.length,
        reservedExceedsBalance: reservedExceeds.length,
        violations: allViolations
      },
      timestamp: new Date()
    }];
  }

  async checkCarbonConservation(): Promise<ReconciliationResult[]> {
    // Total issued = sum of all account balances
    const { rows: totalIssued } = await query(
      `SELECT SUM(ca.total_supply) as total_issued
       FROM carbon_assets ca`
    );
    
    const { rows: totalAccounted } = await query(
      `SELECT SUM(cab.balance) as total_accounted
       FROM carbon_account_balances cab`
    );
    
    // Per-asset conservation
    const { rows: perAsset } = await query(
      `SELECT ca.asset_id, ca.batch_code, ca.total_supply as issued,
              SUM(cab.balance) as accounted
       FROM carbon_assets ca
       LEFT JOIN carbon_accounts cacc ON cacc.batch_id = ca.id
       LEFT JOIN carbon_account_balances cab ON cab.account_id = cacc.account_id
       GROUP BY ca.asset_id, ca.batch_code, ca.total_supply
       HAVING ca.total_supply != SUM(cab.balance)`
    );

    const issued = Number(totalIssued[0]?.total_issued || 0);
    const accounted = Number(totalAccounted[0]?.total_accounted || 0);
    const conservationViolated = issued !== accounted;

    return [{
      checkName: 'carbon_conservation',
      status: conservationViolated || perAsset.length > 0 ? 'FAIL' : 'PASS',
      mismatches: perAsset.length + (conservationViolated ? 1 : 0),
      severity: (conservationViolated || perAsset.length > 0) ? 'P0' : 'P0',
      details: { 
        totalIssued: issued,
        totalAccounted: accounted,
        conservationViolated,
        perAssetViolations: perAsset.length,
        violations: perAsset
      },
      timestamp: new Date()
    }];
  }

  async checkOnChainListings(): Promise<ReconciliationResult[]> {
    // Check: Listings with onchain_listing_id actually exist on-chain
    const { rows } = await query(
      `SELECT l.listing_id, l.onchain_listing_id, l.status, l.remaining_quantity
       FROM listings l
       WHERE l.custody_type = 'onchain' 
         AND l.onchain_listing_id IS NOT NULL
         AND l.status = 'active'`
    );

    // Note: Actual on-chain verification would require RPC calls
    // This is a placeholder for the check structure
    return [{
      checkName: 'onchain_listings',
      status: 'PASS', // Would be determined by actual RPC verification
      mismatches: 0,
      severity: 'P0',
      details: { checkedCount: rows.length },
      timestamp: new Date()
    }];
  }

  async checkBlockchainEvents(): Promise<ReconciliationResult[]> {
    // Check: Unprocessed blockchain events older than threshold
    const { rows } = await query(
      `SELECT COUNT(*) as count, event_name
       FROM blockchain_events
       WHERE processing_status = 'PENDING' 
         AND created_at < NOW() - INTERVAL '1 hour'
       GROUP BY event_name`
    );

    const totalPending = rows.reduce((sum, r) => sum + Number(r.count), 0);

    return [{
      checkName: 'blockchain_events',
      status: totalPending > 0 ? 'WARN' : 'PASS',
      mismatches: totalPending,
      severity: totalPending > 100 ? 'P2' : 'P0',
      details: { pendingByEvent: rows.map(r => ({ event: r.event_name, count: Number(r.count) })) },
      timestamp: new Date()
    }];
  }

  // ============================================================
  // AUTO-REPAIR (Safe Only)
  // ============================================================

  async autoRepair(results: ReconciliationResult[]): Promise<{ repaired: number; failed: number }> {
    let repaired = 0;
    let failed = 0;

    for (const result of results) {
      if (result.mismatches === 0) continue;

      try {
        switch (result.checkName) {
          case 'listing_consistency':
            await this.repairListingReservations(result.details);
            repaired += result.mismatches;
            break;
          case 'position_integrity':
            await this.repairPositionReservations(result.details);
            repaired += result.mismatches;
            break;
          default:
            // Don't auto-repair financial data
            console.warn(`Auto-repair not implemented for ${result.checkName}`);
        }
      } catch (e) {
        failed++;
        console.error(`Auto-repair failed for ${result.checkName}:`, e);
      }
    }

    return { repaired, failed };
  }

  private async repairListingReservations(details: any): Promise<void> {
    // Recalculate position reservations from active listings
    await query(
      `UPDATE ownership_positions op
       SET reserved_quantity = COALESCE((
          SELECT SUM(l.remaining_quantity) 
          FROM listings l 
          WHERE l.position_id = op.position_id AND l.status = 'active'
        ), 0),
        updated_at = NOW()
       WHERE EXISTS (
        SELECT 1 FROM listings l 
        WHERE l.position_id = op.position_id AND l.status = 'active'
       )`
    );
  }

  private async repairPositionReservations(details: any): Promise<void> {
    // For positions with owned < reserved, set reserved = owned
    await query(
      `UPDATE ownership_positions 
       SET reserved_quantity = owned_quantity, updated_at = NOW()
       WHERE owned_quantity < reserved_quantity`
    );
  }

  private async alertCriticalMismatches(critical: ReconciliationResult[]): Promise<void> {
    // In production: send to Sentry, PagerDuty, Slack, etc.
    console.error('[RECONCILIATION ALERT] Critical mismatches detected:', 
      critical.map(c => ({ check: c.checkName, mismatches: c.mismatches, severity: c.severity }))
    );
  }
}

export interface ReconciliationResult {
  checkName: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'ERROR';
  mismatches: number;
  severity: ReconciliationSeverity;
  details: Record<string, any>;
  timestamp: Date;
}

export type ReconciliationSeverity = 'P0' | 'P1' | 'P2';