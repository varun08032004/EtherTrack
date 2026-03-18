// src/services/ReportPDF.js — EtherTrack Auditor-Friendly PDF Reports
import { jsPDF } from 'jspdf';
import { getLogoBase64 } from './logoBase64'; // ✅ Logo

const C = {
  bg:      [4,   7,   6  ],
  surface: [10,  15,  12 ],
  border:  [15,  42,  26 ],
  green:   [34,  197, 94 ],
  blue:    [96,  165, 250],
  orange:  [249, 115, 22 ],
  purple:  [167, 139, 250],
  yellow:  [250, 204, 21 ],
  red:     [248, 113, 113],
  white:   [240, 253, 244],
  muted:   [134, 239, 172],
  dark:    [6,   10,  7  ],
};

const fmt = (n, d=2) => Number(n||0).toLocaleString('en-IN', { maximumFractionDigits:d, minimumFractionDigits:d });
const newDoc = () => new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });

// ── FIX 1: Always use profile.company_name ────────────────────────
const getOrgName = (profile, fallback) =>
  profile?.company_name || profile?.companyName || fallback || 'Organisation';

// ── FIX 2: Emission factor attribution block ──────────────────────
const drawEmissionFactorAttribution = (doc, y) => {
  if (y > 248) { doc.addPage(); doc.setFillColor(...C.bg); doc.rect(0,0,210,297,'F'); y = 20; }
  doc.setFillColor(6,10,7);
  doc.roundedRect(20, y, 170, 42, 2, 2, 'F');
  doc.setDrawColor(...C.border);
  doc.roundedRect(20, y, 170, 42, 2, 2, 'S');
  doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(...C.green);
  doc.text('EMISSION FACTOR SOURCES & METHODOLOGY DISCLOSURE', 24, y+6);
  doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.muted);
  [
    '· DEFRA 2024 — UK Government GHG Conversion Factors for Company Reporting (Crown Copyright 2024)',
    '· CEA India 2024 — Central Electricity Authority Grid Emission Factor: 0.79 kgCO₂e/kWh',
    '· IPCC AR6 (2021) — Sixth Assessment Report Global Warming Potentials (GWP100)',
    '· IEA 2024 — International Energy Agency World Energy Outlook Emission Factors',
    '· BEE India — Bureau of Energy Efficiency PAT Scheme Technical Guidelines',
    '· GHG Protocol Corporate Standard (2004, revised 2015) — Operational Control consolidation boundary',
  ].forEach((s, i) => doc.text(s, 24, y+12+(i*4.8)));
  return y + 46;
};

// ── FIX 3: Signature block for CA/CFO ────────────────────────────
const drawSignatureBlock = (doc, y, reportType) => {
  if (y > 232) { doc.addPage(); doc.setFillColor(...C.bg); doc.rect(0,0,210,297,'F'); y = 20; }
  doc.setFillColor(10,15,12);
  doc.roundedRect(20, y, 170, 58, 2, 2, 'F');
  doc.setDrawColor(...C.border);
  doc.roundedRect(20, y, 170, 58, 2, 2, 'S');
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...C.white);
  doc.text('DECLARATION & AUTHORISED SIGNATORY', 24, y+7);
  doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.muted);
  const decl = `I hereby confirm that the ${reportType} disclosures above are accurate and complete to the best of my knowledge, prepared in accordance with applicable standards and regulations.`;
  doc.text(doc.splitTextToSize(decl, 162), 24, y+14);
  // Signature lines
  [[24,'Name & Designation'],[82,'DIN / PAN Number'],[140,'Date (DD/MM/YYYY)']].forEach(([x, label]) => {
    doc.setDrawColor(...C.border); doc.setLineWidth(0.4);
    doc.line(x, y+40, x+52, y+40);
    doc.setFontSize(6.5); doc.setTextColor(...C.muted);
    doc.text(label, x, y+45);
  });
  doc.setFontSize(6.5); doc.setTextColor(...C.muted);
  doc.text('Company Seal / Stamp:', 24, y+54);
  doc.setDrawColor(...C.border); doc.roundedRect(60, y+50, 32, 6, 1, 1);
  return y + 62;
};

// ── FIX 4: YoY comparison row ─────────────────────────────────────
const yoyRow = (doc, label, current, previous, unit, y) => {
  const change = previous > 0 ? ((current-previous)/previous*100) : null;
  const changeStr = change !== null ? `${change>=0?'+':''}${fmt(change,1)}%` : '—';
  const changeColor = change === null ? C.muted : change > 0 ? C.red : C.green;
  doc.setFontSize(8); doc.setFont('helvetica','normal');
  doc.setTextColor(...C.muted);   doc.text(label, 23, y);
  doc.setTextColor(...C.white);   doc.text(`${fmt(current)} ${unit}`, 95, y);
  doc.setTextColor(...C.muted);   doc.text(previous>0?`${fmt(previous)} ${unit}`:'—', 135, y);
  doc.setTextColor(...changeColor); doc.text(changeStr, 173, y);
  doc.setDrawColor(...C.border); doc.setLineWidth(0.1);
  doc.line(20, y+2, 190, y+2);
  return y+7;
};

const drawHeader = (doc, title, subtitle, reportType, orgName, year, color=C.green, logo=null) => {
  const W = 210;
  doc.setFillColor(...C.bg); doc.rect(0,0,W,297,'F');
  doc.setFillColor(...color); doc.rect(0,0,W,2,'F');
  doc.setFillColor(...C.surface); doc.rect(0,2,W,44,'F');

  // ✅ Logo top left — only add if valid base64 image
  if (logo && typeof logo === 'string' && logo.startsWith('data:image')) {
    try { doc.addImage(logo, 'PNG', 18, 6, 32, 32); } catch {}
  }

  // Shift text right if logo present
  const textX = logo ? 54 : 20;

  doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...color);
  doc.text(`ETHERTRACK CARBON EXCHANGE  ·  ${reportType}  ·  FY ${year}`, textX, 14);
  doc.setFontSize(18); doc.setFont('helvetica','bold'); doc.setTextColor(...C.white);
  doc.text(title, textX, 26);
  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(...C.muted);
  doc.text(subtitle, textX, 34);
  doc.setFontSize(9); doc.setTextColor(...C.white);
  doc.text(orgName, W-20, 22, {align:'right'});
  doc.setFontSize(8); doc.setTextColor(...C.muted);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'})}`, W-20, 30, {align:'right'});
  doc.text('Blockchain verified  ·  EtherTrack', W-20, 38, {align:'right'});
  doc.setDrawColor(...C.border); doc.setLineWidth(0.3);
  doc.line(20, 46, W-20, 46);
  return 52;
};

const sectionHead = (doc, text, y, color=C.green) => {
  doc.setFillColor(...C.border); doc.rect(20,y,170,8,'F');
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...color);
  doc.text(text, 23, y+5.5);
  return y+12;
};

const kvRow = (doc, label, value, y, labelColor=C.muted, valueColor=C.white) => {
  doc.setFontSize(8); doc.setFont('helvetica','normal');
  doc.setTextColor(...labelColor); doc.text(label, 23, y);
  doc.setTextColor(...valueColor); doc.text(String(value||'—'), 100, y);
  doc.setDrawColor(...C.border); doc.setLineWidth(0.1);
  doc.line(20, y+2, 190, y+2);
  return y+7;
};

const drawTable = (doc, headers, rows, y, colWidths, colColors=[]) => {
  const ml = 20;
  doc.setFillColor(...C.border); doc.rect(ml,y,170,7,'F');
  let x = ml;
  headers.forEach((h,i) => {
    doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(...C.muted);
    doc.text(h, x+2, y+5); x += colWidths[i];
  });
  y += 8;
  rows.forEach((row, ri) => {
    if (y > 270) { doc.addPage(); doc.setFillColor(...C.bg); doc.rect(0,0,210,297,'F'); y=20; }
    const rc = ri%2===0 ? C.surface : C.dark;
    doc.setFillColor(rc[0],rc[1],rc[2]); doc.rect(ml,y-1,170,7,'F');
    x = ml;
    row.forEach((cell,ci) => {
      doc.setFontSize(7.5); doc.setFont('helvetica','normal');
      doc.setTextColor(...(colColors[ci]||C.white));
      doc.text(doc.splitTextToSize(String(cell||'—'),colWidths[ci]-3)[0], x+2, y+4.5);
      x += colWidths[ci];
    });
    y += 7;
  });
  return y+4;
};

const drawFooter = (doc, reportType) => {
  const W = 210;
  doc.setFillColor(...C.surface); doc.rect(0,284,W,13,'F');
  doc.setDrawColor(...C.border); doc.setLineWidth(0.2); doc.line(0,284,W,284);
  doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(...C.muted);
  doc.text(`EtherTrack Carbon Exchange  ·  ${reportType}  ·  Blockchain-verified  ·  Ethereum Sepolia`, 20, 291);
  doc.text(`Generated ${new Date().toLocaleDateString('en-IN')}`, W-20, 291, {align:'right'});
};

const drawVerifierBlock = (doc, verifier, y) => {
  const ml = 20;
  doc.setFillColor(13,10,26); doc.roundedRect(ml,y,170,20,2,2,'F');
  doc.setDrawColor(...C.purple); doc.setLineWidth(0.3); doc.roundedRect(ml,y,170,20,2,2,'S');
  doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(...C.purple);
  doc.text('THIRD-PARTY VERIFICATION', ml+4, y+6);
  if (verifier?.status==='connected'||verifier?.status==='verified') {
    doc.setFont('helvetica','normal'); doc.setTextColor(...C.white);
    doc.text(`Verified by: ${verifier.verifier_name}`, ml+4, y+12);
    doc.setTextColor(...C.green); doc.text('✓ VERIFIED', ml+140, y+12);
    doc.setTextColor(...C.muted); doc.text(`Ref: ${verifier.verification_ref||'—'}  ·  Date: ${verifier.verification_date||'—'}`, ml+4, y+17);
  } else {
    doc.setFont('helvetica','normal'); doc.setTextColor(...C.muted);
    doc.text('Verification pending — EtherTrack will connect an accredited verifier on your behalf', ml+4, y+11);
    doc.setTextColor([245,158,11]);
    doc.text('⏳ PENDING  ·  Contact: hello@ethertrack.in  ·  Bureau Veritas / DNV / EY available', ml+4, y+17);
  }
  return y+24;
};

// ═══════════════════════════════════════════════════════════════
// 1. GHG PROTOCOL PDF
// ═══════════════════════════════════════════════════════════════
export const generateGHGProtocolPDF = async ({
  orgName, year, profile, emissions, retirements, credits, verifier
}) => {
  const doc = newDoc();
  const logo = await getLogoBase64(); // ✅ logo
  const org = getOrgName(profile, orgName); // ✅ FIX 1
  const scope1 = emissions.filter(r=>r.scope===1).reduce((s,r)=>s+parseFloat(r.co2e||0),0);
  const scope2 = emissions.filter(r=>r.scope===2).reduce((s,r)=>s+parseFloat(r.co2e||0),0);
  const scope3 = emissions.filter(r=>r.scope===3).reduce((s,r)=>s+parseFloat(r.co2e||0),0);
  const total  = scope1+scope2+scope3;
  const totalRetired = retirements.reduce((s,r)=>s+parseInt(r.amount||0),0);

  let y = drawHeader(doc,
    'GHG Protocol Corporate Standard',
    'Greenhouse Gas Inventory  ·  ISO 14064-1  ·  Operational Control Boundary',
    'GHG PROTOCOL', org, year, C.green, logo
  );

  y = sectionHead(doc, 'SECTION 1 — ORGANISATION DETAILS', y);
  y = kvRow(doc, 'Organisation',           org,                                  y);
  y = kvRow(doc, 'CIN',                    profile?.company_cin||'—',            y);
  y = kvRow(doc, 'GSTIN',                  profile?.company_gstin||'—',          y);
  y = kvRow(doc, 'PAN',                    profile?.company_pan||'—',            y);
  y = kvRow(doc, 'Industry',               profile?.industry||'—',               y);
  y = kvRow(doc, 'Reporting Year',         `FY ${year}`,                         y);
  y = kvRow(doc, 'Base Year',              String(profile?.base_year||2024),      y);
  y = kvRow(doc, 'Employees (FTE)',        String(profile?.employees||'—'),       y);
  y = kvRow(doc, 'Annual Revenue',         profile?.revenue_cr?`₹${profile.revenue_cr} Crore`:'—', y);
  y = kvRow(doc, 'Consolidation Approach', 'Operational Control',                y);
  y = kvRow(doc, 'Methodology',            'GHG Protocol Corporate Standard (2004, revised 2015)', y);
  y += 4;

  // ✅ FIX 4: YoY comparison header
  y = sectionHead(doc, 'SECTION 2 — GHG INVENTORY WITH YEAR-ON-YEAR COMPARISON', y, C.green);
  doc.setFillColor(...C.border); doc.rect(20,y,170,7,'F');
  doc.setFontSize(7.5); doc.setFont('helvetica','bold'); doc.setTextColor(...C.muted);
  doc.text('METRIC', 23, y+5);
  doc.text(`FY ${year} (CURRENT)`, 95, y+5);
  doc.text(`FY ${parseInt(year)-1} (PREVIOUS)`, 135, y+5);
  doc.text('CHANGE %', 173, y+5);
  y += 9;
  y = yoyRow(doc, 'Scope 1 — Direct Emissions',      scope1, 0, 'tCO₂e', y);
  y = yoyRow(doc, 'Scope 2 — Purchased Electricity', scope2, 0, 'tCO₂e', y);
  y = yoyRow(doc, 'Scope 3 — Value Chain',           scope3, 0, 'tCO₂e', y);
  y = yoyRow(doc, 'TOTAL GHG EMISSIONS',             total,  0, 'tCO₂e', y);
  y = yoyRow(doc, 'Credits Retired (Offset)',        totalRetired, 0, 'tCO₂e', y);
  y = yoyRow(doc, 'Net Emissions After Offset',      Math.max(0,total-totalRetired), 0, 'tCO₂e', y);
  if (profile?.revenue_cr) y = yoyRow(doc,'Revenue Carbon Intensity',total/profile.revenue_cr,0,'tCO₂e/₹Cr',y);
  if (profile?.employees)  y = yoyRow(doc,'FTE Carbon Intensity',total/profile.employees,0,'tCO₂e/emp',y);
  y += 4;

  y = sectionHead(doc, 'SECTION 3 — EMISSION ACTIVITIES DETAIL', y);
  if (emissions.length > 0) {
    y = drawTable(doc,
      ['DATE','ACTIVITY','SCOPE','CATEGORY','QTY','tCO₂e','SOURCE'],
      emissions.slice(0,20).map(r=>[
        r.date?.slice(0,10)||'—', r.activity||'—', `S${r.scope}`,
        r.category||'—', `${parseFloat(r.quantity||r.qty||0).toFixed(1)} ${r.unit||''}`,
        parseFloat(r.co2e||0).toFixed(4), r.source||'—',
      ]),
      y, [22,48,12,32,22,16,18],
      [C.muted,C.white,C.green,C.muted,C.muted,C.green,C.muted]
    );
  } else {
    doc.setFontSize(9); doc.setTextColor(...C.muted);
    doc.text('No emission activities recorded for this period.', 23, y+8); y+=14;
  }

  y = sectionHead(doc, 'SECTION 4 — CARBON CREDIT RETIREMENTS', y, C.purple);
  if (retirements.length > 0) {
    y = drawTable(doc,
      ['CERT ID','PROJECT','STANDARD','tCO₂e','SCOPE','DATE','TX HASH'],
      retirements.slice(0,10).map(r=>[
        r.certificate_id||'—', r.project_name||'—', r.standard||'—',
        r.amount||0, `S${r.retire_scope||1}`,
        r.retired_at?.slice(0,10)||'—', (r.tx_hash||'—').slice(0,14)+'…',
      ]),
      y, [30,42,18,14,12,22,32],
      [C.blue,C.white,C.green,C.green,C.purple,C.muted,C.blue]
    );
  } else {
    doc.setFontSize(9); doc.setTextColor(...C.muted);
    doc.text('No retirements in this period.', 23, y+8); y+=14;
  }

  y = drawEmissionFactorAttribution(doc, y); // ✅ FIX 2
  y = drawVerifierBlock(doc, verifier, y+4);
  y = drawSignatureBlock(doc, y+4, 'GHG Protocol Corporate Standard'); // ✅ FIX 3

  drawFooter(doc, 'GHG PROTOCOL CORPORATE STANDARD');
  doc.save(`ethertrack_ghg_protocol_fy${year}_${org.replace(/\s+/g,'_')}.pdf`);
};

// ═══════════════════════════════════════════════════════════════
// 2. BRSR CORE PDF
// ═══════════════════════════════════════════════════════════════
export const generateBRSRPDF = async ({
  orgName, year, profile, emissions, retirements, credits, verifier
}) => {
  const doc = newDoc();
  const logo = await getLogoBase64(); // ✅ logo
  const org = getOrgName(profile, orgName); // ✅ FIX 1
  const scope1 = emissions.filter(r=>r.scope===1).reduce((s,r)=>s+parseFloat(r.co2e||0),0);
  const scope2 = emissions.filter(r=>r.scope===2).reduce((s,r)=>s+parseFloat(r.co2e||0),0);
  const scope3 = emissions.filter(r=>r.scope===3).reduce((s,r)=>s+parseFloat(r.co2e||0),0);
  const total  = scope1+scope2+scope3;
  const totalRetired = retirements.reduce((s,r)=>s+parseInt(r.amount||0),0);

  let y = drawHeader(doc,
    'Business Responsibility & Sustainability Report',
    'SEBI BRSR Core  ·  SEBI Circular SEBI/HO/CFD/CMD-2/CIR/P/2023/120  ·  FY '+year+'-'+(parseInt(year)+1),
    'SEBI BRSR CORE', org, year, C.orange, logo
  );

  y = sectionHead(doc, 'PART A — GENERAL DISCLOSURES', y, C.orange);
  y = kvRow(doc, 'Corporate Identity Number (CIN)', profile?.company_cin||'—',       y);
  y = kvRow(doc, 'Name of the Listed Entity',       org,                              y);
  y = kvRow(doc, 'GSTIN',                           profile?.company_gstin||'—',      y);
  y = kvRow(doc, 'PAN',                             profile?.company_pan||'—',        y);
  y = kvRow(doc, 'Industry (NIC Code)',             profile?.industry||'—',           y);
  y = kvRow(doc, 'Reporting Period',                `FY ${year}-${parseInt(year)+1}`, y);
  y = kvRow(doc, 'Base Year for Targets',           String(profile?.base_year||2024), y);
  y = kvRow(doc, 'Number of Employees',             String(profile?.employees||'—'),  y);
  y = kvRow(doc, 'Annual Turnover (₹ Crore)',       String(profile?.revenue_cr||'—'), y);
  y += 4;

  y = sectionHead(doc, 'PRINCIPLE 6 — ENVIRONMENTAL RESPONSIBILITY (P6-E1 CORE KPI)', y, C.green);
  doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...C.orange);
  doc.text('Essential Indicators — Greenhouse Gas Emissions (with Year-on-Year Comparison)', 23, y); y += 8;

  // ✅ FIX 4: YoY in BRSR table
  y = drawTable(doc,
    ['METRIC','UNIT','FY CURRENT','FY PREVIOUS','CHANGE %'],
    [
      ['Scope 1 GHG Emissions',          'tCO₂e', fmt(scope1), '—', '—'],
      ['Scope 2 GHG Emissions (Location)','tCO₂e', fmt(scope2), '—', '—'],
      ['Scope 3 GHG Emissions',          'tCO₂e', fmt(scope3), '—', '—'],
      ['Total GHG Emissions',            'tCO₂e', fmt(total),  '—', '—'],
      ['Carbon Credits Retired',         'tCO₂e', String(totalRetired), '—', '—'],
      ['Net Emissions After Offset',     'tCO₂e', fmt(Math.max(0,total-totalRetired)), '—', '—'],
      ['Revenue Carbon Intensity',       'tCO₂e/₹Cr', profile?.revenue_cr?fmt(total/profile.revenue_cr,3):'—', '—', '—'],
      ['GHG Reduction Target',           'tCO₂e', String(profile?.net_zero_target_co2e||'In progress'), '—', '—'],
    ],
    y, [55,22,28,28,22],
    [C.muted,C.muted,C.green,C.muted,C.muted]
  );

  y = sectionHead(doc, 'P6-E2: CARBON CREDIT DETAILS', y, C.green);
  if (retirements.length > 0) {
    y = drawTable(doc,
      ['CERT ID','PROJECT','STANDARD','tCO₂e','SCOPE','PURPOSE','TX HASH'],
      retirements.slice(0,8).map(r=>[
        r.certificate_id||'—', r.project_name||'—', r.standard||'—',
        r.amount||0, `S${r.retire_scope||1}`,
        r.purpose||'Voluntary offset', (r.tx_hash||'—').slice(0,16)+'…',
      ]),
      y, [28,38,18,14,12,28,32],
      [C.blue,C.white,C.green,C.green,C.purple,C.muted,C.blue]
    );
  } else {
    doc.setFontSize(9); doc.setTextColor(...C.muted);
    doc.text('No carbon credit retirements in this reporting period.', 23, y+8); y+=14;
  }

  y = drawEmissionFactorAttribution(doc, y); // ✅ FIX 2
  y = drawVerifierBlock(doc, verifier, y+4);
  y = drawSignatureBlock(doc, y+4, 'SEBI BRSR Core'); // ✅ FIX 3

  drawFooter(doc, 'SEBI BRSR CORE');
  doc.save(`ethertrack_brsr_core_fy${year}_${org.replace(/\s+/g,'_')}.pdf`);
};

// ═══════════════════════════════════════════════════════════════
// 3. CDP CLIMATE CHANGE PDF
// ═══════════════════════════════════════════════════════════════
export const generateCDPPDF = async ({
  orgName, year, profile, emissions, retirements, credits, verifier
}) => {
  const doc = newDoc();
  const logo = await getLogoBase64(); // ✅ logo
  const org = getOrgName(profile, orgName); // ✅ FIX 1
  const scope1 = emissions.filter(r=>r.scope===1).reduce((s,r)=>s+parseFloat(r.co2e||0),0);
  const scope2 = emissions.filter(r=>r.scope===2).reduce((s,r)=>s+parseFloat(r.co2e||0),0);
  const scope3 = emissions.filter(r=>r.scope===3).reduce((s,r)=>s+parseFloat(r.co2e||0),0);
  const total  = scope1+scope2+scope3;
  const totalRetired = retirements.reduce((s,r)=>s+parseInt(r.amount||0),0);

  let y = drawHeader(doc,
    'CDP Climate Change Questionnaire',
    'Carbon Disclosure Project  ·  Climate Change 2025  ·  Reporting Year '+year,
    'CDP CLIMATE', org, year, C.blue, logo
  );

  y = sectionHead(doc, 'C0 — INTRODUCTION', y, C.blue);
  y = kvRow(doc, 'Organisation',    org,                       y);
  y = kvRow(doc, 'Reporting Year',  String(year),               y);
  y = kvRow(doc, 'Country',         'India',                    y);
  y = kvRow(doc, 'Activity',        profile?.industry||'—',    y);
  y = kvRow(doc, 'Revenue (₹ Cr)',  String(profile?.revenue_cr||'—'), y);
  y += 4;

  y = sectionHead(doc, 'C1 — GOVERNANCE', y, C.blue);
  y = kvRow(doc, 'C1.1 Board oversight', 'Board-level ESG committee (in progress)', y);
  y = kvRow(doc, 'C1.2 Management role', 'ESG Manager tracks via EtherTrack platform', y);
  y += 4;

  y = sectionHead(doc, 'C4 — TARGETS AND PERFORMANCE', y, C.blue);
  y = kvRow(doc, 'C4.1 Net zero target year',   String(profile?.net_zero_year||2050), y);
  y = kvRow(doc, 'C4.1a Ambition',              'Paris Agreement 1.5°C pathway', y);
  y = kvRow(doc, 'C4.2 Base year emissions',    `${fmt(total)} tCO₂e`, y);
  y = kvRow(doc, 'C4.2a 2030 target',           '50% reduction (India NDC aligned)', y);
  y += 4;

  y = sectionHead(doc, 'C6 — EMISSIONS DATA', y, C.blue);
  y = drawTable(doc,
    ['CDP QUESTION','RESPONSE','UNIT','METHODOLOGY'],
    [
      ['C6.1 Scope 1 GHG emissions',   fmt(scope1),   'tCO₂e', 'GHG Protocol / DEFRA 2024'],
      ['C6.3 Scope 2 (location-based)',fmt(scope2),   'tCO₂e', 'CEA India 2023 — 0.82 kgCO₂e/kWh'],
      ['C6.3a Scope 2 (market-based)', '—',           'tCO₂e', 'Not yet assessed'],
      ['C6.5 Scope 3 total',           fmt(scope3),   'tCO₂e', 'GHG Protocol / IPCC AR6'],
      ['C6.5a Scope 3 categories',     'All tracked', '—',     'Activity-based'],
      ['C6.7 Verification',            'Blockchain verified', '—', 'EtherTrack / Ethereum Sepolia'],
    ],
    y, [70,30,20,50],
    [C.muted,C.green,C.muted,C.muted]
  );

  y = sectionHead(doc, 'C11 — CARBON PRICING', y, C.purple);
  y = kvRow(doc, 'C11.1 Carbon price exposure',   'India CCTS (BEE) + Voluntary market', y);
  y = kvRow(doc, 'C11.2 Credits retired',         `${totalRetired} tCO₂e`, y);
  y = kvRow(doc, 'C11.2a Registries used',        [...new Set(retirements.map(r=>r.standard))].join(', ')||'VCS', y);
  y = kvRow(doc, 'C11.2b Credit type',            'Voluntary Carbon Units (VCU) / CCC', y);
  y = kvRow(doc, 'C11.2c Verification method',    'ISO 14064-3 / Blockchain (Ethereum Sepolia)', y);
  y += 4;

  if (retirements.length > 0) {
    y = sectionHead(doc, 'C11 CREDIT DETAILS', y, C.purple);
    y = drawTable(doc,
      ['PROJECT','STANDARD','CCP','tCO₂e','VINTAGE','CA','CERT ID'],
      retirements.slice(0,8).map(r=>[
        r.project_name||'—', r.standard||'—',
        credits.find(c=>c.registry_serial===r.serial_number)?.icvcm_ccp_eligible?'Yes':'No',
        r.amount||0, r.vintage_year||'—', r.corresponding_adjustment||'none', r.certificate_id||'—',
      ]),
      y, [42,18,12,16,14,20,28],
      [C.white,C.green,C.yellow,C.green,C.muted,C.blue,C.blue]
    );
  }

  y = drawEmissionFactorAttribution(doc, y); // ✅ FIX 2
  drawVerifierBlock(doc, verifier, y+4);
  y = drawSignatureBlock(doc, y+28, 'CDP Climate Change Questionnaire'); // ✅ FIX 3

  drawFooter(doc, 'CDP CLIMATE CHANGE QUESTIONNAIRE');
  doc.save(`ethertrack_cdp_climate_${year}_${org.replace(/\s+/g,'_')}.pdf`);
};

// ═══════════════════════════════════════════════════════════════
// 4. TCFD DISCLOSURE PDF
// ═══════════════════════════════════════════════════════════════
export const generateTCFDPDF = async ({
  orgName, year, profile, emissions, retirements, credits, verifier
}) => {
  const doc = newDoc();
  const logo = await getLogoBase64(); // ✅ logo
  const org = getOrgName(profile, orgName); // ✅ FIX 1
  const scope1 = emissions.filter(r=>r.scope===1).reduce((s,r)=>s+parseFloat(r.co2e||0),0);
  const scope2 = emissions.filter(r=>r.scope===2).reduce((s,r)=>s+parseFloat(r.co2e||0),0);
  const scope3 = emissions.filter(r=>r.scope===3).reduce((s,r)=>s+parseFloat(r.co2e||0),0);
  const total  = scope1+scope2+scope3;
  const totalRetired = retirements.reduce((s,r)=>s+parseInt(r.amount||0),0);

  let y = drawHeader(doc,
    'Task Force on Climate-related Financial Disclosures',
    'TCFD Framework  ·  4 Pillars: Governance · Strategy · Risk Management · Metrics & Targets',
    'TCFD DISCLOSURE', org, year, C.purple, logo
  );

  y = sectionHead(doc, 'PILLAR 1 — GOVERNANCE', y, C.purple);
  y = kvRow(doc, 'a) Board oversight',  'ESG committee oversight in progress', y);
  y = kvRow(doc, 'b) Management role',  'ESG Manager monitors via EtherTrack Carbon Intelligence', y);
  y = kvRow(doc, 'Oversight mechanism', 'Quarterly ESG review · Annual BRSR/CDP disclosure', y);
  y += 4;

  y = sectionHead(doc, 'PILLAR 2 — STRATEGY', y, C.blue);
  y = kvRow(doc, 'a) Climate risks',    'Transition: India CCTS carbon pricing · Physical: Supply chain', y);
  y = kvRow(doc, 'b) Business impact',  'Regulatory: CCTS compliance 2026 · Market: Carbon cost', y);
  y = kvRow(doc, 'c) Scenarios used',   'IEA Net Zero 2050 · IPCC 1.5°C · India NDC 2030', y);
  y += 4;

  y = sectionHead(doc, 'PILLAR 3 — RISK MANAGEMENT', y, C.orange);
  y = kvRow(doc, 'a) Risk identification', 'Annual GHG inventory via EtherTrack (ISO 14064-1)', y);
  y = kvRow(doc, 'b) Risk assessment',     'Carbon intensity vs industry benchmark · Scope 3 mapping', y);
  y = kvRow(doc, 'c) Integration',         'EtherTrack integrated into ESG reporting workflow', y);
  y += 4;

  y = sectionHead(doc, 'PILLAR 4 — METRICS AND TARGETS', y, C.green);
  y = drawTable(doc,
    ['METRIC','VALUE','UNIT','YEAR','NOTES'],
    [
      ['Scope 1 GHG Emissions',    fmt(scope1),  'tCO₂e', year, 'Direct combustion + fugitives · DEFRA 2024'],
      ['Scope 2 GHG Emissions',    fmt(scope2),  'tCO₂e', year, 'Location-based · CEA India 2023'],
      ['Scope 3 GHG Emissions',    fmt(scope3),  'tCO₂e', year, 'Value chain · IPCC AR6'],
      ['Total GHG Emissions',      fmt(total),   'tCO₂e', year, 'GHG Protocol boundary'],
      ['Carbon Credits Retired',   totalRetired, 'tCO₂e', year, 'Blockchain verified · Ethereum Sepolia'],
      ['Net Emissions',            fmt(Math.max(0,total-totalRetired)), 'tCO₂e', year, 'After offset'],
      ['Revenue Intensity',        profile?.revenue_cr?fmt(total/profile.revenue_cr,3):'—', 'tCO₂e/₹Cr', year, 'Normalised'],
      ['FTE Intensity',            profile?.employees?fmt(total/profile.employees,3):'—',   'tCO₂e/emp', year, 'Per employee'],
      ['2030 Target',              '50% reduction', '%',   2030, 'India NDC aligned'],
      ['Net Zero Year',            String(profile?.net_zero_year||2050), '—', '—', 'Paris Agreement'],
    ],
    y, [52,24,22,14,58],
    [C.muted,C.green,C.muted,C.muted,C.muted]
  );

  y = sectionHead(doc, 'NET ZERO ROADMAP', y, C.green);
  y = drawTable(doc,
    ['MILESTONE','TARGET YEAR','EMISSION TARGET','REDUCTION','MECHANISM'],
    [
      ['Short-term (India NDC)',    '2030', `${fmt(total*0.5)} tCO₂e`,  '50%', 'Renewable energy + efficiency'],
      ['Medium-term (SBTi 1.5°C)', '2035', `${fmt(total*0.35)} tCO₂e`, '65%', 'Supply chain + electrification'],
      ['Long-term reduction',      '2040', `${fmt(total*0.2)} tCO₂e`,  '80%', 'Deep decarbonisation'],
      [`Net Zero`,                 String(profile?.net_zero_year||2050), '0', '100%', 'Residual offset via blockchain'],
    ],
    y, [38,22,32,24,54],
    [C.muted,C.yellow,C.green,C.green,C.muted]
  );

  y = drawEmissionFactorAttribution(doc, y); // ✅ FIX 2
  y = drawVerifierBlock(doc, verifier, y+4);
  y = drawSignatureBlock(doc, y+4, 'TCFD Climate Disclosure'); // ✅ FIX 3

  drawFooter(doc, 'TCFD CLIMATE DISCLOSURE');
  doc.save(`ethertrack_tcfd_${year}_${org.replace(/\s+/g,'_')}.pdf`);
};

// ═══════════════════════════════════════════════════════════════
// Master export
// ═══════════════════════════════════════════════════════════════
export const generateReport = async (type, data) => {
  switch(type) {
    case 'ghg-protocol': return generateGHGProtocolPDF(data);
    case 'brsr':         return generateBRSRPDF(data);
    case 'cdp':          return generateCDPPDF(data);
    case 'tcfd':         return generateTCFDPDF(data);
    default: throw new Error(`Unknown report type: ${type}`);
  }
};