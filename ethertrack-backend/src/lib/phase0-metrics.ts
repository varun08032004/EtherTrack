// Phase 0 Observability Metrics
// Additional Prometheus metrics for Phase 0 critical paths

import { Counter, Gauge, Histogram, Registry } from 'prom-client';

const register = new Registry();

// Financial Ledger Metrics
export const financialJournalEntriesTotal = new Counter({
  name: 'ethertrack_financial_journal_entries_total',
  help: 'Total journal entries created',
  labelNames: ['reference_type', 'status'],
  registers: [register]
});

export const financialJournalImbalanceTotal = new Counter({
  name: 'ethertrack_financial_journal_imbalance_total',
  help: 'Journal entries with debit != credit',
  labelNames: ['reference_type'],
  registers: [register]
);

export const accountBalanceNegativeTotal = new Counter({
  name: 'ethertrack_account_balance_negative_total',
  help: 'Accounts with negative balance',
  labelNames: ['account_type'],
  registers: [register]
);

export const financialJournalEntryDuration = new Histogram({
  name: 'ethertrack_financial_journal_entry_duration_seconds',
  help: 'Time to create journal entry',
  labelNames: ['reference_type'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register]
});

// Carbon Ledger Metrics
export const carbonJournalEntriesTotal = new Counter({
  name: 'ethertrack_carbon_journal_entries_total',
  help: 'Total carbon journal entries created',
  labelNames: ['reference_type'],
  registers: [register]
});

export const carbonConservationViolationTotal = new Counter({
  name: 'ethertrack_carbon_conservation_violation_total',
  help: 'Carbon conservation violations detected',
  labelNames: ['asset_id'],
  registers: [register]
});

export const carbonAccountNegativeTotal = new Counter({
  name: 'ethertrack_carbon_account_negative_total',
  help: 'Carbon accounts with negative balance',
  labelNames: ['account_type'],
  registers: [register]
);

export const carbonAccountReservedExceedsBalanceTotal = new Counter({
  name: 'ethertrack_carbon_account_reserved_exceeds_balance_total',
  help: 'Carbon accounts where reserved > balance',
  registers: [register]
});

export const carbonJournalEntryDuration = new Histogram({
  name: 'ethertrack_carbon_journal_entry_duration_seconds',
  help: 'Time to create carbon journal entry',
  labelNames: ['reference_type'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register]
});

// Settlement Metrics
export const settlementStateTransitionsTotal = new Counter({
  name: 'ethertrack_settlement_state_transitions_total',
  help: 'Settlement state transitions',
  labelNames: ['from_state', 'to_state', 'result'],
  registers: [register]
);

export const settlementCompensationsTotal = new Counter({
  name: 'ethertrack_settlement_compensations_total',
  help: 'Settlement compensations executed',
  labelNames: ['failure_point', 'result'],
  registers: [register]
);

export const settlementRequiresReconciliationTotal = new Counter({
  name: 'ethertrack_settlement_requires_reconciliation_total',
  help: 'Trades requiring manual reconciliation',
  labelNames: ['reason'],
  registers: [register]
);

export const settlementDuration = new Histogram({
  name: 'ethertrack_settlement_duration_seconds',
  help: 'Time to complete settlement',
  labelNames: ['payment_mode', 'custody_type'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 300],
  registers: [register]
);

// KYC Metrics
export const kycBypassAttemptsTotal = new Counter({
  name: 'ethertrack_kyc_bypass_attempts_total',
  help: 'KYC bypass attempts blocked',
  labelNames: ['attempt_type'],
  registers: [register]
);

export const kycVerificationDuration = new Histogram({
  name: 'ethertrack_kyc_verification_duration_seconds',
  help: 'Time to verify KYC on-chain',
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [register]
});

// Reconciliation Metrics
export const reconciliationMismatchesTotal = new Counter({
  name: 'ethertrack_reconciliation_mismatches_total',
  help: 'Reconciliation mismatches by type',
  labelNames: ['check_name', 'severity'],
  registers: [register]
);

export const reconciliationDuration = new Histogram({
  name: 'ethertrack_reconciliation_duration_seconds',
  help: 'Time to run reconciliation checks',
  labelNames: ['check_name'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
  registers: [register]
};

export const reconciliationAutoRepairTotal = new Counter({
  name: 'ethertrack_reconciliation_auto_repair_total',
  help: 'Auto-repairs executed',
  labelNames: ['check_name', 'result'],
  registers: [register]
);

// State Machine Metrics
export const carbonStateTransitionsTotal = new Counter({
  name: 'ethertrack_carbon_state_transitions_total',
  help: 'Carbon asset state transitions',
  labelNames: ['from_state', 'to_state', 'result'],
  registers: [register]
);

export const carbonInvalidTransitionAttemptsTotal = new Counter({
  name: 'ethertrack_carbon_invalid_transition_attempts_total',
  help: 'Invalid state transition attempts blocked',
  labelNames: ['from_state', 'to_state'],
  registers: [register]
);

// Idempotency Metrics
export const idempotencyReplayTotal = new Counter({
  name: 'ethertrack_idempotency_replay_total',
  help: 'Idempotent replay requests',
  labelNames: ['endpoint', 'result'],
  registers: [register]
);

// Reconciliation Auto-Repair
export const reconciliationAutoRepairTotal = new Counter({
  name: 'ethertrack_reconciliation_auto_repair_total',
  help: 'Auto-repairs executed',
  labelNames: ['check_name', 'result'],
  registers: [register]
);

// Export register for Prometheus scraping
export { register };

// Helper function to record metrics
export function recordFinancialJournalEntry(referenceType: string, balanced: boolean, durationMs: number) {
  financialJournalEntriesTotal.inc({ reference_type: referenceType, status: balanced ? 'balanced' : 'unbalanced' });
  if (!balanced) {
    financialJournalImbalanceTotal.inc({ reference_type: referenceType });
  }
  financialJournalEntryDuration.observe({ reference_type: referenceType }, durationMs / 1000);
}

export function recordCarbonJournalEntry(referenceType: string, balanced: boolean, durationMs: number) {
  carbonJournalEntriesTotal.inc({ reference_type: referenceType });
  if (!balanced) {
    carbonConservationViolationTotal.inc({ asset_id: 'unknown' });
  }
  carbonJournalEntryDuration.observe({ reference_type: referenceType }, durationMs / 1000);
}

export function recordSettlementTransition(fromState: string, toState: string, success: boolean, durationMs: number) {
  settlementStateTransitionsTotal.inc({ from_state: fromState, to_state: toState, result: success ? 'success' : 'failure' });
  settlementDuration.observe({ payment_mode: 'unknown', custody_type: 'unknown' }, durationMs / 1000);
}

export function recordSettlementCompensation(failurePoint: string, success: boolean) {
  settlementCompensationsTotal.inc({ failure_point: failurePoint, result: success ? 'success' : 'failure' });
}

export function recordSettlementRequiresReconciliation(reason: string) {
  settlementRequiresReconciliationTotal.inc({ reason });
}

export function recordKYCBypassAttempt(attemptType: string) {
  kycBypassAttemptsTotal.inc({ attempt_type: attemptType });
}

export function recordKYCVerification(durationMs: number) {
  kycVerificationDuration.observe(durationMs / 1000);
}

export function recordReconciliationMismatch(checkName: string, severity: string) {
  reconciliationMismatchesTotal.inc({ check_name: checkName, severity });
}

export function recordReconciliationDuration(checkName: string, durationMs: number) {
  reconciliationDuration.observe({ check_name: checkName }, durationMs / 1000);
}

export function recordReconciliationAutoRepair(checkName: string, success: boolean) {
  reconciliationAutoRepairTotal.inc({ check_name: checkName, result: success ? 'success' : 'failure' });
}

export function recordCarbonStateTransition(fromState: string, toState: string, success: boolean) {
  carbonStateTransitionsTotal.inc({ from_state: fromState, to_state: toState, result: success ? 'success' : 'blocked' });
  if (!success) {
    carbonInvalidTransitionAttemptsTotal.inc({ from_state: fromState, to_state: toState });
  }
}

export function recordIdempotencyReplay(endpoint: string, isReplay: boolean) {
  idempotencyReplayTotal.inc({ endpoint, result: isReplay ? 'replay' : 'new' });
}

export function recordReconciliationAutoRepair(checkName: string, success: boolean) {
  reconciliationAutoRepairTotal.inc({ check_name: checkName, result: success ? 'success' : 'failure' });
}