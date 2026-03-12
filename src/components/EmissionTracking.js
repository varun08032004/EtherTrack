import React, { useState, useEffect, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend, Filler } from 'chart.js';

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend, Filler);

const EmissionTracking = () => {
  const [emissions, setEmissions]               = useState([]);
  const [filteredEmissions, setFiltered]        = useState([]);
  const [filterSource, setFilterSource]         = useState('');
  const [filterDate, setFilterDate]             = useState('');
  const [filterAmount, setFilterAmount]         = useState('');
  const [sortOption, setSortOption]             = useState('date');
  const [realTimeEnabled, setRealTimeEnabled]   = useState(true);
  const [loading, setLoading]                   = useState(false);
  const [notification, setNotification]         = useState('');
  const [currentPage, setCurrentPage]           = useState(1);
  const [activeTab, setActiveTab]               = useState('input');

  // Input form state
  const [date, setDate]     = useState('');
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');

  const itemsPerPage = 5;

  const SOURCES = ['Coal', 'Natural Gas', 'Oil', 'Renewable', 'Transport', 'Industrial', 'Agriculture'];

  const fetchEmissionData = async () => [
    { date: '2024-09-01', source: 'Coal',        amount: 2.5 },
    { date: '2024-09-02', source: 'Natural Gas',  amount: 1.2 },
    { date: '2024-09-02', source: 'Coal',         amount: 3.0 },
    { date: '2024-09-03', source: 'Oil',          amount: 4.5 },
    { date: '2024-09-04', source: 'Renewable',    amount: 0.8 },
    { date: '2024-09-05', source: 'Transport',    amount: 2.1 },
    { date: '2024-09-06', source: 'Industrial',   amount: 3.7 },
  ];

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchEmissionData();
        setEmissions(data); setFiltered(data);
        showNotif('✅ Emission data loaded successfully');
      } catch { showNotif('❌ Failed to load emission data'); }
      finally { setLoading(false); }
    };
    load();
    const interval = realTimeEnabled ? setInterval(load, 60000) : null;
    return () => clearInterval(interval);
  }, [realTimeEnabled]);

  const showNotif = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 4000);
  };

  const applyFiltersAndSort = useCallback(() => {
    let filtered = [...emissions];
    if (filterSource) filtered = filtered.filter(e => e.source.toLowerCase().includes(filterSource.toLowerCase()));
    if (filterDate)   filtered = filtered.filter(e => e.date === filterDate);
    if (filterAmount) filtered = filtered.filter(e => e.amount >= parseFloat(filterAmount));
    filtered.sort((a, b) => sortOption === 'date'
      ? new Date(a.date) - new Date(b.date)
      : a.amount - b.amount);
    setFiltered(filtered);
    setCurrentPage(1);
  }, [emissions, filterSource, filterDate, filterAmount, sortOption]);

  useEffect(() => { applyFiltersAndSort(); }, [applyFiltersAndSort]);

  const handleAddData = (e) => {
    e.preventDefault();
    if (!date || !source || !amount) return;
    const newEntry = { date, source, amount: parseFloat(amount) };
    setEmissions(prev => [...prev, newEntry]);
    setDate(''); setSource(''); setAmount('');
    showNotif('✅ Emission data added successfully');
  };

  const handleExportCSV = () => {
    const csv = ['Date,Source,Amount (tons)', ...emissions.map(e => `${e.date},${e.source},${e.amount}`)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'ethertrack_emissions.csv'; a.click();
    URL.revokeObjectURL(url);
    showNotif('✅ CSV exported successfully');
  };

  const total   = emissions.reduce((acc, e) => acc + e.amount, 0);
  const avg     = emissions.length ? total / emissions.length : 0;
  const highest = emissions.length ? Math.max(...emissions.map(e => e.amount)) : 0;
  const credits = Math.ceil(total);

  const itemsStart       = (currentPage - 1) * itemsPerPage;
  const currentEmissions = filteredEmissions.slice(itemsStart, itemsStart + itemsPerPage);
  const totalPages       = Math.ceil(filteredEmissions.length / itemsPerPage);

  const chartData = {
    labels: filteredEmissions.map(e => e.date),
    datasets: [{
      label: 'Emissions (tonnes CO₂)',
      data: filteredEmissions.map(e => e.amount),
      borderColor: '#22c55e',
      backgroundColor: 'rgba(34,197,94,0.06)',
      borderWidth: 2,
      pointBackgroundColor: '#22c55e',
      pointBorderColor: '#080c0a',
      pointRadius: 4,
      tension: 0.4,
      fill: true,
    }]
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { labels: { color: '#4ade8088', font: { family: 'DM Mono', size: 11 } } },
      tooltip: {
        backgroundColor: '#0a0f0c',
        borderColor: '#0f2a1a',
        borderWidth: 1,
        titleColor: '#22c55e',
        bodyColor: '#e2e8e4',
        titleFont: { family: 'DM Mono' },
        bodyFont:  { family: 'DM Mono' },
      }
    },
    scales: {
      x: { ticks: { color: '#4ade8044', font: { family: 'DM Mono', size: 10 } }, grid: { color: '#0f2a1a' } },
      y: { ticks: { color: '#4ade8044', font: { family: 'DM Mono', size: 10 } }, grid: { color: '#0f2a1a' } },
    },
  };

  const sourceColors = {
    Coal: '#f87171', 'Natural Gas': '#fb923c', Oil: '#facc15',
    Renewable: '#22c55e', Transport: '#60a5fa', Industrial: '#a78bfa', Agriculture: '#34d399',
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');

        .et-em {
          min-height: 100vh; background: #080c0a;
          font-family: 'DM Mono', monospace; position: relative;
        }
        .et-em::before {
          content: ''; position: fixed; inset: 0; z-index: 0;
          background-image:
            linear-gradient(rgba(34,197,94,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(34,197,94,0.03) 1px, transparent 1px);
          background-size: 40px 40px; pointer-events: none;
        }
        .et-em-wrap {
          position: relative; z-index: 1;
          max-width: 1200px; margin: 0 auto; padding: 40px 24px;
        }

        /* Header */
        .et-em-header { margin-bottom: 28px; animation: fadeUp .5s ease both; }
        .et-em-label  { font-size: 10px; color: #4ade8066; letter-spacing: .15em; margin-bottom: 8px; }
        .et-em-title  { font-size: 26px; font-weight: 700; color: #f0fdf4; letter-spacing: .03em; margin-bottom: 4px; }
        .et-em-title span { color: #22c55e; }
        .et-em-sub    { font-size: 11px; color: #4ade8044; letter-spacing: .08em; }

        /* Notification */
        .et-em-notif {
          position: fixed; top: 80px; right: 24px; z-index: 999;
          padding: 12px 20px; border-radius: 8px;
          background: #0d2e1f; border: 1px solid #16a34a44;
          color: #22c55e; font-size: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,.4);
          animation: slideIn .3s ease;
        }
        @keyframes slideIn {
          from { transform: translateX(20px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }

        /* Stats */
        .et-em-stats {
          display: grid; grid-template-columns: repeat(4,1fr);
          gap: 12px; margin-bottom: 24px;
          animation: fadeUp .5s ease .1s both;
        }
        .et-em-stat {
          background: #0a0f0c; border: 1px solid #0f2a1a;
          border-radius: 10px; padding: 16px 18px;
          transition: border-color .2s, transform .2s;
        }
        .et-em-stat:hover { border-color: #22c55e22; transform: translateY(-2px); }
        .et-em-stat-label { font-size: 10px; color: #4ade8055; letter-spacing: .12em; margin-bottom: 8px; }
        .et-em-stat-val   { font-size: 22px; font-weight: 700; color: #f0fdf4; margin-bottom: 3px; }
        .et-em-stat-sub   { font-size: 10px; color: #22c55e88; }

        /* Tabs */
        .et-em-tabs { display: flex; gap: 4px; margin-bottom: 20px; animation: fadeUp .5s ease .15s both; }
        .et-em-tab {
          padding: 8px 20px; border-radius: 6px; border: 1px solid #0f2a1a;
          background: #0a0f0c; color: #4ade8066; cursor: pointer;
          font-family: 'DM Mono', monospace; font-size: 11px;
          letter-spacing: .1em; transition: all .2s;
        }
        .et-em-tab:hover  { color: #22c55e; border-color: #22c55e44; }
        .et-em-tab.active { background: #16a34a; color: #f0fdf4; border-color: #22c55e; }

        /* Card */
        .et-em-card {
          background: #0a0f0c; border: 1px solid #0f2a1a;
          border-radius: 10px; padding: 24px;
          animation: fadeUp .5s ease .2s both;
        }
        .et-em-card-title { font-size: 11px; color: #4ade8088; letter-spacing: .14em; margin-bottom: 20px; }

        /* Form */
        .et-em-form-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 20px; }
        .et-em-form-group { display: flex; flex-direction: column; gap: 6px; }
        .et-em-form-label { font-size: 10px; color: #4ade8088; letter-spacing: .12em; }
        .et-em-input, .et-em-select {
          padding: 10px 12px; border-radius: 7px;
          background: #060a07; border: 1px solid #0f2a1a;
          color: #e2e8e4; font-family: 'DM Mono', monospace; font-size: 12px;
          outline: none; transition: border-color .2s, box-shadow .2s;
        }
        .et-em-input:focus, .et-em-select:focus {
          border-color: #22c55e44; box-shadow: 0 0 0 3px rgba(34,197,94,.06);
        }
        .et-em-input::placeholder { color: #4ade8033; }

        /* Buttons */
        .et-em-btn-primary {
          padding: 11px 24px; border-radius: 7px; border: none;
          background: linear-gradient(135deg, #16a34a, #15803d);
          color: #fff; cursor: pointer; font-family: 'DM Mono', monospace;
          font-size: 12px; font-weight: 700; letter-spacing: .08em;
          transition: opacity .2s, transform .1s;
        }
        .et-em-btn-primary:hover { opacity: .88; transform: translateY(-1px); }

        .et-em-btn-secondary {
          padding: 11px 20px; border-radius: 7px;
          border: 1px solid #0f2a1a; background: #060a07;
          color: #4ade8088; cursor: pointer; font-family: 'DM Mono', monospace;
          font-size: 12px; letter-spacing: .08em;
          transition: all .2s;
        }
        .et-em-btn-secondary:hover { border-color: #22c55e44; color: #22c55e; background: #0d2e1f; }

        /* Filters */
        .et-em-filters {
          display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px;
          margin-bottom: 20px;
        }
        .et-em-filter-actions { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }

        /* Table */
        .et-em-table-head {
          display: grid; grid-template-columns: 120px 1fr 120px 100px;
          padding: 0 12px 10px; border-bottom: 1px solid #0f2a1a;
          font-size: 10px; color: #4ade8044; letter-spacing: .12em;
        }
        .et-em-table-row {
          display: grid; grid-template-columns: 120px 1fr 120px 100px;
          padding: 12px; border-bottom: 1px solid #0f2a1a22;
          font-size: 12px; align-items: center;
          transition: background .15s; border-radius: 4px;
        }
        .et-em-table-row:hover { background: #0f1a1244; }
        .et-em-table-row:last-child { border-bottom: none; }

        .et-em-source-badge {
          font-size: 10px; padding: 3px 9px; border-radius: 4px;
          display: inline-block; letter-spacing: .05em;
        }

        /* Pagination */
        .et-em-pagination {
          display: flex; align-items: center; justify-content: center;
          gap: 12px; margin-top: 16px;
        }
        .et-em-page-btn {
          padding: 7px 16px; border-radius: 6px;
          border: 1px solid #0f2a1a; background: #060a07;
          color: #4ade8088; cursor: pointer; font-family: 'DM Mono', monospace;
          font-size: 11px; transition: all .2s;
        }
        .et-em-page-btn:hover:not(:disabled) { border-color: #22c55e44; color: #22c55e; }
        .et-em-page-btn:disabled { opacity: .3; cursor: not-allowed; }
        .et-em-page-info { font-size: 11px; color: #4ade8055; letter-spacing: .08em; }

        /* Chart */
        .et-em-chart-wrap { position: relative; height: 280px; }

        /* Analysis */
        .et-em-analysis-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .et-em-analysis-item {
          background: #060a07; border: 1px solid #0f2a1a;
          border-radius: 8px; padding: 16px;
        }
        .et-em-analysis-label { font-size: 10px; color: #4ade8055; letter-spacing: .12em; margin-bottom: 8px; }
        .et-em-analysis-val   { font-size: 20px; font-weight: 700; color: #22c55e; margin-bottom: 3px; }
        .et-em-analysis-sub   { font-size: 10px; color: #4ade8044; }

        /* Loading */
        .et-em-loading {
          display: flex; align-items: center; justify-content: center;
          padding: 60px; color: #22c55e; font-size: 12px; letter-spacing: .1em;
        }
        .et-em-spinner {
          width: 20px; height: 20px; border-radius: 50%;
          border: 2px solid #0f2a1a; border-top-color: #22c55e;
          animation: spin .8s linear infinite; margin-right: 12px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* 2 col layout */
        .et-em-main { display: grid; grid-template-columns: 1fr 340px; gap: 16px; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        @media (max-width: 900px) {
          .et-em-stats   { grid-template-columns: repeat(2,1fr); }
          .et-em-filters { grid-template-columns: 1fr 1fr; }
          .et-em-form-grid { grid-template-columns: 1fr 1fr; }
          .et-em-main    { grid-template-columns: 1fr; }
          .et-em-analysis-grid { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      {notification && <div className="et-em-notif">{notification}</div>}

      <div className="et-em">
        <div className="et-em-wrap">

          {/* Header */}
          <div className="et-em-header">
            <div className="et-em-label">EMISSION MONITORING SYSTEM</div>
            <div className="et-em-title">Emission <span>Tracker</span></div>
            <div className="et-em-sub">TRACK · ANALYSE · OFFSET · REPORT</div>
          </div>

          {/* Stats */}
          <div className="et-em-stats">
            {[
              { label: "TOTAL EMISSIONS",   val: `${total.toFixed(2)}`,  sub: "tonnes CO₂e logged"    },
              { label: "AVERAGE PER ENTRY", val: `${avg.toFixed(2)}`,    sub: "tonnes CO₂e"           },
              { label: "HIGHEST SINGLE",    val: `${highest.toFixed(2)}`,sub: "tonnes CO₂e peak"      },
              { label: "CREDITS NEEDED",    val: `${credits}`,           sub: "to offset all emissions"},
            ].map(({ label, val, sub }) => (
              <div key={label} className="et-em-stat">
                <div className="et-em-stat-label">{label}</div>
                <div className="et-em-stat-val">{val}</div>
                <div className="et-em-stat-sub">{sub}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="et-em-tabs">
            {['input','chart','analysis','data'].map(t => (
              <button key={t} className={`et-em-tab${activeTab===t?' active':''}`}
                onClick={() => setActiveTab(t)}>
                {t === 'input' ? 'LOG EMISSION' : t === 'chart' ? 'CHART' : t === 'analysis' ? 'ANALYSIS' : 'DATA TABLE'}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="et-em-loading">
              <div className="et-em-spinner" />LOADING EMISSION DATA...
            </div>
          ) : (
            <>

              {/* INPUT TAB */}
              {activeTab === 'input' && (
                <div className="et-em-card">
                  <div className="et-em-card-title">LOG NEW EMISSION ENTRY</div>
                  <form onSubmit={handleAddData}>
                    <div className="et-em-form-grid">
                      <div className="et-em-form-group">
                        <label className="et-em-form-label">DATE</label>
                        <input className="et-em-input" type="date"
                          value={date} onChange={e => setDate(e.target.value)} required />
                      </div>
                      <div className="et-em-form-group">
                        <label className="et-em-form-label">EMISSION SOURCE</label>
                        <select className="et-em-select"
                          value={source} onChange={e => setSource(e.target.value)} required>
                          <option value="">Select source</option>
                          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div className="et-em-form-group">
                        <label className="et-em-form-label">AMOUNT (tonnes CO₂e)</label>
                        <input className="et-em-input" type="number" step="0.01" min="0"
                          placeholder="e.g. 2.5"
                          value={amount} onChange={e => setAmount(e.target.value)} required />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button type="submit" className="et-em-btn-primary">ADD EMISSION ENTRY →</button>
                      <button type="button" className="et-em-btn-secondary" onClick={handleExportCSV}>
                        EXPORT CSV
                      </button>
                      <button type="button" className="et-em-btn-secondary"
                        onClick={() => setRealTimeEnabled(r => !r)}>
                        {realTimeEnabled ? '⏸ PAUSE REALTIME' : '▶ ENABLE REALTIME'}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* CHART TAB */}
              {activeTab === 'chart' && (
                <div className="et-em-card">
                  <div className="et-em-card-title">EMISSION TREND CHART</div>
                  <div className="et-em-chart-wrap">
                    <Line data={chartData} options={chartOptions} />
                  </div>
                </div>
              )}

              {/* ANALYSIS TAB */}
              {activeTab === 'analysis' && (
                <div className="et-em-card">
                  <div className="et-em-card-title">ENHANCED ANALYSIS</div>
                  <div className="et-em-analysis-grid">
                    {[
                      { label: "TOTAL EMISSIONS",    val: `${total.toFixed(2)} tCO₂e`,  sub: "all time logged"         },
                      { label: "AVERAGE PER ENTRY",  val: `${avg.toFixed(2)} tCO₂e`,    sub: "mean emission per record"},
                      { label: "PEAK EMISSION",      val: `${highest.toFixed(2)} tCO₂e`,sub: "highest single entry"    },
                      { label: "OFFSET CREDITS",     val: `${credits} credits`,          sub: "needed to go carbon neutral"},
                      { label: "TOTAL RECORDS",      val: `${emissions.length}`,         sub: "emission entries logged" },
                      { label: "EST. OFFSET COST",   val: `₹${(credits * 842).toLocaleString('en-IN')}`, sub: "at current market rate" },
                    ].map(({ label, val, sub }) => (
                      <div key={label} className="et-em-analysis-item">
                        <div className="et-em-analysis-label">{label}</div>
                        <div className="et-em-analysis-val">{val}</div>
                        <div className="et-em-analysis-sub">{sub}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{
                    marginTop: 20, padding: '14px 16px',
                    background: '#0d2e1f', border: '1px solid #16a34a33',
                    borderRadius: 8, fontSize: 11, color: '#4ade8077', lineHeight: 1.7
                  }}>
                    💡 <strong style={{ color: '#22c55e' }}>Offset Recommendation:</strong> You need{' '}
                    <strong style={{ color: '#22c55e' }}>{credits} carbon credits</strong> to fully offset your
                    tracked emissions. Head to the <strong style={{ color: '#22c55e' }}>Market</strong> tab to purchase credits.
                  </div>
                </div>
              )}

              {/* DATA TABLE TAB */}
              {activeTab === 'data' && (
                <div className="et-em-card">
                  <div className="et-em-card-title">EMISSION DATA TABLE</div>

                  {/* Filters */}
                  <div className="et-em-filters">
                    <div className="et-em-form-group">
                      <label className="et-em-form-label">FILTER BY SOURCE</label>
                      <input className="et-em-input" type="text" placeholder="e.g. Coal"
                        value={filterSource} onChange={e => setFilterSource(e.target.value)} />
                    </div>
                    <div className="et-em-form-group">
                      <label className="et-em-form-label">FILTER BY DATE</label>
                      <input className="et-em-input" type="date"
                        value={filterDate} onChange={e => setFilterDate(e.target.value)} />
                    </div>
                    <div className="et-em-form-group">
                      <label className="et-em-form-label">MIN AMOUNT (tCO₂e)</label>
                      <input className="et-em-input" type="number" placeholder="e.g. 1.0"
                        value={filterAmount} onChange={e => setFilterAmount(e.target.value)} />
                    </div>
                    <div className="et-em-form-group">
                      <label className="et-em-form-label">SORT BY</label>
                      <select className="et-em-select" value={sortOption} onChange={e => setSortOption(e.target.value)}>
                        <option value="date">Date</option>
                        <option value="amount">Amount</option>
                      </select>
                    </div>
                  </div>

                  {/* Table */}
                  <div className="et-em-table-head">
                    <span>DATE</span><span>SOURCE</span><span>AMOUNT</span><span>STATUS</span>
                  </div>
                  {currentEmissions.length === 0 ? (
                    <div style={{ padding: '24px', textAlign: 'center', color: '#4ade8033', fontSize: 12 }}>
                      No emission records found
                    </div>
                  ) : currentEmissions.map((e, i) => (
                    <div key={i} className="et-em-table-row">
                      <span style={{ color: '#4ade8088' }}>{e.date}</span>
                      <span>
                        <span className="et-em-source-badge" style={{
                          background: `${sourceColors[e.source] || '#4ade80'}18`,
                          color: sourceColors[e.source] || '#4ade80',
                          border: `1px solid ${sourceColors[e.source] || '#4ade80'}33`,
                        }}>{e.source}</span>
                      </span>
                      <span style={{ color: e.amount > 3 ? '#f87171' : '#22c55e', fontWeight: 700 }}>
                        {e.amount.toFixed(2)} t
                      </span>
                      <span style={{
                        fontSize: 10, padding: '3px 8px', borderRadius: 4,
                        background: e.amount > 3 ? '#450a0a' : '#0d2e1f',
                        color: e.amount > 3 ? '#f87171' : '#22c55e',
                        border: `1px solid ${e.amount > 3 ? '#dc262644' : '#16a34a44'}`,
                      }}>
                        {e.amount > 3 ? 'HIGH' : 'NORMAL'}
                      </span>
                    </div>
                  ))}

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="et-em-pagination">
                      <button className="et-em-page-btn"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(p => p - 1)}>← PREV</button>
                      <span className="et-em-page-info">PAGE {currentPage} OF {totalPages}</span>
                      <button className="et-em-page-btn"
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage(p => p + 1)}>NEXT →</button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default EmissionTracking;