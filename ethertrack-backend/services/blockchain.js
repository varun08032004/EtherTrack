const { ethers } = require('ethers');
const { safeQuery: query, withTransaction } = require('../db/pool');

const MARKETPLACE_ABI = [
  'event CreditTraded(uint256 indexed tradeId, uint256 indexed listingId, uint256 indexed buyOrderId, address buyer, address seller, uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 totalPrice, uint256 fee, bool isAMM)',
  'event CreditListed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 amount, uint256 pricePerUnit)',
  'event ListingCancelled(uint256 indexed listingId, address indexed seller)',
];

const TOKEN_ABI = [
  'event CreditMinted(uint256 indexed tokenId, address indexed to, uint256 amount, string projectName)',
  'event CreditRetired(uint256 indexed tokenId, address indexed by, uint256 amount)',
];

let provider, marketplace, token;

const init = () => {
  try {
    provider    = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC);
    marketplace = new ethers.Contract(process.env.MARKETPLACE_ADDRESS,          MARKETPLACE_ABI, provider);
    token       = new ethers.Contract(process.env.CARBON_CREDIT_TOKEN_ADDRESS,  TOKEN_ABI,       provider);

    // ── Silence stale filter errors (college WiFi / RPC reconnects) ──
    provider.on('error', (e) => {
      if (e?.error?.message === 'filter not found' ||
          e?.shortMessage?.includes('filter not found') ||
          e?.code === 'UNKNOWN_ERROR') return;
      console.error('Provider error:', e.message);
    });

    attachListeners();
    console.log('✅ Blockchain listeners attached');
  } catch (e) {
    console.error('Blockchain listener init failed:', e.message);
  }
};

// ── Wrap ethers event handlers to suppress filter-not-found spam ──
const safeOn = (contract, event, handler) => {
  contract.on(event, async (...args) => {
    try {
      await handler(...args);
    } catch (e) {
      if (e?.error?.message === 'filter not found' ||
          e?.shortMessage?.includes('filter not found')) return;
      console.error(`${event} handler error:`, e.message);
    }
  });
};

const attachListeners = () => {
  // ── CreditMinted ─────────────────────────────────────────────
  safeOn(token, 'CreditMinted', async (tokenId, to, amount, projectName) => {
    const { rows: batches } = await query(
      'SELECT id, project_id FROM carbon_batches WHERE token_id = $1',
      [Number(tokenId)]
    );
    const batch = batches[0];
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
    console.log(`📦 MINT recorded — tokenId:${tokenId} amount:${amount} to:${to}`);
  });

  // ── CreditListed ─────────────────────────────────────────────
  safeOn(marketplace, 'CreditListed', async (listingId, seller, tokenId, amount, pricePerUnit) => {
    const { rows: batches } = await query(
      'SELECT id, project_id FROM carbon_batches WHERE token_id = $1', [Number(tokenId)]
    );
    const batch = batches[0];
    const { rows: users } = await query(
      'SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1)', [seller]
    );
    await query(
      `INSERT INTO registry_transactions
       (type, token_id, batch_id, project_id, listing_id, from_wallet, from_user_id, amount, price_eth)
       VALUES ('LIST', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        Number(tokenId), batch?.id, batch?.project_id,
        Number(listingId), seller, users[0]?.id,
        Number(amount), parseFloat(ethers.formatEther(pricePerUnit))
      ]
    );
    console.log(`📋 LIST recorded — listingId:${listingId} tokenId:${tokenId}`);
  });

  // ── CreditTraded ─────────────────────────────────────────────
  safeOn(marketplace, 'CreditTraded', async (tradeId, listingId, buyOrderId, buyer, seller, tokenId, amount, pricePerUnit, totalPrice, fee, isAMM, event) => {
    const { rows: batches } = await query(
      'SELECT id, project_id FROM carbon_batches WHERE token_id = $1', [Number(tokenId)]
    );
    const batch = batches[0];

    const [{ rows: buyers }, { rows: sellers }] = await Promise.all([
      query('SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1)', [buyer]),
      query('SELECT id FROM users WHERE LOWER(wallet_address) = LOWER($1)', [seller]),
    ]);

    const priceEth = parseFloat(ethers.formatEther(pricePerUnit));
    const totalEth = parseFloat(ethers.formatEther(totalPrice));
    const feeEth   = parseFloat(ethers.formatEther(fee));

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO registry_transactions
         (type, token_id, batch_id, project_id, listing_id, trade_id,
          from_wallet, to_wallet, from_user_id, to_user_id,
          amount, price_eth, fee_eth, tx_hash)
         VALUES ('TRADE', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (tx_hash) DO NOTHING`,
        [
          Number(tokenId), batch?.id, batch?.project_id,
          Number(listingId), Number(tradeId),
          seller, buyer, sellers[0]?.id, buyers[0]?.id,
          Number(amount), priceEth, feeEth,
          event?.log?.transactionHash || null
        ]
      );
      if (batch) {
        await client.query(
          'UPDATE carbon_batches SET available_credits = available_credits - $1 WHERE id = $2',
          [Number(amount), batch.id]
        );
      }
    });
    console.log(`💱 TRADE recorded — tradeId:${tradeId} amount:${amount} buyer:${buyer}`);
  });

  // ── ListingCancelled ─────────────────────────────────────────
  safeOn(marketplace, 'ListingCancelled', async (listingId, seller) => {
    await query(
      `INSERT INTO registry_transactions (type, listing_id, from_wallet)
       VALUES ('DELIST', $1, $2)`,
      [Number(listingId), seller]
    );
    console.log(`❌ DELIST recorded — listingId:${listingId}`);
  });

  // ── CreditRetired ─────────────────────────────────────────────
  safeOn(token, 'CreditRetired', async (tokenId, by, amount) => {
    const { rows: batches } = await query(
      'SELECT id, project_id FROM carbon_batches WHERE token_id = $1', [Number(tokenId)]
    );
    const batch = batches[0];

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO registry_transactions
         (type, token_id, batch_id, project_id, from_wallet, amount)
         VALUES ('RETIRE', $1, $2, $3, $4, $5)`,
        [Number(tokenId), batch?.id, batch?.project_id, by, Number(amount)]
      );
      if (batch) {
        await client.query(
          `UPDATE carbon_batches
           SET retired_credits   = retired_credits + $1,
               available_credits = available_credits - $1
           WHERE id = $2`,
          [Number(amount), batch.id]
        );
        await client.query(
          'UPDATE projects SET retired_credits = retired_credits + $1 WHERE id = $2',
          [Number(amount), batch.project_id]
        );
      }
    });
    console.log(`🔥 RETIRE recorded — tokenId:${tokenId} amount:${amount} by:${by}`);
  });
};

module.exports = { init };