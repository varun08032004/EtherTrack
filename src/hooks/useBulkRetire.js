// src/hooks/useBulkRetire.js
// Manages multi-select state and bulk retirement flow for the credit grid.

import { useState, useCallback, useMemo } from 'react';

export function useBulkRetire({ allCredits, can, showToast }) {
  const [selected,       setSelected]       = useState(new Set());
  const [showBulkModal,  setShowBulkModal]  = useState(false);

  // Only retirable credits can be selected
  // (minted, approved, not already retired/pending)
  const selectableIds = useMemo(() =>
    new Set(
      allCredits
        .filter(c =>
          !c.isPending && !c.isRejected &&
          c.status !== 'RETIRED' &&
          c.isOnChain && c.tokenId != null
        )
        .map(c => String(c.id))
    ),
  [allCredits]);

  const toggle = useCallback((id) => {
    const sid = String(id);
    if (!selectableIds.has(sid)) return;
    setSelected(prev => {
      const next = new Set(prev);
      next.has(sid) ? next.delete(sid) : next.add(sid);
      return next;
    });
  }, [selectableIds]);

  const selectAll = useCallback(() => {
    setSelected(new Set(selectableIds));
  }, [selectableIds]);

  const clearAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const selectedCredits = useMemo(() =>
    allCredits.filter(c => selected.has(String(c.id))),
  [allCredits, selected]);

  const totalSelected = useMemo(() =>
    selectedCredits.reduce((s, c) => s + (c.heldCredits || c.credits || 0), 0),
  [selectedCredits]);

  const openBulkRetire = useCallback(() => {
    if (selected.size === 0) {
      showToast('❌ Select at least one credit to retire', 'error');
      return;
    }
    if (!can('portfolio:retire')) {
      showToast('❌ You need Admin or Owner role to retire credits', 'error');
      return;
    }
    setShowBulkModal(true);
  }, [selected, can, showToast]);

  return {
    selected,
    selectedCredits,
    totalSelected,
    showBulkModal,
    selectableIds,
    toggle,
    selectAll,
    clearAll,
    openBulkRetire,
    closeBulkModal: () => setShowBulkModal(false),
    hasSelection: selected.size > 0,
  };
}