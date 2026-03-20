// routes/wallet.js — with notification triggers
require('dotenv').config();
const express    = require('express');
const router     = express.Router();
const { ethers } = require('ethers');
const Razorpay   = require('razorpay');
const crypto     = require('crypto');
const { safeQuery: query }   = require('../db/pool');
const { authenticate }       = require('../middleware/auth');
const { runComplianceChecks, updateAMLCounter, recordTDS, recordINRCryptoConversion } = require('./compliance');
const { createNotification } = require('./notifications');

let _razorpay = null;
const getRazorpay = () => {
  if (_razorpay) return _razorpay;
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
    throw new Error('Razorpay keys not configured.');
  _razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  return _razorpay;
};

async function adjustBalance(userId, amount, type) {
  const col = type === 'credit' ? 'inr_balance + $1' : 'inr_balance - $1';
  const { rows } = await query(
    `UPDATE users SET inr_balance = ${col}, updated_at = NOW()
     WHERE id = $2 AND inr_balance ${type === 'debit' ? '>= $1' : '> -1'}
     RETURNING inr_balance`,
    [amount, userId]
  );
  if (!rows.length) throw new Error('Insufficient balance or user not found');
  return rows[0].inr_balance;
}

router.get('/balance', authenticate, async (req, res) => {
  try {
    const { rows: userRows } = await query('SELECT inr_balance, inr_balance_locked FROM users WHERE id = $1', [req.user.id]);
    if (!userRows.length) return res.status(404).json({ error: 'User not found' });
    const { rows: txRows } = await query(
      `SELECT id, type, method, amount, status, reference, created_at, notes
       FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.user.id]
    );
    res.json({ balance: parseFloat(userRows[0].inr_balance), balanceLocked: parseFloat(userRows[0].inr_balance_locked), transactions: txRows });
  } catch (e) { console.error('Balance fetch error:', e); res.status(500).json({ error: 'Failed to fetch balance' }); }
});

router.post('/deposit/create-order', authenticate, async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount < 100 || amount > 100000)
    return res.status(400).json({ error: 'Amount must be between ₹100 and ₹1,00,000' });
  if (!req.user.kyc_verified)
    return res.status(403).json({ error: 'KYC verification required to deposit funds', code: 'KYC_REQUIRED' });
  const compliance = await runComplianceChecks(req.user.id, amount, 'credit');
  if (!compliance.allowed)
    return res.status(403).json({ error: compliance.reason, code: 'COMPLIANCE_BLOCK' });
  try {
    const order = await getRazorpay().orders.create({
      amount: Math.round(amount * 100), currency: 'INR',
      receipt: `ET_${req.user.id.slice(0,8)}_${Date.now()}`,
      notes: { user_id: req.user.id, email: req.user.email },
    });
    await query(
      `INSERT INTO wallet_transactions (user_id, type, method, amount, status, razorpay_order_id, notes)
       VALUES ($1, 'credit', $2, $3, 'pending', $4, $5)`,
      [req.user.id, req.body.method || 'upi', amount, order.id, `Deposit via ${req.body.method || 'upi'}`]
    );
    res.json({ orderId: order.id, amount, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, name: req.user.full_name || req.user.email, email: req.user.email });
  } catch (e) { console.error('Create order error:', e); res.status(500).json({ error: 'Failed to create payment order' }); }
});

router.post('/deposit/verify', authenticate, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return res.status(400).json({ error: 'Missing payment verification fields' });
  try {
    const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    if (expectedSig !== razorpay_signature)
      return res.status(400).json({ error: 'Payment signature verification failed', code: 'SIG_MISMATCH' });
    const { rows: txRows } = await query(
      `SELECT * FROM wallet_transactions WHERE razorpay_order_id = $1 AND user_id = $2 AND status = 'pending'`,
      [razorpay_order_id, req.user.id]
    );
    if (!txRows.length) return res.status(404).json({ error: 'Transaction not found or already processed' });
    const tx = txRows[0];
    const { rows: userRows } = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);
    const balanceBefore = parseFloat(userRows[0].inr_balance);
    const balanceAfter  = await adjustBalance(req.user.id, tx.amount, 'credit');
    await query(
      `UPDATE wallet_transactions SET status='success', razorpay_payment_id=$1, razorpay_signature=$2,
       balance_before=$3, balance_after=$4, updated_at=NOW() WHERE id=$5`,
      [razorpay_payment_id, razorpay_signature, balanceBefore, balanceAfter, tx.id]
    );
    await updateAMLCounter(req.user.id, parseFloat(tx.amount), 'credit');

    // ── NOTIFICATION: Deposit successful ──
    await createNotification(
      req.user.id, 'WALLET', '💰 Funds Deposited',
      `₹${parseFloat(tx.amount).toLocaleString('en-IN')} added to your INR wallet via ${(tx.method || 'UPI').toUpperCase()}`,
      '/wallet', { amount: tx.amount, reference: tx.reference, paymentId: razorpay_payment_id }
    );

    res.json({ success: true, message: 'Funds credited successfully', amount: tx.amount, balance: balanceAfter, reference: tx.reference, paymentId: razorpay_payment_id });
  } catch (e) { console.error('Verify payment error:', e); res.status(500).json({ error: 'Payment verification failed' }); }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig  = req.headers['x-razorpay-signature'];
  const body = req.body;
  const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  if (expectedSig !== sig) { console.warn('Webhook signature mismatch'); return res.status(400).json({ error: 'Invalid webhook signature' }); }
  const event = JSON.parse(body);
  try {
    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity;
      const { rows: txRows } = await query(`SELECT * FROM wallet_transactions WHERE razorpay_order_id = $1 AND status = 'pending'`, [payment.order_id]);
      if (!txRows.length) return res.json({ status: 'already_processed' });
      const tx = txRows[0];
      const { rows: userRows } = await query('SELECT inr_balance FROM users WHERE id = $1', [tx.user_id]);
      const balanceBefore = parseFloat(userRows[0].inr_balance);
      const balanceAfter  = await adjustBalance(tx.user_id, tx.amount, 'credit');
      await query(`UPDATE wallet_transactions SET status='success', razorpay_payment_id=$1, balance_before=$2, balance_after=$3, updated_at=NOW() WHERE id=$4`,
        [payment.id, balanceBefore, balanceAfter, tx.id]);
      await updateAMLCounter(tx.user_id, parseFloat(tx.amount), 'credit');
      await createNotification(tx.user_id, 'WALLET', '💰 Funds Deposited', `₹${parseFloat(tx.amount).toLocaleString('en-IN')} added to your INR wallet`, '/wallet', { amount: tx.amount });
    }
    if (event.event === 'payment.failed') {
      const payment = event.payload.payment.entity;
      await query(`UPDATE wallet_transactions SET status='failed', updated_at=NOW() WHERE razorpay_order_id=$1`, [payment.order_id]);
    }
    res.json({ status: 'ok' });
  } catch (e) { console.error('Webhook processing error:', e); res.status(500).json({ error: 'Webhook processing failed' }); }
});

router.post('/withdraw', authenticate, async (req, res) => {
  const { amount, accountNumber, ifsc, accountName } = req.body;
  if (!amount || amount < 100) return res.status(400).json({ error: 'Minimum withdrawal is ₹100' });
  if (!accountNumber || !ifsc || !accountName) return res.status(400).json({ error: 'Bank account details required' });
  if (!req.user.kyc_verified) return res.status(403).json({ error: 'KYC verification required to withdraw', code: 'KYC_REQUIRED' });
  try {
    const { rows: userRows } = await query('SELECT inr_balance, company_pan FROM users WHERE id = $1', [req.user.id]);
    const currentBalance = parseFloat(userRows[0].inr_balance);
    const userPan        = userRows[0].company_pan;
    if (currentBalance < amount) return res.status(400).json({ error: 'Insufficient balance', available: currentBalance });
    const compliance = await runComplianceChecks(req.user.id, amount, 'debit');
    if (!compliance.allowed) return res.status(403).json({ error: compliance.reason, code: 'COMPLIANCE_BLOCK' });
    const grossAmount  = amount;
    const tdsAmount    = compliance.tdsAmount || 0;
    const netAmount    = compliance.netAmount  || amount;
    const balanceBefore = currentBalance;
    const balanceAfter  = await adjustBalance(req.user.id, grossAmount, 'debit');
    const { rows: txRows } = await query(
      `INSERT INTO wallet_transactions (user_id,type,method,amount,status,balance_before,balance_after,bank_account_number,bank_ifsc,bank_account_name,notes)
       VALUES ($1,'debit','bank',$2,'pending',$3,$4,$5,$6,$7,$8) RETURNING id, reference`,
      [req.user.id, grossAmount, balanceBefore, balanceAfter, accountNumber, ifsc, accountName,
       `Withdrawal to ${accountName} · ${accountNumber.slice(-4)}${tdsAmount > 0 ? ` | TDS 194S: ₹${tdsAmount}` : ''}`]
    );
    const txId  = txRows[0].id;
    const txRef = txRows[0].reference;
    if (tdsAmount > 0 && compliance.tdsInfo) await recordTDS(req.user.id, txId, grossAmount, compliance.tdsInfo, userPan);
    await updateAMLCounter(req.user.id, grossAmount, 'debit');

    // ── NOTIFICATION: Withdrawal initiated ──
    await createNotification(
      req.user.id, 'WALLET', '↑ Withdrawal Initiated',
      `₹${parseFloat(grossAmount).toLocaleString('en-IN')} withdrawal to ···${accountNumber.slice(-4)} initiated${tdsAmount > 0 ? `. TDS ₹${tdsAmount.toLocaleString('en-IN')} deducted (Sec 194S).` : ''}`,
      '/wallet', { amount: grossAmount, tdsAmount, netAmount, reference: txRef }
    );

    res.json({ success: true, message: 'Withdrawal initiated. Funds will reach your account in 1–2 business days.', reference: txRef, gross: grossAmount, tdsAmount, netAmount, tdsApplied: tdsAmount > 0, tdsSection: tdsAmount > 0 ? '194S' : null, balance: balanceAfter });
  } catch (e) { console.error('Withdrawal error:', e); res.status(500).json({ error: e.message || 'Withdrawal failed' }); }
});

router.get('/transactions', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, type, method, amount, status, reference, balance_before, balance_after, created_at, notes
       FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ transactions: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch transactions' }); }
});

// ── Trade deduct ──────────────────────────────────────────────────
router.post('/trade-deduct', authenticate, async (req, res) => {
  const { amount, listingId, tokenId, quantity, projectName, standard } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  try {
    const { rows: userRows } = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);
    const currentBalance = parseFloat(userRows[0].inr_balance);
    if (currentBalance < amount) return res.status(400).json({ error: 'Insufficient balance', available: currentBalance });
    const balanceBefore = currentBalance;
    const balanceAfter  = await adjustBalance(req.user.id, amount, 'debit');
    await query(
      `INSERT INTO wallet_transactions (user_id,type,method,amount,status,balance_before,balance_after,notes)
       VALUES ($1,'debit','system',$2,'success',$3,$4,$5)`,
      [req.user.id, amount, balanceBefore, balanceAfter, `Trade: ${quantity} × ${projectName || 'carbon credits'} (Token #${tokenId})`]
    );

    // ── NOTIFICATION: Trade paid ──
    await createNotification(
      req.user.id, 'TRADE', '🌿 Credit Purchase Paid',
      `₹${parseFloat(amount).toLocaleString('en-IN')} deducted for ${quantity} × ${projectName || 'carbon credits'}`,
      '/portfolio', { amount, quantity, projectName, tokenId }
    );

    res.json({ success: true, balance: balanceAfter });
  } catch (e) { console.error('Trade deduct error:', e); res.status(500).json({ error: 'Payment failed' }); }
});

router.post('/trade-refund', authenticate, async (req, res) => {
  const { amount, reference } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  try {
    const { rows: userRows } = await query('SELECT inr_balance FROM users WHERE id = $1', [req.user.id]);
    const balanceBefore = parseFloat(userRows[0].inr_balance);
    const balanceAfter  = await adjustBalance(req.user.id, amount, 'credit');
    await query(
      `INSERT INTO wallet_transactions (user_id,type,method,amount,status,balance_before,balance_after,notes)
       VALUES ($1,'credit','system',$2,'success',$3,$4,$5)`,
      [req.user.id, amount, balanceBefore, balanceAfter, `Refund — MetaMask rejected: ${reference || 'trade'}`]
    );

    // ── NOTIFICATION: Refund ──
    await createNotification(
      req.user.id, 'WALLET', '↩ Trade Refunded',
      `₹${parseFloat(amount).toLocaleString('en-IN')} refunded to your wallet — MetaMask transaction was rejected`,
      '/wallet', { amount }
    );

    res.json({ success: true, balance: balanceAfter, refunded: amount });
  } catch (e) { console.error('Trade refund error:', e); res.status(500).json({ error: 'Refund failed' }); }
});

// MetaMask routes
router.get('/challenge', authenticate, (req, res) => {
  const message = ['EtherTrack Wallet Binding', `Account: ${req.user.email}`, `User ID: ${req.user.id}`, `Timestamp: ${Date.now()}`, 'By signing this message, you are binding this wallet to your EtherTrack account.', 'This does not initiate a blockchain transaction or cost any gas.'].join('\n');
  res.json({ message });
});

router.post('/bind', authenticate, async (req, res) => {
  const { walletAddress, signature, message } = req.body;
  if (!walletAddress || !signature || !message) return res.status(400).json({ error: 'walletAddress, signature and message required' });
  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) return res.status(400).json({ error: 'Signature verification failed' });
    const { rows: existing } = await query('SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1) AND id != $2', [walletAddress, req.user.id]);
    if (existing.length) return res.status(409).json({ error: 'Wallet already bound to another account', code: 'WALLET_TAKEN' });
    const { rows: currentUser } = await query('SELECT wallet_address FROM users WHERE id = $1', [req.user.id]);
    if (currentUser[0]?.wallet_address && currentUser[0].wallet_address.toLowerCase() !== walletAddress.toLowerCase())
      return res.status(409).json({ error: 'You already have a different wallet bound.', code: 'WALLET_ALREADY_BOUND', currentWallet: currentUser[0].wallet_address });
    await query('UPDATE users SET wallet_address = $1, wallet_bound_at = NOW(), updated_at = NOW() WHERE id = $2', [walletAddress, req.user.id]);
    res.json({ message: 'Wallet bound successfully', walletAddress });
  } catch (e) { console.error('Wallet bind error:', e); res.status(500).json({ error: 'Failed to bind wallet' }); }
});

router.get('/status', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`SELECT wallet_address, wallet_bound_at, kyc_status, kyc_verified, inr_balance, inr_balance_locked FROM users WHERE id = $1`, [req.user.id]);
    const user = rows[0];
    res.json({ walletBound: !!user?.wallet_address, walletAddress: user?.wallet_address, boundAt: user?.wallet_bound_at, kycStatus: user?.kyc_status, kycVerified: !!user?.kyc_verified, inrBalance: parseFloat(user?.inr_balance || 0), inrBalanceLocked: parseFloat(user?.inr_balance_locked || 0) });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch wallet status' }); }
});

router.post('/kyc', authenticate, async (req, res) => {
  const { kycDataHash, aadhaarHash, panHash } = req.body;
  try {
    if (req.user.wallet_address) {
      let isVerified = false;
      try {
        const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC);
        const kycContract = new ethers.Contract(process.env.KYC_REGISTRY_ADDRESS, ['function isKYCVerified(address wallet) view returns (bool)'], provider);
        isVerified = await kycContract.isKYCVerified(req.user.wallet_address);
      } catch { isVerified = true; }
      if (!isVerified) return res.status(400).json({ error: 'Wallet not KYC verified on-chain', code: 'KYC_NOT_ON_CHAIN' });
    }
    if (aadhaarHash) {
      const { rows } = await query('SELECT id FROM users WHERE kyc_aadhaar_hash = $1 AND id != $2', [aadhaarHash, req.user.id]);
      if (rows.length) return res.status(409).json({ error: 'duplicate_kyc', code: 'DUPLICATE_KYC' });
    }
    if (panHash) {
      const { rows } = await query('SELECT id FROM users WHERE kyc_pan_hash = $1 AND id != $2', [panHash, req.user.id]);
      if (rows.length) return res.status(409).json({ error: 'duplicate_kyc', code: 'DUPLICATE_KYC' });
    }
    await query(
      `UPDATE users SET kyc_status='verified', kyc_verified=TRUE, kyc_verified_at=NOW(), kyc_data_hash=$1,
       kyc_aadhaar_hash=COALESCE($2,kyc_aadhaar_hash), kyc_pan_hash=COALESCE($3,kyc_pan_hash), updated_at=NOW() WHERE id=$4`,
      [kycDataHash || null, aadhaarHash || null, panHash || null, req.user.id]
    );
    res.json({ message: 'KYC synced', kycStatus: 'verified', kycVerified: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'duplicate_kyc', code: 'DUPLICATE_KYC' });
    console.error('KYC sync error:', e); res.status(500).json({ error: 'KYC sync failed' });
  }
});

// Bank account routes
router.get('/bank-accounts', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`SELECT id, account_name, account_number, ifsc, bank_name, is_default, created_at FROM user_bank_accounts WHERE user_id=$1 ORDER BY is_default DESC, created_at ASC`, [req.user.id]);
    res.json({ accounts: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch bank accounts' }); }
});

router.post('/bank-accounts', authenticate, async (req, res) => {
  const { accountName, accountNumber, ifsc, bankName } = req.body;
  if (!accountName || !accountNumber || !ifsc || !bankName) return res.status(400).json({ error: 'All bank account fields are required' });
  try {
    const { rows: existing } = await query('SELECT COUNT(*) FROM user_bank_accounts WHERE user_id=$1', [req.user.id]);
    const isFirst = parseInt(existing[0].count) === 0;
    const { rows } = await query(
      `INSERT INTO user_bank_accounts (user_id,account_name,account_number,ifsc,bank_name,is_default)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, account_name, account_number, ifsc, bank_name, is_default, created_at`,
      [req.user.id, accountName, accountNumber, ifsc, bankName, isFirst]
    );
    res.json({ success: true, account: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'This bank account is already saved' });
    res.status(500).json({ error: 'Failed to save bank account' });
  }
});

router.put('/bank-accounts/:id/default', authenticate, async (req, res) => {
  try {
    await query('UPDATE user_bank_accounts SET is_default=false WHERE user_id=$1', [req.user.id]);
    const { rows } = await query(`UPDATE user_bank_accounts SET is_default=true WHERE id=$1 AND user_id=$2 RETURNING id, account_name, account_number, is_default`, [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Account not found' });
    res.json({ success: true, account: rows[0] });
  } catch (e) { res.status(500).json({ error: 'Failed to update default account' }); }
});

router.delete('/bank-accounts/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`DELETE FROM user_bank_accounts WHERE id=$1 AND user_id=$2 RETURNING id, is_default`, [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Account not found' });
    if (rows[0].is_default) await query(`UPDATE user_bank_accounts SET is_default=true WHERE user_id=$1 ORDER BY created_at ASC LIMIT 1`, [req.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete bank account' }); }
});

module.exports = router;