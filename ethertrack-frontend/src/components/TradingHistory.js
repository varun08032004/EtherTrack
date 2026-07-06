// TradingHistory.jsx — EtherTrack (PRODUCTION-HARDENED)
// [FEAT-TRADE-INVOICE] Added GST invoice download button per completed trade row.
//   · Calls tradesAPI.getInvoice(tradeId) which opens PDF in new tab
//   · Button only shown for INR / Razorpay trades (not ETH trades)
//   · Button only shown when buyer (not seller) is viewing the row
//   · has_invoice flag from API controls visibility (invoice may still be generating)

import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePortfolio } from '../context/PortfolioContext';
import { AuthContext }  from '../App';
import { tradesAPI }    from '../services/api';

const itemsPerPage = 10;

const TradingHistory = () => {
  const navigate = useNavigate();
  const { tradeHistory, loading } = usePortfolio();
  const { dbUser } = useContext(AuthContext);

  const [currentPage,  setCurrentPage]  = useState(1);
  const [filterType,   setFilterType]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search,       setSearch]       = useState('');

  const isLoading = loading;

  const rows = tradeHistory.map(t => ({
    id:          t.id       || t.txHash?.slice(0, 8) || '—',
    idShort:     (t.id || t.txHash || '—').slice(0, 8).toUpperCase(),
    market:      t.projectName || (t.tokenId ? `Token #${t.tokenId}` : '—'),
    type:        t.type     || 'Buy',
    size:        t.amount   || 0,
    priceInr:    parseFloat(t.priceINR || t.price_per_credit_inr || 0),
    totalInr:    parseFloat(t.totalINR || t.buyer_pays_inr || 0),
    totalEth:    parseFloat(t.totalEth || 0),
    time:        t.time     || '—',
    status:      t.isAMM ? 'AMM' : (t.status || 'Confirmed'),
    txHash:      t.txHash   || null,
    chainStatus: t.chain_status  || null,
    chainTxHash: t.chain_tx_hash || null,
    // [FEAT-TRADE-INVOICE] invoice fields
    hasInvoice:  t.has_invoice === true || t.has_invoice === 'true' || !!t.trade_invoice_number,
    invoiceGeneratedAt: t.trade_invoice_generated_at || null,
    buyerId:     t.buyer_id || null,
    paymentMode: t.payment_mode || null,
  }));

  const totalVol   = rows.reduce((a, t) => a + t.totalInr, 0);
  const totalBuys  = rows.filter(t => t.type === 'Buy').reduce((a, t)  => a + t.totalInr, 0);
  const totalSells = rows.filter(t => t.type === 'Sell').reduce((a, t) => a + t.totalInr, 0);

  const filtered = rows.filter(t => {
    const matchType   = filterType   === 'all' || t.type.toLowerCase()   === filterType;
    const matchStatus = filterStatus === 'all' || t.status.toLowerCase() === filterStatus.toLowerCase();
    const matchSearch = t.market.toLowerCase().includes(search.toLowerCase())
                     || t.id.toLowerCase().includes(search.toLowerCase());
    return matchType && matchStatus && matchSearch;
  });

  const totalPages     = Math.ceil(filtered.length / itemsPerPage);
  const currentEntries = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const fmt    = n => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  const fmtEth = n => `${Number(n).toFixed(4)}`;

  const handleExport = () => {
    const csv = [
      'TXN ID,Market,Type,Size,Price (INR),Total (INR),Total (ETH),Time,Status',
      ...rows.map(t =>
        `${t.id},${t.market},${t.type},${t.size},${t.priceInr.toFixed(0)},${t.totalInr.toFixed(0)},${t.totalEth},${t.time},${t.status}`
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'trading_history.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const statusClass = s => {
    const l = s?.toLowerCase();
    if (l === 'confirmed' || l === 'amm') return 'confirmed';
    if (l === 'pending')                  return 'pending';
    if (l === 'failed')                   return 'failed';
    return 'confirmed';
  };

  // [FEAT-TRADE-INVOICE] Show invoice button only for:
  //   · Buyer (not seller) — check buyerId vs current user
  //   · INR or Razorpay trades (not ETH)
  //   · Has invoice generated (has_invoice flag)
  const showInvoiceBtn = (t) => {
    if (!t.hasInvoice) return false;
    if (t.type !== 'Buy') return false;
    if (t.paymentMode === 'eth') return false;
    // If we have buyer ID, check it matches current user
    if (t.buyerId && dbUser?.id && t.buyerId !== dbUser.id) return false;
    return true;
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        .et-th { min-height:100vh; background:#080c0a; font-family:'DM Mono',monospace; }
        .et-th-wrap { max-width:1200px; margin:0 auto; padding:40px 24px; }
        .et-th-label { font-size:10px; color:#4ade8066; letter-spacing:.15em; margin-bottom:8px; }
        .et-th-title { font-size:26px; font-weight:700; color:#f0fdf4; margin-bottom:28px; }
        .et-th-title span { color:#22c55e; }
        .et-th-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:24px; }
        .et-th-stat { background:#0a0f0c; border:1px solid #0f2a1a; border-radius:10px; padding:16px 18px; }
        .et-th-stat-label { font-size:10px; color:#4ade8055; letter-spacing:.12em; margin-bottom:8px; }
        .et-th-stat-val   { font-size:18px; font-weight:700; color:#f0fdf4; }
        .et-th-stat-sub   { font-size:10px; color:#22c55e88; margin-top:3px; }
        .et-th-card { background:#0a0f0c; border:1px solid #0f2a1a; border-radius:10px; padding:24px; }
        .et-th-card-title { font-size:11px; color:#4ade8088; letter-spacing:.14em; margin-bottom:20px; }
        .et-th-filters { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:20px; align-items:flex-end; }
        .et-th-filter-group { display:flex; flex-direction:column; gap:5px; }
        .et-th-filter-label { font-size:9px; color:#4ade8044; letter-spacing:.12em; }
        .et-th-input, .et-th-select { padding:8px 12px; border-radius:6px; background:#060a07; border:1px solid #0f2a1a; color:#e2e8e4; font-family:'DM Mono',monospace; font-size:11px; outline:none; }
        .et-th-input::placeholder { color:#4ade8033; }
        .et-th-export-btn { padding:8px 16px; border-radius:6px; border:1px solid #0f2a1a; background:#060a07; color:#4ade8088; cursor:pointer; font-family:'DM Mono',monospace; font-size:11px; align-self:flex-end; }
        .et-th-export-btn:hover { border-color:#22c55e44; color:#22c55e; background:#0d2e1f; }

        .et-th-scroll { overflow-x:auto; width:100%; }
        .et-th-table  { min-width:980px; width:100%; }

        /* 9 columns — added INVOICE column */
        .et-th-head,
        .et-th-row {
          display: grid;
          grid-template-columns: 72px 180px 48px 48px 100px 100px 80px 90px 90px;
          gap: 8px;
          align-items: center;
          padding: 10px 12px;
        }
        .et-th-head { border-bottom:1px solid #0f2a1a; font-size:9px; color:#4ade8044; letter-spacing:.12em; padding-bottom:10px; }
        .et-th-row  { border-bottom:1px solid #0f2a1a22; font-size:11px; cursor:pointer; border-radius:4px; }
        .et-th-row:hover { background:#0f1a1244; }
        .et-th-row:last-child { border-bottom:none; }

        .et-th-cell-id      { font-size:9px; color:#4ade8066; font-family:'DM Mono',monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .et-th-cell-project { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#e2e8e4; font-size:11px; }
        .et-th-type-buy  { color:#22c55e; font-weight:600; }
        .et-th-type-sell { color:#f87171; font-weight:600; }
        .et-th-status { font-size:9px; padding:3px 7px; border-radius:4px; display:inline-block; letter-spacing:.06em; white-space:nowrap; }
        .et-th-status.confirmed { background:#0d2e1f; color:#22c55e; border:1px solid #16a34a44; }
        .et-th-status.pending   { background:#1c1a00; color:#facc15; border:1px solid #ca8a0444; }
        .et-th-status.failed    { background:#450a0a; color:#f87171; border:1px solid #dc262644; }
        .et-th-chain-badge { font-size:8px; padding:2px 5px; border-radius:3px; display:block; margin-top:3px; text-decoration:none; white-space:nowrap; width:fit-content; }
        .et-th-chain-confirmed { background:#0d2e1f; color:#22c55e88; border:1px solid #16a34a22; }
        .et-th-chain-pending   { background:#1c1a00; color:#facc1588; border:1px solid #ca8a0422; }

        /* [FEAT-TRADE-INVOICE] Invoice button */
        .et-th-invoice-btn {
          display: inline-flex; align-items: center; gap: 3px;
          padding: 4px 8px; border-radius: 4px; font-size: 9px;
          border: 1px solid #22c55e33; background: #0d2e1f;
          color: #22c55e88; cursor: pointer;
          font-family: 'DM Mono', monospace; letter-spacing: .06em;
          text-decoration: none; white-space: nowrap;
          transition: all .15s;
        }
        .et-th-invoice-btn:hover { border-color:#22c55e66; color:#22c55e; background:#0f3520; }
        .et-th-invoice-pending {
          display: inline-block; padding: 4px 8px; border-radius: 4px;
          font-size: 9px; color: #86efac33; letter-spacing: .04em;
        }

        .et-th-pagination { display:flex; align-items:center; justify-content:center; gap:8px; margin-top:20px; }
        .et-th-page-btn { padding:6px 14px; border-radius:5px; border:1px solid #0f2a1a; background:#060a07; color:#4ade8088; cursor:pointer; font-family:'DM Mono',monospace; font-size:10px; }
        .et-th-page-btn:hover:not(:disabled) { border-color:#22c55e44; color:#22c55e; }
        .et-th-page-btn:disabled { opacity:.3; cursor:not-allowed; }
        .et-th-page-btn.active   { background:#0d2e1f; border-color:#22c55e; color:#22c55e; }
        .et-th-empty { padding:40px; text-align:center; color:#4ade8033; font-size:12px; letter-spacing:.08em; }
        .et-th-skeleton { height:14px; background:#0f2a1a55; border-radius:4px; animation:pulse 1.5s ease infinite; }
        @keyframes pulse { 0%,100%{opacity:.4;} 50%{opacity:.9;} }
        @media(max-width:768px) { .et-th-stats { grid-template-columns:1fr 1fr; } }
      `}</style>

      <div className="et-th">
        <div className="et-th-wrap">
          <div className="et-th-label">TRANSACTION RECORDS</div>
          <div className="et-th-title">Trading <span>History</span></div>

          <div className="et-th-stats">
            {[
              { label: 'TOTAL VOLUME', val: fmt(totalVol),   sub: 'all transactions'  },
              { label: 'TOTAL BOUGHT', val: fmt(totalBuys),  sub: 'credits purchased' },
              { label: 'TOTAL SOLD',   val: fmt(totalSells), sub: 'credits sold'      },
              { label: 'TOTAL TRADES', val: rows.length,     sub: 'transactions'      },
            ].map(({ label, val, sub }) => (
              <div key={label} className="et-th-stat">
                <div className="et-th-stat-label">{label}</div>
                <div className="et-th-stat-val">
                  {loading?.trades ? <div className="et-th-skeleton" style={{ width: 80 }}/> : val}
                </div>
                <div className="et-th-stat-sub">{sub}</div>
              </div>
            ))}
          </div>

          <div className="et-th-card">
            <div className="et-th-card-title">
              ALL TRANSACTIONS
              {rows.length > 0 && <span style={{ color:'#22c55e88', marginLeft:8 }}>· {rows.length} TOTAL</span>}
            </div>

            <div className="et-th-filters">
              <div className="et-th-filter-group">
                <span className="et-th-filter-label">SEARCH</span>
                <input className="et-th-input" placeholder="TXN ID or project..."
                  value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}/>
              </div>
              <div className="et-th-filter-group">
                <span className="et-th-filter-label">TYPE</span>
                <select className="et-th-select" value={filterType} onChange={e => { setFilterType(e.target.value); setCurrentPage(1); }}>
                  <option value="all">All Types</option>
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </div>
              <div className="et-th-filter-group">
                <span className="et-th-filter-label">STATUS</span>
                <select className="et-th-select" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setCurrentPage(1); }}>
                  <option value="all">All Status</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                  <option value="amm">AMM Swap</option>
                </select>
              </div>
              <button className="et-th-export-btn" onClick={handleExport}>EXPORT CSV</button>
            </div>

            <div className="et-th-scroll">
              <div className="et-th-table">
                <div className="et-th-head">
                  <span>TXN ID</span>
                  <span>PROJECT</span>
                  <span>TYPE</span>
                  <span>SIZE</span>
                  <span>PRICE (INR)</span>
                  <span>TOTAL (INR)</span>
                  <span>ETH</span>
                  <span>STATUS</span>
                  <span>INVOICE</span>{/* [FEAT-TRADE-INVOICE] */}
                </div>

                {loading?.trades ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} style={{ padding:'14px 12px', borderBottom:'1px solid #0f2a1a22' }}>
                      <div className="et-th-skeleton" style={{ width:'60%', marginBottom:6 }}/>
                      <div className="et-th-skeleton" style={{ width:'40%' }}/>
                    </div>
                  ))
                ) : currentEntries.length === 0 ? (
                  <div className="et-th-empty">
                    {rows.length === 0
                      ? 'No trades yet — your transactions will appear here.'
                      : 'No transactions match your filters.'}
                  </div>
                ) : (
                  currentEntries.map((t, i) => (
                    <div key={t.id + i} className="et-th-row"
                      onClick={() => t.txHash && navigate(`/transaction-status?hash=${t.txHash}`)}
                      title={t.txHash || ''}>

                      <span className="et-th-cell-id" title={t.id}>{t.idShort}</span>

                      <span className="et-th-cell-project" title={t.market}>{t.market}</span>

                      <span className={`et-th-type-${t.type.toLowerCase()}`}>{t.type}</span>

                      <span style={{ color:'#e2e8e4' }}>{t.size}</span>

                      <span style={{ color:'#e2e8e4' }}>{t.priceInr > 0 ? fmt(t.priceInr) : '—'}</span>

                      <span style={{ color:'#f0fdf4', fontWeight:700 }}>{t.totalInr > 0 ? fmt(t.totalInr) : '—'}</span>

                      <span style={{ color:'#60a5fa88', fontSize:10 }}>{t.totalEth > 0 ? fmtEth(t.totalEth) : '—'}</span>

                      <span>
                        <span className={`et-th-status ${statusClass(t.status)}`}>{t.status}</span>
                        {t.chainStatus && (
                          <a href={t.chainTxHash ? `https://sepolia.etherscan.io/tx/${t.chainTxHash}` : '#'}
                            target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className={`et-th-chain-badge ${t.chainStatus === 'confirmed' ? 'et-th-chain-confirmed' : 'et-th-chain-pending'}`}>
                            {t.chainStatus === 'confirmed' ? '⛓ ON-CHAIN' : '⏳ LOGGING'}
                          </a>
                        )}
                      </span>

                      {/* [FEAT-TRADE-INVOICE] Invoice download / chain link */}
                      <span onClick={e => e.stopPropagation()}>
                        {showInvoiceBtn(t) ? (
                          // INR / Razorpay — invoice ready
                          <button
                            className="et-th-invoice-btn"
                            onClick={() => tradesAPI.getInvoice(t.id)}
                            title="Download GST Invoice PDF"
                          >
                            ↓ GST PDF
                          </button>
                        ) : t.type === 'Buy' && t.paymentMode === 'eth' && t.chainTxHash ? (
                          // ETH — link to Etherscan instead of invoice
                          <a
                            href={`https://sepolia.etherscan.io/tx/${t.chainTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="et-th-invoice-btn"
                            title="View on Etherscan"
                          >
                            ⛓ ETHERSCAN
                          </a>
                        ) : t.type === 'Buy' && t.paymentMode !== 'eth' && !t.hasInvoice && t.invoiceGeneratedAt === null ? (
                          // INR / Razorpay — invoice still generating (only show if trade very recent)
                          <span className="et-th-invoice-pending" title="Invoice generating — refresh in a moment">
                            ⏳ generating
                          </span>
                        ) : t.type === 'Buy' && t.paymentMode !== 'eth' && !t.hasInvoice ? (
                          // Invoice failed to generate — show retry hint
                          <span style={{ color: '#f8717155', fontSize: 9 }} title="Invoice unavailable — contact support">
                            ⚠ unavailable
                          </span>
                        ) : (
                          <span style={{ color: '#86efac22', fontSize: 9 }}>—</span>
                        )}
                      </span>

                    </div>
                  ))
                )}
              </div>
            </div>

            {totalPages > 1 && (
              <div className="et-th-pagination">
                <button className="et-th-page-btn" disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}>← PREV</button>
                {[...Array(totalPages)].map((_, i) => (
                  <button key={i}
                    className={`et-th-page-btn${currentPage === i + 1 ? ' active' : ''}`}
                    onClick={() => setCurrentPage(i + 1)}>{i + 1}</button>
                ))}
                <button className="et-th-page-btn" disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}>NEXT →</button>
              </div>
            )}

            {rows.length > 0 && (
              <div style={{ marginTop:16, paddingTop:12, borderTop:'1px solid #0f2a1a22', fontSize:9, color:'#4ade8033', textAlign:'center', letterSpacing:'.08em' }}>
                Click any row to view on-chain details · GST invoices available for INR/Razorpay purchases
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default TradingHistory;