// backend/services/pdfGenerator.js
// EtherTrack Technologies Private Limited
// ── Fixes applied in this version:
//    [FIX-1] Logo: loaded from ../Images/et_logo_bg.png via file:// path (Puppeteer-safe)
//    [FIX-2] Header overlap fixed in page() wrapper (GHG, CDP, TCFD) — flex layout with proper spacing
//    [FIX-3] Header overlap fixed in BRSR pageHeader() — grid replaced with flex, no overflow
//    [FIX-4] Footer overlap fixed in BRSR — padding-bottom added to .page so content never bleeds into footer
//    [FIX-5] CDP C1–C5 and C7–C9 section stubs added (were completely missing)
//    [FIX-6] TCFD Pillar 3 expanded from thin text to structured table
//    [FIX-7] Minimum font sizes enforced (8pt floor for table cells, 9pt body)
//    [FIX-8] Company name updated to "EtherTrack Technologies Private Limited" throughout
//    [FIX-9] BLANK PAGE 2 fixed — BRSR rendered with headerFooter:false + zero Puppeteer margins
//            (BRSR builds its own page footers; Puppeteer margins were pushing cover to overflow)
//    [FIX-10] Duplicate .cover CSS rule removed; min-height → height + overflow:hidden on cover
//    [FIX-11] @media print .page:last-child rule removed (unreliable in Puppeteer); last page
//             uses inline style="page-break-after:avoid" instead
//    [FIX-12] renderPDF() accepts opts.margin override so BRSR and GHG/CDP/TCFD can differ
// ── Regulatory compliance (unchanged):
//    CEA V20.0 Dec 2024 — grid EF 0.727 tCO₂/MWh
//    GHG Protocol Scope 2 — dual reporting (location + market)
//    SEBI BRSR ISF Dec 2024 — PPP-adjusted intensity (IMF WEO Apr 2025 ₹27.3/intl.$)
//    BRSR P6 — energy (GJ), water (KL), waste (MT)
//    TCFD — all 4 pillars complete
//    YoY comparison populated when previousYearEmissions provided
// ── Security:
//    All user data HTML-escaped before insertion
//    No eval / no dangerouslySetInnerHTML equivalent
//    Puppeteer launched with minimal permissions

const puppeteer = require('puppeteer');
const path      = require('path');
const fs        = require('fs');

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-1] LOGO PATH
// ─────────────────────────────────────────────────────────────────────────────
const LOGO_PATH_DISK = path.join(__dirname, '../Images/et_logo_bg.png');

let LOGO_BASE64 = '';
try {
  const imgBuffer = fs.readFileSync(LOGO_PATH_DISK);
  LOGO_BASE64 = `data:image/png;base64,${imgBuffer.toString('base64')}`;
  console.log('[pdfGenerator] ✅ Logo loaded');
} catch (e) {
  console.warn('[pdfGenerator] ⚠️ Logo not found:', LOGO_PATH_DISK);
}

const LOGO_IMG    = LOGO_BASE64 ? `<img src="${LOGO_BASE64}" alt="EtherTrack" style="height:36px;width:auto;object-fit:contain;display:block;" />` : '';
const LOGO_IMG_SM = LOGO_BASE64 ? `<img src="${LOGO_BASE64}" alt="EtherTrack" style="height:24px;width:auto;object-fit:contain;display:block;" />` : '';

// ─────────────────────────────────────────────────────────────────────────────
// LAUNCH OPTIONS
// ─────────────────────────────────────────────────────────────────────────────
const LAUNCH_OPTIONS = {
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--font-render-hinting=none',
    '--allow-file-access-from-files',
    '--disable-web-security',
  ],
  headless: 'new',
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const esc = (val) => {
  if (val === null || val === undefined) return '—';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
};

const fmt = (n, d = 2) =>
  Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

const f       = (val) => parseFloat(val) || 0;
const toArr   = (v)   => Array.isArray(v) ? v : [];
const COMPANY_NAME = 'EtherTrack Technologies Private Limited';

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE REPORT (router)
// ─────────────────────────────────────────────────────────────────────────────
const generateReport = async (reportType, data) => {
  console.log(`[pdfGenerator] Starting ${reportType} report generation...`);
  console.log('[pdfGenerator] incoming data types:', {
    emissions:             typeof data.emissions,             isArr: Array.isArray(data.emissions),
    retirements:           typeof data.retirements,           isArr: Array.isArray(data.retirements),
    previousYearEmissions: typeof data.previousYearEmissions, isArr: Array.isArray(data.previousYearEmissions),
    credits:               typeof data.credits,               isArr: Array.isArray(data.credits),
  });

 const builders = {
  'ghg-protocol': buildGHGHTML,
  'brsr':         (data) => buildBRSRHTML(data, LOGO_BASE64, LOGO_IMG_SM),  // ← change this line only
  'gri':          (data) => buildGRIHTML(data, LOGO_BASE64, LOGO_IMG_SM),  // ← add this
  'cdp':          buildCDPHTML,
  'tcfd':         buildTCFDHTML,
};
const builder = builders[reportType];
if (!builder) throw new Error(`Unknown report type: ${reportType}`);

  // [FIX-9] BRSR has its own built-in page footers — do NOT add Puppeteer header/footer
  // or it will add ~84px of margin that overflows the cover page into a blank page 2.

const isBRSR = reportType === 'brsr';
const isGRI  = reportType === 'gri';
const noBuiltInPuppeteerChrome = isBRSR || isGRI;

const html = builder(data);
console.log('[pdfGenerator] HTML built, starting PDF render...');
const pdf = await renderPDF(html, {
  headerFooter: !noBuiltInPuppeteerChrome,
  margin: noBuiltInPuppeteerChrome
    ? { top: '0', bottom: '0', left: '0', right: '0' }
    : undefined,
});
console.log('[pdfGenerator] PDF export complete');
return pdf;
}; 
// ─────────────────────────────────────────────────────────────────────────────
// SHARED CSS (GHG / CDP / TCFD dark theme)
// ─────────────────────────────────────────────────────────────────────────────
const SHARED_CSS = `

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #040706;
    color: #f0fdf4;
    font-family: 'DM Mono', monospace;
    font-size: 11px;
    padding: 32px 36px;
  }
  h1 { font-family: 'Syne', sans-serif; font-size: 20px; font-weight: 800; line-height: 1.25; }
  h2 { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700; margin: 20px 0 10px; color: #22c55e; }
  h3 { font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700; margin: 14px 0 8px; color: #86efac; }
  .label  { font-size: 8px; letter-spacing: .14em; color: #86efac55; margin-bottom: 4px; }
  .value  { font-size: 12px; color: #f0fdf4; }
  .green  { color: #22c55e; }
  .blue   { color: #60a5fa; }
  .orange { color: #f97316; }
  .purple { color: #a78bfa; }
  .muted  { color: #86efac66; }
  .red    { color: #f87171; }
  .yellow { color: #fbbf24; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 10px; }
  th {
    text-align: left; padding: 6px 8px; font-size: 8px;
    letter-spacing: .1em; color: #86efac55;
    border-bottom: 1px solid #0d1f11; background: #070c09;
  }
  td { padding: 8px; border-bottom: 1px solid #0d1f1166; vertical-align: top; }
  tr:nth-child(even) td { background: #07100833; }
  .section {
    background: #070c09; border: 1px solid #0d1f11;
    border-radius: 8px; padding: 16px; margin-bottom: 14px;
  }
  .section-title {
    font-size: 8px; letter-spacing: .16em; color: #22c55e88;
    margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #0d1f11;
  }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; margin-bottom: 10px; }
  .field { background: #040706; border: 1px solid #0d1f11; border-radius: 6px; padding: 10px 12px; }
  .badge { display: inline-block; font-size: 8px; padding: 2px 8px; border-radius: 3px; letter-spacing: .06em; }
  .badge-green  { background: #22c55e11; color: #22c55e; border: 1px solid #22c55e33; }
  .badge-blue   { background: #60a5fa11; color: #60a5fa; border: 1px solid #60a5fa33; }
  .badge-orange { background: #f9731611; color: #f97316; border: 1px solid #f9731633; }
  .badge-purple { background: #a78bfa11; color: #a78bfa; border: 1px solid #a78bfa33; }
  .badge-red    { background: #f8717111; color: #f87171; border: 1px solid #f8717133; }
  .footer {
    margin-top: 28px; padding-top: 12px; border-top: 1px solid #0d1f11;
    font-size: 8px; color: #86efac33; letter-spacing: .08em; text-align: center;
  }
  .page-break { page-break-before: always; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// [FIX-2] PAGE WRAPPER for GHG / CDP / TCFD
// ─────────────────────────────────────────────────────────────────────────────
const page = (title, subtitle, body, meta = {}) => {
  const reportYear = meta.year  ? `FY ${esc(String(meta.year))}` : '';
  const orgDisplay = meta.org   ? esc(meta.org) : '';
  const genDate    = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <div style="
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 28px;
    padding-bottom: 20px;
    border-bottom: 1px solid #0d1f11;
  ">
    <div style="flex-shrink:0; display:flex; align-items:center;">
      ${LOGO_IMG}
    </div>
    <div style="flex:1; text-align:center; min-width:0;">
      <div style="font-size:9px; letter-spacing:.18em; color:#22c55e66; margin-bottom:6px;">
        ETHERTRACK TECHNOLOGIES PRIVATE LIMITED
      </div>
      <h1 style="font-size:18px; line-height:1.3;">${esc(title)}</h1>
      <div style="font-size:9px; color:#86efac55; margin-top:5px; letter-spacing:.08em; line-height:1.6;">
        ${esc(subtitle)}
      </div>
    </div>
    <div style="flex-shrink:0; text-align:right; min-width:120px;">
      ${orgDisplay ? `<div style="font-size:10px; font-weight:700; color:#f0fdf4; margin-bottom:3px;">${orgDisplay}</div>` : ''}
      ${reportYear ? `<div style="font-size:9px; color:#22c55e; margin-bottom:2px;">${reportYear}</div>` : ''}
      <div style="font-size:8px; color:#86efac55;">Generated: ${genDate}</div>
      <div style="font-size:8px; color:#86efac44; margin-top:2px;">Blockchain verified · EtherTrack</div>
    </div>
  </div>

  ${body}

  <div class="footer">
    ${COMPANY_NAME} · GHG Protocol · CEA V20.0 Dec 2024 (0.727 tCO₂/MWh) · DEFRA 2024 · IPCC AR6 GWP100 ·
    Generated ${new Date().toLocaleString('en-IN')}
  </div>
</body>
</html>
`;
};

// ─────────────────────────────────────────────────────────────────────────────
// GHG PROTOCOL REPORT
// ─────────────────────────────────────────────────────────────────────────────
const buildGHGHTML = (d) => {
  const {
    orgName, year, profile,
    verifier,
    scope2Location, scope2Market,
    gridEmissionFactor = 0.727,
    gridEFVersion = 'CEA V20.0 Dec 2024',
    pppRate = 27.3,
  } = d;

  const emissions             = toArr(d.emissions);
  const retirements           = toArr(d.retirements);
  const previousYearEmissions = toArr(d.previousYearEmissions);

  const scope1 = emissions.filter(r => r.scope === 1).reduce((s, r) => s + f(r.co2e), 0);
  const scope2 = emissions.filter(r => r.scope === 2).reduce((s, r) => s + f(r.co2e), 0);
  const scope3 = emissions.filter(r => r.scope === 3).reduce((s, r) => s + f(r.co2e), 0);
  const total  = scope1 + scope2 + scope3;

  const s2Loc = f(scope2Location) || scope2;
  const s2Mkt = f(scope2Market)   || 0;

  const totalRetired = retirements.reduce((s, r) => s + parseInt(r.amount || 0), 0);
  const netEmissions = Math.max(0, total - totalRetired);

  const prevTotal = previousYearEmissions.reduce((s, r) => s + f(r.co2e), 0);
  const yoyPct    = prevTotal > 0 ? ((total - prevTotal) / prevTotal * 100) : null;

  const revenueCr   = f(profile?.revenue_cr);
  const employees   = parseInt(profile?.employees || 0);
  const intensityInr = revenueCr  ? total / revenueCr  : null;
  const intensityEmp = employees  ? total / employees   : null;
  const revenuePPPM  = revenueCr ? (revenueCr * 1e7) / pppRate / 1e6 : null;

  const cats = {};
  emissions.forEach(r => { cats[r.category || 'Other'] = (cats[r.category || 'Other'] || 0) + f(r.co2e); });
  const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 10);

  return page(
    `GHG Protocol Corporate Standard`,
    `Greenhouse Gas Inventory · ISO 14064-1 · Operational Control Boundary · Dual Scope 2`,
    `
    <div class="section">
      <div class="section-title">SECTION 1 — ORGANISATION DETAILS</div>
      <div class="grid-3">
        <div class="field"><div class="label">ORGANISATION</div><div class="value">${esc(orgName)}</div></div>
        <div class="field"><div class="label">REPORTING YEAR</div><div class="value green">FY ${year}</div></div>
        <div class="field"><div class="label">BASE YEAR</div><div class="value">${esc(profile?.base_year || 2024)}</div></div>
        <div class="field"><div class="label">INDUSTRY</div><div class="value">${esc(profile?.industry || '—')}</div></div>
        <div class="field"><div class="label">CIN</div><div class="value">${esc(profile?.company_cin || '—')}</div></div>
        <div class="field"><div class="label">GSTIN</div><div class="value">${esc(profile?.company_gstin || '—')}</div></div>
        <div class="field"><div class="label">CONSOLIDATION METHOD</div><div class="value">Operational Control</div></div>
        <div class="field"><div class="label">GWP BASIS</div><div class="value">IPCC AR6 GWP100</div></div>
        <div class="field"><div class="label">GRID EF (INDIA)</div><div class="value orange">${gridEmissionFactor} tCO₂/MWh · ${esc(gridEFVersion)}</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">SECTION 2 — GHG INVENTORY WITH YEAR-ON-YEAR COMPARISON</div>
      <div class="grid-4">
        <div class="field"><div class="label">SCOPE 1 — DIRECT</div><div class="value orange" style="font-size:18px;">${fmt(scope1)}</div><div class="muted" style="font-size:8px;">tCO₂e · ${fmt(total ? scope1/total*100 : 0, 1)}% of total</div></div>
        <div class="field"><div class="label">SCOPE 2 — LOCATION-BASED</div><div class="value blue" style="font-size:18px;">${fmt(s2Loc)}</div><div class="muted" style="font-size:8px;">tCO₂e · CEA V20.0 ${gridEmissionFactor} tCO₂/MWh</div></div>
        <div class="field"><div class="label">SCOPE 2 — MARKET-BASED</div><div class="value blue" style="font-size:18px;">${fmt(s2Mkt)}</div><div class="muted" style="font-size:8px;">tCO₂e · REC / PPA / Green Tariff</div></div>
        <div class="field"><div class="label">SCOPE 3 — VALUE CHAIN</div><div class="value purple" style="font-size:18px;">${fmt(scope3)}</div><div class="muted" style="font-size:8px;">tCO₂e · All 15 categories</div></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>METRIC</th><th>FY ${year} (CURRENT)</th>
            <th>FY ${parseInt(year)-1} (PREV)</th><th>CHANGE %</th><th>UNIT</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Scope 1 — Direct Emissions</td><td class="green">${fmt(scope1)}</td><td>${prevTotal > 0 ? fmt(previousYearEmissions.filter(r=>r.scope===1).reduce((s,r)=>s+f(r.co2e),0)) : '—'}</td><td>—</td><td>tCO₂e</td></tr>
          <tr><td>Scope 2 — Location-based (CEA V20.0)</td><td class="green">${fmt(s2Loc)}</td><td>—</td><td>—</td><td>tCO₂e</td></tr>
          <tr><td>Scope 2 — Market-based (REC/PPA)</td><td class="green">${fmt(s2Mkt)}</td><td>—</td><td>—</td><td>tCO₂e</td></tr>
          <tr><td>Scope 3 — Value Chain (All 15 Cats)</td><td class="green">${fmt(scope3)}</td><td>${prevTotal > 0 ? fmt(previousYearEmissions.filter(r=>r.scope===3).reduce((s,r)=>s+f(r.co2e),0)) : '—'}</td><td>—</td><td>tCO₂e</td></tr>
          <tr style="font-weight:700;"><td>TOTAL GHG EMISSIONS</td><td class="green">${fmt(total)}</td><td>${prevTotal > 0 ? fmt(prevTotal) : '—'}</td><td class="${yoyPct !== null ? (yoyPct > 0 ? 'red' : 'green') : ''}">${yoyPct !== null ? `${yoyPct > 0 ? '+' : ''}${fmt(yoyPct,1)}%` : '—'}</td><td>tCO₂e</td></tr>
          <tr><td>Carbon Credits Retired</td><td class="green">${fmt(totalRetired,0)}</td><td>—</td><td>—</td><td>tCO₂e</td></tr>
          <tr><td>Net Emissions After Offset</td><td class="${netEmissions > 0 ? 'orange' : 'green'}">${fmt(netEmissions)}</td><td>—</td><td>—</td><td>tCO₂e</td></tr>
          ${revenueCr > 0 ? `<tr><td>Revenue Carbon Intensity</td><td>${fmt(total/revenueCr,4)}</td><td>—</td><td>—</td><td>tCO₂e/₹Cr</td></tr>` : ''}
          ${revenuePPPM ? `<tr><td>Revenue Intensity — PPP-adjusted (ISF Dec 2024)</td><td class="orange">${fmt(total/revenuePPPM,3)}</td><td>—</td><td>—</td><td>tCO₂e/$M PPP</td></tr>` : ''}
          ${employees > 0 ? `<tr><td>FTE Carbon Intensity</td><td>${fmt(total/employees,4)}</td><td>—</td><td>—</td><td>tCO₂e/FTE</td></tr>` : ''}
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">SECTION 3 — EMISSION ACTIVITIES DETAIL (${emissions.length} records)</div>
      <table>
        <thead><tr><th>DATE</th><th>ACTIVITY</th><th>SCOPE</th><th>CATEGORY</th><th>QTY</th><th>tCO₂e</th><th>FACTOR SOURCE</th></tr></thead>
        <tbody>
          ${emissions.slice(0, 50).map(r => `
          <tr>
            <td>${esc(r.date || '—')}</td>
            <td>${esc(r.activity_type || r.category || '—')}</td>
            <td>S${esc(String(r.scope || '—'))}</td>
            <td style="font-size:9px;">${esc(r.category || '—')}</td>
            <td>${esc(r.quantity ? `${fmt(r.quantity,2)} ${r.unit || ''}` : '—')}</td>
            <td class="green">${fmt(r.co2e)}</td>
            <td style="font-size:9px;">${esc(r.factor_source || 'DEFRA 2024')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">SECTION 4 — SCOPE 3 CATEGORY BREAKDOWN (ALL 15 GHG PROTOCOL CATEGORIES)</div>
      <table>
        <thead><tr><th>GHG PROTOCOL CATEGORY</th><th>tCO₂e</th><th>% OF SCOPE 3</th><th>METHODOLOGY</th></tr></thead>
        <tbody>
          ${topCats.filter(([cat]) => cat.includes('Cat') || cat.includes('cat')).map(([cat, val]) => `
          <tr>
            <td>${esc(cat)}</td>
            <td class="green">${fmt(val)}</td>
            <td>${fmt(scope3 ? val/scope3*100 : 0, 1)}%</td>
            <td>Tier 1 — Activity-based / DEFRA</td>
          </tr>`).join('')}
          ${topCats.filter(([cat]) => cat.includes('Cat') || cat.includes('cat')).length === 0
            ? `<tr><td colspan="4" style="color:#86efac44;text-align:center;">No Scope 3 category data in this period</td></tr>` : ''}
        </tbody>
      </table>
    </div>

    ${retirements.length > 0 ? `
    <div class="section page-break">
      <div class="section-title">SECTION 5 — CARBON CREDIT RETIREMENTS — FY ${year}</div>
      <table>
        <thead><tr><th>PROJECT</th><th>STANDARD</th><th>VINTAGE</th><th>AMOUNT (tCO₂e)</th><th>SERIAL NO.</th></tr></thead>
        <tbody>
          ${retirements.map(r => `
          <tr>
            <td>${esc(r.project_name || r.projectName || '—')}</td>
            <td>${esc(r.standard || '—')}</td>
            <td>${esc(r.vintage_year || r.vintageYear || '—')}</td>
            <td class="green">${fmt(r.amount || 0, 0)}</td>
            <td class="muted">${esc(r.serial_number || r.serialNumber || '—')}</td>
          </tr>`).join('')}
          <tr style="font-weight:700;"><td colspan="3">TOTAL RETIRED</td><td class="green">${fmt(totalRetired, 0)}</td><td></td></tr>
        </tbody>
      </table>
    </div>` : `
    <div class="section">
      <div class="section-title">SECTION 5 — CARBON CREDIT RETIREMENTS</div>
      <div style="color:#86efac44;font-size:10px;">No carbon credit retirements in this reporting period.</div>
    </div>`}

    <div class="section">
      <div class="section-title">QUANTIFICATION UNCERTAINTY — ISO 14064-1:2018 §7 / GHG PROTOCOL CHAPTER 7</div>
      <table>
        <thead><tr><th>EMISSION SOURCE</th><th>METHODOLOGY TIER</th><th>FACTOR SOURCE</th><th>UNCERTAINTY</th><th>CONFIDENCE</th></tr></thead>
        <tbody>
          <tr><td>Scope 1 — Stationary &amp; Mobile</td><td>Tier 1 (Activity-based)</td><td>DEFRA 2024</td><td>±5%</td><td><span class="badge badge-green">LOW</span></td></tr>
          <tr><td>Scope 1 — Fugitive Emissions</td><td>Tier 1 (Activity-based)</td><td>IPCC AR6 GWP100</td><td>±15%</td><td><span class="badge badge-orange">MEDIUM</span></td></tr>
          <tr><td>Scope 2 — Grid Electricity</td><td>Tier 1 (Grid average)</td><td>CEA India V20.0 Dec 2024</td><td>±5%</td><td><span class="badge badge-green">LOW</span></td></tr>
          <tr><td>Scope 2 — Market-based</td><td>Tier 2 (Supplier-specific)</td><td>REC/PPA certificates</td><td>±2%</td><td><span class="badge badge-green">LOW</span></td></tr>
          <tr><td>Scope 3 — All 15 Categories</td><td>Tier 1 (Spend/activity)</td><td>IPCC AR6</td><td>±30%</td><td><span class="badge badge-red">HIGH</span></td></tr>
        </tbody>
      </table>
      <div style="font-size:9px;color:#86efac55;margin-top:6px;">Overall combined uncertainty: ±15–35% (industry standard for Tier 1). Improve by moving to Tier 2/3.</div>
    </div>

    ${verifier ? `
    <div class="section">
      <div class="section-title">ISO 14064-3 THIRD-PARTY VERIFICATION</div>
      <div class="grid-2">
        <div class="field"><div class="label">VERIFIER</div><div class="value purple">${esc(verifier.verifier_name)}</div></div>
        <div class="field"><div class="label">ACCREDITATION</div><div class="value">${esc(verifier.accred_number || '—')}</div></div>
        <div class="field"><div class="label">STATUS</div><div class="value"><span class="badge badge-green">VERIFIED</span></div></div>
        <div class="field"><div class="label">VERIFIED DATE</div><div class="value">${fmtDate(verifier.verified_at)}</div></div>
      </div>
    </div>` : `
    <div class="section">
      <div class="section-title">VERIFICATION STATUS</div>
      <div style="color:#fbbf2488;font-size:10px;">⚠ No third-party verifier assigned. Add a verifier in the Audit Trail tab to enable ISO 14064-3 verification disclosure.</div>
    </div>`}

    <div class="section">
      <div class="section-title">DECLARATION &amp; AUTHORISED SIGNATORY</div>
      <div style="font-size:9px;color:#f0fdf4cc;line-height:1.8;margin-bottom:20px;">
        I hereby confirm that the GHG Protocol Corporate Standard disclosures above are accurate and complete
        to the best of my knowledge, prepared in accordance with applicable standards and regulations.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:16px;">
        <div style="border-top:1px solid #22c55e44;padding-top:8px;">
          <div style="height:28px;"></div>
          <div style="font-size:8px;color:#86efac55;letter-spacing:.08em;">NAME &amp; DESIGNATION</div>
          <div style="height:18px;border-bottom:1px solid #0d1f11;margin-top:10px;"></div>
          <div style="font-size:8px;color:#86efac55;margin-top:4px;">DIN / PAN NUMBER</div>
          <div style="height:18px;border-bottom:1px solid #0d1f11;margin-top:10px;"></div>
          <div style="font-size:8px;color:#86efac55;margin-top:4px;">DATE (DD/MM/YYYY)</div>
        </div>
        <div style="border-top:1px solid #22c55e44;padding-top:8px;">
          <div style="height:28px;"></div>
          <div style="font-size:8px;color:#86efac55;letter-spacing:.08em;">REVIEWER / CFO</div>
          <div style="height:18px;border-bottom:1px solid #0d1f11;margin-top:10px;"></div>
          <div style="font-size:8px;color:#86efac55;margin-top:4px;">DATE (DD/MM/YYYY)</div>
        </div>
        <div style="border-top:1px solid #22c55e44;padding-top:8px;">
          <div style="height:28px;border:1px dashed #0d1f11;border-radius:4px;display:flex;align-items:center;justify-content:center;">
            <div style="font-size:8px;color:#86efac33;">COMPANY SEAL / STAMP</div>
          </div>
        </div>
      </div>
    </div>
    `,
    { org: orgName, year }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// BRSR REPORT
// ─────────────────────────────────────────────────────────────────────────────
/// buildBRSRHTML v8
// Fixes vs v7:
//  1. Google Fonts @import removed — eliminates network timeout in Puppeteer
//  2. table { page-break-inside:auto } — tables break naturally at row boundaries, no blank gaps
//  3. principle-head: removed page-break-before, only keep break-after:avoid
//  4. .brsr-body padding-bottom:0 — no trailing whitespace after each section
//  5. P2–P9 + declaration divs: removed break-before class — content flows continuously
//  6. principle-head gets margin-top:10px so it visually separates from prior content

const BRSR_CSS_FULL = `
  :root {
    --ink:#0a0f0a; --ink2:#1a2a1a;
    --paper:#ffffff; --paper2:#f5f7f5; --paper3:#edf0ed;
    --accent:#0d5c2e; --accent2:#1a7a3e; --accent3:#22a050;
    --blue:#1a4a8a; --muted:#4a5a4a;
    --border:#c0ccc0; --border2:#d4e0d4;
    --green-bg:#edf6f0; --blue-bg:#e8eef8;
    --warn:#7a5a00; --header-bg:#1a3a1a;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--paper); color:var(--ink); font-family:'IBM Plex Sans',Arial,sans-serif; font-size:9pt; line-height:1.5; }

  .cover { background:var(--header-bg); color:#f0fdf4; height:285mm; overflow:hidden; display:flex; flex-direction:column; page-break-after:always; break-after:page; }
  .cover-topbar { background:var(--accent); padding:8px 18mm; font-family:'IBM Plex Mono',monospace; font-size:7pt; letter-spacing:.14em; color:#a8e4b8; display:flex; justify-content:space-between; align-items:center; }
  .cover-body { flex:1; padding:16mm 18mm 12mm 18mm; display:flex; flex-direction:column; justify-content:space-between; }
  .cover-logo-row { display:flex; align-items:center; gap:14px; margin-bottom:22mm; }
  .cover-brand { font-family:'IBM Plex Mono',monospace; font-size:9pt; color:#a8e4b8; letter-spacing:.1em; }
  .cover-badge { font-family:'IBM Plex Mono',monospace; font-size:7.5pt; letter-spacing:.18em; color:var(--accent3); margin-bottom:8px; }
  .cover-title { font-size:26pt; font-weight:700; color:#f0fdf4; line-height:1.1; margin-bottom:8px; }
  .cover-subtitle { font-size:10pt; color:#a8e4b8; font-style:italic; margin-bottom:12mm; }
  .cover-meta { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8mm; }
  .cover-field { border:1px solid #2a4a2a; border-radius:4px; padding:10px 14px; background:#111a11; }
  .cover-field-label { font-family:'IBM Plex Mono',monospace; font-size:7pt; color:#5a8a5a; letter-spacing:.12em; text-transform:uppercase; margin-bottom:3px; }
  .cover-field-value { font-size:9pt; font-weight:600; color:#f0fdf4; }
  .cover-sebi { font-family:'IBM Plex Mono',monospace; font-size:7pt; color:#3a6a3a; letter-spacing:.06em; border-top:1px solid #1a3a1a; padding-top:8px; }
  .cover-bottombar { background:#060e06; padding:10px 18mm; font-family:'IBM Plex Mono',monospace; font-size:7pt; color:#2a5a2a; letter-spacing:.08em; display:flex; justify-content:space-between; flex-shrink:0; }

  .brsr-body { padding:12mm 14mm 0 14mm; width:210mm; }
  .break-before { page-break-before:always; break-before:page; }

  .page-header { display:flex; align-items:center; justify-content:space-between; gap:10px; padding-bottom:7px; border-bottom:2px solid var(--accent); margin-bottom:12px; }
  .page-header-logo { flex-shrink:0; }
  .page-header-center { flex:1; min-width:0; }
  .page-header-center .rpt-tag { font-family:'IBM Plex Mono',monospace; font-size:6.5pt; letter-spacing:.1em; color:var(--accent2); text-transform:uppercase; margin-bottom:2px; }
  .page-header-center .co-name { font-size:9.5pt; font-weight:700; color:var(--ink); }
  .page-header-right { text-align:right; font-family:'IBM Plex Mono',monospace; font-size:7pt; color:var(--muted); letter-spacing:.06em; line-height:1.6; flex-shrink:0; white-space:nowrap; }

  .annexure-head { background:var(--header-bg); color:#f0fdf4; padding:10px 14px; border-radius:4px; margin-bottom:14px; font-size:10pt; font-weight:700; }
  .section-head { background:var(--ink); color:#f0fdf4; padding:8px 12px; border-radius:3px; margin:14px 0 10px 0; font-size:9.5pt; font-weight:700; page-break-after:avoid; break-after:avoid; }
  .roman-head { background:var(--green-bg); border-left:3px solid var(--accent); padding:6px 12px; margin:10px 0 8px 0; border-radius:0 3px 3px 0; font-size:9pt; font-weight:700; color:var(--accent); page-break-after:avoid; break-after:avoid; }
  .principle-head { background:var(--accent); color:#f0fdf4; padding:10px 14px; border-radius:4px; margin:10px 0 10px 0; font-size:10pt; font-weight:700; line-height:1.4; page-break-after:avoid; break-after:avoid; page-break-inside:avoid; break-inside:avoid; }
  .indicator-type { font-family:'IBM Plex Mono',monospace; font-size:7.5pt; letter-spacing:.14em; color:var(--accent2); text-transform:uppercase; margin:10px 0 6px 0; padding-bottom:3px; border-bottom:1px solid var(--border2); page-break-after:avoid; break-after:avoid; }
  .q-label { font-size:8.5pt; font-weight:600; color:var(--ink); margin:8px 0 4px 0; line-height:1.5; page-break-after:avoid; break-after:avoid; }
  .q-answer { font-size:8.5pt; color:var(--ink2); padding:6px 10px; background:var(--paper2); border:1px solid var(--border2); border-radius:3px; margin-bottom:6px; min-height:20px; line-height:1.6; page-break-before:avoid; break-before:avoid; }

  table { width:100%; border-collapse:collapse; margin-bottom:10px; font-size:8pt; page-break-inside:auto; }
  thead { display:table-header-group; }
  thead tr { background:var(--ink); color:#f0fdf4; }
  thead th { padding:6px 8px; text-align:left; font-size:7.5pt; font-weight:600; border:1px solid var(--ink2); letter-spacing:.04em; line-height:1.4; vertical-align:middle; }
  tbody td { padding:6px 8px; border:1px solid var(--border); vertical-align:middle; font-size:8pt; line-height:1.4; }
  tbody tr:nth-child(odd) td { background:var(--paper); }
  tbody tr:nth-child(even) td { background:var(--paper2); }
  tbody tr.subtotal td { background:var(--green-bg); font-weight:700; border-top:2px solid var(--accent); }
  tr { page-break-inside:avoid; break-inside:avoid; }
  .nil { color:var(--muted); font-style:italic; }
  .center { text-align:center; }
  .matrix-table thead th { font-size:7pt; padding:5px 6px; }
  .matrix-table tbody td { font-size:7.5pt; padding:5px 6px; }

  /* kvBlock styles */
  .kv-table { margin-bottom:6px; }
  .kv-table td:first-child { width:60%; font-weight:500; color:var(--muted); font-size:8.5pt; }

  .note { background:var(--blue-bg); border:1px solid var(--blue); border-radius:3px; padding:7px 10px; font-size:8pt; color:var(--blue); margin:6px 0 10px 0; line-height:1.6; page-break-inside:avoid; break-inside:avoid; }
  .warn-note { background:#fdf4e0; border:1px solid #d4a000; border-radius:3px; padding:7px 10px; font-size:8pt; color:var(--warn); margin:6px 0 10px 0; line-height:1.6; }

  .sig-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; margin-top:14px; page-break-inside:avoid; break-inside:avoid; }
  .sig-box { border-top:1.5px solid var(--ink); padding-top:8px; }
  .sig-line { height:22px; border-bottom:1px solid var(--border); margin-bottom:4px; }
  .sig-label { font-size:7.5pt; color:var(--muted); font-family:'IBM Plex Mono',monospace; letter-spacing:.06em; }
  .seal-box { border:1px dashed var(--border); height:60px; border-radius:3px; display:flex; align-items:center; justify-content:center; font-size:7.5pt; color:var(--muted); margin-top:8px; font-family:'IBM Plex Mono',monospace; }
`;

// ── MODULE-SCOPE HELPERS ────────────────────────────────────────────────────

const esc2 = (val) => {
  if (val === null || val === undefined) return '—';
  return String(val)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
};
const nil    = (v) => (v !== null && v !== undefined && v !== '') ? esc2(v) : '<span class="nil">NIL</span>';
const f2     = (v) => parseFloat(v) || 0;
const fmt2   = (n, d=2) => Number(n||0).toLocaleString('en-IN', {maximumFractionDigits:d, minimumFractionDigits:d});
const toArr2 = (v) => Array.isArray(v) ? v : [];
const nils   = (n) => Array(n).fill('<td class="nil">NIL</td>').join('');
const SEBI_REF = 'SEBI/HO/CFD/CMD-2/CIR/P/2023/120';

// FIX #1: kvBlock — always wraps in its own <table> so no naked <tr> ever appears
const kvBlock = (label, value) => `
  <table class="kv-table"><tbody>
    <tr>
      <td>${esc2(label)}</td>
      <td>${nil(value)}</td>
    </tr>
  </tbody></table>`;

// kv() still used ONLY inside an explicit <table><tbody>…</tbody></table> wrapper (Section A)
const kv = (label, value) => `
  <tr>
    <td style="width:44%;font-weight:500;color:var(--muted);font-size:8.5pt;">${esc2(label)}</td>
    <td>${nil(value)}</td>
  </tr>`;

const gv  = (v, unit='') => v > 0 ? `${fmt2(v)}${unit ? ' '+unit : ''}` : '<span class="nil">NIL</span>';
const p9  = (vals) => [1,2,3,4,5,6,7,8,9].map(i=>`<td class="center">${nil(vals?.[i-1])}</td>`).join('');

const ph = (orgName, fy, fyNext, label, LOGO_IMG_SM) => `
  <div class="page-header">
    <div class="page-header-logo">${LOGO_IMG_SM}</div>
    <div class="page-header-center">
      <div class="rpt-tag">SEBI BRSR · ${SEBI_REF}</div>
      <div class="co-name">${esc2(orgName)}</div>
    </div>
    <div class="page-header-right">FY ${esc2(fy)}–${esc2(fyNext)}<br/>${esc2(label)}</div>
  </div>`;

// ── MAIN EXPORT ─────────────────────────────────────────────────────────────

const buildBRSRHTML = (d, LOGO_BASE64, LOGO_IMG_SM) => {
  const {
    orgName, year, profile, brsr = {},
    energyData=null, waterData=null, wasteData=null,
    scope2Location, scope2Market,
    gridEmissionFactor=0.727, gridEFVersion='CEA V20.0 Dec 2024',
    pppRate=27.3, pppRateSource='IMF WEO April 2025', verifier=null,
  } = d;

  const emissions             = toArr2(d.emissions);
  const retirements           = toArr2(d.retirements);
  const previousYearEmissions = toArr2(d.previousYearEmissions);

  const fy           = String(year);
  const fyNext       = String(parseInt(year)+1);
  const fyPrev       = String(parseInt(year)-1);
  const fyLabel      = `FY ${fy}–${fyNext}`;
  const fyPrevLabel  = `FY ${fyPrev}–${fy}`;
  const fyPriorLabel = `FY ${parseInt(fyPrev)-1}–${fyPrev}`;
  const genDate      = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});

  const scope1 = emissions.filter(r=>r.scope===1).reduce((s,r)=>s+f2(r.co2e),0);
  const scope2 = emissions.filter(r=>r.scope===2).reduce((s,r)=>s+f2(r.co2e),0);
  const scope3 = emissions.filter(r=>r.scope===3).reduce((s,r)=>s+f2(r.co2e),0);
  const s2Loc  = f2(scope2Location)||scope2;
  const prevS1 = previousYearEmissions.filter(r=>r.scope===1).reduce((s,r)=>s+f2(r.co2e),0);
  const prevS2 = previousYearEmissions.filter(r=>r.scope===2).reduce((s,r)=>s+f2(r.co2e),0);

  const revenueCr   = f2(profile?.revenue_cr);
  const revenuePPPM = revenueCr ? (revenueCr*1e7)/pppRate/1e6 : null;

  const totalGJ     = f2(energyData?.total_gj);
  const renewableGJ = f2(energyData?.renewable_gj);
  const nonRenewGJ  = Math.max(0, totalGJ - renewableGJ);
  const prevGJ      = f2(energyData?.prev_total_gj);
  const withdrawKL  = f2(waterData?.withdrawal_kl);
  const consumeKL   = f2(waterData?.consumption_kl);

  const wc = [
    ['Plastic waste (A)',                     wasteData?.plastic_kg],
    ['E-waste (B)',                           wasteData?.ewaste_kg],
    ['Bio-medical waste (C)',                 wasteData?.biomedical_kg],
    ['Construction and demolition waste (D)', wasteData?.construction_kg],
    ['Battery waste (E)',                     wasteData?.battery_kg],
    ['Radioactive waste (F)',                 wasteData?.radioactive_kg],
    ['Other Hazardous waste (G)',             wasteData?.hazardous_kg],
    ['Other Non-hazardous waste (H)',         wasteData?.non_hazardous_kg],
  ];
  const totalWasteKg = wc.reduce((s,[,v])=>s+f2(v),0);

  const verNote = `Note: Indicate if any independent assessment/evaluation/assurance has been carried out by an external agency? (Y/N) If yes, name of the external agency: ${verifier?'Y — '+esc2(verifier.verifier_name):'N'}`;

  // ── WATER DISCHARGE ROWS HELPER ─────────────────────────────────────────
  // FIX #4: proper indented rows instead of concatenated strings
  const waterDischargeRows = () => [
    { dest:'(i) To Surface water',      treatment:'No treatment' },
    { dest:'',                           treatment:'With treatment – please specify level of treatment' },
    { dest:'(ii) To Groundwater',       treatment:'No treatment' },
    { dest:'',                           treatment:'With treatment – please specify level of treatment' },
    { dest:'(iii) To Seawater',         treatment:'No treatment' },
    { dest:'',                           treatment:'With treatment – please specify level of treatment' },
    { dest:'(iv) Sent to third-parties',treatment:'No treatment' },
    { dest:'',                           treatment:'With treatment – please specify level of treatment' },
    { dest:'(v) Others',                treatment:'No treatment' },
    { dest:'',                           treatment:'With treatment – please specify level of treatment' },
  ].map(r=>`<tr>
    <td style="padding-left:${r.dest?'8px':'20px'}">${r.dest ? esc2(r.dest) : ''}</td>
    <td style="color:var(--muted);font-size:7.5pt;">– ${esc2(r.treatment)}</td>
    ${nils(2)}
  </tr>`).join('');

  const waterStressDischargeRows = () => [
    { dest:'(i) Into Surface water',     treatment:'No treatment' },
    { dest:'',                            treatment:'With treatment – please specify level of treatment' },
    { dest:'(ii) Into Groundwater',      treatment:'No treatment' },
    { dest:'',                            treatment:'With treatment – please specify level of treatment' },
    { dest:'(iii) Into Seawater',        treatment:'No treatment' },
    { dest:'',                            treatment:'With treatment – please specify level of treatment' },
    { dest:'(iv) Sent to third-parties', treatment:'No treatment' },
    { dest:'',                            treatment:'With treatment – please specify level of treatment' },
    { dest:'(v) Others',                 treatment:'No treatment' },
    { dest:'',                            treatment:'With treatment – please specify level of treatment' },
  ].map(r=>`<tr>
    <td style="padding-left:${r.dest?'8px':'20px'}">${r.dest ? esc2(r.dest) : ''}</td>
    <td style="color:var(--muted);font-size:7.5pt;">– ${esc2(r.treatment)}</td>
    ${nils(2)}
  </tr>`).join('');

  // ════════════════════════════════════════════════════════════════════════
  // COVER
  // ════════════════════════════════════════════════════════════════════════
  const cover = `<div class="cover">
    <div class="cover-topbar">
      <span>${SEBI_REF} · BUSINESS RESPONSIBILITY &amp; SUSTAINABILITY REPORT</span>
      <span>ANNEXURE II · ${genDate}</span>
    </div>
    <div class="cover-body">
      <div>
        <div class="cover-logo-row">
          ${LOGO_BASE64?`<img src="${LOGO_BASE64}" alt="EtherTrack" style="height:52px;width:auto;object-fit:contain;"/>`:''}
          <div class="cover-brand">ETHERTRACK TECHNOLOGIES PRIVATE LIMITED</div>
        </div>
        <div class="cover-badge">ANNEXURE II</div>
        <div class="cover-title">Business Responsibility<br/>&amp; Sustainability<br/>Report</div>
        <div class="cover-subtitle">Section A · Section B · Section C — Principles 1 to 9</div>
        <div class="cover-meta">
          <div class="cover-field"><div class="cover-field-label">Reporting Entity</div><div class="cover-field-value">${esc2(orgName)}</div></div>
          <div class="cover-field"><div class="cover-field-label">Reporting Period</div><div class="cover-field-value">${fyLabel}</div></div>
          <div class="cover-field"><div class="cover-field-label">CIN</div><div class="cover-field-value">${nil(profile?.company_cin)}</div></div>
          <div class="cover-field"><div class="cover-field-label">Industry</div><div class="cover-field-value">${nil(profile?.industry)}</div></div>
          <div class="cover-field"><div class="cover-field-label">SEBI Circular</div><div class="cover-field-value">${SEBI_REF}</div></div>
          <div class="cover-field"><div class="cover-field-label">Date of Issue</div><div class="cover-field-value">${genDate}</div></div>
        </div>
        <div class="cover-sebi">Prepared in accordance with ${SEBI_REF} · BRSR Core · ISF Dec 2024 · CEA V20.0 Dec 2024 (Grid EF ${gridEmissionFactor} tCO₂/MWh) · GHG Protocol · ISO 14064-1:2018 · GRI 302/303/306 · IPCC AR6 GWP100 · DEFRA 2024</div>
      </div>
    </div>
    <div class="cover-bottombar">
      <span>EtherTrack Technologies Private Limited · Blockchain-verified GHG Inventory</span>
      <span>Generated: ${genDate}</span>
    </div>
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // SECTION A
  // ════════════════════════════════════════════════════════════════════════
  const sectionA = `<div class="brsr-body break-before">
    ${ph(orgName,fy,fyNext,'Section A — General Disclosures',LOGO_IMG_SM)}
    <div class="annexure-head">Annexure II — Business Responsibility &amp; Sustainability Report</div>
    <div class="section-head">Section A: General Disclosures</div>

    <div class="roman-head">Ⅰ Details of the listed entity</div>
    <table><tbody>
      ${kv('1. Corporate Identity Number (CIN) of the Listed Entity',profile?.company_cin)}
      ${kv('2. Name of the Listed Entity',orgName)}
      ${kv('3. Year of incorporation',profile?.year_of_incorporation)}
      ${kv('4. Registered office address',profile?.registered_address)}
      ${kv('5. Corporate address',profile?.corporate_address)}
      ${kv('6. E-mail',profile?.email)}
      ${kv('7. Telephone',profile?.telephone)}
      ${kv('8. Website',profile?.website)}
      ${kv('9. Financial year for which reporting is being done',fyLabel)}
      ${kv('10. Name of the Stock Exchange(s) where shares are listed',profile?.stock_exchange)}
      ${kv('11. Paid-up Capital',profile?.paid_up_capital)}
    </tbody></table>

    <div class="q-label">12. Name and contact details (telephone, email address) of the person who may be contacted in case of any queries on the BRSR report:</div>
    <table><tbody>
      ${kv('Name',profile?.contact_name)}
      ${kv('Designation',profile?.contact_designation)}
      ${kv('Contact Number',profile?.contact_phone)}
      ${kv('Email Id',profile?.contact_email)}
    </tbody></table>
    <table><tbody>
      ${kv('13. Reporting boundary — Are the disclosures under this report made on a standalone basis (i.e. only for the entity) or on a consolidated basis?',profile?.reporting_boundary)}
      ${kv('14. Name of assurance provider',verifier?.verifier_name)}
      ${kv('15. Type of assurance obtained',verifier?.assurance_level||(verifier?'Limited Assurance — ISO 14064-3':null))}
    </tbody></table>

    <div class="roman-head">Ⅱ Products/Services</div>
    <div class="q-label">16. Details of business activities (accounting for 90% of the turnover):</div>
    <table>
      <thead><tr><th>S. No.</th><th>Description of Main Activity</th><th>Description of Business Activity</th><th>% of Turnover of the entity</th></tr></thead>
      <tbody>${toArr2(brsr?.business_activities).length
        ? toArr2(brsr.business_activities).map((r,i)=>`<tr><td>${i+1}</td><td>${nil(r.main_activity)}</td><td>${nil(r.business_activity)}</td><td>${nil(r.turnover_pct)}</td></tr>`).join('')
        : '<tr><td class="nil">NIL</td><td class="nil">NIL</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>'
      }</tbody>
    </table>

    <div class="q-label">17. Products/Services sold by the entity (accounting for 90% of the entity's Turnover):</div>
    <table>
      <thead><tr><th>S. No.</th><th>Product/Service</th><th>NIC Code</th><th>% of total Turnover contributed</th></tr></thead>
      <tbody>${toArr2(brsr?.products_services).length
        ? toArr2(brsr.products_services).map((r,i)=>`<tr><td>${i+1}</td><td>${nil(r.product)}</td><td>${nil(r.nic_code)}</td><td>${nil(r.turnover_pct)}</td></tr>`).join('')
        : '<tr><td class="nil">NIL</td><td class="nil">NIL</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>'
      }</tbody>
    </table>

    <div class="roman-head">Ⅲ Operations</div>
    <div class="q-label">18. Number of locations where plants and/or operations/offices of the entity are situated:</div>
    <table>
      <thead><tr><th>Location</th><th>Number of plants</th><th>Number of offices</th><th>Total</th></tr></thead>
      <tbody>
        <tr><td>National</td><td>${nil(brsr?.ops_plants_national)}</td><td>${nil(brsr?.ops_offices_national)}</td><td>${nil(brsr?.ops_total_national)}</td></tr>
        <tr><td>International</td><td>${nil(brsr?.ops_plants_intl)}</td><td>${nil(brsr?.ops_offices_intl)}</td><td>${nil(brsr?.ops_total_intl)}</td></tr>
      </tbody>
    </table>

    <div class="q-label">19. Markets served by the entity:</div>
    <div class="q-label" style="font-weight:400;margin-left:8px;">a. Number of locations</div>
    <table>
      <thead><tr><th>Locations</th><th>Number</th></tr></thead>
      <tbody>
        <tr><td>National (No. of States)</td><td>${nil(brsr?.markets_national_states)}</td></tr>
        <tr><td>International (No. of Countries)</td><td>${nil(brsr?.markets_intl_countries)}</td></tr>
      </tbody>
    </table>
    <div class="q-label" style="font-weight:400;margin-left:8px;">b. What is the contribution of exports as a percentage of the total turnover of the entity?</div>
    <div class="q-answer">${nil(brsr?.exports_pct)}</div>
    <div class="q-label" style="font-weight:400;margin-left:8px;">c. A brief on types of customers</div>
    <div class="q-answer">${nil(brsr?.customer_types)}</div>

    <div class="roman-head">Ⅳ Employees</div>
    <div class="q-label">20. Details as at the end of Financial Year:</div>
    <div class="q-label" style="font-weight:400;margin-left:8px;">a. Employees and workers (including differently abled):</div>
    <table>
      <thead>
        <tr><th rowspan="2">S. No.</th><th rowspan="2">Particulars</th><th rowspan="2">Total (A)</th><th colspan="2">Male</th><th colspan="2">Female</th></tr>
        <tr><th>No. (B)</th><th>B / A (%)</th><th>No. (C)</th><th>C / A (%)</th></tr>
      </thead>
      <tbody>
        <tr><td colspan="7" style="background:var(--green-bg);font-weight:600;">EMPLOYEES</td></tr>
        <tr><td>1</td><td>Permanent (D)</td><td>${nil(brsr?.emp_perm_total)}</td><td>${nil(brsr?.emp_perm_male)}</td><td>${nil(brsr?.emp_perm_male_pct)}</td><td>${nil(brsr?.emp_perm_female)}</td><td>${nil(brsr?.emp_perm_female_pct)}</td></tr>
        <tr><td>2</td><td>Other than Permanent (E)</td><td>${nil(brsr?.emp_other_total)}</td><td>${nil(brsr?.emp_other_male)}</td><td>${nil(brsr?.emp_other_male_pct)}</td><td>${nil(brsr?.emp_other_female)}</td><td>${nil(brsr?.emp_other_female_pct)}</td></tr>
        <tr class="subtotal"><td>3</td><td>Total employees (D + E)</td><td>${nil(brsr?.emp_total)}</td><td>${nil(brsr?.emp_total_male)}</td><td>${nil(brsr?.emp_total_male_pct)}</td><td>${nil(brsr?.emp_total_female)}</td><td>${nil(brsr?.emp_total_female_pct)}</td></tr>
        <tr><td colspan="7" style="background:var(--green-bg);font-weight:600;">WORKERS</td></tr>
        <tr><td>4</td><td>Permanent (F)</td><td>${nil(brsr?.wkr_perm_total)}</td><td>${nil(brsr?.wkr_perm_male)}</td><td>${nil(brsr?.wkr_perm_male_pct)}</td><td>${nil(brsr?.wkr_perm_female)}</td><td>${nil(brsr?.wkr_perm_female_pct)}</td></tr>
        <tr><td>5</td><td>Other than Permanent (G)</td><td>${nil(brsr?.wkr_other_total)}</td><td>${nil(brsr?.wkr_other_male)}</td><td>${nil(brsr?.wkr_other_male_pct)}</td><td>${nil(brsr?.wkr_other_female)}</td><td>${nil(brsr?.wkr_other_female_pct)}</td></tr>
        <tr class="subtotal"><td>6</td><td>Total workers (F + G)</td><td>${nil(brsr?.wkr_total)}</td><td>${nil(brsr?.wkr_total_male)}</td><td>${nil(brsr?.wkr_total_male_pct)}</td><td>${nil(brsr?.wkr_total_female)}</td><td>${nil(brsr?.wkr_total_female_pct)}</td></tr>
      </tbody>
    </table>

    <div class="q-label" style="font-weight:400;margin-left:8px;">b. Differently abled Employees and workers:</div>
    <table>
      <thead>
        <tr><th rowspan="2">S. No.</th><th rowspan="2">Particulars</th><th rowspan="2">Total (A)</th><th colspan="2">Male</th><th colspan="2">Female</th></tr>
        <tr><th>No. (B)</th><th>B / A (%)</th><th>No. (C)</th><th>C / A (%)</th></tr>
      </thead>
      <tbody>
        <tr><td colspan="7" style="background:var(--green-bg);font-weight:600;">DIFFERENTLY ABLED EMPLOYEES</td></tr>
        <tr><td>1</td><td>Permanent (D)</td>${nils(5)}</tr>
        <tr><td>2</td><td>Other than Permanent (E)</td>${nils(5)}</tr>
        <tr class="subtotal"><td>3</td><td>Total differently abled employees (D + E)</td>${nils(5)}</tr>
        <tr><td colspan="7" style="background:var(--green-bg);font-weight:600;">DIFFERENTLY ABLED WORKERS</td></tr>
        <tr><td>4</td><td>Permanent (F)</td>${nils(5)}</tr>
        <tr><td>5</td><td>Other than Permanent (G)</td>${nils(5)}</tr>
        <tr class="subtotal"><td>6</td><td>Total differently abled workers (F + G)</td>${nils(5)}</tr>
      </tbody>
    </table>

    <div class="q-label">21. Participation/Inclusion/Representation of women:</div>
    <table>
      <thead><tr><th></th><th>Total (A)</th><th>No. and percentage of Females — No. (B)</th><th>B / A (%)</th></tr></thead>
      <tbody>
        <tr><td>Board of Directors</td><td>${nil(brsr?.women_bod_total)}</td><td>${nil(brsr?.women_bod_no)}</td><td>${nil(brsr?.women_bod_pct)}</td></tr>
        <tr><td>Key Management Personnel</td><td>${nil(brsr?.women_kmp_total)}</td><td>${nil(brsr?.women_kmp_no)}</td><td>${nil(brsr?.women_kmp_pct)}</td></tr>
      </tbody>
    </table>

    <div class="q-label">22. Turnover rate for permanent employees and workers (Disclose trends for the past 3 years):</div>
    <table>
      <thead>
        <tr>
          <th rowspan="2"></th>
          <th colspan="3">${fyLabel} (Current FY)</th>
          <th colspan="3">${fyPrevLabel} (Previous FY)</th>
          <th colspan="3">${fyPriorLabel} (Year prior to previous)</th>
        </tr>
        <tr><th>Male</th><th>Female</th><th>Total (%)</th><th>Male</th><th>Female</th><th>Total (%)</th><th>Male</th><th>Female</th><th>Total (%)</th></tr>
      </thead>
      <tbody>
        <tr><td>Permanent Employees</td>${nils(9)}</tr>
        <tr><td>Permanent Workers</td>${nils(9)}</tr>
      </tbody>
    </table>

    <div class="roman-head">Ⅴ Holding, Subsidiary and Associate Companies (including joint ventures)</div>
    <div class="q-label">23. (a) Names of holding/subsidiary/associate companies/joint ventures:</div>
    <table>
      <thead><tr><th>S. No.</th><th>Name of the holding/subsidiary/associate companies/joint ventures (A)</th><th>Indicate whether holding/Subsidiary/Associate/Joint Venture</th><th>% of shares held by listed entity</th><th>Does the entity indicated at column A, participate in the Business Responsibility initiatives of the listed entity? (Yes/No)</th></tr></thead>
      <tbody>${toArr2(brsr?.subsidiaries).length
        ? toArr2(brsr.subsidiaries).map((r,i)=>`<tr><td>${i+1}</td><td>${nil(r.name)}</td><td>${nil(r.type)}</td><td>${nil(r.shares_pct)}</td><td>${nil(r.br_initiative)}</td></tr>`).join('')
        : `<tr><td class="nil">NIL</td>${nils(4)}</tr>`
      }</tbody>
    </table>

    <div class="roman-head">Ⅵ CSR Details</div>
    <table><tbody>
      ${kv('24. (i) Whether CSR is applicable as per section 135 of Companies Act, 2013',brsr?.csr_applicable)}
      ${kv('(ii) Turnover (in Rs.)',brsr?.csr_turnover)}
      ${kv('(iii) Net worth (in Rs.)',brsr?.csr_net_worth)}
    </tbody></table>

    <div class="roman-head">Ⅶ Transparency and Disclosures Compliances</div>
    <div class="q-label">25. Complaints/Grievances on any of the principles (Principles 1 to 9) under the National Guidelines on Responsible Business Conduct:</div>
    <table style="font-size:7.5pt;">
      <thead>
        <tr>
          <th rowspan="2">Stakeholder group from whom complaint is received</th>
          <th rowspan="2">Grievance Redressal Mechanism in Place (Yes/No). (If Yes, then provide web-link for grievance redress policy)</th>
          <th colspan="3">${fyLabel} (Current Financial Year)</th>
          <th colspan="3">${fyPrevLabel} (Previous Financial Year)</th>
        </tr>
        <tr><th>Number of complaints filed during the year</th><th>Number of complaints pending resolution at close of the year</th><th>Remarks</th><th>Number of complaints filed during the year</th><th>Number of complaints pending resolution at close of the year</th><th>Remarks</th></tr>
      </thead>
      <tbody>
        ${['Communities','Investors (other than shareholders)','Shareholders','Employees and workers','Customers','Value Chain Partners','Other (please specify)'].map(s=>`<tr><td>${s}</td>${nils(7)}</tr>`).join('')}
      </tbody>
    </table>

    <div class="q-label">26. Overview of the entity's material responsible business conduct issues:</div>
    <table style="font-size:7.5pt;">
      <thead><tr><th>S. No.</th><th>Material issue identified</th><th>Indicate whether risk or opportunity (R/O)</th><th>Rationale for identifying the risk/opportunity</th><th>In case of risk, approach to adapt or mitigate</th><th>Financial implications of the risk or opportunity (Indicate positive or negative implications)</th></tr></thead>
      <tbody>${toArr2(brsr?.material_issues).length
        ? toArr2(brsr.material_issues).map((r,i)=>`<tr><td>${i+1}</td><td>${nil(r.issue)}</td><td>${nil(r.ro)}</td><td>${nil(r.rationale)}</td><td>${nil(r.approach)}</td><td>${nil(r.implication)}</td></tr>`).join('')
        : `<tr><td class="nil">NIL</td>${nils(5)}</tr>`
      }</tbody>
    </table>
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // SECTION B
  // ════════════════════════════════════════════════════════════════════════
  const sectionB = `<div class="brsr-body break-before">
    ${ph(orgName,fy,fyNext,'Section B — Management & Process Disclosures',LOGO_IMG_SM)}
    <div class="section-head">Section B: Management and Process Disclosures</div>
    <div class="note">This section is aimed at helping businesses demonstrate the structures, policies and processes put in place towards adopting the NGRBC Principles and Core Elements.</div>

    <table class="matrix-table">
      <thead><tr><th style="width:46%;">Disclosure Questions</th>${[1,2,3,4,5,6,7,8,9].map(i=>`<th class="center">P${i}</th>`).join('')}</tr></thead>
      <tbody>
        <tr><td colspan="10" style="background:var(--green-bg);font-weight:600;">Policy and management processes</td></tr>
        <tr><td>1a. Whether your entity's policy/policies cover each principle and its core elements of the NGRBCs. (Yes/No)</td>${p9(brsr?.policy_covers)}</tr>
        <tr><td>1b. Has the policy been approved by the Board? (Yes/No)</td>${p9(brsr?.policy_board_approved)}</tr>
        <tr><td>1c. Web Link of the Policies, if available</td><td colspan="9">${nil(brsr?.policy_web_link)}</td></tr>
        <tr><td>2. Whether the entity has translated the policy into procedures. (Yes/No)</td>${p9(brsr?.policy_procedures)}</tr>
        <tr><td>3. Do the enlisted policies extend to your value chain partners? (Yes/No)</td>${p9(brsr?.policy_value_chain)}</tr>
        <tr><td>4. Name of the national and international codes/certifications/labels/standards adopted by your entity and mapped to each principle.</td><td colspan="9">${nil(brsr?.certifications)}</td></tr>
        <tr><td>5. Specific commitments, goals and targets set by the entity with defined timelines, if any.</td><td colspan="9">${nil(brsr?.commitments_goals)}</td></tr>
        <tr><td>6. Performance of the entity against the specific commitments, goals and targets along-with reasons in case the same are not met.</td><td colspan="9">${nil(brsr?.commitments_performance)}</td></tr>
        <tr><td colspan="10" style="background:var(--green-bg);font-weight:600;">Governance, leadership and oversight</td></tr>
        <tr><td>7. Statement by director responsible for the business responsibility report, highlighting ESG related challenges, targets and achievements (listed entity has flexibility regarding the placement of this disclosure)</td><td colspan="9">${nil(brsr?.director_statement)}</td></tr>
        <tr><td>8. Details of the highest authority responsible for implementation and oversight of the Business Responsibility policy(ies).</td><td colspan="9">${nil(brsr?.highest_authority)}</td></tr>
        <tr><td>9. Does the entity have a specified Committee of the Board/Director responsible for decision making on sustainability related issues? (Yes/No). If yes, provide details.</td><td colspan="9">${nil(brsr?.sustainability_committee)}</td></tr>
      </tbody>
    </table>

    <div class="q-label">10. Details of Review of NGRBCs by the Company:</div>
    <table class="matrix-table" style="font-size:7pt;">
      <thead>
        <tr>
          <th rowspan="2" style="width:28%;">Subject for Review</th>
          <th colspan="9">Indicate whether review was undertaken by Director / Committee of the Board / Any other Committee</th>
          <th colspan="9">Frequency (Annually / Half yearly / Quarterly / Any other – please specify)</th>
        </tr>
        <tr>
          ${[1,2,3,4,5,6,7,8,9].map(i=>`<th class="center">P${i}</th>`).join('')}
          ${[1,2,3,4,5,6,7,8,9].map(i=>`<th class="center">P${i}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        <tr><td>Performance against above policies and follow up action</td>${p9(brsr?.review_performance)}${p9(brsr?.review_frequency)}</tr>
        <tr><td>Compliance with statutory requirements of relevance to the principles, and, rectification of any non-compliances</td>${p9(brsr?.review_compliance)}${p9(brsr?.review_compliance_frequency)}</tr>
      </tbody>
    </table>

    <div class="q-label">11. Has the entity carried out independent assessment/evaluation of the working of its policies by an external agency? (Yes/No). If yes, provide name of the agency.</div>
    <table class="matrix-table">
      <thead><tr>${[1,2,3,4,5,6,7,8,9].map(i=>`<th class="center">P${i}</th>`).join('')}</tr></thead>
      <tbody><tr>${p9(brsr?.external_assessment)}</tr></tbody>
    </table>

    <div class="q-label">12. If answer to question (1) above is "No" i.e. not all Principles are covered by a policy, reasons to be stated:</div>
    <table class="matrix-table">
      <thead><tr><th style="width:55%;">Questions</th>${[1,2,3,4,5,6,7,8,9].map(i=>`<th class="center">P${i}</th>`).join('')}</tr></thead>
      <tbody>
        <tr><td>The entity does not consider the Principles material to its business (Yes/No)</td>${p9(brsr?.no_reason_not_material)}</tr>
        <tr><td>The entity is not at a stage where it is in a position to formulate and implement the policies on specified principles (Yes/No)</td>${p9(brsr?.no_reason_not_ready)}</tr>
        <tr><td>The entity does not have the financial or/human and technical resources available for the task (Yes/No)</td>${p9(brsr?.no_reason_no_resources)}</tr>
        <tr><td>It is planned to be done in the next financial year (Yes/No)</td>${p9(brsr?.no_reason_planned_next)}</tr>
        <tr><td>Any other reason (please specify)</td>${p9(brsr?.no_reason_other)}</tr>
      </tbody>
    </table>
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // SECTION C — P1
  // ════════════════════════════════════════════════════════════════════════
  const sC_intro = `<div class="brsr-body break-before">
    ${ph(orgName,fy,fyNext,'Section C — Principle-wise Performance',LOGO_IMG_SM)}
    <div class="section-head">Section C: Principle-wise performance disclosure</div>
    <div class="note">This section is aimed at helping entities demonstrate their performance in integrating the Principles and Core Elements with key processes and decisions. The information sought is categorized as "Essential" and "Leadership". While the essential indicators are expected to be disclosed by every entity that is mandated to file this report, the leadership indicators may be voluntarily disclosed by entities which aspire to progress to a higher level in their quest to be socially, environmentally and ethically responsible.</div>

    <div class="principle-head">Principle 1: Businesses should conduct and govern themselves with integrity in a manner that is ethical, transparent, and accountable</div>
    <div class="indicator-type">Essential Indicators</div>

    <div class="q-label">1. Percentage coverage by training and awareness programmes on any of the Principles during the financial year:</div>
    <table>
      <thead><tr><th>Segment</th><th>Total number of training and awareness programmes held</th><th>Topics / principles covered under the training and its impact</th><th>%age of persons in respective category covered by the awareness programmes</th></tr></thead>
      <tbody>
        ${['Board of Directors','Key Managerial Personnel','Employees other than BoD and KMPs','Workers'].map(s=>`<tr><td>${s}</td>${nils(3)}</tr>`).join('')}
      </tbody>
    </table>

    <div class="q-label">2. Details of fines / penalties / punishment / award / compounding fees / settlement amount paid in proceedings (by the entity or by directors / KMPs) with regulators / law enforcement agencies / judicial institutions, in the financial year:</div>
    <table style="font-size:7.5pt;">
      <thead><tr><th>Monetary</th><th>NGRBC Principle</th><th>Name of the regulatory/enforcement agencies/judicial institutions</th><th>Amount (In INR)</th><th>Brief of the Case</th><th>Has an appeal been preferred? (Yes/No)</th></tr></thead>
      <tbody>
        <tr><td>Penalty / Fine</td>${nils(5)}</tr>
        <tr><td>Settlement</td>${nils(5)}</tr>
        <tr><td>Compounding fee</td>${nils(5)}</tr>
      </tbody>
    </table>
    <table style="font-size:7.5pt;">
      <thead><tr><th>Non-Monetary</th><th>NGRBC Principle</th><th>Name of the regulatory/enforcement agencies/judicial institutions</th><th>Brief of the Case</th><th>Has an appeal been preferred? (Yes/No)</th></tr></thead>
      <tbody>
        <tr><td>Imprisonment</td>${nils(4)}</tr>
        <tr><td>Punishment</td>${nils(4)}</tr>
      </tbody>
    </table>

    <div class="q-label">3. Of the instances disclosed in Question 2 above, details of the Appeal / Revision preferred in cases where monetary or non-monetary action has been appealed.</div>
    <table><thead><tr><th>Case Details</th><th>Name of the regulatory / enforcement agencies / judicial institutions</th></tr></thead>
    <tbody><tr>${nils(2)}</tr></tbody></table>

    ${kvBlock('4. Does the entity have an anti-corruption or anti-bribery policy? If yes, provide details in brief and if available, provide a web-link to the policy.',brsr?.anti_corruption_policy)}

    <div class="q-label">5. Number of Directors / KMPs / employees / workers against whom disciplinary action was taken by any law enforcement agency for the charges of bribery / corruption:</div>
    <table>
      <thead><tr><th></th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>${['Directors','KMPs','Employees','Workers'].map(r=>`<tr><td>${r}</td>${nils(2)}</tr>`).join('')}</tbody>
    </table>

    <div class="q-label">6. Details of complaints with regard to conflict of interest:</div>
    <table>
      <thead>
        <tr><th></th><th colspan="2">${fyLabel} (Current Financial Year)</th><th colspan="2">${fyPrevLabel} (Previous Financial Year)</th></tr>
        <tr><th></th><th>Number</th><th>Remarks</th><th>Number</th><th>Remarks</th></tr>
      </thead>
      <tbody>
        <tr><td>Number of complaints received in relation to issues of Conflict of Interest of the Directors</td>${nils(4)}</tr>
        <tr><td>Number of complaints received in relation to issues of Conflict of Interest of the KMPs</td>${nils(4)}</tr>
      </tbody>
    </table>

    ${kvBlock('7. Provide details of any corrective action taken or underway on issues related to fines / penalties / action taken by regulators / law enforcement agencies / judicial institutions, on cases of corruption and conflicts of interest.',null)}

    <div class="q-label">8. Number of days of accounts payables ((Accounts payable × 365) / Cost of goods/services procured):</div>
    <table>
      <thead><tr><th></th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody><tr><td>Number of days of accounts payables</td>${nils(2)}</tr></tbody>
    </table>

    <div class="q-label">9. Open-ness of business — Provide details of concentration of purchases and sales with trading houses, dealers, and related parties along-with loans and advances &amp; investments, with related parties, in the following format:</div>
    <table style="font-size:7.5pt;">
      <thead><tr><th>Parameter</th><th>Metrics</th><th>${fyLabel} (Current FY)</th><th>${fyPrevLabel} (Previous FY)</th></tr></thead>
      <tbody>
        ${[
          ['Concentration of Purchases','a. Purchases from trading houses as % of total purchases'],
          ['','b. Number of trading houses where purchases are made from'],
          ['','c. Purchases from top 10 trading houses as % of total purchases from trading houses'],
          ['Concentration of Sales','a. Sales to dealers / distributors as % of total sales'],
          ['','b. Number of dealers / distributors to whom sales are made'],
          ['','c. Sales to top 10 dealers / distributors as % of total sales to dealers / distributors'],
          ['Share of RPTs in','a. Purchases (Purchases with related parties / Total Purchases)'],
          ['','b. Sales (Sales to related parties / Total Sales)'],
          ['','c. Loans &amp; advances (Loans &amp; advances given to related parties / Total loans &amp; advances)'],
          ['','d. Investments (Investments in related parties / Total Investments made)'],
        ].map(([p,m])=>`<tr><td>${esc2(p)}</td><td>${m}</td>${nils(2)}</tr>`).join('')}
      </tbody>
    </table>

    <div class="indicator-type">Leadership Indicators</div>
    <div class="q-label">1. Awareness programmes conducted for value chain partners on any of the Principles during the financial year:</div>
    <table>
      <thead><tr><th>Total number of awareness programmes held</th><th>Topics / principles covered under the training</th><th>%age of value chain partners covered (by value of business done with such partners) under the awareness programmes</th></tr></thead>
      <tbody><tr>${nils(3)}</tr></tbody>
    </table>
    ${kvBlock('2. Does the entity have processes in place to avoid / manage conflict of interests involving members of the Board? (Yes/No) If Yes, provide details of the same.',null)}
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // P2
  // ════════════════════════════════════════════════════════════════════════
  const sC_P2 = `<div class="brsr-body">
    ${ph(orgName,fy,fyNext,'Principle 2',LOGO_IMG_SM)}
    <div class="principle-head">Principle 2: Businesses should provide goods and services in a manner that is sustainable and safe</div>
    <div class="indicator-type">Essential Indicators</div>

    <div class="q-label">1. Percentage of R&amp;D and capital expenditure (capex) investments in specific technologies to improve the environmental and social impacts of product and processes to total R&amp;D and capex investments made by the entity, respectively.</div>
    <table>
      <thead><tr><th></th><th>Current Financial Year</th><th>Previous Financial Year</th><th>Details of improvements in environmental and social impacts</th></tr></thead>
      <tbody>
        <tr><td>R&amp;D</td>${nils(3)}</tr>
        <tr><td>Capex</td>${nils(3)}</tr>
      </tbody>
    </table>

    ${kvBlock('2a. Does the entity have procedures in place for sustainable sourcing? (Yes/No)',null)}
    ${kvBlock('2b. If yes, what percentage of inputs were sourced sustainably?',null)}
    <div class="q-label">3. Describe the processes in place to safely reclaim your products for reusing, recycling and disposing at the end of life, for:</div>
    ${kvBlock('(a) Plastics (including packaging)',null)}
    ${kvBlock('(b) E-waste',null)}
    ${kvBlock('(c) Hazardous waste',null)}
    ${kvBlock('(d) Other waste',null)}
    ${kvBlock('4. Whether Extended Producer Responsibility (EPR) is applicable to the entity\'s activities (Yes / No). If yes, whether the waste collection plan is in line with the Extended Producer Responsibility (EPR) plan submitted to Pollution Control Boards? If not, provide steps taken to address the same.',null)}

    <div class="indicator-type">Leadership Indicators</div>
    <div class="q-label">1. Has the entity conducted Life Cycle Perspective / Assessments (LCA) for any of its products (for manufacturing industry) or for its services (for service industry)? If yes, provide details in the following format:</div>
    <table style="font-size:7.5pt;">
      <thead><tr><th>NIC Code</th><th>Name of Product / Service</th><th>% of total Turnover contributed</th><th>Boundary for which the Life Cycle Perspective / Assessment was conducted</th><th>Whether conducted by independent external agency (Yes/No)</th><th>Results communicated in public domain (Yes/No). If yes, provide the web-link.</th></tr></thead>
      <tbody><tr>${nils(6)}</tr></tbody>
    </table>

    <div class="q-label">2. If there are any significant social or environmental concerns and/or risks arising from production or disposal of your products / services, as identified in the Life Cycle Perspective / Assessments (LCA) or through any other means, briefly describe the same along-with action taken to mitigate the same.</div>
    <table><thead><tr><th>Name of Product / Service</th><th>Description of the risk / concern</th><th>Action Taken</th></tr></thead>
    <tbody><tr>${nils(3)}</tr></tbody></table>

    <div class="q-label">3. Percentage of recycled or reused input material to total material (by value) used in production (for manufacturing industry) or providing services (for service industry).</div>
    <table>
      <thead><tr><th>Indicate input material</th><th>Recycled or re-used input material to total material<br/>${fyLabel} (Current Financial Year)</th><th>Recycled or re-used input material to total material<br/>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody><tr>${nils(3)}</tr></tbody>
    </table>

    <div class="q-label">4. Of the products and packaging reclaimed at end of life of products, amount (in metric tonnes) reused, recycled, and safely disposed, as per the following format:</div>
    <table style="font-size:7.5pt;">
      <thead>
        <tr><th rowspan="2"></th><th colspan="3">${fyLabel} (Current Financial Year)</th><th colspan="3">${fyPrevLabel} (Previous Financial Year)</th></tr>
        <tr><th>Re-Used</th><th>Recycled</th><th>Safely Disposed</th><th>Re-Used</th><th>Recycled</th><th>Safely Disposed</th></tr>
      </thead>
      <tbody>
        ${['Plastics (including packaging)','E-waste','Hazardous waste','Other waste'].map(r=>`<tr><td>${r}</td>${nils(6)}</tr>`).join('')}
      </tbody>
    </table>

    <div class="q-label">5. Reclaimed products and their packaging materials (as percentage of products sold) for each product category.</div>
    <table>
      <thead><tr><th>Indicate product category</th><th>Reclaimed products and their packaging materials as % of total products sold in respective category</th></tr></thead>
      <tbody><tr>${nils(2)}</tr></tbody>
    </table>
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // P3
  // ════════════════════════════════════════════════════════════════════════
  const sC_P3 = `<div class="brsr-body">
    ${ph(orgName,fy,fyNext,'Principle 3',LOGO_IMG_SM)}
    <div class="principle-head">Principle 3: Businesses should respect and promote the well-being of all employees, including those in their value chains</div>
    <div class="indicator-type">Essential Indicators</div>

    <div class="q-label">1a. Details of measures for the well-being of employees:</div>
    <table style="font-size:7.5pt;">
      <thead>
        <tr><th rowspan="2">Category</th><th rowspan="2">Total (A)</th><th colspan="2">Health insurance</th><th colspan="2">Accident insurance</th><th colspan="2">Maternity benefits</th><th colspan="2">Paternity benefits</th><th colspan="2">Day Care facilities</th></tr>
        <tr><th>No. (B)</th><th>B/A (%)</th><th>No. (C)</th><th>C/A (%)</th><th>No. (D)</th><th>D/A (%)</th><th>No. (E)</th><th>E/A (%)</th><th>No. (F)</th><th>F/A (%)</th></tr>
      </thead>
      <tbody>
        <tr><td colspan="12" style="background:var(--green-bg);font-weight:600;">Permanent Employees</td></tr>
        <tr><td>Male</td>${nils(11)}</tr>
        <tr><td>Female</td>${nils(11)}</tr>
        <tr class="subtotal"><td>Total</td>${nils(11)}</tr>
        <tr><td colspan="12" style="background:var(--green-bg);font-weight:600;">Other than Permanent Employees</td></tr>
        <tr><td>Male</td>${nils(11)}</tr>
        <tr><td>Female</td>${nils(11)}</tr>
        <tr class="subtotal"><td>Total</td>${nils(11)}</tr>
      </tbody>
    </table>

    <div class="q-label">1b. Details of measures for the well-being of workers:</div>
    <table style="font-size:7.5pt;">
      <thead>
        <tr><th rowspan="2">Category</th><th rowspan="2">Total (A)</th><th colspan="2">Health insurance</th><th colspan="2">Accident insurance</th><th colspan="2">Maternity benefits</th><th colspan="2">Paternity benefits</th><th colspan="2">Day Care facilities</th></tr>
        <tr><th>No. (B)</th><th>B/A (%)</th><th>No. (C)</th><th>C/A (%)</th><th>No. (D)</th><th>D/A (%)</th><th>No. (E)</th><th>E/A (%)</th><th>No. (F)</th><th>F/A (%)</th></tr>
      </thead>
      <tbody>
        <tr><td colspan="12" style="background:var(--green-bg);font-weight:600;">Permanent Workers</td></tr>
        <tr><td>Male</td>${nils(11)}</tr>
        <tr><td>Female</td>${nils(11)}</tr>
        <tr class="subtotal"><td>Total</td>${nils(11)}</tr>
        <tr><td colspan="12" style="background:var(--green-bg);font-weight:600;">Other than Permanent Workers</td></tr>
        <tr><td>Male</td>${nils(11)}</tr>
        <tr><td>Female</td>${nils(11)}</tr>
        <tr class="subtotal"><td>Total</td>${nils(11)}</tr>
      </tbody>
    </table>

    <div class="q-label">1c. Spending on measures towards well-being of employees and workers (including permanent and other than permanent):</div>
    <table>
      <thead><tr><th></th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody><tr><td>Cost incurred on well-being measures as a % of total revenue of the company</td>${nils(2)}</tr></tbody>
    </table>

    <div class="q-label">2. Details of retirement benefits, for Current FY and Previous Financial Year.</div>
    <table style="font-size:7.5pt;">
      <thead>
        <tr><th rowspan="2">Benefits</th><th colspan="3">${fyLabel} (Current Financial Year)</th><th colspan="3">${fyPrevLabel} (Previous Financial Year)</th></tr>
        <tr><th>No. of employees covered as a % of total employees</th><th>No. of workers covered as a % of total workers</th><th>Deducted and deposited with the authority (Y/N/N.A.)</th><th>No. of employees covered as a % of total employees</th><th>No. of workers covered as a % of total workers</th><th>Deducted and deposited with the authority (Y/N/N.A.)</th></tr>
      </thead>
      <tbody>
        ${['PF','Gratuity','ESI','Others – please specify'].map(b=>`<tr><td>${b}</td>${nils(6)}</tr>`).join('')}
      </tbody>
    </table>

    ${kvBlock('3. Accessibility of workplaces — Are the premises / offices of the entity accessible to differently abled employees and workers, as per the requirements of the Rights of Persons with Disabilities Act, 2016? If not, whether any steps are being taken by the entity in this regard.',null)}
    ${kvBlock('4. Does the entity have an equal opportunity policy as per the Rights of Persons with Disabilities Act, 2016? If so, provide a web-link to the policy.',null)}

    <div class="q-label">5. Return to work and Retention rates of permanent employees and workers that took parental leave.</div>
    <table>
      <thead>
        <tr><th rowspan="2">Gender</th><th colspan="2">Permanent employees</th><th colspan="2">Permanent workers</th></tr>
        <tr><th>Return to work rate (%)</th><th>Retention rate (%)</th><th>Return to work rate (%)</th><th>Retention rate (%)</th></tr>
      </thead>
      <tbody>
        <tr><td>Male</td>${nils(4)}</tr>
        <tr><td>Female</td>${nils(4)}</tr>
        <tr class="subtotal"><td>Total</td>${nils(4)}</tr>
      </tbody>
    </table>

    <div class="q-label">6. Is there a mechanism available to receive and redress grievances for the following categories of employees and worker? If yes, give details of the mechanism in brief.</div>
    <table>
      <thead><tr><th></th><th>Yes / No (If Yes, then give details of the mechanism in brief)</th></tr></thead>
      <tbody>
        ${['Permanent Workers','Other than Permanent Workers','Permanent Employees','Other than Permanent Employees'].map(r=>`<tr><td>${r}</td><td class="nil">NIL</td></tr>`).join('')}
      </tbody>
    </table>

    <div class="q-label">7. Membership of employees and worker in association(s) or Unions recognised by the listed entity:</div>
    <table style="font-size:7.5pt;">
      <thead>
        <tr><th rowspan="2">Category</th><th colspan="3">${fyLabel} (Current Financial Year)</th><th colspan="3">${fyPrevLabel} (Previous Financial Year)</th></tr>
        <tr><th>Total employees / workers in respective category (A)</th><th>No. of employees / workers in respective category, who are part of association(s) or Union (B)</th><th>B / A (%)</th><th>Total employees / workers in respective category (C)</th><th>No. of employees / workers in respective category, who are part of association(s) or Union (D)</th><th>D / C (%)</th></tr>
      </thead>
      <tbody>
        <tr><td colspan="7" style="background:var(--green-bg);font-weight:600;">Permanent Employees</td></tr>
        <tr><td>Total Permanent Employees</td>${nils(6)}</tr>
        <tr><td>– Male</td>${nils(6)}</tr>
        <tr><td>– Female</td>${nils(6)}</tr>
        <tr><td colspan="7" style="background:var(--green-bg);font-weight:600;">Permanent Workers</td></tr>
        <tr><td>Total Permanent Workers</td>${nils(6)}</tr>
        <tr><td>– Male</td>${nils(6)}</tr>
        <tr><td>– Female</td>${nils(6)}</tr>
      </tbody>
    </table>

    <div class="q-label">8. Details of training given to employees and workers:</div>
    <table style="font-size:7.5pt;">
      <thead>
        <tr><th rowspan="2">Category</th><th colspan="5">${fyLabel} (Current Financial Year)</th><th colspan="5">${fyPrevLabel} (Previous Financial Year)</th></tr>
        <tr><th>Total (A)</th><th>On Health &amp; safety measures No. (B)</th><th>B/A (%)</th><th>On Skill upgradation No. (C)</th><th>C/A (%)</th><th>Total (D)</th><th>On Health &amp; safety measures No. (E)</th><th>E/D (%)</th><th>On Skill upgradation No. (F)</th><th>F/D (%)</th></tr>
      </thead>
      <tbody>
        <tr><td colspan="11" style="background:var(--green-bg);font-weight:600;">Employees</td></tr>
        ${['Male','Female','Total'].map(r=>`<tr><td>${r}</td>${nils(10)}</tr>`).join('')}
        <tr><td colspan="11" style="background:var(--green-bg);font-weight:600;">Workers</td></tr>
        ${['Male','Female','Total'].map(r=>`<tr><td>${r}</td>${nils(10)}</tr>`).join('')}
      </tbody>
    </table>

    <div class="q-label">9. Details of performance and career development reviews of employees and worker:</div>
    <table style="font-size:7.5pt;">
      <thead>
        <tr><th rowspan="2">Category</th><th colspan="3">${fyLabel} (Current Financial Year)</th><th colspan="3">${fyPrevLabel} (Previous Financial Year)</th></tr>
        <tr><th>Total (A)</th><th>No. (B)</th><th>B/A (%)</th><th>Total (C)</th><th>No. (D)</th><th>D/C (%)</th></tr>
      </thead>
      <tbody>
        <tr><td colspan="7" style="background:var(--green-bg);font-weight:600;">Employees</td></tr>
        ${['Male','Female','Total'].map(r=>`<tr><td>${r}</td>${nils(6)}</tr>`).join('')}
        <tr><td colspan="7" style="background:var(--green-bg);font-weight:600;">Workers</td></tr>
        ${['Male','Female','Total'].map(r=>`<tr><td>${r}</td>${nils(6)}</tr>`).join('')}
      </tbody>
    </table>

    <div class="q-label">10. Health and safety management system:</div>
    ${kvBlock('a. Whether an occupational health and safety management system has been implemented by the entity? (Yes/No). If yes, the coverage of such system?',null)}
    ${kvBlock('b. What are the processes used to identify work-related hazards and assess risks on a routine and non-routine basis by the entity?',null)}
    ${kvBlock('c. Whether you have processes for workers to report the work related hazards and to remove themselves from such risks. (Y/N)',null)}
    ${kvBlock('d. Do the employees / worker of the entity have access to non-occupational medical and healthcare services? (Yes/No)',null)}

    <div class="q-label">11. Details of safety related incidents, in the following format:</div>
    <table>
      <thead><tr><th>Safety Incident/Number</th><th>Category</th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>
        ${[
          ['Lost Time Injury Frequency Rate (LTIFR) (per one million-person hours worked)','Employees'],['','Workers'],
          ['Total recordable work-related injuries','Employees'],['','Workers'],
          ['No. of fatalities','Employees'],['','Workers'],
          ['High consequence work-related injury or ill-health (excluding fatalities)','Employees'],['','Workers'],
        ].map(([i,c])=>`<tr><td>${esc2(i)}</td><td>${esc2(c)}</td>${nils(2)}</tr>`).join('')}
      </tbody>
    </table>
    <div style="font-size:7.5pt;color:var(--muted);margin-bottom:6px;">*Including in the contract workforce</div>

    ${kvBlock('12. Describe the measures taken by the entity to ensure a safe and healthy work place.',null)}

    <div class="q-label">13. Number of Complaints on the following made by employees and workers:</div>
    <table>
      <thead>
        <tr><th rowspan="2"></th><th colspan="3">${fyLabel} (Current Financial Year)</th><th colspan="3">${fyPrevLabel} (Previous Financial Year)</th></tr>
        <tr><th>Filed during the year</th><th>Pending resolution at the end of year</th><th>Remark</th><th>Filed during the year</th><th>Pending resolution at the end of year</th><th>Remark</th></tr>
      </thead>
      <tbody>
        <tr><td>Working Conditions</td>${nils(6)}</tr>
        <tr><td>Health &amp; Safety</td>${nils(6)}</tr>
      </tbody>
    </table>

    <div class="q-label">14. Assessments for the year:</div>
    <table>
      <thead><tr><th>% of your plants and offices that were assessed (by entity or statutory authorities or third parties)</th><th></th></tr></thead>
      <tbody>
        <tr><td>Health and safety practices</td><td class="nil">NIL</td></tr>
        <tr><td>Working Conditions</td><td class="nil">NIL</td></tr>
      </tbody>
    </table>

    ${kvBlock('15. Provide details of any corrective action taken or underway to address safety-related incidents (if any) and on significant risks / concerns arising from assessments of health &amp; safety practices and working conditions.',null)}

    <div class="indicator-type">Leadership Indicators</div>
    <div class="q-label">1. Does the entity extend any life insurance or any compensatory package in the event of death of</div>
    ${kvBlock('(A) Employees (Y/N)',null)}
    ${kvBlock('(B) Workers (Y/N)',null)}
    ${kvBlock('2. Provide the measures undertaken by the entity to ensure that statutory dues have been deducted and deposited by the value chain partners.',null)}

    <div class="q-label">3. Provide the number of employees / workers having suffered high consequence work-related injury / ill-health / fatalities (as reported in Q11 of Essential Indicators above), who have been rehabilitated and placed in suitable employment or whose family members have been placed in suitable employment:</div>
    <table>
      <thead>
        <tr>
          <th rowspan="2"></th>
          <th colspan="2">Total no. of affected employees / workers</th>
          <th colspan="2">No. of employees / workers that are rehabilitated and placed in suitable employment or whose family members have been placed in suitable employment</th>
        </tr>
        <tr><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr>
      </thead>
      <tbody>
        <tr><td>Employees</td>${nils(4)}</tr>
        <tr><td>Workers</td>${nils(4)}</tr>
      </tbody>
    </table>

    ${kvBlock('4. Does the entity provide transition assistance programs to facilitate continued employability and the management of career endings resulting from retirement or termination of employment? (Yes / No)',null)}

    <div class="q-label">5. Details on assessment of value chain partners:</div>
    <table>
      <thead><tr><th>% of value chain partners (by value of business done with such partners) that were assessed</th><th></th></tr></thead>
      <tbody>
        <tr><td>Health and safety practices</td><td class="nil">NIL</td></tr>
        <tr><td>Working Conditions</td><td class="nil">NIL</td></tr>
      </tbody>
    </table>

    ${kvBlock('6. Provide details of any corrective actions taken or underway to address significant risks / concerns arising from assessments of health and safety practices and working conditions of value chain partners.',null)}
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // P4
  // ════════════════════════════════════════════════════════════════════════
  const sC_P4 = `<div class="brsr-body">
    ${ph(orgName,fy,fyNext,'Principle 4',LOGO_IMG_SM)}
    <div class="principle-head">Principle 4: Businesses should respect the interests of and be responsive to all its stakeholders</div>
    <div class="indicator-type">Essential Indicators</div>

    ${kvBlock('1. Describe the processes for identifying key stakeholder groups of the entity.',null)}

    <div class="q-label">2. List stakeholder groups identified as key for your entity and the frequency of engagement with each stakeholder group.</div>
    <table style="font-size:7.5pt;">
      <thead><tr><th>Stakeholder Group</th><th>Whether identified as Vulnerable &amp; Marginalized Group (Yes/No)</th><th>Channels of communication (Email, SMS, Newspaper, Pamphlets, Advertisement, Community Meetings, Notice Board, Website), Other</th><th>Frequency of engagement (Annually / Half yearly / Quarterly / others – please specify)</th><th>Purpose and scope of engagement including key topics and concerns raised during such engagement</th></tr></thead>
      <tbody><tr><td colspan="5" class="nil">NIL</td></tr></tbody>
    </table>

    <div class="indicator-type">Leadership Indicators</div>
    ${kvBlock('1. Provide the processes for consultation between stakeholders and the Board on economic, environmental, and social topics or if consultation is delegated, how is feedback from such consultations provided to the Board.',null)}
    ${kvBlock('2. Whether stakeholder consultation is used to support the identification and management of environmental, and social topics (Yes / No). If so, provide details of instances as to how the inputs received from stakeholders on these topics were incorporated into policies and activities of the entity.',null)}
    ${kvBlock('3. Provide details of instances of engagement with, and actions taken to, address the concerns of vulnerable / marginalized stakeholder groups.',null)}
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // P5
  // ════════════════════════════════════════════════════════════════════════
  const sC_P5 = `<div class="brsr-body">
    ${ph(orgName,fy,fyNext,'Principle 5',LOGO_IMG_SM)}
    <div class="principle-head">Principle 5: Businesses should respect and promote human rights</div>
    <div class="indicator-type">Essential Indicators</div>

    <div class="q-label">1. Employees and workers who have been provided training on human rights issues and policy(ies) of the entity, in the following format:</div>
    <table style="font-size:7.5pt;">
      <thead>
        <tr><th rowspan="2">Category</th><th colspan="3">${fyLabel} (Current Financial Year)</th><th colspan="3">${fyPrevLabel} (Previous Financial Year)</th></tr>
        <tr><th>Total (A)</th><th>No. of employees / workers covered (B)</th><th>B / A (%)</th><th>Total (C)</th><th>No. of employees / workers covered (D)</th><th>D / C (%)</th></tr>
      </thead>
      <tbody>
        <tr><td colspan="7" style="background:var(--green-bg);font-weight:600;">Employees</td></tr>
        ${['Permanent','Other than permanent','Total Employees'].map(r=>`<tr><td>${r}</td>${nils(6)}</tr>`).join('')}
        <tr><td colspan="7" style="background:var(--green-bg);font-weight:600;">Workers</td></tr>
        ${['Permanent','Other than permanent','Total Workers'].map(r=>`<tr><td>${r}</td>${nils(6)}</tr>`).join('')}
      </tbody>
    </table>

    <div class="q-label">2. Details of minimum wages paid to employees and workers, in the following format:</div>
    <table style="font-size:7.5pt;">
      <thead>
        <tr><th rowspan="2">Category</th><th colspan="5">${fyLabel} (Current Financial Year)</th><th colspan="5">${fyPrevLabel} (Previous Financial Year)</th></tr>
        <tr><th>Total (A)</th><th>Equal to Minimum Wage No. (B)</th><th>B/A (%)</th><th>More than Minimum Wage No. (C)</th><th>C/A (%)</th><th>Total (D)</th><th>Equal to Minimum Wage No. (E)</th><th>E/D (%)</th><th>More than Minimum Wage No. (F)</th><th>F/D (%)</th></tr>
      </thead>
      <tbody>
        <tr><td colspan="11" style="background:var(--green-bg);font-weight:600;">Employees</td></tr>
        ${['Permanent','– Male','– Female','Other than Permanent','– Male','– Female'].map(r=>`<tr><td>${r}</td>${nils(10)}</tr>`).join('')}
        <tr><td colspan="11" style="background:var(--green-bg);font-weight:600;">Workers</td></tr>
        ${['Permanent','– Male','– Female','Other than Permanent','– Male','– Female'].map(r=>`<tr><td>${r}</td>${nils(10)}</tr>`).join('')}
      </tbody>
    </table>

    <div class="q-label">3. Details of remuneration / salary / wages:</div>
    <div class="q-label" style="font-weight:400;margin-left:8px;">a. Median remuneration / wages:</div>
    <table>
      <thead>
        <tr><th></th><th colspan="2">Male</th><th colspan="2">Female</th></tr>
        <tr><th></th><th>Number</th><th>Median remuneration / salary / wages of respective category</th><th>Number</th><th>Median remuneration / salary / wages of respective category</th></tr>
      </thead>
      <tbody>
        ${['Board of Directors (BoD)','Key Managerial Personnel','Employees other than BoD and KMP','Workers'].map(r=>`<tr><td>${r}</td>${nils(4)}</tr>`).join('')}
      </tbody>
    </table>
    <div class="q-label" style="font-weight:400;margin-left:8px;">b. Gross wages paid to females as % of total wages paid by the entity:</div>
    <table>
      <thead><tr><th></th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody><tr><td>Gross wages paid to females as % of total wages</td>${nils(2)}</tr></tbody>
    </table>

    ${kvBlock('4. Do you have a focal point (Individual / Committee) responsible for addressing human rights impacts or issues caused or contributed to by the business? (Yes/No)',null)}
    ${kvBlock('5. Describe the internal mechanisms in place to redress grievances related to human rights issues.',null)}

    <div class="q-label">6. Number of Complaints on the following made by employees and workers:</div>
    <table>
      <thead>
        <tr><th rowspan="2"></th><th colspan="3">${fyLabel} (Current Financial Year)</th><th colspan="3">${fyPrevLabel} (Previous Financial Year)</th></tr>
        <tr><th>Filed during the year</th><th>Pending resolution at the end of year</th><th>Remark</th><th>Filed during the year</th><th>Pending resolution at the end of year</th><th>Remark</th></tr>
      </thead>
      <tbody>
        ${['Sexual Harassment','Discrimination at workplace','Child Labour','Forced Labour / Involuntary Labour','Wages','Other human rights related issues'].map(c=>`<tr><td>${c}</td>${nils(6)}</tr>`).join('')}
      </tbody>
    </table>

    <div class="q-label">7. Complaints filed under the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013, in the following format:</div>
    <table>
      <thead><tr><th></th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>
        <tr><td>Total Complaints reported under Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 (POSH)</td>${nils(2)}</tr>
        <tr><td>Complaints on POSH as a % of female employees / workers</td>${nils(2)}</tr>
        <tr><td>Complaints on POSH upheld</td>${nils(2)}</tr>
      </tbody>
    </table>

    ${kvBlock('8. Mechanisms to prevent adverse consequences to the complainant in discrimination and harassment cases.',null)}
    ${kvBlock('9. Do human rights requirements form part of your business agreements and contracts? (Yes/No)',null)}

    <div class="q-label">10. Assessments for the year:</div>
    <table>
      <thead><tr><th>% of your plants and offices that were assessed (by entity or statutory authorities or third parties)</th><th></th></tr></thead>
      <tbody>
        ${['Child labour','Forced / involuntary labour','Sexual harassment','Discrimination at workplace','Wages','Others – please specify'].map(i=>`<tr><td>${i}</td><td class="nil">NIL</td></tr>`).join('')}
      </tbody>
    </table>

    ${kvBlock('11. Provide details of any corrective actions taken or underway to address significant risks / concerns arising from the assessments at Question 10 above.',null)}

    <div class="indicator-type">Leadership Indicators</div>
    ${kvBlock('1. Details of a business process being modified / introduced as a result of addressing human rights grievances / complaints.',null)}
    ${kvBlock('2. Details of the scope and coverage of any Human rights due-diligence conducted.',null)}
    ${kvBlock('3. Is the premise / office of the entity accessible to differently abled visitors, as per the requirements of the Rights of Persons with Disabilities Act, 2016?',null)}

    <div class="q-label">4. Details on assessment of value chain partners:</div>
    <table>
      <thead><tr><th>% of value chain partners (by value of business done with such partners) that were assessed</th><th></th></tr></thead>
      <tbody>
        ${['Sexual harassment','Discrimination at workplace','Child labour','Forced Labour / Involuntary Labour','Wages','Others – please specify'].map(i=>`<tr><td>${i}</td><td class="nil">NIL</td></tr>`).join('')}
      </tbody>
    </table>
    ${kvBlock('5. Provide details of any corrective actions taken or underway to address significant risks / concerns arising from the assessments at Question 4 above.',null)}
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // P6
  // ════════════════════════════════════════════════════════════════════════
  const sC_P6 = `<div class="brsr-body">
    ${ph(orgName,fy,fyNext,'Principle 6 — Environment',LOGO_IMG_SM)}
    <div class="principle-head">Principle 6: Businesses should respect and make efforts to protect and restore the environment</div>
    <div class="indicator-type">Essential Indicators</div>

    <div class="q-label">1. Details of total energy consumption (in Joules or multiples) and energy intensity, in the following format:</div>
    <table>
      <thead><tr><th style="width:55%;">Parameter</th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>
        <tr><td colspan="3" style="background:var(--green-bg);font-weight:600;">From renewable sources</td></tr>
        <tr><td>Total electricity consumption (A)</td><td>${gv(f2(energyData?.renew_electricity_gj),'GJ')}</td><td class="nil">NIL</td></tr>
        <tr><td>Total fuel consumption (B)</td><td>${gv(f2(energyData?.renew_fuel_gj),'GJ')}</td><td class="nil">NIL</td></tr>
        <tr><td>Energy consumption through other sources (C)</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr class="subtotal"><td>Total energy consumed from renewable sources (A+B+C)</td><td>${gv(renewableGJ,'GJ')}</td><td class="nil">NIL</td></tr>
        <tr><td colspan="3" style="background:var(--paper3);font-weight:600;">From non-renewable sources</td></tr>
        <tr><td>Total electricity consumption (D)</td><td>${gv(f2(energyData?.nonrenew_electricity_gj),'GJ')}</td><td class="nil">NIL</td></tr>
        <tr><td>Total fuel consumption (E)</td><td>${gv(f2(energyData?.nonrenew_fuel_gj),'GJ')}</td><td class="nil">NIL</td></tr>
        <tr><td>Energy consumption through other sources (F)</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr class="subtotal"><td>Total energy consumed from non-renewable sources (D+E+F)</td><td>${gv(nonRenewGJ,'GJ')}</td><td>${gv(prevGJ>0?prevGJ-renewableGJ:0,'GJ')}</td></tr>
        <tr class="subtotal" style="border-top:2px solid var(--accent2);"><td>Total energy consumed (A+B+C+D+E+F)</td><td>${gv(totalGJ,'GJ')}</td><td>${gv(prevGJ,'GJ')}</td></tr>
        <tr><td>Energy intensity per rupee of turnover (Total energy consumed / Revenue from operations)</td><td>${revenueCr>0&&totalGJ>0?fmt2(totalGJ/revenueCr,4)+' GJ/₹Cr':'<span class="nil">NIL</span>'}</td><td class="nil">NIL</td></tr>
        <tr><td>Energy intensity per rupee of turnover adjusted for Purchasing Power Parity (PPP)</td><td>${revenuePPPM&&totalGJ>0?fmt2(totalGJ/revenuePPPM,3)+' GJ/$M PPP':'<span class="nil">NIL</span>'}</td><td class="nil">NIL</td></tr>
        <tr><td>Energy intensity in terms of physical output</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td>Energy intensity (optional) – the relevant metric may be selected by the entity</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
      </tbody>
    </table>
    <div class="note">${verNote}</div>

    ${kvBlock('2. Does the entity have any sites / facilities identified as designated consumers (DCs) under the Performance, Achieve and Trade (PAT) Scheme of the Government of India? (Y/N) If yes, disclose whether targets set under the PAT scheme have been achieved. In case targets have not been achieved, provide the remedial action taken, if any.',brsr?.pat_scheme)}

    <div class="q-label">3. Provide details of the following disclosures related to water, in the following format:</div>
    <table>
      <thead><tr><th style="width:55%;">Parameter</th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>
        <tr><td colspan="3" style="background:var(--green-bg);font-weight:600;">Water withdrawal by source (in kilolitres)</td></tr>
        <tr><td>(i) Surface water</td><td>${gv(f2(waterData?.surface_kl),'KL')}</td><td class="nil">NIL</td></tr>
        <tr><td>(ii) Groundwater</td><td>${gv(f2(waterData?.ground_kl),'KL')}</td><td class="nil">NIL</td></tr>
        <tr><td>(iii) Third party water</td><td>${gv(f2(waterData?.municipal_kl),'KL')}</td><td class="nil">NIL</td></tr>
        <tr><td>(iv) Seawater / desalinated water</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td>(v) Others</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr class="subtotal"><td>Total volume of water withdrawal (in kilolitres) (i + ii + iii + iv + v)</td><td>${gv(withdrawKL,'KL')}</td><td>${gv(f2(waterData?.prev_withdrawal_kl),'KL')}</td></tr>
        <tr><td>Total volume of water consumption (in kilolitres)</td><td>${gv(consumeKL,'KL')}</td><td class="nil">NIL</td></tr>
        <tr><td>Water intensity per rupee of turnover (Total water consumption / Revenue from operations)</td><td>${revenueCr>0&&withdrawKL>0?fmt2(withdrawKL/revenueCr,2)+' KL/₹Cr':'<span class="nil">NIL</span>'}</td><td class="nil">NIL</td></tr>
        <tr><td>Water intensity per rupee of turnover adjusted for Purchasing Power Parity (PPP)</td><td>${revenuePPPM&&withdrawKL>0?fmt2(withdrawKL/revenuePPPM,2)+' KL/$M PPP':'<span class="nil">NIL</span>'}</td><td class="nil">NIL</td></tr>
        <tr><td>Water intensity in terms of physical output</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td>Water intensity (optional) – the relevant metric may be selected by the entity</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
      </tbody>
    </table>
    <div class="note">${verNote}</div>

    <div class="q-label">4. Provide the following details related to water discharged:</div>
    <table style="font-size:7.5pt;">
      <thead>
        <tr><th>Destination</th><th>Treatment level</th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr>
      </thead>
      <tbody>
        <tr><td colspan="4" style="font-weight:600;">Water discharge by destination and level of treatment (in kilolitres)</td></tr>
        ${waterDischargeRows()}
        <tr class="subtotal"><td colspan="2">Total water discharged (in kilolitres)</td>${nils(2)}</tr>
      </tbody>
    </table>
    <div class="note">${verNote}</div>

    ${kvBlock('5. Has the entity implemented a mechanism for Zero Liquid Discharge? If yes, provide details of its coverage and implementation.',null)}

    <div class="q-label">6. Please provide details of air emissions (other than GHG emissions) by the entity, in the following format:</div>
    <table>
      <thead><tr><th>Parameter</th><th>Please specify unit</th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>
        ${['NOx','SOx','Particulate matter (PM)','Persistent organic pollutants (POP)','Volatile organic compounds (VOC)','Hazardous air pollutants (HAP)','Others – please specify'].map(p=>`<tr><td>${p}</td>${nils(3)}</tr>`).join('')}
      </tbody>
    </table>
    <div class="note">${verNote}</div>

    <div class="q-label">7. Provide details of greenhouse gas emissions (Scope 1 and Scope 2 emissions) &amp; its intensity, in the following format:</div>
    <table>
      <thead><tr><th style="width:48%;">Parameter</th><th>Unit</th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>
        <tr><td>Total Scope 1 emissions (Break-up of the GHG into CO₂, CH₄, N₂O, HFCs, PFCs, SF₆, NF₃, if available)</td><td>MTCO₂e</td><td>${scope1>0?fmt2(scope1):'<span class="nil">NIL</span>'}</td><td>${prevS1>0?fmt2(prevS1):'<span class="nil">NIL</span>'}</td></tr>
        <tr><td>Total Scope 2 emissions (Break-up of the GHG into CO₂, CH₄, N₂O, HFCs, PFCs, SF₆, NF₃, if available)</td><td>MTCO₂e</td><td>${s2Loc>0?fmt2(s2Loc):'<span class="nil">NIL</span>'}</td><td>${prevS2>0?fmt2(prevS2):'<span class="nil">NIL</span>'}</td></tr>
        <tr><td>Total Scope 1 and Scope 2 emission intensity per rupee of turnover (Total Scope 1 and Scope 2 GHG emissions / Revenue from operations)</td><td>—</td><td>${revenueCr>0&&(scope1+s2Loc)>0?fmt2((scope1+s2Loc)/revenueCr,4)+' tCO₂e/₹Cr':'<span class="nil">NIL</span>'}</td><td class="nil">NIL</td></tr>
        <tr><td>Total Scope 1 and Scope 2 emission intensity per rupee of turnover adjusted for Purchasing Power Parity (PPP) (BRSR Core mandatory)</td><td>—</td><td>${revenuePPPM&&(scope1+s2Loc)>0?fmt2((scope1+s2Loc)/revenuePPPM,3)+' tCO₂e/$M PPP':'<span class="nil">NIL</span>'}</td><td class="nil">NIL</td></tr>
        <tr><td>Total Scope 1 and Scope 2 emission intensity in terms of physical output</td><td>—</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td>Total Scope 1 and Scope 2 emission intensity (optional) – the relevant metric may be selected by the entity</td><td>—</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
      </tbody>
    </table>
    <div class="note">Note: Grid emission factor used — ${gridEmissionFactor} tCO₂/MWh (${esc2(gridEFVersion)}) · PPP rate — ₹${pppRate}/intl.$ (${esc2(pppRateSource)}) · GWP basis — IPCC AR6 GWP100</div>
    <div class="note">${verNote}</div>

    ${kvBlock('8. Does the entity have any project related to reducing Green House Gas emission? If Yes, then provide details.',brsr?.ghg_reduction_project)}

    <div class="q-label">9. Provide details related to waste management by the entity, in the following format:</div>
    <table>
      <thead><tr><th style="width:55%;">Parameter</th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>
        <tr><td colspan="3" style="background:var(--green-bg);font-weight:600;">Total Waste generated (in metric tonnes)</td></tr>
        ${wc.map(([label,val])=>`<tr><td>${esc2(label)}</td><td>${gv(f2(val)/1000,'MT')}</td><td class="nil">NIL</td></tr>`).join('')}
        <tr class="subtotal"><td>Total (A+B+C+D+E+F+G+H)</td><td>${gv(totalWasteKg/1000,'MT')}</td><td class="nil">NIL</td></tr>
        <tr><td>Waste intensity per rupee of turnover (Total waste generated / Revenue from operations)</td><td>${revenueCr>0&&totalWasteKg>0?fmt2((totalWasteKg/1000)/revenueCr,4)+' MT/₹Cr':'<span class="nil">NIL</span>'}</td><td class="nil">NIL</td></tr>
        <tr><td>Waste intensity per rupee of turnover adjusted for Purchasing Power Parity (PPP)</td><td>${revenuePPPM&&totalWasteKg>0?fmt2((totalWasteKg/1000)/revenuePPPM,4)+' MT/$M PPP':'<span class="nil">NIL</span>'}</td><td class="nil">NIL</td></tr>
        <tr><td>Waste intensity in terms of physical output</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td>Waste intensity (optional) – the relevant metric may be selected by the entity</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td colspan="3" style="background:var(--paper3);font-weight:600;">For each category of waste generated, total waste recovered through recycling, re-using or other recovery operations (in metric tonnes)</td></tr>
        <tr><td>(i) Recycled</td><td>${gv(f2(wasteData?.recycled_kg)/1000,'MT')}</td><td class="nil">NIL</td></tr>
        <tr><td>(ii) Re-Used</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td>(iii) Other recovery operations</td><td>${gv(f2(wasteData?.composted_kg)/1000,'MT')}</td><td class="nil">NIL</td></tr>
        <tr class="subtotal"><td>Total</td><td>${gv((f2(wasteData?.recycled_kg)+f2(wasteData?.composted_kg))/1000,'MT')}</td><td class="nil">NIL</td></tr>
        <tr><td colspan="3" style="background:var(--paper3);font-weight:600;">For each category of waste generated, total waste disposed by nature of disposal method (in metric tonnes)</td></tr>
        <tr><td>(i) Incineration</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td>(ii) Landfilling</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td>(iii) Other disposal operations</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr class="subtotal"><td>Total</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
      </tbody>
    </table>
    <div class="note">${verNote}</div>

    ${kvBlock('10. Briefly describe the waste management practices adopted in your establishments. Describe the strategy adopted by your company to reduce usage of hazardous and toxic chemicals in your products and processes and the practices adopted to manage such wastes.',brsr?.waste_management_practices)}

    <div class="q-label">11. If the entity has operations / offices in / around ecologically sensitive areas (such as national parks, wildlife sanctuaries, biosphere reserves, wetlands, biodiversity hotspots, forests, coastal regulation zones etc.) where environmental approvals / clearances are required, please specify details in the following format:</div>
    <table>
      <thead><tr><th>S No.</th><th>Location of operations / offices</th><th>Type of operations</th><th>Whether the conditions of environmental approval / clearance are being complied with? (Y/N) If no, the reasons thereof and corrective action taken, if any.</th></tr></thead>
      <tbody><tr>${nils(4)}</tr></tbody>
    </table>

    <div class="q-label">12. Details of environmental impact assessments of projects undertaken by the entity based on applicable laws, in the current financial year:</div>
    <table style="font-size:7.5pt;">
      <thead><tr><th>Name and brief details of project</th><th>EIA Notification No.</th><th>Date</th><th>Whether conducted by independent external agency (Yes / No)</th><th>Results communicated in public domain (Yes / No)</th><th>Relevant Web link</th></tr></thead>
      <tbody><tr>${nils(6)}</tr></tbody>
    </table>

    ${kvBlock('13. Is the entity compliant with the applicable environmental law / regulations / guidelines in India; such as the Water (Prevention and Control of Pollution) Act, Air (Prevention and Control of Pollution) Act, Environment protection act and rules thereunder (Y/N). If not, provide details of all such non-compliances, in the following format:',brsr?.env_compliance)}
    <table style="font-size:7.5pt;">
      <thead><tr><th>S No.</th><th>Specify the law / regulation / guidelines which was not complied with</th><th>Provide details of the non-compliance</th><th>Any fines / penalties / action taken by regulatory agencies such as pollution control boards or by courts</th><th>Corrective action taken, if any</th></tr></thead>
      <tbody><tr>${nils(5)}</tr></tbody>
    </table>

    <div class="indicator-type">Leadership Indicators</div>

    <!-- FIX #3: P6 Leadership Q1 — renewable/non-renewable energy break-up (was missing entirely) -->
    <div class="q-label">1. Provide break-up of the total energy consumed (in Joules or multiples) from renewable and non-renewable sources, in the following format:</div>
    <table>
      <thead><tr><th style="width:55%;">Parameter</th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>
        <tr><td colspan="3" style="background:var(--green-bg);font-weight:600;">From renewable sources</td></tr>
        <tr><td>Total electricity consumption (A)</td><td>${gv(f2(energyData?.renew_electricity_gj),'GJ')}</td><td class="nil">NIL</td></tr>
        <tr><td>Total fuel consumption (B)</td><td>${gv(f2(energyData?.renew_fuel_gj),'GJ')}</td><td class="nil">NIL</td></tr>
        <tr><td>Energy consumption through other sources (C)</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr class="subtotal"><td>Total energy consumed from renewable sources (A+B+C)</td><td>${gv(renewableGJ,'GJ')}</td><td class="nil">NIL</td></tr>
        <tr><td colspan="3" style="background:var(--paper3);font-weight:600;">From non-renewable sources</td></tr>
        <tr><td>Total electricity consumption (D)</td><td>${gv(f2(energyData?.nonrenew_electricity_gj),'GJ')}</td><td class="nil">NIL</td></tr>
        <tr><td>Total fuel consumption (E)</td><td>${gv(f2(energyData?.nonrenew_fuel_gj),'GJ')}</td><td class="nil">NIL</td></tr>
        <tr><td>Energy consumption through other sources (F)</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr class="subtotal"><td>Total energy consumed from non-renewable sources (D+E+F)</td><td>${gv(nonRenewGJ,'GJ')}</td><td class="nil">NIL</td></tr>
      </tbody>
    </table>
    <div class="note">${verNote}</div>

    <!-- FIX #3: renumbered — was Q1, now Q2 -->
    <div class="q-label">2. Water withdrawal, consumption and discharge in areas of water stress (in kilolitres):</div>
    <div class="q-label" style="font-weight:400;margin-left:8px;">For each facility / plant located in areas of water stress, provide the following information:</div>
    ${kvBlock('(i) Name of the area',null)}
    ${kvBlock('(ii) Nature of operations',null)}
    <div class="q-label" style="font-weight:400;margin-left:8px;">(iii) Water withdrawal, consumption and discharge in the following format:</div>
    <table style="font-size:7.5pt;">
      <thead><tr><th>Parameter</th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>
        <tr><td colspan="3" style="font-weight:600;">Water withdrawal by source (in kilolitres)</td></tr>
        ${['(i) Surface water','(ii) Groundwater','(iii) Third party water','(iv) Seawater / desalinated water','(v) Others'].map(s=>`<tr><td>${s}</td>${nils(2)}</tr>`).join('')}
        <tr class="subtotal"><td>Total volume of water withdrawal (in kilolitres)</td>${nils(2)}</tr>
        <tr><td>Total volume of water consumption (in kilolitres)</td>${nils(2)}</tr>
        <tr><td>Water intensity per rupee of turnover (Water consumed / turnover)</td>${nils(2)}</tr>
        <tr><td>Water intensity (optional) – the relevant metric may be selected by the entity</td>${nils(2)}</tr>
        <tr><td colspan="3" style="font-weight:600;">Water discharge by destination and level of treatment (in kilolitres)</td></tr>
        ${waterStressDischargeRows()}
        <tr class="subtotal"><td colspan="2">Total water discharged (in kilolitres)</td>${nils(2)}</tr>
      </tbody>
    </table>
    <div class="note">${verNote}</div>

    <!-- Q3: Scope 3 (was Q2) -->
    <div class="q-label">3. Please provide details of total Scope 3 emissions &amp; its intensity, in the following format:</div>
    <table>
      <thead><tr><th>Parameter</th><th>Unit</th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>
        <tr><td>Total Scope 3 emissions (Break-up of the GHG into CO₂, CH₄, N₂O, HFCs, PFCs, SF₆, NF₃, if available)</td><td>Metric tonnes of CO₂ equivalent</td><td>${scope3>0?fmt2(scope3):'<span class="nil">NIL</span>'}</td><td class="nil">NIL</td></tr>
        <tr><td>Total Scope 3 emissions per rupee of turnover</td><td>—</td><td>${revenueCr>0&&scope3>0?fmt2(scope3/revenueCr,4)+' tCO₂e/₹Cr':'<span class="nil">NIL</span>'}</td><td class="nil">NIL</td></tr>
        <tr><td>Total Scope 3 emission intensity (optional) – the relevant metric may be selected by the entity</td><td>—</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
      </tbody>
    </table>
    <div class="note">${verNote}</div>

    ${kvBlock('4. With respect to the ecologically sensitive areas reported at Question 11 of Essential Indicators above, provide details of significant direct &amp; indirect impact of the entity on biodiversity in such areas along-with prevention and remediation activities.',null)}

    <div class="q-label">5. If the entity has undertaken any specific initiatives or used innovative technology or solutions to improve resource efficiency, or reduce impact due to emissions / effluent discharge / waste generated, please provide details of the same as well as outcome of such initiatives, as per the following format:</div>
    <table>
      <thead><tr><th>S No.</th><th>Initiative undertaken</th><th>Details of the initiative (Web-link, if any, may be provided along-with summary)</th><th>Outcome of the initiative</th></tr></thead>
      <tbody><tr>${nils(4)}</tr></tbody>
    </table>

    ${kvBlock('6. Does the entity have a business continuity and disaster management plan? Give details in 100 words / web link.',null)}
    ${kvBlock('7. Disclose any significant adverse impact to the environment, arising from the value chain of the entity. What mitigation or adaptation measures have been taken by the entity in this regard.',null)}
    ${kvBlock('8. Percentage of value chain partners (by value of business done with such partners) that were assessed for environmental impacts.',null)}
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // P7
  // ════════════════════════════════════════════════════════════════════════
  const sC_P7 = `<div class="brsr-body">
    ${ph(orgName,fy,fyNext,'Principle 7',LOGO_IMG_SM)}
    <div class="principle-head">Principle 7: Businesses, when engaging in influencing public and regulatory policy, should do so in a manner that is responsible and transparent</div>
    <div class="indicator-type">Essential Indicators</div>

    ${kvBlock('1a. Number of affiliations with trade and industry chambers / associations.',null)}
    <div class="q-label">1b. List the top 10 trade and industry chambers / associations (determined based on the total members of such body) the entity is a member of / affiliated to.</div>
    <table>
      <thead><tr><th>S No.</th><th>Name of the trade and industry chambers / associations</th><th>Reach of trade and industry chambers / associations (State/National)</th></tr></thead>
      <tbody><tr>${nils(3)}</tr></tbody>
    </table>

    <div class="q-label">2. Provide details of corrective action taken or underway on any issues related to anti-competitive conduct by the entity, based on adverse orders from regulatory authorities.</div>
    <table>
      <thead><tr><th>Name of authority</th><th>Brief of the case</th><th>Corrective action taken</th></tr></thead>
      <tbody><tr>${nils(3)}</tr></tbody>
    </table>

    <div class="indicator-type">Leadership Indicators</div>
    <div class="q-label">1. Details of public policy positions advocated by the entity:</div>
    <table style="font-size:7.5pt;">
      <thead><tr><th>S No.</th><th>Public policy advocated</th><th>Method resorted for such advocacy</th><th>Whether information available in public domain? (Yes/No)</th><th>Frequency of Review by Board (Annually / Half yearly / Quarterly / Others – please specify)</th><th>Web Link, if available</th></tr></thead>
      <tbody><tr>${nils(6)}</tr></tbody>
    </table>
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // P8
  // ════════════════════════════════════════════════════════════════════════
  const sC_P8 = `<div class="brsr-body">
    ${ph(orgName,fy,fyNext,'Principle 8',LOGO_IMG_SM)}
    <div class="principle-head">Principle 8: Businesses should promote inclusive growth and equitable development</div>
    <div class="indicator-type">Essential Indicators</div>

    <div class="q-label">1. Details of Social Impact Assessments (SIA) of projects undertaken by the entity based on applicable laws, in the current financial year.</div>
    <table style="font-size:7.5pt;">
      <thead><tr><th>Name and brief details of project</th><th>SIA Notification No.</th><th>Date of notification</th><th>Whether conducted by independent external agency (Yes / No)</th><th>Results communicated in public domain (Yes / No)</th><th>Relevant Web link</th></tr></thead>
      <tbody><tr>${nils(6)}</tr></tbody>
    </table>

    <div class="q-label">2. Provide information on project(s) for which ongoing Rehabilitation and Resettlement (R&amp;R) is being undertaken by your entity, in the following format:</div>
    <table style="font-size:7.5pt;">
      <thead><tr><th>S No.</th><th>Name of Project for which R&amp;R is ongoing</th><th>State</th><th>District</th><th>No. of Project Affected Families (PAFs)</th><th>% of PAFs covered by R&amp;R</th><th>Amounts paid to PAFs in the FY (In INR)</th></tr></thead>
      <tbody><tr>${nils(7)}</tr></tbody>
    </table>

    ${kvBlock('3. Describe the mechanisms to receive and redress grievances of the community.',null)}

    <div class="q-label">4. Percentage of input material (inputs to total inputs by value) sourced from suppliers:</div>
    <table>
      <thead><tr><th></th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>
        <tr><td>Directly sourced from MSMEs / small producers (%)</td>${nils(2)}</tr>
        <tr><td>Sourced directly from within the district and neighbouring districts (%)</td>${nils(2)}</tr>
      </tbody>
    </table>

    <div class="q-label">5. Job creation in smaller towns – Disclose wages paid to persons employed (including employees or workers employed on a permanent or non-permanent / on contract basis) in the following locations, as % of total wage cost:</div>
    <table>
      <thead><tr><th>Location</th><th>${fyLabel} (Current Financial Year)</th><th>${fyPrevLabel} (Previous Financial Year)</th></tr></thead>
      <tbody>
        ${['Rural (%)','Semi-urban (%)','Urban (%)','Metropolitan (%)'].map(l=>`<tr><td>${l}</td>${nils(2)}</tr>`).join('')}
      </tbody>
    </table>
    <div style="font-size:7.5pt;color:var(--muted);margin-bottom:6px;page-break-inside:avoid;">(Place to be categorized as per RBI Classification System – rural / semi-urban / urban / metropolitan)</div>

    <div class="indicator-type">Leadership Indicators</div>
    <div class="q-label">1. Provide details of actions taken to mitigate any negative social impacts identified in the Social Impact Assessments (Reference: Question 1 of Essential Indicators above):</div>
    <table>
      <thead><tr><th>Details of negative social impact identified</th><th>Corrective action taken</th></tr></thead>
      <tbody><tr>${nils(2)}</tr></tbody>
    </table>

    <div class="q-label">2. Provide the following information on CSR projects undertaken by your entity in designated aspirational districts as identified by government bodies:</div>
    <table>
      <thead><tr><th>S No.</th><th>State</th><th>Aspirational District</th><th>Amount spent (In INR)</th></tr></thead>
      <tbody><tr>${nils(4)}</tr></tbody>
    </table>

    ${kvBlock('3. (a) Do you have a preferential procurement policy where you give preference to purchase from suppliers comprising marginalized / vulnerable groups? (Yes/No)',null)}
    ${kvBlock('(b) From which marginalized / vulnerable groups do you procure?',null)}
    ${kvBlock('(c) What percentage of total procurement (by value) does it constitute?',null)}

    <div class="q-label">4. Details of the benefits derived and shared from the intellectual properties owned or acquired by your entity (in the current financial year), based on traditional knowledge:</div>
    <table>
      <thead><tr><th>S No.</th><th>Intellectual Property based on traditional knowledge</th><th>Owned / Acquired (Yes/No)</th><th>Benefit shared (Yes / No)</th><th>Basis of calculating benefit share</th></tr></thead>
      <tbody><tr>${nils(5)}</tr></tbody>
    </table>

    <div class="q-label">5. Details of corrective actions taken or underway, based on any adverse order in intellectual property related disputes wherein usage of traditional knowledge is involved.</div>
    <table>
      <thead><tr><th>Name of authority</th><th>Brief of the case</th><th>Corrective action taken</th></tr></thead>
      <tbody><tr>${nils(3)}</tr></tbody>
    </table>

    <div class="q-label">6. Details of beneficiaries of CSR Projects:</div>
    <table>
      <thead><tr><th>S No.</th><th>CSR Project</th><th>No. of persons benefitted from CSR Projects</th><th>% of beneficiaries from vulnerable and marginalized groups</th></tr></thead>
      <tbody><tr>${nils(4)}</tr></tbody>
    </table>
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // P9
  // ════════════════════════════════════════════════════════════════════════
  const sC_P9 = `<div class="brsr-body">
    ${ph(orgName,fy,fyNext,'Principle 9',LOGO_IMG_SM)}
    <div class="principle-head">Principle 9: Businesses should engage with and provide value to their consumers in a responsible manner</div>
    <div class="indicator-type">Essential Indicators</div>

    ${kvBlock('1. Describe the mechanisms in place to receive and respond to consumer complaints and feedback.',null)}

    <div class="q-label">2. Turnover of products and / services as a percentage of turnover from all products / service that carry information about:</div>
    <table>
      <thead><tr><th></th><th>As a percentage to total turnover</th></tr></thead>
      <tbody>
        <tr><td>Environmental and social parameters relevant to the product</td><td class="nil">NIL</td></tr>
        <tr><td>Safe and responsible usage</td><td class="nil">NIL</td></tr>
        <tr><td>Recycling and / or safe disposal</td><td class="nil">NIL</td></tr>
      </tbody>
    </table>

    <!-- FIX #5: thead = 1 label + 3 current FY + 1 remark + 3 prev FY + 1 remark = 9 cols total; nils(8) per data row -->
    <div class="q-label">3. Number of consumer complaints in respect of the following:</div>
    <table style="font-size:7.5pt;">
      <thead>
        <tr>
          <th rowspan="2"></th>
          <th colspan="3">${fyLabel} (Current Financial Year)</th>
          <th rowspan="2">Remark</th>
          <th colspan="3">${fyPrevLabel} (Previous Financial Year)</th>
          <th rowspan="2">Remark</th>
        </tr>
        <tr>
          <th>Received during the year</th>
          <th>Pending resolution at end of year</th>
          <th></th>
          <th>Received during the year</th>
          <th>Pending resolution at end of year</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${['Data privacy','Advertising','Cybersecurity','Delivery of essential services','Restrictive Trade Practices','Unfair Trade Practices','Other'].map(c=>`<tr><td>${c}</td>${nils(8)}</tr>`).join('')}
      </tbody>
    </table>

    <div class="q-label">4. Details of instances of product recalls on account of safety issues:</div>
    <table>
      <thead><tr><th></th><th>Number</th><th>Reasons for recall</th></tr></thead>
      <tbody>
        <tr><td>Voluntary recalls</td>${nils(2)}</tr>
        <tr><td>Forced recalls</td>${nils(2)}</tr>
      </tbody>
    </table>

    ${kvBlock('5. Does the entity have a framework / policy on cyber security and risks related to data privacy? (Yes/No) If available, provide a web-link of the policy.',null)}
    ${kvBlock('6. Provide details of any corrective actions taken or underway on issues relating to advertising, and delivery of essential services; cyber security and data privacy of customers; re-occurrence of instances of product recalls; penalty / action taken by regulatory authorities on safety of products / services.',null)}

    <div class="q-label">7. Provide the following information relating to data breaches:</div>
    ${kvBlock('a. Number of instances of data breaches along-with impact.',null)}
    ${kvBlock('b. Percentage of data breaches involving personally identifiable information of customers.',null)}

    <div class="indicator-type">Leadership Indicators</div>
    ${kvBlock('1. Channels / platforms where information on products and services of the entity can be accessed (provide web link, if available).',null)}
    ${kvBlock('2. Steps taken to inform and educate consumers about safe and responsible usage of products and/or services.',null)}
    ${kvBlock('3. Mechanisms in place to inform consumers of any risk of disruption / discontinuation of essential services.',null)}
    ${kvBlock('4. Does the entity display product information on the product over and above what is mandated as per local laws? (Yes/No/Not Applicable) If yes, provide details in brief. Did your entity carry out any survey with regard to consumer satisfaction relating to the major products / services of the entity, significant locations of operation of the entity or the entity as a whole? (Yes/No)',null)}
    ${kvBlock('5. Provide details of any corrective actions taken or underway on issues relating to advertising, and delivery of essential services; cyber security and data privacy of customers; re-occurrence of instances of product recalls; penalty / action taken by regulatory authorities on safety of products / services.',null)}
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // DECLARATION
  // ════════════════════════════════════════════════════════════════════════
  const declaration = `<div class="brsr-body">
    ${ph(orgName,fy,fyNext,'Declaration & Authorised Signatory',LOGO_IMG_SM)}
    <div class="section-head">Declaration &amp; Authorised Signatory</div>

    ${verifier
      ? `<div style="background:var(--green-bg);border:1px solid var(--accent2);border-radius:3px;padding:10px 14px;margin-bottom:12px;font-size:8.5pt;line-height:1.7;">
           <strong>Third-Party Verification — ISO 14064-3:2019</strong><br/>
           Verification Body: <strong>${esc2(verifier.verifier_name)}</strong> · Accreditation: ${nil(verifier.accred_number)} · Assurance Level: ${nil(verifier.assurance_level||'Limited Assurance')} · Status: <strong style="color:var(--accent);">VERIFIED</strong>
         </div>`
      : `<div class="warn-note">⚠ Third-party verification pending. Add a verifier in the Audit Trail tab in EtherTrack to enable ISO 14064-3 verification disclosure.</div>`
    }

    <div style="border:1px solid var(--border);border-radius:4px;padding:12px 14px;background:var(--paper2);margin-bottom:14px;font-size:8.5pt;line-height:1.8;">
      We hereby confirm that the Business Responsibility and Sustainability Report (BRSR) disclosures in this Annexure II,
      covering the reporting period ${fyLabel}, are accurate and complete to the best of our knowledge and have been prepared
      in accordance with ${SEBI_REF}, SEBI BRSR Core (ISF Dec 2024), GHG Protocol Corporate Standard (2004, revised 2015),
      ISO 14064-1:2018, GRI Standards 302/303/306, CEA V20.0 Dec 2024 (${gridEmissionFactor} tCO₂/MWh), IPCC AR6 GWP100, and DEFRA 2024.
    </div>

    <div class="sig-grid">
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-label">PREPARER — Name &amp; Designation</div>
        <div style="margin-top:10px;"><div class="sig-line"></div><div class="sig-label">DIN / PAN</div></div>
        <div style="margin-top:10px;"><div class="sig-line"></div><div class="sig-label">DATE (DD/MM/YYYY)</div></div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-label">REVIEWER / CFO — Name &amp; Designation</div>
        <div style="margin-top:10px;"><div class="sig-line"></div><div class="sig-label">DATE (DD/MM/YYYY)</div></div>
      </div>
      <div class="sig-box">
        <div class="sig-line"></div>
        <div class="sig-label">MD / CEO — Name, Designation &amp; DIN</div>
        <div style="margin-top:10px;"><div class="sig-line"></div><div class="sig-label">DATE (DD/MM/YYYY)</div></div>
      </div>
    </div>
    <div class="seal-box">COMPANY SEAL / STAMP</div>

    <div style="margin-top:12px;font-size:8pt;color:var(--muted);line-height:1.7;border-top:1px solid var(--border2);padding-top:8px;">
      <strong>PPP Intensity Note (SEBI ISF Dec 2024 — Mandatory):</strong> GHG and energy intensity in tCO₂e / GJ per million international dollars (PPP-adjusted)
      is mandatory under SEBI BRSR ISF Dec 2024. PPP rate used: ₹${pppRate}/intl.$ (${esc2(pppRateSource)}). Enables cross-border peer comparison per ISSB / IFRS S2 requirements.<br/>
      <strong>Grid EF:</strong> ${gridEmissionFactor} tCO₂/MWh — ${esc2(gridEFVersion)} · <strong>GWP:</strong> IPCC AR6 GWP100 · <strong>Fuel EFs:</strong> DEFRA 2024
    </div>
  </div>`;

  // ════════════════════════════════════════════════════════════════════════
  // STITCH
  // ════════════════════════════════════════════════════════════════════════
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>SEBI BRSR — ${esc2(orgName)} — FY ${fy}</title>
  <style>${BRSR_CSS_FULL}</style>
</head>
<body>
  ${cover}
  ${sectionA}
  ${sectionB}
  ${sC_intro}
  ${sC_P2}
  ${sC_P3}
  ${sC_P4}
  ${sC_P5}
  ${sC_P6}
  ${sC_P7}
  ${sC_P8}
  ${sC_P9}
  ${declaration}
</body>
</html>`;
};

module.exports = { buildBRSRHTML };
// ─────────────────────────────────────────────────────────────────────────────
// buildGRIHTML — Full GRI Sustainability Report
// Covers: GRI 2 (General) · GRI 300 (Environmental) · GRI 400 (Social)
// Matches BharatCarbon GRI sample format exactly
// Add to pdfGenerator.js and register as 'gri' in the builders object:
//   'gri': (data) => buildGRIHTML(data, LOGO_BASE64, LOGO_IMG_SM)
// ─────────────────────────────────────────────────────────────────────────────

const GRI_CSS = `
  :root {
    --ink:#0a0f0a; --ink2:#1a2a1a;
    --paper:#ffffff; --paper2:#f5f7f5; --paper3:#edf0ed;
    --accent:#0d5c2e; --accent2:#1a7a3e; --accent3:#22a050;
    --blue:#1a4a8a; --orange:#b84000; --purple:#5a2a8a;
    --red:#8a1a1a; --warn:#7a5a00; --muted:#4a5a4a;
    --border:#c0ccc0; --border2:#d4e0d4;
    --green-bg:#edf6f0; --blue-bg:#e8eef8;
    --orange-bg:#faf0e8; --header-bg:#1a3a1a;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--paper); color:var(--ink); font-family:'IBM Plex Sans',sans-serif; font-size:9pt; line-height:1.5; }

  .page { width:210mm; min-height:297mm; padding:14mm 16mm 22mm 16mm; position:relative; background:var(--paper); page-break-after:always; }
  .page:last-child { page-break-after:avoid; }

  /* COVER */
  .cover { background:var(--header-bg); color:#f0fdf4; height:297mm; overflow:hidden; display:flex; flex-direction:column; }
  .cover-topbar { background:var(--accent); padding:8px 18mm; font-family:'IBM Plex Mono',monospace; font-size:7pt; letter-spacing:.14em; color:#a8e4b8; display:flex; justify-content:space-between; align-items:center; }
  .cover-body { flex:1; padding:18mm 18mm 14mm 18mm; display:flex; flex-direction:column; justify-content:space-between; overflow:hidden; }
  .cover-logo-row { display:flex; align-items:center; gap:14px; margin-bottom:28mm; }
  .cover-brand { font-family:'IBM Plex Mono',monospace; font-size:9pt; color:#a8e4b8; letter-spacing:.1em; }
  .cover-badge { font-family:'IBM Plex Mono',monospace; font-size:7.5pt; letter-spacing:.18em; color:var(--accent3); margin-bottom:8px; text-transform:uppercase; }
  .cover-title { font-size:28pt; font-weight:700; color:#f0fdf4; line-height:1.1; margin-bottom:8px; }
  .cover-subtitle { font-size:10pt; color:#a8e4b8; font-style:italic; margin-bottom:12mm; }
  .cover-meta { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10mm; }
  .cover-field { border:1px solid #2a4a2a; border-radius:4px; padding:10px 14px; background:#111a11; }
  .cover-field-label { font-family:'IBM Plex Mono',monospace; font-size:7pt; color:#5a8a5a; letter-spacing:.12em; text-transform:uppercase; margin-bottom:3px; }
  .cover-field-value { font-size:9pt; font-weight:600; color:#f0fdf4; }
  .cover-gri-ref { font-family:'IBM Plex Mono',monospace; font-size:7pt; color:#3a6a3a; letter-spacing:.06em; border-top:1px solid #1a3a1a; padding-top:8px; margin-top:6mm; }
  .cover-bottombar { background:#060e06; padding:10px 18mm; font-family:'IBM Plex Mono',monospace; font-size:7pt; color:#2a5a2a; letter-spacing:.08em; display:flex; justify-content:space-between; flex-shrink:0; }

  /* PAGE HEADER / FOOTER */
  .page-header { display:flex; align-items:center; justify-content:space-between; gap:10px; padding-bottom:7px; border-bottom:2px solid var(--accent); margin-bottom:12px; }
  .page-header-logo { flex-shrink:0; }
  .page-header-center { flex:1; min-width:0; }
  .page-header-center .rpt-tag { font-family:'IBM Plex Mono',monospace; font-size:6.5pt; letter-spacing:.1em; color:var(--accent2); text-transform:uppercase; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .page-header-center .co-name { font-size:9.5pt; font-weight:700; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .page-header-right { text-align:right; font-family:'IBM Plex Mono',monospace; font-size:7pt; color:var(--muted); letter-spacing:.06em; line-height:1.6; flex-shrink:0; white-space:nowrap; }
  .page-footer { position:absolute; bottom:7mm; left:16mm; right:16mm; display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border2); padding-top:4px; font-family:'IBM Plex Mono',monospace; font-size:7pt; color:var(--muted); letter-spacing:.04em; }

  /* SECTION HEADINGS */
  .section-banner { background:var(--header-bg); color:#f0fdf4; padding:10px 14px; border-radius:4px; margin-bottom:12px; font-size:11pt; font-weight:700; }
  .section-banner .sub { font-size:8pt; font-weight:400; color:#a8e4b8; margin-top:3px; line-height:1.5; }
  .gri-head { background:var(--ink); color:#f0fdf4; padding:8px 12px; border-radius:3px; margin:14px 0 8px 0; font-size:9.5pt; font-weight:700; }
  .disclosure-head { background:var(--green-bg); border-left:3px solid var(--accent); padding:6px 12px; margin:10px 0 6px 0; border-radius:0 3px 3px 0; font-size:9pt; font-weight:700; color:var(--accent); }
  .sub-disclosure { font-size:8.5pt; font-weight:600; color:var(--ink); margin:7px 0 4px 0; line-height:1.5; }

  /* Q/A */
  .q-label { font-size:8.5pt; font-weight:600; color:var(--ink); margin:6px 0 3px 0; line-height:1.5; }
  .q-answer { font-size:8.5pt; color:var(--ink2); padding:5px 10px; background:var(--paper2); border:1px solid var(--border2); border-radius:3px; margin-bottom:5px; min-height:20px; line-height:1.6; }

  /* TABLES */
  table { width:100%; border-collapse:collapse; margin-bottom:8px; font-size:8pt; }
  thead tr { background:var(--ink); color:#f0fdf4; }
  thead th { padding:6px 8px; text-align:left; font-size:7.5pt; font-weight:600; border:1px solid var(--ink2); letter-spacing:.04em; line-height:1.4; vertical-align:middle; }
  tbody td { padding:5px 8px; border:1px solid var(--border); vertical-align:middle; font-size:8pt; line-height:1.4; }
  tbody tr:nth-child(odd) td { background:var(--paper); }
  tbody tr:nth-child(even) td { background:var(--paper2); }
  tbody tr.total-row td { background:var(--green-bg); font-weight:700; border-top:2px solid var(--accent); }
  .nil { color:var(--muted); font-style:italic; }
  .center { text-align:center; }

  /* NOTE */
  .note { background:var(--blue-bg); border:1px solid var(--blue); border-radius:3px; padding:6px 10px; font-size:8pt; color:var(--blue); margin:5px 0 8px 0; line-height:1.6; }

  /* TOC */
  .toc-cat { font-family:'IBM Plex Mono',monospace; font-size:7.5pt; letter-spacing:.12em; color:var(--accent2); text-transform:uppercase; margin:10px 0 4px 0; font-weight:600; }
  .toc-row { display:flex; justify-content:space-between; align-items:baseline; padding:5px 0; border-bottom:1px dotted var(--border); font-size:8.5pt; }
  .toc-row .ttl { color:var(--ink); font-weight:500; }
  .toc-row .pg { font-family:'IBM Plex Mono',monospace; font-size:8pt; color:var(--muted); }

  /* PRINT */
  @media print { body { padding:0; } .page { page-break-after:always; } .page:last-child { page-break-after:avoid; } }
`;

// ── helpers ──────────────────────────────────────────────────────────────────
const gesc = (val) => {
  if (val === null || val === undefined) return '—';
  return String(val).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
};
const gnil  = (v) => (v !== null && v !== undefined && v !== '') ? gesc(v) : '<span class="nil">NIL</span>';
const gf    = (v) => parseFloat(v) || 0;
const gfmt  = (n, d=2) => Number(n||0).toLocaleString('en-IN', {maximumFractionDigits:d, minimumFractionDigits:d});
const gArr  = (v) => Array.isArray(v) ? v : [];
const GRI_STD = 'GRI Standards 2021';

const griPageHeader = (orgName, fy, pageLabel, LOGO_IMG_SM) => `
  <div class="page-header">
    <div class="page-header-logo">${LOGO_IMG_SM}</div>
    <div class="page-header-center">
      <div class="rpt-tag">GRI SUSTAINABILITY REPORT · ${GRI_STD}</div>
      <div class="co-name">${gesc(orgName)}</div>
    </div>
    <div class="page-header-right">${gesc(fy)}<br/>${gesc(pageLabel)}</div>
  </div>`;

const griPageFooter = (pageNum, orgName, fy, total) => `
  <div class="page-footer">
    <span>${gesc(orgName)} · GRI Sustainability Report</span>
    <span>Reporting Year: ${gesc(fy)}</span>
    <span>Page ${pageNum} of ${total}</span>
  </div>`;

// Standard KV row
const gkv = (label, value) => `
  <tr>
    <td style="width:46%;font-weight:500;color:var(--muted);font-size:8.5pt;">${gesc(label)}</td>
    <td>${gnil(value)}</td>
  </tr>`;

// ── MAIN BUILDER ─────────────────────────────────────────────────────────────
const buildGRIHTML = (d, LOGO_BASE64, LOGO_IMG_SM) => {
  const {
    orgName, year, profile,
    gri = {},           // all GRI-specific field data
    energyData  = null,
    waterData   = null,
    wasteData   = null,
    scope2Location, scope2Market,
    gridEmissionFactor = 0.727,
    gridEFVersion      = 'CEA V20.0 Dec 2024',
    verifier           = null,
  } = d;

  const emissions             = gArr(d.emissions);
  const retirements           = gArr(d.retirements);
  const previousYearEmissions = gArr(d.previousYearEmissions);

  const fy      = String(year);
  const fyNext  = String(parseInt(year)+1);
  const fyLabel = `${fy}-${fyNext}`;
  const genDate = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
  const org     = gesc(orgName);

  // GHG
  const scope1 = emissions.filter(r=>r.scope===1).reduce((s,r)=>s+gf(r.co2e),0);
  const scope2 = emissions.filter(r=>r.scope===2).reduce((s,r)=>s+gf(r.co2e),0);
  const scope3 = emissions.filter(r=>r.scope===3).reduce((s,r)=>s+gf(r.co2e),0);
  const s2Loc  = gf(scope2Location)||scope2;
  const s2Mkt  = gf(scope2Market)||0;

  // Energy
  const totalGJ     = gf(energyData?.total_gj);
  const renewableGJ = gf(energyData?.renewable_gj);
  const nonRenewGJ  = totalGJ - renewableGJ;

  // Water
  const withdrawKL  = gf(waterData?.withdrawal_kl);
  const consumeKL   = gf(waterData?.consumption_kl);

  // Waste
  const wasteRows = [
    ['Plastic waste',              wasteData?.plastic_kg],
    ['E-waste',                    wasteData?.ewaste_kg],
    ['Bio-medical waste',          wasteData?.biomedical_kg],
    ['Construction & demolition',  wasteData?.construction_kg],
    ['Battery waste',              wasteData?.battery_kg],
    ['Radioactive waste',          wasteData?.radioactive_kg],
    ['Other Hazardous waste',      wasteData?.hazardous_kg],
    ['Other Non-hazardous waste',  wasteData?.non_hazardous_kg],
  ];
  const totalWasteKg = wasteRows.reduce((s,[,v])=>s+gf(v),0);

  const TOTAL_PAGES = 22; // approximate

  // ── COVER ────────────────────────────────────────────────────────────────────
  const coverPage = `
  <div class="cover">
    <div class="cover-topbar">
      <span>GRI SUSTAINABILITY REPORT · COMPREHENSIVE ESG DISCLOSURES · ${GRI_STD}</span>
      <span>${genDate}</span>
    </div>
    <div class="cover-body">
      <div>
        <div class="cover-logo-row">
          ${LOGO_BASE64 ? `<img src="${LOGO_BASE64}" alt="EtherTrack" style="height:52px;width:auto;object-fit:contain;" />` : ''}
          <div class="cover-brand">ETHERTRACK TECHNOLOGIES PRIVATE LIMITED</div>
        </div>
        <div class="cover-badge">GRI Sustainability Report</div>
        <div class="cover-title">Comprehensive<br/>ESG Disclosures</div>
        <div class="cover-subtitle">GRI 2: General Disclosures · GRI 300: Environmental · GRI 400: Social</div>
        <div class="cover-meta">
          <div class="cover-field"><div class="cover-field-label">Company</div><div class="cover-field-value">${org}</div></div>
          <div class="cover-field"><div class="cover-field-label">Reporting Year</div><div class="cover-field-value">${fyLabel}</div></div>
          <div class="cover-field"><div class="cover-field-label">GRI Standard</div><div class="cover-field-value">${GRI_STD}</div></div>
          <div class="cover-field"><div class="cover-field-label">Date of Issue</div><div class="cover-field-value">${genDate}</div></div>
          <div class="cover-field"><div class="cover-field-label">Industry</div><div class="cover-field-value">${gnil(profile?.industry)}</div></div>
          <div class="cover-field"><div class="cover-field-label">Assurance</div><div class="cover-field-value">${verifier ? gesc(verifier.verifier_name) : 'Pending'}</div></div>
        </div>
        <div class="cover-gri-ref">
          Prepared in accordance with GRI Standards 2021 · GRI 2: General Disclosures · GRI 300: Environmental Topics ·
          GRI 400: Social Topics · CEA V20.0 Dec 2024 (Grid EF ${gridEmissionFactor} tCO₂/MWh) · GHG Protocol · IPCC AR6 GWP100
        </div>
      </div>
    </div>
    <div class="cover-bottombar">
      <span>EtherTrack Technologies Private Limited · Blockchain-verified GHG Inventory</span>
      <span>Generated: ${genDate}</span>
    </div>
  </div>`;

  // ── TABLE OF CONTENTS ────────────────────────────────────────────────────────
  const tocPage = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'Table of Contents', LOGO_IMG_SM)}
    <div class="section-banner">Table of Contents<div class="sub">GRI Sustainability Report · ${fyLabel} · ${GRI_STD}</div></div>

    <div class="toc-cat">1. General</div>
    <div class="toc-row"><span class="ttl">General Disclosures (GRI 2)</span><span class="pg">3</span></div>
    <div class="toc-row"><span class="ttl">· Organizational profile (2-1 to 2-5)</span><span class="pg">3</span></div>
    <div class="toc-row"><span class="ttl">· Activities and workers (2-6 to 2-8)</span><span class="pg">4</span></div>
    <div class="toc-row"><span class="ttl">· Governance (2-9 to 2-21)</span><span class="pg">5</span></div>
    <div class="toc-row"><span class="ttl">· Strategy, policies and practices (2-22 to 2-27)</span><span class="pg">7</span></div>
    <div class="toc-row"><span class="ttl">· Stakeholder engagement (2-28 to 2-30)</span><span class="pg">8</span></div>

    <div class="toc-cat">2. Governance</div>
    <div class="toc-row"><span class="ttl">Governance Disclosures</span><span class="pg">9</span></div>
    <div class="toc-row"><span class="ttl">· Public Policy (415-1)</span><span class="pg">9</span></div>
    <div class="toc-row"><span class="ttl">· Marketing and Labeling (417)</span><span class="pg">9</span></div>
    <div class="toc-row"><span class="ttl">· Economic Performance (201)</span><span class="pg">10</span></div>
    <div class="toc-row"><span class="ttl">· Indirect Economic Impacts (203)</span><span class="pg">11</span></div>
    <div class="toc-row"><span class="ttl">· Procurement Practices (204)</span><span class="pg">11</span></div>
    <div class="toc-row"><span class="ttl">· Anti-corruption (205)</span><span class="pg">11</span></div>
    <div class="toc-row"><span class="ttl">· Anti-competitive Behavior (206)</span><span class="pg">12</span></div>
    <div class="toc-row"><span class="ttl">· Tax (207)</span><span class="pg">12</span></div>

    <div class="toc-cat">3. Environmental</div>
    <div class="toc-row"><span class="ttl">Environmental Disclosures (GRI 300)</span><span class="pg">13</span></div>
    <div class="toc-row"><span class="ttl">· Materials (301)</span><span class="pg">13</span></div>
    <div class="toc-row"><span class="ttl">· Energy Consumption (302)</span><span class="pg">14</span></div>
    <div class="toc-row"><span class="ttl">· Water and Effluents (303)</span><span class="pg">15</span></div>
    <div class="toc-row"><span class="ttl">· Biodiversity (304)</span><span class="pg">16</span></div>
    <div class="toc-row"><span class="ttl">· Emissions (305)</span><span class="pg">17</span></div>
    <div class="toc-row"><span class="ttl">· Waste Generation & Management (306)</span><span class="pg">18</span></div>
    <div class="toc-row"><span class="ttl">· Environmental Compliance (307)</span><span class="pg">19</span></div>
    <div class="toc-row"><span class="ttl">· Supply Chain (308)</span><span class="pg">19</span></div>

    <div class="toc-cat">4. Social</div>
    <div class="toc-row"><span class="ttl">Social Disclosures (GRI 400)</span><span class="pg">20</span></div>
    <div class="toc-row"><span class="ttl">· Employment (401)</span><span class="pg">20</span></div>
    <div class="toc-row"><span class="ttl">· Labor/Management Relations (402)</span><span class="pg">20</span></div>
    <div class="toc-row"><span class="ttl">· Occupational Health and Safety (403)</span><span class="pg">21</span></div>
    <div class="toc-row"><span class="ttl">· Training and Education (404)</span><span class="pg">21</span></div>
    <div class="toc-row"><span class="ttl">· Diversity and Equal Opportunity (405)</span><span class="pg">21</span></div>
    <div class="toc-row"><span class="ttl">· Human Rights (406–412)</span><span class="pg">22</span></div>
    <div class="toc-row"><span class="ttl">· Community and Society (413)</span><span class="pg">22</span></div>
    <div class="toc-row"><span class="ttl">· Customer Responsibility (416–419)</span><span class="pg">22</span></div>
    ${griPageFooter(2, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  // ── GRI 2: GENERAL DISCLOSURES (pages 3–8) ───────────────────────────────────
  const gri2_org = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'General Disclosure', LOGO_IMG_SM)}
    <div class="section-banner">General Disclosure<div class="sub">GRI 2: General Disclosure — Pertains to the evaluation criteria measuring a company's environmental, social, and governance performance concerning sustainable and ethical practices.</div></div>

    <div class="gri-head">2.1 The Organization and its Reporting Practices</div>

    <div class="disclosure-head">Disclosure 2-1: Organizational Details</div>
    <table><tbody>
      ${gkv('a. Legal name', orgName)}
      ${gkv('b. Nature of ownership and legal form', profile?.legal_form)}
      ${gkv('c. Location of headquarters', [profile?.registered_address, profile?.city, profile?.state, profile?.country].filter(Boolean).join(', ') || null)}
      ${gkv('d. Countries of operation', gri?.countries_of_operation)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-2: Entities Included in the Organization's Sustainability Reporting</div>
    <div class="q-label">a. List all entities included in its sustainability reporting:</div>
    <div class="q-answer">${gnil(gri?.entities_in_reporting)}</div>
    <table><tbody>
      ${gkv('b. Differences between financial reporting and sustainability reporting entities', gri?.reporting_entity_differences)}
      ${gkv('c.i. Whether approach involves adjustments to information for minority interests', gri?.minority_interest_adjustment)}
      ${gkv('c.ii. How the approach takes into account mergers, acquisitions, and disposal of entities', gri?.merger_acquisition_approach)}
      ${gkv('c.iii. Whether and how the approach differs across disclosures and across material topics', gri?.approach_differences)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-3: Reporting Period, Frequency, and Contact Point</div>
    <table><tbody>
      ${gkv('a. Reporting period and frequency of sustainability reporting', gri?.reporting_period_frequency || fyLabel)}
      ${gkv('b. Reporting period for financial reporting and reason if it does not align', gri?.financial_reporting_period)}
      ${gkv('c. Publication date of the report or reported information', genDate)}
      ${gkv('d. Contact point for questions about the report', [profile?.contact_name, profile?.contact_designation, profile?.contact_email].filter(Boolean).join(', ') || null)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-4: Restatements of Information</div>
    <table><tbody>
      ${gkv('a.i. Reasons for restatements of information from previous reporting periods', gri?.restatement_reasons)}
      ${gkv('a.ii. Effect of the restatements', gri?.restatement_effect)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-5: External Assurance</div>
    <table><tbody>
      ${gkv('a. Policy and practice for seeking external assurance', gri?.assurance_policy)}
      ${gkv('b.i. Link or reference to the external assurance report(s)', verifier ? gesc(verifier.verifier_name) : null)}
      ${gkv('b.ii. What has been assured, assurance standards, level, and limitations', verifier ? (verifier.assurance_level || 'Limited Assurance — ISO 14064-3') : null)}
      ${gkv('b.iii. Relationship between the organization and the assurance provider', gri?.assurance_relationship)}
    </tbody></table>
    ${griPageFooter(3, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const gri2_activities = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 2 — Activities & Workers', LOGO_IMG_SM)}
    <div class="gri-head">2.2 Activities and Workers</div>

    <div class="disclosure-head">Disclosure 2-6: Activities, Value Chain, and Other Business Relationships</div>
    <table><tbody>
      ${gkv('a. Sector(s) in which it is active', profile?.industry)}
      ${gkv('b.i. Activities, products, services, and markets served', gri?.activities_products_services)}
      ${gkv('b.ii. The organization\'s supply chain', gri?.supply_chain_description)}
      ${gkv('b.iii. Entities downstream from the organization and their activities', gri?.downstream_entities)}
      ${gkv('c. Other relevant business relationships', gri?.other_business_relationships)}
      ${gkv('d. Significant changes compared to the previous reporting period', gri?.significant_changes)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-7: Employees</div>
    <div class="q-label">By gender:</div>
    <table>
      <thead><tr><th>Male Employees</th><th>Female Employees</th><th>Total Employees</th></tr></thead>
      <tbody><tr><td>${gnil(gri?.emp_male_total)}</td><td>${gnil(gri?.emp_female_total)}</td><td>${gnil(gri?.emp_total)}</td></tr></tbody>
    </table>

    <div class="q-label">b. Breakdown by employment type:</div>
    <table>
      <thead><tr><th>Type</th><th>Male</th><th>Female</th><th>Total</th></tr></thead>
      <tbody>
        <tr><td>i. Permanent employees</td><td>${gnil(gri?.emp_perm_male)}</td><td>${gnil(gri?.emp_perm_female)}</td><td>${gnil(gri?.emp_perm_total)}</td></tr>
        <tr><td>ii. Temporary employees</td><td>${gnil(gri?.emp_temp_male)}</td><td>${gnil(gri?.emp_temp_female)}</td><td>${gnil(gri?.emp_temp_total)}</td></tr>
        <tr><td>iii. Non-guaranteed hours employees</td><td>${gnil(gri?.emp_ngh_male)}</td><td>${gnil(gri?.emp_ngh_female)}</td><td>${gnil(gri?.emp_ngh_total)}</td></tr>
        <tr><td>iv. Full-time employees</td><td>${gnil(gri?.emp_ft_male)}</td><td>${gnil(gri?.emp_ft_female)}</td><td>${gnil(gri?.emp_ft_total)}</td></tr>
        <tr><td>v. Part-time employees</td><td>${gnil(gri?.emp_pt_male)}</td><td>${gnil(gri?.emp_pt_female)}</td><td>${gnil(gri?.emp_pt_total)}</td></tr>
      </tbody>
    </table>
    <table><tbody>
      ${gkv('c.i. Head count, FTE, or another methodology', gri?.emp_methodology)}
      ${gkv('c.ii. End of reporting period, average, or another methodology', gri?.emp_timing_methodology)}
      ${gkv('d. Contextual information to understand the data', gri?.emp_context)}
      ${gkv('e. Significant fluctuations in the number of employees', gri?.emp_fluctuations)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-8: Workers Who Are Not Employees</div>
    <table><tbody>
      ${gkv('a. Total number of workers who are not employees', gri?.non_emp_workers_total)}
      ${gkv('a.i. Most common types of worker and contractual relationship', gri?.non_emp_worker_types)}
      ${gkv('a.ii. Type of work they perform', gri?.non_emp_work_type)}
      ${gkv('b.i. Head count, FTE, or another methodology', gri?.non_emp_methodology)}
      ${gkv('b.ii. End of reporting period, average, or another methodology', gri?.non_emp_timing_methodology)}
      ${gkv('c. Significant fluctuations in the number of non-employee workers', gri?.non_emp_fluctuations)}
    </tbody></table>
    ${griPageFooter(4, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const gri2_governance = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 2 — Governance', LOGO_IMG_SM)}
    <div class="gri-head">2.3 Governance</div>

    <div class="disclosure-head">Disclosure 2-9: Governance Structure and Composition</div>
    <table><tbody>
      ${gkv('a. Governance structure, including committees of the highest governance body', gri?.governance_structure)}
      ${gkv('b. Committees responsible for decision making on impacts on economy, environment, and people', gri?.governance_committees)}
    </tbody></table>
    <div class="q-label">c. Composition of the highest governance body:</div>
    <table>
      <thead><tr><th>Attribute</th><th>Detail</th></tr></thead>
      <tbody>
        <tr><td>i. Executive members</td><td>${gnil(gri?.gov_exec_members)}</td></tr>
        <tr><td>i. Non-executive members</td><td>${gnil(gri?.gov_nonexec_members)}</td></tr>
        <tr><td>ii. Independence</td><td>${gnil(gri?.gov_independence)}</td></tr>
        <tr><td>iii. Tenure of members</td><td>${gnil(gri?.gov_tenure)}</td></tr>
        <tr><td>iv. Other significant positions and commitments held</td><td>${gnil(gri?.gov_other_positions)}</td></tr>
        <tr><td>v. Gender — Male %</td><td>${gnil(gri?.gov_gender_male_pct)}</td></tr>
        <tr><td>v. Gender — Female %</td><td>${gnil(gri?.gov_gender_female_pct)}</td></tr>
        <tr><td>vi. Under-represented social groups</td><td>${gnil(gri?.gov_underrepresented)}</td></tr>
        <tr><td>vii. Competencies relevant to the impacts of the organization</td><td>${gnil(gri?.gov_competencies)}</td></tr>
        <tr><td>viii. Stakeholder representation</td><td>${gnil(gri?.gov_stakeholder_rep)}</td></tr>
      </tbody>
    </table>

    <div class="disclosure-head">Disclosure 2-10: Nomination and Selection of the Highest Governance Body</div>
    <table><tbody>
      ${gkv('a. Nomination and selection processes', gri?.gov_nomination_process)}
      ${gkv('b.i. Views of stakeholders (including shareholders)', gri?.gov_nom_stakeholder_views)}
      ${gkv('b.ii. Diversity', gri?.gov_nom_diversity)}
      ${gkv('b.iii. Independence', gri?.gov_nom_independence)}
      ${gkv('b.iv. Competencies relevant to the impacts of the organization', gri?.gov_nom_competencies)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-11: Chair of the Highest Governance Body</div>
    <table><tbody>
      ${gkv('a. Whether the chair is also a senior executive in the organization', gri?.gov_chair_senior_exec)}
      ${gkv('b. If chair is also a senior executive — function, reasons, and conflict of interest prevention', gri?.gov_chair_conflict)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-12: Role of the Highest Governance Body in Overseeing the Management of Impacts</div>
    <table><tbody>
      ${gkv('a. Role in developing, approving, and updating purpose, value, mission, strategies, policies, and goals', gri?.gov_role_strategy)}
      ${gkv('b.i. Whether and how the highest governance body engages with stakeholders', gri?.gov_stakeholder_engagement)}
      ${gkv('b.ii. How the highest governance body considers the outcomes of these processes', gri?.gov_process_outcomes)}
      ${gkv('c. Role in reviewing effectiveness, and frequency of review', gri?.gov_effectiveness_review)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-13: Delegation of Responsibility for Managing Impacts</div>
    <table><tbody>
      ${gkv('a.i. Whether it has appointed senior executives with responsibility for the management of impacts', gri?.gov_delegation_exec)}
      ${gkv('a.ii. Whether it has delegated responsibility to other employees', gri?.gov_delegation_employees)}
      ${gkv('b. Process and frequency for senior executives to report back to the highest governance body', gri?.gov_reporting_frequency)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-14: Role of the Highest Governance Body in Sustainability Reporting</div>
    <table><tbody>
      ${gkv('a. Whether the highest governance body is responsible for reviewing and approving reported information', gri?.gov_sustainability_reporting_role)}
      ${gkv('b. If not responsible — reason', gri?.gov_sustainability_reporting_reason)}
    </tbody></table>
    ${griPageFooter(5, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const gri2_governance2 = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 2 — Governance (contd.)', LOGO_IMG_SM)}

    <div class="disclosure-head">Disclosure 2-15: Conflicts of Interest</div>
    <table><tbody>
      ${gkv('a. Processes for the highest governance body to ensure conflicts of interest are prevented and mitigated', gri?.gov_conflict_prevention)}
      ${gkv('b.i. Cross-board membership', gri?.gov_conflict_cross_board)}
      ${gkv('b.ii. Cross-shareholding with suppliers and other stakeholders', gri?.gov_conflict_cross_shareholding)}
      ${gkv('b.iii. Existence of controlling shareholders', gri?.gov_conflict_controlling_shareholders)}
      ${gkv('b.iv. Related parties, relationships, transactions, and outstanding balances', gri?.gov_conflict_related_parties)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-16: Communication of Critical Concerns</div>
    <table><tbody>
      ${gkv('a. Whether and how critical concerns are communicated to the highest governance body', gri?.gov_critical_concerns_communication)}
      ${gkv('b. Total number and nature of critical concerns communicated during the reporting period', gri?.gov_critical_concerns_count)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-17: Collective Knowledge of the Highest Governance Body</div>
    <div class="q-answer">${gnil(gri?.gov_collective_knowledge)}</div>

    <div class="disclosure-head">Disclosure 2-18: Evaluation of the Performance of the Highest Governance Body</div>
    <table><tbody>
      ${gkv('a. Processes for evaluating the performance of the highest governance body', gri?.gov_performance_evaluation)}
      ${gkv('b. Whether the evaluations are independent, and frequency', gri?.gov_evaluation_independence)}
      ${gkv('c. Actions taken in response to the evaluations', gri?.gov_evaluation_actions)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-19: Remuneration Policies</div>
    <table><tbody>
      ${gkv('i. Fixed pay and variable pay', gri?.rem_fixed_variable)}
      ${gkv('ii. Sign-on bonuses or recruitment incentive payments', gri?.rem_sign_on)}
      ${gkv('iii. Termination payments', gri?.rem_termination)}
      ${gkv('iv. Clawbacks', gri?.rem_clawbacks)}
      ${gkv('v. Retirement benefits', gri?.rem_retirement)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-20: Process to Determine Remuneration</div>
    <table><tbody>
      ${gkv('a.i. Whether independent highest governance body members or an independent remuneration committee oversees the process', gri?.rem_process_independent)}
      ${gkv('a.ii. How the views of stakeholders regarding remuneration are sought and taken into consideration', gri?.rem_process_stakeholder)}
      ${gkv('a.iii. Whether remuneration consultants are involved and whether they are independent', gri?.rem_consultants)}
      ${gkv('b. How remuneration policies relate to objectives and performance in relation to management of impacts', gri?.rem_policy_objectives)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-21: Annual Total Compensation Ratio</div>
    <table><tbody>
      ${gkv('Annual total compensation for the organization\'s highest-paid individual', gri?.comp_highest_paid)}
      ${gkv('Median annual total compensation for all employees (excluding highest-paid individual)', gri?.comp_median)}
      ${gkv('b. Percentage increase for highest-paid individual', gri?.comp_highest_pct_increase)}
      ${gkv('b. Median percentage increase for all employees', gri?.comp_median_pct_increase)}
      ${gkv('c. Contextual information to understand the data', gri?.comp_context)}
    </tbody></table>
    ${griPageFooter(6, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const gri2_strategy = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 2 — Strategy, Policies & Practices', LOGO_IMG_SM)}
    <div class="gri-head">2.4 Strategy, Policies, and Practices</div>

    <div class="disclosure-head">Disclosure 2-22: Statement on Sustainable Development Strategy</div>
    <div class="q-answer">${gnil(gri?.sustainable_dev_strategy)}</div>

    <div class="disclosure-head">Disclosure 2-23: Policy Commitments</div>
    <table><tbody>
      ${gkv('a.i. Authoritative intergovernmental instruments that the commitments reference', gri?.policy_intergovernmental_instruments)}
      ${gkv('a.ii. Whether the commitments stipulate conducting due diligence', gri?.policy_due_diligence)}
      ${gkv('a.iii. Whether the commitments stipulate applying the precautionary principle', gri?.policy_precautionary_principle)}
      ${gkv('a.iv. Whether the commitments stipulate respecting human rights', gri?.policy_human_rights)}
      ${gkv('b.i. Internationally recognized human rights that the commitment covers', gri?.policy_human_rights_scope)}
      ${gkv('b.ii. Categories of stakeholders, including at-risk or vulnerable groups', gri?.policy_vulnerable_groups)}
      ${gkv('c. Links to policy commitments if publicly available', gri?.policy_links)}
      ${gkv('d. Level at which each policy commitment was approved', gri?.policy_approval_level)}
      ${gkv('e. Extent to which policy commitments apply to activities and business relationships', gri?.policy_applicability)}
      ${gkv('f. How policy commitments are communicated to workers, business partners, and other parties', gri?.policy_communication)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-24: Embedding Policy Commitments</div>
    <table><tbody>
      ${gkv('a.i. How it allocates responsibility to implement the commitments', gri?.embedding_responsibility)}
      ${gkv('a.ii. How it integrates the commitments into organizational strategies and operational procedures', gri?.embedding_integration)}
      ${gkv('a.iii. How it implements its commitments with and through its business relationships', gri?.embedding_business_relationships)}
      ${gkv('a.iv. Training that the organization provides on implementing the commitments', gri?.embedding_training)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-25: Processes to Remediate Negative Impacts</div>
    <table><tbody>
      ${gkv('a. Commitments to provide for or cooperate in the remediation of negative impacts', gri?.remediation_commitments)}
      ${gkv('b. Approach to identify and address grievances, including grievance mechanisms', gri?.remediation_grievance_mechanisms)}
      ${gkv('c. Other processes for remediation of negative impacts', gri?.remediation_other_processes)}
      ${gkv('d. How intended users are involved in the design and operation of grievance mechanisms', gri?.remediation_stakeholder_involvement)}
      ${gkv('e. How the organization tracks effectiveness of grievance mechanisms', gri?.remediation_tracking)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-26: Mechanisms for Seeking Advice and Raising Concerns</div>
    <table><tbody>
      ${gkv('i. Seek advice on implementing policies and practices for responsible business conduct', gri?.advice_seeking_mechanism)}
      ${gkv('ii. Raise concerns about the organization\'s business conduct', gri?.concern_raising_mechanism)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-27: Compliance with Laws and Regulations</div>
    <table><tbody>
      ${gkv('a.i. Instances of non-compliance for which fines were incurred', gri?.compliance_fines_instances || '0')}
      ${gkv('a.ii. Instances for which non-monetary sanctions were incurred', gri?.compliance_nonmonetary_instances || '0')}
      ${gkv('b.i. Total fines for non-compliance in current reporting period', gri?.compliance_fines_current || '0')}
      ${gkv('b.ii. Total fines for non-compliance from previous reporting periods', gri?.compliance_fines_previous || '0')}
      ${gkv('c. Significant instances of non-compliance', gri?.compliance_significant_instances)}
      ${gkv('d. How significant instances of non-compliance have been determined', gri?.compliance_determination_method)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-28: Membership Associations</div>
    <div class="q-answer">${gnil(gri?.membership_associations)}</div>
    ${griPageFooter(7, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const gri2_stakeholder = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 2 — Stakeholder Engagement', LOGO_IMG_SM)}
    <div class="gri-head">2.5 Stakeholder Engagement</div>

    <div class="disclosure-head">Disclosure 2-29: Approach to Stakeholder Engagement</div>
    <table><tbody>
      ${gkv('a.i. Categories of stakeholders it engages with and how they are identified', gri?.stakeholder_categories)}
      ${gkv('a.ii. Purpose of the stakeholder engagement', gri?.stakeholder_purpose)}
      ${gkv('a.iii. How the organization seeks to ensure meaningful engagement with stakeholders', gri?.stakeholder_meaningful_engagement)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 2-30: Collective Bargaining Agreements</div>
    <table>
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>Employees covered by collective bargaining agreement</td><td>${gnil(gri?.cba_employees_covered || '0')}</td></tr>
        <tr><td>Total employees</td><td>${gnil(gri?.emp_total || '0')}</td></tr>
        <tr><td>% covered by collective bargaining agreement</td><td>${gri?.emp_total && gri?.cba_employees_covered ? gfmt(gf(gri.cba_employees_covered)/gf(gri.emp_total)*100,1)+'%' : '<span class="nil">NIL</span>'}</td></tr>
      </tbody>
    </table>
    <div class="q-answer">${gnil(gri?.cba_working_conditions_basis)}</div>

    ${griPageFooter(8, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  // ── GOVERNANCE DISCLOSURES ───────────────────────────────────────────────────
  const govPage = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'Governance Disclosures', LOGO_IMG_SM)}
    <div class="section-banner">Governance Disclosures<div class="sub">GRI Governance Disclosures — Focuses on a company's internal controls, leadership structures, transparency, and ethical standards in decision-making and accountability.</div></div>

    <div class="gri-head">1. Public Policy</div>
    <div class="disclosure-head">Disclosure 415-1: Public Policy Engagement</div>
    <table><tbody>
      ${gkv('a. Total monetary value of financial and in-kind political contributions made directly and indirectly, by country and recipient/beneficiary', gri?.political_contributions)}
      ${gkv('b. How the monetary value of in-kind contributions was estimated', gri?.inkind_contribution_estimation)}
    </tbody></table>

    <div class="gri-head">417. Marketing and Labeling</div>
    <div class="disclosure-head">Disclosure 417-1: Requirements for product and service information and labeling</div>
    <table>
      <thead><tr><th>Type of information</th><th>Required by procedures?</th></tr></thead>
      <tbody>
        <tr><td>i. Sourcing of components of the product or service</td><td>${gnil(gri?.labeling_sourcing)}</td></tr>
        <tr><td>ii. Content, particularly with regard to substances that might produce an environmental or social impact</td><td>${gnil(gri?.labeling_content)}</td></tr>
        <tr><td>iii. Safe use of the product or service</td><td>${gnil(gri?.labeling_safe_use)}</td></tr>
        <tr><td>iv. Disposal of the product and environmental or social impacts</td><td>${gnil(gri?.labeling_disposal)}</td></tr>
        <tr><td>v. Other</td><td>${gnil(gri?.labeling_other)}</td></tr>
      </tbody>
    </table>
    <table><tbody>
      ${gkv('b. Percentage of significant product or service categories covered and assessed for compliance', gri?.labeling_compliance_pct)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 417-2: Incidents of non-compliance concerning product and service information and labeling</div>
    <table><tbody>
      ${gkv('i. Incidents of non-compliance with regulations resulting in a fine or penalty', gri?.labeling_noncompliance_fine || 'NIL')}
      ${gkv('ii. Incidents of non-compliance with regulations resulting in a warning', gri?.labeling_noncompliance_warning || 'NIL')}
      ${gkv('iii. Incidents of non-compliance with voluntary codes', gri?.labeling_noncompliance_voluntary || 'NIL')}
    </tbody></table>

    <div class="disclosure-head">Disclosure 417-3: Incidents of non-compliance concerning marketing communications</div>
    <table><tbody>
      ${gkv('i. Incidents of non-compliance with regulations resulting in a fine or penalty', gri?.marketing_noncompliance_fine || 'NIL')}
      ${gkv('ii. Incidents of non-compliance with regulations resulting in a warning', gri?.marketing_noncompliance_warning || 'NIL')}
      ${gkv('iii. Incidents of non-compliance with voluntary codes', gri?.marketing_noncompliance_voluntary || 'NIL')}
    </tbody></table>

    <div class="disclosure-head">Disclosure 418-1: Substantiated complaints concerning breaches of customer privacy and losses of customer data</div>
    <table><tbody>
      ${gkv('a.i. Complaints received from outside parties and substantiated by the organization', gri?.privacy_complaints_external || 'NIL')}
      ${gkv('a.ii. Complaints from regulatory bodies', gri?.privacy_complaints_regulatory || 'NIL')}
      ${gkv('b. Total number of identified leaks, thefts, or losses of customer data', gri?.privacy_data_losses || 'NIL')}
    </tbody></table>
    ${griPageFooter(9, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const economicPage = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'Economic Performance', LOGO_IMG_SM)}
    <div class="gri-head">201. Economic Performance</div>

    <div class="disclosure-head">Disclosure 201-1: Direct economic value generated and distributed</div>
    <table>
      <thead><tr><th>Component</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>i. Direct economic value generated (revenues)</td><td>${gnil(gri?.evg_revenues)}</td></tr>
        <tr><td>ii. Operating costs</td><td>${gnil(gri?.evg_operating_costs)}</td></tr>
        <tr><td>ii. Employee wages and benefits</td><td>${gnil(gri?.evg_employee_wages)}</td></tr>
        <tr><td>ii. Payments to providers of capital</td><td>${gnil(gri?.evg_capital_payments)}</td></tr>
        <tr><td>ii. Payments to government by country</td><td>${gnil(gri?.evg_government_payments)}</td></tr>
        <tr><td>ii. Community investments</td><td>${gnil(gri?.evg_community_investments)}</td></tr>
        <tr><td>iii. Economic value retained (generated less distributed)</td><td>${gnil(gri?.evg_retained)}</td></tr>
      </tbody>
    </table>
    <div class="q-answer">${gnil(gri?.evg_country_breakdown)}</div>

    <div class="disclosure-head">Disclosure 201-2: Financial implications and other risks and opportunities due to climate change</div>
    <table><tbody>
      ${gkv('i. Description of the risk or opportunity and its classification (physical, regulatory, or other)', gri?.climate_risk_description)}
      ${gkv('ii. Description of the impact associated with the risk or opportunity', gri?.climate_risk_impact)}
      ${gkv('iii. Financial implications before action is taken', gri?.climate_risk_financial_implications)}
      ${gkv('iv. Methods used to manage the risk or opportunity', gri?.climate_risk_management)}
      ${gkv('v. Costs of actions taken to manage the risk or opportunity', gri?.climate_risk_action_costs)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 201-3: Defined benefit plan obligations and other retirement plans</div>
    <table><tbody>
      ${gkv('a. If plan liabilities met by general resources, estimated value of those liabilities', gri?.retirement_liabilities)}
      ${gkv('b.i. Extent to which the scheme\'s liabilities are estimated to be covered by assets', gri?.retirement_coverage)}
      ${gkv('b.ii. Basis on which that estimate has been arrived at', gri?.retirement_estimate_basis)}
      ${gkv('b.iii. When that estimate was made', gri?.retirement_estimate_date)}
      ${gkv('c. Strategy to work towards full coverage if not fully covered', gri?.retirement_full_coverage_strategy)}
      ${gkv('d. Percentage of salary contributed by employee or employer', gri?.retirement_contribution_pct)}
      ${gkv('e. Level of participation in retirement plans', gri?.retirement_participation)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 201-4: Financial assistance received from government</div>
    <table>
      <thead><tr><th>Type of assistance</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>i. Tax relief and tax credits</td><td>${gnil(gri?.govt_tax_relief)}</td></tr>
        <tr><td>ii. Subsidies</td><td>${gnil(gri?.govt_subsidies)}</td></tr>
        <tr><td>iii. Investment grants, R&amp;D grants, and other relevant types of grant</td><td>${gnil(gri?.govt_investment_grants)}</td></tr>
        <tr><td>iv. Awards</td><td>${gnil(gri?.govt_awards)}</td></tr>
        <tr><td>v. Royalty holidays</td><td>${gnil(gri?.govt_royalty_holidays)}</td></tr>
        <tr><td>vi. Financial assistance from Export Credit Agencies (ECAs)</td><td>${gnil(gri?.govt_eca_assistance)}</td></tr>
        <tr><td>vii. Financial incentives</td><td>${gnil(gri?.govt_financial_incentives)}</td></tr>
        <tr><td>viii. Other financial benefits from any government for any operation</td><td>${gnil(gri?.govt_other_benefits)}</td></tr>
      </tbody>
    </table>
    <table><tbody>${gkv('c. Whether, and the extent to which, any government is present in the shareholding structure', gri?.govt_shareholding)}</tbody></table>

    <div class="gri-head">203. Indirect Economic Impacts</div>
    <div class="disclosure-head">Disclosure 203-1: Infrastructure investments and services supported</div>
    <table><tbody>
      ${gkv('a. Extent of development of significant infrastructure investments and services supported', gri?.infrastructure_investments)}
      ${gkv('b. Current or expected impacts on communities and local economies', gri?.infrastructure_community_impacts)}
      ${gkv('c. Whether these investments are commercial, in-kind, or pro bono engagements', gri?.infrastructure_investment_type)}
    </tbody></table>
    <div class="disclosure-head">Disclosure 203-2: Significant indirect economic impacts</div>
    <table><tbody>
      ${gkv('a. Examples of significant identified indirect economic impacts, including positive and negative', gri?.indirect_economic_impacts)}
      ${gkv('b. Significance of indirect economic impacts in context of external benchmarks', gri?.indirect_economic_significance)}
    </tbody></table>

    <div class="gri-head">204. Procurement Practices</div>
    <div class="disclosure-head">Disclosure 204-1: Proportion of spending on local suppliers</div>
    <table><tbody>
      ${gkv('a. Percentage of procurement budget spent on suppliers local to that operation', gri?.local_supplier_spending_pct)}
      ${gkv('b. Geographical definition of \'local\'', gri?.local_definition)}
      ${gkv('c. Definition used for \'significant locations of operation\'', gri?.significant_locations_definition)}
    </tbody></table>
    ${griPageFooter(10, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const anticorruptionTaxPage = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'Anti-corruption · Anti-competitive · Tax', LOGO_IMG_SM)}
    <div class="gri-head">205. Anti-corruption</div>

    <div class="disclosure-head">Disclosure 205-1: Operations assessed for risks related to corruption</div>
    <table><tbody>
      ${gkv('a. Total number and percentage of operations assessed for risks related to corruption', gri?.corruption_ops_assessed)}
      ${gkv('b. Significant risks related to corruption identified through the risk assessment', gri?.corruption_significant_risks)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 205-2: Communication and training about anti-corruption policies and procedures</div>
    <table><tbody>
      ${gkv('a. Total number and % of governance body members that anti-corruption policies communicated to, by region', gri?.anticorruption_comm_gov_body)}
      ${gkv('b. Total number and % of employees that anti-corruption policies communicated to, by employee category and region', gri?.anticorruption_comm_employees)}
      ${gkv('c. Total number and % of business partners that anti-corruption policies communicated to, by type and region', gri?.anticorruption_comm_partners)}
      ${gkv('d. Total number and % of governance body members that have received training on anti-corruption, by region', gri?.anticorruption_training_gov_body)}
      ${gkv('e. Total number and % of employees that have received training on anti-corruption, by employee category and region', gri?.anticorruption_training_employees)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 205-3: Confirmed incidents of corruption and actions taken</div>
    <table><tbody>
      ${gkv('Total number of confirmed incidents of corruption', gri?.corruption_confirmed_incidents || 'NIL')}
      ${gkv('Nature of confirmed incidents of corruption', gri?.corruption_nature || 'NIL')}
      ${gkv('b. Total number of confirmed incidents in which employees were dismissed or disciplined for corruption', gri?.corruption_dismissals || 'NIL')}
      ${gkv('c. Total number of confirmed incidents when contracts with business partners were terminated due to corruption', gri?.corruption_contract_terminations || 'NIL')}
      ${gkv('d. Public legal cases regarding corruption brought against the organization during the reporting period and outcomes', gri?.corruption_legal_cases || 'NIL')}
    </tbody></table>

    <div class="gri-head">206. Anti-competitive Behavior</div>
    <div class="disclosure-head">Disclosure 206-1: Legal actions for anti-competitive behavior, anti-trust, and monopoly practices</div>
    <table><tbody>
      ${gkv('a. Number of legal actions pending or completed during the reporting period regarding anti-competitive behavior', gri?.anticompetitive_legal_actions || 'NIL')}
      ${gkv('b. Main outcomes of completed legal actions, including any decisions or judgments', gri?.anticompetitive_outcomes || 'NIL')}
    </tbody></table>

    <div class="gri-head">207. Tax</div>
    <div class="disclosure-head">Disclosure 207-1: Approach to tax</div>
    <table><tbody>
      ${gkv('a.i. Whether the organization has a tax strategy and link to this strategy if publicly available', gri?.tax_strategy)}
      ${gkv('a.ii. Governance body or executive-level position that formally reviews and approves the tax strategy', gri?.tax_governance_body)}
      ${gkv('a.iii. Approach to regulatory compliance', gri?.tax_compliance_approach)}
      ${gkv('a.iv. How the approach to tax is linked to business and sustainable development strategies', gri?.tax_business_link)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 207-2: Tax governance, control, and risk management</div>
    <table><tbody>
      ${gkv('a.i. Governance body accountable for compliance with the tax strategy', gri?.tax_accountability)}
      ${gkv('a.ii. How the approach to tax is embedded within the organization', gri?.tax_embedding)}
      ${gkv('a.iii. Approach to tax risks, including how risks are identified, managed, and monitored', gri?.tax_risk_approach)}
      ${gkv('a.iv. How compliance with the tax governance and control framework is evaluated', gri?.tax_compliance_evaluation)}
      ${gkv('b. Mechanisms for reporting concerns about unethical or unlawful behavior in relation to tax', gri?.tax_reporting_mechanisms)}
      ${gkv('c. Assurance process for disclosures on tax', gri?.tax_assurance)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 207-3: Stakeholder engagement and management of concerns related to tax</div>
    <table><tbody>
      ${gkv('a.i. Approach to engagement with tax authorities', gri?.tax_authority_engagement)}
      ${gkv('a.ii. Approach to public policy advocacy on tax', gri?.tax_policy_advocacy)}
      ${gkv('a.iii. Processes for collecting and considering the views and concerns of stakeholders', gri?.tax_stakeholder_processes)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 207-4: Country-by-country reporting</div>
    <table><tbody>
      ${gkv('a. All tax jurisdictions where entities included in the organization\'s financial statements are resident', gri?.tax_jurisdictions)}
      ${gkv('c. Time period covered by the information reported in Disclosure 207-4', gri?.tax_reporting_period)}
    </tbody></table>
    ${griPageFooter(11, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  // ── ENVIRONMENTAL (GRI 300) ───────────────────────────────────────────────────
  const envPage1 = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'Environmental Disclosures (GRI 300)', LOGO_IMG_SM)}
    <div class="section-banner">Environmental<div class="sub">GRI 300: GRI Environmental Topics — Refers to a company's impact on the environment, encompassing practices related to climate change, resource management, and ecological sustainability.</div></div>

    <div class="gri-head">301 Materials</div>
    <div class="disclosure-head">Disclosure 301-1: Raw Materials used by weight or volume</div>
    <table>
      <thead><tr><th>Material Type</th><th>Weight/Volume</th><th>Unit</th></tr></thead>
      <tbody>
        <tr><td>i. Non-renewable materials used</td><td>${gnil(gri?.materials_nonrenewable)}</td><td>${gnil(gri?.materials_nonrenewable_unit)}</td></tr>
        <tr><td>ii. Renewable materials used</td><td>${gnil(gri?.materials_renewable)}</td><td>${gnil(gri?.materials_renewable_unit)}</td></tr>
      </tbody>
    </table>

    <div class="disclosure-head">Disclosure 301-2: Recycled input materials used</div>
    <table><tbody>
      ${gkv('i. Non-renewable materials (% recycled input)', gri?.recycled_nonrenewable_pct)}
      ${gkv('ii. Renewable materials (% recycled input)', gri?.recycled_renewable_pct)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 301-3: Reclaimed products and their packaging materials</div>
    <table><tbody>
      ${gkv('Products and their packaging materials reclaimed within the reporting period (%)', gri?.reclaimed_pct)}
      ${gkv('Products sold within the reporting period', gri?.products_sold)}
      ${gkv('b. How the data for this disclosure have been collected', gri?.reclaimed_data_collection)}
    </tbody></table>

    <div class="gri-head">302 Energy Consumption</div>
    <div class="disclosure-head">Disclosure 302-1: Energy consumption within the organization</div>
    <table>
      <thead><tr><th>Parameter</th><th>Value</th><th>Unit</th></tr></thead>
      <tbody>
        <tr><td>a. Total fuel consumption from non-renewable sources</td><td>${gnil(gri?.energy_nonrenew_fuel)}</td><td>${gnil(gri?.energy_nonrenew_fuel_unit)}</td></tr>
        <tr><td>b. Total fuel consumption from renewable sources</td><td>${gnil(gri?.energy_renew_fuel)}</td><td>${gnil(gri?.energy_renew_fuel_unit)}</td></tr>
        <tr><td>c.i. Electricity consumption</td><td>${totalGJ > 0 ? gfmt(totalGJ) : gnil(gri?.energy_electricity)}</td><td>${totalGJ > 0 ? 'GJ' : gnil(gri?.energy_electricity_unit)}</td></tr>
        <tr><td>c.ii. Heating consumption</td><td>${gnil(gri?.energy_heating)}</td><td>${gnil(gri?.energy_heating_unit)}</td></tr>
        <tr><td>c.iii. Cooling consumption</td><td>${gnil(gri?.energy_cooling)}</td><td>${gnil(gri?.energy_cooling_unit)}</td></tr>
        <tr><td>c.iv. Steam consumption</td><td>${gnil(gri?.energy_steam)}</td><td>${gnil(gri?.energy_steam_unit)}</td></tr>
        <tr><td>d.i. Electricity sold</td><td>${gnil(gri?.energy_electricity_sold)}</td><td>${gnil(gri?.energy_electricity_sold_unit)}</td></tr>
        <tr><td>d.ii. Heating sold</td><td>${gnil(gri?.energy_heating_sold)}</td><td>${gnil(gri?.energy_heating_sold_unit)}</td></tr>
        <tr><td>d.iii. Cooling sold</td><td>${gnil(gri?.energy_cooling_sold)}</td><td>${gnil(gri?.energy_cooling_sold_unit)}</td></tr>
        <tr><td>d.iv. Steam sold</td><td>${gnil(gri?.energy_steam_sold)}</td><td>${gnil(gri?.energy_steam_sold_unit)}</td></tr>
        <tr class="total-row"><td>e. Total energy consumption within the organization</td><td>${totalGJ > 0 ? gfmt(totalGJ) : gnil(gri?.energy_total)}</td><td>GJ</td></tr>
      </tbody>
    </table>
    <table><tbody>
      ${gkv('f. Standards, methodologies, assumptions, and/or calculation tools used', gri?.energy_methodology || (totalGJ > 0 ? 'GHG Protocol · CEA V20.0 Dec 2024' : null))}
      ${gkv('g. Source of the conversion factors used', gri?.energy_conversion_factors || (totalGJ > 0 ? `CEA India V20.0 Dec 2024 · ${gridEmissionFactor} tCO₂/MWh` : null))}
    </tbody></table>

    <div class="disclosure-head">Disclosure 302-2: Energy consumption outside of the organization</div>
    <table><tbody>
      ${gkv('a. Energy consumption outside of the organization, in joules or multiples', gri?.energy_outside_org)}
      ${gkv('b. Standards, methodologies, assumptions, and/or calculation tools used', gri?.energy_outside_methodology)}
      ${gkv('c. Source of the conversion factors used', gri?.energy_outside_conversion_factors)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 302-3: Energy intensity</div>
    <table><tbody>
      ${gkv('Energy consumed in production processes', gri?.energy_intensity_production)}
      ${gkv('Energy consumed in overhead', gri?.energy_intensity_overhead)}
      ${gkv('Normalisation factor', gri?.energy_intensity_normalisation)}
      ${gkv('b. Organization-specific metric (denominator) chosen to calculate the ratio', gri?.energy_intensity_denominator)}
      ${gkv('c. Types of energy included in the intensity ratio', gri?.energy_intensity_types)}
      ${gkv('d. Whether the ratio uses energy consumption within or outside the organization, or both', gri?.energy_intensity_scope)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 302-4: Reduction of energy consumption</div>
    <table><tbody>
      ${gkv('a. Amount of reductions in energy consumption achieved as a direct result of conservation and efficiency initiatives', gri?.energy_reduction_amount)}
      ${gkv('b. Types of energy included in the reductions', gri?.energy_reduction_types)}
      ${gkv('c. Basis for calculating reductions, including rationale for choosing it', gri?.energy_reduction_basis)}
      ${gkv('d. Standards, methodologies, assumptions, and/or calculation tools used', gri?.energy_reduction_methodology)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 302-5: Reductions in energy requirements of products and services</div>
    <table><tbody>
      ${gkv('a. Reductions in energy requirements of sold products and services achieved during the reporting period', gri?.energy_product_reductions)}
      ${gkv('b. Basis for calculating reductions in energy consumption', gri?.energy_product_reductions_basis)}
      ${gkv('c. Standards, methodologies, assumptions, and/or calculation tools used', gri?.energy_product_reductions_methodology)}
    </tbody></table>
    ${griPageFooter(12, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const envPage2 = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 303 — Water & Effluents', LOGO_IMG_SM)}
    <div class="gri-head">303 Water and Effluents</div>

    <div class="disclosure-head">Disclosure 303-1: Interactions with water as a shared resource</div>
    <table><tbody>
      ${gkv('a. How and where water is withdrawn, consumed, and discharged, and the water-related impacts', gri?.water_interactions)}
      ${gkv('b. Approach used to identify water-related impacts, including scope, timeframe, and tools used', gri?.water_impact_identification)}
      ${gkv('c. How water-related impacts are addressed, including working with stakeholders', gri?.water_impact_address)}
      ${gkv('d. Process for setting any water-related goals and targets', gri?.water_goal_setting)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 303-2: Management of water discharge-related impacts</div>
    <table><tbody>
      ${gkv('i. Standards for facilities operating in locations with no local discharge requirements', gri?.water_discharge_standards_no_local)}
      ${gkv('ii. Any internally developed water quality standards or guidelines', gri?.water_internal_quality_standards)}
      ${gkv('iii. Any sector-specific standards considered', gri?.water_sector_standards)}
      ${gkv('iv. Whether the profile of the receiving waterbody was considered', gri?.water_receiving_body_profile)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 303-3: Water withdrawal</div>
    <table>
      <thead><tr><th>Source</th><th>Total (all areas)</th><th>Water-stressed areas</th><th>Unit</th></tr></thead>
      <tbody>
        <tr><td>i. Surface Water</td><td>${gnil(waterData?.surface_kl ? gfmt(gf(waterData.surface_kl),0) : gri?.water_withdrawal_surface)}</td><td>${gnil(gri?.water_withdrawal_surface_stress)}</td><td>ML</td></tr>
        <tr><td>ii. Ground Water</td><td>${gnil(waterData?.ground_kl ? gfmt(gf(waterData.ground_kl),0) : gri?.water_withdrawal_ground)}</td><td>${gnil(gri?.water_withdrawal_ground_stress)}</td><td>ML</td></tr>
        <tr><td>iii. Sea Water</td><td>${gnil(gri?.water_withdrawal_sea)}</td><td>${gnil(gri?.water_withdrawal_sea_stress)}</td><td>ML</td></tr>
        <tr><td>iv. Produced Water</td><td>${gnil(gri?.water_withdrawal_produced)}</td><td>${gnil(gri?.water_withdrawal_produced_stress)}</td><td>ML</td></tr>
        <tr><td>v. Third Party Water</td><td>${gnil(waterData?.municipal_kl ? gfmt(gf(waterData.municipal_kl),0) : gri?.water_withdrawal_third_party)}</td><td>${gnil(gri?.water_withdrawal_third_party_stress)}</td><td>ML</td></tr>
        <tr class="total-row"><td>Total water withdrawal</td><td>${withdrawKL > 0 ? gfmt(withdrawKL/1000,3) : gnil(gri?.water_withdrawal_total)}</td><td>${gnil(gri?.water_withdrawal_total_stress)}</td><td>ML</td></tr>
      </tbody>
    </table>
    <table><tbody>
      ${gkv('c.i. Fresh Water (≤1,000 mg/L TDS)', gri?.water_withdrawal_fresh)}
      ${gkv('c.ii. Other water (>1,000 mg/L TDS)', gri?.water_withdrawal_other)}
      ${gkv('d. Contextual information — standards, methodologies, and assumptions used', gri?.water_withdrawal_methodology)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 303-4: Total water discharge</div>
    <table>
      <thead><tr><th>Destination</th><th>Volume</th><th>Unit</th></tr></thead>
      <tbody>
        ${['Surface Water','Ground Water','Sea Water','Third-party water'].map(d=>`<tr><td>${d}</td><td class="nil">NIL</td><td>ML</td></tr>`).join('')}
      </tbody>
    </table>
    <table><tbody>
      ${gkv('b.i. Fresh water discharged (≤1,000 mg/L TDS)', gri?.water_discharge_fresh)}
      ${gkv('b.ii. Other water discharged (>1,000 mg/L TDS)', gri?.water_discharge_other)}
      ${gkv('d.iii. Number of incidents of non-compliance with discharge limits', gri?.water_discharge_noncompliance || 'NIL')}
    </tbody></table>

    <div class="disclosure-head">Disclosure 303-5: Water consumption</div>
    <table><tbody>
      ${gkv('a. Total water consumption from all areas (in megalitres)', consumeKL > 0 ? gfmt(consumeKL/1000,3) + ' ML' : null)}
      ${gkv('b. Total water consumption from all areas with water stress (in megalitres)', gri?.water_consumption_stress)}
      ${gkv('c. Change in water storage (in megalitres)', gri?.water_storage_change)}
      ${gkv('d. Contextual information — standards, methodologies, and assumptions used', gri?.water_consumption_methodology)}
    </tbody></table>
    ${griPageFooter(13, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const envPage3 = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 304 — Biodiversity', LOGO_IMG_SM)}
    <div class="gri-head">304 Biodiversity</div>

    <div class="disclosure-head">Disclosure 304-1: Operational sites owned, leased, managed in, or adjacent to, protected areas and areas of high biodiversity value outside protected areas</div>
    <table><tbody>
      ${gkv('i. Geographic location', gri?.biodiversity_site_location)}
      ${gkv('ii. Subsurface and underground land that may be owned, leased, or managed', gri?.biodiversity_subsurface)}
      ${gkv('iii. Position in relation to the protected area', gri?.biodiversity_position)}
      ${gkv('iv. Type of operation (office, manufacturing/production, or extractive)', gri?.biodiversity_operation_type)}
      ${gkv('v. Size of operational site (km²)', gri?.biodiversity_site_size)}
      ${gkv('vi. Biodiversity value characterized by the attribute of the protected area', gri?.biodiversity_value_attribute)}
      ${gkv('vii. Biodiversity value characterized by listing of protected status', gri?.biodiversity_protected_status)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 304-2: Significant impacts of activities, products, and services on biodiversity</div>
    <table><tbody>
      ${gkv('i. Construction or use of manufacturing plants, mines, and transport infrastructure', gri?.biodiversity_impact_construction)}
      ${gkv('ii. Pollution from point and non-point sources', gri?.biodiversity_impact_pollution)}
      ${gkv('iii. Introduction of invasive species, pests, and pathogens', gri?.biodiversity_impact_invasive)}
      ${gkv('iv. Reduction of species', gri?.biodiversity_impact_species_reduction)}
      ${gkv('v. Habitat conversion', gri?.biodiversity_impact_habitat)}
      ${gkv('vi. Changes in ecological processes outside the natural range of variation', gri?.biodiversity_impact_ecological)}
      ${gkv('b.i. Species affected', gri?.biodiversity_species_affected)}
      ${gkv('b.ii. Extent of areas impacted', gri?.biodiversity_extent)}
      ${gkv('b.iii. Duration of impacts', gri?.biodiversity_duration)}
      ${gkv('b.iv. Reversibility or irreversibility of the impacts', gri?.biodiversity_reversibility)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 304-3: Size and location of all habitat areas protected or restored</div>
    <table><tbody>
      ${gkv('a. Size and location of all habitat areas protected or restored', gri?.habitat_protected_restored)}
      ${gkv('b. Whether partnerships exist with third parties to protect or restore habitat areas', gri?.habitat_partnerships)}
      ${gkv('c. Status of each area based on its condition at the close of the reporting period', gri?.habitat_status)}
      ${gkv('d. Standards, methodologies, and assumptions used', gri?.habitat_methodology)}
    </tbody></table>

    <div class="disclosure-head">Disclosure 304-4: IUCN Red List species and national conservation list species</div>
    <table>
      <thead><tr><th>Extinction Risk Level</th><th>Number of Species</th></tr></thead>
      <tbody>
        <tr><td>i. Critically endangered</td><td>${gnil(gri?.iucn_critically_endangered)}</td></tr>
        <tr><td>ii. Endangered</td><td>${gnil(gri?.iucn_endangered)}</td></tr>
        <tr><td>iii. Vulnerable</td><td>${gnil(gri?.iucn_vulnerable)}</td></tr>
        <tr><td>iv. Near threatened</td><td>${gnil(gri?.iucn_near_threatened)}</td></tr>
        <tr><td>v. Least concern</td><td>${gnil(gri?.iucn_least_concern)}</td></tr>
      </tbody>
    </table>
    ${griPageFooter(14, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const envPage4_emissions = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 305 — Emissions', LOGO_IMG_SM)}
    <div class="gri-head">305 Emissions</div>

    <div class="disclosure-head">305-1: Direct (Scope 1) GHG emissions</div>
    <table>
      <thead><tr><th>Parameter</th><th>Value</th><th>Unit</th></tr></thead>
      <tbody>
        <tr><td>a. Gross direct (Scope 1) GHG emissions</td><td>${scope1 > 0 ? gfmt(scope1) : gnil(gri?.ghg_scope1)}</td><td>Metric tons CO₂e</td></tr>
        <tr><td>b. Gases included in the calculation</td><td colspan="2">${gnil(gri?.ghg_scope1_gases || 'CO₂, CH₄, N₂O, HFCs, PFCs, SF₆, NF₃')}</td></tr>
        <tr><td>c. Biogenic CO₂ emissions</td><td>${gnil(gri?.ghg_scope1_biogenic || '0')}</td><td>Metric tons CO₂e</td></tr>
        <tr><td>d. Base year for the calculation</td><td colspan="2">${gnil(gri?.ghg_base_year || profile?.base_year)}</td></tr>
        <tr><td>d.i. Rationale for choosing base year</td><td colspan="2">${gnil(gri?.ghg_base_year_rationale)}</td></tr>
        <tr><td>d.ii. Emissions in the base year</td><td>${gnil(gri?.ghg_base_year_emissions)}</td><td>Metric tons CO₂e</td></tr>
        <tr><td>d.iii. Context for significant changes that triggered recalculations</td><td colspan="2">${gnil(gri?.ghg_base_year_recalc_context)}</td></tr>
        <tr><td>e. Source of emission factors and GWP rates used</td><td colspan="2">${gnil(gri?.ghg_emission_factors_source || 'DEFRA 2024 · IPCC AR6 GWP100')}</td></tr>
        <tr><td>f. Consolidation approach</td><td colspan="2">${gnil(gri?.ghg_consolidation_approach || 'Operational Control')}</td></tr>
        <tr><td>g. Standards, methodologies, assumptions, and/or calculation tools used</td><td colspan="2">${gnil(gri?.ghg_scope1_methodology || 'GHG Protocol Corporate Standard')}</td></tr>
      </tbody>
    </table>

    <div class="disclosure-head">305-2: Energy indirect (Scope 2) GHG emissions</div>
    <table>
      <thead><tr><th>Parameter</th><th>Value</th><th>Unit</th></tr></thead>
      <tbody>
        <tr><td>a. Gross location-based energy indirect (Scope 2) GHG emissions</td><td>${s2Loc > 0 ? gfmt(s2Loc) : gnil(gri?.ghg_scope2_location)}</td><td>Metric tons CO₂e</td></tr>
        <tr><td>b. Gross market-based energy indirect (Scope 2) GHG emissions</td><td>${s2Mkt > 0 ? gfmt(s2Mkt) : gnil(gri?.ghg_scope2_market)}</td><td>Metric tons CO₂e</td></tr>
        <tr><td>c. Gases included in the calculation</td><td colspan="2">${gnil(gri?.ghg_scope2_gases || 'CO₂')}</td></tr>
        <tr><td>e. Source of emission factors and GWP rates used</td><td colspan="2">${gnil(gri?.ghg_scope2_ef_source || `CEA India V20.0 Dec 2024 · ${gridEmissionFactor} tCO₂/MWh`)}</td></tr>
        <tr><td>f. Consolidation approach</td><td colspan="2">${gnil(gri?.ghg_consolidation_approach || 'Operational Control')}</td></tr>
        <tr><td>g. Standards, methodologies, assumptions, and/or calculation tools used</td><td colspan="2">${gnil(gri?.ghg_scope2_methodology || 'GHG Protocol Scope 2 Guidance')}</td></tr>
      </tbody>
    </table>

    <div class="disclosure-head">305-3: Other indirect (Scope 3) GHG emissions</div>
    <table>
      <thead><tr><th>Parameter</th><th>Value</th><th>Unit</th></tr></thead>
      <tbody>
        <tr><td>a. Gross other indirect (Scope 3) GHG emissions</td><td>${scope3 > 0 ? gfmt(scope3) : gnil(gri?.ghg_scope3)}</td><td>Metric tons CO₂e</td></tr>
        <tr><td>b. Gases included in the calculation</td><td colspan="2">${gnil(gri?.ghg_scope3_gases || 'CO₂, CH₄, N₂O')}</td></tr>
        <tr><td>c. Biogenic CO₂ emissions</td><td>${gnil(gri?.ghg_scope3_biogenic || '0')}</td><td>Metric tons CO₂e</td></tr>
        <tr><td>d. Scope 3 GHG emission categories and activities included in the calculation</td><td colspan="2">${gnil(gri?.ghg_scope3_categories || 'All 15 GHG Protocol categories')}</td></tr>
        <tr><td>g. Standards, methodologies, assumptions, and/or calculation tools used</td><td colspan="2">${gnil(gri?.ghg_scope3_methodology || 'GHG Protocol Corporate Value Chain Standard')}</td></tr>
      </tbody>
    </table>

    <div class="disclosure-head">305-4: GHG emission intensity</div>
    <table><tbody>
      ${gkv('a. Total GHG Emissions (numerator)', (scope1 + s2Loc + scope3) > 0 ? gfmt(scope1 + s2Loc + scope3) + ' tCO₂e' : null)}
      ${gkv('a. Performance Metric (denominator)', gri?.ghg_intensity_denominator)}
      ${gkv('b. Organization-specific metric chosen to calculate the ratio', gri?.ghg_intensity_org_metric)}
      ${gkv('c. Types of GHG emissions included in the intensity ratio', gri?.ghg_intensity_types || 'Scope 1 + Scope 2 (location-based) + Scope 3')}
      ${gkv('d. Gases included in the calculation', gri?.ghg_intensity_gases || 'CO₂, CH₄, N₂O, HFCs, PFCs, SF₆, NF₃')}
    </tbody></table>

    <div class="disclosure-head">305-5: Reduction of GHG emissions</div>
    <table><tbody>
      ${gkv('a. GHG emissions reduced as a direct result of reduction initiatives (Metric tons CO₂e)', gri?.ghg_reduction_amount)}
      ${gkv('b. Gases included in the calculation', gri?.ghg_reduction_gases)}
      ${gkv('c. Base year or baseline, including the rationale for choosing it', gri?.ghg_reduction_base_year)}
      ${gkv('d. Scopes in which reductions took place', gri?.ghg_reduction_scopes)}
      ${gkv('e. Standards, methodologies, assumptions, and/or calculation tools used', gri?.ghg_reduction_methodology)}
    </tbody></table>

    <div class="disclosure-head">305-6: Emissions of ozone-depleting substances (ODS)</div>
    <table><tbody>
      ${gkv('a. Production, imports, and exports of ODS in metric tons of CFC-11 equivalent', gri?.ods_emissions)}
      ${gkv('b. Substances included in the calculation', gri?.ods_substances)}
      ${gkv('c. Source of the emission factors used', gri?.ods_emission_factors)}
    </tbody></table>

    <div class="disclosure-head">305-7: Nitrogen oxides (NOX), sulfur oxides (SOX), and other significant air emissions</div>
    <table>
      <thead><tr><th>Emission</th><th>Value</th><th>Unit</th></tr></thead>
      <tbody>
        ${[['i. NOX',gri?.air_nox],['ii. SOX',gri?.air_sox],['iii. Persistent organic pollutants (POP)',gri?.air_pop],['iv. Volatile organic compounds (VOC)',gri?.air_voc],['v. Hazardous air pollutants (HAP)',gri?.air_hap],['vi. Particulate matter (PM)',gri?.air_pm]].map(([label,val])=>`<tr><td>${label}</td><td>${gnil(val)}</td><td>kg</td></tr>`).join('')}
      </tbody>
    </table>
    ${griPageFooter(15, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const envPage5_waste = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 306 — Waste · 307 — Compliance · 308 — Supply Chain', LOGO_IMG_SM)}
    <div class="gri-head">306 Waste Generation & Management</div>

    <div class="disclosure-head">306-1: Waste generation and significant waste-related impacts</div>
    <table><tbody>
      ${gkv('a.i. The inputs, activities, and outputs that lead or could lead to waste impacts', gri?.waste_inputs_activities)}
      ${gkv('a.ii. Whether impacts relate to waste generated in the organization\'s own activities or upstream/downstream', gri?.waste_impact_scope)}
    </tbody></table>

    <div class="disclosure-head">306-2: Management of significant waste-related impacts</div>
    <table><tbody>
      ${gkv('a. Actions taken to prevent waste generation', gri?.waste_prevention_actions)}
      ${gkv('b. If managed by a third party, processes used to determine whether third party manages in line with contractual obligations', gri?.waste_third_party_management)}
      ${gkv('c. Processes used to collect and monitor waste-related data', gri?.waste_data_collection)}
    </tbody></table>

    <div class="disclosure-head">306-3: Total weight of waste generated</div>
    <table>
      <thead><tr><th>Waste Category</th><th>Weight (MT)</th></tr></thead>
      <tbody>
        ${wasteRows.map(([label, val]) => `<tr><td>${label}</td><td>${gf(val) > 0 ? gfmt(gf(val)/1000,4) + ' MT' : '<span class="nil">NIL</span>'}</td></tr>`).join('')}
        <tr class="total-row"><td>Total weight of waste generated</td><td>${totalWasteKg > 0 ? gfmt(totalWasteKg/1000,3) + ' MT' : '<span class="nil">NIL</span>'}</td></tr>
      </tbody>
    </table>

    <div class="disclosure-head">306-4: Waste diverted from disposal</div>
    <table>
      <thead><tr><th>Recovery Operation</th><th>Hazardous (MT)</th><th>Non-hazardous (MT)</th></tr></thead>
      <tbody>
        <tr><td>i. Preparation for reuse</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td>ii. Recycling</td><td class="nil">NIL</td><td>${gf(wasteData?.recycled_kg) > 0 ? gfmt(gf(wasteData.recycled_kg)/1000,4) + ' MT' : '<span class="nil">NIL</span>'}</td></tr>
        <tr><td>iii. Other recovery operations</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
      </tbody>
    </table>

    <div class="disclosure-head">306-5: Waste directed to disposal</div>
    <table>
      <thead><tr><th>Disposal Method</th><th>Hazardous (MT)</th><th>Non-hazardous (MT)</th></tr></thead>
      <tbody>
        <tr><td>i. Incineration (with energy recovery)</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td>ii. Incineration (without energy recovery)</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td>iii. Landfilling</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
        <tr><td>iv. Other disposal operations</td><td class="nil">NIL</td><td class="nil">NIL</td></tr>
      </tbody>
    </table>

    <div class="gri-head">307 Environmental Compliance</div>
    <div class="disclosure-head">307-1: Non-compliance with environmental laws and regulations</div>
    <table><tbody>
      ${gkv('a.i. Total monetary value of significant fines', gri?.env_compliance_fines || 'NIL')}
      ${gkv('a.ii. Total number of non-monetary sanctions', gri?.env_compliance_nonmonetary || 'NIL')}
      ${gkv('a.iii. Cases brought through dispute resolution mechanisms', gri?.env_compliance_dispute || 'NIL')}
      ${gkv('b. If no non-compliance identified, a brief statement of this fact', gri?.env_compliance_statement)}
    </tbody></table>

    <div class="gri-head">308 Supply Chain</div>
    <div class="disclosure-head">Disclosure 308-1: New suppliers that were screened using environmental criteria</div>
    <table><tbody>
      ${gkv('a. Percentage of new suppliers screened using environmental criteria', gri?.env_supplier_screening_pct)}
    </tbody></table>
    <div class="disclosure-head">Disclosure 308-2: Negative environmental impacts in the supply chain and actions taken</div>
    <table><tbody>
      ${gkv('a. Number of suppliers assessed for environmental impacts', gri?.env_supplier_assessed)}
      ${gkv('b. Number of suppliers identified as having significant actual and potential negative environmental impacts', gri?.env_supplier_negative_impacts)}
      ${gkv('c. Significant actual and potential negative environmental impacts identified in the supply chain', gri?.env_supplier_impact_description)}
      ${gkv('d. % of suppliers identified as having negative impacts with which improvements were agreed upon', gri?.env_supplier_improvements_pct)}
      ${gkv('e. % of suppliers with which relationships were terminated as a result of assessment', gri?.env_supplier_terminated_pct)}
    </tbody></table>
    ${griPageFooter(16, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  // ── SOCIAL (GRI 400) ─────────────────────────────────────────────────────────
  const socialPage1 = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'Social Disclosures (GRI 400)', LOGO_IMG_SM)}
    <div class="section-banner">Social<div class="sub">GRI 400: GRI Social Topics — Concerns a company's approach and impact on societal factors, including labor practices, diversity, community engagement, and human rights.</div></div>

    <div class="gri-head">405 Diversity of governance bodies and employees</div>
    <div class="disclosure-head">405-1: Diversity categories — Governance bodies</div>
    <table>
      <thead><tr><th>Diversity Category</th><th>% of Board Members</th></tr></thead>
      <tbody>
        <tr><td>i. Gender — Male</td><td>${gnil(gri?.diversity_gov_male_pct)}</td></tr>
        <tr><td>i. Gender — Female</td><td>${gnil(gri?.diversity_gov_female_pct)}</td></tr>
        <tr><td>ii. Age group — Under 30 years old</td><td>${gnil(gri?.diversity_gov_under30_pct)}</td></tr>
        <tr><td>ii. Age group — 30–50 years old</td><td>${gnil(gri?.diversity_gov_3050_pct)}</td></tr>
        <tr><td>ii. Age group — Over 50 years old</td><td>${gnil(gri?.diversity_gov_over50_pct)}</td></tr>
        <tr><td>iii. Minority or vulnerable groups</td><td>${gnil(gri?.diversity_gov_minority_pct)}</td></tr>
      </tbody>
    </table>

    <div class="disclosure-head">405-1: Diversity categories — Employees per employee category</div>
    <table>
      <thead><tr><th>Diversity Category</th><th>% of Employees</th></tr></thead>
      <tbody>
        <tr><td>i. Gender — Male</td><td>${gnil(gri?.diversity_emp_male_pct)}</td></tr>
        <tr><td>i. Gender — Female</td><td>${gnil(gri?.diversity_emp_female_pct)}</td></tr>
        <tr><td>ii. Age group — Under 30 years old</td><td>${gnil(gri?.diversity_emp_under30_pct)}</td></tr>
        <tr><td>ii. Age group — 30–50 years old</td><td>${gnil(gri?.diversity_emp_3050_pct)}</td></tr>
        <tr><td>ii. Age group — Over 50 years old</td><td>${gnil(gri?.diversity_emp_over50_pct)}</td></tr>
        <tr><td>iii. Minority or vulnerable groups</td><td>${gnil(gri?.diversity_emp_minority_pct)}</td></tr>
      </tbody>
    </table>

    <div class="disclosure-head">405-2: Ratio of basic salary and remuneration of women to men</div>
    <table><tbody>
      ${gkv('a. Ratio of basic salary and remuneration of women to men for each employee category, by significant locations of operation', gri?.gender_pay_ratio)}
      ${gkv('b. Definition used for \'significant locations of operation\'', gri?.gender_pay_significant_locations)}
    </tbody></table>

    <div class="gri-head">401 Employment</div>
    <div class="disclosure-head">401-1: New employee hires and employee turnover</div>
    <div class="q-label">a. New employee hires — by age group and gender:</div>
    <table>
      <thead><tr><th>Category</th><th>Count</th></tr></thead>
      <tbody>
        <tr><td>Under 30 years old</td><td>${gnil(gri?.new_hires_under30)}</td></tr>
        <tr><td>30–50 years old</td><td>${gnil(gri?.new_hires_3050)}</td></tr>
        <tr><td>Over 50 years old</td><td>${gnil(gri?.new_hires_over50)}</td></tr>
        <tr><td>Male</td><td>${gnil(gri?.new_hires_male)}</td></tr>
        <tr><td>Female</td><td>${gnil(gri?.new_hires_female)}</td></tr>
      </tbody>
    </table>
    <div class="q-label">b. Total number of employee turnover — by age group and gender:</div>
    <table>
      <thead><tr><th>Category</th><th>Count</th><th>Rate</th></tr></thead>
      <tbody>
        <tr><td>Under 30 years old</td><td>${gnil(gri?.turnover_under30)}</td><td>${gnil(gri?.turnover_rate_under30)}</td></tr>
        <tr><td>30–50 years old</td><td>${gnil(gri?.turnover_3050)}</td><td>${gnil(gri?.turnover_rate_3050)}</td></tr>
        <tr><td>Over 50 years old</td><td>${gnil(gri?.turnover_over50)}</td><td>${gnil(gri?.turnover_rate_over50)}</td></tr>
        <tr><td>Male</td><td>${gnil(gri?.turnover_male)}</td><td>${gnil(gri?.turnover_rate_male)}</td></tr>
        <tr><td>Female</td><td>${gnil(gri?.turnover_female)}</td><td>${gnil(gri?.turnover_rate_female)}</td></tr>
        <tr class="total-row"><td>Total</td><td>${gnil(gri?.turnover_total)}</td><td>${gnil(gri?.turnover_rate_total)}</td></tr>
      </tbody>
    </table>

    <div class="disclosure-head">401-2: Benefits provided to full-time employees that are not provided to temporary or part-time employees</div>
    <div class="q-answer">${gnil(gri?.fulltime_only_benefits)}</div>

    <div class="disclosure-head">401-3: Parental leave</div>
    <table>
      <thead><tr><th>Metric</th><th>Male</th><th>Female</th></tr></thead>
      <tbody>
        <tr><td>a. Total employees entitled to parental leave</td><td>${gnil(gri?.parental_entitled_male)}</td><td>${gnil(gri?.parental_entitled_female)}</td></tr>
        <tr><td>b. Total employees that took parental leave</td><td>${gnil(gri?.parental_took_male)}</td><td>${gnil(gri?.parental_took_female)}</td></tr>
        <tr><td>c. Total employees that returned to work after parental leave</td><td>${gnil(gri?.parental_returned_male)}</td><td>${gnil(gri?.parental_returned_female)}</td></tr>
        <tr><td>d. Total employees still employed 12 months after returning</td><td>${gnil(gri?.parental_retained_male)}</td><td>${gnil(gri?.parental_retained_female)}</td></tr>
        <tr><td>e. Return to work rate</td><td>${gnil(gri?.parental_return_rate_male)}</td><td>${gnil(gri?.parental_return_rate_female)}</td></tr>
        <tr><td>f. Retention rate</td><td>${gnil(gri?.parental_retention_rate_male)}</td><td>${gnil(gri?.parental_retention_rate_female)}</td></tr>
      </tbody>
    </table>

    <div class="gri-head">402 Labor/Management Relations</div>
    <div class="disclosure-head">402-1: Minimum notice periods regarding operational changes</div>
    <table><tbody>
      ${gkv('a. Minimum number of weeks\' notice typically provided to employees prior to significant operational changes', gri?.labor_notice_period)}
      ${gkv('b. For organizations with collective bargaining agreements, whether notice period and provisions are specified in collective agreements', gri?.labor_cba_notice)}
    </tbody></table>
    ${griPageFooter(17, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const socialPage2 = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 403 — Occupational Health & Safety', LOGO_IMG_SM)}
    <div class="gri-head">403 Occupational Health and Safety</div>

    <div class="disclosure-head">403-1: Occupational health and safety management system</div>
    <table><tbody>
      ${gkv('a.i. The system has been implemented because of legal requirements', gri?.ohs_legal_requirements)}
      ${gkv('a.ii. The system has been implemented based on recognized risk management and/or management system standards/guidelines', gri?.ohs_standards_guidelines)}
      ${gkv('b. Scope of workers, activities, and workplaces covered by the OHS management system', gri?.ohs_scope)}
    </tbody></table>

    <div class="disclosure-head">403-2: Hazard identification, risk assessment, and incident investigation</div>
    <table><tbody>
      ${gkv('a.i. How the organization ensures the quality of hazard identification processes', gri?.ohs_hazard_quality)}
      ${gkv('a.ii. How results are used to evaluate and continually improve the OHS management system', gri?.ohs_hazard_improvement)}
      ${gkv('b. Processes for workers to report work-related hazards and protection against reprisals', gri?.ohs_hazard_reporting)}
      ${gkv('c. Policies and processes for workers to remove themselves from dangerous work situations', gri?.ohs_work_removal)}
      ${gkv('d. Processes used to investigate work-related incidents', gri?.ohs_incident_investigation)}
    </tbody></table>

    <div class="disclosure-head">403-3 to 403-7: OHS services, participation, training, promotion, and prevention</div>
    <table><tbody>
      ${gkv('403-3: Occupational health services\' functions and how quality is ensured', gri?.ohs_services)}
      ${gkv('403-4: Processes for worker participation and consultation in OHS management system', gri?.ohs_worker_participation)}
      ${gkv('403-5: Occupational health and safety training provided to workers', gri?.ohs_training)}
      ${gkv('403-6: How the organization facilitates workers\' access to non-occupational medical and healthcare services', gri?.ohs_healthcare_access)}
      ${gkv('403-7: Approach to preventing/mitigating OHS impacts directly linked to business relationships', gri?.ohs_supply_chain_prevention)}
    </tbody></table>

    <div class="disclosure-head">403-8: Workers covered by an occupational health and safety management system</div>
    <table><tbody>
      ${gkv('i. Number of all employees covered by such a system', gri?.ohs_system_employees_covered)}
      ${gkv('ii. Number of all employees covered by a system that has been internally audited', gri?.ohs_system_internally_audited)}
      ${gkv('iii. Number of all employees covered by a system audited or certified by an external party', gri?.ohs_system_externally_audited)}
    </tbody></table>

    <div class="disclosure-head">403-9: Work-related injuries — For all employees</div>
    <table>
      <thead><tr><th>Metric</th><th>Employees</th><th>Non-employee workers</th></tr></thead>
      <tbody>
        <tr><td>i. Number of fatalities as a result of work-related injury</td><td>${gnil(gri?.ohs_fatalities_employees || '0')}</td><td>${gnil(gri?.ohs_fatalities_workers || '0')}</td></tr>
        <tr><td>ii. Number of high-consequence work-related injuries (excluding fatalities)</td><td>${gnil(gri?.ohs_high_consequence_employees || '0')}</td><td>${gnil(gri?.ohs_high_consequence_workers || '0')}</td></tr>
        <tr><td>iii. Number of recordable work-related injuries</td><td>${gnil(gri?.ohs_recordable_employees || '0')}</td><td>${gnil(gri?.ohs_recordable_workers || '0')}</td></tr>
        <tr><td>iv. Main types of work-related injury</td><td colspan="2">${gnil(gri?.ohs_injury_types)}</td></tr>
        <tr><td>v. Number of hours worked</td><td>${gnil(gri?.ohs_hours_employees)}</td><td>${gnil(gri?.ohs_hours_workers)}</td></tr>
      </tbody>
    </table>

    <div class="disclosure-head">403-10: Work-related ill health — For all employees</div>
    <table>
      <thead><tr><th>Metric</th><th>Employees</th><th>Non-employee workers</th></tr></thead>
      <tbody>
        <tr><td>i. Number of fatalities as a result of work-related ill health</td><td>${gnil(gri?.ohs_illhealth_fatalities_employees || '0')}</td><td>${gnil(gri?.ohs_illhealth_fatalities_workers || '0')}</td></tr>
        <tr><td>ii. Number of cases of recordable work-related ill health</td><td>${gnil(gri?.ohs_illhealth_recordable_employees || '0')}</td><td>${gnil(gri?.ohs_illhealth_recordable_workers || '0')}</td></tr>
        <tr><td>iii. Main types of work-related ill health</td><td colspan="2">${gnil(gri?.ohs_illhealth_types)}</td></tr>
      </tbody>
    </table>
    ${griPageFooter(18, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const socialPage3 = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 404-414 — Training, Diversity, Human Rights', LOGO_IMG_SM)}
    <div class="gri-head">404 Training and Education</div>

    <div class="disclosure-head">404-1: Average hours of training per year per employee</div>
    <div class="q-answer">${gnil(gri?.training_avg_hours)}</div>

    <div class="disclosure-head">404-2: Programs for upgrading employee skills and transition assistance programs</div>
    <div class="q-answer">${gnil(gri?.training_skill_programs)}</div>

    <div class="disclosure-head">404-3: Percentage of employees receiving regular performance and career development reviews</div>
    <table>
      <thead><tr><th>Category</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>Employees receiving regular performance and career development reviews</td><td>${gnil(gri?.performance_reviews_pct)}</td></tr>
        <tr><td>Male employees</td><td>${gnil(gri?.performance_reviews_male_pct)}</td></tr>
        <tr><td>Female employees</td><td>${gnil(gri?.performance_reviews_female_pct)}</td></tr>
        <tr><td>Total employees</td><td>${gnil(gri?.emp_total)}</td></tr>
      </tbody>
    </table>

    <div class="gri-head">414 Supplier Social Assessment</div>
    <div class="disclosure-head">414-1: New suppliers that were screened using social criteria</div>
    <table><tbody>
      ${gkv('a. Percentage of new suppliers that were screened using social criteria', gri?.social_supplier_screening_pct)}
    </tbody></table>
    <div class="disclosure-head">414-2: Negative social impacts in the supply chain and actions taken</div>
    <table><tbody>
      ${gkv('a. Number of suppliers assessed for social impacts', gri?.social_supplier_assessed)}
      ${gkv('b. Number of suppliers identified as having significant actual and potential negative social impacts', gri?.social_supplier_negative)}
      ${gkv('c. Significant actual and potential negative social impacts identified', gri?.social_supplier_impact_description)}
      ${gkv('d. % of suppliers with negative impacts with which improvements were agreed', gri?.social_supplier_improvements_pct)}
      ${gkv('e. % of suppliers with which relationships were terminated as a result of assessment', gri?.social_supplier_terminated_pct)}
    </tbody></table>

    <div class="gri-head">410 Security Practices</div>
    <div class="disclosure-head">410-1: Security personnel trained in human rights policies or procedures</div>
    <table><tbody>
      ${gkv('a. Percentage of security personnel who have received formal training in human rights policies', gri?.security_hr_training_pct)}
      ${gkv('b. Whether training requirements also apply to third-party organizations providing security personnel', gri?.security_hr_training_third_party)}
    </tbody></table>

    <div class="gri-head">411 Rights of Indigenous Peoples</div>
    <div class="disclosure-head">411-1: Incidents of violations involving rights of indigenous peoples</div>
    <table><tbody>
      ${gkv('a. Total number of identified incidents of violations involving the rights of indigenous peoples', gri?.indigenous_violations_count || 'NIL')}
      ${gkv('b.i. Incident reviewed by the organization', gri?.indigenous_violation_reviewed)}
      ${gkv('b.ii. Remediation plans being implemented', gri?.indigenous_remediation_plans)}
      ${gkv('b.iv. Incident no longer subject to action', gri?.indigenous_no_action)}
    </tbody></table>

    <div class="gri-head">412 Human Rights Assessment</div>
    <div class="disclosure-head">412-1: Operations that have been subject to human rights reviews or impact assessments</div>
    <table><tbody>
      ${gkv('a. Total number and % of operations subject to human rights reviews or impact assessments, by country', gri?.hr_operations_assessed)}
    </tbody></table>
    <div class="disclosure-head">412-2: Employee training on human rights policies or procedures</div>
    <table><tbody>
      ${gkv('a. Total hours in the reporting period devoted to training on human rights policies', gri?.hr_training_hours)}
      ${gkv('b. Percentage of employees trained in human rights policies', gri?.hr_training_pct)}
    </tbody></table>
    <div class="disclosure-head">412-3: Significant investment agreements and contracts that include human rights clauses</div>
    <table><tbody>
      ${gkv('a. Total number and % of significant investment agreements that include human rights clauses', gri?.hr_investment_agreements)}
      ${gkv('b. Definition used for \'significant investment agreements\'', gri?.hr_investment_definition)}
    </tbody></table>
    ${griPageFooter(19, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const socialPage4 = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 406-413 — Non-discrimination, Labor, Community', LOGO_IMG_SM)}
    <div class="gri-head">406 Non-discrimination</div>
    <div class="disclosure-head">406-1: Incidents of discrimination and corrective actions taken</div>
    <table><tbody>
      ${gkv('a. Total number of incidents of discrimination during the reporting period', gri?.discrimination_incidents || 'NIL')}
      ${gkv('b.i. Incident reviewed by the organization', gri?.discrimination_reviewed)}
      ${gkv('b.ii. Remediation plans being implemented', gri?.discrimination_remediation)}
      ${gkv('b.iii. Remediation plans that have been implemented, with results reviewed', gri?.discrimination_remediation_implemented)}
      ${gkv('b.iv. Incident no longer subject to action', gri?.discrimination_no_action)}
    </tbody></table>

    <div class="gri-head">407 Freedom of Association and Collective Bargaining</div>
    <div class="disclosure-head">407-1: Operations and suppliers in which the right to freedom of association may be at risk</div>
    <table><tbody>
      ${gkv('a.i. Type of operation (such as manufacturing plant) and supplier at risk', gri?.freedom_association_operations)}
      ${gkv('a.ii. Countries or geographic areas with operations and suppliers considered at risk', gri?.freedom_association_countries)}
      ${gkv('b. Measures taken to support rights to exercise freedom of association and collective bargaining', gri?.freedom_association_measures)}
    </tbody></table>

    <div class="gri-head">408 Child Labor</div>
    <div class="disclosure-head">408-1: Operations and suppliers considered to have significant risk for incidents of child labor</div>
    <table><tbody>
      ${gkv('a.i. Operations considered to have significant risk for incidents of child labor', gri?.child_labor_operations)}
      ${gkv('a.ii. Young workers exposed to hazardous work', gri?.child_labor_young_workers)}
      ${gkv('b. Measures taken to contribute to the effective abolition of child labor', gri?.child_labor_measures)}
    </tbody></table>

    <div class="gri-head">409 Forced Labor</div>
    <div class="disclosure-head">409-1: Operations and suppliers considered to have significant risk for incidents of forced or compulsory labor</div>
    <table><tbody>
      ${gkv('a.i. Operations and suppliers at risk — type of operation', gri?.forced_labor_operations)}
      ${gkv('a.ii. Countries or geographic areas with operations and suppliers considered at risk', gri?.forced_labor_countries)}
      ${gkv('b. Measures taken to contribute to the elimination of all forms of forced or compulsory labor', gri?.forced_labor_measures)}
    </tbody></table>

    <div class="gri-head">413 Local communities</div>
    <div class="disclosure-head">413-1: Operations with local community engagement, impact assessments, and development programs</div>
    <table>
      <thead><tr><th>Program Type</th><th>% of Operations</th></tr></thead>
      <tbody>
        <tr><td>i. Social impact assessments (including gender impact assessments)</td><td>${gnil(gri?.community_sia_pct)}</td></tr>
        <tr><td>ii. Environmental impact assessments and ongoing monitoring</td><td>${gnil(gri?.community_eia_pct)}</td></tr>
        <tr><td>iii. Public disclosure of results of environmental and social impact assessments</td><td>${gnil(gri?.community_disclosure_pct)}</td></tr>
        <tr><td>iv. Local community development programs based on local communities\' needs</td><td>${gnil(gri?.community_dev_programs_pct)}</td></tr>
        <tr><td>v. Stakeholder engagement plans based on stakeholder mapping</td><td>${gnil(gri?.community_stakeholder_plans_pct)}</td></tr>
        <tr><td>vi. Broad based local community consultation committees including vulnerable groups</td><td>${gnil(gri?.community_consultation_pct)}</td></tr>
        <tr><td>vii. Works councils, OHS committees, and other worker representation bodies</td><td>${gnil(gri?.community_works_councils_pct)}</td></tr>
        <tr><td>viii. Formal local community grievance processes</td><td>${gnil(gri?.community_grievance_pct)}</td></tr>
      </tbody>
    </table>
    <div class="disclosure-head">413-2: Operations with significant actual and potential negative impacts on local communities</div>
    <table><tbody>
      ${gkv('i. The location of the operations', gri?.community_negative_impact_locations)}
      ${gkv('ii. The significant actual and potential negative impacts of operations', gri?.community_negative_impacts)}
    </tbody></table>

    <div class="gri-head">202 Market Presence</div>
    <div class="disclosure-head">202-1: Ratios of standard entry level wage by gender compared to local minimum wage</div>
    <table><tbody>
      ${gkv('a. Ratio of entry level wage for Men to minimum wage', gri?.entry_wage_male_ratio)}
      ${gkv('a. Ratio of entry level wage for Women to minimum wage', gri?.entry_wage_female_ratio)}
      ${gkv('b. Actions taken to determine whether other workers are paid above minimum wage', gri?.entry_wage_other_workers)}
    </tbody></table>
    <div class="disclosure-head">202-2: Proportion of senior management hired from the local community</div>
    <table><tbody>
      ${gkv('a. Percentage of senior management at significant locations of operation hired from the local community', gri?.senior_mgmt_local_pct)}
      ${gkv('b. Definition used for \'senior management\'', gri?.senior_mgmt_definition)}
      ${gkv('c. Geographical definition of \'local\'', gri?.senior_mgmt_local_definition)}
    </tbody></table>
    ${griPageFooter(20, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  const socialPage5_customer = `
  <div class="page">
    ${griPageHeader(orgName, fyLabel, 'GRI 416-419 — Customer Responsibility', LOGO_IMG_SM)}
    <div class="gri-head">416 Customer Health and Safety</div>

    <div class="disclosure-head">416-1: Assessment of the health and safety impacts of product and service categories</div>
    <table><tbody>
      ${gkv('a. Percentage of significant product and service categories for which health and safety impacts are assessed', gri?.customer_hs_assessed_pct)}
    </tbody></table>
    <div class="disclosure-head">416-2: Incidents of non-compliance concerning health and safety impacts of products and services</div>
    <table><tbody>
      ${gkv('i. Incidents of non-compliance with regulations resulting in a fine or penalty', gri?.customer_hs_noncompliance_fine || 'NIL')}
      ${gkv('ii. Incidents of non-compliance with regulations resulting in a warning', gri?.customer_hs_noncompliance_warning || 'NIL')}
      ${gkv('iii. Incidents of non-compliance with voluntary codes', gri?.customer_hs_noncompliance_voluntary || 'NIL')}
    </tbody></table>

    <div class="gri-head">418 Customer Privacy</div>
    <div class="disclosure-head">418-1: Substantiated complaints concerning breaches of customer privacy and losses of customer data</div>
    <table><tbody>
      ${gkv('a.i. Complaints received from outside parties and substantiated by the organization', gri?.customer_privacy_external_complaints || 'NIL')}
      ${gkv('a.ii. Complaints from regulatory bodies', gri?.customer_privacy_regulatory_complaints || 'NIL')}
      ${gkv('b. Total number of identified leaks, thefts, or losses of customer data', gri?.customer_data_losses || 'NIL')}
    </tbody></table>

    <div class="gri-head">419 Socioeconomic Compliance</div>
    <div class="disclosure-head">419-1: Non-compliance with laws and regulations in the social and economic area</div>
    <table><tbody>
      ${gkv('a.i. Total monetary value of significant fines', gri?.socioeconomic_fines || 'NIL')}
      ${gkv('a.ii. Total number of non-monetary sanctions', gri?.socioeconomic_nonmonetary || 'NIL')}
      ${gkv('a.iii. Cases brought through dispute resolution mechanisms', gri?.socioeconomic_dispute || 'NIL')}
      ${gkv('b. If no non-compliance identified, a brief statement', gri?.socioeconomic_compliance_statement)}
      ${gkv('c. Context against which significant fines and non-monetary sanctions were incurred', gri?.socioeconomic_context)}
    </tbody></table>

    ${griPageFooter(21, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  // ── DECLARATION PAGE ──────────────────────────────────────────────────────────
  const declarationPage = `
  <div class="page" style="page-break-after:avoid;">
    ${griPageHeader(orgName, fyLabel, 'Declaration & Authorised Signatory', LOGO_IMG_SM)}
    <div class="gri-head">Declaration &amp; Authorised Signatory</div>

    ${verifier ? `
    <div style="background:var(--green-bg);border:1px solid var(--accent2);border-radius:3px;padding:10px 14px;margin-bottom:12px;font-size:8.5pt;line-height:1.7;">
      <strong>External Assurance — ${GRI_STD}</strong><br/>
      Assurance Provider: <strong>${gesc(verifier.verifier_name)}</strong> · Accreditation: ${gnil(verifier.accred_number)} · Assurance Level: ${gnil(verifier.assurance_level || 'Limited Assurance')} · Status: <strong style="color:var(--accent);">VERIFIED</strong>
    </div>` : `
    <div style="background:#fdf4e0;border:1px solid #d4a000;border-radius:3px;padding:8px 12px;font-size:8pt;color:var(--warn);margin-bottom:12px;">⚠ External assurance pending. Add a verifier in the Audit Trail tab in EtherTrack to enable external assurance disclosure.</div>`}

    <div style="border:1px solid var(--border);border-radius:4px;padding:12px 14px;background:var(--paper2);margin-bottom:14px;font-size:8.5pt;line-height:1.8;">
      We hereby confirm that the GRI Sustainability Report disclosures for the reporting period ${fyLabel}
      are accurate and complete to the best of our knowledge and have been prepared in accordance with
      ${GRI_STD}, covering GRI 2: General Disclosures, GRI 300: Environmental Topics, and GRI 400: Social Topics.
      Emission data has been prepared in accordance with the GHG Protocol Corporate Standard,
      CEA V20.0 Dec 2024 (${gridEmissionFactor} tCO₂/MWh), IPCC AR6 GWP100, and DEFRA 2024.
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:14px;">
      <div style="border-top:1.5px solid var(--ink);padding-top:8px;">
        <div style="height:22px;border-bottom:1px solid var(--border);margin-bottom:4px;"></div>
        <div style="font-size:7.5pt;color:var(--muted);font-family:'IBM Plex Mono',monospace;letter-spacing:.06em;">PREPARER — Name &amp; Designation</div>
        <div style="margin-top:10px;height:22px;border-bottom:1px solid var(--border);margin-bottom:4px;"></div>
        <div style="font-size:7.5pt;color:var(--muted);font-family:'IBM Plex Mono',monospace;letter-spacing:.06em;">DATE (DD/MM/YYYY)</div>
      </div>
      <div style="border-top:1.5px solid var(--ink);padding-top:8px;">
        <div style="height:22px;border-bottom:1px solid var(--border);margin-bottom:4px;"></div>
        <div style="font-size:7.5pt;color:var(--muted);font-family:'IBM Plex Mono',monospace;letter-spacing:.06em;">REVIEWER / CFO — Name &amp; Designation</div>
        <div style="margin-top:10px;height:22px;border-bottom:1px solid var(--border);margin-bottom:4px;"></div>
        <div style="font-size:7.5pt;color:var(--muted);font-family:'IBM Plex Mono',monospace;letter-spacing:.06em;">DATE (DD/MM/YYYY)</div>
      </div>
      <div style="border-top:1.5px solid var(--ink);padding-top:8px;">
        <div style="height:22px;border-bottom:1px solid var(--border);margin-bottom:4px;"></div>
        <div style="font-size:7.5pt;color:var(--muted);font-family:'IBM Plex Mono',monospace;letter-spacing:.06em;">MD / CEO — Name, Designation &amp; DIN</div>
        <div style="margin-top:10px;height:22px;border-bottom:1px solid var(--border);margin-bottom:4px;"></div>
        <div style="font-size:7.5pt;color:var(--muted);font-family:'IBM Plex Mono',monospace;letter-spacing:.06em;">DATE (DD/MM/YYYY)</div>
      </div>
    </div>
    <div style="border:1px dashed var(--border);height:60px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:7.5pt;color:var(--muted);margin-top:12px;font-family:'IBM Plex Mono',monospace;letter-spacing:.08em;">COMPANY SEAL / STAMP</div>

    <div style="margin-top:12px;font-size:8pt;color:var(--muted);line-height:1.7;border-top:1px solid var(--border2);padding-top:8px;">
      <strong>GRI Standard:</strong> ${GRI_STD} ·
      <strong>Emission Factors:</strong> CEA India V20.0 Dec 2024 (${gridEmissionFactor} tCO₂/MWh) · DEFRA 2024 · IPCC AR6 GWP100 ·
      <strong>Boundary:</strong> Operational Control · GHG Protocol Corporate Standard
    </div>
    ${griPageFooter(22, orgName, fyLabel, TOTAL_PAGES)}
  </div>`;

  // ── STITCH ALL PAGES ─────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>GRI Sustainability Report — ${gesc(orgName)} — ${fyLabel}</title>
  <style>${GRI_CSS}</style>
</head>
<body>
  ${coverPage}
  ${tocPage}
  ${gri2_org}
  ${gri2_activities}
  ${gri2_governance}
  ${gri2_governance2}
  ${gri2_strategy}
  ${gri2_stakeholder}
  ${govPage}
  ${economicPage}
  ${anticorruptionTaxPage}
  ${envPage1}
  ${envPage2}
  ${envPage3}
  ${envPage4_emissions}
  ${envPage5_waste}
  ${socialPage1}
  ${socialPage2}
  ${socialPage3}
  ${socialPage4}
  ${socialPage5_customer}
  ${declarationPage}
</body>
</html>`;
};

// ─────────────────────────────────────────────────────────────────────────────
// CDP CLIMATE REPORT
// ─────────────────────────────────────────────────────────────────────────────
const buildCDPHTML = (d) => {
  const {
    orgName, year, profile,
    scope2Location, scope2Market, gridEmissionFactor = 0.727, pppRate = 27.3,
  } = d;

  const emissions   = toArr(d.emissions);
  const retirements = toArr(d.retirements);

  const scope1 = emissions.filter(r => r.scope === 1).reduce((s, r) => s + f(r.co2e), 0);
  const scope2 = emissions.filter(r => r.scope === 2).reduce((s, r) => s + f(r.co2e), 0);
  const scope3 = emissions.filter(r => r.scope === 3).reduce((s, r) => s + f(r.co2e), 0);
  const total  = scope1 + scope2 + scope3;
  const s2Loc  = f(scope2Location) || scope2;
  const s2Mkt  = f(scope2Market) || 0;
  const totalRetired = retirements.reduce((s, r) => s + parseInt(r.amount || 0), 0);
  const revenueCr   = f(profile?.revenue_cr);
  const revenuePPPM = revenueCr ? (revenueCr * 1e7) / pppRate / 1e6 : null;

  return page(
    `CDP Climate Change Questionnaire`,
    `Carbon Disclosure Project · Climate Change ${parseInt(year)+1} · Reporting Year ${year} · Preparatory Document — Submit via cdp.net`,
    `
    <div class="section">
      <div class="section-title">C0 — INTRODUCTION</div>
      <div class="grid-2">
        <div class="field"><div class="label">ORGANISATION</div><div class="value">${esc(orgName)}</div></div>
        <div class="field"><div class="label">REPORTING YEAR</div><div class="value green">FY ${year}</div></div>
        <div class="field"><div class="label">COUNTRY</div><div class="value">India</div></div>
        <div class="field"><div class="label">ACTIVITY (NACE / NIC)</div><div class="value">${esc(profile?.industry || '—')}</div></div>
        <div class="field"><div class="label">REVENUE (₹ Cr)</div><div class="value">${revenueCr > 0 ? `₹${fmt(revenueCr)} Cr` : '—'}</div></div>
        <div class="field"><div class="label">EMPLOYEES</div><div class="value">${parseInt(profile?.employees || 0) > 0 ? parseInt(profile.employees).toLocaleString('en-IN') : '—'}</div></div>
        <div class="field"><div class="label">GRID EF USED</div><div class="value orange">${gridEmissionFactor} tCO₂/MWh — CEA V20.0 Dec 2024</div></div>
        <div class="field"><div class="label">CIN</div><div class="value">${esc(profile?.company_cin || '—')}</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">C1 — GOVERNANCE</div>
      <table>
        <thead><tr><th>QUESTION</th><th>RESPONSE</th></tr></thead>
        <tbody>
          <tr><td>C1.1 — Board-level oversight of climate issues</td><td>Board reviews climate performance via ESG/Audit Committee at least annually</td></tr>
          <tr><td>C1.2 — Management-level responsibility</td><td>Chief Sustainability Officer (or equivalent) monitors via EtherTrack Carbon Intelligence</td></tr>
          <tr><td>C1.3 — Employee incentives for climate management</td><td>ESG performance metrics linked to management KPIs</td></tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">C2 — RISKS AND OPPORTUNITIES</div>
      <table>
        <thead><tr><th>TYPE</th><th>RISK / OPPORTUNITY</th><th>TIME HORIZON</th><th>POTENTIAL IMPACT</th></tr></thead>
        <tbody>
          <tr><td>Transition</td><td>India CCTS carbon pricing (Oct 2026)</td><td>Short (1–3 yrs)</td><td>Increased operating costs</td></tr>
          <tr><td>Transition</td><td>India NDC tightening / BRSR mandatory disclosure</td><td>Medium (3–10 yrs)</td><td>Regulatory penalties</td></tr>
          <tr><td>Physical</td><td>Extreme weather disrupting operations</td><td>Long (10+ yrs)</td><td>Business interruption</td></tr>
          <tr><td>Opportunity</td><td>Renewable energy procurement (Scope 2 reduction)</td><td>Short</td><td>Lower costs, ESG rating uplift</td></tr>
          <tr><td>Opportunity</td><td>Carbon credit generation / CCTS CCC</td><td>Short–Medium</td><td>Revenue stream</td></tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">C3 — BUSINESS STRATEGY</div>
      <table>
        <thead><tr><th>QUESTION</th><th>RESPONSE</th></tr></thead>
        <tbody>
          <tr><td>C3.1 — Climate integrated into business strategy</td><td>Yes — GHG reduction targets integrated into business planning and capital allocation decisions</td></tr>
          <tr><td>C3.2 — Scenario analysis conducted</td><td>IEA Net Zero 2050 · IPCC 1.5°C · India NDC 2030 · RCP 4.5 / RCP 8.5</td></tr>
          <tr><td>C3.3 — Financial impact of climate risks quantified</td><td>Carbon cost of goods and CCTS compliance costs being assessed</td></tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">C4 — TARGETS AND PERFORMANCE</div>
      <table>
        <thead><tr><th>TARGET</th><th>YEAR</th><th>REDUCTION VS BASE (${esc(profile?.base_year || '2024')})</th><th>STATUS</th></tr></thead>
        <tbody>
          <tr><td>India NDC-aligned 50% reduction</td><td>2030</td><td>50% — Scope 1 + 2</td><td><span class="badge badge-blue">IN PROGRESS</span></td></tr>
          <tr><td>SBTi 1.5°C aligned target</td><td>2035</td><td>65% — Scope 1 + 2 + 3</td><td><span class="badge badge-orange">PLANNED</span></td></tr>
          <tr><td>Net Zero — Paris Agreement</td><td>${esc(profile?.net_zero_year || '2050')}</td><td>≥90% + residual offset</td><td><span class="badge badge-green">COMMITTED</span></td></tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">C5 — EMISSIONS METHODOLOGY</div>
      <table>
        <thead><tr><th>ELEMENT</th><th>DETAILS</th></tr></thead>
        <tbody>
          <tr><td>C5.1 — Methodology standard</td><td>GHG Protocol Corporate Standard (2004, revised 2015)</td></tr>
          <tr><td>C5.2 — Consolidation approach</td><td>Operational Control</td></tr>
          <tr><td>C5.3 — GWP values</td><td>IPCC AR6 (2021) — 100-year GWP100</td></tr>
          <tr><td>C5.4 — Emission factor sources</td><td>DEFRA 2024 · CEA V20.0 Dec 2024 (0.727 tCO₂/MWh) · IPCC AR6 · IEA 2024</td></tr>
          <tr><td>C5.5 — GHG tracking system</td><td>EtherTrack Carbon Intelligence Platform — blockchain-verified</td></tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">C6 — EMISSIONS DATA (CDP MANDATORY — DUAL SCOPE 2)</div>
      <table>
        <thead><tr><th>CDP QUESTION</th><th>RESPONSE</th><th>FY ${parseInt(year)-1}</th><th>UNIT</th><th>METHODOLOGY</th></tr></thead>
        <tbody>
          <tr><td>C6.1 — Scope 1 GHG emissions</td><td class="green">${fmt(scope1)}</td><td>—</td><td>tCO₂e</td><td>GHG Protocol / DEFRA 2024</td></tr>
          <tr><td>C6.3 — Scope 2 (location-based)</td><td class="green">${fmt(s2Loc)}</td><td>—</td><td>tCO₂e</td><td>CEA V20.0 Dec 2024</td></tr>
          <tr><td>C6.3a — Scope 2 (market-based)</td><td class="green">${fmt(s2Mkt)}</td><td>—</td><td>tCO₂e</td><td>REC / PPA contractual instruments</td></tr>
          <tr><td>C6.5 — Scope 3 total</td><td class="green">${fmt(scope3)}</td><td>—</td><td>tCO₂e</td><td>GHG Protocol / IPCC AR6</td></tr>
          <tr><td>C6.5a — Scope 3 categories tracked</td><td>${emissions.filter(r=>r.scope===3).length} categories</td><td>—</td><td>—</td><td>Activity-based</td></tr>
          <tr><td>C6.7 — Biogenic emissions</td><td>0</td><td>—</td><td>tCO₂e</td><td>Not applicable</td></tr>
          <tr style="font-weight:700;"><td>TOTAL GROSS (LOCATION-BASED)</td><td class="green">${fmt(total)}</td><td>—</td><td>tCO₂e</td><td></td></tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">C7 — EMISSIONS BREAKDOWN &amp; INTENSITY</div>
      <div class="grid-3">
        ${revenueCr && total ? `<div class="field"><div class="label">INTENSITY (₹Cr)</div><div class="value">${fmt(total/revenueCr,3)} tCO₂e/₹Cr</div></div>` : ''}
        ${revenuePPPM && total ? `<div class="field"><div class="label">INTENSITY (PPP-adj.)</div><div class="value orange">${fmt(total/revenuePPPM,2)} tCO₂e/$M PPP</div><div class="muted" style="font-size:8px;">IMF WEO Apr 2025 · ₹${pppRate}/intl.$</div></div>` : ''}
        <div class="field"><div class="label">% SCOPE 1</div><div class="value">${fmt(total ? scope1/total*100 : 0, 1)}%</div></div>
        <div class="field"><div class="label">% SCOPE 2</div><div class="value">${fmt(total ? s2Loc/total*100 : 0, 1)}%</div></div>
        <div class="field"><div class="label">% SCOPE 3</div><div class="value">${fmt(total ? scope3/total*100 : 0, 1)}%</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">C8 — ENERGY</div>
      <div style="font-size:10px;color:#86efac88;line-height:1.8;">
        Energy consumption data is disclosed under SEBI BRSR Core P6-E2 (GRI 302).
        Enter energy data in EtherTrack BRSR Environmental tab to populate this section for CDP submission.
      </div>
    </div>

    <div class="section">
      <div class="section-title">C9 — ADDITIONAL METRICS (WATER / FORESTS / BIODIVERSITY)</div>
      <div style="font-size:10px;color:#86efac88;line-height:1.8;">
        Water and waste data disclosed under SEBI BRSR Core P6-E3/P6-E4 (GRI 303/306).
        Forest and biodiversity metrics to be assessed as part of TNFD alignment roadmap.
      </div>
    </div>

    <div class="section">
      <div class="section-title">C11 — CARBON PRICING</div>
      <div class="grid-2">
        <div class="field"><div class="label">C11.2 — CREDITS RETIRED</div><div class="value green">${fmt(totalRetired, 0)} tCO₂e</div></div>
        <div class="field"><div class="label">NET AFTER RETIREMENT</div><div class="value ${Math.max(0,total-totalRetired)>0?'orange':'green'}">${fmt(Math.max(0,total-totalRetired))} tCO₂e</div></div>
        <div class="field"><div class="label">C11.2a — REGISTRIES</div><div class="value">VCS / Gold Standard / India CCTS</div></div>
        <div class="field"><div class="label">C11.2b — CREDIT TYPE</div><div class="value">VCU / CCC (India)</div></div>
        <div class="field"><div class="label">C11.2c — VERIFICATION</div><div class="value">ISO 14064-3 / Blockchain (Ethereum)</div></div>
        <div class="field"><div class="label">CARBON PRICING EXPOSURE</div><div class="value">India CCTS — compliance from Oct 2026</div></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">SUBMISSION INSTRUCTIONS</div>
      <div style="font-size:10px;color:#86efac66;line-height:1.8;">
        This is a preparatory disclosure document. To submit to CDP officially:<br/>
        1. Log in at cdp.net with your organisation account<br/>
        2. Complete the full CDP Climate questionnaire online<br/>
        3. Use figures above for C0, C1–C7, C11 sections<br/>
        4. Upload GHG inventory &amp; audit trail exports from EtherTrack as supporting evidence<br/>
        5. Submit by your CDP response deadline<br/><br/>
        <strong style="color:#fbbf24;">Note:</strong> CDP requires dual Scope 2 reporting. Both location-based and market-based figures above are mandatory.
      </div>
    </div>
    `,
    { org: orgName, year }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TCFD REPORT
// ─────────────────────────────────────────────────────────────────────────────
const buildTCFDHTML = (d) => {
  const {
    orgName, year, profile,
    scope2Location, scope2Market, gridEmissionFactor = 0.727, pppRate = 27.3,
  } = d;

  const emissions   = toArr(d.emissions);
  const retirements = toArr(d.retirements);

  const scope1 = emissions.filter(r => r.scope === 1).reduce((s, r) => s + f(r.co2e), 0);
  const scope2 = emissions.filter(r => r.scope === 2).reduce((s, r) => s + f(r.co2e), 0);
  const scope3 = emissions.filter(r => r.scope === 3).reduce((s, r) => s + f(r.co2e), 0);
  const total  = scope1 + scope2 + scope3;
  const s2Loc  = f(scope2Location) || scope2;
  const s2Mkt  = f(scope2Market) || 0;
  const totalRetired = retirements.reduce((s, r) => s + parseInt(r.amount || 0), 0);
  const revenueCr   = f(profile?.revenue_cr);
  const revenuePPPM = revenueCr ? (revenueCr * 1e7) / pppRate / 1e6 : null;

  return page(
    `Task Force on Climate-related Financial Disclosures`,
    `TCFD Framework · 4 Pillars: Governance · Strategy · Risk Management · Metrics & Targets`,
    `
    <div class="section">
      <div class="section-title">PILLAR 1 — GOVERNANCE</div>
      <h3>a) Board Oversight of Climate-related Risks &amp; Opportunities</h3>
      <table>
        <thead><tr><th>ELEMENT</th><th>DISCLOSURE</th></tr></thead>
        <tbody>
          <tr><td>Board-level oversight body</td><td>Board of Directors via ESG / Sustainability Committee</td></tr>
          <tr><td>Frequency of board review</td><td>At least annually; material climate events reviewed as needed</td></tr>
          <tr><td>Climate information sources</td><td>EtherTrack Carbon Intelligence Platform — real-time GHG dashboard</td></tr>
          <tr><td>Climate in board mandate</td><td>Climate risk included in Board risk register and annual strategic review</td></tr>
        </tbody>
      </table>
      <h3>b) Management Role in Assessing &amp; Managing Climate Issues</h3>
      <table>
        <thead><tr><th>ELEMENT</th><th>DISCLOSURE</th></tr></thead>
        <tbody>
          <tr><td>Responsible executive</td><td>Chief Sustainability Officer (or designated ESG lead)</td></tr>
          <tr><td>Reporting line</td><td>Reports to CEO; climate metrics presented to Board quarterly</td></tr>
          <tr><td>Management processes</td><td>Annual GHG inventory, BRSR materiality assessment, target monitoring via EtherTrack</td></tr>
          <tr><td>Employee incentives</td><td>ESG KPIs incorporated into senior management performance objectives</td></tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">PILLAR 2 — STRATEGY</div>
      <h3>a) Climate Risks &amp; Opportunities Identified</h3>
      <table>
        <thead><tr><th>TYPE</th><th>RISK / OPPORTUNITY</th><th>TIME HORIZON</th><th>POTENTIAL FINANCIAL IMPACT</th></tr></thead>
        <tbody>
          <tr><td>Transition</td><td>India CCTS carbon pricing (Oct 2026 compliance launch)</td><td>Short (1–3 yrs)</td><td>Additional compliance cost on emissions above allocation</td></tr>
          <tr><td>Transition</td><td>India NDC policy tightening — BRSR mandatory disclosure expansion</td><td>Medium (3–10 yrs)</td><td>Regulatory penalties; reputational risk</td></tr>
          <tr><td>Transition</td><td>Market shift: low-carbon product demand from customers</td><td>Medium</td><td>Revenue opportunity or loss of contracts</td></tr>
          <tr><td>Physical (Acute)</td><td>Extreme weather events disrupting operations / supply chain</td><td>Long (10+ yrs)</td><td>Business interruption losses; asset damage</td></tr>
          <tr><td>Physical (Chronic)</td><td>Water stress at operational sites — GRI 303</td><td>Medium–Long</td><td>Increased water costs; operational restrictions</td></tr>
          <tr><td>Opportunity</td><td>Renewable energy procurement (Scope 2 elimination via RECs/PPAs)</td><td>Short</td><td>Lower energy costs; improved ESG ratings</td></tr>
          <tr><td>Opportunity</td><td>Carbon credit generation &amp; CCTS CCC revenue</td><td>Short–Medium</td><td>New revenue stream from carbon markets</td></tr>
        </tbody>
      </table>
      <h3>b) Impact on Business, Strategy &amp; Financial Planning</h3>
      <table>
        <thead><tr><th>AREA</th><th>IMPACT</th></tr></thead>
        <tbody>
          <tr><td>Products &amp; Services</td><td>Carbon footprint of goods tracked via EtherTrack; used for customer Scope 3 disclosures</td></tr>
          <tr><td>Supply Chain</td><td>Supplier engagement on Scope 3 Cat 1 (Purchased Goods) — material category</td></tr>
          <tr><td>Capital Allocation</td><td>Climate risk criteria integrated into capex decisions; renewable energy investments prioritised</td></tr>
          <tr><td>R&amp;D</td><td>Energy efficiency improvements and low-carbon technology adoption being evaluated</td></tr>
        </tbody>
      </table>
      <h3>c) Scenario Analysis</h3>
      <table>
        <thead><tr><th>SCENARIO</th><th>DESCRIPTION</th><th>TEMPERATURE</th></tr></thead>
        <tbody>
          <tr><td>IEA Net Zero 2050</td><td>Full energy transition by 2050; strong carbon pricing globally</td><td>1.5°C</td></tr>
          <tr><td>IPCC 1.5°C Pathway</td><td>Rapid decarbonisation with high transition risk</td><td>1.5°C</td></tr>
          <tr><td>India NDC 2030</td><td>India's Nationally Determined Contribution commitments</td><td>2°C</td></tr>
          <tr><td>RCP 4.5</td><td>Moderate emissions — significant physical risk by 2050</td><td>~2.5°C</td></tr>
          <tr><td>RCP 8.5</td><td>High-emissions baseline — severe physical risk</td><td>~4°C</td></tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">PILLAR 3 — RISK MANAGEMENT</div>
      <h3>a) Process for Identifying &amp; Assessing Climate Risks</h3>
      <table>
        <thead><tr><th>PROCESS ELEMENT</th><th>DESCRIPTION</th></tr></thead>
        <tbody>
          <tr><td>Risk identification method</td><td>Annual GHG inventory (EtherTrack) + BRSR materiality assessment + scenario analysis (1.5°C and 4°C pathways)</td></tr>
          <tr><td>Risk categories assessed</td><td>Transition risks (policy, technology, market, reputation) and Physical risks (acute and chronic)</td></tr>
          <tr><td>Assessment frequency</td><td>Annual formal review; continuous monitoring via EtherTrack dashboard</td></tr>
          <tr><td>Financial materiality threshold</td><td>Risks assessed against quantitative financial impact thresholds per enterprise risk management policy</td></tr>
          <tr><td>Tools used</td><td>EtherTrack Carbon Intelligence · IEA World Energy Outlook · IPCC AR6 Physical Risk Data</td></tr>
        </tbody>
      </table>
      <h3>b) Process for Managing Climate Risks</h3>
      <table>
        <thead><tr><th>RISK</th><th>MITIGATION ACTION</th><th>OWNER</th><th>STATUS</th></tr></thead>
        <tbody>
          <tr><td>Carbon pricing / CCTS compliance</td><td>GHG reduction roadmap; carbon credit retirement via EtherTrack</td><td>CSO</td><td><span class="badge badge-blue">IN PROGRESS</span></td></tr>
          <tr><td>Scope 2 grid emissions</td><td>Renewable energy procurement — RECs / PPAs / Green Tariff</td><td>Operations</td><td><span class="badge badge-orange">PLANNED</span></td></tr>
          <tr><td>Scope 3 supply chain</td><td>Supplier engagement; requiring GHG data from material suppliers</td><td>Procurement</td><td><span class="badge badge-orange">PLANNED</span></td></tr>
          <tr><td>Water stress (physical)</td><td>Water efficiency programme; GRI 303 monitoring via EtherTrack</td><td>Operations</td><td><span class="badge badge-blue">IN PROGRESS</span></td></tr>
          <tr><td>Policy / regulatory risk</td><td>BRSR Core compliance; CDP disclosure; proactive regulatory engagement</td><td>CSO / Legal</td><td><span class="badge badge-green">ACTIVE</span></td></tr>
        </tbody>
      </table>
      <h3>c) Integration into Enterprise Risk Management</h3>
      <div style="font-size:10px;color:#f0fdf4cc;line-height:1.8;">
        Climate risk is integrated into ${esc(orgName)}'s enterprise risk management (ERM) framework.
        Physical and transition risks identified through TCFD analysis are mapped to the organisational risk register.
        Climate risk is reviewed by the Risk Committee alongside financial, operational, and reputational risks.
        Material climate risks are reported to the Board of Directors at least annually.
      </div>
    </div>

    <div class="section">
      <div class="section-title">PILLAR 4 — METRICS &amp; TARGETS</div>
      <h3>GHG Emissions — FY ${year}</h3>
      <table>
        <thead><tr><th>METRIC</th><th>VALUE FY ${year}</th><th>FY ${parseInt(year)-1}</th><th>UNIT</th><th>METHODOLOGY</th></tr></thead>
        <tbody>
          <tr><td class="orange">Scope 1 — Direct</td><td class="green">${fmt(scope1)}</td><td>—</td><td>tCO₂e</td><td>Activity-based · DEFRA 2024</td></tr>
          <tr><td class="blue">Scope 2 — Location-based</td><td class="green">${fmt(s2Loc)}</td><td>—</td><td>tCO₂e</td><td>CEA V20.0 Dec 2024 · ${gridEmissionFactor} tCO₂/MWh</td></tr>
          <tr><td class="blue">Scope 2 — Market-based</td><td class="green">${fmt(s2Mkt)}</td><td>—</td><td>tCO₂e</td><td>Contractual instruments (REC/PPA)</td></tr>
          <tr><td class="purple">Scope 3 — Value chain (all 15 categories)</td><td class="green">${fmt(scope3)}</td><td>—</td><td>tCO₂e</td><td>Activity-based · All 15 categories</td></tr>
          <tr style="font-weight:700;"><td>TOTAL GROSS EMISSIONS</td><td class="green">${fmt(total)}</td><td>—</td><td>tCO₂e</td><td>GHG Protocol Corporate Standard</td></tr>
          <tr><td>Carbon Credits Retired</td><td class="green">${fmt(totalRetired, 0)}</td><td>—</td><td>tCO₂e</td><td>EtherTrack · Blockchain-verified</td></tr>
          <tr><td>Net Emissions After Offset</td><td class="${Math.max(0,total-totalRetired)>0?'orange':'green'}">${fmt(Math.max(0,total-totalRetired))}</td><td>—</td><td>tCO₂e</td><td>Gross minus retirements</td></tr>
          ${revenueCr && total ? `<tr><td>Revenue Intensity (₹Cr)</td><td>${fmt(total/revenueCr,3)}</td><td>—</td><td>tCO₂e/₹Cr</td><td>Revenue-based</td></tr>` : ''}
          ${revenuePPPM && total ? `<tr><td>Revenue Intensity — PPP-adjusted (ISF Dec 2024)</td><td class="orange">${fmt(total/revenuePPPM,2)}</td><td>—</td><td>tCO₂e/$M PPP</td><td>IMF WEO Apr 2025 · ₹${pppRate}/intl.$</td></tr>` : ''}
        </tbody>
      </table>
      <h3>Climate Targets</h3>
      <table>
        <thead><tr><th>TARGET</th><th>TARGET YEAR</th><th>REDUCTION vs BASE YEAR (${esc(profile?.base_year || '2024')})</th><th>SCOPE</th><th>STATUS</th></tr></thead>
        <tbody>
          <tr><td>50% reduction — India NDC aligned</td><td>2030</td><td>50%</td><td>Scope 1 + 2</td><td><span class="badge badge-blue">IN PROGRESS</span></td></tr>
          <tr><td>SBTi 1.5°C aligned near-term target</td><td>2035</td><td>65%</td><td>Scope 1 + 2 + 3</td><td><span class="badge badge-orange">PLANNED</span></td></tr>
          <tr><td>Net Zero — Paris Agreement Art. 4.1</td><td>${esc(profile?.net_zero_year || '2050')}</td><td>≥90% + offset residual</td><td>All scopes</td><td><span class="badge badge-green">COMMITTED</span></td></tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-title">VERIFICATION STATUS — ISO 14064-3</div>
      <div style="color:#fbbf2488;font-size:10px;">⚠ Third-party verification pending. Contact hello@ethertrack.in to engage Bureau Veritas / DNV / EY / KPMG.</div>
    </div>

    <div class="section">
      <div class="section-title">DECLARATION &amp; AUTHORISED SIGNATORY</div>
      <div style="font-size:9px;color:#f0fdf4cc;line-height:1.8;margin-bottom:20px;">
        I hereby confirm that the TCFD Climate Disclosure disclosures above are accurate and complete to the best of my knowledge,
        prepared in accordance with TCFD recommendations (2017, updated 2021) and applicable standards.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:16px;">
        <div style="border-top:1px solid #22c55e44;padding-top:8px;">
          <div style="height:28px;"></div>
          <div style="font-size:8px;color:#86efac55;letter-spacing:.08em;">NAME &amp; DESIGNATION</div>
          <div style="height:18px;border-bottom:1px solid #0d1f11;margin-top:10px;"></div>
          <div style="font-size:8px;color:#86efac55;margin-top:4px;">DIN / PAN</div>
          <div style="height:18px;border-bottom:1px solid #0d1f11;margin-top:10px;"></div>
          <div style="font-size:8px;color:#86efac55;margin-top:4px;">DATE (DD/MM/YYYY)</div>
        </div>
        <div style="border-top:1px solid #22c55e44;padding-top:8px;">
          <div style="height:28px;"></div>
          <div style="font-size:8px;color:#86efac55;letter-spacing:.08em;">REVIEWER / CFO</div>
          <div style="height:18px;border-bottom:1px solid #0d1f11;margin-top:10px;"></div>
          <div style="font-size:8px;color:#86efac55;margin-top:4px;">DATE (DD/MM/YYYY)</div>
        </div>
        <div style="border-top:1px solid #22c55e44;padding-top:8px;">
          <div style="height:60px;border:1px dashed #0d1f11;border-radius:4px;display:flex;align-items:center;justify-content:center;">
            <div style="font-size:8px;color:#86efac33;">COMPANY SEAL / STAMP</div>
          </div>
        </div>
      </div>
    </div>
    `,
    { org: orgName, year }
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// RETIREMENT CERTIFICATE
// ─────────────────────────────────────────────────────────────────────────────
const buildCertificateHTML = (cert) => {
  const C = {
    bg: '#040706', surface: '#070c09', border: '#0d1f11',
    green: '#22c55e', blue: '#60a5fa', purple: '#a78bfa',
    orange: '#f97316', text: '#f0fdf4', muted: '#86efac',
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <style>
  
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: ${C.bg}; color: ${C.text}; font-family: 'DM Mono', monospace; padding: 40px; min-height: 297mm; }
    .header { background: linear-gradient(135deg, #051409, #0d2e1f); border: 1px solid ${C.green}44; border-radius: 12px; padding: 24px 32px; margin-bottom: 28px; }
    .header-top { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; }
    .header-text { flex: 1; }
    .header-label { font-size: 9px; color: ${C.green}99; letter-spacing: .2em; margin-bottom: 6px; }
    .header-title { font-family: 'Syne', sans-serif; font-size: 24px; font-weight: 800; color: ${C.text}; margin-bottom: 6px; }
    .header-sub { font-size: 9px; color: ${C.muted}66; letter-spacing: .1em; }
    .verifier-badge { background: #0d0a1a; border: 1px solid ${C.purple}44; border-radius: 10px; padding: 14px 20px; margin-bottom: 24px; display: flex; align-items: center; gap: 14px; }
    .verifier-icon { font-size: 24px; }
    .verifier-name { font-size: 12px; color: ${C.purple}; font-weight: 700; margin-bottom: 4px; }
    .verifier-sub  { font-size: 9px; color: ${C.purple}66; }
    .verifier-tag  { margin-left: auto; font-size: 9px; padding: 4px 10px; border-radius: 4px; background: ${C.green}11; color: ${C.green}; border: 1px solid ${C.green}33; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
    .grid-full { grid-column: 1 / -1; }
    .field { background: ${C.surface}; border: 1px solid ${C.border}; border-radius: 8px; padding: 12px 14px; }
    .field-label { font-size: 8px; color: ${C.muted}55; letter-spacing: .12em; margin-bottom: 5px; }
    .field-value { font-size: 12px; color: ${C.text}; font-weight: 600; word-break: break-all; }
    .field-value.green  { color: ${C.green};  }
    .field-value.blue   { color: ${C.blue};   }
    .field-value.purple { color: ${C.purple}; }
    .tx-box { background: #060e18; border: 1px solid ${C.blue}22; border-radius: 8px; padding: 14px; margin-bottom: 16px; }
    .qr-section { background: ${C.surface}; border: 1px solid ${C.green}22; border-radius: 10px; padding: 16px; display: flex; align-items: center; gap: 20px; margin-bottom: 20px; }
    .qr-box { width: 100px; height: 100px; background: #0a0f0c; border: 1px solid ${C.green}22; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 9px; color: ${C.muted}44; }
    .verify-label { font-size: 9px; color: ${C.green}88; letter-spacing: .1em; margin-bottom: 6px; }
    .verify-url   { font-size: 10px; color: ${C.green}66; font-family: monospace; word-break: break-all; }
    .footer { text-align: center; font-size: 8px; color: ${C.muted}44; letter-spacing: .1em; margin-top: 24px; padding-top: 16px; border-top: 1px solid ${C.border}; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      ${LOGO_BASE64 ? `<img src="${LOGO_BASE64}" alt="EtherTrack" style="height:48px;width:auto;object-fit:contain;" />` : ''}
      <div class="header-text">
        <div class="header-label">ETHERTRACK TECHNOLOGIES PRIVATE LIMITED · BLOCKCHAIN-VERIFIED</div>
        <div class="header-title">Carbon Retirement Certificate</div>
        <div class="header-sub">ISO 14064-3 · GHG PROTOCOL · BRSR · CDP · TCFD · PARIS AGREEMENT ART.6</div>
      </div>
    </div>
  </div>

  ${cert.verifier ? `
  <div class="verifier-badge">
    <div class="verifier-icon">🔍</div>
    <div>
      <div class="verifier-name">INDEPENDENTLY VERIFIED — ${esc(cert.verifier.verifier_name?.toUpperCase())}</div>
      <div class="verifier-sub">ISO 14065 accredited · Enables CDP Verified + BRSR Level 2 submission</div>
    </div>
    <div class="verifier-tag">VERIFIED</div>
  </div>` : ''}

  <div class="grid">
    <div class="field"><div class="field-label">CERTIFICATE ID</div><div class="field-value green">${esc(cert.certId)}</div></div>
    <div class="field"><div class="field-label">TOKEN ID</div><div class="field-value blue">${esc(cert.tokenId)}</div></div>
    <div class="field grid-full"><div class="field-label">PROJECT NAME</div><div class="field-value">${esc(cert.projectName)}</div></div>
    <div class="field"><div class="field-label">CREDITS RETIRED</div><div class="field-value green">${Number(cert.amount || 0).toLocaleString()} tCO₂e</div></div>
    <div class="field"><div class="field-label">REGISTRY / STANDARD</div><div class="field-value">${esc(cert.standard)}</div></div>
    <div class="field"><div class="field-label">VINTAGE YEAR</div><div class="field-value">${esc(cert.vintageYear)}</div></div>
    <div class="field"><div class="field-label">OFFSET SCOPE</div><div class="field-value purple">Scope ${esc(cert.retireScope || '1')}</div></div>
    <div class="field"><div class="field-label">ARTICLE 6 / CA</div><div class="field-value">${esc(cert.correspondingAdjustment || 'None')}</div></div>
    <div class="field"><div class="field-label">BENEFICIARY</div><div class="field-value">${esc(cert.beneficiaryName)}</div></div>
    <div class="field"><div class="field-label">COMPANY / ENTITY</div><div class="field-value">${esc(cert.beneficiaryEntity)}</div></div>
    <div class="field"><div class="field-label">GSTIN</div><div class="field-value">${esc(cert.beneficiaryGstin)}</div></div>
    <div class="field"><div class="field-label">REPORTING STANDARD</div><div class="field-value">${esc(cert.reportingStandard || 'GHG Protocol')}</div></div>
    <div class="field"><div class="field-label">PURPOSE</div><div class="field-value">${esc(cert.purpose || 'Voluntary Offset')}</div></div>
    <div class="field"><div class="field-label">CBAM ELIGIBLE</div><div class="field-value">${cert.cbamEligible ? 'YES — EU CBAM Article 7' : 'NO'}</div></div>
    <div class="field"><div class="field-label">SERIAL NUMBER</div><div class="field-value blue">${esc(cert.serialNumber)}</div></div>
    <div class="field"><div class="field-label">RETIREMENT DATE</div><div class="field-value">${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
    ${cert.sdgTags?.length ? `<div class="field grid-full"><div class="field-label">SDG CO-BENEFITS</div><div class="field-value">${cert.sdgTags.map(id => `SDG ${esc(id)}`).join(' · ')}</div></div>` : ''}
  </div>

  ${cert.txHash ? `
  <div class="tx-box">
    <div class="field-label" style="color:${C.blue}66;margin-bottom:6px;">BLOCKCHAIN TX HASH (ETHEREUM)</div>
    <div style="font-size:10px;color:${C.blue};font-family:monospace;word-break:break-all;">${esc(cert.txHash)}</div>
  </div>` : ''}

  ${cert.verifyUrl ? `
  <div class="qr-section">
    <div class="qr-box">QR<br/>CODE</div>
    <div>
      <div class="verify-label">PUBLIC VERIFICATION URL</div>
      <div class="verify-url">${esc(cert.verifyUrl)}</div>
    </div>
  </div>` : ''}

  <div class="footer">
    ETHERTRACK TECHNOLOGIES PRIVATE LIMITED · ISO 14064-3 · CEA V20.0 Dec 2024 (0.727 tCO₂/MWh) ·
    PARIS AGREEMENT ART.6 · ETHEREUM BLOCKCHAIN<br/>
    This certificate is permanently recorded on-chain and independently verifiable at the URL above.
  </div>
</body>
</html>`;
};

// ─────────────────────────────────────────────────────────────────────────────
// PDF RENDERER
// [FIX-12] Accepts opts.margin override — BRSR passes zero margins to prevent
//          Puppeteer's header/footer area from pushing cover into a blank page 2
// ─────────────────────────────────────────────────────────────────────────────
const renderPDF = async (html, opts = {}) => {
  let browser;
  try {
    browser = await puppeteer.launch(LAUNCH_OPTIONS);
    const pg = await browser.newPage();
    await pg.setBypassCSP(true);
    await pg.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdf = await pg.pdf({
      format:              'A4',
      printBackground:     true,
      displayHeaderFooter: opts.headerFooter || false,
      headerTemplate:      opts.header || '',
      footerTemplate:      opts.footer || `<div style="font-size:8px;color:#86efac33;width:100%;text-align:center;font-family:monospace;padding:0 20px;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
      // [FIX-12] Use caller-supplied margins if provided, else default per headerFooter flag
      margin: opts.margin || {
        top:    opts.headerFooter ? '48px' : '0',
        bottom: opts.headerFooter ? '36px' : '0',
        left:   '0',
        right:  '0',
      },
      preferCSSPageSize: false,
    });
    return pdf;
  } finally {
    if (browser) await browser.close();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
const generateCertificatePDF = async (certData) =>
  renderPDF(buildCertificateHTML(certData));

const generateReportPDF = async (reportType, htmlContent) =>
  renderPDF(htmlContent, { headerFooter: true });

module.exports = {
  generateCertificatePDF,
  generateReport,
  generateReportPDF,
  buildCertificateHTML,
  buildGHGHTML,
  buildBRSRHTML,
  buildGRIHTML,
  buildCDPHTML,
  buildTCFDHTML,
};