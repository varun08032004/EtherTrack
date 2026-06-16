// src/hooks/useWatchlist.js
// Persists watchlist to server. No state loss on refresh.
import { useState, useEffect, useCallback } from 'react';
import { portfolioAPI } from '../services/api';

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState([]);
  const [loading,   setLoading]   = useState(false);

  // Load from server on mount
  useEffect(() => {
    setLoading(true);
    portfolioAPI.getWatchlist()
      .then(data => { if (data?.watchlist) setWatchlist(data.watchlist); })
      .catch(() => {}) // not logged in — empty watchlist is fine
      .finally(() => setLoading(false));
  }, []);

  const toggleWatchlist = useCallback(async (listingId) => {
    const isWatched = watchlist.includes(listingId);
    // Optimistic update
    setWatchlist(prev => isWatched ? prev.filter(x => x !== listingId) : [...prev, listingId]);
    try {
      if (isWatched) await portfolioAPI.removeFromWatchlist(listingId);
      else           await portfolioAPI.addToWatchlist(listingId);
    } catch {
      // Rollback on error
      setWatchlist(prev => isWatched ? [...prev, listingId] : prev.filter(x => x !== listingId));
    }
  }, [watchlist]);

  return { watchlist, toggleWatchlist, loading };
}