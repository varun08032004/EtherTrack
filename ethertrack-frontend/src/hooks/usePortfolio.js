// src/hooks/usePortfolio.js
// Extends your existing usePortfolio with the fields PortfolioV3 needs:
//   myBoughtCredits, myRetirements, stats, walletAddress, isKYCVerified,
//   refreshKYC, refreshRetirements, refreshBoughtCredits, loadMyCredits
//
// Your existing contract logic (fetchCredits, registerCredit, retireCredit,
// listCredit, delistCredit) is kept exactly as-is — this file just wraps it.

import { useState, useCallback, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { useContracts } from './useContracts';
import { apiFetch } from '../services/api';
import { STANDARD_ENUM, STANDARD_FROM_ENUM } from '../config/contracts.config';

// ── Vintage depreciation helper (used in PortfolioContext too) ────
// 5% per year for credits older than 3 years, capped at 40%
export const vintagePenalty = (vintageYear) => {
  if (!vintageYear) return 0;
  const age = new Date().getFullYear() - Number(vintageYear);
  if (age <= 3) return 0;
  return Math.min(40, (age - 3) * 5);
};

export function usePortfolio() {
  const { getContracts } = useContracts();

  // ── Existing contract state (unchanged) ──────────────────
  const [credits,   setCredits]   = useState([]);
  const [listings,  setListings]  = useState([]);
  const [loading,   setLoading]   = useState({ credits: false, tx: false });
  const [error,     setError]     = useState('');

  // ── New state for PortfolioV3 ─────────────────────────────
  const [walletAddress,    setWalletAddress]    = useState('');
  const [isKYCVerified,    setIsKYCVerified]    = useState(false);
  const [myBoughtCredits,  setMyBoughtCredits]  = useState([]);
  const [myRetirements,    setMyRetirements]    = useState([]);

  // ── Hydrate wallet on mount ───────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        if (!window.ethereum) return;
        const provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.listAccounts();
        if (accounts.length > 0) setWalletAddress(accounts[0].address);

        window.ethereum.on('accountsChanged', (accs) => {
          setWalletAddress(accs[0] || '');
        });
      } catch (err) {
        console.error('[usePortfolio wallet init]', err);
      }
    };
    init();
    return () => window.ethereum?.removeAllListeners?.('accountsChanged');
  }, []);

  // ── KYC status ───────────────────────────────────────────
  const refreshKYC = useCallback(async () => {
    try {
      const d = await apiFetch('/api/portfolio/kyc-status');
      setIsKYCVerified(d?.verified === true);
    } catch (err) {
      console.error('[refreshKYC]', err);
    }
  }, []);

  useEffect(() => {
    refreshKYC();
  }, [refreshKYC]);

  // ── Fetch credits from blockchain (your existing logic) ──
  const fetchCredits = useCallback(async (address) => {
    const addr = address || walletAddress;
    if (!addr) return;
    setLoading(prev => ({ ...prev, credits: true }));
    setError('');
    try {
      const { creditTokenRead, marketplaceRead } = await getContracts();

      const nextId   = Number(await creditTokenRead.getNextTokenId());
      if (nextId === 0) { setCredits([]); return; }

      const tokenIds  = Array.from({ length: nextId }, (_, i) => i);
      const addresses = Array(nextId).fill(addr);
      const balances  = await creditTokenRead.balanceOfBatch(addresses, tokenIds);

      const userCredits = [];
      for (let i = 0; i < nextId; i++) {
        const balance = Number(balances[i]);
        if (balance === 0) continue;

        const meta      = await creditTokenRead.getCreditMetadata(i);
        const retired   = Number(await creditTokenRead.getTotalRetired(i));
        const isExpired = await creditTokenRead.isExpired(i);

        userCredits.push({
          tokenId:      i,
          tokenHex:     `0x${i.toString(16).padStart(8, '0').toUpperCase()}`,
          projectName:  meta.projectName,
          location:     meta.location,
          standard:     STANDARD_FROM_ENUM[meta.standard] || 'VCS',
          projectType:  meta.projectType,
          developer:    meta.developer,
          vintageYear:  Number(meta.vintageYear),
          expiryDate:   new Date(Number(meta.expiryDate) * 1000).toISOString().split('T')[0],
          serialNumber: meta.serialNumber,
          metadataURI:  meta.metadataURI,
          credits:      balance,
          heldCredits:  balance,
          totalRetired: retired,
          isExpired,
          isOnChain:    true,
          status:       'HELD',
          admin_status: 'approved',
          registeredAt: new Date(Number(meta.registeredAt) * 1000).toLocaleDateString('en-IN'),
          listedForSale: false,
          listingId:    null,
          pricePerCredit: 0,
        });
      }

      // Check marketplace listings
      const sellerListingIds = await marketplaceRead.getSellerListings(addr);
      for (const listingIdBig of sellerListingIds) {
        const listingId = Number(listingIdBig);
        const listing   = await marketplaceRead.listings(listingId);
        if (!listing.active) continue;

        const credit = userCredits.find(c => c.tokenId === Number(listing.tokenId));
        if (credit) {
          credit.listedForSale  = true;
          credit.status         = 'LISTED';
          credit.listingId      = listingId;
          credit.listedCredits  = Number(listing.amount);
          credit.pricePerCredit = Number(ethers.formatEther(listing.pricePerUnit)) * 1e18;
        }
      }

      setCredits(userCredits);
    } catch (err) {
      console.error('[fetchCredits]', err);
      setError(err.message);
    } finally {
      setLoading(prev => ({ ...prev, credits: false }));
    }
  }, [getContracts, walletAddress]);

  // ── Fetch bought credits from backend ────────────────────
  const refreshBoughtCredits = useCallback(async () => {
    try {
      const d = await apiFetch('/api/portfolio/my-purchases');
      setMyBoughtCredits(d?.purchases || []);
    } catch (err) {
      console.error('[refreshBoughtCredits]', err);
    }
  }, []);

  // ── Fetch retirements from backend ───────────────────────
  const refreshRetirements = useCallback(async () => {
    try {
      const d = await apiFetch('/api/portfolio/my-retirements');
      setMyRetirements(d?.retirements || []);
    } catch (err) {
      console.error('[refreshRetirements]', err);
    }
  }, []);

  // ── loadMyCredits — alias used by PortfolioV3 ────────────
  const loadMyCredits = useCallback(() => fetchCredits(walletAddress), [fetchCredits, walletAddress]);

  // ── Bootstrap on wallet ready ────────────────────────────
  useEffect(() => {
    if (!walletAddress) return;
    fetchCredits(walletAddress);
    refreshBoughtCredits();
    refreshRetirements();
  }, [walletAddress]); // eslint-disable-line

  // ── registerCredit (your existing logic, unchanged) ──────
  const registerCredit = useCallback(async (address, creditData) => {
    setLoading(prev => ({ ...prev, tx: true }));
    setError('');
    try {
      const { creditToken, addresses } = await getContracts();

      const approved = await creditToken.isApprovedForAll(address, addresses.Marketplace);
      if (!approved) {
        const approveTx = await creditToken.setApprovalForAll(addresses.Marketplace, true);
        await approveTx.wait();
      }

      const expiryTimestamp = Math.floor(new Date(creditData.expiryDate).getTime() / 1000);

      const tx = await creditToken.mintCredit(
        address, creditData.credits, creditData.projectName,
        creditData.location, STANDARD_ENUM[creditData.standard] ?? 0,
        creditData.projectType, creditData.developer,
        creditData.vintageYear, expiryTimestamp,
        creditData.serialNumber, creditData.metadataURI || '',
      );
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => {
        try { return creditToken.interface.parseLog(log)?.name === 'CreditMinted'; } catch { return false; }
      });
      const tokenId = event ? Number(creditToken.interface.parseLog(event).args.tokenId) : null;

      await fetchCredits(address);
      return { success: true, tokenId, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoading(prev => ({ ...prev, tx: false }));
    }
  }, [getContracts, fetchCredits]);

  // ── retireCredit ─────────────────────────────────────────
  const retireCredit = useCallback(async (tokenId, amount) => {
    setLoading(prev => ({ ...prev, tx: true }));
    setError('');
    try {
      const { creditToken } = await getContracts();
      const tx      = await creditToken.retireCredit(tokenId, amount);
      const receipt = await tx.wait();
      await fetchCredits(walletAddress);
      await refreshRetirements();
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoading(prev => ({ ...prev, tx: false }));
    }
  }, [getContracts, fetchCredits, refreshRetirements, walletAddress]);

  // ── listCredit ───────────────────────────────────────────
  const listCredit = useCallback(async (tokenId, amount, pricePerUnitMATIC, durationDays = 90) => {
    setLoading(prev => ({ ...prev, tx: true }));
    setError('');
    try {
      const { marketplace, creditToken, addresses } = await getContracts();

      const approved = await creditToken.isApprovedForAll(walletAddress, addresses.Marketplace);
      if (!approved) {
        const approveTx = await creditToken.setApprovalForAll(addresses.Marketplace, true);
        await approveTx.wait();
      }

      const priceWei = ethers.parseEther(String(pricePerUnitMATIC));
      const duration = durationDays * 24 * 60 * 60;

      const tx      = await marketplace.listCredit(tokenId, amount, priceWei, duration);
      const receipt = await tx.wait();
      await fetchCredits(walletAddress);
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoading(prev => ({ ...prev, tx: false }));
    }
  }, [getContracts, fetchCredits, walletAddress]);

  // ── delistCredit ─────────────────────────────────────────
  const delistCredit = useCallback(async (listingId) => {
    setLoading(prev => ({ ...prev, tx: true }));
    setError('');
    try {
      const { marketplace } = await getContracts();
      const tx      = await marketplace.cancelListing(listingId);
      const receipt = await tx.wait();
      await fetchCredits(walletAddress);
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setLoading(prev => ({ ...prev, tx: false }));
    }
  }, [getContracts, fetchCredits, walletAddress]);

  // ── stats — derived from credits (memoised) ──────────────
  // PortfolioV3 reads: stats.totalCredits, stats.retiredCount,
  //                    stats.listedCount,  stats.totalValue
  const stats = useMemo(() => {
    const active   = credits.filter(c => c.status !== 'RETIRED');
    const listed   = credits.filter(c => c.status === 'LISTED');
    const retired  = myRetirements.length;

    const totalCredits = active.reduce((s, c) => s + (c.heldCredits || c.credits || 0), 0);
    const listedCount  = listed.reduce((s, c) => s + (c.listedCredits || c.credits || 0), 0);
    const totalValue   = active.reduce((s, c) => {
      const dep     = vintagePenalty(c.vintageYear) / 100;
      const price   = c.pricePerCredit > 0 ? c.pricePerCredit * (1 - dep) : 850 * (1 - dep);
      return s + (c.heldCredits || c.credits || 0) * price;
    }, 0);

    return { totalCredits, retiredCount: retired, listedCount, totalValue };
  }, [credits, myRetirements]);

  return {
    // ── names PortfolioV3 uses ──────────────────────────────
    myCredits:          credits,
    myBoughtCredits,
    myRetirements,
    stats,
    loading,                   // { credits: bool, tx: bool }
    walletAddress,
    isKYCVerified,
    // actions
    listCredit,
    delistCredit,
    retireCredit,
    loadMyCredits,
    refreshKYC,
    refreshRetirements,
    refreshBoughtCredits,

    // ── names your existing code uses (backwards-compat) ────
    credits,
    listings,
    txPending: loading.tx,
    error,
    fetchCredits,
    registerCredit,
  };
}