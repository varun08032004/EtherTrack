import React, { useState } from 'react';

const mockData = [
  { id: 'TXN-001', market: 'VCS-4821',  type: 'Buy',  size: 10, price: 842,  total: 8420,  time: '09:42:11', status: 'Confirmed', date: '2024-09-01' },
  { id: 'TXN-002', market: 'REDD-1193', type: 'Sell', size: 5,  price: 1238, total: 6190,  time: '10:15:03', status: 'Confirmed', date: '2024-09-01' },
  { id: 'TXN-003', market: 'GS-7742',   type: 'Buy',  size: 20, price: 619,  total: 12380, time: '11:02:47', status: 'Pending',   date: '2024-09-02' },
  { id: 'TXN-004', market: 'CDM-3310',  type: 'Buy',  size: 8,  price: 491,  total: 3928,  time: '13:30:00', status: 'Confirmed', date: '2024-09-02' },
  { id: 'TXN-005', market: 'VCS-4821',  type: 'Sell', size: 3,  price: 856,  total: 2568,  time: '14:20:15', status: 'Confirmed', date: '2024-09-03' },
  { id: 'TXN-006', market: 'REDD-1193', type: 'Buy',  size: 12, price: 1245, total: 14940, time: '09:10:33', status: 'Failed',    date: '2024-09-03' },
  { id: 'TXN-007', market: 'GS-7742',   type: 'Sell', size: 7,  price: 624,  total: 4368,  time: '15:45:22', status: 'Confirmed', date: '2024-09-04' },
  { id: 'TXN-008', market: 'VCS-4821',  type: 'Buy',  size: 15, price: 839,  total: 12585, time: '10:55:09', status: 'Confirmed', date: '2024-09-04' },
  { id: 'TXN-009', market: 'CDM-3310',  type: 'Buy',  size: 6,  price: 488,  total: 2928,  time: '11:30:00', status: 'Pending',   date: '2024-09-05' },
  { id: 'TXN-010', market: 'REDD-1193', type: 'Sell', size: 9,  price: 1232, total: 11088, time: '14:05:41', status: 'Confirmed', date: '2024-09-05' },
];

const itemsPerPage = 5;

const TradingHistory = () => {
  const [currentPage, setCurrentPage] = useState(1);
  const [filterType, setFilterType]   = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [search, setSearch]           = useState('');

  const filtered = mockData.filter(t => {
    const matchType   = filterType   === 'all' || t.type.toLowerCase()   === filterType;
    const matchStatus = filterStatus === 'all' || t.status.toLowerCase() === filterStatus;
    const matchSearch = t.market.toLowerCase().includes(search.toLowerCase()) || t.id.toLowerCase().includes(search.toLowerCase());
    return matchType && matchStatus && matchSearch;
  });

  const totalPages      = Math.ceil(filtered.length / itemsPerPage);
  const currentEntries  = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const totalBuys  = mockData.filter(t => t.type === 'Buy').reduce((a, t)  => a + t.total, 0);
  const totalSells = mockData.filter(t => t.type === 'Sell').reduce((a, t) => a + t.total, 0);
  const totalVol   = mockData.reduce((a, t) => a + t.total, 0);

  const fmt = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

  const handleExport = () => {
    const csv = ['TXN ID,Market,Type,Size,Price,Total,Time,Status',
      ...mockData.map(t => `${t.id},${t.market},${t.type},${t.size},${t.price},${t.total},${t.time},${t.status}`)
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = 'trading_history.csv'; a.click();
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        .et-th { min-height: 100vh; background: #080c0a; font-family: 'DM Mono', monospace; position: relative; }
        .et-th::before {
          content: ''; position: fixed; inset: 0; z-index: 0;
          background-image: linear-gradient(rgba(34,197,94,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.03) 1px, transparent 1px);
          background-size: 40px 40px; pointer-events: none;
        }
        .et-th-wrap { position: relative; z-index: 1; max-width: 1100px; margin: 0 auto; padding: 40px 24px; }
        .et-th-label { font-size: 10px; color: #4ade8066; letter-spacing: .15em; margin-bottom: 8px; }
        .et-th-title { font-size: 26px; font-weight: 700; color: #f0fdf4; margin-bottom: 28px; }
        .et-th-title span { color: #22c55e; }

        .et-th-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 24px; animation: fadeUp .4s ease both; }
        .et-th-stat { background: #0a0f0c; border: 1px solid #0f2a1a; border-radius: 10px; padding: 16px 18px; }
        .et-th-stat-label { font-size: 10px; color: #4ade8055; letter-spacing: .12em; margin-bottom: 8px; }
        .et-th-stat-val   { font-size: 18px; font-weight: 700; color: #f0fdf4; }
        .et-th-stat-sub   { font-size: 10px; color: #22c55e88; margin-top: 3px; }

        .et-th-card { background: #0a0f0c; border: 1px solid #0f2a1a; border-radius: 10px; padding: 24px; animation: fadeUp .4s ease .1s both; }
        .et-th-card-title { font-size: 11px; color: #4ade8088; letter-spacing: .14em; margin-bottom: 20px; }

        .et-th-filters { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; align-items: flex-end; }
        .et-th-filter-group { display: flex; flex-direction: column; gap: 5px; }
        .et-th-filter-label { font-size: 9px; color: #4ade8044; letter-spacing: .12em; }
        .et-th-input, .et-th-select {
          padding: 8px 12px; border-radius: 6px;
          background: #060a07; border: 1px solid #0f2a1a;
          color: #e2e8e4; font-family: 'DM Mono', monospace; font-size: 11px;
          outline: none; transition: border-color .2s;
        }
        .et-th-input:focus, .et-th-select:focus { border-color: #22c55e44; }
        .et-th-input::placeholder { color: #4ade8033; }

        .et-th-export-btn {
          padding: 8px 16px; border-radius: 6px;
          border: 1px solid #0f2a1a; background: #060a07;
          color: #4ade8088; cursor: pointer; font-family: 'DM Mono', monospace;
          font-size: 11px; letter-spacing: .08em; transition: all .2s; align-self: flex-end;
        }
        .et-th-export-btn:hover { border-color: #22c55e44; color: #22c55e; background: #0d2e1f; }

        .et-th-head {
          display: grid; grid-template-columns: 90px 100px 60px 60px 90px 100px 80px 90px;
          padding: 0 12px 10px; border-bottom: 1px solid #0f2a1a;
          font-size: 9px; color: #4ade8044; letter-spacing: .12em;
        }
        .et-th-row {
          display: grid; grid-template-columns: 90px 100px 60px 60px 90px 100px 80px 90px;
          padding: 12px; border-bottom: 1px solid #0f2a1a22;
          font-size: 11px; align-items: center;
          transition: background .15s; border-radius: 4px;
        }
        .et-th-row:hover { background: #0f1a1244; }
        .et-th-row:last-child { border-bottom: none; }

        .et-th-type-buy  { color: #22c55e; }
        .et-th-type-sell { color: #f87171; }

        .et-th-status {
          font-size: 9px; padding: 3px 8px; border-radius: 4px;
          display: inline-block; letter-spacing: .06em;
        }
        .et-th-status.confirmed { background: #0d2e1f; color: #22c55e; border: 1px solid #16a34a44; }
        .et-th-status.pending   { background: #1c1a00; color: #facc15; border: 1px solid #ca8a0444; }
        .et-th-status.failed    { background: #450a0a; color: #f87171; border: 1px solid #dc262644; }

        .et-th-pagination { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 20px; }
        .et-th-page-btn {
          padding: 6px 14px; border-radius: 5px;
          border: 1px solid #0f2a1a; background: #060a07;
          color: #4ade8088; cursor: pointer; font-family: 'DM Mono', monospace;
          font-size: 10px; transition: all .2s;
        }
        .et-th-page-btn:hover:not(:disabled) { border-color: #22c55e44; color: #22c55e; }
        .et-th-page-btn:disabled { opacity: .3; cursor: not-allowed; }
        .et-th-page-btn.active   { background: #0d2e1f; border-color: #22c55e; color: #22c55e; }
        .et-th-page-info { font-size: 10px; color: #4ade8044; letter-spacing: .08em; padding: 0 4px; }

        .et-th-empty { padding: 40px; text-align: center; color: #4ade8033; font-size: 12px; letter-spacing: .08em; }

        @keyframes fadeUp { from{opacity:0;transform:translateY(12px);} to{opacity:1;transform:translateY(0);} }
        @media(max-width:900px) {
          .et-th-stats{grid-template-columns:1fr 1fr;}
          .et-th-head, .et-th-row { grid-template-columns: 80px 90px 55px 55px 80px 90px; }
          .et-th-head span:nth-child(7), .et-th-head span:nth-child(8),
          .et-th-row  > *:nth-child(7), .et-th-row  > *:nth-child(8) { display: none; }
        }
      `}</style>

      <div className="et-th">
        <div className="et-th-wrap">
          <div className="et-th-label">TRANSACTION RECORDS</div>
          <div className="et-th-title">Trading <span>History</span></div>

          {/* Stats */}
          <div className="et-th-stats">
            {[
              { label: "TOTAL VOLUME",    val: fmt(totalVol),  sub: "all transactions"   },
              { label: "TOTAL BOUGHT",    val: fmt(totalBuys), sub: "credits purchased"  },
              { label: "TOTAL SOLD",      val: fmt(totalSells),sub: "credits sold"       },
              { label: "TOTAL TRADES",    val: mockData.length,sub: "transactions"       },
            ].map(({ label, val, sub }) => (
              <div key={label} className="et-th-stat">
                <div className="et-th-stat-label">{label}</div>
                <div className="et-th-stat-val">{val}</div>
                <div className="et-th-stat-sub">{sub}</div>
              </div>
            ))}
          </div>

          <div className="et-th-card">
            <div className="et-th-card-title">ALL TRANSACTIONS</div>

            {/* Filters */}
            <div className="et-th-filters">
              <div className="et-th-filter-group">
                <span className="et-th-filter-label">SEARCH</span>
                <input className="et-th-input" placeholder="TXN ID or market..."
                  value={search} onChange={e => { setSearch(e.target.value); setCurrentPage(1); }} />
              </div>
              <div className="et-th-filter-group">
                <span className="et-th-filter-label">TYPE</span>
                <select className="et-th-select" value={filterType}
                  onChange={e => { setFilterType(e.target.value); setCurrentPage(1); }}>
                  <option value="all">All Types</option>
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </div>
              <div className="et-th-filter-group">
                <span className="et-th-filter-label">STATUS</span>
                <select className="et-th-select" value={filterStatus}
                  onChange={e => { setFilterStatus(e.target.value); setCurrentPage(1); }}>
                  <option value="all">All Status</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              <button className="et-th-export-btn" onClick={handleExport}>EXPORT CSV</button>
            </div>

            {/* Table */}
            <div className="et-th-head">
              <span>TXN ID</span><span>MARKET</span><span>TYPE</span>
              <span>SIZE</span><span>PRICE</span><span>TOTAL</span>
              <span>TIME</span><span>STATUS</span>
            </div>

            {currentEntries.length === 0 ? (
              <div className="et-th-empty">No transactions found</div>
            ) : currentEntries.map((t) => (
              <div key={t.id} className="et-th-row">
                <span style={{ color: '#4ade8066' }}>{t.id}</span>
                <span>{t.market}</span>
                <span className={`et-th-type-${t.type.toLowerCase()}`}>{t.type}</span>
                <span>{t.size}</span>
                <span>{fmt(t.price)}</span>
                <span style={{ fontWeight: 700 }}>{fmt(t.total)}</span>
                <span style={{ color: '#4ade8066' }}>{t.time}</span>
                <span><span className={`et-th-status ${t.status.toLowerCase()}`}>{t.status}</span></span>
              </div>
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="et-th-pagination">
                <button className="et-th-page-btn" disabled={currentPage === 1}
                  onClick={() => setCurrentPage(p => p - 1)}>← PREV</button>
                {[...Array(totalPages)].map((_, i) => (
                  <button key={i} className={`et-th-page-btn${currentPage === i+1 ? ' active' : ''}`}
                    onClick={() => setCurrentPage(i + 1)}>{i + 1}</button>
                ))}
                <button className="et-th-page-btn" disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}>NEXT →</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default TradingHistory;