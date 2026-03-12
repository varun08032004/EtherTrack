import React, { useState, useEffect, useContext } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthContext } from '../App';

// ── Mock transaction data ─────────────────────────────────
const MOCK_TRANSACTIONS = [
  {
    txHash:    '0x4c7f1a2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a',
    type:      'BUY',
    status:    'CONFIRMED',
    credit:    'VCS-4821',
    project:   'Solar Farm Maharashtra',
    qty:       10,
    price:     843,
    fee:       42.15,
    total:     8472.15,
    network:   'Ethereum Sepolia',
    block:     52847291,
    gasUsed:   '84,230',
    gasPrice:  '32 Gwei',
    from:      '0xE026653F4fDfe7Bd02fd1F6534Da631DD3410489',
    to:        '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    timestamp: Date.now() - 120000,
    confirmations: 24,
  },
  {
    txHash:    '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
    type:      'SELL',
    status:    'CONFIRMED',
    credit:    'REDD-1193',
    project:   'Sundarbans Forest Reserve',
    qty:       5,
    price:     1238,
    fee:       30.95,
    total:     6159.05,
    network:   'Ethereum Sepolia',
    block:     52847102,
    gasUsed:   '71,450',
    gasPrice:  '30 Gwei',
    from:      '0xE026653F4fDfe7Bd02fd1F6534Da631DD3410489',
    to:        '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    timestamp: Date.now() - 3600000,
    confirmations: 189,
  },
  {
    txHash:    '0x9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a',
    type:      'RETIRE',
    status:    'PENDING',
    credit:    'GS-7742',
    project:   'Wind Energy Rajasthan',
    qty:       20,
    price:     619,
    fee:       61.90,
    total:     12441.90,
    network:   'Ethereum Sepolia',
    block:     null,
    gasUsed:   '—',
    gasPrice:  '35 Gwei',
    from:      '0xE026653F4fDfe7Bd02fd1F6534Da631DD3410489',
    to:        '0x0000000000000000000000000000000000000000',
    timestamp: Date.now() - 60000,
    confirmations: 3,
  },
  {
    txHash:    '0x3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e',
    type:      'MINT',
    status:    'FAILED',
    credit:    'ACR-5521',
    project:   'Amazon Basin REDD+',
    qty:       100,
    price:     956,
    fee:       47.80,
    total:     9647.80,
    network:   'Ethereum Sepolia',
    block:     null,
    gasUsed:   '—',
    gasPrice:  '28 Gwei',
    from:      '0xE026653F4fDfe7Bd02fd1F6534Da631DD3410489',
    to:        '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    timestamp: Date.now() - 7200000,
    confirmations: 0,
  },
];

const STATUS_CONFIG = {
  CONFIRMED: { color: '#22c55e', bg: '#0d2e1f', border: '#22c55e33', label: 'CONFIRMED',  icon: '✓' },
  PENDING:   { color: '#facc15', bg: '#1a1500', border: '#facc1533', label: 'PENDING',    icon: '⟳' },
  FAILED:    { color: '#f87171', bg: '#450a0a', border: '#f8717133', label: 'FAILED',     icon: '✕' },
  CANCELLED: { color: '#9ca3af', bg: '#1a1a1a', border: '#9ca3af33', label: 'CANCELLED',  icon: '○' },
};

const TYPE_CONFIG = {
  BUY:    { color: '#22c55e', bg: '#0d2e1f', icon: '↓', label: 'BUY'    },
  SELL:   { color: '#f87171', bg: '#450a0a', icon: '↑', label: 'SELL'   },
  RETIRE: { color: '#a78bfa', bg: '#120a28', icon: '🔥', label: 'RETIRE' },
  MINT:   { color: '#60a5fa', bg: '#0a1628', icon: '✦', label: 'MINT'   },
  LIST:   { color: '#facc15', bg: '#1a1500', icon: '◈', label: 'LIST'   },
};

const fmt      = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const shortHash = (h) => h ? `${h.slice(0,8)}...${h.slice(-6)}` : '—';
const timeAgo  = (ts) => {
  const diff = Date.now() - ts;
  if (diff < 60000)  return `${Math.floor(diff/1000)}s ago`;
  if (diff < 3600000)return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000)return `${Math.floor(diff/3600000)}h ago`;
  return `${Math.floor(diff/86400000)}d ago`;
};

// ── Step indicator ────────────────────────────────────────
function TxSteps({ status, confirmations }) {
  const steps = [
    { label: 'Submitted',   done: true  },
    { label: 'Broadcasting',done: status !== 'FAILED' },
    { label: 'Confirming',  done: status === 'CONFIRMED' || (status === 'PENDING' && confirmations > 0) },
    { label: 'Confirmed',   done: status === 'CONFIRMED' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, margin: '20px 0' }}>
      {steps.map((step, i) => (
        <React.Fragment key={step.label}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: step.done ? '#16a34a' : '#0a0f0c',
              border: `2px solid ${step.done ? '#22c55e' : '#0f2a1a'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: step.done ? '#fff' : '#4ade8033',
              fontWeight: 700, position: 'relative', zIndex: 1,
              transition: 'all .3s',
              boxShadow: step.done ? '0 0 12px rgba(34,197,94,0.3)' : 'none',
            }}>
              {step.done ? '✓' : i + 1}
            </div>
            <div style={{ fontSize: 9, color: step.done ? '#22c55e' : '#4ade8033', marginTop: 5, letterSpacing: '.08em', textAlign: 'center' }}>
              {step.label.toUpperCase()}
            </div>
          </div>
          {i < steps.length - 1 && (
            <div style={{
              height: 2, flex: 2, marginTop: -18,
              background: steps[i+1].done ? '#22c55e' : '#0f2a1a',
              transition: 'background .5s',
            }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────
export default function TransactionStatus() {
  const navigate                        = useNavigate();
  const [searchParams]                  = useSearchParams();
  const urlHash                         = searchParams.get('hash');

  const [selected,   setSelected]       = useState(MOCK_TRANSACTIONS[0]);
  const [filter,     setFilter]         = useState('ALL');
  const [search,     setSearch]         = useState('');
  const [copied,     setCopied]         = useState('');
  const [pendingDots,setPendingDots]    = useState(0);

  // Animate pending dots
  useEffect(() => {
    const id = setInterval(() => setPendingDots(d => (d + 1) % 4), 500);
    return () => clearInterval(id);
  }, []);

  // Auto-select from URL hash
  useEffect(() => {
    if (urlHash) {
      const found = MOCK_TRANSACTIONS.find(t => t.txHash === urlHash);
      if (found) setSelected(found);
    }
  }, [urlHash]);

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    });
  };

  const filteredTxns = MOCK_TRANSACTIONS
    .filter(t => filter === 'ALL' || t.status === filter || t.type === filter)
    .filter(t => !search || t.txHash.includes(search) || t.credit.includes(search.toUpperCase()) || t.project.toLowerCase().includes(search.toLowerCase()));

  const sc  = STATUS_CONFIG[selected.status];
  const tc  = TYPE_CONFIG[selected.type];
  const isPending = selected.status === 'PENDING';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;}

        .ts{min-height:100vh;background:#060a07;font-family:'DM Mono',monospace;position:relative;overflow-x:hidden;}
        .ts::before{content:'';position:fixed;inset:0;z-index:0;
          background-image:linear-gradient(rgba(34,197,94,.04) 1px,transparent 1px),
          linear-gradient(90deg,rgba(34,197,94,.04) 1px,transparent 1px);
          background-size:40px 40px;pointer-events:none;}
        .tsw{position:relative;z-index:1;max-width:1200px;margin:0 auto;padding:28px 24px 60px;}

        .ts-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;animation:fu .4s ease both;}
        .ts-title{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;color:#f0fdf4;}
        .ts-title span{color:#22c55e;}
        .ts-back{padding:8px 16px;border-radius:6px;border:1px solid #0f2a1a;background:transparent;
          color:#4ade8055;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;
          transition:all .2s;}
        .ts-back:hover{border-color:#22c55e44;color:#22c55e;}

        /* Layout */
        .ts-layout{display:grid;grid-template-columns:360px 1fr;gap:16px;align-items:start;}

        /* List panel */
        .ts-list-panel{background:#0a0f0c;border:1px solid #0f2a1a;border-radius:12px;overflow:hidden;animation:fu .4s ease .05s both;}
        .ts-list-head{padding:16px 18px;border-bottom:1px solid #0f2a1a;}
        .ts-search{width:100%;padding:9px 12px;border-radius:7px;border:1px solid #0f2a1a;
          background:#060a07;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:11px;outline:none;margin-bottom:10px;}
        .ts-search:focus{border-color:#22c55e33;}
        .ts-filters{display:flex;gap:5px;flex-wrap:wrap;}
        .ts-filter{padding:5px 10px;border-radius:4px;border:1px solid #0f2a1a;background:transparent;
          cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.08em;
          color:#4ade8033;transition:all .2s;}
        .ts-filter.active{background:#0d2e1f;border-color:#22c55e;color:#22c55e;}

        /* Tx row */
        .ts-tx-row{padding:14px 18px;border-bottom:1px solid #0f2a1a14;cursor:pointer;
          transition:background .15s;display:flex;gap:12px;align-items:center;}
        .ts-tx-row:hover{background:#0f1a1222;}
        .ts-tx-row.active{background:#0d2e1f22;border-left:2px solid #22c55e;}
        .ts-tx-row:last-child{border-bottom:none;}

        /* Detail panel */
        .ts-detail{background:#0a0f0c;border:1px solid #0f2a1a;border-radius:12px;padding:24px;animation:fu .4s ease .1s both;}

        /* Status badge */
        .ts-status-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;
          border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.1em;}

        /* Hash box */
        .ts-hash-box{background:#060a07;border:1px solid #0f2a1a;border-radius:8px;
          padding:12px 16px;font-size:11px;color:#4ade8066;word-break:break-all;
          display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;}
        .ts-copy-btn{background:none;border:1px solid #0f2a1a;border-radius:4px;color:#4ade8044;
          cursor:pointer;padding:4px 8px;font-size:10px;font-family:'DM Mono',monospace;
          transition:all .2s;flex-shrink:0;}
        .ts-copy-btn:hover{border-color:#22c55e44;color:#22c55e;}
        .ts-copy-btn.copied{border-color:#22c55e;color:#22c55e;}

        /* Info grid */
        .ts-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0;}
        .ts-info-cell{background:#060a07;border-radius:7px;padding:12px 14px;}
        .ts-info-key{font-size:9px;color:#4ade8033;letter-spacing:.1em;margin-bottom:4px;}
        .ts-info-val{font-size:12px;color:#f0fdf4;word-break:break-all;}

        /* Pending animation */
        .ts-pending-ring{
          width:80px;height:80px;border-radius:50%;
          border:3px solid #0f2a1a;
          border-top:3px solid #facc15;
          animation:spin 1s linear infinite;
          margin:0 auto 16px;
        }
        .ts-confirmed-ring{
          width:80px;height:80px;border-radius:50%;
          border:3px solid #22c55e33;
          display:flex;align-items:center;justify-content:center;
          margin:0 auto 16px;
          box-shadow:0 0 24px rgba(34,197,94,0.2);
        }
        .ts-failed-ring{
          width:80px;height:80px;border-radius:50%;
          border:3px solid #f8717133;
          display:flex;align-items:center;justify-content:center;
          margin:0 auto 16px;
        }

        /* Explorer link */
        .ts-explorer-btn{display:flex;align-items:center;gap:8px;padding:11px 16px;
          border-radius:8px;border:1px solid #22c55e33;background:#0d2e1f22;
          color:#22c55e88;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;
          letter-spacing:.08em;transition:all .2s;text-decoration:none;width:100%;justify-content:center;}
        .ts-explorer-btn:hover{border-color:#22c55e66;color:#22c55e;background:#0d2e1f;}

        /* Fee breakdown */
        .ts-fee-row{display:flex;justify-content:space-between;padding:7px 0;
          font-size:11px;border-bottom:1px solid #0f2a1a14;}
        .ts-fee-row:last-child{border-bottom:none;font-weight:700;font-size:13px;padding-top:10px;}

        @keyframes fu{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
        @keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
        @keyframes pulse{0%,100%{opacity:1;}50%{opacity:.4;}}

        .ldot{display:inline-block;width:5px;height:5px;border-radius:50%;background:#22c55e;
          margin-right:5px;animation:lp 1.5s infinite;}
        @keyframes lp{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.4);}50%{box-shadow:0 0 0 4px rgba(34,197,94,0);}}

        @media(max-width:900px){.ts-layout{grid-template-columns:1fr;}}
        @media(max-width:640px){.ts-info-grid{grid-template-columns:1fr;}}
      `}</style>

      <div className="ts">
        <div className="tsw">

          {/* Header */}
          <div className="ts-head">
            <div>
              <div className="ts-title">Transaction <span>Status</span></div>
              <div style={{ fontSize: 10, color: '#4ade8033', letterSpacing: '.1em', marginTop: 3 }}>
                ETHEREUM NETWORK · REAL-TIME TRACKING
              </div>
            </div>
            <button className="ts-back" onClick={() => navigate(-1)}>← BACK</button>
          </div>

          <div className="ts-layout">

            {/* ── Left: Transaction List ── */}
            <div className="ts-list-panel">
              <div className="ts-list-head">
                <input
                  className="ts-search"
                  placeholder="Search by hash, credit ID..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <div className="ts-filters">
                  {['ALL','CONFIRMED','PENDING','FAILED','BUY','SELL','RETIRE'].map(f => (
                    <button key={f} className={`ts-filter${filter===f?' active':''}`} onClick={() => setFilter(f)}>{f}</button>
                  ))}
                </div>
              </div>

              {filteredTxns.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: '#4ade8033', fontSize: 12 }}>
                  No transactions found
                </div>
              ) : filteredTxns.map(tx => {
                const s = STATUS_CONFIG[tx.status];
                const t = TYPE_CONFIG[tx.type];
                return (
                  <div
                    key={tx.txHash}
                    className={`ts-tx-row${selected.txHash === tx.txHash ? ' active' : ''}`}
                    onClick={() => setSelected(tx)}
                  >
                    {/* Type icon */}
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: t.bg, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, color: t.color, border: `1px solid ${t.color}22` }}>
                      {t.icon}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontSize: 12, color: '#f0fdf4', fontWeight: 600 }}>{tx.credit}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: t.color }}>
                          {tx.type === 'BUY' ? '-' : '+'}{fmt(tx.total)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 9, color: '#4ade8033' }}>{shortHash(tx.txHash)}</span>
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3,
                          background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
                          {tx.status === 'PENDING' && <span style={{ animation: 'pulse 1s infinite', display: 'inline' }}>⟳ </span>}
                          {s.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 9, color: '#4ade8022', marginTop: 2 }}>{timeAgo(tx.timestamp)}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Right: Transaction Detail ── */}
            <div className="ts-detail">

              {/* Status indicator */}
              <div style={{ textAlign: 'center', marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid #0f2a1a' }}>
                {isPending ? (
                  <div className="ts-pending-ring" />
                ) : selected.status === 'CONFIRMED' ? (
                  <div className="ts-confirmed-ring">
                    <span style={{ fontSize: 32, color: '#22c55e' }}>✓</span>
                  </div>
                ) : (
                  <div className="ts-failed-ring">
                    <span style={{ fontSize: 32, color: '#f87171' }}>✕</span>
                  </div>
                )}

                <div className={`ts-status-badge`} style={{
                  background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`,
                  margin: '0 auto 10px',
                }}>
                  {isPending && <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>}
                  {sc.label}
                  {isPending && '.'.repeat(pendingDots)}
                </div>

                <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 800, color: '#f0fdf4', marginBottom: 4 }}>
                  {TYPE_CONFIG[selected.type].label} {selected.qty} × {selected.credit}
                </div>
                <div style={{ fontSize: 11, color: '#4ade8033' }}>{selected.project}</div>

                {/* Step tracker */}
                <TxSteps status={selected.status} confirmations={selected.confirmations} />

                {selected.status === 'CONFIRMED' && (
                  <div style={{ fontSize: 11, color: '#22c55e66' }}>
                    {selected.confirmations} confirmations · Block #{selected.block?.toLocaleString()}
                  </div>
                )}
                {isPending && (
                  <div style={{ fontSize: 11, color: '#facc1566' }}>
                    {selected.confirmations}/12 confirmations · Waiting for block inclusion
                  </div>
                )}
              </div>

              {/* Tx Hash */}
              <div style={{ fontSize: 9, color: '#4ade8033', letterSpacing: '.1em', marginBottom: 6 }}>TRANSACTION HASH</div>
              <div className="ts-hash-box">
                <span style={{ fontSize: 10, wordBreak: 'break-all' }}>{selected.txHash}</span>
                <button
                  className={`ts-copy-btn${copied === 'hash' ? ' copied' : ''}`}
                  onClick={() => copyToClipboard(selected.txHash, 'hash')}
                >
                  {copied === 'hash' ? '✓ COPIED' : 'COPY'}
                </button>
              </div>

              {/* Fee breakdown */}
              <div style={{ background: '#060a07', borderRadius: 8, padding: '14px 16px', marginBottom: 14 }}>
                <div style={{ fontSize: 9, color: '#4ade8033', letterSpacing: '.1em', marginBottom: 10 }}>TRANSACTION BREAKDOWN</div>
                <div className="ts-fee-row">
                  <span style={{ color: '#4ade8055' }}>Credit Price</span>
                  <span style={{ color: '#f0fdf4' }}>{fmt(selected.price)} × {selected.qty}</span>
                </div>
                <div className="ts-fee-row">
                  <span style={{ color: '#4ade8055' }}>Subtotal</span>
                  <span style={{ color: '#f0fdf4' }}>{fmt(selected.price * selected.qty)}</span>
                </div>
                <div className="ts-fee-row">
                  <span style={{ color: '#4ade8055' }}>Platform Fee (0.5%)</span>
                  <span style={{ color: '#facc15' }}>{fmt(selected.fee)}</span>
                </div>
                <div className="ts-fee-row">
                  <span style={{ color: '#4ade8055' }}>Gas Fee</span>
                  <span style={{ color: '#4ade8055' }}>{selected.gasPrice}</span>
                </div>
                <div className="ts-fee-row" style={{ borderTop: '1px solid #0f2a1a', marginTop: 6 }}>
                  <span style={{ color: selected.type === 'BUY' ? '#f87171' : '#22c55e' }}>
                    {selected.type === 'BUY' ? 'TOTAL PAID' : 'TOTAL RECEIVED'}
                  </span>
                  <span style={{ color: selected.type === 'BUY' ? '#f87171' : '#22c55e' }}>{fmt(selected.total)}</span>
                </div>
              </div>

              {/* Info grid */}
              <div className="ts-info-grid">
                {[
                  { key: 'NETWORK',       val: selected.network },
                  { key: 'BLOCK',         val: selected.block ? `#${selected.block.toLocaleString()}` : 'Pending' },
                  { key: 'GAS USED',      val: selected.gasUsed },
                  { key: 'GAS PRICE',     val: selected.gasPrice },
                  { key: 'TIME',          val: timeAgo(selected.timestamp) },
                  { key: 'CONFIRMATIONS', val: selected.confirmations > 0 ? `${selected.confirmations}` : '—' },
                ].map(({ key, val }) => (
                  <div key={key} className="ts-info-cell">
                    <div className="ts-info-key">{key}</div>
                    <div className="ts-info-val">{val}</div>
                  </div>
                ))}
              </div>

              {/* From / To */}
              <div style={{ fontSize: 9, color: '#4ade8033', letterSpacing: '.1em', marginBottom: 6 }}>FROM</div>
              <div className="ts-hash-box" style={{ marginBottom: 8 }}>
                <span>{selected.from}</span>
                <button className={`ts-copy-btn${copied==='from'?' copied':''}`} onClick={() => copyToClipboard(selected.from,'from')}>
                  {copied==='from'?'✓':'COPY'}
                </button>
              </div>
              <div style={{ fontSize: 9, color: '#4ade8033', letterSpacing: '.1em', marginBottom: 6 }}>TO</div>
              <div className="ts-hash-box">
                <span>
                  {selected.type === 'RETIRE'
                    ? '0x0000...0000 (BURN ADDRESS)'
                    : selected.to}
                </span>
                <button className={`ts-copy-btn${copied==='to'?' copied':''}`} onClick={() => copyToClipboard(selected.to,'to')}>
                  {copied==='to'?'✓':'COPY'}
                </button>
              </div>

              {/* Explorer link */}
              <a
                href={`https://sepolia.etherscan.io/tx/${selected.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ts-explorer-btn"
                style={{ marginTop: 16, display: 'flex' }}
              >
                🔍 VIEW ON POLYGONSCAN →
              </a>

              {/* Actions */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => navigate('/carbon-credits')}
                  style={{ padding: '10px', borderRadius: 7, border: '1px solid #22c55e33', background: '#0d2e1f22',
                    color: '#22c55e88', cursor: 'pointer', fontFamily: 'DM Mono, monospace', fontSize: 10,
                    letterSpacing: '.08em', transition: 'all .2s' }}
                >
                  TRADE MORE →
                </button>
                <button
                  onClick={() => navigate('/portfolio')}
                  style={{ padding: '10px', borderRadius: 7, border: '1px solid #60a5fa33', background: '#0a162822',
                    color: '#60a5fa88', cursor: 'pointer', fontFamily: 'DM Mono, monospace', fontSize: 10,
                    letterSpacing: '.08em', transition: 'all .2s' }}
                >
                  MY PORTFOLIO →
                </button>
              </div>

            </div>
          </div>

          {/* Footer */}
          <div style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid #0f2a1a',
            display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#4ade8018', letterSpacing: '.1em' }}>
            <span>ETHERTRACK © 2026 — INDIA'S CARBON CREDIT EXCHANGE</span>
            <span>ETHEREUM NETWORK · IMMUTABLE RECORDS</span>
          </div>

        </div>
      </div>
    </>
  );
}