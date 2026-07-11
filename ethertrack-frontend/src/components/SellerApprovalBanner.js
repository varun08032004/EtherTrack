// components/SellerApprovalBanner.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Drop this into PortfolioV3.jsx (or wherever the LIST button lives). Shows
// a one-time approval prompt if the connected wallet hasn't yet granted the
// Marketplace permission to escrow its tokens — required before
// listCredit/listCreditFor can work. Disappears permanently once approved.
//
// Usage in PortfolioV3.jsx:
//   import SellerApprovalBanner from './SellerApprovalBanner';
//   ...
//   <SellerApprovalBanner />   // place near the top of the OVERVIEW section
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback } from 'react';
import { usePortfolio } from '../context/PortfolioContext';

export default function SellerApprovalBanner() {
  const { walletAddress, isSellerApproved, approveMarketplace } = usePortfolio();
  const [approved, setApproved] = useState(null); // null = unknown/checking
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');

  const check = useCallback(async () => {
    if (!walletAddress) { setApproved(null); return; }
    const result = await isSellerApproved();
    setApproved(result);
  }, [walletAddress, isSellerApproved]);

  useEffect(() => { check(); }, [check]);

  const handleApprove = async () => {
    setApproving(true);
    setError('');
    try {
      await approveMarketplace();
      await check();
    } catch (e) {
      setError(e.message || 'Approval failed. Please try again.');
    } finally {
      setApproving(false);
    }
  };

  // Nothing to show: no wallet connected, still checking, or already approved
  if (!walletAddress || approved === null || approved === true) return null;

  return (
    <div role="alert" style={{
      marginBottom: 20, padding: '14px 20px', background: '#0a1628',
      border: '1px solid #60a5fa33', borderRadius: 10,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 16, flexWrap: 'wrap',
    }}>
      <div>
        <div style={{ fontSize: 12, color: '#60a5fa', fontWeight: 700, marginBottom: 3 }}>
          🔓 One-time setup needed to list credits
        </div>
        <div style={{ fontSize: 10, color: '#60a5fa88', lineHeight: 1.6, maxWidth: 480 }}>
          Approve the marketplace once to allow it to hold your credits in escrow when you list them for sale.
          This is a single transaction — after this, listing and delisting will need zero further approval, ever.
        </div>
        {error && (
          <div style={{ fontSize: 10, color: '#f87171', marginTop: 6 }}>{error}</div>
        )}
      </div>
      <button
        onClick={handleApprove}
        disabled={approving}
        style={{
          padding: '10px 20px', borderRadius: 8, border: 'none',
          background: approving ? '#1e3a5f' : 'linear-gradient(135deg,#1d4ed8,#2563eb)',
          color: '#fff', cursor: approving ? 'not-allowed' : 'pointer',
          fontFamily: 'DM Mono, monospace', fontSize: 11, fontWeight: 700,
          letterSpacing: '.06em', flexShrink: 0,
        }}
      >
        {approving ? '⟳ APPROVING…' : 'APPROVE ONCE →'}
      </button>
    </div>
  );
}