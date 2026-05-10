// services/blockchain.js — Updated for new Marketplace contract events
const { ethers } = require('ethers');
const { safeQuery: query, withTransaction } = require('../db/pool');

// ✅ Updated ABI to match new Marketplace.sol events
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

const init = () => {
  try {
    provider    = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC);
    marketplace = new ethers.Contract(process.env.MARKETPLACE_ADDRESS,         MARKETPLACE_ABI, provider);
    token       = new ethers.Contract(process.env.CARBON_CREDIT_TOKEN_ADDRESS, TOKEN_ABI,       provider);

    provider.on('error', (e) => {
      if (
        e?.error?.message === 'filter not found' ||
        e?.shortMessage?.includes('filter not found') ||
        e?.code === 'UNKNOWN_ERROR'
      ) return;
      console.error('Provider error:', e.message);
    });

    attachListeners();
    console.log('✅ Blockchain listeners attached');
  } catch (e) {
    console.error('Blockchain listener init failed:', e.message);
  }
};

const safeOn = (contract, event, handler) => {
  contract.on(event, async (...args) => {
    try {
      await handler(...args);
    } catch (e) {
      if (
        e?.error?.message === 'filter not found' ||
        e?.shortMessage?.includes('filter not found')
      ) return;
      console.error(`${event} handler error:`, e.message);
    }
  });
};

const attachListeners = () => {

  // ── CreditMinted ────────────────────────────────────────────────
  safeOn(token, 'CreditMinted', async (tokenId, to, amount, projectName, standard, serialNumber) => {
    try {
      const { rows: batches } = await query(
        `SELECT id, project_id FROM carbon_batches
         WHERE registry_serial = $1 OR token_id = $2
         LIMIT 1`,
        [serialNumber, Number(tokenId)]
      );
      const batch = batches[0];

      if (batch?.id) {
        await query(
          `UPDATE carbon_batches
           SET token_id   = $1,
               status     = 'tokenised',
               updated_at = NOW()
           WHERE id = $2`,
          [Number(tokenId), batch.id]
        );
      }

      const { rows: users } = await query(
        'SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1)', [to]
      );

      await query(
        `INSERT INTO registry_transactions
         (type, token_id, batch_id, project_id, to_wallet, to_user_id, amount)
         VALUES ('MINT', $1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [Number(tokenId), batch?.id, batch?.project_id, to, users[0]?.id, Number(amount)]
      );

      console.log(`📦 MINT — tokenId:${tokenId} amount:${amount} to:${to} serial:${serialNumber}`);
    } catch (e) {
      console.error('CreditMinted handler error:', e.message);
    }
  });

  // ── CreditListed ────────────────────────────────────────────────
  safeOn(marketplace, 'CreditListed', async (listingId, seller, tokenId, amount, pricePerUnit, pricePerUnitINR) => {
    try {
      const { rows: batches } = await query(
        'SELECT id, project_id FROM carbon_batches WHERE token_id = $1', [Number(tokenId)]
      );
      const batch = batches[0];

      const { rows: users } = await query(
        'SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1)', [seller]
      );

      const priceEth = parseFloat(ethers.formatEther(pricePerUnit));
      const priceINR = Number(pricePerUnitINR);

      await query(
        `INSERT INTO registry_transactions
         (type, token_id, batch_id, project_id, listing_id, from_wallet, from_user_id, amount, price_eth, price_inr)
         VALUES ('LIST', $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          Number(tokenId), batch?.id, batch?.project_id,
          Number(listingId), seller, users[0]?.id,
          Number(amount), priceEth, priceINR,
        ]
      );

      if (batch?.id && priceINR > 0) {
        await query(
          `UPDATE carbon_batches
           SET price_per_credit_inr = $1,
               listing_id_onchain   = $2,
               updated_at           = NOW()
           WHERE id = $3`,
          [priceINR, Number(listingId), batch.id]
        );
      }

      console.log(`📋 LIST — listingId:${listingId} tokenId:${tokenId} priceETH:${priceEth} priceINR:₹${priceINR}`);
    } catch (e) {
      console.error('CreditListed handler error:', e.message);
    }
  });

  // ── CreditTraded ─────────────────────────────────────────────────
  // This blockchain event fires for ALL trades — both INR (settled via trades.js API)
  // and ETH (settled on-chain). We check if the trade was already settled via the
  // INR API flow using tx_hash, and skip wallet crediting if so to avoid double credit.
  safeOn(marketplace, 'CreditTraded', async (
    tradeId, listingId, buyOrderId,
    buyer, seller, tokenId,
    amount, pricePerUnit, pricePerUnitINR,
    totalPrice, buyerFee, sellerFee, totalFee,
    isAMM, event
  ) => {
    try {
      const { rows: batches } = await query(
        'SELECT id, project_id FROM carbon_batches WHERE token_id = $1', [Number(tokenId)]
      );
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
      const txHash       = event?.log?.transactionHash || null;

      const paymentMethod = isAMM ? 'amm' : 'eth';

      // ✅ FIX: Check if this trade was already settled via the INR API (trades.js)
      // INR trades call POST /api/trades/record which saves the tx_hash in trades table.
      // If found, skip wallet crediting to prevent double crediting the seller.
      if (txHash) {
        const { rows: alreadySettled } = await query(
          `SELECT id, payment_mode FROM trades WHERE tx_hash = $1 LIMIT 1`,
          [txHash]
        );

        if (alreadySettled.length > 0) {
          console.log(`⏭️  TRADE already settled via ${alreadySettled[0].payment_mode.toUpperCase()} API — skipping blockchain credit (tradeId:${tradeId} txHash:${txHash})`);
          return; // ✅ Exit early — no double crediting
        }
      }

      // ── Pure ETH trade (not pre-settled via INR API) ─────────────
      await withTransaction(async (client) => {

        // Record in registry_transactions
        // trade_id omitted — on-chain tradeId is uint256, DB trade_id is UUID
        await client.query(
          `INSERT INTO registry_transactions
           (type, token_id, batch_id, project_id, listing_id,
            from_wallet, to_wallet, from_user_id, to_user_id,
            amount, price_eth, price_inr,
            buyer_fee_eth, seller_fee_eth, total_fee_eth,
            total_price_eth, payment_mode, tx_hash)
           VALUES ('TRADE', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (tx_hash) DO NOTHING`,
          [
            Number(tokenId), batch?.id, batch?.project_id,
            Number(listingId),
            seller, buyer, sellers[0]?.id, buyers[0]?.id,
            Number(amount), priceEth, priceINR,
            buyerFeeEth, sellerFeeEth, totalFeeEth,
            totalEth,
            paymentMethod,
            txHash,
          ]
        );

        // Update batch available_credits
        if (batch?.id) {
          await client.query(
            `UPDATE carbon_batches
             SET available_credits     = GREATEST(0, available_credits - $1),
                 last_traded_price_inr = $2,
                 updated_at            = NOW()
             WHERE id = $3`,
            [Number(amount), priceINR, batch.id]
          );
        }

        // Credit seller INR wallet for pure ETH trades only
        if (sellers[0]?.id && priceINR > 0) {
          const sellerGetsINR = Math.round(priceINR * Number(amount) * 0.995);
          if (sellerGetsINR > 0) {
            await client.query(
              `UPDATE users
               SET inr_balance = inr_balance + $1,
                   updated_at  = NOW()
               WHERE id = $2`,
              [sellerGetsINR, sellers[0].id]
            );
            await client.query(
              `INSERT INTO wallet_transactions
               (user_id, type, method, amount, status, notes, trade_type)
               VALUES ($1, 'credit', 'eth', $2, 'success', $3, 'sell_credit')`,
              [
                sellers[0].id,
                sellerGetsINR,
                `Sale of ${Number(amount)} × Token #${Number(tokenId)} @ ₹${priceINR}/credit (ETH on-chain tradeId:${Number(tradeId)})`,
              ]
            );
          }
        }
      });

      console.log(`💱 TRADE settled on-chain — tradeId:${tradeId} amount:${amount} buyer:${buyer} seller:${seller} priceINR:₹${priceINR} method:${paymentMethod}`);
    } catch (e) {
      console.error('CreditTraded handler error:', e.message);
    }
  });

  // ── ListingCancelled ─────────────────────────────────────────────
  safeOn(marketplace, 'ListingCancelled', async (listingId, seller) => {
    try {
      await query(
        `INSERT INTO registry_transactions (type, listing_id, from_wallet)
         VALUES ('DELIST', $1, $2)`,
        [Number(listingId), seller]
      );
      await query(
        `UPDATE carbon_batches
         SET listing_id_onchain = NULL,
             updated_at         = NOW()
         WHERE listing_id_onchain = $1`,
        [Number(listingId)]
      );
      console.log(`❌ DELIST — listingId:${listingId} seller:${seller}`);
    } catch (e) {
      console.error('ListingCancelled handler error:', e.message);
    }
  });

  // ── CreditRetired ─────────────────────────────────────────────────
  safeOn(token, 'CreditRetired', async (tokenId, retiredBy, amount, projectName) => {
    try {
      const { rows: batches } = await query(
        'SELECT id, project_id FROM carbon_batches WHERE token_id = $1', [Number(tokenId)]
      );
      const batch = batches[0];

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO registry_transactions
           (type, token_id, batch_id, project_id, from_wallet, amount)
           VALUES ('RETIRE', $1, $2, $3, $4, $5)`,
          [Number(tokenId), batch?.id, batch?.project_id, retiredBy, Number(amount)]
        );

        if (batch?.id) {
          await client.query(
            `UPDATE carbon_batches
             SET retired_credits   = retired_credits + $1,
                 available_credits = GREATEST(0, available_credits - $1),
                 updated_at        = NOW()
             WHERE id = $2`,
            [Number(amount), batch.id]
          );

          if (batch.project_id) {
            await client.query(
              'UPDATE projects SET retired_credits = retired_credits + $1 WHERE id = $2',
              [Number(amount), batch.project_id]
            );
          }
        }
      });

      console.log(`🔥 RETIRE — tokenId:${tokenId} amount:${amount} by:${retiredBy}`);
    } catch (e) {
      console.error('CreditRetired handler error:', e.message);
    }
  });
};

module.exports = { init };