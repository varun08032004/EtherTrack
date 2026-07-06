'use strict';
/**
 * routes/invoiceVerify.js — EtherTrack Public Invoice Verification
 * ─────────────────────────────────────────────────────────────────────────────
 * Backs the QR code printed on every invoice/bill, which links to:
 *   {FRONTEND_URL}/verify/:invoiceNumber
 *
 * That frontend page (see VerifyInvoice.jsx) calls THIS backend endpoint:
 *   GET /api/invoices/verify/:invoiceNumber
 *
 * PUBLIC ROUTE — no auth. Anyone who scans the QR (a customer, an auditor,
 * a bank) should be able to confirm the document is genuine without logging
 * in. Because of that, this only ever returns fields that are already
 * printed on the PDF itself — nothing more sensitive than what's already
 * sitting in someone's inbox or wallet as a PDF. No full email, no wallet
 * address, no internal IDs beyond the invoice number itself.
 *
 * WIRING NEEDED (I don't have your server.js / app entry, so add this
 * yourself):
 *   const verifyRouter = require('./routes/verify');
 *   app.use('/api/invoices', verifyRouter);
 * ─────────────────────────────────────────────────────────────────────────────
 */

const router      = require('express').Router();
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { safeQuery: query }  = require('../db/pool');
const { computeIntegrityHash } = require('../services/invoice');

// Generous but bounded — this is public and could get hit by anyone/anything
// scanning a QR code, including scraping bots. Not the same trust level as
// authenticated routes, so rate limit by IP.
const verifyLimiter = rateLimit({
  windowMs: 60_000, max: 30,
  keyGenerator: req => ipKeyGenerator(req),
});

function maskName(fullName) {
  if (!fullName) return 'Verified Buyer';
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0];
  const lastInitial = parts.length > 1 ? ` ${parts[parts.length - 1][0]}.` : '';
  return `${first}${lastInitial}`;
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return null;
  const [user, domain] = email.split('@');
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(user.length - 2, 3))}@${domain}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/invoices/verify/:invoiceNumber
// Handles both trade invoices/bills (ETT-/ETB- prefix) and subscription
// invoices (ET- prefix) since both live in different tables.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/verify/:invoiceNumber', verifyLimiter, async (req, res) => {
  const { invoiceNumber } = req.params;

  if (!invoiceNumber || !/^[A-Z0-9-]{5,40}$/.test(invoiceNumber)) {
    return res.status(400).json({ found: false, error: 'Invalid invoice number format' });
  }

  try {
    // Trade invoice or ETH bill — both stored on the trades table
    if (invoiceNumber.startsWith('ETT-') || invoiceNumber.startsWith('ETB-')) {
      const { rows } = await query(
        `SELECT t.trade_invoice_number, t.trade_invoice_generated_at,
                t.buyer_pays_inr, t.gst_inr, t.payment_mode,
                t.chain_tx_hash, t.chain_status,
                cb.project_name, cb.standard,
                u.full_name AS buyer_name, u.email AS buyer_email
         FROM trades t
         LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
         LEFT JOIN users u ON u.id = t.buyer_id
         WHERE t.trade_invoice_number = $1
         LIMIT 1`,
        [invoiceNumber]
      );

      if (!rows.length) {
        return res.status(404).json({ found: false, error: 'No invoice or bill found with this number' });
      }
      const t = rows[0];
      const isBill = invoiceNumber.startsWith('ETB-');
      const totalAmount = parseFloat(t.buyer_pays_inr);

      const integrityHash = computeIntegrityHash({
        invoiceNumber: t.trade_invoice_number,
        invoiceDate: t.trade_invoice_generated_at,
        totalAmount,
        buyerEmail: t.buyer_email || '',
      });

      return res.json({
        found: true,
        documentType: isBill ? 'bill' : 'tax_invoice',
        invoiceNumber: t.trade_invoice_number,
        issuedAt: t.trade_invoice_generated_at,
        projectName: t.project_name,
        standard: t.standard,
        totalAmount,
        gstCharged: !isBill,
        gstAmount: isBill ? 0 : parseFloat(t.gst_inr || 0),
        paymentMode: t.payment_mode,
        buyerName: maskName(t.buyer_name),
        buyerEmail: maskEmail(t.buyer_email),
        onChain: Boolean(t.chain_tx_hash),
        chainStatus: t.chain_status || null,
        chainTxHash: t.chain_tx_hash || null,
        chainExplorerUrl: t.chain_tx_hash
          ? `https://sepolia.etherscan.io/tx/${t.chain_tx_hash}`
          : null,
        integrityHash,
        issuer: 'EtherTrack Technologies Pvt Ltd',
      });
    }

    // Subscription invoice
    if (invoiceNumber.startsWith('ET-')) {
      const { rows } = await query(
        `SELECT sp.invoice_number, sp.invoice_generated_at, sp.status,
                u.full_name AS buyer_name, u.email AS buyer_email
         FROM subscription_payments sp
         LEFT JOIN users u ON u.id = sp.user_id
         WHERE sp.invoice_number = $1
         LIMIT 1`,
        [invoiceNumber]
      );
      if (!rows.length) {
        return res.status(404).json({ found: false, error: 'No invoice found with this number' });
      }
      const sp = rows[0];
      return res.json({
        found: true,
        documentType: 'tax_invoice',
        invoiceNumber: sp.invoice_number,
        issuedAt: sp.invoice_generated_at,
        status: sp.status,
        buyerName: maskName(sp.buyer_name),
        buyerEmail: maskEmail(sp.buyer_email),
        issuer: 'EtherTrack Technologies Pvt Ltd',
      });
    }

    return res.status(404).json({ found: false, error: 'Unrecognized invoice number prefix' });

  } catch (e) {
    console.error('[verify]', e.message);
    return res.status(500).json({ found: false, error: 'Verification lookup failed' });
  }
});

module.exports = router;