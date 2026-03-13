// src/components/WalletMismatchBanner.js
// Drop this inside your main layout, just below <Header/>
import React from 'react';
import { usePortfolio } from '../context/PortfolioContext';

export default function WalletMismatchBanner() {
  const { walletMismatch, walletMismatchInfo } = usePortfolio();

  if (!walletMismatch || !walletMismatchInfo) return null;

  const { boundWallet } = walletMismatchInfo;

  return (
    <div style={{
      position: 'fixed', top: 60, left: 0, right: 0, zIndex: 9000,
      background: '#450a0a', borderBottom: '1px solid #dc262666',
      padding: '12px 24px', display: 'flex', alignItems: 'center',
      justifyContent: 'center', gap: 16,
      fontFamily: "'DM Mono',monospace",
    }}>
      <span style={{ fontSize: 16 }}>⚠️</span>
      <div>
        <div style={{ fontSize: 12, color: '#f87171', fontWeight: 700, marginBottom: 2 }}>
          Wrong Wallet Connected
        </div>
        <div style={{ fontSize: 10, color: '#f8717188' }}>
          Your account is bound to{' '}
          <span style={{ color: '#f87171', fontFamily: 'monospace' }}>
            {boundWallet.slice(0, 6)}...{boundWallet.slice(-4)}
          </span>
          {' '}— please switch to that wallet in MetaMask. Portfolio and trading are disabled.
        </div>
      </div>
      <button
        onClick={() => window.ethereum?.request({
          method: 'wallet_requestPermissions',
          params: [{ eth_accounts: {} }],
        })}
        style={{
          padding: '8px 16px', borderRadius: 6, border: '1px solid #dc262666',
          background: '#7f1d1d', color: '#fca5a5', cursor: 'pointer',
          fontFamily: "'DM Mono',monospace", fontSize: 10, letterSpacing: '.08em',
          flexShrink: 0,
        }}
      >
        SWITCH WALLET IN METAMASK →
      </button>
    </div>
  );
}