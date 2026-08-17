// src/services/ReportPDF.js — EtherTrack Auditor-Friendly PDF Reports
// PRODUCTION HARDENED — v6
// ── Fixes applied vs v5-DIAGNOSTIC:
//    [FIX-F3-1] safeStr returns ' ' (space) instead of '' for null/undefined —
//               jsPDF f3 font-width fn divides by string length; '' → 0/0 → NaN → crash.
//    [FIX-F3-2] drawTable txt fallback changed from '' to ' ' for same reason.
//    [FIX-F3-3] Diagnostic patch text substitution changed from '' to ' '.
//    [FIX-PATCH] Diagnostic patch removed — no longer needed after above fixes.
// ─────────────────────────────────────────────────────────────────────────────



import { jsPDF } from 'jspdf';

// [FIX-LOGO] Lazy import with null fallback
let _getLogoBase64 = null;
try {
  const mod = require('./logoBase64');
  _getLogoBase64 = mod?.getLogoBase64 || null;
} catch {}

const safeGetLogo = async () => {
  if (!_getLogoBase64) return null;
  try { return await _getLogoBase64(); } catch { return null; }
};

// safeStr — wraps every dynamic value before passing to doc.text()
// [FIX-F3-1] Returns ' ' (space) not '' — empty string crashes jsPDF f3 font-width calc
const safeStr = (v) => {
  if (v === null || v === undefined) return ' ';
  if (typeof v === 'string') return v.length > 0 ? v : ' ';
  if (typeof v === 'number') return isFinite(v) ? String(v) : '0';
  const s = String(v);
  return s.length > 0 ? s : ' ';
};

// pdfStr — safeStr + strip characters not in jsPDF built-in helvetica
// Removes: ₹ (U+20B9 rupee), ± (U+00B1), → (U+2192), ° (keep — it's in latin-1)
const pdfStr = (v) => {
  const s = safeStr(v)
    .replace(/₹/g,  'Rs.')
    .replace(/±/g,  '+/-')
    .replace(/→/g,  '->')
    .replace(/·/g,  '.')
    .replace(/—/g,  '--')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\u0000-\u00FF]/g, '?'); // strip anything outside latin-1
  return s.length > 0 ? s : ' ';
};

// ── Colour palette ─────────────────────────────────────────────────
const C = {
  bg      : [4,   7,   6  ],
  surface : [10,  15,  12 ],
  border  : [15,  42,  26 ],
  green   : [34,  197, 94 ],
  blue    : [96,  165, 250],
  orange  : [249, 115, 22 ],
  purple  : [167, 139, 250],
  yellow  : [250, 204, 21 ],
  red     : [248, 113, 113],
  white   : [240, 253, 244],
  muted   : [134, 239, 172],
  dark    : [6,   10,  7  ],
};

const PAGE_W    = 210;
const PAGE_H    = 297;
const MARGIN    = 20;
const CONTENT_W = PAGE_W - MARGIN * 2;

const fmt = (n, d = 2) =>
  Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

const newDoc = () => new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

const getOrgName = (profile, fallback) =>
  pdfStr(profile?.company_name || profile?.companyName || fallback || 'Organisation');

// ── Per-document page counter ──────────────────────────────────────
const makeCtx = () => ({ pageCount: 0 });

const stampPageNumber = (doc, ctx) => {
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.muted);
  doc.text(`Page ${ctx.pageCount}`, PAGE_W - MARGIN, PAGE_H - 6, { align: 'right' });
};

const addPage = (doc, ctx) => {
  doc.addPage();
  ctx.pageCount++;
  doc.setFillColor(...C.bg);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  stampPageNumber(doc, ctx);
  return MARGIN + 4;
};

const guard = (doc, ctx, y, needed = 14) => {
  if (y + needed > PAGE_H - 16) return addPage(doc, ctx);
  return y;
};

const yoyRow = (doc, label, current, previous, unit, y, ctx) => {
  y = guard(doc, ctx, y, 9);
  const hasPrev   = previous !== null && previous !== undefined && previous > 0;
  const change    = hasPrev ? ((current - previous) / previous * 100) : null;
  const changeStr = change !== null ? `${change >= 0 ? '+' : ''}${fmt(change, 1)}%` : '--';
  const changeCol = change === null ? C.muted : change > 0 ? C.red : C.green;

  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.muted);   doc.text(pdfStr(label),                                        MARGIN + 3, y);
  doc.setTextColor(...C.white);   doc.text(pdfStr(`${fmt(current)} ${unit}`),                    95, y);
  doc.setTextColor(...C.muted);   doc.text(hasPrev ? pdfStr(`${fmt(previous)} ${unit}`) : '--',  135, y);
  doc.setTextColor(...changeCol); doc.text(pdfStr(changeStr),                                    173, y);
  doc.setDrawColor(...C.border);  doc.setLineWidth(0.1);
  doc.line(MARGIN, y + 2, PAGE_W - MARGIN, y + 2);
  return y + 7;
};

const drawHeader = (doc, ctx, title, subtitle, reportType, orgName, year, color, logo) => {
  ctx.pageCount = 1;
  doc.setFillColor(...C.bg);      doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  doc.setFillColor(...color);     doc.rect(0, 0, PAGE_W, 2, 'F');
  doc.setFillColor(...C.surface); doc.rect(0, 2, PAGE_W, 44, 'F');

  let textX  = MARGIN;
  let logoOk = false;

  if (logo?.data && typeof logo.data === 'string' && logo.data.startsWith('data:image')) {
    try {
      doc.addImage(logo.data, logo.format || 'JPEG', 18, 6, 28, 28);
      textX  = 50;
      logoOk = true;
    } catch { logoOk = false; }
  }

  if (!logoOk) {
    doc.setFillColor(...C.border);
    doc.roundedRect(MARGIN, 8, 26, 12, 2, 2, 'F');
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...color);
    doc.text('ETHER\nTRACK', MARGIN + 4, 14);
    textX = 50;
  }

  doc.setFontSize(8);  doc.setFont('helvetica', 'normal'); doc.setTextColor(...color);
  doc.text(pdfStr(`ETHERTRACK CARBON EXCHANGE . ${reportType} . FY ${year}`), textX, 14);
  doc.setFontSize(16); doc.setFont('helvetica', 'bold');   doc.setTextColor(...C.white);
  doc.text(pdfStr(title), textX, 25);
  doc.setFontSize(8);  doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.muted);
  doc.text(pdfStr(subtitle), textX, 33);
  doc.setFontSize(9);  doc.setTextColor(...C.white);
  doc.text(pdfStr(orgName), PAGE_W - MARGIN, 20, { align: 'right' });
  doc.setFontSize(7.5); doc.setTextColor(...C.muted);
  doc.text(
    pdfStr(`Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}`),
    PAGE_W - MARGIN, 28, { align: 'right' }
  );
  doc.text('Blockchain verified . EtherTrack', PAGE_W - MARGIN, 35, { align: 'right' });
  doc.setDrawColor(...C.border); doc.setLineWidth(0.3);
  doc.line(MARGIN, 46, PAGE_W - MARGIN, 46);
  stampPageNumber(doc, ctx);
  return 52;
};

const sectionHead = (doc, ctx, text, y, color = C.green) => {
  y = guard(doc, ctx, y, 14);
  doc.setFillColor(...C.border); doc.rect(MARGIN, y, CONTENT_W, 8, 'F');
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...color);
  doc.text(pdfStr(text), MARGIN + 3, y + 5.5);
  return y + 12;
};

const kvRow = (doc, ctx, label, value, y, labelColor = C.muted, valueColor = C.white) => {
  y = guard(doc, ctx, y, 9);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.setTextColor(...labelColor); doc.text(pdfStr(label), MARGIN + 3, y);
  doc.setTextColor(...valueColor); doc.text(pdfStr(value), 100, y);
  doc.setDrawColor(...C.border); doc.setLineWidth(0.1);
  doc.line(MARGIN, y + 2, PAGE_W - MARGIN, y + 2);
  return y + 7;
};

const drawTable = (doc, ctx, headers, rows, y, colWidths, colColors = []) => {
  y = guard(doc, ctx, y, 16);

  const drawHeaderRow = (atY) => {
    doc.setFillColor(...C.border); doc.rect(MARGIN, atY, CONTENT_W, 7, 'F');
    let x = MARGIN;
    headers.forEach((h, i) => {
      doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.muted);
      doc.text(pdfStr(h), x + 2, atY + 5);
      x += colWidths[i];
    });
    return atY + 8;
  };

  y = drawHeaderRow(y);

  rows.forEach((row, ri) => {
    if (y > PAGE_H - 20) {
      y = addPage(doc, ctx);
      y = drawHeaderRow(y);
    }
    const rc = ri % 2 === 0 ? C.surface : C.dark;
    doc.setFillColor(rc[0], rc[1], rc[2]);
    doc.rect(MARGIN, y - 1, CONTENT_W, 7, 'F');
    let x = MARGIN;
    row.forEach((cell, ci) => {
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
      doc.setTextColor(...(colColors[ci] || C.white));
      const colW  = Math.max(colWidths[ci] - 3, 1);
      const clean = pdfStr(cell);
      const split = doc.splitTextToSize(clean, colW);
      // [FIX-F3-2] Use ' ' (space) not '' as fallback — empty string crashes jsPDF f3
      const txt   = (Array.isArray(split) && split.length > 0 && split[0]) ? pdfStr(split[0]) : ' ';
      doc.text(txt, x + 2, y + 4.5);
      x += colWidths[ci];
    });
    y += 7;
  });
  return y + 4;
};

const drawUncertaintyBlock = (doc, ctx, y) => {
  y = guard(doc, ctx, y, 56);
  doc.setFillColor(6, 10, 7);
  doc.roundedRect(MARGIN, y, CONTENT_W, 54, 2, 2, 'F');
  doc.setDrawColor(...C.blue); doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, y, CONTENT_W, 54, 2, 2, 'S');
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.blue);
  doc.text('QUANTIFICATION UNCERTAINTY -- ISO 14064-1:2018 §7 / GHG PROTOCOL CHAPTER 7', MARGIN + 4, y + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.muted);

  const rows = [
    ['Scope 1 -- Stationary & Mobile', 'Tier 1 (Activity-based)', 'DEFRA 2024',      '+/-5%',  'Low'   ],
    ['Scope 1 -- Fugitive Emissions',  'Tier 1 (Activity-based)', 'IPCC AR6 GWP100', '+/-15%', 'Medium'],
    ['Scope 2 -- Grid Electricity',    'Tier 1 (Grid average)',   'CEA India 2024',  '+/-5%',  'Low'   ],
    ['Scope 2 -- Market-based',        'Tier 2 (Supplier-spec.)', 'REC/PPA cert',    '+/-2%',  'Low'   ],
    ['Scope 3 -- All 15 Categories',   'Tier 1 (Spend/activity)', 'IPCC AR6',        '+/-30%', 'High'  ],
  ];
  const cols = [52, 42, 32, 14, 16];
  const hdrs = ['EMISSION SOURCE', 'METHODOLOGY TIER', 'FACTOR SOURCE', 'UNCERT.', 'CONFIDENCE'];
  let rx = MARGIN + 2;
  hdrs.forEach((h, i) => {
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.green);
    doc.text(pdfStr(h), rx, y + 13); rx += cols[i];
  });
  rows.forEach((row, ri) => {
    let cx = MARGIN + 2;
    const ry = y + 19 + ri * 6;
    row.forEach((cell, ci) => {
      const col = ci === 4
        ? (cell === 'Low' ? C.green : cell === 'Medium' ? C.yellow : C.red)
        : C.muted;
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...col);
      doc.text(pdfStr(cell), cx, ry);
      cx += cols[ci];
    });
  });
  doc.setTextColor(...C.muted);
  doc.text(
    'Overall combined uncertainty: +/-15-35% (industry standard for Tier 1). Improve by moving to Tier 2/3.',
    MARGIN + 4, y + 50
  );
  return y + 58;
};

const drawEmissionFactorAttribution = (doc, ctx, y) => {
  y = guard(doc, ctx, y, 46);
  doc.setFillColor(6, 10, 7);
  doc.roundedRect(MARGIN, y, CONTENT_W, 42, 2, 2, 'F');
  doc.setDrawColor(...C.border);
  doc.roundedRect(MARGIN, y, CONTENT_W, 42, 2, 2, 'S');
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.green);
  doc.text('EMISSION FACTOR SOURCES & METHODOLOGY DISCLOSURE', MARGIN + 4, y + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.muted);
  [
    '- DEFRA 2024 -- UK Government GHG Conversion Factors for Company Reporting (Crown Copyright 2024)',
    '- CEA India V20.0 Dec 2024 -- Grid Emission Factor: 0.727 tCO2/MWh (FY 2023-24 weighted average)',
    '- IPCC AR6 (2021) -- Sixth Assessment Report Global Warming Potentials (GWP100)',
    '- IEA 2024 -- International Energy Agency World Energy Outlook Emission Factors',
    '- BEE India -- Bureau of Energy Efficiency PAT Scheme Technical Guidelines',
    '- GHG Protocol Corporate Standard (2004, revised 2015) -- Operational Control consolidation boundary',
  ].forEach((s, i) => doc.text(pdfStr(s), MARGIN + 4, y + 12 + i * 4.8));
  return y + 46;
};

const drawSignatureBlock = (doc, ctx, y, reportType) => {
  y = guard(doc, ctx, y, 62);
  doc.setFillColor(10, 15, 12);
  doc.roundedRect(MARGIN, y, CONTENT_W, 58, 2, 2, 'F');
  doc.setDrawColor(...C.border);
  doc.roundedRect(MARGIN, y, CONTENT_W, 58, 2, 2, 'S');
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.white);
  doc.text('DECLARATION & AUTHORISED SIGNATORY', MARGIN + 4, y + 7);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.muted);
  const decl = pdfStr(
    `I hereby confirm that the ${reportType} disclosures above are accurate and complete to the best of my knowledge, prepared in accordance with applicable standards and regulations.`
  );
  doc.text(doc.splitTextToSize(decl, 162), MARGIN + 4, y + 14);
  [[MARGIN + 4, 'Name & Designation'], [MARGIN + 62, 'DIN / PAN Number'], [MARGIN + 120, 'Date (DD/MM/YYYY)']].forEach(([x, label]) => {
    doc.setDrawColor(...C.border); doc.setLineWidth(0.4);
    doc.line(x, y + 40, x + 52, y + 40);
    doc.setFontSize(6.5); doc.setTextColor(...C.muted);
    doc.text(pdfStr(label), x, y + 45);
  });
  doc.setFontSize(6.5); doc.setTextColor(...C.muted);
  doc.text('Company Seal / Stamp:', MARGIN + 4, y + 54);
  doc.setDrawColor(...C.border);
  doc.roundedRect(MARGIN + 40, y + 50, 32, 6, 1, 1);
  return y + 62;
};

const drawVerifierBlock = (doc, ctx, verifier, y) => {
  y = guard(doc, ctx, y, 26);
  doc.setFillColor(13, 10, 26);
  doc.roundedRect(MARGIN, y, CONTENT_W, 22, 2, 2, 'F');
  doc.setDrawColor(...C.purple); doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, y, CONTENT_W, 22, 2, 2, 'S');
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.purple);
  doc.text('THIRD-PARTY VERIFICATION -- ISO 14064-3', MARGIN + 4, y + 6);
  if (verifier?.status === 'verified') {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.white);
    doc.text(pdfStr(`Verified by: ${verifier.verifier_name}`), MARGIN + 4, y + 13);
    doc.setTextColor(...C.green); doc.text('VERIFIED', MARGIN + 148, y + 13);
    doc.setTextColor(...C.muted);
    doc.text(pdfStr(`Ref: ${verifier.verification_ref || '--'}  .  Date: ${verifier.verification_date || '--'}`), MARGIN + 4, y + 19);
  } else {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.muted);
    doc.text('Verification pending -- EtherTrack connects Bureau Veritas / DNV / EY on request', MARGIN + 4, y + 12);
    doc.setTextColor(245, 158, 11);
    doc.text('PENDING . Contact: hello@ethertrack.in', MARGIN + 4, y + 18);
  }
  return y + 26;
};

const drawFooter = (doc, reportType) => {
  doc.setFillColor(...C.surface); doc.rect(0, 284, PAGE_W, 13, 'F');
  doc.setDrawColor(...C.border); doc.setLineWidth(0.2); doc.line(0, 284, PAGE_W, 284);
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.muted);
  doc.text(pdfStr(`EtherTrack Carbon Exchange . ${reportType} . Blockchain-verified`), MARGIN, 291);
  doc.text(pdfStr(`Generated ${new Date().toLocaleDateString('en-IN')}`), PAGE_W - MARGIN, 291, { align: 'right' });
};

// ── Emission aggregation helpers ───────────────────────────────────
const agg = (emissions, scopeNum) =>
  emissions.filter(r => r.scope === scopeNum)
    .reduce((s, r) => s + parseFloat(r.co2e || 0), 0);

const aggMarketBased = (emissions) =>
  emissions
    .filter(r => r.scope === 2 && r.category?.toLowerCase().includes('market-based'))
    .reduce((s, r) => s + parseFloat(r.co2e || 0), 0);

const scope3ByCategory = (emissions) => {
  const cats = {};
  emissions.filter(r => r.scope === 3).forEach(r => {
    const k = r.category || 'Uncategorised';
    cats[k] = (cats[k] || 0) + parseFloat(r.co2e || 0);
  });
  return Object.entries(cats).sort((a, b) => b[1] - a[1]);
};

const safeSave = (doc, filename) => {
  try {
    doc.save(filename);
  } catch {
    try {
      const blob = doc.output('blob');
      const url  = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      throw new Error('PDF generation succeeded but download failed. Try a different browser.');
    }
  }
};

// ═══════════════════════════════════════════════════════════════════
// 1. GHG PROTOCOL PDF
// ═══════════════════════════════════════════════════════════════════
export const generateGHGProtocolPDF = async ({
  orgName, year, profile, emissions, retirements, credits, verifier,
  previousYearEmissions = null,
}) => {
  const doc  = newDoc();
  const ctx  = makeCtx();
  const logo = await safeGetLogo();
  const org  = getOrgName(profile, orgName);

  const s1    = agg(emissions, 1);
  const s2    = agg(emissions, 2);
  const s2mkt = aggMarketBased(emissions);
  const s3    = agg(emissions, 3);
  const total = s1 + s2 + s3;
  const retired = retirements.reduce((s, r) => s + parseInt(r.amount || 0, 10), 0);

  const p1     = previousYearEmissions ? agg(previousYearEmissions, 1) : 0;
  const p2     = previousYearEmissions ? agg(previousYearEmissions, 2) : 0;
  const p3     = previousYearEmissions ? agg(previousYearEmissions, 3) : 0;
  const pTotal = p1 + p2 + p3;

  let y = drawHeader(doc, ctx,
    'GHG Protocol Corporate Standard',
    'Greenhouse Gas Inventory . ISO 14064-1 . Operational Control Boundary',
    'GHG PROTOCOL', org, year, C.green, logo);

  y = sectionHead(doc, ctx, 'SECTION 1 -- ORGANISATION DETAILS', y);
  y = kvRow(doc, ctx, 'Organisation',          org,                                                   y);
  y = kvRow(doc, ctx, 'CIN (MCA)',              pdfStr(profile?.company_cin   || '--'),                y);
  y = kvRow(doc, ctx, 'GSTIN',                  pdfStr(profile?.company_gstin || '--'),                y);
  y = kvRow(doc, ctx, 'PAN',                    pdfStr(profile?.company_pan   || '--'),                y);
  y = kvRow(doc, ctx, 'Industry',               pdfStr(profile?.industry      || '--'),                y);
  y = kvRow(doc, ctx, 'Reporting Year',         `FY ${year}`,                                          y);
  y = kvRow(doc, ctx, 'Base Year',              String(profile?.base_year || 2024),                    y);
  y = kvRow(doc, ctx, 'Employees (FTE)',        String(profile?.employees || '--'),                    y);
  y = kvRow(doc, ctx, 'Annual Revenue',         profile?.revenue_cr ? `Rs.${profile.revenue_cr} Cr` : '--', y);
  y = kvRow(doc, ctx, 'Consolidation',          'Operational Control',                                 y);
  y = kvRow(doc, ctx, 'Methodology',            'GHG Protocol Corporate Standard (2004, revised 2015)', y);
  y = kvRow(doc, ctx, 'GWP Source',             'IPCC AR6 (2021) -- 100-year GWP values',              y);
  y = kvRow(doc, ctx, 'Grid EF (India)',        'CEA V20.0 Dec 2024 -- 0.727 tCO2/MWh',               y);
  y += 4;

  y = sectionHead(doc, ctx, 'SECTION 2 -- GHG INVENTORY WITH YEAR-ON-YEAR COMPARISON', y);
  doc.setFillColor(...C.border); doc.rect(MARGIN, y, CONTENT_W, 7, 'F');
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.muted);
  doc.text('METRIC',                           MARGIN + 3, y + 5);
  doc.text(`FY ${year} (CURRENT)`,             95,         y + 5);
  doc.text(`FY ${parseInt(year,10)-1} (PREV)`, 135,        y + 5);
  doc.text('CHANGE %',                         173,        y + 5);
  y += 9;

  y = yoyRow(doc, 'Scope 1 -- Direct Emissions',           s1,    p1,     'tCO2e',    y, ctx);
  y = yoyRow(doc, 'Scope 2 -- Location-based (CEA V20.0)', s2,    p2,     'tCO2e',    y, ctx);
  y = yoyRow(doc, 'Scope 2 -- Market-based (REC/PPA)',     s2mkt, 0,      'tCO2e',    y, ctx);
  y = yoyRow(doc, 'Scope 3 -- Value Chain (All 15 Cats)',  s3,    p3,     'tCO2e',    y, ctx);
  y = yoyRow(doc, 'TOTAL GHG EMISSIONS',                   total, pTotal, 'tCO2e',    y, ctx);
  y = yoyRow(doc, 'Carbon Credits Retired',                retired, 0,    'tCO2e',    y, ctx);
  y = yoyRow(doc, 'Net Emissions After Offset',            Math.max(0, total - retired), 0, 'tCO2e', y, ctx);
  if (profile?.revenue_cr)
    y = yoyRow(doc, 'Revenue Carbon Intensity',
      total / profile.revenue_cr,
      pTotal > 0 ? pTotal / profile.revenue_cr : 0,
      'tCO2e/Rs.Cr', y, ctx);
  if (profile?.employees)
    y = yoyRow(doc, 'FTE Carbon Intensity',
      total / profile.employees,
      pTotal > 0 ? pTotal / profile.employees : 0,
      'tCO2e/emp', y, ctx);
  y += 4;

  y = sectionHead(doc, ctx, `SECTION 3 -- EMISSION ACTIVITIES DETAIL (${emissions.length} records)`, y);
  if (emissions.length > 0) {
    y = drawTable(doc, ctx,
      ['DATE', 'ACTIVITY', 'S', 'CATEGORY', 'QTY', 'tCO2e', 'SOURCE'],
      emissions.map(r => [
        pdfStr(r.date?.slice(0, 10) || '--'),
        pdfStr(r.activity || '--'),
        `S${r.scope}`,
        pdfStr((r.category || '--').slice(0, 28)),
        `${parseFloat(r.quantity || r.qty || 0).toFixed(1)} ${pdfStr(r.unit || '')}`,
        parseFloat(r.co2e || 0).toFixed(4),
        pdfStr((r.source || '--').slice(0, 16)),
      ]),
      y, [22, 46, 10, 34, 22, 16, 20],
      [C.muted, C.white, C.green, C.muted, C.muted, C.green, C.muted]
    );
  } else {
    doc.setFontSize(9); doc.setTextColor(...C.muted);
    doc.text('No emission activities recorded for this period.', MARGIN + 3, y + 8);
    y += 14;
  }

  const s3cats = scope3ByCategory(emissions);
  if (s3cats.length > 0) {
    y = sectionHead(doc, ctx, 'SECTION 4 -- SCOPE 3 CATEGORY BREAKDOWN (ALL 15 GHG PROTOCOL CATEGORIES)', y, C.purple);
    y = drawTable(doc, ctx,
      ['GHG PROTOCOL CATEGORY', 'tCO2e', '% OF SCOPE 3', 'METHODOLOGY'],
      s3cats.map(([cat, val]) => [
        pdfStr(cat),
        fmt(val, 3),
        s3 > 0 ? `${fmt(val / s3 * 100, 1)}%` : '--',
        'Tier 1 -- Activity-based / DEFRA 2024',
      ]),
      y, [80, 22, 24, 44],
      [C.muted, C.purple, C.muted, C.muted]
    );
  }

  y = sectionHead(doc, ctx, `SECTION 5 -- CARBON CREDIT RETIREMENTS (${retirements.length} records)`, y, C.purple);
  if (retirements.length > 0) {
    y = drawTable(doc, ctx,
      ['CERT ID', 'PROJECT', 'STANDARD', 'tCO2e', 'SCOPE', 'DATE', 'TX HASH'],
      retirements.map(r => [
        pdfStr(r.certificate_id || '--'),
        pdfStr(r.project_name   || '--'),
        pdfStr(r.standard       || '--'),
        pdfStr(r.amount         || 0),
        `S${r.retire_scope || 1}`,
        pdfStr(r.retired_at?.slice(0, 10) || '--'),
        pdfStr((r.tx_hash || '--').slice(0, 14)) + '...',
      ]),
      y, [28, 44, 18, 12, 10, 22, 36],
      [C.blue, C.white, C.green, C.green, C.purple, C.muted, C.blue]
    );
  } else {
    doc.setFontSize(9); doc.setTextColor(...C.muted);
    doc.text('No retirements in this period.', MARGIN + 3, y + 8);
    y += 14;
  }

  y = drawUncertaintyBlock(doc, ctx, y + 4);
  y = drawEmissionFactorAttribution(doc, ctx, y + 4);
  y = drawVerifierBlock(doc, ctx, verifier, y + 4);
  y = drawSignatureBlock(doc, ctx, y + 4, 'GHG Protocol Corporate Standard');

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) { doc.setPage(p); drawFooter(doc, 'GHG PROTOCOL CORPORATE STANDARD'); }
  safeSave(doc, `ethertrack_ghg_protocol_fy${year}_${org.replace(/\s+/g, '_')}.pdf`);
};

// ═══════════════════════════════════════════════════════════════════
// 2. BRSR CORE PDF
// ═══════════════════════════════════════════════════════════════════
export const generateBRSRPDF = async ({
  orgName, year, profile, emissions, retirements, credits, verifier,
  previousYearEmissions = null,
  waterData  = null,
  wasteData  = null,
  energyData = null,
}) => {
  const doc  = newDoc();
  const ctx  = makeCtx();
  const logo = await safeGetLogo();
  const org  = getOrgName(profile, orgName);

  const s1    = agg(emissions, 1);
  const s2    = agg(emissions, 2);
  const s2mkt = aggMarketBased(emissions);
  const s3    = agg(emissions, 3);
  const total = s1 + s2 + s3;
  const retired = retirements.reduce((s, r) => s + parseInt(r.amount || 0, 10), 0);

  const p1     = previousYearEmissions ? agg(previousYearEmissions, 1) : 0;
  const p2     = previousYearEmissions ? agg(previousYearEmissions, 2) : 0;
  const p3     = previousYearEmissions ? agg(previousYearEmissions, 3) : 0;
  const pTotal = p1 + p2 + p3;

  let y = drawHeader(doc, ctx,
    'Business Responsibility & Sustainability Report',
    `SEBI BRSR Core . SEBI/HO/CFD/CMD-2/CIR/P/2023/120 . FY ${year}-${parseInt(year,10)+1}`,
    'SEBI BRSR CORE', org, year, C.orange, logo);

  y = sectionHead(doc, ctx, 'PART A -- GENERAL DISCLOSURES', y, C.orange);
  y = kvRow(doc, ctx, 'Corporate Identity Number (CIN)', pdfStr(profile?.company_cin   || '--'), y);
  y = kvRow(doc, ctx, 'Name of the Listed Entity',       org,                                    y);
  y = kvRow(doc, ctx, 'GSTIN',                           pdfStr(profile?.company_gstin || '--'), y);
  y = kvRow(doc, ctx, 'PAN',                             pdfStr(profile?.company_pan   || '--'), y);
  y = kvRow(doc, ctx, 'Industry (NIC Code)',             pdfStr(profile?.industry      || '--'), y);
  y = kvRow(doc, ctx, 'Reporting Period',                `FY ${year}-${parseInt(year,10)+1}`,    y);
  y = kvRow(doc, ctx, 'Base Year for Targets',           String(profile?.base_year || 2024),     y);
  y = kvRow(doc, ctx, 'Number of Employees',             String(profile?.employees  || '--'),    y);
  y = kvRow(doc, ctx, 'Annual Turnover (Rs. Crore)',     String(profile?.revenue_cr || '--'),    y);
  y = kvRow(doc, ctx, 'Net Zero Target Year',            String(profile?.net_zero_year || 2050), y);
  y = kvRow(doc, ctx, 'Grid EF Used',                   'CEA V20.0 Dec 2024 -- 0.727 tCO2/MWh', y);
  y += 4;

  y = sectionHead(doc, ctx, 'PRINCIPLE 6 -- P6-E1: GHG EMISSIONS', y, C.green);
  doc.setFillColor(...C.border); doc.rect(MARGIN, y, CONTENT_W, 7, 'F');
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.muted);
  ['METRIC', 'UNIT', `FY ${year}`, `FY ${parseInt(year,10)-1}`, 'CHANGE %']
    .forEach((h, i) => doc.text(pdfStr(h), [MARGIN+3, 92, 122, 148, 174][i], y + 5));
  y += 9;

  y = yoyRow(doc, 'Scope 1 GHG Emissions',             s1,    p1,    'tCO2e', y, ctx);
  y = yoyRow(doc, 'Scope 2 (Location-based)',           s2,    p2,    'tCO2e', y, ctx);
  y = yoyRow(doc, 'Scope 2 (Market-based -- REC/PPA)',  s2mkt, 0,     'tCO2e', y, ctx);
  y = yoyRow(doc, 'Scope 3 -- Value Chain',             s3,    p3,    'tCO2e', y, ctx);
  y = yoyRow(doc, 'Total GHG Emissions',                total, pTotal,'tCO2e', y, ctx);
  y = yoyRow(doc, 'Carbon Credits Retired',             retired, 0,   'tCO2e', y, ctx);
  y = yoyRow(doc, 'Net Emissions After Offset',         Math.max(0, total - retired), 0, 'tCO2e', y, ctx);
  if (profile?.revenue_cr)
    y = yoyRow(doc, 'GHG Intensity (Revenue)',
      total / profile.revenue_cr,
      pTotal > 0 ? pTotal / profile.revenue_cr : 0,
      'tCO2e/Rs.Cr', y, ctx);
  if (profile?.employees)
    y = yoyRow(doc, 'GHG Intensity (Per FTE)',
      total / profile.employees,
      pTotal > 0 ? pTotal / profile.employees : 0,
      'tCO2e/FTE', y, ctx);
  y += 4;

  // P6-E2: Energy
  y = sectionHead(doc, ctx, 'P6-E2: ENERGY CONSUMPTION (BRSR CORE MANDATORY KPI)', y, C.green);
  if (energyData?.total_gj != null) {
    const prevGJ = energyData.prev_total_gj ?? null;
    y = drawTable(doc, ctx,
      ['METRIC', 'UNIT', `FY ${year}`, `FY ${parseInt(year,10)-1}`, 'CHANGE %'],
      [
        ['Total Energy Consumed', 'GJ',
          fmt(energyData.total_gj ?? 0, 0),
          prevGJ != null ? fmt(prevGJ, 0) : '--',
          prevGJ != null && prevGJ > 0 ? `${fmt((energyData.total_gj - prevGJ)/prevGJ*100,1)}%` : '--'],
        ['Renewable Energy',       'GJ', fmt(energyData.renewable_gj ?? 0, 0), '--', '--'],
        ['Non-renewable Energy',   'GJ', fmt((energyData.total_gj??0)-(energyData.renewable_gj??0),0), '--', '--'],
        ['Renewable Energy Share', '%',  energyData.total_gj > 0 ? fmt((energyData.renewable_gj??0)/energyData.total_gj*100,1) : '--', '--', '--'],
        ['Energy Intensity (Revenue)', 'GJ/Rs.Cr',
          energyData.intensity_gj_cr != null ? fmt(energyData.intensity_gj_cr, 3) : '--',
          energyData.prev_intensity_gj_cr != null ? fmt(energyData.prev_intensity_gj_cr, 3) : '--',
          '--'],
      ],
      y, [62,18,28,28,24], [C.muted,C.muted,C.green,C.muted,C.muted]
    );
  } else {
    doc.setFontSize(8); doc.setTextColor(...C.yellow);
    doc.text('Energy data not provided -- enter via BRSR Environmental tab.', MARGIN + 3, y + 8);
    y += 14;
  }

  // P6-E3: Water
  y = sectionHead(doc, ctx, 'P6-E3: WATER CONSUMPTION (BRSR CORE MANDATORY KPI)', y, C.blue);
  if (waterData?.withdrawal_kl != null) {
    const prevWD = waterData.prev_withdrawal_kl ?? null;
    y = drawTable(doc, ctx,
      ['METRIC', 'UNIT', `FY ${year}`, `FY ${parseInt(year,10)-1}`, 'CHANGE %'],
      [
        ['Total Water Withdrawal',  'KL', fmt(waterData.withdrawal_kl??0,0),
          prevWD != null ? fmt(prevWD,0) : '--',
          prevWD != null && prevWD > 0 ? `${fmt((waterData.withdrawal_kl-prevWD)/prevWD*100,1)}%` : '--'],
        ['Total Water Consumption', 'KL', fmt(waterData.consumption_kl??0,0), '--', '--'],
        ['Water Recycled / Reused', 'KL', fmt(waterData.recycled_kl??0,0), '--', '--'],
        ['Recycling Rate', '%', waterData.withdrawal_kl > 0 ? fmt((waterData.recycled_kl??0)/waterData.withdrawal_kl*100,1) : '--', '--', '--'],
        ['Water Intensity (Revenue)', 'KL/Rs.Cr', waterData.intensity_kl_cr != null ? fmt(waterData.intensity_kl_cr,2) : '--', '--', '--'],
      ],
      y, [62,18,28,28,24], [C.muted,C.muted,C.blue,C.muted,C.muted]
    );
  } else {
    doc.setFontSize(8); doc.setTextColor(...C.yellow);
    doc.text('Water data not provided -- enter via BRSR Environmental tab.', MARGIN + 3, y + 8);
    y += 14;
  }

  // P6-E4: Waste
  y = sectionHead(doc, ctx, 'P6-E4: WASTE MANAGEMENT (BRSR CORE) -- source data in kg', y, C.orange);
  if (wasteData?.total_kg != null) {
    const kgToMT   = (kg) => (kg ?? 0) / 1000;
    const prevTKg  = wasteData.prev_total_kg ?? null;
    y = drawTable(doc, ctx,
      ['METRIC', 'UNIT', `FY ${year}`, `FY ${parseInt(year,10)-1}`, 'CHANGE %'],
      [
        ['Total Waste Generated', 'MT', fmt(kgToMT(wasteData.total_kg),2),
          prevTKg != null ? fmt(kgToMT(prevTKg),2) : '--',
          prevTKg != null && prevTKg > 0 ? `${fmt((wasteData.total_kg-prevTKg)/prevTKg*100,1)}%` : '--'],
        ['Hazardous Waste',            'MT', fmt(kgToMT(wasteData.hazardous_kg),2), '--', '--'],
        ['E-Waste',                    'MT', fmt(kgToMT(wasteData.ewaste_kg),2),    '--', '--'],
        ['Plastic Waste',              'MT', fmt(kgToMT(wasteData.plastic_kg),2),   '--', '--'],
        ['Waste Recycled / Recovered', 'MT', fmt(kgToMT(wasteData.recycled_kg),2),  '--', '--'],
        ['Waste to Landfill',          'MT', fmt(kgToMT(wasteData.landfill_kg),2),  '--', '--'],
        ['Recycling Rate', '%', wasteData.total_kg > 0 ? fmt((wasteData.recycled_kg??0)/wasteData.total_kg*100,1) : '--', '--', '--'],
      ],
      y, [62,18,28,28,24], [C.muted,C.muted,C.orange,C.muted,C.muted]
    );
  } else {
    doc.setFontSize(8); doc.setTextColor(...C.yellow);
    doc.text('Waste data not provided -- enter via BRSR Environmental tab.', MARGIN + 3, y + 8);
    y += 14;
  }

  // P6-E5: Credits
  y = sectionHead(doc, ctx, 'P6-E5: CARBON CREDIT DETAILS', y, C.green);
  if (retirements.length > 0) {
    y = drawTable(doc, ctx,
      ['CERT ID','PROJECT','STANDARD','tCO2e','SCOPE','PURPOSE','TX HASH'],
      retirements.map(r => [
        pdfStr(r.certificate_id || '--'),
        pdfStr(r.project_name   || '--'),
        pdfStr(r.standard       || '--'),
        pdfStr(r.amount         || 0),
        `S${r.retire_scope || 1}`,
        pdfStr(r.purpose        || 'Voluntary offset'),
        pdfStr((r.tx_hash       || '--').slice(0,16)) + '...',
      ]),
      y, [28,38,18,12,10,28,36],
      [C.blue,C.white,C.green,C.green,C.purple,C.muted,C.blue]
    );
  } else {
    doc.setFontSize(9); doc.setTextColor(...C.muted);
    doc.text('No carbon credit retirements in this reporting period.', MARGIN + 3, y + 8);
    y += 14;
  }

  y = drawUncertaintyBlock(doc, ctx, y + 4);
  y = drawEmissionFactorAttribution(doc, ctx, y + 4);
  y = drawVerifierBlock(doc, ctx, verifier, y + 4);
  y = drawSignatureBlock(doc, ctx, y + 4, 'SEBI BRSR Core');

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) { doc.setPage(p); drawFooter(doc, 'SEBI BRSR CORE'); }
  safeSave(doc, `ethertrack_brsr_core_fy${year}_${org.replace(/\s+/g, '_')}.pdf`);
};

// ═══════════════════════════════════════════════════════════════════
// 3. CDP CLIMATE CHANGE PDF
// ═══════════════════════════════════════════════════════════════════
export const generateCDPPDF = async ({
  orgName, year, profile, emissions, retirements, credits, verifier,
  previousYearEmissions = null,
}) => {
  const doc  = newDoc();
  const ctx  = makeCtx();
  const logo = await safeGetLogo();
  const org  = getOrgName(profile, orgName);

  const s1    = agg(emissions, 1);
  const s2    = agg(emissions, 2);
  const s2mkt = aggMarketBased(emissions);
  const s3    = agg(emissions, 3);
  const retired = retirements.reduce((s, r) => s + parseInt(r.amount || 0, 10), 0);

  const p1     = previousYearEmissions ? agg(previousYearEmissions, 1) : 0;
  const p2     = previousYearEmissions ? agg(previousYearEmissions, 2) : 0;
  const p3     = previousYearEmissions ? agg(previousYearEmissions, 3) : 0;
  const pTotal = p1 + p2 + p3;

  let y = drawHeader(doc, ctx,
    'CDP Climate Change Questionnaire',
    `Carbon Disclosure Project . Climate Change ${parseInt(year,10)+1} . Reporting Year ${year}`,
    'CDP CLIMATE', org, year, C.blue, logo);

  y = sectionHead(doc, ctx, 'C0 -- INTRODUCTION', y, C.blue);
  y = kvRow(doc, ctx, 'Organisation',         org,                                  y);
  y = kvRow(doc, ctx, 'Reporting Year',        String(year),                        y);
  y = kvRow(doc, ctx, 'Country',               'India',                             y);
  y = kvRow(doc, ctx, 'Activity (NACE / NIC)', pdfStr(profile?.industry || '--'),   y);
  y = kvRow(doc, ctx, 'Revenue (Rs. Cr)',       String(profile?.revenue_cr || '--'), y);
  y = kvRow(doc, ctx, 'Employees',             String(profile?.employees  || '--'), y);
  y = kvRow(doc, ctx, 'Grid EF Used',          'CEA V20.0 Dec 2024 -- 0.727 tCO2/MWh', y);
  y += 4;

  y = sectionHead(doc, ctx, 'C6 -- EMISSIONS DATA (WITH YoY COMPARISON)', y, C.blue);
  y = drawTable(doc, ctx,
    ['CDP QUESTION', 'RESPONSE', `FY ${parseInt(year,10)-1}`, 'UNIT', 'METHODOLOGY'],
    [
      ['C6.1 Scope 1 GHG emissions',    fmt(s1),    pTotal>0?fmt(p1):'--', 'tCO2e', 'GHG Protocol / DEFRA 2024'],
      ['C6.3 Scope 2 (location-based)', fmt(s2),    pTotal>0?fmt(p2):'--', 'tCO2e', 'CEA V20.0 Dec 2024'],
      ['C6.3a Scope 2 (market-based)',  s2mkt>0?fmt(s2mkt):'Not assessed', '--', 'tCO2e', 'REC/PPA'],
      ['C6.5 Scope 3 total',            fmt(s3),    pTotal>0?fmt(p3):'--', 'tCO2e', 'GHG Protocol / IPCC AR6'],
      ['C6.5a Scope 3 categories',      `${scope3ByCategory(emissions).length} tracked`, '--', '--', 'Activity-based'],
      ['C6.7 Biogenic emissions',       '0',        '--', 'tCO2e', 'Not applicable'],
    ],
    y, [60,26,22,18,44],
    [C.muted,C.green,C.muted,C.muted,C.muted]
  );

  y = sectionHead(doc, ctx, 'C11 -- CARBON PRICING', y, C.purple);
  y = kvRow(doc, ctx, 'C11.2 Credits retired',  `${retired} tCO2e`, y);
  y = kvRow(doc, ctx, 'C11.2a Registries',       pdfStr([...new Set(retirements.map(r=>r.standard))].filter(Boolean).join(', ') || 'VCS / Gold Standard'), y);
  y = kvRow(doc, ctx, 'C11.2b Credit type',      'Voluntary Carbon Units (VCU) / CCC', y);
  y = kvRow(doc, ctx, 'C11.2c Verification',     'ISO 14064-3 / Blockchain (Ethereum)', y);
  y += 4;

  if (retirements.length > 0) {
    y = sectionHead(doc, ctx, `C11 CREDIT DETAILS (${retirements.length} retirements)`, y, C.purple);
    y = drawTable(doc, ctx,
      ['PROJECT','STANDARD','CCP','tCO2e','VINTAGE','CA','CERT ID'],
      retirements.map(r => [
        pdfStr(r.project_name || '--'),
        pdfStr(r.standard     || '--'),
        credits?.find(c=>c.registry_serial===r.serial_number)?.icvcm_ccp_eligible ? 'Yes' : 'No',
        pdfStr(r.amount       || 0),
        pdfStr(r.vintage_year || '--'),
        pdfStr(r.corresponding_adjustment || 'none'),
        pdfStr(r.certificate_id || '--'),
      ]),
      y, [42,18,12,14,14,20,30],
      [C.white,C.green,C.yellow,C.green,C.muted,C.blue,C.blue]
    );
  }

y = drawUncertaintyBlock(doc, ctx, y + 4);
  y = drawEmissionFactorAttribution(doc, ctx, y + 4);
  y = drawVerifierBlock(doc, ctx, y + 4);
  drawSignatureBlock(doc, ctx, y + 4, 'CDP Climate Change Questionnaire');

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) { doc.setPage(p); drawFooter(doc, 'CDP CLIMATE CHANGE QUESTIONNAIRE'); }
  safeSave(doc, `ethertrack_cdp_climate_${year}_${org.replace(/\s+/g, '_')}.pdf`);
};

// ═══════════════════════════════════════════════════════════════════
// 4. TCFD DISCLOSURE PDF
// ═══════════════════════════════════════════════════════════════════
export const generateTCFDPDF = async ({
  orgName, year, profile, emissions, retirements, credits, verifier,
  previousYearEmissions = null,
}) => {
  const doc  = newDoc();
  const ctx  = makeCtx();
  const logo = await safeGetLogo();
  const org  = getOrgName(profile, orgName);

  const s1    = agg(emissions, 1);
  const s2    = agg(emissions, 2);
  const s3    = agg(emissions, 3);
  const total = s1 + s2 + s3;
  const retired = retirements.reduce((s, r) => s + parseInt(r.amount || 0, 10), 0);

  const p1     = previousYearEmissions ? agg(previousYearEmissions, 1) : 0;
  const p2     = previousYearEmissions ? agg(previousYearEmissions, 2) : 0;
  const p3     = previousYearEmissions ? agg(previousYearEmissions, 3) : 0;
  const pTotal = p1 + p2 + p3;

  let y = drawHeader(doc, ctx,
    'Task Force on Climate-related Financial Disclosures',
    'TCFD Framework . 4 Pillars: Governance . Strategy . Risk Management . Metrics & Targets',
    'TCFD DISCLOSURE', org, year, C.purple, logo);

  y = sectionHead(doc, ctx, 'PILLAR 1 -- GOVERNANCE', y, C.purple);
  y = kvRow(doc, ctx, 'a) Board oversight', 'ESG committee oversight in progress', y);
  y = kvRow(doc, ctx, 'b) Management role', 'ESG Manager monitors via EtherTrack Carbon Intelligence', y);
  y += 4;

  y = sectionHead(doc, ctx, 'PILLAR 2 -- STRATEGY', y, C.blue);
  y = kvRow(doc, ctx, 'a) Climate risks',   'Transition: India CCTS carbon pricing . Physical: Supply chain', y);
  y = kvRow(doc, ctx, 'b) Business impact', 'Regulatory: CCTS compliance 2026 . Market: Carbon cost of goods', y);
  y = kvRow(doc, ctx, 'c) Scenarios used',  'IEA Net Zero 2050 . IPCC 1.5C . India NDC 2030 . RCP 4.5/8.5', y);
  y += 4;

  y = sectionHead(doc, ctx, 'PILLAR 4 -- METRICS AND TARGETS (WITH YoY COMPARISON)', y, C.green);
  y = drawTable(doc, ctx,
    ['METRIC', 'VALUE', `FY ${parseInt(year,10)-1}`, 'UNIT', 'YEAR', 'NOTES'],
    [
      ['Scope 1 GHG Emissions', fmt(s1), pTotal>0?fmt(p1):'--', 'tCO2e', year, 'Direct . DEFRA 2024'],
      ['Scope 2 GHG Emissions', fmt(s2), pTotal>0?fmt(p2):'--', 'tCO2e', year, 'Location-based . CEA V20.0 Dec 2024'],
      ['Scope 3 GHG Emissions', fmt(s3), pTotal>0?fmt(p3):'--', 'tCO2e', year, 'Value chain . IPCC AR6'],
      ['Total GHG Emissions',   fmt(total), pTotal>0?fmt(pTotal):'--', 'tCO2e', year, 'GHG Protocol'],
      ['Credits Retired',       pdfStr(retired), '--', 'tCO2e', year, 'Blockchain verified'],
      ['Net Emissions',         fmt(Math.max(0,total-retired)), '--', 'tCO2e', year, 'After offset'],
      ['Revenue Intensity',
        profile?.revenue_cr ? fmt(total/profile.revenue_cr,3) : '--',
        pTotal>0&&profile?.revenue_cr ? fmt(pTotal/profile.revenue_cr,3) : '--',
        'tCO2e/Rs.Cr', year, 'By turnover'],
      ['FTE Intensity',
        profile?.employees ? fmt(total/profile.employees,3) : '--',
        pTotal>0&&profile?.employees ? fmt(pTotal/profile.employees,3) : '--',
        'tCO2e/emp', year, 'Per employee'],
      ['Net Zero Year', String(profile?.net_zero_year || 2050), '--', '--', '--', 'Paris Agreement'],
    ],
    y, [40,20,18,18,12,62],
    [C.muted,C.green,C.muted,C.muted,C.muted,C.muted]
  );

  y = drawUncertaintyBlock(doc, ctx, y + 4);
  y = drawEmissionFactorAttribution(doc, ctx, y + 4);
  y = drawVerifierBlock(doc, ctx, verifier, y + 4);
  drawSignatureBlock(doc, ctx, y + 4, 'TCFD Climate Disclosure');

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) { doc.setPage(p); drawFooter(doc, 'TCFD CLIMATE DISCLOSURE'); }
  safeSave(doc, `ethertrack_tcfd_${year}_${org.replace(/\s+/g, '_')}.pdf`);
};

// ═══════════════════════════════════════════════════════════════════
// Master export — returns void, callers must NOT use return value
// ═══════════════════════════════════════════════════════════════════
export const generateReport = async (type, data) => {
  switch (type) {
    case 'ghg-protocol': return generateGHGProtocolPDF(data);
    case 'brsr':         return generateBRSRPDF(data);
    case 'cdp':          return generateCDPPDF(data);
    case 'tcfd':         return generateTCFDPDF(data);
    default: throw new Error(`Unknown report type: "${type}"`);
  }
};
