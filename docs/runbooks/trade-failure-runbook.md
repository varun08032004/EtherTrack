# Trade Failure Runbook

## Overview
This runbook covers common trade failure scenarios in the EtherTrack settlement engine and their resolution procedures.

## Trade State Machine

```
CREATED → VALIDATED → FUNDS_RESERVED → CREDITS_RESERVED → SETTLEMENT_PENDING
                                                        ↓
CREDIT_TRANSFER_SUBMITTED → CREDIT_TRANSFER_CONFIRMED → PAYMENT_SETTLED
                                                        ↓
FEES_COLLECTED → SELLER_PAID → BUYER_CREDITED → SETTLED
```

## Failure Scenarios & Resolution

### 1. Payment Capture Failure (Razorpay)
**State**: `FUNDS_RESERVED` or `CREDITS_RESERVED`
**Symptoms**: `payment.failed` webhook received, trade stuck
**Resolution**:
```bash
# Auto-refund triggered by compensation engine
# Check dead-letter queue if compensation fails
# Manual: Refund buyer INR wallet, release listing
```

### 2. Credit Transfer Failure (On-chain)
**State**: `CREDIT_TRANSFER_SUBMITTED` or `CREDIT_TRANSFER_CONFIRMED`
**Symptoms**: `chain_status = 'failed'`, `REQUIRES_RECONCILIATION`
**Resolution**:
```bash
# Check on-chain transaction status
# If pending: wait for confirmation
# If failed: retry credit transfer via CreditTransferService
# If partial: add to dead-letter queue for manual review
```

### 3. Payment Settled but Credit Transfer Failed
**State**: `PAYMENT_SETTLED` or `FEES_COLLECTED`
**Symptoms**: Buyer paid, seller not paid, credits not transferred
**Resolution**:
```bash
# CRITICAL: Money moved but credits not transferred
# 1. Verify on-chain status
# 2. If credit transfer failed: retry via CreditTransferService
# 3. If manual intervention needed: add to dead-letter queue
# 4. Alert finance team for manual settlement
```

### 4. Stuck Trades (No Progress > 30 min)
**States**: Any intermediate state
**Detection**: Monitoring cron alerts Sentry
**Resolution**:
```bash
# 1. Check settlement_state in trades table
# 2. Run retry cron: node cron/retry-stuck-trades.js
# 3. If retry fails: escalate to on-call engineer
```

## Dead Letter Queue Operations

### View Failed Compensations
```sql
SELECT * FROM compensation_dead_letter WHERE resolved_at IS NULL ORDER BY created_at DESC;
```

### Retry Failed Compensation
```bash
node -e "
const { retryDeadLetter } = require('./services/compensationDeadLetter');
retryDeadLetter('<entry-id>').then(console.log);
"
```

### Mark Resolved
```sql
UPDATE compensation_dead_letter 
SET resolved_at = NOW(), resolved_by = '<user-id>', resolution_notes = 'Manually settled'
WHERE id = '<entry-id>';
```

## Reconciliation Procedures

### Daily Reconciliation (Automated)
- Runs hourly via `reconcileAllBalances()` in creditLedger
- Alerts on mismatches via Sentry

### Manual Reconciliation
```bash
# 1. Run full reconciliation
node -e "require('./services/creditLedger').reconcileAllBalances().then(console.log)"

# 2. Check specific user/token
node -e "
const { verifyLedgerBalance } = require('./services/creditLedger');
verifyLedgerBalance('<user-id>', <token-id>).then(console.log);
"

# 3. Fix mismatch (DB → on-chain)
UPDATE credit_ledger_balances SET balance = <onchain_value> WHERE user_id = '<id>' AND token_id = <token>;
```

## Escalation Contacts

| Issue | Primary | Secondary |
|-------|---------|-----------|
| Payment failures | Payment team | Finance lead |
| Credit transfer failures | Blockchain engineer | CTO |
| Reconciliation mismatches | Data engineer | CTO |
| Dead-letter queue buildup | On-call engineer | Engineering lead |

## Monitoring Dashboards

- **Grafana**: `ethertrack-trades` dashboard
- **Sentry**: `ethertrack-backend` project
- **Logs**: `grep "settlement" /var/log/ethertrack/*.log`

## Quick Reference Commands

```bash
# Check stuck trades
psql -c "SELECT settlement_state, COUNT(*) FROM trades WHERE settlement_state NOT IN ('SETTLED','FAILED') GROUP BY settlement_state;"

# View dead-letter queue
psql -c "SELECT * FROM compensation_dead_letter WHERE resolved_at IS NULL;"

# Run retry cron manually
node cron/retry-stuck-trades.js

# Run reconciliation manually
node -e "require('./services/creditLedger').reconcileAllBalances().then(console.log)"

# Verify specific trade
psql -c "SELECT * FROM trades WHERE id = '<trade-id>';"
psql -c "SELECT * FROM settlement_operations WHERE trade_id = '<trade-id>' ORDER BY started_at;"
```