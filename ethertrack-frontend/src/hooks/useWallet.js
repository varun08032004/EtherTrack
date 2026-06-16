import { useState, useCallback } from 'react';
import { ethers } from 'ethers';

const useWallet = () => {
  const [address,      setAddress]      = useState('');
  const [isConnected,  setIsConnected]  = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [balance,      setBalance]      = useState('0.0000');
  const [balanceINR,   setBalanceINR]   = useState('0.00');
  const [network,      setNetwork]      = useState('');

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : '';

  // ── Fetch balance + network after connect ─────────────
  const loadData = useCallback(async () => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const addr     = await signer.getAddress();
      const bal      = await provider.getBalance(addr);
      const net      = await provider.getNetwork();
      const balEth   = parseFloat(ethers.formatEther(bal)).toFixed(4);

      setBalance(balEth);
      setNetwork(net.name === 'unknown' ? 'Polygon Mumbai' : net.name);

      // Fetch INR price
      try {
        const res  = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=matic-network&vs_currencies=inr');
        const data = await res.json();
        const inr  = data['matic-network']?.inr || 0;
        setBalanceINR((parseFloat(balEth) * inr).toFixed(2));
      } catch { setBalanceINR('—'); }

    } catch (err) {
      console.warn('loadData error:', err.message);
    }
  }, []);

  // ── Connect ───────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert('MetaMask not detected. Please install it from metamask.io');
      return;
    }
    setIsConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts && accounts.length > 0) {
        setAddress(accounts[0]);
        setIsConnected(true);
        await loadData();
      }
    } catch (err) {
      console.error('Connect error:', err.message);
    } finally {
      setIsConnecting(false);
    }
  }, [loadData]);

  // ── Disconnect ────────────────────────────────────────
  const disconnect = useCallback(() => {
    setAddress('');
    setIsConnected(false);
    setBalance('0.0000');
    setBalanceINR('0.00');
    setNetwork('');
  }, []);

  return {
    address, shortAddress,
    isConnected, isConnecting,
    balance, balanceINR, network,
    connect, disconnect,
  };
};

export default useWallet;