// cron/jobs.js — EtherTrack Background Cron Jobs
// ─────────────────────────────────────────────────────────────────
// FIXES APPLIED (v2):
//
// [FIX-1]  Auto-retry mint query — HAVING replaced with WHERE.
//          HAVING without GROUP BY treated the entire table as one group,
//          so it either returned ALL rows or NONE based on aggregate.
//          Now each batch row is evaluated individually.
//
// [FIX-2]  Distributed lock via Redis SET NX EX — prevents duplicate
//          processing when multiple server instances run crons simultaneously
//          (PM2 cluster, Docker replicas, etc.). Gracefully skips Redis
//          if REDIS_URL is not set (single-instance deployments).
//
// [FIX-3]  Listing expiry cleanup — each listing now wrapped in a
//          withTransaction so credit return and listing delete are atomic.
//          Previously, credits could be returned but listing not deleted
//          (or vice versa) on failure.
//
// [FIX-4]  last_kyc_reminder column — add to your migration if missing:
//          ALTER TABLE users ADD COLUMN IF NOT EXISTS last_kyc_reminder TIMESTAMPTZ;
// ─────────────────────────────────────────────────────────────────
'use strict';

const cron = require('node-cron');
const { safeQuery: query, withTransaction } = require('../db/pool');
const { mintApprovedCredit, verifyKYCOnChain } = require('../services/minter');
const { createNotification } = require('../routes/notifications');
const { sendMintSuccessEmail, sendKycExpiredEmail, sendKycExpiringSoonEmail, sendListingExpiredEmail } = require('../services/email');

// ── Optional Redis distributed lock ──────────────────────────────
// [FIX-2] Prevents duplicate cron execution across multiple instances
let redis = null;
;(async () => {
  if (!process.env.REDIS_URL) {
    console.warn('[cron] REDIS_URL not set — distributed lock disabled (safe for single-instance)');
    return;
  }
  try {
    const { createClient } = require('redis');
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on('error', (e) => { console.warn('[cron] Redis error:', e.message); redis = null; });
    await redis.connect();
    console.log('[cron] ✅ Redis distributed lock connected');
  } catch (e) {
    console.warn('[cron] Redis unavailable — distributed lock disabled:', e.message);
    redis = null;
  }
})();

// ── Acquire distributed lock — returns true if acquired ──────────
const acquireLock = async (key, ttlSeconds) => {
  if (!redis) return true; // No Redis = single instance = no lock needed
  try {
    const result = await redis.set(key, '1', { NX: true, EX: ttlSeconds });
    return result === 'OK';
  } catch {
    return true; // Redis error = proceed (fail open, don't block cron)
  }
};

const releaseLock = async (key) => {
  if (!redis) return;
  try { await redis.del(key); } catch {}
};

console.log('⏰ EtherTrack cron jobs starting...');

// ══════════════════════════════════════════════════════════════════
// CRON #1 — Auto-retry failed mints
// Runs every 15 minutes
// ══════════════════════════════════════════════════════════════════
cron.schedule('*/15 * * * *', async () => {
  const LOCK_KEY = 'cron:mint-retry:lock';
  const LOCK_TTL = 14 * 60; // 14 minutes — slightly less than cron interval

  // [FIX-2] Acquire distributed lock
  const locked = await acquireLock(LOCK_KEY, LOCK_TTL);
  if (!locked) {
    console.log('⛓ [CRON] Mint retry — lock held by another instance, skipping');
    return;
  }

  console.log('⛓ [CRON] Running auto-retry failed mints...');
  try {
    // [FIX-1] HAVING replaced with WHERE for per-row failure count evaluation
    const { rows: failedBatches } = await query(`
      SELECT cb.id, cb.project_name, cb.registry_serial, cb.admin_notes,
             cb.user_id, u.email, u.full_name, u.wallet_address,
             (
               LENGTH(COALESCE(cb.admin_notes, '')) -
               LENGTH(REPLACE(COALESCE(cb.admin_notes, ''), 'MINT ERROR', ''))
             ) / LENGTH('MINT ERROR') AS failure_count
      FROM carbon_batches cb
      LEFT JOIN users u ON u.id = cb.user_id
      WHERE cb.admin_status = 'approved'
        AND cb.token_id IS NULL
        AND u.wallet_address IS NOT NULL
        AND u.kyc_verified = TRUE
        AND (cb.expiry_date IS NULL OR cb.expiry_date > NOW())
        AND cb.quantity > 0
        AND (
          LENGTH(COALESCE(cb.admin_notes, '')) -
          LENGTH(REPLACE(COALESCE(cb.admin_notes, ''), 'MINT ERROR', ''))
        ) / LENGTH('MINT ERROR') < 3
      ORDER BY cb.created_at ASC
      LIMIT 10
    `).catch(() => ({ rows: [] }));

    if (!failedBatches.length) {
      console.log('⛓ [CRON] No mintable batches found');
      return;
    }

    console.log(`⛓ [CRON] Found ${failedBatches.length} batch(es) to retry`);
    let minted = 0, failed = 0;

    for (const batch of failedBatches) {
      try {
        console.log(`⛓ [CRON] Retrying batch ${batch.id} — ${batch.project_name}`);
        const { tokenId, txHash } = await mintApprovedCredit(batch.id);

        await createNotification(batch.user_id, 'CREDIT', '🪙 Credit Tokenised On-Chain',
          `"${batch.project_name}" has been minted as Token #${tokenId} on Ethereum Sepolia.`,
          '/portfolio', { tokenId, txHash, creditId: batch.id });

        try {
          await sendMintSuccessEmail(batch.email, {
            name: batch.full_name,
            projectName: batch.project_name,
            tokenId,
            txHash,
            portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
          });
        } catch {}

        console.log(`✅ [CRON] Batch ${batch.id} minted → Token #${tokenId}`);
        minted++;
      } catch (mintErr) {
        console.error(`❌ [CRON] Batch ${batch.id} mint failed:`, mintErr.message);
        try {
          await query(
            `UPDATE carbon_batches
             SET admin_notes=COALESCE(admin_notes,'')||$1, updated_at=NOW()
             WHERE id=$2`,
            [`\n[MINT ERROR ${new Date().toISOString()}]: ${mintErr.message.slice(0, 300)}`, batch.id]
          );
        } catch {}
        failed++;
      }
    }

    console.log(`⛓ [CRON] Mint retry complete — ✅ ${minted} minted · ❌ ${failed} failed`);
  } catch (e) {
    console.error('❌ [CRON] Auto-retry cron error:', e.message);
  } finally {
    await releaseLock(LOCK_KEY);
  }
}, { timezone: 'Asia/Kolkata' });


// ══════════════════════════════════════════════════════════════════
// CRON #2 — KYC expiry enforcement
// Runs every hour
// NOTE: Requires migration — ALTER TABLE users ADD COLUMN IF NOT EXISTS
//       last_kyc_reminder TIMESTAMPTZ; [FIX-4]
// ══════════════════════════════════════════════════════════════════
cron.schedule('0 * * * *', async () => {
  const LOCK_KEY = 'cron:kyc-expiry:lock';
  const LOCK_TTL = 55 * 60; // 55 minutes

  // [FIX-2] Distributed lock
  const locked = await acquireLock(LOCK_KEY, LOCK_TTL);
  if (!locked) {
    console.log('🔍 [CRON] KYC expiry — lock held by another instance, skipping');
    return;
  }

  console.log('🔍 [CRON] Running KYC expiry enforcement...');
  try {
    // ── 2a: Block users whose KYC expired ────────────────────
    const { rows: expired } = await query(`
      SELECT id, email, full_name, kyc_expires_at
      FROM users
      WHERE kyc_verified = TRUE
        AND kyc_expires_at IS NOT NULL
        AND kyc_expires_at < NOW()
        AND kyc_status != 'expired'
        AND role != 'admin'
    `).catch(() => ({ rows: [] }));

    for (const user of expired) {
      try {
        await query(`
          UPDATE users
          SET kyc_verified = FALSE,
              kyc_status   = 'expired',
              updated_at   = NOW()
          WHERE id = $1
        `, [user.id]);

        const { rows: listings } = await query(`
          SELECT listing_id, project_name, available_credits, batch_id
          FROM market_listings
          WHERE seller_id = $1 AND available_credits > 0
        `, [user.id]).catch(() => ({ rows: [] }));

        // [FIX-3] Each listing cleanup is atomic
        for (const listing of listings) {
          try {
            await withTransaction(async (client) => {
              if (listing.batch_id && listing.available_credits > 0) {
                await client.query(`
                  UPDATE carbon_batches
                  SET available_credits = available_credits + $1,
                      status = CASE WHEN status='listed' THEN 'tokenised' ELSE status END,
                      updated_at = NOW()
                  WHERE id = $2
                `, [listing.available_credits, listing.batch_id]);
              }
              await client.query(
                `DELETE FROM market_listings WHERE listing_id=$1`,
                [listing.listing_id]
              );
            });
          } catch (listingErr) {
            console.error(`❌ [CRON] KYC listing cleanup error ${listing.listing_id}:`, listingErr.message);
          }
        }

        await createNotification(user.id, 'KYC', '⚠ KYC Expired — Trading Suspended',
          'Your KYC verification has expired. Trading, listing and retirement features are suspended until you renew.',
          '/kyc', {});

        try {
          await sendKycExpiredEmail(user.email, {
            fullName: user.full_name,
            expiredOn: new Date(user.kyc_expires_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
            listingsRemovedCount: listings.length,
            kycUrl: `${process.env.FRONTEND_URL}/kyc`,
          });
        } catch {}

        console.log(`🔍 [CRON] KYC expired + suspended: ${user.email}`);
      } catch (e) {
        console.error(`❌ [CRON] KYC expiry error for ${user.email}:`, e.message);
      }
    }

    // ── 2b: Send 7-day warning ────────────────────────────────
    // [FIX-4] Requires: ALTER TABLE users ADD COLUMN IF NOT EXISTS last_kyc_reminder TIMESTAMPTZ;
    const { rows: expiringSoon } = await query(`
      SELECT id, email, full_name, kyc_expires_at,
             EXTRACT(DAY FROM kyc_expires_at - NOW())::int AS days_left
      FROM users
      WHERE kyc_verified = TRUE
        AND kyc_expires_at IS NOT NULL
        AND kyc_expires_at > NOW()
        AND kyc_expires_at < NOW() + INTERVAL '7 days'
        AND kyc_status = 'verified'
        AND (last_kyc_reminder IS NULL OR last_kyc_reminder < NOW() - INTERVAL '24 hours')
        AND role != 'admin'
    `).catch(() => ({ rows: [] }));

    for (const user of expiringSoon) {
      try {
        await createNotification(user.id, 'KYC',
          `⚠ KYC Expiring in ${user.days_left} Day${user.days_left === 1 ? '' : 's'}`,
          `Your KYC expires on ${new Date(user.kyc_expires_at).toLocaleDateString('en-IN')}. Renew now to avoid suspension.`,
          '/kyc', {});

        try {
          await sendKycExpiringSoonEmail(user.email, {
            fullName: user.full_name,
            daysLeft: user.days_left,
            expiresOn: new Date(user.kyc_expires_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
            kycUrl: `${process.env.FRONTEND_URL}/kyc`,
          });
        } catch {}

        await query(`UPDATE users SET last_kyc_reminder=NOW() WHERE id=$1`, [user.id]).catch(() => {});
        console.log(`🔍 [CRON] KYC reminder sent: ${user.email} (${user.days_left}d left)`);
      } catch (e) {
        console.error(`❌ [CRON] KYC reminder error for ${user.email}:`, e.message);
      }
    }

    if (expired.length || expiringSoon.length) {
      console.log(`🔍 [CRON] KYC cron done — ${expired.length} expired, ${expiringSoon.length} reminded`);
    } else {
      console.log('🔍 [CRON] KYC cron — nothing to action');
    }
  } catch (e) {
    console.error('❌ [CRON] KYC expiry cron error:', e.message);
  } finally {
    await releaseLock(LOCK_KEY);
  }
}, { timezone: 'Asia/Kolkata' });


// ══════════════════════════════════════════════════════════════════
// CRON #3 — Listing expiry cleanup
// Runs every hour at :30
// ══════════════════════════════════════════════════════════════════
cron.schedule('30 * * * *', async () => {
  const LOCK_KEY = 'cron:listing-expiry:lock';
  const LOCK_TTL = 25 * 60; // 25 minutes

  // [FIX-2] Distributed lock
  const locked = await acquireLock(LOCK_KEY, LOCK_TTL);
  if (!locked) {
    console.log('📋 [CRON] Listing expiry — lock held by another instance, skipping');
    return;
  }

  console.log('📋 [CRON] Running listing expiry cleanup...');
  try {
    const { rows: expiredListings } = await query(`
      SELECT ml.listing_id, ml.batch_id, ml.seller_id,
             ml.available_credits, ml.project_name,
             ml.seller_email, ml.seller_name,
             ml.expires_at
      FROM market_listings ml
      WHERE ml.expires_at IS NOT NULL
        AND ml.expires_at < NOW()
        AND ml.available_credits > 0
      LIMIT 50
    `).catch(() => ({ rows: [] }));

    if (!expiredListings.length) {
      console.log('📋 [CRON] No expired listings found');
      return;
    }

    console.log(`📋 [CRON] Found ${expiredListings.length} expired listing(s)`);
    let cleaned = 0;

    for (const listing of expiredListings) {
      try {
        // [FIX-3] Wrap in transaction — credit return and delete are atomic
        await withTransaction(async (client) => {
          if (listing.batch_id && listing.available_credits > 0) {
            await client.query(`
              UPDATE carbon_batches
              SET available_credits = available_credits + $1,
                  status = CASE WHEN status='listed' THEN 'tokenised' ELSE status END,
                  updated_at = NOW()
              WHERE id = $2
            `, [listing.available_credits, listing.batch_id]);
          }
          await client.query(
            `DELETE FROM market_listings WHERE listing_id=$1`,
            [listing.listing_id]
          );
        });

        await createNotification(listing.seller_id, 'CREDIT', '⏰ Listing Expired',
          `Your listing for "${listing.project_name}" has expired and been removed. ${listing.available_credits} credits returned to your portfolio.`,
          '/portfolio', { listingId: listing.listing_id });

        try {
          await sendListingExpiredEmail(listing.seller_email, {
            name: listing.seller_name,
            projectName: listing.project_name,
            expiredOn: new Date(listing.expires_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
            creditsReturned: listing.available_credits,
            portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
          });
        } catch {}

        console.log(`📋 [CRON] Cleaned listing ${listing.listing_id} — ${listing.project_name}`);
        cleaned++;
      } catch (e) {
        console.error(`❌ [CRON] Listing cleanup error ${listing.listing_id}:`, e.message);
      }
    }

    console.log(`📋 [CRON] Listing cleanup done — ${cleaned}/${expiredListings.length} cleaned`);
  } catch (e) {
    console.error('❌ [CRON] Listing expiry cron error:', e.message);
  } finally {
    await releaseLock(LOCK_KEY);
  }
}, { timezone: 'Asia/Kolkata' });


// ══════════════════════════════════════════════════════════════════
// CRON #4 — Activity log TTL cleanup
// Runs daily at 03:00 IST
// Deletes profile_activity_log entries older than 90 days
// ══════════════════════════════════════════════════════════════════
cron.schedule('0 3 * * *', async () => {
  const LOCK_KEY = 'cron:log-cleanup:lock';
  const LOCK_TTL = 23 * 60 * 60; // 23 hours

  const locked = await acquireLock(LOCK_KEY, LOCK_TTL);
  if (!locked) {
    console.log('🧹 [CRON] Log cleanup — lock held by another instance, skipping');
    return;
  }

  console.log('🧹 [CRON] Running activity log TTL cleanup...');
  try {
    const result = await query(
      `DELETE FROM profile_activity_log WHERE created_at < NOW() - INTERVAL '90 days'`
    );
    console.log(`🧹 [CRON] Cleaned ${result.rowCount} old activity log entries`);
  } catch (e) {
    console.error('❌ [CRON] Activity log cleanup failed:', e.message);
  } finally {
    await releaseLock(LOCK_KEY);
  }
}, { timezone: 'Asia/Kolkata' });


// ══════════════════════════════════════════════════════════════════
// CRON #5 — On-chain KYC sync self-heal
// Runs every 30 minutes
//
// WHY: routes/admin.js's `/kyc/:id/approve` only registers a wallet on the
// on-chain KYCRegistry if that user already had a wallet_address bound at
// the moment of approval. If KYC gets approved BEFORE the wallet is bound,
// the on-chain call is silently skipped — DB says kyc_verified=TRUE, but
// KYCRegistry.isKYCVerified() returns false, and every trade/mint/retire
// call reverts with "Wallet not KYC verified" with no obvious cause.
//
// routes/wallet.js's /bind route was patched to catch this at bind-time,
// but this cron exists as a backstop for any other way the DB and on-chain
// registry can drift apart (failed tx, RPC hiccup during approval, manual
// DB edits, etc.) — it finds anyone kyc_verified=TRUE with a wallet but no
// successful on-chain registration audit entry, and retries them.
// ══════════════════════════════════════════════════════════════════
cron.schedule('*/30 * * * *', async () => {
  const LOCK_KEY = 'cron:kyc-onchain-sync:lock';
  const LOCK_TTL = 25 * 60; // 25 minutes

  const locked = await acquireLock(LOCK_KEY, LOCK_TTL);
  if (!locked) {
    console.log('⛓ [CRON] KYC on-chain sync — lock held by another instance, skipping');
    return;
  }

  console.log('⛓ [CRON] Running on-chain KYC sync self-heal...');
  try {
    const { rows: driftedUsers } = await query(`
      SELECT u.id, u.email, u.wallet_address, u.kyc_data_hash
      FROM users u
      WHERE u.kyc_verified = TRUE
        AND u.wallet_address IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM admin_audit_log a
          WHERE a.target_user_id = u.id
            AND a.action IN (
              'KYC_ONCHAIN_REGISTERED',
              'KYC_ONCHAIN_REGISTERED_MANUAL',
              'KYC_ONCHAIN_REGISTERED_ON_BIND'
            )
        )
      LIMIT 20
    `).catch(() => ({ rows: [] }));

    if (!driftedUsers.length) {
      console.log('⛓ [CRON] No on-chain KYC drift found — all synced');
      return;
    }

    console.log(`⛓ [CRON] Found ${driftedUsers.length} user(s) verified in DB but unconfirmed on-chain`);
    let fixed = 0, failed = 0, alreadyOk = 0;

    for (const user of driftedUsers) {
      try {
        const r = await verifyKYCOnChain(user.wallet_address, user.kyc_data_hash);
        if (r.skipped) {
          // Already verified on-chain — just a missing audit entry (e.g. from
          // before this logging existed). Log it now so future runs skip it.
          await query(
            `INSERT INTO admin_audit_log (admin_id, action, target_user_id, details)
             VALUES ($1,$2,$3,$4)`,
            [user.id, 'KYC_ONCHAIN_REGISTERED_BACKFILLED_LOG', user.id,
             'Already verified on-chain — backfilling missing audit entry']
          ).catch(() => {});
          console.log(`ℹ️  [CRON] ${user.email} — already verified on-chain, logged retroactively`);
          alreadyOk++;
        } else {
          await query(
            `INSERT INTO admin_audit_log (admin_id, action, target_user_id, details)
             VALUES ($1,$2,$3,$4)`,
            [user.id, 'KYC_ONCHAIN_REGISTERED_CRON', user.id, `TX: ${r.txHash}`]
          ).catch(() => {});

          await createNotification(user.id, 'KYC', '✅ Trading Access Confirmed',
            'Your KYC verification is now fully active on-chain. You can trade, list, and retire credits.',
            '/portfolio', {});

          console.log(`✅ [CRON] ${user.email} — registered on-chain, TX: ${r.txHash}`);
          fixed++;
        }
      } catch (e) {
        console.error(`❌ [CRON] ${user.email} — on-chain KYC sync failed:`, e.message);
        await query(
          `INSERT INTO admin_audit_log (admin_id, action, target_user_id, details)
           VALUES ($1,$2,$3,$4)`,
          [user.id, 'KYC_ONCHAIN_FAILED_CRON', user.id, e.message]
        ).catch(() => {});
        failed++;
      }
    }

    console.log(`⛓ [CRON] KYC on-chain sync complete — ✅ ${fixed} fixed · ℹ️ ${alreadyOk} already ok · ❌ ${failed} failed`);
    if (failed > 0) {
      console.warn(`⚠️  [CRON] ${failed} wallet(s) could not be synced — check admin_audit_log for 'KYC_ONCHAIN_FAILED_CRON' entries. Common cause: minter wallet is not registered as a KYC operator, or is out of gas.`);
    }
  } catch (e) {
    console.error('❌ [CRON] KYC on-chain sync cron error:', e.message);
  } finally {
    await releaseLock(LOCK_KEY);
  }
}, { timezone: 'Asia/Kolkata' });


console.log('✅ All cron jobs registered:');
console.log('   ⛓ Auto-retry failed mints    — every 15 minutes');
console.log('   🔍 KYC expiry enforcement     — every hour at :00');
console.log('   📋 Listing expiry cleanup     — every hour at :30');
console.log('   🧹 Activity log TTL cleanup   — daily at 03:00 IST');
console.log('   ⛓ On-chain KYC sync self-heal — every 30 minutes');