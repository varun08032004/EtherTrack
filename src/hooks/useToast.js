// src/hooks/useToast.js
// Fixes:
//  - Memory leak: clearTimeout on unmount
//  - showToast wrapped in useCallback so child memo works correctly
//  - Multiple rapid toasts don't stack timers

import { useState, useCallback, useRef, useEffect } from 'react';

export function useToast(duration = 4500) {
  const [toast,        setToast]   = useState(null);
  const timerRef = useRef(null);

  // Cleanup on unmount — prevents setState on unmounted component
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const showToast = useCallback((msg, type = 'success') => {
    // Cancel any in-flight toast timer before setting a new one
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ msg, type });
    timerRef.current = setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, duration);
  }, [duration]);

  const dismissToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  return { toast, showToast, dismissToast };
}