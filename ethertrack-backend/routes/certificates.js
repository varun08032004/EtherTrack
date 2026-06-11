// routes/certificates.js — signed PDF retirement certificates
// npm install pdfkit
const router  = require('express').Router();
const PDFDoc  = require('pdfkit');
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// GET /api/certificates/:certId — download signed PDF
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
    if (!rows.length) return res.status(404).json({ error: 'Certificate not found' });
    const r = rows[0];

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
  } catch (e) {
    console.error('Certificate generation error:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate certificate' });
  }
});

module.exports = router;