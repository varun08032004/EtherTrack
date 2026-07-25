// services/registryAdapters/acrAdapter.js
// American Carbon Registry — manual tier, same reasoning as verraAdapter.js.

const { BaseRegistryAdapter, CAPABILITY, STATUS, CONFIDENCE } = require('./baseAdapter');

class AcrAdapter extends BaseRegistryAdapter {
  constructor() {
    super();
    this.serialPattern = /^ACR[A-Z0-9-]{3,60}$/i; // placeholder — confirm against real ACR serials

    this.capabilities = {
      verifyCredit: CAPABILITY.MANUAL,
      getOwner:     CAPABILITY.MANUAL,
      getStatus:    CAPABILITY.MANUAL,
      isRetired:    CAPABILITY.MANUAL,
      lockCredit:   CAPABILITY.UNAVAILABLE,
    };
  }

  get name() { return 'acr'; }

  async verifyCredit(serialNumber) {
    const fmt = this.validateSerialFormat(serialNumber);
    return this._envelope({
      serialNumber,
      status: STATUS.UNKNOWN,
      confidence: CONFIDENCE.UNVERIFIED,
      notes: fmt.valid
        ? 'acr: format check passed. No public API — admin must cross-check acr2.apx.com manually.'
        : `acr: ${fmt.reason} — flag for admin review.`,
    });
  }
}

module.exports = AcrAdapter;