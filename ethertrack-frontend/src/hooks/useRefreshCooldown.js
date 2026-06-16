/**
 * hooks/useRefreshCooldown.js
 *
 * Manages the refresh button countdown.
 * Isolated in its own hook so the 1-s tick ONLY re-renders
 * the refresh button, not the entire dashboard.
 */

import { useState, useEffect, useCallback } from 'react';
import { REFRESH_COOLDOWN_MS, LS_KEY_REFRESH } from '../constants/dashboard';

export function useRefreshCooldown() {
  const [cooldown, setCooldown] = useState(() => {
    // Initialise from localStorage so the cooldown survives page refresh
    const stored = Number(localStorage.getItem(LS_KEY_REFRESH) || 0);
    const elapsed = Date.now() - stored;
    if (elapsed < REFRESH_COOLDOWN_MS) {
      return Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1_000);
    }
    return 0;
  });

  // Tick every second while active
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1_000);
    return () => clearInterval(id);
  }, [cooldown]);

  /** Start cooldown countdown after a refresh fires. */
  const start = useCallback(() => {
    setCooldown(Math.ceil(REFRESH_COOLDOWN_MS / 1_000));
  }, []);

  return { cooldown, start, canRefresh: cooldown === 0 };
}