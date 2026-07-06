// src/services/emissionFactorVersioning.js
// Emission Factor Versioning — Priority 1
// Every emission record stores which EF version was active on that date
// CEA updates annually — auditors WILL ask "what factor did you use for March 2025?"
// This makes every tCO2e figure forensically defensible

// ─────────────────────────────────────────────────────────────────────────────
// VERSIONED EMISSION FACTOR REGISTRY
// Each entry has: value, source, effective_from, effective_to, version_id
// When effective_to is null → currently active
// ─────────────────────────────────────────────────────────────────────────────

export const EF_VERSIONS = {
  // ── CEA Grid Emission Factor (India) ────────────────────────────────────
  'Electricity India Location (kWh)': [
    {
      version_id:     'CEA-V18-FY2122',
      value:          0.000716,
      unit:           'tCO2e/kWh',
      source:         'CEA V18.0 — FY 2021-22',
      effective_from: '2021-04-01',
      effective_to:   '2022-03-31',
    },
    {
      version_id:     'CEA-V19-FY2223',
      value:          0.000722,
      unit:           'tCO2e/kWh',
      source:         'CEA V19.0 — FY 2022-23',
      effective_from: '2022-04-01',
      effective_to:   '2023-03-31',
    },
    {
      version_id:     'CEA-V20-FY2324',
      value:          0.000727,
      unit:           'tCO2e/kWh',
      source:         'CEA V20.0 Dec 2024 — FY 2023-24',
      effective_from: '2023-04-01',
      effective_to:   null, // currently active
    },
  ],

  // ── DEFRA Diesel ─────────────────────────────────────────────────────────
  'Diesel (L)': [
    {
      version_id:     'DEFRA-2022-DIESEL',
      value:          2.60,
      unit:           'kgCO2e/L',
      source:         'DEFRA 2022',
      effective_from: '2022-01-01',
      effective_to:   '2023-12-31',
    },
    {
      version_id:     'DEFRA-2024-DIESEL',
      value:          2.68,
      unit:           'kgCO2e/L',
      source:         'DEFRA 2024',
      effective_from: '2024-01-01',
      effective_to:   null,
    },
  ],

  // ── DEFRA Petrol ─────────────────────────────────────────────────────────
  'Petrol (L)': [
    {
      version_id:     'DEFRA-2022-PETROL',
      value:          2.22,
      unit:           'kgCO2e/L',
      source:         'DEFRA 2022',
      effective_from: '2022-01-01',
      effective_to:   '2023-12-31',
    },
    {
      version_id:     'DEFRA-2024-PETROL',
      value:          2.31,
      unit:           'kgCO2e/L',
      source:         'DEFRA 2024',
      effective_from: '2024-01-01',
      effective_to:   null,
    },
  ],

  // ── DEFRA Natural Gas ────────────────────────────────────────────────────
  'Natural Gas (m3)': [
    {
      version_id:     'DEFRA-2024-NATGAS',
      value:          2.02,
      unit:           'kgCO2e/m3',
      source:         'DEFRA 2024',
      effective_from: '2024-01-01',
      effective_to:   null,
    },
  ],

  // ── Air Travel ───────────────────────────────────────────────────────────
  'Air Travel Short (km)': [
    {
      version_id:     'DEFRA-2024-AIR-SHORT',
      value:          0.255,
      unit:           'kgCO2e/km',
      source:         'DEFRA 2024',
      effective_from: '2024-01-01',
      effective_to:   null,
    },
  ],
  'Air Travel Long (km)': [
    {
      version_id:     'DEFRA-2024-AIR-LONG',
      value:          0.195,
      unit:           'kgCO2e/km',
      source:         'DEFRA 2024',
      effective_from: '2024-01-01',
      effective_to:   null,
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// getActiveEFVersion(activity, date)
// Returns the EF version active on a specific date
// Falls back to latest if no exact match (for activities without full history)
// ─────────────────────────────────────────────────────────────────────────────
export const getActiveEFVersion = (activity, date) => {
  const versions = EF_VERSIONS[activity];
  if (!versions || versions.length === 0) return null;

  const d = new Date(date);

  // Find version whose range covers this date
  const match = versions.find(v => {
    const from = new Date(v.effective_from);
    const to   = v.effective_to ? new Date(v.effective_to) : new Date('2099-12-31');
    return d >= from && d <= to;
  });

  // Fallback: return the latest (null effective_to = currently active)
  return match || versions.find(v => !v.effective_to) || versions[versions.length - 1];
};

// ─────────────────────────────────────────────────────────────────────────────
// calcWithVersion(activity, quantity, date, EF)
// Returns co2e + the version metadata used for the calculation
// This is what gets stored in the emission record for audit traceability
// ─────────────────────────────────────────────────────────────────────────────
export const calcWithVersion = (activity, quantity, date, EF) => {
  const ef = EF[activity];
  if (!ef || !quantity || quantity <= 0) return null;

  const version = getActiveEFVersion(activity, date);

  // Use versioned factor if available, fall back to current EF table value
  const factor = version ? version.value * 1000 : ef.factor; // convert tCO2e/kWh → kgCO2e/kWh

  const co2e = (quantity * (version ? version.value : ef.factor / 1000));

  return {
    co2e,
    factor:        version ? version.value * 1000 : ef.factor,
    factor_tco2e:  version ? version.value         : ef.factor / 1000,
    scope:         ef.scope,
    cat:           ef.cat,
    unit:          ef.unit,
    source:        version ? version.source : ef.source,
    method:        ef.method || null,
    // Version metadata — stored with every record for audit trail
    ef_version_id:   version?.version_id   || 'CURRENT',
    ef_version_from: version?.effective_from || null,
    ef_version_to:   version?.effective_to   || null,
    ef_version_src:  version?.source         || ef.source,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// getEFChangelog(activity)
// Returns the full version history for an activity — used in UI tooltips
// ─────────────────────────────────────────────────────────────────────────────
export const getEFChangelog = (activity) => {
  return EF_VERSIONS[activity] || [];
};

// ─────────────────────────────────────────────────────────────────────────────
// detectEFMismatch(activity, date, currentFactor)
// Detects if a record was calculated with an outdated EF
// Used in audit mode to flag records that need recalculation
// ─────────────────────────────────────────────────────────────────────────────
export const detectEFMismatch = (activity, date, storedVersionId) => {
  const currentVersion = getActiveEFVersion(activity, new Date().toISOString().slice(0, 10));
  const recordVersion  = getActiveEFVersion(activity, date);

  if (!currentVersion || !recordVersion) return null;

  return {
    hasMismatch:     currentVersion.version_id !== recordVersion.version_id,
    recordVersion:   recordVersion,
    currentVersion:  currentVersion,
    factorDelta:     currentVersion.value - recordVersion.value,
    factorDeltaPct:  recordVersion.value > 0
      ? ((currentVersion.value - recordVersion.value) / recordVersion.value * 100).toFixed(2)
      : 0,
  };
};