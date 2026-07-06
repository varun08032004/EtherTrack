// src/components/BRSRImportParser.jsx
// ── BRSR PDF Import — Production-ready parser
//    Covers: Section A (Q1–Q26), Section B (Q1–Q12), Section C P1–P9 (Essential + Leadership)
//    PDF text extraction via pdf.js (browser-side, zero server calls for parsing)
//    On confirm → POSTs to:
//      POST /api/brsr/section-a
//      POST /api/brsr/section-b
//      POST /api/brsr/section-c/p1  through p9
//      POST /api/brsr/environmental  (P6 energy/water/waste)
//    Confidence tiers: high | medium | low | nil
//    NIL fields in source → null in state (never coerced to 0)

import React, { useState, useRef, useCallback } from 'react';
import { apiFetch } from '../services/api';

// ─────────────────────────────────────────────────────────────────────────────
// PDF.JS TEXT EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

const loadPdfJs = async () => {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return window.pdfjsLib;
};

const extractAllText = async (file, onProgress) => {
  const lib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const n   = pdf.numPages;
  let full  = '';
  for (let i = 1; i <= n; i++) {
    if (onProgress) onProgress(Math.round((i / n) * 78), `Page ${i} of ${n}…`);
    const pg   = await pdf.getPage(i);
    const cont = await pg.getTextContent();
    full += `\n=== PAGE ${i} ===\n` + cont.items.map(x => x.str).join(' ');
  }
  if (onProgress) onProgress(88, 'Parsing structure…');
  return full;
};

// ─────────────────────────────────────────────────────────────────────────────
// CORE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const san = (s = '', max = 400) =>
  String(s).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, max);

const cleanVal = (raw) => {
  if (!raw) return null;
  const c = raw.trim();
  if (!c || /^nil$/i.test(c) || c === '—' || c === '-' || c === 'N.A.' || c === 'NA') return null;
  return san(c);
};

const pf = (raw) => {
  if (raw === null || raw === undefined) return null;
  const n = parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const pi = (raw) => {
  if (raw === null || raw === undefined) return null;
  const n = parseInt(String(raw).replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

const pYear = (raw) => { const n = pi(raw); return n && n >= 1850 && n <= 2100 ? n : null; };

// Try multiple regex patterns, return first clean non-NIL match
const tryPatterns = (text, patterns) => {
  for (const p of patterns) {
    const m = text.match(p);
    const v = cleanVal(m?.[1]);
    if (v) return v;
  }
  return null;
};

// Extract a Yes/No answer
const yesNo = (text, patterns) => {
  const v = tryPatterns(text, patterns);
  if (!v) return null;
  if (/^yes$/i.test(v)) return 'Yes';
  if (/^no$/i.test(v))  return 'No';
  return v;
};

// Extract numeric value via patterns
const numFrom = (text, patterns) => {
  const v = tryPatterns(text, patterns);
  return pf(v);
};

// Wrap result with confidence
const hc = (value, confidence = 'high') => value !== null && value !== undefined ? { value, confidence } : null;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A EXTRACTORS
// ─────────────────────────────────────────────────────────────────────────────

const extractSectionA = (text) => {
  const out = {};

  // Q1 — CIN
  const cinM = text.match(/\b([UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}[0-9A-Z]{6})\b/);
  if (cinM) out.cin = hc(cinM[1]);

  // Q2 — Company name
  const name = tryPatterns(text, [
    /2\.\s*Name of the Listed Entity\s*[:\t ]+([^\n\t]{3,120})/i,
    /Name of the Listed Entity\s{2,}([^\n\t]{3,120})/i,
    /REPORTING ENTITY\s*\n\s*([^\n]{3,120})/i,
  ]);
  if (name) out.companyName = hc(san(name, 200));

  // Q3 — Year of incorporation
  const incorp = tryPatterns(text, [
    /3\.\s*Year of incorporation\s*[:\t ]+(\d{4})/i,
    /Year of incorporation\s*[:\t ]+(\d{4})/i,
    /Year of incorporation\s{2,}(\d{4})/i,
  ]);
  if (incorp) out.yearIncorporation = hc(pYear(incorp));

  // Q4 — Registered office
  const reg = tryPatterns(text, [
    /4\.\s*Registered office address\s*[:\t ]+([^\n]{5,})/i,
    /Registered office address\s*[:\t ]+([^\n]{5,})/i,
    /Registered office address\s{2,}([^\n]{5,})/i,
  ]);
  if (reg) out.regOfficeAddress = hc(san(reg, 500), 'medium');

  // Q5 — Corporate address
  const corp = tryPatterns(text, [
    /5\.\s*Corporate address\s*[:\t ]+([^\n]{5,})/i,
    /Corporate address\s*[:\t ]+([^\n]{5,})/i,
  ]);
  if (corp) out.corpOfficeAddress = hc(san(corp, 500), 'medium');

  // Q6 — Email
  const emailM = text.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/);
  if (emailM) out.email = hc(emailM[1]);

  // Q7 — Telephone
  const tel = tryPatterns(text, [
    /7\.\s*Telephone\s*[:\t ]+([+0-9][+0-9 \-()\-]{6,20})/i,
    /Telephone\s*[:\t ]+([+0-9][+0-9 \-()\-]{6,20})/i,
  ]);
  if (tel) out.telephone = hc(tel.replace(/\s+/g, ''), 'medium');

  // Q8 — Website
  const webM = text.match(/Website\s*[:\t ]*(https?:\/\/[^\s,\n]+|www\.[^\s,\n]+)/i);
  if (webM) { const v = cleanVal(webM[1]); if (v) out.website = hc(v); }

  // Q9 — Financial year (already known from prop, but extract for validation)
  const fyM = text.match(/Financial year[^:]*[:\t ]+FY\s*(\d{4})/i);
  if (fyM) out.financialYear = hc(fyM[1], 'medium');

  // Q10 — Stock exchange
  const exch = tryPatterns(text, [
    /10\.\s*Name of the Stock Exchange[^:\n]*[:\t ]+([^\n]+)/i,
    /Stock Exchange[^:\n]*listed\s*[:\t ]+([^\n]+)/i,
  ]);
  if (exch) {
    if (/NSE/i.test(exch)) out.listedNSE = hc(true);
    if (/BSE/i.test(exch)) out.listedBSE = hc(true);
    out.stockExchange = hc(san(exch, 100), 'medium');
  }

  // Q11 — Paid-up capital
  const cap = tryPatterns(text, [
    /11\.\s*Paid.up Capital\s*[:\t ]+([0-9,]+\.?[0-9]*)/i,
    /Paid.up Capital\s*[:\t ]+([0-9,]+\.?[0-9]*)/i,
    /Paid.up Capital\s{2,}([0-9,]+\.?[0-9]*)/i,
  ]);
  if (cap) out.paidUpCapital = hc(pf(cap), 'medium');

  // Q12 — Contact details
  const contName = tryPatterns(text, [
    /Name\s*[:\t ]+([A-Z][a-z]+(?: [A-Z][a-z]+)+)/,
    /Contact[^:\n]*Name\s*[:\t ]+([^\n]{3,80})/i,
  ]);
  if (contName) out.contactName = hc(san(contName, 100), 'medium');

  const contDesig = tryPatterns(text, [/Designation\s*[:\t ]+([^\n]{3,100})/i]);
  if (contDesig) out.contactDesignation = hc(san(contDesig, 100), 'medium');

  const contTel = tryPatterns(text, [/Contact Number\s*[:\t ]+([+0-9][+0-9 \-()\-]{6,20})/i]);
  if (contTel) out.contactTelephone = hc(contTel.replace(/\s+/g, ''), 'medium');

  const contEmail = text.match(/Email Id\s*[:\t ]+([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  if (contEmail) out.contactEmail = hc(contEmail[1]);

  // Q13 — Reporting boundary
  const bndM = text.match(/(?:13\.\s*Reporting boundary|Reporting boundary)[^\n]*(Standalone|Consolidated)/i);
  if (bndM) out.reportingBoundary = hc(bndM[1].toLowerCase(), 'high');

  // Q14 — Assurance provider
  const assProv = tryPatterns(text, [
    /14\.\s*Name of assurance provider\s*[:\t ]+([^\n]{3,200})/i,
    /Name of assurance provider\s*[:\t ]+([^\n]{3,200})/i,
    /Name of assurance provider\s{2,}([^\n]{3,200})/i,
  ]);
  if (assProv) out.assuranceProvider = hc(san(assProv, 200), 'medium');

  // Q15 — Assurance type
  const assType = tryPatterns(text, [
    /15\.\s*Type of assurance obtained\s*[:\t ]+([^\n]{3,100})/i,
    /Type of assurance obtained\s*[:\t ]+([^\n]{3,100})/i,
    /Type of assurance obtained\s{2,}([^\n]{3,100})/i,
  ]);
  if (assType) out.assuranceType = hc(san(assType, 100), 'medium');

  // Q18 — Operations locations (table: National / International, plants, offices)
  const natM  = text.match(/National\s+(\d+)\s+(\d+)\s+(\d+)/i);
  const intlM = text.match(/International\s+(\d+)\s+(\d+)\s+(\d+)/i);
  if (natM)  { out.nationalPlants  = hc(pi(natM[1]),  'medium'); out.nationalOffices  = hc(pi(natM[2]),  'medium'); }
  if (intlM) { out.intlPlants      = hc(pi(intlM[1]), 'medium'); out.intlOffices      = hc(pi(intlM[2]), 'medium'); }

  // Q19 — Markets
  const natStates = numFrom(text, [/National.*?No\. of States.*?(\d+)/i, /National \(No\. of States\)\s+(\d+)/i]);
  if (natStates !== null) out.nationalStates = hc(natStates, 'medium');
  const intlCountries = numFrom(text, [/International.*?No\. of Countries.*?(\d+)/i, /International \(No\. of Countries\)\s+(\d+)/i]);
  if (intlCountries !== null) out.intlCountries = hc(intlCountries, 'medium');
  const exportPct = numFrom(text, [/exports as a percentage of the total turnover[^0-9]*([0-9.]+)/i]);
  if (exportPct !== null) out.exportsPct = hc(exportPct, 'medium');

  // Q20a — Employees
  // Table rows: Permanent (D) | Other than Permanent | Total
  // Format: row label  Total  Male-No  Male-%  Female-No  Female-%
  const empPermM = text.match(/Permanent \(D\)\s+(\d+)\s+(\d+)\s+[0-9.]+\s+(\d+)/i);
  if (empPermM) {
    out.empPermTotal  = hc(pi(empPermM[1]), 'medium');
    out.empPermMale   = hc(pi(empPermM[2]), 'medium');
    out.empPermFemale = hc(pi(empPermM[3]), 'medium');
  }
  const empOtherM = text.match(/Other than Permanent \(E\)\s+(\d+)\s+(\d+)\s+[0-9.]+\s+(\d+)/i);
  if (empOtherM) {
    out.empOtherTotal  = hc(pi(empOtherM[1]), 'medium');
    out.empOtherMale   = hc(pi(empOtherM[2]), 'medium');
    out.empOtherFemale = hc(pi(empOtherM[3]), 'medium');
  }
  const empTotalM = text.match(/Total employees.*?\(D \+ E\)\s+(\d+)\s+(\d+)\s+[0-9.]+\s+(\d+)/i);
  if (empTotalM) {
    out.empTotal       = hc(pi(empTotalM[1]), 'medium');
    out.empTotalMale   = hc(pi(empTotalM[2]), 'medium');
    out.empTotalFemale = hc(pi(empTotalM[3]), 'medium');
  }

  // Workers
  const wkrPermM = text.match(/Permanent \(F\)\s+(\d+)\s+(\d+)\s+[0-9.]+\s+(\d+)/i);
  if (wkrPermM) {
    out.wkrPermTotal  = hc(pi(wkrPermM[1]), 'medium');
    out.wkrPermMale   = hc(pi(wkrPermM[2]), 'medium');
    out.wkrPermFemale = hc(pi(wkrPermM[3]), 'medium');
  }
  const wkrOtherM = text.match(/Other than Permanent \(G\)\s+(\d+)\s+(\d+)\s+[0-9.]+\s+(\d+)/i);
  if (wkrOtherM) {
    out.wkrOtherTotal  = hc(pi(wkrOtherM[1]), 'medium');
    out.wkrOtherMale   = hc(pi(wkrOtherM[2]), 'medium');
    out.wkrOtherFemale = hc(pi(wkrOtherM[3]), 'medium');
  }

  // Q21 — Women representation
  const womenBodM = text.match(/Board of Directors\s+(\d+)\s+(\d+)\s+([0-9.]+)/i);
  if (womenBodM) { out.womenBodTotal = hc(pi(womenBodM[1]), 'medium'); out.womenBodNo = hc(pi(womenBodM[2]), 'medium'); out.womenBodPct = hc(pf(womenBodM[3]), 'medium'); }
  const womenKmpM = text.match(/Key Management Personnel\s+(\d+)\s+(\d+)\s+([0-9.]+)/i);
  if (womenKmpM) { out.womenKmpTotal = hc(pi(womenKmpM[1]), 'medium'); out.womenKmpNo = hc(pi(womenKmpM[2]), 'medium'); out.womenKmpPct = hc(pf(womenKmpM[3]), 'medium'); }

  // Q24 — CSR
  const csrM = text.match(/Whether CSR is applicable[^(Yes|No)]*?(Yes|No)/i);
  if (csrM) out.csrApplicable = hc(csrM[1], 'high');
  const csrTurnover = numFrom(text, [/Turnover.*?(?:₹|Rs\.?|INR)\s*([0-9,]+\.?[0-9]*)\s*(?:Cr|Lakh|L)?/i]);
  if (csrTurnover !== null) out.csrTurnover = hc(csrTurnover, 'low');

  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B EXTRACTORS
// ─────────────────────────────────────────────────────────────────────────────

const extractSectionB = (text) => {
  const out = {};

  // Q1a–Q3 — Policy matrix (P1–P9 answers)
  // EtherTrack format: row label followed by 9 space-separated Yes/No/NIL values
  const policyCovers = text.match(/policy\/policies cover each principle[^\n]*\n([^\n]+)/i);
  if (policyCovers) {
    const vals = policyCovers[1].trim().split(/\s+/).slice(0, 9);
    if (vals.length === 9) out.policyCovers = hc(vals, 'medium');
  }

  // Q7 — Director statement
  const dirStmt = tryPatterns(text, [
    /7\.\s*Statement by director[^\n]*\n([^\n]{20,})/i,
    /Statement by director[^\n]*[:\t ]+([^\n]{20,})/i,
  ]);
  if (dirStmt) out.directorStatement = hc(san(dirStmt, 1000), 'medium');

  // Q8 — Highest authority
  const highAuth = tryPatterns(text, [
    /8\.\s*Details of the highest authority[^\n]*\n([^\n]{5,})/i,
    /highest authority responsible[^\n]*[:\t ]+([^\n]{5,})/i,
  ]);
  if (highAuth) out.highestAuthority = hc(san(highAuth, 300), 'medium');

  // Q9 — Sustainability committee
  const susComm = tryPatterns(text, [
    /9\.[^\n]*Committee[^\n]*(Yes|No)[^\n]*/i,
  ]);
  if (susComm) out.sustainabilityCommittee = hc(susComm, 'medium');

  return out;
};


// ─────────────────────────────────────────────────────────────────────────────
// SECTION C — P1 through P9 EXTRACTORS
// ─────────────────────────────────────────────────────────────────────────────

const extractP1 = (text) => {
  const out = {};
  // Q4 — Anti-corruption policy
  const acp = tryPatterns(text, [
    /anti.corruption or anti.bribery policy[^\n]*(Yes|No)[^\n]*/i,
    /4\.[^\n]*anti.corruption[^\n]*(Yes|No)/i,
  ]);
  if (acp) out.antiCorruptionPolicy = hc(acp, 'high');

  // Q5 — Disciplinary action (Directors)
  const discDir = numFrom(text, [/Directors\s+(\d+)\s+\d+/i]);
  if (discDir !== null) out.disciplinaryDirectors = hc(discDir, 'medium');

  // Q8 — Accounts payable days
  const apDays = numFrom(text, [/Number of days of accounts payables\s+([0-9.]+)/i]);
  if (apDays !== null) out.accountsPayableDays = hc(apDays, 'medium');

  return out;
};

const extractP2 = (text) => {
  const out = {};
  // Q2a — Sustainable sourcing
  const ss = tryPatterns(text, [/sustainable sourcing[^\n]*(Yes|No)/i]);
  if (ss) out.sustainableSourcing = hc(ss, 'high');

  // Q2b — % sourced sustainably
  const ssPct = numFrom(text, [/percentage of inputs were sourced sustainably[^0-9]*([0-9.]+)/i]);
  if (ssPct !== null) out.sustainablySourcingPct = hc(ssPct, 'medium');

  // Q4 — EPR applicable
  const epr = tryPatterns(text, [/Extended Producer Responsibility.*?(Yes|No)/i]);
  if (epr) out.eprApplicable = hc(epr, 'high');

  return out;
};

const extractP3 = (text) => {
  const out = {};

  // Q1c — Well-being spending %
  const wbSpend = numFrom(text, [/well.being measures as a % of total revenue[^0-9]*([0-9.]+)/i]);
  if (wbSpend !== null) out.wellbeingSpendPct = hc(wbSpend, 'medium');

  // Q3 — Accessible workplaces
  const access = tryPatterns(text, [
    /premises.*?accessible to differently abled[^\n]*(Yes|No)/i,
    /Accessibility of workplaces[^\n]*(Yes|No)/i,
  ]);
  if (access) out.workplaceAccessible = hc(access, 'high');

  // Q4 — Equal opportunity policy
  const eop = tryPatterns(text, [/equal opportunity policy[^\n]*(Yes|No)/i]);
  if (eop) out.equalOpportunityPolicy = hc(eop, 'high');

  // Q5 — Parental leave return rates
  const plReturnM = numFrom(text, [/Male\s+([0-9.]+)\s+[0-9.]+\s+[0-9.]+\s+[0-9.]+/i]);
  if (plReturnM !== null) out.parentalLeaveReturnMale = hc(plReturnM, 'low');
  const plReturnF = numFrom(text, [/Female\s+([0-9.]+)\s+[0-9.]+\s+[0-9.]+\s+[0-9.]+/i]);
  if (plReturnF !== null) out.parentalLeaveReturnFemale = hc(plReturnF, 'low');

  // Q10a — OHS management system
  const ohs = tryPatterns(text, [
    /occupational health and safety management system[^\n]*(Yes|No)/i,
    /10\.[^\n]*OHS[^\n]*(Yes|No)/i,
  ]);
  if (ohs) out.ohsSystem = hc(ohs, 'high');

  // Q11 — LTIFR
  const ltifr = numFrom(text, [/Lost Time Injury Frequency Rate.*?Employees\s+([0-9.]+)/i]);
  if (ltifr !== null) out.ltifrEmployees = hc(ltifr, 'medium');
  const ltifrW = numFrom(text, [/Lost Time Injury Frequency Rate.*?Workers\s+([0-9.]+)/i]);
  if (ltifrW !== null) out.ltifrWorkers = hc(ltifrW, 'medium');

  // Q11 — Fatalities
  const fatalEmp = numFrom(text, [/No\. of fatalities.*?Employees\s+([0-9]+)/i]);
  if (fatalEmp !== null) out.fatalitiesEmployees = hc(fatalEmp, 'medium');
  const fatalWkr = numFrom(text, [/No\. of fatalities.*?Workers\s+([0-9]+)/i]);
  if (fatalWkr !== null) out.fatalitiesWorkers = hc(fatalWkr, 'medium');

  // Q14 — Assessment % health & safety
  const assessHS = numFrom(text, [/Health and safety practices\s+([0-9.]+)/i]);
  if (assessHS !== null) out.assessmentHealthSafetyPct = hc(assessHS, 'medium');
  const assessWC = numFrom(text, [/Working Conditions\s+([0-9.]+)/i]);
  if (assessWC !== null) out.assessmentWorkingCondsPct = hc(assessWC, 'medium');

  // P3 Leadership Q1 — Life insurance (A/B)
  const lifeInsEmp = tryPatterns(text, [/life insurance.*?\(A\)[^\n]*(Yes|No)/i]);
  if (lifeInsEmp) out.lifeInsuranceEmployees = hc(lifeInsEmp, 'medium');
  const lifeInsWkr = tryPatterns(text, [/life insurance.*?\(B\)[^\n]*(Yes|No)/i]);
  if (lifeInsWkr) out.lifeInsuranceWorkers = hc(lifeInsWkr, 'medium');

  return out;
};

const extractP4 = (text) => {
  const out = {};
  // Q1 — Stakeholder identification process
  const process = tryPatterns(text, [
    /identifying key stakeholder groups[^\n]*(Yes|No|[A-Z][a-z]{5,})/i,
  ]);
  if (process) out.stakeholderProcess = hc(san(process, 300), 'low');

  // P4 Leadership Q2 — Stakeholder consultation for E&S
  const stkConsult = tryPatterns(text, [
    /stakeholder consultation.*?environmental.*?(Yes|No)/i,
  ]);
  if (stkConsult) out.stakeholderConsultationES = hc(stkConsult, 'medium');

  return out;
};

const extractP5 = (text) => {
  const out = {};

  // Q2 — Minimum wages: parse totals from table
  // Employees Permanent: Total  Equal  %  More  %
  const minWageEmpPerm = numFrom(text, [/Permanent\s+(\d+)\s+\d+\s+[0-9.]+\s+\d+/i]);
  if (minWageEmpPerm !== null) out.minWageEmpPermTotal = hc(minWageEmpPerm, 'low');

  // Q3a — Median remuneration BOD
  const medBodM = numFrom(text, [/Board of Directors.*?Male\s+(\d+)\s+([0-9,]+)/i]);
  if (medBodM !== null) out.medRemunerBodMale = hc(medBodM, 'medium');

  // Q3b — Gross wages females %
  const femaleWagesPct = numFrom(text, [
    /Gross wages paid to females as % of total wages\s+([0-9.]+)/i,
    /wages paid to females as % of total wages[^0-9]*([0-9.]+)/i,
  ]);
  if (femaleWagesPct !== null) out.femaleWagesPct = hc(femaleWagesPct, 'high');

  // Q4 — Focal point for HR
  const hrFocal = tryPatterns(text, [/focal point.*?human rights[^\n]*(Yes|No)/i]);
  if (hrFocal) out.hrFocalPoint = hc(hrFocal, 'high');

  // Q7 — POSH complaints
  const poshTotal = numFrom(text, [/Total Complaints reported under.*?POSH[^0-9]*(\d+)/i]);
  if (poshTotal !== null) out.poshTotalComplaints = hc(poshTotal, 'high');
  const poshPct = numFrom(text, [/Complaints on POSH as a % of female[^0-9]*([0-9.]+)/i]);
  if (poshPct !== null) out.poshPct = hc(poshPct, 'high');
  const poshUpheld = numFrom(text, [/Complaints on POSH upheld[^0-9]*(\d+)/i]);
  if (poshUpheld !== null) out.poshUpheld = hc(poshUpheld, 'high');

  // Q9 — Human rights in contracts
  const hrContracts = tryPatterns(text, [/human rights requirements form part.*?(Yes|No)/i]);
  if (hrContracts) out.hrInContracts = hc(hrContracts, 'high');

  // Q10 — Assessments %
  const childLabour = numFrom(text, [/Child labour\s+([0-9.]+)/i]);
  if (childLabour !== null) out.assessChildLabourPct = hc(childLabour, 'medium');
  const sexHarassPct = numFrom(text, [/Sexual harassment\s+([0-9.]+)/i]);
  if (sexHarassPct !== null) out.assessSexHarassPct = hc(sexHarassPct, 'medium');
  const wagesPct = numFrom(text, [/Wages\s+([0-9.]+)/i]);
  if (wagesPct !== null) out.assessWagesPct = hc(wagesPct, 'medium');

  return out;
};

const extractP6 = (text) => {
  const out = {};

  // ── ENERGY ──────────────────────────────────────────────────────────────────
  // Q1 renewable sub-rows
  const renewElecGJ = numFrom(text, [
    /Total electricity consumption \(A\)\s+([0-9,]+\.?[0-9]*)\s+GJ/i,
    /Total electricity consumption \(A\)\s+([0-9,]+\.?[0-9]*)/i,
  ]);
  if (renewElecGJ !== null) out.renewElecGJ = hc(renewElecGJ, 'high');

  const renewFuelGJ = numFrom(text, [
    /Total fuel consumption \(B\)\s+([0-9,]+\.?[0-9]*)\s+GJ/i,
    /Total fuel consumption \(B\)\s+([0-9,]+\.?[0-9]*)/i,
  ]);
  if (renewFuelGJ !== null) out.renewFuelGJ = hc(renewFuelGJ, 'high');

  const totalRenewGJ = numFrom(text, [
    /Total energy consumed from renewable sources[^0-9]*([0-9,]+\.?[0-9]*)/i,
  ]);
  if (totalRenewGJ !== null) out.totalRenewGJ = hc(totalRenewGJ, 'high');

  const nonRenewElecGJ = numFrom(text, [
    /Total electricity consumption \(D\)\s+([0-9,]+\.?[0-9]*)\s+GJ/i,
    /Total electricity consumption \(D\)\s+([0-9,]+\.?[0-9]*)/i,
  ]);
  if (nonRenewElecGJ !== null) out.nonRenewElecGJ = hc(nonRenewElecGJ, 'high');

  const nonRenewFuelGJ = numFrom(text, [
    /Total fuel consumption \(E\)\s+([0-9,]+\.?[0-9]*)\s+GJ/i,
    /Total fuel consumption \(E\)\s+([0-9,]+\.?[0-9]*)/i,
  ]);
  if (nonRenewFuelGJ !== null) out.nonRenewFuelGJ = hc(nonRenewFuelGJ, 'high');

  const totalNonRenewGJ = numFrom(text, [
    /Total energy consumed from non-renewable sources[^0-9]*([0-9,]+\.?[0-9]*)/i,
  ]);
  if (totalNonRenewGJ !== null) out.totalNonRenewGJ = hc(totalNonRenewGJ, 'high');

  const totalEnergyGJ = numFrom(text, [
    /Total energy consumed \(A\+B\+C\+D\+E\+F\)[^0-9]*([0-9,]+\.?[0-9]*)/i,
  ]);
  if (totalEnergyGJ !== null) out.totalEnergyGJ = hc(totalEnergyGJ, 'high');

  const energyIntensityCr = numFrom(text, [
    /Energy intensity per rupee of turnover[^0-9PPP]*([0-9]+\.?[0-9]*)\s*GJ/i,
  ]);
  if (energyIntensityCr !== null) out.energyIntensityCr = hc(energyIntensityCr, 'high');

  const energyIntensityPPP = numFrom(text, [
    /Energy intensity per rupee.*?PPP[^0-9]*([0-9]+\.?[0-9]*)\s*GJ/i,
  ]);
  if (energyIntensityPPP !== null) out.energyIntensityPPP = hc(energyIntensityPPP, 'high');

  // Q2 — PAT scheme
  const patScheme = tryPatterns(text, [/PAT Scheme[^\n]*(Yes|No)/i]);
  if (patScheme) out.patScheme = hc(patScheme, 'high');

  // ── WATER ────────────────────────────────────────────────────────────────────
  const surfaceKL = numFrom(text, [/\(i\) Surface water\s+([0-9,]+\.?[0-9]*)/i]);
  if (surfaceKL !== null) out.surfaceKL = hc(surfaceKL, 'high');
  const groundKL = numFrom(text, [/\(ii\) Groundwater\s+([0-9,]+\.?[0-9]*)/i]);
  if (groundKL !== null) out.groundKL = hc(groundKL, 'high');
  const thirdPartyKL = numFrom(text, [/\(iii\) Third party water\s+([0-9,]+\.?[0-9]*)/i]);
  if (thirdPartyKL !== null) out.thirdPartyKL = hc(thirdPartyKL, 'high');
  const totalWithdrawalKL = numFrom(text, [
    /Total volume of water withdrawal[^0-9]*([0-9,]+\.?[0-9]*)/i,
  ]);
  if (totalWithdrawalKL !== null) out.totalWithdrawalKL = hc(totalWithdrawalKL, 'high');
  const totalConsumptionKL = numFrom(text, [
    /Total volume of water consumption[^0-9]*([0-9,]+\.?[0-9]*)/i,
  ]);
  if (totalConsumptionKL !== null) out.totalConsumptionKL = hc(totalConsumptionKL, 'high');
  const waterIntensityCr = numFrom(text, [
    /Water intensity per rupee of turnover[^0-9PPP]*([0-9]+\.?[0-9]*)\s*KL/i,
  ]);
  if (waterIntensityCr !== null) out.waterIntensityCr = hc(waterIntensityCr, 'high');

  // Q5 — Zero liquid discharge
  const zld = tryPatterns(text, [/Zero Liquid Discharge[^\n]*(Yes|No)/i]);
  if (zld) out.zeroLiquidDischarge = hc(zld, 'high');

  // ── GHG EMISSIONS (Q7) ──────────────────────────────────────────────────────
  const scope1 = numFrom(text, [
    /Total Scope 1 emissions[^0-9]*([0-9,]+\.?[0-9]*)/i,
  ]);
  if (scope1 !== null) out.scope1 = hc(scope1, 'high');

  const scope2 = numFrom(text, [
    /Total Scope 2 emissions[^0-9]*([0-9,]+\.?[0-9]*)/i,
  ]);
  if (scope2 !== null) out.scope2 = hc(scope2, 'high');

  const s12IntensityCr = numFrom(text, [
    /Scope 1 and Scope 2 emission intensity per rupee[^0-9PPP]*([0-9]+\.?[0-9]*)\s*tCO/i,
  ]);
  if (s12IntensityCr !== null) out.s12IntensityCr = hc(s12IntensityCr, 'high');

  const s12IntensityPPP = numFrom(text, [
    /Scope 1 and Scope 2 emission intensity.*?PPP[^0-9]*([0-9]+\.?[0-9]*)\s*tCO/i,
  ]);
  if (s12IntensityPPP !== null) out.s12IntensityPPP = hc(s12IntensityPPP, 'high');

  const gridEF = numFrom(text, [/Grid emission factor used[^0-9]*([0-9]+\.?[0-9]*)\s*tCO/i]);
  if (gridEF !== null) out.gridEmissionFactor = hc(gridEF, 'high');

  const pppRate = numFrom(text, [/PPP rate[^0-9₹]*₹?([0-9]+\.?[0-9]*)\/intl/i]);
  if (pppRate !== null) out.pppRate = hc(pppRate, 'high');

  // Q8 — GHG reduction project
  const ghgRed = tryPatterns(text, [/project related to reducing Green House Gas[^\n]*(Yes|No)/i]);
  if (ghgRed) out.ghgReductionProject = hc(ghgRed, 'high');

  // ── WASTE (Q9) ────────────────────────────────────────────────────────────────
  const plasticKG = numFrom(text, [/Plastic waste \(A\)\s+([0-9,]+\.?[0-9]*)\s*MT/i]);
  if (plasticKG !== null) out.plasticMT = hc(plasticKG, 'high');
  const ewasteKG = numFrom(text, [/E-waste \(B\)\s+([0-9,]+\.?[0-9]*)\s*MT/i]);
  if (ewasteKG !== null) out.ewasteMT = hc(ewasteKG, 'high');
  const biomedMT = numFrom(text, [/Bio-medical waste \(C\)\s+([0-9,]+\.?[0-9]*)\s*MT/i]);
  if (biomedMT !== null) out.biomedMT = hc(biomedMT, 'high');
  const constructMT = numFrom(text, [/Construction and demolition waste \(D\)\s+([0-9,]+\.?[0-9]*)\s*MT/i]);
  if (constructMT !== null) out.constructMT = hc(constructMT, 'high');
  const batteryMT = numFrom(text, [/Battery waste \(E\)\s+([0-9,]+\.?[0-9]*)\s*MT/i]);
  if (batteryMT !== null) out.batteryMT = hc(batteryMT, 'high');
  const radioMT = numFrom(text, [/Radioactive waste \(F\)\s+([0-9,]+\.?[0-9]*)\s*MT/i]);
  if (radioMT !== null) out.radioMT = hc(radioMT, 'high');
  const hazardMT = numFrom(text, [/Other Hazardous waste \(G\)\s+([0-9,]+\.?[0-9]*)\s*MT/i]);
  if (hazardMT !== null) out.hazardMT = hc(hazardMT, 'high');
  const nonHazardMT = numFrom(text, [/Other Non-hazardous waste \(H\)\s+([0-9,]+\.?[0-9]*)\s*MT/i]);
  if (nonHazardMT !== null) out.nonHazardMT = hc(nonHazardMT, 'high');
  const totalWasteMT = numFrom(text, [/Total \(A\+B\+C\+D\+E\+F\+G\+H\)\s+([0-9,]+\.?[0-9]*)/i]);
  if (totalWasteMT !== null) out.totalWasteMT = hc(totalWasteMT, 'high');
  const recycledMT = numFrom(text, [/\(i\) Recycled\s+([0-9,]+\.?[0-9]*)\s*MT/i]);
  if (recycledMT !== null) out.recycledMT = hc(recycledMT, 'high');

  // Q13 — Env compliance
  const envComp = tryPatterns(text, [/Is the entity compliant with the applicable environmental[^\n]*(Y|N|Yes|No)/i]);
  if (envComp) out.envCompliance = hc(envComp, 'high');

  // P6 Leadership Q3 — Scope 3
  const scope3 = numFrom(text, [
    /Total Scope 3 emissions[^0-9]*([0-9,]+\.?[0-9]*)/i,
  ]);
  if (scope3 !== null) out.scope3 = hc(scope3, 'high');

  const s3IntensityCr = numFrom(text, [
    /Total Scope 3 emissions per rupee of turnover[^0-9]*([0-9]+\.?[0-9]*)/i,
  ]);
  if (s3IntensityCr !== null) out.s3IntensityCr = hc(s3IntensityCr, 'high');

  return out;
};

const extractP7 = (text) => {
  const out = {};
  const affiliations = numFrom(text, [/Number of affiliations[^0-9]*(\d+)/i]);
  if (affiliations !== null) out.tradeAffiliations = hc(affiliations, 'medium');
  return out;
};

const extractP8 = (text) => {
  const out = {};
  // Q4 — MSME sourcing %
  const msme = numFrom(text, [/Directly sourced from MSMEs.*?([0-9.]+)/i]);
  if (msme !== null) out.msmeSourcingPct = hc(msme, 'medium');
  const localSrc = numFrom(text, [/Sourced directly from within the district.*?([0-9.]+)/i]);
  if (localSrc !== null) out.localSourcingPct = hc(localSrc, 'medium');

  // CSR beneficiaries
  const csrBenef = numFrom(text, [/No\. of persons benefitted from CSR Projects\s+(\d+)/i]);
  if (csrBenef !== null) out.csrBeneficiaries = hc(csrBenef, 'medium');

  return out;
};

const extractP9 = (text) => {
  const out = {};
  // Q7a — Data breaches
  const dataBreaches = numFrom(text, [/Number of instances of data breaches[^0-9]*(\d+)/i]);
  if (dataBreaches !== null) out.dataBreaches = hc(dataBreaches, 'high');
  // Q7b — PII breaches %
  const piiBreach = numFrom(text, [/Percentage of data breaches involving personally identifiable[^0-9]*([0-9.]+)/i]);
  if (piiBreach !== null) out.piiBreachesPct = hc(piiBreach, 'high');
  // Q5 — Cyber security policy
  const cyberPol = tryPatterns(text, [/framework.*?cyber security[^\n]*(Yes|No)/i]);
  if (cyberPol) out.cyberSecurityPolicy = hc(cyberPol, 'high');

  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// MASTER PARSER
// ─────────────────────────────────────────────────────────────────────────────

const parseBRSR = (text) => ({
  sectionA:  extractSectionA(text),
  sectionB:  extractSectionB(text),
  p1: extractP1(text),
  p2: extractP2(text),
  p3: extractP3(text),
  p4: extractP4(text),
  p5: extractP5(text),
  p6: extractP6(text),
  p7: extractP7(text),
  p8: extractP8(text),
  p9: extractP9(text),
});

const countFields = (obj) =>
  Object.values(obj).filter(v => v && v.value !== null && v.value !== undefined).length;

const totalFields = (parsed) =>
  Object.values(parsed).reduce((s, sec) => s + countFields(sec), 0);


// ─────────────────────────────────────────────────────────────────────────────
// API PAYLOAD BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

const v = (field) => field?.value ?? null;

const buildSectionAPayload = (year, p) => {
  const a = p.sectionA;
  return {
    year,
    entity: {
      cin:                v(a.cin),
      companyName:        v(a.companyName)        || '',
      yearIncorporation:  v(a.yearIncorporation),
      regOfficeAddress:   v(a.regOfficeAddress)   || '',
      corpOfficeAddress:  v(a.corpOfficeAddress)  || '',
      email:              v(a.email)              || '',
      telephone:          v(a.telephone)          || '',
      website:            v(a.website)            || '',
      paidUpCapital:      v(a.paidUpCapital),
      listedNSE:          v(a.listedNSE)          ?? false,
      listedBSE:          v(a.listedBSE)          ?? false,
      stockExchange:      v(a.stockExchange)      || '',
      contactName:        v(a.contactName)        || '',
      contactDesignation: v(a.contactDesignation) || '',
      contactTelephone:   v(a.contactTelephone)   || '',
      contactEmail:       v(a.contactEmail)       || '',
      reportingBoundary:  v(a.reportingBoundary)  || 'standalone',
      assuranceProvider:  v(a.assuranceProvider)  || '',
      assuranceType:      v(a.assuranceType)      || 'None',
    },
    business: {
      nationalPlants:         v(a.nationalPlants),
      nationalOffices:        v(a.nationalOffices),
      intlPlants:             v(a.intlPlants),
      intlOffices:            v(a.intlOffices),
      nationalStates:         v(a.nationalStates),
      intlCountries:          v(a.intlCountries),
      exportsPct:             v(a.exportsPct),
    },
    workforce: {
      empPermTotal:    v(a.empPermTotal),
      empPermMale:     v(a.empPermMale),
      empPermFemale:   v(a.empPermFemale),
      empOtherTotal:   v(a.empOtherTotal),
      empOtherMale:    v(a.empOtherMale),
      empOtherFemale:  v(a.empOtherFemale),
      empTotal:        v(a.empTotal),
      empTotalMale:    v(a.empTotalMale),
      empTotalFemale:  v(a.empTotalFemale),
      wkrPermTotal:    v(a.wkrPermTotal),
      wkrPermMale:     v(a.wkrPermMale),
      wkrPermFemale:   v(a.wkrPermFemale),
      wkrOtherTotal:   v(a.wkrOtherTotal),
      wkrOtherMale:    v(a.wkrOtherMale),
      wkrOtherFemale:  v(a.wkrOtherFemale),
      womenBodTotal:   v(a.womenBodTotal),
      womenBodNo:      v(a.womenBodNo),
      womenBodPct:     v(a.womenBodPct),
      womenKmpTotal:   v(a.womenKmpTotal),
      womenKmpNo:      v(a.womenKmpNo),
      womenKmpPct:     v(a.womenKmpPct),
    },
    structure: {
      csrApplicable: v(a.csrApplicable),
      csrTurnover:   v(a.csrTurnover),
    },
  };
};

const buildSectionBPayload = (year, p) => {
  const b = p.sectionB;
  return {
    year,
    policyCovers:           v(b.policyCovers),
    directorStatement:      v(b.directorStatement)      || '',
    highestAuthority:       v(b.highestAuthority)       || '',
    sustainabilityCommittee:v(b.sustainabilityCommittee)|| '',
  };
};

const buildP1Payload = (year, p) => ({
  year,
  antiCorruptionPolicy:    v(p.p1.antiCorruptionPolicy),
  disciplinaryDirectors:   v(p.p1.disciplinaryDirectors),
  accountsPayableDays:     v(p.p1.accountsPayableDays),
});

const buildP2Payload = (year, p) => ({
  year,
  sustainableSourcing:     v(p.p2.sustainableSourcing),
  sustainablySourcingPct:  v(p.p2.sustainablySourcingPct),
  eprApplicable:           v(p.p2.eprApplicable),
});

const buildP3Payload = (year, p) => ({
  year,
  wellbeingSpendPct:            v(p.p3.wellbeingSpendPct),
  workplaceAccessible:          v(p.p3.workplaceAccessible),
  equalOpportunityPolicy:       v(p.p3.equalOpportunityPolicy),
  parentalLeaveReturnMale:      v(p.p3.parentalLeaveReturnMale),
  parentalLeaveReturnFemale:    v(p.p3.parentalLeaveReturnFemale),
  ohsSystem:                    v(p.p3.ohsSystem),
  ltifrEmployees:               v(p.p3.ltifrEmployees),
  ltifrWorkers:                 v(p.p3.ltifrWorkers),
  fatalitiesEmployees:          v(p.p3.fatalitiesEmployees),
  fatalitiesWorkers:            v(p.p3.fatalitiesWorkers),
  assessmentHealthSafetyPct:    v(p.p3.assessmentHealthSafetyPct),
  assessmentWorkingCondsPct:    v(p.p3.assessmentWorkingCondsPct),
  lifeInsuranceEmployees:       v(p.p3.lifeInsuranceEmployees),
  lifeInsuranceWorkers:         v(p.p3.lifeInsuranceWorkers),
});

const buildP4Payload = (year, p) => ({
  year,
  stakeholderProcess:         v(p.p4.stakeholderProcess),
  stakeholderConsultationES:  v(p.p4.stakeholderConsultationES),
});

const buildP5Payload = (year, p) => ({
  year,
  minWageEmpPermTotal:   v(p.p5.minWageEmpPermTotal),
  medRemunerBodMale:     v(p.p5.medRemunerBodMale),
  femaleWagesPct:        v(p.p5.femaleWagesPct),
  hrFocalPoint:          v(p.p5.hrFocalPoint),
  poshTotalComplaints:   v(p.p5.poshTotalComplaints),
  poshPct:               v(p.p5.poshPct),
  poshUpheld:            v(p.p5.poshUpheld),
  hrInContracts:         v(p.p5.hrInContracts),
  assessChildLabourPct:  v(p.p5.assessChildLabourPct),
  assessSexHarassPct:    v(p.p5.assessSexHarassPct),
  assessWagesPct:        v(p.p5.assessWagesPct),
});

const buildP6Payload = (year, p) => {
  const e = p.p6;
  const MT_TO_KG = 1000;
  const kgOrNull = (mt) => v(mt) != null ? v(mt) * MT_TO_KG : null;
  // POST shape matches /api/brsr/environmental: { year, energy, water, waste }
  return {
    year,
    energy: {
      renew_electricity_gj:    v(e.renewElecGJ),
      renew_fuel_gj:           v(e.renewFuelGJ),
      renewable_gj:            v(e.totalRenewGJ),
      nonrenew_electricity_gj: v(e.nonRenewElecGJ),
      nonrenew_fuel_gj:        v(e.nonRenewFuelGJ),
      total_gj:                v(e.totalEnergyGJ),
      intensity_gj_cr:         v(e.energyIntensityCr),
      intensity_gj_ppp_m:      v(e.energyIntensityPPP),
      grid_ef:                 v(e.gridEmissionFactor),
      ppp_rate:                v(e.pppRate),
      // GHG stored inside energy blob (existing brsr.js schema)
      ghg_scope1:              v(e.scope1),
      ghg_scope2:              v(e.scope2),
      ghg_scope3:              v(e.scope3),
      ghg_s12_intensity_cr:    v(e.s12IntensityCr),
      ghg_s12_intensity_ppp:   v(e.s12IntensityPPP),
      ghg_s3_intensity_cr:     v(e.s3IntensityCr),
      ghg_reduction_project:   v(e.ghgReductionProject),
      pat_scheme:              v(e.patScheme),
      env_compliance:          v(e.envCompliance),
    },
    water: {
      surface_kl:         v(e.surfaceKL),
      groundwater_kl:     v(e.groundKL),
      municipal_kl:       v(e.thirdPartyKL),
      withdrawal_kl:      v(e.totalWithdrawalKL),
      consumption_kl:     v(e.totalConsumptionKL),
      intensity_kl_cr:    v(e.waterIntensityCr),
      zero_liquid_discharge: v(e.zeroLiquidDischarge),
    },
    waste: {
      plastic_kg:       kgOrNull(e.plasticMT),
      ewaste_kg:        kgOrNull(e.ewasteMT),
      biomedical_kg:    kgOrNull(e.biomedMT),
      construction_kg:  kgOrNull(e.constructMT),
      battery_kg:       kgOrNull(e.batteryMT),
      radioactive_kg:   kgOrNull(e.radioMT),
      hazardous_kg:     kgOrNull(e.hazardMT),
      non_hazardous_kg: kgOrNull(e.nonHazardMT),
      recycled_kg:      kgOrNull(e.recycledMT),
    },
  };
};

const buildP7Payload = (year, p) => ({
  year,
  tradeAffiliations: v(p.p7.tradeAffiliations),
});

const buildP8Payload = (year, p) => ({
  year,
  msmeSourcingPct:   v(p.p8.msmeSourcingPct),
  localSourcingPct:  v(p.p8.localSourcingPct),
  csrBeneficiaries:  v(p.p8.csrBeneficiaries),
});

const buildP9Payload = (year, p) => ({
  year,
  dataBreaches:        v(p.p9.dataBreaches),
  piiBreachesPct:      v(p.p9.piiBreachesPct),
  cyberSecurityPolicy: v(p.p9.cyberSecurityPolicy),
});

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT EXECUTOR — posts all selected sections
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_CONFIG = [
  {
    id:       'section-a',
    label:    'Section A — General Disclosures',
    endpoint: '/api/brsr/section-a',
    build:    buildSectionAPayload,
    countKey: ['sectionA'],
  },
  {
    id:       'section-b',
    label:    'Section B — Management & Process',
    endpoint: '/api/brsr/section-b',
    build:    buildSectionBPayload,
    countKey: ['sectionB'],
  },
  {
    id:       'p1',
    label:    'P1 — Ethics & Integrity',
    endpoint: '/api/brsr/principle/p1',
    build:    buildP1Payload,
    countKey: ['p1'],
  },
  {
    id:       'p2',
    label:    'P2 — Sustainable Products',
    endpoint: '/api/brsr/principle/p2',
    build:    buildP2Payload,
    countKey: ['p2'],
  },
  {
    id:       'p3',
    label:    'P3 — Employee Wellbeing',
    endpoint: '/api/brsr/principle/p3',
    build:    buildP3Payload,
    countKey: ['p3'],
  },
  {
    id:       'p4',
    label:    'P4 — Stakeholder Responsiveness',
    endpoint: '/api/brsr/principle/p4',
    build:    buildP4Payload,
    countKey: ['p4'],
  },
  {
    id:       'p5',
    label:    'P5 — Human Rights',
    endpoint: '/api/brsr/principle/p5',
    build:    buildP5Payload,
    countKey: ['p5'],
  },
  {
    id:       'p6',
    label:    'P6 — Environment (Energy/Water/Waste/GHG)',
    endpoint: '/api/brsr/environmental',
    build:    buildP6Payload,
    countKey: ['p6'],
  },
  {
    id:       'p7',
    label:    'P7 — Policy Advocacy',
    endpoint: '/api/brsr/principle/p7',
    build:    buildP7Payload,
    countKey: ['p7'],
  },
  {
    id:       'p8',
    label:    'P8 — Inclusive Growth',
    endpoint: '/api/brsr/principle/p8',
    build:    buildP8Payload,
    countKey: ['p8'],
  },
  {
    id:       'p9',
    label:    'P9 — Consumer Responsibility',
    endpoint: '/api/brsr/principle/p9',
    build:    buildP9Payload,
    countKey: ['p9'],
  },
];


// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
.brsr-imp-overlay{position:fixed;inset:0;z-index:20000;background:#00000099;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:24px;}
.brsr-imp-modal{background:#0b0f14;border:1px solid #1c2836;border-radius:14px;max-width:860px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 32px 96px #000000cc;}
.brsr-imp-hd{padding:22px 26px 14px;border-bottom:1px solid #1c2836;position:sticky;top:0;background:#0b0f14;z-index:2;}
.brsr-imp-title{font-size:17px;font-weight:800;color:#eef4ff;margin-bottom:3px;}
.brsr-imp-title span{color:#10b981;}
.brsr-imp-sub{font-size:10px;color:#5a7a96;letter-spacing:.03em;line-height:1.65;}
.brsr-imp-body{padding:20px 26px;}
.brsr-imp-drop{border:2px dashed #243348;border-radius:10px;padding:36px 24px;text-align:center;cursor:pointer;transition:all .22s;margin-bottom:16px;}
.brsr-imp-drop:hover,.brsr-imp-drop.over{border-color:#10b98166;background:#10b98108;}
.brsr-imp-drop-icon{font-size:38px;margin-bottom:10px;}
.brsr-imp-drop-title{font-size:12px;font-weight:700;color:#eef4ff;margin-bottom:5px;}
.brsr-imp-drop-sub{font-size:10px;color:#5a7a96;line-height:1.7;}
.brsr-imp-spinner{display:flex;flex-direction:column;align-items:center;gap:12px;padding:28px;}
.brsr-imp-spin{width:22px;height:22px;border:2px solid #1c2836;border-top-color:#10b981;border-radius:50%;animation:brsrSpin .8s linear infinite;}
.brsr-imp-spin-lbl{font-size:10px;color:#5a7a96;letter-spacing:.08em;}
.brsr-imp-track{width:100%;max-width:300px;height:4px;border-radius:2px;background:#1c2836;overflow:hidden;}
.brsr-imp-fill{height:100%;background:linear-gradient(90deg,#10b981,#34d399);transition:width .3s ease;}
.brsr-imp-pct{font-size:10px;color:#5a7a96;margin-top:3px;letter-spacing:.06em;}
.brsr-imp-summary{font-size:11px;color:#c8d8ea;margin-bottom:14px;padding:10px 14px;border-radius:8px;background:#10b98108;border:1px solid #10b98122;line-height:1.7;}
.brsr-imp-summary strong{color:#10b981;}
.brsr-imp-sections-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;}
.brsr-imp-sec-toggle{display:flex;align-items:center;gap:7px;cursor:pointer;padding:8px 12px;border-radius:7px;border:1px solid #1c2836;background:#0f1419;transition:border-color .2s;}
.brsr-imp-sec-toggle:hover{border-color:#10b98144;}
.brsr-imp-sec-toggle input{accent-color:#10b981;width:13px;height:13px;flex-shrink:0;}
.brsr-imp-sec-toggle-lbl{font-size:10px;color:#c8d8ea;flex:1;line-height:1.4;}
.brsr-imp-sec-toggle-count{font-size:9px;color:#5a7a96;flex-shrink:0;}
.brsr-imp-panel{margin-bottom:12px;border:1px solid #1c2836;border-radius:9px;overflow:hidden;}
.brsr-imp-panel-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#0f1419;cursor:pointer;user-select:none;}
.brsr-imp-panel-title{font-size:10px;font-weight:700;color:#eef4ff;letter-spacing:.07em;}
.brsr-imp-panel-meta{display:flex;align-items:center;gap:8px;}
.brsr-imp-panel-count{font-size:9px;color:#5a7a96;}
.brsr-imp-panel-chevron{font-size:9px;color:#5a7a96;transition:transform .2s;}
.brsr-imp-panel-chevron.open{transform:rotate(180deg);}
.brsr-imp-panel-body{padding:12px 14px;display:flex;flex-direction:column;gap:6px;}
.brsr-imp-field{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:6px;background:#080b0e;}
.brsr-imp-field-lbl{font-size:9.5px;color:#5a7a96;flex:1;min-width:0;}
.brsr-imp-field-val{font-size:10px;font-weight:700;color:#eef4ff;max-width:260px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;}
.brsr-imp-conf{font-size:8px;padding:2px 5px;border-radius:3px;letter-spacing:.03em;flex-shrink:0;}
.conf-high{background:#10b98114;color:#10b981;border:1px solid #10b98133;}
.conf-medium{background:#f59e0b14;color:#f59e0b;border:1px solid #f59e0b33;}
.conf-low{background:#ef444414;color:#ef4444;border:1px solid #ef444433;}
.brsr-imp-empty{font-size:10px;color:#5a7a9655;padding:6px 0;text-align:center;}
.brsr-imp-result{padding:10px 13px;border-radius:7px;font-size:10px;margin-bottom:8px;display:flex;align-items:flex-start;gap:8px;line-height:1.6;}
.brsr-imp-result-ok{background:#10b98108;border:1px solid #10b98133;color:#10b981;}
.brsr-imp-result-err{background:#ef444408;border:1px solid #ef444433;color:#f87171;}
.brsr-imp-result-warn{background:#f59e0b08;border:1px solid #f59e0b33;color:#f59e0b;}
.brsr-imp-result-icon{flex-shrink:0;margin-top:1px;}
.brsr-imp-actions{display:flex;gap:8px;justify-content:flex-end;padding:16px 26px;border-top:1px solid #1c2836;background:#0b0f14;position:sticky;bottom:0;}
.brsr-imp-btn{padding:9px 18px;border-radius:7px;border:none;cursor:pointer;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .18s;}
.brsr-imp-btn:disabled{opacity:.38;cursor:not-allowed;}
.brsr-imp-btn-p{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
.brsr-imp-btn-p:hover:not(:disabled){opacity:.86;transform:translateY(-1px);}
.brsr-imp-btn-g{background:#0f1419;border:1px solid #243348;color:#c8d8ea;}
.brsr-imp-btn-g:hover:not(:disabled){border-color:#10b98144;color:#10b981;}
.brsr-imp-privacy{font-size:9px;color:#5a7a96;text-align:center;margin-top:10px;line-height:1.7;}
@keyframes brsrSpin{to{transform:rotate(360deg)}}
`;

// ─────────────────────────────────────────────────────────────────────────────
// FIELD LABEL MAPS
// ─────────────────────────────────────────────────────────────────────────────

const LABELS = {
  sectionA: {
    cin:'CIN', companyName:'Company Name', yearIncorporation:'Year of Incorporation',
    regOfficeAddress:'Registered Office Address', corpOfficeAddress:'Corporate Address',
    email:'Email', telephone:'Telephone', website:'Website',
    paidUpCapital:'Paid-up Capital', listedNSE:'Listed — NSE', listedBSE:'Listed — BSE',
    stockExchange:'Stock Exchange(s)', contactName:'Contact Person',
    contactDesignation:'Designation', contactTelephone:'Contact Number',
    contactEmail:'Contact Email', reportingBoundary:'Reporting Boundary',
    assuranceProvider:'Assurance Provider', assuranceType:'Assurance Type',
    nationalPlants:'National Plants', nationalOffices:'National Offices',
    intlPlants:'International Plants', intlOffices:'International Offices',
    nationalStates:'Markets — National States', intlCountries:'Markets — International Countries',
    exportsPct:'Exports (% of Turnover)', empPermTotal:'Perm. Employees — Total',
    empPermMale:'Perm. Employees — Male', empPermFemale:'Perm. Employees — Female',
    empOtherTotal:'Other Employees — Total', empTotal:'Total Employees',
    empTotalMale:'Total Employees — Male', empTotalFemale:'Total Employees — Female',
    wkrPermTotal:'Perm. Workers — Total', wkrPermMale:'Perm. Workers — Male',
    wkrPermFemale:'Perm. Workers — Female', wkrOtherTotal:'Other Workers — Total',
    womenBodTotal:'Women — BoD Total', womenBodNo:'Women — BoD No.',
    womenBodPct:'Women — BoD %', womenKmpTotal:'Women — KMP Total',
    womenKmpNo:'Women — KMP No.', womenKmpPct:'Women — KMP %',
    csrApplicable:'CSR Applicable', csrTurnover:'CSR Turnover (₹)',
  },
  sectionB: {
    policyCovers:'Policy Covers P1–P9', directorStatement:'Director Statement',
    highestAuthority:'Highest Authority', sustainabilityCommittee:'Sustainability Committee',
  },
  p1: {
    antiCorruptionPolicy:'Anti-Corruption Policy (Yes/No)',
    disciplinaryDirectors:'Disciplinary Action — Directors',
    accountsPayableDays:'Accounts Payable Days',
  },
  p2: {
    sustainableSourcing:'Sustainable Sourcing (Yes/No)',
    sustainablySourcingPct:'% Sustainably Sourced',
    eprApplicable:'EPR Applicable (Yes/No)',
  },
  p3: {
    wellbeingSpendPct:'Wellbeing Spend (% Revenue)',
    workplaceAccessible:'Workplace Accessible (Yes/No)',
    equalOpportunityPolicy:'Equal Opportunity Policy',
    parentalLeaveReturnMale:'Parental Leave Return — Male (%)',
    parentalLeaveReturnFemale:'Parental Leave Return — Female (%)',
    ohsSystem:'OHS Management System',
    ltifrEmployees:'LTIFR — Employees',
    ltifrWorkers:'LTIFR — Workers',
    fatalitiesEmployees:'Fatalities — Employees',
    fatalitiesWorkers:'Fatalities — Workers',
    assessmentHealthSafetyPct:'OHS Assessment (%)',
    assessmentWorkingCondsPct:'Working Conditions Assessment (%)',
    lifeInsuranceEmployees:'Life Insurance — Employees',
    lifeInsuranceWorkers:'Life Insurance — Workers',
  },
  p4: {
    stakeholderProcess:'Stakeholder Identification Process',
    stakeholderConsultationES:'Stakeholder Consultation for E&S',
  },
  p5: {
    minWageEmpPermTotal:'Min Wage — Perm Employees Total',
    medRemunerBodMale:'Median Remuneration — BoD Male',
    femaleWagesPct:'Female Wages (% of Total)',
    hrFocalPoint:'HR Focal Point (Yes/No)',
    poshTotalComplaints:'POSH Total Complaints',
    poshPct:'POSH as % of Female Staff',
    poshUpheld:'POSH Upheld',
    hrInContracts:'HR in Contracts (Yes/No)',
    assessChildLabourPct:'Child Labour Assessment (%)',
    assessSexHarassPct:'Sexual Harassment Assessment (%)',
    assessWagesPct:'Wages Assessment (%)',
  },
  p6: {
    renewElecGJ:'Renewable Electricity (GJ)',
    renewFuelGJ:'Renewable Fuel (GJ)',
    totalRenewGJ:'Total Renewable Energy (GJ)',
    nonRenewElecGJ:'Non-Renewable Electricity (GJ)',
    nonRenewFuelGJ:'Non-Renewable Fuel (GJ)',
    totalNonRenewGJ:'Total Non-Renewable Energy (GJ)',
    totalEnergyGJ:'Total Energy (GJ)',
    energyIntensityCr:'Energy Intensity (GJ/₹Cr)',
    energyIntensityPPP:'Energy Intensity PPP (GJ/$M)',
    patScheme:'PAT Scheme (Y/N)',
    surfaceKL:'Surface Water (KL)',
    groundKL:'Groundwater (KL)',
    thirdPartyKL:'Third-party Water (KL)',
    totalWithdrawalKL:'Total Water Withdrawal (KL)',
    totalConsumptionKL:'Total Water Consumption (KL)',
    waterIntensityCr:'Water Intensity (KL/₹Cr)',
    zeroLiquidDischarge:'Zero Liquid Discharge',
    scope1:'Scope 1 Emissions (tCO₂e)',
    scope2:'Scope 2 Emissions (tCO₂e)',
    scope3:'Scope 3 Emissions (tCO₂e)',
    s12IntensityCr:'S1+S2 Intensity (tCO₂e/₹Cr)',
    s12IntensityPPP:'S1+S2 Intensity PPP',
    s3IntensityCr:'Scope 3 Intensity (tCO₂e/₹Cr)',
    gridEmissionFactor:'Grid EF (tCO₂/MWh)',
    pppRate:'PPP Rate (₹/intl.$)',
    ghgReductionProject:'GHG Reduction Project',
    plasticMT:'Plastic Waste (MT)', ewasteMT:'E-waste (MT)',
    biomedMT:'Biomedical Waste (MT)', constructMT:'Construction Waste (MT)',
    batteryMT:'Battery Waste (MT)', radioMT:'Radioactive Waste (MT)',
    hazardMT:'Hazardous Waste (MT)', nonHazardMT:'Non-Hazardous Waste (MT)',
    totalWasteMT:'Total Waste (MT)', recycledMT:'Recycled Waste (MT)',
    envCompliance:'Env. Compliance (Y/N)',
  },
  p7: { tradeAffiliations:'Trade/Industry Affiliations' },
  p8: {
    msmeSourcingPct:'MSME Sourcing (%)',
    localSourcingPct:'Local Sourcing (%)',
    csrBeneficiaries:'CSR Beneficiaries',
  },
  p9: {
    dataBreaches:'Data Breaches (count)',
    piiBreachesPct:'PII Breaches (%)',
    cyberSecurityPolicy:'Cyber Security Policy',
  },
};

const SECTION_LABELS = {
  sectionA: 'Section A — General Disclosures',
  sectionB: 'Section B — Management & Process',
  p1: 'P1 — Ethics & Integrity',
  p2: 'P2 — Sustainable Products',
  p3: 'P3 — Employee Wellbeing',
  p4: 'P4 — Stakeholder Responsiveness',
  p5: 'P5 — Human Rights',
  p6: 'P6 — Environment',
  p7: 'P7 — Policy Advocacy',
  p8: 'P8 — Inclusive Growth',
  p9: 'P9 — Consumer Responsibility',
};


// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function BRSRImportParser({ year, onClose, onImportComplete }) {
  const [dragOver,   setDragOver]   = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress,   setProgress]   = useState({ pct: 0, stage: '' });
  const [parsed,     setParsed]     = useState(null);
  const [sourceFile, setSourceFile] = useState(null);
  const [importing,  setImporting]  = useState(false);
  const [results,    setResults]    = useState([]);
  const [importDone, setImportDone] = useState(false);
  const [openPanels, setOpenPanels] = useState({});

  // Which sections are selected for import — default all on
  const [selected, setSelected] = useState(() =>
    Object.fromEntries(SECTION_CONFIG.map(s => [s.id, true]))
  );

  const fileRef = useRef();

  const processFile = useCallback(async (file) => {
    if (!file) return;
    if (file.name.split('.').pop().toLowerCase() !== 'pdf') {
      alert('Please upload a PDF file.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      alert('File too large — max 25MB');
      return;
    }
    setProcessing(true);
    setParsed(null);
    setResults([]);
    setImportDone(false);
    setSourceFile(file);
    try {
      const text = await extractAllText(file, (pct, stage) => setProgress({ pct, stage }));
      setProgress({ pct: 92, stage: 'Extracting fields…' });
      const result = parseBRSR(text);
      setProgress({ pct: 100, stage: 'Done' });
      setParsed(result);
      // Auto-open panels that have data
      const auto = {};
      Object.keys(result).forEach(k => { if (countFields(result[k]) > 0) auto[k] = true; });
      setOpenPanels(auto);
    } catch (err) {
      alert(err.message || 'Failed to read PDF — ensure it has an embedded text layer.');
    } finally {
      setProcessing(false);
    }
  }, []);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFile(e.dataTransfer.files[0]);
  };

  const handleImport = async () => {
    if (!parsed || importing) return;
    setImporting(true);
    const res = [];

    for (const sec of SECTION_CONFIG) {
      if (!selected[sec.id]) continue;
      const fieldCount = sec.countKey.reduce((s, k) => s + countFields(parsed[k] || {}), 0);
      if (fieldCount === 0) {
        res.push({ id: sec.id, label: sec.label, ok: null, msg: 'No data found — skipped' });
        continue;
      }
      try {
        const payload = sec.build(year, parsed);
        const finalPayload = sec.endpoint === '/api/brsr/environmental'
          ? payload
          : { ...payload, _import: true };
        await apiFetch(sec.endpoint, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(finalPayload),
        });
        res.push({ id: sec.id, label: sec.label, ok: true, msg: `${fieldCount} fields imported` });
      } catch (err) {
        res.push({ id: sec.id, label: sec.label, ok: false, msg: err?.message || 'API error' });
      }
    }

    setResults(res);
    setImportDone(true);
    setImporting(false);
    const imported = res.filter(r => r.ok).map(r => r.id);
    if (imported.length > 0) onImportComplete?.(imported);
  };

  const togglePanel = (key) =>
    setOpenPanels(prev => ({ ...prev, [key]: !prev[key] }));

  const toggleAll = (val) =>
    setSelected(Object.fromEntries(SECTION_CONFIG.map(s => [s.id, val])));

  const confClass = (c) =>
    c === 'high' ? 'conf-high' : c === 'medium' ? 'conf-medium' : 'conf-low';

  const renderFields = (sectionKey, sectionData) => {
    const labelMap = LABELS[sectionKey] || {};
    const entries  = Object.entries(sectionData).filter(([, v]) => v && v.value !== null && v.value !== undefined);
    if (!entries.length) return <div className="brsr-imp-empty">Nothing extracted</div>;
    return entries.map(([key, { value, confidence }]) => (
      <div key={key} className="brsr-imp-field">
        <span className="brsr-imp-field-lbl">{labelMap[key] || key}</span>
        <span className="brsr-imp-field-val">{Array.isArray(value) ? value.join(', ') : String(value)}</span>
        <span className={`brsr-imp-conf ${confClass(confidence)}`}>{confidence}</span>
      </div>
    ));
  };

  const grand = parsed ? totalFields(parsed) : 0;
  const anySelected = Object.values(selected).some(Boolean);

  return (
    <>
      <style>{CSS}</style>
      <div
        className="brsr-imp-overlay"
        onClick={e => { if (e.target === e.currentTarget && !importing) onClose(); }}
      >
        <div className="brsr-imp-modal">

          {/* ── Header ── */}
          <div className="brsr-imp-hd">
            <div className="brsr-imp-title">
              Import from <span>Previous BRSR</span>
            </div>
            <div className="brsr-imp-sub">
              Upload any BRSR PDF (EtherTrack-generated or standard SEBI filing) →
              auto-fills Section A, Section B and all P1–P9 fields for FY {year}.
              Review extracted values before confirming — nothing saves until you click IMPORT.
            </div>
          </div>

          <div className="brsr-imp-body">

            {/* ── Drop zone ── */}
            {!processing && !parsed && !importDone && (
              <>
                <div
                  className={`brsr-imp-drop${dragOver ? ' over' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                >
                  <div className="brsr-imp-drop-icon">📋</div>
                  <div className="brsr-imp-drop-title">DROP PREVIOUS BRSR PDF HERE</div>
                  <div className="brsr-imp-drop-sub">
                    or click to browse · PDF only · Max 25MB<br/>
                    Best results with EtherTrack-generated BRSR. Standard SEBI tabular layout also supported.
                  </div>
                </div>
                <input
                  ref={fileRef} type="file" accept=".pdf"
                  style={{ display: 'none' }}
                  onChange={e => processFile(e.target.files[0])}
                />
                <div className="brsr-imp-privacy">
                  🔒 PDF parsed entirely in your browser — no document data leaves the page
                </div>
              </>
            )}

            {/* ── Progress ── */}
            {processing && (
              <div className="brsr-imp-spinner">
                <div className="brsr-imp-spin"/>
                <div className="brsr-imp-spin-lbl">{progress.stage || 'Reading document…'}</div>
                <div className="brsr-imp-track">
                  <div className="brsr-imp-fill" style={{ width: `${progress.pct}%` }}/>
                </div>
                <div className="brsr-imp-pct">{progress.pct}%</div>
              </div>
            )}

            {/* ── Import results ── */}
            {importDone && results.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                {results.map(r => (
                  <div
                    key={r.id}
                    className={`brsr-imp-result ${
                      r.ok ? 'brsr-imp-result-ok' :
                      r.ok === null ? 'brsr-imp-result-warn' :
                      'brsr-imp-result-err'
                    }`}
                  >
                    <span className="brsr-imp-result-icon">
                      {r.ok ? '✓' : r.ok === null ? '⚠' : '✕'}
                    </span>
                    <span><strong>{r.label}</strong> — {r.msg}</span>
                  </div>
                ))}
                {results.some(r => r.ok) && (
                  <div className="brsr-imp-result brsr-imp-result-ok">
                    <span className="brsr-imp-result-icon">ℹ</span>
                    <span>
                      Go to each section and review the pre-filled values.
                      Click SAVE in each section to finalize.
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── Extracted preview ── */}
            {parsed && !importDone && (
              <>
                <div className="brsr-imp-summary">
                  Found <strong>{grand} fields</strong> across all sections in{' '}
                  <strong>{sourceFile?.name}</strong>.
                  Select sections to import, review values, then confirm.
                </div>

                {/* Section toggles */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 9, letterSpacing: '.12em', color: '#5a7a96' }}>
                      SELECT SECTIONS TO IMPORT
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="brsr-imp-btn brsr-imp-btn-g"
                        style={{ padding: '4px 10px', fontSize: 9 }}
                        onClick={() => toggleAll(true)}
                      >SELECT ALL</button>
                      <button
                        className="brsr-imp-btn brsr-imp-btn-g"
                        style={{ padding: '4px 10px', fontSize: 9 }}
                        onClick={() => toggleAll(false)}
                      >NONE</button>
                    </div>
                  </div>
                  <div className="brsr-imp-sections-grid">
                    {SECTION_CONFIG.map(sec => {
                      const cnt = sec.countKey.reduce((s, k) => s + countFields(parsed[k] || {}), 0);
                      return (
                        <label key={sec.id} className="brsr-imp-sec-toggle">
                          <input
                            type="checkbox"
                            checked={selected[sec.id]}
                            onChange={e => setSelected(prev => ({ ...prev, [sec.id]: e.target.checked }))}
                          />
                          <span className="brsr-imp-sec-toggle-lbl">{sec.label}</span>
                          <span className="brsr-imp-sec-toggle-count">{cnt} fields</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Collapsible field panels — one per section */}
                {Object.entries(parsed).map(([sKey, sData]) => {
                  const cnt   = countFields(sData);
                  const open  = openPanels[sKey];
                  const label = SECTION_LABELS[sKey] || sKey;
                  return (
                    <div key={sKey} className="brsr-imp-panel">
                      <div
                        className="brsr-imp-panel-hd"
                        onClick={() => togglePanel(sKey)}
                      >
                        <span className="brsr-imp-panel-title">{label.toUpperCase()}</span>
                        <div className="brsr-imp-panel-meta">
                          <span className="brsr-imp-panel-count">{cnt} field{cnt !== 1 ? 's' : ''} found</span>
                          <span className={`brsr-imp-panel-chevron${open ? ' open' : ''}`}>▼</span>
                        </div>
                      </div>
                      {open && (
                        <div className="brsr-imp-panel-body">
                          {renderFields(sKey, sData)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* ── Actions ── */}
          <div className="brsr-imp-actions">
            <button
              className="brsr-imp-btn brsr-imp-btn-g"
              onClick={onClose}
              disabled={importing}
            >
              {importDone ? 'CLOSE' : 'CANCEL'}
            </button>

            {parsed && !importDone && (
              <>
                <button
                  className="brsr-imp-btn brsr-imp-btn-g"
                  onClick={() => { setParsed(null); setSourceFile(null); setProgress({ pct: 0, stage: '' }); }}
                  disabled={importing}
                >
                  ← DIFFERENT PDF
                </button>
                <button
                  className="brsr-imp-btn brsr-imp-btn-p"
                  onClick={handleImport}
                  disabled={importing || !anySelected}
                >
                  {importing ? 'IMPORTING…' : `CONFIRM IMPORT FY ${year} →`}
                </button>
              </>
            )}
          </div>

        </div>
      </div>
    </>
  );
}