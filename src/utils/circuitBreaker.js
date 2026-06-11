

/**
 * utils/circuitBreaker.js
 *
 * Lightweight circuit breaker for external API calls.
 *
 * States:
 *   CLOSED    → normal, requests pass through
 *   OPEN      → circuit tripped, requests fail fast
 *   HALF_OPEN → one probe request allowed after open duration
 *
 * Usage:
 *   const cb = createCircuitBreaker('eth-rate', { threshold: 3, openMs: 60_000 });
 *   const data = await cb.call(() => apiFetch('/api/rates/eth-inr'));
 */

const STATE = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

/**
 * @param {string} name - identifier for logging
 * @param {{ threshold?: number, openMs?: number }} opts
 */
export function createCircuitBreaker(name, { threshold = 3, openMs = 60_000 } = {}) {
  let state      = STATE.CLOSED;
  let failures   = 0;
  let openedAt   = 0;

  function trip() {
    state    = STATE.OPEN;
    openedAt = Date.now();
    console.warn(`[CircuitBreaker:${name}] OPEN after ${failures} failures`);
  }

  function reset() {
    state    = STATE.CLOSED;
    failures = 0;
  }

  return {
    get state() { return state; },

    async call(fn) {
      // Transition OPEN → HALF_OPEN after cooldown
      if (state === STATE.OPEN) {
        if (Date.now() - openedAt >= openMs) {
          state = STATE.HALF_OPEN;
        } else {
          throw new Error(`circuit-open:${name}`);
        }
      }

      try {
        const result = await fn();
        // Success → reset
        if (state === STATE.HALF_OPEN) {
          console.info(`[CircuitBreaker:${name}] CLOSED (probe succeeded)`);
        }
        reset();
        return result;
      } catch (err) {
        // Don't count auth/session errors against the breaker
        if (err?.message === 'session-expired') throw err;

        failures++;
        if (state === STATE.HALF_OPEN || failures >= threshold) {
          trip();
        }
        throw err;
      }
    },
  };
}