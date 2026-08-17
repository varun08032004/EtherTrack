// src/__tests__/hooks/useWatchlist.test.js — useWatchlist hook tests
import { act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useWatchlist } from '../../hooks/useWatchlist';
import { vi } from 'vitest';

// Mock the API
vi.mock('../../services/api', () => ({
  portfolioAPI: {
    getWatchlist: vi.fn(),
    addToWatchlist: vi.fn(),
    removeFromWatchlist: vi.fn(),
  },
}));

import { portfolioAPI } from '../../services/api';

describe('useWatchlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('initial state has empty watchlist and loading true', () => {
    portfolioAPI.getWatchlist.mockResolvedValue({ watchlist: [] });
    
    const { result } = renderHook(() => useWatchlist());
    
    expect(result.current.watchlist).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  test('loads watchlist from server on mount', async () => {
    portfolioAPI.getWatchlist.mockResolvedValue({ watchlist: [1, 2, 3] });
    
    const { result } = renderHook(() => useWatchlist());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    expect(result.current.watchlist).toEqual([1, 2, 3]);
    expect(portfolioAPI.getWatchlist).toHaveBeenCalledTimes(1);
  });

  test('handles API error gracefully', async () => {
    portfolioAPI.getWatchlist.mockRejectedValue(new Error('Not logged in'));
    
    const { result } = renderHook(() => useWatchlist());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    expect(result.current.watchlist).toEqual([]);
  });

  test('toggleWatchlist adds item optimistically', async () => {
    portfolioAPI.getWatchlist.mockResolvedValue({ watchlist: [] });
    portfolioAPI.addToWatchlist.mockResolvedValue({ success: true });
    
    const { result } = renderHook(() => useWatchlist());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    await act(async () => {
      await result.current.toggleWatchlist(1);
    });
    
    expect(result.current.watchlist).toEqual([1]);
    expect(portfolioAPI.addToWatchlist).toHaveBeenCalledWith(1);
  });

  test('toggleWatchlist removes item optimistically', async () => {
    portfolioAPI.getWatchlist.mockResolvedValue({ watchlist: [1, 2, 3] });
    portfolioAPI.removeFromWatchlist.mockResolvedValue({ success: true });
    
    const { result } = renderHook(() => useWatchlist());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    await act(async () => {
      await result.current.toggleWatchlist(2);
    });
    
    expect(result.current.watchlist).toEqual([1, 3]);
    expect(portfolioAPI.removeFromWatchlist).toHaveBeenCalledWith(2);
  });

  test('rollback on API error when adding', async () => {
    portfolioAPI.getWatchlist.mockResolvedValue({ watchlist: [] });
    portfolioAPI.addToWatchlist.mockRejectedValue(new Error('API error'));
    
    const { result } = renderHook(() => useWatchlist());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    await act(async () => {
      await result.current.toggleWatchlist(1);
    });
    
    // Should rollback to empty
    expect(result.current.watchlist).toEqual([]);
  });

  test('rollback on API error when removing', async () => {
    portfolioAPI.getWatchlist.mockResolvedValue({ watchlist: [1, 2, 3] });
    portfolioAPI.removeFromWatchlist.mockRejectedValue(new Error('API error'));
    
    const { result } = renderHook(() => useWatchlist());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    await act(async () => {
      await result.current.toggleWatchlist(2);
    });
    
    // Should rollback to include the removed item (order may vary)
    expect(result.current.watchlist).toContain(1);
    expect(result.current.watchlist).toContain(2);
    expect(result.current.watchlist).toContain(3);
    expect(result.current.watchlist.length).toBe(3);
  });

  test('toggleWatchlist function is stable', async () => {
    portfolioAPI.getWatchlist.mockResolvedValue({ watchlist: [] });
    
    const { result, rerender } = renderHook(() => useWatchlist());
    
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    
    const toggleRef = result.current.toggleWatchlist;
    
    rerender();
    
    expect(result.current.toggleWatchlist).toBe(toggleRef);
  });
});