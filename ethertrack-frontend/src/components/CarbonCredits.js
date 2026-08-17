import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';
import { usePortfolio } from '../context/PortfolioContext';
import { useMarket } from '../hooks/useMarket';
import { tradesAPI, apiFetch } from '../services/api';
import { v4 as uuidv4 } from 'uuid';

const PLATFORM_FEE = 0.005;

const STANDARDS   = {
  VCS: { color: '#22c55e', bg: '#0d2e1f' },
  GS:  { color: '#facc15', bg: '#1a1500' },
  CDM: { color: '#60a5fa', bg: '#0a1628' },
  ACR: { color: '#a78bfa', bg: '#120a28' },
};
const TYPE_COLORS = {
  Renewable: { bg: '#0d2e1f', text: '#22c55e', dot: '#16a34a' },
  Forestry:  { bg: '#0f2a1a', text: '#4ade80', dot: '#15803d' },
  Industrial:{ bg: '#1a1a0f', text: '#facc15', dot: '#ca8a04' },
  Social:    { bg: '#120a28', text: '#a78bfa', dot: '#7c3aed' },
};

const fmt    = n   => `₹${Number(n).toLocaleString('en-IN')}`;
const n0     = v   => Number(v || 0).toFixed(0);

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// ── NEW: ChainVerifiedBadge ───────────────────────────────────────
function ChainVerifiedBadge({ chainStatus, chainTxHash }) {
  if (!chainStatus) return null;
  const cfg = {
    confirmed: { bg: '#0d2e1f', border: '#22c55e33', text: '#22c55e', label: '⛓ ON-CHAIN' },
    pending:   { bg: '#1a1200', border: '#facc1533', text: '#facc15', label: '⏳ LOGGING...' },
    on_chain:  { bg: '#0d2e1f', border: '#22c55e33', text: '#22c55e', label: '⛓ ON-CHAIN' },
    failed:    { bg: '#1a0707', border: '#f8717133', text: '#f87171', label: '⚠ LOG FAILED' },
  }[chainStatus] || { bg: '#1a1200', border: '#facc1533', text: '#facc15', label: '⏳ PENDING' };
  return (
    <a
      href={chainTxHash ? `https://amoy.polygonscan.com/tx/${chainTxHash}` : '#'}
      target="_blank" rel="noopener noreferrer"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 7px', borderRadius: 3,
        background: cfg.bg, border: `1px solid ${cfg.border}`,
        color: cfg.text, fontSize: 8, letterSpacing: '.06em',
        textDecoration: 'none', cursor: chainTxHash ? 'pointer' : 'default',
      }}
    >
      {cfg.label}{chainTxHash && <span style={{ opacity: 0.5 }}>↗</span>}
    </a>
  );
}

function buildPriceHistory(tradeHistory, tokenId) {
  const relevant = tradeHistory
    .filter(t => t.tokenId === tokenId)
    .slice(0, 30)
    .reverse();
  if (relevant.length < 2) return [];
  return relevant.map(t =>
    parseFloat(t.totalEth || 0) / (t.amount || 1) * ETH_INR
  );
}

// ── Sub-components defined at module scope ────────────────────────

function MiniChart({ data, color = '#22c55e', width = 120, height = 36 }) {
  if (!data || data.length < 2) return (
    <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 8, color: '#86efac22', letterSpacing: '.08em' }}>NO DATA</span>
    </div>
  );
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const pts = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`
  ).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`g${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={pts} opacity="0.9"/>
      <polygon fill={`url(#g${color.replace('#', '')})`} points={`0,${height} ${pts} ${width},${height}`}/>
    </svg>
  );
}

function DepthBar({ qty, max }) {
  const pct = Math.min((qty / max) * 100, 100);
  return (
    <div style={{ width: '100%', height: 3, background: '#0f2a1a', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: '#22c55e', opacity: 0.5, borderRadius: 2 }}/>
    </div>
  );
}

function Skeleton({ w = '100%', h = 14, mb = 8 }) {
  return <div style={{ width: w, height: h, background: '#0f2a1a55', borderRadius: 4, marginBottom: mb, animation: 'pulse 1.5s ease infinite' }}/>;
}

function Badge({ label, color, bg, border }) {
  return (
    <span style={{
      fontSize: 9, padding: '2px 7px', borderRadius: 3,
      background: bg, color,
      border: `1px solid ${border || color}33`,
      letterSpacing: '.06em',
    }}>
      {label}
    </span>
  );
}

// ── ConnectPrompt — shown in trade panel for unauthed users ───────
function ConnectPrompt({ isKYCVerified, walletAddress, navigate }) {
  if (walletAddress && isKYCVerified) return null;
  return (
    <div style={{
      padding: '14px', borderRadius: 8, marginBottom: 12,
      background: '#040a06', border: '1px solid #22c55e22',
    }}>
      {!walletAddress && (
        <div style={{ marginBottom: 8, fontSize: 11, color: '#86efac88', lineHeight: 1.6 }}>
          Connect MetaMask to trade. The market is open for browsing — no wallet needed.
        </div>
      )}
      {walletAddress && !isKYCVerified && (
        <div style={{ marginBottom: 8, fontSize: 11, color: '#facc1588', lineHeight: 1.6 }}>
          Complete KYC to start trading. Market data is fully visible while you verify.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {!walletAddress && (
          <div style={{
            flex: 1, padding: '9px', borderRadius: 6, textAlign: 'center',
            border: '1px solid #f59e0b33', background: '#1a120022',
            fontSize: 10, color: '#f59e0b88', letterSpacing: '.08em',
          }}>
            METAMASK NOT CONNECTED
          </div>
        )}
        {walletAddress && !isKYCVerified && (
          <button
            onClick={() => navigate('/kyc')}
            style={{
              flex: 1, padding: '9px', borderRadius: 6, border: '1px solid #22c55e33',
              background: '#0d2e1f22', color: '#22c55e88', cursor: 'pointer',
              fontFamily: 'DM Mono, monospace', fontSize: 10, letterSpacing: '.08em',
            }}
          >
            COMPLETE KYC →
          </button>
        )}
      </div>
    </div>
  );
}

// ── WatchlistPanel ────────────────────────────────────────────────
function WatchlistPanel({ listings, selected, setSelected, setAnalyticsToken, watchlist, toggleWatchlist, priceHistories, liveETHINR }) {
  return (
    <div className="cc-panel" style={{ maxHeight: 600, overflowY: 'auto' }}>
      <div className="cc-panel-title">WATCHLIST</div>
      {listings.length === 0 && (
        <div style={{ fontSize: 10, color: '#86efac33', textAlign: 'center', padding: '20px 0' }}>
          No listings
        </div>
      )}
      {listings.map(l => {
        const price   = l.pricePerUnitINR || l.adjPrice * liveETHINR;
        const history = priceHistories[l.tokenId] || [];
        const isUp    = history.length > 1 ? history[history.length - 1] >= history[0] : null;
        const isSel   = selected?.listingId === l.listingId;
        const isStarred = watchlist.includes(l.listingId);
        return (
          <div
            key={l.listingId}
            className={`cc-wl-row${isSel ? ' sel' : ''}`}
            onClick={() => { setSelected(l); setAnalyticsToken(l); }}
          >
            <span
              className={`cc-wl-star${isStarred ? ' on' : ''}`}
              onClick={e => { e.stopPropagation(); toggleWatchlist(l.listingId); }}
            >★</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: '#f0fdf4', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {l.projectName}
              </div>
              <div style={{ fontSize: 9, color: '#86efac44', marginTop: 1 }}>
                {l.standard} · {l.amount} avail
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: isUp === null ? '#86efac88' : isUp ? '#22c55e' : '#f87171' }}>
                {fmt(n0(price))}
              </div>
              {history.length >= 2 && (
                <MiniChart data={history.slice(-10)} color={isUp ? '#22c55e' : '#f87171'} width={50} height={18}/>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── OrderBookPanel ────────────────────────────────────────────────
function OrderBookPanel({ allAsks, allBids, selectedAsks, selectedBids, selected, liveETHINR, setSelected, setTab }) {
  const [obMode, setObMode] = useState('all');

  const asks = obMode === 'all' ? allAsks : selectedAsks.map(l => ({
    price: l.adjPrice,
    priceInr: l.pricePerUnitINR || l.adjPrice * liveETHINR,
    amount: l.amount,
    seller: l.seller,
    listingId: l.listingId,
    projectName: l.projectName,
    tokenId: l.tokenId,
  }));
  const bids = obMode === 'all' ? allBids : selectedBids.map(o => ({
    price: o.limitPrice,
    priceInr: o.limitPrice * liveETHINR,
    amount: o.remaining,
    buyer: o.buyer,
    orderId: o.orderId,
    tokenId: o.tokenId,
  }));
  const maxD     = Math.max(...asks.map(a => a.amount), ...bids.map(b => b.amount), 1);
  const midPrice = asks.length ? asks[0].priceInr : (bids.length ? bids[0].priceInr : 0);
  const spreadVal = asks.length && bids.length
    ? n0((asks[0].price - bids[0].price) * liveETHINR)
    : '—';

  return (
    <div className="cc-panel" style={{ minHeight: 400 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div className="cc-panel-title" style={{ marginBottom: 0 }}>ORDER BOOK</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['all', 'ALL'], ['token', 'TOKEN']].map(([m, l]) => (
            <button
              key={m}
              onClick={() => setObMode(m)}
              style={{
                padding: '3px 8px', borderRadius: 3,
                border: `1px solid ${obMode === m ? '#22c55e44' : '#0f2a1a'}`,
                background: obMode === m ? '#0d2e1f22' : 'transparent',
                color: obMode === m ? '#22c55e' : '#86efac33',
                cursor: 'pointer', fontFamily: 'DM Mono,monospace',
                fontSize: 8, letterSpacing: '.08em',
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {obMode === 'token' && selected && (
        <div style={{ fontSize: 9, color: '#86efac33', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected.projectName}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 50px', gap: 4, padding: '0 8px 4px', fontSize: 8, color: '#86efac33', letterSpacing: '.1em', borderBottom: '1px solid #0f2a1a', marginBottom: 4 }}>
        <span>PRICE</span><span style={{ textAlign: 'center' }}>DEPTH</span><span style={{ textAlign: 'right' }}>QTY</span>
      </div>
      <div style={{ fontSize: 9, color: '#f87171aa', letterSpacing: '.1em', padding: '4px 8px 2px' }}>ASKS</div>
      {asks.length === 0 && <div style={{ fontSize: 10, color: '#86efac22', padding: '4px 8px 6px' }}>No asks</div>}
      {[...asks].reverse().slice(0, 7).map((a, i) => (
        <div key={i} className="cc-ob-ask">
          <span style={{ color: '#f87171', minWidth: 80, fontWeight: 500, fontSize: 11 }}>{fmt(n0(a.priceInr))}</span>
          <div style={{ flex: 1 }}><DepthBar qty={a.amount} max={maxD}/></div>
          <span style={{ color: '#86efac55', minWidth: 36, textAlign: 'right', fontSize: 10 }}>{a.amount}</span>
        </div>
      ))}
      <div className="cc-ob-mid">
        {fmt(n0(midPrice))}
        <span style={{ fontSize: 9, color: '#86efac44', marginLeft: 6, fontWeight: 400 }}>MID</span>
      </div>
      <div style={{ fontSize: 9, color: '#22c55eaa', letterSpacing: '.1em', padding: '2px 8px 4px' }}>BIDS</div>
      {bids.length === 0 && <div style={{ fontSize: 10, color: '#86efac22', padding: '4px 8px' }}>No bids</div>}
      {bids.slice(0, 7).map((b, i) => (
        <div key={i} className="cc-ob-bid">
          <span style={{ color: '#22c55e', minWidth: 80, fontWeight: 500, fontSize: 11 }}>{fmt(n0(b.priceInr))}</span>
          <div style={{ flex: 1 }}><DepthBar qty={b.amount} max={maxD}/></div>
          <span style={{ color: '#86efac55', minWidth: 36, textAlign: 'right', fontSize: 10 }}>{b.amount}</span>
        </div>
      ))}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #0f2a1a', fontSize: 9 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 8px' }}>
          <span style={{ color: '#86efac33' }}>SPREAD</span>
          <span style={{ color: '#facc15' }}>₹{spreadVal}</span>
        </div>
      </div>
    </div>
  );
}

// ── CreditInfoCard ────────────────────────────────────────────────
function CreditInfoCard({ selected, currentPriceInr, priceHistories, liveETHINR }) {
  if (!selected) return (
    <div className="cc-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160 }}>
      <div style={{ textAlign: 'center', color: '#86efac33', fontSize: 11 }}>← Select a credit from the list</div>
    </div>
  );
  const history = priceHistories[selected.tokenId] || [];
  return (
    <div className="cc-panel" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#f0fdf4', marginBottom: 6, lineHeight: 1.3 }}>
            {selected.projectName}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge label={selected.standard} color={STANDARDS[selected.standard]?.color} bg={STANDARDS[selected.standard]?.bg}/>
            <Badge
              label={selected.projectType}
              color={(TYPE_COLORS[selected.projectType] || TYPE_COLORS.Renewable).text}
              bg={(TYPE_COLORS[selected.projectType] || TYPE_COLORS.Renewable).bg}
            />
            <span style={{ fontSize: 9, color: '#86efac55' }}>📍 {selected.location}</span>
            <span style={{ fontSize: 9, color: '#86efac44' }}>Vintage {selected.vintageYear}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#22c55e', letterSpacing: '.02em' }}>
            {fmt(n0(currentPriceInr))}
          </div>
          <div style={{ fontSize: 10, color: '#86efac55' }}>{fmtEth(currentPriceInr)}</div>
        </div>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #0f2a1a' }}>
        <div style={{ fontSize: 8, color: '#86efac44', letterSpacing: '.12em', marginBottom: 6 }}>
          PRICE HISTORY {history.length < 2 && <span style={{ color: '#86efac22' }}>— NO TRADES YET</span>}
        </div>
        {history.length >= 2
          ? <MiniChart data={history} color="#22c55e" width={300} height={48}/>
          : <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#86efac22', fontSize: 9, letterSpacing: '.1em' }}>
              CHART AVAILABLE AFTER FIRST TRADE
            </div>
        }
      </div>
    </div>
  );
}

// ── OrderForm ─────────────────────────────────────────────────────
function OrderForm({
  isKYCVerified, walletAddress, txPending, listings, selected, setSelected,
  orderMode, setOrderMode, qty, setQty, limitPrice, setLimitPrice,
  bidQty, setBidQty, bidPrice, setBidPrice, bidDays, setBidDays,
  paymentMode, setPaymentMode, inrBalance, inrLoading,
  tradePriceINR, tradeTotalInr, tradeFeeInr, tradeNetInr, tradeNetEth,
  bidTotalEth, bidFeeEth, bidEscrowEth,
  liveETHINR, handlePlaceOrder, handlePlaceBid, navigate,
}) {
  const canTrade      = isKYCVerified;
  const inrSufficient = inrBalance >= tradeNetInr && tradeNetInr > 0;
  const maxQty        = selected?.amount || 0;
  const qtyOverMax    = qty && +qty > maxQty;

  return (
    <div>
      <div className="cc-panel" style={{ marginBottom: 10 }}>
        <div className="cc-panel-title">PLACE ORDER</div>

        <ConnectPrompt isKYCVerified={isKYCVerified} walletAddress={walletAddress} navigate={navigate}/>

        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {[['market', 'MARKET'], ['limit', 'LIMIT'], ['bid', 'BID']].map(([m, label]) => (
            <button key={m} className={`cc-mode-btn${orderMode === m ? ' act' : ''}`} onClick={() => setOrderMode(m)}>
              {label}
            </button>
          ))}
        </div>

        {(orderMode === 'market' || orderMode === 'limit') && (
          <>
            <select
              className="cc-inp"
              value={selected?.listingId || ''}
              onChange={e => setSelected(listings.find(l => l.listingId === +e.target.value))}
            >
              <option value="">Select credit...</option>
              {listings.map(l => (
                <option key={l.listingId} value={l.listingId}>
                  {l.projectName} · {fmt(n0(l.pricePerUnitINR || l.adjPrice * liveETHINR))}
                </option>
              ))}
            </select>

            <div style={{ position: 'relative' }}>
              <input
                className="cc-inp"
                type="number"
                min="1"
                max={maxQty}
                placeholder={`Qty (max ${maxQty})`}
                value={qty}
                onChange={e => setQty(e.target.value)}
                style={{ borderColor: qtyOverMax ? '#f87171' : undefined }}
              />
              {qtyOverMax && (
                <div style={{ fontSize: 9, color: '#f87171', marginTop: -6, marginBottom: 6, paddingLeft: 2 }}>
                  ⚠ Max available: {maxQty} credits
                </div>
              )}
            </div>

            {orderMode === 'limit' && (
              <input
                className="cc-inp"
                type="number"
                placeholder="Max price (₹ per credit)"
                value={limitPrice}
                onChange={e => setLimitPrice(e.target.value)}
              />
            )}

            {canTrade && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.1em', marginBottom: 6 }}>PAY WITH</div>
                <div style={{ display: 'flex', gap: 6 }}>

                  {/* INR Wallet */}
                  <button
                    onClick={() => setPaymentMode('inr')}
                    style={{
                      flex: 1, padding: '10px 6px', borderRadius: 8,
                      border: `1px solid ${paymentMode === 'inr' ? '#22c55e55' : '#0f2a1a'}`,
                      background: paymentMode === 'inr' ? '#0d2e1f' : '#060a07',
                      cursor: 'pointer', fontFamily: 'DM Mono,monospace',
                      transition: 'all 0.2s', textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 16, marginBottom: 3 }}>🇮🇳</div>
                    <div style={{ fontSize: 9, color: paymentMode === 'inr' ? '#22c55e' : '#4ade8044', fontWeight: 600, letterSpacing: '.08em' }}>INR WALLET</div>
                    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 3, color: inrLoading ? '#4ade8044' : inrBalance > 0 ? '#22c55e' : '#f87171' }}>
                      {inrLoading ? '...' : `₹${inrBalance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                    </div>
                    {paymentMode === 'inr' && tradeNetInr > 0 && (
                      <div style={{ fontSize: 8, marginTop: 2, color: inrSufficient ? '#22c55e88' : '#f87171' }}>
                        {inrSufficient ? '✓ SUFFICIENT' : `SHORT ₹${Math.round(tradeNetInr - inrBalance).toLocaleString('en-IN')}`}
                      </div>
                    )}
                  </button>

                  {/* NEW: Razorpay Direct */}
                  <button
                    onClick={() => setPaymentMode('razorpay')}
                    style={{
                      flex: 1, padding: '10px 6px', borderRadius: 8,
                      border: `1px solid ${paymentMode === 'razorpay' ? '#60a5fa55' : '#0f2a1a'}`,
                      background: paymentMode === 'razorpay' ? '#0a1628' : '#060a07',
                      cursor: 'pointer', fontFamily: 'DM Mono,monospace',
                      transition: 'all 0.2s', textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 16, marginBottom: 3 }}>💳</div>
                    <div style={{ fontSize: 9, color: paymentMode === 'razorpay' ? '#60a5fa' : '#4ade8044', fontWeight: 600, letterSpacing: '.08em' }}>UPI/CARD</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa88', marginTop: 3 }}>RAZORPAY</div>
                    <div style={{ fontSize: 8, color: '#60a5fa44', marginTop: 2 }}>NO CAP</div>
                  </button>

                  {/* MetaMask ETH */}
                  <button
                    onClick={() => setPaymentMode('eth')}
                    style={{
                      flex: 1, padding: '10px 6px', borderRadius: 8,
                      border: `1px solid ${paymentMode === 'eth' ? '#f59e0b55' : '#0f2a1a'}`,
                      background: paymentMode === 'eth' ? '#1a1200' : '#060a07',
                      cursor: 'pointer', fontFamily: 'DM Mono,monospace',
                      transition: 'all 0.2s', textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 16, marginBottom: 3 }}>🦊</div>
                    <div style={{ fontSize: 9, color: paymentMode === 'eth' ? '#f59e0b' : '#4ade8044', fontWeight: 600, letterSpacing: '.08em' }}>METAMASK</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b88', marginTop: 3 }}>ETH</div>
                    <div style={{ fontSize: 8, color: '#f59e0b44', marginTop: 2 }}>
                      {walletAddress ? 'ON-CHAIN' : 'NOT CONNECTED'}
                    </div>
                  </button>
                </div>
                {paymentMode === 'inr' && !inrSufficient && tradeNetInr > 0 && (
                  <button
                    onClick={() => navigate('/wallet')}
                    style={{
                      width: '100%', marginTop: 6, padding: '7px', borderRadius: 6,
                      border: '1px solid #22c55e33', background: '#0d2e1f22',
                      color: '#22c55e88', cursor: 'pointer',
                      fontFamily: 'DM Mono,monospace', fontSize: 9, letterSpacing: '.08em',
                    }}
                  >
                    + ADD FUNDS TO WALLET →
                  </button>
                )}
              </div>
            )}

            {qty > 0 && selected && !qtyOverMax && canTrade && (
              <div style={{ background: '#040706', borderRadius: 6, padding: '9px 11px', marginBottom: 10 }}>
                <div className="cc-fee-row"><span>Subtotal</span><span>{fmt(n0(tradeTotalInr))}</span></div>
                <div className="cc-fee-row">
                  <span>Vintage adj</span>
                  <span style={{ color: '#facc1577' }}>{selected.vintageDiscount > 0 ? `-${selected.vintageDiscount}%` : 'None'}</span>
                </div>
                <div className="cc-fee-row">
                  <span>Platform fee (0.5%)</span>
                  <span style={{ color: '#facc15' }}>{fmt(n0(tradeFeeInr))}</span>
                </div>
                {paymentMode === 'inr' ? (
                  <div className="cc-fee-tot">
                    <span>TOTAL (INR WALLET)</span>
                    <span style={{ color: inrSufficient ? '#22c55e' : '#f87171' }}>
                      ₹{Math.round(tradeNetInr).toLocaleString('en-IN')}
                    </span>
                  </div>
                ) : paymentMode === 'razorpay' ? (
                  <div className="cc-fee-tot">
                    <span>TOTAL (UPI/CARD)</span>
                    <span style={{ color: '#60a5fa' }}>₹{Math.round(tradeNetInr).toLocaleString('en-IN')}</span>
                  </div>
                ) : (
                  <>
                    <div className="cc-fee-row"><span>ETH</span><span style={{ color: '#60a5fa88' }}>{Number(tradeNetEth || 0).toFixed(6)}</span></div>
                    <div className="cc-fee-tot">
                      <span>TOTAL</span>
                      <span style={{ color: '#f87171' }}>{fmt(n0(tradeNetInr))}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              className="cc-btn cc-btn-buy"
              disabled={
                !canTrade || txPending || qtyOverMax ||
                (paymentMode === 'eth' && !walletAddress) ||
                (paymentMode === 'inr' && (!inrSufficient || tradeNetInr <= 0))
              }
              onClick={handlePlaceOrder}
              style={
                !canTrade
                  ? { background: 'linear-gradient(135deg,#1a1a1a,#2a2a2a)', color: '#86efac33' }
                  : paymentMode === 'inr' && !inrSufficient
                    ? { background: 'linear-gradient(135deg,#374151,#4b5563)' }
                    : paymentMode === 'razorpay'
                      ? { background: 'linear-gradient(135deg,#1d4ed8,#1e40af)' }
                      : {}
              }
            >
              {txPending     ? '⏳ PROCESSING...'
               : !canTrade  ? (walletAddress ? '🔒 COMPLETE KYC TO TRADE' : '🦊 CONNECT METAMASK TO TRADE')
               : qtyOverMax ? `⚠ MAX ${maxQty} AVAILABLE`
               : paymentMode === 'inr'
                 ? inrSufficient
                   ? `🇮🇳 BUY ${qty || '—'} · ₹${Math.round(tradeNetInr).toLocaleString('en-IN')}`
                   : '⚠ INSUFFICIENT BALANCE'
                 : paymentMode === 'razorpay'
                   ? `💳 BUY ${qty || '—'} · ₹${Math.round(tradeNetInr).toLocaleString('en-IN')}`
                   : `🦊 BUY ${qty || '—'} CREDITS`
              }
            </button>
          </>
        )}

        {orderMode === 'bid' && (
          <>
            <div style={{ fontSize: 9, color: '#60a5fa88', marginBottom: 10, padding: 8, background: '#0a1628', borderRadius: 6, border: '1px solid #60a5fa22', lineHeight: 1.6 }}>
              📥 Lock ETH on-chain. Auto-executes when seller lists at your price.
            </div>
            <select
              className="cc-inp"
              value={selected?.listingId || ''}
              onChange={e => setSelected(listings.find(l => l.listingId === +e.target.value))}
            >
              <option value="">Select credit token...</option>
              {listings.map(l => <option key={l.listingId} value={l.listingId}>{l.projectName}</option>)}
            </select>
            <input className="cc-inp" type="number" placeholder="Quantity (credits)" value={bidQty} onChange={e => setBidQty(e.target.value)}/>
            <input className="cc-inp" type="number" placeholder="Bid price (₹ per credit)" value={bidPrice} onChange={e => setBidPrice(e.target.value)}/>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {['7', '14', '30'].map(d => (
                <button
                  key={d}
                  onClick={() => setBidDays(d)}
                  style={{
                    flex: 1, padding: 6, borderRadius: 4,
                    border: `1px solid ${bidDays === d ? '#22c55e44' : '#0f2a1a'}`,
                    background: bidDays === d ? '#0d2e1f22' : 'transparent',
                    color: bidDays === d ? '#22c55e' : '#86efac44',
                    cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 10,
                  }}
                >
                  {d}d
                </button>
              ))}
            </div>
            {bidQty > 0 && bidPrice > 0 && (
              <div style={{ background: '#040706', borderRadius: 6, padding: '9px 11px', marginBottom: 10 }}>
                <div className="cc-fee-row"><span>Bid total</span><span>{Number(bidTotalEth || 0).toFixed(6)} ETH</span></div>
                <div className="cc-fee-row"><span>Fee (0.5%)</span><span style={{ color: '#facc15' }}>{Number(bidFeeEth || 0).toFixed(6)} ETH</span></div>
                <div className="cc-fee-tot"><span>LOCKED IN ESCROW</span><span style={{ color: '#60a5fa' }}>{Number(bidEscrowEth || 0).toFixed(6)} ETH</span></div>
              </div>
            )}
            <button
              className="cc-btn cc-btn-bid"
              disabled={!canTrade || !walletAddress || txPending}
              onClick={handlePlaceBid}
            >
              {txPending
                ? '⏳ PROCESSING...'
                : !canTrade
                  ? (walletAddress ? '🔒 COMPLETE KYC TO BID' : '🦊 CONNECT METAMASK TO BID')
                  : `PLACE BID · LOCK ${Number(bidEscrowEth || 0).toFixed(4)} ETH`
              }
            </button>
          </>
        )}

        <div style={{ marginTop: 8, fontSize: 9, color: '#86efac33', textAlign: 'center' }}>
          1 credit = 1 tonne CO₂ · MetaMask required for on-chain signing
        </div>
      </div>

      <div className="cc-panel">
        <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.12em', marginBottom: 8 }}>HAVE CREDITS TO SELL?</div>
        <button
          style={{ width: '100%', padding: '9px', borderRadius: 6, border: '1px solid #facc1533', background: 'transparent', color: '#facc1566', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 10 }}
          onClick={() => navigate('/portfolio')}
        >
          GO TO PORTFOLIO →
        </button>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────
export default function CarbonCredits() {
  const navigate = useNavigate();
  const { addNotification, NOTIF_TYPES } = useNotifications();

  const {
    isKYCVerified,
    refreshTradeHistory,
  } = usePortfolio();

  const {
    listings,
    buyOrders,
    tradeHistory,
    marketStats,
    loading: marketLoading,
    error:   marketError,
    refetch: refetchMarket,
    liveETHINR,
  } = useMarket();

  const loading = { listings: marketLoading };

  // ── State ─────────────────────────────────────────────────────
  const [tab,              setTab]              = useState('market');
  const [selected,         setSelected]         = useState(null);
  const [orderMode,        setOrderMode]        = useState('market');
  const [qty,              setQty]              = useState('');
  const [limitPrice,       setLimitPrice]       = useState('');
  const [bidPrice,         setBidPrice]         = useState('');
  const [bidQty,           setBidQty]           = useState('');
  const [bidDays,          setBidDays]          = useState('7');
  const [filterStd,        setFilterStd]        = useState('ALL');
  const [filterType,       setFilterType]       = useState('ALL');
  const [sortBy,           setSortBy]           = useState('price');
  const [alertPrice,       setAlertPrice]       = useState('');
  const [alertType,        setAlertType]        = useState('below');
  const [alerts,           setAlerts]           = useState([]);
  const [confirmModal,     setConfirmModal]     = useState(null);
  const [toast,            setToast]            = useState({ msg: '', type: 'success' });
  const [txPending,        setTxPending]        = useState(false);
  const [ammModal,         setAmmModal]         = useState(null);
  const [ammQty,           setAmmQty]           = useState('');
  const [ammDir,           setAmmDir]           = useState('buy');
  const [myOpenBids,       setMyOpenBids]       = useState([]);
  const [priceHistories,   setPriceHistories]   = useState({});
  const [watchlist,        setWatchlist]        = useState([]);
  const [analyticsToken,   setAnalyticsToken]   = useState(null);
  const [paymentMode,      setPaymentMode]      = useState('eth');
  const [inrBalance,       setInrBalance]       = useState(0);
  const [inrLoading,       setInrLoading]       = useState(false);
  const [cancelBidConfirm, setCancelBidConfirm] = useState(null);

  // ── CSS ────────────────────────────────────────────────────────
  const CSS = useMemo(() => `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    ::-webkit-scrollbar{width:4px;height:4px;}
    ::-webkit-scrollbar-track{background:#080c0a;}
    ::-webkit-scrollbar-thumb{background:#0f2a1a;border-radius:2px;}
    .cc{min-height:100vh;background:#060908;font-family:'DM Mono',monospace;color:#f0fdf4;}
    .cc::before{content:'';position:fixed;inset:0;z-index:0;background-image:radial-gradient(circle at 20% 50%,rgba(34,197,94,0.03) 0%,transparent 50%),radial-gradient(circle at 80% 20%,rgba(96,165,250,0.02) 0%,transparent 50%);pointer-events:none;}
    .cc-wrap{position:relative;z-index:1;max-width:1400px;margin:0 auto;padding:24px 20px 80px;}
    .cc-ticker-wrap{overflow:hidden;background:#080c0a;border:1px solid #0f2a1a;border-radius:8px;margin-bottom:16px;position:relative;}
    .cc-ticker-wrap::before,.cc-ticker-wrap::after{content:'';position:absolute;top:0;bottom:0;width:40px;z-index:2;pointer-events:none;}
    .cc-ticker-wrap::before{left:0;background:linear-gradient(to right,#080c0a,transparent);}
    .cc-ticker-wrap::after{right:0;background:linear-gradient(to left,#080c0a,transparent);}
    .cc-ticker-inner{display:flex;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;padding:0 8px;}
    .cc-ticker-inner::-webkit-scrollbar{display:none;}
    .cc-tick{flex:0 0 auto;padding:10px 16px;border-right:1px solid #0f2a1a08;cursor:pointer;transition:background .15s;min-width:150px;}
    .cc-tick:hover,.cc-tick.sel{background:#0d2e1f22;}
    .cc-tick-name{font-size:9px;color:#86efac55;letter-spacing:.1em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;margin-bottom:2px;}
    .cc-tick-price{font-size:13px;font-weight:500;letter-spacing:.04em;}
    .cc-tick-chg{font-size:9px;margin-top:1px;letter-spacing:.06em;}
    .cc-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px;}
    .cc-stat{background:#080c0a;border:1px solid #0f2a1a;border-radius:8px;padding:12px 14px;}
    .cc-stat-lbl{font-size:8px;color:#86efac55;letter-spacing:.14em;margin-bottom:4px;}
    .cc-stat-val{font-size:18px;font-weight:500;color:#f0fdf4;letter-spacing:.02em;}
    .cc-stat-sub{font-size:9px;color:#22c55e88;margin-top:2px;}
    .cc-tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid #0f2a1a;padding-bottom:0;}
    .cc-tab{padding:9px 16px;border:none;border-bottom:2px solid transparent;background:transparent;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;color:#86efac44;transition:all .2s;margin-bottom:-1px;}
    .cc-tab:hover{color:#86efac88;}
    .cc-tab.act{color:#22c55e;border-bottom-color:#22c55e;}
    .cc-market-layout{display:grid;grid-template-columns:240px 1fr;gap:12px;}
    .cc-trade-layout{display:grid;grid-template-columns:220px 1fr 280px;gap:12px;}
    .cc-panel{background:#080c0a;border:1px solid #0f2a1a;border-radius:10px;padding:16px;}
    .cc-panel-title{font-size:9px;color:#86efac55;letter-spacing:.14em;margin-bottom:12px;}
    .cc-wl-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #0f2a1a08;cursor:pointer;transition:background .15s;border-radius:4px;}
    .cc-wl-row:hover,.cc-wl-row.sel{background:#0d2e1f18;padding-left:4px;}
    .cc-wl-star{font-size:11px;cursor:pointer;color:#86efac22;transition:color .15s;}
    .cc-wl-star.on{color:#facc15;}
    .cc-tbl-head{display:grid;grid-template-columns:2fr 80px 110px 70px 90px 90px 70px;gap:8px;padding:0 8px 8px;font-size:8px;color:#86efac44;letter-spacing:.12em;border-bottom:1px solid #0f2a1a;}
    .cc-tbl-row{display:grid;grid-template-columns:2fr 80px 110px 70px 90px 90px 70px;gap:8px;padding:10px 8px;border-bottom:1px solid #0f2a1a08;cursor:pointer;transition:all .15s;align-items:center;border-radius:4px;}
    .cc-tbl-row:hover,.cc-tbl-row.sel{background:#0d2e1f22;}
    .cc-tbl-row.sel{border-left:2px solid #22c55e33;padding-left:6px;}
    .cc-ob-ask{display:flex;justify-content:space-between;align-items:center;padding:4px 8px;font-size:11px;gap:8px;transition:background .1s;}
    .cc-ob-ask:hover{background:#f8717108;}
    .cc-ob-bid{display:flex;justify-content:space-between;align-items:center;padding:4px 8px;font-size:11px;gap:8px;transition:background .1s;}
    .cc-ob-bid:hover{background:#22c55e08;}
    .cc-ob-mid{text-align:center;padding:8px;font-size:20px;font-weight:500;color:#22c55e;letter-spacing:.04em;background:#0d2e1f11;margin:4px 0;border-radius:4px;}
    .cc-mode-btn{flex:1;padding:8px 4px;border-radius:4px;border:1px solid #0f2a1a;background:transparent;cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.08em;color:#86efac44;transition:all .2s;}
    .cc-mode-btn.act{border-color:#22c55e44;color:#22c55e;background:#0d2e1f22;}
    .cc-inp{width:100%;padding:9px 11px;border-radius:6px;border:1px solid #0f2a1a;background:#040706;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:11px;outline:none;margin-bottom:8px;transition:border-color .2s;}
    .cc-inp:focus{border-color:#22c55e33;}
    .cc-fee-row{display:flex;justify-content:space-between;font-size:10px;padding:3px 0;color:#86efac77;}
    .cc-fee-tot{display:flex;justify-content:space-between;font-size:11px;font-weight:500;padding:7px 0 3px;border-top:1px solid #0f2a1a;color:#f0fdf4;}
    .cc-btn{width:100%;padding:11px;border-radius:7px;border:none;cursor:pointer;font-family:'DM Mono',monospace;font-size:12px;font-weight:500;letter-spacing:.1em;transition:opacity .2s;}
    .cc-btn:disabled{opacity:.35;cursor:not-allowed;}
    .cc-btn-buy{background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;}
    .cc-btn-bid{background:linear-gradient(135deg,#1d4ed8,#1e40af);color:#fff;}
    .cc-btn-red{background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;}
    .cc-bids-head{display:grid;grid-template-columns:60px 1fr 80px 100px 70px 70px;gap:8px;font-size:8px;color:#86efac44;letter-spacing:.12em;padding:0 0 8px;border-bottom:1px solid #0f2a1a;}
    .cc-bids-row{display:grid;grid-template-columns:60px 1fr 80px 100px 70px 70px;gap:8px;font-size:10px;padding:10px 0;border-bottom:1px solid #0f2a1a08;align-items:center;}
    .cc-hist-head{display:grid;grid-template-columns:1fr 60px 80px 90px 80px 70px 90px;gap:8px;font-size:8px;color:#86efac44;letter-spacing:.12em;padding:0 0 8px;border-bottom:1px solid #0f2a1a;}
    .cc-hist-row{display:grid;grid-template-columns:1fr 60px 80px 90px 80px 70px 90px;gap:8px;font-size:10px;padding:9px 0;border-bottom:1px solid #0f2a1a08;cursor:pointer;align-items:center;}
    .cc-hist-row:hover{background:#0d2e1f18;}
    .cc-chart-wrap{background:#040706;border-radius:8px;padding:16px;border:1px solid #0f2a1a;margin-bottom:12px;}
    .cc-amm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
    .cc-amm-card{background:#080c0a;border-radius:10px;padding:18px;cursor:pointer;transition:all .2s;border:1px solid #0f2a1a;}
    .cc-amm-card:hover{transform:translateY(-2px);}
    .cc-pool-stat{display:flex;justify-content:space-between;padding:5px 0;font-size:10px;border-bottom:1px solid #0f2a1a08;}
    .cc-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);backdrop-filter:blur(6px);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px;}
    .cc-modal{background:#080c0a;border:1px solid #0f2a1a;border-radius:14px;width:100%;max-width:420px;box-shadow:0 32px 80px rgba(0,0,0,.9);animation:slideUp .2s ease;}
    .cc-modal-h{padding:16px 20px;border-bottom:1px solid #0f2a1a;display:flex;justify-content:space-between;align-items:center;}
    .cc-modal-b{padding:20px;}
    .cc-modal-f{padding:14px 20px;border-top:1px solid #0f2a1a;display:flex;gap:8px;}
    .cc-btn-ok{flex:1;padding:11px;border-radius:7px;border:none;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:500;letter-spacing:.08em;}
    .cc-btn-cn{flex:1;padding:11px;border-radius:7px;border:1px solid #0f2a1a;background:transparent;color:#86efac55;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;}
    .cc-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%);z-index:9999;background:#080c0a;border-radius:10px;padding:16px 28px;font-size:12px;font-family:'DM Mono',monospace;letter-spacing:.04em;box-shadow:0 8px 40px rgba(0,0,0,.9);animation:slideIn .3s ease;min-width:340px;max-width:540px;text-align:center;border-width:1px;border-style:solid;}
    .cc-toast-error{position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:9999;background:#1a0707;border:1px solid #f8717166;border-radius:10px;padding:16px 28px;font-size:12px;font-family:'DM Mono',monospace;letter-spacing:.04em;box-shadow:0 8px 40px rgba(0,0,0,.9);animation:slideDown .3s ease;min-width:340px;max-width:540px;text-align:center;color:#f87171;}
    @keyframes slideDown{from{opacity:0;transform:translateX(-50%) translateY(-12px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}
    .cc-pending{position:fixed;bottom:80px;right:24px;z-index:9999;background:#080c0a;border:1px solid #22c55e33;border-radius:8px;padding:12px 18px;font-size:11px;color:#22c55e;font-family:'DM Mono',monospace;display:flex;align-items:center;gap:10px;}
    .cc-spin{width:12px;height:12px;border:2px solid #22c55e22;border-top-color:#22c55e;border-radius:50%;animation:spin 1s linear infinite;}
    .dot-live{display:inline-block;width:5px;height:5px;border-radius:50%;background:#22c55e;margin-right:5px;animation:livepulse 1.5s infinite;}
    @keyframes slideUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
    @keyframes slideIn{from{opacity:0;transform:translateX(16px);}to{opacity:1;transform:translateX(0);}}
    @keyframes spin{to{transform:rotate(360deg);}}
    @keyframes livepulse{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.4);}50%{box-shadow:0 0 0 4px rgba(34,197,94,0);}}
    @keyframes pulse{0%,100%{opacity:.4;}50%{opacity:.9;}}
    @media(max-width:1200px){.cc-trade-layout{grid-template-columns:200px 1fr 260px;}.cc-amm-grid{grid-template-columns:1fr 1fr;}}
    @media(max-width:1024px){.cc-trade-layout{grid-template-columns:1fr 1fr;}.cc-stats{grid-template-columns:repeat(3,1fr);}}
    @media(max-width:768px){.cc-market-layout{grid-template-columns:1fr;}.cc-trade-layout{grid-template-columns:1fr;}.cc-stats{grid-template-columns:repeat(2,1fr);}.cc-tbl-head>*:nth-child(n+5),.cc-tbl-row>*:nth-child(n+5){display:none;}.cc-amm-grid{grid-template-columns:1fr;}}
  `, []);

  

  // ── Price histories ───────────────────────────────────────────
  useEffect(() => {
    if (!listings.length) return;
    const h = {};
    listings.forEach(l => {
      h[l.tokenId] = buildPriceHistory(tradeHistory, l.tokenId);
    });
    setPriceHistories(h);
  }, [listings, tradeHistory]);

  // ── Auto-select first listing ─────────────────────────────────
  useEffect(() => {
    if (!selected && listings.length) {
      setSelected(listings[0]);
      setAnalyticsToken(listings[0]);
    }
  }, [listings, selected]);

  

  

  // ── Price alerts ──────────────────────────────────────────────
  useEffect(() => {
    if (!alerts.length || !listings.length) return;
    alerts.forEach(a => {
      const listing = listings.find(l => l.listingId === a.listingId);
      if (!listing) return;
      const price = listing.pricePerUnitINR || listing.adjPrice * liveETHINR;
      const triggered = a.type === 'below' ? price <= a.targetPrice : price >= a.targetPrice;
      if (triggered && !a.triggered) {
        showToast(`🔔 ALERT: ${a.projectName} is now ${fmt(n0(price))}`, 'info');
        setAlerts(prev => prev.map(x => x.id === a.id ? { ...x, triggered: true } : x));
      }
    });
  }, [listings, alerts, liveETHINR]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    const duration = type === 'error' ? 7000 : type === 'info' ? 3000 : 6000;
    setTimeout(() => setToast({ msg: '', type: 'success' }), duration);
  };

  const toggleWatchlist = id =>
    setWatchlist(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  // ── Computed values ───────────────────────────────────────────
  const filtered = listings
    .filter(l => filterStd  === 'ALL' || l.standard    === filterStd)
    .filter(l => filterType === 'ALL' || l.projectType === filterType)
    .filter(l => !l.expiresAt || l.expiresAt > Math.floor(Date.now() / 1000))
    .sort((a, b) => {
      if (sortBy === 'price')     return b.adjPrice - a.adjPrice;
      if (sortBy === 'priceAsc')  return a.adjPrice - b.adjPrice;
      if (sortBy === 'name')      return a.projectName.localeCompare(b.projectName);
      if (sortBy === 'vintage')   return b.vintageYear - a.vintageYear;
      if (sortBy === 'amount')    return b.amount - a.amount;
      if (sortBy === 'watchlist') return watchlist.includes(b.listingId) - watchlist.includes(a.listingId);
      return 0;
    });

  const allAsks = listings
    .filter(l => !l.expiresAt || l.expiresAt > Math.floor(Date.now() / 1000))
    .map(l => ({
      price: l.adjPrice,
      priceInr: l.pricePerUnitINR || l.adjPrice * liveETHINR,
      amount: l.amount, seller: l.seller, listingId: l.listingId,
      projectName: l.projectName, tokenId: l.tokenId,
    }))
    .sort((a, b) => a.price - b.price);

  const allBids = buyOrders
    .filter(o => o.status === 0 || o.status === 2)
    .map(o => ({
      price: o.limitPrice, priceInr: o.limitPrice * liveETHINR,
      amount: o.remaining, buyer: o.buyer, orderId: o.orderId, tokenId: o.tokenId,
    }))
    .sort((a, b) => b.price - a.price);

  const selectedAsks = selected
    ? listings.filter(l => l.tokenId === selected.tokenId).sort((a, b) => a.adjPrice - b.adjPrice)
    : [];
  const selectedBids = selected
    ? buyOrders.filter(o => o.tokenId === selected.tokenId && (o.status === 0 || o.status === 2))
        .sort((a, b) => b.limitPrice - a.limitPrice)
    : [];

  const currentPriceInr = selected ? (selected.pricePerUnitINR || selected.adjPrice * liveETHINR) : 0;

  const tradePrice    = orderMode === 'limit' && limitPrice ? parseFloat(limitPrice) / liveETHINR : (selected?.adjPrice || 0);
  const tradePriceINR = selected?.pricePerUnitINR || Math.round(tradePrice * liveETHINR);
  const tradeTotalInr = qty ? parseFloat(qty) * tradePriceINR : 0;
  const tradeFeeInr   = tradeTotalInr * PLATFORM_FEE;
  const tradeNetInr   = tradeTotalInr + tradeFeeInr;
  const tradeNetEth   = tradeNetInr / liveETHINR;

  const bidTotalEth  = bidQty && bidPrice ? parseFloat(bidQty) * (parseFloat(bidPrice) / liveETHINR) : 0;
  const bidFeeEth    = bidTotalEth * PLATFORM_FEE;
  const bidEscrowEth = bidTotalEth + bidFeeEth;

  const totalAvailable  = listings.reduce((s, l) => s + l.amount, 0);
  const openBidsTotal   = buyOrders.filter(o => o.status === 0 || o.status === 2).length;
  const platformRetired = (() => {
    const seen = new Set();
    return listings.reduce((s, l) => {
      if (!seen.has(l.tokenId)) { seen.add(l.tokenId); return s + (l.totalRetired || 0); }
      return s;
    }, 0);
  })();

  const todayStr    = new Date().toLocaleDateString();
  const dailyTrades = tradeHistory.filter(t => {
    try { return new Date(t.time).toLocaleDateString() === todayStr; } catch { return true; }
  });
  const dailyVolume   = dailyTrades.reduce((s, t) => s + (t.amount || 0), 0);
  const avgTradePrice = tradeHistory.length
    ? tradeHistory.reduce((s, t) => {
        const p = t.priceINR || (t.amount > 0 ? (parseFloat(t.totalEth || 0) / t.amount) * liveETHINR : 0);
        return s + p;
      }, 0) / tradeHistory.length
    : 0;

  const analyticsListing = analyticsToken || selected;
  const analyticsHistory = analyticsListing ? (priceHistories[analyticsListing.tokenId] || []) : [];
  const analyticsHigh    = analyticsHistory.length ? Math.max(...analyticsHistory) : 0;
  const analyticsLow     = analyticsHistory.length ? Math.min(...analyticsHistory) : 0;
  const analyticsChange  = analyticsHistory.length > 1
    ? ((analyticsHistory[analyticsHistory.length - 1] - analyticsHistory[0]) / analyticsHistory[0] * 100).toFixed(2)
    : null;

  // ── fetchBatchId ──────────────────────────────────────────────
  const fetchBatchId = async tokenId => {
    try {
      const data = await apiFetch(`/api/portfolio/batch-by-token/${tokenId}`);
      return data?.batchId || null;
    } catch { return null; }
  };

  // ── recordTrade ───────────────────────────────────────────────
  const recordTrade = async ({ txHash, paymentMode, listing, qty, pricePerCreditINR }) => {
    try {
      const data = await tradesAPI.record({
        batchId:           listing.batchId || null,
        listingId:         listing.listingIdOnchain || null,
        quantity:          parseInt(qty),
        paymentMode,
        txHash:            txHash || null,
        pricePerCreditINR: parseFloat(pricePerCreditINR || listing.pricePerUnitINR || Math.round(listing.adjPrice * liveETHINR)),
        idempotencyKey:    txHash,
      });
      if (!data?.success) {
        console.error('ETH trade DB record failed — blockchain listener will retry:', data?.error, '| txHash:', txHash);
      }
      return data;
    } catch (e) {
      console.error('recordTrade fetch failed:', e.message, '| txHash:', txHash);
      return null;
    }
  };

  // ── handlePlaceOrder ──────────────────────────────────────────
  const handlePlaceOrder = () => {
    if (!isKYCVerified)                              { showToast('❌ Complete KYC first', 'error'); return; }
    if (paymentMode === 'eth' && !walletAddress)     { showToast('❌ Connect MetaMask', 'error'); return; }
    if (paymentMode === 'inr' && inrBalance < tradeNetInr) { showToast('❌ Insufficient INR balance', 'error'); return; }
    if (!qty || isNaN(qty) || +qty <= 0)             { showToast('❌ Enter valid quantity', 'error'); return; }
    if (!selected)                                   { showToast('❌ Select a credit', 'error'); return; }
    if (+qty > selected.amount)                      { showToast(`❌ Max available: ${selected.amount}`, 'error'); return; }
    if (selected.seller?.toLowerCase() === walletAddress?.toLowerCase()) { showToast('❌ Cannot buy your own listing', 'error'); return; }
    if (orderMode === 'limit' && (!limitPrice || isNaN(limitPrice))) { showToast('❌ Enter limit price', 'error'); return; }
    setConfirmModal({ type: 'buy', listing: selected, qty: +qty, orderMode, tradePrice, tradePriceINR, tradeTotalInr, tradeFeeInr, tradeNetInr, tradeNetEth, paymentMode });
  };

  // ── handleConfirmBuy — 3 paths ────────────────────────────────
  const handleConfirmBuy = async () => {
    const o = confirmModal;
    setConfirmModal(null);
    setTxPending(true);
    const idempotencyKey = uuidv4();
    try {
      // PATH A: INR Wallet
      if (o.paymentMode === 'inr') {
        showToast('⏳ Processing trade...', 'info');
        const tradeData = await tradesAPI.record({
          batchId:           o.listing.batchId || null,
          listingId:         o.listing.listingIdOnchain || null,
          quantity:          parseInt(o.qty),
          paymentMode:       'inr',
          txHash:            null,
          pricePerCreditINR: parseFloat(o.tradePriceINR),
          idempotencyKey:    idempotencyKey,
        });
        if (!tradeData.success) throw Object.assign(new Error(tradeData.error || 'Trade settlement failed'), { isSettlementError: true });
        if (tradeData.buyerBalance !== undefined) setInrBalance(parseFloat(tradeData.buyerBalance));
        else await refreshINRBalance();
        addNotification({ type: NOTIF_TYPES.TRADE, title: 'Buy Executed ✅', message: `${o.qty} × ${o.listing.projectName} — ₹${Math.round(o.tradeNetInr).toLocaleString('en-IN')} from INR wallet` });
        showToast(`🎉 Congratulations! ${o.qty} credit${o.qty > 1 ? 's' : ''} purchased successfully.
Invoice sent to your email — check Trade History to download your GST invoice.`);
        setQty(''); setLimitPrice('');
        refetchMarket();
        refreshTradeHistory();

      // PATH B: Razorpay Direct (NEW)
      } else if (o.paymentMode === 'razorpay') {
        showToast('⏳ Opening Razorpay...', 'info');
        const loaded = await loadRazorpay();
        if (!loaded) throw new Error('Razorpay SDK failed to load. Please try again.');

        const orderData = await tradesAPI.checkoutOrder({
          batchId:           o.listing.batchId,
          listingId:         o.listing.listingIdOnchain || null,
          quantity:          parseInt(o.qty),
          pricePerCreditINR: parseFloat(o.tradePriceINR),
        });
        if (!orderData?.orderId) throw new Error('Failed to create payment order');

        await new Promise((resolve, reject) => {
          const rzp = new window.Razorpay({
            key:         orderData.keyId,
            amount:      orderData.amount,
            currency:    'INR',
            name:        'EtherTrack',
            description: `${o.qty} × ${o.listing.projectName}`,
            order_id:    orderData.orderId,
            theme:       { color: '#22c55e' },
            modal:       { ondismiss: () => reject(new Error('Payment cancelled')) },
            handler: async (response) => {
              try {
                showToast('⏳ Verifying payment...', 'info');
                const result = await tradesAPI.checkoutVerify({
                  razorpay_order_id:   response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature:  response.razorpay_signature,
                  idempotencyKey,
                });
                if (!result?.success) throw new Error(result?.error || 'Settlement failed');
                addNotification({ type: NOTIF_TYPES.TRADE, title: 'Buy Executed ✅', message: `${o.qty} × ${o.listing.projectName} — ₹${Math.round(o.tradeNetInr).toLocaleString('en-IN')} via Razorpay` });
                showToast(`🎉 Congratulations! ${o.qty} credit${o.qty > 1 ? 's' : ''} purchased successfully.
Invoice sent to your email — check Trade History to download your GST invoice.`);
                setQty(''); setLimitPrice('');
                refetchMarket(); refreshTradeHistory();
                resolve(result);
              } catch (e) { reject(e); }
            },
          });
          rzp.on('payment.failed', r => reject(new Error(r.error?.description || 'Payment failed')));
          rzp.open();
        });

      // PATH C: ETH on-chain
      } else {
        showToast('⏳ Confirm in MetaMask...', 'info');
        const r = await buyCredit(o.listing.listingIdOnchain, o.qty, Number(o.tradeNetEth || 0).toFixed(8));
        await recordTrade({ txHash: r.txHash, paymentMode: 'eth', listing: o.listing, qty: o.qty, pricePerCreditINR: o.tradePriceINR });
        addNotification({ type: NOTIF_TYPES.TRADE, title: 'Buy Executed ✅', message: `${o.qty} × ${o.listing.projectName} — ${Number(o.tradeNetEth || 0).toFixed(4)} ETH` });
        showToast(`🎉 Trade confirmed on-chain! ${o.qty} credit${o.qty > 1 ? 's' : ''} are now yours.
Check your email for invoice or visit Trade History to download your GST PDF.`);
        setQty(''); setLimitPrice('');
        refetchMarket();
        refreshTradeHistory();
        navigate(`/transaction-status?hash=${r.txHash}`);
      }
    } catch (e) {
      if (e.code === 4001 || e.message === 'Payment cancelled') {
        showToast('❌ Payment cancelled — no charges made.', 'error');
      } else if (e.message?.toLowerCase().includes('insufficient') || e.message?.toLowerCase().includes('balance')) {
        showToast('❌ Insufficient balance — please top up your wallet and try again.', 'error');
      } else if (e.message?.toLowerCase().includes('price') || e.message?.toLowerCase().includes('mismatch')) {
        showToast('❌ Price changed — please refresh the page and try again.', 'error');
      } else if (e.message?.toLowerCase().includes('kyc')) {
        showToast('❌ KYC required — complete your KYC verification to trade.', 'error');
      } else if (e.message?.toLowerCase().includes('network') || e.message?.toLowerCase().includes('timeout')) {
        showToast('❌ Network error — please check your connection and try again.', 'error');
      } else if (e.isSettlementError) {
        showToast(`❌ Settlement failed: ${e.message}\nPlease contact support if this persists.`, 'error');
      } else {
        showToast(`❌ Trade failed: ${e.reason || e.message || 'Unknown error — please try again or contact support.'}`, 'error');
      }
    } finally { setTxPending(false); }
  };

  const handlePlaceBid = () => {
    if (!isKYCVerified)                               { showToast('❌ Complete KYC first', 'error'); return; }
    if (!walletAddress)                               { showToast('❌ Connect MetaMask', 'error'); return; }
    if (selected?.seller?.toLowerCase() === walletAddress.toLowerCase()) { showToast('❌ Cannot bid on your own listing', 'error'); return; }
    if (!bidQty || isNaN(bidQty) || +bidQty <= 0)    { showToast('❌ Enter valid quantity', 'error'); return; }
    if (!bidPrice || isNaN(bidPrice))                 { showToast('❌ Enter bid price', 'error'); return; }
    if (!selected)                                    { showToast('❌ Select a credit first', 'error'); return; }
    setConfirmModal({ type: 'bid', listing: selected, qty: +bidQty, limitPriceInr: +bidPrice, limitPriceEth: (+bidPrice / liveETHINR).toFixed(8), bidTotalEth, bidFeeEth, bidEscrowEth, durationDays: parseInt(bidDays) || 7 });
  };

  const handleConfirmBid = async () => {
    const o = confirmModal; setConfirmModal(null); setTxPending(true);
    try {
      showToast('⏳ Locking ETH in escrow...', 'info');
      const r = await placeBuyOrder(o.listing.tokenId, o.qty, o.limitPriceEth, o.durationDays);
      addNotification({ type: NOTIF_TYPES.TRADE, title: 'Bid Placed ✅', message: `${o.qty} × ${o.listing.projectName} @ ${fmt(o.limitPriceInr)}` });
      showToast('✅ Bid placed! ETH locked in escrow.');
      setBidQty(''); setBidPrice('');
      navigate(`/transaction-status?hash=${r.txHash}`);
    } catch (e) {
      if (e.code === 4001) showToast('❌ Rejected in MetaMask', 'error');
      else showToast(`❌ ${e.reason || 'Transaction failed'}`, 'error');
    } finally { setTxPending(false); }
  };

  const handleCancelBidRequest  = (orderId, ethEscrowed) => setCancelBidConfirm({ orderId, ethEscrowed });
  const handleCancelBidConfirmed = async () => {
    const { orderId } = cancelBidConfirm; setCancelBidConfirm(null);
    try {
      showToast('⏳ Cancelling bid...', 'info');
      await cancelBuyOrder(orderId);
      showToast('✅ Bid cancelled. ETH refunded.');
    } catch (e) { showToast(`❌ ${e.reason || 'Cancel failed'}`, 'error'); }
  };

  const addAlert = () => {
    if (!alertPrice || isNaN(alertPrice)) { showToast('❌ Enter valid price', 'error'); return; }
    if (!selected)                        { showToast('❌ Select a credit first', 'error'); return; }
    setAlerts(prev => [...prev, { listingId: selected.listingId, tokenId: selected.tokenId, projectName: selected.projectName, targetPrice: +alertPrice, type: alertType, triggered: false, id: Date.now(), createdAt: new Date().toLocaleTimeString() }]);
    setAlertPrice('');
    showToast(`🔔 Alert set: ${alertType} ${fmt(alertPrice)}`);
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>
      <div className="cc">
        <div className="cc-wrap">

          {/* Header */}
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.18em', marginBottom: 4 }}>ETHERTRACK · CARBON MARKET · SEPOLIA</div>
              <div style={{ fontSize: 22, fontWeight: 500, color: '#f0fdf4', letterSpacing: '.02em' }}>
                Carbon Credit <span style={{ color: '#22c55e' }}>Exchange</span>
              </div>
              <div style={{ fontSize: 10, color: '#86efac44', marginTop: 2 }}>
                <span className="dot-live"/>LIVE ORDER BOOK · HYBRID AMM · OPEN TO ALL
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {isKYCVerified && (
                <span onClick={() => navigate('/wallet')} style={{ fontSize: 9, padding: '4px 12px', borderRadius: 20, background: '#0d2e1f', border: '1px solid #22c55e33', color: '#22c55e', letterSpacing: '.08em', cursor: 'pointer' }}>
                  🇮🇳 ₹{inrBalance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
              )}
              {isKYCVerified
                ? <span style={{ fontSize: 9, padding: '4px 10px', borderRadius: 20, background: '#0d2e1f', border: '1px solid #22c55e33', color: '#22c55e', letterSpacing: '.1em' }}>✅ KYC VERIFIED</span>
                : <span style={{ fontSize: 9, padding: '4px 10px', borderRadius: 20, background: '#1a0a0a', border: '1px solid #f8717133', color: '#f87171', cursor: 'pointer', letterSpacing: '.1em' }} onClick={() => navigate('/kyc')}>⚠️ COMPLETE KYC</span>
              }
              {!walletAddress && (
                <span style={{ fontSize: 9, padding: '4px 10px', borderRadius: 20, background: '#1a1200', border: '1px solid #f59e0b33', color: '#f59e0b88', letterSpacing: '.1em' }}>
                  METAMASK NOT CONNECTED
                </span>
              )}
              <span style={{ fontSize: 9, padding: '4px 10px', borderRadius: 20, background: '#0a1628', border: '1px solid #60a5fa22', color: '#60a5fa66', letterSpacing: '.1em' }}>⛓ SEPOLIA</span>
            </div>
          </div>

          {/* Market error banner */}
          {marketError && (
            <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 7, background: '#1a0707', border: '1px solid #f8717133', color: '#f87171', fontSize: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>⚠ Market data error — {marketError}</span>
              <button onClick={() => refetchMarket()} style={{ background: 'none', border: '1px solid #f8717133', borderRadius: 4, color: '#f87171', cursor: 'pointer', fontSize: 9, padding: '3px 8px', fontFamily: 'DM Mono, monospace' }}>RETRY</button>
            </div>
          )}

          {/* Ticker */}
          <div className="cc-ticker-wrap">
            <div className="cc-ticker-inner">
              {marketLoading && !listings.length
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="cc-tick"><Skeleton w="80px" h={8} mb={4}/><Skeleton w="60px" h={12} mb={0}/></div>
                  ))
                : listings.map(l => {
                    const price   = l.pricePerUnitINR || l.adjPrice * liveETHINR;
                    const history = priceHistories[l.tokenId] || [];
                    const isUp    = history.length > 1 ? history[history.length - 1] >= history[0] : null;
                    return (
                      <div key={l.listingId} className={`cc-tick${selected?.listingId === l.listingId ? ' sel' : ''}`} onClick={() => { setSelected(l); setTab('trade'); }}>
                        <div className="cc-tick-name">{l.projectName}</div>
                        <div className="cc-tick-price" style={{ color: isUp === null ? '#86efac88' : isUp ? '#22c55e' : '#f87171' }}>{fmt(n0(price))}</div>
                        <div className="cc-tick-chg" style={{ color: isUp === null ? '#86efac44' : isUp ? '#16a34a' : '#dc2626' }}>
                          {isUp === null ? '— ' : isUp ? '▲ ' : '▼ '}{l.standard}
                        </div>
                      </div>
                    );
                  })
              }
              {!marketLoading && !marketError && !listings.length && (
                <div style={{ padding: '14px 20px', fontSize: 10, color: '#86efac33' }}>No active listings yet.</div>
              )}
              {!marketLoading && marketError && (
                <div style={{ padding: '14px 20px', fontSize: 10, color: '#f87171aa' }}>Market data unavailable — retrying...</div>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="cc-stats">
            {[
              { label: 'CREDITS AVAILABLE', val: totalAvailable || (marketStats?.activeListings || '—'), sub: `${listings.length} active listings` },
              { label: 'CREDITS RETIRED',   val: platformRetired || (marketStats?.totalRetired || '—'), sub: 'platform-wide tCO₂' },
              { label: 'DAILY VOLUME',      val: dailyVolume ? `${dailyVolume} tCO₂` : '—',            sub: `${tradeHistory.length} total trades` },
              { label: 'AVG TRADE PRICE',   val: avgTradePrice ? fmt(n0(avgTradePrice)) : '—',         sub: avgTradePrice ? 'per tonne CO₂' : 'no trades yet' },
              { label: 'OPEN BIDS',         val: openBidsTotal || '—',                                 sub: `${Number(myOpenBids.reduce((s, o) => s + (o.ethEscrowed || 0), 0) || 0).toFixed(4)} ETH locked` },
            ].map(({ label, val, sub }) => (
              <div className="cc-stat" key={label}>
                <div className="cc-stat-lbl">{label}</div>
                <div className="cc-stat-val">{marketLoading ? <Skeleton w="70px" h={20} mb={0}/> : val}</div>
                <div className="cc-stat-sub">{sub}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="cc-tabs">
            {[
              ['market',    'MARKET'],
              ['trade',     'TRADE'],
              ['analytics', 'ANALYTICS'],
              ['amm',       '⚡ AMM'],
              ['history',   'HISTORY'],
              ['bids',      `MY BIDS${myOpenBids.length ? ` (${myOpenBids.length})` : ''}`],
              ['alerts',    `ALERTS${alerts.length ? ` (${alerts.length})` : ''}`],
            ].map(([t, label]) => (
              <button key={t} className={`cc-tab${tab === t ? ' act' : ''}`} onClick={() => setTab(t)}>{label}</button>
            ))}
          </div>

          {/* MARKET TAB */}
          {tab === 'market' && (
            <div className="cc-market-layout">
              <WatchlistPanel
                listings={listings} selected={selected}
                setSelected={setSelected} setAnalyticsToken={setAnalyticsToken}
                watchlist={watchlist} toggleWatchlist={toggleWatchlist}
                priceHistories={priceHistories} liveETHINR={liveETHINR}
              />
              <div className="cc-panel">
                <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select className="cc-inp" style={{ margin: 0, width: 'auto' }} value={filterStd}  onChange={e => setFilterStd(e.target.value)}>
                    <option value="ALL">All Standards</option>
                    <option value="VCS">VCS</option>
                    <option value="GS">Gold Standard</option>
                    <option value="CDM">CDM</option>
                    <option value="ACR">ACR</option>
                  </select>
                  <select className="cc-inp" style={{ margin: 0, width: 'auto' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
                    <option value="ALL">All Types</option>
                    <option value="Renewable">Renewable</option>
                    <option value="Forestry">Forestry</option>
                    <option value="Industrial">Industrial</option>
                    <option value="Social">Social</option>
                  </select>
                  <select className="cc-inp" style={{ margin: 0, width: 'auto' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
                    <option value="price">Price ↓</option>
                    <option value="priceAsc">Price ↑</option>
                    <option value="amount">Volume ↓</option>
                    <option value="vintage">Vintage ↓</option>
                    <option value="name">Name A→Z</option>
                  </select>
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: '#86efac44', letterSpacing: '.1em' }}>
                    {filtered.length} LISTINGS
                  </span>
                </div>
                <div className="cc-tbl-head">
                  <span>PROJECT</span><span>STD</span><span>PRICE</span><span>VINTAGE</span><span>TREND</span><span>BIDS</span><span>ACTION</span>
                </div>
                {marketLoading && !listings.length
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} style={{ padding: '12px 8px', borderBottom: '1px solid #0f2a1a08' }}>
                        <Skeleton w="60%" h={12} mb={6}/><Skeleton w="40%" h={9} mb={0}/>
                      </div>
                    ))
                  : filtered.length === 0
                    ? (
                      <div style={{ textAlign: 'center', padding: '48px', color: '#86efac33', fontSize: 11 }}>
                        {marketError ? `Failed to load — ${marketError}` : 'No listings match your filters.'}
                      </div>
                    )
                    : filtered.map(l => {
                        const price   = l.pricePerUnitINR || l.adjPrice * liveETHINR;
                        const history = priceHistories[l.tokenId] || [];
                        const isUp    = history.length > 1 ? history[history.length - 1] >= history[0] : null;
                        const bidsN   = buyOrders.filter(o => o.tokenId === l.tokenId && (o.status === 0 || o.status === 2)).length;
                        const isSel   = selected?.listingId === l.listingId;
                        const col     = TYPE_COLORS[l.projectType] || TYPE_COLORS.Renewable;
                        return (
                          <div key={l.listingId} className={`cc-tbl-row${isSel ? ' sel' : ''}`} onClick={() => { setSelected(l); setAnalyticsToken(l); setTab('trade'); }}>
                            <div>
                              <div style={{ fontSize: 11, color: '#f0fdf4', fontWeight: 500, marginBottom: 2 }}>{l.projectName}</div>
                              <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 8, color: '#86efac44' }}>{l.serialNumber}</span>
                                <Badge label={l.projectType} color={col.text} bg={col.bg}/>
                              </div>
                            </div>
                            <Badge label={l.standard} color={STANDARDS[l.standard]?.color} bg={STANDARDS[l.standard]?.bg}/>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 500, color: isUp === null ? '#86efac88' : isUp ? '#22c55e' : '#f87171' }}>{fmt(n0(price))}</div>
                              <div style={{ fontSize: 9, color: '#86efac44' }}>{l.amount} avail</div>
                            </div>
                            <span style={{ fontSize: 10, color: '#86efac66' }}>{l.vintageYear}</span>
                            {history.length >= 2
                              ? <MiniChart data={history.slice(-12)} color={isUp ? '#22c55e' : '#f87171'} width={80} height={28}/>
                              : <span style={{ fontSize: 9, color: '#86efac22' }}>—</span>
                            }
                            <span style={{ fontSize: 10, color: bidsN > 0 ? '#60a5fa88' : '#86efac33' }}>
                              {bidsN > 0 ? `📥 ${bidsN}` : '—'}
                            </span>
                            {l.seller?.toLowerCase() === walletAddress?.toLowerCase()
                              ? <span style={{ fontSize: 9, color: '#86efac22', padding: '5px 4px' }}>YOUR LISTING</span>
                              : (
                                <button
                                  onClick={e => { e.stopPropagation(); setSelected(l); setTab('trade'); }}
                                  style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid #22c55e44', background: '#0d2e1f', color: '#22c55e', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 9, letterSpacing: '.08em' }}
                                >
                                  {isKYCVerified ? 'BUY →' : 'VIEW →'}
                                </button>
                              )
                            }
                          </div>
                        );
                      })
                }
              </div>
            </div>
          )}

          {/* TRADE TAB */}
          {tab === 'trade' && (
            <div className="cc-trade-layout">
              <OrderBookPanel
                allAsks={allAsks} allBids={allBids}
                selectedAsks={selectedAsks} selectedBids={selectedBids}
                selected={selected} liveETHINR={liveETHINR}
                setSelected={setSelected} setTab={setTab}
              />
              <div>
                <CreditInfoCard selected={selected} currentPriceInr={currentPriceInr} priceHistories={priceHistories} liveETHINR={liveETHINR}/>
                <div className="cc-panel">
                  <div className="cc-panel-title">RECENT TRADES</div>
                  {tradeHistory.length === 0
                    ? <div style={{ fontSize: 10, color: '#86efac33', textAlign: 'center', padding: '16px 0' }}>No trades yet</div>
                    : tradeHistory.slice(0, 6).map((t, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 10, borderBottom: '1px solid #0f2a1a08', cursor: 'pointer' }}
                          onClick={() => t.txHash && navigate(`/transaction-status?hash=${t.txHash}`)}>
                          <span style={{ color: t.type === 'Buy' ? '#22c55e' : '#f87171', minWidth: 30 }}>{t.type}</span>
                          <span style={{ color: '#f0fdf4' }}>{t.amount} credits</span>
                          <span style={{ color: '#60a5fa88' }}>{t.priceINR ? fmt(t.priceINR) : `${t.totalEth} ETH`}</span>
                          <span style={{ color: '#86efac44', fontSize: 9 }}>{t.time}</span>
                          <ChainVerifiedBadge chainStatus={t.chain_status} chainTxHash={t.chain_tx_hash}/>
                        </div>
                      ))
                  }
                </div>
              </div>
              <OrderForm
                isKYCVerified={isKYCVerified} walletAddress={walletAddress}
                txPending={txPending} listings={listings}
                selected={selected} setSelected={setSelected}
                orderMode={orderMode} setOrderMode={setOrderMode}
                qty={qty} setQty={setQty}
                limitPrice={limitPrice} setLimitPrice={setLimitPrice}
                bidQty={bidQty} setBidQty={setBidQty}
                bidPrice={bidPrice} setBidPrice={setBidPrice}
                bidDays={bidDays} setBidDays={setBidDays}
                paymentMode={paymentMode} setPaymentMode={setPaymentMode}
                inrBalance={inrBalance} inrLoading={inrLoading}
                tradePriceINR={tradePriceINR} tradeTotalInr={tradeTotalInr}
                tradeFeeInr={tradeFeeInr} tradeNetInr={tradeNetInr} tradeNetEth={tradeNetEth}
                bidTotalEth={bidTotalEth} bidFeeEth={bidFeeEth} bidEscrowEth={bidEscrowEth}
                liveETHINR={liveETHINR}
                handlePlaceOrder={handlePlaceOrder} handlePlaceBid={handlePlaceBid}
                navigate={navigate}
              />
            </div>
          )}

          {/* ANALYTICS TAB */}
          {tab === 'analytics' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.12em' }}>TOKEN:</span>
                  {listings.map(l => (
                    <button key={l.listingId} onClick={() => setAnalyticsToken(l)}
                      style={{ padding: '5px 10px', borderRadius: 4, border: `1px solid ${analyticsListing?.listingId === l.listingId ? '#22c55e44' : '#0f2a1a'}`, background: analyticsListing?.listingId === l.listingId ? '#0d2e1f22' : 'transparent', color: analyticsListing?.listingId === l.listingId ? '#22c55e' : '#86efac44', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 9 }}>
                      {l.projectName?.slice(0, 16)}...
                    </button>
                  ))}
                </div>
                <div className="cc-chart-wrap">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: '#86efac44', letterSpacing: '.12em', marginBottom: 4 }}>PRICE CHART · {analyticsListing?.projectName}</div>
                      <div style={{ fontSize: 26, fontWeight: 500, color: '#22c55e' }}>{fmt(n0(currentPriceInr))}</div>
                      {analyticsChange !== null
                        ? <div style={{ fontSize: 10, color: parseFloat(analyticsChange) >= 0 ? '#22c55e' : '#f87171', marginTop: 2 }}>
                            {parseFloat(analyticsChange) >= 0 ? '▲' : '▼'} {Math.abs(analyticsChange)}% (session)
                          </div>
                        : <div style={{ fontSize: 10, color: '#86efac33', marginTop: 2 }}>No trade history yet</div>
                      }
                    </div>
                    {analyticsHistory.length >= 2 && (
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 9, color: '#86efac44' }}>H: {fmt(n0(analyticsHigh))} · L: {fmt(n0(analyticsLow))}</div>
                      </div>
                    )}
                  </div>
                  {analyticsHistory.length >= 2
                    ? <MiniChart data={analyticsHistory} color="#22c55e" width={600} height={120}/>
                    : <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#86efac22', fontSize: 10, letterSpacing: '.1em' }}>
                        CHART AVAILABLE AFTER FIRST TRADE
                      </div>
                  }
                </div>
              </div>
              <div>
                <div className="cc-panel" style={{ marginBottom: 12 }}>
                  <div className="cc-panel-title">MARKET OVERVIEW</div>
                  {[
                    { l: 'TOTAL LISTINGS', v: listings.length },
                    { l: 'TOTAL SUPPLY',   v: `${totalAvailable} tCO₂` },
                    { l: 'OPEN BIDS',      v: openBidsTotal },
                    { l: 'YOUR BIDS',      v: myOpenBids.length },
                    { l: 'TRADES TODAY',   v: dailyTrades.length },
                  ].map(({ l, v }) => (
                    <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 10, borderBottom: '1px solid #0f2a1a08' }}>
                      <span style={{ color: '#86efac55' }}>{l}</span>
                      <span style={{ color: '#f0fdf4', fontWeight: 500 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* AMM TAB */}
          {tab === 'amm' && (
            <div>
              <div style={{ marginBottom: 14, padding: '11px 14px', background: '#080c0a', border: '1px solid #0f2a1a', borderRadius: 8, fontSize: 10, color: '#86efac66', lineHeight: 1.7 }}>
                ⚡ <strong style={{ color: '#f0fdf4' }}>AMM Pools</strong> — Instant swaps for small orders (≤100 credits). No counterparty needed.
              </div>
              <div className="cc-amm-grid">
                {(!ammPools || ammPools.length === 0) && !marketLoading
                  ? <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px', color: '#86efac33', fontSize: 11 }}>No AMM pools found.</div>
                  : (ammPools || []).map(pool => (
                      <div key={pool.poolId} className="cc-amm-card" onClick={() => setAmmModal({ pool, ammDir: 'buy' })}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 500, color: '#f0fdf4', marginBottom: 4 }}>{pool.name}</div>
                            <div style={{ fontSize: 9, color: '#86efac44' }}>Pool #{pool.poolId}</div>
                          </div>
                          <span style={{ fontSize: 9, padding: '3px 8px', borderRadius: 12, background: pool.active ? '#0d2e1f' : '#1a0a0a', color: pool.active ? '#22c55e' : '#f87171', border: `1px solid ${pool.active ? '#22c55e33' : '#f8717133'}` }}>
                            {pool.active ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </div>
                        {[
                          { l: 'CREDIT RESERVE', v: `${pool.creditReserve} tCO₂` },
                          { l: 'ETH RESERVE',    v: `${Number(pool.ethReserve || 0).toFixed(4)} ETH` },
                          { l: 'PRICE',          v: fmt(n0(pool.priceInr || pool.priceEth * liveETHINR)) },
                        ].map(({ l, v }) => (
                          <div key={l} className="cc-pool-stat">
                            <span style={{ color: '#86efac44' }}>{l}</span>
                            <span style={{ color: '#f0fdf4', fontWeight: 500 }}>{v}</span>
                          </div>
                        ))}
                        <button style={{ width: '100%', marginTop: 12, padding: '9px', borderRadius: 6, border: '1px solid #22c55e44', background: '#0d2e1f22', color: '#22c55e', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 10, fontWeight: 500 }}>
                          SWAP NOW →
                        </button>
                      </div>
                    ))
                }
              </div>
            </div>
          )}

          {/* HISTORY TAB */}
          {tab === 'history' && (
            <div className="cc-panel">
              <div className="cc-panel-title">TRADE HISTORY ({tradeHistory.length})</div>
              {tradeHistory.length === 0
                ? <div style={{ textAlign: 'center', padding: '48px', color: '#86efac33', fontSize: 11 }}>No trades yet.</div>
                : <>
                    <div className="cc-hist-head">
                      <span>TX ID</span><span>TYPE</span><span>AMOUNT</span><span>PRICE (INR)</span><span>TIME</span><span>STATUS</span><span>CHAIN</span>
                    </div>
                    {tradeHistory.map((t, i) => (
                      <div key={i} className="cc-hist-row" onClick={() => t.txHash && navigate(`/transaction-status?hash=${t.txHash}`)}>
                        <span style={{ color: '#86efac44', fontSize: 9 }}>{t.id}</span>
                        <span style={{ color: t.type === 'Buy' ? '#22c55e' : '#f87171', fontWeight: 500 }}>{t.type}</span>
                        <span style={{ color: '#f0fdf4' }}>{t.amount} tCO₂</span>
                        <span style={{ color: '#60a5fa88' }}>{t.priceINR ? fmt(t.priceINR) : `${t.totalEth} ETH`}</span>
                        <span style={{ color: '#86efac44', fontSize: 9 }}>{t.time}</span>
                        <span style={{ fontSize: 8, padding: '2px 7px', borderRadius: 3, background: '#0d2e1f', color: '#22c55e', border: '1px solid #16a34a33' }}>{t.status}</span>
                        <ChainVerifiedBadge chainStatus={t.chain_status} chainTxHash={t.chain_tx_hash}/>
                      </div>
                    ))}
                  </>
              }
            </div>
          )}

          {/* MY BIDS TAB */}
          {tab === 'bids' && (
            <div className="cc-panel">
              {!walletAddress
                ? (
                  <div style={{ textAlign: 'center', padding: '48px', color: '#86efac44', fontSize: 11 }}>
                    Connect MetaMask to see your bids.
                  </div>
                )
                : (
                  <>
                    <div className="cc-panel-title">MY OPEN BIDS ({myOpenBids.length})</div>
                    {myOpenBids.length === 0
                      ? <div style={{ textAlign: 'center', padding: '48px', color: '#86efac44', fontSize: 11 }}>No open bids.</div>
                      : <>
                          <div className="cc-bids-head">
                            <span>#</span><span>TOKEN</span><span>QTY</span><span>BID PRICE</span><span>ESCROW</span><span>ACTION</span>
                          </div>
                          {myOpenBids.map(o => (
                            <div key={o.orderId} className="cc-bids-row">
                              <span style={{ color: '#86efac44' }}>#{o.orderId}</span>
                              <div>
                                <div style={{ fontSize: 10, color: '#f0fdf4' }}>Token #{o.tokenId}</div>
                                <div style={{ fontSize: 8, color: '#86efac33' }}>exp. {new Date(o.expiresAt * 1000).toLocaleDateString()}</div>
                              </div>
                              <div><div style={{ color: '#f0fdf4' }}>{o.remaining}/{o.amount}</div></div>
                              <div><div style={{ color: '#22c55e', fontWeight: 500 }}>{fmt(n0(Number(o.limitPrice || 0) * liveETHINR))}</div></div>
                              <div style={{ color: '#60a5fa88' }}>{Number(o.ethEscrowed || 0).toFixed(4)} ETH</div>
                              <button
                                onClick={() => handleCancelBidRequest(o.orderId, o.ethEscrowed)}
                                style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid #dc262633', background: 'transparent', color: '#f8717166', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 9 }}
                              >
                                CANCEL
                              </button>
                            </div>
                          ))}
                        </>
                    }
                  </>
                )
              }
            </div>
          )}

          {/* ALERTS TAB */}
          {tab === 'alerts' && (
            <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 12 }}>
              <div className="cc-panel">
                <div className="cc-panel-title">CREATE ALERT</div>
                <select className="cc-inp" value={selected?.listingId || ''} onChange={e => setSelected(listings.find(l => l.listingId === +e.target.value))}>
                  <option value="">Select credit...</option>
                  {listings.map(l => <option key={l.listingId} value={l.listingId}>{l.projectName} · {fmt(n0(l.pricePerUnitINR || l.adjPrice * liveETHINR))}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {[['below', 'PRICE BELOW'], ['above', 'PRICE ABOVE']].map(([t, l]) => (
                    <button key={t} onClick={() => setAlertType(t)}
                      style={{ flex: 1, padding: '7px', borderRadius: 4, border: `1px solid ${alertType === t ? '#22c55e44' : '#0f2a1a'}`, background: alertType === t ? '#0d2e1f22' : 'transparent', color: alertType === t ? '#22c55e' : '#86efac44', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 9 }}>
                      {l}
                    </button>
                  ))}
                </div>
                <input className="cc-inp" type="number" placeholder={`Alert when price ${alertType} ₹...`} value={alertPrice} onChange={e => setAlertPrice(e.target.value)}/>
                <button className="cc-btn" style={{ background: 'linear-gradient(135deg,#0d2e1f,#16a34a)', color: '#22c55e', border: '1px solid #22c55e44' }} onClick={addAlert}>🔔 SET ALERT</button>
                <div style={{ marginTop: 8, fontSize: 9, color: '#86efac33', lineHeight: 1.5 }}>
                  Alerts work while this tab is open. For persistent alerts, enable notifications in your account settings.
                </div>
              </div>
              <div className="cc-panel">
                <div className="cc-panel-title">ACTIVE ALERTS ({alerts.length})</div>
                {alerts.length === 0
                  ? <div style={{ textAlign: 'center', padding: '32px', color: '#86efac33', fontSize: 11 }}>🔔 No alerts set.</div>
                  : alerts.map(a => (
                      <div key={a.id} style={{ background: '#060908', border: '1px solid #0f2a1a', borderRadius: 8, padding: '12px 14px', marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 11, color: '#f0fdf4', fontWeight: 500, marginBottom: 2 }}>{a.projectName}</div>
                          <div style={{ fontSize: 9, color: '#86efac55' }}>Alert {a.type} {fmt(a.targetPrice)} · Set {a.createdAt}</div>
                          {a.triggered && <span style={{ fontSize: 8, color: '#facc15', marginTop: 2, display: 'block' }}>⚡ TRIGGERED</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 9, padding: '3px 8px', borderRadius: 12, background: a.triggered ? '#1a1500' : '#0d2e1f', color: a.triggered ? '#facc15' : '#22c55e', border: `1px solid ${a.triggered ? '#facc1533' : '#22c55e33'}` }}>
                            {a.triggered ? 'TRIGGERED' : 'WATCHING'}
                          </span>
                          <button onClick={() => setAlerts(prev => prev.filter(x => x.id !== a.id))} style={{ background: 'none', border: 'none', color: '#f8717144', cursor: 'pointer', fontSize: 14 }}>✕</button>
                        </div>
                      </div>
                    ))
                }
              </div>
            </div>
          )}
        </div>
      </div>

      {/* BUY CONFIRM MODAL */}
      {confirmModal?.type === 'buy' && (
        <div className="cc-overlay" onClick={e => e.target === e.currentTarget && setConfirmModal(null)}>
          <div className="cc-modal" style={{ maxWidth: 480 }}>
            <div className="cc-modal-h">
              <span style={{ fontSize: 12, fontWeight: 500, color: '#f0fdf4', letterSpacing: '.1em' }}>CONFIRM BUY ORDER</span>
              <button style={{ background: 'none', border: 'none', color: '#86efac44', cursor: 'pointer', fontSize: 16 }} onClick={() => setConfirmModal(null)}>✕</button>
            </div>
            <div className="cc-modal-b" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 14,
                background: confirmModal.paymentMode === 'inr' ? '#0d2e1f' : confirmModal.paymentMode === 'razorpay' ? '#0a1628' : '#1a1200',
                border: `1px solid ${confirmModal.paymentMode === 'inr' ? '#22c55e33' : confirmModal.paymentMode === 'razorpay' ? '#60a5fa33' : '#f59e0b33'}`,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ fontSize: 20 }}>
                  {confirmModal.paymentMode === 'inr' ? '🇮🇳' : confirmModal.paymentMode === 'razorpay' ? '💳' : '🦊'}
                </span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: confirmModal.paymentMode === 'inr' ? '#22c55e' : confirmModal.paymentMode === 'razorpay' ? '#60a5fa' : '#f59e0b' }}>
                    {confirmModal.paymentMode === 'inr'
                      ? 'PAYING FROM INR WALLET — ATOMIC SETTLEMENT'
                      : confirmModal.paymentMode === 'razorpay'
                        ? 'PAYING VIA RAZORPAY — UPI / CARD / NETBANKING'
                        : 'PAYING WITH METAMASK (ETH)'}
                  </div>
                  <div style={{ fontSize: 9, color: '#86efac44', marginTop: 2 }}>
                    {confirmModal.paymentMode === 'inr'
                      ? `₹${inrBalance.toLocaleString('en-IN')} available → ₹${Math.round(confirmModal.tradeNetInr).toLocaleString('en-IN')} will be deducted`
                      : confirmModal.paymentMode === 'razorpay'
                        ? 'Razorpay checkout will open. Seller receives funds directly to bank.'
                        : 'MetaMask will prompt for ETH transaction'
                    }
                  </div>
                </div>
              </div>
              <div style={{ background: '#040706', borderRadius: 8, padding: 14, marginBottom: 14, border: '1px solid #0f2a1a' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#f0fdf4', marginBottom: 6 }}>{confirmModal.listing.projectName}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  <Badge label={confirmModal.listing.standard} color={STANDARDS[confirmModal.listing.standard]?.color} bg={STANDARDS[confirmModal.listing.standard]?.bg}/>
                  <Badge label={confirmModal.listing.projectType} color={(TYPE_COLORS[confirmModal.listing.projectType] || TYPE_COLORS.Renewable).text} bg={(TYPE_COLORS[confirmModal.listing.projectType] || TYPE_COLORS.Renewable).bg}/>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                  {[
                    { l: 'QUANTITY',   v: `${confirmModal.qty} credits` },
                    { l: 'VINTAGE',    v: confirmModal.listing.vintageYear },
                    { l: 'LISTING ID', v: `#${confirmModal.listing.listingId}` },
                    { l: 'SELLER',     v: `${confirmModal.listing.seller?.slice(0, 6)}...${confirmModal.listing.seller?.slice(-4)}` },
                  ].map(({ l, v }) => (
                    <div key={l}>
                      <div style={{ fontSize: 8, color: '#86efac33', letterSpacing: '.1em', marginBottom: 1 }}>{l}</div>
                      <div style={{ fontSize: 10, color: '#86efac88' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="cc-fee-row"><span>Subtotal</span><span>{fmt(n0(confirmModal.tradeTotalInr))}</span></div>
              <div className="cc-fee-row"><span>Platform fee (0.5%)</span><span style={{ color: '#facc15' }}>{fmt(n0(confirmModal.tradeFeeInr))}</span></div>
              {confirmModal.paymentMode === 'inr' ? (
                <div className="cc-fee-tot"><span>TOTAL (INR WALLET)</span><span style={{ color: '#22c55e' }}>₹{Math.round(confirmModal.tradeNetInr).toLocaleString('en-IN')}</span></div>
              ) : confirmModal.paymentMode === 'razorpay' ? (
                <div className="cc-fee-tot"><span>TOTAL (RAZORPAY)</span><span style={{ color: '#60a5fa' }}>₹{Math.round(confirmModal.tradeNetInr).toLocaleString('en-IN')}</span></div>
              ) : (
                <>
                  <div className="cc-fee-row"><span>ETH to send</span><span style={{ color: '#60a5fa88' }}>{Number(confirmModal.tradeNetEth || 0).toFixed(6)} ETH</span></div>
                  <div className="cc-fee-tot"><span>TOTAL PAYABLE</span><span style={{ color: '#f87171' }}>{fmt(n0(confirmModal.tradeNetInr))}</span></div>
                </>
              )}
            </div>
            <div className="cc-modal-f">
              <button className="cc-btn-cn" onClick={() => setConfirmModal(null)}>CANCEL</button>
              <button
                className="cc-btn-ok"
                style={{
                  background: confirmModal.paymentMode === 'inr'
                    ? 'linear-gradient(135deg,#16a34a,#15803d)'
                    : confirmModal.paymentMode === 'razorpay'
                      ? 'linear-gradient(135deg,#1d4ed8,#1e40af)'
                      : 'linear-gradient(135deg,#f59e0b,#d97706)',
                  color: '#fff',
                }}
                onClick={handleConfirmBuy}
              >
                {confirmModal.paymentMode === 'inr'
                  ? '🇮🇳 CONFIRM & PAY →'
                  : confirmModal.paymentMode === 'razorpay'
                    ? '💳 OPEN RAZORPAY →'
                    : '🦊 CONFIRM IN METAMASK →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BID CONFIRM MODAL */}
      {confirmModal?.type === 'bid' && (
        <div className="cc-overlay" onClick={e => e.target === e.currentTarget && setConfirmModal(null)}>
          <div className="cc-modal">
            <div className="cc-modal-h">
              <span style={{ fontSize: 12, fontWeight: 500, color: '#f0fdf4', letterSpacing: '.1em' }}>CONFIRM BID — LOCK ETH</span>
              <button style={{ background: 'none', border: 'none', color: '#86efac44', cursor: 'pointer', fontSize: 16 }} onClick={() => setConfirmModal(null)}>✕</button>
            </div>
            <div className="cc-modal-b">
              <div style={{ background: '#0a1628', borderRadius: 8, padding: 12, marginBottom: 14, border: '1px solid #60a5fa22' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: '#f0fdf4', marginBottom: 2 }}>{confirmModal.listing.projectName}</div>
                <div style={{ fontSize: 9, color: '#86efac55' }}>Bid for {confirmModal.qty} credits @ {fmt(confirmModal.limitPriceInr)} · {confirmModal.durationDays} days</div>
              </div>
              {[
                { l: 'BID QUANTITY', v: `${confirmModal.qty} credits`, c: '#f0fdf4' },
                { l: 'BID PRICE',    v: fmt(confirmModal.limitPriceInr),    c: '#22c55e' },
                { l: 'EXPIRES IN',   v: `${confirmModal.durationDays} days`, c: '#f0fdf4' },
              ].map(({ l, v, c }) => (
                <div key={l} className="cc-fee-row" style={{ padding: '6px 0' }}><span>{l}</span><span style={{ color: c }}>{v}</span></div>
              ))}
              <div style={{ height: 1, background: '#0f2a1a', margin: '8px 0' }}/>
              <div className="cc-fee-row"><span>Bid total</span><span>{Number(confirmModal.bidTotalEth || 0).toFixed(6)} ETH</span></div>
              <div className="cc-fee-row"><span>Platform fee</span><span style={{ color: '#facc15' }}>{Number(confirmModal.bidFeeEth || 0).toFixed(6)} ETH</span></div>
              <div className="cc-fee-tot"><span>ETH LOCKED IN ESCROW</span><span style={{ color: '#60a5fa' }}>{Number(confirmModal.bidEscrowEth || 0).toFixed(6)} ETH</span></div>
            </div>
            <div className="cc-modal-f">
              <button className="cc-btn-cn" onClick={() => setConfirmModal(null)}>CANCEL</button>
              <button className="cc-btn-ok" style={{ background: 'linear-gradient(135deg,#1d4ed8,#1e40af)', color: '#fff' }} onClick={handleConfirmBid}>LOCK ETH & BID →</button>
            </div>
          </div>
        </div>
      )}

      {/* CANCEL BID CONFIRM MODAL */}
      {cancelBidConfirm && (
        <div className="cc-overlay" onClick={e => e.target === e.currentTarget && setCancelBidConfirm(null)}>
          <div className="cc-modal" style={{ maxWidth: 360 }}>
            <div className="cc-modal-h">
              <span style={{ fontSize: 12, fontWeight: 500, color: '#f87171', letterSpacing: '.1em' }}>CANCEL BID?</span>
              <button style={{ background: 'none', border: 'none', color: '#86efac44', cursor: 'pointer', fontSize: 16 }} onClick={() => setCancelBidConfirm(null)}>✕</button>
            </div>
            <div className="cc-modal-b">
              <div style={{ padding: '12px', background: '#1a0707', border: '1px solid #f8717122', borderRadius: 8, marginBottom: 12, fontSize: 11, color: '#f8717199', lineHeight: 1.7 }}>
                This will cancel your bid and return <strong style={{ color: '#f87171' }}>{Number(cancelBidConfirm.ethEscrowed || 0).toFixed(6)} ETH</strong> from escrow to your wallet.
                <br/><span style={{ fontSize: 9, color: '#f8717155' }}>Gas fees apply. This action cannot be undone.</span>
              </div>
            </div>
            <div className="cc-modal-f">
              <button className="cc-btn-cn" onClick={() => setCancelBidConfirm(null)}>KEEP BID</button>
              <button className="cc-btn-ok" style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)', color: '#fff' }} onClick={handleCancelBidConfirmed}>
                CANCEL & REFUND ETH
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AMM MODAL */}
      {ammModal && (
        <div className="cc-overlay" onClick={e => e.target === e.currentTarget && setAmmModal(null)}>
          <div className="cc-modal">
            <div className="cc-modal-h">
              <span style={{ fontSize: 12, fontWeight: 500, color: '#f0fdf4' }}>⚡ AMM SWAP · Pool #{ammModal.pool.poolId}</span>
              <button style={{ background: 'none', border: 'none', color: '#86efac44', cursor: 'pointer', fontSize: 16 }} onClick={() => setAmmModal(null)}>✕</button>
            </div>
            <div className="cc-modal-b">
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {[['buy', 'ETH → CREDITS'], ['sell', 'CREDITS → ETH']].map(([d, label]) => (
                  <button key={d} onClick={() => setAmmDir(d)} style={{ flex: 1, padding: '8px', borderRadius: 5, border: `1px solid ${ammDir === d ? '#22c55e44' : '#0f2a1a'}`, background: ammDir === d ? '#0d2e1f22' : 'transparent', color: ammDir === d ? '#22c55e' : '#86efac44', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 10, fontWeight: 500 }}>
                    {label}
                  </button>
                ))}
              </div>
              <input className="cc-inp" type="number" placeholder={ammDir === 'buy' ? 'ETH to spend' : 'Credits to sell'} value={ammQty} onChange={e => setAmmQty(e.target.value)}/>
              {ammQty && ammModal.pool && (() => {
                const pool = ammModal.pool;
                const inputAmt = parseFloat(ammQty) || 0;
                let outputAmt = 0, priceImpactPct = 0;
                if (ammDir === 'buy' && pool.ethReserve > 0 && pool.creditReserve > 0) {
                  const iWF = inputAmt * 0.997;
                  outputAmt = (iWF * pool.creditReserve) / (pool.ethReserve + iWF);
                  priceImpactPct = (inputAmt / pool.ethReserve) * 100;
                } else if (ammDir === 'sell' && pool.creditReserve > 0 && pool.ethReserve > 0) {
                  const iWF = inputAmt * 0.997;
                  outputAmt = (iWF * pool.ethReserve) / (pool.creditReserve + iWF);
                  priceImpactPct = (inputAmt / pool.creditReserve) * 100;
                }
                const minOut = outputAmt * 0.98;
                const highImpact = priceImpactPct > 5;
                return (
                  <div style={{ background: '#040706', borderRadius: 6, padding: '9px 11px', marginBottom: 10 }}>
                    <div className="cc-fee-row"><span>You give</span><span>{ammQty} {ammDir === 'buy' ? 'ETH' : 'credits'}</span></div>
                    <div className="cc-fee-row"><span>Pool fee (0.3%)</span><span style={{ color: '#facc15' }}>{(inputAmt * 0.003).toFixed(4)}</span></div>
                    <div className="cc-fee-row">
                      <span>Price impact</span>
                      <span style={{ color: highImpact ? '#f87171' : '#22c55e88' }}>{priceImpactPct.toFixed(2)}% {highImpact && '⚠ HIGH'}</span>
                    </div>
                    <div className="cc-fee-tot"><span>YOU RECEIVE ≈</span><span style={{ color: '#22c55e' }}>{outputAmt.toFixed(ammDir === 'buy' ? 2 : 6)} {ammDir === 'buy' ? 'credits' : 'ETH'}</span></div>
                    <div style={{ fontSize: 8, color: '#86efac33', marginTop: 4 }}>Min received (2% slippage): {minOut.toFixed(ammDir === 'buy' ? 2 : 6)}</div>
                    {highImpact && (
                      <div style={{ marginTop: 8, padding: '6px 8px', background: '#1a0707', border: '1px solid #f8717122', borderRadius: 4, fontSize: 9, color: '#f87171' }}>
                        ⚠ High price impact — consider splitting into smaller swaps
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="cc-modal-f">
              <button className="cc-btn-cn" onClick={() => setAmmModal(null)}>CANCEL</button>
              <button
                className="cc-btn-ok"
                style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff' }}
                onClick={async () => {
                  if (!ammQty) { showToast('❌ Enter amount', 'error'); return; }
                  const pool = ammModal.pool;
                  const inputAmt = parseFloat(ammQty);
                  let minOut = 0;
                  if (ammDir === 'buy' && pool.ethReserve > 0 && pool.creditReserve > 0) {
                    const iWF = inputAmt * 0.997;
                    minOut = Math.floor(((iWF * pool.creditReserve) / (pool.ethReserve + iWF)) * 0.98);
                  } else if (ammDir === 'sell' && pool.creditReserve > 0 && pool.ethReserve > 0) {
                    const iWF = inputAmt * 0.997;
                    minOut = ((iWF * pool.ethReserve) / (pool.creditReserve + iWF)) * 0.98;
                  }
                  try {
                    setAmmModal(null);
                    if (ammDir === 'buy') await ammSwapETHForCredits(ammModal.pool.poolId, ammQty, minOut);
                    else await ammSwapCreditsForETH(ammModal.pool.poolId, parseInt(ammQty), minOut);
                    showToast('✅ Swap successful!');
                    refetchMarket();
                  } catch (e) { showToast(`❌ ${e.reason || 'Swap failed'}`, 'error'); }
                }}
              >
                SWAP NOW →
              </button>
            </div>
          </div>
        </div>
      )}

      {txPending && <div className="cc-pending"><div className="cc-spin"/>Waiting for confirmation...</div>}

      {toast.msg && toast.type === 'error' ? (
        <div className="cc-toast-error">
          {toast.msg.split('\n').map((line, i) => (
            <div key={i} style={{ fontWeight: i === 0 ? 600 : 400, fontSize: i === 0 ? 12 : 10, opacity: i === 0 ? 1 : 0.75, marginBottom: i === 0 && toast.msg.includes('\n') ? 5 : 0 }}>
              {line}
            </div>
          ))}
        </div>
      ) : toast.msg ? (
        <div className="cc-toast" style={{ borderColor: toast.type === 'info' ? '#60a5fa44' : '#22c55e44', color: toast.type === 'info' ? '#60a5fa' : '#22c55e' }}>
          {toast.msg.split('\n').map((line, i) => (
            <div key={i} style={{ fontWeight: i === 0 ? 600 : 400, fontSize: i === 0 ? 13 : 10, opacity: i === 0 ? 1 : 0.7, marginBottom: i === 0 && toast.msg.includes('\n') ? 6 : 0 }}>
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}