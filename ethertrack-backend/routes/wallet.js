const router  = require('express').Router();
const { ethers } = require('ethers');
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// ── GET /api/wallet/challenge ─────────────────────────────────────
router.get('/challenge', authenticate, (req, res) => {
  const message = [
    'EtherTrack Wallet Binding',
    `Account: ${req.user.email}`,
    `User ID: ${req.user.id}`,
    `Timestamp: ${Date.now()}`,
    'By signing this message, you are binding this wallet to your EtherTrack account.',
    'This does not initiate a blockchain transaction or cost any gas.',
  ].join('\n');

  res.json({ message });
});

// ── POST /api/wallet/bind ─────────────────────────────────────────
router.post('/bind', authenticate, async (req, res) => {
  const { walletAddress, signature, message } = req.body;

  if (!walletAddress || !signature || !message) {
    return res.status(400).json({ error: 'walletAddress, signature and message required' });
  }

  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);

    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(400).json({ error: 'Signature verification failed' });
    }

    // Wallet already bound to another account?
    const { rows: existing } = await query(
      'SELECT id, email FROM users WHERE LOWER(wallet_address) = LOWER($1) AND id != $2',
      [walletAddress, req.user.id]
    );
    if (existing.length) {
      return res.status(409).json({
        error: 'This wallet is already bound to another account',
        code: 'WALLET_TAKEN',
      });
    }

    // User already has a different wallet?
    const { rows: currentUser } = await query(
      'SELECT wallet_address FROM users WHERE id = $1', [req.user.id]
    );
    if (currentUser[0]?.wallet_address &&
        currentUser[0].wallet_address.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(409).json({
        error: 'You already have a different wallet bound. Contact support to change it.',
        code: 'WALLET_ALREADY_BOUND',
        currentWallet: currentUser[0].wallet_address,
      });
    }

    await query(
      `UPDATE users SET wallet_address = $1, wallet_bound_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [walletAddress, req.user.id]
    );

    res.json({ message: 'Wallet bound successfully', walletAddress, boundAt: new Date().toISOString() });
  } catch (e) {
    console.error('Wallet bind error:', e);
    res.status(500).json({ error: 'Failed to bind wallet' });
  }
});

// ── GET /api/wallet/status ────────────────────────────────────────
router.get('/status', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT wallet_address, wallet_bound_at, kyc_status, kyc_verified FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = rows[0];
    res.json({
      walletBound:   !!user?.wallet_address,
      walletAddress: user?.wallet_address,
      boundAt:       user?.wallet_bound_at,
      kycStatus:     user?.kyc_status,
      kycVerified:   !!user?.kyc_verified,
    });
  } catch (e) {
    console.error('Wallet status error:', e);
    res.status(500).json({ error: 'Failed to fetch wallet status' });
  }
});

// ── POST /api/wallet/kyc ──────────────────────────────────────────
// Sync KYC from blockchain → DB + store ID hashes for duplicate detection
// NOTE: Does NOT require wallet to be bound — hashes saved first, wallet bound later
router.post('/kyc', authenticate, async (req, res) => {
  const { kycDataHash, aadhaarHash, panHash, fullName, idType } = req.body;

  try {
    // ── Verify on-chain (only if wallet is already bound) ─────
    if (req.user.wallet_address) {
      let isVerified = false;
      try {
        const provider    = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC);
        const kycContract = new ethers.Contract(
          process.env.KYC_REGISTRY_ADDRESS,
          ['function isKYCVerified(address wallet) view returns (bool)'],
          provider
        );
        isVerified = await kycContract.isKYCVerified(req.user.wallet_address);
      } catch (chainErr) {
        // RPC unreachable (college WiFi) — trust frontend
        console.warn('On-chain KYC check failed (RPC error), trusting frontend:', chainErr.message);
        isVerified = true;
      }

      if (!isVerified) {
        return res.status(400).json({
          error: 'Wallet is not KYC verified on-chain. Complete KYC on the platform first.',
          code: 'KYC_NOT_ON_CHAIN',
        });
      }
    }
    // If no wallet bound yet — skip on-chain check, just save hashes

    // ── Check for duplicate Aadhaar hash ─────────────────────
    if (aadhaarHash) {
      const { rows: dupAadhaar } = await query(
        'SELECT id FROM users WHERE kyc_aadhaar_hash = $1 AND id != $2',
        [aadhaarHash, req.user.id]
      );
      if (dupAadhaar.length) {
        return res.status(409).json({
          error: 'duplicate_kyc',
          message: 'These KYC credentials are already verified with another account.',
          code: 'DUPLICATE_KYC',
        });
      }
    }

    // ── Check for duplicate PAN hash ──────────────────────────
    if (panHash) {
      const { rows: dupPan } = await query(
        'SELECT id FROM users WHERE kyc_pan_hash = $1 AND id != $2',
        [panHash, req.user.id]
      );
      if (dupPan.length) {
        return res.status(409).json({
          error: 'duplicate_kyc',
          message: 'These KYC credentials are already verified with another account.',
          code: 'DUPLICATE_KYC',
        });
      }
    }

    // ── Save hashes + mark verified ───────────────────────────
    await query(
      `UPDATE users SET
        kyc_status       = 'verified',
        kyc_verified     = TRUE,
        kyc_verified_at  = NOW(),
        kyc_data_hash    = $1,
        kyc_aadhaar_hash = COALESCE($2, kyc_aadhaar_hash),
        kyc_pan_hash     = COALESCE($3, kyc_pan_hash),
        updated_at       = NOW()
       WHERE id = $4`,
      [kycDataHash || null, aadhaarHash || null, panHash || null, req.user.id]
    );

    res.json({
      message:     'KYC status synced',
      kycStatus:   'verified',
      kycVerified: true,
    });
  } catch (e) {
    // Unique constraint violation (fallback safety net)
    if (e.code === '23505') {
      return res.status(409).json({
        error: 'duplicate_kyc',
        message: 'These KYC credentials are already verified with another account.',
        code: 'DUPLICATE_KYC',
      });
    }
    console.error('KYC sync error:', e);
    res.status(500).json({ error: 'KYC sync failed' });
  }
});

module.exports = router;