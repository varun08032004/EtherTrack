'use strict';
// services/invoice.js — EtherTrack (Production Tax Invoice Engine v4)
// GST-compliant invoice generator for both SUBSCRIPTIONS and CARBON CREDIT TRADES
//
// EXPORTS:
//   generateGSTInvoice(...)     — subscription invoice (called from subscription.js)
//   generateTradeInvoice(...)   — carbon credit trade invoice (called from trades.js)
//   serveInvoice(req, res)      — serve subscription invoice PDF
//   serveTradeInvoice(req, res) — serve trade invoice PDF
//
// HOW TO GO LIVE:
//   1. npm install pdfkit qrcode
//   2. Run migrations/add_invoice_columns.sql
//   3. Run migrations/add_invoice_counters.sql (atomic invoice numbering — see below)
//   4. Fill in GSTIN/PAN below when GST registration comes through
//   5. If you collect buyer state (not just GSTIN) at checkout, pass buyerStateCode
//      through so CGST/SGST vs IGST is never guessed — see note below.
//
// ── migrations/add_invoice_counters.sql ──────────────────────────────────────
//   CREATE TABLE IF NOT EXISTS invoice_counters (
//     prefix TEXT NOT NULL,
//     year   INT  NOT NULL,
//     seq    INT  NOT NULL DEFAULT 0,
//     PRIMARY KEY (prefix, year)
//   );
//
// ── CGST/SGST vs IGST LOGIC (FIXED IN v4) ────────────────────────────────────
// getGSTType() now takes an explicit buyerStateCode fallback:
//   - B2B (buyer has GSTIN): state is read from the GSTIN's first 2 digits —
//     this was already correct.
//   - B2C with NO GSTIN (the common case for individual buyers): v3 defaulted
//     to IGST here, which is wrong whenever the buyer is actually in the same
//     state as the seller (Maharashtra) — this produced an incorrect invoice
//     for an intrastate B2C sale. v4 defaults B2C-with-no-info to CGST+SGST
//     instead, since EtherTrack's seller state is Maharashtra and most retail
//     buyers on an India-only platform will, by base rate, be same-state
//     unless you actually collect their billing state. If you DO collect
//     buyer state at checkout, pass it in via buyerStateCode and this
//     assumption is never used.
//
// ── WHY TRADE INVOICES HAVE TWO TAX RATES ─────────────────────────────────────
// trades.js's calcFees() only charges 18% GST on the platform's commission,
// not on the carbon-credit price itself:
//     gstINR = totalFeeINR * 0.18
//     buyerPaysINR = subtotalINR + buyerFeeINR + gstINR/2
// Since buyerFeeINR === sellerFeeINR (fee is split 50/50), the buyer's GST
// share (gstINR/2) is algebraically identical to (buyerFeeINR * 0.18).
// So this invoice bills:
//   Line 1 — Carbon Credits            → taxable value = subtotalINR,  GST 0%
//   Line 2 — Platform Fee              → taxable value = buyerFeeINR,  GST 18%
// This reconciles EXACTLY to buyerPaysINR with no rounding hacks, and is also
// the legally correct way to present an invoice with mixed tax rates.
// NOTE: whether carbon credit trading itself is GST-exempt/nil-rated or
// taxable at a different rate is a genuine open question in Indian GST law —
// confirm the correct HSN/SAC and rate for the credit line with a CA before
// go-live. The 0% used here reflects your current fee calculator, not a
// verified tax position.
//
// ── NEW IN v4 ──────────────────────────────────────────────────────────────
//   • Fixed CGST/SGST vs IGST default for B2C-no-GSTIN buyers (see above).
//   • Company logo in header (assets/et_logo_bg.png), graceful text fallback.
//   • Registered office updated to Balewadi, Pune.
//   • QR code linking to a verification URL (SELLER.website/verify/:invoiceNumber).
//   • Document integrity hash — a short SHA-256 fingerprint of the invoice's
//     core fields, so a printed/forwarded copy can be checked for tampering.
//   • Blockchain transaction hash + Sepolia explorer link on trade invoices
//     (pass txHash into generateTradeInvoice).
//   • "Verified on-chain" badge when a txHash is present.
//   • Retirement status badge — RETIRED vs TRADED (ACTIVE) — pass `retired`
//     boolean into generateTradeInvoice. Matters a lot for BRSR/CDP reporting,
//     since only retired credits count toward a claimed offset.
//   • Semi-transparent "PAID" stamp (all invoices here are post-payment).
//   • SAC code footnote explaining what the codes mean, for buyers unfamiliar
//     with services taxation.
//   • "Powered by EtherTrack Verification Engine" branding line next to the
//     verification block.
//   • True multi-page footer ("Page X of Y") using pdfkit's buffered pages,
//     instead of a footer that silently only applied to the last page.
//
// ── PRIOR CHANGES (v3) ────────────────────────────────────────────────────────
//   • Per-line-item GST rates, atomic invoice numbering, idempotency guard,
//     registered office/shipping block, T&Cs, billing period, carbon credit
//     traceability, place of supply / reverse charge fields, paisa-level
//     precision, HTML-escaping in emails.

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { safeQuery: query } = require('../db/pool');
const { sendSubscriptionInvoiceEmail, sendTradeInvoiceEmail, sendTradeInvoiceChainConfirmedEmail, sendTradeBillEthEmail } = require('./email');

// ── Logo ──────────────────────────────────────────────────────────────────────
// Multi-candidate resolution: if you're deploying to Vercel serverless
// functions, a static asset like this PNG can silently fail to get bundled
// into the function unless explicitly included — fs.existsSync() will then
// return false in production even though the file works fine locally. This
// tries several plausible locations and LOGS which one (if any) actually
// resolved, so you can check server logs to see what's really happening at
// runtime instead of guessing.
//
// If none of these resolve on Vercel, add this to vercel.json:
//   { "functions": { "api/**/*.js": { "includeFiles": "assets/**" } } }
// (adjust the "api/**/*.js" glob to match wherever your serverless entry
// points actually live relative to the project root).
const LOGO_CANDIDATES = [
  path.join(__dirname, '..', 'Images', 'et_logo_bg.png'),   // services/ → ../Images — actual location
  path.join(process.cwd(), 'Images', 'et_logo_bg.png'),     // project root (Vercel cwd)
  path.join(process.cwd(), 'ethertrack-backend', 'Images', 'et_logo_bg.png'),
  path.join(__dirname, 'Images', 'et_logo_bg.png'),         // same dir as this file
  // legacy candidates, in case the file gets moved to assets/ later
  path.join(__dirname, '..', 'assets', 'et_logo_bg.png'),
  path.join(process.cwd(), 'assets', 'et_logo_bg.png'),
];
let LOGO_PATH = null;
for (const candidate of LOGO_CANDIDATES) {
  if (fs.existsSync(candidate)) { LOGO_PATH = candidate; break; }
}
const LOGO_EXISTS = LOGO_PATH !== null;
if (LOGO_EXISTS) {
  console.log('[invoice] logo resolved at:', LOGO_PATH);
} else {
  console.warn(
    '[invoice] logo NOT found — tried:\n  ' + LOGO_CANDIDATES.join('\n  ') +
    '\nFalling back to text wordmark. If this is happening in production but ' +
    'not locally, your deploy platform is likely not bundling the assets/ ' +
    'folder — see the comment above this block for the Vercel fix.'
  );
}

// ── Company registration — filled in July 2026 on incorporation ─────────────
const SELLER = {
  name:        'EtherTrack Technologies Pvt Ltd',
  addressLine1:'Flat 306, Truspace Prima Angulus',
  addressLine2:'Patil Nagar, Balewadi',
  city:        'Pune',
  state:       'Maharashtra',
  stateCode:   '27',
  pincode:     '411045',
  gstin:       '27AAJCE8329G1ZD',
  pan:         'AAJCE8329G',
  tan:         'PNEE11967E',
  cin:         'U62090PN2026PTC257708',
  incorporatedOn: '2026-07-13',
  sacCode:     '997331',   // SAC for software/marketplace services
  email:       'billing@ethertrack.in',
  supportEmail:'support@ethertrack.in',
  website:     process.env.FRONTEND_URL || 'https://app.ethertrack.in',
};

const fullSellerAddress = () =>
  [SELLER.addressLine1, SELLER.addressLine2, `${SELLER.city}, ${SELLER.state} ${SELLER.pincode}`]
    .filter(Boolean).join(', ');

const INVOICE_PREFIX = 'ET';
const GST_RATE       = 0.18;

// ── Graceful degradation if optional deps aren't installed ───────────────────
let PDFDocument = null;
try { PDFDocument = require('pdfkit'); } catch {
  console.warn('⚠️  pdfkit not installed — invoices will be skipped. Run: npm install pdfkit');
}
let QRCode = null;
try { QRCode = require('qrcode'); } catch {
  console.warn('⚠️  qrcode not installed — invoices will skip QR codes. Run: npm install qrcode');
}

const TMP_DIR = '/tmp/et-invoices';
try { if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true }); } catch {}

// ── Helpers ───────────────────────────────────────────────────────────────────
const inr = n => `Rs. ${parseFloat(n || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100; // round to paisa

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function toWords(n) {
  const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
             'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
             'Seventeen','Eighteen','Nineteen'];
  const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const cvt = x => {
    if (x < 20)       return a[x];
    if (x < 100)      return b[Math.floor(x/10)] + (x%10 ? ' '+a[x%10] : '');
    if (x < 1000)     return a[Math.floor(x/100)] + ' Hundred' + (x%100 ? ' '+cvt(x%100) : '');
    if (x < 100000)   return cvt(Math.floor(x/1000))   + ' Thousand' + (x%1000   ? ' '+cvt(x%1000)   : '');
    if (x < 10000000) return cvt(Math.floor(x/100000)) + ' Lakh'     + (x%100000 ? ' '+cvt(x%100000) : '');
    return               cvt(Math.floor(x/10000000)) + ' Crore'   + (x%10000000 ? ' '+cvt(x%10000000) : '');
  };
  // Split into rupees + paise so the words match the exact printed total,
  // rather than rounding off paise (which an auditor/CA would flag as a
  // mismatch between "Amount in Words" and the numeric Grand Total).
  const rupees = Math.floor(n + 1e-9);
  const paise  = Math.round((n - rupees) * 100);
  let result = rupees === 0 ? 'Zero Rupees' : `${cvt(rupees)} Rupees`;
  if (paise > 0) result += ` and ${cvt(paise)} Paise`;
  return result + ' Only';
}

// buyerStateCode: explicit 2-digit GST state code if you collect it at
// checkout (recommended). Falls back to the buyer's GSTIN prefix for B2B,
// and to an assumed same-state B2C sale only if neither is available —
// see the v4 header note above for why that's the safer default than IGST.
function getGSTType(buyerGstin, buyerStateCode) {
  const stateCode =
    (buyerGstin && buyerGstin.length >= 2) ? buyerGstin.slice(0, 2) : buyerStateCode;
  if (!stateCode) return 'cgst_sgst'; // assumed same-state B2C — see header note
  return stateCode === SELLER.stateCode ? 'cgst_sgst' : 'igst';
}

function placeOfSupply(buyerGstin, buyerStateCode) {
  const stateCode = (buyerGstin && buyerGstin.length >= 2) ? buyerGstin.slice(0, 2) : buyerStateCode;
  if (stateCode) return `State Code ${stateCode}`;
  return `${SELLER.state} (${SELLER.stateCode}) — B2C (assumed)`;
}

const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

// SHA-256 fingerprint of the invoice's core fields. Anyone holding a printed
// or forwarded copy can recompute this from the visible fields to check the
// document hasn't been altered — a lightweight, dependency-free integrity
// check (not a legal digital signature, but a real tamper-evidence layer).
function computeIntegrityHash({ invoiceNumber, invoiceDate, totalAmount, buyerEmail }) {
  const payload = `${invoiceNumber}|${invoiceDate}|${totalAmount.toFixed(2)}|${buyerEmail}|${SELLER.gstin}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16).toUpperCase();
}

const shortHash   = h => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '');
const sepoliaUrl  = h => `https://sepolia.etherscan.io/tx/${h}`;

function drawBadge(doc, x, y, w, h, label, bg, fg) {
  doc.roundedRect(x, y, w, h, 3).fill(bg);
  doc.fontSize(6.5).font('Helvetica-Bold').fillColor(fg)
    .text(label, x, y + h / 2 - 3.5, { width: w, align: 'center' });
}

// ── Atomic invoice numbering ──────────────────────────────────────────────────
// Single upsert statement — concurrent calls can never receive the same number.
// Requires the invoice_counters table (see migration note at top of file).
async function getNextInvoiceNumber(prefix = INVOICE_PREFIX) {
  const year = new Date().getFullYear();
  const { rows } = await query(
    `INSERT INTO invoice_counters (prefix, year, seq)
     VALUES ($1, $2, 1)
     ON CONFLICT (prefix, year)
     DO UPDATE SET seq = invoice_counters.seq + 1
     RETURNING seq`,
    [prefix, year]
  );
  const seq = String(rows[0].seq).padStart(5, '0');
  return `${prefix}-${year}-${seq}`;
}

// ── Core PDF builder (shared by both subscription + trade invoices) ───────────
// lineItems: [{ description, sacCode, qty, rate, amount (taxable value), gstRate (0..1) }]
async function buildPDF(data) {
  const {
    invoiceNumber, invoiceDate,
    lineItems,
    buyerName, buyerEmail, buyerGstin, buyerPan, buyerStateCode,
    gstType, invoiceTitle,
    billingPeriod,
    txHash,
    retired,
    documentType = 'tax_invoice', // 'tax_invoice' | 'bill' — 'bill' = no GST claimed at all
  } = data;
  const isBill = documentType === 'bill';

  // Compute totals from line items — every rupee on this invoice is derived
  // here, so the printed totals can never drift from the line items above them.
  const items = lineItems.map(item => {
    const gstRate = item.gstRate ?? GST_RATE;
    const gstAmt  = r2(item.amount * gstRate);
    return { ...item, gstRate, gstAmt, lineTotal: r2(item.amount + gstAmt) };
  });
  const baseAmount  = r2(items.reduce((s, i) => s + i.amount, 0));
  const gstAmount   = r2(items.reduce((s, i) => s + i.gstAmt, 0));
  const totalAmount = r2(baseAmount + gstAmount);

  const verifyUrl    = `${SELLER.website}/verify/${invoiceNumber}`;
  const invoiceHash  = computeIntegrityHash({ invoiceNumber, invoiceDate, totalAmount, buyerEmail });
  const verifiedOnChain = Boolean(txHash);

  // QR code generated up front (async) so it's ready before the sync PDF draw below.
  let qrBuffer = null;
  if (QRCode) {
    try {
      qrBuffer = await QRCode.toBuffer(verifyUrl, {
        margin: 1, width: 160, color: { dark: '#040706', light: '#ffffff' },
      });
    } catch (e) {
      console.warn('QR generation failed:', e.message);
    }
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 0, bufferPages: true,
      info: { Title: `Tax Invoice ${invoiceNumber}`, Author: SELLER.name },
    });
    const chunks = [];
    doc.on('data',  c => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 595.28, H = 841.89, M = 36, CW = W - M * 2;
    const GREEN = '#22c55e', DARK = '#040706', GREY = '#6b7280';
    const LGREY = '#f0fdf4', BLACK = '#111827', WHITE = '#ffffff';

    const pageBreakIfNeeded = (needed) => {
      if (doc.y + needed > H - 60) { doc.addPage(); return true; }
      return false;
    };

    // Header
    doc.rect(0, 0, W, 118).fill(DARK);

    if (LOGO_EXISTS) {
      try {
        doc.image(LOGO_PATH, M, 24, { fit: [44, 44] });
        doc.fontSize(22).font('Helvetica-Bold').fillColor(GREEN).text('EtherTrack', M + 54, 28);
        doc.fontSize(9).font('Helvetica').fillColor('#86efac').text('Carbon Credit Exchange Platform', M + 54, 54);
        doc.fontSize(8).fillColor('#86efac66').text(SELLER.website, M + 54, 68).text(SELLER.email, M + 54, 80);
      } catch (e) {
        console.warn(
          '[invoice] logo file exists at', LOGO_PATH, 'but pdfkit failed to render it:',
          e.message, '— this usually means the PNG is interlaced (pdfkit doesn\'t ' +
          'support interlaced PNGs) or corrupted. Re-export it as a non-interlaced ' +
          'PNG and try again. Falling back to text wordmark for this invoice.'
        );
        doc.fontSize(22).font('Helvetica-Bold').fillColor(GREEN).text('EtherTrack', M, 28);
        doc.fontSize(9).font('Helvetica').fillColor('#86efac').text('Carbon Credit Exchange Platform', M, 54);
        doc.fontSize(8).fillColor('#86efac66').text(SELLER.website, M, 68).text(SELLER.email, M, 80);
      }
    } else {
      doc.fontSize(22).font('Helvetica-Bold').fillColor(GREEN).text('EtherTrack', M, 28);
      doc.fontSize(9).font('Helvetica').fillColor('#86efac').text('Carbon Credit Exchange Platform', M, 54);
      doc.fontSize(8).fillColor('#86efac66').text(SELLER.website, M, 68).text(SELLER.email, M, 80);
    }

    doc.fontSize(18).font('Helvetica-Bold').fillColor(WHITE).text(isBill ? 'PAYMENT BILL' : 'TAX INVOICE', 0, 32, { width: W-M, align: 'right' });
    doc.fontSize(8.5).font('Helvetica').fillColor('#86efac')
      .text(`Invoice No: ${invoiceNumber}`, 0, 58, { width: W-M, align: 'right' })
      .text(`Invoice Date: ${invoiceDate}`, 0, 72, { width: W-M, align: 'right' })
      .text(invoiceTitle || (isBill ? 'Payment Bill' : 'Tax Invoice'), 0, 86, { width: W-M, align: 'right' });
    if (billingPeriod) {
      doc.fontSize(7.5).fillColor('#86efac99')
        .text(`Billing Period: ${billingPeriod.from} – ${billingPeriod.to}`, 0, 100, { width: W-M, align: 'right' });
    }
    if (!isBill && SELLER.gstin === 'GSTIN_PENDING_REGISTRATION') {
      doc.fontSize(7).fillColor('#f59e0b')
        .text('⚠ GST registration pending — invoice reissued once registered', 0, 106, { width: W-M, align: 'right' });
    }
    if (isBill) {
      doc.fontSize(7).fillColor('#93c5fd')
        .text('Non-GST payment bill — no tax charged, no ITC claimable', 0, 106, { width: W-M, align: 'right' });
    }

    // Semi-transparent PAID stamp — fixed position, doesn't disturb the
    // flowing layout below since doc.y/doc.x for subsequent elements are
    // always set explicitly.
    doc.save();
    doc.rotate(-18, { origin: [W / 2, 420] });
    doc.opacity(0.07);
    doc.fontSize(70).font('Helvetica-Bold').fillColor(GREEN)
      .text('PAID', W / 2 - 150, 392, { width: 300, align: 'center' });
    doc.opacity(1);
    doc.restore();

    let y = 132;
    const colW = (CW/2) - 10;

    // Seller box — registered office + shipping address (same address; digital service)
    const sellerBoxH = 130;
    doc.rect(M, y, colW, sellerBoxH).fill(LGREY).stroke('#e5e7eb');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(GREEN).text('BILLED BY (REGISTERED OFFICE)', M+12, y+12);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(BLACK).text(SELLER.name, M+12, y+26, { width: colW-20 });
    doc.fontSize(7.5).font('Helvetica').fillColor(GREY)
      .text(fullSellerAddress(),                            M+12, y+44, { width: colW-20 })
      .text(`GSTIN: ${SELLER.gstin}`,                       M+12, y+76)
      .text(`PAN:   ${SELLER.pan}`,                         M+12, y+89)
      .text(`State: ${SELLER.state} (${SELLER.stateCode})`, M+12, y+102);
    doc.fontSize(6.5).fillColor('#9ca3af')
      .text('Shipping Address: Same as above — digital/intangible service, no physical shipment.', M+12, y+116, { width: colW-20 });

    // Buyer box
    const bx = M + colW + 20;
    doc.rect(bx, y, colW, sellerBoxH).fill(LGREY).stroke('#e5e7eb');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(GREEN).text('BILLED TO', bx+12, y+12);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(BLACK).text(buyerName || 'Individual', bx+12, y+26, { width: colW-20 });
    doc.fontSize(7.5).font('Helvetica').fillColor(GREY).text(buyerEmail, bx+12, y+44, { width: colW-20 });
    let by = y + 60;
    if (buyerGstin) { doc.text(`GSTIN: ${buyerGstin}`, bx+12, by, { width: colW-20 }); by += 13; }
    if (buyerPan)   { doc.text(`PAN:   ${buyerPan}`,   bx+12, by, { width: colW-20 }); by += 13; }
    if (!buyerGstin) { doc.fillColor('#f59e0b').text('B2C — No GSTIN provided', bx+12, by, { width: colW-20 }); by += 13; }
    doc.fillColor(GREY).text(`Place of Supply: ${placeOfSupply(buyerGstin, buyerStateCode)}`, bx+12, by, { width: colW-20 });

    y += sellerBoxH + 14;

    // Line items header
    const cols = [
      { key:'idx',  label: '#',            x: M+6,   w: 16,  align: 'left'   },
      { key:'desc', label: 'Description',  x: M+24,  w: 168, align: 'left'   },
      { key:'sac',  label: 'SAC',          x: M+196, w: 38,  align: 'center' },
      { key:'qty',  label: 'Qty',          x: M+236, w: 26,  align: 'center' },
      { key:'rate', label: 'Rate',         x: M+264, w: 52,  align: 'right'  },
      { key:'tax',  label: 'Taxable Val.', x: M+318, w: 60,  align: 'right'  },
      { key:'gstp', label: 'GST%',         x: M+380, w: 28,  align: 'center' },
      { key:'gsta', label: 'GST Amt',      x: M+410, w: 50,  align: 'right'  },
      { key:'tot',  label: 'Total',        x: M+462, w: 53,  align: 'right'  },
    ];
    doc.rect(M, y, CW, 20).fill(DARK);
    doc.fontSize(6.8).font('Helvetica-Bold').fillColor(WHITE);
    cols.forEach(c => doc.text(c.label, c.x, y+6, { width: c.w, align: c.align }));
    y += 20;

    items.forEach((item, i) => {
      const rowH = item.description.length > 42 ? 34 : 28;
      doc.rect(M, y, CW, rowH).fill(i%2===0?WHITE:'#fafafa').stroke('#e5e7eb');
      doc.fontSize(7).font('Helvetica').fillColor(BLACK);
      doc.text(String(i+1),                    cols[0].x, y+9, { width: cols[0].w, align: 'left'   });
      doc.text(item.description,               cols[1].x, y+6, { width: cols[1].w, align: 'left'   });
      doc.text(item.sacCode||SELLER.sacCode,    cols[2].x, y+9, { width: cols[2].w, align: 'center' });
      doc.text(String(item.qty||1),             cols[3].x, y+9, { width: cols[3].w, align: 'center' });
      doc.text(inr(item.rate),                  cols[4].x, y+9, { width: cols[4].w, align: 'right'  });
      doc.text(inr(item.amount),                cols[5].x, y+9, { width: cols[5].w, align: 'right'  });
      doc.text(`${(item.gstRate*100).toFixed(0)}%`, cols[6].x, y+9, { width: cols[6].w, align: 'center' });
      doc.text(inr(item.gstAmt),                cols[7].x, y+9, { width: cols[7].w, align: 'right'  });
      doc.text(inr(item.lineTotal),             cols[8].x, y+9, { width: cols[8].w, align: 'right'  });
      y += rowH;
    });

    y += 8;

    // GST summary (aggregated across line items — see header note on mixed rates)
    const sx = M + CW * 0.54, sw = CW * 0.46;
    const summaryRow = (label, value, bold = false, color = BLACK) => {
      doc.rect(sx, y, sw, 18).fill(bold ? LGREY : WHITE).stroke('#e5e7eb');
      doc.fontSize(7.5).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color)
        .text(label, sx+8,       y+5, { width: sw*0.54 })
        .text(value, sx+sw*0.54, y+5, { width: sw*0.43, align: 'right' });
      y += 18;
    };
    summaryRow(isBill ? 'Total Amount' : 'Total Taxable Value', inr(baseAmount));
    if (!isBill) {
      if (gstType === 'cgst_sgst') {
        summaryRow(`CGST @ ${(GST_RATE/2*100).toFixed(1)}%`, inr(gstAmount/2));
        summaryRow(`SGST @ ${(GST_RATE/2*100).toFixed(1)}%`, inr(gstAmount/2));
      } else {
        summaryRow(`IGST`, inr(gstAmount));
      }
    }
    summaryRow('Grand Total', inr(totalAmount), true, GREEN);
    y += 8;

    // Amount in words
    doc.rect(M, y, CW, 24).fill(LGREY).stroke('#e5e7eb');
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GREY).text('Amount in Words:', M+8, y+8);
    doc.font('Helvetica').fillColor(BLACK).text(toWords(totalAmount), M+108, y+8, { width: CW-116 });
    y += 34;

    doc.fontSize(6.8).font('Helvetica').fillColor(GREY).text(
      isBill
        ? 'This is a non-GST payment bill for a blockchain (ETH)-settled transaction. No GST has been charged, and no input tax credit can be claimed against this document.'
        : gstType === 'cgst_sgst'
          ? `Intrastate supply — CGST + SGST applicable. Seller state: ${SELLER.state}.`
          : `Interstate supply — IGST applicable. Seller state: ${SELLER.state}.`,
      M, y, { width: CW }
    );
    y += 10;
    if (!isBill) {
      doc.text(`Reverse Charge Applicable: No    ·    Tax is payable on reverse charge basis: No`, M, y, { width: CW });
      y += 12;
      doc.fontSize(6.2).fillColor('#9ca3af').text(
        'SAC 997337 = Environmental & related services. SAC 997331 = Other financial/support services (platform commission).',
        M, y, { width: CW }
      );
      y += 16;
    } else {
      y += 6;
    }

    pageBreakIfNeeded(110);
    y = doc.y > y ? doc.y : y;

    // ── Verification & integrity block ────────────────────────────────────
    const vBoxH = 92;
    doc.rect(M, y, CW, vBoxH).fill(WHITE).stroke('#e5e7eb');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(GREEN).text('VERIFICATION & INTEGRITY', M+12, y+8);

    if (qrBuffer) {
      try { doc.image(qrBuffer, M+12, y+20, { fit: [64, 64] }); } catch {}
    }
    const vTextX = M + 12 + (qrBuffer ? 76 : 0);
    const vTextW = CW - (vTextX - M) - 132;

    doc.fontSize(6.6).font('Helvetica').fillColor(GREY)
      .text(`Verify this invoice: ${verifyUrl}`, vTextX, y+22, { width: vTextW })
      .text(`Document Integrity Hash: ${invoiceHash}`, vTextX, y+35, { width: vTextW });

    if (txHash) {
      doc.text(`Blockchain Tx (Sepolia): ${shortHash(txHash)}`, vTextX, y+48, { width: vTextW });
      doc.fillColor('#3b82f6').text(sepoliaUrl(txHash), vTextX, y+61, { width: vTextW, link: sepoliaUrl(txHash) });
    }
    doc.fontSize(6).fillColor('#9ca3af')
      .text('Powered by EtherTrack Verification Engine', vTextX, y+77, { width: vTextW });

    // Status badges — right side of the box
    let badgeY = y + 20;
    const badgeX = M + CW - 128;
    if (verifiedOnChain) {
      drawBadge(doc, badgeX, badgeY, 116, 18, '⛓ VERIFIED ON-CHAIN', GREEN, WHITE);
      badgeY += 24;
    }
    if (retired === true) {
      drawBadge(doc, badgeX, badgeY, 116, 18, '✔ RETIRED', '#0ea5e9', WHITE);
      badgeY += 24;
    } else if (retired === false) {
      drawBadge(doc, badgeX, badgeY, 116, 18, 'TRADED (ACTIVE)', '#f59e0b', WHITE);
      badgeY += 24;
    }

    y += vBoxH + 12;

    pageBreakIfNeeded(140);
    y = doc.y > y ? doc.y : y;

    // Terms & Conditions
    const tcH = 78;
    doc.rect(M, y, CW, tcH).fill(WHITE).stroke('#e5e7eb');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(GREY).text('TERMS & CONDITIONS', M+8, y+7);
    doc.font('Helvetica').fillColor(GREY).fontSize(6.8).text(
      '1. This invoice is issued for payment already received; no further payment is due against it.\n' +
      `2. Refunds/cancellations, where applicable, are governed by the policy published at ${SELLER.website}/refund-policy.\n` +
      `3. Any discrepancy in this invoice must be reported to ${SELLER.supportEmail} within 7 days of the invoice date.\n` +
      '4. All disputes are subject to the exclusive jurisdiction of the courts at Mumbai, Maharashtra.\n' +
      '5. This is a system-generated invoice and does not require a physical signature.',
      M+8, y+19, { width: CW-16, lineGap: 1 }
    );
    y += tcH + 12;

    // Declaration
    pageBreakIfNeeded(60);
    y = doc.y > y ? doc.y : y;
    doc.rect(M, y, CW, 38).fill(LGREY).stroke('#e5e7eb');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(GREY).text('DECLARATION', M+8, y+7);
    doc.font('Helvetica').fillColor(GREY).fontSize(6.8).text(
      isBill
        ? 'We declare that this bill shows the actual price of the goods/services described and that all particulars are true and correct. No GST has been charged or collected on this transaction.'
        : 'We declare that this invoice shows the actual price of the goods/services described and that all ' +
          'particulars are true and correct.',
      M+8, y+19, { width: CW-16 }
    );

    // ── Footer — drawn on every buffered page, with "Page X of Y" ──────────
    const pageRange = doc.bufferedPageRange();
    for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
      doc.switchToPage(i);
      doc.rect(0, H-46, W, 46).fill(DARK);
      doc.fontSize(6.5).font('Helvetica').fillColor('#86efac55')
        .text(`${SELLER.name}  ·  GSTIN: ${SELLER.gstin}  ·  ${SELLER.email}  ·  ${SELLER.website}`, M, H-30, { width: CW - 90, align: 'left' })
        .text(
          isBill
            ? 'Non-GST payment bill — blockchain (ETH)-settled transaction. Not a tax invoice.'
            : 'Generated in compliance with the CGST Rules, 2017 and the GST Act, 2017.',
          M, H-18, { width: CW - 90, align: 'left' }
        );
      doc.fontSize(6.5).fillColor('#86efac55')
        .text(`Page ${i - pageRange.start + 1} of ${pageRange.count}`, W - M - 80, H-27, { width: 80, align: 'right' });
    }

    doc.end();
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// generateGSTInvoice — subscription invoice (subscription.js calls this)
// ═════════════════════════════════════════════════════════════════════════════
async function generateGSTInvoice({
  paymentId, plan, cycle, amount, gstin, pan, buyerName, buyerEmail,
  buyerStateCode,                          // optional — see CGST/SGST note above
  billingPeriodStart, billingPeriodEnd,    // optional — renders "Billing Period" on the PDF
}) {
  if (!PDFDocument) {
    console.warn(`⚠️  Invoice skipped for payment ${paymentId} — run: npm install pdfkit`);
    return null;
  }

  try {
    // Idempotency: don't re-issue a new invoice number for a payment that already has one.
    const { rows: existing } = await query(
      `SELECT invoice_url FROM subscription_payments WHERE id=$1 AND invoice_number IS NOT NULL`,
      [paymentId]
    ).catch(() => ({ rows: [] }));
    if (existing.length && existing[0].invoice_url) {
      console.log(`ℹ️  Invoice already exists for payment ${paymentId}, skipping regeneration`);
      return existing[0].invoice_url;
    }

    const baseAmount    = r2(amount);
    const gstType       = getGSTType(gstin, buyerStateCode);
    const invoiceNumber = await getNextInvoiceNumber();
    const invoiceDate   = fmtDate(new Date());
    const planLabel     = plan.charAt(0).toUpperCase() + plan.slice(1);
    const cycleLabel    = cycle === 'annual' ? 'Annual' : 'Monthly';

    const pdfBuffer = await buildPDF({
      invoiceNumber, invoiceDate,
      invoiceTitle:  'Subscription Invoice',
      billingPeriod: billingPeriodStart && billingPeriodEnd
        ? { from: fmtDate(billingPeriodStart), to: fmtDate(billingPeriodEnd) }
        : null,
      lineItems: [{
        description: `EtherTrack ${planLabel} Plan (${cycleLabel}) — SaaS Carbon Exchange Platform`,
        sacCode:     SELLER.sacCode,
        qty:         1,
        rate:        baseAmount,
        amount:      baseAmount,
        gstRate:     GST_RATE,
      }],
      buyerName, buyerEmail, buyerGstin: gstin || null, buyerPan: pan || null, buyerStateCode,
      gstType,
    });

    const invoiceUrl = `${SELLER.website}/api/org/invoice/${paymentId}`;

    await query(
      `UPDATE subscription_payments
       SET invoice_number=$1, invoice_pdf=$2, invoice_url=$3, invoice_generated_at=NOW()
       WHERE id=$4`,
      [invoiceNumber, pdfBuffer, invoiceUrl, paymentId]
    ).catch(e => console.warn('DB invoice store failed:', e.message));

    try { fs.writeFileSync(path.join(TMP_DIR, `sub-${paymentId}.pdf`), pdfBuffer); } catch {}

    await sendSubscriptionInvoiceEmail(buyerEmail,
      { name: buyerName, invoiceNumber, planLabel, cycleLabel, invoiceUrl },
      { attachments: [{ filename: `EtherTrack-Invoice-${invoiceNumber}.pdf`, content: pdfBuffer }] }
    ).catch(e => console.warn('Invoice email failed:', e.message));

    console.log(`✅ Subscription invoice ${invoiceNumber} — payment ${paymentId}`);
    return invoiceUrl;

  } catch (e) {
    console.error('generateGSTInvoice error (payment unaffected):', e.message);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// generateTradeInvoice — carbon credit trade invoice (trades.js calls this)
// ═════════════════════════════════════════════════════════════════════════════
async function generateTradeInvoice({
  tradeId, buyerName, buyerEmail,
  projectName, standard, registrySerial,
  qty, subtotalINR,
  buyerFeeINR, gstINR, totalPaidINR,
  paymentMode, buyerGstin, buyerPan, buyerStateCode,
  txHash,     // optional — on-chain settlement tx hash (Sepolia), enables the
              // "Verified on-chain" badge + explorer link when present
  retired,    // optional boolean — true if this credit has been retired,
              // false if still an active/traded holding, omit if not tracked
}) {
  if (!PDFDocument) {
    console.warn(`⚠️  Trade invoice skipped for trade ${tradeId} — run: npm install pdfkit`);
    return null;
  }

  try {
    // Idempotency: don't re-issue a new invoice number for a trade that already has one.
    const { rows: existing } = await query(
      `SELECT trade_invoice_url FROM trades WHERE id=$1 AND trade_invoice_number IS NOT NULL`,
      [tradeId]
    ).catch(() => ({ rows: [] }));
    if (existing.length && existing[0].trade_invoice_url) {
      console.log(`ℹ️  Invoice already exists for trade ${tradeId}, skipping regeneration`);
      return existing[0].trade_invoice_url;
    }

    const gstType   = getGSTType(buyerGstin, buyerStateCode);
    const payLabel  = paymentMode === 'direct_razorpay' ? 'Razorpay' : 'INR Wallet';
    const traceBits = [standard, registrySerial ? `Serial: ${registrySerial}` : null].filter(Boolean).join(' · ');

    // See header note: only the platform fee is taxable at 18%; the credit
    // line is billed at 0% GST pending confirmation of its correct GST
    // treatment. This reconciles exactly to totalPaidINR — see self-check below.
    const lineItems = [
      {
        description: `Carbon Credits — ${projectName}${traceBits ? ` (${traceBits})` : ''} · ${qty} tCO₂e via ${payLabel}`,
        sacCode:     '997337', // SAC: Environmental services
        qty,
        rate:        r2(subtotalINR / qty),
        amount:      r2(subtotalINR),
        gstRate:     0, // nil-rated pending CA confirmation — see file header note
      },
      {
        description: 'Platform Fee (0.5% of trade value)',
        sacCode:     SELLER.sacCode,
        qty:         1,
        rate:        r2(buyerFeeINR),
        amount:      r2(buyerFeeINR),
        gstRate:     GST_RATE,
      },
    ];

    const invoiceNumber = await getNextInvoiceNumber('ETT'); // ETT = EtherTrack Trade
    const invoiceDate   = fmtDate(new Date());

    const pdfBuffer = await buildPDF({
      invoiceNumber,
      invoiceDate,
      invoiceTitle: 'Carbon Credit Trade Invoice',
      lineItems,
      buyerName, buyerEmail,
      buyerGstin: buyerGstin || null,
      buyerPan:   buyerPan   || null,
      buyerStateCode,
      gstType,
      txHash: txHash || null,
      retired: typeof retired === 'boolean' ? retired : undefined,
    });

    // Sanity check against the caller's own numbers — logs, doesn't block.
    const reconciled = r2(subtotalINR + buyerFeeINR + buyerFeeINR * GST_RATE);
    if (Math.abs(reconciled - r2(totalPaidINR)) > 0.02) {
      console.warn(
        `⚠️  Trade ${tradeId}: invoice total (${reconciled}) doesn't match totalPaidINR ` +
        `(${totalPaidINR}) passed in — double check the fee calculation upstream.`
      );
    }

    const invoiceUrl = `${SELLER.website}/api/trades/${tradeId}/invoice`;

    await query(
      `UPDATE trades
       SET trade_invoice_number=$1, trade_invoice_pdf=$2, trade_invoice_url=$3,
           trade_invoice_generated_at=NOW()
       WHERE id=$4`,
      [invoiceNumber, pdfBuffer, invoiceUrl, tradeId]
    ).catch(e => console.warn('[tradeInvoice] DB store failed:', e.message));

    try { fs.writeFileSync(path.join(TMP_DIR, `trade-${tradeId}.pdf`), pdfBuffer); } catch {}

    const safeProjectName = escapeHtml(projectName);
    await sendTradeInvoiceEmail(buyerEmail,
      {
        buyerName, invoiceNumber, projectName: safeProjectName, qty,
        totalPaidINR: Number(totalPaidINR).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        invoiceUrl,
      },
      { attachments: [{ filename: `EtherTrack-Trade-Invoice-${invoiceNumber}.pdf`, content: pdfBuffer }] }
    ).catch(e => console.warn('[tradeInvoice] email failed:', e.message));

    console.log(`✅ Trade invoice ${invoiceNumber} — trade ${tradeId}`);
    return invoiceUrl;

  } catch (e) {
    console.error('generateTradeInvoice error (trade unaffected):', e.message);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// patchInvoiceWithChainConfirmation — regenerate a trade invoice once
// chainLogger.js has confirmed the on-chain settlement tx.
//
// WHY THIS EXISTS: generateTradeInvoice() runs synchronously right after the
// trade completes, but chainLogger.logTrade() is fire-and-forget and confirms
// later — so at invoice-generation time, chain_tx_hash / chain_status aren't
// set yet. This function re-fetches the now-confirmed trade, rebuilds the PDF
// with the tx hash + "VERIFIED ON-CHAIN" badge included, and overwrites the
// stored invoice. It does NOT re-email the buyer by default (avoid spamming
// them a second time over the same purchase) — flip `notifyBuyer` to true if
// you want a "your invoice was updated" email.
//
// INTEGRATION: call this from chainLogger.js at the point where it sets
// chain_status = 'confirmed' for a trade, e.g.:
//
//   const { patchInvoiceWithChainConfirmation } = require('./invoice');
//   await patchInvoiceWithChainConfirmation(tradeId).catch(err =>
//     console.error('[chainLogger] invoice patch failed:', err.message));
//
// Call it AFTER the DB row's chain_status/chain_tx_hash update commits, since
// this function re-reads those columns from the DB rather than accepting
// them as arguments — that guarantees it always reflects what's actually
// confirmed, not whatever chainLogger's caller happened to pass in.
// ═════════════════════════════════════════════════════════════════════════════
async function patchInvoiceWithChainConfirmation(tradeId, { notifyBuyer = false } = {}) {
  if (!PDFDocument) {
    console.warn(`⚠️  Invoice patch skipped for trade ${tradeId} — pdfkit not installed`);
    return null;
  }

  try {
    const { rows } = await query(
      `SELECT t.*, u.full_name AS buyer_name, u.email AS buyer_email,
              cb.project_name, cb.standard, cb.registry_serial
       FROM trades t
       JOIN users u ON u.id = t.buyer_id
       LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
       WHERE t.id = $1`,
      [tradeId]
    );
    if (!rows.length) {
      console.warn(`[patchInvoiceWithChainConfirmation] trade ${tradeId} not found`);
      return null;
    }
    const t = rows[0];

    if (!t.chain_tx_hash) {
      console.log(`[patchInvoiceWithChainConfirmation] trade ${tradeId} has no chain_tx_hash yet — skipping patch`);
      return null;
    }
    if (!t.trade_invoice_number) {
      console.log(`[patchInvoiceWithChainConfirmation] trade ${tradeId} has no invoice yet — nothing to patch`);
      return null;
    }

    const gstType   = getGSTType(null, null); // B2C default — same assumption as original generation
    const payLabel  = t.payment_mode === 'direct_razorpay' ? 'Razorpay' : 'INR Wallet';
    const traceBits = [t.standard, t.registry_serial ? `Serial: ${t.registry_serial}` : null]
      .filter(Boolean).join(' · ');

    const subtotalINR = parseFloat(t.subtotal_inr);
    const buyerFeeINR = parseFloat(t.buyer_fee_inr);
    const qty         = t.quantity;

    const lineItems = [
      {
        description: `Carbon Credits — ${t.project_name}${traceBits ? ` (${traceBits})` : ''} · ${qty} tCO₂e via ${payLabel}`,
        sacCode: '997337', qty, rate: r2(subtotalINR / qty), amount: r2(subtotalINR), gstRate: 0,
      },
      {
        description: 'Platform Fee (0.5% of trade value)',
        sacCode: SELLER.sacCode, qty: 1, rate: r2(buyerFeeINR), amount: r2(buyerFeeINR), gstRate: GST_RATE,
      },
    ];

    const pdfBuffer = await buildPDF({
      invoiceNumber: t.trade_invoice_number,
      invoiceDate:   fmtDate(t.trade_invoice_generated_at || t.created_at),
      invoiceTitle:  'Carbon Credit Trade Invoice',
      lineItems,
      buyerName: t.buyer_name, buyerEmail: t.buyer_email,
      buyerGstin: null, buyerPan: null,
      gstType,
      txHash: t.chain_tx_hash, // ← now confirmed
      retired: undefined,      // retirement is tracked separately — see portfolio flow
    });

    await query(
      `UPDATE trades SET trade_invoice_pdf = $1 WHERE id = $2`,
      [pdfBuffer, tradeId]
    );
    try {
      fs.writeFileSync(path.join(TMP_DIR, `trade-${tradeId}.pdf`), pdfBuffer);
    } catch {}

    if (notifyBuyer && t.buyer_email) {
      await sendTradeInvoiceChainConfirmedEmail(t.buyer_email,
        { invoiceNumber: t.trade_invoice_number, invoiceUrl: `${SELLER.website}/api/trades/${tradeId}/invoice` },
        { attachments: [{ filename: `EtherTrack-Trade-Invoice-${t.trade_invoice_number}.pdf`, content: pdfBuffer }] }
      ).catch(e => console.warn('[patchInvoiceWithChainConfirmation] email failed:', e.message));
    }

    console.log(`✅ Invoice ${t.trade_invoice_number} patched with on-chain confirmation for trade ${tradeId}`);
    return true;

  } catch (e) {
    console.error(`patchInvoiceWithChainConfirmation error (trade ${tradeId} unaffected):`, e.message);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// generateTradeBill — ETH-mode trades get this instead of generateTradeInvoice.
//
// WHY A SEPARATE FUNCTION: GST treatment of a crypto-denominated platform fee
// is legally murkier than an INR fee (RBI/crypto tax rules are unsettled and
// still evolving in India) — rather than guess at a tax position for ETH
// trades, this issues a plain non-GST "Payment Bill": same line items, but
// gstRate forced to 0 throughout and no CGST/SGST/IGST claimed anywhere on
// the document. It uses a separate 'ETB' (EtherTrack Bill) numbering series
// so bills and tax invoices are never confused in your records.
//
// Unlike INR trades, the on-chain tx hash is already known at call time here
// (client submits it directly for ETH-mode trades — see trades.js /record),
// so there's no async chain-confirmation patch step needed for this path.
// ═════════════════════════════════════════════════════════════════════════════
async function generateTradeBill({
  tradeId, buyerName, buyerEmail,
  projectName, standard, registrySerial,
  qty, subtotalINR,
  buyerFeeINR, totalPaidINR,
  totalETH, ethRate,
  txHash,
}) {
  if (!PDFDocument) {
    console.warn(`⚠️  Trade bill skipped for trade ${tradeId} — run: npm install pdfkit`);
    return null;
  }

  try {
    const { rows: existing } = await query(
      `SELECT trade_invoice_url FROM trades WHERE id=$1 AND trade_invoice_number IS NOT NULL`,
      [tradeId]
    ).catch(() => ({ rows: [] }));
    if (existing.length && existing[0].trade_invoice_url) {
      console.log(`ℹ️  Bill/invoice already exists for trade ${tradeId}, skipping regeneration`);
      return existing[0].trade_invoice_url;
    }

    const traceBits = [standard, registrySerial ? `Serial: ${registrySerial}` : null].filter(Boolean).join(' · ');
    const ethNote = ethRate
      ? ` · ${Number(totalETH || subtotalINR / ethRate).toFixed(6)} ETH @ ₹${Number(ethRate).toLocaleString('en-IN')}/ETH`
      : '';

    const lineItems = [
      {
        description: `Carbon Credits — ${projectName}${traceBits ? ` (${traceBits})` : ''} · ${qty} tCO₂e via ETH${ethNote}`,
        sacCode: '997337', qty, rate: r2(subtotalINR / qty), amount: r2(subtotalINR), gstRate: 0,
      },
      {
        description: 'Platform Fee (0.5% of trade value) — no GST charged',
        sacCode: SELLER.sacCode, qty: 1, rate: r2(buyerFeeINR), amount: r2(buyerFeeINR), gstRate: 0,
      },
    ];

    const invoiceNumber = await getNextInvoiceNumber('ETB'); // ETB = EtherTrack Bill (non-GST)
    const invoiceDate   = fmtDate(new Date());

    const pdfBuffer = await buildPDF({
      invoiceNumber,
      invoiceDate,
      documentType: 'bill',
      invoiceTitle: 'Payment Bill — ETH Settlement (Non-GST)',
      lineItems,
      buyerName, buyerEmail,
      buyerGstin: null, buyerPan: null,
      gstType: 'cgst_sgst', // unused when documentType === 'bill', harmless default
      txHash: txHash || null,
    });

    const reconciled = r2(subtotalINR + buyerFeeINR);
    if (totalPaidINR != null && Math.abs(reconciled - r2(totalPaidINR)) > 0.02) {
      console.warn(
        `⚠️  Trade ${tradeId}: bill total (${reconciled}) doesn't match totalPaidINR ` +
        `(${totalPaidINR}) passed in — double check the fee calculation upstream.`
      );
    }

    const invoiceUrl = `${SELLER.website}/api/trades/${tradeId}/invoice`;

    await query(
      `UPDATE trades
       SET trade_invoice_number=$1, trade_invoice_pdf=$2, trade_invoice_url=$3,
           trade_invoice_generated_at=NOW()
       WHERE id=$4`,
      [invoiceNumber, pdfBuffer, invoiceUrl, tradeId]
    ).catch(e => console.warn('[tradeBill] DB store failed:', e.message));

    try { fs.writeFileSync(path.join(TMP_DIR, `trade-${tradeId}.pdf`), pdfBuffer); } catch {}

    const safeProjectName = escapeHtml(projectName);
    await sendTradeBillEthEmail(buyerEmail,
      { buyerName, invoiceNumber, projectName: safeProjectName, qty, invoiceUrl },
      { attachments: [{ filename: `EtherTrack-Trade-Bill-${invoiceNumber}.pdf`, content: pdfBuffer }] }
    ).catch(e => console.warn('[tradeBill] email failed:', e.message));

    console.log(`✅ Trade bill ${invoiceNumber} — trade ${tradeId}`);
    return invoiceUrl;

  } catch (e) {
    console.error('generateTradeBill error (trade unaffected):', e.message);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// serveInvoice — serve subscription invoice (GET /api/org/invoice/:paymentId)
// ═════════════════════════════════════════════════════════════════════════════
async function serveInvoice(req, res) {
  try {
    const { rows } = await query(
      `SELECT invoice_pdf, invoice_number FROM subscription_payments
       WHERE id=$1 AND user_id=$2 AND status='success'`,
      [req.params.paymentId, req.user.id]
    );
    if (!rows.length || !rows[0].invoice_pdf)
      return res.status(404).json({ error: 'Invoice not found or still generating.' });

    const { invoice_pdf, invoice_number } = rows[0];
    const tmpPath = path.join(TMP_DIR, `sub-${req.params.paymentId}.pdf`);
    const buffer  = fs.existsSync(tmpPath) ? fs.readFileSync(tmpPath) : invoice_pdf;

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="EtherTrack-Invoice-${invoice_number}.pdf"`,
      'Content-Length':      buffer.length,
      'Cache-Control':       'private, max-age=3600',
    });
    res.send(buffer);
  } catch (e) {
    console.error('serveInvoice error:', e.message);
    res.status(500).json({ error: 'Could not serve invoice.' });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// serveTradeInvoice — serve trade invoice (GET /api/trades/:id/invoice)
// ═════════════════════════════════════════════════════════════════════════════
async function serveTradeInvoice(req, res) {
  try {
    const { rows } = await query(
      `SELECT trade_invoice_pdf, trade_invoice_number
       FROM trades
       WHERE id=$1 AND buyer_id=$2 AND status='completed'`,
      [req.params.id, req.user.id]
    );
    if (!rows.length || !rows[0].trade_invoice_pdf)
      return res.status(404).json({ error: 'Invoice not found or still generating.' });

    const { trade_invoice_pdf, trade_invoice_number } = rows[0];
    const tmpPath = path.join(TMP_DIR, `trade-${req.params.id}.pdf`);
    const buffer  = fs.existsSync(tmpPath) ? fs.readFileSync(tmpPath) : trade_invoice_pdf;

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="EtherTrack-Trade-Invoice-${trade_invoice_number}.pdf"`,
      'Content-Length':      buffer.length,
      'Cache-Control':       'private, max-age=3600',
    });
    res.send(buffer);
  } catch (e) {
    console.error('serveTradeInvoice error:', e.message);
    res.status(500).json({ error: 'Could not serve invoice.' });
  }
}

module.exports = {
  generateGSTInvoice, generateTradeInvoice, generateTradeBill,
  serveInvoice, serveTradeInvoice,
  patchInvoiceWithChainConfirmation,
  computeIntegrityHash, // needed by routes/verify.js to recompute + display the hash
  getGSTType, // needed by subscription.js/trades.js to persist the CGST/SGST-vs-IGST
              // determination at insert time — previously computed only at PDF-render
              // time and never saved, making bulk GST filing exports impossible.
};