// routes/verify.js — PUBLIC route, no login required (by design — this is
// a public retirement-certificate verification endpoint, similar to how
// Verra/Gold Standard's own registries let anyone check a retirement is
// real. Third parties, auditors, and ESG reviewers need to verify a
// company's retirement claim without needing an EtherTrack account.
//
// [SECURITY FIXES — see inline comments below]
//   1. Rate limiting added — this file previously had NONE at all.
//   2. Fuzzy ILIKE substring fallback removed — it matched on just the
//      last 8 characters of a certificate ID, which combined with
//      generateCertId()'s low-entropy format (sequential tokenId +
//      timestamp-derived suffix, not cryptographically random — see
//      services/certificates.js) made certificates trivially guessable.
//      A "verification" endpoint that succeeds on a partial substring
//      match isn't actually verifying anything.
//   3. beneficiary_gstin masked — a business tax ID is more sensitive
//      than the retiring entity's name (which is the legitimate, intended-
//      to-be-public part of a retirement certificate, same as real
//      carbon registries). Full GSTIN + company name together is useful
//      for GSTIN-based social engineering; a partial mask still lets a
//      verifier confirm authenticity without handing out the full number.
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { safeQuery: query } = require('../db/pool');

// A legitimate verifier (auditor, counterparty, someone scanning a QR code
// on a physical/PDF certificate) needs a handful of lookups, never dozens
// per minute. Certificate IDs are NOT cryptographically random (see
// generateCertId — sequential tokenId + timestamp suffix), so this rate
// limit is the primary defense against enumeration, not a formality.
const verifyLimiter = rateLimit({
  windowMs: 60_000, max: 5,
  keyGenerator: req => ipKeyGenerator(req),
  message: { error: 'Too many verification attempts — please wait a minute and try again.' },
});
const verifyDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60_000, max: 50,
  keyGenerator: req => ipKeyGenerator(req),
  message: { error: 'Daily verification limit reached for this network — try again tomorrow, or contact support@ethertrack.in.' },
});

const maskGstin = (gstin) => {
  if (!gstin || gstin.length < 8) return gstin || '';
  return `${gstin.slice(0, 4)}${'*'.repeat(gstin.length - 8)}${gstin.slice(-4)}`;
};

// ── GET /api/verify/:certId — public, no auth, rate limited ───────
router.get('/:certId', verifyLimiter, verifyDailyLimiter, async (req, res) => {
  const { certId } = req.params;
  if (!certId) return res.status(400).json({ error: 'Certificate ID required' });
  // Exact-format check — no partial/fuzzy matching. A real certificate ID
  // always looks like CERT-XXXXXXXX-XXXXXX (see generateCertId) or the
  // legacy registry_transactions cert_id format; reject anything that
  // can't possibly be a real ID before even touching the database.
  if (!/^[A-Za-z0-9-]{6,60}$/.test(certId)) {
    return res.status(400).json({ error: 'Invalid certificate ID format' });
  }

  try {
    // ✅ Check retirements table FIRST — has full corporate data
    const { rows: retRows } = await query(
      `SELECT
         r.id, r.certificate_id, r.tx_hash, r.block_number,
         r.amount, r.retire_scope, r.retired_at,
         r.project_name, r.project_type, r.vintage_year,
         r.serial_number, r.developer, r.location, r.country,
         r.standard, r.corresponding_adjustment,
         r.beneficiary_name, r.beneficiary_entity, r.beneficiary_gstin,
         r.reporting_standard, r.purpose,
         COALESCE(cb.icvcm_ccp_eligible, false) AS icvcm_ccp_eligible,
         r.wallet_address,
         u.wallet_address AS user_wallet
       FROM retirements r
       LEFT JOIN users u ON u.id = r.retired_by
       LEFT JOIN carbon_batches cb ON cb.token_id = r.token_id
       WHERE r.certificate_id = $1
       LIMIT 1`,
      [certId]
    );

    if (retRows.length) {
      const r = retRows[0];
      return res.json({
        certificate_id:           r.certificate_id,
        tx_hash:                  r.tx_hash,
        block_number:             r.block_number,
        amount:                   r.amount,
        retire_scope:             r.retire_scope || '1',
        retired_at:               r.retired_at,
        project_name:             r.project_name || '—',
        project_type:             r.project_type || '—',
        vintage_year:             r.vintage_year || '—',
        serial_number:            r.serial_number || '—',
        developer:                r.developer || '—',
        location:                 r.location || '—',
        country:                  r.country || '—',
        standard:                 r.standard || 'VCS',
        corresponding_adjustment: r.corresponding_adjustment || 'none',
        beneficiary_name:         r.beneficiary_name || '',
        beneficiary_entity:       r.beneficiary_entity || '',
        beneficiary_gstin:        maskGstin(r.beneficiary_gstin),
        reporting_standard:       r.reporting_standard || '',
        purpose:                  r.purpose || '',
        icvcm_ccp_eligible:       r.icvcm_ccp_eligible || false,
        wallet_address:           r.wallet_address || r.user_wallet || '',
        source:                   'retirements',
      });
    }

    // ✅ Fall back to registry_transactions + carbon_batches join
    const { rows: txRows } = await query(
      `SELECT
         rt.cert_id              AS certificate_id,
         rt.tx_hash, rt.block_number, rt.amount,
         '1'                     AS retire_scope,
         rt.created_at           AS retired_at,
         rt.project_name, rt.project_type, rt.serial_number,
         rt.developer, rt.location, rt.standard,
         rt.beneficiary          AS beneficiary_name,
         cb.vintage_year, cb.country,
         cb.corresponding_adjustment, cb.icvcm_ccp_eligible,
         COALESCE(rt.from_wallet, u.wallet_address) AS wallet_address
       FROM registry_transactions rt
       LEFT JOIN carbon_batches cb ON cb.token_id = rt.token_id
       LEFT JOIN users u ON u.id = COALESCE(rt.from_user_id, rt.user_id)
       WHERE rt.cert_id = $1
       LIMIT 1`,
      [certId]
    );

    if (!txRows.length) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const r = txRows[0];
    res.json({
      certificate_id:           r.certificate_id || certId,
      tx_hash:                  r.tx_hash,
      block_number:             r.block_number,
      amount:                   r.amount,
      retire_scope:             '1',
      retired_at:               r.retired_at,
      project_name:             r.project_name || '—',
      project_type:             r.project_type || '—',
      vintage_year:             r.vintage_year || '—',
      serial_number:            r.serial_number || '—',
      developer:                r.developer || '—',
      location:                 r.location || '—',
      country:                  r.country || '—',
      standard:                 r.standard || 'VCS',
      corresponding_adjustment: r.corresponding_adjustment || 'none',
      beneficiary_name:         r.beneficiary_name || '',
      beneficiary_entity:       '',
      beneficiary_gstin:        '',
      reporting_standard:       '',
      purpose:                  '',
      icvcm_ccp_eligible:       r.icvcm_ccp_eligible || false,
      wallet_address:           r.wallet_address || '',
      source:                   'registry_transactions',
    });

  } catch (e) {
    console.error('Verify cert error:', e.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

module.exports = router;