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

// ══════════════════════════════════════════════════════════════════
// POST /api/portfolio/list-credit-ledger
// Wallet-free listing — no escrow step needed, credits are already in
// pooled custody. Just creates a DB-visible listing against the seller's
// ledger balance. The actual on-chain SELL/BUY log entries happen at
// purchase time (see checkout-verify's ledger-to-ledger branch).
// ══════════════════════════════════════════════════════════════════
router.post('/list-credit-ledger', authenticate, requireKYC, async (req, res) => {
  const { tokenId, batchId, amount, priceInINR, durationDays = 30 } = req.body;

  if (tokenId == null || !amount || amount <= 0) {
    return res.status(400).json({ error: 'tokenId and a positive amount are required' });
  }
  if (!priceInINR || priceInINR <= 0) {
    return res.status(400).json({ error: 'priceInINR must be greater than zero' });
  }
  if (req.user.wallet_address) {
    return res.status(400).json({ error: 'You have a linked wallet — list directly from your wallet instead.' });
  }

  try {
    const { getLedgerBalance } = require('../services/creditLedger');
    const current = await getLedgerBalance(req.user.id, tokenId);

    const { rows: activeListings } = await query(
      `SELECT COALESCE(SUM(amount_remaining), 0) as listed
       FROM ledger_listings WHERE seller_id = $1 AND token_id = $2 AND active = TRUE`,
      [req.user.id, tokenId]
    );
    const alreadyListed = Number(activeListings[0].listed);
    const available = Number(current.balance) - alreadyListed;

    if (available < amount) {
      return res.status(400).json({
        error: `You only have ${available} available to list (${current.balance} held, ${alreadyListed} already listed).`,
      });
    }

    const { rows } = await query(
      `INSERT INTO ledger_listings
         (seller_id, token_id, batch_id, amount, amount_remaining, price_per_credit_inr, expires_at)
       VALUES ($1,$2,$3,$4,$4,$5, NOW() + ($6 || ' days')::INTERVAL)
       RETURNING id`,
      [req.user.id, tokenId, batchId || null, amount, priceInINR, durationDays]
    );

    await auditLog(req.user.id, 'CREDIT_LISTED_LEDGER', req.user.id,
      `tokenId=${tokenId} amount=${amount} listingId=${rows[0].id}`);

    return res.json({ message: 'Credit listed successfully', listingId: rows[0].id });
  } catch (e) {
    console.error('[list-credit-ledger]', e.message);
    return res.status(500).json({ error: 'Listing failed. Please try again.' });
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /api/portfolio/delist-credit-ledger
// Wallet-free delisting — just deactivates the DB listing row. Nothing to
// move on-chain since nothing was ever escrowed out of pooled custody.
// ══════════════════════════════════════════════════════════════════
router.post('/delist-credit-ledger', authenticate, async (req, res) => {
  const { listingId } = req.body;
  if (!listingId) return res.status(400).json({ error: 'listingId is required' });

  try {
    const { rows } = await query(
      `UPDATE ledger_listings SET active = FALSE, updated_at = NOW()
       WHERE id = $1 AND seller_id = $2 AND active = TRUE
       RETURNING id`,
      [listingId, req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Listing not found or already inactive.' });
    }

    await auditLog(req.user.id, 'CREDIT_DELISTED_LEDGER', req.user.id, `listingId=${listingId}`);
    return res.json({ message: 'Listing cancelled successfully' });
  } catch (e) {
    console.error('[delist-credit-ledger]', e.message);
    return res.status(500).json({ error: 'Delisting failed. Please try again.' });
  }
});

// ══════════════════════════════════════════════════════════════════
// LEDGER-TO-LEDGER MARKETPLACE — parallel checkout flow for purchases
// FROM a wallet-free seller's ledger listing. Kept separate from
// routes/trades.js's checkout-order/checkout-verify (which assume a
// wallet-based seller + an on-chain Marketplace listing) rather than risk
// destabilizing that already-fixed flow with an incompatible branch.
// Mirrors its Razorpay order/fee/signature-verification pattern exactly.
// ══════════════════════════════════════════════════════════════════

const Razorpay = require('razorpay');
const crypto   = require('crypto');

const razorpayLedger = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PLATFORM_FEE_BPS = 100;
const GST_RATE         = 0.18;

function calcLedgerFees(subtotalINR) {
  const buyerFeeINR   = parseFloat((subtotalINR * PLATFORM_FEE_BPS / 2 / 10000).toFixed(2));
  const sellerFeeINR  = parseFloat((subtotalINR * PLATFORM_FEE_BPS / 2 / 10000).toFixed(2));
  const totalFeeINR   = parseFloat((buyerFeeINR + sellerFeeINR).toFixed(2));
  const gstINR        = parseFloat((totalFeeINR * GST_RATE).toFixed(2));
  const buyerPaysINR  = parseFloat((subtotalINR + buyerFeeINR + gstINR / 2).toFixed(2));
  const sellerGetsINR = parseFloat((subtotalINR - sellerFeeINR - gstINR / 2).toFixed(2));
  return { buyerFeeINR, sellerFeeINR, totalFeeINR, gstINR, buyerPaysINR, sellerGetsINR };
}

// POST /api/portfolio/ledger-checkout-order
router.post('/ledger-checkout-order', authenticate, requireKYC, async (req, res) => {
  const { ledgerListingId, quantity } = req.body;
  if (!ledgerListingId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'ledgerListingId and a positive quantity are required' });
  }

  try {
    const { rows } = await query(
      `SELECT ll.*, u.id as seller_user_id, u.razorpay_contact_id, u.razorpay_fund_account_id,
              cb.project_name
       FROM ledger_listings ll
       JOIN users u ON u.id = ll.seller_id
       LEFT JOIN carbon_batches cb ON cb.id = ll.batch_id
       WHERE ll.id = $1 AND ll.active = TRUE`,
      [ledgerListingId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Listing not found or no longer active.' });
    const listing = rows[0];

    if (listing.seller_id === req.user.id) {
      return res.status(400).json({ error: 'Cannot buy your own listing.' });
    }
    if (listing.amount_remaining < quantity) {
      return res.status(400).json({ error: `Only ${listing.amount_remaining} credits available.` });
    }

    const subtotalINR = parseFloat((listing.price_per_credit_inr * quantity).toFixed(2));
    const fees = calcLedgerFees(subtotalINR);

    const transfers = [];
    if (listing.razorpay_fund_account_id) {
      transfers.push({
        account: listing.razorpay_fund_account_id,
        amount: Math.round(fees.sellerGetsINR * 100),
        currency: 'INR',
        notes: { ledger_listing_id: ledgerListingId, quantity: String(quantity) },
        on_hold: 0,
      });
    }

    const order = await razorpayLedger.orders.create({
      amount: Math.round(fees.buyerPaysINR * 100),
      currency: 'INR',
      transfers,
      notes: {
        buyer_id: String(req.user.id), seller_id: String(listing.seller_id),
        ledger_listing_id: ledgerListingId, quantity: String(quantity),
        token_id: String(listing.token_id),
      },
    });

    await query(
      `INSERT INTO razorpay_checkout_orders
         (razorpay_order_id, buyer_id, seller_id, batch_id, listing_id,
          quantity, price_per_credit_inr, subtotal_inr,
          buyer_pays_inr, seller_gets_inr, total_fee_inr, gst_inr, status, created_at)
       VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11,'pending',NOW())`,
      [order.id, req.user.id, listing.seller_id, listing.batch_id,
       quantity, listing.price_per_credit_inr, subtotalINR,
       fees.buyerPaysINR, fees.sellerGetsINR, fees.totalFeeINR, fees.gstINR]
    );

    // Stash which ledger listing this order is against — checkout-verify
    // needs it and razorpay_checkout_orders has no ledger_listing_id column.
    await query(
      `UPDATE razorpay_checkout_orders SET notes = $1 WHERE razorpay_order_id = $2`,
      [JSON.stringify({ ledger_listing_id: ledgerListingId, token_id: listing.token_id }), order.id]
    ).catch(() => {}); // best-effort — column may not exist on older schemas

    return res.json({
      orderId: order.id, amount: order.amount, currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      buyerPaysINR: fees.buyerPaysINR, sellerGetsINR: fees.sellerGetsINR,
      totalFeeINR: fees.totalFeeINR, gstINR: fees.gstINR,
    });
  } catch (e) {
    console.error('[ledger-checkout-order]', e.message);
    return res.status(500).json({ error: e.message || 'Failed to create order' });
  }
});

// POST /api/portfolio/ledger-checkout-verify
router.post('/ledger-checkout-verify', authenticate, requireKYC, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, ledgerListingId, quantity } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !ledgerListingId || !quantity) {
    return res.status(400).json({ error: 'Missing payment verification fields' });
  }

  const expectedSig = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  if (expectedSig !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment signature verification failed.' });
  }

  try {
    const { rows: orderRows } = await query(
      `SELECT * FROM razorpay_checkout_orders WHERE razorpay_order_id = $1 AND status = 'pending'`,
      [razorpay_order_id]
    );
    if (!orderRows.length) return res.status(400).json({ error: 'Order not found or already processed.' });
    const order = orderRows[0];

    const { rows: listingRows } = await query(
      `SELECT * FROM ledger_listings WHERE id = $1 AND active = TRUE FOR UPDATE`,
      [ledgerListingId]
    );
    if (!listingRows.length) return res.status(400).json({ error: 'Listing no longer active.' });
    const listing = listingRows[0];

    if (listing.amount_remaining < quantity) {
      return res.status(400).json({ error: 'Listing no longer has enough remaining quantity.' });
    }

    // Insert the trade row first (mirrors trades.js's pattern)
    const { rows: tradeRows } = await query(
      `INSERT INTO trades
         (buyer_id, seller_id, batch_id, token_id, quantity, status,
          price_per_credit_inr, buyer_pays_inr, payment_mode, chain_status, created_at)
       VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,'razorpay','pending',NOW())
       RETURNING id`,
      [req.user.id, listing.seller_id, listing.batch_id, listing.token_id, quantity,
       listing.price_per_credit_inr, order.buyer_pays_inr]
    );
    const tradeId = tradeRows[0].id;

    await query(
      `UPDATE razorpay_checkout_orders SET status = 'completed' WHERE razorpay_order_id = $1`,
      [razorpay_order_id]
    );
    await query(
      `UPDATE ledger_listings SET amount_remaining = amount_remaining - $1,
         active = CASE WHEN amount_remaining - $1 <= 0 THEN FALSE ELSE active END,
         updated_at = NOW()
       WHERE id = $2`,
      [quantity, ledgerListingId]
    );

    // The actual on-chain settlement — both sides are ledger users, so this
    // is a ledger-to-ledger transfer (SELL + BUY), not a token movement.
    try {
      const { transferLedgerOwnership } = require('../services/creditLedger');
      const result = await transferLedgerOwnership({
        sellerId: listing.seller_id,
        buyerId:  req.user.id,
        tokenId:  listing.token_id,
        amount:   quantity,
        refTable: 'trades',
        refId:    tradeId,
        note:     `Ledger sale — listing ${ledgerListingId}`,
      });

      await query(
        `UPDATE trades SET chain_status = 'confirmed', chain_tx_hash = $1, chain_block = $2 WHERE id = $3`,
        [result.buyerResult.txHash, result.buyerResult.blockNumber, tradeId]
      );
      console.log(`[ledger-checkout-verify] Trade ${tradeId} settled — seller TX: ${result.sellerResult.txHash}, buyer TX: ${result.buyerResult.txHash}`);
    } catch (chainErr) {
      await query(`UPDATE trades SET chain_status = 'failed' WHERE id = $1`, [tradeId]).catch(() => {});
      await auditLog(req.user.id, 'LEDGER_TRADE_ONCHAIN_SETTLEMENT_FAILED', req.user.id,
        `Trade ${tradeId} — payment captured but ledger settlement failed: ${chainErr.message}`);
      console.error(`[ledger-checkout-verify] ⚠️ Settlement FAILED for trade ${tradeId} — payment already captured:`, chainErr.message);
    }

    return res.json({ message: 'Purchase completed', tradeId });
  } catch (e) {
    console.error('[ledger-checkout-verify]', e.message);
    return res.status(500).json({ error: 'Purchase verification failed. Please contact support.' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /api/portfolio/ledger-certificate/:entryId
// Returns everything needed to render a Certificate of Ownership (for a
// BUY entry) or Certificate of Retirement (for a RETIRE entry) — the
// wallet-free equivalent of "check your own wallet on Etherscan", since a
// ledger user has no personal address to point to. The tx_hash here is
// real and independently verifiable regardless of what the DB claims.
// ══════════════════════════════════════════════════════════════════
router.get('/ledger-certificate/:entryId', authenticate, async (req, res) => {
  const { entryId } = req.params;

  try {
    const { rows } = await query(
      `SELECT cle.*, cb.project_name, cb.standard, cb.project_type, cb.developer,
              cb.vintage_year, cb.country, cb.registry_serial, cb.credit_type,
              u.full_name as holder_name, u.email as holder_email
       FROM credit_ledger_entries cle
       LEFT JOIN carbon_batches cb ON cb.id::text = cle.ref_id::text
       JOIN users u ON u.id = cle.user_id
       WHERE cle.id = $1`,
      [entryId]
    );

    if (!rows.length) return res.status(404).json({ error: 'Certificate not found.' });
    const entry = rows[0];

    if (entry.user_id !== req.user.id) {
      return res.status(403).json({ error: 'This certificate does not belong to your account.' });
    }

    const isRetirement = entry.action_type === 'RETIRE';

    return res.json({
      certificateType: isRetirement ? 'RETIREMENT' : 'OWNERSHIP',
      entryId: entry.id,
      holderName: entry.holder_name,
      holderEmail: entry.holder_email,
      tokenId: entry.token_id,
      amount: Math.abs(entry.amount_delta),
      actionType: entry.action_type,
      projectName: entry.project_name || '—',
      standard: entry.standard || 'VCS',
      projectType: entry.project_type || '—',
      developer: entry.developer || '—',
      vintageYear: entry.vintage_year || '—',
      country: entry.country || '—',
      registrySerial: entry.registry_serial || '—',
      creditType: entry.credit_type || 'voluntary',
      txHash: entry.tx_hash,
      blockNumber: entry.block_number,
      refHash: entry.ref_hash,
      chainStatus: entry.chain_status,
      issuedAt: entry.created_at,
      custodyModel: 'pooled', // distinguishes from wallet-based certificates in the UI
      verifyUrl: entry.tx_hash ? `https://sepolia.etherscan.io/tx/${entry.tx_hash}` : null,
    });
  } catch (e) {
    console.error('[ledger-certificate]', e.message);
    return res.status(500).json({ error: 'Failed to load certificate.' });
  }
});

// ══════════════════════════════════════════════════════════════════
// GET /api/portfolio/my-ledger-credits
// Returns the authenticated user's wallet-free (pooled custody) holdings,
// shaped to match myCredits/myBoughtCredits so the frontend can merge them
// into one unified credit list.
// ══════════════════════════════════════════════════════════════════
router.get('/my-ledger-credits', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT clb.token_id, clb.balance, clb.total_retired,
              cb.project_name, cb.standard, cb.project_type, cb.developer,
              cb.vintage_year, cb.country, cb.project_location, cb.registry_serial,
              cb.credit_type, cb.cbam_eligible, cb.expiry_date
       FROM credit_ledger_balances clb
       LEFT JOIN carbon_batches cb ON cb.token_id = clb.token_id
       WHERE clb.user_id = $1 AND clb.balance > 0`,
      [req.user.id]
    );

    const credits = rows.map(r => ({
      id: `ledger-${r.token_id}`,
      tokenId: r.token_id,
      projectName: r.project_name || '—',
      standard: r.standard || 'VCS',
      projectType: r.project_type || '—',
      developer: r.developer || '—',
      vintageYear: r.vintage_year,
      country: r.country || '—',
      location: r.project_location || '—',
      serialNumber: r.registry_serial || '—',
      creditType: r.credit_type || 'voluntary',
      cbamEligible: r.cbam_eligible || false,
      expiryDate: r.expiry_date,
      heldCredits: Number(r.balance),
      credits: Number(r.balance),
      listedCredits: 0, // populated separately from ledger_listings if needed
      totalRetired: Number(r.total_retired),
      status: 'HELD',
      isLedger: true,       // [NEW] distinguishes from wallet-based credits in the UI
      isOnChain: true,      // still genuinely on-chain — just via CreditLedger, not personal balanceOf()
      admin_status: 'approved',
    }));

    return res.json({ credits });
  } catch (e) {
    console.error('[my-ledger-credits]', e.message);
    return res.status(500).json({ error: 'Failed to load ledger credits.' });
  }
});

module.exports = router;