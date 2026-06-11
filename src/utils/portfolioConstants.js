// src/hooks/usePortfolioData.js
// Extracts all data fetching, derived credit lists, and computed stat totals
// from PortfolioV3 into a clean, testable hook.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../services/api';
import { vintagePenalty } from '../context/PortfolioContext';
import { REFERENCE_PRICES, STANDARD_PREMIUM } from '../utils/portfolioConstants';

export function usePortfolioData({ myCredits, myBoughtCredits, myRetirements }) {

  const [pendingCredits, setPendingCredits] = useState([]);
  const [emissionsData,  setEmissionsData]  = useState(null);
  const [ethPriceInr,    setEthPriceInr]    = useState(null);
  const [watchlist,      setWatchlist]      = useState([]);
  const [watchlistError, setWatchlistError] = useState(false);

  // ── Loaders ──────────────────────────────────────────────────

  const loadPendingCredits = useCallback(async () => {
    try {
      const d = await apiFetch('/api/portfolio/my-submissions');
      setPendingCredits(d?.submissions || []);
    } catch (err) {
      console.error('[loadPendingCredits]', err);
    }
  }, []);

  const loadEmissionsData = useCallback(async () => {
    try {
      const year = new Date().getFullYear();
      const d    = await apiFetch(`/api/portfolio/emissions-summary?year=${year}`);
      if (d) setEmissionsData({ ...d, year });
    } catch (err) {
      console.error('[loadEmissionsData]', err);
    }
  }, []);

  const fetchEthPrice = useCallback(async () => {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr');
      const d = await r.json();
      if (d?.ethereum?.inr) setEthPriceInr(d.ethereum.inr);
    } catch (err) {
      console.error('[fetchEthPrice]', err);
    }
  }, []);

  // [FIX-4] No localStorage fallback — shows error state if API fails
  const loadWatchlist = useCallback(async () => {
    try {
      const d = await apiFetch('/api/portfolio/watchlist');
      setWatchlist(d?.items || []);
      setWatchlistError(false);
    } catch (err) {
      console.error('[loadWatchlist]', err);
      setWatchlist([]);
      setWatchlistError(true);
    }
  }, []);

  // ── Bootstrap & polling ──────────────────────────────────────

  useEffect(() => {
    loadPendingCredits();
    loadEmissionsData();
    fetchEthPrice();
    loadWatchlist();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ^ intentional mount-only; all loaders are stable callbacks

  useEffect(() => {
    const id = setInterval(fetchEthPrice, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchEthPrice]);

  // ── Derived credit lists ──────────────────────────────────────

  const ownedCredits = useMemo(() => [
    ...myCredits,
    ...pendingCredits
      .filter(p => !myCredits.find(c => c.serialNumber === p.registry_serial))
      .map(p => ({
        id: p.id, projectName: p.project_name,
        location: p.project_location || '—', country: p.country || '—',
        standard: p.standard || 'VCS', projectType: p.project_type || '—',
        developer: p.developer || '—', credits: p.quantity,
        vintageYear: p.vintage_year, serialNumber: p.registry_serial,
        projectId: p.project_id || '—', status: 'PENDING',
        admin_status: p.admin_status, admin_notes: p.admin_notes,
        doc_ipfs_hash: p.doc_ipfs_hash, creditType: p.credit_type || 'voluntary',
        cbamEligible: p.cbam_eligible || false, sdgTags: p.sdg_tags || [],
        correspondingAdjustment: p.corresponding_adjustment || 'none',
        icvcm_ccp_eligible: p.icvcm_ccp_eligible || false,
        icvcm_ccp_label: p.icvcm_ccp_label || '',
        methodologyId: p.methodology_id || '',
        registryLink: p.registry_link || '',
        expiryDate: p.expiry_date || '',
        coBenefitsVerified: p.co_benefits_verified || false,
        isPending: true, isRejected: p.admin_status === 'rejected',
      })),
  ], [myCredits, pendingCredits]);

  const normalisedBought = useMemo(() => (myBoughtCredits || []).map(b => ({
    ...b, status: 'HELD', isBought: true,
    heldCredits: b.quantity || b.credits || 0,
    credits: b.quantity || b.credits || 0,
    listedCredits: 0, isOnChain: true, admin_status: 'approved',
    tokenId: b.tokenId || b.token_id || null,
    projectType: b.projectType || b.project_type || 'Renewable Energy',
    creditType: b.creditType || b.credit_type || 'voluntary',
    serialNumber: b.serialNumber || b.registry_serial || b.serial || '—',
    location: b.location || b.project_location || '—',
    country: b.country || '—',
    vintageYear: b.vintageYear || b.vintage_year || new Date().getFullYear() - 1,
    methodologyId: b.methodologyId || b.methodology_id || '',
    registryLink: b.registryLink || b.registry_link || '',
    expiryDate: b.expiryDate || b.expiry_date || '',
    correspondingAdjustment: b.correspondingAdjustment || b.corresponding_adjustment || 'none',
  })), [myBoughtCredits]);

  const allCredits = useMemo(
    () => [...ownedCredits, ...normalisedBought],
    [ownedCredits, normalisedBought]
  );

  // ── Tab counts ───────────────────────────────────────────────

  const tabCounts = useMemo(() => ({
    ALL:      allCredits.length,
    HELD:     ownedCredits.filter(c => c.status === 'HELD').length + normalisedBought.length,
    LISTED:   ownedCredits.filter(c => c.status === 'LISTED').length,
    BOUGHT:   normalisedBought.length,
    RETIRED:  myRetirements.length,
    PENDING:  ownedCredits.filter(c => c.isPending && !c.isRejected).length,
    REJECTED: ownedCredits.filter(c => c.isRejected).length,
  }), [allCredits, ownedCredits, normalisedBought, myRetirements]);

  // ── Stat totals [FIX-1][FIX-2][FIX-3] ──────────────────────
  // All three are now tCO₂ sums — not card counts

  const statTotals = useMemo(() => {
    const active = allCredits.filter(
      c => !c.isPending && !c.isRejected && c.status !== 'RETIRED'
    );

    // FIX-1: total held+listed+bought tCO₂
    const totalTco2 = active.reduce(
      (s, c) => s + Number(c.heldCredits || c.credits || 0), 0
    );

    // FIX-2: listed tCO₂ only
    const listedTco2 = active
      .filter(c => c.status === 'LISTED')
      .reduce((s, c) => s + Number(c.listedCredits || c.credits || 0), 0);

    // FIX-3: single source of truth for portfolio value
    const portfolioValue = active.reduce((s, c) => {
      const dep     = vintagePenalty(c.vintageYear) / 100;
      const base    = REFERENCE_PRICES[c.projectType] || 850;
      const premium = STANDARD_PREMIUM[c.standard]   || 1.0;
      const price   = c.pricePerCredit > 0
        ? c.pricePerCredit * (1 - dep)
        : base * premium * (1 - dep);
      return s + Number(c.heldCredits || c.credits || 0) * price;
    }, 0);

    // Retired tCO₂ from retirements list
    const retiredTco2 = myRetirements.reduce(
      (s, r) => s + Number(r.amount || r.credits || 0), 0
    );

    return { totalTco2, listedTco2, portfolioValue, retiredTco2 };
  }, [allCredits, myRetirements]);

  return {
    // raw
    pendingCredits, emissionsData, ethPriceInr,
    watchlist, watchlistError,
    // derived
    ownedCredits, normalisedBought, allCredits,
    tabCounts, statTotals,
    // loaders
    loadPendingCredits, loadEmissionsData,
    loadWatchlist, fetchEthPrice,
  };
}