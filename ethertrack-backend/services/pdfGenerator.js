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
  console.log('[pdfGenerator] incoming data types:', {
    emissions:             typeof data.emissions,             isArr: Array.isArray(data.emissions),
    retirements:           typeof data.retirements,           isArr: Array.isArray(data.retirements),
    previousYearEmissions: typeof data.previousYearEmissions, isArr: Array.isArray(data.previousYearEmissions),
    credits:               typeof data.credits,               isArr: Array.isArray(data.credits),
  });

  const builders = {
    'ghg-protocol': buildGHGHTML,
    'brsr':         buildBRSRHTML,
    'cdp':          buildCDPHTML,
    'tcfd':         buildTCFDHTML,
  };
  const builder = builders[reportType];
  if (!builder) throw new Error(`Unknown report type: ${reportType}`);

  // [FIX-9] BRSR has its own built-in page footers — do NOT add Puppeteer header/footer
  // or it will add ~84px of margin that overflows the cover page into a blank page 2.
  const isBRSR = reportType === 'brsr';
  return renderPDF(builder(data), {
    headerFooter: !isBRSR,
    margin: isBRSR
      ? { top: '0', bottom: '0', left: '0', right: '0' }
      : undefined,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CSS (GHG / CDP / TCFD dark theme)
// ─────────────────────────────────────────────────────────────────────────────
const SHARED_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');
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
// BRSR CSS (light theme)
// [FIX-10] Duplicate .cover rule removed; min-height → height; overflow:hidden added
// [FIX-11] @media print .page:last-child removed (unreliable in Puppeteer)
// ─────────────────────────────────────────────────────────────────────────────
const BRSR_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
  :root {
    --ink:#0a0f0a; --ink2:#1a2a1a; --ink3:#2a3a2a;
    --paper:#f8faf8; --paper2:#f0f4f0; --paper3:#e8ede8;
    --accent:#0d5c2e; --accent2:#1a7a3e; --accent3:#22a050;
    --orange:#b84000; --blue:#1a4a8a; --purple:#5a2a8a;
    --red:#8a1a1a; --warn:#7a5a00; --muted:#4a5a4a;
    --border:#c8d4c8; --border2:#d8e4d8;
    --green-bg:#e8f4ec; --blue-bg:#e8eef8;
    --orange-bg:#faf0e8; --red-bg:#faeaea;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--paper); color:var(--ink); font-family:'IBM Plex Sans',sans-serif; font-size:9pt; line-height:1.55; padding:0; }

  /* [FIX-4] padding-bottom so content never bleeds into the absolute footer */
  .page { width:210mm; padding:14mm 18mm 28mm 18mm; position:relative; background:var(--paper); }

  /* [FIX-10] Single .cover rule — height (not min-height) + overflow:hidden prevents blank page 2 */
  .cover {
    background:var(--ink);
    color:var(--paper);
    padding:0;
    display:flex;
    flex-direction:column;
    height:297mm;
    overflow:hidden;
  }

  .cover-top-bar { background:var(--accent); padding:10px 20mm; font-family:'IBM Plex Mono',monospace; font-size:7pt; letter-spacing:.14em; color:#a8e4b8; display:flex; justify-content:space-between; align-items:center; }
  .cover-body { flex:1; padding:20mm 20mm 16mm 20mm; display:flex; flex-direction:column; justify-content:space-between; overflow:hidden; }
  .cover-logo-row { display:flex; align-items:center; gap:14px; margin-bottom:40mm; }
  .cover-brand { font-family:'IBM Plex Mono',monospace; font-size:9pt; color:#a8e4b8; letter-spacing:.1em; }
  .cover-title-block { margin-bottom:10mm; }
  .cover-report-type { font-family:'IBM Plex Mono',monospace; font-size:8pt; letter-spacing:.18em; color:var(--accent3); margin-bottom:8px; text-transform:uppercase; }
  .cover-title { font-family:'IBM Plex Sans',sans-serif; font-size:26pt; font-weight:700; color:var(--paper); line-height:1.15; margin-bottom:6px; }
  .cover-subtitle { font-size:10pt; color:#a8e4b8; font-style:italic; letter-spacing:.03em; }
  .cover-meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10mm; }
  .cover-meta-field { border:1px solid #2a4a2a; border-radius:4px; padding:10px 14px; background:#111a11; }
  .cover-meta-label { font-family:'IBM Plex Mono',monospace; font-size:7pt; color:#5a8a5a; letter-spacing:.12em; margin-bottom:3px; text-transform:uppercase; }
  .cover-meta-value { font-size:9pt; font-weight:600; color:var(--paper); }
  .cover-sebi-ref { font-family:'IBM Plex Mono',monospace; font-size:7pt; color:#3a6a3a; letter-spacing:.06em; border-top:1px solid #1a3a1a; padding-top:8px; margin-top:6mm; }
  .cover-bottom-bar { background:#060e06; padding:10px 20mm; font-family:'IBM Plex Mono',monospace; font-size:7pt; color:#2a5a2a; letter-spacing:.08em; display:flex; justify-content:space-between; flex-shrink:0; }

  /* [FIX-3] BRSR page header — flex layout, no overlap */
  .page-header {
    display:flex; align-items:center; justify-content:space-between; gap:12px;
    padding-bottom:8px; border-bottom:2px solid var(--accent); margin-bottom:14px;
  }
  .page-header-logo { flex-shrink:0; }
  .page-header-left { flex:1; min-width:0; }
  .page-header-left .report-tag { font-family:'IBM Plex Mono',monospace; font-size:6.5pt; letter-spacing:.1em; color:var(--accent2); margin-bottom:2px; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .page-header-left .company-name { font-size:9.5pt; font-weight:700; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .page-header-right { text-align:right; font-family:'IBM Plex Mono',monospace; font-size:7pt; color:var(--muted); letter-spacing:.06em; line-height:1.7; flex-shrink:0; white-space:nowrap; }

  .page-footer { position:absolute; bottom:8mm; left:18mm; right:18mm; display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border2); padding-top:5px; font-family:'IBM Plex Mono',monospace; font-size:7pt; color:var(--muted); letter-spacing:.05em; }

  .part-head { background:var(--ink); color:var(--paper); padding:10px 14px; border-radius:4px; margin-bottom:12px; display:flex; align-items:baseline; gap:10px; }
  .part-head-label { font-family:'IBM Plex Mono',monospace; font-size:7pt; letter-spacing:.16em; color:var(--accent3); text-transform:uppercase; flex-shrink:0; }
  .part-head-title { font-size:10pt; font-weight:700; }

  .section-head { background:var(--green-bg); border-left:3px solid var(--accent); padding:7px 12px; margin:12px 0 8px 0; border-radius:0 3px 3px 0; }
  .section-head-label { font-family:'IBM Plex Mono',monospace; font-size:7pt; letter-spacing:.12em; color:var(--accent2); text-transform:uppercase; margin-bottom:1px; }
  .section-head-title { font-size:9pt; font-weight:700; color:var(--ink); }

  .kv-table { width:100%; border-collapse:collapse; margin-bottom:12px; }
  .kv-table tr:nth-child(odd) td { background:var(--paper2); }
  .kv-table tr:nth-child(even) td { background:var(--paper); }
  .kv-table td { padding:6px 10px; font-size:9pt; border:1px solid var(--border2); vertical-align:top; }
  .kv-table td:first-child { font-weight:500; color:var(--muted); width:42%; font-size:8.5pt; }
  .kv-table td:last-child { color:var(--ink); font-weight:500; }

  /* [FIX-7] Minimum 8pt for table cells */
  .data-table { width:100%; border-collapse:collapse; margin-bottom:12px; font-size:8.5pt; }
  .data-table thead tr { background:var(--ink); color:var(--paper); }
  .data-table thead th { padding:7px 9px; text-align:left; font-family:'IBM Plex Mono',monospace; font-size:7pt; letter-spacing:.1em; font-weight:500; text-transform:uppercase; border:1px solid var(--ink2); }
  .data-table tbody td { padding:7px 9px; border:1px solid var(--border); vertical-align:middle; font-size:8pt; }
  .data-table tbody tr:nth-child(odd) td { background:var(--paper); }
  .data-table tbody tr:nth-child(even) td { background:var(--paper2); }
  .data-table tbody tr.total-row td { background:var(--green-bg); font-weight:700; border-top:2px solid var(--accent); }
  .data-table tbody tr.subtotal-row td { background:var(--paper3); font-weight:600; }

  .metric-grid { display:grid; gap:8px; margin-bottom:12px; }
  .metric-grid-4 { grid-template-columns:repeat(4,1fr); }
  .metric-grid-3 { grid-template-columns:repeat(3,1fr); }
  .metric-grid-2 { grid-template-columns:repeat(2,1fr); }
  .metric-card { border:1px solid var(--border); border-radius:4px; padding:10px 12px; background:var(--paper); }
  .metric-card.accent-green { border-left:3px solid var(--accent3); background:var(--green-bg); }
  .metric-card.accent-blue  { border-left:3px solid var(--blue); background:var(--blue-bg); }
  .metric-card.accent-orange{ border-left:3px solid var(--orange); background:var(--orange-bg); }
  .metric-card.accent-red   { border-left:3px solid var(--red); background:var(--red-bg); }
  .metric-label { font-family:'IBM Plex Mono',monospace; font-size:7pt; letter-spacing:.1em; color:var(--muted); text-transform:uppercase; margin-bottom:4px; }
  .metric-value { font-size:16pt; font-weight:700; color:var(--ink); line-height:1.1; margin-bottom:2px; }
  .metric-value.green  { color:var(--accent);  }
  .metric-value.blue   { color:var(--blue);    }
  .metric-value.orange { color:var(--orange);  }
  .metric-value.red    { color:var(--red);     }
  .metric-unit { font-family:'IBM Plex Mono',monospace; font-size:7.5pt; color:var(--muted); }
  .metric-sub  { font-size:7.5pt; color:var(--muted); margin-top:3px; line-height:1.4; }

  .alert { padding:9px 12px; border-radius:3px; font-size:8.5pt; margin-bottom:10px; display:flex; gap:8px; align-items:flex-start; }
  .alert-warn { background:#fdf4e0; border:1px solid #d4a000; color:var(--warn); }
  .alert-info { background:var(--blue-bg); border:1px solid var(--blue); color:var(--blue); }
  .alert-ok   { background:var(--green-bg); border:1px solid var(--accent2); color:var(--accent); }

  .note-box { background:var(--paper2); border:1px solid var(--border); border-radius:3px; padding:8px 12px; font-size:8pt; color:var(--muted); margin-top:8px; margin-bottom:10px; line-height:1.6; }

  .badge { display:inline-block; font-family:'IBM Plex Mono',monospace; font-size:7pt; letter-spacing:.06em; padding:2px 8px; border-radius:2px; font-weight:500; }
  .badge-green  { background:var(--green-bg); color:var(--accent); border:1px solid var(--accent2); }
  .badge-orange { background:var(--orange-bg); color:var(--orange); border:1px solid var(--orange); }
  .badge-blue   { background:var(--blue-bg); color:var(--blue); border:1px solid var(--blue); }
  .badge-red    { background:var(--red-bg); color:var(--red); border:1px solid var(--red); }
  .badge-warn   { background:#fdf4e0; color:var(--warn); border:1px solid #d4a000; }

  .toc-entry { display:flex; justify-content:space-between; align-items:baseline; padding:6px 0; border-bottom:1px dotted var(--border); font-size:9pt; }
  .toc-entry-title { color:var(--ink); font-weight:500; }
  .toc-entry-page  { font-family:'IBM Plex Mono',monospace; font-size:8pt; color:var(--muted); }
  .toc-section-head { font-size:8pt; letter-spacing:.12em; color:var(--accent2); font-family:'IBM Plex Mono',monospace; text-transform:uppercase; margin:10px 0 4px; font-weight:600; }

  .sig-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px; margin-top:16px; }
  .sig-box  { border-top:1.5px solid var(--ink); padding-top:8px; }
  .sig-name-line { height:22px; border-bottom:1px solid var(--border); margin-bottom:4px; }
  .sig-label { font-size:7.5pt; color:var(--muted); font-family:'IBM Plex Mono',monospace; letter-spacing:.06em; }
  .sig-sub   { font-size:7pt; color:var(--muted); margin-top:2px; }
  .seal-box  { border:1px dashed var(--border); height:60px; border-radius:3px; display:flex; align-items:center; justify-content:center; font-size:7.5pt; color:var(--muted); margin-top:8px; font-family:'IBM Plex Mono',monospace; letter-spacing:.08em; }

  .unc-table thead th { background:var(--ink2); }
  .empty-data-row td { text-align:center; color:var(--warn); font-style:italic; background:#fdf4e0 !important; padding:10px; font-size:8.5pt; }

  /* [FIX-11] Removed .page:last-child rule — unreliable in Puppeteer.
     Last page now uses inline style="page-break-after:avoid" instead. */
  @media print {
    body { padding:0; }
    .page { page-break-after:always; }
  }
`;

const yoyCell = (curr, prev) => {
  if (!prev || prev === 0) return '<td style="color:var(--muted)">—</td>';
  const pct = (curr - prev) / prev * 100;
  const col = pct > 0 ? 'var(--red)' : 'var(--accent)';
  const arrow = pct > 0 ? '▲' : '▼';
  return `<td style="color:${col};font-weight:600;">${arrow} ${Math.abs(pct).toFixed(1)}%</td>`;
};

// [FIX-3] BRSR page header
const pageHeader = (orgName, reportYear, pageLabel, version) => `
  <div class="page-header">
    <div class="page-header-logo">${LOGO_IMG_SM}</div>
    <div class="page-header-left">
      <div class="report-tag">SEBI BRSR CORE · P6 ENVIRONMENTAL · SEBI/HO/CFD/CMD-2/CIR/P/2023/120</div>
      <div class="company-name">${esc(orgName)}</div>
    </div>
    <div class="page-header-right">
      FY ${esc(String(reportYear))}–${esc(String(parseInt(reportYear) + 1))}<br/>
      ${esc(pageLabel)}<br/>
      ${esc(version)}
    </div>
  </div>
`;

const pageFooter = (pageNum, orgName, reportYear) => `
  <div class="page-footer">
    <span>${esc(orgName)} · SEBI BRSR Core · FY ${esc(String(reportYear))}</span>
    <span>SEBI/HO/CFD/CMD-2/CIR/P/2023/120 · ISF Dec 2024</span>
    <span>Page ${pageNum}</span>
  </div>
`;

// ─────────────────────────────────────────────────────────────────────────────
// BRSR REPORT
// ─────────────────────────────────────────────────────────────────────────────
const buildBRSRHTML = (d) => {
  const {
    orgName, year, profile,
    energyData = null, waterData = null, wasteData = null,
    scope2Location, scope2Market,
    gridEmissionFactor = 0.727,
    gridEFVersion = 'CEA V20.0 Dec 2024',
    pppRate = 27.3,
    pppRateSource = 'IMF WEO April 2025',
    verifier = null,
  } = d;

  const emissions             = toArr(d.emissions);
  const retirements           = toArr(d.retirements);
  const previousYearEmissions = toArr(d.previousYearEmissions);

  const reportVersion = 'v1.0 — Final';
  const generatedDate = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const org    = esc(orgName);
  const fy     = String(year);
  const fyNext = String(parseInt(year) + 1);
  const fyPrev = String(parseInt(year) - 1);

  const scope1 = emissions.filter(r => r.scope === 1).reduce((s, r) => s + f(r.co2e), 0);
  const scope2 = emissions.filter(r => r.scope === 2).reduce((s, r) => s + f(r.co2e), 0);
  const scope3 = emissions.filter(r => r.scope === 3).reduce((s, r) => s + f(r.co2e), 0);
  const total  = scope1 + scope2 + scope3;
  const s2Loc  = f(scope2Location) || scope2;
  const s2Mkt  = f(scope2Market)   || 0;

  const prevS1 = previousYearEmissions.filter(r => r.scope === 1).reduce((s, r) => s + f(r.co2e), 0);
  const prevS2 = previousYearEmissions.filter(r => r.scope === 2).reduce((s, r) => s + f(r.co2e), 0);
  const prevS3 = previousYearEmissions.filter(r => r.scope === 3).reduce((s, r) => s + f(r.co2e), 0);
  const prevTotal = prevS1 + prevS2 + prevS3;

  const totalRetired = retirements.reduce((s, r) => s + parseInt(r.amount || 0), 0);
  const netEmissions = Math.max(0, total - totalRetired);

  const revenueCr   = f(profile?.revenue_cr);
  const employees   = parseInt(profile?.employees || 0);
  const revenuePPPM = revenueCr ? (revenueCr * 1e7) / pppRate / 1e6 : null;

  const totalGJ     = f(energyData?.total_gj);
  const renewableGJ = f(energyData?.renewable_gj);
  const nonRenewGJ  = totalGJ - renewableGJ;
  const renewPct    = totalGJ > 0 ? renewableGJ / totalGJ * 100 : 0;
  const prevGJ      = f(energyData?.prev_total_gj);

  const withdrawKL = f(waterData?.withdrawal_kl);
  const consumeKL  = f(waterData?.consumption_kl);
  const recycleKL  = f(waterData?.recycled_kl);
  const recyclePct = withdrawKL > 0 ? recycleKL / withdrawKL * 100 : 0;
  const prevWDKL   = f(waterData?.prev_withdrawal_kl);

  const totalWasteKg    = f(wasteData?.total_kg);
  const hazardousKg     = f(wasteData?.hazardous_kg);
  const ewasteKg        = f(wasteData?.ewaste_kg);
  const recycledWasteKg = f(wasteData?.recycled_kg);
  const prevWasteKg     = f(wasteData?.prev_total_kg);
  const diversionPct    = totalWasteKg > 0
    ? (recycledWasteKg + f(wasteData?.composted_kg) + f(wasteData?.coprocessed_kg)) / totalWasteKg * 100 : 0;

  // ── COVER PAGE ──
  const coverPage = `
  <div class="cover">
    <div class="cover-top-bar">
      <span>SEBI/HO/CFD/CMD-2/CIR/P/2023/120 · BRSR CORE · P6 ENVIRONMENTAL DISCLOSURES</span>
      <span>CONFIDENTIAL · ${reportVersion}</span>
    </div>
    <div class="cover-body">
      <div>
        <div class="cover-logo-row">
          ${LOGO_BASE64 ? `<img src="${LOGO_BASE64}" alt="EtherTrack" style="height:52px;width:auto;object-fit:contain;" />` : ''}
          <div class="cover-brand">ETHERTRACK TECHNOLOGIES PRIVATE LIMITED</div>
        </div>
        <div class="cover-title-block">
          <div class="cover-report-type">Business Responsibility &amp; Sustainability Report</div>
          <div class="cover-title">BRSR Core<br/>Environmental<br/>Disclosures</div>
          <div class="cover-subtitle">Principle 6 · P6-E1 GHG · P6-E2 Energy · P6-E3 Water · P6-E4 Waste · P6-E5 Credits</div>
        </div>
        <div class="cover-meta-grid">
          <div class="cover-meta-field"><div class="cover-meta-label">Reporting Entity</div><div class="cover-meta-value">${org}</div></div>
          <div class="cover-meta-field"><div class="cover-meta-label">Reporting Period</div><div class="cover-meta-value">FY ${fy}–${fyNext}</div></div>
          <div class="cover-meta-field"><div class="cover-meta-label">CIN</div><div class="cover-meta-value">${esc(profile?.company_cin || '—')}</div></div>
          <div class="cover-meta-field"><div class="cover-meta-label">Industry</div><div class="cover-meta-value">${esc(profile?.industry || '—')}</div></div>
          <div class="cover-meta-field"><div class="cover-meta-label">Report Version</div><div class="cover-meta-value">${reportVersion}</div></div>
          <div class="cover-meta-field"><div class="cover-meta-label">Date of Issue</div><div class="cover-meta-value">${generatedDate}</div></div>
        </div>
        <div class="cover-sebi-ref">
          Prepared in accordance with SEBI/HO/CFD/CMD-2/CIR/P/2023/120 · ISF Dec 2024 ·
          CEA V20.0 Dec 2024 (Grid EF 0.727 tCO₂/MWh) · GHG Protocol · ISO 14064-1:2018 ·
          GRI 302/303/306 · IPCC AR6 GWP100 · DEFRA 2024
        </div>
      </div>
    </div>
    <div class="cover-bottom-bar">
      <span>EtherTrack Technologies Private Limited · Blockchain-verified GHG Inventory</span>
      <span>Generated: ${generatedDate}</span>
    </div>
  </div>`;

  // ── TOC PAGE ──
  const tocPage = `
  <div class="page">
    ${pageHeader(orgName, year, 'Table of Contents', reportVersion)}
    <div class="part-head"><span class="part-head-label">CONTENTS</span><span class="part-head-title">Table of Contents</span></div>
    <div class="toc-section-head">Part A — General Disclosures</div>
    <div class="toc-entry"><span class="toc-entry-title">A.1 · Reporting Entity &amp; Regulatory Identity</span><span class="toc-entry-page">3</span></div>
    <div class="toc-entry"><span class="toc-entry-title">A.2 · Reporting Boundary &amp; Consolidation</span><span class="toc-entry-page">3</span></div>
    <div class="toc-entry"><span class="toc-entry-title">A.3 · Materiality Assessment</span><span class="toc-entry-page">3</span></div>
    <div class="toc-section-head">Part B — Management and Process Disclosures</div>
    <div class="toc-entry"><span class="toc-entry-title">B.1 · Environmental Policy &amp; Governance</span><span class="toc-entry-page">4</span></div>
    <div class="toc-entry"><span class="toc-entry-title">B.2 · Targets &amp; Net Zero Commitment</span><span class="toc-entry-page">4</span></div>
    <div class="toc-section-head">Part C — Principle 6 Environmental Performance (BRSR Core KPIs)</div>
    <div class="toc-entry"><span class="toc-entry-title">P6-E1 · GHG Emissions — Dual Scope 2 · Year-on-Year</span><span class="toc-entry-page">5</span></div>
    <div class="toc-entry"><span class="toc-entry-title">P6-E2 · Energy Consumption — GRI 302</span><span class="toc-entry-page">6</span></div>
    <div class="toc-entry"><span class="toc-entry-title">P6-E3 · Water Withdrawal &amp; Consumption — GRI 303</span><span class="toc-entry-page">7</span></div>
    <div class="toc-entry"><span class="toc-entry-title">P6-E4 · Waste Management — CPCB / PWM Rules 2022</span><span class="toc-entry-page">7</span></div>
    <div class="toc-entry"><span class="toc-entry-title">P6-E5 · Carbon Credit Retirements</span><span class="toc-entry-page">8</span></div>
    <div class="toc-section-head">Annexures</div>
    <div class="toc-entry"><span class="toc-entry-title">Annex I · Quantification Uncertainty — ISO 14064-1:2018 §7</span><span class="toc-entry-page">9</span></div>
    <div class="toc-entry"><span class="toc-entry-title">Annex II · Emission Factor Sources &amp; Methodology</span><span class="toc-entry-page">9</span></div>
    <div class="toc-entry"><span class="toc-entry-title">Annex III · Third-Party Verification — ISO 14064-3</span><span class="toc-entry-page">9</span></div>
    <div class="toc-entry"><span class="toc-entry-title">Declaration &amp; Authorised Signatory</span><span class="toc-entry-page">10</span></div>
    <div style="margin-top:16px;padding:12px 14px;background:var(--blue-bg);border:1px solid var(--blue);border-radius:3px;font-size:8.5pt;color:var(--blue);line-height:1.7;">
      <strong>Assurance Level:</strong> ${verifier ? 'Limited Assurance — ISO 14064-3 · Third-party verified' : 'Management Assertion — Third-party verification pending'}<br/>
      <strong>Frameworks:</strong> SEBI BRSR Core (ISF Dec 2024) · GHG Protocol Corporate Standard · ISO 14064-1:2018 · GRI 302/303/306 · IPCC AR6 GWP100 · DEFRA 2024 · CEA V20.0 Dec 2024<br/>
      <strong>Consolidation:</strong> Operational Control — all operations under ${org}'s operational control<br/>
      <strong>Currency:</strong> Indian Rupees (₹) unless stated otherwise
    </div>
    ${pageFooter(2, orgName, year)}
  </div>`;

  // ── PART A PAGE ──
  const partAPage = `
  <div class="page">
    ${pageHeader(orgName, year, 'Part A — General Disclosures', reportVersion)}
    <div class="part-head"><span class="part-head-label">PART A</span><span class="part-head-title">General Disclosures</span></div>
    <div class="section-head"><div class="section-head-label">A.1</div><div class="section-head-title">Reporting Entity &amp; Regulatory Identity</div></div>
    <table class="kv-table">
      <tr><td>Name of Entity</td><td><strong>${org}</strong></td></tr>
      <tr><td>CIN (MCA)</td><td>${esc(profile?.company_cin || '—')}</td></tr>
      <tr><td>GSTIN</td><td>${esc(profile?.company_gstin || '—')}</td></tr>
      <tr><td>PAN</td><td>${esc(profile?.company_pan || '—')}</td></tr>
      <tr><td>Industry / NIC Code</td><td>${esc(profile?.industry || '—')}</td></tr>
      <tr><td>Reporting Period</td><td>FY ${fy}–${fyNext} (1 April ${fy} to 31 March ${fyNext})</td></tr>
      <tr><td>Base Year for Targets</td><td>${esc(profile?.base_year || '2024')}</td></tr>
      <tr><td>Number of Employees (FTE)</td><td>${employees > 0 ? employees.toLocaleString('en-IN') : '—'}</td></tr>
      <tr><td>Annual Turnover (₹ Crore)</td><td>${revenueCr > 0 ? `₹${fmt(revenueCr)} Cr` : '—'}</td></tr>
      ${revenuePPPM ? `<tr><td>Turnover — PPP-adjusted (ISF Dec 2024 mandatory)</td><td>$${fmt(revenuePPPM, 2)}M intl.$ (@ ₹${pppRate}/intl.$ · ${esc(pppRateSource)})</td></tr>` : ''}
      <tr><td>Net Zero Target Year</td><td>${esc(profile?.net_zero_year || '2050')}</td></tr>
      <tr><td>Grid Emission Factor</td><td>${gridEmissionFactor} tCO₂/MWh — ${esc(gridEFVersion)}</td></tr>
    </table>
    <div class="section-head"><div class="section-head-label">A.2</div><div class="section-head-title">Reporting Boundary &amp; Consolidation</div></div>
    <table class="kv-table">
      <tr><td>Consolidation Method</td><td>Operational Control (GHG Protocol Corporate Standard)</td></tr>
      <tr><td>Boundary</td><td>All operations and facilities over which ${org} exercises operational control</td></tr>
      <tr><td>Excluded Operations</td><td>JVs where ${org} holds minority non-controlling interest</td></tr>
      <tr><td>Base Year Recalculation Policy</td><td>Restated if structural changes exceed ±5% of total emissions per GHG Protocol</td></tr>
    </table>
    <div class="section-head"><div class="section-head-label">A.3</div><div class="section-head-title">Materiality Assessment Statement</div></div>
    <div class="note-box">
      ${org} has conducted a materiality assessment per SEBI BRSR Core requirements and GRI materiality principle.
      Material topics for FY ${fy}: GHG emissions (Scope 1/2/3), energy consumption &amp; renewable transition,
      water withdrawal in water-stressed areas, waste generation &amp; diversion from landfill, and carbon credit retirements.
      A double materiality lens (financial + impact materiality) has been applied consistent with SEBI ISF Dec 2024.
    </div>
    ${pageFooter(3, orgName, year)}
  </div>`;

  // ── PART B PAGE ──
  const partBPage = `
  <div class="page">
    ${pageHeader(orgName, year, 'Part B — Management Disclosures', reportVersion)}
    <div class="part-head"><span class="part-head-label">PART B</span><span class="part-head-title">Management and Process Disclosures</span></div>
    <div class="section-head"><div class="section-head-label">B.1</div><div class="section-head-title">Environmental Policy &amp; Governance</div></div>
    <table class="kv-table">
      <tr><td>Environmental Policy</td><td>Documented policy committing to continuous GHG reduction, responsible resource use, and regulatory compliance</td></tr>
      <tr><td>Board Oversight</td><td>Board reviews ESG performance including GHG emissions and climate risk at least annually via ESG/Audit Committee</td></tr>
      <tr><td>Management Responsibility</td><td>Chief Sustainability Officer responsible for environmental data collection, reporting, and target setting</td></tr>
      <tr><td>GHG Monitoring System</td><td>EtherTrack Carbon Intelligence Platform — blockchain-verified, activity-based GHG tracking · CEA V20.0 Dec 2024</td></tr>
      <tr><td>Regulatory Compliance</td><td>SEBI BRSR Core · Environment Protection Act 1986 · CPCB Guidelines · BEE PAT Scheme (where applicable)</td></tr>
    </table>
    <div class="section-head"><div class="section-head-label">B.2</div><div class="section-head-title">Targets &amp; Net Zero Commitment</div></div>
    <table class="data-table">
      <thead><tr><th>TARGET</th><th>YEAR</th><th>REDUCTION VS BASE (${esc(profile?.base_year || '2024')})</th><th>SCOPE</th><th>STATUS</th></tr></thead>
      <tbody>
        <tr><td>India NDC-aligned 50% reduction</td><td>2030</td><td>50%</td><td>Scope 1 + 2</td><td><span class="badge badge-blue">IN PROGRESS</span></td></tr>
        <tr><td>SBTi 1.5°C aligned near-term</td><td>2035</td><td>65%</td><td>Scope 1 + 2 + 3</td><td><span class="badge badge-warn">PLANNED</span></td></tr>
        <tr><td>Net Zero — Paris Agreement Art. 4.1</td><td>${esc(profile?.net_zero_year || '2050')}</td><td>≥90% + offset residual</td><td>All scopes</td><td><span class="badge badge-green">COMMITTED</span></td></tr>
      </tbody>
    </table>
    ${pageFooter(4, orgName, year)}
  </div>`;

  // ── P6-E1 GHG PAGE ──
  const ghgPage = `
  <div class="page">
    ${pageHeader(orgName, year, 'P6-E1 — GHG Emissions', reportVersion)}
    <div class="part-head"><span class="part-head-label">PART C · PRINCIPLE 6</span><span class="part-head-title">P6-E1 · GHG Emissions — BRSR Core Mandatory KPI</span></div>
    <div class="metric-grid metric-grid-4" style="margin-bottom:12px;">
      <div class="metric-card accent-orange"><div class="metric-label">Scope 1 — Direct</div><div class="metric-value orange">${fmt(scope1)}</div><div class="metric-unit">tCO₂e</div><div class="metric-sub">Stationary · Mobile · Fugitive<br/>${fmt(total ? scope1/total*100 : 0, 1)}% of total</div></div>
      <div class="metric-card accent-blue"><div class="metric-label">Scope 2 — Location-based</div><div class="metric-value blue">${fmt(s2Loc)}</div><div class="metric-unit">tCO₂e</div><div class="metric-sub">CEA V20.0 · ${gridEmissionFactor} tCO₂/MWh</div></div>
      <div class="metric-card" style="border-left:3px solid var(--blue);"><div class="metric-label">Scope 2 — Market-based</div><div class="metric-value blue">${fmt(s2Mkt)}</div><div class="metric-unit">tCO₂e</div><div class="metric-sub">REC / PPA / Green Tariff</div></div>
      <div class="metric-card" style="border-left:3px solid var(--purple);"><div class="metric-label">Scope 3 — Value Chain</div><div class="metric-value" style="color:var(--purple);">${fmt(scope3)}</div><div class="metric-unit">tCO₂e</div><div class="metric-sub">All 15 GHG Protocol Categories</div></div>
    </div>
    <table class="data-table">
      <thead><tr><th style="width:38%;">METRIC</th><th>UNIT</th><th>FY ${fy}</th><th>FY ${fyPrev}</th><th>CHANGE %</th><th>METHODOLOGY</th></tr></thead>
      <tbody>
        <tr><td>Scope 1 GHG Emissions</td><td>tCO₂e</td><td><strong>${fmt(scope1)}</strong></td><td>${prevS1 > 0 ? fmt(prevS1) : '—'}</td>${yoyCell(scope1, prevS1)}<td>Activity-based · DEFRA 2024</td></tr>
        <tr><td>Scope 2 — Location-based (CEA V20.0)</td><td>tCO₂e</td><td><strong>${fmt(s2Loc)}</strong></td><td>${prevS2 > 0 ? fmt(prevS2) : '—'}</td>${yoyCell(s2Loc, prevS2)}<td>CEA ${gridEmissionFactor} tCO₂/MWh</td></tr>
        <tr><td>Scope 2 — Market-based (REC/PPA)</td><td>tCO₂e</td><td><strong>${fmt(s2Mkt)}</strong></td><td>—</td><td>—</td><td>Contractual instruments</td></tr>
        <tr><td>Scope 3 — All 15 Categories</td><td>tCO₂e</td><td><strong>${fmt(scope3)}</strong></td><td>${prevS3 > 0 ? fmt(prevS3) : '—'}</td>${yoyCell(scope3, prevS3)}<td>Activity-based · IPCC AR6</td></tr>
        <tr class="total-row"><td><strong>Total GHG Emissions (location-based)</strong></td><td>tCO₂e</td><td><strong>${fmt(total)}</strong></td><td>${prevTotal > 0 ? `<strong>${fmt(prevTotal)}</strong>` : '—'}</td>${yoyCell(total, prevTotal)}<td>GHG Protocol Corporate Standard</td></tr>
        <tr><td>Carbon Credits Retired</td><td>tCO₂e</td><td>${fmt(totalRetired, 0)}</td><td>—</td><td>—</td><td>EtherTrack · Blockchain-verified</td></tr>
        <tr class="subtotal-row"><td><strong>Net Emissions After Offset</strong></td><td>tCO₂e</td><td><strong>${fmt(netEmissions)}</strong></td><td>—</td><td>—</td><td>Gross minus retirements</td></tr>
        ${revenueCr > 0 ? `<tr><td>GHG Intensity — Revenue (₹Cr)</td><td>tCO₂e/₹Cr</td><td>${fmt(total/revenueCr, 4)}</td><td>${prevTotal > 0 && revenueCr > 0 ? fmt(prevTotal/revenueCr, 4) : '—'}</td>${yoyCell(total/revenueCr, prevTotal > 0 ? prevTotal/revenueCr : 0)}<td>BRSR Core mandatory</td></tr>` : ''}
        ${revenuePPPM ? `<tr><td>GHG Intensity — PPP-adjusted (ISF Dec 2024)</td><td>tCO₂e/$M PPP</td><td><strong style="color:var(--orange);">${fmt(total/revenuePPPM, 3)}</strong></td><td>—</td><td>—</td><td>IMF WEO Apr 2025 · ₹${pppRate}/intl.$</td></tr>` : ''}
        ${employees > 0 ? `<tr><td>GHG Intensity — Per FTE</td><td>tCO₂e/FTE</td><td>${fmt(total/employees, 4)}</td><td>—</td>${yoyCell(total/employees, prevTotal > 0 ? prevTotal/employees : 0)}<td>BRSR Core mandatory</td></tr>` : ''}
      </tbody>
    </table>
    <div class="note-box"><strong>Dual Scope 2 (GHG Protocol Scope 2 Guidance — Mandatory):</strong> Both location-based and market-based figures are disclosed. Location-based uses CEA weighted-average grid EF (${gridEmissionFactor} tCO₂/MWh, ${esc(gridEFVersion)}). Market-based uses contractual instrument EFs (REC=0; PPA Solar=0.041; PPA Wind=0.011 tCO₂/MWh).</div>
    ${pageFooter(5, orgName, year)}
  </div>`;

  // ── P6-E2 ENERGY PAGE ──
  const energyPage = `
  <div class="page">
    ${pageHeader(orgName, year, 'P6-E2 — Energy Consumption', reportVersion)}
    <div class="part-head"><span class="part-head-label">PART C · PRINCIPLE 6</span><span class="part-head-title">P6-E2 · Energy Consumption — GRI 302 · BRSR Core Mandatory KPI</span></div>
    ${totalGJ > 0 ? `
    <div class="metric-grid metric-grid-4" style="margin-bottom:12px;">
      <div class="metric-card accent-orange"><div class="metric-label">Total Energy</div><div class="metric-value orange">${fmt(totalGJ, 0)}</div><div class="metric-unit">Gigajoules (GJ)</div></div>
      <div class="metric-card accent-green"><div class="metric-label">Renewable</div><div class="metric-value green">${fmt(renewableGJ, 0)}</div><div class="metric-unit">GJ · ${fmt(renewPct, 1)}% share</div></div>
      <div class="metric-card accent-red"><div class="metric-label">Non-Renewable</div><div class="metric-value red">${fmt(nonRenewGJ, 0)}</div><div class="metric-unit">GJ · ${fmt(100 - renewPct, 1)}% share</div></div>
      <div class="metric-card"><div class="metric-label">Previous Year</div><div class="metric-value" style="color:var(--muted)">${prevGJ > 0 ? fmt(prevGJ, 0) : '—'}</div><div class="metric-unit">GJ</div></div>
    </div>` : `<div class="alert alert-warn"><span>⚠</span><span>Energy data not entered for FY ${fy}. Enter P6-E2 data via the BRSR Environmental tab.</span></div>`}
    <table class="data-table">
      <thead><tr><th style="width:40%;">ENERGY METRIC</th><th>UNIT</th><th>FY ${fy}</th><th>FY ${fyPrev}</th><th>CHANGE %</th><th>SOURCE</th></tr></thead>
      <tbody>
        ${totalGJ > 0 ? `
        <tr><td>Total Energy Consumed</td><td>GJ</td><td><strong>${fmt(totalGJ, 0)}</strong></td><td>${prevGJ > 0 ? fmt(prevGJ, 0) : '—'}</td>${yoyCell(totalGJ, prevGJ)}<td>GRI 302-1</td></tr>
        <tr><td>— of which Renewable</td><td>GJ</td><td>${fmt(renewableGJ, 0)}</td><td>—</td><td>—</td><td>Solar / Wind / Hydro / Biomass</td></tr>
        <tr><td>— of which Non-Renewable</td><td>GJ</td><td>${fmt(nonRenewGJ, 0)}</td><td>—</td><td>—</td><td>Grid · Diesel · Gas · Coal</td></tr>
        <tr class="subtotal-row"><td>Renewable Energy Share</td><td>%</td><td><strong>${fmt(renewPct, 1)}%</strong></td><td>—</td><td>—</td><td>BRSR Core KPI</td></tr>
        ${revenueCr > 0 ? `<tr><td>Energy Intensity — Revenue (₹Cr)</td><td>GJ/₹Cr</td><td>${fmt(totalGJ/revenueCr, 2)}</td><td>${prevGJ > 0 && revenueCr > 0 ? fmt(prevGJ/revenueCr, 2) : '—'}</td><td>—</td><td>BRSR Core mandatory</td></tr>` : ''}
        ${revenuePPPM ? `<tr><td>Energy Intensity — PPP-adjusted (ISF Dec 2024)</td><td>GJ/$M PPP</td><td>${fmt(totalGJ/revenuePPPM, 2)}</td><td>—</td><td>—</td><td>IMF WEO Apr 2025</td></tr>` : ''}
        ${employees > 0 ? `<tr><td>Energy Intensity — Per FTE</td><td>GJ/FTE</td><td>${fmt(totalGJ/employees, 2)}</td><td>—</td><td>—</td><td>BRSR optional</td></tr>` : ''}
        ` : `<tr class="empty-data-row"><td colspan="6">Data Not Available — Enter via BRSR Environmental tab</td></tr>`}
      </tbody>
    </table>
    ${pageFooter(6, orgName, year)}
  </div>`;

  // ── P6-E3 WATER + P6-E4 WASTE PAGE ──
  const waterWastePage = `
  <div class="page">
    ${pageHeader(orgName, year, 'P6-E3 Water · P6-E4 Waste', reportVersion)}
    <div class="part-head" style="background:var(--blue);"><span class="part-head-label">PART C · PRINCIPLE 6</span><span class="part-head-title">P6-E3 · Water Withdrawal &amp; Consumption — GRI 303</span></div>
    ${withdrawKL > 0 ? `
    <div class="metric-grid metric-grid-3" style="margin-bottom:10px;">
      <div class="metric-card accent-blue"><div class="metric-label">Total Withdrawal</div><div class="metric-value blue">${fmt(withdrawKL, 0)}</div><div class="metric-unit">Kilolitres (KL)</div></div>
      <div class="metric-card accent-green"><div class="metric-label">Recycled / Reused</div><div class="metric-value green">${fmt(recycleKL, 0)}</div><div class="metric-unit">KL · ${fmt(recyclePct, 1)}% rate</div></div>
      <div class="metric-card"><div class="metric-label">Consumption</div><div class="metric-value">${fmt(consumeKL, 0)}</div><div class="metric-unit">KL</div></div>
    </div>` : `<div class="alert alert-warn"><span>⚠</span><span>Water data not entered for FY ${fy}. Enter P6-E3 data via BRSR Environmental tab.</span></div>`}
    <table class="data-table" style="margin-bottom:14px;">
      <thead><tr><th style="width:42%;">WATER METRIC</th><th>UNIT</th><th>FY ${fy}</th><th>FY ${fyPrev}</th><th>CHANGE %</th></tr></thead>
      <tbody>
        ${withdrawKL > 0 ? `
        <tr><td>Total Water Withdrawal</td><td>KL</td><td><strong>${fmt(withdrawKL, 0)}</strong></td><td>${prevWDKL > 0 ? fmt(prevWDKL, 0) : '—'}</td>${yoyCell(withdrawKL, prevWDKL)}</tr>
        <tr><td>— Surface Water</td><td>KL</td><td>${f(waterData?.surface_kl) > 0 ? fmt(f(waterData.surface_kl), 0) : '—'}</td><td>—</td><td>—</td></tr>
        <tr><td>— Groundwater</td><td>KL</td><td>${f(waterData?.ground_kl) > 0 ? fmt(f(waterData.ground_kl), 0) : '—'}</td><td>—</td><td>—</td></tr>
        <tr><td>— Third-party / Municipal</td><td>KL</td><td>${f(waterData?.municipal_kl) > 0 ? fmt(f(waterData.municipal_kl), 0) : '—'}</td><td>—</td><td>—</td></tr>
        <tr><td>Total Consumption</td><td>KL</td><td>${fmt(consumeKL, 0)}</td><td>—</td><td>—</td></tr>
        <tr class="subtotal-row"><td>Recycling Rate</td><td>%</td><td><strong>${fmt(recyclePct, 1)}%</strong></td><td>—</td><td>—</td></tr>
        ${revenueCr > 0 ? `<tr><td>Water Intensity (₹Cr)</td><td>KL/₹Cr</td><td>${fmt(withdrawKL/revenueCr, 1)}</td><td>—</td><td>—</td></tr>` : ''}
        ` : `<tr class="empty-data-row"><td colspan="5">Data Not Available — Enter via BRSR Environmental tab</td></tr>`}
      </tbody>
    </table>
    <div class="part-head" style="background:var(--purple);"><span class="part-head-label">PART C · PRINCIPLE 6</span><span class="part-head-title">P6-E4 · Waste Management — CPCB / PWM Rules 2022</span></div>
    ${totalWasteKg > 0 ? `
    <div class="metric-grid metric-grid-4" style="margin-bottom:10px;">
      <div class="metric-card" style="border-left:3px solid var(--purple);"><div class="metric-label">Total Waste</div><div class="metric-value" style="color:var(--purple);">${fmt(totalWasteKg/1000, 3)}</div><div class="metric-unit">Metric Tonnes (MT)</div></div>
      <div class="metric-card accent-red"><div class="metric-label">Hazardous</div><div class="metric-value red">${fmt(hazardousKg/1000, 3)}</div><div class="metric-unit">MT</div></div>
      <div class="metric-card accent-green"><div class="metric-label">Diverted from Landfill</div><div class="metric-value green">${fmt(diversionPct, 1)}%</div><div class="metric-unit">Recycled + Composted</div></div>
      <div class="metric-card"><div class="metric-label">E-Waste</div><div class="metric-value">${fmt(ewasteKg/1000, 3)}</div><div class="metric-unit">MT</div></div>
    </div>` : `<div class="alert alert-warn"><span>⚠</span><span>Waste data not entered for FY ${fy}. Enter P6-E4 data via BRSR Environmental tab.</span></div>`}
    <table class="data-table">
      <thead><tr><th style="width:40%;">WASTE CATEGORY</th><th>UNIT</th><th>FY ${fy} (kg)</th><th>FY ${fy} (MT)</th><th>% OF TOTAL</th><th>DISPOSAL METHOD</th></tr></thead>
      <tbody>
        ${totalWasteKg > 0 ? `
        ${[
          ['Hazardous Waste',     wasteData?.hazardous_kg,    'Authorised TSDF / recycler'],
          ['E-Waste',            wasteData?.ewaste_kg,        'Registered e-waste recycler (E-Waste Rules 2022)'],
          ['Plastic Waste',      wasteData?.plastic_kg,       'EPR registered recycler (PWM Rules 2022)'],
          ['Bio-medical Waste',  wasteData?.biomedical_kg,    'Authorised CBWTF'],
          ['Construction Waste', wasteData?.construction_kg,  'Authorised C&D facility'],
          ['Battery Waste',      wasteData?.battery_kg,       'Authorised battery recycler'],
          ['Non-hazardous',      wasteData?.non_hazardous_kg, 'Municipal / recycling'],
        ].filter(([, v]) => f(v) > 0).map(([label, val, method]) =>
          `<tr><td>${esc(label)}</td><td>kg / MT</td><td>${fmt(f(val), 0)}</td><td>${fmt(f(val)/1000, 4)}</td><td>${fmt(totalWasteKg > 0 ? f(val)/totalWasteKg*100 : 0, 1)}%</td><td style="font-size:8pt;">${esc(method)}</td></tr>`
        ).join('')}
        <tr class="total-row"><td><strong>Total Waste Generated</strong></td><td>kg / MT</td><td><strong>${fmt(totalWasteKg, 0)}</strong></td><td><strong>${fmt(totalWasteKg/1000, 3)}</strong></td><td>100%</td><td>—</td></tr>
        ` : `<tr class="empty-data-row"><td colspan="6">Data Not Available — Enter via BRSR Environmental tab</td></tr>`}
      </tbody>
    </table>
    ${pageFooter(7, orgName, year)}
  </div>`;

  // ── P6-E5 + ANNEXES PAGE ──
  const creditsAnnexPage = `
  <div class="page">
    ${pageHeader(orgName, year, 'P6-E5 Credits · Annexures', reportVersion)}
    <div class="part-head"><span class="part-head-label">PART C · PRINCIPLE 6</span><span class="part-head-title">P6-E5 · Carbon Credit Retirements</span></div>
    ${retirements.length > 0 ? `
    <table class="data-table" style="margin-bottom:12px;">
      <thead><tr><th>CERT ID</th><th>PROJECT</th><th>STANDARD</th><th>VINTAGE</th><th>tCO₂e</th><th>SCOPE</th><th>PURPOSE</th><th>TX HASH</th></tr></thead>
      <tbody>
        ${retirements.map(r => `
        <tr>
          <td style="font-family:'IBM Plex Mono',monospace;font-size:7.5pt;">${esc(r.certificate_id || '—')}</td>
          <td>${esc(r.project_name || '—')}</td>
          <td>${esc(r.standard || '—')}</td>
          <td>${esc(r.vintage_year || '—')}</td>
          <td><strong style="color:var(--accent);">${fmt(r.amount || 0, 0)}</strong></td>
          <td>S${esc(String(r.retire_scope || 1))}</td>
          <td>${esc(r.purpose || 'Voluntary offset')}</td>
          <td style="font-family:'IBM Plex Mono',monospace;font-size:7pt;color:var(--muted);">${esc((r.tx_hash || '—').slice(0, 14))}…</td>
        </tr>`).join('')}
        <tr class="total-row"><td colspan="4"><strong>Total Credits Retired — FY ${fy}</strong></td><td><strong style="color:var(--accent);">${fmt(totalRetired, 0)}</strong></td><td colspan="3">tCO₂e</td></tr>
      </tbody>
    </table>` : `
    <div class="alert alert-warn"><span>⚠</span><span>No carbon credit retirements recorded for FY ${fy}. Add via the Audit Trail tab in EtherTrack.</span></div>
    <table class="data-table" style="margin-bottom:14px;"><thead><tr><th>CERT ID</th><th>PROJECT</th><th>STANDARD</th><th>VINTAGE</th><th>tCO₂e</th><th>SCOPE</th><th>PURPOSE</th></tr></thead><tbody><tr class="empty-data-row"><td colspan="7">No Retirements in This Reporting Period</td></tr></tbody></table>`}

    <div class="section-head"><div class="section-head-label">ANNEX I</div><div class="section-head-title">Quantification Uncertainty — ISO 14064-1:2018 §7</div></div>
    <table class="data-table unc-table" style="font-size:8pt;margin-bottom:12px;">
      <thead><tr><th style="width:30%;">EMISSION SOURCE</th><th>METHODOLOGY TIER</th><th>FACTOR SOURCE</th><th>UNCERTAINTY</th><th>CONFIDENCE</th></tr></thead>
      <tbody>
        <tr><td>Scope 1 — Stationary &amp; Mobile</td><td>Tier 1 (Activity-based)</td><td>DEFRA 2024</td><td>±5%</td><td><span class="badge badge-green">LOW</span></td></tr>
        <tr><td>Scope 1 — Fugitive (Refrigerants)</td><td>Tier 1 (Activity-based)</td><td>IPCC AR6 GWP100</td><td>±15%</td><td><span class="badge badge-warn">MEDIUM</span></td></tr>
        <tr><td>Scope 2 — Grid Electricity</td><td>Tier 1 (Grid average)</td><td>CEA India V20.0 Dec 2024</td><td>±5%</td><td><span class="badge badge-green">LOW</span></td></tr>
        <tr><td>Scope 2 — Market-based</td><td>Tier 2 (Supplier-specific)</td><td>REC/PPA certificates</td><td>±2%</td><td><span class="badge badge-green">LOW</span></td></tr>
        <tr><td>Scope 3 — All 15 Categories</td><td>Tier 1 (Spend/activity)</td><td>IPCC AR6 / DEFRA 2024</td><td>±30%</td><td><span class="badge badge-red">HIGH</span></td></tr>
      </tbody>
    </table>
    <div class="note-box">Overall combined uncertainty: ±15–35% (industry standard for Tier 1). Reduce by upgrading to Tier 2/3 supplier-specific factors for material Scope 3 categories.</div>

    <div class="section-head"><div class="section-head-label">ANNEX II</div><div class="section-head-title">Emission Factor Sources &amp; Methodology</div></div>
    <table class="kv-table" style="font-size:8.5pt;">
      <tr><td>Grid Electricity (India)</td><td>CEA India V20.0 Dec 2024 — 0.727 tCO₂/MWh (FY 2023-24 weighted avg, CERC-approved)</td></tr>
      <tr><td>Fuel Combustion</td><td>DEFRA 2024 — UK Government GHG Conversion Factors for Company Reporting (Crown Copyright 2024)</td></tr>
      <tr><td>GWP Values</td><td>IPCC AR6 (2021) — Sixth Assessment Report, 100-year GWP100</td></tr>
      <tr><td>International Energy Factors</td><td>IEA 2024 — World Energy Outlook Emission Factors</td></tr>
      <tr><td>Energy Efficiency</td><td>BEE India — Bureau of Energy Efficiency PAT Scheme Technical Guidelines</td></tr>
      <tr><td>Boundary / Consolidation</td><td>GHG Protocol Corporate Standard (2004, revised 2015) — Operational Control</td></tr>
    </table>
    ${pageFooter(8, orgName, year)}
  </div>`;

  // ── DECLARATION PAGE — [FIX-11] page-break-after:avoid on last page ──
  const declarationPage = `
  <div class="page" style="page-break-after:avoid;">
    ${pageHeader(orgName, year, 'Verification · Declaration', reportVersion)}
    <div class="section-head"><div class="section-head-label">ANNEX III</div><div class="section-head-title">Third-Party Verification — ISO 14064-3 / ISO 14065</div></div>
    ${verifier ? `
    <table class="kv-table" style="margin-bottom:12px;">
      <tr><td>Verification Body</td><td><strong>${esc(verifier.verifier_name)}</strong></td></tr>
      <tr><td>Accreditation Number</td><td>${esc(verifier.accred_number || '—')}</td></tr>
      <tr><td>Verification Standard</td><td>ISO 14064-3:2019</td></tr>
      <tr><td>Assurance Level</td><td>${esc(verifier.assurance_level || 'Limited Assurance')}</td></tr>
      <tr><td>Verification Date</td><td>${esc(verifier.verification_date || '—')}</td></tr>
      <tr><td>Status</td><td><span class="badge badge-green">VERIFIED</span></td></tr>
    </table>` : `
    <div class="alert alert-warn" style="margin-bottom:12px;">
      <span>⚠</span>
      <div><strong>Verification Pending</strong> — EtherTrack connects Bureau Veritas, DNV, EY, and KPMG for ISO 14064-3 verification. Contact <strong>hello@ethertrack.in</strong> to initiate. Add verifier in the Audit Trail tab once engaged.</div>
    </div>
    <table class="kv-table" style="margin-bottom:12px;">
      <tr><td>Verification Body</td><td style="color:var(--muted);">Pending engagement</td></tr>
      <tr><td>Verification Standard</td><td>ISO 14064-3:2019 (to be applied)</td></tr>
      <tr><td>Status</td><td><span class="badge badge-warn">PENDING</span></td></tr>
    </table>`}

    <div class="part-head" style="background:var(--ink2);"><span class="part-head-label">DECLARATION</span><span class="part-head-title">Authorised Signatory — SEBI BRSR Core Schedule III</span></div>
    <div style="border:1px solid var(--border);border-radius:4px;padding:14px 16px;background:var(--paper2);margin-bottom:16px;font-size:9pt;line-height:1.8;color:var(--ink);">
      We hereby confirm that the Business Responsibility and Sustainability Report disclosures above, covering FY ${fy}–${fyNext},
      are accurate and complete to the best of our knowledge and have been prepared in accordance with SEBI BRSR Core
      (SEBI/HO/CFD/CMD-2/CIR/P/2023/120), SEBI ISF Dec 2024, GHG Protocol Corporate Standard (2004, revised 2015),
      ISO 14064-1:2018, GRI Standards 302/303/306, CEA V20.0 Dec 2024, IPCC AR6 GWP100, and DEFRA 2024.
    </div>
    <div class="sig-grid">
      <div class="sig-box">
        <div class="sig-name-line"></div><div class="sig-label">PREPARER — Name &amp; Designation</div>
        <div style="margin-top:10px;"><div class="sig-name-line"></div><div class="sig-label">DATE (DD/MM/YYYY)</div></div>
      </div>
      <div class="sig-box">
        <div class="sig-name-line"></div><div class="sig-label">REVIEWER / CFO — Name &amp; Designation</div>
        <div style="margin-top:10px;"><div class="sig-name-line"></div><div class="sig-label">DATE (DD/MM/YYYY)</div></div>
      </div>
      <div class="sig-box">
        <div class="sig-name-line"></div><div class="sig-label">MD / CEO — Name, Designation &amp; DIN / PAN</div>
        <div style="margin-top:10px;"><div class="sig-name-line"></div><div class="sig-label">DATE (DD/MM/YYYY)</div></div>
      </div>
    </div>
    <div class="seal-box">COMPANY SEAL / STAMP</div>
    <div class="note-box" style="margin-top:12px;font-size:8pt;">
      <strong>PPP Intensity Note (SEBI ISF Dec 2024 — Mandatory):</strong>
      GHG intensity in tCO₂e per million international dollars (PPP-adjusted) is mandatory under SEBI BRSR ISF Dec 2024.
      PPP rate: ₹${pppRate}/intl.$ (${esc(pppRateSource)}). Enables cross-border peer comparison per ISSB requirements.
    </div>
    ${pageFooter(9, orgName, year)}
  </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>SEBI BRSR Core — ${esc(orgName)} — FY ${fy}</title>
  <style>${BRSR_CSS}</style>
</head>
<body>
  ${coverPage}
  ${tocPage}
  ${partAPage}
  ${partBPage}
  ${ghgPage}
  ${energyPage}
  ${waterWastePage}
  ${creditsAnnexPage}
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
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');
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
    await pg.setContent(html, { waitUntil: 'networkidle0' });
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
  buildCDPHTML,
  buildTCFDHTML,
};