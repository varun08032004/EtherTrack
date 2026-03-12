import React, { useState, useEffect, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { usePortfolio } from '../context/PortfolioContext';
import { txAPI, apiFetch } from '../services/api';

const NEWS_FEED = [
  { id:1, time:'2h ago',  tag:'MARKET',     title:'Carbon credit prices surge 12% as CCTS framework nears finalization', hot:true  },
  { id:2, time:'4h ago',  tag:'POLICY',     title:"India's BEE releases draft guidelines for voluntary carbon market participants", hot:false },
  { id:3, time:'6h ago',  tag:'TECHNOLOGY', title:'Ethereum Network sees record carbon tokenization volumes in Q1 2026', hot:false },
  { id:4, time:'1d ago',  tag:'GLOBAL',     title:'COP31 preparations: Asia-Pacific carbon markets set to double by 2027', hot:false },
  { id:5, time:'1d ago',  tag:'MARKET',     title:'Gold Standard credits outperform VCS in renewable energy segment', hot:false },
];

const QUICK_ACTIONS = [
  { icon:'🌿', label:'BUY CREDITS',   path:'/carbon-credits',    color:'#22c55e', bg:'#0d2e1f' },
  { icon:'📊', label:'MY PORTFOLIO',  path:'/portfolio',         color:'#60a5fa', bg:'#0a1628' },
  { icon:'🏭', label:'LOG EMISSIONS', path:'/emission-tracking', color:'#f97316', bg:'#1a0e00' },
  { icon:'📈', label:'TRADE HISTORY', path:'/trading-history',   color:'#a78bfa', bg:'#120a28' },
  { icon:'🔐', label:'KYC VERIFY',    path:'/kyc',               color:'#facc15', bg:'#1a1500' },
  { icon:'⚙️', label:'SETTINGS',      path:'/settings',          color:'#4ade80', bg:'#052e16' },
];

const fmt = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

function Spark({ data, color }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const norm = v => 28 - ((v - min) / (max - min || 1)) * 24;
  const pts  = data.map((v, i) => `${(i / (data.length - 1)) * 80},${norm(v)}`).join(' ');
  return (
    <svg width="80" height="28" style={{ display:'block', flexShrink:0 }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={pts} opacity="0.9"/>
      <polyline fill={color} fillOpacity="0.1" stroke="none" points={`0,28 ${pts} 80,28`}/>
    </svg>
  );
}

function EmissionArc({ pct }) {
  const r = 50, cx = 64, cy = 64;
  const arcLen = Math.PI * r;
  const fill   = (pct / 100) * arcLen;
  return (
    <svg width="128" height="76" viewBox="0 0 128 80">
      <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke="#0f2a1a" strokeWidth="8" strokeLinecap="round"/>
      <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke="#22c55e" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${fill} ${arcLen}`} style={{ transition:'stroke-dasharray 1.2s ease' }}/>
      <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" opacity="0.2"/>
    </svg>
  );
}

export default function Dashboard() {
  const { user, dbUser, kycCompleted } = useContext(AuthContext);
  const navigate = useNavigate();

  const {
    myCredits, stats, listings,
    walletAddress, isKYCVerified, loading,
  } = usePortfolio();

  const [time,          setTime]          = useState(new Date());
  const [walletBal,     setWalletBal]     = useState(null);
  const [platformStats, setPlatformStats] = useState(null);
  const [myTrades,      setMyTrades]      = useState([]);
  const [emissionsData, setEmissionsData] = useState(null);
  const [statsLoading,  setStatsLoading]  = useState(true);

  // Spark data per listing (generated once)
  const [sparks] = useState(() =>
    Array.from({ length: 20 }, () =>
      Array.from({ length: 20 }, (_, i) => 50 + Math.sin(i * 0.6) * 15 + Math.random() * 8)
    )
  );

  const tickerRef = useRef(null);
  const tickerX   = useRef(0);

  const displayName = dbUser?.full_name || user?.displayName || user?.email?.split('@')[0] || 'Trader';
  const firstName   = displayName.split(' ')[0];
  const hour        = new Date().getHours();
  const greeting    = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  // Clock
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Wallet balance
  useEffect(() => {
    const fetchBal = async () => {
      if (!window.ethereum) return;
      try {
        const { ethers } = await import('ethers');
        const provider   = new ethers.BrowserProvider(window.ethereum);
        const accounts   = await provider.listAccounts();
        if (!accounts.length) return;
        const bal = await provider.getBalance(accounts[0]);
        setWalletBal(parseFloat(ethers.formatEther(bal)).toFixed(4));
      } catch {}
    };
    fetchBal();
  }, [walletAddress]);

  // Platform stats + my trades + emissions — all from backend
  useEffect(() => {
    const fetchAll = async () => {
      setStatsLoading(true);
      await Promise.allSettled([
        // Platform stats
        txAPI.getStats()
          .then(d => setPlatformStats(d))
          .catch(() => {}),

        // My recent trades
        txAPI.getMy()
          .then(d => setMyTrades((d.transactions || []).slice(0, 4)))
          .catch(() => {}),

        // My emissions
        apiFetch('/api/emissions/my')
          .then(d => setEmissionsData(d))
          .catch(() => {}),
      ]);
      setStatsLoading(false);
    };
    fetchAll();
  }, []);

  // Ticker animation
  useEffect(() => {
    const el = tickerRef.current;
    if (!el) return;
    let rafId;
    const animate = () => {
      tickerX.current -= 0.4;
      const half = el.scrollWidth / 2;
      if (Math.abs(tickerX.current) >= half) tickerX.current = 0;
      el.style.transform = `translateX(${tickerX.current}px)`;
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [listings]);

  // ── Derived values ─────────────────────────────────────────────
  const totalCreditsOwned   = stats?.totalCredits || 0;
  const totalPortfolioValue = stats?.totalValue   || 0;
  const totalRetiredCount   = stats?.retiredCount || 0;

  const platformTrades  = platformStats?.totalTrades   || 0;
  const platformRetired = platformStats?.totalRetired  || totalRetiredCount;
  const platformVolume  = platformStats?.totalVolumeINR|| 0;

  // Emissions: use real data if available
  const totalEmitted   = emissionsData?.totalEmitted || 0;
  const emissionOffset = totalEmitted > 0 && platformRetired > 0
    ? Math.min(Math.round((platformRetired / totalEmitted) * 100), 100)
    : 0;

  // Portfolio breakdown from real credits
  const portfolioBreakdown = myCredits
    .filter(c => c.status !== 'RETIRED')
    .slice(0, 4)
    .map((c, i) => {
      const colors = ['#22c55e','#4ade80','#facc15','#a78bfa'];
      const totalC = myCredits.filter(x => x.status !== 'RETIRED').reduce((s, x) => s + x.credits, 0) || 1;
      return {
        name:    c.projectName,
        std:     c.standard,
        credits: c.credits,
        color:   colors[i % colors.length],
        pct:     +((c.credits / totalC) * 100).toFixed(1),
      };
    });

  // Ticker items — only real listings, duplicated for scroll
  const tickerItems = listings.length > 0
    ? [...listings, ...listings, ...listings]
    : [];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;}
        .d{min-height:100vh;background:#060a07;font-family:'DM Mono',monospace;position:relative;overflow-x:hidden;}
        .d::before{content:'';position:fixed;inset:0;z-index:0;background-image:linear-gradient(rgba(34,197,94,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,.04) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;}
        .d::after{content:'';position:fixed;top:-200px;left:50%;transform:translateX(-50%);width:900px;height:450px;background:radial-gradient(ellipse,rgba(34,197,94,.05) 0%,transparent 70%);pointer-events:none;z-index:0;}
        .dw{position:relative;z-index:1;max-width:1280px;margin:0 auto;padding:24px 24px 60px;}
        .ticker-wrap{overflow:hidden;background:#0a0f0c;border:1px solid #0f2a1a;border-radius:8px;margin-bottom:24px;height:36px;display:flex;align-items:center;}
        .ticker-live{padding:0 14px;font-size:9px;color:#22c55e;letter-spacing:.12em;border-right:1px solid #0f2a1a;height:100%;display:flex;align-items:center;gap:5px;flex-shrink:0;}
        .ticker-track{display:flex;gap:40px;white-space:nowrap;will-change:transform;}
        .ticker-item{display:flex;align-items:center;gap:8px;font-size:11px;}
        .topbar{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;gap:16px;animation:fu .5s ease both;}
        .greeting{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#f0fdf4;line-height:1.2;margin-bottom:4px;}
        .greeting span{color:#22c55e;}
        .sub{font-size:10px;color:#86efacaa;letter-spacing:.1em;}
        .clock-val{font-family:'Syne',sans-serif;font-size:26px;font-weight:700;color:#22c55e;letter-spacing:.04em;text-align:right;}
        .clock-date{font-size:9px;color:#86efacaa;letter-spacing:.1em;text-align:right;margin-top:3px;}
        .kyc-banner{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-radius:10px;margin-bottom:20px;border:1px solid #facc1533;background:#1a150033;animation:fu .5s ease .05s both;gap:12px;}
        .kyc-btn{padding:7px 16px;border-radius:5px;border:none;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.1em;background:#facc15;color:#080c0a;flex-shrink:0;}
        .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px;}
        .c3{grid-column:span 3;}.c4{grid-column:span 4;}.c6{grid-column:span 6;}.c8{grid-column:span 8;}.c12{grid-column:span 12;}
        .card{background:#0a0f0c;border:1px solid #0f2a1a;border-radius:12px;padding:18px;position:relative;overflow:hidden;transition:border-color .2s;animation:fu .45s ease both;}
        .card:hover{border-color:#22c55e22;}
        .card-accent{position:absolute;top:0;left:0;right:0;height:2px;border-radius:12px 12px 0 0;}
        .clabel{font-size:9px;letter-spacing:.14em;margin-bottom:10px;color:#86efac99;display:flex;align-items:center;justify-content:space-between;}
        .cval{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;line-height:1;}
        .csub{font-size:10px;color:#86efaccc;margin-top:4px;letter-spacing:.05em;}
        .cchg{font-size:10px;margin-top:7px;}
        .mrow{display:grid;grid-template-columns:2fr 60px 90px 80px 80px;gap:8px;padding:10px 0;border-bottom:1px solid #0f2a1a14;align-items:center;cursor:pointer;border-radius:4px;transition:all .15s;}
        .mrow:hover{background:#0f1a1222;padding-left:6px;}
        .mrow:last-child{border-bottom:none;}
        .actions-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}
        .action-btn{padding:14px 8px;border-radius:8px;border:1px solid #0f2a1a;background:transparent;cursor:pointer;text-align:center;transition:all .2s;font-family:'DM Mono',monospace;}
        .action-btn:hover{transform:translateY(-2px);border-color:#22c55e22;}
        .action-icon{font-size:20px;margin-bottom:5px;}
        .action-label{font-size:9px;letter-spacing:.1em;}
        .news-item{display:flex;gap:10px;padding:11px 0;border-bottom:1px solid #0f2a1a14;cursor:pointer;border-radius:4px;transition:all .15s;}
        .news-item:hover{background:#0f1a1211;padding-left:6px;}
        .news-item:last-child{border-bottom:none;}
        .news-tag{font-size:8px;padding:2px 7px;border-radius:3px;letter-spacing:.1em;white-space:nowrap;flex-shrink:0;align-self:flex-start;margin-top:2px;}
        .news-title{font-size:11px;color:#f0fdf4;line-height:1.5;}
        .news-time{font-size:9px;color:#86efacaa;margin-top:3px;}
        .vol-bar{height:3px;background:#0f2a1a;border-radius:2px;overflow:hidden;margin-top:4px;}
        .vol-fill{height:100%;border-radius:2px;transition:width .8s ease;}
        .net-row{display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #0f2a1a14;font-size:11px;}
        .net-row:last-child{border-bottom:none;}
        .ldot{display:inline-block;width:5px;height:5px;border-radius:50%;background:#22c55e;margin-right:5px;animation:lp 1.5s infinite;}
        .trade-row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #0f2a1a14;}
        .trade-row:last-child{border-bottom:none;}
        .btn-ghost{width:100%;padding:9px;border-radius:6px;border:1px solid #22c55e22;background:transparent;color:#22c55e66;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;transition:all .2s;margin-top:10px;}
        .btn-ghost:hover{border-color:#22c55e55;color:#22c55e;background:#0d2e1f22;}
        .live-badge{font-size:9px;color:#22c55e;display:flex;align-items:center;gap:4px;}
        .shimmer{background:linear-gradient(90deg,#0f2a1a 25%,#0d2e1f 50%,#0f2a1a 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:4px;}
        @keyframes fu{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
        @keyframes lp{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(34,197,94,.4);}50%{opacity:.6;box-shadow:0 0 0 4px rgba(34,197,94,0);}}
        @keyframes shimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
        @media(max-width:1024px){.c3{grid-column:span 6;}.c4{grid-column:span 6;}.c8{grid-column:span 12;}}
        @media(max-width:640px){.c3,.c4,.c6,.c8{grid-column:span 12;}.greeting{font-size:20px;}.actions-grid{grid-template-columns:repeat(2,1fr);}}
      `}</style>

      <div className="d">
        <div className="dw">

          {/* Ticker — only shows when real listings exist */}
          <div className="ticker-wrap">
            <div className="ticker-live"><span className="ldot"/>LIVE</div>
            <div style={{ overflow:'hidden', flex:1 }}>
              {tickerItems.length > 0 ? (
                <div className="ticker-track" ref={tickerRef}>
                  {tickerItems.map((c, i) => (
                    <div key={i} className="ticker-item">
                      <span style={{ color:'#86efaccc' }}>{c.serialNumber?.slice(0,12) || c.standard}</span>
                      <span style={{ color:'#22c55e', fontWeight:700 }}>
                        ₹{Math.round((c.adjPrice||0) * 280000).toLocaleString('en-IN')}
                      </span>
                      {c.vintageDiscount > 0 && (
                        <span style={{ color:'#facc15' }}>-{c.vintageDiscount}% vtg</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding:'0 16px', fontSize:10, color:'#86efac33', letterSpacing:'.1em' }}>
                  NO ACTIVE LISTINGS — BE THE FIRST TO LIST CARBON CREDITS
                </div>
              )}
            </div>
          </div>

          {/* Topbar */}
          <div className="topbar">
            <div>
              <div className="greeting">{greeting}, <span>{firstName}</span> 👋</div>
              <div className="sub">
                {(kycCompleted || isKYCVerified) ? '✅ KYC VERIFIED · FULL ACCESS' : '⚠️ COMPLETE KYC TO UNLOCK TRADING'}
                {' · '}ETHERTRACK CARBON EXCHANGE
              </div>
            </div>
            <div>
              <div className="clock-val">{time.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})}</div>
              <div className="clock-date">{time.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}).toUpperCase()}</div>
            </div>
          </div>

          {/* KYC Banner */}
          {!(kycCompleted || isKYCVerified) && (
            <div className="kyc-banner">
              <div>
                <div style={{ fontSize:12,color:'#facc15',fontWeight:700,marginBottom:2 }}>⚠️ KYC Verification Required</div>
                <div style={{ fontSize:10,color:'#facc1566',letterSpacing:'.06em' }}>Complete KYC to access trading, portfolio management and emission tracking.</div>
              </div>
              <button className="kyc-btn" onClick={() => navigate('/kyc')}>VERIFY NOW →</button>
            </div>
          )}

          <div className="grid">

            {/* Stat 1 — Portfolio Value */}
            <div className="card c3">
              <div className="card-accent" style={{ background:'linear-gradient(90deg,#16a34a,#22c55e)' }}/>
              <div className="clabel">PORTFOLIO VALUE</div>
              <div className="cval" style={{ color:'#22c55e' }}>
                {loading.credits ? <span className="shimmer" style={{ display:'block',height:32,width:100 }}/> : `₹${(totalPortfolioValue/100000).toFixed(1)}L`}
              </div>
              <div className="csub">{loading.credits ? '—' : `${totalCreditsOwned.toLocaleString()} tCO₂ held`}</div>
              <div className="cchg" style={{ color:'#22c55e33',fontSize:9 }}>Live from blockchain</div>
            </div>

            {/* Stat 2 — Wallet Balance */}
            <div className="card c3">
              <div className="card-accent" style={{ background:'linear-gradient(90deg,#60a5fa,#818cf8)' }}/>
              <div className="clabel">WALLET BALANCE</div>
              <div className="cval" style={{ color:'#60a5fa' }}>
                {walletBal || '—'} <span style={{ fontSize:13,color:'#60a5fa66' }}>{walletBal ? 'ETH' : ''}</span>
              </div>
              <div className="csub">{walletBal ? `≈ ${fmt(Math.round(walletBal * 280000))}` : 'Connect wallet to view'}</div>
              <div className="cchg" style={{ color:'#60a5fa33',fontSize:9 }}>1 ETH = ₹2,80,000</div>
            </div>

            {/* Stat 3 — Platform Trades */}
            <div className="card c3">
              <div className="card-accent" style={{ background:'linear-gradient(90deg,#a78bfa,#c084fc)' }}/>
              <div className="clabel">PLATFORM TRADES</div>
              <div className="cval" style={{ color:'#a78bfa' }}>
                {statsLoading ? <span className="shimmer" style={{ display:'block',height:32,width:80 }}/> : platformTrades.toLocaleString()}
              </div>
              <div className="csub">total on-chain trades</div>
              <div className="cchg" style={{ color:'#a78bfa33',fontSize:9 }}>
                {platformVolume > 0 ? `₹${(platformVolume/100000).toFixed(1)}L total volume` : 'No trades yet'}
              </div>
            </div>

            {/* Stat 4 — Total Retired */}
            <div className="card c3">
              <div className="card-accent" style={{ background:'linear-gradient(90deg,#f97316,#fb923c)' }}/>
              <div className="clabel">TOTAL OFFSET</div>
              <div className="cval" style={{ color:'#f97316' }}>
                {statsLoading ? <span className="shimmer" style={{ display:'block',height:32,width:80 }}/> : platformRetired.toLocaleString()}
              </div>
              <div className="csub">tCO₂ permanently retired</div>
              <div className="cchg" style={{ color:'#f9731633',fontSize:9 }}>
                {platformRetired > 0 ? 'Blockchain verified' : 'None retired yet'}
              </div>
            </div>

            {/* Market Overview — real listings only */}
            <div className="card c8">
              <div className="clabel">
                {listings.length > 0 ? `LIVE MARKET — ${listings.length} ON-CHAIN LISTINGS` : 'MARKET'}
                <span className="live-badge"><span className="ldot"/>LIVE</span>
              </div>
              {listings.length > 0 ? (
                <>
                  <div style={{ display:'grid',gridTemplateColumns:'2fr 60px 90px 80px 80px',gap:8,padding:'0 0 8px',borderBottom:'1px solid #0f2a1a',fontSize:9,color:'#86efac99',letterSpacing:'.12em' }}>
                    <span>PROJECT</span><span>STD</span><span>PRICE (₹)</span><span>VINTAGE</span><span>TREND</span>
                  </div>
                  {listings.slice(0, 4).map((c, i) => {
                    const priceINR = Math.round((c.adjPrice || 0) * 280000);
                    const reg = { VCS:'#22c55e', GS:'#facc15', CDM:'#60a5fa', ACR:'#a78bfa' }[c.standard] || '#22c55e';
                    return (
                      <div key={i} className="mrow" onClick={() => navigate('/carbon-credits')}>
                        <div>
                          <div style={{ fontSize:12,color:'#f0fdf4',fontWeight:600,marginBottom:2 }}>{c.projectName}</div>
                          <div style={{ fontSize:9,color:'#86efac99' }}>{c.serialNumber}</div>
                        </div>
                        <span style={{ fontSize:9,padding:'2px 6px',borderRadius:3,background:`${reg}22`,color:reg,border:`1px solid ${reg}33` }}>{c.standard}</span>
                        <span style={{ fontSize:13,fontWeight:700,color:'#22c55e' }}>₹{priceINR.toLocaleString('en-IN')}</span>
                        <span style={{ fontSize:10,color:'#86efac66' }}>{c.vintageYear || '—'}</span>
                        <Spark data={sparks[i]} color="#22c55e"/>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div style={{ textAlign:'center',padding:'32px 0',color:'#86efac22',fontSize:11 }}>
                  <div style={{ fontSize:32,marginBottom:8 }}>🌿</div>
                  No listings on market yet. Tokenize and list credits to see them here.
                </div>
              )}
              <button className="btn-ghost" onClick={() => navigate('/carbon-credits')}>
                {listings.length > 0 ? `VIEW ALL ${listings.length} LISTINGS →` : 'GO TO MARKET →'}
              </button>
            </div>

            {/* Quick Actions */}
            <div className="card c4">
              <div className="clabel">QUICK ACTIONS</div>
              <div className="actions-grid">
                {QUICK_ACTIONS.map(({ icon, label, path, color, bg }) => (
                  <button key={label} className="action-btn" style={{ background:bg }} onClick={() => navigate(path)}>
                    <div className="action-icon">{icon}</div>
                    <div className="action-label" style={{ color }}>{label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Emission Offset */}
            <div className="card c4">
              <div className="clabel">EMISSION OFFSET PROGRESS</div>
              <div style={{ display:'flex',flexDirection:'column',alignItems:'center',padding:'4px 0' }}>
                <EmissionArc pct={emissionOffset}/>
                <div style={{ marginTop:-4,textAlign:'center' }}>
                  <div style={{ fontFamily:'Syne,sans-serif',fontSize:30,fontWeight:800,color:'#22c55e',lineHeight:1 }}>
                    {emissionOffset}%
                  </div>
                  <div style={{ fontSize:10,color:'#86efac55',marginTop:3,letterSpacing:'.08em' }}>
                    {totalEmitted > 0 ? 'OF LOGGED EMISSIONS' : 'LOG EMISSIONS TO TRACK'}
                  </div>
                </div>
              </div>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginTop:10 }}>
                {[
                  { l:'EMITTED', v: totalEmitted > 0 ? `${totalEmitted} tCO₂` : '—',          c:'#f87171' },
                  { l:'OFFSET',  v: platformRetired > 0 ? `${platformRetired} tCO₂` : '—',    c:'#22c55e' },
                  { l:'NET',     v: totalEmitted > 0 ? `${Math.max(0,totalEmitted-platformRetired)} tCO₂` : '—', c:'#facc15' },
                  { l:'CREDITS', v: `${totalRetiredCount} burned`,                             c:'#60a5fa' },
                ].map(({ l, v, c }) => (
                  <div key={l} style={{ background:'#060a07',borderRadius:6,padding:'8px 10px' }}>
                    <div style={{ fontSize:8,color:'#86efac88',letterSpacing:'.1em',marginBottom:3 }}>{l}</div>
                    <div style={{ fontSize:12,fontWeight:700,color:c }}>{v}</div>
                  </div>
                ))}
              </div>
              <button className="btn-ghost" onClick={() => navigate('/emission-tracking')}>LOG EMISSIONS →</button>
            </div>

            {/* Portfolio Breakdown */}
            <div className="card c4">
              <div className="clabel">
                PORTFOLIO BREAKDOWN
                <span className="live-badge" style={{ fontSize:9,color:'#22c55e44' }}>LIVE</span>
              </div>
              {portfolioBreakdown.length > 0 ? portfolioBreakdown.map(({ name, std, credits, color, pct }) => (
                <div key={name} style={{ marginBottom:10 }}>
                  <div style={{ display:'flex',justifyContent:'space-between',marginBottom:4 }}>
                    <div>
                      <div style={{ fontSize:10,color:'#f0fdf4' }}>{name}</div>
                      <div style={{ fontSize:8,color:'#86efac99',letterSpacing:'.06em' }}>{std} · {credits.toLocaleString()} tCO₂</div>
                    </div>
                    <div style={{ fontSize:11,color,fontWeight:700 }}>{pct}%</div>
                  </div>
                  <div className="vol-bar"><div className="vol-fill" style={{ width:`${pct}%`,background:color }}/></div>
                </div>
              )) : (
                <div style={{ textAlign:'center',padding:'24px 0',color:'#86efac22',fontSize:11,lineHeight:1.8 }}>
                  No approved credits yet.<br/>Submit credits for admin verification.
                </div>
              )}
              <button className="btn-ghost" onClick={() => navigate('/portfolio')}>VIEW FULL PORTFOLIO →</button>
            </div>

            {/* Network Status */}
            <div className="card c4">
              <div className="clabel">NETWORK STATUS</div>
              {[
                { label:'BLOCKCHAIN',     value:'Ethereum Sepolia',                                        status:'ONLINE', color:'#22c55e' },
                { label:'SMART CONTRACT', value:'Marketplace.sol',                                         status:'ACTIVE', color:'#22c55e' },
                { label:'BACKEND API',    value: !statsLoading ? 'Connected' : 'Connecting...',            status: !statsLoading ? 'ONLINE' : 'SYNC', color: !statsLoading ? '#22c55e' : '#facc15' },
                { label:'PLATFORM FEE',   value:'0.5% per trade',                                          status:'FIXED',  color:'#facc15' },
                { label:'MARKET TYPE',    value:'Voluntary Carbon',                                        status:'LIVE',   color:'#60a5fa' },
                { label:'CCTS STATUS',    value:'Integration Ready',                                       status:'BETA',   color:'#a78bfa' },
              ].map(({ label, value, status, color }) => (
                <div key={label} className="net-row">
                  <div>
                    <div style={{ fontSize:9,color:'#86efac99',letterSpacing:'.1em',marginBottom:2 }}>{label}</div>
                    <div style={{ fontSize:11,color:'#f0fdf4' }}>{value}</div>
                  </div>
                  <span style={{ fontSize:9,padding:'2px 8px',borderRadius:3,letterSpacing:'.06em',background:`${color}18`,color,border:`1px solid ${color}33` }}>
                    {['ONLINE','ACTIVE','LIVE'].includes(status) && <span className="ldot" style={{ width:4,height:4,background:color }}/>}
                    {status}
                  </span>
                </div>
              ))}
            </div>

            {/* News Feed */}
            <div className="card c8">
              <div className="clabel">CARBON MARKET NEWS <span style={{ fontSize:9,color:'#86efac44' }}>CURATED</span></div>
              {NEWS_FEED.map(n => {
                const TC = {MARKET:{bg:'#0d2e1f',c:'#22c55e'},POLICY:{bg:'#1a1500',c:'#facc15'},TECHNOLOGY:{bg:'#0a1628',c:'#60a5fa'},GLOBAL:{bg:'#120a28',c:'#a78bfa'}};
                const tc = TC[n.tag] || TC.MARKET;
                return (
                  <div key={n.id} className="news-item">
                    <span className="news-tag" style={{ background:tc.bg,color:tc.c,border:`1px solid ${tc.c}33` }}>{n.tag}</span>
                    <div style={{ flex:1 }}>
                      <div className="news-title">{n.hot && <span style={{ color:'#f97316',marginRight:5 }}>🔥</span>}{n.title}</div>
                      <div className="news-time">{n.time}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Recent Trades — real from backend */}
            <div className="card c4">
              <div className="clabel">
                RECENT TRADES
                <span style={{ cursor:'pointer',color:'#22c55e44',fontSize:9 }} onClick={() => navigate('/trading-history')}>ALL →</span>
              </div>
              {myTrades.length > 0 ? myTrades.map((t, i) => {
                const isBuy = t.tx_type === 'buy';
                const valueINR = t.total_price_inr || 0;
                return (
                  <div key={i} className="trade-row">
                    <div style={{ display:'flex',alignItems:'center',gap:10 }}>
                      <div style={{ width:28,height:28,borderRadius:6,background:isBuy?'#0d2e1f':'#450a0a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:isBuy?'#22c55e':'#f87171',fontWeight:700 }}>
                        {isBuy ? '↓' : '↑'}
                      </div>
                      <div>
                        <div style={{ fontSize:11,color:'#f0fdf4' }}>{t.project_name || t.tx_type?.toUpperCase()}</div>
                        <div style={{ fontSize:9,color:'#86efac99' }}>
                          {t.quantity} credits · {new Date(t.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontSize:12,fontWeight:700,color:isBuy?'#f87171':'#22c55e' }}>
                        {isBuy ? '-' : '+'}{fmt(valueINR)}
                      </div>
                      <div style={{ fontSize:9,color:'#86efac33',padding:'2px 6px',borderRadius:3,background:'#0d2e1f' }}>
                        {t.standard || '—'}
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div style={{ textAlign:'center',padding:'24px 0',color:'#86efac22',fontSize:11,lineHeight:1.8 }}>
                  {statsLoading ? 'Loading trades...' : 'No trades yet.\nBuy or sell credits to see history.'}
                </div>
              )}
              <button className="btn-ghost" onClick={() => navigate('/trading-history')}>FULL HISTORY →</button>
            </div>

          </div>

          <div style={{ marginTop:32,paddingTop:20,borderTop:'1px solid #0f2a1a',display:'flex',justifyContent:'space-between',fontSize:9,color:'#86efaccc',letterSpacing:'.1em' }}>
            <span>ETHERTRACK © 2026 — INDIA'S CARBON CREDIT EXCHANGE</span>
            <span>ETHEREUM · VOLUNTARY MARKET · CCTS-READY</span>
          </div>
        </div>
      </div>
    </>
  );
}