// services/registryAdapters/index.js
//
// Single entry point: getAdapter(standard) -> adapter instance, so
// callers (routes/admin.js, routes/registry.js) never branch on registry
// name themselves. Adapters are singletons — no per-request state, so
// this is safe to reuse across requests.
//
// [COMPLIANCE-GATE] 'BEE' (India CCTS) is deliberately NOT in this map.
// BEE/CCTS credits are not a voluntary-registry verification problem —
// they're routed through a completely different flow (CCTS reporting +
// eventual GCIL registry / IEX-PXIL-HPX exchange integration). Calling
// getAdapter('BEE') throws on purpose so nobody accidentally wires a
// compliance credit through the voluntary verification path. See
// services/minter.js and routes/admin.js for where BEE/compliance
// credits actually get handled.

const VerraAdapter        = require('./verraAdapter');
const GoldStandardAdapter = require('./goldStandardAdapter');
const AcrAdapter          = require('./acrAdapter');
const CarAdapter          = require('./carAdapter');
const PuroAdapter          = require('./puroAdapter');

const registry = {
  VCS:  new VerraAdapter(),
  GS:   new GoldStandardAdapter(),
  ACR:  new AcrAdapter(),
  CAR:  new CarAdapter(),
  PURO: new PuroAdapter(),
  // CDM has no adapter yet — falls through to the error below until one
  // is built. Don't silently default it to another adapter's serial
  // pattern; CDM project IDs have a different shape.
};

/**
 * @param {string} standard e.g. 'VCS', 'GS', 'ACR', 'CAR', 'PURO'
 * @returns adapter instance
 * @throws if standard is 'BEE'/compliance, or genuinely unsupported
 */
function getAdapter(standard) {
  const key = String(standard || '').toUpperCase().trim();

  if (key === 'BEE') {
    throw new Error(
      "getAdapter('BEE'): India CCTS/CCC credits are not routed through " +
      "voluntary registry adapters. See services/minter.js compliance-gate."
    );
  }

  const adapter = registry[key];
  if (!adapter) {
    throw new Error(`getAdapter: no adapter registered for standard "${standard}".`);
  }
  return adapter;
}

/** For admin UI: list which standards currently have adapters + their capability tiers. */
function listAdapterCapabilities() {
  return Object.entries(registry).map(([standard, adapter]) => ({
    standard,
    name: adapter.name,
    capabilities: adapter.capabilities,
  }));
}

module.exports = { getAdapter, listAdapterCapabilities };