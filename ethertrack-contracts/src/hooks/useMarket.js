import { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';
import { useContracts } from './useContracts';
import { STANDARD_FROM_ENUM, ORDER_SIDE } from '../config/contracts.config';

/**
 * useMarket
 * Replaces: ALL mock state and handlers in CarbonCredits.js
 *
 * BEFORE (mock):                       AFTER (blockchain):
 *   CREDITS array          →  marketplace.getActiveListings()
 *   prices state (random)  →  listing.pricePerUnit from contract
 *   handleConfirmTrade()   →  marketplace.buyCredit() with MATIC
 *   openOrders state       →  marketplace.getTraderOrders()
 *   trades state           →  marketplace.getBuyerTrades() events
 *   cancelOrder()          →  marketplace.cancelOrder()
 *   placeLimitOrder()      →  marketplace.placeLimitOrder()
 */
export function useMarket() {
  const { getContracts } = useContracts();

  const [listings,    setListings]    = useState([]); // active on-chain listings
  const [myOrders,    setMyOrders]    = useState([]); // my open limit orders
  const [myTrades,    setMyTrades]    = useState([]); // my completed trades
  const [loading,     setLoading]     = useState(false);
  const [txPending,   setTxPending]   = useState(false);
  const [txHash,      setTxHash]      = useState('');
  const [error,       setError]       = useState('');

  // ── Fetch all active listings from Marketplace contract ──
  // Replaces: CREDITS hardcoded array + Portfolio listed credits
  const fetchListings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { marketplaceRead, creditTokenRead } = await getContracts();
      const rawListings = await marketplaceRead.getActiveListings();

      // Enrich with credit metadata
      const enriched = await Promise.all(
        rawListings.map(async (l) => {
          const tokenId = Number(l.tokenId);
          let meta = null;
          try { meta = await creditTokenRead.getCreditMetadata(tokenId); } catch {}

          return {
            listingId:       Number(l.listingId),
            seller:          l.seller,
            tokenId,
            amount:          Number(l.amount),
            amountRemaining: Number(l.amountRemaining),
            pricePerUnit:    l.pricePerUnit,                           // BigInt (wei)
            priceFormatted:  ethers.formatEther(l.pricePerUnit),       // MATIC string
            priceINR:        Number(ethers.formatEther(l.pricePerUnit)) * 87.4, // approx INR
            listedAt:        new Date(Number(l.listedAt)  * 1000),
            expiresAt:       new Date(Number(l.expiresAt) * 1000),

            // Credit metadata
            projectName:  meta?.projectName  || `Token #${tokenId}`,
            location:     meta?.location     || '—',
            standard:     STANDARD_FROM_ENUM[meta?.standard] || 'VCS',
            projectType:  meta?.projectType  || '—',
            developer:    meta?.developer    || '—',
            vintageYear:  Number(meta?.vintageYear || 0),
            serialNumber: meta?.serialNumber || '—',
          };
        })
      );

      setListings(enriched);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [getContracts]);

  // ── Fetch my orders ─────────────────────────────────────
  // Replaces: openOrders useState array
  const fetchMyOrders = useCallback(async (walletAddress) => {
    if (!walletAddress) return;
    try {
      const { marketplaceRead } = await getContracts();
      const orderIds = await marketplaceRead.getTraderOrders(walletAddress);

      const orders = await Promise.all(
        orderIds.map(async (id) => {
          const o = await marketplaceRead.orders(Number(id));
          return {
            orderId:      Number(o.orderId),
            tokenId:      Number(o.tokenId),
            amount:       Number(o.amount),
            limitPrice:   ethers.formatEther(o.limitPrice),
            filledAmount: Number(o.filledAmount),
            side:         o.side === 0 ? 'BUY' : 'SELL',
            status:       ['OPEN','FILLED','CANCELLED','EXPIRED'][o.status] || 'OPEN',
            createdAt:    new Date(Number(o.createdAt) * 1000),
            expiresAt:    new Date(Number(o.expiresAt) * 1000),
          };
        })
      );

      setMyOrders(orders.filter(o => o.status === 'OPEN'));
    } catch (err) {
      setError(err.message);
    }
  }, [getContracts]);

  // ── Fetch my trade history ──────────────────────────────
  // Replaces: trades useState array
  const fetchMyTrades = useCallback(async (walletAddress) => {
    if (!walletAddress) return;
    try {
      const { marketplaceRead } = await getContracts();
      const buyTradeIds  = await marketplaceRead.getBuyerTrades(walletAddress);
      const sellTradeIds = await marketplaceRead.getSellerTrades(walletAddress);

      const allIds  = [...new Set([...buyTradeIds, ...sellTradeIds].map(Number))];
      const trades  = await Promise.all(
        allIds.map(async (id) => {
          const t = await marketplaceRead.getTrade(id);
          return {
            tradeId:      Number(t.tradeId),
            listingId:    Number(t.listingId),
            buyer:        t.buyer,
            seller:       t.seller,
            tokenId:      Number(t.tokenId),
            amount:       Number(t.amount),
            pricePerUnit: ethers.formatEther(t.pricePerUnit),
            totalPrice:   ethers.formatEther(t.totalPrice),
            fee:          ethers.formatEther(t.fee),
            tradedAt:     new Date(Number(t.tradedAt) * 1000),
            type:         t.buyer.toLowerCase() === walletAddress.toLowerCase() ? 'BUY' : 'SELL',
          };
        })
      );

      setMyTrades(trades.sort((a, b) => b.tradedAt - a.tradedAt));
    } catch (err) {
      setError(err.message);
    }
  }, [getContracts]);

  // ── Buy credit (market order) ───────────────────────────
  // Replaces: handleConfirmTrade() in CarbonCredits.js
  const buyCredit = useCallback(async (walletAddress, listingId, amount, pricePerUnit) => {
    setTxPending(true);
    setTxHash('');
    setError('');
    try {
      const { marketplace } = await getContracts();

      // Calculate total + fee
      const total    = BigInt(amount) * BigInt(pricePerUnit);
      const fee      = (total * 50n) / 10000n; // 0.5%
      const totalWei = total + fee;

      const tx = await marketplace.buyCredit(listingId, amount, { value: totalWei });
      const receipt = await tx.wait();

      setTxHash(receipt.hash);
      await Promise.all([fetchListings(), fetchMyTrades(walletAddress)]);
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setTxPending(false);
    }
  }, [getContracts, fetchListings, fetchMyTrades]);

  // ── Place limit order ───────────────────────────────────
  // Replaces: openOrders state management in CarbonCredits.js
  const placeLimitOrder = useCallback(async (walletAddress, tokenId, amount, limitPriceMATIC, side, durationDays = 7) => {
    setTxPending(true);
    setError('');
    try {
      const { marketplace } = await getContracts();

      const limitPriceWei = ethers.parseEther(String(limitPriceMATIC));
      const duration      = durationDays * 24 * 60 * 60;
      const sideEnum      = side === 'BUY' ? ORDER_SIDE.BUY : ORDER_SIDE.SELL;

      let value = 0n;
      if (side === 'BUY') {
        const total = BigInt(amount) * limitPriceWei;
        const fee   = (total * 50n) / 10000n;
        value = total + fee;
      }

      const tx = await marketplace.placeLimitOrder(
        tokenId, amount, limitPriceWei, sideEnum, duration, { value }
      );
      const receipt = await tx.wait();

      await fetchMyOrders(walletAddress);
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setTxPending(false);
    }
  }, [getContracts, fetchMyOrders]);

  // ── Cancel limit order ──────────────────────────────────
  // Replaces: cancelOrder() in CarbonCredits.js
  const cancelOrder = useCallback(async (walletAddress, orderId) => {
    setTxPending(true);
    setError('');
    try {
      const { marketplace } = await getContracts();
      const tx = await marketplace.cancelOrder(orderId);
      const receipt = await tx.wait();
      await fetchMyOrders(walletAddress);
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setTxPending(false);
    }
  }, [getContracts, fetchMyOrders]);

  // ── Calculate fee (read from contract) ─────────────────
  // Replaces: tradeFee = tradeTotal * PLATFORM_FEE in CarbonCredits.js
  const calculateFee = useCallback(async (amount, pricePerUnit) => {
    try {
      const { marketplaceRead } = await getContracts();
      const [fee, total] = await marketplaceRead.calculateFee(amount, pricePerUnit);
      return {
        fee:   ethers.formatEther(fee),
        total: ethers.formatEther(total),
        net:   ethers.formatEther(total + fee),
      };
    } catch {
      return { fee: '0', total: '0', net: '0' };
    }
  }, [getContracts]);

  return {
    listings,
    myOrders,
    myTrades,
    loading,
    txPending,
    txHash,
    error,
    fetchListings,
    fetchMyOrders,
    fetchMyTrades,
    buyCredit,
    placeLimitOrder,
    cancelOrder,
    calculateFee,
  };
}
