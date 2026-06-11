// services/invoice.js — EtherTrack
// ─────────────────────────────────────────────────────────────────
// GST-compliant tax invoice generator for Render / Railway.
//
// HOW TO GO LIVE:
//   1. npm install pdfkit                          (one time)
//   2. Run migrations/add_invoice_columns.sql      (one time)
//   3. Fill in the SELLER block below when you get your GST registration
//   4. That's it — no env vars required to deploy right now
//
// UNTIL YOU HAVE GST REGISTRATION:
//   • Invoices are generated with "GSTIN_PENDING_REGISTRATION" watermark
//   • Payments are NEVER blocked — invoice is always non-blocking
//   • If pdfkit is not installed yet, invoices are silently skipped
//   • Once you fill in real values below, all future invoices are correct
// ─────────────────────────────────────────────────────────────────

'use strict';

const path = require('path');
const fs   = require('fs');
const { safeQuery: query } = require('../db/pool');
const { sendEmail }        = require('./email');

// ─────────────────────────────────────────────────────────────────
// ── FILL THESE IN WHEN YOU GET YOUR GST REGISTRATION ─────────────
// ── Everything works as-is until then ────────────────────────────
// ─────────────────────────────────────────────────────────────────
const SELLER = {
  name:      'EtherTrack Technologies Pvt Ltd',   // TODO: your registered company name
  address:   'Mumbai, Maharashtra, India',         // TODO: your full registered address
  state:     'Maharashtra',                        // TODO: your registered state
  stateCode: '27',                                 // TODO: your state GST code (27 = Maharashtra)
  gstin:     'GSTIN_PENDING_REGISTRATION',         // TODO: fill when GST registered e.g. 27AABCE1234F1Z5
  pan:       'PAN_PENDING',                        // TODO: fill your company PAN e.g. AABCE1234F
  sacCode:   '997331',                             // SAC for software subscriptions — correct, don't change
  email:     'billing@ethertrack.in',              // TODO: change if different
  website:   process.env.FRONTEND_URL || 'https://app.ethertrack.in',
};

const INVOICE_PREFIX = 'ET';    // invoice numbers will be ET-2025-00001, ET-2025-00002 …
const GST_RATE       = 0.18;    // 18% GST on software services — fixed by law

// ── Graceful degradation: works even if pdfkit not installed ──────
let PDFDocument = null;
try {
  PDFDocument = require('pdfkit');
} catch {
  console.warn('⚠️  pdfkit not installed — invoices will be skipped. Run: npm install pdfkit');
}

// ── Tmp dir for fast local serving within same Render dyno ───────
const TMP_DIR = '/tmp/et-invoices';
try { if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true }); } catch {}

// ── Sequential invoice number ─────────────────────────────────────
async function getNextInvoiceNumber() {
  const year = new Date().getFullYear();
  const { rows } = await query(
    `SELECT COUNT(*) AS cnt FROM subscription_payments
     WHERE status='success' AND EXTRACT(YEAR FROM created_at)=$1`,
    [year]
  );
  const seq = (parseInt(rows[0]?.cnt || 0) + 1).toString().padStart(5, '0');
  return `${INVOICE_PREFIX}-${year}-${seq}`;
}

// ── Format INR ────────────────────────────────────────────────────
const inr = n => `Rs. ${parseFloat(n || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

// ── Amount in words (legal requirement on Indian invoices) ────────
function toWords(n) {
  const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
             'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
             'Seventeen','Eighteen','Nineteen'];
  const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const num = Math.round(n);
  if (num === 0) return 'Zero';
  const cvt = x => {
    if (x < 20)        return a[x];
    if (x < 100)       return b[Math.floor(x/10)] + (x%10 ? ' '+a[x%10] : '');
    if (x < 1000)      return a[Math.floor(x/100)] + ' Hundred' + (x%100 ? ' '+cvt(x%100) : '');
    if (x < 100000)    return cvt(Math.floor(x/1000))    + ' Thousand' + (x%1000    ? ' '+cvt(x%1000)    : '');
    if (x < 10000000)  return cvt(Math.floor(x/100000))  + ' Lakh'     + (x%100000  ? ' '+cvt(x%100000)  : '');
    return               cvt(Math.floor(x/10000000)) + ' Crore'    + (x%10000000 ? ' '+cvt(x%10000000) : '');
  };
  return cvt(num) + ' Rupees Only';
}

// ── IGST vs CGST+SGST ────────────────────────────────────────────
// Buyer GSTIN starts with seller state code → intrastate → CGST+SGST
// No GSTIN or different state → interstate → IGST
function getGSTType(buyerGstin) {
  if (!buyerGstin || buyerGstin.length < 2) return 'igst';
  return buyerGstin.slice(0, 2) === SELLER.stateCode ? 'cgst_sgst' : 'igst';
}

// ── PDF builder ───────────────────────────────────────────────────
function buildInvoicePDF(data) {
  return new Promise((resolve, reject) => {
    const {
      invoiceNumber, invoiceDate,
      plan, cycle,
      baseAmount, gstAmount, totalAmount,
      buyerName, buyerEmail, buyerGstin, buyerPan,
      gstType,
    } = data;

    const doc    = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Tax Invoice ${invoiceNumber}`, Author: SELLER.name } });
    const chunks = [];
    doc.on('data',  c => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W  = 595.28;
    const H  = 841.89;
    const M  = 40;
    const CW = W - M * 2;

    const GREEN = '#22c55e';
    const DARK  = '#040706';
    const GREY  = '#6b7280';
    const LGREY = '#f0fdf4';
    const BLACK = '#111827';
    const WHITE = '#ffffff';

    // ── Header ──────────────────────────────────────────────────
    doc.rect(0, 0, W, 118).fill(DARK);
    doc.fontSize(22).font('Helvetica-Bold').fillColor(GREEN).text('EtherTrack', M, 30);
    doc.fontSize(9).font('Helvetica').fillColor('#86efac').text('Carbon Credit Exchange Platform', M, 56);
    doc.fontSize(8).fillColor('#86efac66').text(SELLER.website, M, 70).text(SELLER.email, M, 82);
    doc.fontSize(18).font('Helvetica-Bold').fillColor(WHITE).text('TAX INVOICE', 0, 36, { width: W-M, align: 'right' });
    doc.fontSize(8.5).font('Helvetica').fillColor('#86efac')
      .text(`Invoice No: ${invoiceNumber}`, 0, 62, { width: W-M, align: 'right' })
      .text(`Date: ${invoiceDate}`,         0, 76, { width: W-M, align: 'right' });

    // Pending GST watermark note
    if (SELLER.gstin === 'GSTIN_PENDING_REGISTRATION') {
      doc.fontSize(7).fillColor('#f59e0b')
        .text('⚠ GST registration pending — invoice will be reissued once registered', 0, 94, { width: W-M, align: 'right' });
    }

    let y = 132;

    // ── Seller + Buyer boxes ─────────────────────────────────────
    const colW = (CW/2) - 10;

    doc.rect(M, y, colW, 112).fill(LGREY).stroke('#e5e7eb');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(GREEN).text('BILLED BY', M+12, y+12);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(BLACK).text(SELLER.name, M+12, y+26, { width: colW-20 });
    doc.fontSize(7.5).font('Helvetica').fillColor(GREY)
      .text(SELLER.address,                                   M+12, y+44, { width: colW-20 })
      .text(`GSTIN: ${SELLER.gstin}`,                         M+12, y+72)
      .text(`PAN:   ${SELLER.pan}`,                           M+12, y+85)
      .text(`State: ${SELLER.state} (${SELLER.stateCode})`,   M+12, y+98);

    const bx = M + colW + 20;
    doc.rect(bx, y, colW, 112).fill(LGREY).stroke('#e5e7eb');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(GREEN).text('BILLED TO', bx+12, y+12);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(BLACK).text(buyerName || 'Individual / Unlisted', bx+12, y+26, { width: colW-20 });
    doc.fontSize(7.5).font('Helvetica').fillColor(GREY).text(buyerEmail, bx+12, y+44, { width: colW-20 });
    let by = y + 58;
    if (buyerGstin) { doc.text(`GSTIN: ${buyerGstin}`, bx+12, by, { width: colW-20 }); by += 13; }
    if (buyerPan)   { doc.text(`PAN:   ${buyerPan}`,   bx+12, by, { width: colW-20 }); by += 13; }
    if (!buyerGstin) doc.fillColor('#f59e0b').text('B2C — No GSTIN provided', bx+12, by, { width: colW-20 });

    y += 126;

    // ── Line items header ────────────────────────────────────────
    doc.rect(M, y, CW, 22).fill(DARK);
    const cols = [
      { label: '#',            x: M+8,   w: 18,  align: 'left'   },
      { label: 'Description',  x: M+30,  w: 200, align: 'left'   },
      { label: 'SAC',          x: M+234, w: 55,  align: 'center' },
      { label: 'Qty',          x: M+293, w: 28,  align: 'center' },
      { label: 'Rate (INR)',   x: M+325, w: 95,  align: 'right'  },
      { label: 'Amount (INR)', x: M+424, w: 91,  align: 'right'  },
    ];
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(WHITE);
    cols.forEach(c => doc.text(c.label, c.x, y+7, { width: c.w, align: c.align }));
    y += 22;

    // ── Line item row ────────────────────────────────────────────
    const planLabel  = plan.charAt(0).toUpperCase() + plan.slice(1);
    const cycleLabel = cycle === 'annual' ? 'Annual' : 'Monthly';

    doc.rect(M, y, CW, 38).fill(WHITE).stroke('#e5e7eb');
    doc.fontSize(7.5).font('Helvetica').fillColor(BLACK);
    doc.text('1',                                          cols[0].x, y+7,  { width: cols[0].w, align: 'left'   });
    doc.text(`EtherTrack ${planLabel} Plan (${cycleLabel})`, cols[1].x, y+7,  { width: cols[1].w, align: 'left'   });
    doc.text('Software as a Service — Carbon Credit Exchange', cols[1].x, y+19, { width: cols[1].w, align: 'left'   });
    doc.text(SELLER.sacCode,                               cols[2].x, y+13, { width: cols[2].w, align: 'center' });
    doc.text('1',                                          cols[3].x, y+13, { width: cols[3].w, align: 'center' });
    doc.text(inr(baseAmount),                              cols[4].x, y+13, { width: cols[4].w, align: 'right'  });
    doc.text(inr(baseAmount),                              cols[5].x, y+13, { width: cols[5].w, align: 'right'  });
    y += 38;

    // ── GST summary ──────────────────────────────────────────────
    const sx = M + CW * 0.54;
    const sw = CW * 0.46;
    const summaryRow = (label, value, bold = false, color = BLACK) => {
      doc.rect(sx, y, sw, 20).fill(bold ? LGREY : WHITE).stroke('#e5e7eb');
      doc.fontSize(8).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color)
        .text(label, sx+8,       y+6, { width: sw*0.54 })
        .text(value, sx+sw*0.54, y+6, { width: sw*0.43, align: 'right' });
      y += 20;
    };

    summaryRow('Taxable Amount', inr(baseAmount));
    if (gstType === 'cgst_sgst') {
      summaryRow(`CGST @ ${(GST_RATE/2*100).toFixed(1)}%`, inr(gstAmount/2));
      summaryRow(`SGST @ ${(GST_RATE/2*100).toFixed(1)}%`, inr(gstAmount/2));
    } else {
      summaryRow(`IGST @ ${(GST_RATE*100).toFixed(0)}%`, inr(gstAmount));
    }
    summaryRow('Total Amount', inr(totalAmount), true, GREEN);
    y += 10;

    // ── Amount in words ──────────────────────────────────────────
    doc.rect(M, y, CW, 26).fill(LGREY).stroke('#e5e7eb');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(GREY).text('Amount in Words:', M+8, y+9);
    doc.font('Helvetica').fillColor(BLACK).text(toWords(totalAmount), M+115, y+9, { width: CW-125 });
    y += 38;

    // ── GST supply note ──────────────────────────────────────────
    doc.fontSize(7).font('Helvetica').fillColor(GREY).text(
      gstType === 'cgst_sgst'
        ? `Intrastate supply — CGST + SGST applicable. Seller state: ${SELLER.state} (${SELLER.stateCode})`
        : `Interstate supply — IGST applicable. Seller state: ${SELLER.state} (${SELLER.stateCode})`,
      M, y, { width: CW }
    );
    y += 18;

    // ── Payment details ──────────────────────────────────────────
    doc.rect(M, y, CW, 44).fill(LGREY).stroke('#e5e7eb');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(GREEN).text('PAYMENT DETAILS', M+8, y+8);
    doc.font('Helvetica').fillColor(GREY)
      .text(`Invoice No: ${invoiceNumber}`,          M+8,   y+22)
      .text(`Date: ${invoiceDate}`,                   M+160, y+22)
      .text(`Plan: ${planLabel} (${cycleLabel})`,     M+8,   y+34)
      .text(`SAC Code: ${SELLER.sacCode}`,            M+160, y+34);
    y += 56;

    // ── Declaration ──────────────────────────────────────────────
    doc.rect(M, y, CW, 40).fill(WHITE).stroke('#e5e7eb');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(GREY).text('DECLARATION', M+8, y+7);
    doc.font('Helvetica').fillColor(GREY).text(
      'We declare that this invoice shows the actual price of the services described and that all particulars are true and correct. ' +
      'This is a computer-generated invoice and does not require a physical signature.',
      M+8, y+19, { width: CW-16 }
    );
    y += 52;

    // ── Authorised signatory ─────────────────────────────────────
    doc.rect(M+CW*0.62, y, CW*0.38, 46).fill(LGREY).stroke('#e5e7eb');
    doc.fontSize(8).font('Helvetica-Bold').fillColor(BLACK).text('For '+SELLER.name, M+CW*0.62+8, y+8, { width: CW*0.38-16 });
    doc.fontSize(7.5).font('Helvetica').fillColor(GREY).text('Authorised Signatory', M+CW*0.62+8, y+32, { width: CW*0.38-16 });
    y += 58;

    // ── Footer ───────────────────────────────────────────────────
    doc.rect(0, H-46, W, 46).fill(DARK);
    doc.fontSize(7).font('Helvetica').fillColor('#86efac55')
      .text(`${SELLER.name}  ·  GSTIN: ${SELLER.gstin}  ·  ${SELLER.email}  ·  ${SELLER.website}`, M, H-30, { width: CW, align: 'center' })
      .text('Generated in compliance with CGST Rules 2017 and the Goods and Services Tax Act, 2017.', M, H-18, { width: CW, align: 'center' });

    doc.end();
  });
}

// ═════════════════════════════════════════════════════════════════
// ── MAIN EXPORT ───────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════

/**
 * generateGSTInvoice — called from org.js after every successful payment.
 * Always non-blocking — never fails the payment if invoice has an error.
 */
async function generateGSTInvoice({ paymentId, plan, cycle, amount, gstin, pan, buyerName, buyerEmail }) {
  if (!PDFDocument) {
    console.warn(`⚠️  Invoice skipped for payment ${paymentId} — run: npm install pdfkit`);
    return null;
  }

  try {
    const baseAmount  = Math.round(amount);
    const gstAmount   = Math.round(baseAmount * GST_RATE);
    const totalAmount = baseAmount + gstAmount;
    const gstType     = getGSTType(gstin);

    const invoiceNumber = await getNextInvoiceNumber();
    const invoiceDate   = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const pdfBuffer = await buildInvoicePDF({
      invoiceNumber, invoiceDate,
      plan, cycle,
      baseAmount, gstAmount, totalAmount,
      buyerName, buyerEmail,
      buyerGstin: gstin || null,
      buyerPan:   pan   || null,
      gstType,
    });

    const invoiceUrl = `${SELLER.website}/api/org/invoice/${paymentId}`;

    // Store in DB — primary store, survives Render restarts
    await query(
      `UPDATE subscription_payments
       SET invoice_number=$1, invoice_pdf=$2, invoice_url=$3, invoice_generated_at=NOW()
       WHERE id=$4`,
      [invoiceNumber, pdfBuffer, invoiceUrl, paymentId]
    ).catch(e => console.warn('DB invoice store failed (non-critical):', e.message));

    // Also save to /tmp for fast serving within same dyno session
    try { fs.writeFileSync(path.join(TMP_DIR, `${paymentId}.pdf`), pdfBuffer); } catch {}

    // Email with PDF attachment
    await sendEmail({
      to:      buyerEmail,
      subject: `EtherTrack Tax Invoice ${invoiceNumber}`,
      html: `
        <div style="font-family:monospace;background:#040706;color:#f0fdf4;padding:32px;border-radius:12px;max-width:520px;margin:0 auto;">
          <div style="color:#22c55e;font-size:20px;font-weight:700;margin-bottom:16px;">EtherTrack 🌿</div>
          <p style="color:#d1fae5;margin-bottom:16px;">Thank you for subscribing! Your GST tax invoice is attached and available below.</p>
          <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:24px;background:#050809;border-radius:8px;overflow:hidden;">
            <tr style="border-bottom:1px solid #22c55e11;">
              <td style="color:#86efac44;padding:10px 14px;">Invoice No</td>
              <td style="color:#f0fdf4;padding:10px 14px;text-align:right;font-weight:700;">${invoiceNumber}</td>
            </tr>
            <tr style="border-bottom:1px solid #22c55e11;">
              <td style="color:#86efac44;padding:10px 14px;">Date</td>
              <td style="color:#f0fdf4;padding:10px 14px;text-align:right;">${invoiceDate}</td>
            </tr>
            <tr style="border-bottom:1px solid #22c55e11;">
              <td style="color:#86efac44;padding:10px 14px;">Plan</td>
              <td style="color:#22c55e;padding:10px 14px;text-align:right;font-weight:700;">${plan.charAt(0).toUpperCase()+plan.slice(1)} · ${cycle === 'annual' ? 'Annual' : 'Monthly'}</td>
            </tr>
            <tr style="border-bottom:1px solid #22c55e11;">
              <td style="color:#86efac44;padding:10px 14px;">Taxable Amount</td>
              <td style="color:#f0fdf4;padding:10px 14px;text-align:right;">Rs. ${baseAmount.toLocaleString('en-IN')}</td>
            </tr>
            <tr style="border-bottom:1px solid #22c55e11;">
              <td style="color:#86efac44;padding:10px 14px;">GST @ 18%</td>
              <td style="color:#f0fdf4;padding:10px 14px;text-align:right;">Rs. ${gstAmount.toLocaleString('en-IN')}</td>
            </tr>
            <tr>
              <td style="color:#22c55e;padding:12px 14px;font-weight:700;">Total Paid</td>
              <td style="color:#22c55e;padding:12px 14px;text-align:right;font-weight:700;font-size:14px;">Rs. ${totalAmount.toLocaleString('en-IN')}</td>
            </tr>
          </table>
          <a href="${invoiceUrl}" style="display:inline-block;padding:13px 28px;background:#14532d;color:#d1fae5;border-radius:8px;text-decoration:none;font-weight:700;font-size:12px;letter-spacing:.05em;">
            ↓ DOWNLOAD GST INVOICE (PDF)
          </a>
          <p style="color:#86efac22;font-size:11px;margin-top:24px;line-height:1.7;">
            PDF also attached to this email. Keep for ITC claims.<br/>
            Queries: ${SELLER.email}
          </p>
        </div>
      `,
      attachments: [{
        filename:    `EtherTrack-Invoice-${invoiceNumber}.pdf`,
        content:     pdfBuffer,
        contentType: 'application/pdf',
      }],
    }).catch(e => console.warn('Invoice email failed (non-critical):', e.message));

    console.log(`✅ Invoice ${invoiceNumber} generated — payment ${paymentId}`);
    return invoiceUrl;

  } catch (e) {
    console.error('generateGSTInvoice error (payment unaffected):', e.message);
    return null;
  }
}

// ── Serve invoice PDF from DB ─────────────────────────────────────
async function serveInvoice(req, res) {
  try {
    const { rows } = await query(
      `SELECT invoice_pdf, invoice_number FROM subscription_payments
       WHERE id=$1 AND user_id=$2 AND status='success'`,
      [req.params.paymentId, req.user.id]
    );

    if (!rows.length || !rows[0].invoice_pdf)
      return res.status(404).json({ error: 'Invoice not found. It may still be generating — try again shortly.' });

    const { invoice_pdf, invoice_number } = rows[0];
    const tmpPath = path.join(TMP_DIR, `${req.params.paymentId}.pdf`);
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
    res.status(500).json({ error: 'Could not serve invoice. Please contact support.' });
  }
}

module.exports = { generateGSTInvoice, serveInvoice };