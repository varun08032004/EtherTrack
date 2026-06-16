// src/components/EmissionTracking.jsx
// ── Regulatory compliance:
//    CEA V20.0 Dec 2024 — grid EF 0.727 tCO₂/MWh (FY 2023-24 weighted avg)
//    GHG Protocol Scope 2 Guidance — dual reporting (location + market) MANDATORY
//    SEBI BRSR Dec 2024 circular — PPP-adjusted intensity, output-based intensity
//    BEE CCTS Oct 2025 / Jan 2026 gazette — 9 sectors
//    IPCC AR6 GWP100 — all GHG factors
//    DEFRA 2024 — non-India factors
// ── Bug fixes v5:
//    [FIX-TIER-GATE]   Corporate-only tabs gated — ESG, BRSR-ENV, AUDIT, GEI,
//                      PAT, CCTS, ACTION-PLAN, SBTi, SUPPLIERS, MULTI-ENTITY.
//                      Growth users see UpgradeLock screen with CTA.
//    [FIX-PDF-GATE]    Growth: GHG Protocol export only. BRSR/CDP/TCFD buttons
//                      visible but show PdfUpgradeModal on click.
//    [FIX-NZ-BARS]     Net Zero Roadmap progress bars now dynamic — computed
//                      from prev year baseline vs current emissions vs target.
//                      Was hardcoded at 2% for all milestones.
//    [FIX-ESG-STATUS]  SBTi/PAT/CCTS ok: false hardcodes replaced with real
//                      data checks: patData, cctsData, profile net_zero fields.
//    [FIX-PLAN-FETCH]  subscriptionPlan loaded from /api/org/plan in loadAll.
// ── Bug fixes v4:
//    [FIX-CEA-KWH]  CEA grid EF 1000x bug fixed — 0.000727 tCO2e/kWh
//    [FIX-NEW-TABS] Added GEI REPORT, SBTi TARGETS, 5-YEAR PLAN, SUPPLIERS
// ── Bug fixes v3:
//    [FIX-PDF]  [FIX-CSRF]  [FIX-404]  [FIX-LOAD]  [FIX-VALIDATE]
// ── Security: abort controllers, input sanitisation, XSS prevention,
//    blob URL revocation, no window.confirm, rate limiting awareness

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, LineElement, BarElement, ArcElement,
  CategoryScale, LinearScale, PointElement, Tooltip, Legend, Filler
} from 'chart.js';
import { apiFetch } from '../services/api';
import BRSREnvironmental  from './BRSREnvironmental';
import AuditTrail         from './AuditTrail';
import PATScheme          from './PATScheme';
import MultiEntity        from './MultiEntity';
import CCTSCompliance     from './CCTSCompliance';
import SBTiModule         from './SBTiModule';
import FiveYearActionPlan from './FiveYearActionPlan';
import SupplierPortal     from './SupplierPortal';
import EmissionLogHub from './emission-log/EmissionLogHub';

ChartJS.register(
  LineElement, BarElement, ArcElement,
  CategoryScale, LinearScale, PointElement, Tooltip, Legend, Filler
);

// ─────────────────────────────────────────────────────────────────────────────
// EMISSION FACTORS
// CEA V20.0 Dec 2024: weighted-avg grid EF = 0.727 tCO2/MWh (FY 2023-24)
// ─────────────────────────────────────────────────────────────────────────────
const CEA_GRID_EF_2024 = 0.727;


const EF = {
  'Diesel (L)':                  { factor: 2.68,   unit: 'L',      scope: 1, cat: 'Stationary Combustion',  source: 'DEFRA 2024' },
  'Petrol (L)':                  { factor: 2.31,   unit: 'L',      scope: 1, cat: 'Stationary Combustion',  source: 'DEFRA 2024' },
  'Natural Gas (m3)':            { factor: 2.02,   unit: 'm3',     scope: 1, cat: 'Stationary Combustion',  source: 'DEFRA 2024' },
  'Coal (kg)':                   { factor: 2.42,   unit: 'kg',     scope: 1, cat: 'Stationary Combustion',  source: 'IPCC AR6'   },
  'LPG (kg)':                    { factor: 2.98,   unit: 'kg',     scope: 1, cat: 'Stationary Combustion',  source: 'DEFRA 2024' },
  'Furnace Oil (L)':             { factor: 3.18,   unit: 'L',      scope: 1, cat: 'Stationary Combustion',  source: 'DEFRA 2024' },
  'Biomass (kg)':                { factor: 0.015,  unit: 'kg',     scope: 1, cat: 'Stationary Combustion',  source: 'IPCC AR6 biogenic' },
  'Company Vehicle Diesel (km)': { factor: 0.24,   unit: 'km',     scope: 1, cat: 'Mobile Combustion',      source: 'DEFRA 2024' },
  'Company Vehicle Petrol (km)': { factor: 0.21,   unit: 'km',     scope: 1, cat: 'Mobile Combustion',      source: 'DEFRA 2024' },
  'Company Vehicle CNG (km)':    { factor: 0.16,   unit: 'km',     scope: 1, cat: 'Mobile Combustion',      source: 'DEFRA 2024' },
  'Refrigerant R-410A (kg)':     { factor: 2088,   unit: 'kg',     scope: 1, cat: 'Fugitive Emissions',     source: 'IPCC AR6 GWP100' },
  'Refrigerant R-22 (kg)':       { factor: 1810,   unit: 'kg',     scope: 1, cat: 'Fugitive Emissions',     source: 'IPCC AR6 GWP100' },
  'Refrigerant R-32 (kg)':       { factor: 675,    unit: 'kg',     scope: 1, cat: 'Fugitive Emissions',     source: 'IPCC AR6 GWP100' },
  'Methane leakage (m3)':        { factor: 2.86,   unit: 'm3',     scope: 1, cat: 'Fugitive Emissions',     source: 'IPCC AR6 GWP100' },
  'Electricity India Location (kWh)': { factor: CEA_GRID_EF_2024 / 1000, unit: 'kWh', scope: 2, cat: 'Purchased Electricity Location-based', source: 'CEA V20.0 Dec 2024 0.727 tCO2/MWh', method: 'location' },
  'Electricity EU Location (kWh)':    { factor: 0.28,  unit: 'kWh', scope: 2, cat: 'Purchased Electricity Location-based', source: 'IEA 2024', method: 'location' },
  'Electricity US Location (kWh)':    { factor: 0.39,  unit: 'kWh', scope: 2, cat: 'Purchased Electricity Location-based', source: 'IEA 2024', method: 'location' },
  'Electricity China Location (kWh)': { factor: 0.58,  unit: 'kWh', scope: 2, cat: 'Purchased Electricity Location-based', source: 'IEA 2024', method: 'location' },
  'Electricity India REC (kWh)':          { factor: 0.0,   unit: 'kWh', scope: 2, cat: 'Purchased Electricity Market-based', source: 'REC instrument zero emission attribute', method: 'market' },
  'Electricity India PPA Solar (kWh)':    { factor: 0.041, unit: 'kWh', scope: 2, cat: 'Purchased Electricity Market-based', source: 'IPCC AR6 LCA Solar', method: 'market' },
  'Electricity India PPA Wind (kWh)':     { factor: 0.011, unit: 'kWh', scope: 2, cat: 'Purchased Electricity Market-based', source: 'IPCC AR6 LCA Wind', method: 'market' },
  'Electricity India Green Tariff (kWh)': { factor: 0.0,   unit: 'kWh', scope: 2, cat: 'Purchased Electricity Market-based', source: 'Supplier green tariff instrument', method: 'market' },
  'District Heating (kWh)':   { factor: 0.18,  unit: 'kWh', scope: 2, cat: 'Purchased Heat/Steam', source: 'DEFRA 2024' },
  'District Cooling (kWh)':   { factor: 0.25,  unit: 'kWh', scope: 2, cat: 'Purchased Cooling',    source: 'DEFRA 2024' },
  'Solar/Renewable Own (kWh)':{ factor: 0.041, unit: 'kWh', scope: 2, cat: 'Purchased Electricity Market-based', source: 'IPCC AR6 LCA', method: 'market' },
  'Steel (kg)':           { factor: 1.85,  unit: 'kg',   scope: 3, cat: 'Cat 1: Purchased Goods & Services', source: 'IPCC AR6' },
  'Aluminium (kg)':       { factor: 11.5,  unit: 'kg',   scope: 3, cat: 'Cat 1: Purchased Goods & Services', source: 'IPCC AR6' },
  'Plastic (kg)':         { factor: 3.14,  unit: 'kg',   scope: 3, cat: 'Cat 1: Purchased Goods & Services', source: 'IPCC AR6' },
  'Cement (kg)':          { factor: 0.83,  unit: 'kg',   scope: 3, cat: 'Cat 1: Purchased Goods & Services', source: 'IPCC AR6' },
  'Paper (kg)':           { factor: 0.91,  unit: 'kg',   scope: 3, cat: 'Cat 1: Purchased Goods & Services', source: 'DEFRA 2024' },
  'Glass (kg)':           { factor: 0.54,  unit: 'kg',   scope: 3, cat: 'Cat 1: Purchased Goods & Services', source: 'IPCC AR6' },
  'Copper (kg)':          { factor: 3.42,  unit: 'kg',   scope: 3, cat: 'Cat 1: Purchased Goods & Services', source: 'IPCC AR6' },
  'IT Equipment (unit)':  { factor: 300,   unit: 'unit', scope: 3, cat: 'Cat 1: Purchased Goods & Services', source: 'DEFRA 2024' },
  'Cloud Computing (kWh)':{ factor: 0.33,  unit: 'kWh',  scope: 3, cat: 'Cat 1: Purchased Goods & Services', source: 'DEFRA 2024' },
  'Capital Equipment (Lakh)':  { factor: 2.1, unit: 'Lakh', scope: 3, cat: 'Cat 2: Capital Goods', source: 'DEFRA 2024' },
  'Building Construction (m2)': { factor: 500, unit: 'm2',  scope: 3, cat: 'Cat 2: Capital Goods', source: 'IPCC AR6' },
  'Upstream Natural Gas (m3)': { factor: 0.37,  unit: 'm3',  scope: 3, cat: 'Cat 3: Fuel & Energy Related', source: 'DEFRA 2024' },
  'Upstream Diesel (L)':       { factor: 0.61,  unit: 'L',   scope: 3, cat: 'Cat 3: Fuel & Energy Related', source: 'DEFRA 2024' },
  'T&D Losses India (kWh)':    { factor: 0.073, unit: 'kWh', scope: 3, cat: 'Cat 3: Fuel & Energy Related', source: 'CEA V20.0 Dec 2024 T&D losses' },
  'Road Freight (tonne-km)': { factor: 0.062, unit: 't-km', scope: 3, cat: 'Cat 4: Upstream Transport & Distribution', source: 'DEFRA 2024' },
  'Sea Freight (tonne-km)':  { factor: 0.010, unit: 't-km', scope: 3, cat: 'Cat 4: Upstream Transport & Distribution', source: 'DEFRA 2024' },
  'Air Freight (tonne-km)':  { factor: 0.602, unit: 't-km', scope: 3, cat: 'Cat 4: Upstream Transport & Distribution', source: 'DEFRA 2024' },
  'Rail Freight (tonne-km)': { factor: 0.028, unit: 't-km', scope: 3, cat: 'Cat 4: Upstream Transport & Distribution', source: 'DEFRA 2024' },
  'Landfill Waste (kg)':    { factor: 0.58,  unit: 'kg', scope: 3, cat: 'Cat 5: Waste in Operations', source: 'DEFRA 2024' },
  'Recycled Waste (kg)':    { factor: 0.021, unit: 'kg', scope: 3, cat: 'Cat 5: Waste in Operations', source: 'DEFRA 2024' },
  'Incinerated Waste (kg)': { factor: 0.34,  unit: 'kg', scope: 3, cat: 'Cat 5: Waste in Operations', source: 'DEFRA 2024' },
  'Composted Waste (kg)':   { factor: 0.010, unit: 'kg', scope: 3, cat: 'Cat 5: Waste in Operations', source: 'DEFRA 2024' },
  'Wastewater (m3)':        { factor: 0.344, unit: 'm3', scope: 3, cat: 'Cat 5: Waste in Operations', source: 'DEFRA 2024' },
  'Air Travel Short (km)':  { factor: 0.255, unit: 'km',     scope: 3, cat: 'Cat 6: Business Travel', source: 'DEFRA 2024' },
  'Air Travel Long (km)':   { factor: 0.195, unit: 'km',     scope: 3, cat: 'Cat 6: Business Travel', source: 'DEFRA 2024' },
  'Rail Travel (km)':       { factor: 0.041, unit: 'km',     scope: 3, cat: 'Cat 6: Business Travel', source: 'DEFRA 2024' },
  'Hotel Stay (nights)':    { factor: 0.031, unit: 'nights', scope: 3, cat: 'Cat 6: Business Travel', source: 'DEFRA 2024' },
  'Car Rental (km)':        { factor: 0.19,  unit: 'km',     scope: 3, cat: 'Cat 6: Business Travel', source: 'DEFRA 2024' },
  'Employee Commute Car (km)':   { factor: 0.14,  unit: 'km',  scope: 3, cat: 'Cat 7: Employee Commuting', source: 'DEFRA 2024' },
  'Employee Commute Bus (km)':   { factor: 0.089, unit: 'km',  scope: 3, cat: 'Cat 7: Employee Commuting', source: 'DEFRA 2024' },
  'Employee Commute Metro (km)': { factor: 0.031, unit: 'km',  scope: 3, cat: 'Cat 7: Employee Commuting', source: 'DEFRA 2024' },
  'Employee WFH (day)':          { factor: 2.1,   unit: 'day', scope: 3, cat: 'Cat 7: Employee Commuting', source: 'DEFRA 2024' },
  'Leased Office Space (m2-yr)': { factor: 98,   unit: 'm2-yr', scope: 3, cat: 'Cat 8: Upstream Leased Assets', source: 'DEFRA 2024' },
  'Leased Vehicle (km)':         { factor: 0.21, unit: 'km',    scope: 3, cat: 'Cat 8: Upstream Leased Assets', source: 'DEFRA 2024' },
  'Downstream Road Freight (t-km)': { factor: 0.062, unit: 't-km', scope: 3, cat: 'Cat 9: Downstream Transport', source: 'DEFRA 2024' },
  'Customer Last-mile (km)':        { factor: 0.12,  unit: 'km',   scope: 3, cat: 'Cat 9: Downstream Transport', source: 'DEFRA 2024' },
  'Product Processing (kg)':        { factor: 0.45, unit: 'kg', scope: 3, cat: 'Cat 10: Processing of Sold Products', source: 'DEFRA 2024' },
  'Product Energy Use (kWh)':       { factor: CEA_GRID_EF_2024 / 1000, unit: 'kWh', scope: 3, cat: 'Cat 11: Use of Sold Products', source: 'CEA V20.0 Dec 2024' },
  'Product Landfill (kg)':          { factor: 0.58,  unit: 'kg', scope: 3, cat: 'Cat 12: End-of-Life Treatment', source: 'DEFRA 2024' },
  'Product Recycling (kg)':         { factor: 0.021, unit: 'kg', scope: 3, cat: 'Cat 12: End-of-Life Treatment', source: 'DEFRA 2024' },
  'Leased Asset Electricity (kWh)': { factor: CEA_GRID_EF_2024 / 1000, unit: 'kWh', scope: 3, cat: 'Cat 13: Downstream Leased Assets', source: 'CEA V20.0 Dec 2024' },
  'Franchise Operations (Lakh)':    { factor: 1.8, unit: 'Lakh', scope: 3, cat: 'Cat 14: Franchises',  source: 'DEFRA 2024' },
  'Equity Investment (Cr)':         { factor: 8.5, unit: 'Cr',   scope: 3, cat: 'Cat 15: Investments', source: 'DEFRA 2024 PCAF' },
  'Debt/Loans (Cr)':                { factor: 3.2, unit: 'Cr',   scope: 3, cat: 'Cat 15: Investments', source: 'DEFRA 2024 PCAF' },
  'Coal for Power (tonne)':     { factor: 2420, unit: 'tonne', scope: 1, cat: 'PAT Energy Consumption', source: 'BEE India' },
  'FO/LSHS (kL)':               { factor: 3180, unit: 'kL',   scope: 1, cat: 'PAT Energy Consumption', source: 'BEE India' },
  'HSD (kL)':                   { factor: 2680, unit: 'kL',   scope: 1, cat: 'PAT Energy Consumption', source: 'BEE India' },
  'Grid Electricity PAT (kWh)': { factor: CEA_GRID_EF_2024 / 1000, unit: 'kWh', scope: 2, cat: 'PAT Energy Consumption', source: 'CEA V20.0 Dec 2024' },
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const SC   = { 1: '#f97316', 2: '#3b82f6', 3: '#a855f7' };
const fmt  = (n, d = 2) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const sanitise = (str = '') => String(str).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, 500);
const safeNum = (val, min = 0, max = 1e12) => {
  const n = parseFloat(val);
  if (!isFinite(n) || n < min || n > max) return null;
  return n;
};
const calc = (activity, qty) => {
  const e = EF[activity];
  const q = safeNum(qty);
  if (!e || q === null) return null;
  return { co2e: (q * e.factor / 1000), scope: e.scope, cat: e.cat, unit: e.unit, factor: e.factor, source: e.source, method: e.method || null };
};

const IMF_PPP_RATE_INR = 27.3;
const MONTHS       = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const REPORT_YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i);

const INDUSTRY_BENCHMARKS = {
  'Manufacturing':  { low: 2.0,  medium: 5.0,  high: 12.0 },
  'IT/Software':    { low: 0.1,  medium: 0.3,  high: 0.8  },
  'Finance':        { low: 0.05, medium: 0.15, high: 0.4  },
  'Healthcare':     { low: 0.3,  medium: 0.8,  high: 2.0  },
  'Retail':         { low: 0.2,  medium: 0.6,  high: 1.5  },
  'Logistics':      { low: 3.0,  medium: 7.0,  high: 15.0 },
  'Construction':   { low: 1.5,  medium: 4.0,  high: 10.0 },
  'Energy':         { low: 5.0,  medium: 12.0, high: 25.0 },
  'Agriculture':    { low: 1.0,  medium: 3.0,  high: 8.0  },
  'Education':      { low: 0.1,  medium: 0.3,  high: 0.7  },
  'Other':          { low: 0.5,  medium: 1.5,  high: 4.0  },
};

const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#4a5a6a', font: { family: 'Space Mono', size: 10 } } },
    tooltip: {
      backgroundColor: '#0b0f12', borderColor: '#1a2028', borderWidth: 1,
      titleColor: '#e8eef4', bodyColor: '#4a5a6a',
      titleFont: { family: 'Space Mono' }, bodyFont: { family: 'Space Mono', size: 10 },
    },
  },
  scales: {
    x: { ticks: { color: '#2a3a4a', font: { family: 'Space Mono', size: 9 } }, grid: { color: '#1a202822' } },
    y: { ticks: { color: '#2a3a4a', font: { family: 'Space Mono', size: 9 } }, grid: { color: '#1a202844' } },
  },
};


// ─────────────────────────────────────────────────────────────────────────────
// CSV PARSER
// ─────────────────────────────────────────────────────────────────────────────
const parseCSV = (text) => {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || '').trim().replace(/^"|"$/g, ''); });
    const ef  = EF[obj.activity];
    const qty = safeNum(obj.quantity || obj.qty, 0);
    if (qty === null) return null;
    return {
      date:     sanitise(obj.date),
      activity: sanitise(obj.activity),
      quantity: qty,
      notes:    sanitise(obj.notes || ''),
      unit:     ef?.unit,
      scope:    ef?.scope || parseInt(obj.scope),
      category: ef?.cat   || sanitise(obj.category),
      factor:   ef?.factor,
      source:   sanitise(ef?.source || obj.source || 'Manual entry'),
      co2e:     ef ? qty * ef.factor / 1000 : safeNum(obj.co2e, 0) || 0,
    };
  }).filter(r => r && r.date && r.activity && r.quantity > 0);
};

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-TIER-GATE] Tier helpers
// ─────────────────────────────────────────────────────────────────────────────
const CORPORATE_PLANS = ['corporate', 'enterprise'];
const isCorporate = (plan) => CORPORATE_PLANS.includes(plan);

// Tabs locked to Corporate+
const CORPORATE_TABS = [
  'esg', 'brsr-env', 'audit', 'gei-report',
  'pat-scheme', 'ccts', 'action-plan', 'sbti', 'suppliers', 'multi',
];

// PDF types locked to Corporate+ (ghg-protocol available on Growth)
const CORPORATE_PDF_TYPES = ['brsr', 'cdp', 'tcfd'];

// ─────────────────────────────────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  ['log',         'LOG EMISSION'],
  ['ledger',      'GHG LEDGER'],
  ['analytics',   'ANALYTICS'],
  ['intensity',   'INTENSITY'],
  ['esg',         'ESG REPORT'],
  ['brsr-env',    'BRSR ENVIRONMENTAL'],
  ['audit',       'AUDIT TRAIL'],
  ['pat-scheme',  'PAT SCHEME'],
  ['ccts',        'CCTS COMPLIANCE'],
  ['action-plan', '5-YEAR PLAN'],
  ['sbti',        'SBTi TARGETS'],
  ['suppliers',   'SUPPLIERS'],
  ['multi',       'MULTI-ENTITY'],
];

const isFullPageTab = (t) => [
  'brsr-env', 'audit', 'pat-scheme', 'ccts', 'multi',
  'gei-report', 'sbti', 'action-plan', 'suppliers',
].includes(t);

// ─────────────────────────────────────────────────────────────────────────────
// UPGRADE LOCK SCREEN
// Shown when non-corporate user opens a locked tab
// ─────────────────────────────────────────────────────────────────────────────
const UpgradeLock = ({ tabLabel, navigate }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: 340, gap: 16, padding: 40,
    background: 'var(--surf)', border: '1px solid var(--brd)', borderRadius: 10,
    animation: 'fU .4s ease both',
  }}>
    <div style={{ fontSize: 36, opacity: .5 }}>&#128274;</div>
    <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, fontWeight: 800, color: 'var(--txt)', textAlign: 'center' }}>
      {tabLabel}
    </div>
    <div style={{ fontSize: 12, color: 'var(--mut)', textAlign: 'center', maxWidth: 420, lineHeight: 1.8 }}>
      This feature is available on the{' '}
      <span style={{ color: '#f97316', fontWeight: 700 }}>Corporate plan</span> and above.
      Upgrade to unlock full ESG compliance, audit trails, BRSR, PAT scheme, CCTS,
      SBTi targets, supplier portal, and multi-entity consolidation.
    </div>
    <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
      <button
        onClick={() => navigate('/billing')}
        style={{
          padding: '10px 24px', borderRadius: 6, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg,#f97316,#ea580c)', color: '#fff',
          fontFamily: 'Space Mono,monospace', fontSize: 11, fontWeight: 700,
          letterSpacing: '.1em',
        }}
      >
        UPGRADE TO CORPORATE
      </button>
      <button
        onClick={() => navigate('/billing')}
        style={{
          padding: '10px 18px', borderRadius: 6, cursor: 'pointer',
          background: 'var(--surf)', border: '1px solid var(--brd2)',
          color: 'var(--mut)', fontFamily: 'Space Mono,monospace', fontSize: 11,
        }}
      >
        VIEW PLANS
      </button>
    </div>
    <div style={{ fontSize: 10, color: 'var(--mut)', opacity: .5, marginTop: 4 }}>
      Corporate: Rs.19,999/mo · Listed companies · BRSR mandatory filers · Custom pricing available
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// PDF UPGRADE MODAL
// Shown when Growth user clicks BRSR / CDP / TCFD export button
// ─────────────────────────────────────────────────────────────────────────────
const PdfUpgradeModal = ({ label, onClose, navigate }) => (
  <div className="em-confirm-overlay" onClick={onClose}>
    <div className="em-confirm-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
      <div style={{ fontSize: 28, textAlign: 'center', marginBottom: 10 }}>&#128274;</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)', marginBottom: 8, textAlign: 'center', letterSpacing: '.06em' }}>
        {label.toUpperCase()} — CORPORATE PLAN REQUIRED
      </div>
      <div style={{ fontSize: 11, color: 'var(--mut)', marginBottom: 20, textAlign: 'center', lineHeight: 1.8 }}>
        {label} PDF export is available on the{' '}
        <span style={{ color: '#f97316' }}>Corporate plan</span> and above.
        Your current Growth plan includes the GHG Protocol PDF only.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => { onClose(); navigate('/billing'); }}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg,#f97316,#ea580c)', color: '#fff',
            fontFamily: 'Space Mono,monospace', fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
          }}
        >
          UPGRADE NOW
        </button>
        <button className="em-btn em-btn-g" onClick={onClose} style={{ flex: 1 }}>CANCEL</button>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function EmissionTracking() {
  const [records,           setRecords]           = useState([]);
  const [summary,           setSummary]           = useState(null);
  const [profile,           setProfile]           = useState(null);
  const [tab,               setTab]               = useState('log');
  const [sfilt,             setSfilt]             = useState('all');
  const [page,              setPage]              = useState(1);
  const [year,              setYear]              = useState(new Date().getFullYear());
  const [notif,             setNotif]             = useState(null);
  const [loading,           setLoading]           = useState(true);
  const [synced,            setSynced]            = useState(false);
  const [dragOver,          setDragOver]          = useState(false);
  const [exportLoading,     setExportLoading]     = useState('');
  const [submitting,        setSubmitting]        = useState(false);
  const [deleteConfirm,     setDeleteConfirm]     = useState(null);
  const [showExportModal,   setShowExportModal]   = useState(false);
  const [pendingExport,     setPendingExport]     = useState(null);
  const [retirements,       setRetirements]       = useState([]);
  const [credits,           setCredits]           = useState([]);
  const [brsrData,          setBrsrData]          = useState(null);
  const [verifier,          setVerifier]          = useState(null);
  const [prevYearEmissions, setPrevYearEmissions] = useState(null);
  const [cctsData,          setCctsData]          = useState(null);
  const [patData,           setPatData]           = useState(null);
  // [FIX-PLAN-FETCH] subscription plan state
  const [subscriptionPlan,  setSubscriptionPlan]  = useState(null);
  // [FIX-PDF-GATE] upgrade modal state for locked PDF exports
  const [pdfUpgradeModal,   setPdfUpgradeModal]   = useState(null);

  const fileRef  = useRef();
  const abortRef = useRef(null);
  const PER_PAGE = 10;

  const [form, setForm] = useState({ date: '', activity: '', qty: '', notes: '' });
  const [pform, setPform] = useState({
    companyName: '', industry: '', revenueCr: '', employees: '', floorSqft: '',
    netZeroYear: '2050', netZeroTargetCo2e: '', reportingYear: String(new Date().getFullYear()),
    companyCin: '', companyGstin: '', companyPan: '', companyType: '', baseYear: '2024',
  });

  const navigate = useNavigate();
  const toast = (msg, type = 'success') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 4000); };

  // ── [FIX-PLAN-FETCH] Load all data including subscription plan ─────────────
  const loadAll = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    try {
      const [acts, sum, prof] = await Promise.all([
        apiFetch(`/api/emissions/activities?limit=500`, { signal: ctl.signal }).catch(() => null),
        apiFetch(`/api/emissions/summary?year=${year}`, { signal: ctl.signal }).catch(() => null),
        apiFetch('/api/emissions/profile',              { signal: ctl.signal }).catch(() => null),
      ]);

      if (ctl.signal.aborted) return;

      if (acts?.activities?.length) {
        setRecords(acts.activities.map(r => ({
          ...r,
          qty:      parseFloat(r.quantity || 0),
          co2e:     parseFloat(r.co2e     || 0),
          date:     (r.date || '').slice(0, 10),
          notes:    sanitise(r.notes    || ''),
          activity: sanitise(r.activity || ''),
        })));
        setSynced(true);
      }
      if (sum) setSummary(sum);
      if (prof?.profile) {
        const p = prof.profile;
        setProfile(p);
        setPform(f => ({
          ...f,
          companyName:       sanitise(p.company_name    || ''),
          industry:          sanitise(p.industry        || ''),
          revenueCr:         p.revenue_cr               || '',
          employees:         p.employees                || '',
          floorSqft:         p.floor_sqft               || '',
          netZeroYear:       String(p.net_zero_year      || 2050),
          netZeroTargetCo2e: p.net_zero_target_co2e     || '',
          reportingYear:     String(p.reporting_year     || new Date().getFullYear()),
          companyCin:        sanitise(p.company_cin     || ''),
          companyGstin:      sanitise(p.company_gstin   || ''),
          companyPan:        sanitise(p.company_pan     || ''),
          baseYear:          String(p.base_year         || 2024),
        }));
      }

      // [FIX-PLAN-FETCH] Fetch subscription plan from /api/org/plan
      apiFetch('/api/org/plan', { signal: ctl.signal })
        .then(d => { if (!ctl.signal.aborted && d?.plan) setSubscriptionPlan(d.plan); })
        .catch(() => {});

      apiFetch(`/api/transactions/retirements`, { signal: ctl.signal })
        .then(d => { if (ctl.signal.aborted || !d) return; setRetirements(d?.retirements || d?.data || []); setCredits(d?.credits || []); }).catch(() => {});

      apiFetch(`/api/brsr/environmental?year=${year}`, { signal: ctl.signal })
        .then(d => { if (ctl.signal.aborted || !d?.data) return; const { energy, water, waste } = d.data; if (energy || water || waste) setBrsrData({ energyData: energy, waterData: water, wasteData: waste }); }).catch(() => {});

      apiFetch(`/api/audit/verifiers?year=${year}`, { signal: ctl.signal })
        .then(d => { if (ctl.signal.aborted || !d) return; setVerifier(d?.verifiers?.find(v => v.status === 'verified') || null); }).catch(() => {});

      apiFetch(`/api/emissions/activities?limit=500&year=${year - 1}`, { signal: ctl.signal })
        .then(d => { if (ctl.signal.aborted || !d?.activities?.length) return; setPrevYearEmissions(d.activities.map(r => ({ ...r, co2e: parseFloat(r.co2e || 0), scope: r.scope }))); }).catch(() => {});

      apiFetch('/api/ccts/profile', { signal: ctl.signal })
        .then(d => { if (ctl.signal.aborted || !d?.data) return; setCctsData(d.data); }).catch(() => {});

      apiFetch('/api/pat/profile', { signal: ctl.signal })
        .then(d => { if (ctl.signal.aborted || !d?.data) return; setPatData(d.data); }).catch(() => {});

    } catch (e) {
      if (e.name !== 'AbortError') toast('Failed to load data. Please refresh.', 'error');
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, [year]);

  useEffect(() => { loadAll(); return () => { abortRef.current?.abort(); }; }, [loadAll]);

  // ── Derived totals ─────────────────────────────────────────────────────────
  const scope1 = summary?.scope1 ?? records.filter(r => r.scope === 1).reduce((s, r) => s + r.co2e, 0);
  const scope2 = summary?.scope2 ?? records.filter(r => r.scope === 2).reduce((s, r) => s + r.co2e, 0);
  const scope3 = summary?.scope3 ?? records.filter(r => r.scope === 3).reduce((s, r) => s + r.co2e, 0);
  const total  = scope1 + scope2 + scope3;

  const scope2Location = records.filter(r => r.scope === 2 && r.category?.includes('Location-based')).reduce((s, r) => s + r.co2e, 0);
  const scope2Market   = records.filter(r => r.scope === 2 && r.category?.includes('Market-based')).reduce((s, r) => s + r.co2e, 0);
  const scope2Loc      = scope2Location || scope2;
  const scope2Mkt      = scope2Market;

  const creditsNeeded       = Math.ceil(total);
  const netZeroTarget       = parseFloat(profile?.net_zero_target_co2e) || Math.max(50, total * 0.6);
  const netZeroPct          = Math.min(100, total > 0 ? (total / netZeroTarget) * 100 : 0);
  const yoyChange           = summary?.yoyChange;
  const revenueCr           = parseFloat(profile?.revenue_cr) || null;
  const employees           = parseInt(profile?.employees)    || null;
  const floorSqft           = parseInt(profile?.floor_sqft)   || null;
  const revenuePPP          = revenueCr ? revenueCr / (IMF_PPP_RATE_INR / 1e7) : null;
  const revenueIntensityPPP = revenuePPP && total ? total / revenuePPP : null;
  const preview             = calc(form.activity, form.qty);
  const industryBenchmark   = profile?.industry ? INDUSTRY_BENCHMARKS[profile.industry] : null;
  const revenueIntensity    = revenueCr && total ? total / revenueCr : null;
  const benchmarkStatus     = industryBenchmark && revenueIntensity
    ? revenueIntensity <= industryBenchmark.low    ? 'leader'
    : revenueIntensity <= industryBenchmark.medium ? 'average' : 'laggard'
    : null;

  // Convenience flag
  const corporate = isCorporate(subscriptionPlan);

  // Prev year total for Net Zero progress bars
  const prevYearTotal = prevYearEmissions
    ? prevYearEmissions.reduce((s, r) => s + r.co2e, 0)
    : null;

  const filtered    = records.filter(r => sfilt === 'all' ? true : r.scope === parseInt(sfilt)).sort((a, b) => new Date(b.date) - new Date(a.date));
  const totalPages  = Math.ceil(filtered.length / PER_PAGE);
  const pageRecords = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const byMonthScope = (sc) => MONTHS.map((_, i) => {
    const m = String(i + 1).padStart(2, '0');
    if (summary?.monthlyTrend?.length) {
      const row = summary.monthlyTrend.find(r => r.scope === sc && r.month === (i + 1));
      return parseFloat(row?.total_co2e || 0);
    }
    return records.filter(r => r.scope === sc && r.date?.includes(`${year}-${m}`)).reduce((s, r) => s + r.co2e, 0);
  });

  const trendData = {
    labels: MONTHS,
    datasets: [
      { label: 'Scope 1', data: byMonthScope(1), borderColor: '#f97316', backgroundColor: '#f9731612', fill: true, tension: .4, pointRadius: 3 },
      { label: 'Scope 2', data: byMonthScope(2), borderColor: '#3b82f6', backgroundColor: '#3b82f612', fill: true, tension: .4, pointRadius: 3 },
      { label: 'Scope 3', data: byMonthScope(3), borderColor: '#a855f7', backgroundColor: '#a855f712', fill: true, tension: .4, pointRadius: 3 },
    ],
  };

  const donutData = {
    labels: ['Scope 1', 'Scope 2', 'Scope 3'],
    datasets: [{ data: [scope1.toFixed(3), scope2.toFixed(3), scope3.toFixed(3)],
      backgroundColor: ['#f9731620', '#3b82f620', '#a855f720'],
      borderColor: ['#f97316', '#3b82f6', '#a855f7'], borderWidth: 2 }],
  };

  const catSource = summary?.categoryBreakdown?.length
    ? summary.categoryBreakdown
    : (() => {
        const c = {};
        records.forEach(r => { c[r.category || 'Other'] = (c[r.category || 'Other'] || 0) + r.co2e; });
        return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([category, total_co2e]) => ({ category, total_co2e }));
      })();

  const catData = {
    labels: catSource.map(r => r.category),
    datasets: [{ label: 'tCO2e', data: catSource.map(r => +parseFloat(r.total_co2e).toFixed(3)), backgroundColor: '#10b98120', borderColor: '#10b981', borderWidth: 2, borderRadius: 4 }],
  };

  // ── Log emission ───────────────────────────────────────────────────────────
  const handleAdd = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.date || !form.activity || !form.qty) return;
    const cleanDate  = sanitise(form.date);
    const cleanNotes = sanitise(form.notes);
    const qty        = safeNum(form.qty, 0.001, 1e9);
    if (!qty) { toast('Invalid quantity', 'error'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) { toast('Invalid date format', 'error'); return; }
    const p = calc(form.activity, qty);
    if (!p) { toast('Unknown activity', 'error'); return; }
    setSubmitting(true);
    const tmp = { id: `tmp-${Date.now()}`, date: cleanDate, activity: form.activity, qty, notes: cleanNotes, verified: false, ...p };
    setRecords(prev => [tmp, ...prev]);
    setForm({ date: '', activity: '', qty: '', notes: '' });
    toast(`Logged ${p.co2e.toFixed(3)} tCO2e Scope ${p.scope} ${p.source}`);
    try {
      const res = await apiFetch('/api/emissions/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: cleanDate, activity: form.activity, quantity: qty, unit: p.unit, scope: p.scope, category: p.cat, factor: p.factor, co2e: p.co2e, notes: cleanNotes, source: p.source }),
      });
      if (res?.activity) {
        setRecords(prev => prev.map(r => r.id === tmp.id ? { ...tmp, ...res.activity, qty: parseFloat(res.activity.quantity), co2e: parseFloat(res.activity.co2e), date: (res.activity.date || '').slice(0, 10) } : r));
        setSynced(true);
        const ctl = new AbortController();
        apiFetch(`/api/emissions/summary?year=${year}`, { signal: ctl.signal }).then(d => { if (d) setSummary(d); }).catch(() => {});
      }
    } catch {
      setRecords(prev => prev.filter(r => r.id !== tmp.id));
      toast('Failed to save record. Please try again.', 'error');
    } finally { setSubmitting(false); }
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDeleteRequest = (id)  => setDeleteConfirm(id);
  const handleDeleteCancel  = ()    => setDeleteConfirm(null);
  const handleDeleteConfirm = async () => {
    const id = deleteConfirm;
    setDeleteConfirm(null);
    const rollback = records.find(r => r.id === id);
    setRecords(prev => prev.filter(r => r.id !== id));
    try {
      await apiFetch(`/api/emissions/activities/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Record removed');
    } catch {
      if (rollback) setRecords(prev => [rollback, ...prev]);
      toast('Failed to delete record', 'error');
    }
  };

  // ── CSV Export ────────────────────────────────────────────────────────────
  const handleExport = () => {
    const rows = [
      'Date,Activity,Quantity,Unit,Scope,Category,Factor,tCO2e,Source,Verified,Notes',
      ...records.map(r => [r.date, `"${(r.activity||'').replace(/"/g,'""')}"`, r.qty||r.quantity, r.unit||'', r.scope||'', `"${(r.category||'').replace(/"/g,'""')}"`, r.factor||'', (r.co2e||0).toFixed(4), `"${(r.source||'').replace(/"/g,'""')}"`, r.verified||false, `"${(r.notes||'').replace(/"/g,'""')}"`].join(',')),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `ethertrack_ghg_${year}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('GHG inventory exported');
  };

  // ── PDF export ─────────────────────────────────────────────────────────────
  const downloadReport = async (type, label) => {
    if (exportLoading) return;
    setExportLoading(type);
    try {
      const payload = {
        reportType: type, orgName: sanitise(profile?.company_name || 'EtherTrack User'),
        year, profile, emissions: records, retirements, credits, verifier,
        previousYearEmissions: prevYearEmissions,
        scope2Location: scope2Loc, scope2Market: scope2Mkt,
        gridEmissionFactor: CEA_GRID_EF_2024,
        gridEFVersion: 'CEA V20.0 Dec 2024 (FY 2023-24)',
        pppRate: IMF_PPP_RATE_INR, pppRateSource: 'IMF WEO April 2025',
        ...(type === 'brsr' && brsrData?.energyData ? { energyData: brsrData.energyData } : {}),
        ...(type === 'brsr' && brsrData?.waterData  ? { waterData:  brsrData.waterData  } : {}),
        ...(type === 'brsr' && brsrData?.wasteData  ? { wasteData:  brsrData.wasteData  } : {}),
      };
      const response = await fetch('/api/reports/generate', {
        method: 'POST', credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof window.__csrf_token !== 'undefined' ? { 'X-CSRF-Token': window.__csrf_token } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        let errMsg = `Server error ${response.status}`;
        try { const errJson = await response.json(); errMsg = errJson.error || errMsg; } catch {}
        throw new Error(errMsg);
      }
      const blob     = await response.blob();
      const url      = URL.createObjectURL(blob);
      const filename = response.headers.get('Content-Disposition')
        ?.match(/filename="(.+)"/)?.[1] || `ethertrack_${type}_fy${year}.pdf`;
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 15_000);
      const auditHash = response.headers.get('X-Audit-Hash');
      toast(`${label} PDF exported for FY ${year}${auditHash ? ` Hash: ${auditHash.slice(0, 8)}` : ''}`);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') console.error('[PDF export]', err?.message || err);
      toast(`PDF export failed: ${err?.message || 'Please try again.'}`, 'error');
    } finally { setExportLoading(''); }
  };

  // ── CSV Import ────────────────────────────────────────────────────────────
  const handleCSVImport = async (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('File too large (max 5MB)', 'error'); return; }
    if (!['text/csv','text/plain','application/vnd.ms-excel'].includes(file.type) && !file.name.endsWith('.csv')) { toast('Only CSV files accepted', 'error'); return; }
    const text   = await file.text();
    const parsed = parseCSV(text);
    if (!parsed.length) { toast('No valid records found in CSV', 'error'); return; }
    const batch = parsed.slice(0, 2000);
    toast(`Importing ${batch.length} records`);
    try {
      const res = await apiFetch('/api/emissions/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: batch }) });
      toast(`Imported ${res?.inserted || batch.length} records`);
      loadAll();
    } catch { toast('Import failed. Please try again.', 'error'); }
  };

  // ── Save profile ──────────────────────────────────────────────────────────
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const cin   = sanitise(pform.companyCin).toUpperCase();
    const gstin = sanitise(pform.companyGstin).toUpperCase();
    const pan   = sanitise(pform.companyPan).toUpperCase();
    if (cin   && !/^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9A-Z]{6}$/.test(cin))  { toast('Invalid CIN format', 'error');   return; }
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin)) { toast('Invalid GSTIN format', 'error'); return; }
    if (pan   && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan)) { toast('Invalid PAN format', 'error'); return; }
    const revenueCrVal = safeNum(pform.revenueCr, 0, 1e8);
    const employeesVal = safeNum(pform.employees,  0, 1e7);
    const floorSqftVal = safeNum(pform.floorSqft,  0, 1e9);
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/emissions/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: sanitise(pform.companyName), industry: pform.industry||null, revenueCr: revenueCrVal||0, employees: employeesVal||0, floorSqft: floorSqftVal||0, netZeroYear: parseInt(pform.netZeroYear)||2050, netZeroTargetCo2e: safeNum(pform.netZeroTargetCo2e,0)||0, reportingYear: parseInt(pform.reportingYear)||new Date().getFullYear(), companyCin: cin||null, companyGstin: gstin||null, companyPan: pan||null, companyType: sanitise(pform.companyType)||null, baseYear: parseInt(pform.baseYear)||2024 }),
      });
      if (res?.profile) { setProfile(res.profile); toast('Company profile saved'); }
    } catch { toast('Failed to save profile. Please try again.', 'error'); }
    finally { setSubmitting(false); }
  };

  const intensities = [
    revenueCr && { label: 'Carbon Intensity (Revenue Rs.Cr)', val: total / revenueCr, unit: 'tCO2e/Rs.Cr', max: 5, color: total / revenueCr > 2 ? 'var(--red)' : total / revenueCr > 1 ? 'var(--ylw)' : 'var(--grn)' },
    revenuePPP && { label: 'Carbon Intensity (Revenue PPP adj. IMF 2025)', val: total / revenuePPP * 1000, unit: 'tCO2e/M$ PPP', max: 200, color: 'var(--grn)' },
    employees  && { label: 'Carbon Intensity (FTE)', val: total / employees, unit: 'tCO2e/emp', max: 2, color: total / employees > 1 ? 'var(--red)' : total / employees > .5 ? 'var(--ylw)' : 'var(--grn)' },
    floorSqft  && { label: 'Carbon Intensity (Area)', val: total / floorSqft * 1000, unit: 'kgCO2e/sqft', max: 1, color: 'var(--grn)' },
    total > 0  && { label: 'Scope 3 Share', val: scope3 / total * 100, unit: '%', max: 100, color: scope3 / total > .6 ? 'var(--red)' : scope3 / total > .4 ? 'var(--ylw)' : 'var(--grn)' },
  ].filter(Boolean);

  // ── Export pre-flight checks ───────────────────────────────────────────────
  const getExportChecks = (type) => {
    const base = [
      { label: 'Company name', detail: 'Used in PDF header and filename set in Company Profile tab', ok: !!profile?.company_name, required: true, fixTab: 'profile' },
      { label: `Emission records for FY ${year}`, detail: `${records.length} activities logged`, ok: records.length > 0, required: true, fixTab: 'log' },
    ];
    if (type === 'ghg-protocol') return [...base,
      { label: 'Scope 1 emissions logged', detail: 'Direct emissions stationary/mobile combustion fugitives', ok: records.some(r => r.scope===1), required: true, fixTab: 'log' },
      { label: 'Scope 2 emissions logged', detail: 'Purchased electricity location-based CEA V20.0', ok: records.some(r => r.scope===2), required: true, fixTab: 'log' },
      { label: 'Consolidation boundary set', detail: 'Operational control set industry in Company Profile', ok: !!profile?.industry, required: true, fixTab: 'profile' },
      { label: 'Base year defined', detail: 'Required for GHG Protocol base year recalculation', ok: !!profile?.base_year, required: false, fixTab: 'profile' },
      { label: 'Dual Scope 2 market-based data', detail: 'GHG Protocol mandates dual reporting log REC/PPA/Green Tariff', ok: scope2Mkt > 0, required: false, fixTab: 'log' },
      { label: 'Scope 3 categories logged', detail: 'Value chain emissions across all 15 GHG Protocol categories', ok: records.some(r => r.scope===3), required: false, fixTab: 'log' },
      { label: 'Revenue for intensity reporting', detail: 'tCO2e per Rs.Cr Company Profile tab', ok: !!profile?.revenue_cr, required: false, fixTab: 'profile' },
      { label: 'Employee count (FTE)', detail: 'tCO2e per employee Company Profile tab', ok: !!profile?.employees, required: false, fixTab: 'profile' },
      { label: 'Third-party verification', detail: 'ISO 14064-3 verifier add in Audit Trail tab', ok: !!verifier, required: false, fixTab: 'audit' },
      { label: 'Previous year data for YoY', detail: `FY ${year-1} records enable year-on-year comparison`, ok: !!prevYearEmissions, required: false, fixTab: 'log' },
    ];
    if (type === 'brsr') return [...base,
      { label: 'CIN (Corporate Identity Number)', detail: 'MCA registration mandatory BRSR Part A', ok: !!profile?.company_cin, required: true, fixTab: 'profile' },
      { label: 'Industry / NIC code', detail: 'Mandatory BRSR Part A company classification', ok: !!profile?.industry, required: true, fixTab: 'profile' },
      { label: 'Annual revenue (Rs. Cr)', detail: 'P6-E1 mandatory revenue-based GHG intensity', ok: !!profile?.revenue_cr, required: true, fixTab: 'profile' },
      { label: 'Employee count (FTE)', detail: 'P6-E1 mandatory employee-based GHG intensity', ok: !!profile?.employees, required: true, fixTab: 'profile' },
      { label: 'Scope 1 emissions (P6-E1)', detail: 'BRSR Core KPI direct GHG emissions', ok: records.some(r => r.scope===1), required: true, fixTab: 'log' },
      { label: 'Scope 2 emissions (P6-E1)', detail: 'BRSR Core KPI purchased electricity', ok: records.some(r => r.scope===2), required: true, fixTab: 'log' },
      { label: 'GSTIN', detail: 'GST registration BRSR regulatory identity', ok: !!profile?.company_gstin, required: false, fixTab: 'profile' },
      { label: 'Energy data (P6-E2)', detail: 'Total GJ consumed renewable share BRSR Environmental tab', ok: !!brsrData?.energyData, required: false, fixTab: 'brsr-env' },
      { label: 'Water data (P6-E3)', detail: 'Withdrawal consumption recycling rate BRSR Environmental tab', ok: !!brsrData?.waterData, required: false, fixTab: 'brsr-env' },
      { label: 'Waste data (P6-E4)', detail: 'Total waste hazardous recycling rate BRSR Environmental tab', ok: !!brsrData?.wasteData, required: false, fixTab: 'brsr-env' },
      { label: 'Dual Scope 2 market-based', detail: 'BRSR ISF Dec 2024 requires both location and market-based Scope 2', ok: scope2Mkt > 0, required: false, fixTab: 'log' },
      { label: 'Net zero target year', detail: 'BRSR Core transition plan disclosure', ok: !!profile?.net_zero_year, required: false, fixTab: 'profile' },
      { label: 'Carbon credit retirements (P6-E5)', detail: 'Offset disclosures log via Audit Trail tab', ok: retirements.length > 0, required: false, fixTab: 'audit' },
    ];
    if (type === 'cdp') return [...base,
      { label: 'Industry / NACE activity', detail: 'CDP C0 organisation classification mandatory', ok: !!profile?.industry, required: true, fixTab: 'profile' },
      { label: 'Scope 1 emissions (C6.1)', detail: 'CDP mandatory direct GHG emissions in tCO2e', ok: records.some(r => r.scope===1), required: true, fixTab: 'log' },
      { label: 'Scope 2 location-based (C6.3)', detail: 'CDP mandatory grid average method', ok: records.some(r => r.scope===2), required: true, fixTab: 'log' },
      { label: 'Revenue for C6 intensity', detail: 'CDP C6 revenue-based emissions intensity mandatory', ok: !!profile?.revenue_cr, required: true, fixTab: 'profile' },
      { label: 'Scope 2 market-based (C6.3a)', detail: 'CDP strongly encouraged REC/PPA/Green Tariff', ok: scope2Mkt > 0, required: false, fixTab: 'log' },
      { label: 'Scope 3 categories (C6.5)', detail: 'CDP C6.5 all relevant upstream and downstream categories', ok: records.some(r => r.scope===3), required: false, fixTab: 'log' },
      { label: 'Employee count (FTE)', detail: 'CDP C6 employee intensity metric', ok: !!profile?.employees, required: false, fixTab: 'profile' },
      { label: 'Carbon credit retirements (C11)', detail: 'CDP C11.2 voluntary carbon pricing disclosures', ok: retirements.length > 0, required: false, fixTab: 'audit' },
      { label: 'Third-party verification', detail: 'CDP verification level and standard ISO 14064-3', ok: !!verifier, required: false, fixTab: 'audit' },
      { label: 'Previous year for C6 comparison', detail: `CDP requires prior year FY ${year-1} for trend reporting`, ok: !!prevYearEmissions, required: false, fixTab: 'log' },
      { label: 'Net zero / SBTi target', detail: 'CDP C4 emissions reduction targets disclosure', ok: !!profile?.net_zero_year, required: false, fixTab: 'profile' },
    ];
    if (type === 'tcfd') return [...base,
      { label: 'Industry sector', detail: 'TCFD Strategy pillar sector-specific risk identification', ok: !!profile?.industry, required: true, fixTab: 'profile' },
      { label: 'Scope 1 emissions (Metrics)', detail: 'TCFD Metrics and Targets Scope 1 mandatory disclosure', ok: records.some(r => r.scope===1), required: true, fixTab: 'log' },
      { label: 'Scope 2 emissions (Metrics)', detail: 'TCFD Metrics and Targets Scope 2 mandatory disclosure', ok: records.some(r => r.scope===2), required: true, fixTab: 'log' },
      { label: 'Revenue for intensity metrics', detail: 'TCFD Metrics revenue carbon intensity mandatory', ok: !!profile?.revenue_cr, required: true, fixTab: 'profile' },
      { label: 'Net zero target year', detail: 'TCFD Metrics and Targets transition plan targets mandatory', ok: !!profile?.net_zero_year, required: true, fixTab: 'profile' },
      { label: 'Scope 3 emissions (Metrics)', detail: 'TCFD encouraged value chain emissions for full footprint', ok: records.some(r => r.scope===3), required: false, fixTab: 'log' },
      { label: 'Employee count (FTE)', detail: 'TCFD per-employee intensity metric', ok: !!profile?.employees, required: false, fixTab: 'profile' },
      { label: 'Previous year for trend (Metrics)', detail: `TCFD requires year-on-year metrics FY ${year-1} data`, ok: !!prevYearEmissions, required: false, fixTab: 'log' },
      { label: 'Carbon credit retirements', detail: 'TCFD Metrics offset strategy and carbon pricing exposure', ok: retirements.length > 0, required: false, fixTab: 'audit' },
      { label: 'Third-party verification', detail: 'TCFD increases credibility of metrics disclosure', ok: !!verifier, required: false, fixTab: 'audit' },
      { label: 'BRSR environmental data', detail: 'TCFD Strategy physical risk energy water waste exposure', ok: !!brsrData, required: false, fixTab: 'brsr-env' },
    ];
    return base;
  };

  const exportChecks = getExportChecks(pendingExport?.type || 'ghg-protocol');
  const canExport    = exportChecks.filter(c => c.required).every(c => c.ok);

  // ── [FIX-TIER-GATE] Tab click — intercepts locked tabs ────────────────────
  const handleTabClick = (k) => {
    setTab(k);
    setPage(1);
  };

  // ── [FIX-PDF-GATE] PDF export click — intercepts locked PDF types ─────────
  const handlePdfExportClick = (type, label) => {
    if (CORPORATE_PDF_TYPES.includes(type) && !corporate) {
      setPdfUpgradeModal({ label });
      return;
    }
    const checks          = getExportChecks(type);
    const missingRequired = checks.filter(c => c.required && !c.ok);
    const missingOptional = checks.filter(c => !c.required && !c.ok);
    if (missingRequired.length > 0) toast(`Cannot export missing: ${missingRequired.map(c => c.label).join(', ')}`, 'error');
    else if (missingOptional.length > 0) toast(`${label} will be incomplete missing: ${missingOptional.map(c => c.label).join(', ')}`, 'error');
    setPendingExport({ type, label });
    setShowExportModal(true);
  };

  // ── CSS ───────────────────────────────────────────────────────────────────
  const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap');
:root{--bg:#060809;--surf:#0e1318;--brd:#243040;--brd2:#2e3d50;--txt:#f0f6ff;--mut:#8ba3bc;--grn:#10b981;--red:#ef4444;--ylw:#f59e0b;--s1:#f97316;--s2:#3b82f6;--s3:#a855f7;}
.em{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);position:relative;overflow-x:hidden;}
.em::after{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background-image:linear-gradient(rgba(56,189,248,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,.025) 1px,transparent 1px);background-size:48px 48px;}
.em-in{position:relative;z-index:1;max-width:1400px;margin:0 auto;padding:0px 28px;}
.em-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--brd);animation:fU .5s ease both;}
.em-brand-label{font-size:10px;letter-spacing:.15em;color:var(--mut);margin-top:0;}
.em-brand-title{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;}
.em-brand-title span{color:var(--grn);}
.em-badge{padding:6px 13px;border-radius:4px;font-size:11px;letter-spacing:.08em;}
.em-badge-grn{border:1px solid #10b98133;color:var(--grn);background:#10b98108;}
.em-badge-mut{border:1px solid var(--brd2);color:var(--txt);background:var(--surf);}
.em-badge-ylw{border:1px solid #f59e0b33;color:var(--ylw);background:#f59e0b08;}
.em-live{width:7px;height:7px;border-radius:50%;background:var(--grn);box-shadow:0 0 8px var(--grn);animation:pulse 2s ease infinite;}
.em-scopes{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px;animation:fU .5s ease .08s both;}
.em-sc-card{border-radius:10px;padding:18px 20px;border:1px solid var(--brd);background:var(--surf);position:relative;overflow:hidden;transition:transform .2s,border-color .2s;}
.em-sc-card:hover{transform:translateY(-2px);}
.em-sc-card::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,var(--ac)08,transparent 60%);}
.em-sc-lbl{font-size:10px;letter-spacing:.12em;color:var(--mut);margin-bottom:10px;position:relative;}
.em-sc-val{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;margin-bottom:2px;position:relative;}
.em-sc-sub{font-size:11px;color:var(--mut);letter-spacing:.08em;position:relative;}
.em-sc-bar{height:3px;border-radius:2px;margin-top:12px;background:var(--brd);position:relative;}
.em-sc-fill{height:100%;border-radius:2px;transition:width .8s ease;}
.em-tabs{display:flex;gap:0;margin-bottom:20px;border-bottom:1px solid var(--brd);animation:fU .5s ease .12s both;overflow-x:auto;}
.em-tab{padding:10px 14px;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.08em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;white-space:nowrap;flex-shrink:0;}
.em-tab:hover{color:var(--txt);}
.em-tab.on{color:var(--grn);border-bottom-color:var(--grn);}
.em-tab-locked{opacity:.45;}
.em-tab-locked:hover{opacity:.65;}
.em-tab-ccts.on{color:#14b8a6;border-bottom-color:#14b8a6;}
.em-tab-gei.on{color:#14b8a6;border-bottom-color:#14b8a6;}
.em-tab-sbti.on{color:#10b981;border-bottom-color:#10b981;}
.em-tab-plan.on{color:#f97316;border-bottom-color:#f97316;}
.em-tab-sup.on{color:#a855f7;border-bottom-color:#a855f7;}
.em-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:22px;animation:fU .5s ease .16s both;}
.em-ctit{font-size:10px;letter-spacing:.15em;color:var(--mut);margin-bottom:18px;display:flex;align-items:center;gap:8px;}
.em-ctit::before{content:'';width:12px;height:1px;background:var(--grn);}
.em-g2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.em-g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;}
.em-glog{display:grid;grid-template-columns:2fr 1fr;gap:16px;}
.em-fg4{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:12px;margin-bottom:14px;}
.em-fg3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px;}
.em-fg{display:flex;flex-direction:column;gap:5px;}
.em-lbl{font-size:11px;letter-spacing:.1em;color:var(--mut);}
.em-inp,.em-sel{padding:10px 12px;border-radius:6px;background:#0a1018;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s,box-shadow .2s;-webkit-appearance:none;width:100%;box-sizing:border-box;}
.em-inp:focus,.em-sel:focus{border-color:#10b98144;box-shadow:0 0 0 3px #10b98108;}
.em-inp::placeholder{color:var(--mut);opacity:.9;}
.em-btn{padding:10px 18px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.em-btn:disabled{opacity:.5;cursor:not-allowed;}
.em-btn-p{background:linear-gradient(135deg,#10b981,#059669);color:#fff;box-shadow:0 4px 14px #10b98122;}
.em-btn-p:hover:not(:disabled){opacity:.88;transform:translateY(-1px);}
.em-btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.em-btn-g:hover:not(:disabled){border-color:#10b98144;color:var(--grn);}
.em-btn-sm{padding:7px 14px;font-size:11px;}
.em-btn-danger{background:#ef444414;border:1px solid #ef444444;color:#ef4444;}
.em-prev{padding:14px 16px;border-radius:7px;background:#10b98108;border:1px solid #10b98122;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.em-prev-val{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;color:var(--grn);}
.em-lh,.em-lr{display:grid;grid-template-columns:96px 1fr 60px 130px 72px 80px 72px 100px;padding:10px 14px;font-size:12px;align-items:center;}
.em-lh{color:var(--mut);letter-spacing:.08em;border-bottom:1px solid var(--brd);font-size:11px;}
.em-lr{border-bottom:1px solid #1a202833;transition:background .15s;border-radius:4px;}
.em-lr:hover{background:#ffffff03;}
.em-pill{font-size:10px;padding:4px 9px;border-radius:3px;letter-spacing:.04em;display:inline-flex;align-items:center;gap:4px;}
.em-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0;}
.em-fps{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
.em-fp{padding:6px 16px;border-radius:20px;font-size:11px;border:1px solid var(--brd);background:transparent;color:var(--txt);cursor:pointer;letter-spacing:.06em;font-family:'Space Mono',monospace;transition:all .2s;}
.em-fp.fa{border-color:var(--grn);color:var(--grn);background:#10b98108;}
.em-fp.f1{border-color:var(--s1);color:var(--s1);background:#f9731608;}
.em-fp.f2{border-color:var(--s2);color:var(--s2);background:#3b82f608;}
.em-fp.f3{border-color:var(--s3);color:var(--s3);background:#a855f708;}
.em-irow{margin-bottom:14px;}
.em-ihr{display:flex;justify-content:space-between;margin-bottom:5px;font-size:12px;}
.em-itrack{height:4px;background:var(--brd);border-radius:2px;}
.em-ifill{height:100%;border-radius:2px;transition:width 1s ease;}
.em-alert{padding:11px 16px;border-radius:7px;font-size:11px;display:flex;align-items:center;gap:10px;margin-bottom:12px;}
.em-alg{background:#10b98108;border:1px solid #10b98133;color:var(--grn);}
.em-aly{background:#f59e0b08;border:1px solid #f59e0b33;color:var(--ylw);}
.em-alr{background:#ef444408;border:1px solid #ef444433;color:var(--red);}
.em-esg-g{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px;}
.em-fw{padding:14px;border-radius:8px;border:1px solid var(--brd);background:#080b0e;text-align:center;transition:all .2s;}
.em-fw:hover{border-color:#10b98144;background:#10b98108;}
.em-nz{height:16px;border-radius:8px;background:var(--brd);position:relative;overflow:hidden;margin:12px 0;}
.em-nzf{height:100%;border-radius:8px;background:linear-gradient(90deg,var(--red),var(--ylw),var(--grn));transition:width 1s ease;}
.em-pg{display:flex;align-items:center;justify-content:center;gap:10px;padding-top:16px;}
.em-pgb{padding:7px 16px;border-radius:5px;border:1px solid var(--brd2);background:var(--surf);color:var(--txt);font-family:'Space Mono',monospace;font-size:11px;cursor:pointer;transition:all .2s;}
.em-pgb:hover:not(:disabled){border-color:#10b98144;color:var(--grn);}
.em-pgb:disabled{opacity:.3;cursor:not-allowed;}
.em-drop{border:2px dashed var(--brd2);border-radius:8px;padding:24px;text-align:center;cursor:pointer;transition:all .2s;margin-bottom:14px;}
.em-drop:hover,.em-drop.over{border-color:#10b98166;background:#10b98108;}
.em-yoy-pos{color:var(--red);font-size:10px;}
.em-yoy-neg{color:var(--grn);font-size:10px;}
.em-export-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;}
.em-export-btn{padding:14px 10px;border-radius:8px;border:1px solid var(--brd);background:var(--surf);cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.06em;color:var(--txt);transition:all .2s;text-align:center;position:relative;}
.em-export-btn:hover:not(:disabled){transform:translateY(-2px);border-color:#10b98144;}
.em-export-btn:disabled{opacity:.5;cursor:not-allowed;}
.em-export-lock-badge{position:absolute;top:7px;right:7px;font-size:8px;padding:2px 5px;border-radius:3px;background:#f9731614;color:#f97316;border:1px solid #f9731633;letter-spacing:.04em;}
.em-benchmark{padding:12px 16px;border-radius:8px;border:1px solid var(--brd);background:var(--surf);margin-bottom:16px;}
.em-confirm-overlay{position:fixed;inset:0;z-index:1000;background:#00000088;display:flex;align-items:center;justify-content:center;}
.em-confirm-box{background:var(--surf);border:1px solid var(--brd2);border-radius:10px;padding:24px;max-width:340px;width:90%;}
.em-export-modal{max-width:480px !important;width:92% !important;max-height:88vh;overflow-y:auto;}
.em-check-row{display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;padding:10px 12px;border-radius:6px;}
.em-check-row-req-ok{background:#10b98108;border:1px solid #10b98133;}
.em-check-row-req-fail{background:#ef444408;border:1px solid #ef444433;}
.em-check-row-opt-ok{background:var(--surf);border:1px solid #10b98122;}
.em-check-row-opt-warn{background:var(--surf);border:1px solid var(--brd);}
@keyframes fU{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
@media(max-width:1100px){.em-scopes{grid-template-columns:1fr 1fr;}}
@media(max-width:900px){.em-g2,.em-glog{grid-template-columns:1fr;}.em-fg4{grid-template-columns:1fr 1fr;}.em-lh,.em-lr{grid-template-columns:80px 1fr 50px 70px 60px 60px;}.em-lh span:nth-child(n+7),.em-lr span:nth-child(n+7){display:none;}.em-export-grid{grid-template-columns:1fr 1fr;}}
  `;

  return (
    <>
      <style>{CSS}</style>

      {/* ── Delete confirmation modal ────────────────────────────────────── */}
      {deleteConfirm && (
        <div className="em-confirm-overlay" onClick={handleDeleteCancel}>
          <div className="em-confirm-box" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 13, marginBottom: 16, color: 'var(--txt)' }}>Remove this emission record? This cannot be undone.</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="em-btn em-btn-danger" style={{ flex: 1 }} onClick={handleDeleteConfirm}>REMOVE</button>
              <button className="em-btn em-btn-g"      style={{ flex: 1 }} onClick={handleDeleteCancel}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* ── PDF export pre-flight modal ──────────────────────────────────── */}
      {showExportModal && pendingExport && (
        <div className="em-confirm-overlay" onClick={() => setShowExportModal(false)}>
          <div className="em-confirm-box em-export-modal" onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)', marginBottom: 4, letterSpacing: '.06em' }}>
              {pendingExport.label.toUpperCase()} PRE-EXPORT CHECK
            </div>
            <div style={{ fontSize: 11, color: 'var(--mut)', marginBottom: 18 }}>
              FY {year} {records.length} record{records.length !== 1 ? 's' : ''} {profile?.company_name || 'No company set'}
            </div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--mut)', marginBottom: 8 }}>REQUIRED missing items block export</div>
            {exportChecks.filter(c => c.required).map(({ label, detail, ok, fixTab }) => (
              <div key={label} className={`em-check-row ${ok ? 'em-check-row-req-ok' : 'em-check-row-req-fail'}`}>
                <span style={{ color: ok ? 'var(--grn)' : 'var(--red)', fontSize: 15, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{ok ? '✓' : '✕'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: ok ? 'var(--grn)' : 'var(--red)', fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 2 }}>{detail}</div>
                </div>
                {!ok && <button className="em-btn em-btn-g" style={{ padding: '4px 10px', fontSize: 10, flexShrink: 0, alignSelf: 'center' }} onClick={() => { setShowExportModal(false); if (fixTab === 'profile') navigate('/team?tab=profile'); else setTab(fixTab); }}>FIX</button>}
              </div>
            ))}
            <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--mut)', margin: '14px 0 8px' }}>OPTIONAL improves report quality but does not block export</div>
            {exportChecks.filter(c => !c.required).map(({ label, detail, ok, fixTab }) => (
              <div key={label} className={`em-check-row ${ok ? 'em-check-row-opt-ok' : 'em-check-row-opt-warn'}`}>
                <span style={{ color: ok ? 'var(--grn)' : 'var(--ylw)', fontSize: 13, flexShrink: 0, marginTop: 2 }}>{ok ? '✓' : '⚠'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: ok ? 'var(--txt)' : 'var(--ylw)' }}>{label}</div>
                  <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 1 }}>{detail}</div>
                </div>
                {!ok && <button className="em-btn em-btn-g" style={{ padding: '3px 9px', fontSize: 10, flexShrink: 0, alignSelf: 'center', opacity: .7 }} onClick={() => { setShowExportModal(false); setTab(fixTab); }}>ADD</button>}
              </div>
            ))}
            {!canExport && <div className="em-alert em-alr" style={{ marginTop: 14, fontSize: 11 }}><span>✕</span><span>Complete the required fields above to enable PDF export.</span></div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button className="em-btn em-btn-p" style={{ flex: 1, opacity: canExport ? 1 : 0.35, cursor: canExport ? 'pointer' : 'not-allowed' }} disabled={!canExport || !!exportLoading}
                onClick={() => { setShowExportModal(false); downloadReport(pendingExport.type, pendingExport.label); }}>
                {exportLoading ? 'GENERATING' : canExport ? `EXPORT ${pendingExport.label.toUpperCase()} PDF` : 'COMPLETE REQUIRED FIELDS FIRST'}
              </button>
              <button className="em-btn em-btn-g" onClick={() => setShowExportModal(false)}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* ── [FIX-PDF-GATE] PDF upgrade modal ────────────────────────────── */}
      {pdfUpgradeModal && (
        <PdfUpgradeModal
          label={pdfUpgradeModal.label}
          onClose={() => setPdfUpgradeModal(null)}
          navigate={navigate}
        />
      )}

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {notif && (
        <div style={{ position: 'fixed', top: 76, right: 24, zIndex: 9999, padding: '12px 20px', borderRadius: 8,
          background: notif.type === 'error' ? '#450a0a' : '#0b2a1e',
          border: `1px solid ${notif.type === 'error' ? '#ef444433' : '#10b98133'}`,
          color: notif.type === 'error' ? '#f87171' : '#10b981',
          fontFamily: 'Space Mono,monospace', fontSize: 11, boxShadow: '0 8px 32px #00000066', animation: 'fU .3s ease' }}>
          {notif.msg}
        </div>
      )}

      <div className="em">
        <div className="em-in">

          {/* ── Topbar ───────────────────────────────────────────────────── */}
          <div className="em-top">
            <div>
              <div className="em-brand-label">
                GHG PROTOCOL · ISO 14064-1 · DEFRA 2024 · CEA V20.0 · BRSR CORE · CDP · TCFD · PAT SCHEME · CCTS 2026 · ALL 15 SCOPE 3 CATEGORIES
              </div>
              <div className="em-brand-title">Carbon <span>Intelligence</span></div>
              {profile?.company_name && (
                <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 3, letterSpacing: '.06em' }}>
                  {profile.company_name}
                  {profile.company_cin   && <span style={{ marginLeft: 8, fontSize: 10 }}>CIN: {profile.company_cin}</span>}
                  {profile.company_gstin && <span style={{ marginLeft: 8, fontSize: 10 }}>GSTIN: {profile.company_gstin}</span>}
                  {' '}· {profile.industry} · FY {profile.reporting_year}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <div className="em-live" title="Live tracking"/>
              {/* [FIX-PLAN-FETCH] Show plan badge */}
              {subscriptionPlan && (
                <span className="em-badge" style={{
                  fontSize: 9, textTransform: 'uppercase',
                  background: corporate ? '#f9731614' : '#3b82f614',
                  color:      corporate ? '#f97316'   : '#3b82f6',
                  border:     `1px solid ${corporate ? '#f9731633' : '#3b82f633'}`,
                }}>
                  {subscriptionPlan}
                </span>
              )}
              {retirements.length > 0 && <span className="em-badge em-badge-grn" style={{ fontSize: 9 }}>{retirements.length} RETIREMENTS</span>}
              {verifier && <span className="em-badge" style={{ fontSize: 9, background: '#a855f714', color: '#a855f7', border: '1px solid #a855f733' }}>ISO 14064-3 VERIFIED</span>}
              {prevYearEmissions && <span className="em-badge em-badge-mut" style={{ fontSize: 9 }}>YoY READY</span>}
              <select className="em-sel" style={{ width: 'auto', padding: '6px 12px', fontSize: 11 }}
                value={year} onChange={e => { setYear(parseInt(e.target.value)); setPage(1); }}>
                {REPORT_YEARS.map(y => <option key={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {!profile && (
            <div className="em-alert em-aly" style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => navigate('/team?tab=profile')}>
              <span>⚠</span><span>Set up your <strong>company profile</strong> to unlock intensity benchmarks and regulatory exports</span>
            </div>
          )}
          {yoyChange != null && (
            <div className={`em-alert ${yoyChange > 0 ? 'em-alr' : 'em-alg'}`}>
              <span>{yoyChange > 0 ? '↑' : '↓'}</span>
              <span>Year-over-year: <strong>{yoyChange > 0 ? '+' : ''}{fmt(yoyChange, 1)}%</strong> vs {year - 1}.{yoyChange > 0 ? ' Action required.' : ' Great progress!'}</span>
            </div>
          )}
          {scope3 > 0 && scope3 > scope1 + scope2 && (
            <div className="em-alert em-aly">
              <span>⚠</span>
              <span>Scope 3 is <strong>{fmt(scope3 / total * 100, 1)}%</strong> of total supply chain requires priority action (BRSR Core KPI)</span>
            </div>
          )}
          {brsrData && <div className="em-alert em-alg"><span>✓</span><span>BRSR environmental data loaded energy water and waste sections ready in BRSR PDF.</span></div>}

          {/* ── Scope Cards ──────────────────────────────────────────────── */}
          <div className="em-scopes">
            {[
              { sc: 1, lbl: 'SCOPE 1 · DIRECT',     sub: 'Combustion & Fugitives',          val: scope1,    color: '#f97316' },
              { sc: 2, lbl: 'SCOPE 2 · ENERGY',      sub: 'Location-based (CEA V20.0 2024)', val: scope2Loc, color: '#3b82f6' },
              { sc: 3, lbl: 'SCOPE 3 · VALUE CHAIN', sub: 'All 15 GHG Protocol Categories',  val: scope3,    color: '#a855f7' },
            ].map(({ sc, lbl, sub, val, color }) => (
              <div key={sc} className="em-sc-card" style={{ '--ac': color }}>
                <div className="em-sc-lbl">{lbl}</div>
                <div style={{ fontSize: 11, color, marginBottom: 8, letterSpacing: '.04em' }}>{sub}</div>
                <div className="em-sc-val" style={{ color }}>{fmt(val)}</div>
                <div className="em-sc-sub">tCO2e · {fmt(total ? val / total * 100 : 0, 1)}%</div>
                <div className="em-sc-bar"><div className="em-sc-fill" style={{ width: `${total ? val / total * 100 : 0}%`, background: color }}/></div>
              </div>
            ))}
            <div className="em-sc-card" style={{ '--ac': '#10b981' }}>
              <div className="em-sc-lbl">TOTAL FOOTPRINT · {year}</div>
              <div className="em-sc-val" style={{ color: '#10b981', fontSize: 30 }}>{fmt(total)}</div>
              <div className="em-sc-sub">
                tCO2e · {creditsNeeded} credits needed
                {retirements.length > 0 && <span style={{ color: '#10b981', marginLeft: 8, fontSize: 10 }}>· {retirements.reduce((s, r) => s + parseInt(r.amount || 0), 0)}t offset</span>}
                {yoyChange != null && <span className={yoyChange > 0 ? 'em-yoy-pos' : 'em-yoy-neg'} style={{ marginLeft: 8 }}>({yoyChange > 0 ? '+' : ''}{fmt(yoyChange, 1)}% YoY)</span>}
              </div>
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--mut)', marginBottom: 5 }}>
                  <span>NET ZERO PROGRESS</span>
                  <span style={{ color: netZeroPct > 80 ? 'var(--red)' : netZeroPct > 50 ? 'var(--ylw)' : 'var(--grn)' }}>{fmt(netZeroPct, 1)}% of budget</span>
                </div>
                <div className="em-nz"><div className="em-nzf" style={{ width: `${netZeroPct}%` }}/></div>
                <div style={{ fontSize: 11, color: 'var(--mut)', textAlign: 'right' }}>Budget: {fmt(netZeroTarget)} tCO2e · Target {profile?.net_zero_year || 2050}</div>
              </div>
            </div>
          </div>

          {/* ── PDF Export Panel ─────────────────────────────────────────── */}
          <div className="em-card" style={{ marginBottom: 16 }}>
            <div className="em-ctit">
              CORPORATE REGULATORY REPORTS FY {year}
              {!corporate && subscriptionPlan && (
                <span style={{ marginLeft: 6, fontSize: 9, padding: '2px 8px', borderRadius: 3, background: '#f9731614', color: '#f97316', border: '1px solid #f9731633', letterSpacing: '.04em' }}>
                  GHG ONLY ON GROWTH
                </span>
              )}
            </div>
            <div className="em-export-grid">
              {[
                { type: 'ghg-protocol', label: 'GHG Protocol',   icon: '📊', desc: 'ISO 14064-1 · Dual Scope 2 · YoY · CEA V20.0', color: '#10b981' },
                { type: 'brsr',         label: 'SEBI BRSR Core', icon: '🇮🇳', desc: `P6 Energy Water Waste · PPP intensity · Dec 2024 ISF${brsrData ? ' · ENV READY' : ''}`, color: '#f97316' },
                { type: 'cdp',          label: 'CDP Climate',    icon: '🌍', desc: 'CDP prep · Dual Scope 2 · Submit via portal', color: '#3b82f6' },
                { type: 'tcfd',         label: 'TCFD',           icon: '📋', desc: '4-pillar · Risk · Metrics · Roadmap', color: '#a855f7' },
              ].map(({ type, label, icon, desc, color }) => {
                // [FIX-PDF-GATE] Locked for non-corporate on BRSR/CDP/TCFD
                const isLocked = CORPORATE_PDF_TYPES.includes(type) && !corporate;
                return (
                  <button
                    key={type}
                    className="em-export-btn"
                    disabled={!!exportLoading && !isLocked}
                    onClick={() => handlePdfExportClick(type, label)}
                    style={{
                      borderColor: isLocked ? `${color}22` : `${color}33`,
                      background:  exportLoading === type ? `${color}11` : isLocked ? `${color}06` : 'var(--surf)',
                      opacity:     isLocked ? 0.6 : 1,
                    }}
                  >
                    {isLocked && <span className="em-export-lock-badge">CORPORATE</span>}
                    <div style={{ fontSize: 24, marginBottom: 8 }}>
                      {exportLoading === type ? '⟳' : isLocked ? '🔒' : icon}
                    </div>
                    <div style={{ fontWeight: 700, color: isLocked ? 'var(--mut)' : color, marginBottom: 4, letterSpacing: '.06em' }}>{label}</div>
                    <div style={{ fontSize: 9, color: 'var(--mut)', lineHeight: 1.5 }}>
                      {isLocked ? 'Upgrade to Corporate to unlock' : desc}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 9, color: 'var(--mut)', textAlign: 'center', letterSpacing: '.06em' }}>
              Auditor-ready · Dual Scope 2 (location + market) · CEA V20.0 Dec 2024 grid EF 0.727 tCO2/MWh ·
              {retirements.length} retirements wired · {verifier ? 'ISO 14064-3 verified' : 'Verification pending'} · DEFRA 2024 / IPCC AR6
            </div>
          </div>

          {/* ── Tabs ─────────────────────────────────────────────────────── */}
          <div className="em-tabs">
            {TABS.map(([k, v]) => {
              const isTabLocked = CORPORATE_TABS.includes(k) && !corporate;
              return (
                <button key={k}
                  className={[
                    'em-tab',
                    tab === k        ? 'on'           : '',
                    k === 'ccts'        ? 'em-tab-ccts'  : '',
                    k === 'gei-report'  ? 'em-tab-gei'   : '',
                    k === 'sbti'        ? 'em-tab-sbti'  : '',
                    k === 'action-plan' ? 'em-tab-plan'  : '',
                    k === 'suppliers'   ? 'em-tab-sup'   : '',
                    isTabLocked         ? 'em-tab-locked': '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleTabClick(k)}
                  title={isTabLocked ? 'Requires Corporate plan — click to see upgrade options' : undefined}
                >
                  {k === 'profile' && !profile ? `${v} ⚠` : v}
                  {isTabLocked && <span style={{ marginLeft: 4, fontSize: 9, opacity: .6 }}>🔒</span>}
                  {k === 'ccts' && !isTabLocked && (
                    <span style={{ marginLeft: 5, fontSize: 8, padding: '1px 5px', borderRadius: 3, background: '#14b8a622', color: '#14b8a6', border: '1px solid #14b8a633', letterSpacing: '.06em', verticalAlign: 'middle' }}>BETA</span>
                  )}
                </button>
              );
            })}
          </div>

          {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--mut)', fontSize: 11, letterSpacing: '.1em' }}>LOADING GHG DATA</div>}

          {/* ── Full-page tab renders ─────────────────────────────────────── */}
          {/* [FIX-TIER-GATE] Each corporate tab checks plan before rendering  */}

          {!loading && tab === 'brsr-env' && (
            corporate
              ? <BRSREnvironmental profile={profile} year={year} onDataReady={(d) => { setBrsrData(d); toast('BRSR environmental data saved PDF sections ready'); }} />
              : <UpgradeLock tabLabel="BRSR Environmental" navigate={navigate} />
          )}

          {!loading && tab === 'audit' && (
            corporate
              ? <AuditTrail year={year} profile={profile} emissions={records} />
              : <UpgradeLock tabLabel="Audit Trail" navigate={navigate} />
          )}

          {!loading && tab === 'pat-scheme' && (
            corporate
              ? <PATScheme profile={profile} />
              : <UpgradeLock tabLabel="PAT Scheme" navigate={navigate} />
          )}

          {!loading && tab === 'multi' && (
            corporate
              ? <MultiEntity profile={profile} year={year} />
              : <UpgradeLock tabLabel="Multi-Entity Consolidation" navigate={navigate} />
          )}

          {!loading && tab === 'ccts' && (
            corporate ? (
              <>
                <div style={{ marginBottom: 12, padding: '10px 16px', borderRadius: 8, background: '#14b8a608', border: '1px solid #14b8a633', fontSize: 11, color: '#14b8a6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>CCTS tracks GEI (emission intensity per unit output) for BEE compliance. For CCC position, netting and exchange orders</span>
                  <button onClick={() => navigate('/compliance')} style={{ background: 'none', border: '1px solid #14b8a633', borderRadius: 5, color: '#14b8a6', cursor: 'pointer', fontSize: 10, padding: '5px 12px', fontFamily: 'Space Mono,monospace', flexShrink: 0, marginLeft: 12 }}>
                    COMPLIANCE DASHBOARD
                  </button>
                </div>
                <CCTSCompliance profile={profile} />
              </>
            ) : <UpgradeLock tabLabel="CCTS Compliance" navigate={navigate} />
          )}
          {!loading && tab === 'sbti' && (
            corporate
              ? <SBTiModule profile={profile} emissions={records} year={year} />
              : <UpgradeLock tabLabel="SBTi Targets" navigate={navigate} />
          )}

          {!loading && tab === 'action-plan' && (
            corporate
              ? <FiveYearActionPlan profile={profile} emissions={records} cctsData={cctsData} patData={patData} />
              : <UpgradeLock tabLabel="5-Year Action Plan" navigate={navigate} />
          )}

          {!loading && tab === 'suppliers' && (
            corporate
              ? <SupplierPortal profile={profile} year={year} />
              : <UpgradeLock tabLabel="Supplier Data Portal" navigate={navigate} />
          )}

          {!loading && !isFullPageTab(tab) && (<>

            {/* ── LOG TAB ──────────────────────────────────────────────── */}
            {tab === 'log' && (
              <div className="em-glog">
                <div className="em-card">
                  <div className="em-ctit">LOG NEW EMISSION RECORD</div>
                  {preview && (
                    <div className="em-prev">
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 6 }}>CALCULATED CO2e</div>
                        <div className="em-prev-val">{preview.co2e.toFixed(4)}</div>
                        <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 2 }}>tonnes CO2e · Scope {preview.scope} · {preview.cat}</div>
                        {preview.method && <div style={{ fontSize: 10, color: preview.method === 'market' ? '#10b981' : '#3b82f6', marginTop: 4 }}>{preview.method === 'market' ? 'Market-based Scope 2' : 'Location-based Scope 2'}</div>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--mut)', textAlign: 'right', lineHeight: 1.9 }}>
                        Factor: <strong style={{ color: 'var(--txt)' }}>{preview.factor} kg CO2e/{preview.unit}</strong><br/>
                        Source: <strong style={{ color: 'var(--grn)' }}>{preview.source}</strong><br/>
                        Method: Activity-based GHG
                      </div>
                    </div>
                  )}
                  <form onSubmit={handleAdd}>
                    <div className="em-fg4">
                      <div className="em-fg">
                        <label className="em-lbl">EMISSION ACTIVITY</label>
                        <select className="em-sel" value={form.activity} onChange={e => setForm(f => ({ ...f, activity: e.target.value }))} required>
                          <option value="">Select activity</option>
                          {[1, 2, 3].map(s => (
                            <optgroup key={s} label={`SCOPE ${s}`}>
                              {Object.entries(EF).filter(([, ef]) => ef.scope === s).map(([name]) => (
                                <option key={name} value={name}>{name}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <div className="em-fg">
                        <label className="em-lbl">QUANTITY{EF[form.activity] ? ` (${EF[form.activity].unit})` : ''}</label>
                        <input className="em-inp" type="number" step="0.001" min="0.001" max="999999999" placeholder="0.000"
                          value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} required/>
                      </div>
                      <div className="em-fg">
                        <label className="em-lbl">DATE</label>
                        <input className="em-inp" type="date" value={form.date}
                          max={new Date().toISOString().slice(0, 10)}
                          onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required/>
                      </div>
                      <div className="em-fg">
                        <label className="em-lbl">NOTES</label>
                        <input className="em-inp" type="text" placeholder="Description" maxLength={200}
                          value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}/>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button type="submit" className="em-btn em-btn-p" disabled={submitting}>{submitting ? 'SAVING' : 'LOG EMISSION'}</button>
                      <button type="button" className="em-btn em-btn-g" onClick={handleExport}>EXPORT GHG CSV</button>
                    </div>
                  </form>
                  <div style={{ marginTop: 20, borderTop: '1px solid var(--brd)', paddingTop: 18 }}>
                    <div className="em-ctit">BULK IMPORT CSV</div>
                    <div className={`em-drop${dragOver ? ' over' : ''}`}
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); handleCSVImport(e.dataTransfer.files[0]); }}
                      onClick={() => fileRef.current?.click()}>
                      <div style={{ fontSize: 12, color: 'var(--txt)', letterSpacing: '.06em' }}>DROP CSV HERE or CLICK TO UPLOAD</div>
                      <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 6 }}>Required: date, activity, quantity optional: notes · Max 5MB · 2,000 rows</div>
                    </div>
                    <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => handleCSVImport(e.target.files[0])}/>
                    <a href="data:text/plain,date,activity,quantity,notes" download="ethertrack_ghg_template.csv"
                      style={{ fontSize: 11, color: 'var(--grn)', letterSpacing: '.06em' }}>DOWNLOAD CSV TEMPLATE</a>
                  </div>
                </div>
                <div className="em-card">
                  <div className="em-ctit">EMISSION FACTOR REFERENCE</div>
                  <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                    {[1, 2, 3].map(s => (
                      <div key={s} style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: 11, letterSpacing: '.1em', color: SC[s], marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 1, background: SC[s], display: 'inline-block' }}/>SCOPE {s}
                          {s === 2 && <span style={{ fontSize: 9, color: 'var(--mut)', marginLeft: 4 }}>(Location-based: 0.000727 tCO2e/kWh CEA V20.0)</span>}
                        </div>
                        {Object.entries(EF).filter(([, ef]) => ef.scope === s).map(([name, ef]) => (
                          <div key={name} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--brd)44', fontSize: 11 }}>
                            <span style={{ color: 'var(--mut)', flex: 1 }}>{name}</span>
                            <span style={{ color: SC[s], marginRight: 12 }}>{ef.factor} kg/{ef.unit}</span>
                            <span style={{ fontSize: 9, color: 'var(--mut)', opacity: .6 }}>{ef.source}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mut)', lineHeight: 1.9 }}>
                    Sources: DEFRA 2024 · IPCC AR6 GWP100 · IEA 2024 · CEA V20.0 Dec 2024 · BEE India PAT
                  </div>
                </div>
              </div>
            )}

            {/* ── LEDGER TAB ───────────────────────────────────────────── */}
            {tab === 'ledger' && (
              <div className="em-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div className="em-ctit" style={{ marginBottom: 0 }}>GHG INVENTORY LEDGER · {year}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--mut)', alignSelf: 'center' }}>{filtered.length} records</span>
                    <button className="em-btn em-btn-g em-btn-sm" onClick={handleExport}>EXPORT CSV</button>
                  </div>
                </div>
                <div className="em-fps">
                  {[['all','ALL'],['1','SCOPE 1'],['2','SCOPE 2'],['3','SCOPE 3']].map(([k, v]) => (
                    <button key={k} className={`em-fp${sfilt===k ? k==='all' ? ' fa' : ` f${k}` : ''}`}
                      onClick={() => { setSfilt(k); setPage(1); }}>{v}</button>
                  ))}
                </div>
                <div className="em-lh">
                  <span>DATE</span><span>ACTIVITY</span><span>S</span>
                  <span>CATEGORY</span><span>QTY</span><span>tCO2e</span><span>SOURCE</span><span>STATUS</span>
                </div>
                {pageRecords.length === 0
                  ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>No records log your first emission above</div>
                  : pageRecords.map(r => {
                      const col = SC[r.scope] || '#888';
                      return (
                        <div key={r.id} className="em-lr">
                          <span style={{ color: 'var(--mut)', fontSize: 11 }}>{r.date}</span>
                          <span style={{ fontSize: 10 }}>{r.activity}{r.notes && <span style={{ color: 'var(--mut)', fontSize: 11, display: 'block' }}>{r.notes}</span>}</span>
                          <span><span className="em-pill" style={{ background: `${col}14`, color: col, border: `1px solid ${col}33` }}>S{r.scope}</span></span>
                          <span style={{ fontSize: 11, color: 'var(--mut)' }}>{r.category}</span>
                          <span style={{ fontSize: 10 }}>{fmt(r.qty || r.quantity, 1)} <span style={{ fontSize: 11, color: 'var(--mut)' }}>{r.unit}</span></span>
                          <span style={{ color: col, fontWeight: 700 }}>{(r.co2e || 0).toFixed(3)}</span>
                          <span style={{ fontSize: 9, color: 'var(--mut)', opacity: .7 }}>{r.source || EF[r.activity]?.source || '—'}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="em-pill" style={{ background: r.verified ? '#10b98114' : '#f59e0b14', color: r.verified ? '#10b981' : '#f59e0b', border: `1px solid ${r.verified ? '#10b98133' : '#f59e0b33'}` }}>
                              <span className="em-dot" style={{ background: r.verified ? '#10b981' : '#f59e0b' }}/>
                              {r.verified ? 'VERIFIED' : 'PENDING'}
                            </span>
                            <button onClick={() => handleDeleteRequest(r.id)}
                              style={{ background: 'none', border: 'none', color: '#ef444444', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}
                              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                              onMouseLeave={e => e.currentTarget.style.color = '#ef444444'}
                              aria-label="Delete record">✕</button>
                          </span>
                        </div>
                      );
                    })
                }
                {totalPages > 1 && (
                  <div className="em-pg">
                    <button className="em-pgb" disabled={page === 1} onClick={() => setPage(p => p - 1)}>PREV</button>
                    <span style={{ fontSize: 11, color: 'var(--mut)' }}>PAGE {page} / {totalPages}</span>
                    <button className="em-pgb" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>NEXT</button>
                  </div>
                )}
              </div>
            )}

            {/* ── ANALYTICS TAB ────────────────────────────────────────── */}
            {tab === 'analytics' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="em-g2">
                  <div className="em-card">
                    <div className="em-ctit">MONTHLY TREND BY SCOPE {year}</div>
                    <div style={{ height: 260 }}><Line data={trendData} options={CHART_OPTS}/></div>
                  </div>
                  <div className="em-card">
                    <div className="em-ctit">SCOPE DISTRIBUTION</div>
                    <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 220, height: 220 }}>
                        <Doughnut data={donutData} options={{ ...CHART_OPTS, scales: undefined, cutout: '68%' }}/>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="em-card">
                  <div className="em-ctit">EMISSIONS BY CATEGORY (tCO2e)</div>
                  <div style={{ height: 220 }}><Bar data={catData} options={CHART_OPTS}/></div>
                </div>
                <div className="em-card">
                  <div className="em-ctit">TOP 5 EMITTING ACTIVITIES</div>
                  {[...records].sort((a, b) => b.co2e - a.co2e).slice(0, 5).map((r, i) => (
                    <div key={r.id || i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--brd)44', fontSize: 12 }}>
                      <span style={{ color: 'var(--mut)' }}>
                        <span style={{ color: SC[r.scope], marginRight: 8, fontSize: 11 }}>S{r.scope}</span>{r.activity}
                        <span style={{ color: 'var(--mut)', fontSize: 11, display: 'block' }}>{r.date} · {r.notes}</span>
                      </span>
                      <span style={{ color: SC[r.scope], fontWeight: 700, flexShrink: 0, marginLeft: 12 }}>{(r.co2e || 0).toFixed(3)} t</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── INTENSITY TAB ─────────────────────────────────────────── */}
            {tab === 'intensity' && (
              <div className="em-g2">
                <div className="em-card">
                  <div className="em-ctit">CARBON INTENSITY METRICS</div>
                  {industryBenchmark && revenueIntensity && (
                    <div className="em-benchmark" style={{ borderColor: benchmarkStatus === 'leader' ? '#10b98133' : benchmarkStatus === 'average' ? '#f59e0b33' : '#ef444433' }}>
                      <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 8 }}>INDUSTRY BENCHMARK {profile.industry}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                        {[
                          { l: 'YOUR INTENSITY', v: `${fmt(revenueIntensity, 2)}`, c: benchmarkStatus === 'leader' ? '#10b981' : benchmarkStatus === 'average' ? '#f59e0b' : '#ef4444' },
                          { l: 'SECTOR LEADER',  v: `${industryBenchmark.low}`,    c: '#10b981' },
                          { l: 'SECTOR AVERAGE', v: `${industryBenchmark.medium}`, c: '#f59e0b' },
                          { l: 'SECTOR HIGH',    v: `${industryBenchmark.high}`,   c: '#ef4444' },
                        ].map(({ l, v, c }) => (
                          <div key={l} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 9, color: 'var(--mut)', marginBottom: 4 }}>{l}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: c, fontFamily: 'Syne,sans-serif' }}>{v}</div>
                            <div style={{ fontSize: 8, color: 'var(--mut)' }}>tCO2e/Rs.Cr</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {revenueIntensityPPP && (
                    <div style={{ padding: '10px 14px', borderRadius: 7, background: '#f9731608', border: '1px solid #f9731633', marginBottom: 14, fontSize: 11, color: '#f97316' }}>
                      <strong>PPP-adjusted intensity (SEBI BRSR ISF Dec 2024 mandatory):</strong>{' '}
                      {fmt(revenueIntensityPPP * 1000, 2)} tCO2e / M$ PPP
                      <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--mut)' }}>IMF PPP rate: Rs.{IMF_PPP_RATE_INR} per intl. $ (WEO Apr 2025)</span>
                    </div>
                  )}
                  {intensities.length === 0
                    ? <div className="em-alert em-aly" style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => navigate('/team?tab=profile')}><span>⚠</span><span>Set up company profile to see intensity metrics</span></div>
                    : intensities.map(({ label, val, unit, max, color }) => (
                      <div key={label} className="em-irow">
                        <div className="em-ihr">
                          <span style={{ color: 'var(--mut)', fontSize: 11 }}>{label}</span>
                          <span style={{ color, fontSize: 11, fontWeight: 700 }}>{fmt(val, 3)} <span style={{ fontSize: 11, color: 'var(--mut)' }}>{unit}</span></span>
                        </div>
                        <div className="em-itrack"><div className="em-ifill" style={{ width: `${Math.min(100, val / max * 100)}%`, background: color }}/></div>
                      </div>
                    ))
                  }
                </div>
                <div className="em-card">
                  <div className="em-ctit">DECARBONISATION SCENARIOS</div>
                  {[
                    { name: 'Baseline (Current)',           val: total, pct: 100, color: 'var(--red)' },
                    { name: 'Renewable Electricity Switch', val: total - scope2Loc * 0.96, pct: (total - scope2Loc * 0.96) / Math.max(total, .001) * 100, color: 'var(--ylw)' },
                    { name: '+ Supply Chain Optimisation',  val: total - scope2Loc * 0.96 - scope3 * 0.3, pct: (total - scope2Loc * 0.96 - scope3 * 0.3) / Math.max(total, .001) * 100, color: '#10b981' },
                    { name: 'Net Zero (Full Offset)',        val: 0, pct: 0, color: 'var(--s2)' },
                  ].map(({ name, val, pct, color }) => (
                    <div key={name} className="em-irow">
                      <div className="em-ihr">
                        <span style={{ color: 'var(--mut)', fontSize: 11 }}>{name}</span>
                        <span style={{ color, fontSize: 11, fontWeight: 700 }}>{fmt(val)} <span style={{ fontSize: 11, color: 'var(--mut)' }}>tCO2e</span></span>
                      </div>
                      <div className="em-itrack"><div className="em-ifill" style={{ width: `${pct}%`, background: color }}/></div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── ESG REPORT TAB ─────────────────────────────────────────── */}
            {/* [FIX-TIER-GATE] Corporate only                                */}
            {tab === 'esg' && !corporate && (
              <UpgradeLock tabLabel="ESG Report" navigate={navigate} />
            )}

            {tab === 'esg' && corporate && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="em-card">
                  <div className="em-ctit">FRAMEWORK COMPLIANCE STATUS</div>
                  <div className="em-esg-g">
                    {[
                      // [FIX-ESG-STATUS] All ok values now wired to real data
                      { name: 'GHG Protocol',   sub: 'Corporate Standard + Dual S2',       ok: records.length > 0 && scope2Mkt >= 0,                                    status: records.length > 0 ? 'COMPLIANT' : 'PENDING',          nav: null },
                      { name: 'SEBI BRSR Core', sub: 'India Dec 2024 ISF standards',        ok: records.length > 0 && !!brsrData,                                        status: records.length > 0 && brsrData ? 'COMPLIANT' : records.length > 0 ? 'GHG ONLY' : 'PENDING', nav: null },
                      { name: 'CDP',            sub: 'Prep doc submit via portal',           ok: records.length > 0,                                                      status: records.length > 0 ? 'PDF READY' : 'PENDING',          nav: null },
                      { name: 'TCFD',           sub: '4-pillar disclosure',                  ok: records.length > 0,                                                      status: records.length > 0 ? 'PDF READY' : 'PENDING',          nav: null },
                      { name: 'GRI 305',        sub: 'Emissions Standard',                   ok: records.length > 0,                                                      status: records.length > 0 ? 'COMPLIANT' : 'PENDING',          nav: null },
                      { name: 'ISO 14064-3',    sub: 'Third-party verification',             ok: !!verifier,                                                              status: verifier ? 'VERIFIED' : 'PENDING',                     nav: null },
                      // [FIX-ESG-STATUS] SBTi: ok if net_zero_year AND net_zero_target_co2e are set
                      { name: 'SBTi',           sub: 'Science Based Targets',                ok: !!profile?.net_zero_year && !!profile?.net_zero_target_co2e,             status: profile?.net_zero_year && profile?.net_zero_target_co2e ? 'TARGET SET' : 'SET UP TARGETS', nav: 'sbti' },
                      // [FIX-ESG-STATUS] PAT: ok if patData is loaded from API
                      { name: 'PAT Scheme',     sub: 'BEE India Energy Cycle IV',            ok: !!patData,                                                               status: patData ? 'CONFIGURED' : 'SETUP REQUIRED',             nav: 'pat-scheme' },
                      // [FIX-ESG-STATUS] CCTS: ok if cctsData is loaded from API
                      { name: 'CCTS 2025',      sub: '9 sectors BEE/CERC/GRID-India',        ok: !!cctsData,                                                              status: cctsData ? 'CONFIGURED' : 'SETUP REQUIRED',            nav: 'ccts' },
                      { name: 'ISO 14064-1',    sub: 'GHG Inventories',                      ok: records.length > 0,                                                      status: records.length > 0 ? 'COMPLIANT' : 'PENDING',          nav: null },
                    ].map(({ name, sub, ok, status, nav }) => (
                      <div key={name} className="em-fw"
                        style={{ cursor: nav ? 'pointer' : undefined }}
                        onClick={nav ? () => setTab(nav) : undefined}
                      >
                        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{name}</div>
                        <div style={{ fontSize: 11, color: 'var(--mut)', letterSpacing: '.06em', marginBottom: 10 }}>{sub}</div>
                        <span className="em-pill" style={{ background: ok ? '#10b98114' : '#f59e0b14', color: ok ? '#10b981' : '#f59e0b', border: `1px solid ${ok ? '#10b98133' : '#f59e0b33'}`, display: 'inline-flex' }}>{status}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="em-g2">
                  <div className="em-card">
                    <div className="em-ctit">ANNUAL GHG INVENTORY FY {year}</div>
                    {[
                      { label: 'Scope 1 Direct Emissions',                     val: fmt(scope1),    unit: 'tCO2e', color: '#f97316', bold: false },
                      { label: 'Scope 2 Location-based (CEA V20.0 0.727)',     val: fmt(scope2Loc), unit: 'tCO2e', color: '#3b82f6', bold: false },
                      { label: 'Scope 2 Market-based (REC/PPA/Green Tariff)',  val: fmt(scope2Mkt), unit: 'tCO2e', color: '#60a5fa', bold: false },
                      { label: 'Scope 3 All 15 Categories',                    val: fmt(scope3),    unit: 'tCO2e', color: '#a855f7', bold: false },
                      { label: 'TOTAL GHG EMISSIONS (location-based)',          val: fmt(total),     unit: 'tCO2e', color: 'var(--grn)', bold: true },
                      { label: 'Carbon Credits Retired',                        val: fmt(retirements.reduce((s, r) => s + parseInt(r.amount||0), 0)), unit: 'tCO2e', color: '#10b981', bold: false },
                      { label: 'NET EMISSIONS AFTER OFFSET',                   val: fmt(Math.max(0, total - retirements.reduce((s,r)=>s+parseInt(r.amount||0),0))), unit: 'tCO2e', color: 'var(--grn)', bold: true },
                      { label: 'Intensity (per employee)',                      val: employees ? fmt(total/employees,3) : '—', unit: 'tCO2e/FTE', color: 'var(--txt)', bold: false },
                      { label: 'Intensity (per Rs.Cr revenue)',                 val: revenueCr ? fmt(total/revenueCr,3) : '—', unit: 'tCO2e/Rs.Cr', color: 'var(--txt)', bold: false },
                      { label: 'Intensity (PPP-adjusted BRSR ISF Dec 2024)',   val: revenueIntensityPPP ? `${fmt(revenueIntensityPPP*1000,2)}` : '—', unit: 'tCO2e/M$ PPP', color: '#f97316', bold: false },
                      { label: 'Credits Required to Offset',                   val: String(creditsNeeded), unit: 'credits', color: 'var(--grn)', bold: false },
                    ].map(({ label, val, unit, color, bold }) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--brd)44', fontSize: bold ? 12 : 10, fontWeight: bold ? 700 : 400 }}>
                        <span style={{ color: 'var(--mut)' }}>{label}</span>
                        <span style={{ color }}>{val} <span style={{ fontSize: 11, color: 'var(--mut)' }}>{unit}</span></span>
                      </div>
                    ))}
                  </div>

                  {/* ── [FIX-NZ-BARS] Net Zero Roadmap with dynamic progress bars ── */}
                  <div className="em-card">
                    <div className="em-ctit">NET ZERO ROADMAP</div>
                    {[
                      { label: `2030 50% reduction (India NDC)`, reductionPct: 50  },
                      { label: `2035 SBTi 1.5C aligned`,         reductionPct: 65  },
                      { label: `2040 80% reduction`,              reductionPct: 80  },
                      { label: `${profile?.net_zero_year || 2050} Net Zero`, reductionPct: 100 },
                    ].map(({ label, reductionPct }) => {
                      // Use prevYearTotal as baseline if available, else use current total
                      // This gives a meaningful progress bar even without historic data
                      const baseline   = prevYearTotal && prevYearTotal > 0 ? prevYearTotal : (total > 0 ? total * 1.1 : 1);
                      const targetAbs  = baseline * (1 - reductionPct / 100);
                      const gap        = Math.max(0, total - targetAbs);
                      // Progress toward the reduction goal: 0% = no reduction, 100% = goal met
                      const progressPct = baseline > 0
                        ? Math.max(0, Math.min(100, ((baseline - total) / Math.max(baseline - targetAbs, 0.001)) * 100))
                        : 0;
                      const barColor = progressPct >= 100 ? 'var(--grn)' : progressPct >= 50 ? 'var(--ylw)' : 'var(--red)';
                      return (
                        <div key={label} className="em-irow">
                          <div className="em-ihr">
                            <span style={{ color: 'var(--mut)', fontSize: 11 }}>{label}</span>
                            <span style={{ color: gap === 0 ? 'var(--grn)' : '#f59e0b', fontSize: 11 }}>
                              Target: {fmt(targetAbs)} t
                            </span>
                          </div>
                          <div className="em-itrack">
                            <div className="em-ifill" style={{ width: `${progressPct}%`, background: barColor }}/>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--mut)', marginTop: 3 }}>
                            <span>{gap > 0 ? `Gap: ${fmt(gap)} tCO2e to reduce` : 'Target achieved'}</span>
                            <span style={{ color: barColor }}>{fmt(progressPct, 1)}% progress</span>
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ marginTop: 16 }}>
                      <button className="em-btn em-btn-g em-btn-sm" onClick={() => setTab('sbti')} style={{ width: '100%' }}>
                        SET UP SBTi TARGETS FOR SCIENCE-BASED PATHWAY
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </>)}
        </div>
      </div>
    </>
  );
}