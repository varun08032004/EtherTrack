// lib/circuitBreaker.js — EtherTrack
// Circuit breaker pattern for external API resilience
'use strict';

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 30000; // 30s default
    this.fallback = options.fallback || null;
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.nextAttempt = Date.now();
  }

  async execute(operation) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        const err = new Error(`${this.name} circuit breaker is OPEN`);
        err.code = 'CIRCUIT_OPEN';
        err.retryAfter = Math.ceil((this.nextAttempt - Date.now()) / 1000);
        throw err;
      }
      // Transition to HALF_OPEN
      this.state = 'HALF_OPEN';
      this.successes = 0;
    }

    try {
      const result = await Promise.race([
        operation(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`${this.name} operation timeout`)), this.timeout)
        )
      ]);
      
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  onSuccess() {
    this.failures = 0;
    this.lastFailureTime = null;
    
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this.state = 'CLOSED';
        this.successes = 0;
        console.log(`[CircuitBreaker] ${this.name}: CLOSED (recovered)`);
      }
    }
  }

  onFailure(err) {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.state === 'HALF_OPEN') {
      // Any failure in HALF_OPEN goes back to OPEN
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
      console.warn(`[CircuitBreaker] ${this.name}: OPEN (failure in HALF_OPEN)`);
    } else if (this.state === 'CLOSED' && this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
      console.warn(`[CircuitBreaker] ${this.name}: OPEN (threshold reached: ${this.failures})`);
    }
  }

  getState() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      nextAttempt: this.state === 'OPEN' ? this.nextAttempt : null,
      retryAfter: this.state === 'OPEN' ? Math.ceil((this.nextAttempt - Date.now()) / 1000) : 0
    };
  }

  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.nextAttempt = Date.now();
  }

  forceOpen() {
    this.state = 'OPEN';
    this.nextAttempt = Date.now() + this.timeout;
  }
}

// Registry for all circuit breakers
const breakers = new Map();

function getBreaker(name, options) {
  if (!breakers.has(name)) {
    breakers.set(name, new CircuitBreaker(name, options));
  }
  return breakers.get(name);
}

function getAllStates() {
  const states = {};
  for (const [name, breaker] of breakers) {
    states[name] = breaker.getState();
  }
  return states;
}

function resetAll() {
  for (const breaker of breakers.values()) {
    breaker.reset();
  }
}

module.exports = {
  CircuitBreaker,
  getBreaker,
  getAllStates,
  resetAll
};