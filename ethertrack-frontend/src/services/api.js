// src/services/api.js — EtherTrack v15
// [FEAT-BULK-DELETE]    emissionsAPI.bulkDelete(ids)
// [FEAT-LEDGER-CHAIN]   auditAPI.getChain() / auditAPI.writeChain()
// All v14 code retained unchanged.

'use strict';

const BASE            = process.env.REACT_APP_API_URL || '';
const REQUEST_TIMEOUT = 60_000;

export const tokenStorage = {
  getAccess  : () => null,
  getRefresh : () => null,
  setTokens  : () => {},
  clear      : () => {
    _csrfTokenMemory = '';
    try { localStorage.removeItem('et_access');  } catch {}
    try { localStorage.removeItem('et_refresh'); } catch {}
  },
};

let _csrfTokenMemory = '';

function getCsrfToken() {
  return _csrfTokenMemory;
}

let _csrfPromise = null;

async function ensureCsrfCookie() {
  if (_csrfTokenMemory) return;

  if (!_csrfPromise) {
    _csrfPromise = (async () => {
      try {
        const res = await fetch(`${BASE}/api/auth/csrf`, {
          method: 'GET', credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.csrfToken) {
            _csrfTokenMemory = data.csrfToken;
          }
        }
      } catch {
      } finally {
        _csrfPromise = null;
      }
    })();
  }

  await _csrfPromise;
}

function withTimeout(ms) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

let _loggingOut  = false;
let _refreshing  = false;
let _refreshWait = null;

function qs(params = {}) {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const str = new URLSearchParams(filtered).toString();
  return str ? '?' + str : '';
}

export const apiFetch = async (path, options = {}, retry = true) => {
  const isAuthRoute = path.startsWith('/api/auth/');
  const method      = (options.method || 'GET').toUpperCase();
  const isFormData  = options.body instanceof FormData;
  const isWrite     = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (isWrite && !isAuthRoute) {
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
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers,
  };

  if (isWrite && !isAuthRoute) {
    headers['X-CSRF-Token'] = getCsrfToken();
  }

  const { signal, clear } = withTimeout(REQUEST_TIMEOUT);

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options, method, credentials: 'include', headers, signal,
    });
  } catch (err) {
    clear();
    if (err.name === 'AbortError')
      throw Object.assign(new Error('Request timed out. Please try again.'), { status: 408 });
    throw Object.assign(new Error('Network error. Check your connection.'), { status: 0 });
  }
  clear();

  if (res.status === 401 && retry && !isAuthRoute && !_loggingOut) {
    if (_refreshing && _refreshWait) {
      await _refreshWait;
      return apiFetch(path, options, false);
    }

    let resolveRefresh;
    _refreshing  = true;
    _refreshWait = new Promise(r => { resolveRefresh = r; });

    try {
      const { signal: rSig, clear: rClear } = withTimeout(REQUEST_TIMEOUT);
      const refreshRes = await fetch(`${BASE}/api/auth/refresh`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        signal: rSig,
      });
      rClear();

      if (refreshRes.ok) {
        resolveRefresh(); _refreshing = false; _refreshWait = null;
        return apiFetch(path, options, false);
      }
      throw new Error('Refresh failed');
    } catch {
      resolveRefresh?.(); _refreshing = false; _refreshWait = null;
      if (!_loggingOut) {
        _loggingOut = true;
        tokenStorage.clear();
        window.dispatchEvent(new Event('auth:logout'));
        setTimeout(() => { _loggingOut = false; }, 5000);
      }
      return null;
    }
  }

  if (res.status === 404) return null;

  let data = {};
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    console.error('[apiFetch error]', res.status, JSON.stringify(data));
    throw Object.assign(
      new Error(data?.error || data?.message || data?.detail || `Request failed: ${res.status}`),
      { status: res.status, ...data }
    );
  }

  return data;
};

export const apiFetchMultipart = async (path, formData, options = {}) => {
  await ensureCsrfCookie();
  const csrf = getCsrfToken();
  if (!csrf)
    throw Object.assign(
      new Error('Could not obtain CSRF token. Refresh the page and try again.'),
      { status: 403 }
    );

  const { signal, clear } = withTimeout(REQUEST_TIMEOUT);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST', credentials: 'include',
      headers: { 'X-CSRF-Token': csrf, ...options.headers },
      body: formData, signal,
    });
  } catch (err) {
    clear();
    if (err.name === 'AbortError')
      throw Object.assign(new Error('Upload timed out. Please try again.'), { status: 408 });
    throw Object.assign(new Error('Network error. Check your connection.'), { status: 0 });
  }
  clear();

  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok)
    throw Object.assign(
      new Error(data?.error || data?.message || `Upload failed (${res.status})`),
      { status: res.status, ...data }
    );
  return data;
};

export const apiFetchMultipartWithProgress = (path, formData, options = {}, onProgress) => {
  let xhr;
  const promise = (async () => {
    await ensureCsrfCookie();
    const csrf = getCsrfToken();
    if (!csrf)
      throw Object.assign(
        new Error('Could not obtain CSRF token. Refresh the page and try again.'),
        { status: 403 }
      );

    return new Promise((resolve, reject) => {
      xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && typeof onProgress === 'function')
          onProgress(Math.round((e.loaded / e.total) * 95));
      });

      xhr.addEventListener('load', () => {
        if (typeof onProgress === 'function') onProgress(100);
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
        } else {
          reject(Object.assign(
            new Error(data?.error || data?.message || `Upload failed (${xhr.status})`),
            { status: xhr.status, ...data }
          ));
        }
      });

      xhr.addEventListener('error',   () => reject(Object.assign(new Error('Network error during upload.'), { status: 0 })));
      xhr.addEventListener('abort',   () => reject(Object.assign(new Error('Upload cancelled.'), { status: 0 })));
      xhr.addEventListener('timeout', () => reject(Object.assign(new Error('Upload timed out.'), { status: 408 })));

      xhr.open('POST', `${BASE}${path}`);
      xhr.timeout         = REQUEST_TIMEOUT;
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-CSRF-Token', csrf);
      if (options.headers) {
        Object.entries(options.headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      }
      xhr.send(formData);
    });
  })();

  return { promise, abort: () => xhr?.abort() };
};

export const apiFetchWithIdempotency = (path, options = {}, keyPrefix = 'req') => {
  const key = `${keyPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return apiFetch(path, {
    ...options,
    headers: { ...options.headers, 'Idempotency-Key': key },
  });
};

export const openKycSseStream = ({ onApproved, onRejected, onError } = {}) => {
  let es         = null;
  let closed     = false;
  let retries    = 0;
  let retryTimer = null;

  const connect = () => {
    if (closed) return;
    es = new EventSource(`${BASE}/api/kyc/stream`, { withCredentials: true });

    es.addEventListener('message', (e) => {
      retries = 0;
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'kyc.approved' && typeof onApproved === 'function') onApproved(payload);
        if (payload.type === 'kyc.rejected' && typeof onRejected === 'function') onRejected(payload);
      } catch {}
    });

    es.addEventListener('error', (err) => {
      es.close(); es = null;
      if (closed) return;
      if (typeof onError === 'function') onError(err);
      const base  = Math.min(3000 * Math.pow(2, retries), 90_000);
      const delay = base + Math.random() * 2000;
      retries    += 1;
      retryTimer  = setTimeout(connect, delay);
    });
  };

  connect();
  return { close: () => { closed = true; clearTimeout(retryTimer); es?.close(); es = null; } };
};

export const apiFetchStrict = async (path, options) => {
  const result = await apiFetch(path, options);
  if (result === null)
    throw Object.assign(
      new Error('Session expired or resource not found. Please log in again.'),
      { status: 401 }
    );
  return result;
};

// ══════════════════════════════════════════════════════════════════════════════
// KYC
// ══════════════════════════════════════════════════════════════════════════════
export const kycAPI = {
  submit: ({ fullName, idType, idNumber, phone, docIpfsHash }) =>
    apiFetchWithIdempotency(
      '/api/kyc/submit',
      { method: 'POST', body: JSON.stringify({ fullName, idType, idNumber, phone, docIpfsHash }) },
      'kyc-submit'
    ),
  status: () => apiFetch('/api/kyc/status'),
  uploadDoc: (file, idToken, onProgress) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiFetchMultipartWithProgress(
      '/api/ipfs/pin-kyc-doc',
      formData,
      { headers: { Authorization: `Bearer ${idToken}` } },
      onProgress
    );
  },
  openStream: (handlers) => openKycSseStream(handlers),
  pending : (page = 0, size = 50) => apiFetch(`/api/kyc/pending${qs({ page, size })}`),
  detail  : (id)                  => apiFetch(`/api/kyc/${id}`),
  approve : (id, tier = 'full')   => apiFetch(`/api/kyc/${id}/approve`, { method: 'POST', body: JSON.stringify({ tier }) }),
  reject  : (id, reason)          => apiFetch(`/api/kyc/${id}/reject`,  { method: 'POST', body: JSON.stringify({ reason }) }),
};

// ══════════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════════
export const authAPI = {
  register    : (body) => apiFetch('/api/auth/register',     { method: 'POST', body: JSON.stringify(body) }),
  verifyEmail : (body) => apiFetch('/api/auth/verify-email', { method: 'POST', body: JSON.stringify(body) }),
  resendOtp   : (body) => apiFetch('/api/auth/resend-otp',   { method: 'POST', body: JSON.stringify(body) }),
  login: async (body) => {
    const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
    tokenStorage.clear();
    return data;
  },
  syncUser: async (body, idToken) => {
    await ensureCsrfCookie();
    const data = await apiFetch('/api/auth/firebase-sync', {
      method  : 'POST',
      headers : idToken ? { Authorization: `Bearer ${idToken}` } : {},
      body    : JSON.stringify(body),
    });
    tokenStorage.clear();
    return data;
  },
  me     : () => apiFetch('/api/auth/me'),
  logout : async () => {
    try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch {}
    tokenStorage.clear();
  },
  setup2FA       : ()                    => apiFetch('/api/auth/2fa/setup',        { method: 'POST' }),
  verifySetup2FA : (token)               => apiFetch('/api/auth/2fa/verify-setup', { method: 'POST', body: JSON.stringify({ token }) }),
  validate2FA    : (tempToken, totpCode) => apiFetch('/api/auth/2fa/validate',     { method: 'POST', body: JSON.stringify({ tempToken, totpCode }) }),
  disable2FA     : (totpCode)            => apiFetch('/api/auth/2fa/disable',      { method: 'POST', body: JSON.stringify({ totpCode }) }),
};

// ══════════════════════════════════════════════════════════════════════════════
// WALLET
// ══════════════════════════════════════════════════════════════════════════════
export const walletAPI = {
  challenge  : ()     => apiFetch('/api/wallet/challenge'),
  bind       : (body) => apiFetch('/api/wallet/bind',   { method: 'POST', body: JSON.stringify(body) }),
  status     : ()     => apiFetch('/api/wallet/status'),
  syncKYC    : (body) => apiFetch('/api/wallet/kyc',    { method: 'POST', body: JSON.stringify(body) }),
  getBalance      : ()       => apiFetch('/api/wallet/balance'),
  getTransactions : (p = {}) => apiFetch(`/api/wallet/transactions${qs(p)}`),
  getEthRate      : ()       => apiFetch('/api/wallet/eth-inr-rate'),
  getLimits       : ()       => apiFetch('/api/wallet/limits'),
  createDepositOrder : (amount, method = 'upi') =>
    apiFetch('/api/wallet/deposit/create-order', { method: 'POST', body: JSON.stringify({ amount, method }) }),
  verifyDeposit : (body) => apiFetch('/api/wallet/deposit/verify', { method: 'POST', body: JSON.stringify(body) }),
  withdraw      : (body) => apiFetch('/api/wallet/withdraw',       { method: 'POST', body: JSON.stringify(body) }),
  tradeDeduct   : (body) => apiFetch('/api/wallet/trade-deduct',   { method: 'POST', body: JSON.stringify(body) }),
  refundTrade   : (body) => apiFetch('/api/wallet/trade-refund',   { method: 'POST', body: JSON.stringify(body) }),
  getBankAccounts    : ()     => apiFetch('/api/wallet/bank-accounts'),
  addBankAccount     : (body) => apiFetch('/api/wallet/bank-accounts',               { method: 'POST',   body: JSON.stringify(body) }),
  setDefaultAccount  : (id)   => apiFetch(`/api/wallet/bank-accounts/${id}/default`, { method: 'PUT' }),
  deleteBankAccount  : (id)   => apiFetch(`/api/wallet/bank-accounts/${id}`,         { method: 'DELETE' }),
};

// ══════════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION
// ══════════════════════════════════════════════════════════════════════════════
export const subscriptionAPI = {
  getPrices  : () => apiFetch('/api/subscription/prices'),
  selectFree : () => apiFetch('/api/subscription/free', { method: 'POST' }),
  validateCoupon: (planKey, cycle, couponCode) =>
    apiFetch('/api/subscription/coupon/validate', {
      method: 'POST',
      body:   JSON.stringify({ plan: planKey, cycle, coupon_code: couponCode }),
    }),
  createOrder: (planKey, cycle = 'monthly', idempotencyKey, couponCode) =>
    apiFetch('/api/subscription/order', {
      method: 'POST',
      body:   JSON.stringify({ plan: planKey, cycle, idempotency_key: idempotencyKey,
        coupon_code: couponCode || undefined }),
    }),
  verifyAndActivate: (planKey, cycle, razorpayResponse, gstDetails = {}) =>
    apiFetch('/api/subscription/verify', {
      method: 'POST',
      body:   JSON.stringify({
        plan:                planKey,
        cycle,
        razorpay_order_id:   razorpayResponse.razorpay_order_id,
        razorpay_payment_id: razorpayResponse.razorpay_payment_id,
        razorpay_signature:  razorpayResponse.razorpay_signature,
        gstin:               gstDetails.gstin || undefined,
        pan:                 gstDetails.pan   || undefined,
      }),
    }),
  payWithWallet: (planKey, cycle, idempotencyKey, gstDetails = {}, couponCode) =>
    apiFetch('/api/subscription/wallet-pay', {
      method: 'POST',
      body:   JSON.stringify({ plan: planKey, cycle, idempotency_key: idempotencyKey,
        gstin: gstDetails.gstin || undefined, pan: gstDetails.pan || undefined,
        coupon_code: couponCode || undefined }),
    }),
  payWithMetaMask: (planKey, cycle, walletAddress, signature, message, gstDetails = {}, couponCode) =>
    apiFetch('/api/subscription/metamask-pay', {
      method: 'POST',
      body:   JSON.stringify({ plan: planKey, cycle, wallet_address: walletAddress,
        signature, message, gstin: gstDetails.gstin || undefined, pan: gstDetails.pan || undefined,
        coupon_code: couponCode || undefined }),
    }),
  getHistory: ({ limit = 20, cursor } = {}) =>
    apiFetch(`/api/subscription/history?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
  getCurrentPlan: () => apiFetch('/api/org/plan'),
};

// ══════════════════════════════════════════════════════════════════════════════
// REGISTRY
// ══════════════════════════════════════════════════════════════════════════════
export const registryAPI = {
  getProjects   : (p = {}) => apiFetch(`/api/registry/projects${qs(p)}`),
  getProject    : (id)     => apiFetch(`/api/registry/projects/${id}`),
  myProjects    : ()       => apiFetch('/api/registry/my-projects'),
  getBatch      : (tid)    => apiFetch(`/api/registry/batches/token/${tid}`),
  createBatch   : (body)   => apiFetch('/api/registry/batches',                { method: 'POST', body: JSON.stringify(body) }),
  tokeniseBatch : (id, b)  => apiFetch(`/api/registry/batches/${id}/tokenise`, { method: 'POST', body: JSON.stringify(b) }),
};

// ══════════════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════════════════════════════════════════
export const txAPI = {
  getMy            : ()        => apiFetch('/api/transactions/my'),
  getStats         : ()        => apiFetch('/api/transactions/stats'),
  sync             : (body)    => apiFetch('/api/transactions/sync',            { method: 'POST', body: JSON.stringify(body) }),
  getRetirements   : (p = {})  => apiFetch(`/api/transactions/retirements${qs(p)}`),
  recordRetirement : (body)    => apiFetch('/api/transactions/retirements',     { method: 'POST', body: JSON.stringify(body) }),
  recordPurchase   : (body)    => apiFetch('/api/transactions/record-purchase', { method: 'POST', body: JSON.stringify(body) }),
  getCertificate   : (cid)     => apiFetch(`/api/transactions/retirements/${cid}`),
};

// ══════════════════════════════════════════════════════════════════════════════
// TRADES
// ══════════════════════════════════════════════════════════════════════════════
export const tradesAPI = {
  record  : (payload) => apiFetch('/api/trades/record',  { method: 'POST', body: JSON.stringify(payload) }),
  history : (p = {})  => apiFetch(`/api/trades/history${qs(p)}`),
  stats   : ()        => apiFetch('/api/trades/stats'),
  myFees  : (p = {})  => apiFetch(`/api/trades/my-fees${qs(p)}`),
  ethRate : ()        => apiFetch('/api/trades/eth-rate'),
  checkoutOrder  : (payload) => apiFetch('/api/trades/checkout-order',  { method: 'POST', body: JSON.stringify(payload) }),
  checkoutVerify : (payload) => apiFetch('/api/trades/checkout-verify', { method: 'POST', body: JSON.stringify(payload) }),
  verifyOnChain  : (tradeId) => apiFetch(`/api/trades/${tradeId}/verify`),
  getInvoice: (tradeId) => {
    window.open(`${BASE}/api/trades/${tradeId}/invoice`, '_blank', 'noopener,noreferrer');
  },
  hasInvoice: (trade) => Boolean(trade?.has_invoice || trade?.trade_invoice_number),
};

// ══════════════════════════════════════════════════════════════════════════════
// MARKET
// ══════════════════════════════════════════════════════════════════════════════
export const marketAPI = {
  listings     : (p = {}) => apiFetch(`/api/market/listings${qs(p)}`),
  buyOrders    : (p = {}) => apiFetch(`/api/market/buy-orders${qs(p)}`),
  tradeHistory : (p = {}) => apiFetch(`/api/market/trade-history${qs(p)}`),
  stats        : ()       => apiFetch('/api/market/stats'),
};

// ══════════════════════════════════════════════════════════════════════════════
// EMISSIONS
// ══════════════════════════════════════════════════════════════════════════════
export const emissionsAPI = {
  getMy          : ()        => apiFetch('/api/emissions/my'),
  getActivities  : (p = {})  => apiFetch(`/api/emissions/activities${qs(p)}`),
  log            : (body)    => apiFetch('/api/emissions/log',  { method: 'POST', body: JSON.stringify(body) }),
  bulk           : (records) => apiFetch('/api/emissions/bulk', { method: 'POST', body: JSON.stringify({ records }) }),
  getSummary     : (year)    => apiFetch(`/api/emissions/summary${qs({ year })}`),
  getProfile     : ()        => apiFetch('/api/emissions/profile'),
  saveProfile    : (body)    => apiFetch('/api/emissions/profile', { method: 'POST', body: JSON.stringify(body) }),
  deleteActivity : (id)      => apiFetch(`/api/emissions/activities/${id}`, { method: 'DELETE' }),

  // [FEAT-BULK-DELETE] Delete multiple records in one request.
  // GHGLedger.jsx calls this when user confirms bulk deletion via checkboxes.
  bulkDelete: (ids) => apiFetch('/api/emissions/bulk-delete', {
    method: 'POST',
    body:   JSON.stringify({ ids }),
  }),

  // Maker-Checker approval workflow
  transitionState  : (id, state, comment) =>
    apiFetch(`/api/emissions/activities/${id}/state`, { method: 'PATCH', body: JSON.stringify({ state, comment }) }),
  submitAdjustment : (id, { field, old_val, new_val, reason }) =>
    apiFetch(`/api/emissions/activities/${id}/adjustment`, { method: 'POST', body: JSON.stringify({ field, old_val, new_val, reason }) }),
  getAdjustments   : (id) => apiFetch(`/api/emissions/activities/${id}/adjustments`),

  // Source-to-number lineage
  getLineage    : (id) => apiFetch(`/api/emissions/activities/${id}/lineage`),
  getEFVersions : ()   => apiFetch('/api/emissions/ef-versions'),
};

// ══════════════════════════════════════════════════════════════════════════════
// PORTFOLIO
// ══════════════════════════════════════════════════════════════════════════════
export const portfolioAPI = {
  myCredits     : (p = {}) => apiFetch(`/api/portfolio/my-credits${qs(p)}`),
  myPurchases   : (p = {}) => apiFetch(`/api/portfolio/my-bought-credits${qs(p)}`),
  mySubmissions : (p = {}) => apiFetch(`/api/portfolio/my-submissions${qs(p)}`),
  kycStatus     : ()       => apiFetch('/api/portfolio/kyc-status'),
  emissionsSummary         : (year)   => apiFetch(`/api/portfolio/emissions-summary${qs({ year })}`),
  checkDuplicateRetirement : (serial) => apiFetch(`/api/portfolio/check-duplicate-retirement${qs({ serial })}`),
  submitCredit             : (data)   => apiFetch('/api/portfolio/submit-credit',     { method: 'POST',   body: JSON.stringify(data) }),
  cancelSubmission         : (id)     => apiFetch(`/api/portfolio/submissions/${id}`, { method: 'DELETE' }),
  getWatchlist             : ()       => apiFetch('/api/portfolio/watchlist'),
  addToWatchlist           : (lid)    => apiFetch('/api/portfolio/watchlist',         { method: 'POST',   body: JSON.stringify({ listingId: lid }) }),
  removeFromWatchlist      : (lid)    => apiFetch(`/api/portfolio/watchlist/${lid}`,  { method: 'DELETE' }),
};

// ══════════════════════════════════════════════════════════════════════════════
// ORG
// ══════════════════════════════════════════════════════════════════════════════
export const orgAPI = {
  me               : ()                   => apiFetch('/api/org/me'),
  members          : (orgId)              => apiFetch(`/api/org/${orgId}/members`),
  verifiers        : (orgId)              => apiFetch(`/api/org/${orgId}/verifiers`),
  portfolioSummary : (orgId)              => apiFetch(`/api/org/${orgId}/portfolio-summary`),
  auditLog         : (orgId, limit = 100) => apiFetch(`/api/org/${orgId}/audit-log${qs({ limit })}`),
  retirementQueue  : (orgId)              => apiFetch(`/api/org/${orgId}/retirement-queue`),
  submitRetirement  : (orgId, data)       => apiFetch(`/api/org/${orgId}/retirement-queue`,               { method: 'POST', body: JSON.stringify(data) }),
  approveRetirement : (orgId, id)         => apiFetch(`/api/org/${orgId}/retirement-queue/${id}/approve`, { method: 'POST' }),
  rejectRetirement  : (orgId, id, reason) => apiFetch(`/api/org/${orgId}/retirement-queue/${id}/reject`,  { method: 'POST', body: JSON.stringify({ reason }) }),
};

// ══════════════════════════════════════════════════════════════════════════════
// ORG ROLES
// ══════════════════════════════════════════════════════════════════════════════
export const orgRoleAPI = {
  getMyRole   : () => apiFetch('/api/org/my-role'),
  setUserRole : (userId, role) =>
    apiFetch('/api/org/roles', { method: 'POST', body: JSON.stringify({ userId, role }) }),
};

// ══════════════════════════════════════════════════════════════════════════════
// PAT SCHEME
// ══════════════════════════════════════════════════════════════════════════════
export const patAPI = {
  getProfile: () => apiFetch('/api/pat/profile'),
  saveProfile: (body) =>
    apiFetch('/api/pat/profile', {
      method: 'POST',
      body:   JSON.stringify({
        sector: body.sector, cycle: body.cycle, dc_name: body.dc_name,
        dc_number: body.dc_number, reporting_year: body.reporting_year,
        baseline_sec: body.baseline_sec ?? null, target_sec: body.target_sec ?? null,
        target_reduction_pct: body.target_reduction_pct ?? null,
        gate_capacity: body.gate_capacity ?? null, monthly_gj: body.monthly_gj,
        energy_sources: body.energy_sources ?? null, current_sec: body.current_sec ?? null,
        energy_saved_gj: body.energy_saved_gj ?? null, escerts: body.escerts ?? 0,
        escert_deficit: body.escert_deficit ?? 0, auditor_name: body.auditor_name ?? null,
        auditor_firm: body.auditor_firm ?? null, auditor_reg_number: body.auditor_reg_number ?? null,
        audit_date: body.audit_date ?? null, audit_verified: body.audit_verified ?? false,
      }),
    }),
};

// ══════════════════════════════════════════════════════════════════════════════
// CCTS
// ══════════════════════════════════════════════════════════════════════════════
export const cctsAPI = {
  getProfile:  ()     => apiFetch('/api/ccts/profile'),
  saveProfile: (body) => apiFetch('/api/ccts/profile', { method: 'POST', body: JSON.stringify(body) }),
  getMonthlyData:    (year)       => apiFetch(`/api/ccts/monthly${qs({ year })}`),
  saveMonthlyData:   (year, body) => apiFetch('/api/ccts/monthly', { method: 'POST', body: JSON.stringify({ year, ...body }) }),
  getAcvaStatus:     ()     => apiFetch('/api/ccts/acva/status'),
  submitAcvaRequest: (body) => apiFetch('/api/ccts/acva/submit', { method: 'POST', body: JSON.stringify(body) }),
  getRegistryStatus: ()     => apiFetch('/api/ccts/registry/status'),
  submitToRegistry:  (body) => apiFetch('/api/ccts/registry/submit', { method: 'POST', body: JSON.stringify(body) }),
  exportForm: (formType)    => apiFetch(`/api/ccts/forms/${formType}/export`),
};

// ══════════════════════════════════════════════════════════════════════════════
// BRSR
// ══════════════════════════════════════════════════════════════════════════════
export const brsrAPI = {
  getEnvironmental:  (year)        => apiFetch(`/api/brsr/environmental${qs({ year })}`),
  saveEnvironmental: (year, body)  => apiFetch('/api/brsr/environmental', { method: 'POST', body: JSON.stringify({ year, ...body }) }),
  getSummary:        (year)        => apiFetch(`/api/brsr/summary${qs({ year })}`),
  getForm:  (formCode, year)       => apiFetch(`/api/brsr/forms/${formCode}${qs({ year })}`),
  saveForm: (formCode, year, body) => apiFetch(`/api/brsr/forms/${formCode}`, { method: 'POST', body: JSON.stringify({ year, ...body }) }),
  autoPopulate: (year) => apiFetch(`/api/brsr/auto-populate/${year}`),
  esgSummary:   (year) => apiFetch(`/api/brsr/esg-summary/${year}`),
};

// ══════════════════════════════════════════════════════════════════════════════
// AUDIT
// ══════════════════════════════════════════════════════════════════════════════
export const auditAPI = {
  getVerifiers:    (year)       => apiFetch(`/api/audit/verifiers${qs({ year })}`),
  requestVerifier: (body)       => apiFetch('/api/audit/verifiers', { method: 'POST', body: JSON.stringify(body) }),
  updateVerifier:  (id, body)   => apiFetch(`/api/audit/verifiers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeVerifier:  (id)         => apiFetch(`/api/audit/verifiers/${id}`, { method: 'DELETE' }),
  getLogs:         (p = {})     => apiFetch(`/api/audit/logs${qs(p)}`),
  getLog:          (id)         => apiFetch(`/api/audit/logs/${id}`),
  getStatements:   (year)       => apiFetch(`/api/audit/statements${qs({ year })}`),
  uploadStatement: (formData)   => apiFetchMultipart('/api/audit/statements', formData),

  // [FEAT-LEDGER-CHAIN] Lightweight per-user ledger chain (ghg_ledger_chain table).
  // GHGLedger.jsx uses these to read and write the Chain Log panel.
  getChain:   ({ year, limit = 50 } = {}) => apiFetch(`/api/audit/chain${qs({ year, limit })}`),
  writeChain: (payload)                   => apiFetch('/api/audit/chain', { method: 'POST', body: JSON.stringify(payload) }),
};

// ══════════════════════════════════════════════════════════════════════════════
// AUDITOR ACCESS
// ══════════════════════════════════════════════════════════════════════════════
export const auditorAccessAPI = {
  generateToken : ({ auditor_email, auditor_firm, expires_days, package: pkg, year }) =>
    apiFetch('/api/audit/auditor-token', {
      method: 'POST',
      body:   JSON.stringify({ auditor_email, auditor_firm, expires_days, package: pkg, year }),
    }),
  listTokens  : ()   => apiFetch('/api/audit/auditor-tokens'),
  revokeToken : (id) => apiFetch(`/api/audit/auditor-tokens/${id}`, { method: 'DELETE' }),
};

// ══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════════════════════
export const reportsAPI = {
  generate: async (payload) => {
    await ensureCsrfCookie();
    const res = await fetch(`${BASE}/api/reports/generate`, {
      method:      'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let errMsg = `Server error ${res.status}`;
      try { const j = await res.json(); errMsg = j.error || errMsg; } catch {}
      throw Object.assign(new Error(errMsg), { status: res.status });
    }
    return res;
  },
  generateGEI: (payload) =>
    apiFetch('/api/reports/gei', { method: 'POST', body: JSON.stringify(payload) }),
};

// ══════════════════════════════════════════════════════════════════════════════
// SBTi
// ══════════════════════════════════════════════════════════════════════════════
export const sbtiAPI = {
  getTargets:  ()     => apiFetch('/api/sbti/targets'),
  saveTargets: (body) => apiFetch('/api/sbti/targets', { method: 'POST', body: JSON.stringify(body) }),
  getProgress: (year) => apiFetch(`/api/sbti/progress${qs({ year })}`),
};

// ══════════════════════════════════════════════════════════════════════════════
// ACTION PLAN
// ══════════════════════════════════════════════════════════════════════════════
export const actionPlanAPI = {
  getPlan:         ()     => apiFetch('/api/action-plan'),
  savePlan:        (body) => apiFetch('/api/action-plan', { method: 'POST', body: JSON.stringify(body) }),
  getMRVCalendar:  ()     => apiFetch('/api/action-plan/mrv-calendar'),
  saveMRVCalendar: (body) => apiFetch('/api/action-plan/mrv-calendar', { method: 'POST', body: JSON.stringify(body) }),
};

// ══════════════════════════════════════════════════════════════════════════════
// SUPPLIERS
// ══════════════════════════════════════════════════════════════════════════════
export const supplierAPI = {
  getSuppliers:     (p = {})   => apiFetch(`/api/suppliers${qs(p)}`),
  getSupplier:      (id)       => apiFetch(`/api/suppliers/${id}`),
  inviteSupplier:   (body)     => apiFetch('/api/suppliers/invite', { method: 'POST', body: JSON.stringify(body) }),
  saveSupplierData: (id, body) => apiFetch(`/api/suppliers/${id}/data`, { method: 'POST', body: JSON.stringify(body) }),
  getSupplierData:  (id, year) => apiFetch(`/api/suppliers/${id}/data${qs({ year })}`),
  removeSupplier:   (id)       => apiFetch(`/api/suppliers/${id}`, { method: 'DELETE' }),
};

// ══════════════════════════════════════════════════════════════════════════════
// MULTI-ENTITY
// ══════════════════════════════════════════════════════════════════════════════
export const multiEntityAPI = {
  getEntities:      ()           => apiFetch('/api/multi-entity/entities'),
  addEntity:        (body)       => apiFetch('/api/multi-entity/entities', { method: 'POST', body: JSON.stringify(body) }),
  removeEntity:     (id)         => apiFetch(`/api/multi-entity/entities/${id}`, { method: 'DELETE' }),
  getConsolidated:  (year)       => apiFetch(`/api/multi-entity/consolidated${qs({ year })}`),
  saveConsolidated: (year, body) => apiFetch('/api/multi-entity/consolidated', { method: 'POST', body: JSON.stringify({ year, ...body }) }),
};

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════════════
export const notificationsAPI = {
  getAll:      (p = {}) => apiFetch(`/api/notifications${qs(p)}`),
  markRead:    (id)     => apiFetch(`/api/notifications/${id}/read`,  { method: 'PATCH' }),
  markAllRead: ()       => apiFetch('/api/notifications/read-all',    { method: 'PATCH' }),
  deleteOne:   (id)     => apiFetch(`/api/notifications/${id}`,       { method: 'DELETE' }),
};

// ══════════════════════════════════════════════════════════════════════════════
// SUPPORT
// ══════════════════════════════════════════════════════════════════════════════
export const supportAPI = {
  raiseTicket    : (body) => apiFetch('/api/support/tickets',    { method: 'POST', body: JSON.stringify(body) }),
  logFeedback    : (body) => apiFetch('/api/support/feedback',   { method: 'POST', body: JSON.stringify(body) }),
  logUnanswered  : (body) => apiFetch('/api/support/unanswered', { method: 'POST', body: JSON.stringify(body) }),
  getTickets     : (p = {})   => apiFetch(`/api/support/tickets${qs(p)}`),
  updateTicket   : (id, body) => apiFetch(`/api/support/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getAnalytics   : ()         => apiFetch('/api/support/analytics'),
};

export default apiFetch;