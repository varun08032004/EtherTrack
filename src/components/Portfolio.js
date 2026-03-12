import React, { useState, useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { usePortfolio, vintagePenalty } from '../context/PortfolioContext';
import { txAPI, apiFetch } from '../services/api';

const REGISTRIES = {
  VCS: { label: 'Verra VCS',                color: '#22c55e', bg: '#0d2e1f' },
  GS:  { label: 'Gold Standard',            color: '#facc15', bg: '#1a1500' },
  CDM: { label: 'Clean Dev. Mechanism',     color: '#60a5fa', bg: '#0a1628' },
  ACR: { label: 'American Carbon Registry', color: '#a78bfa', bg: '#120a28' },
};

const PROJECT_TYPES = [
  'Renewable Energy','Reforestation','REDD+','Methane Capture',
  'Energy Efficiency','Blue Carbon','Cookstoves','Soil Carbon',
  'Industrial Gas','Avoided Deforestation',
];

const emptyForm = {
  projectName:'', location:'', country:'', standard:'VCS',
  projectType:'', developer:'', credits:'', vintageYear:'',
  expiryDate:'', serialNumber:'', registryName:'', docFile: null,
};

// ── Credit Score Panel ────────────────────────────────────────────
function CreditScorePanel({ stats, myCredits }) {
  const total    = stats.totalCredits || 0;
  const retired  = stats.retiredCount || 0;
  const listed   = stats.listedCount  || 0;
  const verified = myCredits.filter(c => c.admin_status === 'approved').length;

  // Score formula: based on verified credits, retirements, trading activity
  const score = Math.min(850, Math.round(
    (verified  * 2.5) +
    (retired   * 15)  +
    (listed    * 10)  +
    (total > 0 ? Math.log(total + 1) * 40 : 0) +
    200 // base score
  ));

  const pct   = (score / 850) * 100;
  const color = score >= 700 ? '#22c55e' : score >= 500 ? '#facc15' : score >= 300 ? '#f97316' : '#f87171';
  const grade = score >= 700 ? 'EXCELLENT' : score >= 500 ? 'GOOD' : score >= 300 ? 'FAIR' : 'BUILDING';

  // Arc params
  const R = 54, cx = 70, cy = 70;
  const startAngle = -210, totalArc = 240;
  const toRad = d => (d * Math.PI) / 180;
  const arcX  = (a) => cx + R * Math.cos(toRad(a));
  const arcY  = (a) => cy + R * Math.sin(toRad(a));
  const endAngle = startAngle + (totalArc * pct) / 100;
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  const trackD = `M ${arcX(startAngle)} ${arcY(startAngle)} A ${R} ${R} 0 1 1 ${arcX(startAngle + totalArc)} ${arcY(startAngle + totalArc)}`;
  const fillD  = pct > 0
    ? `M ${arcX(startAngle)} ${arcY(startAngle)} A ${R} ${R} 0 ${largeArc} 1 ${arcX(endAngle)} ${arcY(endAngle)}`
    : '';

  return (
    <div style={{
      background:'#0a0f0c', border:'1px solid #0f2a1a', borderRadius:14,
      padding:'20px 24px', marginBottom:24, display:'flex',
      alignItems:'center', gap:32, flexWrap:'wrap',
      animation:'fu .4s ease .08s both',
    }}>
      {/* Arc gauge */}
      <div style={{ position:'relative', flexShrink:0 }}>
        <svg width={140} height={90} viewBox="0 0 140 90">
          <path d={trackD} fill="none" stroke="#0f2a1a" strokeWidth={10} strokeLinecap="round"/>
          {fillD && <path d={fillD} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round"
            style={{ filter:`drop-shadow(0 0 6px ${color}88)` }}/>}
          <text x={cx} y={cy+4}  textAnchor="middle" fill={color}  fontSize={22} fontWeight={700} fontFamily="'DM Mono',monospace">{score}</text>
          <text x={cx} y={cy+18} textAnchor="middle" fill={color+'88'} fontSize={8}  fontFamily="'DM Mono',monospace" letterSpacing={2}>{grade}</text>
        </svg>
        <div style={{ textAlign:'center', fontSize:9, color:'#86efac44', letterSpacing:'.12em', marginTop:-8 }}>
          CARBON SCORE
        </div>
      </div>

      {/* Score breakdown */}
      <div style={{ flex:1, minWidth:200 }}>
        <div style={{ fontSize:11, color:'#f0fdf4', fontWeight:500, marginBottom:12, letterSpacing:'.04em' }}>
          Score Breakdown <span style={{ fontSize:9, color:'#86efac44' }}>/ 850</span>
        </div>
        {[
          { label:'Verified Credits',    val: verified,  max: 50,   pts: Math.round(verified * 2.5),   color:'#22c55e' },
          { label:'Credits Retired',     val: retired,   max: 20,   pts: Math.round(retired * 15),     color:'#a78bfa' },
          { label:'Active Listings',     val: listed,    max: 20,   pts: Math.round(listed * 10),      color:'#facc15' },
          { label:'Portfolio Volume',    val: `${total}t`, max: null, pts: Math.round(Math.log(total+1)*40), color:'#60a5fa' },
        ].map(({ label, val, pts, color: c }) => (
          <div key={label} style={{ marginBottom:8 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
              <span style={{ fontSize:9, color:'#86efac66', letterSpacing:'.08em' }}>{label}</span>
              <span style={{ fontSize:9, color: c }}>+{pts} pts</span>
            </div>
            <div style={{ height:3, background:'#0f2a1a', borderRadius:2 }}>
              <div style={{ height:'100%', width:`${Math.min(100,(pts/200)*100)}%`, background:c, borderRadius:2, transition:'width .6s ease' }}/>
            </div>
          </div>
        ))}
      </div>

      {/* ESG tag */}
      <div style={{ display:'flex', flexDirection:'column', gap:8, flexShrink:0 }}>
        {[
          { label:'ESG READY',     ok: score >= 400 },
          { label:'SCOPE 3 OFFSET',ok: retired > 0  },
          { label:'REGISTRY VERIF',ok: verified > 0 },
          { label:'MARKET ACTIVE', ok: listed > 0   },
        ].map(({ label, ok }) => (
          <div key={label} style={{
            fontSize:9, padding:'4px 10px', borderRadius:4, letterSpacing:'.08em',
            background: ok ? '#0d2e1f' : '#0a0a0a',
            color:       ok ? '#22c55e' : '#86efac22',
            border:      `1px solid ${ok ? '#22c55e33' : '#0f2a1a'}`,
          }}>
            {ok ? '✓' : '○'} {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Retirement Certificate ────────────────────────────────────────
function RetirementCertificate({ credit, txHash, onClose }) {
  const date   = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
  const certId = `CERT-${(credit.tokenId||'').slice(2,10)||'XXXXXX'}-${Date.now().toString(36).toUpperCase()}`;
  const reg    = REGISTRIES[credit.standard] || REGISTRIES.VCS;

  return (
    <div style={{
      background:'linear-gradient(135deg,#060a07 0%,#0a1209 50%,#060a07 100%)',
      border:'1px solid #22c55e44', borderRadius:16, padding:32,
      position:'relative', overflow:'hidden',
    }}>
      <div style={{ position:'absolute',inset:0,opacity:.03,pointerEvents:'none',
        backgroundImage:'repeating-linear-gradient(45deg,#22c55e 0,#22c55e 1px,transparent 0,transparent 50%)',
        backgroundSize:'12px 12px' }}/>
      {[{top:0,left:0},{top:0,right:0},{bottom:0,left:0},{bottom:0,right:0}].map((pos,i)=>(
        <div key={i} style={{ position:'absolute',...pos,width:32,height:32,
          borderTop:   i<2  ?'2px solid #22c55e66':'none',
          borderBottom:i>=2 ?'2px solid #22c55e66':'none',
          borderLeft:  i%2===0?'2px solid #22c55e66':'none',
          borderRight: i%2===1?'2px solid #22c55e66':'none' }}/>
      ))}
      <div style={{ position:'relative',zIndex:1 }}>
        <div style={{ textAlign:'center',marginBottom:24 }}>
          <div style={{ fontSize:10,color:'#22c55e88',letterSpacing:'.2em',marginBottom:8 }}>ETHERTRACK CARBON EXCHANGE</div>
          <div style={{ fontSize:22,fontWeight:700,color:'#f0fdf4',fontFamily:'Syne,sans-serif',marginBottom:4 }}>Carbon Retirement Certificate</div>
          <div style={{ fontSize:10,color:'#86efac66',letterSpacing:'.12em' }}>VERIFIED PERMANENT OFFSET · ISO 14064-3 · ETHEREUM SEPOLIA</div>
        </div>
        <div style={{ display:'flex',alignItems:'center',gap:12,marginBottom:24 }}>
          <div style={{ flex:1,height:1,background:'linear-gradient(90deg,transparent,#22c55e44)' }}/>
          <span style={{ fontSize:18 }}>🌿</span>
          <div style={{ flex:1,height:1,background:'linear-gradient(90deg,#22c55e44,transparent)' }}/>
        </div>
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20 }}>
          {[
            { label:'CERTIFICATE ID',   value:certId,                                  color:'#22c55e' },
            { label:'TOKEN ID',         value:credit.tokenId||'—',                     color:'#60a5fa' },
            { label:'PROJECT NAME',     value:credit.projectName,                      color:'#f0fdf4' },
            { label:'SERIAL NO.',       value:credit.serialNumber,                     color:'#f0fdf4' },
            { label:'REGISTRY',         value:reg.label,                               color:reg.color },
            { label:'STANDARD',         value:credit.standard,                         color:reg.color },
            { label:'CREDITS RETIRED',  value:`${credit.credits?.toLocaleString()} tCO₂`, color:'#22c55e' },
            { label:'VINTAGE YEAR',     value:credit.vintageYear,                      color:'#f0fdf4' },
            { label:'PROJECT TYPE',     value:credit.projectType,                      color:'#f0fdf4' },
            { label:'COUNTRY',          value:credit.country||credit.location,         color:'#f0fdf4' },
            { label:'DEVELOPER',        value:credit.developer,                        color:'#f0fdf4' },
            { label:'RETIREMENT DATE',  value:date,                                    color:'#f0fdf4' },
          ].map(({ label, value, color })=>(
            <div key={label} style={{ background:'#0a0f0c88',borderRadius:8,padding:'10px 14px',border:'1px solid #0f2a1a' }}>
              <div style={{ fontSize:8,color:'#86efac55',letterSpacing:'.12em',marginBottom:4 }}>{label}</div>
              <div style={{ fontSize:11,color,fontWeight:600,wordBreak:'break-all' }}>{value}</div>
            </div>
          ))}
        </div>
        {txHash && (
          <div style={{ background:'#0a0f0c88',borderRadius:8,padding:'10px 14px',border:'1px solid #0f2a1a',marginBottom:16 }}>
            <div style={{ fontSize:8,color:'#86efac55',letterSpacing:'.12em',marginBottom:4 }}>BLOCKCHAIN TX HASH</div>
            <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer"
              style={{ fontSize:10,color:'#60a5fa',fontFamily:'monospace',wordBreak:'break-all',textDecoration:'none' }}>
              {txHash}
            </a>
          </div>
        )}
        {/* ESG Declaration */}
        <div style={{ background:'#0a1628',border:'1px solid #60a5fa22',borderRadius:8,padding:'12px 16px',marginBottom:16 }}>
          <div style={{ fontSize:9,color:'#60a5fa88',letterSpacing:'.12em',marginBottom:8 }}>ESG GOVERNANCE DECLARATION</div>
          <div style={{ fontSize:10,color:'#86efac77',lineHeight:1.8 }}>
            This certificate confirms the permanent retirement of <strong style={{ color:'#22c55e' }}>{credit.credits?.toLocaleString()} tCO₂e</strong> from
            the voluntary carbon market under <strong style={{ color:reg.color }}>{reg.label}</strong> registry.
            These credits are eligible for Scope 1/2/3 emission offset reporting under GHG Protocol and TCFD frameworks.
            Certificate ID <strong style={{ color:'#f0fdf4' }}>{certId}</strong> is immutably recorded on Ethereum Sepolia.
          </div>
        </div>
        <div style={{ background:'#0d2e1f44',border:'1px solid #22c55e33',borderRadius:8,
          padding:'12px 16px',marginBottom:20,display:'flex',alignItems:'flex-start',gap:10 }}>
          <span style={{ fontSize:18,flexShrink:0 }}>✓</span>
          <div>
            <div style={{ fontSize:11,color:'#22c55e',fontWeight:700,marginBottom:3 }}>Registry Verified — {reg.label}</div>
            <div style={{ fontSize:10,color:'#86efac77',lineHeight:1.6 }}>
              {credit.credits?.toLocaleString()} tonnes CO₂ equivalent permanently cancelled and cannot be traded again.
            </div>
          </div>
        </div>
        <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:16,borderTop:'1px solid #0f2a1a' }}>
          <div style={{ fontSize:9,color:'#86efac44',letterSpacing:'.08em' }}>ETHERTRACK · INDIA'S CARBON EXCHANGE · ISO 14064-3</div>
          <button onClick={onClose} style={{ padding:'8px 20px',borderRadius:6,border:'1px solid #22c55e44',
            background:'#0d2e1f',color:'#22c55e',cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10 }}>CLOSE ✕</button>
        </div>
      </div>
    </div>
  );
}

export default function Portfolio() {
  const navigate = useNavigate();
  const { user, dbUser } = useContext(AuthContext);

  const {
    myCredits, stats, loading,
    walletAddress, isKYCVerified,
    listCredit, delistCredit, retireCredit,
    loadMyCredits,
  } = usePortfolio();

  const [activeTab,  setActiveTab]  = useState('ALL');
  const [showForm,   setShowForm]   = useState(false);
  const [showRetire, setShowRetire] = useState(null);
  const [showList,   setShowList]   = useState(null);
  const [showCert,   setShowCert]   = useState(null);
  const [listPrice,  setListPrice]  = useState('');
  const [listQty,    setListQty]    = useState('');
  const [form,       setForm]       = useState(emptyForm);
  const [formErrors, setFormErrors] = useState({});
  const [toast,      setToast]      = useState(null);
  const [txPending,  setTxPending]  = useState('');
  const [submitting, setSubmitting] = useState(false);

  // pending credits from backend
  const [pendingCredits, setPendingCredits] = useState([]);

  useEffect(() => {
    const loadPending = async () => {
      try {
        const d = await apiFetch('/api/portfolio/my-submissions');
        setPendingCredits(d.submissions || []);
      } catch {}
    };
    loadPending();
  }, []);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Tab filtering — merge on-chain + pending ──────────────────
  const allCredits = [
    ...myCredits,
    ...pendingCredits.filter(p =>
      !myCredits.find(c => c.serialNumber === p.registry_serial)
    ).map(p => ({
      id:          p.id,
      projectName: p.project_name,
      location:    p.project_location || '—',
      country:     p.country || '—',
      standard:    p.registry_name || 'VCS',
      projectType: p.project_type || '—',
      developer:   p.developer || '—',
      credits:     p.quantity,
      vintageYear: p.vintage_year,
      serialNumber:p.registry_serial,
      status:      'PENDING',
      admin_status:p.admin_status,
      isPending:   true,
    }))
  ];

  const filtered = allCredits.filter(c => {
    if (activeTab === 'HELD')    return c.status === 'HELD';
    if (activeTab === 'LISTED')  return c.status === 'LISTED';
    if (activeTab === 'RETIRED') return c.status === 'RETIRED';
    if (activeTab === 'PENDING') return c.isPending;
    return true;
  });

  const tabCounts = {
    ALL:     allCredits.length,
    HELD:    allCredits.filter(c => c.status === 'HELD').length,
    LISTED:  allCredits.filter(c => c.status === 'LISTED').length,
    RETIRED: allCredits.filter(c => c.status === 'RETIRED').length,
    PENDING: allCredits.filter(c => c.isPending).length,
  };

  const validateForm = () => {
    const e = {};
    if (!form.projectName.trim())            e.projectName  = 'Required';
    if (!form.location.trim())               e.location     = 'Required';
    if (!form.country.trim())                e.country      = 'Required';
    if (!form.projectType)                   e.projectType  = 'Required';
    if (!form.developer.trim())              e.developer    = 'Required';
    if (!form.credits || +form.credits <= 0) e.credits      = 'Enter valid amount';
    if (!form.vintageYear || isNaN(form.vintageYear)) e.vintageYear = 'Required';
    if (!form.expiryDate)                    e.expiryDate   = 'Required';
    if (!form.serialNumber.trim())           e.serialNumber = 'Required';
    if (!form.registryName.trim())           e.registryName = 'Required';
    if (!form.docFile)                       e.docFile      = 'Ownership proof required';
    setFormErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Upload doc to Pinata ──────────────────────────────────────
  const uploadDocToIPFS = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pinataMetadata', JSON.stringify({
      name: `credit_proof_${dbUser?.id}_${Date.now()}`,
    }));
    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        pinata_api_key:        process.env.REACT_APP_PINATA_API_KEY,
        pinata_secret_api_key: process.env.REACT_APP_PINATA_SECRET_KEY,
      },
      body: formData,
    });
    if (!res.ok) throw new Error('IPFS upload failed');
    const data = await res.json();
    return data.IpfsHash;
  };

  // ── Submit tokenize to backend (pending admin approval) ───────
  const handleRegister = async () => {
    if (!validateForm()) return;
    if (!isKYCVerified) { showToast('❌ Complete KYC verification first', 'error'); return; }
    setSubmitting(true);
    setTxPending('Uploading ownership proof to IPFS...');
    try {
      const docIpfsHash = await uploadDocToIPFS(form.docFile);
      setTxPending('Submitting for admin verification...');
      await apiFetch('/api/portfolio/submit-credit', {
        method: 'POST',
        body: JSON.stringify({
          projectName:     form.projectName,
          projectLocation: form.location,
          country:         form.country,
          standard:        form.standard,
          registryName:    form.registryName,
          projectType:     form.projectType,
          developer:       form.developer,
          quantity:        parseInt(form.credits),
          vintageYear:     parseInt(form.vintageYear),
          expiryDate:      form.expiryDate,
          registrySerial:  form.serialNumber,
          docIpfsHash,
        }),
      });
      setShowForm(false);
      setForm(emptyForm);
      setFormErrors({});
      showToast('✅ Submitted for admin verification! Approval takes 1-2 days.');
      // reload pending
      const d = await apiFetch('/api/portfolio/my-submissions');
      setPendingCredits(d.submissions || []);
    } catch (e) {
      showToast(`❌ ${e.message || 'Submission failed'}`, 'error');
    } finally {
      setSubmitting(false);
      setTxPending('');
    }
  };

  const handleListForSale = async (credit) => {
    if (!listPrice || isNaN(listPrice) || +listPrice <= 0) { showToast('❌ Enter a valid price','error'); return; }
    const qty = parseInt(listQty) || credit.credits;
    if (qty <= 0 || qty > credit.credits) { showToast(`❌ Quantity must be between 1 and ${credit.credits}`,'error'); return; }
    const priceInEth = (+listPrice / 210000).toFixed(6);
    try {
      setTxPending(`Listing "${credit.projectName}" on Ethereum Sepolia...`);
      await listCredit(credit.id, qty, priceInEth);
      setShowList(null); setListPrice(''); setListQty('');
      setActiveTab('LISTED');
      showToast('📈 Listed on blockchain!');
    } catch (e) {
      showToast(`❌ ${e.reason || e.message || 'Transaction failed'}`, 'error');
    } finally { setTxPending(''); }
  };

  const handleDelist = async (credit) => {
    try {
      setTxPending('Cancelling listing on blockchain...');
      await delistCredit(credit.listingId);
      showToast('Credit removed from marketplace.');
    } catch (e) {
      showToast(`❌ ${e.reason || e.message || 'Transaction failed'}`, 'error');
    } finally { setTxPending(''); }
  };

  const handleRetireConfirm = async (credit) => {
    try {
      setTxPending('Burning credit token permanently on Ethereum Sepolia...');
      const result = await retireCredit(credit.id, credit.credits);
      try {
        await txAPI.recordRetirement({
          tokenId: credit.tokenId, projectName: credit.projectName,
          standard: credit.standard, credits: credit.credits,
          vintageYear: credit.vintageYear, serialNumber: credit.serialNumber,
          developer: credit.developer, location: credit.location,
          country: credit.country, projectType: credit.projectType,
          txHash: result.txHash, beneficiary: user?.email || walletAddress,
        });
      } catch (e) { console.warn('Retirement backend sync failed:', e?.message); }
      setShowRetire(null);
      setShowCert({ ...credit, txHash: result.txHash });
      showToast('🌿 Credit permanently retired! Certificate generated.');
    } catch (e) {
      showToast(`❌ ${e.reason || e.message || 'Transaction failed'}`, 'error');
    } finally { setTxPending(''); }
  };

  const handleRefresh = async () => {
    try {
      await loadMyCredits();
      showToast('✅ Portfolio refreshed from blockchain');
    } catch { showToast('❌ Refresh failed', 'error'); }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;}
        .pt{min-height:100vh;background:#040706;font-family:'DM Mono',monospace;position:relative;overflow-x:hidden;}
        .pt::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
          background-image:linear-gradient(rgba(34,197,94,.025) 1px,transparent 1px),
          linear-gradient(90deg,rgba(34,197,94,.025) 1px,transparent 1px);background-size:40px 40px;}
        .ptw{position:relative;z-index:1;max-width:1200px;margin:0 auto;padding:32px 24px 80px;}
        .pt-hdr{margin-bottom:28px;animation:fu .4s ease both;}
        .pt-hdr-label{font-size:9px;color:#86efac44;letter-spacing:.2em;margin-bottom:6px;}
        .pt-hdr-title{font-family:'Syne',sans-serif;font-size:30px;font-weight:800;color:#f0fdf4;margin-bottom:4px;}
        .pt-hdr-title span{color:#22c55e;}
        .pt-hdr-sub{font-size:10px;color:#86efac33;letter-spacing:.1em;}
        .pt-topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;animation:fu .4s ease .05s both;}
        .pt-reg-btn{padding:11px 22px;border-radius:8px;border:none;background:linear-gradient(135deg,#14532d,#166534);color:#d1fae5;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.1em;transition:all .2s;box-shadow:0 4px 20px rgba(0,0,0,.5);}
        .pt-reg-btn:hover{background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;transform:translateY(-1px);}
        .pt-reg-btn:disabled{opacity:.3;cursor:not-allowed;transform:none;}
        .pt-refresh-btn{padding:10px 16px;border-radius:8px;border:1px solid #0f2a1a;background:#060a07;color:#86efac44;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .2s;}
        .pt-refresh-btn:hover:not(:disabled){border-color:#22c55e33;color:#22c55e88;}
        .pt-refresh-btn:disabled{opacity:.3;cursor:not-allowed;}
        .pt-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;animation:fu .4s ease .1s both;}
        .pt-stat{background:#070c09;border:1px solid #0d1f11;border-radius:12px;padding:18px;position:relative;overflow:hidden;transition:border-color .2s;}
        .pt-stat:hover{border-color:#22c55e22;}
        .pt-stat-label{font-size:9px;color:#86efac44;letter-spacing:.14em;margin-bottom:8px;}
        .pt-stat-val{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;line-height:1;margin-bottom:4px;}
        .pt-stat-sub{font-size:9px;color:#86efac33;letter-spacing:.06em;}
        .pt-tabs{display:flex;gap:6px;margin-bottom:20px;animation:fu .4s ease .15s both;flex-wrap:wrap;}
        .pt-tab{padding:8px 18px;border-radius:6px;border:1px solid #0d1f11;background:#060a07;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.1em;color:#86efac33;transition:all .2s;display:flex;align-items:center;gap:7px;}
        .pt-tab:hover{border-color:#22c55e22;color:#86efac66;}
        .pt-tab.active{border-color:#22c55e;color:#22c55e;background:#0a1a0e;}
        .pt-tab-count{font-size:9px;background:#0d1f11;padding:1px 7px;border-radius:10px;}
        .pt-tab.active .pt-tab-count{background:#22c55e22;color:#22c55e;}
        .pt-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;animation:fu .4s ease .2s both;}
        .pt-card{background:#070c09;border:1px solid #0d1f11;border-radius:14px;overflow:hidden;transition:all .25s;position:relative;}
        .pt-card:hover{border-color:#22c55e22;transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,0,0,.6);}
        .pt-card.retired{opacity:.6;}
        .pt-card.pending-approval{border-color:#f59e0b22;}
        .pt-ribbon{position:absolute;top:12px;right:12px;z-index:2;font-size:8px;padding:3px 10px;border-radius:3px;letter-spacing:.12em;font-weight:700;}
        .pt-card-hdr{padding:16px 16px 12px;border-bottom:1px solid #0d1f1122;}
        .pt-card-name{font-size:12px;font-weight:700;color:#f0fdf4;line-height:1.4;margin-bottom:5px;}
        .pt-card-loc{font-size:9px;color:#86efac44;margin-bottom:8px;}
        .pt-card-badges{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
        .pt-meta{display:grid;grid-template-columns:1fr 1fr;}
        .pt-meta-cell{padding:9px 14px;border-bottom:1px solid #0d1f1114;border-right:1px solid #0d1f1114;}
        .pt-meta-cell:nth-child(even){border-right:none;}
        .pt-meta-cell:nth-last-child(-n+2){border-bottom:none;}
        .pt-meta-label{font-size:8px;color:#86efac33;letter-spacing:.1em;margin-bottom:3px;}
        .pt-meta-val{font-size:11px;color:#e2e8e4;font-weight:500;}
        .pt-meta-val.green{color:#22c55e;}.pt-meta-val.blue{color:#60a5fa;}.pt-meta-val.yellow{color:#facc15;}.pt-meta-val.purple{color:#a78bfa;}.pt-meta-val.red{color:#f87171;}
        .pt-meta-full{grid-column:1/-1;border-right:none!important;}
        .pt-dep-badge{display:inline-flex;align-items:center;gap:4px;font-size:9px;padding:2px 7px;border-radius:3px;}
        .pt-verify{display:inline-flex;align-items:center;gap:4px;font-size:9px;padding:2px 8px;border-radius:3px;letter-spacing:.06em;}
        .pt-card-actions{display:flex;gap:6px;padding:12px 14px;border-top:1px solid #0d1f11;background:#050809;}
        .pt-act-btn{flex:1;padding:9px 6px;border-radius:6px;font-size:9px;letter-spacing:.08em;cursor:pointer;font-family:'DM Mono',monospace;border:1px solid #0d1f11;background:#060a07;color:#86efac55;transition:all .2s;font-weight:500;}
        .pt-act-btn:hover{border-color:#22c55e33;color:#22c55ecc;background:#091409;}
        .pt-act-btn.sell{background:#0e1200;border-color:#facc1522;color:#facc1577;}
        .pt-act-btn.sell:hover{border-color:#facc1566;color:#facc15cc;background:#151000;}
        .pt-act-btn.retire{background:#0e0505;border-color:#f8717122;color:#f8717166;}
        .pt-act-btn.retire:hover{border-color:#f8717166;color:#f87171cc;background:#1a0707;}
        .pt-act-btn.delist{background:#0e0800;border-color:#f9731622;color:#f9731655;}
        .pt-act-btn.delist:hover{border-color:#f9731666;color:#f97316cc;background:#180d00;}
        .pt-act-btn.cert{background:#0c0828;border-color:#a78bfa22;color:#a78bfa66;}
        .pt-act-btn.cert:hover{border-color:#a78bfa66;color:#a78bfacc;background:#130a30;}
        .pt-act-btn.market{background:#060e18;border-color:#60a5fa22;color:#60a5fa55;}
        .pt-act-btn.market:hover{border-color:#60a5fa55;color:#60a5facc;background:#071020;}
        .pt-act-btn:disabled{opacity:.2;cursor:not-allowed;}
        .pt-empty{grid-column:1/-1;text-align:center;padding:72px 24px;background:#070c09;border:1px solid #0d1f11;border-radius:14px;}
        .pt-skel{background:linear-gradient(90deg,#0d1f11 25%,#0a1a0e 50%,#0d1f11 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:6px;}
        .pt-tx-banner{position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:4000;background:#070c09;border:1px solid #22c55e33;border-radius:8px;padding:12px 24px;font-size:11px;color:#22c55e99;font-family:'DM Mono',monospace;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,.8);white-space:nowrap;animation:slideDown .3s ease;}
        .pt-spinner{width:14px;height:14px;border:2px solid #22c55e11;border-top-color:#22c55e88;border-radius:50%;animation:spin 1s linear infinite;flex-shrink:0;}
        .pt-overlay{position:fixed;inset:0;background:rgba(0,0,0,.88);backdrop-filter:blur(6px);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeIn .2s ease;}
        .pt-modal{background:#070c09;border:1px solid #0d1f11;border-radius:16px;width:100%;max-width:580px;max-height:90vh;overflow-y:auto;box-shadow:0 32px 80px rgba(0,0,0,.95);animation:slideUp .25s ease;}
        .pt-modal::-webkit-scrollbar{width:3px;}.pt-modal::-webkit-scrollbar-thumb{background:#0d1f11;border-radius:2px;}
        .pt-modal-hdr{padding:20px 24px;border-bottom:1px solid #0d1f11;display:flex;align-items:center;justify-content:space-between;}
        .pt-modal-title{font-size:13px;font-weight:700;color:#f0fdf4;letter-spacing:.1em;}
        .pt-modal-close{background:none;border:none;color:#86efac33;cursor:pointer;font-size:18px;transition:color .2s;}
        .pt-modal-close:hover{color:#f87171;}
        .pt-modal-body{padding:24px;}
        .pt-modal-foot{padding:16px 24px;border-top:1px solid #0d1f11;display:flex;gap:10px;background:#050809;}
        .pt-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
        .pt-form-full{grid-column:1/-1;}
        .pt-field{display:flex;flex-direction:column;gap:5px;}
        .pt-label{font-size:9px;color:#86efac44;letter-spacing:.12em;}
        .pt-input{padding:10px 12px;border-radius:7px;border:1px solid #0d1f11;background:#040706;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:11px;outline:none;transition:border-color .2s;width:100%;}
        .pt-input:focus{border-color:#22c55e33;}
        .pt-input.err{border-color:#dc2626;}
        .pt-err{font-size:9px;color:#f87171;}
        .pt-btn-primary{flex:1;padding:12px;border-radius:8px;border:none;background:linear-gradient(135deg,#14532d,#166534);color:#d1fae5;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.1em;transition:all .2s;}
        .pt-btn-primary:hover{background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;}
        .pt-btn-primary:disabled{opacity:.3;cursor:not-allowed;}
        .pt-btn-secondary{flex:1;padding:12px;border-radius:8px;border:1px solid #0d1f11;background:#060a07;color:#86efac44;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .2s;}
        .pt-btn-secondary:hover{border-color:#22c55e22;color:#86efac88;}
        .pt-btn-secondary:disabled{opacity:.3;cursor:not-allowed;}
        .pt-btn-danger{flex:1;padding:12px;border-radius:8px;border:1px solid #1f0707;background:#0e0505;color:#f8717166;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .2s;}
        .pt-btn-danger:hover:not(:disabled){background:#1a0707;border-color:#dc262666;color:#f87171cc;}
        .pt-btn-danger:disabled{opacity:.3;cursor:not-allowed;}
        .pt-toast{position:fixed;bottom:24px;right:24px;z-index:9999;background:#070c09;border-radius:8px;padding:12px 20px;font-size:12px;font-family:'DM Mono',monospace;letter-spacing:.06em;box-shadow:0 8px 32px rgba(0,0,0,.8);animation:slideIn .3s ease;}
        .pt-upload-box{position:relative;border:1px dashed #0d1f11;border-radius:8px;padding:20px;text-align:center;background:#040706;cursor:pointer;transition:border-color .2s;}
        .pt-upload-box:hover{border-color:#22c55e22;}
        .pt-upload-box.err{border-color:#dc2626;}
        .pt-qty-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
        .pt-qty-slider{flex:1;-webkit-appearance:none;height:4px;background:#0d1f11;border-radius:2px;outline:none;}
        .pt-qty-slider::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#22c55e;cursor:pointer;}
        @keyframes fu{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
        @keyframes slideUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
        @keyframes slideIn{from{opacity:0;transform:translateX(20px);}to{opacity:1;transform:translateX(0);}}
        @keyframes slideDown{from{opacity:0;transform:translate(-50%,-10px);}to{opacity:1;transform:translate(-50%,0);}}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes shimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
        @media(max-width:1024px){.pt-grid{grid-template-columns:repeat(2,1fr);}}
        @media(max-width:680px){.pt-grid{grid-template-columns:1fr;}.pt-stats{grid-template-columns:repeat(2,1fr);}.pt-form-grid{grid-template-columns:1fr;}}
      `}</style>

      <div className="pt">
        <div className="ptw">

          {/* Header */}
          <div className="pt-hdr">
            <div className="pt-hdr-label">MY CARBON ASSETS · ETHEREUM SEPOLIA</div>
            <div className="pt-hdr-title">Carbon Credit <span>Portfolio</span></div>
            <div className="pt-hdr-sub">TOKENIZED ON-CHAIN · REGISTER · HOLD · LIST · RETIRE · CERTIFICATE</div>
          </div>

          {/* Top bar */}
          <div className="pt-topbar">
            <div style={{ fontSize:11,color:'#86efac33',letterSpacing:'.06em',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap' }}>
              {loading.credits
                ? <span style={{ color:'#22c55e44' }}>⟳ Loading from blockchain...</span>
                : <span>{myCredits.filter(c=>c.status!=='RETIRED').length} active tokens on Sepolia</span>
              }
              {walletAddress && (
                <a href={`https://sepolia.etherscan.io/address/${walletAddress}`} target="_blank" rel="noreferrer"
                  style={{ color:'#86efac22',textDecoration:'none',fontSize:10 }}>
                  🔗 {walletAddress.slice(0,6)}...{walletAddress.slice(-4)} ↗
                </a>
              )}
            </div>
            <div style={{ display:'flex',gap:8 }}>
              <button className="pt-refresh-btn" onClick={handleRefresh} disabled={loading.credits}>
                {loading.credits ? '⟳ Refreshing...' : '↻ REFRESH'}
              </button>
              <button className="pt-reg-btn" onClick={()=>setShowForm(true)} disabled={submitting||!isKYCVerified}
                title={!isKYCVerified?'Complete KYC first':''}>
                ⊕ TOKENIZE NEW CREDIT
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="pt-stats">
            {[
              { label:'TOTAL CREDITS',      val:loading.credits?'...':`${stats.totalCredits.toLocaleString()} t`,  sub:'CO₂ equivalent tokenized',   color:'#22c55e', accent:'linear-gradient(90deg,#052e16,#16a34a)' },
              { label:'PORTFOLIO VALUE',     val:loading.credits?'...':`₹${(stats.totalValue/100000).toFixed(1)}L`, sub:'after vintage depreciation',  color:'#60a5fa', accent:'linear-gradient(90deg,#0c1a2e,#3b82f6)' },
              { label:'LISTED ON MARKET',    val:loading.credits?'...':stats.listedCount,                           sub:'live on blockchain market',    color:'#facc15', accent:'linear-gradient(90deg,#1a1000,#ca8a04)' },
              { label:'PERMANENTLY RETIRED', val:loading.credits?'...':stats.retiredCount,                          sub:'tCO₂ offset on-chain',         color:'#a78bfa', accent:'linear-gradient(90deg,#0f0520,#7c3aed)' },
            ].map(({ label, val, sub, color, accent })=>(
              <div className="pt-stat" key={label}>
                <div style={{ position:'absolute',top:0,left:0,right:0,height:2,background:accent,borderRadius:'12px 12px 0 0' }}/>
                <div className="pt-stat-label">{label}</div>
                <div className="pt-stat-val" style={{ color }}>{val}</div>
                <div className="pt-stat-sub">{sub}</div>
              </div>
            ))}
          </div>

          {/* Credit Score Panel */}
          <CreditScorePanel stats={stats} myCredits={allCredits} />

          {/* Tabs */}
          <div className="pt-tabs">
            {['ALL','HELD','LISTED','RETIRED','PENDING'].map(tab => (
              <button key={tab} className={`pt-tab${activeTab===tab?' active':''}`} onClick={()=>setActiveTab(tab)}>
                {tab}
                {tab === 'PENDING' && tabCounts.PENDING > 0
                  ? <span className="pt-tab-count" style={{ background:'#f59e0b22',color:'#f59e0b' }}>{tabCounts.PENDING}</span>
                  : <span className="pt-tab-count">{tabCounts[tab]}</span>
                }
              </button>
            ))}
          </div>

          {/* Grid */}
          <div className="pt-grid">
            {loading.credits && allCredits.length === 0 ? (
              [1,2,3].map(i => (
                <div key={i} style={{ background:'#070c09',border:'1px solid #0d1f11',borderRadius:14,overflow:'hidden' }}>
                  <div style={{ padding:16 }}>
                    <div className="pt-skel" style={{ height:14,width:'70%',marginBottom:10 }}/>
                    <div className="pt-skel" style={{ height:10,width:'40%',marginBottom:14 }}/>
                    <div style={{ display:'flex',gap:6 }}>
                      <div className="pt-skel" style={{ height:20,width:50 }}/><div className="pt-skel" style={{ height:20,width:70 }}/>
                    </div>
                  </div>
                  {[1,2,3,4].map(j=>(
                    <div key={j} style={{ padding:'10px 14px',borderTop:'1px solid #0d1f1114' }}>
                      <div className="pt-skel" style={{ height:8,width:'30%',marginBottom:6 }}/>
                      <div className="pt-skel" style={{ height:12,width:'60%' }}/>
                    </div>
                  ))}
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div className="pt-empty">
                <div style={{ fontSize:40,marginBottom:16 }}>🌿</div>
                <div style={{ fontSize:14,color:'#f0fdf4',fontWeight:700,marginBottom:8 }}>
                  {activeTab==='RETIRED'?'No retired credits yet':activeTab==='PENDING'?'No pending submissions':'No credits found'}
                </div>
                <div style={{ fontSize:11,color:'#86efac22',lineHeight:1.7 }}>
                  {!isKYCVerified?'Complete KYC verification to start tokenizing carbon credits'
                    :activeTab==='ALL'?'Click "TOKENIZE NEW CREDIT" to submit your first carbon credit for verification'
                    :`No credits with status: ${activeTab}`}
                </div>
              </div>
            ) : filtered.map(credit => {
              const reg     = REGISTRIES[credit.standard] || REGISTRIES.VCS;
              const dep     = vintagePenalty(credit.vintageYear);
              const adjPrice= +(( credit.pricePerCredit||0) * (1 - dep/100)).toFixed(0);
              const expired = credit.expiryDate && new Date(credit.expiryDate) < new Date();

              const statusStyle = credit.isPending
                ? { bg:'#1a0e00', color:'#f59e0b', border:'#f59e0b33', label:'⏳ PENDING' }
                : {
                    HELD:    { bg:'#051409', color:'#22c55e', border:'#22c55e22', label:'● HELD'    },
                    LISTED:  { bg:'#110e00', color:'#facc15', border:'#facc1522', label:'◆ LISTED'  },
                    RETIRED: { bg:'#0c0520', color:'#a78bfa', border:'#a78bfa22', label:'✓ RETIRED' },
                  }[credit.status] || { bg:'#051409', color:'#22c55e', border:'#22c55e22', label:'● HELD' };

              return (
                <div key={credit.id} className={`pt-card${credit.status==='RETIRED'?' retired':''}${credit.isPending?' pending-approval':''}`}>
                  <div className="pt-ribbon" style={{ background:statusStyle.bg, color:statusStyle.color, border:`1px solid ${statusStyle.border}` }}>
                    {statusStyle.label}
                  </div>
                  <div className="pt-card-hdr">
                    <div className="pt-card-name">{credit.projectName}</div>
                    <div className="pt-card-loc">📍 {credit.location}</div>
                    <div className="pt-card-badges">
                      <span style={{ fontSize:9,padding:'2px 8px',borderRadius:3,background:reg.bg,color:reg.color,border:`1px solid ${reg.color}22` }}>{credit.standard}</span>
                      {credit.isPending
                        ? <span className="pt-verify" style={{ background:'#1a0e0066',color:'#f59e0b88',border:'1px solid #f59e0b22' }}>⏳ Admin Review</span>
                        : <span className="pt-verify" style={{ background:'#22c55e0d',color:'#22c55e66',border:'1px solid #22c55e11' }}>⛓ On-Chain</span>
                      }
                      {dep>0 && <span className="pt-dep-badge" style={{ background:'#11100066',color:'#facc1566',border:'1px solid #facc1511' }}>↓{dep}% vintage</span>}
                    </div>
                  </div>

                  {/* Pending notice */}
                  {credit.isPending && (
                    <div style={{ margin:'0 14px 0',padding:'8px 12px',background:'#110a00',border:'1px solid #f59e0b22',borderRadius:6,fontSize:10,color:'#f59e0b88',lineHeight:1.6 }}>
                      🔍 Under admin verification. Serial number and registry data being checked.
                      Approval typically takes 1–2 business days.
                    </div>
                  )}

                  <div className="pt-meta">
                    {!credit.isPending && (
                      <div className="pt-meta-cell"><div className="pt-meta-label">TOKEN ID</div><div className="pt-meta-val blue" style={{ fontSize:10,fontFamily:'monospace' }}>{credit.tokenId}</div></div>
                    )}
                    <div className={`pt-meta-cell${credit.isPending?' pt-meta-full':''}`}><div className="pt-meta-label">QUANTITY (tCO₂)</div><div className="pt-meta-val green">{credit.credits?.toLocaleString()}</div></div>
                    <div className="pt-meta-cell"><div className="pt-meta-label">VINTAGE YEAR</div><div className="pt-meta-val">{credit.vintageYear}</div></div>
                    {!credit.isPending && <div className="pt-meta-cell"><div className="pt-meta-label">ADJ. PRICE</div><div className="pt-meta-val">₹{adjPrice.toLocaleString()}</div></div>}
                    {credit.expiryDate && <div className="pt-meta-cell"><div className="pt-meta-label">EXPIRY</div><div className={`pt-meta-val${expired?' red':''}`}>{new Date(credit.expiryDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div></div>}
                    <div className="pt-meta-cell"><div className="pt-meta-label">PROJECT TYPE</div><div className="pt-meta-val" style={{ fontSize:10 }}>{credit.projectType}</div></div>
                    <div className="pt-meta-cell"><div className="pt-meta-label">COUNTRY</div><div className="pt-meta-val">{credit.country}</div></div>
                    <div className="pt-meta-cell pt-meta-full"><div className="pt-meta-label">REGISTRY</div><div className="pt-meta-val" style={{ color:reg.color }}>{reg.label}</div></div>
                    <div className="pt-meta-cell pt-meta-full" style={{ borderBottom:'none' }}><div className="pt-meta-label">SERIAL / CERTIFICATE NO.</div><div className="pt-meta-val blue" style={{ fontSize:10 }}>{credit.serialNumber}</div></div>
                  </div>

                  {/* Action buttons */}
                  {credit.isPending ? (
                    <div className="pt-card-actions">
                      <button className="pt-act-btn" style={{ color:'#f59e0b44',borderColor:'#f59e0b11',background:'#0e0900' }} disabled>⏳ AWAITING APPROVAL</button>
                    </div>
                  ) : credit.status !== 'RETIRED' ? (
                    <div className="pt-card-actions">
                      {credit.status === 'LISTED' ? (
                        <button className="pt-act-btn delist" onClick={()=>handleDelist(credit)} disabled={loading.tx}>DELIST</button>
                      ) : (
                        <button className="pt-act-btn sell" onClick={()=>{setShowList(credit);setListPrice(credit.pricePerCredit);setListQty(String(credit.credits));}} disabled={loading.tx}>LIST FOR SALE</button>
                      )}
                      <button className="pt-act-btn market" onClick={()=>navigate('/carbon-credits')} disabled={loading.tx}>VIEW MARKET</button>
                      <button className="pt-act-btn retire" onClick={()=>setShowRetire(credit)} disabled={loading.tx}>RETIRE</button>
                    </div>
                  ) : (
                    <div className="pt-card-actions">
                      <button className="pt-act-btn cert" onClick={()=>setShowCert(credit)}>📜 VIEW CERTIFICATE</button>
                      <a href={`https://sepolia.etherscan.io/address/${walletAddress}`} target="_blank" rel="noreferrer"
                        style={{ flex:1,padding:'9px 6px',borderRadius:6,fontSize:9,letterSpacing:'.08em',border:'1px solid #0d1f11',background:'#060e18',color:'#60a5fa44',textDecoration:'none',textAlign:'center',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'DM Mono,monospace' }}>
                        ETHERSCAN ↗
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {txPending && <div className="pt-tx-banner"><div className="pt-spinner"/>{txPending}</div>}

      {/* ── Tokenize Modal ── */}
      {showForm && (
        <div className="pt-overlay" onClick={e=>e.target===e.currentTarget&&!submitting&&setShowForm(false)}>
          <div className="pt-modal">
            <div className="pt-modal-hdr">
              <span className="pt-modal-title">⊕ SUBMIT CARBON CREDIT FOR VERIFICATION</span>
              <button className="pt-modal-close" onClick={()=>!submitting&&setShowForm(false)}>✕</button>
            </div>
            <div className="pt-modal-body">
              <div style={{ fontSize:10,color:'#f59e0b88',marginBottom:20,padding:'10px 12px',background:'#110a00',borderRadius:6,border:'1px solid #f59e0b22',lineHeight:1.7 }}>
                ⏳ Your submission will be reviewed by our compliance team within <strong style={{ color:'#f59e0b' }}>1–2 business days</strong>.
                Admin will verify your serial number against the registry database before approving.
              </div>
              <div className="pt-form-grid">
                <div className="pt-field pt-form-full">
                  <label className="pt-label">PROJECT NAME</label>
                  <input className={`pt-input${formErrors.projectName?' err':''}`} placeholder="e.g. Sundarbans Mangrove Restoration" value={form.projectName} onChange={e=>setForm({...form,projectName:e.target.value})}/>
                  {formErrors.projectName&&<span className="pt-err">{formErrors.projectName}</span>}
                </div>
                <div className="pt-field">
                  <label className="pt-label">LOCATION</label>
                  <input className={`pt-input${formErrors.location?' err':''}`} placeholder="e.g. West Bengal, India" value={form.location} onChange={e=>setForm({...form,location:e.target.value})}/>
                  {formErrors.location&&<span className="pt-err">{formErrors.location}</span>}
                </div>
                <div className="pt-field">
                  <label className="pt-label">COUNTRY</label>
                  <input className={`pt-input${formErrors.country?' err':''}`} placeholder="e.g. India" value={form.country} onChange={e=>setForm({...form,country:e.target.value})}/>
                  {formErrors.country&&<span className="pt-err">{formErrors.country}</span>}
                </div>
                <div className="pt-field">
                  <label className="pt-label">REGISTRY / STANDARD</label>
                  <select className="pt-input" value={form.standard} onChange={e=>setForm({...form,standard:e.target.value})}>
                    <option value="VCS">VCS — Verra</option>
                    <option value="GS">GS — Gold Standard</option>
                    <option value="CDM">CDM — Clean Dev. Mechanism</option>
                    <option value="ACR">ACR — American Carbon Registry</option>
                  </select>
                </div>
                <div className="pt-field">
                  <label className="pt-label">REGISTRY NAME (FULL)</label>
                  <input className={`pt-input${formErrors.registryName?' err':''}`} placeholder="e.g. Verra VCS Registry" value={form.registryName} onChange={e=>setForm({...form,registryName:e.target.value})}/>
                  {formErrors.registryName&&<span className="pt-err">{formErrors.registryName}</span>}
                </div>
                <div className="pt-field">
                  <label className="pt-label">PROJECT TYPE</label>
                  <select className={`pt-input${formErrors.projectType?' err':''}`} value={form.projectType} onChange={e=>setForm({...form,projectType:e.target.value})}>
                    <option value="">Select type</option>
                    {PROJECT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                  {formErrors.projectType&&<span className="pt-err">{formErrors.projectType}</span>}
                </div>
                <div className="pt-field pt-form-full">
                  <label className="pt-label">PROJECT DEVELOPER</label>
                  <input className={`pt-input${formErrors.developer?' err':''}`} placeholder="Organization / Company name" value={form.developer} onChange={e=>setForm({...form,developer:e.target.value})}/>
                  {formErrors.developer&&<span className="pt-err">{formErrors.developer}</span>}
                </div>
                <div className="pt-field">
                  <label className="pt-label">QUANTITY (tCO₂ CREDITS)</label>
                  <input className={`pt-input${formErrors.credits?' err':''}`} type="number" placeholder="e.g. 500" value={form.credits} onChange={e=>setForm({...form,credits:e.target.value})}/>
                  {formErrors.credits&&<span className="pt-err">{formErrors.credits}</span>}
                </div>
                <div className="pt-field">
                  <label className="pt-label">VINTAGE YEAR</label>
                  <input className={`pt-input${formErrors.vintageYear?' err':''}`} type="number" placeholder="e.g. 2023" min="2000" max="2030" value={form.vintageYear} onChange={e=>setForm({...form,vintageYear:e.target.value})}/>
                  {formErrors.vintageYear&&<span className="pt-err">{formErrors.vintageYear}</span>}
                  {form.vintageYear&&!isNaN(form.vintageYear)&&(
                    <span style={{ fontSize:9,color:vintagePenalty(+form.vintageYear)>0?'#facc1566':'#22c55e66' }}>
                      {vintagePenalty(+form.vintageYear)>0?`↓ ${vintagePenalty(+form.vintageYear)}% vintage depreciation`:'✓ Current vintage'}
                    </span>
                  )}
                </div>
                <div className="pt-field">
                  <label className="pt-label">EXPIRY DATE</label>
                  <input className={`pt-input${formErrors.expiryDate?' err':''}`} type="date" value={form.expiryDate} onChange={e=>setForm({...form,expiryDate:e.target.value})}/>
                  {formErrors.expiryDate&&<span className="pt-err">{formErrors.expiryDate}</span>}
                </div>
                <div className="pt-field pt-form-full">
                  <label className="pt-label">SERIAL / CERTIFICATE NUMBER</label>
                  <input className={`pt-input${formErrors.serialNumber?' err':''}`} placeholder="e.g. VCS-2023-IN-00412" value={form.serialNumber} onChange={e=>setForm({...form,serialNumber:e.target.value})}/>
                  {formErrors.serialNumber&&<span className="pt-err">{formErrors.serialNumber}</span>}
                </div>
                <div className="pt-field pt-form-full">
                  <label className="pt-label">OWNERSHIP PROOF DOCUMENT</label>
                  <div className={`pt-upload-box${formErrors.docFile?' err':''}`}>
                    {form.docFile ? (
                      <div style={{ fontSize:11,color:'#22c55e88' }}>✓ {form.docFile.name}</div>
                    ) : (
                      <>
                        <div style={{ fontSize:28,marginBottom:6 }}>📄</div>
                        <div style={{ fontSize:11,color:'#86efac33',marginBottom:4 }}>Click to upload ownership proof</div>
                        <div style={{ fontSize:9,color:'#86efac22' }}>PDF, JPG, PNG — max 5MB · Stored on IPFS</div>
                      </>
                    )}
                    <input type="file" accept="image/*,.pdf" style={{ position:'absolute',inset:0,opacity:0,cursor:'pointer' }}
                      onChange={e=>{
                        const f=e.target.files[0];
                        if(f&&f.size>5*1024*1024){showToast('❌ File too large. Max 5MB','error');return;}
                        setForm({...form,docFile:f||null});
                      }}/>
                  </div>
                  {formErrors.docFile&&<span className="pt-err">{formErrors.docFile}</span>}
                  <div style={{ fontSize:9,color:'#86efac22',marginTop:4,lineHeight:1.6 }}>
                    📤 Document is securely stored on IPFS. Only compliance team can view it for verification.
                  </div>
                </div>
              </div>
            </div>
            <div className="pt-modal-foot">
              <button className="pt-btn-secondary" onClick={()=>{setShowForm(false);setFormErrors({});}} disabled={submitting}>CANCEL</button>
              <button className="pt-btn-primary" onClick={handleRegister} disabled={submitting}>
                {submitting?`⟳ ${txPending||'SUBMITTING...'}`: 'SUBMIT FOR VERIFICATION →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Retire Modal ── */}
      {showRetire && (
        <div className="pt-overlay" onClick={e=>e.target===e.currentTarget&&!loading.tx&&setShowRetire(null)}>
          <div className="pt-modal" style={{ maxWidth:440 }}>
            <div className="pt-modal-hdr">
              <span className="pt-modal-title">RETIRE CREDIT PERMANENTLY</span>
              <button className="pt-modal-close" onClick={()=>!loading.tx&&setShowRetire(null)}>✕</button>
            </div>
            <div className="pt-modal-body">
              <div style={{ background:'#060a07',borderRadius:8,padding:'12px 14px',marginBottom:16,border:'1px solid #0d1f11' }}>
                <div style={{ fontSize:12,color:'#f0fdf4',fontWeight:700,marginBottom:4 }}>{showRetire.projectName}</div>
                <div style={{ display:'flex',gap:8,fontSize:10,color:'#86efac44' }}>
                  <span>{showRetire.standard}</span><span>·</span>
                  <span>{showRetire.credits?.toLocaleString()} tCO₂</span><span>·</span>
                  <span>Vintage {showRetire.vintageYear}</span>
                </div>
              </div>
              {[
                `Registry: ${REGISTRIES[showRetire.standard]?.label}`,
                `Serial: ${showRetire.serialNumber}`,
                `Quantity: ${showRetire.credits?.toLocaleString()} tCO₂`,
                'Double-count scan: CLEAR',
                'Blockchain burn: READY',
              ].map((s,i)=>(
                <div key={i} style={{ display:'flex',alignItems:'center',gap:10,padding:'7px 12px',borderRadius:6,marginBottom:5,background:'#051409',border:'1px solid #22c55e11' }}>
                  <span style={{ color:'#22c55e66' }}>✓</span>
                  <span style={{ fontSize:10,color:'#86efac77' }}>{s}</span>
                </div>
              ))}
              <div style={{ marginTop:14,padding:'10px 12px',background:'#0e0505',borderRadius:6,border:'1px solid #f8717122',fontSize:10,color:'#f8717188',lineHeight:1.6 }}>
                ⚠️ <strong style={{ color:'#f87171aa' }}>Irreversible.</strong> Token burned on Ethereum Sepolia.
                ISO 14064-3 retirement certificate generated with TX hash.
              </div>
            </div>
            <div className="pt-modal-foot">
              <button className="pt-btn-secondary" onClick={()=>setShowRetire(null)} disabled={loading.tx}>CANCEL</button>
              <button className="pt-btn-danger" onClick={()=>handleRetireConfirm(showRetire)} disabled={loading.tx}>
                {loading.tx?'⟳ BURNING ON-CHAIN...':'RETIRE PERMANENTLY'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── List Modal ── */}
      {showList && (
        <div className="pt-overlay" onClick={e=>e.target===e.currentTarget&&setShowList(null)}>
          <div className="pt-modal" style={{ maxWidth:420 }}>
            <div className="pt-modal-hdr">
              <span className="pt-modal-title">LIST FOR SALE ON BLOCKCHAIN</span>
              <button className="pt-modal-close" onClick={()=>setShowList(null)}>✕</button>
            </div>
            <div className="pt-modal-body">
              <div style={{ background:'#060a07',borderRadius:8,padding:'12px 14px',marginBottom:14,border:'1px solid #0d1f11' }}>
                <div style={{ fontSize:12,color:'#f0fdf4',fontWeight:700,marginBottom:4 }}>{showList.projectName}</div>
                <div style={{ fontSize:10,color:'#86efac44' }}>{showList.credits?.toLocaleString()} tCO₂ total · {showList.standard} · Vintage {showList.vintageYear}</div>
              </div>
              {vintagePenalty(showList.vintageYear)>0&&(
                <div style={{ padding:'8px 12px',background:'#110e00',border:'1px solid #facc1511',borderRadius:6,marginBottom:14,fontSize:10,color:'#facc1555' }}>
                  ↓ {vintagePenalty(showList.vintageYear)}% vintage depreciation applied
                </div>
              )}
              <div className="pt-field" style={{ marginBottom:14 }}>
                <label className="pt-label">QUANTITY TO LIST (tCO₂)</label>
                <div className="pt-qty-row">
                  <input className="pt-qty-slider" type="range" min="1" max={showList.credits} step="1" value={listQty||showList.credits} onChange={e=>setListQty(e.target.value)}/>
                  <input className="pt-input" type="number" min="1" max={showList.credits} style={{ width:80,marginBottom:0 }} value={listQty||showList.credits} onChange={e=>setListQty(e.target.value)}/>
                </div>
                <div style={{ fontSize:9,color:'#86efac33',marginTop:4 }}>
                  Listing <strong style={{ color:'#22c55e88' }}>{listQty||showList.credits}</strong> of {showList.credits?.toLocaleString()} credits
                </div>
              </div>
              <div className="pt-field" style={{ marginBottom:12 }}>
                <label className="pt-label">ASKING PRICE PER CREDIT (₹)</label>
                <input className="pt-input" type="number" placeholder="e.g. 850" value={listPrice} onChange={e=>setListPrice(e.target.value)}/>
              </div>
              {listPrice&&!isNaN(listPrice)&&+listPrice>0&&(
                <div style={{ background:'#040706',borderRadius:6,padding:'10px 12px',fontSize:10,color:'#86efac66',border:'1px solid #0d1f11' }}>
                  <div style={{ display:'flex',justifyContent:'space-between',marginBottom:4 }}>
                    <span>Listing value</span><span style={{ color:'#22c55e88' }}>₹{(+listPrice*(+(listQty||showList.credits))).toLocaleString()}</span>
                  </div>
                  <div style={{ display:'flex',justifyContent:'space-between',marginBottom:4 }}>
                    <span>Platform fee (0.5%)</span><span style={{ color:'#facc1566' }}>₹{(+listPrice*(+(listQty||showList.credits))*0.005).toLocaleString()}</span>
                  </div>
                  <div style={{ display:'flex',justifyContent:'space-between',paddingTop:6,marginTop:4,borderTop:'1px solid #0d1f11' }}>
                    <span>On-chain price</span><span style={{ color:'#60a5fa66' }}>{(+listPrice/210000).toFixed(6)} ETH/credit</span>
                  </div>
                </div>
              )}
            </div>
            <div className="pt-modal-foot">
              <button className="pt-btn-secondary" onClick={()=>setShowList(null)}>CANCEL</button>
              <button className="pt-btn-primary" onClick={()=>handleListForSale(showList)} disabled={loading.tx}>
                {loading.tx?'⟳ LISTING ON-CHAIN...':'LIST ON BLOCKCHAIN →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Certificate Modal ── */}
      {showCert && (
        <div className="pt-overlay" onClick={e=>e.target===e.currentTarget&&setShowCert(null)}>
          <div className="pt-modal" style={{ maxWidth:600 }}>
            <div className="pt-modal-hdr">
              <span className="pt-modal-title">📜 RETIREMENT CERTIFICATE</span>
              <button className="pt-modal-close" onClick={()=>setShowCert(null)}>✕</button>
            </div>
            <div className="pt-modal-body">
              <RetirementCertificate credit={showCert} txHash={showCert.txHash} onClose={()=>setShowCert(null)}/>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="pt-toast" style={{ border:`1px solid ${toast.type==='error'?'#f8717122':'#22c55e22'}`,color:toast.type==='error'?'#f8717199':'#22c55e88' }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}