// src/components/EmissionTracking.jsx
// ── Regulatory compliance:
//    CEA V20.0 Dec 2024 — grid EF 0.727 tCO₂/MWh (FY 2023-24 weighted avg)
//    GHG Protocol Scope 2 Guidance — dual reporting (location + market) MANDATORY
//    SEBI BRSR Dec 2024 circular — PPP-adjusted intensity, output-based intensity
//    BEE CCTS Oct 2025 / Jan 2026 gazette — 9 sectors
//    IPCC AR6 GWP100 — all GHG factors
//    DEFRA 2024 — non-India factors
// ── Bug fixes v9 (this merge — combines your v7 and v8 files):
//    [MERGE-CSS]        Restored CSS classes that v8 silently dropped and
//                       that child components rely on for global styling:
//                       .em-lbl, .em-fg / .em-fg3 / .em-fg4 (form grids used
//                       by EmissionLogHub's log form), .em-drop (+hover/over,
//                       bulk CSV import drop zone), .em-inp::placeholder,
//                       .em-card-dark, .em-ctit-action, .em-export-btn::before,
//                       .em-fw[style*="cursor"]:hover, .em-nz / .em-nzf,
//                       .em-prev / .em-prev-val, .em-chart-wrap,
//                       @keyframes shimmer.
//    [MERGE-UPPERCASE]  Kept text-transform:uppercase on .em-brand-label,
//                       .em-badge, .em-ctit, .em-lh, .em-lbl. v8 had dropped
//                       these, which silently broke the plan badge (it would
//                       render lowercase "growth"/"corporate" from the API
//                       instead of "GROWTH"/"CORPORATE").
//    [MERGE-BRSR-LABEL] Kept the friendly section-name map (Section A,
//                       Section B, P1…P9, "P6 Environmental") in the BRSR
//                       save toast. v8 had regressed to toasting the raw
//                       sectionKey (e.g. "p6 saved" instead of
//                       "P6 Environmental saved").
//    [MERGE-ANIM-FIX]   UpgradeLock referenced a non-existent "fU" keyframe
//                       (leftover typo — silently did nothing). Fixed to the
//                       real "fadeUp" keyframe.
// ── Bug fixes v8 (state-correctness fixes, carried forward from your latest file):
//    [FIX-REFRESH]      onRecordAdded now calls setSummary() after every log
//                       so scope cards, analytics, inventory, and category
//                       breakdown all update immediately — not just ledger rows.
//    [FIX-LOADALL-YEAR] loadAll() always fetches records filtered by the
//                       selected year. Previously fetched all-time records,
//                       so switching years showed wrong totals and ledger rows.
//    [FIX-RECORDS-INIT] setRecords([]) when the year has no data, so the
//                       ledger never shows stale records from a previous year.
//    [FIX-SSE-DEDUP]    SSE 'log' handler skips prepend if the record was
//                       already added by the optimistic update, skips records
//                       outside the currently-viewed year, and always
//                       refreshes summary regardless.
//    [FIX-DELETE-SYNC]  Delete now optimistically updates summary state too,
//                       not just the records array, so scope cards update
//                       instantly. Rolls back via loadAll() on failure.
// ── Bug fixes v7:
//    [FEAT-APPROVALS]  New "Approvals" tab in Data & Ledger group — renders
//                      MakerChecker.jsx. Draft → submitted → reviewed →
//                      approved → locked workflow for every emission record.
//    [FEAT-LINEAGE]    Each ledger row now has a 🔍 lineage button that opens
//                      EmissionLineage.jsx — full source-to-number traceability
//                      (file → user → EF version → approver → blockchain anchor).
// ── Bug fixes v6:
//    [FIX-TAB-GROUP]   Tab bar restructured — Overview pinned, 5 collapsible
//                      groups (Data & Ledger, Analysis, BRSR & Regulatory,
//                      Targets & Planning, Supply Chain). Locked tabs hidden
//                      for Growth users; single "Unlock Corporate" button shown
//                      instead of scattered lock icons.
//    [FIX-PLAN-NULL]   subscriptionPlan defaults to 'loading' not null.
//                      Corporate tabs show neutral skeleton until plan resolves,
//                      not UpgradeLock (which was showing briefly for Corp users).
//    [FIX-TOAST-DUP]   Removed redundant toasts in handlePdfExportClick —
//                      the pre-flight modal already shows all check rows.
//    [FIX-SFILT-RESET] sfilt now resets to 'all' on tab switch alongside page.
//    [FIX-NZ-FALLBACK] Net Zero bars show explicit "No baseline data" message
//                      when prevYearTotal is null, instead of four red 0% bars.
//    [FIX-CHECKS-MEMO] getExportChecks memoized via useMemo keyed on
//                      pendingExport?.type to avoid double-compute per render.
//    [FIX-BRSR-MERGE]  brsrData keyed by section (section-a, section-b, p1..p9)
//                      — saving one section never wipes another.
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
// ── Real-time: SSE stream subscribes to /api/emissions/stream for live
//    log/bulk/delete events — exponential backoff retry on disconnect.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS, LineElement, BarElement, ArcElement,
  CategoryScale, LinearScale, PointElement, Tooltip, Legend, Filler
} from 'chart.js';
import { apiFetch } from '../services/api';
import BRSRDisclosures    from './BRSRDisclosures';
import AuditTrail         from './AuditTrail';
import PATScheme          from './PATScheme';
import MultiEntity        from './MultiEntity';
import CCTSCompliance     from './CCTSCompliance';
import SBTiModule         from './SBTiModule';
import FiveYearActionPlan from './FiveYearActionPlan';
import SupplierPortal     from './SupplierPortal';
import EmissionLogHub     from './emission-log/EmissionLogHub';
import MakerChecker       from './emission-log/MakerChecker';
import EmissionLineage    from './EmissionLineage';
import EmissionAnalytics from './EmissionAnalytics';
import GHGLedger from './emission-log/GHGLedger';

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

// [FIX-REFRESH] Centralised record normaliser — used everywhere a record
// comes in from the API or SSE, so the shape handed to the rest of the
// component is always consistent (loadAll, SSE 'log' events, onRecordAdded).
const normaliseRecord = (r) => ({
  ...r,
  qty:      parseFloat(r.quantity || r.qty || 0),
  co2e:     parseFloat(r.co2e || 0),
  date:     (r.date || '').slice(0, 10),
  notes:    sanitise(r.notes    || ''),
  activity: sanitise(r.activity || ''),
});

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
// [FIX-TIER-GATE] Tier helpers
// ─────────────────────────────────────────────────────────────────────────────
const CORPORATE_PLANS = ['corporate', 'enterprise'];
const isCorporate = (plan) => CORPORATE_PLANS.includes(plan);

// PDF types locked to Corporate+ (ghg-protocol available on Growth)
const CORPORATE_PDF_TYPES = ['brsr', 'cdp', 'tcfd'];

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-TAB-GROUP] Tab navigation structure
// Overview is pinned. Corporate tabs are hidden from Growth users entirely.
// [FEAT-APPROVALS] 'approvals' added to Data & Ledger group — available on
//                  Growth too, since the approval workflow is core data
//                  hygiene, not a corporate-only compliance feature.
// ─────────────────────────────────────────────────────────────────────────────
const TAB_GROUPS = [
  {
    id: 'data',
    label: 'DATA & LEDGER',
    tabs: [
      { k: 'log',       v: 'Log Emission' },
      { k: 'ledger',    v: 'GHG Ledger'  },
      { k: 'approvals', v: 'Approvals'   },
    ],
    corporate: false,
  },
  {
    id: 'analysis',
    label: 'ANALYSIS',
    tabs: [
      { k: 'analytics', v: 'Analytics' },
      { k: 'intensity', v: 'Intensity' },
    ],
    corporate: false,
  },
  {
    id: 'regulatory',
    label: 'BRSR & REGULATORY',
    tabs: [
      { k: 'brsr-env',   v: 'BRSR Disclosures'  },
      { k: 'pat-scheme', v: 'PAT Scheme'         },
      { k: 'ccts',       v: 'CCTS Compliance'    },
      { k: 'audit',      v: 'Audit Trail'         },
    ],
    corporate: true,
  },
  {
    id: 'targets',
    label: 'TARGETS & PLANNING',
    tabs: [
      { k: 'sbti',        v: 'SBTi Targets' },
      { k: 'action-plan', v: '5-Year Plan'  },
    ],
    corporate: true,
  },
  {
    id: 'supply',
    label: 'SUPPLY CHAIN',
    tabs: [
      { k: 'suppliers', v: 'Suppliers'    },
      { k: 'multi',     v: 'Multi-Entity' },
    ],
    corporate: true,
  },
];

// [FEAT-APPROVALS] 'approvals' added — renders MakerChecker full-page, same
// as other full-page tabs, so it doesn't fall inside the scope cards section.
const isFullPageTab = (t) => [
  'brsr-env', 'audit', 'pat-scheme', 'ccts', 'multi',
  'gei-report', 'sbti', 'action-plan', 'suppliers', 'approvals',
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
    // [MERGE-ANIM-FIX] was 'fU .4s ease both' — "fU" matched no @keyframes,
    // so this animation was a silent no-op. Fixed to the real "fadeUp".
    animation: 'fadeUp .4s ease both',
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
// PLAN LOADING SKELETON
// Shown in place of UpgradeLock while subscriptionPlan is still resolving
// ─────────────────────────────────────────────────────────────────────────────
const PlanLoadingSkeleton = () => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 340, gap: 12,
    background: 'var(--surf)', border: '1px solid var(--brd)', borderRadius: 10,
  }}>
    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mut)', opacity: .4, animation: 'pulse 1.2s ease infinite' }}/>
    <div style={{ fontSize: 11, color: 'var(--mut)', letterSpacing: '.12em' }}>LOADING PLAN DATA</div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function EmissionTracking() {
  const [records,           setRecords]           = useState([]);
  const [summary,           setSummary]           = useState(null);
  const [profile,           setProfile]           = useState(null);
  const [tab,               setTab]               = useState('esg');
  const [activeGroup,       setActiveGroup]       = useState(null);
  const [sfilt,             setSfilt]             = useState('all');
  const [page,              setPage]              = useState(1);
  const [year,              setYear]              = useState(new Date().getFullYear());
  const [notif,             setNotif]             = useState(null);
  const [loading,           setLoading]           = useState(true);
  const [exportLoading,     setExportLoading]     = useState('');
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
  const [subscriptionPlan,  setSubscriptionPlan]  = useState('loading');
  const [pdfUpgradeModal,   setPdfUpgradeModal]   = useState(null);
  // [FEAT-LINEAGE] holds the record currently shown in the lineage modal
  const [lineageRecord,     setLineageRecord]     = useState(null);

  const abortRef   = useRef(null);
  const navRef     = useRef(null);
  const groupRefs  = useRef({});
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const PER_PAGE = 10;

  const navigate = useNavigate();
  const toast = useCallback((msg, type = 'success') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 4000);
  }, []);

  // ── Click-outside closes nav dropdown ─────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      // Close if click is outside the nav AND outside any group button
      const inNav = navRef.current?.contains(e.target);
      const inAnyGroup = Object.values(groupRefs.current).some(el => el?.contains(e.target));
      if (!inNav && !inAnyGroup) setActiveGroup(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── [FIX-PLAN-FETCH] Load all data including subscription plan ─────────────
  // [FIX-LOADALL-YEAR] / [FIX-RECORDS-INIT] Activities are always fetched
  // filtered by the selected year, and records are always reset (including to
  // [] when that year has no data) — previously this fetched all-time
  // activities, so switching years showed the wrong totals and stale rows.
  const loadAll = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setLoading(true);
    try {
      const [acts, sum, prof] = await Promise.all([
        apiFetch(`/api/emissions/activities?year=${year}&limit=500`, { signal: ctl.signal }).catch(() => null),
        apiFetch(`/api/emissions/summary?year=${year}`,              { signal: ctl.signal }).catch(() => null),
        apiFetch('/api/emissions/profile',                            { signal: ctl.signal }).catch(() => null),
      ]);

      if (ctl.signal.aborted) return;

      // [FIX-RECORDS-INIT] Always reset records for the selected year — even
      // to an empty array — so a year with no data never shows the previous
      // year's rows left over from before the fetch resolved.
      setRecords(acts?.activities?.length ? acts.activities.map(normaliseRecord) : []);
      if (sum) setSummary(sum);
      if (prof?.profile) {
        setProfile(prof.profile);
      }

      // [FIX-PLAN-NULL] Fetch subscription plan — stays 'loading' until resolved
      apiFetch('/api/org/plan', { signal: ctl.signal })
        .then(d => { if (!ctl.signal.aborted) setSubscriptionPlan(d?.plan || 'growth'); })
        .catch(() => { if (!ctl.signal.aborted) setSubscriptionPlan('growth'); });

      apiFetch(`/api/transactions/retirements`, { signal: ctl.signal })
        .then(d => { if (ctl.signal.aborted || !d) return; setRetirements(d?.retirements || d?.data || []); setCredits(d?.credits || []); }).catch(() => {});

      apiFetch(`/api/brsr/environmental?year=${year}`, { signal: ctl.signal })
        .then(d => {
          if (ctl.signal.aborted || !d?.data) return;
          const { energy, water, waste } = d.data;
          if (energy || water || waste) {
            setBrsrData(prev => ({ ...prev, p6: { energyData: energy, waterData: water, wasteData: waste } }));
          }
        }).catch(() => {});

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

  // [FEAT-SSE] Real-time updates — subscribes to backend SSE stream
  useEffect(() => {
    let es;
    let retryTimeout;
    let retries = 0;

    const connect = () => {
      es = new EventSource('/api/emissions/stream', { withCredentials: true });

      es.addEventListener('emission_update', (e) => {
        try {
          const data = JSON.parse(e.data);

          if (data.action === 'log') {
            const r = data.record;
            if (!r) return;
            // [FIX-SSE-DEDUP] Skip prepend if the optimistic update from
            // onRecordAdded already added this record, and skip records that
            // don't belong to the year currently being viewed. The summary
            // refresh below still runs regardless, since that's the source
            // of truth for the scope cards / totals.
            setRecords(prev => {
              if (prev.some(x => x.id === r.id)) return prev;
              const recordYear = new Date(r.date || '').getFullYear();
              if (recordYear !== year) return prev;
              return [normaliseRecord(r), ...prev];
            });
            apiFetch(`/api/emissions/summary?year=${year}`)
              .then(sum => { if (sum) setSummary(sum); }).catch(() => {});
          }

          if (data.action === 'bulk') {
            loadAll();
            const { inserted = 0, duplicates = 0, errSkipped = 0 } = data;
            const msg = [
              `✓ ${inserted} record${inserted !== 1 ? 's' : ''} imported`,
              duplicates > 0 ? `${duplicates} duplicate${duplicates !== 1 ? 's' : ''} skipped` : null,
              errSkipped > 0 ? `${errSkipped} error${errSkipped !== 1 ? 's' : ''}` : null,
            ].filter(Boolean).join(' · ');
            toast(msg, 'success');
          }

          if (data.action === 'delete') {
            if (data.id) {
              setRecords(prev => prev.filter(r => r.id !== data.id));
              apiFetch(`/api/emissions/summary?year=${year}`)
                .then(sum => { if (sum) setSummary(sum); }).catch(() => {});
            }
          }

          // [FEAT-APPROVALS] Optional — if the backend also emits state
          // transition / adjustment events over SSE, reflect them live.
          // Falls back gracefully if the backend doesn't send these yet.
          if (data.action === 'state_change' || data.action === 'adjustment') {
            setRecords(prev => prev.map(r => r.id === data.id ? { ...r, ...data.patch } : r));
          }
        } catch (_) {}
      });

      es.addEventListener('error', () => {
        es.close();
        const delay = Math.min(2000 * Math.pow(2, retries), 60_000);
        retries++;
        retryTimeout = setTimeout(connect, delay);
      });
    };

    connect();
    return () => { clearTimeout(retryTimeout); es?.close(); };
  }, [year, loadAll, toast]);

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
  const industryBenchmark   = profile?.industry ? INDUSTRY_BENCHMARKS[profile.industry] : null;
  const revenueIntensity    = revenueCr && total ? total / revenueCr : null;
  const benchmarkStatus     = industryBenchmark && revenueIntensity
    ? revenueIntensity <= industryBenchmark.low    ? 'leader'
    : revenueIntensity <= industryBenchmark.medium ? 'average' : 'laggard'
    : null;

  // Convenience flags
  const planResolved = subscriptionPlan !== 'loading';
  const corporate    = isCorporate(subscriptionPlan);

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

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDeleteRequest = (id)  => setDeleteConfirm(id);
  const handleDeleteCancel  = ()    => setDeleteConfirm(null);
  const handleDeleteConfirm = async () => {
    const id = deleteConfirm;
    setDeleteConfirm(null);
    const rollback = records.find(r => r.id === id);

    // Optimistic remove from the records list
    setRecords(prev => prev.filter(r => r.id !== id));

    // [FIX-DELETE-SYNC] Optimistically update summary too — not just the
    // records array — so the scope cards and total footprint update
    // instantly instead of waiting on a refetch.
    if (rollback) {
      setSummary(prev => {
        if (!prev) return prev;
        const co2e = rollback.co2e || 0;
        return {
          ...prev,
          scope1: rollback.scope === 1 ? Math.max(0, (prev.scope1 || 0) - co2e) : prev.scope1,
          scope2: rollback.scope === 2 ? Math.max(0, (prev.scope2 || 0) - co2e) : prev.scope2,
          scope3: rollback.scope === 3 ? Math.max(0, (prev.scope3 || 0) - co2e) : prev.scope3,
          total:  Math.max(0, (prev.total  || 0) - co2e),
        };
      });
    }

    try {
      await apiFetch(`/api/emissions/activities/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Record removed');
      // Refresh summary from the server for accuracy after the optimistic update
      apiFetch(`/api/emissions/summary?year=${year}`)
        .then(sum => { if (sum) setSummary(sum); }).catch(() => {});
    } catch {
      // Roll back the optimistic changes on failure
      if (rollback) setRecords(prev => [rollback, ...prev]);
      loadAll();
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
        // [FIX-BRSR-MERGE] brsrData is now keyed by section: { 'section-a', 'section-b', p1..p9 }
        // BRSR PDF renderer needs the full object, not just P6's energy/water/waste.
        // P6's shape stays { energyData, waterData, wasteData } for backward-compat
        // with the existing renderer; spread it flat alongside the rest.
        ...(type === 'brsr' && brsrData ? {
          brsrSections: brsrData,
          ...(brsrData.p6?.energyData ? { energyData: brsrData.p6.energyData } : {}),
          ...(brsrData.p6?.waterData  ? { waterData:  brsrData.p6.waterData  } : {}),
          ...(brsrData.p6?.wasteData  ? { wasteData:  brsrData.p6.wasteData  } : {}),
        } : {}),
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

  const intensities = [
    revenueCr && { label: 'Carbon Intensity (Revenue Rs.Cr)', val: total / revenueCr, unit: 'tCO2e/Rs.Cr', max: 5, color: total / revenueCr > 2 ? 'var(--red)' : total / revenueCr > 1 ? 'var(--ylw)' : 'var(--grn)' },
    revenuePPP && { label: 'Carbon Intensity (Revenue PPP adj. IMF 2025)', val: total / revenuePPP * 1000, unit: 'tCO2e/M$ PPP', max: 200, color: 'var(--grn)' },
    employees  && { label: 'Carbon Intensity (FTE)', val: total / employees, unit: 'tCO2e/emp', max: 2, color: total / employees > 1 ? 'var(--red)' : total / employees > .5 ? 'var(--ylw)' : 'var(--grn)' },
    floorSqft  && { label: 'Carbon Intensity (Area)', val: total / floorSqft * 1000, unit: 'kgCO2e/sqft', max: 1, color: 'var(--grn)' },
    total > 0  && { label: 'Scope 3 Share', val: scope3 / total * 100, unit: '%', max: 100, color: scope3 / total > .6 ? 'var(--red)' : scope3 / total > .4 ? 'var(--ylw)' : 'var(--grn)' },
  ].filter(Boolean);

  // ── [FIX-CHECKS-MEMO] Export checks memoized ──────────────────────────────
  const getExportChecks = useCallback((type) => {
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
      { label: 'Energy data (P6-E2)', detail: 'Total GJ consumed · renewable share — BRSR Disclosures → Section C → P6', ok: !!brsrData?.p6?.energyData, required: false, fixTab: 'brsr-env' },
      { label: 'Water data (P6-E3)', detail: 'Withdrawal consumption recycling rate — BRSR Disclosures → Section C → P6', ok: !!brsrData?.p6?.waterData, required: false, fixTab: 'brsr-env' },
      { label: 'Waste data (P6-E4)', detail: 'Total waste hazardous recycling rate — BRSR Disclosures → Section C → P6', ok: !!brsrData?.p6?.wasteData, required: false, fixTab: 'brsr-env' },
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
      { label: 'BRSR environmental data', detail: 'TCFD physical risk exposure — BRSR Disclosures → Section C → P6 Energy/Water/Waste', ok: !!brsrData?.p6, required: false, fixTab: 'brsr-env' },
    ];
    return base;
  }, [profile, year, records, scope2Mkt, brsrData, verifier, prevYearEmissions, retirements]);

  const exportChecks = useMemo(
    () => getExportChecks(pendingExport?.type || 'ghg-protocol'),
    [getExportChecks, pendingExport?.type]
  );
  const canExport = exportChecks.filter(c => c.required).every(c => c.ok);

  // ── [FIX-SFILT-RESET] Tab click — resets filter and page ──────────────────
  const handleTabClick = (k) => {
    setTab(k);
    setPage(1);
    setSfilt('all');
  };

  // ── [FIX-TOAST-DUP] PDF export click — no redundant toasts ───────────────
  const handlePdfExportClick = (type, label) => {
    if (CORPORATE_PDF_TYPES.includes(type) && !corporate) {
      setPdfUpgradeModal({ label });
      return;
    }
    setPendingExport({ type, label });
    setShowExportModal(true);
  };

  // ── CSS ───────────────────────────────────────────────────────────────────
  const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;700;800&display=swap');

:root{
  --bg:#050709;
  --surf:#0b0f14;
  --surf2:#0f1419;
  --surf3:#131920;
  --brd:#1c2836;
  --brd2:#243348;
  --txt:#eef4ff;
  --txt2:#c8d8ea;
  --mut:#5a7a96;
  --grn:#10b981;
  --grn2:#059669;
  --red:#ef4444;
  --ylw:#f59e0b;
  --s1:#f97316;
  --s2:#3b82f6;
  --s3:#a855f7;
  --radius:12px;
  --radius-sm:8px;
}

/* ── Base ── */
*{box-sizing:border-box;}
.em{min-height:100vh;background:var(--bg);font-family:'Space Mono',monospace;color:var(--txt);position:relative;}
.em::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    radial-gradient(ellipse 800px 500px at 20% 0%,#10b98106 0%,transparent 70%),
    radial-gradient(ellipse 600px 400px at 80% 100%,#3b82f604 0%,transparent 70%);
}
.em::after{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
  background-image:
    linear-gradient(rgba(56,189,248,.018) 1px,transparent 1px),
    linear-gradient(90deg,rgba(56,189,248,.018) 1px,transparent 1px);
  background-size:56px 56px;
}
.em-in{position:relative;z-index:1;max-width:1440px;margin:0 auto;padding:0 32px 40px;}

/* ── Topbar ── */
.em-top{display:flex;align-items:center;justify-content:space-between;padding:20px 0 16px;margin-bottom:4px;border-bottom:1px solid var(--brd);animation:fadeUp .5s ease both;}
.em-brand-label{font-size:9px;letter-spacing:.18em;color:var(--mut);margin-bottom:6px;text-transform:uppercase;}
.em-brand-title{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;letter-spacing:-.02em;}
.em-brand-title span{color:var(--grn);}
.em-brand-sub{font-size:11px;color:var(--mut);margin-top:4px;letter-spacing:.04em;}
.em-brand-sub b{color:var(--txt2);}
.em-topright{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;}
.em-live{width:6px;height:6px;border-radius:50%;background:var(--grn);box-shadow:0 0 0 3px #10b98122,0 0 12px var(--grn);animation:livePulse 2.4s ease infinite;}
.em-badge{padding:4px 10px;border-radius:4px;font-size:9px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;}
.em-badge-plan-corp{background:#f9731410;color:#f97316;border:1px solid #f9731430;}
.em-badge-plan-growth{background:#3b82f610;color:#60a5fa;border:1px solid #3b82f630;}
.em-badge-grn{background:#10b98110;color:var(--grn);border:1px solid #10b98130;}
.em-badge-purple{background:#a855f710;color:#c084fc;border:1px solid #a855f730;}
.em-badge-mut{background:var(--surf2);color:var(--txt2);border:1px solid var(--brd2);}
.em-yr-sel{padding:6px 10px;border-radius:6px;background:var(--surf2);border:1px solid var(--brd2);color:var(--txt);font-family:'Space Mono',monospace;font-size:11px;outline:none;cursor:pointer;transition:border-color .2s;}
.em-yr-sel:focus{border-color:var(--grn);}

/* ── Alert strip ── */
.em-alerts{display:flex;flex-direction:column;gap:6px;margin-bottom:16px;}
.em-alert{padding:10px 16px;border-radius:var(--radius-sm);font-size:11px;display:flex;align-items:center;gap:10px;line-height:1.5;}
.em-alert-icon{flex-shrink:0;font-size:13px;}
.em-alg{background:#10b98108;border:1px solid #10b98128;color:#34d399;}
.em-aly{background:#f59e0b08;border:1px solid #f59e0b28;color:#fbbf24;}
.em-alr{background:#ef444408;border:1px solid #ef444428;color:#f87171;}

/* ── Scope hero cards ── */
.em-scopes{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;animation:fadeUp .5s ease .06s both;}
.em-sc-card{
  border-radius:var(--radius);padding:22px 24px;
  border:1px solid var(--brd);
  background:var(--surf);
  position:relative;overflow:hidden;
  transition:transform .25s cubic-bezier(.2,.8,.2,1),border-color .25s,box-shadow .25s;
  cursor:default;
}
.em-sc-card:hover{transform:translateY(-3px);border-color:var(--ac,var(--brd2));box-shadow:0 8px 32px #00000044,0 0 0 1px var(--ac,transparent)22;}
.em-sc-card::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,var(--ac,#fff)06 0%,transparent 55%);pointer-events:none;}
.em-sc-card::after{content:'';position:absolute;bottom:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--ac,var(--grn)),transparent);opacity:.5;}
.em-sc-lbl{font-size:9px;letter-spacing:.16em;color:var(--mut);margin-bottom:14px;text-transform:uppercase;}
.em-sc-scope{font-size:10px;letter-spacing:.08em;margin-bottom:6px;font-weight:700;}
.em-sc-val{font-family:'Syne',sans-serif;font-size:34px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px;line-height:1;}
.em-sc-unit{font-size:10px;color:var(--mut);letter-spacing:.06em;margin-bottom:16px;}
.em-sc-bar{height:2px;border-radius:2px;background:var(--brd);overflow:hidden;}
.em-sc-fill{height:100%;border-radius:2px;transition:width 1.2s cubic-bezier(.2,.8,.2,1);}
.em-sc-pct{font-size:10px;color:var(--mut);margin-top:6px;letter-spacing:.04em;}
/* total card special */
.em-sc-total{background:linear-gradient(135deg,#0d1a12,#0b1420);}
.em-sc-total::after{background:linear-gradient(90deg,transparent,var(--grn),transparent);opacity:.7;}
.em-nz-mini{margin-top:14px;padding-top:14px;border-top:1px solid var(--brd);}
.em-nz-mini-bar{height:3px;border-radius:2px;background:var(--brd);overflow:hidden;margin:6px 0 4px;}
.em-nz-mini-fill{height:100%;border-radius:2px;background:linear-gradient(90deg,var(--red),var(--ylw) 50%,var(--grn));transition:width 1.2s cubic-bezier(.2,.8,.2,1);}

/* ── Nav ── */
.em-nav-wrap{
  position:sticky;top:0;z-index:100;
  margin-bottom:24px;
  background:linear-gradient(to bottom,var(--bg) 0%,var(--bg)ee 100%);
  backdrop-filter:blur(12px);
  border-bottom:1px solid var(--brd);
  animation:fadeUp .5s ease .1s both;
}
.em-nav{display:flex;align-items:stretch;overflow-x:auto;scrollbar-width:none;}
.em-nav::-webkit-scrollbar{display:none;}
.em-nav-pin{padding:12px 18px;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;cursor:pointer;border:none;background:none;color:var(--mut);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;white-space:nowrap;flex-shrink:0;font-weight:700;}
.em-nav-pin:hover{color:var(--txt);}
.em-nav-pin.on{color:var(--grn);border-bottom-color:var(--grn);}
.em-nav-pin.reports.on{color:var(--s2);border-bottom-color:var(--s2);}
.em-nav-sep{width:1px;background:var(--brd);margin:8px 6px;flex-shrink:0;}
.em-nav-group{position:relative;flex-shrink:0;z-index:10;}
.em-nav-grp-btn{
  padding:12px 16px;font-family:'Space Mono',monospace;font-size:10px;
  letter-spacing:.08em;cursor:pointer;border:none;background:none;
  color:var(--mut);border-bottom:2px solid transparent;
  transition:all .2s;margin-bottom:-1px;white-space:nowrap;
  display:flex;align-items:center;gap:7px;height:100%;
}
.em-nav-grp-btn:hover{color:var(--txt);}
.em-nav-grp-btn.active{color:var(--grn);border-bottom-color:var(--grn);}
.em-nav-grp-btn .chev{
  width:14px;height:14px;border-radius:3px;
  background:var(--brd);display:flex;align-items:center;justify-content:center;
  font-size:7px;opacity:.7;transition:transform .2s,background .2s;
  flex-shrink:0;
}
.em-nav-grp-btn.open .chev{transform:rotate(180deg);background:var(--grn);opacity:1;color:#000;}
.em-nav-unlock{padding:12px 14px;font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.1em;cursor:pointer;border:none;background:none;color:var(--s1);border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-1px;white-space:nowrap;flex-shrink:0;opacity:.7;font-weight:700;}
.em-nav-unlock:hover{opacity:1;border-bottom-color:#f9731440;}

/* ── Cards ── */
.em-card{
  background:var(--surf);border:1px solid var(--brd);
  border-radius:var(--radius);padding:24px;
  animation:fadeUp .45s ease .14s both;
}
.em-card-dark{background:var(--bg);border-color:var(--brd);}
.em-ctit{
  font-size:9px;letter-spacing:.18em;color:var(--mut);
  margin-bottom:20px;display:flex;align-items:center;gap:10px;
  text-transform:uppercase;
}
.em-ctit::before{content:'';width:16px;height:1px;background:linear-gradient(90deg,var(--grn),transparent);}
.em-ctit-action{margin-left:auto;display:flex;gap:8px;align-items:center;}

/* ── Buttons ── */
.em-btn{padding:9px 18px;border-radius:var(--radius-sm);border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.em-btn:disabled{opacity:.4;cursor:not-allowed;}
.em-btn-p{background:linear-gradient(135deg,var(--grn),var(--grn2));color:#fff;box-shadow:0 4px 20px #10b98128;}
.em-btn-p:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 6px 24px #10b98138;}
.em-btn-g{background:var(--surf2);border:1px solid var(--brd2);color:var(--txt2);}
.em-btn-g:hover:not(:disabled){border-color:var(--grn);color:var(--grn);background:var(--surf3);}
.em-btn-sm{padding:6px 14px;font-size:10px;}
.em-btn-danger{background:#ef444410;border:1px solid #ef444430;color:#f87171;}
.em-btn-danger:hover{background:#ef444420;border-color:#ef4444;}

/* ── Inputs ── */
.em-lbl{font-size:10px;letter-spacing:.12em;color:var(--mut);margin-bottom:5px;text-transform:uppercase;}
.em-inp,.em-sel{
  padding:10px 14px;border-radius:var(--radius-sm);
  background:var(--surf3);border:1px solid var(--brd);
  color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;
  outline:none;transition:border-color .2s,box-shadow .2s;
  -webkit-appearance:none;width:100%;
}
.em-inp:focus,.em-sel:focus{border-color:#10b98150;box-shadow:0 0 0 3px #10b98110;}
.em-inp::placeholder{color:var(--mut);opacity:.6;}

/* ── Grids ── */
.em-g2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.em-g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;}
.em-fg4{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:12px;margin-bottom:16px;}
.em-fg3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;}
.em-fg{display:flex;flex-direction:column;gap:6px;}

/* ── Ledger ── */
.em-fps{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;}
.em-fp{padding:5px 14px;border-radius:20px;font-size:10px;border:1px solid var(--brd);background:transparent;color:var(--mut);cursor:pointer;letter-spacing:.06em;font-family:'Space Mono',monospace;transition:all .2s;font-weight:700;}
.em-fp:hover{color:var(--txt);border-color:var(--brd2);}
.em-fp.fa{border-color:var(--grn);color:var(--grn);background:#10b98110;}
.em-fp.f1{border-color:var(--s1);color:var(--s1);background:#f9731610;}
.em-fp.f2{border-color:var(--s2);color:var(--s2);background:#3b82f610;}
.em-fp.f3{border-color:var(--s3);color:var(--s3);background:#a855f710;}
.em-lh,.em-lr{display:grid;grid-template-columns:96px 1fr 60px 140px 72px 80px 72px 100px;padding:11px 16px;font-size:11px;align-items:center;gap:4px;}
.em-lh{color:var(--mut);letter-spacing:.09em;border-bottom:1px solid var(--brd);font-size:10px;text-transform:uppercase;}
.em-lr{border-bottom:1px solid var(--brd)44;transition:background .15s;border-radius:6px;}
.em-lr:hover{background:var(--surf2);}
.em-pill{font-size:9px;padding:3px 8px;border-radius:4px;letter-spacing:.05em;display:inline-flex;align-items:center;gap:4px;font-weight:700;}
.em-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0;}
.em-pg{display:flex;align-items:center;justify-content:center;gap:10px;padding-top:18px;}
.em-pgb{padding:6px 16px;border-radius:6px;border:1px solid var(--brd2);background:var(--surf2);color:var(--txt2);font-family:'Space Mono',monospace;font-size:10px;cursor:pointer;transition:all .2s;}
.em-pgb:hover:not(:disabled){border-color:var(--grn);color:var(--grn);}
.em-pgb:disabled{opacity:.25;cursor:not-allowed;}

/* ── Intensity bars ── */
.em-irow{margin-bottom:16px;}
.em-ihr{display:flex;justify-content:space-between;margin-bottom:6px;font-size:11px;}
.em-itrack{height:3px;background:var(--brd);border-radius:2px;overflow:hidden;}
.em-ifill{height:100%;border-radius:2px;transition:width 1.2s cubic-bezier(.2,.8,.2,1);}

/* ── ESG framework cards ── */
.em-esg-g{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;}
.em-fw{
  padding:16px;border-radius:var(--radius-sm);
  border:1px solid var(--brd);background:var(--surf2);
  text-align:center;transition:all .2s;position:relative;overflow:hidden;
}
.em-fw::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,#10b98104,transparent);pointer-events:none;}
.em-fw:hover{border-color:#10b98144;transform:translateY(-1px);}
.em-fw[style*="cursor"]:hover{background:var(--surf3);}

/* ── Net zero bar ── */
.em-nz{height:10px;border-radius:6px;background:var(--brd);position:relative;overflow:hidden;margin:10px 0;}
.em-nzf{height:100%;border-radius:6px;background:linear-gradient(90deg,var(--grn2),var(--ylw) 60%,var(--red));transition:width 1.2s cubic-bezier(.2,.8,.2,1);}

/* ── Export cards ── */
.em-export-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px;}
.em-export-btn{
  padding:22px 16px;border-radius:var(--radius);
  border:1px solid var(--brd);background:var(--surf2);
  cursor:pointer;font-family:'Space Mono',monospace;
  font-size:10px;letter-spacing:.06em;color:var(--txt);
  transition:all .25s cubic-bezier(.2,.8,.2,1);text-align:center;
  position:relative;overflow:hidden;
}
.em-export-btn::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,var(--ec,#fff)06,transparent 60%);pointer-events:none;transition:opacity .2s;}
.em-export-btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 28px #00000044;}
.em-export-btn:disabled{opacity:.4;cursor:not-allowed;}
.em-export-lock-badge{position:absolute;top:8px;right:8px;font-size:8px;padding:2px 6px;border-radius:4px;background:#f9731414;color:#f97316;border:1px solid #f9731630;letter-spacing:.04em;font-weight:700;}

/* ── Benchmark ── */
.em-benchmark{padding:14px 18px;border-radius:var(--radius-sm);border:1px solid var(--brd);background:var(--surf2);margin-bottom:18px;}

/* ── Modals ── */
.em-confirm-overlay{position:fixed;inset:0;z-index:10000;background:#00000099;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);}
.em-confirm-box{background:var(--surf);border:1px solid var(--brd2);border-radius:var(--radius);padding:28px;max-width:360px;width:90%;box-shadow:0 24px 80px #000000aa;}
.em-export-modal{max-width:500px !important;width:94% !important;max-height:88vh;overflow-y:auto;}
.em-check-row{display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;padding:10px 14px;border-radius:var(--radius-sm);}
.em-check-row-req-ok{background:#10b98108;border:1px solid #10b98128;}
.em-check-row-req-fail{background:#ef444408;border:1px solid #ef444428;}
.em-check-row-opt-ok{background:var(--surf2);border:1px solid var(--brd);}
.em-check-row-opt-warn{background:var(--surf2);border:1px solid var(--brd);}

/* ── Drop zone ── */
.em-drop{border:2px dashed var(--brd2);border-radius:var(--radius-sm);padding:28px;text-align:center;cursor:pointer;transition:all .2s;margin-bottom:14px;}
.em-drop:hover,.em-drop.over{border-color:#10b98166;background:#10b98108;}

/* ── Misc ── */
.em-yoy-pos{color:var(--red);font-size:10px;}
.em-yoy-neg{color:var(--grn);font-size:10px;}
.em-prev{padding:14px 18px;border-radius:var(--radius-sm);background:#10b98108;border:1px solid #10b98122;display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
.em-prev-val{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:var(--grn);}

/* ── Animations ── */
@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes livePulse{0%,100%{box-shadow:0 0 0 3px #10b98122,0 0 12px var(--grn)}50%{box-shadow:0 0 0 6px #10b98108,0 0 20px var(--grn)}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}

/* ── Chart tooltip override ── */
.em-chart-wrap{height:260px;position:relative;}

/* ── Responsive ── */
@media(max-width:1100px){.em-scopes{grid-template-columns:1fr 1fr;}.em-export-grid{grid-template-columns:1fr 1fr;}}
@media(max-width:900px){
  .em-in{padding:0 16px 32px;}
  .em-g2{grid-template-columns:1fr;}
  .em-fg4{grid-template-columns:1fr 1fr;}
  .em-lh,.em-lr{grid-template-columns:80px 1fr 50px 70px 60px 60px;}
  .em-lh span:nth-child(n+7),.em-lr span:nth-child(n+7){display:none;}
}
@media(max-width:600px){.em-scopes{grid-template-columns:1fr;}.em-esg-g{grid-template-columns:1fr 1fr;}}
`;

  // Determine which group contains the current tab (pinned tabs esg/reports have no group)
  const activeGroupId = TAB_GROUPS.find(g => g.tabs.some(t => t.k === tab))?.id || null;

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
              FY {year} · {records.length} record{records.length !== 1 ? 's' : ''} · {profile?.company_name || 'No company set'}
            </div>
            <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--mut)', marginBottom: 8 }}>REQUIRED — missing items block export</div>
            {exportChecks.filter(c => c.required).map(({ label, detail, ok, fixTab }) => (
              <div key={label} className={`em-check-row ${ok ? 'em-check-row-req-ok' : 'em-check-row-req-fail'}`}>
                <span style={{ color: ok ? 'var(--grn)' : 'var(--red)', fontSize: 15, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>{ok ? '✓' : '✕'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: ok ? 'var(--grn)' : 'var(--red)', fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 2 }}>{detail}</div>
                </div>
                {!ok && <button className="em-btn em-btn-g" style={{ padding: '4px 10px', fontSize: 10, flexShrink: 0, alignSelf: 'center' }} onClick={() => { setShowExportModal(false); if (fixTab === 'profile') navigate('/team?tab=profile'); else handleTabClick(fixTab); }}>FIX</button>}
              </div>
            ))}
            <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--mut)', margin: '14px 0 8px' }}>OPTIONAL — improves report quality</div>
            {exportChecks.filter(c => !c.required).map(({ label, detail, ok, fixTab }) => (
              <div key={label} className={`em-check-row ${ok ? 'em-check-row-opt-ok' : 'em-check-row-opt-warn'}`}>
                <span style={{ color: ok ? 'var(--grn)' : 'var(--ylw)', fontSize: 13, flexShrink: 0, marginTop: 2 }}>{ok ? '✓' : '⚠'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: ok ? 'var(--txt)' : 'var(--ylw)' }}>{label}</div>
                  <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 1 }}>{detail}</div>
                </div>
                {!ok && <button className="em-btn em-btn-g" style={{ padding: '3px 9px', fontSize: 10, flexShrink: 0, alignSelf: 'center', opacity: .7 }} onClick={() => { setShowExportModal(false); handleTabClick(fixTab); }}>ADD</button>}
              </div>
            ))}
            {!canExport && <div className="em-alert em-alr" style={{ marginTop: 14, fontSize: 11 }}><span>✕</span><span>Complete the required fields above to enable PDF export.</span></div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button className="em-btn em-btn-p" style={{ flex: 1, opacity: canExport ? 1 : 0.35, cursor: canExport ? 'pointer' : 'not-allowed' }} disabled={!canExport || !!exportLoading}
                onClick={() => { setShowExportModal(false); downloadReport(pendingExport.type, pendingExport.label); }}>
                {exportLoading ? 'GENERATING…' : canExport ? `EXPORT ${pendingExport.label.toUpperCase()} PDF` : 'COMPLETE REQUIRED FIELDS FIRST'}
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

      {/* ── [FEAT-LINEAGE] Source-to-number lineage modal ────────────────── */}
      {lineageRecord && (
        <EmissionLineage record={lineageRecord} onClose={() => setLineageRecord(null)} />
      )}

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {notif && (
        <div style={{ position: 'fixed', top: 76, right: 24, zIndex: 9999, padding: '12px 20px', borderRadius: 8,
          background: notif.type === 'error' ? '#450a0a' : '#0b2a1e',
          border: `1px solid ${notif.type === 'error' ? '#ef444433' : '#10b98133'}`,
          color: notif.type === 'error' ? '#f87171' : '#10b981',
          fontFamily: 'Space Mono,monospace', fontSize: 11, boxShadow: '0 8px 32px #00000066', animation: 'fadeUp .3s ease' }}>
          {notif.msg}
        </div>
      )}

      <div className="em">
        <div className="em-in">

          {/* ── Topbar ───────────────────────────────────────────────────── */}
          <div className="em-top">
            <div>
              <div className="em-brand-label">
                GHG Protocol · ISO 14064-1 · CEA V20.0 · BRSR Core · CDP · TCFD · PAT · CCTS 2026
              </div>
              <div className="em-brand-title">Carbon <span>Intelligence</span></div>
              {profile?.company_name && (
                <div className="em-brand-sub">
                  <b>{profile.company_name}</b>
                  {profile.company_cin && <span style={{marginLeft:10}}>CIN: {profile.company_cin}</span>}
                  {profile.industry && <span style={{marginLeft:10}}>{profile.industry}</span>}
                  <span style={{marginLeft:10}}>FY {profile.reporting_year}</span>
                  {profile.is_default && (
                    <span style={{marginLeft:10, color:'#eab308'}}>
                      Prefilled from signup — review &amp; save in Company Profile
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="em-topright">
              <div className="em-live" title="Live tracking"/>
              {planResolved && (
                <span className={`em-badge ${corporate ? 'em-badge-plan-corp' : 'em-badge-plan-growth'}`}>
                  {subscriptionPlan}
                </span>
              )}
              {retirements.length > 0 && <span className="em-badge em-badge-grn">{retirements.length} retirements</span>}
              {verifier && <span className="em-badge em-badge-purple">ISO 14064-3 verified</span>}
              {prevYearEmissions && <span className="em-badge em-badge-mut">YoY ready</span>}
              <select className="em-yr-sel" value={year} onChange={e => { setYear(parseInt(e.target.value)); setPage(1); }}>
                {REPORT_YEARS.map(y => <option key={y}>{y}</option>)}
              </select>
            </div>
          </div>

          <div className="em-alerts">
          {!profile && (
            <div className="em-alert em-aly" style={{ cursor: 'pointer' }} onClick={() => navigate('/team?tab=profile')}>
              <span className="em-alert-icon">⚠</span><span>Set up your <strong>company profile</strong> to unlock intensity benchmarks and regulatory exports</span>
            </div>
          )}
          {yoyChange != null && (
            <div className={`em-alert ${yoyChange > 0 ? 'em-alr' : 'em-alg'}`}>
              <span className="em-alert-icon">{yoyChange > 0 ? '↑' : '↓'}</span>
              <span>Year-over-year: <strong>{yoyChange > 0 ? '+' : ''}{fmt(yoyChange, 1)}%</strong> vs {year - 1}.{yoyChange > 0 ? ' Action required.' : ' Great progress!'}</span>
            </div>
          )}
          {scope3 > 0 && scope3 > scope1 + scope2 && (
            <div className="em-alert em-aly">
              <span className="em-alert-icon">⚠</span>
              <span>Scope 3 is <strong>{fmt(scope3 / total * 100, 1)}%</strong> of total — supply chain requires priority action (BRSR Core KPI)</span>
            </div>
          )}
          {brsrData && Object.keys(brsrData).length > 0 && (
            <div className="em-alert em-alg">
              <span className="em-alert-icon">✓</span>
              <span>
                BRSR progress saved — {Object.keys(brsrData).length} of 11 sections started
                {brsrData.p6 ? ' (P6 energy/water/waste ready for PDF)' : ''}.
                {' '}Continue in BRSR Disclosures for full filing coverage.
              </span>
            </div>
          )}
          </div>

          {/* ── Scope Hero Cards ─────────────────────────────────────────── */}
          <div className="em-scopes">
            {[
              { sc: 1, lbl: 'DIRECT EMISSIONS',    sub: 'Scope 1',  val: scope1,    color: '#f97316', pct: total ? scope1/total*100 : 0 },
              { sc: 2, lbl: 'PURCHASED ENERGY',    sub: 'Scope 2',  val: scope2Loc, color: '#3b82f6', pct: total ? scope2Loc/total*100 : 0 },
              { sc: 3, lbl: 'VALUE CHAIN',         sub: 'Scope 3',  val: scope3,    color: '#a855f7', pct: total ? scope3/total*100 : 0 },
            ].map(({ sc, lbl, sub, val, color, pct }) => (
              <div key={sc} className="em-sc-card" style={{ '--ac': color }}>
                <div className="em-sc-lbl">{lbl}</div>
                <div className="em-sc-scope" style={{ color }}>{sub}</div>
                <div className="em-sc-val" style={{ color }}>{fmt(val)}</div>
                <div className="em-sc-unit">tCO₂e</div>
                <div className="em-sc-bar">
                  <div className="em-sc-fill" style={{ width: `${pct}%`, background: color }}/>
                </div>
                <div className="em-sc-pct">{fmt(pct, 1)}% of total · CEA V20.0</div>
              </div>
            ))}
            <div className="em-sc-card em-sc-total" style={{ '--ac': '#10b981' }}>
              <div className="em-sc-lbl">TOTAL FOOTPRINT · FY {year}</div>
              <div className="em-sc-val" style={{ color: '#10b981', fontSize: 38 }}>{fmt(total)}</div>
              <div className="em-sc-unit">
                tCO₂e · {creditsNeeded} credits needed
                {retirements.length > 0 && <span style={{ color: '#10b981', marginLeft: 8 }}> · {retirements.reduce((s,r)=>s+parseInt(r.amount||0),0)}t offset</span>}
                {yoyChange != null && <span className={yoyChange > 0 ? 'em-yoy-pos' : 'em-yoy-neg'} style={{ marginLeft: 8 }}>({yoyChange > 0 ? '+' : ''}{fmt(yoyChange,1)}% YoY)</span>}
              </div>
              <div className="em-nz-mini">
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--mut)' }}>
                  <span>NET ZERO PROGRESS</span>
                  <span style={{ color: netZeroPct > 80 ? 'var(--red)' : netZeroPct > 50 ? 'var(--ylw)' : 'var(--grn)' }}>{fmt(netZeroPct,1)}%</span>
                </div>
                <div className="em-nz-mini-bar"><div className="em-nz-mini-fill" style={{ width:`${netZeroPct}%` }}/></div>
                <div style={{ fontSize:10, color:'var(--mut)' }}>Target {profile?.net_zero_year||2050} · Budget {fmt(netZeroTarget)} tCO₂e</div>
              </div>
            </div>
          </div>

          {/* ── Nav ─────────────────────────────────────────────────────── */}
          <div className="em-nav-wrap">
          <div className="em-nav" ref={navRef}>
            <button className={`em-nav-pin${tab==='esg'?' on':''}`} onClick={()=>{handleTabClick('esg');setActiveGroup(null);}}>OVERVIEW</button>
            <button className={`em-nav-pin reports${tab==='reports'?' on':''}`} onClick={()=>{handleTabClick('reports');setActiveGroup(null);}}>REPORTS</button>
            <div className="em-nav-sep"/>
            {TAB_GROUPS.map(group => {
              if (group.corporate && planResolved && !corporate) return null;
              const isLoading     = group.corporate && !planResolved;
              const groupIsActive = activeGroupId === group.id;
              const isOpen        = activeGroup === group.id;
              return (
                <div key={group.id} className="em-nav-group" ref={el=>{groupRefs.current[group.id]=el;}}>
                  <button
                    className={`em-nav-grp-btn${groupIsActive?' active':''}${isOpen?' open':''}`}
                    style={{opacity:isLoading?.4:1}}
                    onClick={()=>{
                      if(isLoading)return;
                      if(isOpen){setActiveGroup(null);}
                      else{
                        const el=groupRefs.current[group.id];
                        if(el){const r=el.getBoundingClientRect();setDropdownPos({top:r.bottom+4,left:r.left});}
                        setActiveGroup(group.id);
                      }
                    }}
                  >
                    {group.label}<span className="chev">▾</span>
                  </button>
                </div>
              );
            })}

            {/* Portal dropdown */}
            {activeGroup && !(TAB_GROUPS.find(g=>g.id===activeGroup)?.corporate && planResolved && !corporate) &&
              createPortal(
                <div
                  style={{
                    position:'fixed', top:dropdownPos.top, left:dropdownPos.left,
                    minWidth:200, background:'#0b0f14', border:'1px solid #243348',
                    borderRadius:10, boxShadow:'0 16px 48px #000000cc, 0 0 0 1px #10b98112',
                    zIndex:99999, padding:6, fontFamily:'Space Mono,monospace',
                    animation:'fadeUp .15s ease both',
                  }}
                  onMouseDown={e=>e.stopPropagation()}
                >
                  {TAB_GROUPS.find(g=>g.id===activeGroup)?.tabs.map(({k,v})=>(
                    <button key={k}
                      style={{
                        display:'block', width:'100%', padding:'11px 16px',
                        fontFamily:'Space Mono,monospace', fontSize:11, letterSpacing:'.06em',
                        cursor:'pointer', border:'none',
                        background: tab===k ? '#10b98116' : 'transparent',
                        color: tab===k ? '#10b981' : '#5a7a96',
                        textAlign:'left', borderRadius:6, whiteSpace:'nowrap',
                        transition:'all .15s',
                      }}
                      onMouseEnter={e=>{e.currentTarget.style.background='#10b98110';e.currentTarget.style.color='#eef4ff';}}
                      onMouseLeave={e=>{e.currentTarget.style.background=tab===k?'#10b98116':'transparent';e.currentTarget.style.color=tab===k?'#10b981':'#5a7a96';}}
                      onClick={()=>{handleTabClick(k);setActiveGroup(null);}}
                    >
                      {v}
                      {k==='ccts'&&<span style={{marginLeft:6,fontSize:8,padding:'1px 5px',borderRadius:3,background:'#14b8a620',color:'#14b8a6',border:'1px solid #14b8a630',letterSpacing:'.06em',verticalAlign:'middle'}}>BETA</span>}
                    </button>
                  ))}
                </div>,
                document.body
              )
            }

            {planResolved && !corporate && (
              <>
                <div className="em-nav-sep"/>
                <button className="em-nav-unlock" onClick={()=>navigate('/billing')}>🔒 UNLOCK CORPORATE</button>
              </>
            )}
          </div>
          </div>{/* end em-nav-wrap */}

          {loading && (
            <div style={{ padding:60, textAlign:'center', color:'var(--mut)', fontSize:10, letterSpacing:'.18em', textTransform:'uppercase' }}>
              Loading GHG Data…
            </div>
          )}

          {/* ── Full-page tab renders ─────────────────────────────────────── */}
          {/* [FIX-PLAN-NULL] Show skeleton while plan is still resolving      */}

          {!loading && tab === 'brsr-env' && (
            !planResolved ? <PlanLoadingSkeleton /> :
            corporate
              ? <BRSRDisclosures
                  profile={profile}
                  year={year}
                  onDataReady={(payload, sectionKey) => {
                    // [FIX-BRSR-MERGE] BRSRDisclosures now passes (payload, sectionKey) —
                    // section-a, section-b, p1..p9. MUST merge by key, never replace
                    // the whole brsrData object, or saving one section wipes another.
                    setBrsrData(prev => ({ ...prev, [sectionKey]: payload }));
                    // [MERGE-BRSR-LABEL] Friendly section names for the toast —
                    // v8 had regressed to toasting the raw sectionKey (e.g. "p6 saved").
                    const labels = {
                      'section-a': 'Section A', 'section-b': 'Section B',
                      p1:'P1', p2:'P2', p3:'P3', p4:'P4', p5:'P5',
                      p6:'P6 Environmental', p7:'P7', p8:'P8', p9:'P9',
                    };
                    toast(`${labels[sectionKey] || sectionKey} saved`);
                  }}
                />
              : <UpgradeLock tabLabel="BRSR Disclosures" navigate={navigate} />
          )}

          {!loading && tab === 'audit' && (
            !planResolved ? <PlanLoadingSkeleton /> :
            corporate
              ? <AuditTrail year={year} profile={profile} emissions={records} retirements={retirements} />
              : <UpgradeLock tabLabel="Audit Trail" navigate={navigate} />
          )}

          {!loading && tab === 'pat-scheme' && (
            !planResolved ? <PlanLoadingSkeleton /> :
            corporate
              ? <PATScheme profile={profile} />
              : <UpgradeLock tabLabel="PAT Scheme" navigate={navigate} />
          )}

          {!loading && tab === 'multi' && (
            !planResolved ? <PlanLoadingSkeleton /> :
            corporate
              ? <MultiEntity profile={profile} year={year} />
              : <UpgradeLock tabLabel="Multi-Entity Consolidation" navigate={navigate} />
          )}

          {!loading && tab === 'ccts' && (
            !planResolved ? <PlanLoadingSkeleton /> :
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
            !planResolved ? <PlanLoadingSkeleton /> :
            corporate
              ? <SBTiModule profile={profile} emissions={records} year={year} />
              : <UpgradeLock tabLabel="SBTi Targets" navigate={navigate} />
          )}

          {!loading && tab === 'action-plan' && (
            !planResolved ? <PlanLoadingSkeleton /> :
            corporate
              ? <FiveYearActionPlan profile={profile} emissions={records} cctsData={cctsData} patData={patData} />
              : <UpgradeLock tabLabel="5-Year Action Plan" navigate={navigate} />
          )}

          {!loading && tab === 'suppliers' && (
            !planResolved ? <PlanLoadingSkeleton /> :
            corporate
              ? <SupplierPortal profile={profile} year={year} />
              : <UpgradeLock tabLabel="Supplier Data Portal" navigate={navigate} />
          )}

          {/* ── [FEAT-APPROVALS] APPROVALS TAB — full page, available on all plans ── */}
          {!loading && tab === 'approvals' && (
            <MakerChecker
              records={records}
              userRole={profile?.approval_role || 'maker'}
              year={year}
              onStateChange={() => loadAll()}
            />
          )}

          {!loading && !isFullPageTab(tab) && (<>

            {/* ── REPORTS TAB ──────────────────────────────────────────── */}
            {tab === 'reports' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="em-card">
                  <div className="em-ctit">
                    EXPORT REPORTS · FY {year}
                    {planResolved && !corporate && (
                      <span style={{ marginLeft: 6, fontSize: 9, padding: '2px 8px', borderRadius: 3, background: '#f9731614', color: '#f97316', border: '1px solid #f9731633', letterSpacing: '.04em' }}>
                        GHG PROTOCOL ONLY ON GROWTH
                      </span>
                    )}
                  </div>
                  <div className="em-export-grid">
                    {[
                      { type: 'ghg-protocol', label: 'GHG Protocol',   icon: '📊', desc: 'ISO 14064-1 · Dual Scope 2 · YoY · CEA V20.0 Dec 2024', color: '#10b981' },
                      { type: 'brsr',         label: 'SEBI BRSR Core', icon: '🇮🇳', desc: `Section A · B · C (P1–P9) · PPP intensity · ISF Dec 2024${brsrData?.p6 ? ' · P6 READY' : ''}`, color: '#f97316' },
                      { type: 'cdp',          label: 'CDP Climate',    icon: '🌍', desc: 'CDP C6 · Dual Scope 2 · Submit via CDP portal', color: '#3b82f6' },
                      { type: 'tcfd',         label: 'TCFD',           icon: '📋', desc: '4-pillar · Governance · Strategy · Risk · Metrics', color: '#a855f7' },
                    ].map(({ type, label, icon, desc, color }) => {
                      const isLocked = CORPORATE_PDF_TYPES.includes(type) && planResolved && !corporate;
                      return (
                        <button
                          key={type}
                          className="em-export-btn"
                          disabled={!!exportLoading && exportLoading !== type}
                          onClick={() => handlePdfExportClick(type, label)}
                          style={{
                            borderColor: isLocked ? `${color}22` : `${color}33`,
                            background:  exportLoading === type ? `${color}11` : isLocked ? `${color}06` : 'var(--surf)',
                            opacity:     isLocked ? 0.6 : 1,
                            padding: '20px 14px',
                          }}
                        >
                          {isLocked && <span className="em-export-lock-badge">CORPORATE</span>}
                          <div style={{ fontSize: 28, marginBottom: 10 }}>
                            {exportLoading === type ? '⟳' : isLocked ? '🔒' : icon}
                          </div>
                          <div style={{ fontWeight: 700, color: isLocked ? 'var(--mut)' : color, marginBottom: 6, letterSpacing: '.06em', fontSize: 11 }}>{label}</div>
                          <div style={{ fontSize: 10, color: 'var(--mut)', lineHeight: 1.6 }}>
                            {isLocked ? 'Upgrade to Corporate to unlock' : desc}
                          </div>
                          {!isLocked && (
                            <div style={{ marginTop: 12, padding: '5px 0', borderTop: `1px solid ${color}22`, fontSize: 9, color, letterSpacing: '.06em' }}>
                              {exportLoading === type ? 'GENERATING PDF…' : 'CLICK TO EXPORT PDF'}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--mut)', textAlign: 'center', letterSpacing: '.06em', marginTop: 4 }}>
                    Auditor-ready · Dual Scope 2 (location + market) · CEA V20.0 Dec 2024 grid EF 0.727 tCO2/MWh ·
                    {retirements.length} retirement{retirements.length !== 1 ? 's' : ''} wired · {verifier ? 'ISO 14064-3 verified' : 'Verification pending'} · DEFRA 2024 / IPCC AR6
                  </div>
                </div>

                {/* Pre-export status checklist — always visible so users know what to fix */}
                <div className="em-card">
                  <div className="em-ctit">EXPORT READINESS · GHG PROTOCOL</div>
                  <div style={{ fontSize: 11, color: 'var(--mut)', marginBottom: 14 }}>
                    Quick check before you export. Required items block generation; optional items improve report quality.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {getExportChecks('ghg-protocol').map(({ label, detail, ok, required, fixTab }) => (
                      <div key={label} className={`em-check-row ${required ? (ok ? 'em-check-row-req-ok' : 'em-check-row-req-fail') : (ok ? 'em-check-row-opt-ok' : 'em-check-row-opt-warn')}`}
                        style={{ margin: 0 }}>
                        <span style={{ color: ok ? 'var(--grn)' : required ? 'var(--red)' : 'var(--ylw)', fontSize: 13, flexShrink: 0 }}>
                          {ok ? '✓' : required ? '✕' : '⚠'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: ok ? 'var(--txt)' : required ? 'var(--red)' : 'var(--ylw)', fontWeight: required ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                          <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div>
                        </div>
                        {!ok && (
                          <button className="em-btn em-btn-g" style={{ padding: '3px 8px', fontSize: 9, flexShrink: 0 }}
                            onClick={() => { if (fixTab === 'profile') navigate('/team?tab=profile'); else handleTabClick(fixTab); }}>
                            FIX
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Growth upgrade nudge */}
                {planResolved && !corporate && (
                  <div style={{ padding: '24px', borderRadius: 10, border: '1px solid #f9731633', background: '#f9731608', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
                    <div>
                      <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 15, fontWeight: 800, color: 'var(--txt)', marginBottom: 6 }}>BRSR · CDP · TCFD exports require Corporate</div>
                      <div style={{ fontSize: 11, color: 'var(--mut)', lineHeight: 1.8 }}>
                        Your Growth plan includes the GHG Protocol PDF. Upgrade to unlock SEBI BRSR Core, CDP Climate, and TCFD reports — mandatory for listed companies under SEBI LODR.
                      </div>
                    </div>
                    <button onClick={() => navigate('/billing')}
                      style={{ padding: '12px 24px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#f97316,#ea580c)', color: '#fff', fontFamily: 'Space Mono,monospace', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      UPGRADE TO CORPORATE
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
             * LOG TAB
             * [FIX-REFRESH] onRecordAdded now refreshes summary after every
             * log so scope cards, analytics, inventory, category breakdown
             * all update immediately — not just the ledger rows.
             * ───────────────────────────────────────────────────────────── */}
            {tab === 'log' && (
              <EmissionLogHub
                EF={EF}
                year={year}
                onRecordAdded={async (record) => {
                  // 1. Optimistically prepend to the ledger — instant feedback.
                  //    SSE will also fire and dedup by id.
                  setRecords(prev => {
                    if (prev.some(x => x.id === record.id)) return prev;
                    return [normaliseRecord(record), ...prev];
                  });

                  // 2. [FIX-REFRESH] Refresh summary from server — this is what drives:
                  //    • Scope 1 / 2 / 3 hero cards
                  //    • Total footprint card
                  //    • Analytics monthly trend chart
                  //    • Category breakdown chart
                  //    • GHG inventory table totals
                  //    • Net zero progress bar
                  //    • Intensity metrics
                  //    • YoY change badge
                  //    Previously only the ledger rows updated on log — everything
                  //    else was stale until a manual refresh or page reload.
                  apiFetch(`/api/emissions/summary?year=${year}`)
                    .then(sum => { if (sum) setSummary(sum); })
                    .catch(() => {});
                }}
                onBulkAdded={async ({ inserted, duplicates = 0, errSkipped = 0 }) => {
                  // Full reload — bulk changes many rows at once, too many to
                  // patch optimistically. SSE also fires a 'bulk' event with
                  // the toast; loadAll() here is the fallback for when SSE
                  // hasn't connected yet or fires before loadAll completes.
                  await loadAll();
                }}
                onImportError={(msg) => toast(msg, 'error')}
                profile={profile}
              />
            )}

            {/* ── LEDGER TAB ───────────────────────────────────────────── */}
            {tab === 'ledger' && (
  <div className="em-card">
    <GHGLedger
      records={records}
      year={year}
      EF={EF}
      profile={profile}
      onRecordsChanged={() => loadAll()}
      onLineageOpen={(r) => setLineageRecord(r)}
    />
  </div>
)}

            {/* ── ANALYTICS TAB ────────────────────────────────────────── */}
            {tab === 'analytics' && (
  <EmissionAnalytics
    records={records}
    summary={summary}
    prevYearEmissions={prevYearEmissions}
    year={year}
    profile={profile}
    SC={SC}
    CHART_OPTS={CHART_OPTS}
    fmt={fmt}
    onDrilldown={(scope) => { handleTabClick('ledger'); setSfilt(String(scope)); }}
  />
)}

            {/* ── INTENSITY TAB ─────────────────────────────────────────── */}
            {tab === 'intensity' && (
              <div className="em-g2">
                <div className="em-card">
                  <div className="em-ctit">CARBON INTENSITY METRICS</div>
                  {industryBenchmark && revenueIntensity && (
                    <div className="em-benchmark" style={{ borderColor: benchmarkStatus === 'leader' ? '#10b98133' : benchmarkStatus === 'average' ? '#f59e0b33' : '#ef444433' }}>
                      <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 8 }}>INDUSTRY BENCHMARK · {profile.industry}</div>
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

            {/* ── OVERVIEW (ESG) TAB ─────────────────────────────────────── */}
            {tab === 'esg' && !planResolved && <PlanLoadingSkeleton />}

            {tab === 'esg' && planResolved && !corporate && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* ── Empty state ── */}
                {records.length === 0 && !loading && (
                  <div style={{
                    padding: '52px 40px', borderRadius: 'var(--radius)',
                    border: '1px dashed var(--brd2)', background: 'var(--surf)',
                    textAlign: 'center', animation: 'fadeUp .4s ease both',
                  }}>
                    <div style={{ fontSize: 40, marginBottom: 16, opacity: .6 }}>🌱</div>
                    <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, fontWeight: 800, color: 'var(--txt)', marginBottom: 8 }}>
                      No emissions logged yet
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--mut)', marginBottom: 24, maxWidth: 380, margin: '0 auto 24px', lineHeight: 1.8 }}>
                      Start by logging your first emission activity. Your GHG inventory, intensity metrics, framework compliance status, and net zero roadmap will all populate automatically.
                    </div>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button className="em-btn em-btn-p" onClick={() => handleTabClick('log')}>
                        LOG FIRST EMISSION
                      </button>
                      {!profile && (
                        <button className="em-btn em-btn-g" onClick={() => navigate('/team?tab=profile')}>
                          SET UP COMPANY PROFILE
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 20, opacity: .6 }}>
                      Supports Scope 1, 2 & 3 · 60+ activity types · CEA V20.0 · DEFRA 2024 · IPCC AR6
                    </div>
                  </div>
                )}
                {/* Growth users see a limited overview — GHG inventory + upgrade prompt */}
                <div className="em-card">
                  <div className="em-ctit">GHG OVERVIEW · FY {year}</div>
                  {[
                    { label: 'Scope 1 Direct Emissions',                    val: fmt(scope1),    unit: 'tCO2e', color: '#f97316' },
                    { label: 'Scope 2 Location-based (CEA V20.0 0.727)',    val: fmt(scope2Loc), unit: 'tCO2e', color: '#3b82f6' },
                    { label: 'Scope 2 Market-based (REC/PPA/Green Tariff)', val: fmt(scope2Mkt), unit: 'tCO2e', color: '#60a5fa' },
                    { label: 'Scope 3 All 15 Categories',                   val: fmt(scope3),    unit: 'tCO2e', color: '#a855f7' },
                    { label: 'TOTAL GHG EMISSIONS (location-based)',         val: fmt(total),     unit: 'tCO2e', color: 'var(--grn)', bold: true },
                    { label: 'Carbon Credits Retired',                       val: fmt(retirements.reduce((s, r) => s + parseInt(r.amount||0), 0)), unit: 'tCO2e', color: '#10b981' },
                    { label: 'Credits Required to Offset',                  val: String(creditsNeeded), unit: 'credits', color: 'var(--grn)' },
                  ].map(({ label, val, unit, color, bold }) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--brd)44', fontSize: bold ? 12 : 10, fontWeight: bold ? 700 : 400 }}>
                      <span style={{ color: 'var(--mut)' }}>{label}</span>
                      <span style={{ color }}>{val} <span style={{ fontSize: 11, color: 'var(--mut)' }}>{unit}</span></span>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '28px 24px', borderRadius: 10, border: '1px solid #f9731633', background: '#f9731608', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
                  <div>
                    <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 16, fontWeight: 800, color: 'var(--txt)', marginBottom: 6 }}>Upgrade for full ESG compliance</div>
                    <div style={{ fontSize: 11, color: 'var(--mut)', lineHeight: 1.8 }}>
                      Corporate plan unlocks BRSR disclosures, audit trails, PAT scheme, CCTS compliance,
                      SBTi targets, 5-year action plans, supplier portal, and multi-entity consolidation.
                    </div>
                  </div>
                  <button
                    onClick={() => navigate('/billing')}
                    style={{ padding: '12px 28px', borderRadius: 6, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#f97316,#ea580c)', color: '#fff', fontFamily: 'Space Mono,monospace', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', whiteSpace: 'nowrap', flexShrink: 0 }}
                  >
                    UPGRADE TO CORPORATE
                  </button>
                </div>
              </div>
            )}

            {tab === 'esg' && planResolved && corporate && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* ── Empty state ── */}
                {records.length === 0 && !loading && (
                  <div style={{
                    padding: '52px 40px', borderRadius: 'var(--radius)',
                    border: '1px dashed var(--brd2)', background: 'var(--surf)',
                    textAlign: 'center', animation: 'fadeUp .4s ease both',
                  }}>
                    <div style={{ fontSize: 40, marginBottom: 16, opacity: .6 }}>🌱</div>
                    <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, fontWeight: 800, color: 'var(--txt)', marginBottom: 8 }}>
                      No emissions logged yet
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--mut)', marginBottom: 24, maxWidth: 380, margin: '0 auto 24px', lineHeight: 1.8 }}>
                      Start by logging your first emission activity. Your GHG inventory, BRSR disclosures, framework compliance, and net zero roadmap will populate automatically.
                    </div>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button className="em-btn em-btn-p" onClick={() => handleTabClick('log')}>LOG FIRST EMISSION</button>
                      {!profile && <button className="em-btn em-btn-g" onClick={() => navigate('/team?tab=profile')}>SET UP COMPANY PROFILE</button>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 20, opacity: .6 }}>
                      Scope 1, 2 & 3 · BRSR Core · CDP · TCFD · PAT · CCTS · ISO 14064-1
                    </div>
                  </div>
                )}
                <div className="em-card">
                  <div className="em-ctit">FRAMEWORK COMPLIANCE STATUS</div>
                  <div className="em-esg-g">
                    {[
                      { name: 'GHG Protocol',   sub: 'Corporate Standard + Dual S2',       ok: records.length > 0 && scope2Mkt >= 0,                                    status: records.length > 0 ? 'COMPLIANT' : 'PENDING',          nav: null },
                      { name: 'SEBI BRSR Core', sub: 'Section A + B + C (P1–P9)', ok: records.length > 0 && !!brsrData && Object.keys(brsrData).length >= 11, status: !brsrData || Object.keys(brsrData).length === 0 ? (records.length > 0 ? 'NOT STARTED' : 'PENDING') : `${Object.keys(brsrData).length}/11 SECTIONS`, nav: 'brsr-env' },
                      { name: 'CDP',            sub: 'Prep doc submit via portal',           ok: records.length > 0,                                                      status: records.length > 0 ? 'PDF READY' : 'PENDING',          nav: null },
                      { name: 'TCFD',           sub: '4-pillar disclosure',                  ok: records.length > 0,                                                      status: records.length > 0 ? 'PDF READY' : 'PENDING',          nav: null },
                      { name: 'GRI 305',        sub: 'Emissions Standard',                   ok: records.length > 0,                                                      status: records.length > 0 ? 'COMPLIANT' : 'PENDING',          nav: null },
                      { name: 'ISO 14064-3',    sub: 'Third-party verification',             ok: !!verifier,                                                              status: verifier ? 'VERIFIED' : 'PENDING',                     nav: null },
                      { name: 'SBTi',           sub: 'Science Based Targets',                ok: !!profile?.net_zero_year && !!profile?.net_zero_target_co2e,             status: profile?.net_zero_year && profile?.net_zero_target_co2e ? 'TARGET SET' : 'SET UP TARGETS', nav: 'sbti' },
                      { name: 'PAT Scheme',     sub: 'BEE India Energy Cycle IV',            ok: !!patData,                                                               status: patData ? 'CONFIGURED' : 'SETUP REQUIRED',             nav: 'pat-scheme' },
                      { name: 'CCTS 2025',      sub: '9 sectors BEE/CERC/GRID-India',        ok: !!cctsData,                                                              status: cctsData ? 'CONFIGURED' : 'SETUP REQUIRED',            nav: 'ccts' },
                      { name: 'ISO 14064-1',    sub: 'GHG Inventories',                      ok: records.length > 0,                                                      status: records.length > 0 ? 'COMPLIANT' : 'PENDING',          nav: null },
                    ].map(({ name, sub, ok, status, nav }) => (
                      <div key={name} className="em-fw"
                        style={{ cursor: nav ? 'pointer' : undefined }}
                        onClick={nav ? () => handleTabClick(nav) : undefined}
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
                    <div className="em-ctit">ANNUAL GHG INVENTORY · FY {year}</div>
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

                  {/* ── [FIX-NZ-FALLBACK] Net Zero Roadmap ── */}
                  <div className="em-card">
                    <div className="em-ctit">NET ZERO ROADMAP</div>

                    {/* [FIX-NZ-FALLBACK] No baseline = show clear message instead of 4 red 0% bars */}
                    {!prevYearTotal && (
                      <div className="em-alert em-aly" style={{ marginBottom: 16, fontSize: 11 }}>
                        <span>⚠</span>
                        <span>No prior-year baseline — add FY {year - 1} records to see reduction progress against your roadmap milestones.</span>
                      </div>
                    )}

                    {[
                      { label: `2030 — 50% reduction (India NDC)`, reductionPct: 50  },
                      { label: `2035 — SBTi 1.5°C aligned`,        reductionPct: 65  },
                      { label: `2040 — 80% reduction`,              reductionPct: 80  },
                      { label: `${profile?.net_zero_year || 2050} — Net Zero`, reductionPct: 100 },
                    ].map(({ label, reductionPct }) => {
                      if (!prevYearTotal) {
                        // [FIX-NZ-FALLBACK] No baseline: show target absolute value only, no misleading bar
                        const targetAbs = total > 0 ? total * (1 - reductionPct / 100) : null;
                        return (
                          <div key={label} className="em-irow">
                            <div className="em-ihr">
                              <span style={{ color: 'var(--mut)', fontSize: 11 }}>{label}</span>
                              <span style={{ color: 'var(--mut)', fontSize: 11 }}>
                                {targetAbs !== null ? `Target: ${fmt(targetAbs)} t` : '—'}
                              </span>
                            </div>
                            <div className="em-itrack">
                              <div className="em-ifill" style={{ width: '0%', background: 'var(--brd2)' }}/>
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 3 }}>Add prior-year data to track progress</div>
                          </div>
                        );
                      }

                      const baseline    = prevYearTotal;
                      const targetAbs   = baseline * (1 - reductionPct / 100);
                      const gap         = Math.max(0, total - targetAbs);
                      const progressPct = Math.max(0, Math.min(100,
                        ((baseline - total) / Math.max(baseline - targetAbs, 0.001)) * 100
                      ));
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
                      <button className="em-btn em-btn-g em-btn-sm" onClick={() => handleTabClick('sbti')} style={{ width: '100%' }}>
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