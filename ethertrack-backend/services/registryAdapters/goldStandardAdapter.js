// services/registryAdapters/goldStandardAdapter.js
// Same tier as Verra today — no public verification API. See verraAdapter.js
// for the reasoning. Gold Standard is #2 on the outreach list (after Puro)
// since it's historically been more open to integration conversations —
// flip this adapter's capabilities to 'api' if/when that materializes.

const { BaseRegistryAdapter, CAPABILITY, STATUS, CONFIDENCE } = require('./baseAdapter');

class GoldStandardAdapter extends BaseRegistryAdapter {
  constructor() {
    super();
    this.serialPattern = /^GS[A-Z0-9-]{4,60}$/i; // placeholder — confirm against real GS serials

    this.capabilities = {
      verifyCredit: CAPABILITY.MANUAL,
      getOwner:     CAPABILITY.MANUAL,
      getStatus:    CAPABILITY.MANUAL,
      isRetired:    CAPABILITY.MANUAL,
      lockCredit:   CAPABILITY.UNAVAILABLE,
    };
  }

  get name() { return 'gold_standard'; }

  async verifyCredit(serialNumber) {
    const fmt = this.validateSerialFormat(serialNumber);
    return this._envelope({
      serialNumber,
      status: STATUS.UNKNOWN,
      confidence: CONFIDENCE.UNVERIFIED,
      notes: fmt.valid
        ? 'gold_standard: format check passed. No public API — admin must cross-check registry.goldstandard.org manually.'
        : `gold_standard: ${fmt.reason} — flag for admin review.`,
    });
  }
}

module.exports = GoldStandardAdapter;