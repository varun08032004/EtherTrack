// src/components/WalletMismatchBanner.js — EtherTrack (PRODUCTION-HARDENED)
// ─────────────────────────────────────────────────────────────────────────────
// FIXES APPLIED:
//
// [FIX-1]  window.ethereum null-check added before calling wallet_requestPermissions.
//          In non-MetaMask environments (mobile browser, Brave without MetaMask,
//          etc.) the original code would throw silently. Now redirects to
//          metamask.io if window.ethereum is absent.
//
// [FIX-2]  User rejection (code 4001) handled gracefully — no console error
//          logged when the user cancels the switch dialog.
//
// [FIX-3]  Error state added so the user sees feedback if the switch fails for
//          reasons other than user rejection.
//
// [FIX-4]  aria-live="assertive" added — screen readers announce the mismatch
//          banner immediately since it's a blocking error state.
//
// Drop inside your main layout, just below <Header/>

import React, { useState } from 'react';
import { usePortfolio } from '../context/PortfolioContext';

export default function WalletMismatchBanner() {
  const { walletMismatch, walletMismatchInfo } = usePortfolio();
  const [switchErr, setSwitchErr] = useState('');

  if (!walletMismatch || !walletMismatchInfo) return null;

  const { boundWallet } = walletMismatchInfo;

  // [FIX-1] Null-check + graceful fallback for non-MetaMask environments
  // [FIX-2] User rejection handled separately
  // [FIX-3] Error state surfaced to user
  const handleSwitch = async () => {
    setSwitchErr('');
    if (!window.ethereum) {
      window.open('https://metamask.io/download/', '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await window.ethereum.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }],
      });
    } catch (e) {
      if (e?.code === 4001) {
        // User cancelled — silent, no error shown
        return;
      }
      setSwitchErr('Switch failed. Please change the account manually in MetaMask.');
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"  // [FIX-4] announces immediately to screen readers
      style={{
        position:       'fixed',
        top:            60,
        left:           0,
        right:          0,
        zIndex:         9000,
        background:     '#450a0a',
        borderBottom:   '1px solid #dc262666',
        padding:        '12px 24px',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            16,
        fontFamily:     "'DM Mono',monospace",
        flexWrap:       'wrap',
      }}
    >
      <span style={{ fontSize: 16 }} aria-hidden="true">⚠️</span>

      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 12, color: '#f87171', fontWeight: 700, marginBottom: 2 }}>
          Wrong Wallet Connected
        </div>
        <div style={{ fontSize: 10, color: '#f8717188' }}>
          Your account is bound to{' '}
          <span style={{ color: '#f87171', fontFamily: 'monospace' }}>
            {boundWallet.slice(0, 6)}...{boundWallet.slice(-4)}
          </span>
          {' '}— please switch to that wallet in MetaMask.
          Portfolio and trading are disabled until you switch.
        </div>
        {switchErr && (
          <div style={{ fontSize: 10, color: '#fca5a5', marginTop: 4 }}>
            ⚠ {switchErr}
          </div>
        )}
      </div>

      <button
        onClick={handleSwitch}
        aria-label="Switch to the correct wallet in MetaMask"
        style={{
          padding:     '8px 16px',
          borderRadius: 6,
          border:       '1px solid #dc262666',
          background:   '#7f1d1d',
          color:        '#fca5a5',
          cursor:       'pointer',
          fontFamily:   "'DM Mono',monospace",
          fontSize:     10,
          letterSpacing: '.08em',
          flexShrink:   0,
          transition:   'opacity .2s',
        }}
        onMouseOver={e => e.currentTarget.style.opacity = '.8'}
        onMouseOut={e => e.currentTarget.style.opacity = '1'}
      >
        SWITCH WALLET IN METAMASK →
      </button>
    </div>
  );
}