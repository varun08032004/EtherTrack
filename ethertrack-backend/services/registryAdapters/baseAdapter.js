// services/registryAdapters/baseAdapter.js
//
// Base class for all voluntary-market registry adapters (Verra, Gold
// Standard, ACR, CAR, Puro...). NOT used for India CCTS/CCC — that's a
// different regulatory universe (CERC-registered Power Exchanges), see
// services/minter.js for why compliance-type credits never reach here.
//
// Design principle: don't assume every registry can do everything. Most
// voluntary registries have no public API today — Verra/GS/ACR/CAR all
// require partnership agreements or manual workflows; only a handful
// (Puro is the best-documented example) expose anything a server can call
// directly. So each adapter DECLARES what it can actually do, and the
// verification engine branches on that instead of every adapter needing
// to fake-implement methods it can't really support.

const CAPABILITY = Object.freeze({
  API:         'api',          // real automated call against the registry
  MANUAL:      'manual',       // admin has to check by hand (registry page, PDF, email)
  UNAVAILABLE: 'unavailable',  // not supported by this registry at all
});

const STATUS = Object.freeze({
  ACTIVE:  'ACTIVE',
  RETIRED: 'RETIRED',
  LOCKED:  'LOCKED',
  UNKNOWN: 'UNKNOWN',
});

const CONFIDENCE = Object.freeze({
  VERIFIED_API:    'VERIFIED_API',
  VERIFIED_MANUAL: 'VERIFIED_MANUAL',
  UNVERIFIED:      'UNVERIFIED',
});

// How long a check should be trusted before it needs re-verification.
// A credit checked ACTIVE today can be retired/resold next week if you
// don't actually hold a lock on it — so nothing here is "checked once,
// trusted forever". Re-verification should be scheduled (cron), same
// pattern as your existing KYC-renewal flow.
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

class BaseRegistryAdapter {
  constructor() {
    if (new.target === BaseRegistryAdapter) {
      throw new Error('BaseRegistryAdapter is abstract — extend it per registry.');
    }

    // Every adapter MUST declare capabilities. Default: nothing is
    // automated. Subclasses override only what they actually support.
    this.capabilities = {
      verifyCredit: CAPABILITY.MANUAL,
      getOwner:     CAPABILITY.MANUAL,
      getStatus:    CAPABILITY.MANUAL,
      isRetired:    CAPABILITY.MANUAL,
      lockCredit:   CAPABILITY.UNAVAILABLE, // true for every voluntary registry today
    };
  }

  /** @returns {string} short machine-readable name, e.g. 'verra', 'puro' */
  get name() {
    throw new Error('Adapter must implement get name()');
  }

  /**
   * Normalized envelope every adapter method should return — same shape
   * regardless of which registry answered, so callers (admin panel, DB
   * writes, audit log) never need registry-specific branching.
   */
  _envelope({ serialNumber, status = STATUS.UNKNOWN, confidence = CONFIDENCE.UNVERIFIED,
              raw = null, notes = '' }) {
    return {
      serialNumber,
      status,
      confidence,
      source: this.name,
      checkedAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
      raw,   // untouched registry response, if any — useful for audit trail
      notes, // human-readable, e.g. "no public API — admin must verify manually"
    };
  }

  /**
   * Format-level validation only (regex on serial number pattern etc).
   * This is cheap and can run for EVERY adapter regardless of capability
   * tier — it's the "shrink what the human checks" layer even when full
   * automated verification isn't possible.
   * Subclasses should override `serialPattern`.
   */
  validateSerialFormat(serialNumber) {
    if (!this.serialPattern) return { valid: true, reason: 'no pattern defined' };
    const valid = this.serialPattern.test(String(serialNumber || '').trim());
    return { valid, reason: valid ? 'format ok' : `does not match ${this.name} serial pattern` };
  }

  // ── Methods every adapter *may* implement — base class returns a
  // MANUAL/UNVERIFIED envelope with clear instructions so calling code
  // never has to guess why nothing automated happened. ─────────────────

  async verifyCredit(serialNumber) {
    return this._envelope({
      serialNumber,
      confidence: CONFIDENCE.UNVERIFIED,
      notes: `${this.name}: no automated verification available — admin must check the registry directly.`,
    });
  }

  async getOwner(serialNumber) {
    return this._envelope({
      serialNumber,
      confidence: CONFIDENCE.UNVERIFIED,
      notes: `${this.name}: owner lookup not automated — verify against uploaded ownership proof manually.`,
    });
  }

  async getStatus(serialNumber) {
    return this._envelope({
      serialNumber,
      status: STATUS.UNKNOWN,
      confidence: CONFIDENCE.UNVERIFIED,
      notes: `${this.name}: status lookup not automated.`,
    });
  }

  async isRetired(serialNumber) {
    return this._envelope({
      serialNumber,
      status: STATUS.UNKNOWN,
      confidence: CONFIDENCE.UNVERIFIED,
      notes: `${this.name}: retirement check not automated — cross-check registry's public retirement list manually.`,
    });
  }

  /**
   * lockCredit() is intentionally NOT implemented by the base class and
   * should stay that way for every voluntary registry adapter until one
   * of them actually ships a real lock/immobilization API. Do not stub
   * this to silently succeed — a fake lock is worse than no lock, because
   * it gives false confidence that double-selling has been prevented.
   */
  async lockCredit() {
    throw new Error(
      `${this.name}: lockCredit() is not available for this registry. ` +
      `Double-selling prevention currently relies on EtherTrack's own ` +
      `serial-number uniqueness check + public attestation ledger, not a ` +
      `registry-side lock. Do not implement a fake success here.`
    );
  }
}

module.exports = { BaseRegistryAdapter, CAPABILITY, STATUS, CONFIDENCE };