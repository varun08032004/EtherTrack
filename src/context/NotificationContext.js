import React, { createContext, useContext, useState, useCallback } from 'react';

// ── Context ──────────────────────────────────────────────
const NotificationContext = createContext();

// ── Hook — named export ──────────────────────────────────
export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used inside NotificationProvider');
  }
  return context;
};

// ── Types ────────────────────────────────────────────────
export const NOTIF_TYPES = {
  TRADE:    'TRADE',
  PRICE:    'PRICE',
  KYC:      'KYC',
  EMISSION: 'EMISSION',
  WALLET:   'WALLET',
  SYSTEM:   'SYSTEM',
};

const TYPE_META = {
  TRADE:    { icon: '📈', color: '#22c55e', label: 'Trade'    },
  PRICE:    { icon: '💹', color: '#facc15', label: 'Price'    },
  KYC:      { icon: '🔐', color: '#60a5fa', label: 'KYC'      },
  EMISSION: { icon: '🌿', color: '#34d399', label: 'Emission' },
  WALLET:   { icon: '👛', color: '#a78bfa', label: 'Wallet'   },
  SYSTEM:   { icon: '⚙️', color: '#94a3b8', label: 'System'   },
};

// ── Seed data ────────────────────────────────────────────
const SEED = [
  { id: 1, type: 'TRADE',    title: 'Buy Order Executed',        message: 'Bought 10 VCS-4821 credits at ₹842/unit',   time: Date.now() - 1000*60*5,   read: false },
  { id: 2, type: 'KYC',      title: 'KYC Verification Pending',  message: 'Complete KYC to unlock trading features',   time: Date.now() - 1000*60*30,  read: false },
  { id: 3, type: 'PRICE',    title: 'Price Alert: VCS-4821',     message: 'VCS-4821 rose 3.2% to ₹869 in last 1hr',   time: Date.now() - 1000*60*60,  read: true  },
  { id: 4, type: 'EMISSION', title: 'Monthly Emission Reminder', message: 'Log your September emission data now',      time: Date.now() - 1000*3600*3, read: true  },
  { id: 5, type: 'WALLET',   title: 'Wallet Connected',          message: 'MetaMask connected to Polygon Mumbai',     time: Date.now() - 1000*3600*5, read: true  },
  { id: 6, type: 'TRADE',    title: 'Sell Order Executed',       message: 'Sold 5 REDD-1193 credits at ₹1,238/unit', time: Date.now() - 1000*3600*8, read: true  },
];

// ── Provider — named export ──────────────────────────────
export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState(SEED);

  const unreadCount = notifications.filter(n => !n.read).length;

  const addNotification = useCallback(({ type, title, message }) => {
    setNotifications(prev => [{
      id:      Date.now(),
      type:    type || 'SYSTEM',
      title,
      message,
      time:    Date.now(),
      read:    false,
    }, ...prev]);
  }, []);

  const markRead = useCallback((id) =>
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    ), []);

  const markAllRead = useCallback(() =>
    setNotifications(prev => prev.map(n => ({ ...n, read: true }))), []);

  const deleteOne = useCallback((id) =>
    setNotifications(prev => prev.filter(n => n.id !== id)), []);

  const clearAll = useCallback(() => setNotifications([]), []);

  const getTypeMeta = useCallback((type) =>
    TYPE_META[type] || TYPE_META.SYSTEM, []);

  const timeAgo = useCallback((ts) => {
    const d   = Date.now() - ts;
    const m   = Math.floor(d / 60000);
    const h   = Math.floor(d / 3600000);
    const day = Math.floor(d / 86400000);
    if (m < 1)   return 'Just now';
    if (m < 60)  return `${m}m ago`;
    if (h < 24)  return `${h}h ago`;
    return `${day}d ago`;
  }, []);

  const value = {
    notifications,
    unreadCount,
    addNotification,
    markRead,
    markAllRead,
    deleteOne,
    clearAll,
    getTypeMeta,
    timeAgo,
    NOTIF_TYPES,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

// ── Default export (context itself, in case needed) ──────
export default NotificationContext;