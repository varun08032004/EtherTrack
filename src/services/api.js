// EtherTrack Backend API Service
const BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// ── Token storage ─────────────────────────────────────────────────
// Used in ALL environments — fixes localhost cross-origin cookie problem.
// On localhost, frontend (3000) and backend (5000) are different origins,
// so httpOnly cookies are never sent even with credentials:'include'.
// Solution: always use Authorization header with tokens stored in localStorage.
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

// ── Guard against logout loop ─────────────────────────────────────
let _loggingOut  = false;
let _refreshing  = false;
let _refreshWait = null;

// ── Core fetch ────────────────────────────────────────────────────
export const apiFetch = async (path, options = {}, retry = true) => {
  const isAuthRoute    = path.startsWith('/api/auth/');
  const isRefreshRoute = path === '/api/auth/refresh';

  // Always send access token as Authorization header
  const accessToken = tokenStorage.getAccess();
  const authHeader  = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include', // still useful for same-origin / cookie fallback
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...options.headers,
    },
  });

  // ── Auto-refresh on 401 ───────────────────────────────────────
  if (res.status === 401 && retry && !isAuthRoute && !_loggingOut) {

    // Deduplicate concurrent refresh calls
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
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ refreshToken }),
      });

      if (refreshRes.ok) {
        const refreshData = await refreshRes.json().catch(() => ({}));
        // Store new tokens returned in body
        if (refreshData.accessToken) {
          tokenStorage.setTokens(refreshData.accessToken, refreshData.refreshToken);
        }
        resolveRefresh();
        _refreshing  = false;
        _refreshWait = null;
        return apiFetch(path, options, false);
      } else {
        throw new Error('Refresh failed');
      }
    } catch {
      resolveRefresh?.();
      _refreshing  = false;
      _refreshWait = null;
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
  register:   (body) => apiFetch('/api/auth/register',     { method:'POST', body:JSON.stringify(body) }),
  verifyEmail:(body) => apiFetch('/api/auth/verify-email', { method:'POST', body:JSON.stringify(body) }),
  login: async (body) => {
    const data = await apiFetch('/api/auth/login', { method:'POST', body:JSON.stringify(body) });
    // Store tokens returned in response body
    if (data?.accessToken)  tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data;
  },
  syncUser: async (body) => {
    const data = await apiFetch('/api/auth/firebase-sync', { method:'POST', body:JSON.stringify(body) });
    if (data?.accessToken) tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data;
  },
  me: () => apiFetch('/api/auth/me'),
  logout: async () => {
    try { await apiFetch('/api/auth/logout', { method:'POST' }); } catch {}
    tokenStorage.clear();
  },
};

// ══════════════════════════════════════════════════════════════════
// WALLET
// ══════════════════════════════════════════════════════════════════
export const walletAPI = {
  challenge: ()     => apiFetch('/api/wallet/challenge'),
  bind:      (body) => apiFetch('/api/wallet/bind',  { method:'POST', body:JSON.stringify(body) }),
  status:    ()     => apiFetch('/api/wallet/status'),
  syncKYC:   (body) => apiFetch('/api/wallet/kyc',   { method:'POST', body:JSON.stringify(body) }),
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