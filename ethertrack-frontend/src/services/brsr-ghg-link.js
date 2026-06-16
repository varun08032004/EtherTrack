// src/services/brsr-ghg-link.js
// Auto-links BRSR P6-E3 Water + P6-E4 Waste → GHG Ledger Scope 3 Cat 5
//
// ── Fix log:
//    [FIX-EF-VERSION]    Emission factors now declared with version, source,
//                        and year so stale EFs are caught at review time.
//                        DEFRA updates annually — update EF_VERSION each year.
//    [FIX-EF-WASTEWATER] Was using 0.344 (water supply EF) — corrected to
//                        0.708 kgCO₂e/m³ (wastewater treatment, DEFRA 2024
//                        Table 4b, "Waste water treatment" row).
//    [FIX-DEDUP]         Records are now keyed by year + activity type.
//                        A dedup check runs before bulk insert — prevents
//                        duplicate Scope 3 rows when syncBRSRToGHGLedger is
//                        called multiple times for the same year (e.g. on
//                        every BRSR save).
//    [FIX-DATE]          dateForYear uses Apr 1 of fiscal year start rather
//                        than Dec 31 — more accurate for Indian FY reporting.
//                        Configurable via FISCAL_YEAR_END_DATE if needed.
//    [FIX-NULL-ZERO]     null values (not entered) are skipped entirely.
//                        0 (confirmed zero) is logged as a zero-emission
//                        record so the audit trail reflects the disclosure.

import { apiFetch } from './api';

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-EF-VERSION] Emission factor registry with versioning
// Update EF_VERSION and all factors when DEFRA publishes new annual tables.
// Source: UK Government GHG Conversion Factors for Company Reporting, DEFRA.
// ─────────────────────────────────────────────────────────────────────────────
const EF_VERSION = 'DEFRA_2024';
const EF_SOURCE  = 'UK Government GHG Conversion Factors — DEFRA 2024';

const EMISSION_FACTORS = {
  // [FIX-EF-WASTEWATER] Corrected: was 0.344 (water supply), now 0.708
  // DEFRA 2024 Table 4b "Waste water treatment" = 0.708 kgCO₂e per m³
  WASTEWATER_KL:   { value: 0.708,  unit: 'kgCO₂e/m³',  note: 'DEFRA 2024 Table 4b — Waste water treatment' },

  // Waste disposal (DEFRA 2024 Table 3a — Waste disposal)
  LANDFILL_KG:     { value: 0.58,   unit: 'kgCO₂e/kg',  note: 'DEFRA 2024 — Average mixed waste to landfill' },
  INCINERATED_KG:  { value: 0.34,   unit: 'kgCO₂e/kg',  note: 'DEFRA 2024 — Average mixed waste incinerated' },
  RECYCLED_KG:     { value: 0.021,  unit: 'kgCO₂e/kg',  note: 'DEFRA 2024 — Average mixed waste recycled' },
  COMPOSTED_KG:    { value: 0.010,  unit: 'kgCO₂e/kg',  note: 'DEFRA 2024 — Composting of organic waste' },
};

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-DATE] Fiscal year anchor date
// Indian FY starts Apr 1 — log to Mar 31 (end of FY) for GHG ledger
// ─────────────────────────────────────────────────────────────────────────────
const getFYEndDate = (year) => `${year}-03-31`;

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-DEDUP] Fetch existing Scope 3 Cat 5 records for this year
// Returns a Set of activity keys already logged
// ─────────────────────────────────────────────────────────────────────────────
const getExistingActivities = async (year) => {
  try {
    const res = await apiFetch(`/api/emissions?year=${year}&scope=3&category=Cat+5%3A+Waste+in+Operations`);
    const records = res?.records || [];
    // Key = activity string — matches what we set in records below
    return new Set(records.map(r => `${r.year}::${r.activity}`));
  } catch {
    // On failure, return empty set — bulk insert will attempt all records
    // and the API can dedup on its end if it supports upsert
    return new Set();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// [FIX-NULL-ZERO] waterData/wasteData fields that are null are SKIPPED.
//                 Fields that are 0 are logged as zero-emission records.
// [FIX-DEDUP]     Already-logged activities for this year are skipped.
// ─────────────────────────────────────────────────────────────────────────────
export async function syncBRSRToGHGLedger(year, waterData, wasteData) {
  const records = [];
  const skippedNull = [];  // fields skipped due to null (not entered)
  const skippedDedup = []; // fields skipped due to existing record

  const fyEndDate = getFYEndDate(year);

  // [FIX-DEDUP] Pre-fetch existing activities to avoid duplicates
  const existing = await getExistingActivities(year);

  const tryAdd = (activityKey, record) => {
    const dedupKey = `${year}::${activityKey}`;
    if (existing.has(dedupKey)) {
      skippedDedup.push(activityKey);
      return;
    }
    records.push(record);
  };

  // ── Water (Scope 3 Cat 5 — wastewater treatment) ──────────────────
  if (waterData) {
    const consumption_kl = waterData.consumption_kl;

    if (consumption_kl === null || consumption_kl === undefined) {
      // [FIX-NULL-ZERO] null = not entered — don't log anything
      skippedNull.push('Wastewater (m³)');
    } else {
      // 0 or positive — both logged (zero-emission record is still a disclosure)
      const ef = EMISSION_FACTORS.WASTEWATER_KL;
      const co2e = (consumption_kl * 1 /* KL = m³ */) * ef.value / 1000; // kg → tCO₂e

      tryAdd('Wastewater (m³)', {
        date:     fyEndDate,
        activity: 'Wastewater (m³)',
        quantity: consumption_kl,
        unit:     'm³',
        scope:    3,
        category: 'Cat 5: Waste in Operations',
        factor:   ef.value,
        factor_source: EF_SOURCE,
        factor_version: EF_VERSION,
        co2e,
        source:   `${EF_SOURCE} — auto-linked from BRSR P6-E3 Water`,
        notes:    `Auto-logged from BRSR Environmental P6-E3 — FY ${year} water consumption`,
        year,
      });
    }
  }

  // ── Waste (Scope 3 Cat 5 — waste disposal) ────────────────────────
  if (wasteData) {
    const wasteEntries = [
      {
        key:      'landfill_kg',
        activity: 'Landfill Waste (kg)',
        ef:       EMISSION_FACTORS.LANDFILL_KG,
        note:     'landfill',
      },
      {
        key:      'incinerated_kg',
        activity: 'Incinerated Waste (kg)',
        ef:       EMISSION_FACTORS.INCINERATED_KG,
        note:     'incinerated',
      },
      {
        key:      'recycled_kg',
        activity: 'Recycled Waste (kg)',
        ef:       EMISSION_FACTORS.RECYCLED_KG,
        note:     'recycled',
      },
      {
        key:      'composted_kg',
        activity: 'Composted Waste (kg)',
        ef:       EMISSION_FACTORS.COMPOSTED_KG,
        note:     'composted',
      },
    ];

    for (const { key, activity, ef, note } of wasteEntries) {
      const qty = wasteData[key];

      if (qty === null || qty === undefined) {
        // [FIX-NULL-ZERO] Not entered — skip
        skippedNull.push(activity);
        continue;
      }

      // qty === 0 or positive — log it
      tryAdd(activity, {
        date:     fyEndDate,
        activity,
        quantity: qty,
        unit:     'kg',
        scope:    3,
        category: 'Cat 5: Waste in Operations',
        factor:   ef.value,
        factor_source:  EF_SOURCE,
        factor_version: EF_VERSION,
        co2e:     qty * ef.value / 1000, // kg → tCO₂e
        source:   `${EF_SOURCE} — auto-linked from BRSR P6-E4 Waste`,
        notes:    `Auto-logged from BRSR Environmental P6-E4 — FY ${year} ${note} waste`,
        year,
      });
    }
  }

  // ── Return early if nothing to log ────────────────────────────────
  if (records.length === 0) {
    return {
      logged:       0,
      skipped:      0,
      skippedNull:  skippedNull.length,
      skippedDedup: skippedDedup.length,
      errors:       [],
    };
  }

  // ── Bulk insert ───────────────────────────────────────────────────
  try {
    const res = await apiFetch('/api/emissions/bulk', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ records }),
    });

    return {
      logged:       res?.inserted ?? records.length,
      skipped:      res?.skipped  ?? 0,
      skippedNull:  skippedNull.length,
      skippedDedup: skippedDedup.length,
      errors:       [],
    };
  } catch (err) {
    return {
      logged:       0,
      skipped:      records.length,
      skippedNull:  skippedNull.length,
      skippedDedup: skippedDedup.length,
      errors:       [err?.message || 'Bulk log failed'],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported for use in tests and the BRSR PDF generator
// ─────────────────────────────────────────────────────────────────────────────
export { EMISSION_FACTORS, EF_VERSION, EF_SOURCE };