// services/certificates.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared certificate-ID generation + DB record, used by both wallet-based
// and ledger-based (wallet-free) purchase/retirement flows. Keeps cert_id
// format consistent with the existing retirement flow in
// routes/retirementApproval.js (CERT-<tokenId>-<random>).
// ─────────────────────────────────────────────────────────────────────────────

const { safeQuery: query } = require('../db/pool');

const generateCertId = (tokenId) =>
  `CERT-${String(tokenId).padStart(8, '0')}-${Date.now().toString(36).toUpperCase().slice(-6)}`;

/**
 * Creates an Ownership certificate — issued the moment a buyer actually
 * receives credits, whether via a real on-chain transfer (wallet-based) or
 * a CreditLedger log entry (wallet-free). This is the "proof of purchase"
 * that was missing — previously only retirement produced a certificate.
 */
const issueOwnershipCertificate = async ({
  userId, tokenId, quantity, tradeId, ledgerEntryId, txHash, blockNumber, custodyModel = 'wallet',
}) => {
  const certId = generateCertId(tokenId);
  await query(
    `INSERT INTO certificates
       (cert_id, cert_type, user_id, trade_id, ledger_entry_id, token_id,
        quantity, custody_model, tx_hash, block_number)
     VALUES ($1,'OWNERSHIP',$2,$3,$4,$5,$6,$7,$8,$9)`,
    [certId, userId, tradeId || null, ledgerEntryId || null, tokenId,
     quantity, custodyModel, txHash || null, blockNumber || null]
  );
  return certId;
};

/**
 * Creates a Retirement certificate. Wallet-based retirements already
 * generate their own cert_id inline in routes/retirementApproval.js — this
 * is for the wallet-free (ledger) retirement path, keeping both consistent
 * in the same `certificates` table.
 */
const issueRetirementCertificate = async ({
  userId, tokenId, quantity, ledgerEntryId, txHash, blockNumber, custodyModel = 'pooled',
}) => {
  const certId = generateCertId(tokenId);
  await query(
    `INSERT INTO certificates
       (cert_id, cert_type, user_id, ledger_entry_id, token_id,
        quantity, custody_model, tx_hash, block_number)
     VALUES ($1,'RETIREMENT',$2,$3,$4,$5,$6,$7,$8)`,
    [certId, userId, ledgerEntryId || null, tokenId,
     quantity, custodyModel, txHash || null, blockNumber || null]
  );
  return certId;
};

module.exports = { generateCertId, issueOwnershipCertificate, issueRetirementCertificate };