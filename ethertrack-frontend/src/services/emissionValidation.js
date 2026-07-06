// src/services/emissionValidation.js
// Validation Layer — Priority 3
// Runs BEFORE any record touches the GHG ledger
// Three checks: range validation, unit mismatch, duplicate detection

// ─────────────────────────────────────────────────────────────────────────────
// UNIT NORMALISATION MAP
// Catches the most common unit confusion errors in practice
// ─────────────────────────────────────────────────────────────────────────────
export const UNIT_ALIASES = {
  // Electricity
  'kwh':  { canonical: 'kWh',  multiplier: 1       },
  'mwh':  { canonical: 'kWh',  multiplier: 1000    },
  'gwh':  { canonical: 'kWh',  multiplier: 1000000 },
  'unit': { canonical: 'kWh',  multiplier: 1       }, // "units" on Indian bills = kWh

  // Volume
  'l':    { canonical: 'L',    multiplier: 1       },
  'ltr':  { canonical: 'L',    multiplier: 1       },
  'litre':{ canonical: 'L',    multiplier: 1       },
  'kl':   { canonical: 'L',    multiplier: 1000    },
  'ml':   { canonical: 'L',    multiplier: 0.001   },

  // Mass
  'kg':   { canonical: 'kg',   multiplier: 1       },
  'g':    { canonical: 'kg',   multiplier: 0.001   },
  'tonne':{ canonical: 'kg',   multiplier: 1000    },
  'mt':   { canonical: 'kg',   multiplier: 1000    }, // metric tonne
  'ton':  { canonical: 'kg',   multiplier: 907.185 }, // short ton — common mistake

  // Distance
  'km':   { canonical: 'km',   multiplier: 1       },
  'miles':{ canonical: 'km',   multiplier: 1.60934 },
  'm':    { canonical: 'km',   multiplier: 0.001   },

  // Gas volume
  'm3':   { canonical: 'm3',   multiplier: 1       },
  'scm':  { canonical: 'm3',   multiplier: 1       },
  'mmscm':{ canonical: 'm3',   multiplier: 1000000 },
};

// ─────────────────────────────────────────────────────────────────────────────
// REASONABLE RANGE BOUNDS per activity
// Values outside these ranges trigger a hard-stop review
// Based on typical Indian facility consumption patterns
// ─────────────────────────────────────────────────────────────────────────────
const ACTIVITY_RANGES = {
  'Electricity India Location (kWh)': { min: 1,      max: 50_000_000,  warn: 5_000_000  }, // 5M kWh/entry = warning
  'Diesel (L)':                        { min: 1,      max: 500_000,     warn: 100_000    },
  'Petrol (L)':                        { min: 1,      max: 100_000,     warn: 20_000     },
  'Natural Gas (m3)':                  { min: 1,      max: 10_000_000,  warn: 1_000_000  },
  'LPG (kg)':                          { min: 1,      max: 500_000,     warn: 50_000     },
  'Coal (kg)':                         { min: 1,      max: 100_000_000, warn: 10_000_000 },
  'Refrigerant R-410A (kg)':           { min: 0.001,  max: 1_000,       warn: 100        },
  'Air Travel Short (km)':             { min: 50,     max: 10_000,      warn: 5_000      },
  'Air Travel Long (km)':              { min: 1_000,  max: 20_000,      warn: 15_000     },
  'Hotel Stay (nights)':               { min: 1,      max: 365,         warn: 30         },
  'Steel (kg)':                        { min: 1,      max: 50_000_000,  warn: 10_000_000 },
};

// ─────────────────────────────────────────────────────────────────────────────
// MONTH-OVER-MONTH ANOMALY THRESHOLDS
// A jump > threshold% vs same activity last month triggers review
// ─────────────────────────────────────────────────────────────────────────────
const MOM_THRESHOLD_PCT = 300; // 300% increase = anomaly flag

// ─────────────────────────────────────────────────────────────────────────────
// validateRange(activity, quantity)
// Returns: { valid, level, message }
// level: 'ok' | 'warn' | 'error'
// ─────────────────────────────────────────────────────────────────────────────
export const validateRange = (activity, quantity) => {
  const range = ACTIVITY_RANGES[activity];
  if (!range) return { valid: true, level: 'ok', message: null };

  if (quantity < range.min) {
    return {
      valid:   false,
      level:   'error',
      message: `Quantity ${quantity} is below minimum (${range.min}) for ${activity}`,
    };
  }

  if (quantity > range.max) {
    return {
      valid:   false,
      level:   'error',
      message: `Quantity ${quantity} exceeds maximum (${range.max.toLocaleString('en-IN')}) for ${activity} — check unit (e.g. kWh vs MWh)`,
    };
  }

  if (quantity > range.warn) {
    return {
      valid:   true,
      level:   'warn',
      message: `Quantity ${quantity.toLocaleString('en-IN')} is unusually high for ${activity} — please verify`,
    };
  }

  return { valid: true, level: 'ok', message: null };
};

// ─────────────────────────────────────────────────────────────────────────────
// detectUnitMismatch(activity, rawUnit, quantity)
// Returns suggested correction if unit looks wrong
// ─────────────────────────────────────────────────────────────────────────────
export const detectUnitMismatch = (activity, rawUnit, quantity) => {
  if (!rawUnit) return null;

  const alias = UNIT_ALIASES[rawUnit.toLowerCase().trim()];
  if (!alias) return null;

  const range = ACTIVITY_RANGES[activity];
  if (!range) return null;

  // If the raw quantity in the stated unit would exceed max,
  // but after normalisation it wouldn't — likely unit mismatch
  if (quantity > range.max && alias.multiplier !== 1) {
    const normalised = quantity * alias.multiplier;
    if (normalised <= range.max) {
      return {
        detected:      true,
        rawUnit,
        canonicalUnit: alias.canonical,
        multiplier:    alias.multiplier,
        rawQuantity:   quantity,
        fixedQuantity: normalised,
        message:       `Unit mismatch detected: did you mean ${normalised.toLocaleString('en-IN')} ${alias.canonical} instead of ${quantity.toLocaleString('en-IN')} ${rawUnit}?`,
      };
    }
  }

  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// generateDuplicateFingerprint(record)
// Creates a fingerprint for duplicate detection across intake channels
// Fingerprint = hash of: activity + approximate_quantity + approximate_date + scope
// "Approximate" so that minor rounding differences don't miss duplicates
// ─────────────────────────────────────────────────────────────────────────────
export const generateDuplicateFingerprint = (record) => {
  const activity  = (record.activity || '').trim().toLowerCase();
  const qty       = Math.round(parseFloat(record.quantity || 0) / 10) * 10; // round to nearest 10
  const dateMonth = (record.date || '').slice(0, 7); // YYYY-MM — same month = suspect duplicate
  const scope     = record.scope || '';

  return `${activity}::${qty}::${dateMonth}::${scope}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// checkDuplicate(newRecord, existingRecords)
// Returns { isDuplicate, matchedRecord, similarity }
// ─────────────────────────────────────────────────────────────────────────────
export const checkDuplicate = (newRecord, existingRecords) => {
  if (!existingRecords || existingRecords.length === 0) {
    return { isDuplicate: false, matchedRecord: null };
  }

  const newFp = generateDuplicateFingerprint(newRecord);

  for (const existing of existingRecords) {
    const existingFp = generateDuplicateFingerprint(existing);
    if (existingFp === newFp) {
      return {
        isDuplicate:   true,
        matchedRecord: existing,
        message:       `Possible duplicate: a similar ${newRecord.activity} record (${existing.quantity} ${existing.unit}) was already logged for ${dateMonth(existing.date)}. Was this the same invoice?`,
      };
    }
  }

  return { isDuplicate: false, matchedRecord: null };
};

const dateMonth = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};

// ─────────────────────────────────────────────────────────────────────────────
// detectMoMAnomaly(newRecord, existingRecords)
// Compares new record to same activity in previous month
// Returns anomaly if > MOM_THRESHOLD_PCT change
// ─────────────────────────────────────────────────────────────────────────────
export const detectMoMAnomaly = (newRecord, existingRecords) => {
  if (!newRecord.date || !existingRecords || existingRecords.length === 0) {
    return { isAnomaly: false };
  }

  const newDate  = new Date(newRecord.date);
  const prevMonth = new Date(newDate);
  prevMonth.setMonth(prevMonth.getMonth() - 1);
  const prevMonthStr = prevMonth.toISOString().slice(0, 7); // YYYY-MM

  // Find same activity records from previous month
  const prevRecords = existingRecords.filter(r =>
    r.activity === newRecord.activity &&
    (r.date || '').startsWith(prevMonthStr)
  );

  if (prevRecords.length === 0) return { isAnomaly: false };

  const prevTotal = prevRecords.reduce((s, r) => s + parseFloat(r.quantity || 0), 0);
  const newQty    = parseFloat(newRecord.quantity || 0);

  if (prevTotal === 0) return { isAnomaly: false };

  const changePct = ((newQty - prevTotal) / prevTotal) * 100;

  if (Math.abs(changePct) > MOM_THRESHOLD_PCT) {
    return {
      isAnomaly:   true,
      level:       Math.abs(changePct) > 500 ? 'error' : 'warn',
      changePct:   changePct.toFixed(1),
      prevTotal,
      newQty,
      prevMonth:   prevMonthStr,
      message:     `${Math.abs(changePct).toFixed(0)}% ${changePct > 0 ? 'increase' : 'decrease'} vs ${dateMonth(prevMonthStr + '-01')} for ${newRecord.activity}. Previous month: ${prevTotal.toLocaleString('en-IN')} — this entry: ${newQty.toLocaleString('en-IN')}. Please verify before submitting.`,
    };
  }

  return { isAnomaly: false };
};

// ─────────────────────────────────────────────────────────────────────────────
// runAllValidations(record, existingRecords)
// Master validation runner — call this before any record touches the ledger
// Returns: { passed, warnings, errors, requiresApproval }
// ─────────────────────────────────────────────────────────────────────────────
export const runAllValidations = (record, existingRecords = []) => {
  const errors   = [];
  const warnings = [];

  // 1. Range check
  const rangeCheck = validateRange(record.activity, parseFloat(record.quantity));
  if (rangeCheck.level === 'error')   errors.push({ type: 'RANGE',     ...rangeCheck });
  if (rangeCheck.level === 'warn')  warnings.push({ type: 'RANGE',     ...rangeCheck });

  // 2. Duplicate check
  const dupCheck = checkDuplicate(record, existingRecords);
  if (dupCheck.isDuplicate) warnings.push({ type: 'DUPLICATE', message: dupCheck.message, matchedRecord: dupCheck.matchedRecord });

  // 3. Month-over-month anomaly
  const momCheck = detectMoMAnomaly(record, existingRecords);
  if (momCheck.isAnomaly) {
    if (momCheck.level === 'error') errors.push({ type: 'ANOMALY', message: momCheck.message, ...momCheck });
    else                          warnings.push({ type: 'ANOMALY', message: momCheck.message, ...momCheck });
  }

  // 4. Date validation
  if (!record.date || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    errors.push({ type: 'DATE', message: 'Invalid date format — use YYYY-MM-DD' });
  } else {
    const d = new Date(record.date);
    if (d > new Date()) errors.push({ type: 'DATE', message: 'Date cannot be in the future' });
    if (d < new Date('2000-01-01')) errors.push({ type: 'DATE', message: 'Date seems too far in the past — please verify' });
  }

  // 5. Required fields
  if (!record.activity) errors.push({ type: 'REQUIRED', message: 'Activity is required' });
  if (!record.quantity || parseFloat(record.quantity) <= 0) errors.push({ type: 'REQUIRED', message: 'Valid quantity is required' });

  const passed           = errors.length === 0;
  const requiresApproval = warnings.length > 0 || errors.length > 0;

  return {
    passed,
    errors,
    warnings,
    requiresApproval,
    summary: passed && warnings.length === 0
      ? 'All checks passed'
      : `${errors.length} error(s), ${warnings.length} warning(s)`,
  };
};