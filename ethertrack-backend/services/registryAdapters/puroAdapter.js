// services/registryAdapters/puroAdapter.js
//
// Puro.earth — best-documented public API among the voluntary registries,
// so this is the one adapter worth wiring to a real endpoint first. Until
// EtherTrack actually has partner/API credentials from Puro, this stays in
// 'manual' mode for the live calls but with the format-validation layer
// active — flip PURO_API_KEY in env once credentials exist and the
// capability flags below switch the engine over automatically.

const { BaseRegistryAdapter, CAPABILITY, STATUS, CONFIDENCE } = require('./baseAdapter');

const PURO_API_BASE = process.env.PURO_API_BASE_URL || 'https://api.puro.earth'; // placeholder — confirm real base URL before enabling
const PURO_API_KEY  = process.env.PURO_API_KEY || null;

class PuroAdapter extends BaseRegistryAdapter {
  constructor() {
    super();
    this.serialPattern = /^PURO-[A-Z0-9-]{4,40}$/i; // placeholder pattern — confirm against real Puro serials

    const hasCreds = Boolean(PURO_API_KEY);
    this.capabilities = {
      verifyCredit: hasCreds ? CAPABILITY.API : CAPABILITY.MANUAL,
      getOwner:     hasCreds ? CAPABILITY.API : CAPABILITY.MANUAL,
      getStatus:    hasCreds ? CAPABILITY.API : CAPABILITY.MANUAL,
      isRetired:    hasCreds ? CAPABILITY.API : CAPABILITY.MANUAL,
      lockCredit:   CAPABILITY.UNAVAILABLE, // no immobilization API from Puro today
    };
  }

  get name() { return 'puro'; }

  async verifyCredit(serialNumber) {
    const fmt = this.validateSerialFormat(serialNumber);
    if (!fmt.valid) {
      return this._envelope({
        serialNumber, status: STATUS.UNKNOWN, confidence: CONFIDENCE.UNVERIFIED,
        notes: `puro: ${fmt.reason}`,
      });
    }

    if (this.capabilities.verifyCredit !== CAPABILITY.API) {
      return this._envelope({
        serialNumber, confidence: CONFIDENCE.UNVERIFIED,
        notes: 'puro: PURO_API_KEY not configured — admin must verify against puro.earth registry manually. Format check passed.',
      });
    }

    try {
      const res = await fetch(`${PURO_API_BASE}/v1/credits/${encodeURIComponent(serialNumber)}`, {
        headers: { Authorization: `Bearer ${PURO_API_KEY}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return this._envelope({
          serialNumber, confidence: CONFIDENCE.UNVERIFIED,
          notes: `puro: API returned ${res.status} — fall back to manual verification, do not assume valid.`,
        });
      }
      const data = await res.json();
      return this._envelope({
        serialNumber,
        status: data.retired ? STATUS.RETIRED : STATUS.ACTIVE,
        confidence: CONFIDENCE.VERIFIED_API,
        raw: data,
        notes: 'puro: verified via API.',
      });
    } catch (err) {
      return this._envelope({
        serialNumber, confidence: CONFIDENCE.UNVERIFIED,
        notes: `puro: API call failed (${err.message}) — fall back to manual verification.`,
      });
    }
  }

  // getOwner / getStatus / isRetired: same shape as verifyCredit above.
  // Left as base-class MANUAL fallback until real endpoint paths are
  // confirmed from Puro's docs — don't guess at endpoint shapes for
  // owner/status separately from verifyCredit without checking their
  // actual API reference first.
}

module.exports = PuroAdapter;