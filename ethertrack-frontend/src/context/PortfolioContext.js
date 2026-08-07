// context/PortfolioContext.jsx — EtherTrack
// PRODUCTION HARDENED
// ─────────────────────────────────────────────────────────────────────────────
// FIXES APPLIED:
//
// [FIX-1]  Added fetchTradeHistory — fetches user's trade history from
//          /api/trades/history and normalises it into the tradeHistory state.
//          Previously tradeHistory was ONLY populated by blockchain events,
//          meaning INR trades (no on-chain event) never appeared in history.
//
// [FIX-2]  Added refreshTradeHistory useCallback — exposed in context value
//          so CarbonCredits.jsx can call it after every buy to immediately
//          update TradingHistory.jsx.
//
// [FIX-3]  refreshTradeHistory is called on mount alongside refreshBoughtCredits
//          so history is populated on page load for returning users.
//
// [FIX-4]  loadListingsFromAPI mapper now correctly reads batchId from
//          l.batchId (UUID) separately from listingId (onchain integer).
//          The market route now returns both as separate fields.
//
// [FIX-5]  `stats` previously only summed `myCredits` (owned/minted), so
//          anything bought on the marketplace was silently excluded from
//          the Dashboard's PORTFOLIO VALUE / TOTAL CREDITS cards even
//          though PortfolioV3 (the portfolio page) counted it via
//          `allCredits = [...ownedCredits, ...normalisedBought]`. It also
//          priced everything off the raw DB `pricePerCredit` field, which
//          defaults to a flat ₹850 for any credit that's never traded
//          (see mapDbCredit), while PortfolioV3 priced via a real
//          reference-price formula. The two numbers could never match.
//          `stats` now includes myBoughtCredits AND prices every credit
//          through the same shared getMarketPrice() used by PortfolioV3,
//          so Dashboard and the Portfolio page always reconcile. `costBasis`
//          was also added — Dashboard.jsx already read `stats?.costBasis`
//          but nothing ever set it, so P&L was silently always based on 0.
//
// [FIX-6]  vintagePenalty moved to utils/creditPricing.js (single source of
//          truth, shared with getMarketPrice's depreciation step) and
//          re-exported here so existing `import { vintagePenalty } from
//          '../context/PortfolioContext'` call sites keep working.
//
// [FIX-7]  Real supply/demand pricing engine — tokenMetaMap + marketBuckets
//          are built once per render from live listings/tradeHistory/
//          buyOrders and exposed via context as `marketBuckets` so
//          PortfolioV3.jsx and DashboardCards.jsx can price/badge credits
//          off the exact same market snapshot as `stats` does here.
//          Requires trade rows to carry `rawCreatedAt` (raw ISO timestamp)
//          for recency-weighted price discovery — added to
//          normaliseTradeRow and the on-chain optimistic trade entry.
//
// [FIX-8]  getContractErrorMessage — every on-chain call used to do
//          `throw e;` on failure, re-throwing ethers.js's raw error object
//          (including the entire estimateGas/transaction/ABI payload)
//          straight up to whatever component calls showToast(e.message).
//          Now pulls out just the human-readable revert reason.
//
// [FIX-9]  [NEW] listCredit / delistCredit are now OPERATOR-EXECUTED via the
//          backend instead of the user's own MetaMask wallet. The backend
//          (using its operator wallet, same as Marketplace's signerWallet)
//          calls listCreditFor()/cancelListingFor() on-chain on the user's
//          behalf — the seller's tokens are still moved by a REAL on-chain
//          transaction, it's just signed by the backend instead of
//          requiring a MetaMask popup for every listing/delisting action.
//          Requires the seller to have granted
//          creditToken.setApprovalForAll(marketplace, true) ONCE, ever —
//          same one-time approval pattern OpenSea/Uniswap use. If that
//          approval is missing, the backend call fails with a clear error
//          rather than silently doing nothing.
//
//          retireCredit and buyCredit (ETH path) are UNCHANGED — retiring
//          stays self-service (MetaMask) until CarbonCreditToken's operator
//          migration is deployed (deliberately postponed to avoid orphaning
//          already-minted credits — see project notes), and ETH/crypto
//          buys stay MetaMask-based by design, since that's the user's own
//          funds moving and they must authorize it themselves. INR-paid
//          purchases settle separately via a Razorpay webhook calling
//          settleINRTradeOnChain() in the backend — not through this file.
//
//          REQUIRES: Marketplace v3 deployed (listCreditFor/cancelListingFor)
//          and backend routes routes/operator-trading.js mounted at
//          /api/portfolio — until then, listCredit/delistCredit will fail
//          with a clear error rather than silently doing nothing.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

import React, {
  createContext, useContext, useState, useEffect,
  useCallback, useRef, useMemo,
} from 'react';
import { ethers } from 'ethers';
import {
  vintagePenalty as vintagePenaltyFn,
  buildTokenMetaMap,
  buildMarketBuckets,
  getMarketPrice,
} from '../utils/creditPricing';
import { getCsrfToken, ensureCsrfCookie } from '../services/api';

// ── Contract addresses — validated at startup ─────────────────────
const ADDRESSES = {
  CarbonCreditToken : process.env.REACT_APP_CARBON_CREDIT_TOKEN_ADDRESS,
  Marketplace       : process.env.REACT_APP_MARKETPLACE_ADDRESS,
  EmissionRegistry  : process.env.REACT_APP_EMISSION_REGISTRY_ADDRESS,
  Treasury          : process.env.REACT_APP_TREASURY_ADDRESS,
  AMMPool           : process.env.REACT_APP_AMM_POOL_ADDRESS,
};

if (process.env.NODE_ENV === 'development') {
  ['CarbonCreditToken', 'Marketplace'].forEach(k => {
    if (!ADDRESSES[k]) console.error(`[EtherTrack] REACT_APP_${k.toUpperCase()}_ADDRESS is not set`);
  });
}

const API              = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const SEPOLIA_CHAIN_ID = '0xaa36a7';

// ── ETH rate cache — module-level singleton ───────────────────────
let _ethRateCache     = null;
let _ethRateFetchedAt = 0;
const ETH_RATE_TTL      = 5 * 60 * 1000;
const ETH_RATE_FALLBACK = 280000;

// ── ABIs ─────────────────────────────────────────────────────────
const ABI = {
  CarbonCreditToken: [
    'function mintCredit((address to,uint256 amount,string projectName,string location,uint8 standard,string projectType,string developer,uint256 vintageYear,uint256 expiryDate,string serialNumber,string metadataURI) p) returns (uint256)',
    'function retireCredit(uint256 tokenId, uint256 amount)',
    'function balanceOf(address account, uint256 id) view returns (uint256)',
    'function getCreditMetadata(uint256 tokenId) view returns (tuple(string projectName,string location,uint8 standard,string projectType,string developer,uint256 vintageYear,uint256 expiryDate,string serialNumber,string metadataURI,bool active,address registeredBy,uint256 registeredAt))',
    'function getNextTokenId() view returns (uint256)',
    'function getTotalRetired(uint256 tokenId) view returns (uint256)',
    'function setApprovalForAll(address operator, bool approved)',
    'function isApprovedForAll(address account, address operator) view returns (bool)',
    'function isExpired(uint256 tokenId) view returns (bool)',
    'event CreditMinted(uint256 indexed tokenId, address indexed to, uint256 amount, string projectName, uint8 standard, string serialNumber)',
    'event CreditRetired(uint256 indexed tokenId, address indexed retiredBy, uint256 amount, string projectName)',
  ],
  Marketplace: [
    'function listCredit(uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR, uint256 duration) returns (uint256)',
    'function cancelListing(uint256 listingId)',
    'function updateListingPrice(uint256 listingId, uint256 newPriceEth, uint256 newPriceINR)',
    'function buyCredit(uint256 listingId, uint256 amount) payable',
    'function placeBuyOrder(uint256 tokenId, uint256 amount, uint256 limitPrice, uint256 duration) payable returns (uint256)',
    'function cancelBuyOrder(uint256 orderId)',
    'function getActiveListings() view returns (tuple(uint256 listingId,address seller,uint256 tokenId,uint256 amount,uint256 amountRemaining,uint256 pricePerUnit,uint256 pricePerUnitINR,uint256 listedAt,uint256 expiresAt,bool active)[])',
    'function getOpenBuyOrders() view returns (tuple(uint256 orderId,address buyer,uint256 tokenId,uint256 amount,uint256 amountFilled,uint256 limitPrice,uint256 ethEscrowed,uint8 status,uint256 createdAt,uint256 expiresAt)[])',
    'function listings(uint256) view returns (tuple(uint256 listingId,address seller,uint256 tokenId,uint256 amount,uint256 amountRemaining,uint256 pricePerUnit,uint256 pricePerUnitINR,uint256 listedAt,uint256 expiresAt,bool active))',
    'function getSellerListings(address seller) view returns (uint256[])',
    'function getBuyerOrders(address buyer) view returns (uint256[])',
    'function calculateBuyerCost(uint256 amount, uint256 pricePerUnit) view returns (uint256 subtotal, uint256 buyerFee, uint256 totalBuyerPays)',
    'function calculateSellerReceives(uint256 amount, uint256 pricePerUnit) view returns (uint256 subtotal, uint256 sellerFee, uint256 sellerReceives)',
    'function shouldUseAMM(uint256 amount) view returns (bool)',
    'function ammThreshold() view returns (uint256)',
    'event CreditTraded(uint256 indexed tradeId,uint256 indexed listingId,uint256 indexed buyOrderId,address buyer,address seller,uint256 tokenId,uint256 amount,uint256 pricePerUnit,uint256 pricePerUnitINR,uint256 totalPrice,uint256 buyerFee,uint256 sellerFee,uint256 totalFee,bool isAMM)',
    'event CreditListed(uint256 indexed listingId,address indexed seller,uint256 indexed tokenId,uint256 amount,uint256 pricePerUnit,uint256 pricePerUnitINR)',
    'event BuyOrderPlaced(uint256 indexed orderId,address indexed buyer,uint256 indexed tokenId,uint256 amount,uint256 limitPrice,uint256 ethEscrowed)',
    'event MatchExecuted(uint256 listingId,uint256 buyOrderId,uint256 amount,uint256 price)',
    'event ListingCancelled(uint256 indexed listingId,address indexed seller)',
    'event BuyOrderCancelled(uint256 indexed orderId,address indexed buyer,uint256 ethRefunded)',
  ],
  AMMPool: [
    'function swapETHForCredits(uint256 poolId, uint256 minCredits) payable returns (uint256)',
    'function swapCreditsForETH(uint256 poolId, uint256 credits, uint256 minEth) returns (uint256)',
    'function addLiquidity(uint256 poolId, uint256 creditAmount) payable returns (uint256)',
    'function removeLiquidity(uint256 poolId, uint256 shares) returns (uint256, uint256)',
    'function getPool(uint256 poolId) view returns (tuple(uint256 tokenId,uint256 creditReserve,uint256 ethReserve,uint256 totalShares,bool active,string name))',
    'function getPrice(uint256 poolId) view returns (uint256)',
    'function totalPools() view returns (uint256)',
    'event Swapped(uint256 indexed poolId,address indexed trader,bool creditIn,uint256 amountIn,uint256 amountOut,uint256 fee)',
  ],
};

// ── Public exports ────────────────────────────────────────────────
export const STANDARD_ENUM      = { VCS: 0, GS: 1, CDM: 2, ACR: 3 };
export const STANDARD_FROM_ENUM = { 0: 'VCS', 1: 'GS', 2: 'CDM', 3: 'ACR' };

export const vintagePenalty = vintagePenaltyFn;

const safeNum = (val, fallback = 0) => {
  const n = Number(val);
  return isNaN(n) || !isFinite(n) ? fallback : n;
};

const getContractErrorMessage = (e) => {
  if (e?.reason)                              return e.reason;
  if (e?.revert?.args?.[0])                   return e.revert.args[0];
  if (e?.shortMessage && !/^could not/i.test(e.shortMessage)) return e.shortMessage;
  if (e?.info?.error?.message)                return e.info.error.message.replace(/^execution reverted:\s*/i, '');
  if (e?.error?.message)                      return e.error.message.replace(/^execution reverted:\s*/i, '');
  if (e?.code === 'INSUFFICIENT_FUNDS')        return 'Insufficient ETH balance to cover this transaction and gas.';
  if (e?.code === 'CALL_EXCEPTION')            return 'Transaction would fail — the contract rejected this action.';
  if (e?.code === 'NETWORK_ERROR')             return 'Network connection issue. Please check your connection and try again.';
  if (e?.code === 'TIMEOUT')                   return 'The transaction timed out. Please try again.';
  return 'Transaction failed. Please try again.';
};

const toTokenHex = (id) =>
  id != null ? `0x${Number(id).toString(16).padStart(8, '0').toUpperCase()}` : null;

const authFetch = async (path, opts = {}) => {
  const token = localStorage.getItem('et_access');
  const isFormData = opts.body instanceof FormData;
  const method = (opts.method || 'GET').toUpperCase();
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  // [FIX-CSRF-AUTHFETCH] authFetch predates the backend's CSRF middleware —
  // it never attached X-CSRF-Token, so every write through it (list-credit,
  // delist-credit, list-credit-ledger, delist-credit-ledger,
  // retire-credit-ledger, confirm-listing, confirm-delisting — the entire
  // wallet-free listing/delisting/retiring flow) was silently failing CSRF
  // validation on the backend. Reuses the SAME cached token as apiFetch in
  // services/api.js rather than fetching its own, so both stay in sync.
  if (isWrite) {
    await ensureCsrfCookie();
    const csrf = getCsrfToken();
    if (!csrf) {
      throw Object.assign(
        new Error('Could not obtain CSRF token. Refresh the page and try again.'),
        { status: 403 }
      );
    }
  }

  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(isWrite ? { 'X-CSRF-Token': getCsrfToken() } : {}),
    ...(opts.headers || {}),
  };

  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    ...opts,
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem('et_access');
    throw Object.assign(new Error('Session expired. Please log in again.'), { status: 401 });
  }

  if (!res.ok) {
    let detail = '';
    try { const body = await res.json(); detail = body.error || body.message || ''; } catch {}
    throw Object.assign(new Error(detail || `Request failed: ${res.status}`), { status: res.status });
  }

  return res.json();
};

const publicFetch = async (path) => {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

const fetchETHRate = async () => {
  const now = Date.now();
  if (_ethRateCache && now - _ethRateFetchedAt < ETH_RATE_TTL) return _ethRateCache;

  try {
    const d = await authFetch('/api/trades/eth-rate');
    if (d?.rate && typeof d.rate === 'number' && d.rate > 0) {
      _ethRateCache = d.rate;
      _ethRateFetchedAt = now;
      return _ethRateCache;
    }
  } catch {}

  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr',
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await r.json();
    if (data?.ethereum?.inr && typeof data.ethereum.inr === 'number') {
      _ethRateCache = data.ethereum.inr;
      _ethRateFetchedAt = now;
      return _ethRateCache;
    }
  } catch {}

  if (_ethRateCache) return _ethRateCache;
  console.warn(`[EtherTrack] ETH rate unavailable — using fallback ₹${ETH_RATE_FALLBACK}`);
  return ETH_RATE_FALLBACK;
};

const fetchDBKycStatus = async () => {
  try {
    const d = await authFetch('/api/auth/me');
    return !!(d.kyc_verified || d.kyc_status === 'verified');
  } catch { return false; }
};

const fetchDBCredits = async () => {
  try {
    const d = await authFetch('/api/portfolio/my-credits');
    return Array.isArray(d.credits) ? d.credits : [];
  } catch { return []; }
};

const fetchMyRetirements = async () => {
  try {
    const d = await authFetch('/api/transactions/retirements');
    return Array.isArray(d.retirements) ? d.retirements : [];
  } catch { return []; }
};

const fetchMyPurchases = async () => {
  try {
    const d = await authFetch('/api/portfolio/my-bought-credits');
    return Array.isArray(d.bought) ? d.bought : [];
  } catch {
    try {
      const d = await authFetch('/api/transactions/my-trades?type=buy');
      return Array.isArray(d.trades) ? d.trades : [];
    } catch { return []; }
  }
};

const fetchBoundWallet = async () => {
  try {
    const d = await authFetch('/api/wallet/status');
    const w = d.walletAddress || d.wallet_address || null;
    return w ? w.toLowerCase() : null;
  } catch { return null; }
};

const fetchListingsFromAPI = async () => {
  try {
    const d = await publicFetch('/api/market/listings');
    return Array.isArray(d.listings) ? d.listings : [];
  } catch { return []; }
};

const fetchTradeHistoryFromDB = async () => {
  try {
    const d = await authFetch('/api/trades/history');
    return Array.isArray(d?.trades) ? d.trades : [];
  } catch { return []; }
};

// [FIX-LEDGER] Wallet-free users' holdings — pooled custody, tracked via
// CreditLedger.sol + credit_ledger_balances instead of on-chain balanceOf().
const fetchLedgerCredits = async () => {
  try {
    const d = await authFetch('/api/portfolio/my-ledger-credits');
    return Array.isArray(d?.credits) ? d.credits : [];
  } catch { return []; }
};

const listCreditLedgerViaBackend = async (tokenId, batchId, amount, priceInINR, durationDays) => {
  return authFetch('/api/portfolio/list-credit-ledger', {
    method: 'POST',
    body: JSON.stringify({ tokenId, batchId, amount, priceInINR, durationDays }),
  });
};

const delistCreditLedgerViaBackend = async (listingId) => {
  return authFetch('/api/portfolio/delist-credit-ledger', {
    method: 'POST',
    body: JSON.stringify({ listingId }),
  });
};

const retireCreditLedgerViaBackend = async (tokenId, amount) => {
  return authFetch('/api/portfolio/retire-credit-ledger', {
    method: 'POST',
    body: JSON.stringify({ tokenId, amount }),
  });
};

// [FIX-9] Backend calls for operator-executed listing/delisting — no
// MetaMask signature required. See CHANGELOG note at top of file.
const listCreditViaBackend = async (tokenId, amount, priceInEth, priceInINR, durationDays) => {
  return authFetch('/api/portfolio/list-credit', {
    method: 'POST',
    body: JSON.stringify({ tokenId, amount, priceInEth, priceInINR, durationDays }),
  });
};

const delistCreditViaBackend = async (listingIdOnchain) => {
  return authFetch('/api/portfolio/delist-credit', {
    method: 'POST',
    body: JSON.stringify({ listingIdOnchain }),
  });
};

const normaliseTradeRow = (t) => ({
  id          : `TXN-${t.id}`,
  type        : t.seller_id && t.buyer_id && t.seller_id === t.buyer_id
                  ? 'Buy'
                  : t.buyer_id ? 'Buy' : 'Sell',
  tradeId     : t.id,
  tokenId     : t.token_id ?? null,
  amount      : safeNum(t.quantity, 0),
  projectName : t.project_name || '—',
  priceINR    : parseFloat(t.price_per_credit_inr || 0),
  totalINR    : parseFloat(t.buyer_pays_inr || 0),
  totalEth    : parseFloat(t.total_eth || 0),
  txHash      : t.tx_hash || null,
  time        : t.created_at
                  ? new Date(t.created_at).toLocaleString('en-IN', {
                      day: '2-digit', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })
                  : '—',
  rawCreatedAt: t.created_at || null,
  status      : t.status === 'completed' ? 'Confirmed' : (t.status || 'Confirmed'),
  paymentMode : t.payment_mode || 'inr',
  isAMM       : false,
  priceINR         : parseFloat(t.price_per_credit_inr || 0),
  price_per_credit_inr : parseFloat(t.price_per_credit_inr || 0),
  buyer_pays_inr   : parseFloat(t.buyer_pays_inr || 0),
});

const mapDbCredit = (db, addr = '') => ({
  id             : `db-${db.id}`,
  tokenId        : db.token_id ?? null,
  tokenHex       : toTokenHex(db.token_id),
  projectId      : db.project_id || db.project_code || '',
  projectName    : db.project_name || '',
  location       : db.project_location || '',
  country        : db.country || '',
  standard       : db.standard || 'VCS',
  projectType    : db.project_type || '',
  developer      : db.developer || '',
  vintageYear    : safeNum(db.vintage_year, 0),
  expiryDate     : db.expiry_date || '',
  serialNumber   : db.registry_serial || '',
  credits        : safeNum(db.available_credits ?? db.quantity, 0),
  heldCredits    : safeNum(db.available_credits ?? db.quantity, 0),
  listedCredits  : 0,
  totalRetired   : safeNum(db.retired_credits, 0),
  active         : true,
  ownerWallet    : addr.toLowerCase(),
  status         : db.status === 'exhausted' ? 'RETIRED' : 'HELD',
  pricePerCredit : safeNum(db.price_per_credit_inr || db.last_traded_price_inr, 850),
  pricePerCreditEth : 0,
  listingId      : null,
  vintageDiscount : vintagePenalty(safeNum(db.vintage_year, 0)),
  admin_status   : db.admin_status || 'approved',
  isOnChain      : db.token_id != null,
  creditType              : db.credit_type || 'voluntary',
  cbamEligible            : db.cbam_eligible || false,
  sdg_tags                : Array.isArray(db.sdg_tags) ? db.sdg_tags
    : (() => { try { return JSON.parse(db.sdg_tags || '[]'); } catch { return []; } })(),
  correspondingAdjustment : db.corresponding_adjustment || 'none',
  acvaStatus              : db.acva_status || 'pending',
  icvcm_ccp_eligible      : db.icvcm_ccp_eligible || false,
  icvcm_ccp_label         : db.icvcm_ccp_label || '',
  methodologyId           : db.methodology_id || '',
  registryLink            : db.registry_link || '',
  coBenefitsVerified      : db.co_benefits_verified || false,
});

const PortfolioContext = createContext(null);

export function PortfolioProvider({ children }) {
  const [provider,           setProvider]           = useState(null);
  const [signer,             setSigner]             = useState(null);
  const [walletAddress,      setWalletAddress]      = useState('');
  const [contracts,          setContracts]          = useState(null);
  const [isKYCVerified,      setIsKYCVerified]      = useState(false);
  const [chainOk,            setChainOk]            = useState(false);
  const [walletMismatch,     setWalletMismatch]     = useState(false);
  const [walletMismatchInfo, setWalletMismatchInfo] = useState(null);
  const [myCredits,          setMyCredits]          = useState([]);
  const [myBoughtCredits,    setMyBoughtCredits]    = useState([]);
  const [myLedgerCredits,    setMyLedgerCredits]    = useState([]);
  const [myRetirements,      setMyRetirements]      = useState([]);
  const [listings,           setListings]           = useState([]);
  const [buyOrders,          setBuyOrders]          = useState([]);
  const [tradeHistory,       setTradeHistory]       = useState([]);
  const [ammPools,           setAmmPools]           = useState([]);
  const [loading,            setLoading]            = useState({
    credits: false, listings: false, buyOrders: false, tx: false, trades: false,
  });
  const [error, setError] = useState('');
  const [ethINRRate, setEthINRRate] = useState(null);

  const retirementLockRef   = useRef(new Set());
  const listenersRef        = useRef([]);
  const mountedRef          = useRef(true);
  const loadCreditsAbortRef = useRef(null);
  const chainListingsLoadedRef = useRef(false);
  const listingsPollRef        = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const safeSet = useCallback((setter) => (...args) => {
    if (mountedRef.current) setter(...args);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const update = async () => {
      const rate = await fetchETHRate();
      if (!cancelled && mountedRef.current) setEthINRRate(rate);
    };
    update();
    const id = setInterval(update, ETH_RATE_TTL);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const buildContracts = useCallback((_signer) => ({
    token  : new ethers.Contract(ADDRESSES.CarbonCreditToken, ABI.CarbonCreditToken, _signer),
    market : new ethers.Contract(ADDRESSES.Marketplace, ABI.Marketplace, _signer),
    amm    : ADDRESSES.AMMPool
      ? new ethers.Contract(ADDRESSES.AMMPool, ABI.AMMPool, _signer)
      : null,
  }), []);

  const cleanupListeners = useCallback(() => {
    listenersRef.current.forEach(({ contract, event, handler }) => {
      try { contract.off(event, handler); } catch {}
    });
    listenersRef.current = [];
  }, []);

  const loadListingsFromAPI = useCallback(async () => {
    if (!mountedRef.current) return;
    safeSet(setLoading)(l => ({ ...l, listings: true }));
    try {
      const apiListings = await fetchListingsFromAPI();
      if (!apiListings.length || !mountedRef.current) return;

      const rate    = _ethRateCache || ETH_RATE_FALLBACK;
      const nowSec  = Math.floor(Date.now() / 1000);
      const mapped  = apiListings
        .map(l => {
          const dep         = vintagePenalty(safeNum(l.vintageYear || l.vintage_year, 0));
          const priceINR    = safeNum(l.pricePerUnitINR || l.price_per_credit_inr, 850);
          const priceEth    = safeNum(l.pricePerUnit || l.price_per_credit_eth, priceINR / rate);
          const adjPriceINR = Math.round(priceINR * (1 - dep / 100));
          const expiresAt   = safeNum(l.expiresAt || l.expires_at, nowSec + 86400 * 30);

          return {
            batchId         : l.batchId || null,
            listingId       : safeNum(l.listingId ?? l.listingIdOnchain ?? l.listing_id_onchain, 0),
            listingIdOnchain: safeNum(l.listingIdOnchain ?? l.listingId ?? l.listing_id_onchain, 0),
            seller          : (l.seller || '').toLowerCase(),
            tokenId         : safeNum(l.tokenId ?? l.token_id, null) || null,
            amount          : safeNum(l.amount ?? l.available_credits, 0),
            pricePerUnit    : +priceEth.toFixed(8),
            pricePerUnitINR : +priceINR,
            adjPrice        : +(priceEth * (1 - dep / 100)).toFixed(8),
            adjPriceINR     : +adjPriceINR,
            adjPriceInr     : +adjPriceINR,
            projectName     : l.projectName || l.project_name || '',
            location        : l.location || l.project_location || '',
            country         : (l.location || l.project_location || '').split(',').pop().trim(),
            standard        : l.standard || 'VCS',
            projectType     : l.projectType || l.project_type || '',
            developer       : l.developer || '',
            vintageYear     : safeNum(l.vintageYear || l.vintage_year, 0),
            serialNumber    : l.serialNumber || l.registry_serial || '',
            vintageDiscount : dep,
            active          : true,
            expiresAt,
            listedAt        : safeNum(l.listedAt || l.listed_at, nowSec),
            totalRetired    : safeNum(l.totalRetired || l.total_retired, 0),
            lastTradedPriceINR : safeNum(l.lastTradedPriceINR || l.last_traded_price_inr, 0),
          };
        })
        .filter(l => l.expiresAt > nowSec && l.amount > 0);

      if (!chainListingsLoadedRef.current) {
        safeSet(setListings)(mapped);
      }
    } catch (e) {
      console.warn('[EtherTrack] API listings load failed:', e.message);
    } finally {
      safeSet(setLoading)(l => ({ ...l, listings: false }));
    }
  }, [safeSet]);

  const refreshTradeHistory = useCallback(async () => {
    if (!mountedRef.current) return;
    safeSet(setLoading)(l => ({ ...l, trades: true }));
    try {
      const raw = await fetchTradeHistoryFromDB();
      if (!mountedRef.current) return;
      safeSet(setTradeHistory)(raw.map(normaliseTradeRow));
    } catch (e) {
      console.error('[refreshTradeHistory]', e.message);
    } finally {
      safeSet(setLoading)(l => ({ ...l, trades: false }));
    }
  }, [safeSet]);

  const refreshBoughtCredits = useCallback(async () => {
    if (!mountedRef.current) return [];
    try {
      const raw  = await fetchMyPurchases();
      const rate = _ethRateCache || ETH_RATE_FALLBACK;

      const normalised = raw.map(b => ({
        id             : b.id || `bought-${b.trade_id || Math.random()}`,
        tradeId        : b.trade_id || b.tradeId,
        tokenId        : b.token_id ?? b.tokenId ?? null,
        tokenHex       : toTokenHex(b.token_id ?? b.tokenId),
        projectName    : b.project_name    || b.projectName    || '—',
        projectType    : b.project_type    || b.projectType    || 'Renewable Energy',
        standard       : b.standard        || 'VCS',
        location       : b.project_location|| b.location       || '—',
        country        : b.country         || (b.project_location || '').split(',').pop().trim() || '—',
        vintageYear    : safeNum(b.vintage_year || b.vintageYear, new Date().getFullYear() - 1),
        serialNumber   : b.registry_serial || b.serialNumber   || b.serial || '—',
        developer      : b.developer       || '—',
        quantity       : safeNum(b.quantity || b.credits, 0),
        credits        : safeNum(b.quantity || b.credits, 0),
        heldCredits    : safeNum(b.quantity || b.credits, 0),
        listedCredits  : 0,
        pricePerCredit : safeNum(b.price_per_credit_inr || b.pricePerCredit || b.pricePerUnitINR, 850),
        totalPaid      : safeNum(
          b.buyer_pays_inr || b.totalPaid || b.total_paid_inr,
          safeNum(b.quantity, 0) * safeNum(b.price_per_credit_inr, 850)
        ),
        paymentMode    : b.payment_mode || b.paymentMode || 'eth',
        sellerWallet   : (b.seller_wallet || b.sellerWallet || '').toLowerCase(),
        txHash         : b.tx_hash || b.txHash || null,
        boughtAt       : b.bought_at || b.boughtAt || b.created_at || new Date().toISOString(),
        batchId        : b.batch_id || b.batchId || null,
        creditType              : b.credit_type || b.creditType || 'voluntary',
        cbamEligible            : b.cbam_eligible || b.cbamEligible || false,
        sdgTags                 : Array.isArray(b.sdg_tags) ? b.sdg_tags
          : (() => { try { return JSON.parse(b.sdg_tags || '[]'); } catch { return []; } })(),
        correspondingAdjustment : b.corresponding_adjustment || b.correspondingAdjustment || 'none',
        icvcm_ccp_eligible      : b.icvcm_ccp_eligible || false,
        icvcm_ccp_label         : b.icvcm_ccp_label || '',
        registryLink            : b.registry_link || b.registryLink || '',
        methodologyId           : b.methodology_id || b.methodologyId || '',
        expiryDate              : b.expiry_date || b.expiryDate || '',
        status         : 'BOUGHT',
        isBought       : true,
        isOnChain      : true,
        admin_status   : 'approved',
        listingId      : b.listing_id || b.listingId || null,
        vintageDiscount: 0,
      }));

      safeSet(setMyBoughtCredits)(normalised);
      return normalised;
    } catch (e) {
      console.error('[refreshBoughtCredits]', e);
      return [];
    }
  }, [safeSet]);

  const refreshLedgerCredits = useCallback(async () => {
    if (!mountedRef.current) return [];
    try {
      const raw = await fetchLedgerCredits();
      safeSet(setMyLedgerCredits)(raw);
      return raw;
    } catch (e) {
      console.error('[refreshLedgerCredits]', e);
      return [];
    }
  }, [safeSet]);

  const initInProgress = useRef(false);

  const init = useCallback(async () => {
    if (initInProgress.current) return;
    initInProgress.current = true;

    try {
      if (!window.ethereum) {
        const [dbCredits, retirements] = await Promise.all([
          fetchDBCredits(),
          fetchMyRetirements(),
        ]);
        safeSet(setMyCredits)(dbCredits.map(db => mapDbCredit(db)));
        safeSet(setMyRetirements)(retirements);
        await refreshBoughtCredits();
        return;
      }

      const accounts = await window.ethereum.request({ method: 'eth_accounts' });

      if (!accounts.length) {
        safeSet(setWalletAddress)('');
        safeSet(setContracts)(null);
        safeSet(setChainOk)(false);
        safeSet(setWalletMismatch)(false);
        safeSet(setWalletMismatchInfo)(null);
        const [dbCredits, retirements] = await Promise.all([
          fetchDBCredits(),
          fetchMyRetirements(),
        ]);
        safeSet(setMyCredits)(prev => prev.length ? prev : dbCredits.map(db => mapDbCredit(db)));
        safeSet(setMyRetirements)(retirements);
        return;
      }

      const metamaskWallet = accounts[0].toLowerCase();
      const boundWallet    = await fetchBoundWallet();

      if (boundWallet && boundWallet !== metamaskWallet) {
        console.warn('[EtherTrack] Wallet mismatch — blocking init');
        safeSet(setWalletMismatch)(true);
        safeSet(setWalletMismatchInfo)({ metamaskWallet, boundWallet });
        safeSet(setWalletAddress)('');
        safeSet(setContracts)(null);
        safeSet(setChainOk)(false);
        safeSet(setMyCredits)([]);
        safeSet(setError)(
          `Wrong wallet connected. This account is bound to ${boundWallet.slice(0,6)}…${boundWallet.slice(-4)}`
        );
        return;
      }

      if (!boundWallet) {
        try {
          await authFetch('/api/wallet/bind', {
            method : 'POST',
            body   : JSON.stringify({ walletAddress: metamaskWallet }),
          });
        } catch (e) {
          console.warn('[EtherTrack] Auto-bind failed (non-fatal):', e.message);
        }
      }

      safeSet(setWalletMismatch)(false);
      safeSet(setWalletMismatchInfo)(null);
      safeSet(setError)('');

      const chainId = await window.ethereum.request({ method: 'eth_chainId' });
      const isCorrectChain = chainId === SEPOLIA_CHAIN_ID;
      safeSet(setChainOk)(isCorrectChain);

      if (!isCorrectChain) {
        try {
          await window.ethereum.request({
            method : 'wallet_switchEthereumChain',
            params : [{ chainId: SEPOLIA_CHAIN_ID }],
          });
          return;
        } catch (switchErr) {
          console.error('[EtherTrack] Cannot switch to Sepolia:', switchErr);
          safeSet(setContracts)(null);
          safeSet(setError)('Please switch MetaMask to the Sepolia testnet.');
          const dbCredits = await fetchDBCredits();
          safeSet(setMyCredits)(dbCredits.map(db => mapDbCredit(db, metamaskWallet)));
          return;
        }
      }

      const _provider = new ethers.BrowserProvider(window.ethereum);
      const _signer   = await _provider.getSigner();
      const _address  = (await _signer.getAddress()).toLowerCase();

      safeSet(setProvider)(_provider);
      safeSet(setSigner)(_signer);
      safeSet(setWalletAddress)(_address);

      const c = buildContracts(_signer);
      safeSet(setContracts)(c);

      const [verified] = await Promise.all([fetchDBKycStatus()]);
      safeSet(setIsKYCVerified)(verified);

      cleanupListeners();
      setupListeners(c, _address);

      await Promise.allSettled([
        loadListings(c),
        loadBuyOrders(c),
        loadMyCreditsInternal(c, _address),
        refreshBoughtCredits(),
        c.amm ? loadAMMPools(c) : Promise.resolve(),
      ]);
    } catch (e) {
      console.error('[EtherTrack] Wallet init error:', e);
    } finally {
      initInProgress.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildContracts, cleanupListeners, refreshBoughtCredits, safeSet]);

  const setupListeners = useCallback((c, address) => {
    const addr = address.toLowerCase();

    const onTraded = (...args) => {
      const [tradeId, listingId, buyOrderId, buyer, seller, tokenId,
             amount, pricePerUnit, pricePerUnitINR, totalPrice,
             buyerFee, sellerFee, totalFee, isAMM] = args;

      const isBuyer  = buyer?.toLowerCase()  === addr;
      const isSeller = seller?.toLowerCase() === addr;

      if (isBuyer || isSeller) {
        setTimeout(() => {
          loadMyCreditsInternal(null, address);
          loadListings();
          loadBuyOrders();
          if (isBuyer) {
            refreshBoughtCredits();
            refreshTradeHistory();
          }
        }, 2500);

        safeSet(setTradeHistory)(prev => [{
          id           : `TXN-${Date.now()}`,
          type         : isBuyer ? 'Buy' : 'Sell',
          tradeId      : Number(tradeId),
          listingId    : Number(listingId),
          tokenId      : Number(tokenId),
          amount       : Number(amount),
          totalEth     : ethers.formatEther(totalPrice),
          priceINR     : Number(pricePerUnitINR),
          totalINR     : 0,
          buyerFeeINR  : Number(buyerFee),
          sellerFeeINR : Number(sellerFee),
          time         : new Date().toLocaleString('en-IN'),
          rawCreatedAt : new Date().toISOString(),
          status       : 'Confirmed',
          isAMM,
        }, ...prev.slice(0, 49)]);
      } else {
        setTimeout(() => { loadListings(); loadBuyOrders(); }, 2000);
      }
    };

    const onMatch  = () => setTimeout(() => { loadListings(); loadBuyOrders(); }, 1500);
    const onListed = () => setTimeout(() => { loadListings(); loadListingsFromAPI(); }, 1500);
    const onBid    = () => setTimeout(() => loadBuyOrders(), 1500);
    const onUnlist = () => setTimeout(() => { loadListings(); loadListingsFromAPI(); }, 1500);
    const onUnbid  = () => setTimeout(() => loadBuyOrders(), 1500);

    c.market.on('CreditTraded',      onTraded);
    c.market.on('MatchExecuted',     onMatch);
    c.market.on('CreditListed',      onListed);
    c.market.on('BuyOrderPlaced',    onBid);
    c.market.on('ListingCancelled',  onUnlist);
    c.market.on('BuyOrderCancelled', onUnbid);

    listenersRef.current = [
      { contract: c.market, event: 'CreditTraded',      handler: onTraded  },
      { contract: c.market, event: 'MatchExecuted',     handler: onMatch   },
      { contract: c.market, event: 'CreditListed',      handler: onListed  },
      { contract: c.market, event: 'BuyOrderPlaced',    handler: onBid     },
      { contract: c.market, event: 'ListingCancelled',  handler: onUnlist  },
      { contract: c.market, event: 'BuyOrderCancelled', handler: onUnbid   },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSet, refreshBoughtCredits, refreshTradeHistory]);

  useEffect(() => {
    init();
    loadListingsFromAPI();
    refreshBoughtCredits();
    refreshTradeHistory();
    refreshLedgerCredits();
    fetchMyRetirements().then(safeSet(setMyRetirements));

    listingsPollRef.current = setInterval(() => {
      if (!chainListingsLoadedRef.current) loadListingsFromAPI();
    }, 30_000);

    if (!window.ethereum) {
      return () => { if (listingsPollRef.current) clearInterval(listingsPollRef.current); };
    }

    const handleAccountsChanged = () => { cleanupListeners(); init(); };
    const handleChainChanged    = () => { cleanupListeners(); init(); };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged',    handleChainChanged);

    return () => {
      cleanupListeners();
      if (listingsPollRef.current) clearInterval(listingsPollRef.current);
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged',    handleChainChanged);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMyCreditsInternal = useCallback(async (c, addr) => {
    const _c    = c    || contracts;
    const _addr = addr || walletAddress;

    if (walletMismatch) return;

    if (loadCreditsAbortRef.current) {
      loadCreditsAbortRef.current.abort();
    }
    const abortController = new AbortController();
    loadCreditsAbortRef.current = abortController;

    safeSet(setLoading)(l => ({ ...l, credits: true }));

    try {
      const dbCredits = await fetchDBCredits();
      if (abortController.signal.aborted) return;

      let onChainCredits = [];
      const rate = _ethRateCache || ETH_RATE_FALLBACK;

      if (_addr && _c) {
        try {
          const nextId = await _c.token.getNextTokenId();
          const total  = Number(nextId);

          if (total > 10000) {
            console.warn('[EtherTrack] Token range too large for full scan:', total);
          }

          const sellerIds      = await _c.market.getSellerListings(_addr);
          const sellerListings = await Promise.all(
            sellerIds.map(lid => _c.market.listings(lid))
          );

          const BATCH_SIZE = 20;
          for (let start = 0; start < Math.min(total, 10000); start += BATCH_SIZE) {
            if (abortController.signal.aborted) break;
            const end      = Math.min(start + BATCH_SIZE, total);
            const batchIds = Array.from({ length: end - start }, (_, i) => start + i);

            const balances = await Promise.all(
              batchIds.map(id => _c.token.balanceOf(_addr, id).catch(() => 0n))
            );

            for (let i = 0; i < batchIds.length; i++) {
              if (abortController.signal.aborted) break;
              const tokenId = batchIds[i];
              const held    = Number(balances[i]);

              let listingId = null, listingPriceETH = 0,
                  listingPriceINR = 0, listed = 0;

              for (let j = 0; j < sellerListings.length; j++) {
                const l = sellerListings[j];
                if (Number(l.tokenId) === tokenId && l.active) {
                  listingId       = Number(sellerIds[j]);
                  listingPriceETH = parseFloat(ethers.formatEther(l.pricePerUnit));
                  listingPriceINR = safeNum(l.pricePerUnitINR, Math.round(listingPriceETH * rate));
                  listed          = Number(l.amountRemaining);
                  break;
                }
              }

              const totalAmt = held + listed;
              if (totalAmt === 0) continue;

              const [meta, retired] = await Promise.all([
                _c.token.getCreditMetadata(tokenId).catch(() => null),
                _c.token.getTotalRetired(tokenId).catch(() => 0n),
              ]);

              if (!meta) continue;

              const dep      = vintagePenalty(Number(meta.vintageYear));
              const stdStr   = STANDARD_FROM_ENUM[Number(meta.standard)] || 'VCS';
              const priceInr = listingPriceINR > 0 ? listingPriceINR
                             : listingPriceETH > 0 ? Math.round(listingPriceETH * rate)
                             : 850;

              onChainCredits.push({
                id              : tokenId,
                tokenId,
                tokenHex        : toTokenHex(tokenId),
                projectId       : meta.serialNumber,
                projectName     : meta.projectName,
                location        : meta.location,
                country         : meta.location.split(',').pop().trim(),
                standard        : stdStr,
                projectType     : meta.projectType,
                developer       : meta.developer,
                vintageYear     : Number(meta.vintageYear),
                expiryDate      : new Date(Number(meta.expiryDate) * 1000).toISOString().slice(0, 10),
                serialNumber    : meta.serialNumber,
                credits         : totalAmt,
                heldCredits     : held,
                listedCredits   : listed,
                totalRetired    : Number(retired),
                active          : meta.active,
                registeredBy    : meta.registeredBy,
                registeredAt    : new Date(Number(meta.registeredAt) * 1000).toISOString().slice(0, 10),
                ownerWallet     : _addr.toLowerCase(),
                status          : !meta.active ? 'RETIRED'
                                : listed > 0 && held > 0 ? 'PARTIAL'
                                : listed > 0 ? 'LISTED' : 'HELD',
                pricePerCredit  : +priceInr,
                pricePerCreditEth : +listingPriceETH,
                listingId,
                vintageDiscount : dep,
                admin_status    : 'approved',
                isOnChain       : true,
                creditType      : 'voluntary',
                cbamEligible    : false,
                sdg_tags        : [],
                correspondingAdjustment : 'none',
                icvcm_ccp_eligible : false,
              });
            }
          }
        } catch (e) {
          if (!abortController.signal.aborted) {
            console.warn('[EtherTrack] On-chain load failed, using DB:', e.message);
          }
        }
      }

      if (abortController.signal.aborted) return;

      const onChainSerials = new Set(
        onChainCredits.map(c => c.serialNumber).filter(Boolean)
      );

      const dbOnly = dbCredits
        .filter(db => {
          const s = db.registry_serial || db.serialNumber || '';
          return !s || !onChainSerials.has(s);
        })
        .map(db => mapDbCredit(db, _addr));

      const merged = [...onChainCredits, ...dbOnly];
      safeSet(setMyCredits)(merged.length ? merged : dbCredits.map(db => mapDbCredit(db, _addr)));

      if (dbCredits.length && onChainCredits.length) {
        const dbBySerial = {};
        dbCredits.forEach(db => {
          if (db.registry_serial) dbBySerial[db.registry_serial] = db;
        });
        safeSet(setMyCredits)(prev => prev.map(c => {
          const db = dbBySerial[c.serialNumber];
          if (!db || !c.isOnChain) return c;
          return {
            ...c,
            creditType              : db.credit_type || c.creditType || 'voluntary',
            cbamEligible            : db.cbam_eligible ?? c.cbamEligible ?? false,
            sdg_tags                : db.sdg_tags || c.sdg_tags || [],
            correspondingAdjustment : db.corresponding_adjustment || c.correspondingAdjustment || 'none',
            icvcm_ccp_eligible      : db.icvcm_ccp_eligible ?? c.icvcm_ccp_eligible ?? false,
            icvcm_ccp_label         : db.icvcm_ccp_label || '',
            methodologyId           : db.methodology_id || '',
            registryLink            : db.registry_link || '',
            expiryDate              : db.expiry_date || c.expiryDate,
            developer               : db.developer || c.developer,
            projectId               : db.project_id || c.projectId,
          };
        }));
      }

      fetchMyRetirements().then(safeSet(setMyRetirements));
    } catch (e) {
      if (!abortController.signal.aborted) {
        console.error('[loadMyCredits]', e);
      }
    } finally {
      if (!abortController.signal.aborted) {
        safeSet(setLoading)(l => ({ ...l, credits: false }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, walletAddress, walletMismatch, safeSet]);

  const loadMyCredits = loadMyCreditsInternal;

  const loadListings = useCallback(async (c) => {
    const _c = c || contracts;
    if (!_c) return loadListingsFromAPI();

    safeSet(setLoading)(l => ({ ...l, listings: true }));
    try {
      const raw    = await _c.market.getActiveListings();
      const rate   = _ethRateCache || ETH_RATE_FALLBACK;
      const nowSec = Math.floor(Date.now() / 1000);

      const enriched = await Promise.allSettled(
        raw.map(async (l) => {
          const tokenId = Number(l.tokenId);
          const meta    = await _c.token.getCreditMetadata(tokenId);
          const dep         = vintagePenalty(Number(meta.vintageYear));
          const basePrice   = parseFloat(ethers.formatEther(l.pricePerUnit));
          const priceINR    = safeNum(l.pricePerUnitINR, Math.round(basePrice * rate));
          const adjPriceINR = Math.round(priceINR * (1 - dep / 100));
          const expiresAt   = Number(l.expiresAt);

          return {
            listingId        : Number(l.listingId),
            listingIdOnchain : Number(l.listingId),
            batchId          : null,
            seller           : l.seller.toLowerCase(),
            tokenId,
            amount           : Number(l.amountRemaining),
            pricePerUnit     : +basePrice,
            pricePerUnitINR  : +priceINR,
            adjPrice         : +(basePrice * (1 - dep / 100)).toFixed(8),
            adjPriceINR      : +adjPriceINR,
            adjPriceInr      : +adjPriceINR,
            listedAt         : Number(l.listedAt),
            expiresAt,
            projectName      : meta.projectName,
            location         : meta.location,
            country          : meta.location.split(',').pop().trim(),
            standard         : STANDARD_FROM_ENUM[Number(meta.standard)] || 'VCS',
            projectType      : meta.projectType,
            developer        : meta.developer,
            vintageYear      : Number(meta.vintageYear),
            serialNumber     : meta.serialNumber,
            vintageDiscount  : dep,
            active           : l.active,
          };
        })
      );

      const valid = enriched
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value)
        .filter(l => l.active && l.expiresAt > nowSec && l.amount > 0);

      safeSet(setListings)(valid);
      chainListingsLoadedRef.current = true;
    } catch (e) {
      console.error('[loadListings on-chain]', e);
      chainListingsLoadedRef.current = false;
      await loadListingsFromAPI();
    } finally {
      safeSet(setLoading)(l => ({ ...l, listings: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, loadListingsFromAPI, safeSet]);

  const loadBuyOrders = useCallback(async (c) => {
    const _c = c || contracts;
    if (!_c) return;

    safeSet(setLoading)(l => ({ ...l, buyOrders: true }));
    try {
      const raw = await _c.market.getOpenBuyOrders();
      safeSet(setBuyOrders)(raw.map(o => ({
        orderId      : Number(o.orderId),
        buyer        : o.buyer.toLowerCase(),
        tokenId      : Number(o.tokenId),
        amount       : Number(o.amount),
        amountFilled : Number(o.amountFilled),
        remaining    : Number(o.amount) - Number(o.amountFilled),
        limitPrice   : parseFloat(ethers.formatEther(o.limitPrice)),
        ethEscrowed  : parseFloat(ethers.formatEther(o.ethEscrowed)),
        status       : Number(o.status),
        createdAt    : Number(o.createdAt),
        expiresAt    : Number(o.expiresAt),
      })));
    } catch (e) {
      console.error('[loadBuyOrders]', e);
      safeSet(setBuyOrders)([]);
    } finally {
      safeSet(setLoading)(l => ({ ...l, buyOrders: false }));
    }
  }, [contracts, safeSet]);

  const loadAMMPools = useCallback(async (c) => {
    const _c = c || contracts;
    if (!_c?.amm) return;
    const rate = _ethRateCache || ETH_RATE_FALLBACK;
    try {
      const total = Number(await _c.amm.totalPools());
      const poolResults = await Promise.allSettled(
        Array.from({ length: total }, (_, i) =>
          Promise.all([_c.amm.getPool(i + 1), _c.amm.getPrice(i + 1)])
            .then(([pool, price]) => ({
              poolId        : i + 1,
              tokenId       : Number(pool.tokenId),
              name          : pool.name,
              creditReserve : Number(pool.creditReserve),
              ethReserve    : parseFloat(ethers.formatEther(pool.ethReserve)),
              totalShares   : Number(pool.totalShares),
              active        : pool.active,
              priceEth      : parseFloat(ethers.formatEther(price)),
              priceInr      : +(parseFloat(ethers.formatEther(price)) * rate),
            }))
        )
      );
      safeSet(setAmmPools)(
        poolResults.filter(r => r.status === 'fulfilled').map(r => r.value)
      );
    } catch (e) {
      console.error('[loadAMMPools]', e);
    }
  }, [contracts, safeSet]);

  const refreshKYC = useCallback(async () => {
    try {
      const v = await fetchDBKycStatus();
      safeSet(setIsKYCVerified)(v);
      return v;
    } catch { return false; }
  }, [safeSet]);

  const requireWallet = () => {
    if (!contracts)     throw new Error('Wallet not connected. Please connect MetaMask.');
    if (walletMismatch) throw new Error('Wrong wallet connected. Please switch to your registered wallet.');
    if (!chainOk)       throw new Error('Please switch MetaMask to the Sepolia testnet.');
  };

  const registerCredit = useCallback(async (formData) => {
    requireWallet();
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const params = {
        to           : walletAddress,
        amount       : parseInt(formData.credits, 10),
        projectName  : formData.projectName,
        location     : formData.location,
        standard     : STANDARD_ENUM[formData.standard] ?? 0,
        projectType  : formData.projectType,
        developer    : formData.developer,
        vintageYear  : parseInt(formData.vintageYear, 10),
        expiryDate   : Math.floor(new Date(formData.expiryDate).getTime() / 1000),
        serialNumber : formData.serialNumber,
        metadataURI  : '',
      };
      const tx      = await contracts.token.mintCredit(params);
      const receipt = await tx.wait();
      const event   = receipt.logs.find(log => {
        try { return contracts.token.interface.parseLog(log)?.name === 'CreditMinted'; }
        catch { return false; }
      });
      const tokenId = event
        ? Number(contracts.token.interface.parseLog(event).args.tokenId)
        : null;
      await loadMyCreditsInternal();
      return { success: true, tokenId, txHash: tx.hash };
    } catch (e) {
      if (e.code === 4001 || e.code === 'ACTION_REJECTED')
        throw new Error('Transaction rejected by user.');
      throw new Error(getContractErrorMessage(e));
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, walletAddress, safeSet, loadMyCreditsInternal]);

  // [FIX-9] listCredit is now OPERATOR-EXECUTED via the backend — no
  // MetaMask popup. The backend signs the real on-chain listCreditFor()
  // transaction using its operator wallet; the seller's tokens still move
  // via a genuine on-chain escrow transfer, same as before. Requires the
  // seller to have granted setApprovalForAll(marketplace, true) ONCE ever —
  // if that's missing, the backend returns a clear error telling the user
  // to do the one-time approval, rather than failing silently.
  //
  // Only requires a connected wallet to know WHO is listing — no direct
  // contract call happens here anymore, so `contracts`/`chainOk` are not
  // required.
  // [FIX-SELLER-APPROVAL] listCredit is now backend-executed (no MetaMask),
  // but that only works if the seller has already granted the Marketplace
  // one-time setApprovalForAll — which the backend cannot do on the
  // seller's behalf (that would defeat the entire point of requiring their
  // own signature for this one specific action). These two functions let
  // the UI check that status and prompt for it exactly once per wallet.
  const isSellerApproved = useCallback(async () => {
    if (!contracts || !walletAddress) return null; // unknown — needs wallet connected to check
    try {
      return await contracts.token.isApprovedForAll(walletAddress, ADDRESSES.Marketplace);
    } catch (e) {
      console.warn('[isSellerApproved] check failed:', e.message);
      return null;
    }
  }, [contracts, walletAddress]);

  const approveMarketplace = useCallback(async () => {
    requireWallet();
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const tx = await contracts.token.setApprovalForAll(ADDRESSES.Marketplace, true);
      const receipt = await tx.wait();
      return { success: true, txHash: tx.hash, blockNumber: receipt.blockNumber };
    } catch (e) {
      if (e.code === 4001 || e.code === 'ACTION_REJECTED') throw new Error('Approval rejected — you\'ll need to approve once before listing credits.');
      throw new Error(getContractErrorMessage(e));
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, walletAddress, safeSet]);

  const listCredit = useCallback(async (tokenId, amount, priceInEth, priceInINR, durationDays = 30) => {
    if (!walletAddress) throw new Error('Wallet not connected. Please connect your wallet.');
    if (!tokenId && tokenId !== 0) throw new Error('Invalid token ID.');
    if (amount <= 0)               throw new Error('Amount must be greater than zero.');
    if (parseFloat(priceInEth) <= 0) throw new Error('Price must be greater than zero.');

    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const result = await listCreditViaBackend(tokenId, amount, priceInEth, priceInINR, durationDays);
      await Promise.allSettled([loadMyCreditsInternal(), loadListings(), loadListingsFromAPI()]);
      return { success: true, txHash: result.txHash, listingId: result.listingId };
    } catch (e) {
      throw new Error(e.message || 'Listing failed. Please try again.');
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, safeSet, loadMyCreditsInternal, loadListings, loadListingsFromAPI]);

  // [FIX-9] delistCredit is now OPERATOR-EXECUTED via the backend — no
  // MetaMask popup, zero approval needed (Marketplace already holds the
  // escrowed tokens itself from listing time).
  const delistCredit = useCallback(async (listingIdOnchain) => {
    if (!walletAddress) throw new Error('Wallet not connected. Please connect your wallet.');
    if (listingIdOnchain == null) throw new Error('Invalid listing ID.');

    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const result = await delistCreditViaBackend(listingIdOnchain);
      await Promise.allSettled([loadMyCreditsInternal(), loadListings(), loadListingsFromAPI()]);
      return { success: true, txHash: result.txHash };
    } catch (e) {
      throw new Error(e.message || 'Delisting failed. Please try again.');
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, safeSet, loadMyCreditsInternal, loadListings, loadListingsFromAPI]);

  // [FIX-LEDGER] Wallet-free equivalents of listCredit/delistCredit/retireCredit
  // — no wallet, no MetaMask, ever. Backend calls CreditLedger.sol directly.
  const listCreditLedger = useCallback(async (tokenId, batchId, amount, priceInINR, durationDays = 30) => {
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const result = await listCreditLedgerViaBackend(tokenId, batchId, amount, priceInINR, durationDays);
      await refreshLedgerCredits();
      return { success: true, listingId: result.listingId };
    } catch (e) {
      throw new Error(e.message || 'Listing failed. Please try again.');
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  }, [safeSet, refreshLedgerCredits]);

  const delistCreditLedger = useCallback(async (listingId) => {
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      await delistCreditLedgerViaBackend(listingId);
      await refreshLedgerCredits();
      return { success: true };
    } catch (e) {
      throw new Error(e.message || 'Delisting failed. Please try again.');
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  }, [safeSet, refreshLedgerCredits]);

  const retireCreditLedger = useCallback(async (tokenId, amount) => {
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const result = await retireCreditLedgerViaBackend(tokenId, amount);
      await refreshLedgerCredits();
      return { success: true, txHash: result.txHash, blockNumber: result.blockNumber };
    } catch (e) {
      throw new Error(e.message || 'Retirement failed. Please try again.');
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  }, [safeSet, refreshLedgerCredits]);

  // retireCredit — UNCHANGED, still self-service via MetaMask. Operator-
  // executed retirement (retireCreditFor) requires a CarbonCreditToken
  // migration that's deliberately on hold to avoid orphaning already-minted
  // credits. Revisit once that migration ships — should follow the same
  // backend-call pattern as listCredit/delistCredit above.
  const retireCredit = useCallback(async (tokenId, amount) => {
    requireWallet();
    if (tokenId == null) throw new Error('Invalid token ID.');
    if (amount <= 0)     throw new Error('Amount must be greater than zero.');

    const lockKey = `${walletAddress}-${tokenId}`;
    if (retirementLockRef.current.has(lockKey))
      throw new Error('A retirement is already in progress for this credit. Please wait.');

    retirementLockRef.current.add(lockKey);
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const tx      = await contracts.token.retireCredit(tokenId, amount);
      const receipt = await tx.wait();
      await loadMyCreditsInternal();
      return { success: true, txHash: tx.hash, blockNumber: receipt.blockNumber };
    } catch (e) {
      if (e.code === 4001 || e.code === 'ACTION_REJECTED') throw new Error('Transaction rejected by user.');
      throw new Error(getContractErrorMessage(e));
    } finally {
      retirementLockRef.current.delete(lockKey);
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, walletAddress, safeSet, loadMyCreditsInternal]);

  // buyCredit — UNCHANGED, ETH/crypto path stays MetaMask-based by design.
  // INR-paid purchases settle separately via a Razorpay webhook calling
  // settleINRTradeOnChain() in the backend — not through this function.
  const buyCredit = useCallback(async (listingId, amount, totalEth) => {
    requireWallet();
    if (!listingId && listingId !== 0) throw new Error('Invalid listing ID.');
    if (amount <= 0)                   throw new Error('Amount must be greater than zero.');
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const tx = await contracts.market.buyCredit(
        listingId, amount,
        { value: ethers.parseEther(String(totalEth)) }
      );
      await tx.wait();
      await refreshBoughtCredits();
      return { success: true, txHash: tx.hash };
    } catch (e) {
      if (e.code === 4001 || e.code === 'ACTION_REJECTED') throw new Error('Transaction rejected by user.');
      throw new Error(getContractErrorMessage(e));
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, safeSet, refreshBoughtCredits]);

  const placeBuyOrder = useCallback(async (tokenId, amount, limitPriceEth, durationDays = 7) => {
    requireWallet();
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const limitWei  = ethers.parseEther(String(limitPriceEth));
      const amountBig = ethers.toBigInt(amount);
      const totalCost = limitWei * amountBig;
      const buyerFee  = totalCost * 50n / 10000n;
      const tx = await contracts.market.placeBuyOrder(
        tokenId, amount, limitWei,
        durationDays * 86400,
        { value: totalCost + buyerFee }
      );
      await tx.wait();
      await loadBuyOrders();
      return { success: true, txHash: tx.hash };
    } catch (e) {
      if (e.code === 4001 || e.code === 'ACTION_REJECTED') throw new Error('Transaction rejected by user.');
      throw new Error(getContractErrorMessage(e));
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, safeSet, loadBuyOrders]);

  const cancelBuyOrder = useCallback(async (orderId) => {
    requireWallet();
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const tx = await contracts.market.cancelBuyOrder(orderId);
      await tx.wait();
      await loadBuyOrders();
      return { success: true, txHash: tx.hash };
    } catch (e) {
      if (e.code === 4001 || e.code === 'ACTION_REJECTED') throw new Error('Transaction rejected by user.');
      throw new Error(getContractErrorMessage(e));
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, safeSet, loadBuyOrders]);

  const ammSwapETHForCredits = useCallback(async (poolId, ethAmount, minCredits = 0) => {
    requireWallet();
    if (!contracts.amm) throw new Error('AMM is not available.');
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const tx = await contracts.amm.swapETHForCredits(
        poolId, minCredits,
        { value: ethers.parseEther(String(ethAmount)) }
      );
      await tx.wait();
      await Promise.allSettled([loadMyCreditsInternal(), loadAMMPools(), refreshBoughtCredits()]);
      return { success: true, txHash: tx.hash };
    } catch (e) {
      if (e.code === 4001 || e.code === 'ACTION_REJECTED') throw new Error('Transaction rejected by user.');
      throw new Error(getContractErrorMessage(e));
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, safeSet, loadMyCreditsInternal, loadAMMPools, refreshBoughtCredits]);

  const ammSwapCreditsForETH = useCallback(async (poolId, credits, minEth = 0) => {
    requireWallet();
    if (!contracts.amm) throw new Error('AMM is not available.');
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const approved = await contracts.token.isApprovedForAll(walletAddress, ADDRESSES.AMMPool);
      if (!approved) {
        const t = await contracts.token.setApprovalForAll(ADDRESSES.AMMPool, true);
        await t.wait();
      }
      const minEthWei = minEth > 0 ? ethers.parseEther(minEth.toFixed(18)) : 0n;
      const tx = await contracts.amm.swapCreditsForETH(poolId, credits, minEthWei);
      await tx.wait();
      await Promise.allSettled([loadMyCreditsInternal(), loadAMMPools()]);
      return { success: true, txHash: tx.hash };
    } catch (e) {
      if (e.code === 4001 || e.code === 'ACTION_REJECTED') throw new Error('Transaction rejected by user.');
      throw new Error(getContractErrorMessage(e));
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, walletAddress, safeSet, loadMyCreditsInternal, loadAMMPools]);

  const ammAddLiquidity = useCallback(async (poolId, creditAmount, ethAmount) => {
    requireWallet();
    if (!contracts.amm) throw new Error('AMM is not available.');
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const approved = await contracts.token.isApprovedForAll(walletAddress, ADDRESSES.AMMPool);
      if (!approved) {
        const t = await contracts.token.setApprovalForAll(ADDRESSES.AMMPool, true);
        await t.wait();
      }
      const tx = await contracts.amm.addLiquidity(
        poolId, creditAmount,
        { value: ethers.parseEther(String(ethAmount)) }
      );
      await tx.wait();
      await Promise.allSettled([loadMyCreditsInternal(), loadAMMPools()]);
      return { success: true, txHash: tx.hash };
    } catch (e) {
      if (e.code === 4001 || e.code === 'ACTION_REJECTED') throw new Error('Transaction rejected by user.');
      throw new Error(getContractErrorMessage(e));
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, walletAddress, safeSet, loadMyCreditsInternal, loadAMMPools]);

  const tokenMetaMap = useMemo(
    () => buildTokenMetaMap({ listings, myCredits, myBoughtCredits }),
    [listings, myCredits, myBoughtCredits]
  );

  const marketBuckets = useMemo(
    () => buildMarketBuckets({ listings, tradeHistory, buyOrders }, tokenMetaMap),
    [listings, tradeHistory, buyOrders, tokenMetaMap]
  );

  const stats = useMemo(() => {
    const ownedActive  = myCredits.filter(c => c.status !== 'RETIRED');
    const boughtActive = myBoughtCredits;
    const allActive    = [...ownedActive, ...boughtActive];

    const totalCredits = allActive.reduce(
      (s, c) => s + safeNum(c.heldCredits ?? c.credits, 0), 0
    );

    const totalValue = allActive.reduce((s, c) => {
      const { price } = getMarketPrice(
        c.projectType, c.standard, c.vintageYear, c.creditType, marketBuckets
      );
      return s + safeNum(c.heldCredits ?? c.credits, 0) * price;
    }, 0);

    const costBasis = myBoughtCredits.reduce(
      (s, c) => s + safeNum(c.pricePerCredit, 0) * safeNum(c.heldCredits ?? c.credits, 0),
      0
    );

    return {
      totalCredits,
      totalValue,
      costBasis,
      listedCount  : myCredits
        .filter(c => c.status === 'LISTED')
        .reduce((s, c) => s + safeNum(c.listedCredits, 0), 0),
      retiredCount : myRetirements.reduce((s, r) => s + safeNum(r.amount, 0), 0),
      heldCount    : myCredits.filter(c => c.status === 'HELD').length,
      openBids     : buyOrders.filter(o => o.status === 0 || o.status === 2).length,
    };
  }, [myCredits, myBoughtCredits, myRetirements, buyOrders, marketBuckets]);

  const resolvedRate = ethINRRate || ETH_RATE_FALLBACK;

  return (
    <PortfolioContext.Provider value={{
      provider, signer, walletAddress, contracts, chainOk,
      walletMismatch, walletMismatchInfo, error,
      isKYCVerified, refreshKYC,
      myCredits, myBoughtCredits, myLedgerCredits, myRetirements,
      listings, buyOrders, tradeHistory, ammPools,
      marketBuckets,
      stats,
      loading,
      ethINRRate     : resolvedRate,
      ETH_INR_RATE   : resolvedRate,
      ethRateLoaded  : ethINRRate !== null,
      registerCredit, listCredit, delistCredit, retireCredit,
      listCreditLedger, delistCreditLedger, retireCreditLedger,
      buyCredit, placeBuyOrder, cancelBuyOrder,
      isSellerApproved, approveMarketplace,
      ammSwapETHForCredits, ammSwapCreditsForETH, ammAddLiquidity,
      loadMyCredits,
      loadListings,
      loadListingsFromAPI,
      loadBuyOrders,
      loadAMMPools,
      refreshBoughtCredits,
      refreshTradeHistory,
      refreshLedgerCredits,
      refreshRetirements : () => fetchMyRetirements().then(safeSet(setMyRetirements)),
      vintagePenalty, STANDARD_ENUM, STANDARD_FROM_ENUM,
    }}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error('usePortfolio must be used inside <PortfolioProvider>.');
  return ctx;
}

export default PortfolioContext;