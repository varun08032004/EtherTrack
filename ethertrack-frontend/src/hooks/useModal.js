// src/hooks/useModal.js
// Provides:
//  - Escape key to close
//  - Focus trap inside modal
//  - Body scroll lock while open
//  - aria-modal + role="dialog" helpers

import { useEffect, useRef, useCallback } from 'react';

/**
 * @param {boolean} isOpen
 * @param {function} onClose
 * @returns {{ modalRef, overlayProps, dialogProps }}
 */
export function useModal(isOpen, onClose) {
  const modalRef = useRef(null);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Focus trap — keep focus inside modal
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    const modal    = modalRef.current;
    const focusable = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    // Auto-focus first focusable element
    first?.focus();

    const handleTab = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  // Click outside to close
  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const overlayProps = {
    onClick: handleOverlayClick,
    style: {
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,.88)', backdropFilter: 'blur(6px)',
      zIndex: 3000, display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    },
  };

  const dialogProps = {
    ref: modalRef,
    role: 'dialog',
    'aria-modal': true,
  };

  return { modalRef, overlayProps, dialogProps };
}