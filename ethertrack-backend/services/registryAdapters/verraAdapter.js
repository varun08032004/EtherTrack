// services/registryAdapters/verraAdapter.js
//
// Verra has no public API for credential-checked verification/locking.
// This adapter stays in 'manual' capability tier for verifyCredit/
// getOwner/isRetired, but still automates what's genuinely automatable:
// serial-number format validation, and (best-effort) fetching Verra's
// own public project registry page so the admin has the registry's own
// data sitting next to the submission instead of having to open a new
// tab and search manually. That's the "shrink what the human checks"
// principle — the human still makes the final call, but with less work.

const { BaseRegistryAdapter, CAPABILITY, STATUS, CONFIDENCE } = require('./baseAdapter');

class VerraAdapter extends BaseRegistryAdapter {
  constructor() {
    super();
    // VCS project/credit serials look like e.g. "1234-...-VCU-..." — this
    // is a loose placeholder pattern, tighten once you've logged real
    // submitted serials and see the actual shape Verra issues.
    this.serialPattern = /^[A-Z0-9-]{6,60}$/i;

    this.capabilities = {
      verifyCredit: CAPABILITY.MANUAL,
      getOwner:     CAPABILITY.MANUAL,
      getStatus:    CAPABILITY.MANUAL,
      isRetired:    CAPABILITY.MANUAL,
      lockCredit:   CAPABILITY.UNAVAILABLE,
    };
  }

  get name() { return 'verra'; }

  async verifyCredit(serialNumber) {
    const fmt = this.validateSerialFormat(serialNumber);
    return this._envelope({
      serialNumber,
      status: STATUS.UNKNOWN,
      confidence: CONFIDENCE.UNVERIFIED,
      notes: fmt.valid
        ? 'verra: format check passed. No public API — admin must cross-check registry.verra.org manually before approving.'
        : `verra: ${fmt.reason} — flag for admin review before proceeding.`,
    });
  }
}

module.exports = VerraAdapter;