// context/NotificationContext.js
// Real-time notifications — polls /api/notifications + SSE stream
// ─────────────────────────────────────────────────────────────────

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { tokenStorage } from '../services/api';

const NotificationContext = createContext();

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// ── Notification types ────────────────────────────────────────────
export const NOTIF_TYPES = {
  TRADE:      'TRADE',
  PRICE:      'PRICE',
  KYC:        'KYC',
  EMISSION:   'EMISSION',
  WALLET:     'WALLET',
  SYSTEM:     'SYSTEM',
  CREDIT:     'CREDIT',
  COMPLIANCE: 'COMPLIANCE',
  TEAM:       'TEAM',
};

const TYPE_META = {
  TRADE:      { icon: '📈', color: '#22c55e', label: 'Trade'      },
  PRICE:      { icon: '💹', color: '#facc15', label: 'Price'      },
  KYC:        { icon: '🔐', color: '#60a5fa', label: 'KYC'        },
  EMISSION:   { icon: '🌿', color: '#34d399', label: 'Emission'   },
  WALLET:     { icon: '💰', color: '#a78bfa', label: 'Wallet'     },
  SYSTEM:     { icon: '⚙️', color: '#94a3b8', label: 'System'     },
  CREDIT:     { icon: '🪙', color: '#f59e0b', label: 'Credit'     },
  COMPLIANCE: { icon: '🚩', color: '#f87171', label: 'Compliance' },
  TEAM:       { icon: '👥', color: '#c084fc', label: 'Team'       },
};

// ── API helpers ───────────────────────────────────────────────────
const authHeader = () => ({
  'Content-Type':  'application/json',
  'Authorization': `Bearer ${tokenStorage.getAccess()}`,
});

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used inside NotificationProvider');
  return ctx;
};

// ── Provider ──────────────────────────────────────────────────────
export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);
  const [loading,       setLoading]       = useState(false);
  const sseRef   = useRef(null);
  const pollRef  = useRef(null);
  const mountRef = useRef(true);

  // ── Fetch from backend ──────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    const token = tokenStorage.getAccess();
    if (!token) return;
    try {
      setLoading(true);
      const res  = await fetch(`${API}/api/notifications?limit=50`, { headers: authHeader() });
      if (!res.ok) return;
      const data = await res.json();
      if (!mountRef.current) return;
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount    || 0);
    } catch {}
    finally { if (mountRef.current) setLoading(false); }
  }, []);

  // ── SSE real-time stream ────────────────────────────────────────
  const connectSSE = useCallback(() => {
    const token = tokenStorage.getAccess();
    if (!token || sseRef.current) return;

    try {
      const es = new EventSource(`${API}/api/notifications/stream?token=${token}`);
      sseRef.current = es;

      es.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          if (parsed.event === 'notification' && parsed.data) {
            // Prepend new notification without full refetch
            setNotifications(prev => [parsed.data, ...prev]);
            setUnreadCount(prev => prev + 1);
          }
        } catch {}
      };

      es.onerror = () => {
        es.close();
        sseRef.current = null;
        // Reconnect after 5s on error
        if (mountRef.current) setTimeout(connectSSE, 5000);
      };
    } catch {}
  }, []);

  // SSE with token in header isn't natively supported by EventSource
  // So we pass token as query param — update your SSE route to accept it:
  // router.get('/stream', (req, res, next) => {
  //   if (req.query.token) req.headers.authorization = `Bearer ${req.query.token}`;
  //   next();
  // }, authenticate, ...)

  // ── Start polling + SSE on mount ────────────────────────────────
  useEffect(() => {
    mountRef.current = true;
    fetchNotifications();
    connectSSE();

    // Poll every 30s as fallback (catches anything SSE misses)
    pollRef.current = setInterval(fetchNotifications, 30000);

    return () => {
      mountRef.current = false;
      clearInterval(pollRef.current);
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    };
  }, [fetchNotifications, connectSSE]);

  // ── Actions ─────────────────────────────────────────────────────
  const markRead = useCallback(async (id) => {
    // Optimistic update
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
    try {
      await fetch(`${API}/api/notifications/${id}/read`, {
        method: 'PUT', headers: authHeader(),
      });
    } catch {}
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      await fetch(`${API}/api/notifications/read-all`, {
        method: 'PUT', headers: authHeader(),
      });
    } catch {}
  }, []);

  const deleteOne = useCallback(async (id) => {
    const n = notifications.find(x => x.id === id);
    setNotifications(prev => prev.filter(x => x.id !== id));
    if (n && !n.read) setUnreadCount(prev => Math.max(0, prev - 1));
    try {
      await fetch(`${API}/api/notifications/${id}`, {
        method: 'DELETE', headers: authHeader(),
      });
    } catch {}
  }, [notifications]);

  const clearAll = useCallback(async () => {
    setNotifications([]);
    setUnreadCount(0);
    try {
      await fetch(`${API}/api/notifications`, {
        method: 'DELETE', headers: authHeader(),
      });
    } catch {}
  }, []);

  // addNotification — for local/frontend triggered notifications
  // (backend-generated ones come via SSE or polling automatically)
  const addNotification = useCallback(({ type, title, message, link, meta }) => {
    const n = {
      id:         `local-${Date.now()}`,
      type:       type || 'SYSTEM',
      title,
      message,
      link:       link || null,
      meta:       meta || {},
      read:       false,
      created_at: new Date().toISOString(),
    };
    setNotifications(prev => [n, ...prev]);
    setUnreadCount(prev => prev + 1);
  }, []);

  const getTypeMeta = useCallback((type) => TYPE_META[type] || TYPE_META.SYSTEM, []);

  const timeAgo = useCallback((ts) => {
    const now  = Date.now();
    const time = typeof ts === 'string' ? new Date(ts).getTime() : ts;
    const d    = now - time;
    const m    = Math.floor(d / 60000);
    const h    = Math.floor(d / 3600000);
    const day  = Math.floor(d / 86400000);
    if (m < 1)   return 'Just now';
    if (m < 60)  return `${m}m ago`;
    if (h < 24)  return `${h}h ago`;
    if (day < 7) return `${day}d ago`;
    return new Date(time).toLocaleDateString('en-IN', { day:'2-digit', month:'short' });
  }, []);

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      loading,
      addNotification,
      markRead,
      markAllRead,
      deleteOne,
      clearAll,
      getTypeMeta,
      timeAgo,
      NOTIF_TYPES,
      refresh: fetchNotifications,
    }}>
      {children}
    </NotificationContext.Provider>
  );
};

export default NotificationContext;