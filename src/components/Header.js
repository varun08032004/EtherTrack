import React, { useContext, useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../App';
import { useNotifications } from '../context/NotificationContext';
import useWallet from '../hooks/useWallet';
import { walletAPI } from '../services/api';

const Header = () => {
  const { isAuthenticated, handleLogout, dbUser, setDbUser } = useContext(AuthContext);
  const {
    notifications, unreadCount,
    markRead, markAllRead, deleteOne, getTypeMeta, timeAgo,
  } = useNotifications();
  const {
    address, shortAddress,
    isConnected, isConnecting,
    balance, balanceINR, network,
    connect, disconnect,
  } = useWallet();

  const navigate = useNavigate();
  const location = useLocation();

  const [menuOpen,   setMenuOpen]   = useState(false);
  const [bellOpen,   setBellOpen]   = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [scrolled,   setScrolled]   = useState(false);
  const [binding,    setBinding]    = useState(false);
  const [bindDone,   setBindDone]   = useState(false);

  const bellRef   = useRef(null);
  const walletRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false); setBellOpen(false); setWalletOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handler = (e) => {
      if (bellRef.current   && !bellRef.current.contains(e.target))   setBellOpen(false);
      if (walletRef.current && !walletRef.current.contains(e.target)) setWalletOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Auto-bind wallet to account after MetaMask connects ──────
  const silentBind = async (walletAddress) => {
    // Skip if already bound
    if (dbUser?.wallet_address) return;
    if (bindDone) return;

    setBinding(true);
    try {
      const challengeRes = await walletAPI.challenge(walletAddress);
      const message = challengeRes?.message || challengeRes?.data?.message;
      if (!message) return;

      const signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, walletAddress],
      });

      const bindRes = await walletAPI.bind({ walletAddress, signature, message });

      if (bindRes?.user) {
        setDbUser?.(bindRes.user);
      }
      setBindDone(true);
      console.log('✅ Wallet auto-bound to account');
    } catch (e) {
      // Non-fatal — wallet still works for blockchain, just not bound in DB
      console.warn('Auto wallet bind skipped:', e?.message || e);
    } finally {
      setBinding(false);
    }
  };

  // ── Connect + auto-bind ───────────────────────────────────────
  const handleConnect = async () => {
    try {
      await connect(); // existing useWallet connect
      // address updates asynchronously via useWallet hook
      // so we read from MetaMask directly for the bind call
      if (window.ethereum) {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts?.[0]) silentBind(accounts[0]);
      }
    } catch (e) {
      console.error('Connect failed:', e?.message);
    }
  };

  // Also bind if wallet already connected when component mounts
  useEffect(() => {
    if (isConnected && address && !dbUser?.wallet_address && !bindDone) {
      silentBind(address);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  const handleLogoutClick = () => {
    disconnect();
    handleLogout();
    navigate('/login');
  };

  const isActive = (path) => location.pathname === path;

  const navLinks = [
    { to: '/dashboard',         label: 'DASHBOARD' },
    { to: '/portfolio',         label: 'PORTFOLIO' },
    { to: '/carbon-credits',    label: 'MARKET'    },
    { to: '/emission-tracking', label: 'EMISSIONS' },
    { to: '/trading-history',   label: 'HISTORY'   },
    { to: '/profile',           label: 'PROFILE'   },
  ];

  // Wallet already bound badge
  const walletBound = !!dbUser?.wallet_address || bindDone;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        .et-header {
          position: fixed; top: 0; left: 0; right: 0; z-index: 1000;
          font-family: 'DM Mono', monospace;
          background: #080c0aee; border-bottom: 1px solid #0f2a1a;
          backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
          transition: box-shadow 0.3s; height: 60px; display: flex; align-items: center;
        }
        .et-header.scrolled { box-shadow: 0 4px 32px rgba(0,0,0,0.5); }
        .et-header-inner {
          max-width: 1200px; margin: 0 auto; padding: 0 24px; width: 100%;
          display: flex; align-items: center; justify-content: space-between; gap: 24px;
        }
        .et-header-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; flex-shrink: 0; }
        .et-header-nav { display: flex; align-items: center; gap: 4px; flex: 1; justify-content: center; }
        .et-nav-link {
          padding: 6px 14px; border-radius: 5px; font-size: 11px; letter-spacing: 0.1em;
          font-weight: 500; color: #4ade8066; text-decoration: none;
          transition: color 0.2s, background 0.2s; white-space: nowrap;
        }
        .et-nav-link:hover  { color: #22c55e; background: #0d2e1f; }
        .et-nav-link.active { color: #22c55e; background: #0d2e1f; border: 1px solid #16a34a22; }
        .et-header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .et-header-divider { width: 1px; height: 20px; background: #0f2a1a; flex-shrink: 0; }
        .et-live { display: flex; align-items: center; gap: 5px; font-size: 10px; color: #4ade8055; letter-spacing: 0.1em; }
        .et-live-dot { width: 5px; height: 5px; border-radius: 50%; background: #22c55e; animation: livePulse 1.5s infinite; }
        @keyframes livePulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
          50%      { box-shadow: 0 0 0 3px rgba(34,197,94,0); }
        }
        .et-bell-wrap { position: relative; }
        .et-bell-btn {
          position: relative; width: 34px; height: 34px; border-radius: 7px;
          border: 1px solid #0f2a1a; background: transparent;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s; font-size: 15px;
        }
        .et-bell-btn:hover { border-color: #22c55e44; background: #0d2e1f; }
        .et-bell-badge {
          position: absolute; top: -5px; right: -5px;
          min-width: 16px; height: 16px; border-radius: 8px; padding: 0 3px;
          background: #dc2626; border: 2px solid #080c0a;
          font-size: 9px; color: #fff; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
        }
        .et-bell-dropdown {
          position: absolute; top: calc(100% + 10px); right: 0; width: 340px;
          background: #0a0f0c; border: 1px solid #0f2a1a; border-radius: 12px;
          box-shadow: 0 16px 48px rgba(0,0,0,0.7); z-index: 2000;
          animation: dropIn 0.2s ease; overflow: hidden;
        }
        .et-bell-top {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 16px; border-bottom: 1px solid #0f2a1a;
        }
        .et-bell-top-title { font-size: 11px; color: #f0fdf4; font-weight: 700; letter-spacing: 0.1em; }
        .et-bell-mark-all { font-size: 10px; color: #22c55e88; cursor: pointer; background: none; border: none; font-family: inherit; letter-spacing: 0.06em; padding: 0; }
        .et-bell-mark-all:hover { color: #22c55e; }
        .et-bell-list { max-height: 300px; overflow-y: auto; }
        .et-bell-list::-webkit-scrollbar { width: 3px; }
        .et-bell-list::-webkit-scrollbar-thumb { background: #0f2a1a; border-radius: 2px; }
        .et-bell-item {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 12px 16px; border-bottom: 1px solid #0f2a1a18;
          cursor: pointer; transition: background 0.15s; position: relative;
        }
        .et-bell-item:hover  { background: #0f1a1255; }
        .et-bell-item.unread { background: #0d2e1f22; }
        .et-bell-item-icon { width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0; background: #060a07; border: 1px solid #0f2a1a; display: flex; align-items: center; justify-content: center; font-size: 13px; }
        .et-bell-item-body  { flex: 1; min-width: 0; }
        .et-bell-item-title { font-size: 11px; color: #f0fdf4; font-weight: 700; margin-bottom: 2px; }
        .et-bell-item-msg   { font-size: 10px; color: #4ade8066; line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .et-bell-item-time  { font-size: 9px; color: #4ade8033; margin-top: 3px; }
        .et-bell-unread-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; flex-shrink: 0; margin-top: 4px; }
        .et-bell-del { position: absolute; top: 10px; right: 10px; background: none; border: none; cursor: pointer; font-size: 11px; color: #4ade8022; opacity: 0; transition: opacity 0.2s; }
        .et-bell-item:hover .et-bell-del { opacity: 1; }
        .et-bell-del:hover { color: #f87171; }
        .et-bell-empty { padding: 32px; text-align: center; font-size: 11px; color: #4ade8033; }
        .et-bell-footer { padding: 12px 16px; border-top: 1px solid #0f2a1a; text-align: center; }
        .et-bell-footer a { font-size: 11px; color: #22c55e88; text-decoration: none; letter-spacing: 0.08em; }
        .et-bell-footer a:hover { color: #22c55e; }
        .et-wallet-wrap { position: relative; }
        .et-wallet-btn {
          padding: 7px 14px; border-radius: 6px;
          border: 1px solid #22c55e55; background: transparent;
          color: #22c55e; cursor: pointer; font-family: 'DM Mono', monospace;
          font-size: 11px; letter-spacing: 0.08em; transition: all 0.2s; white-space: nowrap;
          display: flex; align-items: center; gap: 6px;
        }
        .et-wallet-btn:hover     { background: #0d2e1f; border-color: #22c55e; }
        .et-wallet-btn.connected { background: #0d2e1f; border-color: #16a34a; color: #4ade80; }
        .et-wallet-btn:disabled  { opacity: 0.5; cursor: not-allowed; }
        .et-wallet-dropdown {
          position: absolute; top: calc(100% + 10px); right: 0; width: 260px;
          background: #0a0f0c; border: 1px solid #0f2a1a; border-radius: 12px;
          box-shadow: 0 16px 48px rgba(0,0,0,0.7); z-index: 2000;
          animation: dropIn 0.2s ease; overflow: hidden;
        }
        .et-wallet-drop-header { padding: 14px 16px; border-bottom: 1px solid #0f2a1a; display: flex; align-items: center; justify-content: space-between; }
        .et-wallet-drop-title { font-size: 11px; color: #f0fdf4; font-weight: 700; letter-spacing: 0.1em; }
        .et-wallet-drop-status { font-size: 9px; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.08em; }
        .et-wallet-drop-status.on  { background: #0d2e1f; color: #22c55e; border: 1px solid #22c55e33; }
        .et-wallet-drop-status.off { background: #1a0a0a; color: #f87171; border: 1px solid #f8717133; }
        .et-wallet-drop-connect { padding: 24px 16px; text-align: center; }
        .et-wallet-drop-icon { font-size: 32px; margin-bottom: 10px; }
        .et-wallet-drop-desc { font-size: 10px; color: #4ade8055; margin-bottom: 16px; line-height: 1.6; letter-spacing: 0.04em; }
        .et-wallet-connect-btn {
          width: 100%; padding: 11px; border-radius: 8px; border: none;
          background: linear-gradient(135deg, #16a34a, #15803d);
          color: #fff; cursor: pointer; font-family: 'DM Mono', monospace;
          font-size: 12px; font-weight: 700; letter-spacing: 0.1em; transition: opacity 0.2s;
        }
        .et-wallet-connect-btn:hover    { opacity: 0.85; }
        .et-wallet-connect-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .et-wallet-drop-body { padding: 14px 16px; }
        .et-wallet-addr { font-size: 10px; color: #4ade8088; letter-spacing: 0.06em; margin-bottom: 14px; word-break: break-all; line-height: 1.5; padding: 8px 10px; background: #060a07; border-radius: 6px; border: 1px solid #0f2a1a; }
        .et-wallet-stat { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #0f2a1a18; }
        .et-wallet-stat:last-of-type { border-bottom: none; }
        .et-wallet-stat-label { font-size: 10px; color: #4ade8044; letter-spacing: 0.08em; }
        .et-wallet-stat-value { font-size: 12px; color: #f0fdf4; font-weight: 700; letter-spacing: 0.04em; }
        .et-wallet-stat-value.green { color: #22c55e; }
        .et-wallet-drop-footer { padding: 12px 16px; border-top: 1px solid #0f2a1a; }
        .et-wallet-disconnect-btn {
          width: 100%; padding: 9px; border-radius: 6px;
          border: 1px solid #dc262633; background: transparent;
          color: #f8717166; cursor: pointer; font-family: 'DM Mono', monospace;
          font-size: 11px; letter-spacing: 0.08em; transition: all 0.2s;
        }
        .et-wallet-disconnect-btn:hover { background: #450a0a; border-color: #dc2626; color: #f87171; }
        .et-login-btn {
          padding: 7px 16px; border-radius: 6px; border: 1px solid #0f2a1a;
          background: transparent; color: #4ade8088; cursor: pointer;
          font-family: 'DM Mono', monospace; font-size: 11px; letter-spacing: 0.08em;
          transition: all 0.2s; text-decoration: none; display: inline-flex; align-items: center;
        }
        .et-login-btn:hover { color: #22c55e; border-color: #22c55e44; background: #0d2e1f; }
        .et-signup-btn {
          padding: 7px 16px; border-radius: 6px; border: 1px solid #22c55e55;
          background: linear-gradient(135deg, #16a34a, #15803d);
          color: #fff; cursor: pointer; font-family: 'DM Mono', monospace;
          font-size: 11px; letter-spacing: 0.08em; transition: opacity 0.2s;
          text-decoration: none; display: inline-flex; align-items: center;
        }
        .et-signup-btn:hover { opacity: 0.85; }
        .et-logout-btn {
          padding: 7px 14px; border-radius: 6px; border: 1px solid #dc262633;
          background: transparent; color: #f8717166; cursor: pointer;
          font-family: 'DM Mono', monospace; font-size: 11px; letter-spacing: 0.08em; transition: all 0.2s;
        }
        .et-logout-btn:hover { background: #450a0a; border-color: #dc2626; color: #f87171; }
        .et-hamburger { display: none; flex-direction: column; gap: 4px; cursor: pointer; padding: 4px; background: none; border: none; }
        .et-hamburger span { display: block; width: 20px; height: 2px; background: #4ade8088; border-radius: 2px; transition: all 0.3s; }
        .et-hamburger.open span:nth-child(1) { transform: rotate(45deg) translate(4px,4px); }
        .et-hamburger.open span:nth-child(2) { opacity: 0; }
        .et-hamburger.open span:nth-child(3) { transform: rotate(-45deg) translate(4px,-4px); }
        .et-mobile-menu {
          position: fixed; top: 60px; left: 0; right: 0; background: #080c0af5;
          border-bottom: 1px solid #0f2a1a; backdrop-filter: blur(12px);
          padding: 16px 24px 20px; display: flex; flex-direction: column; gap: 4px;
          z-index: 999; animation: menuSlide 0.2s ease;
        }
        .et-mobile-nav-link { padding: 12px 16px; border-radius: 6px; font-size: 12px; letter-spacing: 0.1em; color: #4ade8077; text-decoration: none; transition: all 0.2s; border: 1px solid transparent; }
        .et-mobile-nav-link:hover  { color: #22c55e; background: #0d2e1f; border-color: #16a34a22; }
        .et-mobile-nav-link.active { color: #22c55e; background: #0d2e1f; border-color: #16a34a22; }
        .et-mobile-divider { height: 1px; background: #0f2a1a; margin: 8px 0; }
        .et-bind-pill { font-size: 9px; padding: 2px 7px; border-radius: 10px; background: #0d2e1f; color: #22c55e88; border: 1px solid #22c55e22; margin-left: 4px; }
        @keyframes dropIn    { from{opacity:0;transform:translateY(-8px);} to{opacity:1;transform:translateY(0);} }
        @keyframes menuSlide { from{opacity:0;transform:translateY(-8px);} to{opacity:1;transform:translateY(0);} }
        @media (max-width: 768px) {
          .et-header-nav { display: none; }
          .et-hamburger  { display: flex; }
          .et-live { display: none; }
          .et-header-divider { display: none; }
          .et-wallet-dropdown { right: -60px; width: 240px; }
          .et-bell-dropdown   { width: 300px; right: -40px; }
        }
        @media (min-width: 769px) { .et-mobile-menu { display: none !important; } }
        .et-header-spacer { height: 60px; }
      `}</style>

      C:\Users\ASUS\Desktop\EtherTrack\src\Images\et_logo_bg.png

      <header className={`et-header${scrolled ? ' scrolled' : ''}`}>
        <div className="et-header-inner">

          <Link to={isAuthenticated ? '/dashboard' : '/'} className="et-header-brand">
            <img src={require('../Images/et_logo_bg.png')} alt="EtherTrack"
              style={{ height:'42px', width:'auto', objectFit:'contain', mixBlendMode:'screen' }} />
          </Link>

          {isAuthenticated && (
            <nav className="et-header-nav">
              {navLinks.map(({ to, label }) => (
                <Link key={to} to={to} className={`et-nav-link${isActive(to) ? ' active' : ''}`}>{label}</Link>
              ))}
            </nav>
          )}

          <div className="et-header-right">
            {isAuthenticated ? (
              <>
                <span className="et-live"><span className="et-live-dot" />LIVE</span>
                <div className="et-header-divider" />

                {/* Bell */}
                <div className="et-bell-wrap" ref={bellRef}>
                  <button className="et-bell-btn" onClick={() => { setBellOpen(o => !o); setWalletOpen(false); }}>
                    🔔
                    {unreadCount > 0 && <span className="et-bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                  </button>
                  {bellOpen && (
                    <div className="et-bell-dropdown">
                      <div className="et-bell-top">
                        <span className="et-bell-top-title">NOTIFICATIONS{unreadCount > 0 ? ` (${unreadCount})` : ''}</span>
                        {unreadCount > 0 && <button className="et-bell-mark-all" onClick={markAllRead}>Mark all read</button>}
                      </div>
                      <div className="et-bell-list">
                        {notifications.slice(0,5).length === 0
                          ? <div className="et-bell-empty">🎉 All caught up!</div>
                          : notifications.slice(0,5).map(n => {
                              const meta = getTypeMeta(n.type);
                              return (
                                <div key={n.id} className={`et-bell-item${!n.read?' unread':''}`} onClick={() => markRead(n.id)}>
                                  <div className="et-bell-item-icon">{meta.icon}</div>
                                  <div className="et-bell-item-body">
                                    <div className="et-bell-item-title">{n.title}</div>
                                    <div className="et-bell-item-msg">{n.message}</div>
                                    <div className="et-bell-item-time">{timeAgo(n.time)}</div>
                                  </div>
                                  {!n.read && <div className="et-bell-unread-dot"/>}
                                  <button className="et-bell-del" onClick={e=>{e.stopPropagation();deleteOne(n.id);}}>✕</button>
                                </div>
                              );
                            })
                        }
                      </div>
                      <div className="et-bell-footer">
                        <Link to="/notifications" onClick={() => setBellOpen(false)}>VIEW ALL NOTIFICATIONS →</Link>
                      </div>
                    </div>
                  )}
                </div>

                <div className="et-header-divider" />

                {/* Wallet */}
                <div className="et-wallet-wrap" ref={walletRef}>
                  <button
                    className={`et-wallet-btn${isConnected ? ' connected' : ''}`}
                    onClick={() => { setWalletOpen(o => !o); setBellOpen(false); }}
                  >
                    👛
                    {isConnected
                      ? <>
                          {`WALLET · ${shortAddress}`}
                          {/* Show bound indicator */}
                          {walletBound && <span className="et-bind-pill">BOUND</span>}
                          {binding && <span className="et-bind-pill" style={{color:'#facc15',borderColor:'#facc1522'}}>BINDING...</span>}
                        </>
                      : 'WALLET'
                    }
                  </button>

                  {walletOpen && (
                    <div className="et-wallet-dropdown">
                      <div className="et-wallet-drop-header">
                        <span className="et-wallet-drop-title">MY WALLET</span>
                        <span className={`et-wallet-drop-status ${isConnected ? 'on' : 'off'}`}>
                          {isConnected ? '● CONNECTED' : '○ NOT CONNECTED'}
                        </span>
                      </div>

                      {!isConnected ? (
                        <div className="et-wallet-drop-connect">
                          <div className="et-wallet-drop-icon">🦊</div>
                          <div className="et-wallet-drop-desc">
                            Connect your MetaMask wallet to trade carbon credits.<br/>
                            Your wallet will be <strong style={{color:'#22c55e88'}}>automatically linked</strong> to your account.
                          </div>
                          <button className="et-wallet-connect-btn" onClick={handleConnect} disabled={isConnecting}>
                            {isConnecting ? 'CONNECTING...' : 'CONNECT METAMASK →'}
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="et-wallet-drop-body">
                            <div className="et-wallet-addr">📍 {address}</div>
                            <div className="et-wallet-stat">
                              <span className="et-wallet-stat-label">BALANCE</span>
                              <span className="et-wallet-stat-value green">{balance} ETH</span>
                            </div>
                            <div className="et-wallet-stat">
                              <span className="et-wallet-stat-label">VALUE (INR)</span>
                              <span className="et-wallet-stat-value">₹{balanceINR}</span>
                            </div>
                            <div className="et-wallet-stat">
                              <span className="et-wallet-stat-label">NETWORK</span>
                              <span className="et-wallet-stat-value">{network || 'Unknown'}</span>
                            </div>
                            <div className="et-wallet-stat">
                              <span className="et-wallet-stat-label">ACCOUNT LINK</span>
                              <span className="et-wallet-stat-value" style={{fontSize:10}}>
                                {walletBound
                                  ? <span style={{color:'#22c55e'}}>✅ BOUND</span>
                                  : binding
                                    ? <span style={{color:'#facc15'}}>⟳ LINKING...</span>
                                    : <span style={{color:'#f87171'}}>NOT LINKED</span>
                                }
                              </span>
                            </div>
                          </div>
                          <div className="et-wallet-drop-footer">
                            <button className="et-wallet-disconnect-btn"
                              onClick={() => { disconnect(); setWalletOpen(false); }}>
                              DISCONNECT WALLET
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="et-header-divider" />
                <button className="et-logout-btn" onClick={handleLogoutClick}>LOGOUT</button>
                <button className={`et-hamburger${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(o => !o)}>
                  <span /><span /><span />
                </button>
              </>
            ) : (
              <>
                <Link to="/login"  className="et-login-btn">LOGIN</Link>
                <Link to="/signup" className="et-signup-btn">GET STARTED →</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {isAuthenticated && menuOpen && (
        <div className="et-mobile-menu">
          {navLinks.map(({ to, label }) => (
            <Link key={to} to={to} className={`et-mobile-nav-link${isActive(to) ? ' active' : ''}`}>{label}</Link>
          ))}
          <div className="et-mobile-divider" />
          <button
            className="et-mobile-nav-link"
            style={{background:'none',border:'none',cursor:'pointer',textAlign:'left',color:'#f8717166',fontFamily:'inherit',letterSpacing:'0.1em',fontSize:'12px'}}
            onClick={handleLogoutClick}
          >LOGOUT</button>
        </div>
      )}

      <div className="et-header-spacer" />
    </>
  );
};

export default Header;