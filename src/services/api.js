// EtherTrack Backend API Service
const BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const IS_PROD = process.env.NODE_ENV === 'production';

// ── Token storage — localStorage in prod (cross-domain safe), cookies in dev ──
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
let _loggingOut = false;

// ── Core fetch ────────────────────────────────────────────────────
export const apiFetch = async (path, options = {}, retry = true) => {
  const isAuthRoute = path.startsWith('/api/auth/');

  // In production: send token as Authorization header (cross-domain safe)
  // In dev: rely on cookies
  const accessToken = IS_PROD ? tokenStorage.getAccess() : null;
  const authHeader  = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include', // keep for dev + cookie fallback
    headers: {
      'Content-Type': 'application/json',
      ...authHeader,
      ...options.headers,
    },
  });

  // Auto-refresh on 401
  if (res.status === 401 && retry && !isAuthRoute && !_loggingOut) {
    const refreshToken = IS_PROD ? tokenStorage.getRefresh() : null;

    const refreshRes = await fetch(`${BASE}/api/auth/refresh`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      // Send refresh token in body for cross-domain
      body: refreshToken ? JSON.stringify({ refreshToken }) : undefined,
    });

    if (refreshRes.ok) {
      const refreshData = await refreshRes.json().catch(() => ({}));
      // Store new tokens if returned in body
      if (refreshData.accessToken) {
        tokenStorage.setTokens(refreshData.accessToken, refreshData.refreshToken);
      }
      return apiFetch(path, options, false);
    } else {
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
  syncUser: async (body) => {
    const data = await apiFetch('/api/auth/firebase-sync', {
      method: 'POST', body: JSON.stringify(body),
    });
    // Store tokens from response body (works cross-domain)
    if (data?.accessToken) {
      tokenStorage.setTokens(data.accessToken, data.refreshToken);
    }
    return data;
  },
  me:     () => apiFetch('/api/auth/me'),
  logout: async () => {
    const res = await apiFetch('/api/auth/logout', { method: 'POST' });
    tokenStorage.clear();
    return res;
  },
};

// ══════════════════════════════════════════════════════════════════
// WALLET
// ══════════════════════════════════════════════════════════════════
export const walletAPI = {
  challenge: ()     => apiFetch('/api/wallet/challenge'),
  bind:      (body) => apiFetch('/api/wallet/bind',   { method: 'POST', body: JSON.stringify(body) }),
  status:    ()     => apiFetch('/api/wallet/status'),
  syncKYC:   (body) => apiFetch('/api/wallet/kyc',    { method: 'POST', body: JSON.stringify(body) }),
};

// ══════════════════════════════════════════════════════════════════
// REGISTRY
// ══════════════════════════════════════════════════════════════════
export const registryAPI = {
  getProjects:   (p = {}) => apiFetch('/api/registry/projects?' + new URLSearchParams(p)),
  getProject:    (id)     => apiFetch(`/api/registry/projects/${id}`),
  myProjects:    ()       => apiFetch('/api/registry/my-projects'),
  getBatch:      (tid)    => apiFetch(`/api/registry/batches/token/${tid}`),
  createBatch:   (body)   => apiFetch('/api/registry/batches',                { method: 'POST', body: JSON.stringify(body) }),
  tokeniseBatch: (id, b)  => apiFetch(`/api/registry/batches/${id}/tokenise`, { method: 'POST', body: JSON.stringify(b) }),
};

// ══════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ══════════════════════════════════════════════════════════════════
export const txAPI = {
  getMy:            ()     => apiFetch('/api/transactions/my'),
  getStats:         ()     => apiFetch('/api/transactions/stats'),
  sync:             (body) => apiFetch('/api/transactions/sync',        { method: 'POST', body: JSON.stringify(body) }),
  getRetirements:   ()     => apiFetch('/api/transactions/retirements'),
  recordRetirement: (body) => apiFetch('/api/transactions/retirements', { method: 'POST', body: JSON.stringify(body) }),
  getCertificate:   (cid)  => apiFetch(`/api/transactions/retirements/${cid}`),
};

// ══════════════════════════════════════════════════════════════════
// EMISSIONS
// ══════════════════════════════════════════════════════════════════
export const emissionsAPI = {
  getMy:  ()         => apiFetch('/api/emissions/my'),
  create: (body)     => apiFetch('/api/emissions',       { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => apiFetch(`/api/emissions/${id}`, { method: 'PUT',  body: JSON.stringify(body) }),
};