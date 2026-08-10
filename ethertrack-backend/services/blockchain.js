// services/blockchain.js — Updated for new Marketplace contract events
// ─────────────────────────────────────────────────────────────────────────
// FIXES (carried over from previous version):
//
// [B1]  SYNC TIMEOUT — hard 25s/120s cap so a slow sync can't block
//       graceful shutdown.
// [B2]  BACKGROUND SYNC — sync runs concurrently with polling, not blocking
//       server boot.
// [B3]  SYNC DEDUP — persists lastSyncedBlock to DB.
// [B4]  SHUTDOWN FLAG — stop() clears the poll timer and cancels in-flight
//       polls gracefully.
// [B5]  CHUNK DELAY reduced 150ms → 50ms (superseded by B6 below).
// [B6]  CHUNK SIZE / DELAY / TIMEOUT tuned for Ankr free tier.
//
// NEW IN THIS VERSION:
//
// [FIX-LISTED-QTY] handleCreditListed, handleCreditTraded, and
//       handleListingCancelled (plus their mirrors inside syncMissedEvents)
//       now read/write carbon_batches.listed_quantity — the column that
//       tracks how many credits of a batch are currently sitting in an
//       ACTIVE on-chain listing (mirrors the contract's
//       Listing.amountRemaining).
//
//       Previously these handlers only ever touched available_credits and
//       listing_id_onchain, so:
//         - CreditListed  never recorded HOW MANY credits were listed
//         - CreditTraded  (the ETH/AMM settlement path) decremented
//                         available_credits but left listed_quantity
//                         completely unset/stale
//         - ListingCancelled cleared listing_id_onchain but never reset
//                         listed_quantity, so a subsequent listing on the
//                         same batch could inherit a stale non-zero value
//
//       Net effect before this fix: any trade settled via the ETH/AMM path
//       (as opposed to INR wallet or Razorpay, which go through
//       routes/trades.js and now decrement listed_quantity there) would
//       leave the delist modal and the market "available" figure showing
//       stale numbers for that listing.
// ─────────────────────────────────────────────────────────────────────────
'use strict';

const { ethers } = require('ethers');
const { safeQuery: query, withTransaction } = require('../db/pool');
const { getBreaker } = require('../lib/circuitBreaker');
const logger = require('./logger');

const rpcBreaker = getBreaker('alchemy-rpc', {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000
});

const MARKETPLACE_ABI = [
  'event CreditTraded(uint256 indexed tradeId, uint256 indexed listingId, uint256 indexed buyOrderId, address buyer, address seller, uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR, uint256 totalPrice, uint256 buyerFee, uint256 sellerFee, uint256 totalFee, bool isAMM)',
  'event CreditListed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR)',
  'event ListingCancelled(uint256 indexed listingId, address indexed seller)',
  'event BuyOrderPlaced(uint256 indexed orderId, address indexed buyer, uint256 indexed tokenId, uint256 amount, uint256 limitPrice, uint256 ethEscrowed)',
  'event MatchExecuted(uint256 listingId, uint256 buyOrderId, uint256 amount, uint256 price)',
];

const TOKEN_ABI = [
  'event CreditMinted(uint256 indexed tokenId, address indexed to, uint256 amount, string projectName, uint8 standard, string serialNumber)',
  'event CreditRetired(uint256 indexed tokenId, address indexed retiredBy, uint256 amount, string projectName)',
];

let provider, marketplace, token;
let lastPolledBlock = null;
let pollTimer       = null;
let _stopped        = false; // [B4] shutdown flag

const POLL_INTERVAL_MS = 15_000;
const CHUNK_SIZE       = 2000;   // [B6] was 9 — Ankr supports ~3500 blocks per call
const CHUNK_DELAY_MS   = 200;    // [B6] was 50ms — breathing room for Ankr free tier
const SYNC_TIMEOUT_MS  = 120_000; // [B6] was 25s — increased to match larger chunks
const SYNC_WINDOW      = 2_000;  // [B6] was 10_000 — cap sync lookback to reduce RPC calls

// ── [B3] Persist lastSyncedBlock to DB ───────────────────────────
// Prevents replaying blocks on every restart.
const SYNC_STATE_KEY = 'blockchain:last_synced_block';

const getLastSyncedBlock = async () => {
  try {
    const { rows } = await query(
      `SELECT value FROM app_state WHERE key = $1 LIMIT 1`,
      [SYNC_STATE_KEY]
    );
    return rows[0]?.value ? parseInt(rows[0].value, 10) : null;
  } catch {
    return null; // table may not exist yet — safe fallback
  }
};

const saveLastSyncedBlock = async (blockNumber) => {
  try {
    await query(
      `INSERT INTO app_state (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [SYNC_STATE_KEY, String(blockNumber)]
    );
  } catch { /* non-fatal */ }
};

// ── Chunked getLogs helper ────────────────────────────────────────
const queryFilterChunked = async (contract, filter, fromBlock, toBlock, abortSignal) => {
  const allEvents = [];

  for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
    // [B4] Respect shutdown / timeout signal
    if (_stopped || abortSignal?.aborted) break;

    const end = Math.min(start + CHUNK_SIZE - 1, toBlock);
    try {
      const events = await rpcBreaker.execute(() => contract.queryFilter(filter, start, end));
      allEvents.push(...events);
    } catch (e) {
      logger.error(`  ↳ queryFilter chunk [${start}→${end}] failed:`, e.message);
    }

    if (end < toBlock) {
      await new Promise(res => setTimeout(res, CHUNK_DELAY_MS));
    }
  }

  return allEvents;
};

// ── Init ──────────────────────────────────────────────────────────
const init = () => {
  try {
    _stopped    = false;
    provider    = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC);
    marketplace = new ethers.Contract(process.env.MARKETPLACE_ADDRESS,         MARKETPLACE_ABI, provider);
    token       = new ethers.Contract(process.env.CARBON_CREDIT_TOKEN_ADDRESS, TOKEN_ABI,       provider);

    provider.on('error', (e) => {
      if (
        e?.error?.message === 'filter not found' ||
        e?.shortMessage?.includes('filter not found') ||
        e?.code === 'UNKNOWN_ERROR'
      ) return;
      logger.error('Provider error:', e.message);
    });

    // [B2] Start polling immediately — don't wait for sync
    provider.getBlockNumber().then(async (currentBlock) => {
      lastPolledBlock = currentBlock;
      startPolling();
      logger.info('✅ Blockchain polling started (block:', currentBlock, ')');

      // [B2] Sync runs in background — won't block or kill server
      runBackgroundSync(currentBlock).catch(e =>
        logger.warn('[blockchain] Background sync error:', e.message)
      );
    }).catch(async (e) => {
      logger.error('Blockchain init failed to get block number:', e.message);
      lastPolledBlock = 0;
      startPolling();
    });

  } catch (e) {
    logger.error('Blockchain listener init failed:', e.message);
  }
};

// ── [B2] Background sync — runs after polling starts ─────────────
const runBackgroundSync = async (currentBlock) => {
  // [B1] Hard timeout — abort sync if it takes too long
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => {
    controller.abort();
    logger.warn(`[blockchain] Startup sync timed out after ${SYNC_TIMEOUT_MS / 1000}s — will resume on next poll`);
  }, SYNC_TIMEOUT_MS);

  try {
    await syncMissedEvents(currentBlock, controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
};

// ── Polling loop ──────────────────────────────────────────────────
const startPolling = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (_stopped) return; // [B4]
    try {
      await pollEvents();
    } catch (e) {
      logger.error('Poll cycle error:', e.message);
    }
  }, POLL_INTERVAL_MS);
};

// [B4] Stop function — called by server.js shutdown()
const stop = () => {
  _stopped = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  logger.info('[blockchain] Polling stopped');
};

const pollEvents = async () => {
  const currentBlock = await provider.getBlockNumber();

  if (lastPolledBlock === null) lastPolledBlock = currentBlock - 1;
  if (currentBlock <= lastPolledBlock) return;

  const fromBlock = lastPolledBlock + 1;
  const toBlock   = currentBlock;

  const mintedEvents = await queryFilterChunked(token, token.filters.CreditMinted(), fromBlock, toBlock);
  for (const ev of mintedEvents) {
    const [tokenId, to, amount, projectName, standard, serialNumber] = ev.args;
    await handleCreditMinted(tokenId, to, amount, projectName, standard, serialNumber, ev);
  }

  const listedEvents = await queryFilterChunked(marketplace, marketplace.filters.CreditListed(), fromBlock, toBlock);
  for (const ev of listedEvents) {
    const [listingId, seller, tokenId, amount, pricePerUnit, pricePerUnitINR] = ev.args;
    await handleCreditListed(listingId, seller, tokenId, amount, pricePerUnit, pricePerUnitINR, ev);
  }

  const tradedEvents = await queryFilterChunked(marketplace, marketplace.filters.CreditTraded(), fromBlock, toBlock);
  for (const ev of tradedEvents) {
    const [tradeId, listingId, buyOrderId, buyer, seller, tokenId, amount, pricePerUnit, pricePerUnitINR, totalPrice, buyerFee, sellerFee, totalFee, isAMM] = ev.args;
    await handleCreditTraded(tradeId, listingId, buyOrderId, buyer, seller, tokenId, amount, pricePerUnit, pricePerUnitINR, totalPrice, buyerFee, sellerFee, totalFee, isAMM, ev);
  }

  const cancelledEvents = await queryFilterChunked(marketplace, marketplace.filters.ListingCancelled(), fromBlock, toBlock);
  for (const ev of cancelledEvents) {
    const [listingId, seller] = ev.args;
    await handleListingCancelled(listingId, seller, ev);
  }

  const retiredEvents = await queryFilterChunked(token, token.filters.CreditRetired(), fromBlock, toBlock);
  for (const ev of retiredEvents) {
    const [tokenId, retiredBy, amount, projectName] = ev.args;
    await handleCreditRetired(tokenId, retiredBy, amount, projectName, ev);
  }

  lastPolledBlock = currentBlock;
  await saveLastSyncedBlock(currentBlock); // [B3] persist progress
};

// ── [B3] Sync missed events — starts from last saved block ───────
const syncMissedEvents = async (currentBlock, abortSignal) => {
  try {
    // [B3] Start from where we left off
    // [B6] Cap lookback to SYNC_WINDOW blocks to reduce RPC calls
    const savedBlock = await getLastSyncedBlock();
    const fromBlock  = savedBlock
      ? Math.max(savedBlock, currentBlock - SYNC_WINDOW)
      : Math.max(0, currentBlock - SYNC_WINDOW);

    if (fromBlock >= currentBlock) {
      logger.info('[blockchain] No missed blocks to sync');
      return;
    }

    const totalChunks = Math.ceil((currentBlock - fromBlock) / CHUNK_SIZE);
    logger.info(`🔄 Syncing missed events from block ${fromBlock} to ${currentBlock}...`);
    logger.info(`   (${totalChunks} chunks × ${CHUNK_SIZE} blocks — timeout: ${SYNC_TIMEOUT_MS / 1000}s)`);

    // ── Sync CreditListed ─────────────────────────────────────
    // [FIX-LISTED-QTY] now also writes listed_quantity = amount
    if (!abortSignal?.aborted) {
      const listedEvents = await queryFilterChunked(
        marketplace, marketplace.filters.CreditListed(), fromBlock, currentBlock, abortSignal
      );
      logger.info(`   Found ${listedEvents.length} CreditListed events`);
      for (const ev of listedEvents) {
        if (abortSignal?.aborted) break;
        const [listingId, seller, tokenId, amount, pricePerUnit, pricePerUnitINR] = ev.args;
        try {
          const { rows: batches } = await query('SELECT id FROM carbon_batches WHERE token_id = $1', [Number(tokenId)]);
          const batch = batches[0];
          if (!batch?.id) continue;
          const priceINR = Number(pricePerUnitINR);
          await query(
            `UPDATE carbon_batches
             SET price_per_credit_inr = COALESCE(NULLIF($1, 0), price_per_credit_inr),
                 listing_id_onchain   = $2,
                 listed_quantity      = $3,
                 updated_at           = NOW()
             WHERE id = $4 AND (listing_id_onchain IS NULL OR listing_id_onchain != $2)`,
            [priceINR, Number(listingId), Number(amount), batch.id]
          );
        } catch (e) {
          logger.error(`  ↳ CreditListed sync error (listingId:${listingId}):`, e.message);
        }
      }
    }

    // ── Sync ListingCancelled ─────────────────────────────────
    // [FIX-LISTED-QTY] now also zeroes listed_quantity — a cancel always
    // deactivates the whole listing on-chain (no partial cancel exists).
    if (!abortSignal?.aborted) {
      const cancelledEvents = await queryFilterChunked(
        marketplace, marketplace.filters.ListingCancelled(), fromBlock, currentBlock, abortSignal
      );
      logger.info(`   Found ${cancelledEvents.length} ListingCancelled events`);
      for (const ev of cancelledEvents) {
        if (abortSignal?.aborted) break;
        const [listingId] = ev.args;
        try {
          await query(
            `UPDATE carbon_batches
             SET listing_id_onchain = NULL, listed_quantity = 0, updated_at = NOW()
             WHERE listing_id_onchain = $1`,
            [Number(listingId)]
          );
        } catch (e) {
          logger.error(`  ↳ ListingCancelled sync error:`, e.message);
        }
      }
    }

    // ── Sync CreditMinted ─────────────────────────────────────
    if (!abortSignal?.aborted) {
      const mintedEvents = await queryFilterChunked(
        token, token.filters.CreditMinted(), fromBlock, currentBlock, abortSignal
      );
      logger.info(`   Found ${mintedEvents.length} CreditMinted events`);
      for (const ev of mintedEvents) {
        if (abortSignal?.aborted) break;
        const [tokenId, to, amount, projectName, standard, serialNumber] = ev.args;
        try {
          const { rows: batches } = await query(
            `SELECT id FROM carbon_batches WHERE registry_serial = $1 OR token_id = $2 LIMIT 1`,
            [serialNumber, Number(tokenId)]
          );
          const batch = batches[0];
          if (batch?.id) {
            await query(
              `UPDATE carbon_batches SET token_id = $1, status = 'tokenised', updated_at = NOW()
               WHERE id = $2 AND (token_id IS NULL OR token_id != $1)`,
              [Number(tokenId), batch.id]
            );
          }
        } catch (e) {
          logger.error(`  ↳ CreditMinted sync error (tokenId:${tokenId}):`, e.message);
        }
      }
    }

    // ── Sync CreditTraded (ETH/AMM settlements missed while offline) ──
    // [FIX-LISTED-QTY] added — previously this event type wasn't replayed
    // at all during sync, meaning any ETH trade that happened while the
    // listener was down would never decrement available_credits OR
    // listed_quantity until/unless pollEvents happened to catch it live.
    if (!abortSignal?.aborted) {
      const tradedEvents = await queryFilterChunked(
        marketplace, marketplace.filters.CreditTraded(), fromBlock, currentBlock, abortSignal
      );
      logger.info(`   Found ${tradedEvents.length} CreditTraded events`);
      for (const ev of tradedEvents) {
        if (abortSignal?.aborted) break;
        const [tradeId, listingId, buyOrderId, buyer, seller, tokenId, amount, pricePerUnit, pricePerUnitINR, totalPrice, buyerFee, sellerFee, totalFee, isAMM] = ev.args;
        try {
          await handleCreditTraded(tradeId, listingId, buyOrderId, buyer, seller, tokenId, amount, pricePerUnit, pricePerUnitINR, totalPrice, buyerFee, sellerFee, totalFee, isAMM, ev);
        } catch (e) {
          logger.error(`  ↳ CreditTraded sync error (tradeId:${tradeId}):`, e.message);
        }
      }
    }

    if (!abortSignal?.aborted) {
      await saveLastSyncedBlock(currentBlock); // [B3] mark sync complete
      logger.info('✅ Historical event sync complete');
    } else {
      logger.warn('[blockchain] Sync aborted — partial progress saved');
    }
  } catch (e) {
    logger.error('syncMissedEvents error:', e.message);
    throw e;
  }
};

// ── Event handlers ────────────────────────────────────────────────

const handleCreditMinted = async (tokenId, to, amount, projectName, standard, serialNumber, ev) => {
  try {
    const { rows: batches } = await query(
      `SELECT id, project_id FROM carbon_batches WHERE registry_serial = $1 OR token_id = $2 LIMIT 1`,
      [serialNumber, Number(tokenId)]
    );
    const batch = batches[0];
    if (batch?.id) {
      await query(
        `UPDATE carbon_batches SET token_id = $1, status = 'tokenised', updated_at = NOW() WHERE id = $2`,
        [Number(tokenId), batch.id]
      );
    }
    const { rows: users } = await query('SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1)', [to]);
    await query(
      `INSERT INTO registry_transactions (type, token_id, batch_id, project_id, to_wallet, to_user_id, amount)
       VALUES ('MINT', $1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [Number(tokenId), batch?.id, batch?.project_id, to, users[0]?.id, Number(amount)]
    );
    logger.info(`📦 MINT — tokenId:${tokenId} amount:${amount} to:${to}`);
  } catch (e) {
    logger.error('CreditMinted handler error:', e.message);
  }
};

// [FIX-LISTED-QTY] now writes listed_quantity = amount from the event.
// Previously `amount` was destructured into this function's params but
// never actually persisted anywhere — the DB had zero record of how many
// credits were put into a given on-chain listing.
const handleCreditListed = async (listingId, seller, tokenId, amount, pricePerUnit, pricePerUnitINR, ev) => {
  try {
    const { rows: batches } = await query('SELECT id, project_id FROM carbon_batches WHERE token_id = $1', [Number(tokenId)]);
    const batch = batches[0];
    const { rows: users } = await query('SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1)', [seller]);
    const priceEth = parseFloat(ethers.formatEther(pricePerUnit));
    const priceINR = Number(pricePerUnitINR);
    const qty      = Number(amount);
    await query(
      `INSERT INTO registry_transactions (type, token_id, batch_id, project_id, listing_id, from_wallet, from_user_id, amount, price_eth, price_inr)
       VALUES ('LIST', $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [Number(tokenId), batch?.id, batch?.project_id, Number(listingId), seller, users[0]?.id, qty, priceEth, priceINR]
    );
    if (batch?.id) {
      await query(
        `UPDATE carbon_batches
         SET price_per_credit_inr = COALESCE(NULLIF($1, 0), price_per_credit_inr),
             listing_id_onchain   = $2,
             listed_quantity      = $3,
             updated_at           = NOW()
         WHERE id = $4`,
        [priceINR, Number(listingId), qty, batch.id]
      );
    }
    logger.info(`📋 LIST — listingId:${listingId} tokenId:${tokenId} qty:${qty} priceINR:₹${priceINR}`);
  } catch (e) {
    logger.error('CreditListed handler error:', e.message);
  }
};

// [FIX-LISTED-QTY] now decrements listed_quantity alongside
// available_credits. This is the ETH/AMM settlement path — INR wallet and
// Razorpay trades are decremented directly inside routes/trades.js at
// settlement time, but ETH trades settle purely on-chain and only reach the
// DB through this listener, so without this fix ETH trades never reduced
// listed_quantity at all.
const handleCreditTraded = async (tradeId, listingId, buyOrderId, buyer, seller, tokenId, amount, pricePerUnit, pricePerUnitINR, totalPrice, buyerFee, sellerFee, totalFee, isAMM, ev) => {
  try {
    const { rows: batches } = await query('SELECT id, project_id FROM carbon_batches WHERE token_id = $1', [Number(tokenId)]);
    const batch = batches[0];
    const [{ rows: buyers }, { rows: sellers }] = await Promise.all([
      query('SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1)', [buyer]),
      query('SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1)', [seller]),
    ]);
    const priceEth     = parseFloat(ethers.formatEther(pricePerUnit));
    const totalEth     = parseFloat(ethers.formatEther(totalPrice));
    const buyerFeeEth  = parseFloat(ethers.formatEther(buyerFee));
    const sellerFeeEth = parseFloat(ethers.formatEther(sellerFee));
    const totalFeeEth  = parseFloat(ethers.formatEther(totalFee));
    const priceINR     = Number(pricePerUnitINR);
    const qty          = Number(amount);
    const txHash       = ev?.transactionHash || null;
    const paymentMethod = isAMM ? 'amm' : 'eth';
    if (txHash) {
      const { rows: existing } = await query(`SELECT id FROM trades WHERE tx_hash = $1 LIMIT 1`, [txHash]);
      if (existing.length) {
        logger.info(`⏭️  TRADE already settled — skipping (tradeId:${tradeId})`);
        return;
      }
    }
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO registry_transactions (type, token_id, batch_id, project_id, listing_id, from_wallet, to_wallet, from_user_id, to_user_id, amount, price_eth, price_inr, buyer_fee_eth, seller_fee_eth, total_fee_eth, total_price_eth, payment_mode, tx_hash)
         VALUES ('TRADE', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (tx_hash) DO NOTHING`,
        [Number(tokenId), batch?.id, batch?.project_id, Number(listingId), seller, buyer, sellers[0]?.id, buyers[0]?.id, qty, priceEth, priceINR, buyerFeeEth, sellerFeeEth, totalFeeEth, totalEth, paymentMethod, txHash]
      );
      if (batch?.id) {
        await client.query(
          `UPDATE carbon_batches
           SET available_credits = GREATEST(0, available_credits - $1),
               listed_quantity   = GREATEST(0, listed_quantity - $1),
               last_traded_price_inr = $2, updated_at = NOW()
           WHERE id = $3`,
          [qty, priceINR, batch.id]
        );
      }
      if (sellers[0]?.id && priceINR > 0) {
        const sellerGetsINR = Math.round(priceINR * qty * 0.995);
        if (sellerGetsINR > 0) {
          await client.query(`UPDATE users SET inr_balance = inr_balance + $1, updated_at = NOW() WHERE id = $2`, [sellerGetsINR, sellers[0].id]);
          await client.query(
            `INSERT INTO wallet_transactions (user_id, type, method, amount, status, notes, trade_type) VALUES ($1, 'credit', 'eth', $2, 'success', $3, 'sell_credit')`,
            [sellers[0].id, sellerGetsINR, `Sale of ${qty} × Token #${Number(tokenId)} @ ₹${priceINR}/credit (ETH tradeId:${Number(tradeId)})`]
          );
        }
      }
    });
    logger.info(`💱 TRADE — tradeId:${tradeId} amount:${qty} priceINR:₹${priceINR}`);
  } catch (e) {
    logger.error('CreditTraded handler error:', e.message);
  }
};

// [FIX-LISTED-QTY] now also zeroes listed_quantity when a listing is
// cancelled. Safe to always zero: cancelListing() on-chain always
// deactivates the WHOLE listing (there's no partial cancel), so whatever
// was left unsold gets returned to the seller's wallet and the listing
// stops existing. A subsequent partial re-list will fire a fresh
// CreditListed event that sets listed_quantity to the new correct amount.
const handleListingCancelled = async (listingId, seller, ev) => {
  try {
    await query(`INSERT INTO registry_transactions (type, listing_id, from_wallet) VALUES ('DELIST', $1, $2)`, [Number(listingId), seller]);
    await query(
      `UPDATE carbon_batches
       SET listing_id_onchain = NULL, listed_quantity = 0, updated_at = NOW()
       WHERE listing_id_onchain = $1`,
      [Number(listingId)]
    );
    logger.info(`❌ DELIST — listingId:${listingId}`);
  } catch (e) {
    logger.error('ListingCancelled handler error:', e.message);
  }
};

const handleCreditRetired = async (tokenId, retiredBy, amount, projectName, ev) => {
  try {
    const { rows: batches } = await query('SELECT id, project_id FROM carbon_batches WHERE token_id = $1', [Number(tokenId)]);
    const batch = batches[0];
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO registry_transactions (type, token_id, batch_id, project_id, from_wallet, amount) VALUES ('RETIRE', $1, $2, $3, $4, $5)`,
        [Number(tokenId), batch?.id, batch?.project_id, retiredBy, Number(amount)]
      );
      if (batch?.id) {
        await client.query(
          `UPDATE carbon_batches SET retired_credits = retired_credits + $1, available_credits = GREATEST(0, available_credits - $1), updated_at = NOW() WHERE id = $2`,
          [Number(amount), batch.id]
        );
        if (batch.project_id) {
          await client.query('UPDATE projects SET retired_credits = retired_credits + $1 WHERE id = $2', [Number(amount), batch.project_id]);
        }
      }
    });
    logger.info(`🔥 RETIRE — tokenId:${tokenId} amount:${amount}`);
  } catch (e) {
    logger.error('CreditRetired handler error:', e.message);
  }
};

module.exports = { init, stop }; // [B4] export stop() for graceful shutdown