// src/hooks/useMarket.js — EtherTrack (PRODUCTION-HARDENED)
// ─────────────────────────────────────────────────────────────────────────────
// FIXES APPLIED:
//
// [FIX-1]  INR price calculation fixed — was multiplying by 87.4 (MATIC price).
//          EtherTrack runs on Ethereum Sepolia, not Polygon. fetchListings()
//          now fetches the live ETH/INR rate from /api/rates/eth-inr before
//          computing pricePerUnitINR. Falls back to 280000 if rate fetch fails.
//
// [FIX-2]  marketStats now fetched from /api/market/stats in fetchPublicListings.
//          CarbonCredits.jsx uses marketStats?.activeListings and
//          marketStats?.totalRetired as fallback values in the stats bar.
//          Previously these were always undefined — stats bar showed '—'.
//
// Public REST fetch fires on mount with no wallet needed -- market visible to everyone.
// On-chain methods activate once wallet connects, and re-read the latest wallet state
// at call time (not cached at mount) so connecting MetaMask after page load works too.

import { useState, useCallback, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { useContracts } from './useContracts';
import { STANDARD_FROM_ENUM, ORDER_SIDE } from '../config/contracts.config';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const POLL_MS = 30_000;

// ── [FIX-2] Public REST fetch — now includes /api/market/stats ────────────────
async function fetchPublicListings() {
  const [listRes, orderRes, histRes, statsRes] = await Promise.all([
    fetch(`${API_URL}/api/market/listings`),
    fetch(`${API_URL}/api/market/buy-orders`),
    fetch(`${API_URL}/api/market/trade-history`),
    fetch(`${API_URL}/api/market/stats`),        // [FIX-2] added
  ]);

  const [listData, orderData, histData, statsData] = await Promise.all([
    listRes.ok   ? listRes.json()   : { listings: [] },
    orderRes.ok  ? orderRes.json()  : { orders: []   },
    histRes.ok   ? histRes.json()   : { trades: []   },
    statsRes.ok  ? statsRes.json()  : {},               // [FIX-2] added
  ]);

  return {
    listings:    listData.listings  || [],
    buyOrders:   orderData.orders   || [],
    marketStats: statsData          || {},              // [FIX-2] added
    trades: (histData.trades || []).map(t => ({
      ...t,
      time:   t.time ? new Date(t.time).toLocaleString() : '--',
      type:   'Buy',
      status: 'Confirmed',
    })),
  };
}

export function useMarket() {
  // useContracts returns {} when window.ethereum is absent -- safe.
  // We store it in a ref so on-chain methods always read the latest wallet
  // state at call time rather than whatever was cached at mount.
  const contractsHook    = useContracts();
  const contractsHookRef = useRef(contractsHook);
  contractsHookRef.current = contractsHook;

  const getContracts = useCallback(async () => {
    const gc = contractsHookRef.current?.getContracts;
    if (!gc) return null;
    return gc();
  }, []);

  const [listings,     setListings]     = useState([]);
  const [buyOrders,    setBuyOrders]    = useState([]);
  const [myOrders,     setMyOrders]     = useState([]);
  const [myTrades,     setMyTrades]     = useState([]);
  const [tradeHistory, setTradeHistory] = useState([]);
  const [marketStats,  setMarketStats]  = useState({});  // [FIX-2] added
  const [loading,      setLoading]      = useState(true);
  const [txPending,    setTxPending]    = useState(false);
  const [txHash,       setTxHash]       = useState('');
  const [error,        setError]        = useState('');

  const mountedRef  = useRef(true);
  const pollRef     = useRef(null);
  const chainLoaded = useRef(false);

  // 1. Public fetch — fires on mount, no wallet dependency
  const fetchPublic = useCallback(async () => {
    try {
      const data = await fetchPublicListings();
      if (!mountedRef.current) return;
      if (!chainLoaded.current) {
        setListings(data.listings);
        setBuyOrders(data.buyOrders);
      }
      setTradeHistory(data.trades);
      setMarketStats(data.marketStats);  // [FIX-2] set stats
      setError('');
    } catch (e) {
      if (mountedRef.current) setError(e.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // 2. On-chain listings — call this when wallet connects
  const fetchListings = useCallback(async () => {
    const contracts = await getContracts();
    if (!contracts) return; // no wallet — REST data already showing
    setLoading(true);
    setError('');
    try {
      const { marketplaceRead, creditTokenRead } = contracts;
      const rawListings = await marketplaceRead.getActiveListings();

      // [FIX-1] Fetch live ETH/INR rate from backend — not hardcoded MATIC rate
      let ethINR = 280000; // fallback
      try {
        const rateRes  = await fetch(`${API_URL}/api/rates/eth-inr`);
        const rateData = await rateRes.json();
        if (rateData?.inr > 0) ethINR = rateData.inr;
      } catch {
        console.warn('[useMarket] ETH/INR rate fetch failed — using fallback 280000');
      }

      const enriched = await Promise.all(
        rawListings.map(async (l) => {
          const tokenId = Number(l.tokenId);
          let meta = null;
          try { meta = await creditTokenRead.getCreditMetadata(tokenId); } catch {}

          // [FIX-1] Use live ETH/INR rate — was incorrectly using 87.4 (MATIC rate)
          const pricePerUnitINR = Number(ethers.formatEther(l.pricePerUnit)) * ethINR;

          return {
            listingId:       Number(l.listingId),
            seller:          l.seller,
            tokenId,
            amount:          Number(l.amount),
            amountRemaining: Number(l.amountRemaining),
            pricePerUnit:    l.pricePerUnit,
            priceFormatted:  ethers.formatEther(l.pricePerUnit),
            pricePerUnitINR,
            adjPrice:        Number(ethers.formatEther(l.pricePerUnit)),
            listedAt:        new Date(Number(l.listedAt) * 1000),
            expiresAt:       Number(l.expiresAt),
            projectName:     meta?.projectName  || `Token #${tokenId}`,
            location:        meta?.location     || '--',
            standard:        STANDARD_FROM_ENUM[meta?.standard] || 'VCS',
            projectType:     meta?.projectType  || '--',
            developer:       meta?.developer    || '--',
            vintageYear:     Number(meta?.vintageYear || 0),
            serialNumber:    meta?.serialNumber || '--',
            vintageDiscount: 0,
            totalRetired:    0,
          };
        })
      );

      if (!mountedRef.current) return;
      setListings(enriched);
      chainLoaded.current = true; // stop REST poll from overwriting richer data
      setError('');
    } catch (err) {
      if (mountedRef.current) setError(err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [getContracts]);

  // 3. My orders
  const fetchMyOrders = useCallback(async (walletAddress) => {
    if (!walletAddress) return;
    const contracts = await getContracts();
    if (!contracts) return;
    try {
      const { marketplaceRead } = contracts;
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
            status:       ['OPEN', 'FILLED', 'CANCELLED', 'EXPIRED'][o.status] || 'OPEN',
            createdAt:    new Date(Number(o.createdAt) * 1000),
            expiresAt:    new Date(Number(o.expiresAt) * 1000),
          };
        })
      );
      if (mountedRef.current) setMyOrders(orders.filter(o => o.status === 'OPEN'));
    } catch (err) {
      if (mountedRef.current) setError(err.message);
    }
  }, [getContracts]);

  // 4. My trade history
  const fetchMyTrades = useCallback(async (walletAddress) => {
    if (!walletAddress) return;
    const contracts = await getContracts();
    if (!contracts) return;
    try {
      const { marketplaceRead } = contracts;
      const buyTradeIds  = await marketplaceRead.getBuyerTrades(walletAddress);
      const sellTradeIds = await marketplaceRead.getSellerTrades(walletAddress);
      const allIds = [...new Set([...buyTradeIds, ...sellTradeIds].map(Number))];
      const trades = await Promise.all(
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
      if (mountedRef.current) setMyTrades(trades.sort((a, b) => b.tradedAt - a.tradedAt));
    } catch (err) {
      if (mountedRef.current) setError(err.message);
    }
  }, [getContracts]);

  // 5. Buy credit
  const buyCredit = useCallback(async (walletAddress, listingId, amount, pricePerUnit) => {
    const contracts = await getContracts();
    if (!contracts) return { success: false, error: 'Wallet not connected' };
    setTxPending(true);
    setTxHash('');
    setError('');
    try {
      const { marketplace } = contracts;
      const total    = ethers.toBigInt(amount) * ethers.toBigInt(pricePerUnit);
      const fee      = (total * 50n) / 10000n;
      const totalWei = total + fee;
      const tx       = await marketplace.buyCredit(listingId, amount, { value: totalWei });
      const receipt  = await tx.wait();
      if (mountedRef.current) setTxHash(receipt.hash);
      await Promise.all([fetchListings(), fetchMyTrades(walletAddress), fetchPublic()]);
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      if (mountedRef.current) setError(msg);
      return { success: false, error: msg };
    } finally {
      if (mountedRef.current) setTxPending(false);
    }
  }, [getContracts, fetchListings, fetchMyTrades, fetchPublic]);

  // 6. Place limit order
  const placeLimitOrder = useCallback(async (walletAddress, tokenId, amount, limitPriceETH, side, durationDays = 7) => {
    const contracts = await getContracts();
    if (!contracts) return { success: false, error: 'Wallet not connected' };
    setTxPending(true);
    setError('');
    try {
      const { marketplace } = contracts;
      const limitPriceWei = ethers.parseEther(String(limitPriceETH));
      const duration      = durationDays * 24 * 60 * 60;
      const sideEnum      = side === 'BUY' ? ORDER_SIDE.BUY : ORDER_SIDE.SELL;
      let value = 0n;
      if (side === 'BUY') {
        const total = ethers.toBigInt(amount) * limitPriceWei;
        const fee   = (total * 50n) / 10000n;
        value = total + fee;
      }
      const tx      = await marketplace.placeLimitOrder(tokenId, amount, limitPriceWei, sideEnum, duration, { value });
      const receipt = await tx.wait();
      await fetchMyOrders(walletAddress);
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      if (mountedRef.current) setError(msg);
      return { success: false, error: msg };
    } finally {
      if (mountedRef.current) setTxPending(false);
    }
  }, [getContracts, fetchMyOrders]);

  // 7. Cancel order
  const cancelOrder = useCallback(async (walletAddress, orderId) => {
    const contracts = await getContracts();
    if (!contracts) return { success: false, error: 'Wallet not connected' };
    setTxPending(true);
    setError('');
    try {
      const { marketplace } = contracts;
      const tx      = await marketplace.cancelOrder(orderId);
      const receipt = await tx.wait();
      await fetchMyOrders(walletAddress);
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      if (mountedRef.current) setError(msg);
      return { success: false, error: msg };
    } finally {
      if (mountedRef.current) setTxPending(false);
    }
  }, [getContracts, fetchMyOrders]);

  // 8. Calculate fee
  const calculateFee = useCallback(async (amount, pricePerUnit) => {
    const contracts = await getContracts();
    if (!contracts) return { fee: '0', total: '0', net: '0' };
    try {
      const { marketplaceRead } = contracts;
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

  // Mount: public fetch fires immediately, no wallet dependency
  useEffect(() => {
    mountedRef.current = true;
    fetchPublic();
    pollRef.current = setInterval(fetchPublic, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(pollRef.current);
    };
  }, [fetchPublic]);

  return {
    listings,
    buyOrders,
    myOrders,
    myTrades,
    tradeHistory,
    marketStats,     // [FIX-2] now returned — used by CarbonCredits.jsx stats bar
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
    refetch: fetchPublic,
  };
}