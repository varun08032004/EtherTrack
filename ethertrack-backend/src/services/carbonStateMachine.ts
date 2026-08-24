// Carbon Asset State Machine Enforcement Service
// Enforces valid state transitions for carbon assets

import { safeQuery as query, withTransaction } from '../../db/pool.js';
import { CarbonAssetLifecycleState, CarbonStateTransition } from '../../domain/types';

export class CarbonStateMachineService {
  // Valid state transitions from the database
  private static validTransitions: Map<CarbonAssetLifecycleState, CarbonAssetLifecycleState[]> = new Map([
    ['CREATED', ['VERIFIED', 'CANCELLED']],
    ['VERIFIED', ['ISSUED', 'CANCELLED']],
    ['ISSUED', ['OWNED', 'CANCELLED']],
    ['OWNED', ['LISTED', 'RESERVED', 'TRANSFERRED', 'RETIRED', 'CANCELLED']],
    ['LISTED', ['OWNED', 'RESERVED', 'EXPIRED', 'CANCELLED']],
    ['RESERVED', ['SETTLED', 'CANCELLED']],
    ['SETTLED', ['OWNED', 'CANCELLED']],
    ['TRANSFERRED', ['CANCELLED']],
    ['RETIRED', []],  // Terminal state
    ['EXPIRED', ['CANCELLED']],
    ['CANCELLED', []]  // Terminal state
  ]);

  /**
   * Check if a state transition is valid
   */
  static isValidTransition(fromState: CarbonAssetLifecycleState, toState: CarbonAssetLifecycleState): boolean {
    const allowed = this.validTransitions.get(fromState) || [];
    return allowed.includes(toState);
  }

  /**
   * Get allowed next states for a given state
   */
  static getAllowedNextStates(state: CarbonAssetLifecycleState): CarbonAssetLifecycleState[] {
    return this.validTransitions.get(state) || [];
  }

  /**
   * Check if a state is terminal (no further transitions allowed)
   */
  static isTerminalState(state: CarbonAssetLifecycleState): boolean {
    const allowed = this.validTransitions.get(state) || [];
    return allowed.length === 0;
  }

  /**
   * Execute a state transition with validation and audit logging
   */
  async transitionState(
    batchId: string,
    fromState: CarbonAssetLifecycleState,
    toState: CarbonAssetLifecycleState,
    transitionedBy: string,
    reason?: string,
    sideEffect?: string
  ): Promise<void> {
    // Validate transition
    if (!CarbonStateMachineService.isValidTransition(fromState, toState)) {
      throw new Error(`Invalid state transition: ${fromState} -> ${toState}`);
    }

    // Check current state in database matches expected fromState
    const { rows: current } = await query(
      `SELECT current_state FROM carbon_asset_lifecycle WHERE batch_id = $1`,
      [batchId]
    );

    if (current.length === 0) {
      // Create new lifecycle record if none exists
      if (fromState !== 'CREATED') {
        throw new Error(`Asset lifecycle not found for batch ${batchId}. Expected initial state CREATED.`);
      }
    } else if (current[0].current_state !== fromState) {
      throw new Error(
        `State mismatch: expected ${fromState}, found ${current[0].current_state} for batch ${batchId}`
      );
    }

    // Execute transition in transaction
    await withTransaction(async (client) => {
      // Update lifecycle record
      if (current.length === 0) {
        await client.query(
          `INSERT INTO carbon_asset_lifecycle (batch_id, current_state, previous_state, transitioned_by, reason)
           VALUES ($1, $2, $3, $4, $5)`,
          [batchId, toState, fromState, transitionedBy, reason || 'Initial creation']
        );
      } else {
        await client.query(
          `UPDATE carbon_asset_lifecycle
           SET current_state = $1, previous_state = $2, transitioned_at = NOW(), transitioned_by = $3, reason = $4
           WHERE batch_id = $5`,
          [toState, fromState, transitionedBy, reason, batchId]
        );
      }

      // Log the transition
      await client.query(
        `INSERT INTO carbon_state_transition_log (batch_id, from_state, to_state, transitioned_by, reason, side_effect, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [batchId, fromState, toState, transitionedBy, reason, sideEffect || null]
      );
    });
  }

  /**
   * Get current state of an asset
   */
  async getCurrentState(batchId: string): Promise<CarbonAssetLifecycleState | null> {
    const { rows } = await query(
      `SELECT current_state FROM carbon_asset_lifecycle WHERE batch_id = $1`,
      [batchId]
    );
    return rows[0]?.current_state || null;
  }

  /**
   * Get transition history for an asset
   */
  async getTransitionHistory(batchId: string): Promise<CarbonStateTransition[]> {
    const { rows } = await query(
      `SELECT from_state, to_state, transitioned_by, reason, side_effect, created_at
       FROM carbon_state_transition_log
       WHERE batch_id = $1
       ORDER BY created_at ASC`,
      [batchId]
    );
    return rows.map(r => ({
      fromState: r.from_state,
      toState: r.to_state,
      transitionedBy: r.transitioned_by,
      reason: r.reason,
      sideEffect: r.side_effect,
      timestamp: r.created_at
    }));
  }

  /**
   * Validate that a batch can be listed (must be in OWNED state)
   */
  async validateCanList(batchId: string): Promise<void> {
    const currentState = await this.getCurrentState(batchId);
    if (currentState !== 'OWNED') {
      throw new Error(`Cannot list batch: must be in OWNED state, currently ${currentState}`);
    }
  }

  /**
   * Validate that a batch can be delisted (must be in LISTED state)
   */
  async validateCanDelist(batchId: string): Promise<void> {
    const currentState = await this.getCurrentState(batchId);
    if (currentState !== 'LISTED') {
      throw new Error(`Cannot delist batch: must be in LISTED state, currently ${currentState}`);
    }
  }

  /**
   * Validate that a batch can be traded (must be in LISTED or RESERVED state)
   */
  async validateCanTrade(batchId: string): Promise<void> {
    const currentState = await this.getCurrentState(batchId);
    if (currentState !== 'LISTED' && currentState !== 'RESERVED') {
      throw new Error(`Cannot trade batch: must be in LISTED or RESERVED state, currently ${currentState}`);
    }
  }

  /**
   * Validate that a batch can be retired (must be in OWNED state)
   */
  async validateCanRetire(batchId: string): Promise<void> {
    const currentState = await this.getCurrentState(batchId);
    if (currentState !== 'OWNED') {
      throw new Error(`Cannot retire batch: must be in OWNED state, currently ${currentState}`);
    }
  }

  /**
   * Validate that a batch can be transferred to wallet (must be in OWNED state)
   */
  async validateCanWithdrawToWallet(batchId: string): Promise<void> {
    const currentState = await this.getCurrentState(batchId);
    if (currentState !== 'OWNED') {
      throw new Error(`Cannot withdraw batch: must be in OWNED state, currently ${currentState}`);
    }
  }
}

export default CarbonStateMachineService;