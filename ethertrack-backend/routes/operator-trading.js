// routes/operator-trading.js
// ─────────────────────────────────────────────────────────────────────────────
// Operator-executed trading actions — the backend signs and pays gas using
// its operator wallet (same one as MINTER_PRIVATE_KEY / Marketplace's
// signerWallet), so users never see a MetaMask popup for routine listing or
// delisting. Requires Marketplace v3 (with listCreditFor/cancelListingFor)
// to be deployed and MARKETPLACE_ADDRESS set in .env — calls will fail
// clearly (not silently) until then.
//
// NOTE: buying via ETH/crypto and retiring credits are NOT in this file.
//   - ETH/crypto buys stay MetaMask-based by design (it's the user's own
//     funds moving, they must authorize it themselves).
//   - Retiring stays self-service (MetaMask) until CarbonCreditToken's
//     operator migration is deployed — see conversation notes, deliberately
//     postponed to avoid orphaning existing minted credits.
//   - INR-paid buy settlement lives in routes/trades.js's payment
//     confirmation flow, not here — it's triggered by a Razorpay webhook,
//     not a direct user action.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate, requireKYC } = require('../middleware/auth');
const {
  listCreditForOnChain,
  cancelListingForOnChain,
} = require('../services/minter');

const auditLog = async (adminId, action, targetUserId, details) => {
  try {
    await query(
      `INSERT INTO admin_audit_log (admin_id, action, target_user_id, details)
       VALUES ($1,$2,$3,$4)`,
      [adminId, action, targetUserId || null, details || null]
    );
  } catch (e) { console.warn('[operator-trading][auditLog] failed:', e.message); }
};

// ══════════════════════════════════════════════════════════════════
// POST /api/portfolio/list-credit
// Operator-executed listing — no MetaMask required. Seller must have
// already granted setApprovalForAll(marketplace, true) ONCE (checked
// on-chain by listCreditFor itself, which reverts clearly if missing).
// ══════════════════════════════════════════════════════════════════
router.post('/list-credit', authenticate, requireKYC, async (req, res) => {
  const { tokenId, amount, priceInEth, priceInINR, durationDays = 30 } = req.body;

  if (tokenId == null || !amount || amount <= 0) {
    return res.status(400).json({ error: 'tokenId and a positive amount are required' });
  }
  if (!priceInEth || parseFloat(priceInEth) <= 0) {
    return res.status(400).json({ error: 'priceInEth must be greater than zero' });
  }

  try {
    const { rows } = await query(
      'SELECT wallet_address FROM users WHERE id = $1',
      [req.user.id]
    );
    const sellerWallet = rows[0]?.wallet_address;
    if (!sellerWallet) {
      return res.status(400).json({ error: 'No wallet linked to your account. Bind a wallet first.' });
    }

    const result = await listCreditForOnChain(
      sellerWallet, tokenId, amount, priceInEth,
      priceInINR || Math.round(parseFloat(priceInEth) * 280000),
      (durationDays || 30) * 86400
    );

    await auditLog(req.user.id, 'CREDIT_LISTED_OPERATOR', req.user.id,
      `tokenId=${tokenId} amount=${amount} listingId=${result.listingId} TX: ${result.txHash}`);

    return res.json({
      message: 'Credit listed successfully',
      listingId: result.listingId,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
    });
  } catch (e) {
    console.error('[list-credit][operator]', e.message);

    if (/not KYC verified/i.test(e.message)) {
      return res.status(403).json({ error: 'Your wallet is not yet KYC verified on-chain. Try again in a moment, or contact support.' });
    }
    if (/Insufficient credits/i.test(e.message)) {
      return res.status(400).json({ error: 'You do not hold enough of this credit on-chain to list this amount.' });
    }
    if (/MARKETPLACE_ADDRESS/i.test(e.message)) {
      return res.status(503).json({ error: 'Listing is temporarily unavailable. Please try again shortly.' });
    }

    return res.status(500).json({ error: 'Listing failed. Please try again.' });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/portfolio/delist-credit
// Operator-executed delisting — zero approval needed, Marketplace
// already holds the escrowed tokens itself.
// ══════════════════════════════════════════════════════════════════
router.post('/delist-credit', authenticate, async (req, res) => {
  const { listingIdOnchain } = req.body;

  if (listingIdOnchain == null) {
    return res.status(400).json({ error: 'listingIdOnchain is required' });
  }

  try {
    const { rows } = await query(
      'SELECT wallet_address FROM users WHERE id = $1',
      [req.user.id]
    );
    const sellerWallet = rows[0]?.wallet_address;
    if (!sellerWallet) {
      return res.status(400).json({ error: 'No wallet linked to your account.' });
    }

    const result = await cancelListingForOnChain(sellerWallet, listingIdOnchain);

    await auditLog(req.user.id, 'CREDIT_DELISTED_OPERATOR', req.user.id,
      `listingId=${listingIdOnchain} TX: ${result.txHash}`);

    return res.json({
      message: 'Listing cancelled successfully',
      txHash: result.txHash,
      blockNumber: result.blockNumber,
    });
  } catch (e) {
    console.error('[delist-credit][operator]', e.message);

    if (/seller mismatch/i.test(e.message)) {
      return res.status(403).json({ error: 'This listing does not belong to your wallet.' });
    }
    if (/MARKETPLACE_ADDRESS/i.test(e.message)) {
      return res.status(503).json({ error: 'Delisting is temporarily unavailable. Please try again shortly.' });
    }

    return res.status(500).json({ error: 'Delisting failed. Please try again.' });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/portfolio/retire-credit-ledger
// Wallet-free retirement — for users with no linked wallet. Their credits
// live in pooled custody and are tracked via CreditLedger.sol; this
// permanently reduces their ledger balance and writes a dedicated,
// independently-verifiable retirement log on-chain. No MetaMask involved.
//
// Users WITH a linked wallet should keep using the existing self-service
// retireCredit() flow (still MetaMask-based) — this endpoint is only for
// wallet-free ledger users.
// ══════════════════════════════════════════════════════════════════
router.post('/retire-credit-ledger', authenticate, requireKYC, async (req, res) => {
  const { tokenId, amount } = req.body;

  if (tokenId == null || !amount || amount <= 0) {
    return res.status(400).json({ error: 'tokenId and a positive amount are required' });
  }
  if (req.user.wallet_address) {
    return res.status(400).json({
      error: 'You have a linked wallet — retire directly from your wallet instead.',
    });
  }

  try {
    const { getLedgerBalance, logRetirementOnChain } = require('../services/creditLedger');

    const current = await getLedgerBalance(req.user.id, tokenId);
    if (Number(current.balance) < amount) {
      return res.status(400).json({
        error: `You only hold ${current.balance} of this credit — cannot retire ${amount}.`,
      });
    }

    const result = await logRetirementOnChain({
      userId  : req.user.id,
      tokenId,
      amount,
      refTable: 'credit_ledger_entries',
      refId   : null,
    });

    await auditLog(req.user.id, 'CREDIT_RETIRED_LEDGER', req.user.id,
      `tokenId=${tokenId} amount=${amount} TX: ${result.txHash}`);

    return res.json({
      message: 'Credit retired successfully',
      txHash: result.txHash,
      blockNumber: result.blockNumber,
    });
  } catch (e) {
    console.error('[retire-credit-ledger]', e.message);
    return res.status(500).json({ error: 'Retirement failed. Please try again.' });
  }
});

module.exports = router;