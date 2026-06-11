/**
 * hooks/useWalletBalance.js
 *
 * Manages ETH wallet balance with:
 *  - Multi-provider fallback: MetaMask → Alchemy → Infura → public RPC
 *  - Hostname allowlist check before requesting accounts
 *  - Provider cleanup on unmount
 *  - Concurrent-fetch guard
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithTimeout, isWalletHostAllowed } from '../utils/dashboard';

let _ethersModule = null;
async function getEthers() {
  _ethersModule ??= await import('ethers');
  return _ethersModule;
}

/** Build a provider with automatic fallback chain */
async function buildProvider(ethers) {
  // 1. Injected (MetaMask, Rabby, etc.)
  if (window.ethereum) {
    try {
      return new ethers.BrowserProvider(window.ethereum);
    } catch { /* fall through */ }
  }

  // 2. Alchemy
  const alchemyUrl = process.env.REACT_APP_ALCHEMY_URL;
  if (alchemyUrl) {
    try { return new ethers.JsonRpcProvider(alchemyUrl); } catch { /* fall through */ }
  }

  // 3. Infura
  const infuraUrl = process.env.REACT_APP_INFURA_URL;
  if (infuraUrl) {
    try { return new ethers.JsonRpcProvider(infuraUrl); } catch { /* fall through */ }
  }

  // 4. Public Sepolia RPC (last resort, rate-limited)
  return new ethers.JsonRpcProvider('https://rpc.sepolia.org');
}

export function useWalletBalance(walletAddress) {
  const [balance, setBalance]   = useState(null);
  const [error, setError]       = useState(false);
  const providerRef             = useRef(null);
  const fetchingRef             = useRef(false);

  const fetchBalance = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const { ethers } = await getEthers();
      if (!providerRef.current) {
        providerRef.current = await buildProvider(ethers);
      }

      const accounts = window.ethereum
        ? await fetchWithTimeout(() => providerRef.current.listAccounts())
        : walletAddress ? [{ address: walletAddress }] : [];

      if (!accounts.length) { setBalance(null); return; }

      const address = accounts[0]?.address || accounts[0];
      const bal     = await fetchWithTimeout(() => providerRef.current.getBalance(address));
      setBalance(parseFloat(ethers.formatEther(bal)).toFixed(4));
      setError(false);
    } catch {
      providerRef.current = null; // reset so next attempt rebuilds
      setError(true);
    } finally {
      fetchingRef.current = false;
    }
  }, [walletAddress]);

  // Fetch on mount and when walletAddress changes
  useEffect(() => {
    if (!window.ethereum && !walletAddress) return;
    fetchBalance();
  }, [walletAddress, fetchBalance]);

  // Cleanup provider on unmount
  useEffect(() => {
    return () => {
      if (providerRef.current?.destroy) providerRef.current.destroy();
      providerRef.current = null;
    };
  }, []);

  const connectWallet = useCallback(async () => {
    if (!isWalletHostAllowed()) {
      // Log to Sentry — could be a phishing mirror
      try {
        const Sentry = await import('@sentry/react');
        Sentry.captureMessage('Wallet connect blocked — unrecognised hostname', {
          level: 'warning',
          extra: { hostname: window.location.hostname },
        });
      } catch { /* Sentry not available */ }
      alert('Wallet connection is only available on the official EtherTrack platform.');
      return;
    }

    if (!window.ethereum) {
      window.open('https://metamask.io/download/', '_blank', 'noopener,noreferrer');
      return;
    }

    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      await fetchBalance();
    } catch {
      /* User rejected — silent */
    }
  }, [fetchBalance]);

  return { balance, error, connectWallet, refetch: fetchBalance };
}