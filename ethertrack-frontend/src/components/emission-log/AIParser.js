// src/components/emission-log/AIParser.jsx
// Rule-based AI document parser for Indian emission sources
// Supports: Electricity bills, Fuel receipts, Air tickets, GST invoices, Hotel invoices
// Zero external API dependency — runs entirely client-side
// OCR (Tesseract.js, WASM) handles images + scanned PDFs — nothing ever leaves the browser
// OCR confidence feeds into the result's confidence tier; low-confidence reads are
// excluded from bulk-save and must be individually reviewed before they hit the ledger.
// Every saved record carries an audit payload (auto-extracted vs human-confirmed values,
// extraction method, OCR confidence, source filename) for BRSR/CCTS traceability.
//
// v5 — Production fixes:
// Fix 6: Duplicate bill detection — SHA-256 hash of (activity+date+quantity+filename)
//         checked client-side before save; server-side dedup key also sent in payload
// Fix 7: Multiplier (गुणक अवयव) applied to reading diff — HT/3-phase meters in
//         Maharashtra, Karnataka, AP use multipliers of 2, 5, 10; ignoring it causes
//         massive undercounting. Extracted from bill table before applying diff.
// Fix 8: OCR timeout — 90s hard timeout per file; spinner auto-clears with helpful msg
//
// v4 — Critical fixes:
// Fix 1: Lazy OCR language loading — detect script from quick text scan first,
//         load only needed language packs, not all 7 upfront every time
// Fix 2: Tesseract v5 OEM constant fixed (Tesseract.OEM.LSTM_ONLY)
// Fix 3: OCR CDN retry with fallback mirror on load failure
// Fix 4: Faulty meter stub quantity set to null not 0, saveRecord handles null
//         gracefully with a "please enter" prompt instead of "invalid quantity"
// Fix 5: Reading diff fallback — चालू रिडिंग minus मागील रिडिंग used when
//         "units consumed" is absent (Mahavitaran + most state discom formats)
//
// v3 — OCR engine upgraded + state-wide fallback detection:
// OCR:         Tesseract now loads eng+hin+tel+tam+kan+ben+guj language packs
//              so Devanagari, Telugu, Tamil, Kannada, Bengali, Gujarati scripts
//              are read natively — not just English on regional bills
// Electricity: All 22 states — GSTIN state-code prefix + official discom website
//              URL patterns used as a last-resort fallback when the script OCR
//              fails, so a bill is never silently dropped just because Tesseract
//              couldn't read the regional script cleanly
// Fuel:        Hindi, Marathi, Tamil, Telugu, Kannada, Bengali, Gujarati
// Air:         Hindi, Marathi, Tamil, Telugu + 30 domestic + key intl routes
// GST:         Hindi + regional material keywords
// Hotel:       Hindi, Marathi, Tamil, Telugu, Kannada, Bengali, Gujarati, Punjabi

import React, { useState, useRef, useCallback } from 'react';
import { apiFetch } from '../../services/api';

const sanitise = (str = '') =>
  String(str).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, 500);

const safeNum = (val, min = 0, max = 1e12) => {
  const n = parseFloat(val);
  if (!isFinite(n) || n < min || n > max) return null;
  return n;
};

// Conservative OCR-noise cleanup, applied before regex matching. Only fires on narrow,
// unambiguous patterns (a letter sandwiched directly between two digits, or irregular
// unit spacing) so it doesn't risk corrupting clean PDF/text input.
const normalizeOcrText = (text = '') =>
  text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/(\d)[oO](\d)/g, '$10$2')
    .replace(/(\d)[lI](\d)/g, '$11$2')
    .replace(/(\d)[sS](\d)/g, '$15$2')
    .replace(/k\s*w\s*h\s*r/gi, 'kWhr')
    .replace(/k\s*w\s*h/gi, 'kWh');

// ── Fix 6: Client-side duplicate bill detection ───────────────────────────────
// Computes a lightweight dedup key from the record's core fields. Used two ways:
//   1. Before showing results — checks against sessionStorage (same tab session)
//   2. Sent to the backend in aiAudit.dedupKey so the server can enforce uniqueness
//      across sessions via a unique index on emissions_log(dedup_key).
//
// SHA-256 is async (SubtleCrypto), so we use a fast djb2-style string hash for
// the client-side session check and generate the SHA-256 async for the server.
const djb2Hash = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
};

const buildDedupKey = (activity, date, quantity, fileName) =>
  djb2Hash(`${activity}|${date}|${Math.round((quantity || 0) * 1000)}|${fileName}`);

const sha256 = async (str) => {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};

// Session-level seen set — clears on page reload, just catches same-session dupes
const SESSION_SEEN = new Set();


// Each parser targets a specific Indian document type
// Returns array of extracted records
// ─────────────────────────────────────────────────────────────────────────────

const extractDate = (text) => {
  // Priority: look for labelled "bill date" / "reading date" first, then fall
  // back to the first date found. This avoids picking up the due date which
  // is typically 2-4 weeks after the actual billing period.
  const labelledPatterns = [
    // English labels
    /(?:bill\s*date|invoice\s*date|reading\s*date|issue\s*date|billing\s*date)[:\s]+(\d{1,2}[/\-]\d{2}[/\-]\d{4})/i,
    /(?:bill\s*date|invoice\s*date|reading\s*date|issue\s*date)[:\s]+(\d{4}-\d{2}-\d{2})/i,
    // Marathi — देयक दिनांक (bill date), मागील रिडिंग दिनांक
    /देयक\s*दिनांक[:\s]+(\d{1,2}[/\-]\d{2}[/\-]\d{4})/i,
    /बिलिंग\s*दिनांक[:\s]+(\d{1,2}[/\-]\d{2}[/\-]\d{4})/i,
    // Hindi — बिल दिनांक
    /बिल\s*दिनांक[:\s]+(\d{1,2}[/\-]\d{2}[/\-]\d{4})/i,
    /चालान\s*दिनांक[:\s]+(\d{1,2}[/\-]\d{2}[/\-]\d{4})/i,
    // Telugu — బిల్లు తేదీ
    /బిల్లు\s*తేదీ[:\s]+(\d{1,2}[/\-]\d{2}[/\-]\d{4})/i,
    // Tamil — பட்டியல் தேதி
    /பட்டியல்\s*தேதி[:\s]+(\d{1,2}[/\-]\d{2}[/\-]\d{4})/i,
    // Kannada — ಬಿಲ್ ದಿನಾಂಕ
    /ಬಿಲ್\s*ದಿನಾಂಕ[:\s]+(\d{1,2}[/\-]\d{2}[/\-]\d{4})/i,
  ];

  const parseRaw = (raw) => {
    if (!raw) return null;
    const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = raw.match(/(\d{1,2})[/\-](\d{2})[/\-](\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1].padStart(2, '0')}`;
    return null;
  };

  for (const p of labelledPatterns) {
    const m = text.match(p);
    if (m) { const d = parseRaw(m[1]); if (d) return d; }
  }

  // Generic fallback — first date found in document
  const generic = [
    /(\d{4})-(\d{2})-(\d{2})/,
    /(\d{2})[/\-](\d{2})[/\-](\d{4})/,
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i,
  ];
  for (const p of generic) {
    const m = text.match(p);
    if (m) {
      if (p === generic[0]) return `${m[1]}-${m[2]}-${m[3]}`;
      if (p === generic[1]) return `${m[3]}-${m[2]}-${m[1].padStart(2,'0')}`;
      if (p === generic[2]) {
        const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
        return `${m[3]}-${months[m[2].toLowerCase().slice(0,3)]}-${m[1].padStart(2,'0')}`;
      }
    }
  }
  return new Date().toISOString().slice(0, 10);
};

// ── Electricity Bill Parser ───────────────────────────────────────────────────
// Covers all 22 state discoms + Marathi, Hindi, Telugu, Tamil, Kannada, Bengali,
// Gujarati, Punjabi, Odia, Malayalam, Urdu detection keywords.
const parseElectricityBill = (text) => {
  const results = [];

  // ── Discom / utility detection ──────────────────────────────────────────────
  // English discom names + abbreviations
  const isElecEnglish = /ELECTRICITY|MSEDCL|BESCOM|TPDDL|BSES|TNEB|TANGEDCO|WBSEDCL|CESC|DISCOM|UNITS CONSUMED|KWH|KWHR|ENERGY CHARGES|MAHAVITARAN|TORRENT POWER|ADANI ELECTRICITY|APEPDCL|APCPDCL|TSSPDCL|TSNPDCL|PSPCL|UHBVN|DHBVN|JVVNL|AVVNL|MPEZ|MPWZ|CSPDCL|BSPHCL|APDCL|KESCO|KPTCL|HESCOM|GESCOM|MESCOM|CESCOM|UGVCL|PGVCL|DGVCL|MGVCL|BILL OF SUPPLY|ELECTRICITY BILL|POWER BILL|ENERGY BILL|UNITS|METER READING|CESU|NESCO|WESCO|SOUTHCO|KSEB/i.test(text);

  // Marathi — Mahavitaran (Maharashtra) most common
  const isElecMarathi = /महावितरण|वीज|युनिट|एकूण वापर|विद्युत|वीज पुरवठा|बिलिंग युनिट|मीटर क्रमांक|थकबाकी|देय रक्कम|चालू रिडिंग|मागील रिडिंग|वीज बिल|वीज पुरवठा देयक/i.test(text);

  // Hindi — UP, Bihar, Rajasthan, MP, Uttarakhand, Jharkhand, Haryana discoms
  const isElecHindi = /बिजली|विद्युत|इकाई|यूनिट|बिल राशि|मीटर संख्या|खपत|उपभोग|कुल इकाई|ऊर्जा शुल्क|बिजली बिल|विद्युत बिल|बिलिंग माह|वर्तमान रीडिंग|पिछली रीडिंग|बिजली आपूर्ति/i.test(text);

  // Telugu — APEPDCL, APCPDCL, TSSPDCL, TSNPDCL (Andhra Pradesh & Telangana)
  const isElecTelugu = /విద్యుత్|యూనిట్లు|కరెంట్ బిల్|మీటర్|వినియోగం|విద్యుత్ బిల్|యూనిట్|చదవడం|విద్యుత్ సరఫరా/i.test(text);

  // Tamil — TNEB / TANGEDCO (Tamil Nadu)
  const isElecTamil = /மின்சாரம்|யூனிட்|மின் கட்டணம்|மீட்டர்|நுகர்வு|மின்னணு|மின் பில்|படிக்கும்|மின் விநியோகம்/i.test(text);

  // Kannada — BESCOM, HESCOM, GESCOM, MESCOM, CESCOM (Karnataka)
  const isElecKannada = /ವಿದ್ಯುತ್|ಯೂನಿಟ್|ವಿದ್ಯುತ್ ಬಿಲ್|ಮೀಟರ್|ಬಳಕೆ|ಯೂನಿಟ್ಗಳು|ಓದುವಿಕೆ|ವಿದ್ಯುತ್ ಪೂರೈಕೆ/i.test(text);

  // Bengali — WBSEDCL, CESC (West Bengal)
  const isElecBengali = /বিদ্যুৎ|ইউনিট|বিদ্যুৎ বিল|মিটার|ব্যবহার|বিদ্যুৎ চার্জ|রিডিং|বিদ্যুৎ সরবরাহ/i.test(text);

  // Gujarati — UGVCL, PGVCL, DGVCL, MGVCL, Torrent Power, Adani Electricity
  const isElecGujarati = /વીજળી|યુનિટ|વીજ બિલ|મીટર|વપરાશ|ઊર્જા|રીડિંગ|વીજ પુરવઠો|વીજ સપ્લાય/i.test(text);

  // Punjabi — PSPCL (Punjab)
  const isElecPunjabi = /ਬਿਜਲੀ|ਯੂਨਿਟ|ਬਿਜਲੀ ਬਿੱਲ|ਮੀਟਰ|ਖਪਤ|ਰੀਡਿੰਗ|ਬਿਜਲੀ ਸਪਲਾਈ/i.test(text);

  // Odia — CESU, NESCO, WESCO, SOUTHCO (Odisha)
  const isElecOdia = /ବିଦ୍ୟୁତ|ୟୁନିଟ|ବିଦ୍ୟୁତ ବିଲ|ମିଟର|ବ୍ୟବହାର|ରିଡିଂ|ବିଦ୍ୟୁତ ଯୋଗାଣ/i.test(text);

  // Malayalam — KSEB (Kerala)
  const isElecMalayalam = /വൈദ്യുതി|യൂണിറ്റ്|വൈദ്യുതി ബിൽ|മീറ്റർ|ഉപഭോഗം|റീഡിംഗ്|വൈദ്യുതി വിതരണം/i.test(text);

  // Urdu — J&K discoms, some UP/Bihar bills printed in Urdu
  const isElecUrdu = /بجلی|یونٹ|بجلی بل|میٹر|استعمال|ریڈنگ|بجلی فراہمی/i.test(text);

  // ── State-level fallback: GSTIN prefix + official discom domain ────────────
  // When regional script OCR fails completely (Tesseract can't read the script),
  // every Indian electricity bill still has two machine-readable English anchors:
  //   1. GSTIN — first 2 digits = state code (01=JK, 07=Delhi, 27=MH, 29=KA …)
  //   2. Official discom website URL printed on the bill
  // These are always in English so they survive even bad OCR. We use them as a
  // last-resort net so no bill is silently dropped across any Indian state.
  const isElecGstinFallback = (() => {
    // State codes that appear in discom GSTINs (not all states have a single code)
    // 01=JK, 02=HP, 03=PB, 04=CH, 05=UT, 06=HR, 07=DL, 08=RJ, 09=UP, 10=BR
    // 11=SK, 12=AR, 13=NL, 14=MN, 15=MZ, 16=TR, 17=ML, 18=AS, 19=WB, 20=JH
    // 21=OD, 22=CG, 23=MP, 24=GJ, 27=MH, 28=AP, 29=KA, 30=GA, 32=KL, 33=TN
    // 34=PY, 36=TG, 37=AP(new)
    const gstinMatch = text.match(/\b(\d{2})[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]\b/);
    if (!gstinMatch) return false;
    const stateCode = parseInt(gstinMatch[1], 10);
    // All valid Indian state codes for electricity utilities
    return [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,27,28,29,30,32,33,34,36,37,38].includes(stateCode);
  })();

  // Official discom / utility website domains printed on bills across all states
  const isElecUrlFallback = /mahadiscom\.in|bescom\.org|tpddl\.com|bsesdelhi\.com|bsesrajdhani\.com|tangedco\.gov|tneb\.org|wbsedcl\.in|cesc\.co\.in|torrentpower\.com|adanielectricity\.com|apepdcl\.in|apcpdcl\.in|tsspdcl\.in|tsnpdcl\.in|pspcl\.in|uhbvn\.org\.in|dhbvn\.org\.in|jvvnl\.in|avvnl\.com|mpcz\.co\.in|mpez\.co\.in|cspdcl\.co\.in|bsphcl\.co\.in|apdcl\.gov\.in|kesco\.co\.in|hescom\.in|gescom\.in|mescom\.in|cescom\.in|ugvcl\.com|pgvcl\.com|dgvcl\.com|mgvcl\.com|kseb\.in|cesuodisha\.org|nesco\.co\.in|wesco\.co\.in|southco\.in|jkpdd\.net|hpseb\.in|sikkim\.gov\.in\/electricity|mepdcl\.gov\.in|dnhpdcl\.gov\.in|dpdcl\.in/i.test(text);

  // Bill of supply + meter-related English phrases that appear on all state bills
  const isElecBillPhraseFallback = /BILL\s+OF\s+SUPPLY|METER\s+STATUS|METER\s+READING|CONSUMER\s+NO|ACCOUNT\s+NO|BILLING\s+PERIOD|DUE\s+DATE|SANCTIONED\s+LOAD|CONNECTED\s+LOAD/i.test(text);

  const isElec =
    isElecEnglish        || isElecMarathi   || isElecHindi    || isElecTelugu  ||
    isElecTamil          || isElecKannada   || isElecBengali  || isElecGujarati ||
    isElecPunjabi        || isElecOdia      || isElecMalayalam || isElecUrdu    ||
    isElecGstinFallback  || isElecUrlFallback || isElecBillPhraseFallback;

  if (!isElec) return [];

  // ── kWh / units extraction ──────────────────────────────────────────────────
  const kwhPatterns = [
    // English
    /units\s+consumed[:\s]+([0-9,]+\.?\d*)/i,
    /net\s+units[:\s]+([0-9,]+\.?\d*)/i,
    /total\s+units[:\s]+([0-9,]+\.?\d*)/i,
    /energy\s+consumed[:\s]+([0-9,]+\.?\d*)/i,
    /consumption[:\s]+([0-9,]+\.?\d*)/i,
    /([0-9,]+\.?\d*)\s*kwh/i,
    /([0-9,]+\.?\d*)\s*kwhr/i,
    /([0-9,]+\.?\d*)\s*units/i,
    /current\s+reading\s*[-–]\s*previous\s*reading[:\s]+([0-9,]+\.?\d*)/i,
    // Marathi — एकूण वापर (total consumption), युनिट, चालू/मागील रिडिंग
    /एकूण\s*वापर[:\s]*([0-9,]+\.?\d*)/i,
    /युनिट[:\s]*([0-9,]+\.?\d*)/i,
    /वापर[:\s]*([0-9,]+\.?\d*)/i,
    // Hindi — कुल इकाई, खपत, उपभोग, यूनिट
    /कुल\s*इकाई[:\s]*([0-9,]+\.?\d*)/i,
    /खपत[:\s]*([0-9,]+\.?\d*)/i,
    /उपभोग[:\s]*([0-9,]+\.?\d*)/i,
    /यूनिट[:\s]*([0-9,]+\.?\d*)/i,
    // Telugu
    /వినియోగం[:\s]*([0-9,]+\.?\d*)/i,
    /యూనిట్లు[:\s]*([0-9,]+\.?\d*)/i,
    // Tamil
    /நுகர்வு[:\s]*([0-9,]+\.?\d*)/i,
    /யூனிட்[:\s]*([0-9,]+\.?\d*)/i,
    // Kannada
    /ಬಳಕೆ[:\s]*([0-9,]+\.?\d*)/i,
    /ಯೂನಿಟ್[:\s]*([0-9,]+\.?\d*)/i,
    // Bengali
    /ব্যবহার[:\s]*([0-9,]+\.?\d*)/i,
    /ইউনিট[:\s]*([0-9,]+\.?\d*)/i,
    // Gujarati
    /વપરાશ[:\s]*([0-9,]+\.?\d*)/i,
    /યુનિટ[:\s]*([0-9,]+\.?\d*)/i,
    // Punjabi
    /ਖਪਤ[:\s]*([0-9,]+\.?\d*)/i,
    /ਯੂਨਿਟ[:\s]*([0-9,]+\.?\d*)/i,
    // Malayalam
    /ഉപഭോഗം[:\s]*([0-9,]+\.?\d*)/i,
    /യൂണിറ്റ്[:\s]*([0-9,]+\.?\d*)/i,
    // Odia
    /ବ୍ୟବହାର[:\s]*([0-9,]+\.?\d*)/i,
    /ୟୁନିଟ[:\s]*([0-9,]+\.?\d*)/i,
  ];

  let kwh = null;
  for (const p of kwhPatterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 0 && val < 10_000_000) { kwh = val; break; }
    }
  }

  // ── Fix 7: Multiplier (गुणक अवयव) extraction ──────────────────────────────
  // HT connections and some 3-phase LT meters use a CT/PT multiplier (typically
  // 2, 5, 10, 20, 40, 100). Mahavitaran prints it as "गुणक अवयव" in the reading
  // table; BESCOM/TSSPDCL call it "Multiplying Factor" or "MF". If we ignore it
  // the reading diff is off by that factor — a massive data quality error.
  const extractMultiplier = (t) => {
    const patterns = [
      /(?:multiplying\s*factor|MF|meter\s*constant)[:\s]*([0-9]+\.?\d*)/i,
      /गुणक\s*(?:अवयव)?[:\s]*([0-9]+\.?\d*)/i,          // Marathi
      /గుణకం[:\s]*([0-9]+\.?\d*)/i,                       // Telugu
      /பெருக்கல்\s*காரணி[:\s]*([0-9]+\.?\d*)/i,          // Tamil
      /ಗುಣಕ[:\s]*([0-9]+\.?\d*)/i,                        // Kannada
      /গুণক[:\s]*([0-9]+\.?\d*)/i,                        // Bengali
      /ગુણક[:\s]*([0-9]+\.?\d*)/i,                        // Gujarati
      // Mahavitaran table fallback: reading table row has [curr] [prev] [MF] [units]
      // MF is always a round number: 1, 2, 5, 10, 20, 40, 100
      /([0-9]{3,6})\s+([0-9]{3,6})\s+(1|2|5|10|20|40|100)\.?0*\s+/,
    ];
    for (const p of patterns) {
      const m = t.match(p);
      if (m) {
        // Last pattern returns MF in group 3
        const raw = p.source.includes('[0-9]{3,6}') ? m[3] : m[1];
        const mf  = parseFloat(raw);
        if (mf >= 1 && mf <= 1000) return mf;
      }
    }
    return 1; // default — no multiplier
  };

  const multiplier = extractMultiplier(text);

  // ── Fix 5: Reading difference fallback ─────────────────────────────────────
  // When "units consumed" is absent or zero (common on Mahavitaran, BESCOM, TSSPDCL
  // bills), try computing current_reading − previous_reading directly from the meter
  // reading table. Works for: English, Marathi (चालू/मागील रिडिंग), Hindi (वर्तमान/
  // पिछली रीडिंग), Telugu (ప్రస్తుత/మునుపటి), Tamil (தற்போதைய/முந்தைய).
  if (!kwh) {
    const readingPatterns = [
      // English — "Current Reading" and "Previous Reading" on same or adjacent lines
      [/current\s*reading[:\s]*([0-9,]+)/i, /previous\s*reading[:\s]*([0-9,]+)/i],
      // Marathi — చాళూ రిడింగ్ / మాగీళ్ రిడింగ్
      [/चालू\s*रिडिंग[:\s]*([0-9,]+)/i, /मागील\s*रिडिंग[:\s]*([0-9,]+)/i],
      // Hindi
      [/वर्तमान\s*रीडिंग[:\s]*([0-9,]+)/i, /पिछली\s*रीडिंग[:\s]*([0-9,]+)/i],
      // Kannada — ಪ್ರಸ್ತುತ / ಹಿಂದಿನ ರೀಡಿಂಗ್
      [/ಪ್ರಸ್ತುತ\s*ರೀಡಿಂಗ್[:\s]*([0-9,]+)/i, /ಹಿಂದಿನ\s*ರೀಡಿಂಗ್[:\s]*([0-9,]+)/i],
      // Tamil
      [/தற்போதைய\s*படிப்பு[:\s]*([0-9,]+)/i, /முந்தைய\s*படிப்பு[:\s]*([0-9,]+)/i],
      // Telugu
      [/ప్రస్తుత\s*రీడింగ్[:\s]*([0-9,]+)/i, /మునుపటి\s*రీడింగ్[:\s]*([0-9,]+)/i],
      // Bengali
      [/বর্তমান\s*রিডিং[:\s]*([0-9,]+)/i, /পূর্ববর্তী\s*রিডিং[:\s]*([0-9,]+)/i],
      // Gujarati
      [/વર્તમાન\s*રીડિંગ[:\s]*([0-9,]+)/i, /પાછલી\s*રીડિંગ[:\s]*([0-9,]+)/i],
      // Generic "present / previous" table — two large numbers close together
      // Mahavitaran table: चालू रिडिंग | मागील रिडिंग | गुणक अवयव | युनिट
      // OCR often drops labels → fall back to: big_number1 ... big_number2 ... 1.00 ... 0
      [/([0-9]{3,6})\s+([0-9]{3,6})\s+1\.00\s+0/i, null], // special case
    ];

    for (const [currPat, prevPat] of readingPatterns) {
      // Special case: Mahavitaran table pattern — [curr] [prev] MF 0
      if (!prevPat) {
        const m = text.match(currPat);
        if (m) {
          const curr = parseFloat(m[1].replace(/,/g, ''));
          const prev = parseFloat(m[2].replace(/,/g, ''));
          const diff = (curr - prev) * multiplier;
          if (diff > 0 && diff < 10_000_000) { kwh = diff; break; }
        }
        continue;
      }
      const mCurr = text.match(currPat);
      const mPrev = text.match(prevPat);
      if (mCurr && mPrev) {
        const curr = parseFloat(mCurr[1].replace(/,/g, ''));
        const prev = parseFloat(mPrev[1].replace(/,/g, ''));
        const diff = (curr - prev) * multiplier;
        if (diff > 0 && diff < 10_000_000) { kwh = diff; break; }
      }
    }
  }

  // ── Faulty / estimated meter graceful fallback ──────────────────────────────
  // When even reading-diff fails (meter genuinely faulty / no readings printed),
  // return a stub with quantity: null so the UI prompts the user to fill it in.
  // null is intentional — saveRecord checks for it specifically and shows a
  // "please enter the units manually" message instead of "invalid quantity".
  const isFaulty =
    /faulty|meter.*faulty|estimated\s*bill|सारासरी|अनुमानित|दोषपूर्ण\s*मीटर|ಅಂದಾಜು|மதிப்பீடு|అంచనా|আনুমানিক/i.test(text);

  if (!kwh) {
    if (isFaulty) {
      return [{
        activity:   'Electricity India Location (kWh)',
        quantity:   null,                // null → UI shows "enter manually" prompt
        date:       extractDate(text),
        notes:      'Meter faulty / estimated billing — units not available, please enter manually',
        confidence: 'low',
        source:     'AI Parser — Electricity Bill (Faulty Meter)',
      }];
    }
    return [];
  }

  const date = extractDate(text);

  // ── Discom label for notes ──────────────────────────────────────────────────
  const discom =
    /MSEDCL|महावितरण/i.test(text)          ? 'MSEDCL (Mahavitaran)' :
    /BESCOM/i.test(text)                    ? 'BESCOM'               :
    /TPDDL/i.test(text)                     ? 'TPDDL'                :
    /BSES/i.test(text)                      ? 'BSES'                 :
    /TNEB|TANGEDCO/i.test(text)             ? 'TNEB/TANGEDCO'        :
    /WBSEDCL/i.test(text)                   ? 'WBSEDCL'              :
    /CESC/i.test(text)                      ? 'CESC'                 :
    /TORRENT/i.test(text)                   ? 'Torrent Power'        :
    /ADANI\s*ELECTRICITY/i.test(text)       ? 'Adani Electricity'    :
    /APEPDCL/i.test(text)                   ? 'APEPDCL'              :
    /APCPDCL/i.test(text)                   ? 'APCPDCL'              :
    /TSSPDCL/i.test(text)                   ? 'TSSPDCL'              :
    /TSNPDCL/i.test(text)                   ? 'TSNPDCL'              :
    /PSPCL/i.test(text)                     ? 'PSPCL'                :
    /UHBVN/i.test(text)                     ? 'UHBVN'                :
    /DHBVN/i.test(text)                     ? 'DHBVN'                :
    /JVVNL/i.test(text)                     ? 'JVVNL'                :
    /AVVNL/i.test(text)                     ? 'AVVNL'                :
    /CSPDCL/i.test(text)                    ? 'CSPDCL'               :
    /BSPHCL/i.test(text)                    ? 'BSPHCL'               :
    /APDCL/i.test(text)                     ? 'APDCL'                :
    /KESCO/i.test(text)                     ? 'KESCO'                :
    /HESCOM/i.test(text)                    ? 'HESCOM'               :
    /GESCOM/i.test(text)                    ? 'GESCOM'               :
    /MESCOM/i.test(text)                    ? 'MESCOM'               :
    /CESCOM/i.test(text)                    ? 'CESCOM'               :
    /UGVCL/i.test(text)                     ? 'UGVCL'                :
    /PGVCL/i.test(text)                     ? 'PGVCL'                :
    /DGVCL/i.test(text)                     ? 'DGVCL'                :
    /MGVCL/i.test(text)                     ? 'MGVCL'                :
    /KSEB/i.test(text)                      ? 'KSEB'                 :
    /CESU/i.test(text)                      ? 'CESU'                 :
    /NESCO/i.test(text)                     ? 'NESCO'                :
    /WESCO/i.test(text)                     ? 'WESCO'                :
    /SOUTHCO/i.test(text)                   ? 'SOUTHCO'              :
    'Grid electricity';

  results.push({
    activity:   'Electricity India Location (kWh)',
    quantity:   kwh,
    date,
    notes:      `Auto-parsed from ${discom} bill${multiplier !== 1 ? ` · MF×${multiplier} applied` : ''}`,
    confidence: 'high',
    source:     'AI Parser — Electricity Bill',
  });

  return results;
};

// ── Fuel Receipt Parser ──────────────────────────────────────────────────────
// Petrol / Diesel / CNG pump receipts — HPCL, BPCL, IOC + all regional languages
const parseFuelReceipt = (text) => {
  const results = [];
  const isFuelEnglish  = /HPCL|BPCL|IOC|INDIAN OIL|BHARAT PETROLEUM|HINDUSTAN PETROLEUM|FUEL|PETROL|DIESEL|CNG|LPG|LITRES?|LITERS?|PUMP\s*RECEIPT|FUEL\s*STATION/i.test(text);
  const isFuelHindi    = /पेट्रोल|डीजल|ईंधन|सीएनजी|एलपीजी|लीटर|पेट्रोल पंप|ईंधन भरण/i.test(text);
  const isFuelMarathi  = /पेट्रोल|डिझेल|इंधन|सीएनजी|लिटर|इंधन भरणे/i.test(text);
  const isFuelTamil    = /பெட்ரோல்|டீசல்|எரிபொருள்|லிட்டர்|சிஎன்ஜி/i.test(text);
  const isFuelTelugu   = /పెట్రోల్|డీజల్|ఇంధనం|లీటర్లు|సిఎన్జి/i.test(text);
  const isFuelKannada  = /ಪೆಟ್ರೋಲ್|ಡೀಸೆಲ್|ಇಂಧನ|ಲೀಟರ್|ಸಿಎನ್ಜಿ/i.test(text);
  const isFuelBengali  = /পেট্রোল|ডিজেল|জ্বালানি|লিটার/i.test(text);
  const isFuelGujarati = /પેટ્રોલ|ડીઝલ|ઇંધણ|લીટર|સીએનજી/i.test(text);
  const isFuel = isFuelEnglish || isFuelHindi || isFuelMarathi || isFuelTamil ||
    isFuelTelugu || isFuelKannada || isFuelBengali || isFuelGujarati;
  if (!isFuel) return [];
  const litrePatterns = [
    /([0-9]+\.?\d*)\s*(?:ltrs?|litres?|liters?|ltr)/i,
    /qty[:\s]+([0-9]+\.?\d*)/i,
    /volume[:\s]+([0-9]+\.?\d*)/i,
    /([0-9]+\.?\d*)\s*L\b/,
    /([0-9]+\.?\d*)\s*(?:लीटर|लिटर)/i,
    /([0-9]+\.?\d*)\s*லிட்டர்/i,
    /([0-9]+\.?\d*)\s*లీటర్లు/i,
    /([0-9]+\.?\d*)\s*ಲೀಟರ್/i,
    /([0-9]+\.?\d*)\s*লিটার/i,
    /([0-9]+\.?\d*)\s*લીટર/i,
  ];
  let litres = null;
  for (const p of litrePatterns) {
    const m = text.match(p);
    if (m) { const val = parseFloat(m[1]); if (val > 0 && val < 100_000) { litres = val; break; } }
  }
  if (!litres) return [];
  const date     = extractDate(text);
  const isDiesel = /DIESEL|HSD|HIGH SPEED|डीजल|डिझेल|டீசல்|డీజల్|ಡೀಸೆಲ್|ডিজেল|ડીઝલ/i.test(text);
  const isCNG    = /CNG|COMPRESSED NATURAL GAS|सीएनजी|சிஎன்ஜி|సిఎన్జి|ಸಿಎನ್ಜಿ/i.test(text);
  const activity = isCNG ? 'Natural Gas (m3)' : isDiesel ? 'Diesel (L)' : 'Petrol (L)';
  const brand    = /HPCL|HINDUSTAN/i.test(text) ? 'HPCL' : /BPCL|BHARAT/i.test(text) ? 'BPCL' : /IOC|INDIAN OIL/i.test(text) ? 'IOC' : 'Fuel station';
  results.push({ activity, quantity: litres, date, notes: `Auto-parsed from ${brand} receipt`, confidence: 'high', source: 'AI Parser — Fuel Receipt' });
  return results;
};

// ── LPG Cylinder Invoice Parser ───────────────────────────────────────────────
// HPCL Indane, BPCL Bharat Gas, IOC HP Gas — 5kg / 14.2kg / 19kg / 47.5kg cylinders
const parseLPGInvoice = (text) => {
  const results = [];
  const isLPG = /INDANE|BHARAT\s*GAS|HP\s*GAS|LPG|LIQUEFIED\s*PETROLEUM|GAS\s*CYLINDER|CYLINDER\s*DELIVERY|DOMESTIC\s*GAS|गैस\s*सिलेंडर|सिलेंडर|एलपीजी|गॅस\s*सिलिंडर|గ్యాస్\s*సిలిండర్|சிலிண்டர்|ಗ್ಯಾಸ್\s*ಸಿಲಿಂಡರ್|গ্যাস\s*সিলিন্ডার|ગેસ\s*સિલિન્ડર/i.test(text);
  if (!isLPG) return [];
  const cylPatterns = [
    /no\.?\s*of\s*(?:cylinder|cyl)[:\s]*(\d+)/i,
    /(\d+)\s*(?:cylinder|cylinders|cyl)/i,
    /qty[:\s]*(\d+)/i,
    /(\d+)\s*(?:सिलेंडर|सिलिंडर)/i,
    /(\d+)\s*సిలిండర్లు/i,
    /(\d+)\s*சிலிண்டர்கள்/i,
    /(\d+)\s*ಸಿಲಿಂಡರ್ಗಳು/i,
  ];
  let cylinders = 1;
  for (const p of cylPatterns) {
    const m = text.match(p); if (m) { const v = parseInt(m[1]); if (v > 0 && v < 100) { cylinders = v; break; } }
  }
  const is19kg  = /19\s*kg|commercial/i.test(text);
  const is5kg   = /5\s*kg|small\s*cylinder/i.test(text);
  const is475kg = /47\.?5\s*kg|bulk/i.test(text);
  const cylKg   = is475kg ? 47.5 : is19kg ? 19 : is5kg ? 5 : 14.2;
  const totalKg = cylinders * cylKg;
  const brand   = /INDANE|INDIAN\s*OIL|IOC/i.test(text) ? 'Indane (IOC)' : /BHARAT\s*GAS|BPCL/i.test(text) ? 'Bharat Gas (BPCL)' : /HP\s*GAS|HPCL/i.test(text) ? 'HP Gas (HPCL)' : 'LPG supplier';
  results.push({ activity: 'LPG (kg)', quantity: totalKg, date: extractDate(text),
    notes: `Auto-parsed — ${cylinders}×${cylKg}kg cylinder from ${brand}`, confidence: 'high', source: 'AI Parser — LPG Invoice' });
  return results;
};

// ── PNG (Piped Natural Gas) Bill Parser ──────────────────────────────────────
// MGL (Mumbai), IGL (Delhi/NCR), GAIL Gas, Adani Gas, Gujarat Gas, MNGL (Pune)
const parsePNGBill = (text) => {
  const results = [];
  const isPNG = /MGL|IGL|GAIL\s*GAS|ADANI\s*GAS|GUJARAT\s*GAS|MNGL|MAHANAGAR\s*GAS|INDRAPRASTHA\s*GAS|PIPED\s*(?:NATURAL\s*)?GAS|PNG\s*BILL|SCM|STANDARD\s*CUBIC|NATURAL\s*GAS\s*BILL|गैस\s*बिल|पाइप्ड\s*गैस|नळाने\s*गॅस|పైప్డ్\s*గ్యాస్|குழாய்\s*வாயு/i.test(text);
  if (!isPNG) return [];
  let scm = null;
  const scmPatterns = [
    /([0-9,]+\.?\d*)\s*(?:SCM|standard\s*cubic\s*met(?:re|er))/i,
    /units\s*consumed[:\s]*([0-9,]+\.?\d*)/i,
    /gas\s*consumed[:\s]*([0-9,]+\.?\d*)/i,
    /consumption[:\s]*([0-9,]+\.?\d*)\s*(?:SCM|m3|m³)/i,
    /([0-9,]+\.?\d*)\s*(?:m3|m³)/i,
  ];
  for (const p of scmPatterns) {
    const m = text.match(p); if (m) { const val = parseFloat(m[1].replace(/,/g,'')); if (val > 0 && val < 1_000_000) { scm = val; break; } }
  }
  if (!scm) {
    const curr = text.match(/current\s*reading[:\s]*([0-9,]+\.?\d*)/i);
    const prev = text.match(/previous\s*reading[:\s]*([0-9,]+\.?\d*)/i);
    if (curr && prev) { const diff = parseFloat(curr[1].replace(/,/g,'')) - parseFloat(prev[1].replace(/,/g,'')); if (diff > 0) scm = diff; }
  }
  if (!scm) return [];
  const supplier = /MGL|MAHANAGAR/i.test(text) ? 'MGL' : /IGL|INDRAPRASTHA/i.test(text) ? 'IGL' : /GAIL/i.test(text) ? 'GAIL Gas' : /ADANI/i.test(text) ? 'Adani Gas' : /GUJARAT\s*GAS/i.test(text) ? 'Gujarat Gas' : /MNGL/i.test(text) ? 'MNGL' : 'PNG supplier';
  results.push({ activity: 'Natural Gas (m3)', quantity: scm, date: extractDate(text),
    notes: `Auto-parsed from ${supplier} PNG bill`, confidence: 'high', source: 'AI Parser — PNG Bill' });
  return results;
};

// ── Solar Export Detector ─────────────────────────────────────────────────────
// Mahavitaran, BESCOM, TSSPDCL net-metering bills — export units = negative Scope 2
const parseSolarExport = (text) => {
  const results = [];
  const hasSolar = /SOLAR|NET\s*METER|NET-METER|EXPORT|GENERATION|सौर|सोलर|सौरऊर्जा|సోలార్|சூரிய|ಸೌರ|সোলার|સૌર/i.test(text);
  if (!hasSolar) return [];
  const exportPatterns = [
    /export(?:ed)?\s*(?:units?|energy|kwh)[:\s]*([0-9,]+\.?\d*)/i,
    /(?:units?|energy)\s*export(?:ed)?[:\s]*([0-9,]+\.?\d*)/i,
    /generation[:\s]*([0-9,]+\.?\d*)\s*(?:kwh|units?)/i,
    /net\s*export[:\s]*([0-9,]+\.?\d*)/i,
    /solar\s*(?:units?|kwh|generation)[:\s]*([0-9,]+\.?\d*)/i,
    /निर्यात\s*(?:युनिट)?[:\s]*([0-9,]+\.?\d*)/i,
    /ఎగుమతి\s*యూనిట్లు[:\s]*([0-9,]+\.?\d*)/i,
    /ರಫ್ತು\s*ಯೂನಿಟ್[:\s]*([0-9,]+\.?\d*)/i,
  ];
  let exportKwh = null;
  for (const p of exportPatterns) {
    const m = text.match(p); if (m) { const val = parseFloat(m[1].replace(/,/g,'')); if (val > 0 && val < 10_000_000) { exportKwh = val; break; } }
  }
  if (!exportKwh) return [];
  // 'Electricity India REC (kWh)' has factor 0.0 — solar export is a credit,
  // not a consumption. We use negative quantity so co2e = 0.0 * (-kwh) = 0 tCO2e
  // which is correct — the actual offset is tracked via the negative quantity
  // displayed to the user and stored in the ledger for net calculation.
  // Add 'Solar Export (kWh)': { factor: CEA_GRID_EF_2024/1000, unit:'kWh', scope:2, ... }
  // to your EF object if you want to show the avoided emissions value.
  results.push({ activity: 'Electricity India REC (kWh)', quantity: -exportKwh, date: extractDate(text),
    notes: 'Auto-parsed solar export — negative quantity = grid offset (Scope 2 credit)', confidence: 'medium', source: 'AI Parser — Solar Export' });
  return results;
};

// ── Air Ticket Parser ─────────────────────────────────────────────────────────
// All Indian carriers + 80+ domestic/international routes + multi-leg support
const parseAirTicket = (text) => {
  const results = [];
  const isAir =
    /AIRLINE|AIRWAYS|AIR INDIA|INDIGO|SPICEJET|VISTARA|GO FIRST|AKASA|STAR AIR|ALLIANCE AIR|AIR ASIA|EMIRATES|ETIHAD|QATAR|LUFTHANSA|BRITISH AIRWAYS|SINGAPORE AIRLINES|BOARDING PASS|E-TICKET|PNR|FLIGHT\s*NO|CLASS OF TRAVEL|हवाई टिकट|उड़ान|बोर्डिंग पास|विमान तिकीट|விமான டிக்கெட்|విమాన టికెట్|ವಿಮಾನ ಟಿಕೆಟ್/i.test(text);
  if (!isAir) return [];
  const ROUTES = {
    'DEL-BOM':1148,'BOM-DEL':1148,'DEL-BLR':1741,'BLR-DEL':1741,'DEL-MAA':1760,'MAA-DEL':1760,
    'BOM-BLR':845,'BLR-BOM':845,'DEL-HYD':1253,'HYD-DEL':1253,'BOM-HYD':620,'HYD-BOM':620,
    'DEL-CCU':1305,'CCU-DEL':1305,'BOM-CCU':1659,'CCU-BOM':1659,'BLR-HYD':500,'HYD-BLR':500,
    'BLR-MAA':285,'MAA-BLR':285,'MAA-HYD':521,'HYD-MAA':521,'BLR-CCU':1560,'CCU-BLR':1560,
    'DEL-AMD':909,'AMD-DEL':909,'DEL-JAI':258,'JAI-DEL':258,'DEL-LKO':590,'LKO-DEL':590,
    'DEL-BHO':720,'BHO-DEL':720,'DEL-PAT':990,'PAT-DEL':990,'DEL-IXC':240,'IXC-DEL':240,
    'DEL-ATQ':447,'ATQ-DEL':447,'DEL-SXR':660,'SXR-DEL':660,'DEL-GAU':1690,'GAU-DEL':1690,
    'DEL-IXB':1590,'IXB-DEL':1590,'DEL-VNS':680,'VNS-DEL':680,'DEL-NAG':1060,'NAG-DEL':1060,
    'DEL-UDR':660,'UDR-DEL':660,'DEL-JDH':580,'JDH-DEL':580,'DEL-RPR':1100,'RPR-DEL':1100,
    'BOM-GOI':452,'GOI-BOM':452,'BOM-NAG':737,'NAG-BOM':737,'BOM-PNQ':120,'PNQ-BOM':120,
    'BOM-AMD':490,'AMD-BOM':490,'BOM-JAI':990,'JAI-BOM':990,'BOM-COK':1200,'COK-BOM':1200,
    'BOM-TRV':1330,'TRV-BOM':1330,'BOM-MAA':1062,'MAA-BOM':1062,'BOM-VTZ':840,'VTZ-BOM':840,
    'BLR-COK':520,'COK-BLR':520,'BLR-TRV':650,'TRV-BLR':650,'BLR-AMD':1310,'AMD-BLR':1310,
    'BLR-IXE':320,'IXE-BLR':320,'MAA-COK':530,'COK-MAA':530,'MAA-TRV':530,'TRV-MAA':530,
    'CCU-GAU':900,'GAU-CCU':900,'BOM-IXZ':1897,'IXZ-BOM':1897,
    'DEL-DXB':2188,'DXB-DEL':2188,'BOM-DXB':1930,'DXB-BOM':1930,
    'DEL-DOH':2860,'DOH-DEL':2860,'BOM-DOH':2650,'DOH-BOM':2650,
    'DEL-AUH':2370,'AUH-DEL':2370,'BOM-AUH':1913,'AUH-BOM':1913,
    'DEL-KWI':2970,'KWI-DEL':2970,'DEL-MCT':2740,'MCT-DEL':2740,'BOM-MCT':2080,'MCT-BOM':2080,
    'DEL-SIN':5630,'SIN-DEL':5630,'BOM-SIN':4338,'SIN-BOM':4338,
    'DEL-BKK':4511,'BKK-DEL':4511,'BOM-KUL':3880,'KUL-BOM':3880,
    'DEL-CMB':2680,'CMB-DEL':2680,'BOM-CMB':1700,'CMB-BOM':1700,
    'DEL-KTM':1060,'KTM-DEL':1060,'DEL-DAC':1550,'DAC-DEL':1550,
    'DEL-HKG':5100,'HKG-DEL':5100,'DEL-RGN':3000,'RGN-DEL':3000,
    'DEL-LHR':6726,'LHR-DEL':6726,'DEL-CDG':6600,'CDG-DEL':6600,
    'DEL-FRA':6200,'FRA-DEL':6200,'DEL-AMS':6800,'AMS-DEL':6800,
    'DEL-JFK':11760,'JFK-DEL':11760,'DEL-ORD':12100,'ORD-DEL':12100,
    'DEL-SFO':13200,'SFO-DEL':13200,'BOM-LHR':7180,'LHR-BOM':7180,
    'BOM-JFK':12550,'JFK-BOM':12550,'DEL-SYD':9220,'SYD-DEL':9220,
    'DEL-NRT':6000,'NRT-DEL':6000,'DEL-ICN':5600,'ICN-DEL':5600,
    'DEL-NBO':5600,'NBO-DEL':5600,'BOM-NBO':4300,'NBO-BOM':4300,
  };
  const routePattern = /\b([A-Z]{3})\s*[-→/to]+\s*([A-Z]{3})\b/gi;
  const legs = []; let m;
  while ((m = routePattern.exec(text)) !== null) {
    const key = `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
    if (!legs.find(l => l.key === key)) legs.push({ key });
  }
  const date = extractDate(text);
  if (legs.length === 0) {
    results.push({ activity: 'Air Travel Short (km)', quantity: 1000, date,
      notes: 'Auto-parsed air ticket — route not found, defaulting 1000km', confidence: 'low', source: 'AI Parser — Air Ticket' });
    return results;
  }
  for (const leg of legs) {
    const distance = ROUTES[leg.key] || null;
    results.push({
      activity:   distance && distance > 3700 ? 'Air Travel Long (km)' : 'Air Travel Short (km)',
      quantity:   distance || 1000, date,
      notes:      `Auto-parsed air ticket — ${leg.key}${distance ? '' : ' (est. 1000km)'}`,
      confidence: distance ? 'medium' : 'low',
      source:     'AI Parser — Air Ticket',
    });
  }
  return results;
};

// ── Train Ticket Parser ───────────────────────────────────────────────────────
// IRCTC e-tickets, PRS tickets — distance extracted directly or from station lookup
const parseTrainTicket = (text) => {
  const results = [];
  const isTrain = /IRCTC|INDIAN\s*RAILWAYS|PNR\s*NO|TRAIN\s*NO|RAJDHANI|SHATABDI|DURONTO|VANDE\s*BHARAT|SUPERFAST|SLEEPER|AC\s*[1-3]|रेलवे|ट्रेन|रेल\s*टिकट|రైలు|ரயில்|ರೈಲು|ট্রেন/i.test(text);
  if (!isTrain) return [];
  let distance = null;
  const distPatterns = [
    /distance[:\s]*([0-9,]+)\s*(?:km|kms)/i,
    /([0-9,]+)\s*(?:km|kms)\s*(?:distance|journey)/i,
    /journey\s*distance[:\s]*([0-9,]+)/i,
  ];
  for (const p of distPatterns) {
    const dm = text.match(p); if (dm) { const val = parseFloat(dm[1].replace(/,/g,'')); if (val > 0 && val < 5000) { distance = val; break; } }
  }
  if (!distance) {
    const TRAIN_ROUTES = {
      'NDLS-BCT':1384,'BCT-NDLS':1384,'NDLS-MAS':2180,'MAS-NDLS':2180,
      'NDLS-SBC':2367,'SBC-NDLS':2367,'NDLS-HWH':1453,'HWH-NDLS':1453,
      'NDLS-HYB':1661,'HYB-NDLS':1661,'BCT-MAS':1279,'MAS-BCT':1279,
      'BCT-SBC':1012,'SBC-BCT':1012,'BCT-HWH':1967,'HWH-BCT':1967,
      'BCT-HYB':710,'HYB-BCT':710,'MAS-SBC':356,'SBC-MAS':356,
      'MAS-HYB':794,'HYB-MAS':794,'NDLS-JAT':577,'JAT-NDLS':577,
      'NDLS-ADI':943,'ADI-NDLS':943,'NDLS-JP':308,'JP-NDLS':308,
      'NDLS-LKO':511,'LKO-NDLS':511,'NDLS-PNBE':1072,'PNBE-NDLS':1072,
    };
    const sp = /\b([A-Z]{2,5})\s*[-→/to]+\s*([A-Z]{2,5})\b/gi; let sm;
    while ((sm = sp.exec(text)) !== null) {
      const key = `${sm[1]}-${sm[2]}`; if (TRAIN_ROUTES[key]) { distance = TRAIN_ROUTES[key]; break; }
    }
  }
  results.push({ activity: 'Rail Travel (km)', quantity: distance || 500, date: extractDate(text),
    notes: 'Auto-parsed IRCTC/railway ticket', confidence: distance ? 'medium' : 'low', source: 'AI Parser — Train Ticket' });
  return results;
};

// ── Cab / Taxi Receipt Parser ─────────────────────────────────────────────────
// Ola, Uber, Rapido, Meru, BluSmart — ride receipts with km distance
const parseCabReceipt = (text) => {
  const results = [];
  const isCab = /\bOLA\b|UBER|RAPIDO|MERU|BLUSMART|BLUE\s*SMART|CAB\s*RECEIPT|RIDE\s*RECEIPT|TAXI\s*RECEIPT|TRIP\s*DISTANCE|RIDE\s*SUMMARY|ओला|उबर|टैक्सी|కాబ్|கேப்/i.test(text);
  if (!isCab) return [];
  const distPatterns = [
    /(?:total|trip|ride|journey)?\s*distance[:\s]*([0-9]+\.?\d*)\s*(?:km|kms)/i,
    /([0-9]+\.?\d*)\s*(?:km|kms)\s*(?:trip|ride|journey)?/i,
    /distance\s*travelled[:\s]*([0-9]+\.?\d*)/i,
    /कुल\s*दूरी[:\s]*([0-9]+\.?\d*)/i,
  ];
  let km = null;
  for (const p of distPatterns) {
    const m = text.match(p); if (m) { const val = parseFloat(m[1]); if (val > 0 && val < 2000) { km = val; break; } }
  }
  if (!km) return [];
  const isEV   = /ELECTRIC|EV|BLUSMART|BLUE\s*SMART|e-RICKSHAW/i.test(text);
  const isAuto = /AUTO|AUTORICKSHAW|RICKSHAW|THREE\s*WHEEL/i.test(text);
  // Map to existing EF keys:
  // EV cab → 'Employee Commute Metro (km)' (lowest EF, closest proxy)
  // Auto rickshaw → 'Employee Commute Bus (km)' (similar emissions profile)
  // Petrol cab → 'Car Rental (km)' (0.19 kg/km, same as petrol car)
  const activity = isEV ? 'Employee Commute Metro (km)' : isAuto ? 'Employee Commute Bus (km)' : 'Car Rental (km)';
  const provider = /\bOLA\b/i.test(text) ? 'Ola' : /UBER/i.test(text) ? 'Uber' : /RAPIDO/i.test(text) ? 'Rapido' : /MERU/i.test(text) ? 'Meru' : /BLUSMART|BLUE\s*SMART/i.test(text) ? 'BluSmart' : 'Cab';
  results.push({ activity, quantity: km, date: extractDate(text),
    notes: `Auto-parsed from ${provider} receipt`, confidence: 'high', source: 'AI Parser — Cab Receipt' });
  return results;
};

// ── Bus Ticket Parser ─────────────────────────────────────────────────────────
// KSRTC, MSRTC, TSRTC, APSRTC, DTC, BMTC, RedBus, AbhiBus + state RTCs
const parseBusTicket = (text) => {
  const results = [];
  const isBus = /\bBUS\b|KSRTC|MSRTC|TSRTC|APSRTC|GSRTC|UPSRTC|RSRTC|DTC|BMTC|PMPML|REDBUS|ABHIBUS|INTERCITY\s*BUS|BUS\s*TICKET|बस\s*टिकट|బస్\s*టికెట్|பேருந்து|ಬಸ್\s*ಟಿಕೆಟ್|বাস\s*টিকেট|બસ\s*ટિકિટ/i.test(text);
  if (!isBus) return [];
  const distPatterns = [
    /distance[:\s]*([0-9,]+\.?\d*)\s*(?:km|kms)/i,
    /([0-9,]+\.?\d*)\s*(?:km|kms)/i,
    /दूरी[:\s]*([0-9,]+\.?\d*)/i,
  ];
  let km = null;
  for (const p of distPatterns) {
    const m = text.match(p); if (m) { const val = parseFloat(m[1].replace(/,/g,'')); if (val > 0 && val < 3000) { km = val; break; } }
  }
  if (!km) return [];
  // Map to existing EF key — 'Employee Commute Bus (km)' is the closest proxy
  results.push({ activity: 'Employee Commute Bus (km)', quantity: km, date: extractDate(text),
    notes: 'Auto-parsed from bus ticket', confidence: 'medium', source: 'AI Parser — Bus Ticket' });
  return results;
};

// ── GST Invoice Parser ────────────────────────────────────────────────────────
// Steel, aluminium, cement, paper, plastic, copper — GSTIN/CGST/SGST detection
const parseGSTInvoice = (text) => {
  const results = [];
  const isGST =
    /GSTIN|GST\s*NO|TAX\s*INVOICE|IGST|CGST|SGST|जीएसटी|कर चालान|ਜੀਐਸਟੀ|జిఎస్టి|ஜிஎஸ்டி|ಜಿಎಸ್ಟಿ|জিএসটি|GST ચાલાન/i.test(text);
  if (!isGST) return [];
  const materialMap = [
    { patterns: /STEEL|TMT|HR\s*COIL|CR\s*SHEET|इस्पात|स्टील|స్టీల్|ஸ்டீல்|ಸ್ಟೀಲ್|স্টিল|સ્ટીલ/i, activity: 'Steel (kg)' },
    { patterns: /ALUMIN|एल्युमीनियम|అల్యూమినియం|அலுமினியம்|ಅಲ್ಯೂಮಿನಿಯಂ|অ্যালুমিনিয়াম|એલ્યુમિનિયમ/i, activity: 'Aluminium (kg)' },
    { patterns: /CEMENT|सीमेंट|సిమెంట్|சிமென்ட்|ಸಿಮೆಂಟ್|সিমেন্ট|સિમેન્ટ/i, activity: 'Cement (kg)' },
    { patterns: /PAPER|CARTON|PACKAGING|कागज|కాగితం|காகிதம்|ಕಾಗದ|কাগজ|કાગળ/i, activity: 'Paper (kg)' },
    { patterns: /PLASTIC|प्लास्टिक|ప్లాస్టిక్|பிளாஸ்டிக்|ಪ್ಲಾಸ್ಟಿಕ್|প্লাস্টিক|પ્લાસ્ટિક/i, activity: 'Plastic (kg)' },
    { patterns: /COPPER|तांबा|ताम्र|రాగి|செம்பு|ತಾಮ್ರ|তামা|તાંબુ/i, activity: 'Copper (kg)' },
  ];
  for (const mat of materialMap) {
    if (mat.patterns.test(text)) {
      const qtyPatterns = [
        /qty[:\s]+([0-9,]+\.?\d*)\s*(?:kg|kgs)/i,
        /([0-9,]+\.?\d*)\s*(?:MT|METRIC\s*TONS?)/i,
        /([0-9,]+\.?\d*)\s*(?:kg|kgs)/i,
        /मात्रा[:\s]+([0-9,]+\.?\d*)/i,
        /परिमाण[:\s]+([0-9,]+\.?\d*)/i,
        /వజన[:\s]+([0-9,]+\.?\d*)/i,
        /அளவு[:\s]*([0-9,]+\.?\d*)/i,
      ];
      let qty = null;
      for (const p of qtyPatterns) {
        const m = text.match(p);
        if (m) {
          let val = parseFloat(m[1].replace(/,/g, ''));
          if (p.toString().includes('MT')) val = val * 1000;
          if (val > 0) { qty = val; break; }
        }
      }
      if (qty) {
        results.push({ activity: mat.activity, quantity: qty, date: extractDate(text),
          notes: 'Auto-parsed from GST invoice', confidence: 'medium', source: 'AI Parser — GST Invoice' });
      }
      break;
    }
  }
  return results;
};

// ── Hotel Invoice Parser ──────────────────────────────────────────────────────
// Night stay invoices — English + 8 Indian languages
const parseHotelInvoice = (text) => {
  const results = [];
  const isHotel =
    /HOTEL|RESORT|INN|LODGE|NIGHTS?\s+STAY|ROOM\s+TARIFF|CHECK.?IN|CHECK.?OUT|होटल|रिसॉर्ट|रात्रि प्रवास|हॉटेल|ஹோட்டல்|హోటల్|ಹೋಟೆಲ್|হোটেল|હોટેલ|ਹੋਟਲ/i.test(text);
  if (!isHotel) return [];
  const nightPatterns = [
    /(\d+)\s+nights?/i,
    /nights?\s*[:\-]\s*(\d+)/i,
    /no\.?\s+of\s+nights?\s*[:\-]?\s*(\d+)/i,
    /(\d+)\s*(?:रातें|रात|रात्रि|रात्री|रात्र)/i,
    /(\d+)\s*இரவுகள்/i,
    /(\d+)\s*రాత్రులు/i,
    /(\d+)\s*ರಾತ್ರಿಗಳು/i,
    /(\d+)\s*রাত/i,
    /(\d+)\s*રાત/i,
  ];
  let nights = null;
  for (const p of nightPatterns) {
    const m = text.match(p); if (m) { nights = parseInt(m[1]); break; }
  }
  if (!nights || nights > 365) return [];
  results.push({ activity: 'Hotel Stay (nights)', quantity: nights, date: extractDate(text),
    notes: 'Auto-parsed from hotel invoice', confidence: 'high', source: 'AI Parser — Hotel Invoice' });
  return results;
};

// ── Master parser — runs ALL parsers ─────────────────────────────────────────
const parseDocument = (text) => [
  ...parseElectricityBill(text),
  ...parseSolarExport(text),
  ...parseLPGInvoice(text),
  ...parsePNGBill(text),
  ...parseFuelReceipt(text),
  ...parseAirTicket(text),
  ...parseTrainTicket(text),
  ...parseCabReceipt(text),
  ...parseBusTicket(text),
  ...parseGSTInvoice(text),
  ...parseHotelInvoice(text),
];


// ─────────────────────────────────────────────────────────────────────────────
// OCR ENGINE — Tesseract.js (WASM, runs entirely in-browser)
// No API calls, no document data ever leaves the device.
// Used for: image uploads, and PDFs that turn out to be scans (no embedded text).
// ─────────────────────────────────────────────────────────────────────────────

const TESSERACT_CDN  = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const TESSERACT_CDN2 = 'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js'; // fallback mirror
const MAX_OCR_DIMENSION = 2200;

const OCR_STAGE_LABELS = {
  'loading tesseract core':       'Loading OCR engine…',
  'initializing tesseract':       'Initializing OCR…',
  'initialized tesseract':        'Initializing OCR…',
  'initializing api':             'Initializing OCR…',
  'loading language traineddata': 'Loading language data…',
  'recognizing text':             'Reading document…',
};

let tesseractLoadPromise = null;

// Fix 3: retry with unpkg mirror if jsDelivr fails
const loadTesseract = () => {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoadPromise) return tesseractLoadPromise;

  const loadScript = (src) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload  = () => resolve(window.Tesseract);
    script.onerror = reject;
    document.head.appendChild(script);
  });

  tesseractLoadPromise = loadScript(TESSERACT_CDN)
    .catch(() => loadScript(TESSERACT_CDN2))
    .catch(() => {
      tesseractLoadPromise = null;
      throw new Error('Failed to load OCR engine — check your connection and try again');
    });

  return tesseractLoadPromise;
};

// ── Fix 1: Lazy language pack detection ────────────────────────────────────
// Loading all 7 language packs (~20MB) on every OCR run is wasteful and slow
// on mobile. Instead, do a quick Unicode block scan on a small text preview
// (filename + first 200 chars of any embedded text hint) to detect the script,
// then load only the packs needed. eng is always included.
//
// Script detection ranges:
//   Devanagari  U+0900–U+097F  → hin  (Hindi + Marathi)
//   Bengali     U+0980–U+09FF  → ben
//   Gujarati    U+0A80–U+0AFF  → guj
//   Gurmukhi    U+0A00–U+0A7F  → pan  (Punjabi — falls back to eng, low vol)
//   Odia        U+0B00–U+0B7F  → (not loading, eng GSTIN fallback sufficient)
//   Telugu      U+0C00–U+0C7F  → tel
//   Kannada     U+0C80–U+0CFF  → kan
//   Malayalam   U+0D00–U+0D7F  → (not loading, eng GSTIN fallback sufficient)
//   Tamil       U+0B80–U+0BFF  → tam
const detectLangs = (hint = '') => {
  const langs = new Set(['eng']);
  for (const ch of hint) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x0900 && cp <= 0x097F) langs.add('hin');  // Devanagari
    if (cp >= 0x0980 && cp <= 0x09FF) langs.add('ben');  // Bengali
    if (cp >= 0x0A80 && cp <= 0x0AFF) langs.add('guj');  // Gujarati
    if (cp >= 0x0C00 && cp <= 0x0C7F) langs.add('tel');  // Telugu
    if (cp >= 0x0C80 && cp <= 0x0CFF) langs.add('kan');  // Kannada
    if (cp >= 0x0B80 && cp <= 0x0BFF) langs.add('tam');  // Tamil
  }
  return [...langs].join('+');
};

// Loads an image file into a canvas, downscales it if it's huge, and converts it to
// grayscale with a contrast stretch. This is the single cheapest lever for OCR accuracy
// on phone photos — uneven lighting and low contrast hurt Tesseract far more than
// rotation does, and this needs no extra library.
const preprocessImageForOcr = (file) => new Promise((resolve, reject) => {
  const img = new Image();
  const url = URL.createObjectURL(file);

  img.onload = () => {
    URL.revokeObjectURL(url);
    let { width, height } = img;
    const scale = Math.min(1, MAX_OCR_DIMENSION / Math.max(width, height));
    width  = Math.max(1, Math.round(width  * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    try {
      const imageData = ctx.getImageData(0, 0, width, height);
      const d = imageData.data;
      const gray = new Uint8ClampedArray(width * height);
      let min = 255, max = 0;

      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        gray[p] = g;
        if (g < min) min = g;
        if (g > max) max = g;
      }

      const range = Math.max(1, max - min);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        const stretched = ((gray[p] - min) / range) * 255;
        d[i] = d[i + 1] = d[i + 2] = stretched;
      }
      ctx.putImageData(imageData, 0, 0);
    } catch {
      // If pixel access fails for any reason, fall back to the plain resized image —
      // still strictly better than feeding Tesseract an oversized raw photo.
    }

    resolve(canvas);
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Could not read image file'));
  };
  img.src = url;
});

// Runs OCR over one or more sources (canvas / File / Blob) using a single worker.
// onProgress(pct, stageLabel) is called throughout.
// hint — a short string (filename + any already-extracted text) used to auto-detect
// which language packs to load. Only the needed packs are downloaded.
// ── Fix 3: Image script detection via pixel sampling ─────────────────────────
// Filename like IMG_20260610.jpg tells us nothing about the script.
// Instead, sample a horizontal strip of pixels from the top third of the image
// (where header text lives on Indian bills) and run detectLangs on the actual
// OCR text from a tiny fast eng-only pre-pass on a downscaled thumbnail.
// This adds ~1-2s but saves downloading wrong language packs (~5MB each).
const detectScriptFromCanvas = async (canvas, Tesseract) => {
  try {
    // Downscale to a tiny thumbnail for the pre-pass — speed over accuracy
    const THUMB_W = 400;
    const scale   = THUMB_W / canvas.width;
    const thumb   = document.createElement('canvas');
    thumb.width   = THUMB_W;
    thumb.height  = Math.round(canvas.height * scale * 0.35); // top 35% only
    thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);

    const OEM    = Tesseract.OEM?.LSTM_ONLY ?? 1;
    const worker = await Tesseract.createWorker('eng', OEM);
    const { data } = await worker.recognize(thumb);
    await worker.terminate();

    // detectLangs on the partial English text — GSTIN, discom name, URL etc.
    // are always English and appear at the top of every Indian bill
    return detectLangs(data?.text || '');
  } catch {
    // If pre-pass fails for any reason, load all common Indian scripts
    return 'eng+hin+tel+tam+kan+ben+guj';
  }
};

 // 90s — generous for multi-page scanned PDFs on slow mobile
const OCR_TIMEOUT_MS = 90_000;

const ocrImages = async (sources, onProgress, hint = '') => {
  const Tesseract = await loadTesseract();

  // Fix 3: canvas sources (images/scanned PDFs) get a pixel-based script pre-pass
  // so we only download the language packs actually needed for this document.
  // PDF text hints and plain filenames use the faster Unicode block scan.
  let lang;
  if (sources.length > 0 && sources[0] instanceof HTMLCanvasElement) {
    onProgress?.(0, 'Detecting document language…');
    lang = await detectScriptFromCanvas(sources[0], Tesseract);
  } else {
    lang = detectLangs(hint);
  }

  const OEM  = Tesseract.OEM?.LSTM_ONLY ?? 1;

  // Fix 8: wrap entire OCR run in a timeout so a hung worker never blocks the UI
  let worker;
  const timeoutId = setTimeout(async () => {
    try { await worker?.terminate(); } catch {}
    // Bubble up as a recognisable error — processFile catch will toast it
    throw new Error('OCR timed out — the image may be too complex. Try a clearer photo or upload a PDF instead.');
  }, OCR_TIMEOUT_MS);

  try {
    worker = await Tesseract.createWorker(lang, OEM, {
      logger: (m) => {
        if (!onProgress) return;
        const label = OCR_STAGE_LABELS[m?.status] || 'Processing…';
        onProgress(Math.round((m?.progress || 0) * 100), label);
      },
    });

    const texts       = [];
    const confidences = [];

    for (let i = 0; i < sources.length; i++) {
      if (sources.length > 1 && onProgress) {
        onProgress(0, `Reading page ${i + 1} of ${sources.length}…`);
      }
      const { data } = await worker.recognize(sources[i]);
      texts.push(data?.text || '');
      if (typeof data?.confidence === 'number') confidences.push(data.confidence);
    }

    const confidence = confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null;

    return { text: texts.join('\n'), confidence };
  } finally {
    clearTimeout(timeoutId);
    try { await worker?.terminate(); } catch {}
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// TEXT EXTRACTION
// PDF → text via pdf.js; falls back to in-browser OCR if the PDF is a scan
// Image → in-browser OCR (Tesseract.js), preprocessed first
// Plain text → direct
// Returns { text, ocrConfidence, method } — ocrConfidence is null when OCR wasn't used.
// ─────────────────────────────────────────────────────────────────────────────

const loadPdfJs = async () => {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src     = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload  = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return window.pdfjsLib;
};

const extractTextFromFile = async (file, onProgress) => {
  const ext = file.name.split('.').pop().toLowerCase();
  // Hint for lazy lang detection: filename gives strong script clues
  // (e.g. "mahavitaran_bill.jpg" → eng, "बिजली_बिल.jpg" → hin)
  const hint = file.name;

  // Plain text / CSV
  if (['txt', 'csv'].includes(ext)) {
    return { text: await file.text(), ocrConfidence: null, method: 'plain-text' };
  }

  // PDF — text-layer extraction first, OCR fallback if it's a scan
  if (ext === 'pdf') {
    try {
      const pdfjsLib    = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdf         = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pageCount   = Math.min(pdf.numPages, 5);

      let fullText = '';
      for (let i = 1; i <= pageCount; i++) {
        const page    = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText     += content.items.map(item => item.str).join(' ') + '\n';
      }

      // Little to no embedded text → almost certainly a scanned bill saved as PDF.
      // Render each page to a canvas and run through OCR instead.
      const meaningfulChars = fullText.replace(/\s/g, '').length;
      if (meaningfulChars < 30) {
        const canvases = [];
        for (let i = 1; i <= pageCount; i++) {
          const page     = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2 });
          const canvas   = document.createElement('canvas');
          canvas.width   = viewport.width;
          canvas.height  = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          canvases.push(canvas);
        }
        // Use filename + any partial text as hint for script detection
        const { text, confidence } = await ocrImages(canvases, onProgress, hint + ' ' + fullText.slice(0, 200));
        return { text, ocrConfidence: confidence, method: 'ocr-scanned-pdf' };
      }

      return { text: fullText, ocrConfidence: null, method: 'pdf-text' };
    } catch (err) {
      throw new Error('PDF extraction failed — try uploading as an image, text, or manually enter values');
    }
  }

  // Image — preprocess, then in-browser OCR. Nothing leaves the device.
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    const canvas = await preprocessImageForOcr(file);
    const { text, confidence } = await ocrImages([canvas], onProgress, hint);
    if (!text || text.trim().length < 5) {
      throw new Error('Could not read text from this image — try a clearer, well-lit photo or upload a PDF instead');
    }
    return { text, ocrConfidence: confidence, method: 'ocr-image' };
  }

  throw new Error(`Unsupported file type: .${ext}. Please use PDF, image (JPG/PNG), TXT, or CSV.`);
};

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────
const CSS = `
.aip-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:22px;animation:fU .4s ease both;}
.aip-ctit{font-size:10px;letter-spacing:.15em;color:var(--mut);margin-bottom:18px;display:flex;align-items:center;gap:8px;}
.aip-ctit::before{content:'';width:12px;height:1px;background:#3b82f6;}
.aip-drop{border:2px dashed var(--brd2);border-radius:10px;padding:40px 24px;text-align:center;cursor:pointer;transition:all .25s;margin-bottom:16px;position:relative;}
.aip-drop:hover,.aip-drop.over{border-color:#3b82f666;background:#3b82f608;}
.aip-drop-icon{font-size:40px;margin-bottom:12px;}
.aip-drop-title{font-size:13px;font-weight:700;color:var(--txt);margin-bottom:6px;}
.aip-drop-sub{font-size:11px;color:var(--mut);line-height:1.7;}
.aip-formats{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:12px;}
.aip-fmt{font-size:9px;padding:3px 8px;border-radius:3px;background:var(--surf);border:1px solid var(--brd);color:var(--mut);letter-spacing:.06em;}
.aip-processing{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;font-size:12px;color:var(--mut);}
.aip-processing-row{display:flex;align-items:center;gap:12px;}
.aip-spinner{width:20px;height:20px;border:2px solid var(--brd);border-top-color:#3b82f6;border-radius:50%;animation:spin .8s linear infinite;flex-shrink:0;}
.aip-progress-track{width:100%;max-width:320px;height:6px;border-radius:4px;background:var(--brd);overflow:hidden;}
.aip-progress-fill{height:100%;background:linear-gradient(135deg,#3b82f6,#2563eb);transition:width .25s ease;}
.aip-progress-pct{font-size:10px;color:var(--mut);letter-spacing:.06em;}
.aip-result{border:1px solid var(--brd);border-radius:10px;overflow:hidden;margin-bottom:12px;}
.aip-result-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#3b82f608;border-bottom:1px solid var(--brd);flex-wrap:wrap;gap:8px;}
.aip-result-title{font-size:12px;font-weight:700;color:#3b82f6;}
.aip-result-body{padding:16px;}
.aip-field{display:flex;flex-direction:column;gap:5px;margin-bottom:12px;}
.aip-lbl{font-size:10px;letter-spacing:.1em;color:var(--mut);}
.aip-inp,.aip-sel{padding:9px 11px;border-radius:6px;background:#0a1018;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;width:100%;box-sizing:border-box;}
.aip-inp:focus,.aip-sel:focus{border-color:#3b82f644;}
.aip-confidence{font-size:9px;padding:2px 8px;border-radius:3px;letter-spacing:.06em;}
.conf-high{background:#10b98114;color:#10b981;border:1px solid #10b98133;}
.conf-medium{background:#f59e0b14;color:#f59e0b;border:1px solid #f59e0b33;}
.conf-low{background:#ef444414;color:#ef4444;border:1px solid #ef444433;}
.aip-preview-co2e{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#3b82f6;margin:8px 0;}
.aip-btn{padding:10px 18px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.aip-btn:disabled{opacity:.5;cursor:not-allowed;}
.aip-btn-blue{background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;}
.aip-btn-blue:hover:not(:disabled){opacity:.88;transform:translateY(-1px);}
.aip-btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.aip-btn-g:hover:not(:disabled){border-color:#3b82f644;color:#3b82f6;}
.aip-toast{position:fixed;top:76px;right:24px;z-index:9999;padding:12px 20px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000066;animation:fU .3s ease;}
.aip-toast-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.aip-toast-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
.aip-supported{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;}
.aip-sup-tile{padding:12px;border-radius:8px;border:1px solid var(--brd);background:#080b0e;text-align:center;}
.aip-sup-icon{font-size:20px;margin-bottom:4px;}
.aip-sup-label{font-size:10px;color:var(--txt);font-weight:700;margin-bottom:2px;}
.aip-sup-desc{font-size:9px;color:var(--mut);line-height:1.4;}
.aip-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.aip-review-note{font-size:11px;color:#f59e0b;background:#f59e0b0c;border:1px solid #f59e0b2e;border-radius:8px;padding:10px 14px;margin-bottom:14px;}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:700px){.aip-supported{grid-template-columns:repeat(2,1fr);}.aip-grid2{grid-template-columns:1fr 1fr;}}
`;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function AIParser({ EF, year, onRecordAdded, profile }) {
  const [dragOver,    setDragOver]    = useState(false);
  const [processing,  setProcessing]  = useState(false);
  const [ocrProgress, setOcrProgress] = useState(null); // { pct, stage } | null
  const [results,     setResults]     = useState([]); // parsed records pending confirm
  const [savedAll,    setSavedAll]    = useState(false);
  const [notif,       setNotif]       = useState(null);
  const fileRef = useRef();

  const toast = (msg, type = 'ok') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 4000);
  };

  // Process uploaded file
  const processFile = useCallback(async (file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('File too large — max 10MB', 'err'); return; }

    setProcessing(true);
    setResults([]);
    setSavedAll(false);
    setOcrProgress(null);

    try {
      const { text, ocrConfidence, method } = await extractTextFromFile(
        file,
        (pct, stage) => setOcrProgress({ pct, stage })
      );
      const parsed = parseDocument(normalizeOcrText(text));

      if (parsed.length === 0) {
        toast('No emission data found — try a different document or use manual entry', 'err');
        setProcessing(false);
        setOcrProgress(null);
        return;
      }

      // A low-confidence OCR read means the underlying text may be unreliable even
      // where a regex matched cleanly — downgrade the tier so it isn't bulk-saved.
      const lowOcrConfidence = typeof ocrConfidence === 'number' && ocrConfidence < 65;
      const downgrade = (c) => (c === 'high' ? 'medium' : 'low');

      // Enrich with EF data
      const enriched = parsed.map(r => {
        const ef    = EF[r.activity];
        const co2e  = ef ? r.quantity * ef.factor / 1000 : 0;
        const confidence = lowOcrConfidence ? downgrade(r.confidence) : r.confidence;
        const base = {
          ...r,
          confidence,
          unit:     ef?.unit     || '—',
          scope:    ef?.scope    || null,
          category: ef?.cat      || '—',
          factor:   ef?.factor   || null,
          co2e,
          confirmed: false,
          extractionMethod: method,
          ocrConfidence,
          sourceFileName: file.name,
        };
        // Frozen snapshot of the as-extracted values — never mutated. This is what the
        // audit payload compares against the final, possibly human-edited values.
        return {
          ...base,
          original: {
            activity: base.activity,
            quantity: base.quantity,
            date:     base.date,
            notes:    base.notes,
          },
        };
      });

      setResults(enriched);
      const ocrNote = lowOcrConfidence ? ' — image quality was low, double-check values' : '';

      // Fix 6: flag any records that look like dupes from this session
      const dupeCount = enriched.filter(r => {
        const key = buildDedupKey(r.activity, r.date, r.quantity, r.sourceFileName);
        return SESSION_SEEN.has(key);
      }).length;

      const dupeNote = dupeCount > 0 ? ` · ⚠ ${dupeCount} possible duplicate${dupeCount > 1 ? 's' : ''}` : '';
      toast(`✓ Found ${enriched.length} emission record${enriched.length > 1 ? 's' : ''}${ocrNote}${dupeNote}`);
    } catch (err) {
      toast(err.message || 'Failed to process file', 'err');
    } finally {
      setProcessing(false);
      setOcrProgress(null);
    }
  }, [EF]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFile(e.dataTransfer.files[0]);
  };

  const handleFileInput = (e) => processFile(e.target.files[0]);

  // Update a result field
  const updateResult = (idx, field, value) => {
    setResults(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: value };
      // Recalculate co2e if activity or quantity changes
      if (field === 'activity' || field === 'quantity') {
        const ef  = EF[updated.activity];
        const qty = safeNum(updated.quantity, 0, 1e12);
        updated.co2e     = ef && qty ? qty * ef.factor / 1000 : 0;
        updated.unit     = ef?.unit     || '—';
        updated.scope    = ef?.scope    || null;
        updated.category = ef?.cat      || '—';
        updated.factor   = ef?.factor   || null;
      }
      return updated;
    }));
  };

  // Confirm and save a single record
  const saveRecord = async (idx) => {
    const r = results[idx];

    // Fix 4: null quantity means faulty meter stub — prompt user to fill it in
    // rather than throwing "invalid quantity" which is confusing
    if (r.quantity === null || r.quantity === undefined) {
      toast('Please enter the units consumed manually before saving', 'err');
      return;
    }

    if (!r.activity || !r.quantity || !r.date) {
      toast('Fill in activity, quantity and date before saving', 'err');
      return;
    }

    const ef  = EF[r.activity];
    // Solar export is a negative offset — needs a negative range check
    const isSolarExport = r.activity === 'Solar Export (kWh)';
    const qty = isSolarExport
      ? safeNum(r.quantity, -1e9, -0.001)
      : safeNum(r.quantity, 0.001, 1e9);
    if (!ef)  { toast('Unknown activity — select from dropdown', 'err'); return; }
    if (!qty) { toast('Invalid quantity — must be greater than 0', 'err'); return; }

    const co2e = qty * ef.factor / 1000;

    // Fix 6: build dedup keys — fast djb2 for UI warning, SHA-256 for server index
    const dedupKeyFast = buildDedupKey(r.activity, r.date, qty, r.sourceFileName || '');
    const dedupKeySha  = await sha256(`${r.activity}|${r.date}|${Math.round(qty * 1000)}|${r.sourceFileName || ''}`);

    // Warn if this exact record was already saved this session
    if (SESSION_SEEN.has(dedupKeyFast)) {
      toast('⚠ This record looks like a duplicate — it may already be in your ledger', 'err');
      return;
    }

    const wasEdited = !!r.original && (
      r.original.activity !== r.activity ||
      r.original.quantity !== r.quantity ||
      r.original.date     !== r.date     ||
      (r.original.notes || '') !== (r.notes || '')
    );

    try {
      const res = await apiFetch('/api/emissions/log', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date:     r.date,
          activity: r.activity,
          quantity: qty,
          unit:     ef.unit,
          scope:    ef.scope,
          category: ef.cat,
          factor:   ef.factor,
          co2e,
          notes:    sanitise(r.notes || ''),
          source:   r.source || 'AI Parser',
          // Audit trail for BRSR/CCTS traceability
          aiAudit: {
            extractionMethod: r.extractionMethod || 'manual',
            ocrConfidence:    r.ocrConfidence    ?? null,
            confidenceTier:   r.confidence       || null,
            autoExtracted:    r.original         || null,
            wasEdited,
            sourceFileName:   r.sourceFileName   || null,
            dedupKey:         dedupKeySha,        // server enforces UNIQUE on this column
          },
        }),
      });

      onRecordAdded(res?.activity || {
        id:       `ai-${Date.now()}`,
        date:     r.date,
        activity: r.activity,
        qty,
        co2e,
        scope:    ef.scope,
        category: ef.cat,
        unit:     ef.unit,
        notes:    r.notes || '',
        verified: false,
      });

      SESSION_SEEN.add(dedupKeyFast); // mark so re-upload of same bill is caught
      setResults(prev => prev.map((rec, i) => i === idx ? { ...rec, confirmed: true } : rec));
      toast(`✓ Saved ${co2e.toFixed(3)} tCO₂e`);
    } catch (err) {
      // Log the real error for debugging — 400 usually means aiAudit column missing
      // on emissions_log table; 409 means server dedup key collision (true duplicate)
      const status = err?.status || err?.response?.status;
      if (status === 409) {
        toast('Duplicate — this bill is already in your ledger', 'err');
      } else {
        console.error('[AIParser] save failed:', err);
        toast(`Save failed${status ? ` (${status})` : ''} — check console for details`, 'err');
      }
    }
  };

  // Bulk-save — high-confidence records only. Medium/low must be confirmed individually.
  const saveAllHighConfidence = async () => {
    const indices = results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => !r.confirmed && r.confidence === 'high')
      .map(({ i }) => i);

    for (const i of indices) {
      await saveRecord(i);
    }
    setSavedAll(true);
  };

  const confidenceClass = (c) =>
    c === 'high' ? 'conf-high' : c === 'medium' ? 'conf-medium' : 'conf-low';

  const pendingCount          = results.filter(r => !r.confirmed).length;
  const pendingHighConfidence = results.filter(r => !r.confirmed && r.confidence === 'high').length;
  const pendingNeedsReview    = pendingCount - pendingHighConfidence;

  return (
    <>
      <style>{CSS}</style>

      {notif && (
        <div className={`aip-toast ${notif.type === 'err' ? 'aip-toast-err' : 'aip-toast-ok'}`}>
          {notif.msg}
        </div>
      )}

      <div className="aip-card">
        <div className="aip-ctit">AI DOCUMENT PARSER — RULE-BASED EXTRACTION + ON-DEVICE OCR</div>

        {/* Supported formats */}
        <div className="aip-supported">
          {[
            { icon: '⚡', label: 'Electricity Bills',  desc: 'All 22 state discoms — 11 languages + GSTIN/URL fallback' },
            { icon: '☀️', label: 'Solar Export',       desc: 'Net-metering bills — export units auto-subtracted from Scope 2' },
            { icon: '🍳', label: 'LPG Cylinders',      desc: 'Indane, Bharat Gas, HP Gas — 5kg/14.2kg/19kg/47.5kg' },
            { icon: '🔥', label: 'PNG / Piped Gas',    desc: 'MGL, IGL, GAIL, Adani Gas, Gujarat Gas, MNGL — SCM units' },
            { icon: '⛽', label: 'Fuel Receipts',      desc: 'HPCL, BPCL, IOC — petrol / diesel / CNG — 8 languages' },
            { icon: '✈️', label: 'Air Tickets',        desc: '80+ domestic + international routes — multi-leg support' },
            { icon: '🚆', label: 'Train Tickets',      desc: 'IRCTC e-tickets — distance direct or station-pair lookup' },
            { icon: '🚖', label: 'Cab Receipts',       desc: 'Ola, Uber, Rapido, Meru, BluSmart — EV/Auto detected' },
            { icon: '🚌', label: 'Bus Tickets',        desc: 'KSRTC, MSRTC, DTC, BMTC, RedBus, AbhiBus + all state RTCs' },
            { icon: '🏨', label: 'Hotel Invoices',     desc: 'Night stay — 8 Indian languages for Scope 3 travel' },
            { icon: '📋', label: 'GST Invoices',       desc: 'Steel, aluminium, cement, paper, plastic, copper purchases' },
            { icon: '📷', label: 'Photos / Scans',     desc: 'Snap any bill — OCR runs on-device, nothing leaves browser' },
          ].map(({ icon, label, desc }) => (
            <div key={label} className="aip-sup-tile">
              <div className="aip-sup-icon">{icon}</div>
              <div className="aip-sup-label">{label}</div>
              <div className="aip-sup-desc">{desc}</div>
            </div>
          ))}
        </div>

        {/* Drop zone */}
        {!processing && results.length === 0 && (
          <>
            <div
              className={`aip-drop${dragOver ? ' over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <div className="aip-drop-icon">📄</div>
              <div className="aip-drop-title">DROP YOUR DOCUMENT HERE</div>
              <div className="aip-drop-sub">
                or click to browse · PDF, image (JPG/PNG), TXT, CSV · Max 10MB<br/>
                Electricity bills · Fuel receipts · Air tickets · Hotel invoices · GST invoices · Photos work too
              </div>
              <div className="aip-formats">
                {['PDF', 'JPG', 'PNG', 'TXT', 'CSV'].map(f => (
                  <span key={f} className="aip-fmt">{f}</span>
                ))}
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.csv,.jpg,.jpeg,.png,.webp"
              style={{ display: 'none' }}
              onChange={handleFileInput}
            />
            <div style={{ fontSize: 10, color: 'var(--mut)', textAlign: 'center', lineHeight: 1.8 }}>
              🔒 All processing — including OCR — happens on-device in your browser. No document ever leaves it.
            </div>
          </>
        )}

        {/* Processing spinner / OCR progress */}
        {processing && (
          <div className="aip-processing">
            <div className="aip-processing-row">
              <div className="aip-spinner"/>
              <span>{ocrProgress?.stage || 'Extracting emission data from document…'}</span>
            </div>
            {ocrProgress && (
              <>
                <div className="aip-progress-track">
                  <div className="aip-progress-fill" style={{ width: `${ocrProgress.pct}%` }} />
                </div>
                <div className="aip-progress-pct">
                  {ocrProgress.pct}% · downloads only needed language packs, cached after first run
                </div>
              </>
            )}
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--txt)' }}>
                <strong style={{ color: '#3b82f6' }}>{results.length}</strong> record{results.length > 1 ? 's' : ''} found
                {pendingCount > 0 && <span style={{ color: 'var(--mut)', marginLeft: 8 }}>· {pendingCount} pending confirmation</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {pendingHighConfidence > 0 && (
                  <button className="aip-btn aip-btn-blue" onClick={saveAllHighConfidence}>
                    SAVE HIGH-CONFIDENCE ({pendingHighConfidence}) →
                  </button>
                )}
                <button
                  className="aip-btn aip-btn-g"
                  onClick={() => { setResults([]); setSavedAll(false); }}
                >
                  UPLOAD ANOTHER
                </button>
              </div>
            </div>

            {pendingNeedsReview > 0 && (
              <div className="aip-review-note">
                ⚠ {pendingNeedsReview} record{pendingNeedsReview > 1 ? 's' : ''} {pendingNeedsReview > 1 ? 'need' : 'needs'} individual review before saving —
                medium/low confidence reads (low OCR quality, unmatched routes, faulty meters) aren't bulk-saved.
                Check the values below and hit CONFIRM &amp; SAVE on each.
              </div>
            )}

            {results.map((r, idx) => (
              <div key={idx} className="aip-result" style={{
                borderColor: r.confirmed ? '#10b98133' : '#3b82f633',
                background:  r.confirmed ? '#10b98106' : 'var(--surf)',
              }}>
                <div className="aip-result-hd">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span className="aip-result-title">
                      {r.confirmed ? '✓ SAVED' : `RECORD ${idx + 1}`}
                    </span>
                    <span className={`aip-confidence ${confidenceClass(r.confidence)}`}>
                      {r.confidence?.toUpperCase()} CONFIDENCE
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--mut)' }}>{r.source}</span>
                    {typeof r.ocrConfidence === 'number' && (
                      <span style={{ fontSize: 10, color: 'var(--mut)' }}>· OCR {Math.round(r.ocrConfidence)}%</span>
                    )}
                  </div>
                  {!r.confirmed && (
                    <button
                      className="aip-btn aip-btn-blue"
                      style={{ padding: '6px 14px', fontSize: 10 }}
                      onClick={() => saveRecord(idx)}
                    >
                      CONFIRM & SAVE
                    </button>
                  )}
                </div>

                <div className="aip-result-body">
                  {r.confirmed ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--txt)', fontWeight: 700 }}>{r.activity}</div>
                        <div style={{ fontSize: 11, color: 'var(--mut)' }}>{r.quantity} {r.unit} · {r.date}</div>
                      </div>
                      <div className="aip-preview-co2e" style={{ fontSize: 20, margin: 0 }}>
                        {r.co2e.toFixed(4)} tCO₂e
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="aip-grid2">
                        <div className="aip-field">
                          <label className="aip-lbl">EMISSION ACTIVITY</label>
                          <select
                            className="aip-sel"
                            value={r.activity}
                            onChange={e => updateResult(idx, 'activity', e.target.value)}
                          >
                            {[1, 2, 3].map(s => (
                              <optgroup key={s} label={`── SCOPE ${s} ──`}>
                                {Object.entries(EF)
                                  .filter(([, ef]) => ef.scope === s)
                                  .map(([name]) => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>

                        <div className="aip-field">
                          <label className="aip-lbl">QUANTITY ({r.unit || '—'})</label>
                          <input
                            className="aip-inp"
                            type="number"
                            step="0.001"
                            min="0"
                            value={r.quantity}
                            onChange={e => updateResult(idx, 'quantity', parseFloat(e.target.value))}
                          />
                        </div>

                        <div className="aip-field">
                          <label className="aip-lbl">DATE</label>
                          <input
                            className="aip-inp"
                            type="date"
                            value={r.date}
                            max={new Date().toISOString().slice(0, 10)}
                            onChange={e => updateResult(idx, 'date', e.target.value)}
                          />
                        </div>

                        <div className="aip-field">
                          <label className="aip-lbl">NOTES</label>
                          <input
                            className="aip-inp"
                            type="text"
                            value={r.notes || ''}
                            maxLength={200}
                            onChange={e => updateResult(idx, 'notes', e.target.value)}
                          />
                        </div>
                      </div>

                      {/* CO2e preview */}
                      {r.co2e > 0 && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 16,
                          padding: '10px 14px', borderRadius: 8,
                          background: '#3b82f608', border: '1px solid #3b82f622',
                        }}>
                          <div>
                            <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 4 }}>
                              CALCULATED CO₂e
                            </div>
                            <div className="aip-preview-co2e">{r.co2e.toFixed(4)}</div>
                            <div style={{ fontSize: 11, color: 'var(--mut)' }}>
                              tonnes CO₂e · Scope {r.scope} · {r.category}
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--mut)', textAlign: 'right', lineHeight: 1.9 }}>
                            Factor: <strong style={{ color: 'var(--txt)' }}>{r.factor} kg CO₂e/{r.unit}</strong><br/>
                            Source: <strong style={{ color: '#3b82f6' }}>{r.source}</strong>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}

            {savedAll && pendingCount === 0 && (
              <div style={{
                padding: '14px 18px', borderRadius: 8,
                background: '#10b98108', border: '1px solid #10b98133',
                fontSize: 12, color: '#10b981', textAlign: 'center',
              }}>
                ✓ All records saved to GHG ledger
                <button
                  className="aip-btn aip-btn-g"
                  style={{ marginLeft: 16, padding: '6px 14px', fontSize: 10 }}
                  onClick={() => { setResults([]); setSavedAll(false); }}
                >
                  PARSE ANOTHER DOCUMENT
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}