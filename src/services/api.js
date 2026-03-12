// EtherTrack Backend API Service
const BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// ── tokenStorage is now a no-op — auth handled via httpOnly cookies ─
export const tokenStorage = {
  getAccess:  () => null,
  getRefresh: () => null,
  setTokens:  () => {},
  setUser:    () => {},
  getUser:    () => null,
  clear:      () => {},
};

// ── Guard against logout loop ─────────────────────────────────────
let _loggingOut = false;

// ── Core fetch — cookies sent automatically by browser ────────────
export const apiFetch = async (path, options = {}, retry = true) => {
  // Never intercept auth routes themselves (prevents loops)
  const isAuthRoute = path.startsWith('/api/auth/');

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'include', // ← sends httpOnly cookies automatically
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });

  // Auto-refresh on 401 — but not for auth routes or during logout
  if (res.status === 401 && retry && !isAuthRoute && !_loggingOut) {
    const refreshRes = await fetch(`${BASE}/api/auth/refresh`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
    });

    if (refreshRes.ok) {
      // Backend set new cookies — retry original request
      return apiFetch(path, options, false);
    } else {
      // Refresh failed — fire logout once, never loop
      if (!_loggingOut) {
        _loggingOut = true;
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
  syncUser: (body) => apiFetch('/api/auth/firebase-sync', {
    method: 'POST', body: JSON.stringify(body),
  }),
  me:     () => apiFetch('/api/auth/me'),
  logout: () => apiFetch('/api/auth/logout', { method: 'POST' }),
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