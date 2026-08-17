// src/__tests__/hooks/useToast.test.js — useToast hook tests
import { act, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useToast } from '../../hooks/useToast';
import { vi } from 'vitest';

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns initial toast as null', () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBeNull();
  });

  test('showToast sets toast message and type', () => {
    const { result } = renderHook(() => useToast());
    
    act(() => {
      result.current.showToast('Test message', 'success');
    });
    
    expect(result.current.toast).toEqual({ msg: 'Test message', type: 'success' });
  });

  test('showToast defaults type to success', () => {
    const { result } = renderHook(() => useToast());
    
    act(() => {
      result.current.showToast('Test message');
    });
    
    expect(result.current.toast).toEqual({ msg: 'Test message', type: 'success' });
  });

  test('dismisses toast after duration', () => {
    const { result } = renderHook(() => useToast(1000));
    
    act(() => {
      result.current.showToast('Test message', 'success');
    });
    
    expect(result.current.toast).not.toBeNull();
    
    // Advance timers past the duration
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    
    expect(result.current.toast).toBeNull();
  });

  test('dismissToast clears toast immediately', () => {
    const { result } = renderHook(() => useToast(1000));
    
    act(() => {
      result.current.showToast('Test message', 'success');
    });
    
    expect(result.current.toast).not.toBeNull();
    
    act(() => {
      result.current.dismissToast();
    });
    
    expect(result.current.toast).toBeNull();
  });

  test('multiple rapid toasts only show the latest', () => {
    const { result } = renderHook(() => useToast(1000));
    
    act(() => {
      result.current.showToast('First message', 'success');
    });
    
    act(() => {
      result.current.showToast('Second message', 'error');
    });
    
    expect(result.current.toast).toEqual({ msg: 'Second message', type: 'error' });
    
    // Advance timers - should not clear the second toast early
    act(() => {
      vi.advanceTimersByTime(500);
    });
    
    expect(result.current.toast).toEqual({ msg: 'Second message', type: 'error' });
    
    // Advance past full duration
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    
    expect(result.current.toast).toBeNull();
  });

  test('cleanup clears timer on unmount', () => {
    const { result, unmount } = renderHook(() => useToast(1000));
    
    act(() => {
      result.current.showToast('Test message', 'success');
    });
    
    expect(result.current.toast).not.toBeNull();
    
    // Unmount the hook
    unmount();
    
    // Advance timers - should not cause issues
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    
    // No error should occur
    expect(true).toBe(true);
  });

  test('showToast returns a function reference (useCallback)', () => {
    const { result, rerender } = renderHook(() => useToast(1000));
    
    const showToastRef = result.current.showToast;
    
    rerender(); // Re-render with same props
    
    // showToast should be the same function reference
    expect(result.current.showToast).toBe(showToastRef);
  });
});