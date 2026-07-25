// services/registryAdapters/carAdapter.js
// Climate Action Reserve — manual tier, same reasoning as verraAdapter.js.

const { BaseRegistryAdapter, CAPABILITY, STATUS, CONFIDENCE } = require('./baseAdapter');

class CarAdapter extends BaseRegistryAdapter {
  constructor() {
    super();
    this.serialPattern = /^CAR[A-Z0-9-]{3,60}$/i; // placeholder — confirm against real CAR serials

    this.capabilities = {
      verifyCredit: CAPABILITY.MANUAL,
      getOwner:     CAPABILITY.MANUAL,
      getStatus:    CAPABILITY.MANUAL,
      isRetired:    CAPABILITY.MANUAL,
      lockCredit:   CAPABILITY.UNAVAILABLE,
    };
  }

  get name() { return 'car'; }

  async verifyCredit(serialNumber) {
    const fmt = this.validateSerialFormat(serialNumber);
    return this._envelope({
      serialNumber,
      status: STATUS.UNKNOWN,
      confidence: CONFIDENCE.UNVERIFIED,
      notes: fmt.valid
        ? 'car: format check passed. No public API — admin must cross-check climateactionreserve.org manually.'
        : `car: ${fmt.reason} — flag for admin review.`,
    });
  }
}

module.exports = CarAdapter;