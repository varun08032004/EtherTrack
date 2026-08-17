// context/PortfolioContext.jsx — EtherTrack
// METAMASK-FREE REWRITE
// ─────────────────────────────────────────────────────────────────────────────
// ARCHITECTURE (see accompanying MIGRATION_NOTES.md for the full rationale):
//
//   Authenticated EtherTrack user (JWT via authFetch)
//     → Organization / KYC (GET /api/auth/me)
//       → Portfolio data (GET /api/portfolio/*)
//         → PostgreSQL / Credit Ledger
//           → EtherTrack operator/custody wallet (backend-only, never in browser)
//
// Portfolio identity is the authenticated EtherTrack account. There is no
// wallet, no signer, no provider, no chain, and no browser-wallet identity
// anywhere in this file. All state-changing actions (list / delist / retire)
// are backend calls authenticated by the existing JWT bearer token — the
// same way they already were for "ledger" (pooled-custody) credits before
// this rewrite. Since MetaMask is gone, EVERY credit is now custody-held by
// the EtherTrack operator wallet — there is no more "self-custody" tier, so
// the old isLedger / custodyModel branch that used to exist in the UI layer
// is gone too. See MIGRATION_NOTES.md §"Custody model unification".
//
// REMOVED ENTIRELY (search the old file for these — none appear here):
//   window.ethereum, ethers.BrowserProvider, ethers.Contract, getSigner,
//   eth_requestAccounts, eth_accounts, eth_chainId,
//   wallet_switchEthereumChain, accountsChanged/chainChanged listeners,
//   walletAddress, contracts, signer, provider, chainOk, walletMismatch,
//   requireWallet(), isSellerApproved/approveMarketplace, mintCredit(),
//   buyCredit() ETH path, placeBuyOrder/cancelBuyOrder (ETH escrow),
//   AMM swap/liquidity functions, ETH↔INR rate fetching (no longer needed
//   because listing/pricing is INR-only now — nothing converts to ETH).
//
// KNOWN GAPS I CANNOT VERIFY FROM THIS FILE ALONE (flagged again in
// MIGRATION_NOTES.md — read that before deploying):
//   - /api/portfolio/list-credit-ledger, delist-credit-ledger and
//     retire-credit-ledger were called by the OLD context but their route
//     handlers were not included in what you pasted. I'm assuming they
//     already do backend/operator-signed transactions with no wallet
//     involvement (that was true for the "ledger" tier already). If they
//     internally still expect a wallet-bound user, that needs a backend fix.
//   - retire-credit-ledger being reused for credits that used to be
//     "self-custody" assumes the operator wallet can burn/retire tokens it
//     holds in custody. If CarbonCreditToken.sol only allows the literal
//     token holder to call retireCredit() and the operator is NOT already
//     that holder for these tokens, this is blocked at the contract level —
//     I have not seen that contract and cannot confirm either way.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

import React, {
  createContext, useContext, useState, useEffect,
  useCallback, useRef, useMemo,
} from 'react';
import {
  vintagePenalty as vintagePenaltyFn,
  buildTokenMetaMap,
  buildMarketBuckets,
  getMarketPrice,
} from '../utils/creditPricing';
import { getCsrfToken, ensureCsrfCookie } from '../services/api';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// ── Public exports (unchanged — still useful as plain enums) ──────
export const STANDARD_ENUM      = { VCS: 0, GS: 1, CDM: 2, ACR: 3 };
export const STANDARD_FROM_ENUM = { 0: 'VCS', 1: 'GS', 2: 'CDM', 3: 'ACR' };
export const vintagePenalty = vintagePenaltyFn;

const safeNum = (val, fallback = 0) => {
  const n = Number(val);
  return isNaN(n) || !isFinite(n) ? fallback : n;
};

const toTokenHex = (id) =>
  id != null ? `0x${Number(id).toString(16).padStart(8, '0').toUpperCase()}` : null;

// ── Backend error normaliser ───────────────────────────────────────
// Replaces the old getContractErrorMessage(), which existed purely to
// decode ethers.js/MetaMask failure shapes (ACTION_REJECTED,
// INSUFFICIENT_FUNDS, CALL_EXCEPTION, wrong network, etc). None of that
// exists anymore — every action is a normal HTTP call, so the backend's
// own error message (already surfaced by authFetch below) is authoritative.
const getBackendErrorMessage = (e) =>
  e?.message || 'The request failed. Please try again.';

// ── Auth-aware fetch — identical to before, MINUS anything wallet-related.
// Identity comes entirely from the JWT bearer token; nothing here ever
// read window.ethereum or a wallet address, so this function is unchanged
// in behaviour, just re-documented for clarity. ─────────────────────────
const authFetch = async (path, opts = {}) => {
  const token = localStorage.getItem('et_access');
  const isFormData = opts.body instanceof FormData;
  const method = (opts.method || 'GET').toUpperCase();
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (isWrite) {
    await ensureCsrfCookie();
    const csrf = getCsrfToken();
    if (!csrf) {
      throw Object.assign(
        new Error('Could not obtain a security token. Refresh the page and try again.'),
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

// ── Identity — the authenticated EtherTrack account IS the identity.
// No wallet address involved anywhere in this call. ────────────────
const fetchMe = async () => {
  try {
    const d = await authFetch('/api/auth/me');
    return {
      id             : d.id ?? d.user_id ?? null,
      email          : d.email || '',
      fullName       : d.full_name || '',
      organizationId : d.organization_id ?? d.org_id ?? null,
      isKYCVerified  : !!(d.kyc_verified || d.kyc_status === 'verified'),
    };
  } catch {
    return { id: null, email: '', fullName: '', organizationId: null, isKYCVerified: false };
  }
};

const fetchDBCredits = async () => {
  try {
    const d = await authFetch('/api/portfolio/my-credits');
    // NOTE: my-credits currently supports cursor pagination server-side
    // (see routes/portfolio.js) but returns a flat `credits` array shape
    // in the version you pasted for the simple case. Handle both shapes
    // defensively so this doesn't silently break on the paginated path.
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.credits)) return d.credits;
    return [];
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

// Pooled/ledger-custody credits. Under the new architecture this is no
// longer a "special, walletless" tier — it's simply how ALL credits are
// held now, since there is no more self-custody tier. Kept as a separate
// fetch (rather than merged server-side) only because that's the endpoint
// that already exists; see MIGRATION_NOTES.md for the recommendation to
// unify these two tables/endpoints server-side.
const fetchLedgerCredits = async () => {
  try {
    const d = await authFetch('/api/portfolio/my-ledger-credits');
    return Array.isArray(d?.credits) ? d.credits : [];
  } catch { return []; }
};

// ── Backend-driven actions — every single one of these is a plain
// authenticated HTTP call. None of them touch a browser wallet. ────
const listCreditViaBackend = (tokenId, batchId, amount, priceInINR, durationDays) =>
  authFetch('/api/portfolio/list-credit-ledger', {
    method: 'POST',
    body: JSON.stringify({ tokenId, batchId, amount, priceInINR, durationDays }),
  });

const delistCreditViaBackend = (listingId) =>
  authFetch('/api/portfolio/delist-credit-ledger', {
    method: 'POST',
    body: JSON.stringify({ listingId }),
  });

const retireCreditViaBackend = (tokenId, amount) =>
  authFetch('/api/portfolio/retire-credit-ledger', {
    method: 'POST',
    body: JSON.stringify({ tokenId, amount }),
  });

// ── Row mappers ─────────────────────────────────────────────────────
const normaliseTradeRow = (t) => ({
  id          : `TXN-${t.id}`,
  type        : t.buyer_id ? 'Buy' : 'Sell',
  tradeId     : t.id,
  tokenId     : t.token_id ?? null,
  amount      : safeNum(t.quantity, 0),
  projectName : t.project_name || '—',
  priceINR    : parseFloat(t.price_per_credit_inr || 0),
  totalINR    : parseFloat(t.buyer_pays_inr || 0),
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
});

// mapDbCredit / mapLedgerCredit: NOTE there is deliberately no
// `ownerWallet` field anywhere below. Ownership is
// (user_id, organization_id, batch_id) — never a browser wallet address.
const mapCredit = (db) => ({
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
  credits        : safeNum(db.heldCredits ?? db.available_credits ?? db.quantity, 0),
  heldCredits    : safeNum(db.heldCredits ?? db.available_credits ?? db.quantity, 0),
  listedCredits  : safeNum(db.listedCredits ?? db.listed_quantity, 0),
  totalRetired   : safeNum(db.totalRetired ?? db.retired_credits, 0),
  active         : true,
  status         : db.status || (db.available_credits === 0 ? 'RETIRED' : 'HELD'),
  pricePerCredit : safeNum(db.price_per_credit_inr || db.last_traded_price_inr, 850),
  listingId      : db.listingIdOnchain ?? db.listing_id_onchain ?? null,
  vintageDiscount: vintagePenalty(safeNum(db.vintage_year, 0)),
  admin_status   : db.admin_status || 'approved',
  isOnChain      : db.token_id != null,
  creditType              : db.credit_type || 'voluntary',
  cbamEligible            : db.cbam_eligible || false,
  sdg_tags                : Array.isArray(db.sdg_tags) ? db.sdg_tags
    : (() => { try { return JSON.parse(db.sdg_tags || '[]'); } catch { return []; } })(),
  correspondingAdjustment : db.corresponding_adjustment || 'none',
  icvcm_ccp_eligible      : db.icvcm_ccp_eligible || false,
  icvcm_ccp_label         : db.icvcm_ccp_label || '',
  methodologyId           : db.methodology_id || '',
  registryLink            : db.registry_link || '',
  batchId                 : db.id ?? db.batchId ?? null,
});

const PortfolioContext = createContext(null);

export function PortfolioProvider({ children }) {
  // ── Identity — from the authenticated session, never from a wallet ──
  const [me,               setMe]               = useState({
    id: null, email: '', fullName: '', organizationId: null, isKYCVerified: false,
  });

  // ── Portfolio data — all backend-sourced ────────────────────────────
  const [myCredits,       setMyCredits]       = useState([]); // approved batches (custody-held)
  const [myLedgerCredits, setMyLedgerCredits] = useState([]); // pooled-custody credits
  const [myBoughtCredits, setMyBoughtCredits] = useState([]);
  const [myRetirements,   setMyRetirements]   = useState([]);
  const [listings,        setListings]        = useState([]);
  const [tradeHistory,    setTradeHistory]    = useState([]);

  // Deliberately empty/static — see MIGRATION_NOTES.md. Buy orders and
  // AMM both fundamentally assumed a user's own wallet escrowing ETH.
  // Rather than fake a backend-settled version that doesn't exist yet,
  // these are explicitly disabled so the UI can show "unavailable"
  // instead of silently doing nothing or throwing an ugly wallet error.
  const buyOrders = [];
  const ammPools  = [];

  const [loading, setLoading] = useState({
    identity: true, credits: false, listings: false, tx: false, trades: false,
  });
  const [error, setError] = useState('');

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const safeSet = useCallback((setter) => (...args) => {
    if (mountedRef.current) setter(...args);
  }, []);

  // ── Loaders — every one of these is a plain backend call ────────────
  const refreshIdentity = useCallback(async () => {
    safeSet(setLoading)(l => ({ ...l, identity: true }));
    try {
      const identity = await fetchMe();
      safeSet(setMe)(identity);
      return identity;
    } finally {
      safeSet(setLoading)(l => ({ ...l, identity: false }));
    }
  }, [safeSet]);

  const loadMyCredits = useCallback(async () => {
    safeSet(setLoading)(l => ({ ...l, credits: true }));
    try {
      const raw = await fetchDBCredits();
      safeSet(setMyCredits)(raw.map(mapCredit));
    } catch (e) {
      console.error('[loadMyCredits]', e);
    } finally {
      safeSet(setLoading)(l => ({ ...l, credits: false }));
    }
  }, [safeSet]);

  const refreshLedgerCredits = useCallback(async () => {
    try {
      const raw = await fetchLedgerCredits();
      const mapped = raw.map(mapCredit);
      safeSet(setMyLedgerCredits)(mapped);
      return mapped;
    } catch (e) {
      console.error('[refreshLedgerCredits]', e);
      return [];
    }
  }, [safeSet]);

  const refreshBoughtCredits = useCallback(async () => {
    try {
      const raw = await fetchMyPurchases();
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
        pricePerCredit : safeNum(b.price_per_credit_inr || b.pricePerCredit, 850),
        totalPaid      : safeNum(b.buyer_pays_inr || b.totalPaid,
          safeNum(b.quantity, 0) * safeNum(b.price_per_credit_inr, 850)),
        paymentMode    : b.payment_mode || 'inr',
        txHash         : b.tx_hash || b.txHash || null,
        boughtAt       : b.bought_at || b.boughtAt || b.created_at || new Date().toISOString(),
        batchId        : b.batch_id || b.batchId || null,
        creditType              : b.credit_type || 'voluntary',
        cbamEligible            : b.cbam_eligible || false,
        sdgTags                 : Array.isArray(b.sdg_tags) ? b.sdg_tags
          : (() => { try { return JSON.parse(b.sdg_tags || '[]'); } catch { return []; } })(),
        correspondingAdjustment : b.corresponding_adjustment || 'none',
        icvcm_ccp_eligible      : b.icvcm_ccp_eligible || false,
        registryLink            : b.registry_link || '',
        methodologyId           : b.methodology_id || '',
        expiryDate              : b.expiry_date || '',
        status         : 'BOUGHT',
        isBought       : true,
        isOnChain      : true,
        admin_status   : 'approved',
        vintageDiscount: 0,
      }));
      safeSet(setMyBoughtCredits)(normalised);
      return normalised;
    } catch (e) {
      console.error('[refreshBoughtCredits]', e);
      return [];
    }
  }, [safeSet]);

  const refreshRetirements = useCallback(async () => {
    try {
      const rows = await fetchMyRetirements();
      safeSet(setMyRetirements)(rows);
      return rows;
    } catch (e) {
      console.error('[refreshRetirements]', e);
      return [];
    }
  }, [safeSet]);

  const refreshTradeHistory = useCallback(async () => {
    safeSet(setLoading)(l => ({ ...l, trades: true }));
    try {
      const raw = await fetchTradeHistoryFromDB();
      safeSet(setTradeHistory)(raw.map(normaliseTradeRow));
    } catch (e) {
      console.error('[refreshTradeHistory]', e);
    } finally {
      safeSet(setLoading)(l => ({ ...l, trades: false }));
    }
  }, [safeSet]);

  const loadListingsFromAPI = useCallback(async () => {
    safeSet(setLoading)(l => ({ ...l, listings: true }));
    try {
      const apiListings = await fetchListingsFromAPI();
      const nowSec = Math.floor(Date.now() / 1000);

      const mapped = apiListings
        .map(l => {
          const dep         = vintagePenalty(safeNum(l.vintageYear || l.vintage_year, 0));
          const priceINR    = safeNum(l.pricePerUnitINR || l.price_per_credit_inr, 850);
          const adjPriceINR = Math.round(priceINR * (1 - dep / 100));
          const expiresAt   = safeNum(l.expiresAt || l.expires_at, nowSec + 86400 * 30);

          return {
            listingId       : l.listingId ?? l.listing_id ?? null,
            batchId         : l.batchId || null,
            tokenId         : safeNum(l.tokenId ?? l.token_id, null) || null,
            amount          : safeNum(l.amount ?? l.available_credits, 0),
            pricePerUnitINR : +priceINR,
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
            lastTradedPriceINR: safeNum(l.lastTradedPriceINR || l.last_traded_price_inr, 0),
          };
        })
        .filter(l => l.expiresAt > nowSec && l.amount > 0);

      safeSet(setListings)(mapped);
    } catch (e) {
      console.warn('[loadListingsFromAPI]', e.message);
    } finally {
      safeSet(setLoading)(l => ({ ...l, listings: false }));
    }
  }, [safeSet]);

  // ── Init — no wallet branch, no chain checks, no window.ethereum ────
  useEffect(() => {
    refreshIdentity();
    loadMyCredits();
    refreshLedgerCredits();
    refreshBoughtCredits();
    refreshRetirements();
    refreshTradeHistory();
    loadListingsFromAPI();

    // Polling replaces the old on-chain event listeners
    // (CreditTraded / CreditListed / etc). Blockchain-side reconciliation
    // is the backend's job (see MIGRATION_NOTES.md); the frontend just
    // re-polls periodically plus lets callers force an explicit refresh.
    const pollId = setInterval(() => {
      loadListingsFromAPI();
    }, 30_000);

    return () => clearInterval(pollId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Backend-driven actions ───────────────────────────────────────────
  const listCredit = useCallback(async (tokenId, batchId, amount, priceInINR, durationDays = 30) => {
    if (!tokenId && tokenId !== 0 && !batchId) throw new Error('Invalid credit reference.');
    if (amount <= 0) throw new Error('Amount must be greater than zero.');
    if (!priceInINR || priceInINR <= 0) throw new Error('Price must be greater than zero.');

    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const result = await listCreditViaBackend(tokenId, batchId, amount, priceInINR, durationDays);
      await Promise.allSettled([loadMyCredits(), refreshLedgerCredits(), loadListingsFromAPI()]);
      return { success: true, listingId: result.listingId, txHash: result.txHash || null };
    } catch (e) {
      throw new Error(getBackendErrorMessage(e) || 'Listing failed. Please try again.');
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  }, [safeSet, loadMyCredits, refreshLedgerCredits, loadListingsFromAPI]);

  const delistCredit = useCallback(async (listingId) => {
    if (listingId == null) throw new Error('Invalid listing reference.');
    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const result = await delistCreditViaBackend(listingId);
      await Promise.allSettled([loadMyCredits(), refreshLedgerCredits(), loadListingsFromAPI()]);
      return { success: true, txHash: result.txHash || null };
    } catch (e) {
      throw new Error(getBackendErrorMessage(e) || 'Delisting failed. Please try again.');
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  }, [safeSet, loadMyCredits, refreshLedgerCredits, loadListingsFromAPI]);

  const retireCredit = useCallback(async (tokenId, amount) => {
    if (tokenId == null) throw new Error('Invalid credit reference.');
    if (amount <= 0) throw new Error('Amount must be greater than zero.');
    if (!me.isKYCVerified) throw new Error('KYC verification is required before retiring credits.');

    safeSet(setLoading)(l => ({ ...l, tx: true }));
    try {
      const result = await retireCreditViaBackend(tokenId, amount);
      await Promise.allSettled([loadMyCredits(), refreshLedgerCredits(), refreshRetirements()]);
      return { success: true, txHash: result.txHash || null, certId: result.certId || null };
    } catch (e) {
      throw new Error(getBackendErrorMessage(e) || 'Retirement failed. Please try again.');
    } finally {
      safeSet(setLoading)(l => ({ ...l, tx: false }));
    }
  }, [safeSet, me.isKYCVerified, loadMyCredits, refreshLedgerCredits, refreshRetirements]);

  // ── Explicitly unavailable — NOT faked, NOT silently no-ops.
  // These threw MetaMask-specific errors before; now they throw a plain,
  // honest "this isn't wired up yet" error so the UI can disable the
  // buttons and say why, instead of pretending to work. See
  // MIGRATION_NOTES.md §11–13 for what backend work would unblock them. ──
  const NOT_AVAILABLE = (feature) => () => {
    throw new Error(
      `${feature} requires wallet-based ETH escrow and is not available in the wallet-free ` +
      `Portfolio. This is pending a backend/operator settlement path — see MIGRATION_NOTES.md.`
    );
  };
  const buyCredit       = useCallback(NOT_AVAILABLE('Direct ETH purchase'), []);
  const placeBuyOrder   = useCallback(NOT_AVAILABLE('Buy orders'), []);
  const cancelBuyOrder  = useCallback(NOT_AVAILABLE('Buy orders'), []);
  const ammSwapETHForCredits  = useCallback(NOT_AVAILABLE('AMM swaps'), []);
  const ammSwapCreditsForETH  = useCallback(NOT_AVAILABLE('AMM swaps'), []);
  const ammAddLiquidity       = useCallback(NOT_AVAILABLE('AMM liquidity'), []);

  const refreshKYC = useCallback(async () => {
    const identity = await refreshIdentity();
    return identity.isKYCVerified;
  }, [refreshIdentity]);

  // ── Derived pricing / stats — unchanged logic, just no wallet inputs ─
  const allOwnedCredits = useMemo(
    () => [...myCredits, ...myLedgerCredits],
    [myCredits, myLedgerCredits]
  );

  const tokenMetaMap = useMemo(
    () => buildTokenMetaMap({ listings, myCredits: allOwnedCredits, myBoughtCredits }),
    [listings, allOwnedCredits, myBoughtCredits]
  );

  const marketBuckets = useMemo(
    () => buildMarketBuckets({ listings, tradeHistory, buyOrders }, tokenMetaMap),
    [listings, tradeHistory, tokenMetaMap]
  );

  const stats = useMemo(() => {
    const ownedActive  = allOwnedCredits.filter(c => c.status !== 'RETIRED');
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
      listedCount  : allOwnedCredits
        .filter(c => c.status === 'LISTED' || c.status === 'PARTIAL')
        .reduce((s, c) => s + safeNum(c.listedCredits, 0), 0),
      retiredCount : myRetirements.reduce((s, r) => s + safeNum(r.amount, 0), 0),
      heldCount    : allOwnedCredits.filter(c => c.status === 'HELD').length,
      openBids     : 0, // buy orders disabled — see NOT_AVAILABLE above
    };
  }, [allOwnedCredits, myBoughtCredits, myRetirements, marketBuckets]);

  const handleRefreshAll = useCallback(async () => {
    await Promise.allSettled([
      loadMyCredits(),
      refreshLedgerCredits(),
      refreshBoughtCredits(),
      refreshRetirements(),
      loadListingsFromAPI(),
    ]);
  }, [loadMyCredits, refreshLedgerCredits, refreshBoughtCredits, refreshRetirements, loadListingsFromAPI]);

  return (
    <PortfolioContext.Provider value={{
      // Identity — application identity only, never wallet identity
      me,
      userId          : me.id,
      organizationId  : me.organizationId,
      isKYCVerified   : me.isKYCVerified,
      refreshKYC,
      refreshIdentity,

      // Portfolio data
      myCredits        : allOwnedCredits, // unified — no more isLedger branching in the UI
      myBoughtCredits,
      myRetirements,
      listings, buyOrders, tradeHistory, ammPools,
      marketBuckets,
      stats,
      loading, error,

      // Backend-driven actions
      listCredit, delistCredit, retireCredit,
      buyCredit, placeBuyOrder, cancelBuyOrder,
      ammSwapETHForCredits, ammSwapCreditsForETH, ammAddLiquidity,

      // Refresh / reconciliation
      loadMyCredits,
      loadListingsFromAPI,
      refreshIdentity,
      refreshBoughtCredits,
      refreshLedgerCredits,
      refreshTradeHistory,
      refreshRetirements,
      refreshAll: handleRefreshAll,
      refreshAllLegacy: handleRefreshAll, // alias for backward compat

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