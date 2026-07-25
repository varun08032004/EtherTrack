// routes/certificates.js — signed PDF certificates (Ownership + Retirement)
// npm install pdfkit
const router  = require('express').Router();
const PDFDoc  = require('pdfkit');
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// GET /api/certificates/:certId — download signed PDF
// [CERT-OWNERSHIP] Extended with a fallback: if certId isn't found in the
// original `retirements` table (wallet-based retirements only, unchanged
// below), falls back to the new unified `certificates` table, which covers
// (a) Certificates of Ownership for ANY purchase — wallet or ledger-based —
// and (b) Certificates of Retirement for wallet-FREE (ledger) retirements,
// which never had a `retirements` row to begin with since they don't burn
// a personal on-chain balance. The original retirements-table path below is
// completely untouched — every certificate ever issued through it keeps
// working exactly as before.
router.get('/:certId', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT r.*, u.full_name, u.email, u.wallet_address
       FROM retirements r
       JOIN users u ON u.id = r.retired_by
       WHERE r.certificate_id = $1
         AND (r.retired_by = $2 OR r.is_public = TRUE)
       LIMIT 1`,
      [req.params.certId, req.user.id]
    );

    if (rows.length) {
      return renderRetirementPDF(res, rows[0]);
    }

    // [CERT-OWNERSHIP] Fallback — check the new unified certificates table
    const { rows: certRows } = await query(
      `SELECT c.*, u.full_name, u.email, u.wallet_address,
              cb.project_name, cb.standard, cb.project_type, cb.developer,
              cb.vintage_year, cb.country, cb.project_location AS location,
              cb.registry_serial AS serial_number,
              t.retire_scope, t.beneficiary_name, t.beneficiary_entity,
              t.reporting_standard, t.purpose
       FROM certificates c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN trades t ON t.id = c.trade_id
       LEFT JOIN carbon_batches cb ON cb.token_id = c.token_id
       WHERE c.cert_id = $1 AND c.user_id = $2
       LIMIT 1`,
      [req.params.certId, req.user.id]
    );

    if (!certRows.length) return res.status(404).json({ error: 'Certificate not found' });
    return renderUnifiedPDF(res, certRows[0]);

  } catch (e) {
    console.error('Certificate generation error:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate certificate' });
  }
});

// ── Original retirement PDF renderer — UNCHANGED, extracted into a function
// so both lookup paths above can share the surrounding route handler ──────
function renderRetirementPDF(res, r) {

    const doc = new PDFDoc({ size: 'A4', margin: 60 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="EtherTrack-Certificate-${r.certificate_id}.pdf"`);
    doc.pipe(res);

    // Header bar
    doc.rect(0, 0, doc.page.width, 8).fill('#16a34a');

    // Logo + title
    doc.moveDown(1);
    doc.fontSize(22).fillColor('#16a34a').font('Helvetica-Bold').text('ETHERTRACK', { align: 'center' });
    doc.fontSize(11).fillColor('#555').font('Helvetica').text('Carbon Credit Retirement Certificate', { align: 'center' });
    doc.moveDown(0.5);

    // Cert ID box
    doc.rect(60, doc.y, doc.page.width - 120, 36).fillAndStroke('#f0fdf4', '#16a34a');
    doc.fontSize(10).fillColor('#166534').font('Helvetica-Bold')
       .text(`Certificate ID: ${r.certificate_id}`, 60, doc.y - 28, { align: 'center', width: doc.page.width - 120 });
    doc.moveDown(1.5);

    // This certifies
    doc.fontSize(12).fillColor('#111').font('Helvetica')
       .text('This certifies that', { align: 'center' });
    doc.fontSize(16).fillColor('#16a34a').font('Helvetica-Bold')
       .text(r.beneficiary_name || r.full_name || 'Unknown', { align: 'center' });
    doc.fontSize(12).fillColor('#111').font('Helvetica')
       .text(`has retired ${r.amount} carbon credit${r.amount > 1 ? 's' : ''} (${r.amount} tCO₂e)`, { align: 'center' });
    doc.moveDown(1);

    // Details table
    const left = 80, col2 = 280, rowH = 22;
    const rows2 = [
      ['Project Name',     r.project_name    || '—'],
      ['Standard',         r.standard        || '—'],
      ['Project Type',     r.project_type    || '—'],
      ['Vintage Year',     r.vintage_year    || '—'],
      ['Serial Number',    r.serial_number   || '—'],
      ['Location',         r.location        || '—'],
      ['Country',          r.country         || '—'],
      ['Retirement Date',  r.retired_at ? new Date(r.retired_at).toLocaleDateString('en-IN') : '—'],
      ['Purpose',          r.purpose         || 'Voluntary Offset'],
      ['Reporting Std',    r.reporting_standard || 'GHG Protocol'],
      ['Scope',            r.retire_scope    || '1'],
      ['On-chain TX',      r.tx_hash ? `${r.tx_hash.slice(0,20)}...` : 'INR Settlement'],
      ['Beneficiary',      r.beneficiary_name || r.full_name || '—'],
    ];

    let y = doc.y + 10;
    doc.rect(left - 10, y - 4, doc.page.width - left * 2 + 20, rows2.length * rowH + 8).stroke('#e5e7eb');
    rows2.forEach(([label, value], i) => {
      const rowY = y + i * rowH;
      if (i % 2 === 0) doc.rect(left - 10, rowY - 2, doc.page.width - left * 2 + 20, rowH).fill('#f9fafb').fillColor('#f9fafb');
      doc.fontSize(9).fillColor('#555').font('Helvetica-Bold').text(label, left, rowY, { width: 180 });
      doc.fontSize(9).fillColor('#111').font('Helvetica').text(String(value), col2, rowY, { width: 260 });
    });

    doc.y = y + rows2.length * rowH + 20;
    doc.moveDown(1);

    // Statement
    doc.rect(60, doc.y, doc.page.width - 120, 2).fill('#16a34a');
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor('#555').font('Helvetica')
       .text(
         `This certificate confirms the permanent retirement of ${r.amount} tCO₂e from the voluntary carbon market. ` +
         `The retired credits have been cancelled on the ${r.standard || 'VCS'} registry and cannot be used again. ` +
         `This retirement is recorded immutably on the Ethereum blockchain.`,
         { align: 'center', width: doc.page.width - 120 }
       );
    doc.moveDown(1);

    // Issuer + date
    const issueDate = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.fontSize(9).fillColor('#888').text(`Issued by EtherTrack on ${issueDate}`, { align: 'center' });
    doc.text('India\'s Carbon Credit Exchange · ethertrackapp.vercel.app', { align: 'center' });
    doc.moveDown(0.5);
    if (r.tx_hash) doc.fontSize(8).fillColor('#aaa').text(`Verify on-chain: https://sepolia.etherscan.io/tx/${r.tx_hash}`, { align: 'center' });

    // Footer bar
    doc.rect(0, doc.page.height - 8, doc.page.width, 8).fill('#16a34a');

    doc.end();
}

// ── New renderer — covers Ownership certs (any purchase, wallet or ledger)
// and Retirement certs for wallet-free (ledger) users, who never get a row
// in the original `retirements` table since they don't burn a personal
// on-chain balance. Same visual language as renderRetirementPDF above,
// adapted per cert_type.
function renderUnifiedPDF(res, c) {
  const isRetirement = c.cert_type === 'RETIREMENT';
  const accentColor  = isRetirement ? '#dc2626' : '#16a34a';
  const accentLight  = isRetirement ? '#fef2f2' : '#f0fdf4';

  const doc = new PDFDoc({ size: 'A4', margin: 60 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="EtherTrack-Certificate-${c.cert_id}.pdf"`);
  doc.pipe(res);

  doc.rect(0, 0, doc.page.width, 8).fill(accentColor);

  doc.moveDown(1);
  doc.fontSize(22).fillColor(accentColor).font('Helvetica-Bold').text('ETHERTRACK', { align: 'center' });
  doc.fontSize(11).fillColor('#555').font('Helvetica')
     .text(isRetirement ? 'Carbon Credit Retirement Certificate' : 'Carbon Credit Certificate of Ownership', { align: 'center' });
  doc.moveDown(0.5);

  doc.rect(60, doc.y, doc.page.width - 120, 36).fillAndStroke(accentLight, accentColor);
  doc.fontSize(10).fillColor(isRetirement ? '#991b1b' : '#166534').font('Helvetica-Bold')
     .text(`Certificate ID: ${c.cert_id}`, 60, doc.y - 28, { align: 'center', width: doc.page.width - 120 });
  doc.moveDown(1.5);

  doc.fontSize(12).fillColor('#111').font('Helvetica')
     .text('This certifies that', { align: 'center' });
  doc.fontSize(16).fillColor(accentColor).font('Helvetica-Bold')
     .text(c.beneficiary_name || c.full_name || 'Unknown', { align: 'center' });
  doc.fontSize(12).fillColor('#111').font('Helvetica')
     .text(
       isRetirement
         ? `has retired ${c.quantity} carbon credit${c.quantity > 1 ? 's' : ''} (${c.quantity} tCO\u2082e)`
         : `holds ${c.quantity} carbon credit${c.quantity > 1 ? 's' : ''} (${c.quantity} tCO\u2082e)`,
       { align: 'center' }
     );
  doc.moveDown(1);

  const left = 80, col2 = 280, rowH = 22;
  const rows2 = [
    ['Project Name',    c.project_name || '—'],
    ['Standard',        c.standard     || '—'],
    ['Project Type',    c.project_type || '—'],
    ['Vintage Year',    c.vintage_year || '—'],
    ['Serial Number',   c.serial_number || '—'],
    ['Location',        c.location     || '—'],
    ['Country',         c.country      || '—'],
    [isRetirement ? 'Retirement Date' : 'Issued Date',
     c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN') : '—'],
    ['Custody Model',   c.custody_model === 'pooled' ? 'Pooled Custody (Wallet-Free)' : 'Personal Wallet'],
    ['On-chain TX',     c.tx_hash ? `${c.tx_hash.slice(0, 20)}...` : 'Pending'],
    ['Holder',          c.beneficiary_name || c.full_name || '—'],
  ];

  let y = doc.y + 10;
  doc.rect(left - 10, y - 4, doc.page.width - left * 2 + 20, rows2.length * rowH + 8).stroke('#e5e7eb');
  rows2.forEach(([label, value], i) => {
    const rowY = y + i * rowH;
    if (i % 2 === 0) doc.rect(left - 10, rowY - 2, doc.page.width - left * 2 + 20, rowH).fill('#f9fafb').fillColor('#f9fafb');
    doc.fontSize(9).fillColor('#555').font('Helvetica-Bold').text(label, left, rowY, { width: 180 });
    doc.fontSize(9).fillColor('#111').font('Helvetica').text(String(value), col2, rowY, { width: 260 });
  });

  doc.y = y + rows2.length * rowH + 20;
  doc.moveDown(1);

  doc.rect(60, doc.y, doc.page.width - 120, 2).fill(accentColor);
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor('#555').font('Helvetica')
     .text(
       isRetirement
         ? `This certificate confirms the permanent retirement of ${c.quantity} tCO\u2082e from the voluntary carbon market. ` +
           `This retirement is recorded immutably on the Ethereum blockchain — pooled custody, no personal wallet required, ` +
           `independently verifiable by anyone using the transaction hash below.`
         : `This certificate confirms ownership of ${c.quantity} tCO\u2082e, held in EtherTrack's pooled custody on the holder's ` +
           `behalf. This is recorded immutably on the Ethereum blockchain — independently verifiable by anyone using the ` +
           `transaction hash below, without requiring a personal wallet.`,
       { align: 'center', width: doc.page.width - 120 }
     );
  doc.moveDown(1);

  const issueDate = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.fontSize(9).fillColor('#888').text(`Issued by EtherTrack on ${issueDate}`, { align: 'center' });
  doc.text('India\'s Carbon Credit Exchange · ethertrackapp.vercel.app', { align: 'center' });
  doc.moveDown(0.5);
  if (c.tx_hash) doc.fontSize(8).fillColor('#aaa').text(`Verify on-chain: https://sepolia.etherscan.io/tx/${c.tx_hash}`, { align: 'center' });

  doc.rect(0, doc.page.height - 8, doc.page.width, 8).fill(accentColor);

  doc.end();
}

module.exports = router;