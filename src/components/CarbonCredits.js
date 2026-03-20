import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';
import { usePortfolio } from '../context/PortfolioContext';
import { walletAPI } from '../services/api';

const PLATFORM_FEE = 0.005;
const ETH_INR      = 280000;

const STANDARDS   = { VCS:{color:'#22c55e',bg:'#0d2e1f'}, GS:{color:'#facc15',bg:'#1a1500'}, CDM:{color:'#60a5fa',bg:'#0a1628'}, ACR:{color:'#a78bfa',bg:'#120a28'} };
const TYPE_COLORS = { Renewable:{bg:'#0d2e1f',text:'#22c55e',dot:'#16a34a'}, Forestry:{bg:'#0f2a1a',text:'#4ade80',dot:'#15803d'}, Industrial:{bg:'#1a1a0f',text:'#facc15',dot:'#ca8a04'}, Social:{bg:'#120a28',text:'#a78bfa',dot:'#7c3aed'} };

const fmt    = n   => `₹${Number(n).toLocaleString('en-IN')}`;
const fmtEth = inr => `${(inr/ETH_INR).toFixed(6)} ETH`;

function MiniChart({ data, color = '#22c55e', width = 120, height = 36 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`).join(' ');
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`g${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={pts} opacity="0.9"/>
      <polygon fill={`url(#g${color.replace('#','')})`} points={`0,${height} ${pts} ${width},${height}`}/>
    </svg>
  );
}

function DepthBar({ qty, max, color, align = 'left' }) {
  const pct = Math.min((qty / max) * 100, 100);
  return (
    <div style={{ width: '100%', height: 3, background: '#0f2a1a', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, opacity: 0.5, borderRadius: 2, float: align === 'right' ? 'right' : 'left' }}/>
    </div>
  );
}

function Skeleton({ w = '100%', h = 14, mb = 8 }) {
  return <div style={{ width: w, height: h, background: '#0f2a1a55', borderRadius: 4, marginBottom: mb, animation: 'pulse 1.5s ease infinite' }}/>;
}

function Badge({ label, color, bg, border }) {
  return <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, background: bg, color, border: `1px solid ${border||color}33`, letterSpacing: '.06em' }}>{label}</span>;
}

function buildPriceHistory(tradeHistory, tokenId, basePrice) {
  const relevant = tradeHistory.filter(t => t.tokenId === tokenId).slice(0, 30).reverse();
  if (relevant.length > 2) {
    return relevant.map(t => parseFloat(t.totalEth) / (t.amount || 1) * ETH_INR);
  }
  const points = [];
  let p = basePrice * 0.95;
  for (let i = 0; i < 24; i++) {
    p = p + (Math.random() - 0.48) * basePrice * 0.02;
    points.push(Math.max(p, basePrice * 0.8));
  }
  points.push(basePrice);
  return points;
}

export default function CarbonCredits() {
  const navigate  = useNavigate();
  const { addNotification, NOTIF_TYPES } = useNotifications();
  const {
    listings, loadListings,
    buyOrders, loadBuyOrders,
    buyCredit, placeBuyOrder, cancelBuyOrder,
    ammPools, loadAMMPools, ammSwapETHForCredits, ammSwapCreditsForETH,
    isKYCVerified, walletAddress, loading, tradeHistory, contracts, ETH_INR_RATE,
  } = usePortfolio();

  const [tab,          setTab]          = useState('market');
  const [selected,     setSelected]     = useState(null);
  const [orderMode,    setOrderMode]    = useState('market');
  const [qty,          setQty]          = useState('');
  const [limitPrice,   setLimitPrice]   = useState('');
  const [bidPrice,     setBidPrice]     = useState('');
  const [bidQty,       setBidQty]       = useState('');
  const [bidDays,      setBidDays]      = useState('7');
  const [filterStd,    setFilterStd]    = useState('ALL');
  const [filterType,   setFilterType]   = useState('ALL');
  const [sortBy,       setSortBy]       = useState('price');
  const [alertPrice,   setAlertPrice]   = useState('');
  const [alertType,    setAlertType]    = useState('below');
  const [alerts,       setAlerts]       = useState([]);
  const [confirmModal, setConfirmModal] = useState(null);
  const [toast,        setToast]        = useState({ msg: '', type: 'success' });
  const [txPending,    setTxPending]    = useState(false);
  const [ammModal,     setAmmModal]     = useState(null);
  const [ammQty,       setAmmQty]       = useState('');
  const [ammDir,       setAmmDir]       = useState('buy');
  const [myOpenBids,   setMyOpenBids]   = useState([]);
  const [priceHistories, setPriceHistories] = useState({});
  const [watchlist,    setWatchlist]    = useState([]);
  const [analyticsToken, setAnalyticsToken] = useState(null);

  // ── INR wallet state ──────────────────────────────────────────
  const [paymentMode,  setPaymentMode]  = useState('eth');   // 'eth' | 'inr'
  const [inrBalance,   setInrBalance]   = useState(0);
  const [inrLoading,   setInrLoading]   = useState(false);

  const tickerRef = useRef(null);

  // Fetch INR balance on mount
  useEffect(() => {
    const fetchINRBalance = async () => {
      setInrLoading(true);
      try {
        const data = await walletAPI.getBalance();
        if (data?.balance !== undefined) setInrBalance(parseFloat(data.balance));
      } catch {}
      finally { setInrLoading(false); }
    };
    fetchINRBalance();
  }, []);

  // Refresh INR balance after successful trade
  const refreshINRBalance = async () => {
    try {
      const data = await walletAPI.getBalance();
      if (data?.balance !== undefined) setInrBalance(parseFloat(data.balance));
    } catch {}
  };

  useEffect(() => {
    if (!listings.length) return;
    const h = {};
    listings.forEach(l => {
      h[l.tokenId] = buildPriceHistory(tradeHistory, l.tokenId, l.adjPrice * ETH_INR);
    });
    setPriceHistories(h);
  }, [listings.length, tradeHistory.length]);

  useEffect(() => {
    if (!selected && listings.length) {
      setSelected(listings[0]);
      setAnalyticsToken(listings[0]);
    }
  }, [listings]);

  useEffect(() => {
    if (!walletAddress || !buyOrders.length) { setMyOpenBids([]); return; }
    setMyOpenBids(buyOrders.filter(o => o.buyer?.toLowerCase() === walletAddress.toLowerCase() && (o.status === 0 || o.status === 2)));
  }, [buyOrders, walletAddress]);

  useEffect(() => {
    if (!alerts.length || !listings.length) return;
    alerts.forEach(a => {
      const listing = listings.find(l => l.listingId === a.listingId);
      if (!listing) return;
      const price = listing.adjPrice * ETH_INR;
      const triggered = a.type === 'below' ? price <= a.targetPrice : price >= a.targetPrice;
      if (triggered && !a.triggered) {
        showToast(`🔔 ALERT: ${a.projectName} is now ${fmt(price.toFixed(0))}`, 'info');
        setAlerts(prev => prev.map(x => x.id === a.id ? { ...x, triggered: true } : x));
      }
    });
  }, [listings, alerts]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg: '', type: 'success' }), 4500);
  };

  const toggleWatchlist = (listingId) => {
    setWatchlist(prev => prev.includes(listingId) ? prev.filter(x => x !== listingId) : [...prev, listingId]);
  };

  const filtered = listings
    .filter(l => filterStd === 'ALL' || l.standard === filterStd)
    .filter(l => filterType === 'ALL' || l.projectType === filterType)
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
    .map(l => ({ price: l.adjPrice, priceInr: l.adjPrice * ETH_INR, amount: l.amount, seller: l.seller, listingId: l.listingId, projectName: l.projectName, tokenId: l.tokenId }))
    .sort((a, b) => a.price - b.price);

  const allBids = buyOrders
    .filter(o => o.status === 0 || o.status === 2)
    .map(o => ({ price: o.limitPrice, priceInr: o.limitPrice * ETH_INR, amount: o.remaining, buyer: o.buyer, orderId: o.orderId, tokenId: o.tokenId }))
    .sort((a, b) => b.price - a.price);

  const selectedAsks = selected ? listings.filter(l => l.tokenId === selected.tokenId).sort((a, b) => a.adjPrice - b.adjPrice) : [];
  const selectedBids = selected ? buyOrders.filter(o => o.tokenId === selected.tokenId && (o.status === 0 || o.status === 2)).sort((a, b) => b.limitPrice - a.limitPrice) : [];
  const maxDepth     = Math.max(...selectedAsks.map(a => a.amount), ...selectedBids.map(b => b.remaining), 1);

  const currentPriceInr = selected ? selected.adjPrice * ETH_INR : 0;
  const spread = selectedAsks.length && selectedBids.length
    ? ((selectedAsks[0].adjPrice - selectedBids[0].limitPrice) * ETH_INR).toFixed(0)
    : '—';

  const tradePrice    = orderMode === 'limit' && limitPrice ? parseFloat(limitPrice) / ETH_INR : (selected?.adjPrice || 0);
  const tradeTotalInr = qty ? parseFloat(qty) * tradePrice * ETH_INR : 0;
  const tradeFeeInr   = tradeTotalInr * PLATFORM_FEE;
  const tradeNetInr   = tradeTotalInr + tradeFeeInr;
  const tradeNetEth   = tradeNetInr / ETH_INR;

  const bidTotalEth  = bidQty && bidPrice ? parseFloat(bidQty) * (parseFloat(bidPrice) / ETH_INR) : 0;
  const bidFeeEth    = bidTotalEth * PLATFORM_FEE;
  const bidEscrowEth = bidTotalEth + bidFeeEth;

  const totalAvailable  = listings.reduce((s, l) => s + l.amount, 0);
  const totalVolume     = listings.reduce((s, l) => s + l.amount * l.adjPrice * ETH_INR, 0);
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
  const dailyVolume  = dailyTrades.reduce((s, t) => s + (t.amount || 0), 0);
  const avgTradePrice = tradeHistory.length
    ? tradeHistory.reduce((s, t) => {
        const pricePerCredit = t.amount > 0 ? (parseFloat(t.totalEth || 0) / t.amount) * ETH_INR : 0;
        return s + pricePerCredit;
      }, 0) / tradeHistory.length
    : listings.length
      ? listings.reduce((s, l) => s + l.adjPrice * ETH_INR, 0) / listings.length
      : 0;

  const analyticsListing  = analyticsToken || selected;
  const analyticsHistory  = analyticsListing ? (priceHistories[analyticsListing.tokenId] || []) : [];
  const analyticsAsks     = analyticsListing ? listings.filter(l => l.tokenId === analyticsListing.tokenId) : [];
  const analyticsBids     = analyticsListing ? buyOrders.filter(o => o.tokenId === analyticsListing.tokenId && (o.status === 0 || o.status === 2)) : [];
  const analyticsHigh     = analyticsHistory.length ? Math.max(...analyticsHistory) : 0;
  const analyticsLow      = analyticsHistory.length ? Math.min(...analyticsHistory) : 0;
  const analyticsChange   = analyticsHistory.length > 1 ? ((analyticsHistory[analyticsHistory.length-1] - analyticsHistory[0]) / analyticsHistory[0] * 100).toFixed(2) : 0;

  // ── Handlers ──────────────────────────────────────────────────

  const handlePlaceOrder = () => {
    if (!isKYCVerified)                     { showToast('❌ Complete KYC first', 'error'); return; }
    if (paymentMode === 'eth' && !walletAddress) { showToast('❌ Connect MetaMask', 'error'); return; }
    if (paymentMode === 'inr' && inrBalance < tradeNetInr) { showToast('❌ Insufficient INR balance', 'error'); return; }
    if (!qty || isNaN(qty) || +qty <= 0)    { showToast('❌ Enter valid quantity', 'error'); return; }
    if (!selected)                          { showToast('❌ Select a credit', 'error'); return; }
    if (selected.seller?.toLowerCase() === walletAddress?.toLowerCase()) { showToast('❌ Cannot buy your own listing', 'error'); return; }
    if (+qty > selected.amount)             { showToast(`❌ Max available: ${selected.amount}`, 'error'); return; }
    if (orderMode === 'limit' && (!limitPrice || isNaN(limitPrice))) { showToast('❌ Enter limit price', 'error'); return; }
    setConfirmModal({ type: 'buy', listing: selected, qty: +qty, orderMode, tradePrice, tradeTotalInr, tradeFeeInr, tradeNetInr, tradeNetEth, paymentMode });
  };

  // ── Updated handleConfirmBuy — supports INR + ETH ─────────────
  const handleConfirmBuy = async () => {
    const o = confirmModal;
    setConfirmModal(null);
    setTxPending(true);

    try {
      if (o.paymentMode === 'inr') {
        // ── INR WALLET PATH ──────────────────────────────────────
        showToast('⏳ Deducting from INR wallet...', 'info');

        const payResult = await walletAPI.tradeDeduct({
          amount:      Math.round(o.tradeNetInr),
          listingId:   o.listing.listingId,
          tokenId:     o.listing.tokenId,
          quantity:    o.qty,
          projectName: o.listing.projectName,
          standard:    o.listing.standard,
        });

        if (!payResult?.success) throw new Error('INR payment failed');
        setInrBalance(parseFloat(payResult.balance));

        // MetaMask still needed for on-chain credit transfer
        showToast('✅ INR paid — Confirm credit transfer in MetaMask...', 'info');
        const r = await buyCredit(o.listing.listingId, o.qty, o.tradeNetEth.toFixed(8));

        addNotification({
          type:    NOTIF_TYPES.TRADE,
          title:   'Buy Executed ✅',
          message: `${o.qty} × ${o.listing.projectName} — ₹${Math.round(o.tradeNetInr).toLocaleString('en-IN')} from INR wallet`,
        });
        showToast(`✅ ${o.qty} credits purchased! ₹${Math.round(o.tradeNetInr).toLocaleString('en-IN')} deducted.`);
        setQty(''); setLimitPrice('');
        await refreshINRBalance();
        navigate(`/transaction-status?hash=${r.txHash}`);

      } else {
        // ── ETH / METAMASK PATH (original — unchanged) ───────────
        showToast('⏳ Confirm in MetaMask...', 'info');
        const r = await buyCredit(o.listing.listingId, o.qty, o.tradeNetEth.toFixed(8));
        addNotification({ type: NOTIF_TYPES.TRADE, title: 'Buy Executed ✅', message: `${o.qty} × ${o.listing.projectName}` });
        showToast(`✅ ${o.qty} credits purchased!`);
        setQty(''); setLimitPrice('');
        navigate(`/transaction-status?hash=${r.txHash}`);
      }

    } catch (e) {
      // If MetaMask rejected AFTER INR was already deducted — refund
      if (o.paymentMode === 'inr' && (e.code === 4001 || e.message?.includes('rejected') || e.message?.includes('denied'))) {
        try {
          await walletAPI.refundTrade({ amount: Math.round(o.tradeNetInr), reference: `MetaMask-rejected-${Date.now()}` });
          setInrBalance(prev => prev + o.tradeNetInr);
          showToast('❌ MetaMask rejected — INR refunded to your wallet', 'error');
        } catch {
          showToast('❌ MetaMask rejected. Contact support if INR was deducted.', 'error');
        }
      } else if (e.code === 4001) {
        showToast('❌ Rejected in MetaMask', 'error');
      } else {
        showToast(`❌ ${e.reason || e.message || 'Transaction failed'}`, 'error');
      }
    } finally {
      setTxPending(false);
    }
  };

  const handlePlaceBid = () => {
    if (!isKYCVerified)                           { showToast('❌ Complete KYC first', 'error'); return; }
    if (!walletAddress)                           { showToast('❌ Connect MetaMask', 'error'); return; }
    if (selected?.seller?.toLowerCase() === walletAddress.toLowerCase()) { showToast('❌ Cannot bid on your own listing', 'error'); return; }
    if (!bidQty || isNaN(bidQty) || +bidQty <= 0) { showToast('❌ Enter valid quantity', 'error'); return; }
    if (!bidPrice || isNaN(bidPrice))             { showToast('❌ Enter bid price', 'error'); return; }
    if (!selected)                                { showToast('❌ Select a credit first', 'error'); return; }
    setConfirmModal({
      type: 'bid', listing: selected, qty: +bidQty,
      limitPriceInr: +bidPrice,
      limitPriceEth: (+bidPrice / ETH_INR).toFixed(8),
      bidTotalEth, bidFeeEth, bidEscrowEth,
      durationDays: parseInt(bidDays) || 7,
    });
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

  const handleCancelBid = async (orderId) => {
    try {
      showToast('⏳ Cancelling bid...', 'info');
      await cancelBuyOrder(orderId);
      showToast('✅ Bid cancelled. ETH refunded.');
    } catch (e) {
      showToast(`❌ ${e.reason || 'Cancel failed'}`, 'error');
    }
  };

  const addAlert = () => {
    if (!alertPrice || isNaN(alertPrice)) { showToast('❌ Enter valid price', 'error'); return; }
    if (!selected)                        { showToast('❌ Select a credit first', 'error'); return; }
    setAlerts(prev => [...prev, {
      listingId: selected.listingId, tokenId: selected.tokenId,
      projectName: selected.projectName, targetPrice: +alertPrice,
      type: alertType, triggered: false, id: Date.now(),
      createdAt: new Date().toLocaleTimeString(),
    }]);
    setAlertPrice('');
    showToast(`🔔 Alert set: ${alertType} ${fmt(alertPrice)}`);
  };

  const CSS = `
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
    .cc-hist-head{display:grid;grid-template-columns:1fr 60px 80px 90px 80px 80px;gap:8px;font-size:8px;color:#86efac44;letter-spacing:.12em;padding:0 0 8px;border-bottom:1px solid #0f2a1a;}
    .cc-hist-row{display:grid;grid-template-columns:1fr 60px 80px 90px 80px 80px;gap:8px;font-size:10px;padding:9px 0;border-bottom:1px solid #0f2a1a08;cursor:pointer;align-items:center;}
    .cc-hist-row:hover{background:#0d2e1f18;}
    .cc-chart-wrap{background:#040706;border-radius:8px;padding:16px;border:1px solid #0f2a1a;margin-bottom:12px;}
    .cc-depth-row{display:flex;align-items:center;gap:8px;padding:3px 0;font-size:10px;}
    .cc-alert-card{background:#060908;border:1px solid #0f2a1a;border-radius:8px;padding:12px 14px;margin-top:8px;display:flex;justify-content:space-between;align-items:center;}
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
    .cc-kyc-bar{padding:10px 14px;border-radius:7px;background:#1a0a0a;border:1px solid #f8717133;color:#f87171;font-size:10px;margin-bottom:10px;text-align:center;cursor:pointer;letter-spacing:.06em;}
    .cc-toast{position:fixed;bottom:24px;right:24px;z-index:9999;background:#080c0a;border-radius:8px;padding:11px 18px;font-size:11px;font-family:'DM Mono',monospace;letter-spacing:.05em;box-shadow:0 8px 40px rgba(0,0,0,.6);animation:slideIn .3s ease;}
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
  `;

  // ── Watchlist Panel ───────────────────────────────────────────
  const WatchlistPanel = () => (
    <div className="cc-panel" style={{ maxHeight: 600, overflowY: 'auto' }}>
      <div className="cc-panel-title">WATCHLIST</div>
      {listings.length === 0 && <div style={{ fontSize: 10, color: '#86efac33', textAlign: 'center', padding: '20px 0' }}>No listings</div>}
      {listings.map(l => {
        const price    = l.adjPrice * ETH_INR;
        const history  = priceHistories[l.tokenId] || [];
        const isUp     = history.length > 1 ? history[history.length-1] >= history[0] : true;
        const isSel    = selected?.listingId === l.listingId;
        const isStarred= watchlist.includes(l.listingId);
        return (
          <div key={l.listingId} className={`cc-wl-row${isSel?' sel':''}`} onClick={() => { setSelected(l); setAnalyticsToken(l); }}>
            <span className={`cc-wl-star${isStarred?' on':''}`} onClick={e => { e.stopPropagation(); toggleWatchlist(l.listingId); }}>★</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: '#f0fdf4', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.projectName}</div>
              <div style={{ fontSize: 9, color: '#86efac44', marginTop: 1 }}>{l.standard} · {l.amount} avail</div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: isUp ? '#22c55e' : '#f87171' }}>{fmt(price.toFixed(0))}</div>
              <MiniChart data={history.slice(-10)} color={isUp ? '#22c55e' : '#f87171'} width={50} height={18}/>
            </div>
          </div>
        );
      })}
    </div>
  );

  const [obMode, setObMode] = useState('all');

  // ── Order Book Panel ──────────────────────────────────────────
  const OrderBookPanel = () => {
    const asks = obMode === 'all' ? allAsks : selectedAsks.map(l => ({ price: l.adjPrice, priceInr: l.adjPrice * ETH_INR, amount: l.amount, seller: l.seller, listingId: l.listingId, projectName: l.projectName, tokenId: l.tokenId }));
    const bids = obMode === 'all' ? allBids : selectedBids.map(o => ({ price: o.limitPrice, priceInr: o.limitPrice * ETH_INR, amount: o.remaining, buyer: o.buyer, orderId: o.orderId, tokenId: o.tokenId }));
    const maxD  = Math.max(...asks.map(a => a.amount), ...bids.map(b => b.amount), 1);
    const midPrice = asks.length ? asks[0].priceInr : (bids.length ? bids[0].priceInr : 0);
    const spreadVal = asks.length && bids.length ? ((asks[0].price - bids[0].price) * ETH_INR).toFixed(0) : '—';
    return (
      <div className="cc-panel" style={{ minHeight: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="cc-panel-title" style={{ marginBottom: 0 }}>ORDER BOOK</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[['all','ALL'],['token','TOKEN']].map(([m, l]) => (
              <button key={m} onClick={() => setObMode(m)}
                style={{ padding: '3px 8px', borderRadius: 3, border: `1px solid ${obMode===m?'#22c55e44':'#0f2a1a'}`, background: obMode===m?'#0d2e1f22':'transparent', color: obMode===m?'#22c55e':'#86efac33', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 8, letterSpacing: '.08em' }}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {obMode === 'token' && selected && <div style={{ fontSize: 9, color: '#86efac33', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.projectName}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 50px', gap: 4, padding: '0 8px 4px', fontSize: 8, color: '#86efac33', letterSpacing: '.1em', borderBottom: '1px solid #0f2a1a', marginBottom: 4 }}>
          <span>PRICE</span><span style={{ textAlign: 'center' }}>DEPTH</span><span style={{ textAlign: 'right' }}>QTY</span>
        </div>
        <div style={{ fontSize: 9, color: '#f87171aa', letterSpacing: '.1em', padding: '4px 8px 2px' }}>ASKS</div>
        {asks.length === 0 && <div style={{ fontSize: 10, color: '#86efac22', padding: '4px 8px 6px' }}>No asks</div>}
        {[...asks].reverse().slice(0, 7).map((a, i) => (
          <div key={i} className="cc-ob-ask">
            <span style={{ color: '#f87171', minWidth: 80, fontWeight: 500, fontSize: 11 }}>{fmt(a.priceInr.toFixed(0))}</span>
            <div style={{ flex: 1 }}><DepthBar qty={a.amount} max={maxD} color="#f87171"/></div>
            <span style={{ color: '#86efac55', minWidth: 36, textAlign: 'right', fontSize: 10 }}>{a.amount}</span>
          </div>
        ))}
        <div className="cc-ob-mid">{fmt(midPrice.toFixed(0))}<span style={{ fontSize: 9, color: '#86efac44', marginLeft: 6, fontWeight: 400 }}>MID</span></div>
        <div style={{ fontSize: 9, color: '#22c55eaa', letterSpacing: '.1em', padding: '2px 8px 4px' }}>BIDS</div>
        {bids.length === 0 && <div style={{ fontSize: 10, color: '#86efac22', padding: '4px 8px' }}>No bids</div>}
        {bids.slice(0, 7).map((b, i) => (
          <div key={i} className="cc-ob-bid">
            <span style={{ color: '#22c55e', minWidth: 80, fontWeight: 500, fontSize: 11 }}>{fmt(b.priceInr.toFixed(0))}</span>
            <div style={{ flex: 1 }}><DepthBar qty={b.amount} max={maxD} color="#22c55e"/></div>
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
  };

  // ── Credit Info Card ──────────────────────────────────────────
  const CreditInfoCard = () => selected ? (
    <div className="cc-panel" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#f0fdf4', marginBottom: 6, lineHeight: 1.3 }}>{selected.projectName}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge label={selected.standard} color={STANDARDS[selected.standard]?.color} bg={STANDARDS[selected.standard]?.bg}/>
            <Badge label={selected.projectType} color={(TYPE_COLORS[selected.projectType]||TYPE_COLORS.Renewable).text} bg={(TYPE_COLORS[selected.projectType]||TYPE_COLORS.Renewable).bg}/>
            <span style={{ fontSize: 9, color: '#86efac55' }}>📍 {selected.location}</span>
            <span style={{ fontSize: 9, color: '#86efac44' }}>Vintage {selected.vintageYear}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
          <div style={{ fontSize: 22, fontWeight: 500, color: '#22c55e', letterSpacing: '.02em' }}>{fmt(currentPriceInr.toFixed(0))}</div>
          <div style={{ fontSize: 10, color: '#86efac55' }}>{fmtEth(currentPriceInr)}</div>
        </div>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #0f2a1a' }}>
        <div style={{ fontSize: 8, color: '#86efac44', letterSpacing: '.12em', marginBottom: 6 }}>PRICE HISTORY</div>
        <MiniChart data={priceHistories[selected.tokenId] || []} color="#22c55e" width={300} height={48}/>
      </div>
    </div>
  ) : (
    <div className="cc-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 160 }}>
      <div style={{ textAlign: 'center', color: '#86efac33', fontSize: 11 }}>← Select a credit from the list</div>
    </div>
  );

  // ── Order Form — with INR / ETH toggle ────────────────────────
  const OrderForm = () => {
    const inrSufficient = inrBalance >= tradeNetInr && tradeNetInr > 0;

    return (
      <div>
        <div className="cc-panel" style={{ marginBottom: 10 }}>
          <div className="cc-panel-title">PLACE ORDER</div>
          {!isKYCVerified && <div className="cc-kyc-bar" onClick={() => navigate('/kyc')}>⚠️ KYC REQUIRED TO TRADE →</div>}

          {/* Order type */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {[['market','MARKET'],['limit','LIMIT'],['bid','BID']].map(([m, label]) => (
              <button key={m} className={`cc-mode-btn${orderMode===m?' act':''}`} onClick={() => setOrderMode(m)}>{label}</button>
            ))}
          </div>

          {(orderMode === 'market' || orderMode === 'limit') && (
            <>
              <select className="cc-inp" value={selected?.listingId||''} onChange={e => setSelected(listings.find(l => l.listingId === +e.target.value))}>
                <option value="">Select credit...</option>
                {listings.map(l => <option key={l.listingId} value={l.listingId}>{l.projectName} · {fmt((l.adjPrice*ETH_INR).toFixed(0))}</option>)}
              </select>
              <input className="cc-inp" type="number" min="1" placeholder={`Qty (max ${selected?.amount||0})`} value={qty} onChange={e => setQty(e.target.value)}/>
              {orderMode === 'limit' && (
                <input className="cc-inp" type="number" placeholder="Max price (₹ per credit)" value={limitPrice} onChange={e => setLimitPrice(e.target.value)}/>
              )}

              {/* ── Payment Mode Toggle ── */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.1em', marginBottom: 6 }}>PAY WITH</div>
                <div style={{ display: 'flex', gap: 6 }}>

                  {/* INR Wallet */}
                  <button
                    onClick={() => setPaymentMode('inr')}
                    style={{
                      flex: 1, padding: '10px 6px', borderRadius: 8,
                      border: `1px solid ${paymentMode==='inr' ? '#22c55e55' : '#0f2a1a'}`,
                      background: paymentMode==='inr' ? '#0d2e1f' : '#060a07',
                      cursor: 'pointer', fontFamily: 'DM Mono,monospace',
                      transition: 'all 0.2s', textAlign: 'center',
                    }}>
                    <div style={{ fontSize: 16, marginBottom: 3 }}>🇮🇳</div>
                    <div style={{ fontSize: 9, color: paymentMode==='inr' ? '#22c55e' : '#4ade8044', fontWeight: 600, letterSpacing: '.08em' }}>INR WALLET</div>
                    <div style={{
                      fontSize: 11, fontWeight: 700, marginTop: 3,
                      color: inrLoading ? '#4ade8044' : inrBalance > 0 ? '#22c55e' : '#f87171',
                    }}>
                      {inrLoading ? '...' : `₹${inrBalance.toLocaleString('en-IN', {maximumFractionDigits:0})}`}
                    </div>
                    {paymentMode === 'inr' && tradeNetInr > 0 && (
                      <div style={{ fontSize: 8, marginTop: 2, color: inrSufficient ? '#22c55e88' : '#f87171' }}>
                        {inrSufficient ? '✓ SUFFICIENT' : `SHORT ₹${Math.round(tradeNetInr - inrBalance).toLocaleString('en-IN')}`}
                      </div>
                    )}
                  </button>

                  {/* MetaMask ETH */}
                  <button
                    onClick={() => setPaymentMode('eth')}
                    style={{
                      flex: 1, padding: '10px 6px', borderRadius: 8,
                      border: `1px solid ${paymentMode==='eth' ? '#f59e0b55' : '#0f2a1a'}`,
                      background: paymentMode==='eth' ? '#1a1200' : '#060a07',
                      cursor: 'pointer', fontFamily: 'DM Mono,monospace',
                      transition: 'all 0.2s', textAlign: 'center',
                    }}>
                    <div style={{ fontSize: 16, marginBottom: 3 }}>🦊</div>
                    <div style={{ fontSize: 9, color: paymentMode==='eth' ? '#f59e0b' : '#4ade8044', fontWeight: 600, letterSpacing: '.08em' }}>METAMASK</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b88', marginTop: 3 }}>ETH</div>
                    <div style={{ fontSize: 8, color: '#f59e0b44', marginTop: 2 }}>ON-CHAIN</div>
                  </button>

                </div>

                {/* Add funds nudge */}
                {paymentMode === 'inr' && !inrSufficient && tradeNetInr > 0 && (
                  <button onClick={() => navigate('/wallet')} style={{
                    width: '100%', marginTop: 6, padding: '7px',
                    borderRadius: 6, border: '1px solid #22c55e33',
                    background: '#0d2e1f22', color: '#22c55e88',
                    cursor: 'pointer', fontFamily: 'DM Mono,monospace',
                    fontSize: 9, letterSpacing: '.08em',
                  }}>
                    + ADD FUNDS TO WALLET →
                  </button>
                )}
              </div>

              {/* Trade summary */}
              {qty > 0 && selected && (
                <div style={{ background: '#040706', borderRadius: 6, padding: '9px 11px', marginBottom: 10 }}>
                  <div className="cc-fee-row"><span>Subtotal</span><span>{fmt(tradeTotalInr.toFixed(0))}</span></div>
                  <div className="cc-fee-row"><span>Vintage adj</span><span style={{ color: '#facc1577' }}>{selected.vintageDiscount > 0 ? `-${selected.vintageDiscount}%` : 'None'}</span></div>
                  <div className="cc-fee-row"><span>Platform fee (0.5%)</span><span style={{ color: '#facc15' }}>{fmt(tradeFeeInr.toFixed(0))}</span></div>
                  {paymentMode === 'inr' ? (
                    <div className="cc-fee-tot">
                      <span>TOTAL (INR WALLET)</span>
                      <span style={{ color: inrSufficient ? '#22c55e' : '#f87171' }}>
                        ₹{Math.round(tradeNetInr).toLocaleString('en-IN')}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="cc-fee-row"><span>ETH</span><span style={{ color: '#60a5fa88' }}>{tradeNetEth.toFixed(6)}</span></div>
                      <div className="cc-fee-tot"><span>TOTAL</span><span style={{ color: '#f87171' }}>{fmt(tradeNetInr.toFixed(0))}</span></div>
                    </>
                  )}
                </div>
              )}

              {/* Buy button */}
              <button
                className="cc-btn cc-btn-buy"
                disabled={
                  !isKYCVerified || txPending ||
                  (paymentMode === 'eth' && !walletAddress) ||
                  (paymentMode === 'inr' && (!inrSufficient || tradeNetInr <= 0))
                }
                onClick={handlePlaceOrder}
                style={paymentMode === 'inr' && !inrSufficient ? {
                  background: 'linear-gradient(135deg,#374151,#4b5563)',
                } : {}}>
                {txPending ? '⏳ PROCESSING...'
                  : !isKYCVerified ? '🔒 KYC REQUIRED'
                  : paymentMode === 'inr'
                    ? inrSufficient
                      ? `🇮🇳 BUY ${qty||'—'} · ₹${Math.round(tradeNetInr).toLocaleString('en-IN')}`
                      : '⚠ INSUFFICIENT BALANCE'
                  : `🦊 BUY ${qty||'—'} CREDITS`
                }
              </button>
            </>
          )}

          {/* BID mode — ETH only */}
          {orderMode === 'bid' && (
            <>
              <div style={{ fontSize: 9, color: '#60a5fa88', marginBottom: 10, padding: 8, background: '#0a1628', borderRadius: 6, border: '1px solid #60a5fa22', lineHeight: 1.6 }}>
                📥 Lock ETH on-chain. Auto-executes when seller lists at your price.<br/>
                <span style={{ color: '#60a5fa44' }}>Bids always use MetaMask — ETH is locked in smart contract escrow.</span>
              </div>
              <select className="cc-inp" value={selected?.listingId||''} onChange={e => setSelected(listings.find(l => l.listingId === +e.target.value))}>
                <option value="">Select credit token...</option>
                {listings.map(l => <option key={l.listingId} value={l.listingId}>{l.projectName}</option>)}
              </select>
              <input className="cc-inp" type="number" placeholder="Quantity (credits)" value={bidQty} onChange={e => setBidQty(e.target.value)}/>
              <input className="cc-inp" type="number" placeholder="Bid price (₹ per credit)" value={bidPrice} onChange={e => setBidPrice(e.target.value)}/>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {['7','14','30'].map(d => (
                  <button key={d} onClick={() => setBidDays(d)} style={{ flex:1, padding:6, borderRadius:4, border:`1px solid ${bidDays===d?'#22c55e44':'#0f2a1a'}`, background:bidDays===d?'#0d2e1f22':'transparent', color:bidDays===d?'#22c55e':'#86efac44', cursor:'pointer', fontFamily:'DM Mono,monospace', fontSize:10 }}>
                    {d}d
                  </button>
                ))}
              </div>
              {bidQty > 0 && bidPrice > 0 && (
                <div style={{ background: '#040706', borderRadius: 6, padding: '9px 11px', marginBottom: 10 }}>
                  <div className="cc-fee-row"><span>Bid total</span><span>{bidTotalEth.toFixed(6)} ETH</span></div>
                  <div className="cc-fee-row"><span>Fee (0.5%)</span><span style={{ color: '#facc15' }}>{bidFeeEth.toFixed(6)} ETH</span></div>
                  <div className="cc-fee-tot"><span>LOCKED IN ESCROW</span><span style={{ color: '#60a5fa' }}>{bidEscrowEth.toFixed(6)} ETH</span></div>
                </div>
              )}
              <button className="cc-btn cc-btn-bid" disabled={!isKYCVerified || !walletAddress || txPending} onClick={handlePlaceBid}>
                {txPending ? '⏳ PROCESSING...' : `PLACE BID · LOCK ${bidEscrowEth.toFixed(4)} ETH`}
              </button>
            </>
          )}

          <div style={{ marginTop: 8, fontSize: 9, color: '#86efac33', textAlign: 'center' }}>
            1 credit = 1 tonne CO₂ · MetaMask required for on-chain signing
          </div>
        </div>

        <div className="cc-panel">
          <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.12em', marginBottom: 8 }}>HAVE CREDITS TO SELL?</div>
          <button style={{ width: '100%', padding: '9px', borderRadius: 6, border: '1px solid #facc1533', background: 'transparent', color: '#facc1566', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 10 }} onClick={() => navigate('/portfolio')}>
            GO TO PORTFOLIO →
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="cc">
        <div className="cc-wrap">

          {/* Page header */}
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.18em', marginBottom: 4 }}>ETHERTRACK · CARBON MARKET · SEPOLIA</div>
              <div style={{ fontSize: 22, fontWeight: 500, color: '#f0fdf4', letterSpacing: '.02em' }}>
                Carbon Credit <span style={{ color: '#22c55e' }}>Exchange</span>
              </div>
              <div style={{ fontSize: 10, color: '#86efac44', marginTop: 2 }}>
                <span className="dot-live"/>LIVE ORDER BOOK · HYBRID AMM · AUTO-MATCHING
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* INR balance chip */}
              <span
                onClick={() => navigate('/wallet')}
                style={{ fontSize: 9, padding: '4px 12px', borderRadius: 20, background: '#0d2e1f', border: '1px solid #22c55e33', color: '#22c55e', letterSpacing: '.08em', cursor: 'pointer' }}>
                🇮🇳 ₹{inrBalance.toLocaleString('en-IN', {maximumFractionDigits:0})}
              </span>
              {isKYCVerified
                ? <span style={{ fontSize: 9, padding: '4px 10px', borderRadius: 20, background: '#0d2e1f', border: '1px solid #22c55e33', color: '#22c55e', letterSpacing: '.1em' }}>✅ KYC VERIFIED</span>
                : <span style={{ fontSize: 9, padding: '4px 10px', borderRadius: 20, background: '#1a0a0a', border: '1px solid #f8717133', color: '#f87171', cursor: 'pointer', letterSpacing: '.1em' }} onClick={() => navigate('/kyc')}>⚠️ COMPLETE KYC</span>
              }
              <span style={{ fontSize: 9, padding: '4px 10px', borderRadius: 20, background: '#0a1628', border: '1px solid #60a5fa22', color: '#60a5fa66', letterSpacing: '.1em' }}>⛓ SEPOLIA</span>
            </div>
          </div>

          {/* Ticker */}
          <div className="cc-ticker-wrap">
            <div className="cc-ticker-inner">
              {loading.listings && !listings.length
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="cc-tick"><Skeleton w="80px" h={8} mb={4}/><Skeleton w="60px" h={12} mb={0}/></div>
                  ))
                : listings.map(l => {
                    const price   = l.adjPrice * ETH_INR;
                    const history = priceHistories[l.tokenId] || [];
                    const isUp    = history.length > 1 ? history[history.length-1] >= history[0] : true;
                    return (
                      <div key={l.listingId} className={`cc-tick${selected?.listingId===l.listingId?' sel':''}`} onClick={() => { setSelected(l); setTab('trade'); }}>
                        <div className="cc-tick-name">{l.projectName}</div>
                        <div className="cc-tick-price" style={{ color: isUp ? '#22c55e' : '#f87171' }}>{fmt(price.toFixed(0))}</div>
                        <div className="cc-tick-chg" style={{ color: isUp ? '#16a34a' : '#dc2626' }}>
                          {isUp ? '▲' : '▼'} {l.standard}
                        </div>
                      </div>
                    );
                  })
              }
              {!loading.listings && !listings.length && (
                <div style={{ padding: '14px 20px', fontSize: 10, color: '#86efac33' }}>No active listings yet.</div>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="cc-stats">
            {[
              { label: 'CREDITS AVAILABLE', val: totalAvailable || '—',                              sub: `${listings.length} active listings` },
              { label: 'CREDITS RETIRED',   val: platformRetired || '—',                             sub: 'platform-wide tCO₂ retired' },
              { label: 'DAILY VOLUME',      val: dailyVolume ? `${dailyVolume} tCO₂` : '—',         sub: `${tradeHistory.length} total trades` },
              { label: 'AVG TRADE PRICE',   val: avgTradePrice ? fmt(avgTradePrice.toFixed(0)) : '—',sub: 'per tonne CO₂' },
              { label: 'OPEN BIDS',         val: openBidsTotal || '—',                               sub: `${myOpenBids.reduce((s,o)=>s+o.ethEscrowed,0).toFixed(4)} ETH locked` },
            ].map(({ label, val, sub }) => (
              <div className="cc-stat" key={label}>
                <div className="cc-stat-lbl">{label}</div>
                <div className="cc-stat-val">{loading.listings ? <Skeleton w="70px" h={20} mb={0}/> : val}</div>
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
              <button key={t} className={`cc-tab${tab===t?' act':''}`} onClick={() => setTab(t)}>{label}</button>
            ))}
          </div>

          {/* ══ MARKET TAB ══ */}
          {tab === 'market' && (
            <div className="cc-market-layout">
              <WatchlistPanel/>
              <div className="cc-panel">
                <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select className="cc-inp" style={{ margin: 0, width: 'auto' }} value={filterStd} onChange={e => setFilterStd(e.target.value)}>
                    <option value="ALL">All Standards</option><option value="VCS">VCS</option><option value="GS">Gold Standard</option><option value="CDM">CDM</option><option value="ACR">ACR</option>
                  </select>
                  <select className="cc-inp" style={{ margin: 0, width: 'auto' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
                    <option value="ALL">All Types</option><option value="Renewable">Renewable</option><option value="Forestry">Forestry</option><option value="Industrial">Industrial</option><option value="Social">Social</option>
                  </select>
                  <select className="cc-inp" style={{ margin: 0, width: 'auto' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
                    <option value="price">Price ↓</option><option value="priceAsc">Price ↑</option><option value="amount">Volume ↓</option><option value="vintage">Vintage ↓</option><option value="name">Name A→Z</option>
                  </select>
                  <span style={{ marginLeft: 'auto', fontSize: 9, color: '#86efac44', letterSpacing: '.1em' }}>{filtered.length} LISTINGS</span>
                </div>
                <div className="cc-tbl-head">
                  <span>PROJECT</span><span>STD</span><span>PRICE</span><span>VINTAGE</span><span>TREND</span><span>BIDS</span><span>ACTION</span>
                </div>
                {loading.listings && !listings.length
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} style={{ padding: '12px 8px', borderBottom: '1px solid #0f2a1a08' }}>
                        <Skeleton w="60%" h={12} mb={6}/><Skeleton w="40%" h={9} mb={0}/>
                      </div>
                    ))
                  : filtered.length === 0
                    ? <div style={{ textAlign: 'center', padding: '48px', color: '#86efac33', fontSize: 11 }}>No listings match your filters.</div>
                    : filtered.map(l => {
                        const price   = l.adjPrice * ETH_INR;
                        const history = priceHistories[l.tokenId] || [];
                        const isUp    = history.length > 1 ? history[history.length-1] >= history[0] : true;
                        const bidsN   = buyOrders.filter(o => o.tokenId === l.tokenId && (o.status === 0 || o.status === 2)).length;
                        const isSel   = selected?.listingId === l.listingId;
                        const col     = TYPE_COLORS[l.projectType] || TYPE_COLORS.Renewable;
                        return (
                          <div key={l.listingId} className={`cc-tbl-row${isSel?' sel':''}`} onClick={() => { setSelected(l); setAnalyticsToken(l); setTab('trade'); }}>
                            <div>
                              <div style={{ fontSize: 11, color: '#f0fdf4', fontWeight: 500, marginBottom: 2 }}>{l.projectName}</div>
                              <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 8, color: '#86efac44' }}>{l.serialNumber}</span>
                                <Badge label={l.projectType} color={col.text} bg={col.bg}/>
                              </div>
                            </div>
                            <Badge label={l.standard} color={STANDARDS[l.standard]?.color} bg={STANDARDS[l.standard]?.bg}/>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 500, color: isUp ? '#22c55e' : '#f87171' }}>{fmt(price.toFixed(0))}</div>
                              <div style={{ fontSize: 9, color: '#86efac44' }}>{l.amount} avail</div>
                            </div>
                            <span style={{ fontSize: 10, color: '#86efac66' }}>{l.vintageYear}</span>
                            <MiniChart data={history.slice(-12)} color={isUp ? '#22c55e' : '#f87171'} width={80} height={28}/>
                            <span style={{ fontSize: 10, color: bidsN > 0 ? '#60a5fa88' : '#86efac33' }}>{bidsN > 0 ? `📥 ${bidsN}` : '—'}</span>
                            {l.seller?.toLowerCase() === walletAddress?.toLowerCase()
                              ? <span style={{ fontSize: 9, color: '#86efac22', padding: '5px 4px' }}>YOUR LISTING</span>
                              : <button onClick={e => { e.stopPropagation(); setSelected(l); setTab('trade'); }}
                                  style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid #22c55e44', background: '#0d2e1f', color: '#22c55e', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 9, letterSpacing: '.08em' }}>
                                  BUY →
                                </button>
                            }
                          </div>
                        );
                      })
                }
              </div>
            </div>
          )}

          {/* ══ TRADE TAB ══ */}
          {tab === 'trade' && (
            <div className="cc-trade-layout">
              <OrderBookPanel/>
              <div>
                <CreditInfoCard/>
                <div className="cc-panel">
                  <div className="cc-panel-title">RECENT TRADES</div>
                  {tradeHistory.length === 0
                    ? <div style={{ fontSize: 10, color: '#86efac33', textAlign: 'center', padding: '16px 0' }}>No trades yet</div>
                    : tradeHistory.slice(0, 6).map((t, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 10, borderBottom: '1px solid #0f2a1a08', cursor: 'pointer' }}
                          onClick={() => t.txHash && navigate(`/transaction-status?hash=${t.txHash}`)}>
                          <span style={{ color: t.type === 'Buy' ? '#22c55e' : '#f87171', minWidth: 30 }}>{t.type}</span>
                          <span style={{ color: '#f0fdf4' }}>{t.amount} credits</span>
                          <span style={{ color: '#60a5fa88' }}>{t.totalEth} ETH</span>
                          <span style={{ color: '#86efac44', fontSize: 9 }}>{t.time}</span>
                        </div>
                      ))
                  }
                </div>
              </div>
              <OrderForm/>
            </div>
          )}

          {/* ══ ANALYTICS TAB ══ */}
          {tab === 'analytics' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.12em' }}>TOKEN:</span>
                  {listings.map(l => (
                    <button key={l.listingId} onClick={() => setAnalyticsToken(l)}
                      style={{ padding: '5px 10px', borderRadius: 4, border: `1px solid ${analyticsListing?.listingId===l.listingId?'#22c55e44':'#0f2a1a'}`, background: analyticsListing?.listingId===l.listingId?'#0d2e1f22':'transparent', color: analyticsListing?.listingId===l.listingId?'#22c55e':'#86efac44', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 9 }}>
                      {l.projectName?.slice(0, 16)}...
                    </button>
                  ))}
                </div>
                <div className="cc-chart-wrap">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: '#86efac44', letterSpacing: '.12em', marginBottom: 4 }}>PRICE CHART · {analyticsListing?.projectName}</div>
                      <div style={{ fontSize: 26, fontWeight: 500, color: '#22c55e' }}>{fmt(currentPriceInr.toFixed(0))}</div>
                      <div style={{ fontSize: 10, color: parseFloat(analyticsChange) >= 0 ? '#22c55e' : '#f87171', marginTop: 2 }}>
                        {parseFloat(analyticsChange) >= 0 ? '▲' : '▼'} {Math.abs(analyticsChange)}% (session)
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 9, color: '#86efac44' }}>H: {fmt(analyticsHigh.toFixed(0))} · L: {fmt(analyticsLow.toFixed(0))}</div>
                    </div>
                  </div>
                  <MiniChart data={analyticsHistory} color="#22c55e" width={600} height={120}/>
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
                    { l: 'TRADES TODAY',   v: tradeHistory.length },
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

          {/* ══ AMM TAB ══ */}
          {tab === 'amm' && (
            <div>
              <div style={{ marginBottom: 14, padding: '11px 14px', background: '#080c0a', border: '1px solid #0f2a1a', borderRadius: 8, fontSize: 10, color: '#86efac66', lineHeight: 1.7 }}>
                ⚡ <strong style={{ color: '#f0fdf4' }}>AMM Pools</strong> — Instant swaps for small orders (≤100 credits). No counterparty needed.
              </div>
              <div className="cc-amm-grid">
                {ammPools.length === 0 && !loading.listings
                  ? <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '48px', color: '#86efac33', fontSize: 11 }}>No AMM pools found.</div>
                  : ammPools.map((pool) => (
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
                          { l: 'ETH RESERVE',    v: `${pool.ethReserve.toFixed(4)} ETH` },
                          { l: 'PRICE',          v: fmt((pool.priceEth * ETH_INR).toFixed(0)) },
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

          {/* ══ HISTORY TAB ══ */}
          {tab === 'history' && (
            <div className="cc-panel">
              <div className="cc-panel-title">TRADE HISTORY ({tradeHistory.length})</div>
              {tradeHistory.length === 0
                ? <div style={{ textAlign: 'center', padding: '48px', color: '#86efac33', fontSize: 11 }}>No trades yet.</div>
                : <>
                    <div className="cc-hist-head">
                      <span>TX ID</span><span>TYPE</span><span>AMOUNT</span><span>VALUE (ETH)</span><span>TIME</span><span>STATUS</span>
                    </div>
                    {tradeHistory.map((t, i) => (
                      <div key={i} className="cc-hist-row" onClick={() => t.txHash && navigate(`/transaction-status?hash=${t.txHash}`)}>
                        <span style={{ color: '#86efac44', fontSize: 9 }}>{t.id}</span>
                        <span style={{ color: t.type === 'Buy' ? '#22c55e' : '#f87171', fontWeight: 500 }}>{t.type}</span>
                        <span style={{ color: '#f0fdf4' }}>{t.amount} tCO₂</span>
                        <span style={{ color: '#60a5fa88' }}>{t.totalEth} ETH</span>
                        <span style={{ color: '#86efac44', fontSize: 9 }}>{t.time}</span>
                        <span style={{ fontSize: 8, padding: '2px 7px', borderRadius: 3, background: '#0d2e1f', color: '#22c55e', border: '1px solid #16a34a33' }}>
                          {t.isAMM ? 'AMM' : t.status}
                        </span>
                      </div>
                    ))}
                  </>
              }
            </div>
          )}

          {/* ══ MY BIDS TAB ══ */}
          {tab === 'bids' && (
            <div className="cc-panel">
              <div className="cc-panel-title">MY OPEN BIDS — ON-CHAIN ({myOpenBids.length})</div>
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
                        <div>
                          <div style={{ color: '#22c55e', fontWeight: 500 }}>{fmt((o.limitPrice * ETH_INR).toFixed(0))}</div>
                        </div>
                        <div style={{ color: '#60a5fa88' }}>{o.ethEscrowed.toFixed(4)} ETH</div>
                        <button onClick={() => handleCancelBid(o.orderId)} style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid #dc262633', background: 'transparent', color: '#f8717166', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 9 }}>
                          CANCEL
                        </button>
                      </div>
                    ))}
                  </>
              }
            </div>
          )}

          {/* ══ ALERTS TAB ══ */}
          {tab === 'alerts' && (
            <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 12 }}>
              <div className="cc-panel">
                <div className="cc-panel-title">CREATE ALERT</div>
                <select className="cc-inp" value={selected?.listingId||''} onChange={e => setSelected(listings.find(l => l.listingId === +e.target.value))}>
                  <option value="">Select credit...</option>
                  {listings.map(l => <option key={l.listingId} value={l.listingId}>{l.projectName} · {fmt((l.adjPrice*ETH_INR).toFixed(0))}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {[['below','PRICE BELOW'],['above','PRICE ABOVE']].map(([t, l]) => (
                    <button key={t} onClick={() => setAlertType(t)}
                      style={{ flex: 1, padding: '7px', borderRadius: 4, border: `1px solid ${alertType===t?'#22c55e44':'#0f2a1a'}`, background: alertType===t?'#0d2e1f22':'transparent', color: alertType===t?'#22c55e':'#86efac44', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 9 }}>
                      {l}
                    </button>
                  ))}
                </div>
                <input className="cc-inp" type="number" placeholder={`Alert when price ${alertType} ₹...`} value={alertPrice} onChange={e => setAlertPrice(e.target.value)}/>
                <button className="cc-btn" style={{ background: 'linear-gradient(135deg,#0d2e1f,#16a34a)', color: '#22c55e', border: '1px solid #22c55e44' }} onClick={addAlert}>🔔 SET ALERT</button>
              </div>
              <div className="cc-panel">
                <div className="cc-panel-title">ACTIVE ALERTS ({alerts.length})</div>
                {alerts.length === 0
                  ? <div style={{ textAlign: 'center', padding: '32px', color: '#86efac33', fontSize: 11 }}>🔔 No alerts set.</div>
                  : alerts.map(a => (
                      <div key={a.id} className="cc-alert-card">
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

      {/* ── BUY CONFIRM MODAL ── */}
      {confirmModal?.type === 'buy' && (
        <div className="cc-overlay" onClick={e => e.target === e.currentTarget && setConfirmModal(null)}>
          <div className="cc-modal" style={{ maxWidth: 480 }}>
            <div className="cc-modal-h">
              <span style={{ fontSize: 12, fontWeight: 500, color: '#f0fdf4', letterSpacing: '.1em' }}>CONFIRM BUY ORDER</span>
              <button style={{ background: 'none', border: 'none', color: '#86efac44', cursor: 'pointer', fontSize: 16 }} onClick={() => setConfirmModal(null)}>✕</button>
            </div>
            <div className="cc-modal-b" style={{ maxHeight: '70vh', overflowY: 'auto' }}>

              {/* Payment method banner */}
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 14,
                background: confirmModal.paymentMode === 'inr' ? '#0d2e1f' : '#1a1200',
                border: `1px solid ${confirmModal.paymentMode === 'inr' ? '#22c55e33' : '#f59e0b33'}`,
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ fontSize: 20 }}>{confirmModal.paymentMode === 'inr' ? '🇮🇳' : '🦊'}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: confirmModal.paymentMode === 'inr' ? '#22c55e' : '#f59e0b' }}>
                    {confirmModal.paymentMode === 'inr' ? 'PAYING FROM INR WALLET' : 'PAYING WITH METAMASK (ETH)'}
                  </div>
                  <div style={{ fontSize: 9, color: '#86efac44', marginTop: 2 }}>
                    {confirmModal.paymentMode === 'inr'
                      ? `₹${inrBalance.toLocaleString('en-IN')} available → ₹${Math.round(confirmModal.tradeNetInr).toLocaleString('en-IN')} will be deducted`
                      : 'MetaMask will prompt for ETH transaction'
                    }
                  </div>
                </div>
              </div>

              {/* Credit info */}
              <div style={{ background: '#040706', borderRadius: 8, padding: 14, marginBottom: 14, border: '1px solid #0f2a1a' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#f0fdf4', marginBottom: 6 }}>{confirmModal.listing.projectName}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  <Badge label={confirmModal.listing.standard} color={STANDARDS[confirmModal.listing.standard]?.color} bg={STANDARDS[confirmModal.listing.standard]?.bg}/>
                  <Badge label={confirmModal.listing.projectType} color={(TYPE_COLORS[confirmModal.listing.projectType]||TYPE_COLORS.Renewable).text} bg={(TYPE_COLORS[confirmModal.listing.projectType]||TYPE_COLORS.Renewable).bg}/>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                  {[
                    { l: 'QUANTITY',    v: `${confirmModal.qty} credits` },
                    { l: 'VINTAGE',     v: confirmModal.listing.vintageYear },
                    { l: 'LISTING ID',  v: `#${confirmModal.listing.listingId}` },
                    { l: 'SELLER',      v: `${confirmModal.listing.seller?.slice(0,6)}...${confirmModal.listing.seller?.slice(-4)}` },
                  ].map(({ l, v }) => (
                    <div key={l}>
                      <div style={{ fontSize: 8, color: '#86efac33', letterSpacing: '.1em', marginBottom: 1 }}>{l}</div>
                      <div style={{ fontSize: 10, color: '#86efac88' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Order summary */}
              <div className="cc-fee-row"><span>Subtotal</span><span>{fmt(confirmModal.tradeTotalInr.toFixed(0))}</span></div>
              <div className="cc-fee-row"><span>Platform fee (0.5%)</span><span style={{ color: '#facc15' }}>{fmt(confirmModal.tradeFeeInr.toFixed(0))}</span></div>
              {confirmModal.paymentMode === 'inr' ? (
                <div className="cc-fee-tot">
                  <span>TOTAL (INR WALLET)</span>
                  <span style={{ color: '#22c55e' }}>₹{Math.round(confirmModal.tradeNetInr).toLocaleString('en-IN')}</span>
                </div>
              ) : (
                <>
                  <div className="cc-fee-row"><span>ETH to send</span><span style={{ color: '#60a5fa88' }}>{confirmModal.tradeNetEth.toFixed(6)} ETH</span></div>
                  <div className="cc-fee-tot"><span>TOTAL PAYABLE</span><span style={{ color: '#f87171' }}>{fmt(confirmModal.tradeNetInr.toFixed(0))}</span></div>
                </>
              )}

              <div style={{ marginTop: 10, padding: '8px 10px', background: '#0d2e1f22', borderRadius: 6, fontSize: 9, color: '#86efac44', lineHeight: 1.6 }}>
                {confirmModal.paymentMode === 'inr'
                  ? '🇮🇳 INR deducted first → MetaMask signs on-chain credit transfer'
                  : '⛓ Calls Marketplace.buyCredit() on Ethereum Sepolia. MetaMask will prompt.'
                }
              </div>
            </div>
            <div className="cc-modal-f">
              <button className="cc-btn-cn" onClick={() => setConfirmModal(null)}>CANCEL</button>
              <button className="cc-btn-ok"
                style={{ background: confirmModal.paymentMode === 'inr' ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#fff' }}
                onClick={handleConfirmBuy}>
                {confirmModal.paymentMode === 'inr' ? '🇮🇳 CONFIRM & PAY →' : '🦊 CONFIRM IN METAMASK →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BID CONFIRM MODAL ── */}
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
                <div style={{ fontSize: 9, color: '#86efac55' }}>Bid for {confirmModal.qty} credits @ {fmt(confirmModal.limitPriceInr)}</div>
              </div>
              {[
                { l: 'BID QUANTITY', v: `${confirmModal.qty} credits`, c: '#f0fdf4' },
                { l: 'BID PRICE',    v: fmt(confirmModal.limitPriceInr),  c: '#22c55e' },
                { l: 'DURATION',     v: `${confirmModal.durationDays} days`, c: '#f0fdf4' },
              ].map(({ l, v, c }) => (
                <div key={l} className="cc-fee-row" style={{ padding: '6px 0' }}><span>{l}</span><span style={{ color: c }}>{v}</span></div>
              ))}
              <div style={{ height: 1, background: '#0f2a1a', margin: '8px 0' }}/>
              <div className="cc-fee-row"><span>Bid total</span><span>{confirmModal.bidTotalEth.toFixed(6)} ETH</span></div>
              <div className="cc-fee-row"><span>Platform fee</span><span style={{ color: '#facc15' }}>{confirmModal.bidFeeEth.toFixed(6)} ETH</span></div>
              <div className="cc-fee-tot"><span>ETH LOCKED IN ESCROW</span><span style={{ color: '#60a5fa' }}>{confirmModal.bidEscrowEth.toFixed(6)} ETH</span></div>
            </div>
            <div className="cc-modal-f">
              <button className="cc-btn-cn" onClick={() => setConfirmModal(null)}>CANCEL</button>
              <button className="cc-btn-ok" style={{ background: 'linear-gradient(135deg,#1d4ed8,#1e40af)', color: '#fff' }} onClick={handleConfirmBid}>LOCK ETH & BID →</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AMM SWAP MODAL ── */}
      {ammModal && (
        <div className="cc-overlay" onClick={e => e.target === e.currentTarget && setAmmModal(null)}>
          <div className="cc-modal">
            <div className="cc-modal-h">
              <span style={{ fontSize: 12, fontWeight: 500, color: '#f0fdf4' }}>⚡ AMM SWAP · Pool #{ammModal.pool.poolId}</span>
              <button style={{ background: 'none', border: 'none', color: '#86efac44', cursor: 'pointer', fontSize: 16 }} onClick={() => setAmmModal(null)}>✕</button>
            </div>
            <div className="cc-modal-b">
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {[['buy','ETH → CREDITS'],['sell','CREDITS → ETH']].map(([d, label]) => (
                  <button key={d} onClick={() => setAmmDir(d)} style={{ flex: 1, padding: '8px', borderRadius: 5, border: `1px solid ${ammDir===d?'#22c55e44':'#0f2a1a'}`, background: ammDir===d?'#0d2e1f22':'transparent', color: ammDir===d?'#22c55e':'#86efac44', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 10, fontWeight: 500 }}>
                    {label}
                  </button>
                ))}
              </div>
              <input className="cc-inp" type="number" placeholder={ammDir === 'buy' ? 'ETH to spend' : 'Credits to sell'} value={ammQty} onChange={e => setAmmQty(e.target.value)}/>
              {ammQty && (
                <div style={{ background: '#040706', borderRadius: 6, padding: '9px 11px', marginBottom: 10 }}>
                  <div className="cc-fee-row"><span>You give</span><span>{ammQty} {ammDir === 'buy' ? 'ETH' : 'credits'}</span></div>
                  <div className="cc-fee-row"><span>Pool fee (0.3%)</span><span style={{ color: '#facc15' }}>{(ammQty * 0.003).toFixed(4)}</span></div>
                  <div className="cc-fee-tot"><span>YOU RECEIVE ≈</span><span style={{ color: '#22c55e' }}>{(ammQty * 0.997).toFixed(ammDir === 'buy' ? 2 : 6)} {ammDir === 'buy' ? 'credits' : 'ETH'}</span></div>
                </div>
              )}
            </div>
            <div className="cc-modal-f">
              <button className="cc-btn-cn" onClick={() => setAmmModal(null)}>CANCEL</button>
              <button className="cc-btn-ok" style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff' }}
                onClick={async () => {
                  if (!ammQty) { showToast('❌ Enter amount', 'error'); return; }
                  try {
                    setAmmModal(null);
                    if (ammDir === 'buy') await ammSwapETHForCredits(ammModal.pool.poolId, ammQty, 0);
                    else await ammSwapCreditsForETH(ammModal.pool.poolId, parseInt(ammQty), 0);
                    showToast('✅ Swap successful!');
                  } catch (e) { showToast(`❌ ${e.reason || 'Swap failed'}`, 'error'); }
                }}>
                SWAP NOW →
              </button>
            </div>
          </div>
        </div>
      )}

      {txPending && (
        <div className="cc-pending"><div className="cc-spin"/>Waiting for confirmation...</div>
      )}

      {toast.msg && (
        <div className="cc-toast" style={{ borderColor: toast.type==='error'?'#f8717144':toast.type==='info'?'#60a5fa44':'#22c55e44', color: toast.type==='error'?'#f87171':toast.type==='info'?'#60a5fa':'#22c55e' }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}