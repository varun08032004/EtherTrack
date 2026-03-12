import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { useContracts } from './useContracts';
import { STANDARD_ENUM, STANDARD_FROM_ENUM } from '../config/contracts.config';

/**
 * usePortfolio
 * Replaces: ALL useState in Portfolio.js
 *
 * BEFORE (state):                    AFTER (blockchain):
 *   credits[]            →  creditToken.balanceOf() + getCreditMetadata()
 *   handleRegister()     →  mintCredit() on CarbonCreditToken
 *   handleRetire()       →  retireCredit() on CarbonCreditToken
 *   handleListForSale()  →  listCredit() on Marketplace
 *   handleDelist()       →  cancelListing() on Marketplace
 */
export function usePortfolio() {
  const { getContracts } = useContracts();

  const [credits,   setCredits]   = useState([]);
  const [listings,  setListings]  = useState([]); // user's own listings
  const [loading,   setLoading]   = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [error,     setError]     = useState('');

  // ── Fetch user's credits from contract ─────────────────
  // Replaces: SEED_CREDITS array in Portfolio.js
  const fetchCredits = useCallback(async (walletAddress) => {
    if (!walletAddress) return;
    setLoading(true);
    setError('');
    try {
      const { creditTokenRead, marketplaceRead } = await getContracts();

      const nextId = Number(await creditTokenRead.getNextTokenId());
      if (nextId === 0) { setCredits([]); return; }

      const tokenIds  = Array.from({ length: nextId }, (_, i) => i);
      const addresses = Array(nextId).fill(walletAddress);

      // Batch fetch balances
      const balances = await creditTokenRead.balanceOfBatch(addresses, tokenIds);

      // Fetch metadata for tokens user holds
      const userCredits = [];
      for (let i = 0; i < nextId; i++) {
        const balance = Number(balances[i]);
        if (balance === 0) continue;

        const meta      = await creditTokenRead.getCreditMetadata(i);
        const retired   = Number(await creditTokenRead.getTotalRetired(i));
        const isExpired = await creditTokenRead.isExpired(i);

        userCredits.push({
          tokenId:            i,
          projectName:        meta.projectName,
          location:           meta.location,
          standard:           STANDARD_FROM_ENUM[meta.standard] || 'VCS',
          projectType:        meta.projectType,
          developer:          meta.developer,
          vintageYear:        Number(meta.vintageYear),
          expiryDate:         new Date(Number(meta.expiryDate) * 1000).toISOString().split('T')[0],
          serialNumber:       meta.serialNumber,
          metadataURI:        meta.metadataURI,
          balance,             // How many credits user holds
          totalRetired:       retired,
          isExpired,
          registeredAt:       new Date(Number(meta.registeredAt) * 1000).toLocaleDateString('en-IN'),
          listedForSale:      false, // updated below
          listingId:          null,
          pricePerCredit:     0,
        });
      }

      // Check which are listed on Marketplace
      const sellerListingIds = await marketplaceRead.getSellerListings(walletAddress);
      for (const listingIdBig of sellerListingIds) {
        const listingId = Number(listingIdBig);
        const listing   = await marketplaceRead.listings(listingId);
        if (!listing.active) continue;

        const credit = userCredits.find(c => c.tokenId === Number(listing.tokenId));
        if (credit) {
          credit.listedForSale = true;
          credit.listingId     = listingId;
          credit.pricePerCredit = Number(ethers.formatEther(listing.pricePerUnit)) * 1e18; // keep in wei for display
          credit.priceINR      = Number(ethers.formatEther(listing.pricePerUnit)); // MATIC
        }
      }

      setCredits(userCredits);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [getContracts]);

  // ── Register / Mint credit ──────────────────────────────
  // Replaces: handleRegister() in Portfolio.js
  const registerCredit = useCallback(async (walletAddress, creditData) => {
    setTxPending(true);
    setError('');
    try {
      const { creditToken, addresses } = await getContracts();

      // Approve marketplace to transfer credits (needed for listing later)
      const approved = await creditToken.isApprovedForAll(walletAddress, addresses.Marketplace);
      if (!approved) {
        const approveTx = await creditToken.setApprovalForAll(addresses.Marketplace, true);
        await approveTx.wait();
      }

      const expiryTimestamp = Math.floor(new Date(creditData.expiryDate).getTime() / 1000);

      const tx = await creditToken.mintCredit(
        walletAddress,
        creditData.credits,
        creditData.projectName,
        creditData.location,
        STANDARD_ENUM[creditData.standard] ?? 0,
        creditData.projectType,
        creditData.developer,
        creditData.vintageYear,
        expiryTimestamp,
        creditData.serialNumber,
        creditData.metadataURI || '',
      );

      const receipt = await tx.wait();

      // Extract tokenId from CreditMinted event
      const event   = receipt.logs.find(log => {
        try { return creditToken.interface.parseLog(log)?.name === 'CreditMinted'; } catch { return false; }
      });
      const tokenId = event ? Number(creditToken.interface.parseLog(event).args.tokenId) : null;

      await fetchCredits(walletAddress);
      return { success: true, tokenId, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setTxPending(false);
    }
  }, [getContracts, fetchCredits]);

  // ── Retire credit ───────────────────────────────────────
  // Replaces: handleRetire() in Portfolio.js
  const retireCredit = useCallback(async (walletAddress, tokenId, amount) => {
    setTxPending(true);
    setError('');
    try {
      const { creditToken } = await getContracts();
      const tx = await creditToken.retireCredit(tokenId, amount);
      const receipt = await tx.wait();
      await fetchCredits(walletAddress);
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setTxPending(false);
    }
  }, [getContracts, fetchCredits]);

  // ── List credit for sale ────────────────────────────────
  // Replaces: handleListForSale() in Portfolio.js
  const listCredit = useCallback(async (walletAddress, tokenId, amount, pricePerUnitMATIC, durationDays = 90) => {
    setTxPending(true);
    setError('');
    try {
      const { marketplace, creditToken, addresses } = await getContracts();

      // Ensure Marketplace is approved
      const approved = await creditToken.isApprovedForAll(walletAddress, addresses.Marketplace);
      if (!approved) {
        const approveTx = await creditToken.setApprovalForAll(addresses.Marketplace, true);
        await approveTx.wait();
      }

      const priceWei = ethers.parseEther(String(pricePerUnitMATIC));
      const duration = durationDays * 24 * 60 * 60;

      const tx = await marketplace.listCredit(tokenId, amount, priceWei, duration);
      const receipt = await tx.wait();
      await fetchCredits(walletAddress);
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setTxPending(false);
    }
  }, [getContracts, fetchCredits]);

  // ── Delist credit ───────────────────────────────────────
  // Replaces: handleDelist() in Portfolio.js
  const delistCredit = useCallback(async (walletAddress, listingId) => {
    setTxPending(true);
    setError('');
    try {
      const { marketplace } = await getContracts();
      const tx = await marketplace.cancelListing(listingId);
      const receipt = await tx.wait();
      await fetchCredits(walletAddress);
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setTxPending(false);
    }
  }, [getContracts, fetchCredits]);

  return {
    credits,
    listings,
    loading,
    txPending,
    error,
    fetchCredits,
    registerCredit,
    retireCredit,
    listCredit,
    delistCredit,
  };
}
