// src/hooks/useRealtimeSync.js
// WebSocket hook for real-time portfolio updates across team members.
// When one user retires/lists/delists a credit, all org members see it instantly.
//
// Backend setup required — see backend/services/socketServer.js
// Install frontend: npm install socket.io-client

import { useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { tokenStorage } from '../services/api';

/**
 * @param {object} params
 * @param {string|null} params.orgId       — org to subscribe to, null = solo user
 * @param {function}    params.onUpdate    — called when portfolio changes remotely
 * @param {function}    params.showToast   — for connection status messages
 */
export function useRealtimeSync({ orgId, onUpdate, showToast }) {
  const socketRef    = useRef(null);
  const reconnectRef = useRef(0);

  const connect = useCallback(() => {
    const token = tokenStorage.getAccess();
    if (!token || !orgId) return;

    const socket = io(process.env.REACT_APP_API_URL || 'http://localhost:5000', {
      auth:              { token },
      transports:        ['websocket'],
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => {
      reconnectRef.current = 0;
      socket.emit('join:org', { orgId });
    });

    socket.on('portfolio:updated', (payload) => {
      // Remote change — refresh the relevant data
      onUpdate?.(payload);

      const messages = {
        RETIREMENT:    `🔥 Credit retired by team member`,
        LISTED:        `📈 Credit listed on marketplace`,
        DELISTED:      `📉 Credit removed from marketplace`,
        CREDIT_ADDED:  `✅ New credit approved`,
        RETIRE_REQUEST:`⏳ New retirement request submitted`,
      };
      const msg = messages[payload?.type];
      if (msg) showToast?.(msg);
    });

    socket.on('retirement:approved', (payload) => {
      onUpdate?.({ type: 'RETIREMENT', ...payload });
      showToast?.(`✅ Retirement approved — cert ${payload.certId}`);
    });

    socket.on('connect_error', (err) => {
      console.error('[useRealtimeSync] connect error:', err.message);
      reconnectRef.current += 1;
      // After 3 failed reconnects, stop showing errors silently
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // Server kicked us — try to reconnect manually
        setTimeout(() => socket.connect(), 3000);
      }
    });

    socketRef.current = socket;
  }, [orgId, onUpdate, showToast]);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [connect]);

  return {
    isConnected: () => socketRef.current?.connected ?? false,
  };
}