// services/api.js — EtherTrack Frontend API Service
const BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// ── Token storage ─────────────────────────────────────────────────
export const tokenStorage = {
  getAccess:  () => localStorage.getItem('et_access'),
  getRefresh: () => localStorage.getItem('et_refresh'),
  setTokens:  (access, refresh) => {
    if (access)  localStorage.setItem('et_access',  access);
    if (refresh) localStorage.setItem('et_refresh', refresh);
  },
  clear: () => {
    localStorage.removeItem('et_access');
    localStorage.removeItem('et_refresh');
  },
};

let _loggingOut  = false;
let _refreshing  = false;
let _refreshWait = null;

// ── Core fetch ────────────────────────────────────────────────────
export const apiFetch = async (path, options = {}, retry = true) => {
  const isAuthRoute    = path.startsWith('/api/auth/');
  const accessToken    = tokenStorage.getAccess();
  const authHeader     = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...options.headers,
    },
  });

  if (res.status === 401 && retry && !isAuthRoute && !_loggingOut) {
    if (_refreshing && _refreshWait) {
      await _refreshWait;
      return apiFetch(path, options, false);
    }
    let resolveRefresh;
    _refreshing  = true;
    _refreshWait = new Promise(r => { resolveRefresh = r; });
    try {
      const refreshToken = tokenStorage.getRefresh();
      if (!refreshToken) throw new Error('No refresh token');
      const refreshRes = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (refreshRes.ok) {
        const d = await refreshRes.json().catch(() => ({}));
        if (d.accessToken) tokenStorage.setTokens(d.accessToken, d.refreshToken);
        resolveRefresh();
        _refreshing = false; _refreshWait = null;
        return apiFetch(path, options, false);
      } else throw new Error('Refresh failed');
    } catch {
      resolveRefresh?.();
      _refreshing = false; _refreshWait = null;
      if (!_loggingOut) {
        _loggingOut = true;
        tokenStorage.clear();
        window.dispatchEvent(new Event('auth:logout'));
        setTimeout(() => { _loggingOut = false; }, 5000);
      }
      return null;
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...data };
  return data;
};

// ══════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════
export const authAPI = {
  register:    (body) => apiFetch('/api/auth/register',     { method:'POST', body:JSON.stringify(body) }),
  verifyEmail: (body) => apiFetch('/api/auth/verify-email', { method:'POST', body:JSON.stringify(body) }),
  login: async (body) => {
    const data = await apiFetch('/api/auth/login', { method:'POST', body:JSON.stringify(body) });
    if (data?.accessToken) tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data;
  },
  syncUser: async (body) => {
    const data = await apiFetch('/api/auth/firebase-sync', { method:'POST', body:JSON.stringify(body) });
    if (data?.accessToken) tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data;
  },
  me:     () => apiFetch('/api/auth/me'),
  logout: async () => {
    try { await apiFetch('/api/auth/logout', { method:'POST' }); } catch {}
    tokenStorage.clear();
  },
};

// ══════════════════════════════════════════════════════════════════
// WALLET  — MetaMask binding (existing) + INR wallet (new)
// ══════════════════════════════════════════════════════════════════
export const walletAPI = {
  // ── MetaMask binding (unchanged) ──
  challenge: ()     => apiFetch('/api/wallet/challenge'),
  bind:      (body) => apiFetch('/api/wallet/bind',  { method:'POST', body:JSON.stringify(body) }),
  status:    ()     => apiFetch('/api/wallet/status'),
  syncKYC:   (body) => apiFetch('/api/wallet/kyc',   { method:'POST', body:JSON.stringify(body) }),

  // ── INR Wallet (new) ──

  // Get balance + last 20 transactions
  getBalance: () => apiFetch('/api/wallet/balance'),

  // Step 1: Create Razorpay order before opening payment popup
  createDepositOrder: (amount, method = 'upi') =>
    apiFetch('/api/wallet/deposit/create-order', {
      method: 'POST',
      body: JSON.stringify({ amount, method }),
    }),

  // Step 2: Verify payment after Razorpay popup closes successfully
  verifyDeposit: (body) =>
    apiFetch('/api/wallet/deposit/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Withdraw to bank account
  withdraw: (body) =>
    apiFetch('/api/wallet/withdraw', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Full transaction history
  getTransactions: () => apiFetch('/api/wallet/transactions'),

  // Deduct INR balance when buying a credit
  tradeDeduct: (body) =>
    apiFetch('/api/wallet/trade-deduct', {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  // Refund INR if MetaMask rejected after deduction
  refundTrade: (body) =>
    apiFetch('/api/wallet/trade-refund', {
      method: 'POST',
      body:   JSON.stringify(body),
    }),

  // ── Bank accounts (persistent in DB) ──
  getBankAccounts:    ()     => apiFetch('/api/wallet/bank-accounts'),
  addBankAccount:     (body) => apiFetch('/api/wallet/bank-accounts',           { method:'POST',   body:JSON.stringify(body) }),
  setDefaultAccount:  (id)   => apiFetch(`/api/wallet/bank-accounts/${id}/default`, { method:'PUT' }),
  deleteBankAccount:  (id)   => apiFetch(`/api/wallet/bank-accounts/${id}`,     { method:'DELETE' }),
};

// ══════════════════════════════════════════════════════════════════
// REGISTRY
// ══════════════════════════════════════════════════════════════════
export const registryAPI = {
  getProjects:   (p={}) => apiFetch('/api/registry/projects?'+new URLSearchParams(p)),
  getProject:    (id)   => apiFetch(`/api/registry/projects/${id}`),
  myProjects:    ()     => apiFetch('/api/registry/my-projects'),
  getBatch:      (tid)  => apiFetch(`/api/registry/batches/token/${tid}`),
  createBatch:   (body) => apiFetch('/api/registry/batches',                { method:'POST', body:JSON.stringify(body) }),
  tokeniseBatch: (id,b) => apiFetch(`/api/registry/batches/${id}/tokenise`, { method:'POST', body:JSON.stringify(b) }),
};

// ══════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════════════════════════════
export const txAPI = {
  getMy:            ()     => apiFetch('/api/transactions/my'),
  getStats:         ()     => apiFetch('/api/transactions/stats'),
  sync:             (body) => apiFetch('/api/transactions/sync',        { method:'POST', body:JSON.stringify(body) }),
  getRetirements:   ()     => apiFetch('/api/transactions/retirements'),
  recordRetirement: (body) => apiFetch('/api/transactions/retirements', { method:'POST', body:JSON.stringify(body) }),
  getCertificate:   (cid)  => apiFetch(`/api/transactions/retirements/${cid}`),
};

// ══════════════════════════════════════════════════════════════════
// EMISSIONS
// ══════════════════════════════════════════════════════════════════
export const emissionsAPI = {
  getMy:  ()         => apiFetch('/api/emissions/my'),
  create: (body)     => apiFetch('/api/emissions',       { method:'POST', body:JSON.stringify(body) }),
  update: (id, body) => apiFetch(`/api/emissions/${id}`, { method:'PUT',  body:JSON.stringify(body) }),
};