import React, { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { usePortfolio } from '../context/PortfolioContext';

const Profile = () => {
  const { user, dbUser, handleLogout } = useContext(AuthContext);
  const { myCredits, tradeHistory, stats, walletAddress: connectedWallet } = usePortfolio();
  const navigate = useNavigate();
  const [walletCopied, setWalletCopied] = useState(false);

  const name        = dbUser?.full_name    || user?.name  || '—';
  const email       = dbUser?.email        || user?.email || '—';
  const company     = dbUser?.company_name || '—';
  const role        = dbUser?.role         || 'user';
  const kycVerified = !!dbUser?.kyc_verified;
  const kycDate     = dbUser?.kyc_submitted_at
    ? new Date(dbUser.kyc_submitted_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
    : '—';
  const wallet      = dbUser?.wallet_address || connectedWallet || null;
  const memberSince = dbUser?.created_at
    ? new Date(dbUser.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
    : '—';

  const initials = name !== '—'
    ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  const totalCreditsOwned = stats?.totalCredits  || 0;
  const totalTradesCount  = tradeHistory?.length  || 0;
  const totalRetiredCount = myCredits?.reduce((s, c) => s + (c.totalRetired || 0), 0) || 0;
  const portfolioValue    = stats?.totalValue     || 0;

  const copyWallet = () => {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet);
    setWalletCopied(true);
    setTimeout(() => setWalletCopied(false), 2000);
  };

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
    *{box-sizing:border-box;}
    .ep{min-height:100vh;background:#060908;font-family:'DM Mono',monospace;color:#f0fdf4;position:relative;}
    .ep::before{content:'';position:fixed;inset:0;z-index:0;
      background-image:linear-gradient(rgba(34,197,94,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,0.025) 1px,transparent 1px);
      background-size:44px 44px;pointer-events:none;}
    .ep-wrap{position:relative;z-index:1;max-width:860px;margin:0 auto;padding:40px 24px 80px;}
    .ep-label{font-size:9px;color:#4ade8077;letter-spacing:.2em;margin-bottom:6px;}
    .ep-title{font-size:28px;font-weight:500;color:#f0fdf4;margin-bottom:2px;letter-spacing:.02em;}
    .ep-title span{color:#22c55e;}
    .ep-sub{font-size:10px;color:#4ade8066;letter-spacing:.1em;margin-bottom:32px;}
    .ep-hero{background:#080c0a;border:1px solid #0f2a1a;border-radius:16px;padding:28px 32px;
      display:flex;align-items:center;gap:24px;margin-bottom:16px;animation:fadeUp .35s ease both;}
    .ep-avatar{width:76px;height:76px;border-radius:50%;flex-shrink:0;
      background:linear-gradient(135deg,#16a34a,#052e16);border:2px solid #22c55e44;
      display:flex;align-items:center;justify-content:center;
      font-size:26px;font-weight:500;color:#22c55e;position:relative;}
    .ep-avatar-ring{position:absolute;inset:-4px;border-radius:50%;
      border:1px solid #22c55e22;animation:ringPulse 3s ease infinite;}
    .ep-info{flex:1;min-width:0;}
    .ep-name{font-size:22px;font-weight:500;color:#f0fdf4;margin-bottom:3px;letter-spacing:.01em;}
    .ep-email{font-size:11px;color:#86efac88;margin-bottom:10px;}
    .ep-badges{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
    .ep-badge{display:inline-flex;align-items:center;gap:4px;font-size:9px;padding:3px 9px;border-radius:4px;letter-spacing:.08em;}
    .ep-badge-kyc-ok{background:#0d2e1f;color:#22c55e;border:1px solid #22c55e33;}
    .ep-badge-kyc-no{background:#1a1500;color:#facc15;border:1px solid #facc1533;cursor:pointer;}
    .ep-badge-chain{background:#0a1628;color:#60a5faaa;border:1px solid #60a5fa22;}
    .ep-badge-role{background:#120a28;color:#a78bfaaa;border:1px solid #7c3aed22;}
    .ep-hero-actions{display:flex;flex-direction:column;gap:8px;flex-shrink:0;}
    .ep-edit-btn{padding:9px 18px;border-radius:7px;border:1px solid #22c55e44;
      background:transparent;color:#22c55e;cursor:pointer;
      font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;transition:all .2s;}
    .ep-edit-btn:hover{background:#0d2e1f;border-color:#22c55e;}
    .ep-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;animation:fadeUp .35s ease .06s both;}
    .ep-stat{background:#080c0a;border:1px solid #0f2a1a;border-radius:12px;padding:18px 14px;text-align:center;transition:border-color .2s;cursor:default;}
    .ep-stat:hover{border-color:#22c55e22;}
    .ep-stat-icon{font-size:22px;margin-bottom:8px;}
    .ep-stat-val{font-size:20px;font-weight:500;margin-bottom:3px;letter-spacing:.02em;}
    .ep-stat-lbl{font-size:8px;color:#86efac66;letter-spacing:.12em;}
    .ep-table{background:#080c0a;border:1px solid #0f2a1a;border-radius:12px;overflow:hidden;margin-bottom:16px;animation:fadeUp .35s ease .12s both;}
    .ep-table-hdr{padding:14px 20px;border-bottom:1px solid #0f2a1a;font-size:10px;color:#f0fdf4;font-weight:500;letter-spacing:.12em;display:flex;align-items:center;justify-content:space-between;}
    .ep-row{display:flex;align-items:center;justify-content:space-between;padding:13px 20px;border-bottom:1px solid #0f2a1a0a;transition:background .15s;}
    .ep-row:hover{background:#0f1a1218;}
    .ep-row:last-child{border-bottom:none;}
    .ep-row-key{font-size:9px;color:#86efac77;letter-spacing:.12em;}
    .ep-row-val{font-size:11px;color:#f0fdf4;font-weight:500;display:flex;align-items:center;gap:8px;}
    .ep-row-val.green{color:#22c55e;}
    .ep-row-val.muted{color:#86efac99;}
    .ep-copy-btn{background:none;border:1px solid #0f2a1a;border-radius:4px;color:#4ade8044;cursor:pointer;padding:2px 7px;font-size:9px;font-family:'DM Mono',monospace;transition:all .15s;letter-spacing:.06em;}
    .ep-copy-btn:hover{border-color:#22c55e33;color:#22c55e;}
    .ep-copy-btn.copied{border-color:#22c55e44;color:#22c55e;}
    /* Quick actions — 4 cols to fit Help */
    .ep-actions{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;animation:fadeUp .35s ease .18s both;}
    .ep-action{background:#080c0a;border:1px solid #0f2a1a;border-radius:10px;padding:16px;text-align:center;cursor:pointer;transition:all .2s;}
    .ep-action:hover{border-color:#22c55e22;background:#0d2e1f1a;transform:translateY(-1px);}
    .ep-action.help{border-color:#60a5fa22;}
    .ep-action.help:hover{border-color:#60a5fa55;background:#0a162822;}
    .ep-action-icon{font-size:20px;margin-bottom:6px;}
    .ep-action-lbl{font-size:9px;color:#86efac88;letter-spacing:.1em;}
    .ep-action.help .ep-action-lbl{color:#60a5fa88;}
    .ep-bottom{display:grid;grid-template-columns:1fr 1fr;gap:10px;animation:fadeUp .35s ease .22s both;}
    .ep-logout{padding:12px;border-radius:8px;border:1px solid #dc262633;background:transparent;color:#f8717199;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;transition:all .2s;}
    .ep-logout:hover{background:#450a0a;border-color:#dc2626;color:#f87171;}
    .ep-delete{padding:12px;border-radius:8px;border:1px solid #7c3aed22;background:transparent;color:#7c3aed99;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;transition:all .2s;}
    .ep-delete:hover{background:#1a0a2e;border-color:#7c3aed55;color:#a78bfa;}
    .ep-privacy{margin-top:12px;padding:14px 16px;border-radius:8px;background:#040706;border:1px solid #0f2a1a08;font-size:9px;color:#86efac55;line-height:1.9;letter-spacing:.03em;animation:fadeUp .35s ease .26s both;}
    .ep-privacy b{color:#22c55e99;}
    .ep-member{margin-bottom:16px;padding:10px 16px;border-radius:8px;background:#040706;border:1px solid #0f2a1a;display:flex;justify-content:space-between;align-items:center;font-size:9px;animation:fadeUp .35s ease .09s both;}
    @keyframes fadeUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
    @keyframes ringPulse{0%,100%{opacity:.3;}50%{opacity:.7;}}
    @media(max-width:640px){
      .ep-hero{flex-direction:column;text-align:center;}
      .ep-badges{justify-content:center;}
      .ep-stats{grid-template-columns:repeat(2,1fr);}
      .ep-actions{grid-template-columns:repeat(2,1fr);}
      .ep-bottom{grid-template-columns:1fr;}
    }
  `;

  return (
    <>
      <style>{CSS}</style>
      <div className="ep">
        <div className="ep-wrap">

          <div className="ep-label">ETHERTRACK · MY ACCOUNT</div>
          <div className="ep-title">Your <span>Profile</span></div>
          <div className="ep-sub">
            {kycVerified ? 'KYC VERIFIED · BLOCKCHAIN IDENTITY CONFIRMED' : 'COMPLETE KYC TO UNLOCK TRADING'}
          </div>

          {/* Hero */}
          <div className="ep-hero">
            <div className="ep-avatar">
              <div className="ep-avatar-ring"/>
              {initials}
            </div>
            <div className="ep-info">
              <div className="ep-name">{name}</div>
              <div className="ep-email">{email}</div>
              <div className="ep-badges">
                {kycVerified
                  ? <span className="ep-badge ep-badge-kyc-ok">✅ KYC VERIFIED</span>
                  : <span className="ep-badge ep-badge-kyc-no" onClick={() => navigate('/kyc')}>⏳ COMPLETE KYC →</span>
                }
                {wallet && <span className="ep-badge ep-badge-chain">⛓ SEPOLIA BOUND</span>}
                <span className="ep-badge ep-badge-role">👤 {role.toUpperCase()}</span>
              </div>
            </div>
            <div className="ep-hero-actions">
              <button className="ep-edit-btn" onClick={() => navigate('/edit-profile')}>EDIT PROFILE →</button>
              {!kycVerified && (
                <button className="ep-edit-btn" style={{ borderColor:'#facc1533', color:'#facc15' }} onClick={() => navigate('/kyc')}>
                  VERIFY KYC →
                </button>
              )}
            </div>
          </div>

          {/* Member since strip */}
          <div className="ep-member">
            <span style={{ color:'#86efac66' }}>MEMBER SINCE</span>
            <span style={{ color:'#86efac99' }}>{memberSince}</span>
            <span style={{ color:'#86efac66' }}>USER ID</span>
            <span style={{ color:'#86efac77', fontSize:8 }}>{dbUser?.id?.slice(0,8).toUpperCase() || '—'}</span>
            <span style={{ color:'#86efac66' }}>NETWORK</span>
            <span style={{ color:'#60a5fa99' }}>ETHEREUM SEPOLIA</span>
          </div>

          {/* Stats */}
          <div className="ep-stats">
            {[
              { icon:'🔐', label:'KYC STATUS',     val: kycVerified ? 'VERIFIED' : 'PENDING', color: kycVerified ? '#22c55e' : '#facc15' },
              { icon:'🌿', label:'CREDITS OWNED',   val: totalCreditsOwned || '—',             color:'#22c55e' },
              { icon:'📈', label:'TRADES EXECUTED', val: totalTradesCount  || '—',             color:'#60a5fa' },
              { icon:'🔥', label:'tCO₂ RETIRED',    val: totalRetiredCount || '—',             color:'#f87171' },
            ].map(({ icon, label, val, color }) => (
              <div className="ep-stat" key={label}>
                <div className="ep-stat-icon">{icon}</div>
                <div className="ep-stat-val" style={{ color }}>{val}</div>
                <div className="ep-stat-lbl">{label}</div>
              </div>
            ))}
          </div>

          {/* Info table */}
          <div className="ep-table">
            <div className="ep-table-hdr">
              ACCOUNT INFORMATION
              {!kycVerified && (
                <span style={{ fontSize:9, color:'#facc15cc', cursor:'pointer' }} onClick={() => navigate('/kyc')}>
                  COMPLETE KYC →
                </span>
              )}
            </div>
            {[
              { key:'FULL NAME',  val: name },
              { key:'EMAIL',      val: email },
              { key:'COMPANY',    val: company },
              { key:'ROLE',       val: role.toUpperCase(), muted: true },
              { key:'KYC STATUS', val: kycVerified ? '✅ VERIFIED' : '⏳ PENDING', green: kycVerified },
              { key:'KYC DATE',   val: kycDate, muted: true },
              { key:'PORTFOLIO',  val: portfolioValue > 0 ? `₹${portfolioValue.toLocaleString('en-IN', { maximumFractionDigits:0 })}` : '—', muted: true },
            ].map(({ key, val, green, muted }) => (
              <div className="ep-row" key={key}>
                <span className="ep-row-key">{key}</span>
                <span className={`ep-row-val${green ? ' green' : muted ? ' muted' : ''}`}>{val}</span>
              </div>
            ))}
            <div className="ep-row">
              <span className="ep-row-key">WALLET</span>
              <span className="ep-row-val">
                {wallet ? (
                  <>
                    <span style={{ fontSize:10, fontFamily:'monospace', color:'#86efaccc' }}>
                      {wallet.slice(0,6)}...{wallet.slice(-4)}
                    </span>
                    <button className={`ep-copy-btn${walletCopied ? ' copied' : ''}`} onClick={copyWallet} title="Copy full address">
                      {walletCopied ? '✓ COPIED' : 'COPY'}
                    </button>
                    {kycVerified && <span style={{ fontSize:8, color:'#22c55e99', letterSpacing:'.06em' }}>⛓ ON-CHAIN</span>}
                  </>
                ) : (
                  <span style={{ color:'#86efac66', fontSize:10 }}>NOT CONNECTED</span>
                )}
              </span>
            </div>
          </div>

          {/* Quick actions — 4 cols (7 items + Help) */}
          <div className="ep-actions">
            {[
              { icon:'📈', label:'MARKET',    path:'/carbon-credits',    cls:'' },
              { icon:'🌿', label:'EMISSIONS', path:'/emission-tracking', cls:'' },
              { icon:'📊', label:'HISTORY',   path:'/trading-history',   cls:'' },
              { icon:'💼', label:'PORTFOLIO', path:'/portfolio',         cls:'' },
              { icon:'🔔', label:'ALERTS',    path:'/notifications',     cls:'' },
              { icon:'⚙️', label:'SETTINGS',  path:'/settings',          cls:'' },
              { icon:'💰', label:'WALLET',    path:'/wallet',            cls:'' },
              { icon:'📘', label:'HELP',      path:'/help',              cls:'help' },
            ].map(({ icon, label, path, cls }) => (
              <div key={label} className={`ep-action${cls ? ` ${cls}` : ''}`} onClick={() => navigate(path)}>
                <div className="ep-action-icon">{icon}</div>
                <div className="ep-action-lbl">{label}</div>
              </div>
            ))}
          </div>

          {/* Logout + Delete */}
          <div className="ep-bottom">
            <button className="ep-logout" onClick={() => { handleLogout(); navigate('/login'); }}>
              🚪 LOGOUT FROM ETHERTRACK
            </button>
            <button className="ep-delete" onClick={() => {
              if (window.confirm('Request account deletion? All your data will be permanently removed. This cannot be undone.')) {
                alert('Please email support@ethertrack.in with subject "Account Deletion Request". We will process it within 72 hours as per DPDP Act 2023.');
              }
            }}>
              🗑 REQUEST ACCOUNT DELETION
            </button>
          </div>

          {/* Privacy notice */}
          <div className="ep-privacy">
            🔒 <b>DATA PRIVACY</b> — Your Aadhaar and PAN numbers are <b>never stored</b> on our servers or on the blockchain.
            Only one-way cryptographic hashes (keccak256) are retained solely for duplicate KYC prevention.
            Document photos are verified in-session and immediately discarded — never uploaded or persisted.
            Your identity is anchored on-chain via wallet address only. Compliant with <b>DPDP Act 2023</b>, <b>IT Act 2000 §43A</b>, and <b>UIDAI guidelines</b>.
          </div>

        </div>
      </div>
    </>
  );
};

export default Profile;