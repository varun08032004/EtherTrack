// src/components/emission-log/CSVImport.jsx
// ── v2 fixes:
//    [FIX-SCOPE2-HINTS]  Extended DOMAIN_HINTS with 40+ specific patterns for
//                        descriptive activity names like "Purchased Electricity -
//                        HQ Office", "District Heating - Warehouse A", etc.
//                        Previously these scored < 0.25 in fuzzy match → no
//                        resolvedKey → co2e = null → Scope 2 showed 0.000.
//    [FIX-PRECALC-CO2E]  Auto-detects CSV columns named "Quantity (tCO2e)" or
//                        "tco2e" / "co2e" — stores the value directly as co2e
//                        instead of multiplying by an EF factor (which produced
//                        wrong tiny results when the CSV already contained
//                        pre-calculated tCO2e values).
//    [FIX-SCOPE-COL]     Reads optional "Scope" column (e.g. "Scope 1 - Direct
//                        Emissions") to pre-fill scope when activity name alone
//                        is ambiguous.
//
// Key UX principle: resolve by UNIQUE ACTIVITY, not by row.
//   A 15,000-row file with 8 distinct activity strings = 8 decisions, not 15,000.
//
// Resolution flow:
//   1. Parse file → collect all unique raw activity strings
//   2. Fuzzy-match each unique string → exact / suggest / unknown
//   3. Show "Activity Resolver" panel — one row per unique activity
//   4. User confirms suggestions or picks from dropdown (seconds, not minutes)
//   5. Apply resolution map to all rows instantly → full preview + import

import React, { useState, useRef, useCallback, useMemo } from 'react';
import ExcelJS from 'exceljs';
import { apiFetch } from '../../services/api';

// ─── Sanitisation ─────────────────────────────────────────────────────────────
const sanitise = (str = '') =>
  String(str).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, 500);

const safeNum = (val) => {
  const n = parseFloat(String(val ?? '').replace(/,/g, ''));
  return isFinite(n) && n > 0 && n < 1e12 ? n : null;
};

// ─── Date normalisation ───────────────────────────────────────────────────────
const normaliseDate = (raw) => {
  if (!raw && raw !== 0) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Excel serial number (days since 1900-01-01, with 1900 leap year bug)
  if (typeof raw === 'number' && raw > 1000) {
    try {
      const excelEpoch = new Date(1900, 0, 1);
      // Excel incorrectly treats 1900 as a leap year, so adjust for dates after 1900-02-28
      const daysOffset = raw - (raw > 59 ? 2 : 1);
      const d = new Date(excelEpoch.getTime() + daysOffset * 86400000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    } catch (_) {}
  }

  // DD/MM/YYYY or DD-MM-YYYY
  let m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;

  // YYYY/MM/DD
  m = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;

  // Natural language fallback
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return null;
};

// ─── Fuzzy matcher ────────────────────────────────────────────────────────────
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

// [FIX-SCOPE2-HINTS] Extended domain hints — more-specific patterns MUST come
// before more-general ones because fuzzyMatch() returns on the FIRST match.
// New patterns cover all descriptive names used in real-world CSV exports:
// "Purchased Electricity - HQ Office", "District Heating - Warehouse A", etc.
const DOMAIN_HINTS = [
  // ── Scope 2: Electricity (specific first) ─────────────────────────────────
  ['purchased electricity.*india',     'Electricity India Location'],
  ['purchased electricity.*location',  'Electricity India Location'],
  ['grid electricity.*india',          'Electricity India Location'],
  ['electricity.*india.*location',     'Electricity India Location'],
  ['purchased electricity.*eu',        'Electricity EU Location'],
  ['purchased electricity.*europe',    'Electricity EU Location'],
  ['purchased electricity.*us',        'Electricity US Location'],
  ['purchased electricity.*united states', 'Electricity US Location'],
  ['purchased electricity.*china',     'Electricity China Location'],
  ['purchased electricity.*rec',       'Electricity India REC'],
  ['electricity.*rec',                 'Electricity India REC'],
  ['purchased electricity.*ppa.*solar','Electricity India PPA Solar'],
  ['purchased electricity.*ppa.*wind', 'Electricity India PPA Wind'],
  ['purchased electricity.*green tariff','Electricity India Green Tariff'],
  ['purchased electricity.*green',     'Electricity India Green Tariff'],
  // Generic "Purchased Electricity - [location name]" → default to India Location
  ['purchased electricity',            'Electricity India Location'],
  ['grid electricity',                 'Electricity India Location'],
  ['electricity.*location',            'Electricity India Location'],
  ['electricity.*india',               'Electricity India Location'],
  ['electricity.*hq',                  'Electricity India Location'],
  ['electricity.*warehouse',           'Electricity India Location'],
  ['electricity.*office',              'Electricity India Location'],
  ['electricity.*data centre',         'Electricity India Location'],
  ['electricity.*data center',         'Electricity India Location'],
  ['electricity.*retail',              'Electricity India Location'],
  ['electricity.*car park',            'Electricity India Location'],
  ['electricity.*server',              'Electricity India Location'],
  ['electricity.*showroom',            'Electricity India Location'],
  ['electricity.*facility',            'Electricity India Location'],
  ['electricity.*hub',                 'Electricity India Location'],
  ['electricity.*canteen',             'Electricity India Location'],
  ['electricity.*r&d',                 'Electricity India Location'],
  ['electricity.*manufactur',          'Electricity India Location'],
  ['electricity.*satellite',           'Electricity India Location'],
  ['electricity.*distribution',        'Electricity India Location'],

  // ── Scope 2: District Heating ──────────────────────────────────────────────
  // Matches: "District Heating - HQ Office", "District Heating - Warehouse A"
  ['district heat',                    'District Heating'],
  ['purchased heat',                   'District Heating'],
  ['purchased steam',                  'District Heating'],  // closest EF available
  ['steam.*manufactur',                'District Heating'],
  ['steam.*packag',                    'District Heating'],

  // ── Scope 2: District Cooling ──────────────────────────────────────────────
  // Matches: "District Cooling - HQ Office", "District Cooling - Manufacturing"
  ['district cool',                    'District Cooling'],

  // ── Scope 2: Solar / Renewables ───────────────────────────────────────────
  ['solar.*renew',                     'Solar/Renewable Own'],
  ['renewable.*own',                   'Solar/Renewable Own'],
  ['rooftop solar',                    'Solar/Renewable Own'],

  // ── Scope 1: Natural Gas (specific first) ─────────────────────────────────
  // Matches: "Natural Gas Combustion - HQ Boilers", "Natural Gas Combustion - Warehouse A"
  ['natural gas combustion',           'Natural Gas (m3)'],
  ['natural gas.*boiler',              'Natural Gas (m3)'],
  ['natural gas.*warehouse',           'Natural Gas (m3)'],
  ['natural gas.*manufactur',          'Natural Gas (m3)'],
  ['natural gas.*r&d',                 'Natural Gas (m3)'],
  ['natural gas.*satellite',           'Natural Gas (m3)'],
  ['natural gas.*hq',                  'Natural Gas (m3)'],
  ['natural gas',                      'Natural Gas (m3)'],

  // ── Scope 1: Diesel (specific first) ──────────────────────────────────────
  // Matches: "Diesel - Owned Fleet Vehicles", "Diesel - Backup Generators", etc.
  ['diesel.*fleet',                    'Diesel (L)'],
  ['diesel.*generator',                'Diesel (L)'],
  ['diesel.*backup',                   'Diesel (L)'],
  ['diesel.*forklift',                 'Diesel (L)'],
  ['diesel.*construction',             'Diesel (L)'],
  ['diesel.*deliver',                  'Diesel (L)'],
  ['diesel.*transport',                'Diesel (L)'],
  ['diesel.*refrigerat',               'Diesel (L)'],
  ['diesel.*site',                     'Diesel (L)'],
  ['diesel.*owned',                    'Diesel (L)'],
  ['diesel.*vehicle',                  'Company Vehicle Diesel (km)'],
  ['hsd',                              'HSD (kL)'],
  ['diesel',                           'Diesel (L)'],

  // ── Scope 1: Petrol / Gasoline ─────────────────────────────────────────────
  // Matches: "Petrol - Company Cars", "Petrol - Field Operations Vehicles", etc.
  ['petrol.*car',                      'Petrol (L)'],
  ['petrol.*vehicle',                  'Company Vehicle Petrol (km)'],
  ['petrol.*field',                    'Petrol (L)'],
  ['petrol.*sales',                    'Petrol (L)'],
  ['petrol.*company',                  'Petrol (L)'],
  ['gasoline',                         'Petrol (L)'],
  ['petrol',                           'Petrol (L)'],

  // ── Scope 1: LPG ──────────────────────────────────────────────────────────
  // Matches: "LPG - Canteen Operations", "LPG - Heating - Satellite Office"
  ['lpg.*canteen',                     'LPG (kg)'],
  ['lpg.*heat',                        'LPG (kg)'],
  ['lpg.*cook',                        'LPG (kg)'],
  ['lpg',                              'LPG (kg)'],

  // ── Scope 1: Refrigerants / Fugitives ─────────────────────────────────────
  // Matches: "Refrigerant Leakage (HFCs) - HVAC", "HFCs - Chiller Units"
  ['refrigerant.*hvac',                'Refrigerant R-410A (kg)'],
  ['refrigerant leakage',              'Refrigerant R-410A (kg)'],
  ['refrigerant.*hfc',                 'Refrigerant R-410A (kg)'],
  ['hfc.*chill',                       'Refrigerant R-410A (kg)'],
  ['hfc.*hvac',                        'Refrigerant R-410A (kg)'],
  ['fugitive.*refrigerant',            'Refrigerant R-410A (kg)'],
  ['r-410',                            'Refrigerant R-410A (kg)'],
  ['r-22',                             'Refrigerant R-22 (kg)'],
  ['r-32',                             'Refrigerant R-32 (kg)'],
  ['refrigerant',                      'Refrigerant R-410A (kg)'],
  ['methane',                          'Methane leakage (m3)'],

  // ── Scope 1: Coal ─────────────────────────────────────────────────────────
  ['coal.*boiler',                     'Coal (kg)'],
  ['coal.*industrial',                 'Coal (kg)'],
  ['coal for power',                   'Coal for Power (tonne)'],
  ['coal',                             'Coal (kg)'],

  // ── Scope 1: Furnace / Fuel Oil ───────────────────────────────────────────
  ['fuel oil.*standby',                'Furnace Oil (L)'],
  ['fuel oil',                         'Furnace Oil (L)'],
  ['furnace oil',                      'Furnace Oil (L)'],
  ['fo/lshs',                          'FO/LSHS (kL)'],
  ['lshs',                             'FO/LSHS (kL)'],

  // ── Scope 1: Biomass ──────────────────────────────────────────────────────
  ['biomass',                          'Biomass (kg)'],

  // ── Scope 1: Company Vehicles ─────────────────────────────────────────────
  ['company vehicle.*diesel',          'Company Vehicle Diesel (km)'],
  ['company vehicle.*petrol',          'Company Vehicle Petrol (km)'],
  ['company vehicle.*cng',             'Company Vehicle CNG (km)'],
  ['company vehicle',                  'Company Vehicle Diesel (km)'],

  // ── Scope 3: Air Travel ───────────────────────────────────────────────────
  ['air travel.*short',                'Air Travel Short (km)'],
  ['air travel.*long',                 'Air Travel Long (km)'],
  ['flight.*short',                    'Air Travel Short (km)'],
  ['flight.*long',                     'Air Travel Long (km)'],
  ['air travel',                       'Air Travel Short (km)'],
  ['flight',                           'Air Travel Short (km)'],

  // ── Scope 3: Rail ─────────────────────────────────────────────────────────
  ['rail travel',                      'Rail Travel (km)'],
  ['rail freight',                     'Rail Freight (tonne-km)'],
  ['rail',                             'Rail Travel (km)'],

  // ── Scope 3: Road / Sea / Air Freight ─────────────────────────────────────
  ['road freight',                     'Road Freight (tonne-km)'],
  ['sea freight',                      'Sea Freight (tonne-km)'],
  ['air freight',                      'Air Freight (tonne-km)'],
  ['downstream.*road',                 'Downstream Road Freight (t-km)'],
  ['customer.*last.mile',              'Customer Last-mile (km)'],

  // ── Scope 3: Hotel / Car Rental ───────────────────────────────────────────
  ['hotel',                            'Hotel Stay (nights)'],
  ['car rental',                       'Car Rental (km)'],

  // ── Scope 3: Employee Commute / WFH ──────────────────────────────────────
  ['commut.*car',                      'Employee Commute Car (km)'],
  ['commut.*bus',                      'Employee Commute Bus (km)'],
  ['commut.*metro',                    'Employee Commute Metro (km)'],
  ['commut',                           'Employee Commute Car (km)'],
  ['wfh',                              'Employee WFH (day)'],
  ['work from home',                   'Employee WFH (day)'],

  // ── Scope 3: Waste ────────────────────────────────────────────────────────
  ['landfill',                         'Landfill Waste (kg)'],
  ['recycl.*waste',                    'Recycled Waste (kg)'],
  ['incinerat',                        'Incinerated Waste (kg)'],
  ['compost',                          'Composted Waste (kg)'],
  ['wastewater',                       'Wastewater (m3)'],
  ['waste.*water',                     'Wastewater (m3)'],

  // ── Scope 3: T&D Losses ───────────────────────────────────────────────────
  ['t&d',                              'T&D Losses India (kWh)'],
  ['transmission.*loss',               'T&D Losses India (kWh)'],
  ['distribution.*loss',               'T&D Losses India (kWh)'],

  // ── Scope 3: Upstream fuels ───────────────────────────────────────────────
  ['upstream.*natural gas',            'Upstream Natural Gas (m3)'],
  ['upstream.*gas',                    'Upstream Natural Gas (m3)'],
  ['upstream.*diesel',                 'Upstream Diesel (L)'],

  // ── Scope 3: Materials ────────────────────────────────────────────────────
  ['steel',                            'Steel (kg)'],
  ['aluminium',                        'Aluminium (kg)'],
  ['aluminum',                         'Aluminium (kg)'],
  ['plastic',                          'Plastic (kg)'],
  ['cement',                           'Cement (kg)'],
  ['paper',                            'Paper (kg)'],
  ['glass',                            'Glass (kg)'],
  ['copper',                           'Copper (kg)'],
  ['it equipment',                     'IT Equipment (unit)'],
  ['cloud',                            'Cloud Computing (kWh)'],
  ['capital equipment',                'Capital Equipment (Lakh)'],
  ['building construct',               'Building Construction (m2)'],

  // ── Scope 3: Leased Assets ────────────────────────────────────────────────
  ['leased.*office',                   'Leased Office Space (m2-yr)'],
  ['leased.*vehicle',                  'Leased Vehicle (km)'],
  ['leased.*electricity',              'Leased Asset Electricity (kWh)'],
  ['leased.*asset',                    'Leased Asset Electricity (kWh)'],

  // ── Scope 3: Products ─────────────────────────────────────────────────────
  ['product.*process',                 'Product Processing (kg)'],
  ['product.*energy',                  'Product Energy Use (kWh)'],
  ['product.*landfill',                'Product Landfill (kg)'],
  ['product.*recycl',                  'Product Recycling (kg)'],

  // ── Scope 3: Investments / Franchise ──────────────────────────────────────
  ['equity investment',                'Equity Investment (Cr)'],
  ['debt.*loan',                       'Debt/Loans (Cr)'],
  ['franchise',                        'Franchise Operations (Lakh)'],
  ['investment',                       'Equity Investment (Cr)'],

  // ── PAT / BEE ─────────────────────────────────────────────────────────────
  ['grid electricity.*pat',            'Grid Electricity PAT (kWh)'],
  ['coal.*power',                      'Coal for Power (tonne)'],
];

const fuzzyMatch = (input, EF) => {
  const inputL = input.toLowerCase();
  const inputN = norm(input);
  if (!inputN) return null;

  // 1. Domain hint shortcut (iterates top-to-bottom, returns on first match)
  for (const [pattern, efSubstr] of DOMAIN_HINTS) {
    if (new RegExp(pattern, 'i').test(inputL)) {
      const candidates = Object.keys(EF).filter(k => k.toLowerCase().includes(efSubstr.toLowerCase()));
      if (candidates.length === 1) return { key: candidates[0], score: 0.92 };
      if (candidates.length > 1) {
        const iWords = new Set(inputN.split(' '));
        let best = candidates[0], bestScore = 0;
        for (const c of candidates) {
          const ov = norm(c).split(' ').filter(w => w.length > 2 && iWords.has(w)).length / norm(c).split(' ').length;
          if (ov > bestScore) { best = c; bestScore = ov; }
        }
        return { key: best, score: Math.max(0.85, bestScore) };
      }
    }
  }

  // 2. Bidirectional word overlap fallback
  const inputWords = new Set(inputN.split(' ').filter(w => w.length > 2));
  let best = null, bestScore = 0;
  for (const key of Object.keys(EF)) {
    const keyN = norm(key);
    if (keyN === inputN) return { key, score: 1.0 };
    const keyWords = keyN.split(' ').filter(w => w.length > 2);
    if (!keyWords.length) continue;
    const fwd = keyWords.filter(w => inputWords.has(w)).length / keyWords.length;
    const bwd = [...inputWords].filter(w => keyWords.includes(w)).length / Math.max(inputWords.size, 1);
    const score = (fwd + bwd) / 2;
    if (score > bestScore) { best = key; bestScore = score; }
  }
  return bestScore > 0.25 ? { key: best, score: bestScore } : null;
};

// ─── Header resolution ────────────────────────────────────────────────────────
const HEADER_ALIASES = {
  date:     ['date', 'period', 'month', 'reporting date', 'activity date', 'transaction date'],
  activity: ['activity', 'emission activity', 'emission source', 'source', 'type', 'fuel type', 'description', 'category', 'item', 'material'],
  quantity: ['quantity', 'qty', 'amount', 'volume', 'value', 'consumption', 'usage', 'units', 'quantity (tco2e)', 'quantity (co2e)'],
  notes:    ['notes', 'note', 'comment', 'comments', 'details', 'remark', 'remarks'],
  scope:    ['scope'],
  // [FIX-PRECALC-CO2E] Detect pre-calculated tCO2e column
  co2e:     ['tco2e', 'co2e', 'emissions (tco2e)', 'ghg (tco2e)', 'carbon (tco2e)', 'quantity (tco2e)'],
};

const resolveHeader = (raw) => {
  const n = String(raw ?? '').toLowerCase().replace(/[^a-z0-9\(\)]+/g, ' ').trim();
  if (!n) return null;
  for (const [canon, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      if (n === alias || n.startsWith(alias)) return canon;
    }
  }
  return null;
};

// [FIX-PRECALC-CO2E] Detect if the quantity column header itself signals tCO2e
const isPreCalcCo2eHeader = (raw) => {
  const n = String(raw ?? '').toLowerCase();
  return n.includes('tco2e') || n.includes('co2e') || n === 'quantity (tco2e)';
};

// ─── File → array-of-arrays ───────────────────────────────────────────────────
const readFile = (file) => new Promise((resolve, reject) => {
  const ext = file.name.split('.').pop().toLowerCase();
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buffer = e.target.result;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
          reject(new Error('No worksheets found in Excel file'));
          return;
        }
        const rows = [];
        worksheet.eachRow({ includeEmpty: false }, (row) => {
          const rowData = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            rowData.push(cell.value ?? '');
          });
          rows.push(rowData);
        });
        resolve(rows);
      } catch (err) { reject(new Error('Could not parse Excel file: ' + err.message)); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  } else if (['csv', 'txt'].includes(ext)) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const rows = e.target.result.trim().split('\n').filter(l => l.trim()).map(line => {
        const vals = []; let cur = '', inQ = false;
        for (const ch of line) {
          if (ch === '"') { inQ = !inQ; }
          else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
          else { cur += ch; }
        }
        vals.push(cur.trim());
        return vals.map(v => v.replace(/^"|"$/g, '').replace(/\r$/, ''));
      });
      resolve(rows);
    };
    reader.onerror = reject;
    reader.readAsText(file);
  } else {
    reject(new Error(`Unsupported file type .${ext} — use CSV or Excel`));
  }
});

// ─── Parse rows → raw records + unique activity map ──────────────────────────
const parseRows = (rows, EF) => {
  if (rows.length < 2) return { rawRecords: [], uniqueActivities: new Map(), isPreCalc: false };

  // Detect header row
  let headerRowIdx = 0, headerMap = {};
  let quantityHeaderRaw = '';
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const map = {};
    for (let j = 0; j < rows[i].length; j++) {
      const cell = rows[i][j];
      const c = resolveHeader(String(cell ?? ''));
      if (c && !(c in map)) {
        map[c] = j;
        if (c === 'quantity') quantityHeaderRaw = String(cell ?? '');
      }
    }
    if (Object.keys(map).length >= 2) { headerRowIdx = i; headerMap = map; break; }
  }

  // [FIX-PRECALC-CO2E] Check if the quantity column stores pre-calculated tCO2e
  const isPreCalc = isPreCalcCo2eHeader(quantityHeaderRaw) ||
    (headerMap.co2e !== undefined);

  const rawRecords = [];
  const uniqueActivities = new Map();

  rows.slice(headerRowIdx + 1).forEach((row, i) => {
    if (row.every(c => c === null || c === undefined || String(c).trim() === '')) return;

    const get     = (f) => sanitise(String(row[headerMap[f]] ?? '').trim());
    const rawDate  = row[headerMap.date];
    const date     = normaliseDate(rawDate);
    const activity = get('activity');
    const qty      = safeNum(row[headerMap.quantity]);
    const co2eRaw  = headerMap.co2e !== undefined ? safeNum(row[headerMap.co2e]) : null;
    const notes    = get('notes');
    // [FIX-SCOPE-COL] Read raw scope string for reference (used in UI display)
    const scopeRaw = get('scope');

    rawRecords.push({
      rowNum: headerRowIdx + i + 2,
      date,
      rawDate: String(rawDate ?? ''),
      activity,
      qty,
      co2eRaw,        // pre-calculated tCO2e if column present
      notes,
      scopeRaw,
      isPreCalc,      // flag per-record so applyResolutions can use it
    });

    if (activity && !uniqueActivities.has(activity)) {
      const efExact = EF[activity];
      if (efExact) {
        uniqueActivities.set(activity, { status: 'exact', resolvedKey: activity, suggested: activity, score: 1.0 });
      } else {
        const match = fuzzyMatch(activity, EF);
        if (match && match.score >= 0.75) {
          uniqueActivities.set(activity, { status: 'suggest', resolvedKey: match.key, suggested: match.key, score: match.score });
        } else if (match) {
          uniqueActivities.set(activity, { status: 'pick', resolvedKey: '', suggested: match.key, score: match.score });
        } else {
          uniqueActivities.set(activity, { status: 'pick', resolvedKey: '', suggested: '', score: 0 });
        }
      }
    }
  });

  return { rawRecords, uniqueActivities, isPreCalc };
};

// ─── Apply resolution map → final records ────────────────────────────────────
const applyResolutions = (rawRecords, resolutionMap, EF) =>
  rawRecords.map(r => {
    const res = resolutionMap.get(r.activity) ?? { resolvedKey: '', status: 'pick' };
    const key = res.resolvedKey;
    const ef  = key ? EF[key] : null;

    const dateOk = !!r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date);
    const actOk  = !!ef;
    const qtyOk  = r.qty !== null;

    // [FIX-PRECALC-CO2E] If CSV column is "Quantity (tCO2e)" or a co2e column
    // exists, use the raw value directly. Otherwise calculate from EF factor.
    let co2e = null;
    if (actOk && qtyOk) {
      if (r.isPreCalc) {
        // Column is already tCO2e — store directly, no EF multiplication
        co2e = r.co2eRaw ?? r.qty;
      } else if (r.co2eRaw !== null) {
        // Separate co2e column present — use it directly
        co2e = r.co2eRaw;
      } else {
        // Normal path: raw quantity × emission factor
        co2e = (r.qty * ef.factor) / 1000;
      }
    }

    const valid  = dateOk && actOk && (qtyOk || r.co2eRaw !== null);
    const errors = [];
    if (!dateOk) errors.push('Invalid date');
    if (!actOk)  errors.push(!r.activity ? 'Missing activity' : 'Activity not mapped');
    if (!qtyOk && r.co2eRaw === null) errors.push('Invalid quantity');

    return { ...r, key, ef, co2e, valid, errors };
  });

// ─── Templates ────────────────────────────────────────────────────────────────
const TEMPLATES = [
  { id: 'scope1', icon: '🔥', label: 'SCOPE 1', desc: 'Combustion & fugitives', color: '#f97316',
    sample: ['date,activity,quantity,notes',
      '2026-01-15,Diesel (L),500,Generator set A',
      '2026-01-20,LPG (kg),120,Canteen',
      '2026-02-01,Refrigerant R-410A (kg),2.5,AC top-up'] },
  { id: 'scope2', icon: '⚡', label: 'SCOPE 2', desc: 'Purchased electricity', color: '#3b82f6',
    sample: ['date,activity,quantity,notes',
      '2026-01-31,Electricity India Location (kWh),45000,Jan electricity bill',
      '2026-02-28,Electricity India Location (kWh),42000,Feb electricity bill',
      '2026-01-31,District Heating (kWh),12000,Jan heating bill'] },
  { id: 'scope3', icon: '🌐', label: 'SCOPE 3', desc: 'Value chain', color: '#a855f7',
    sample: ['date,activity,quantity,notes',
      '2026-01-10,Air Travel Short (km),1148,BOM-DEL',
      '2026-01-15,Hotel Stay (nights),2,Mumbai trip',
      '2026-01-20,Steel (kg),5000,Raw material purchase'] },
  { id: 'all', icon: '📋', label: 'ALL SCOPES', desc: 'Combined template', color: '#10b981',
    sample: ['date,activity,quantity,notes',
      '2026-01-15,Diesel (L),500,Generator',
      '2026-01-31,Electricity India Location (kWh),45000,Electricity bill',
      '2026-01-10,Air Travel Short (km),1148,Flight BOM-DEL'] },
  // [FIX-PRECALC-CO2E] New template for files that already have tCO2e calculated
  { id: 'precalc', icon: '🧮', label: 'PRE-CALC', desc: 'Already has tCO2e values', color: '#14b8a6',
    sample: ['date,activity,quantity (tCO2e),notes',
      '2026-01-31,Purchased Electricity - HQ Office,0.033,Smart meter data',
      '2026-01-31,Diesel - Owned Fleet Vehicles,85.2,Fleet report',
      '2026-02-28,District Heating - Warehouse A,6.84,Supplier invoice'] },
];

// ─── Styles ───────────────────────────────────────────────────────────────────
const CSS = `
.ci-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:22px;}
.ci-label{font-size:10px;letter-spacing:.15em;color:var(--mut);margin-bottom:10px;display:flex;align-items:center;gap:8px;}
.ci-label::before{content:'';width:12px;height:1px;background:#a855f7;}
.ci-step{font-size:10px;color:var(--mut);letter-spacing:.1em;margin:14px 0 8px;}
.ci-templates{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:18px;}
.ci-tpl{padding:10px;border-radius:8px;border:1px solid var(--brd);background:#080b0e;cursor:pointer;text-align:center;transition:all .2s;}
.ci-tpl:hover{transform:translateY(-1px);}
.ci-tpl-icon{font-size:18px;margin-bottom:4px;}
.ci-tpl-lbl{font-size:10px;font-weight:700;letter-spacing:.06em;margin-bottom:2px;}
.ci-tpl-desc{font-size:9px;color:var(--mut);}
.ci-drop{border:2px dashed var(--brd2);border-radius:10px;padding:32px 24px;text-align:center;cursor:pointer;transition:all .25s;margin-bottom:14px;}
.ci-drop:hover,.ci-drop.over{border-color:#a855f766;background:#a855f708;}
.ci-drop-icon{font-size:36px;margin-bottom:8px;}
.ci-drop-title{font-size:13px;font-weight:700;color:var(--txt);margin-bottom:4px;}
.ci-drop-sub{font-size:11px;color:var(--mut);line-height:1.7;}

/* ── Activity Resolver panel ── */
.ci-resolver{border:1px solid var(--brd);border-radius:8px;margin-bottom:16px;overflow:hidden;}
.ci-resolver-hdr{background:#080b0e;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.ci-resolver-title{font-size:10px;letter-spacing:.1em;color:var(--mut);}
.ci-resolver-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.ci-resolver-table{width:100%;border-collapse:collapse;font-size:11px;}
.ci-resolver-table th{text-align:left;padding:7px 12px;font-size:9px;letter-spacing:.08em;color:var(--mut);border-bottom:1px solid var(--brd);background:#080b0e;}
.ci-resolver-table td{padding:8px 12px;border-bottom:1px solid var(--brd)22;vertical-align:middle;}
.ci-resolver-table tr:last-child td{border-bottom:none;}
.ci-resolver-table tr.rs-exact td{background:#10b98106;}
.ci-resolver-table tr.rs-suggest td{background:#f9731608;}
.ci-resolver-table tr.rs-pick td{background:#ef444408;}
.ci-resolver-table tr.rs-confirmed td{background:#10b98110;}

.ci-raw{font-size:10px;color:var(--mut);margin-bottom:3px;}
.ci-pill-small{font-size:8px;padding:1px 5px;border-radius:3px;margin-left:5px;}
.ci-pill-exact{background:#10b98114;color:#10b981;border:1px solid #10b98133;}
.ci-pill-suggest{background:#f9731614;color:#f97316;border:1px solid #f9731633;}
.ci-pill-pick{background:#ef444414;color:#ef4444;border:1px solid #ef444433;}
.ci-pill-confirmed{background:#10b98114;color:#10b981;border:1px solid #10b98133;}
.ci-count-badge{font-size:9px;padding:1px 6px;border-radius:10px;background:#a855f714;color:#a855f7;border:1px solid #a855f733;white-space:nowrap;}

.ci-picker{font-size:10px;padding:4px 6px;border-radius:4px;border:1px solid var(--brd2);background:#080b0e;color:var(--txt);font-family:'Space Mono',monospace;width:100%;max-width:280px;}
.ci-picker:focus{outline:1px solid #a855f7;}
.ci-confirm-btn{font-size:9px;padding:3px 8px;border-radius:4px;border:1px solid #10b98133;background:#10b98114;color:#10b981;cursor:pointer;font-family:'Space Mono',monospace;white-space:nowrap;}
.ci-confirm-btn:hover{background:#10b98122;}
.ci-change-btn{font-size:9px;padding:3px 8px;border-radius:4px;border:1px solid var(--brd2);background:transparent;color:var(--mut);cursor:pointer;font-family:'Space Mono',monospace;}
.ci-change-btn:hover{color:var(--txt);}

/* ── Pre-calc notice ── */
.ci-precalc-notice{padding:10px 14px;border-radius:7px;background:#14b8a608;border:1px solid #14b8a633;color:#14b8a6;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px;}

/* ── Stats + preview ── */
.ci-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px;}
.ci-stat{background:#080b0e;border-radius:7px;padding:10px;border:1px solid var(--brd);text-align:center;}
.ci-stat-val{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;margin-bottom:2px;}
.ci-stat-lbl{font-size:9px;color:var(--mut);letter-spacing:.08em;}
.ci-actions{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;}
.ci-btn{padding:9px 16px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.ci-btn:disabled{opacity:.4;cursor:not-allowed;}
.ci-btn-pur{background:linear-gradient(135deg,#a855f7,#7c3aed);color:#fff;}
.ci-btn-pur:hover:not(:disabled){opacity:.88;transform:translateY(-1px);}
.ci-btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.ci-btn-g:hover:not(:disabled){border-color:#a855f744;color:#a855f7;}
.ci-btn-green{background:#10b98114;border:1px solid #10b98133;color:#10b981;}
.ci-btn-green:hover:not(:disabled){background:#10b98122;}
.ci-notice{padding:11px 14px;border-radius:7px;font-size:11px;margin-bottom:10px;}
.ci-notice-ok  {background:#10b98108;border:1px solid #10b98133;color:#10b981;}
.ci-notice-warn{background:#f9731608;border:1px solid #f9731633;color:#f97316;}
.ci-notice-err {background:#ef444408;border:1px solid #ef444433;color:#ef4444;}
.ci-scroll{max-height:340px;overflow-y:auto;border-radius:6px;border:1px solid var(--brd);}
.ci-table{width:100%;border-collapse:collapse;font-size:11px;}
.ci-table th{text-align:left;padding:7px 9px;font-size:9px;letter-spacing:.08em;color:var(--mut);border-bottom:1px solid var(--brd);background:#080b0e;position:sticky;top:0;}
.ci-table td{padding:7px 9px;border-bottom:1px solid var(--brd)22;vertical-align:middle;}
.ci-table tr.row-ok  td{background:#10b98104;}
.ci-table tr.row-err td{background:#ef444408;}
.pill{font-size:9px;padding:2px 6px;border-radius:3px;white-space:nowrap;}
.pill-ok {background:#10b98114;color:#10b981;border:1px solid #10b98133;}
.pill-err{background:#ef444414;color:#ef4444;border:1px solid #ef444433;}
.ci-toast{position:fixed;top:76px;right:24px;z-index:9999;padding:11px 18px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000066;animation:fadeUp .3s ease;}
.ci-toast-ok {background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.ci-toast-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
@media(max-width:700px){.ci-templates{grid-template-columns:1fr 1fr 1fr;}.ci-stats{grid-template-columns:1fr 1fr;}}
`;

// ─── Grouped EF dropdown (reused across resolver rows) ───────────────────────
const EF_OPTIONS_CACHE = {};
const getGroupedOptions = (EF) => {
  const key = Object.keys(EF).length;
  if (EF_OPTIONS_CACHE[key]) return EF_OPTIONS_CACHE[key];
  const groups = {};
  for (const k of Object.keys(EF)) {
    const g = `Scope ${EF[k].scope} — ${EF[k].cat.split(':')[0].trim()}`;
    if (!groups[g]) groups[g] = [];
    groups[g].push(k);
  }
  EF_OPTIONS_CACHE[key] = groups;
  return groups;
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function CSVImport({ EF, year, onBulkAdded, onImportError }) {
  const [dragOver,      setDragOver]      = useState(false);
  const [stage,         setStage]         = useState('upload');   // upload | resolve | preview
  const [rawRecords,    setRawRecords]    = useState([]);
  const [resolutionMap, setResolutionMap] = useState(new Map());
  const [isPreCalc,     setIsPreCalc]     = useState(false);
  const [editingRow,    setEditingRow]    = useState(null);
  const [importing,     setImporting]     = useState(false);
  const [imported,      setImported]      = useState(false);
  const [notif,         setNotif]         = useState(null);
  const fileRef = useRef();

  const toast = useCallback((msg, type = 'ok') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 4500);
  }, []);

  const finalRecords = useMemo(
    () => applyResolutions(rawRecords, resolutionMap, EF),
    [rawRecords, resolutionMap, EF]
  );

  const scopeColor = (s) => s === 1 ? '#f97316' : s === 2 ? '#3b82f6' : s === 3 ? '#a855f7' : 'var(--mut)';

  // ── Resolver map helpers ──
  const updateResolution = (rawActivity, resolvedKey) => {
    setResolutionMap(prev => {
      const next = new Map(prev);
      const cur  = next.get(rawActivity) ?? {};
      next.set(rawActivity, { ...cur, resolvedKey, status: resolvedKey ? 'confirmed' : 'pick' });
      return next;
    });
    setEditingRow(null);
  };

  const confirmAll = () => {
    setResolutionMap(prev => {
      const next = new Map(prev);
      for (const [k, v] of next) {
        if (v.status === 'suggest') next.set(k, { ...v, status: 'confirmed', resolvedKey: v.suggested });
      }
      return next;
    });
  };

  // ── File processing ──
  const processFile = async (file) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast('File too large — max 15 MB', 'err'); return; }
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'txt', 'xlsx', 'xls', 'xlsm'].includes(ext)) {
      toast(`Unsupported format .${ext} — use CSV or Excel (.xlsx, .xls, .xlsm)`, 'err'); return;
    }
    try {
      toast('Reading file…');
      const rows = await readFile(file);
      const { rawRecords: rr, uniqueActivities, isPreCalc: preCalc } = parseRows(rows, EF);
      if (rr.length === 0) { toast('No data rows found — check your file has a header row', 'err'); return; }

      setRawRecords(rr);
      setResolutionMap(uniqueActivities);
      setIsPreCalc(preCalc);
      setImported(false);

      const needAction = [...uniqueActivities.values()].filter(v => v.status !== 'exact').length;
      if (needAction === 0) {
        setStage('preview');
        toast(`✓ ${rr.length} rows parsed — all activities matched${preCalc ? ' · pre-calculated tCO2e detected' : ''}, ready to import`);
      } else {
        setStage('resolve');
        toast(`✓ ${rr.length} rows parsed — ${needAction} unique activit${needAction === 1 ? 'y needs' : 'ies need'} review`);
      }
    } catch (err) {
      toast(err.message || 'Could not read file', 'err');
    }
  };

  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0]); };

  // ── Import ──
  const handleImport = async () => {
    if (importing) return;
    const valid = finalRecords.filter(r => r.valid);
    if (!valid.length) { toast('No valid records to import', 'err'); return; }
    setImporting(true);

    try {
      const batch = valid.slice(0, 20000).map(r => ({
        date:     r.date,
        activity: r.key,
        quantity: r.qty,
        unit:     r.ef?.unit     || (r.isPreCalc ? 'tCO2e' : ''),
        scope:    r.ef?.scope    || null,
        category: r.ef?.cat      || '',
        factor:   r.isPreCalc ? 1 : (r.ef?.factor || null),
        co2e:     r.co2e,
        notes:    r.notes,
        source:   r.ef?.source   || (r.isPreCalc ? 'CSV Import (pre-calculated)' : 'CSV Import'),
      }));

      const res = await apiFetch('/api/emissions/bulk', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ records: batch }),
      });

      if (!res) throw new Error('No response from server');

      const inserted = res.inserted ?? batch.length;
      const skipped  = res.skipped  ?? 0;

      const msg = skipped > 0
        ? `✓ ${inserted} records imported · ${skipped} skipped (date/qty errors)`
        : `✓ ${inserted} records imported into GHG ledger`;
      toast(msg);
      setImported(true);

      if (typeof onBulkAdded === 'function') {
        await onBulkAdded({
          inserted,
          duplicates: res.duplicates ?? 0,
          errSkipped: res.errSkipped ?? 0,
          total:      batch.length,
        });
      }

    } catch (err) {
      const msg = err?.message?.includes('No response')
        ? 'Import failed — server did not respond. Try again.'
        : err?.message || 'Import failed — please try again';
      toast(msg, 'err');
      if (typeof onImportError === 'function') onImportError(msg);
    } finally {
      setImporting(false);
    }
  };

  const reset = () => { setStage('upload'); setRawRecords([]); setResolutionMap(new Map()); setIsPreCalc(false); setImported(false); };

  // ── Resolver stats ──
  const resEntries     = [...resolutionMap.entries()];
  const exactCount     = resEntries.filter(([,v]) => v.status === 'exact').length;
  const suggestCount   = resEntries.filter(([,v]) => v.status === 'suggest').length;
  const confirmedCount = resEntries.filter(([,v]) => v.status === 'confirmed').length;
  const pickCount      = resEntries.filter(([,v]) => v.status === 'pick').length;
  const allResolved    = suggestCount === 0 && pickCount === 0;

  const validCount  = finalRecords.filter(r => r.valid).length;
  const errorCount  = finalRecords.filter(r => !r.valid).length;
  const totalCo2e   = finalRecords.filter(r => r.valid).reduce((s, r) => s + (r.co2e || 0), 0);

  const groupedOptions = getGroupedOptions(EF);

  const downloadTemplate = (tpl) => {
    const url = URL.createObjectURL(new Blob([tpl.sample.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `ethertrack_${tpl.id}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`✓ ${tpl.label} template downloaded`);
  };

  return (
    <>
      <style>{CSS}</style>
      {notif && <div className={`ci-toast ci-toast-${notif.type === 'err' ? 'err' : 'ok'}`}>{notif.msg}</div>}

      <div className="ci-card">
        <div className="ci-label">BULK IMPORT — CSV / EXCEL</div>

        {/* ══ STAGE: UPLOAD ══════════════════════════════════════════════════ */}
        {stage === 'upload' && (<>
          <div className="ci-step">STEP 1 — DOWNLOAD A TEMPLATE (OPTIONAL)</div>
          <div className="ci-templates">
            {TEMPLATES.map(tpl => (
              <div key={tpl.id} className="ci-tpl" style={{ borderColor: `${tpl.color}22` }} onClick={() => downloadTemplate(tpl)}>
                <div className="ci-tpl-icon">{tpl.icon}</div>
                <div className="ci-tpl-lbl" style={{ color: tpl.color }}>{tpl.label}</div>
                <div className="ci-tpl-desc">{tpl.desc}</div>
                <div style={{ fontSize: 9, color: tpl.color, marginTop: 5 }}>↓ DOWNLOAD</div>
              </div>
            ))}
          </div>

          <div className="ci-step">STEP 2 — UPLOAD YOUR FILE</div>
          <div
            className={`ci-drop${dragOver ? ' over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <div className="ci-drop-icon">📊</div>
            <div className="ci-drop-title">DROP FILE HERE OR CLICK TO BROWSE</div>
            <div className="ci-drop-sub">
              CSV, Excel (.xlsx / .xls / .xlsm) · Max 15 MB · Up to 20,000 rows<br/>
              Column order doesn't matter — we detect date, activity, quantity, notes automatically<br/>
              <span style={{ color: '#14b8a6' }}>Pre-calculated tCO₂e columns auto-detected</span> — name your quantity column "Quantity (tCO2e)"
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls,.xlsm"
            style={{ display: 'none' }} onChange={e => processFile(e.target.files[0])} />
          <div style={{ fontSize: 10, color: 'var(--mut)', textAlign: 'center', marginTop: 4 }}>
            Activity names don't need to match exactly — we'll suggest the right emission factor · Scope 2 electricity, heating & cooling fully supported
          </div>
          <div style={{ fontSize: 9, color: '#14b8a6', textAlign: 'center', marginTop: 6 }}>
            📝 ODS (OpenDocument) format not supported — please use .xlsx, .xls, .xlsm, or CSV
          </div>
        </>)}

        {/* ══ STAGE: RESOLVE ═════════════════════════════════════════════════ */}
        {stage === 'resolve' && (<>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--txt)', marginBottom: 4, fontWeight: 700 }}>
              Map activities to emission factors
            </div>
            <div style={{ fontSize: 11, color: 'var(--mut)', lineHeight: 1.6 }}>
              Found <strong style={{ color: 'var(--txt)' }}>{resolutionMap.size} unique activities</strong> across{' '}
              <strong style={{ color: 'var(--txt)' }}>{rawRecords.length.toLocaleString()} rows</strong>.
              Resolve these {resolutionMap.size} mappings once — all matching rows update instantly.
            </div>
          </div>

          {/* [FIX-PRECALC-CO2E] Show notice when pre-calculated values detected */}
          {isPreCalc && (
            <div className="ci-precalc-notice">
              <span>🧮</span>
              <span>
                <strong>Pre-calculated tCO₂e detected</strong> — your quantity column contains tCO₂e values.
                These will be stored directly without applying an emission factor.
                Activity mapping is still required to assign scope, category, and source.
              </span>
            </div>
          )}

          <div className="ci-resolver">
            <div className="ci-resolver-hdr">
              <div className="ci-resolver-title">
                ACTIVITY RESOLVER
                <span style={{ marginLeft: 10, fontSize: 9, color: 'var(--mut)' }}>
                  {exactCount > 0 && `${exactCount} exact · `}
                  {suggestCount > 0 && `${suggestCount} suggested · `}
                  {confirmedCount > 0 && `${confirmedCount} confirmed · `}
                  {pickCount > 0 && `${pickCount} need selection`}
                </span>
              </div>
              <div className="ci-resolver-actions">
                {suggestCount > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--mut)' }}>
                    {suggestCount} auto-suggestion{suggestCount > 1 ? 's' : ''} waiting
                  </span>
                )}
                {suggestCount > 0 && (
                  <button className="ci-btn-green ci-confirm-btn" style={{ padding: '5px 12px', fontSize: 10 }} onClick={confirmAll}>
                    ✓ CONFIRM ALL SUGGESTIONS
                  </button>
                )}
              </div>
            </div>

            <table className="ci-resolver-table">
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>YOUR ACTIVITY NAME</th>
                  <th style={{ width: '40%' }}>MAPPED TO EMISSION FACTOR</th>
                  <th style={{ width: '15%' }}>ROWS</th>
                  <th style={{ width: '15%' }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {resEntries.map(([rawActivity, res]) => {
                  const rowsAffected = rawRecords.filter(r => r.activity === rawActivity).length;
                  const isEditing    = editingRow === rawActivity;
                  const rowClass     = res.status === 'exact' ? 'rs-exact'
                    : res.status === 'confirmed' ? 'rs-confirmed'
                    : res.status === 'suggest' ? 'rs-suggest'
                    : 'rs-pick';
                  const ef = res.resolvedKey ? EF[res.resolvedKey] : null;

                  return (
                    <tr key={rawActivity} className={rowClass}>
                      <td>
                        <div style={{ fontSize: 11, color: 'var(--txt)', fontWeight: 500 }}>
                          {rawActivity || <span style={{ color: 'var(--mut)' }}>(blank)</span>}
                        </div>
                        {isPreCalc && (
                          <div style={{ fontSize: 9, color: '#14b8a6', marginTop: 2 }}>pre-calc tCO₂e</div>
                        )}
                      </td>

                      <td>
                        {isEditing ? (
                          <select
                            className="ci-picker"
                            autoFocus
                            defaultValue={res.resolvedKey || res.suggested || ''}
                            onChange={e => updateResolution(rawActivity, e.target.value)}
                            onBlur={e => { if (!e.target.value) setEditingRow(null); else updateResolution(rawActivity, e.target.value); }}
                          >
                            <option value="">— select emission factor —</option>
                            {Object.entries(groupedOptions).map(([grp, keys]) => (
                              <optgroup key={grp} label={grp}>
                                {keys.map(k => <option key={k} value={k}>{k}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        ) : res.status === 'pick' ? (
                          <div>
                            {res.suggested && (
                              <div style={{ fontSize: 9, color: 'var(--mut)', marginBottom: 4 }}>
                                Best guess: {res.suggested}
                              </div>
                            )}
                            <select
                              className="ci-picker"
                              value={res.resolvedKey || ''}
                              onChange={e => updateResolution(rawActivity, e.target.value)}
                            >
                              <option value="">— select emission factor —</option>
                              {Object.entries(groupedOptions).map(([grp, keys]) => (
                                <optgroup key={grp} label={grp}>
                                  {keys.map(k => <option key={k} value={k}>{k}</option>)}
                                </optgroup>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--txt)', fontWeight: 500 }}>{res.resolvedKey}</div>
                              {ef && (
                                <div style={{ fontSize: 9, color: 'var(--mut)', marginTop: 1 }}>
                                  {isPreCalc ? 'tCO₂e direct' : ef.unit} · S{ef.scope} · {ef.cat.split(':').slice(-1)[0].trim()}
                                </div>
                              )}
                            </div>
                            <button className="ci-change-btn" onClick={() => setEditingRow(rawActivity)}>change</button>
                          </div>
                        )}
                      </td>

                      <td>
                        <span className="ci-count-badge">{rowsAffected.toLocaleString()} rows</span>
                      </td>

                      <td>
                        {res.status === 'exact' && (
                          <span className="ci-pill-small ci-pill-exact">✓ EXACT</span>
                        )}
                        {res.status === 'confirmed' && (
                          <span className="ci-pill-small ci-pill-confirmed">✓ CONFIRMED</span>
                        )}
                        {res.status === 'suggest' && (
                          <button className="ci-confirm-btn" onClick={() => updateResolution(rawActivity, res.suggested)}>
                            confirm ✓
                          </button>
                        )}
                        {res.status === 'pick' && !res.resolvedKey && (
                          <span className="ci-pill-small ci-pill-pick">SELECT ↑</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="ci-actions">
            <button
              className="ci-btn ci-btn-pur"
              disabled={!allResolved && pickCount > 0}
              onClick={() => setStage('preview')}
            >
              {allResolved
                ? `PREVIEW ${rawRecords.length.toLocaleString()} ROWS →`
                : `RESOLVE ${pickCount} REMAINING TO CONTINUE`}
            </button>
            <button className="ci-btn ci-btn-g" onClick={reset}>UPLOAD DIFFERENT FILE</button>
          </div>

          {pickCount > 0 && (
            <div className="ci-notice ci-notice-err">
              ✕ {pickCount} activit{pickCount === 1 ? 'y needs' : 'ies need'} an emission factor selected above before you can proceed.
            </div>
          )}
        </>)}

        {/* ══ STAGE: PREVIEW ═════════════════════════════════════════════════ */}
        {stage === 'preview' && (<>
          {isPreCalc && (
            <div className="ci-precalc-notice">
              <span>🧮</span>
              <span>
                <strong>Pre-calculated tCO₂e mode</strong> — quantity values are stored as-is.
                tCO₂e column: {totalCo2e.toFixed(3)} total · no EF multiplication applied.
              </span>
            </div>
          )}

          <div className="ci-stats">
            {[
              { label: 'TOTAL ROWS',        val: finalRecords.length.toLocaleString(), color: 'var(--txt)' },
              { label: 'VALID',             val: validCount.toLocaleString(),           color: '#10b981'    },
              { label: 'ERRORS',            val: errorCount,                            color: errorCount > 0 ? '#ef4444' : 'var(--mut)' },
              { label: 'UNIQUE ACTIVITIES', val: resolutionMap.size,                    color: '#3b82f6'    },
              { label: 'TOTAL tCO₂e',      val: totalCo2e.toFixed(2),                 color: '#a855f7'    },
            ].map(({ label, val, color }) => (
              <div key={label} className="ci-stat">
                <div className="ci-stat-val" style={{ color }}>{val}</div>
                <div className="ci-stat-lbl">{label}</div>
              </div>
            ))}
          </div>

          <div className="ci-actions">
            {!imported && validCount > 0 && (
              <button className="ci-btn ci-btn-pur" onClick={handleImport} disabled={importing}>
                {importing ? '⟳ IMPORTING…' : `IMPORT ${validCount.toLocaleString()} RECORDS →`}
              </button>
            )}
            <button className="ci-btn ci-btn-g" onClick={() => setStage('resolve')}>
              ← BACK TO ACTIVITY MAP
            </button>
            <button className="ci-btn ci-btn-g" onClick={reset}>UPLOAD DIFFERENT FILE</button>
          </div>

          {imported && (
            <div className="ci-notice ci-notice-ok">✓ {validCount.toLocaleString()} records imported into GHG ledger</div>
          )}
          {errorCount > 0 && (
            <div className="ci-notice ci-notice-err">
              ✕ {errorCount} rows have date or quantity errors and will be skipped.
            </div>
          )}

          <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 6 }}>
            PREVIEW — FIRST 200 ROWS
          </div>
          <div className="ci-scroll">
            <table className="ci-table">
              <thead>
                <tr>
                  <th>ROW</th>
                  <th>DATE</th>
                  <th>MAPPED ACTIVITY</th>
                  <th>QTY</th>
                  <th>tCO₂e</th>
                  <th>SCOPE</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {finalRecords.slice(0, 200).map(r => (
                  <tr key={r.rowNum} className={r.valid ? 'row-ok' : 'row-err'}>
                    <td style={{ color: 'var(--mut)', fontFamily: 'monospace' }}>{r.rowNum}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {/^\d{4}-\d{2}-\d{2}$/.test(r.date)
                        ? r.date
                        : <span style={{ color: '#ef4444' }}>{r.rawDate || '—'}</span>}
                    </td>
                    <td>
                      {r.activity !== r.key && r.activity && (
                        <div className="ci-raw">{r.activity.slice(0, 40)}{r.activity.length > 40 ? '…' : ''}</div>
                      )}
                      <span style={{ color: 'var(--txt)' }}>{r.key || '—'}</span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {r.qty != null
                        ? `${r.qty.toLocaleString()} ${r.isPreCalc ? 'tCO₂e' : (r.ef?.unit || '')}`
                        : <span style={{ color: '#ef4444' }}>—</span>}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', color: '#a855f7', fontWeight: 700 }}>
                      {r.co2e != null ? r.co2e.toFixed(4) : '—'}
                      {r.isPreCalc && <span style={{ fontSize: 8, color: '#14b8a6', marginLeft: 3 }}>direct</span>}
                    </td>
                    <td style={{ color: scopeColor(r.ef?.scope), fontWeight: 700 }}>
                      {r.ef?.scope ? `S${r.ef.scope}` : '—'}
                    </td>
                    <td>
                      {r.valid
                        ? <span className="pill pill-ok">✓ READY</span>
                        : <span className="pill pill-err" title={r.errors.join(', ')}>✕ {r.errors[0]?.slice(0, 22)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {finalRecords.length > 200 && (
            <div style={{ fontSize: 10, color: 'var(--mut)', textAlign: 'center', padding: '8px 0' }}>
              Showing 200 of {finalRecords.length.toLocaleString()} rows · all valid rows will be imported
            </div>
          )}
        </>)}
      </div>
    </>
  );
}