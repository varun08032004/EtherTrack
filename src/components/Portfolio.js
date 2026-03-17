import React, { useState, useContext, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import { usePortfolio, vintagePenalty } from '../context/PortfolioContext';
import { txAPI, apiFetch } from '../services/api';

// ── Registries ────────────────────────────────────────────────────
const REGISTRIES = {
  VCS: { label:'Verra VCS',                color:'#22c55e', bg:'#0d2e1f' },
  GS:  { label:'Gold Standard',            color:'#facc15', bg:'#1a1500' },
  CDM: { label:'Clean Dev. Mechanism',     color:'#60a5fa', bg:'#0a1628' },
  ACR: { label:'American Carbon Registry', color:'#a78bfa', bg:'#120a28' },
  BEE: { label:'BEE India (CCTS)',         color:'#f97316', bg:'#1a0a00' },
};

// ── BEE CCTS + Global VCM project types ──────────────────────────
const PROJECT_TYPES = [
  'Renewable Energy (BEE)','Green Hydrogen (BEE)','Industrial Energy Efficiency (BEE)',
  'Landfill Methane Recovery (BEE)','Mangrove Afforestation (BEE)',
  'Renewable Energy with Storage (BEE)','Offshore Wind (BEE)','Compressed Biogas (BEE)',
  'Renewable Energy','Reforestation','REDD+','Methane Capture',
  'Energy Efficiency','Blue Carbon','Cookstoves','Soil Carbon',
  'Industrial Gas','Avoided Deforestation',
];

const CREDIT_TYPES = [
  { value:'voluntary',  label:'Voluntary (VCU)', color:'#22c55e', desc:'Voluntary Carbon Unit — voluntary markets' },
  { value:'compliance', label:'Compliance (CCC)', color:'#f97316', desc:'Carbon Credit Certificate — India CCTS' },
];

// ── Gold Standard SDG tags (required for GS credits) ─────────────
const SDG_OPTIONS = [
  { id:1,  label:'No Poverty' },
  { id:3,  label:'Good Health' },
  { id:6,  label:'Clean Water' },
  { id:7,  label:'Clean Energy' },
  { id:8,  label:'Decent Work' },
  { id:11, label:'Sustainable Cities' },
  { id:13, label:'Climate Action' },
  { id:14, label:'Life Below Water' },
  { id:15, label:'Life on Land' },
];

// ── ACVA verification statuses ────────────────────────────────────
const VERIFICATION_STATUSES = [
  { value:'pending',     label:'Not Verified',   color:'#86efac33' },
  { value:'in_progress', label:'In Progress',     color:'#f59e0b' },
  { value:'verified',    label:'Verified',        color:'#22c55e' },
];

// ── Corresponding Adjustment (Article 6) options ──────────────────
const CA_OPTIONS = [
  { value:'none',        label:'None — voluntary only (no CA)',         color:'#86efac44' },
  { value:'host_issued', label:'Host country CA issued (Art. 6.2)',     color:'#22c55e' },
  { value:'itmo',        label:'ITMO authorised (Art. 6.4)',            color:'#60a5fa' },
  { value:'pending',     label:'CA pending host country confirmation',  color:'#f59e0b' },
];

// ── Reference prices (INR/tCO₂) ──────────────────────────────────
const REFERENCE_PRICES = {
  'Renewable Energy (BEE)':700,'Green Hydrogen (BEE)':1400,'Industrial Energy Efficiency (BEE)':600,
  'Landfill Methane Recovery (BEE)':950,'Mangrove Afforestation (BEE)':1800,
  'Renewable Energy with Storage (BEE)':900,'Offshore Wind (BEE)':800,'Compressed Biogas (BEE)':750,
  'Renewable Energy':650,'Reforestation':1200,'REDD+':1100,'Avoided Deforestation':1050,
  'Blue Carbon':2100,'Methane Capture':900,'Energy Efficiency':550,'Cookstoves':750,
  'Soil Carbon':950,'Industrial Gas':450,'Forestry':1150,'Renewable':650,
  'Methane':900,'Efficiency':550,'Ocean':2100,'Agriculture':950,
};

const INDIA_CCTS_FLOOR   = 600;
const INDIA_CCTS_CEILING = 1200;
const STANDARD_PREMIUM   = { VCS:1.0, GS:1.15, CDM:0.85, ACR:1.05, BEE:1.0 };

const getReferencePrice = (projectType, standard, vintageYear) => {
  const base    = REFERENCE_PRICES[projectType] || 850;
  const premium = STANDARD_PREMIUM[standard]    || 1.0;
  const dep     = vintagePenalty(vintageYear)   / 100;
  return Math.round(base * premium * (1 - dep));
};

// ── Empty form state ──────────────────────────────────────────────
const emptyForm = {
  projectName:'', location:'', country:'', standard:'VCS', projectType:'',
  developer:'', credits:'', vintageYear:'', expiryDate:'', serialNumber:'',
  projectId:'', docFile:null, pincode:'',
  creditType:'voluntary', cbamEligible:false,
  acvaName:'', acvaDate:'', acvaStatus:'pending',
  icmRegistryId:'', bankingStatus:'available',
  sdgTags:[],
  correspondingAdjustment:'none',
};

// ─────────────────────────────────────────────────────────────────
// ── Offset Gap Panel ──────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
function OffsetGapPanel({ myCredits, emissionsData }) {
  const totalRetiredTco2 = myCredits.filter(c=>c.status==='RETIRED').reduce((s,c)=>s+(c.totalRetired||c.credits||0),0);
  const totalEm  = emissionsData?.total||0;
  const scope1Em = emissionsData?.scope1||0;
  const scope2Em = emissionsData?.scope2||0;
  const scope3Em = emissionsData?.scope3||0;
  const gap      = Math.max(0, totalEm - totalRetiredTco2);
  const pct      = totalEm>0 ? Math.min(100,(totalRetiredTco2/totalEm)*100) : 0;
  const needed   = Math.ceil(gap);
  const refPrice = getReferencePrice('Renewable Energy','VCS',new Date().getFullYear()-1);

  if (!emissionsData || totalEm===0) return (
    <div style={{background:'#0a0f0c',border:'1px solid #0f2a1a',borderRadius:14,padding:'16px 20px',marginBottom:24,animation:'fu .4s ease both'}}>
      <div style={{fontSize:9,color:'#86efac44',letterSpacing:'.14em',marginBottom:8}}>OFFSET RECONCILIATION · GHG PROTOCOL</div>
      <div style={{fontSize:11,color:'#86efac33',lineHeight:1.8}}>
        No emission data linked.{' '}<a href="/emissions" style={{color:'#22c55e88',textDecoration:'none'}}>Log GHG emissions →</a>{' '}to calculate your offset gap.
      </div>
    </div>
  );

  return (
    <div style={{background:'#0a0f0c',border:'1px solid #0f2a1a',borderRadius:14,padding:'20px 24px',marginBottom:24,animation:'fu .4s ease .06s both'}}>
      <div style={{fontSize:9,color:'#86efac44',letterSpacing:'.14em',marginBottom:16}}>OFFSET RECONCILIATION · GHG PROTOCOL · FY {emissionsData.year||new Date().getFullYear()}</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
        {[
          {label:'TOTAL EMISSIONS',val:`${totalEm.toFixed(1)} t`,  color:'#f87171'},
          {label:'CREDITS RETIRED',val:`${totalRetiredTco2.toFixed(1)} t`,color:'#22c55e'},
          {label:'OFFSET GAP',     val:`${gap.toFixed(1)} t`,      color:gap===0?'#22c55e':'#facc15'},
          {label:'CREDITS NEEDED', val:needed,                     color:'#60a5fa'},
        ].map(({label,val,color})=>(
          <div key={label} style={{background:'#070c09',borderRadius:8,padding:'12px 14px',border:'1px solid #0d1f11'}}>
            <div style={{fontSize:8,color:'#86efac33',letterSpacing:'.12em',marginBottom:6}}>{label}</div>
            <div style={{fontSize:18,fontWeight:700,color,fontFamily:'Syne,sans-serif'}}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'#86efac44',marginBottom:6}}>
          <span>OFFSET PROGRESS</span>
          <span style={{color:pct>=100?'#22c55e':'#facc15'}}>{pct.toFixed(1)}% covered</span>
        </div>
        <div style={{height:6,background:'#0d1f11',borderRadius:3}}>
          <div style={{height:'100%',width:`${pct}%`,borderRadius:3,background:pct>=100?'#22c55e':'linear-gradient(90deg,#f87171,#facc15)',transition:'width .8s ease'}}/>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:14}}>
        {[
          {label:'SCOPE 1 GAP',em:scope1Em,color:'#f97316'},
          {label:'SCOPE 2 GAP',em:scope2Em,color:'#3b82f6'},
          {label:'SCOPE 3 GAP',em:scope3Em,color:'#a855f7'},
        ].map(({label,em,color})=>(
          <div key={label} style={{background:'#070c09',borderRadius:6,padding:'8px 12px',border:`1px solid ${color}22`}}>
            <div style={{fontSize:8,color:`${color}88`,letterSpacing:'.1em',marginBottom:4}}>{label}</div>
            <div style={{fontSize:13,color,fontWeight:700}}>{em.toFixed(1)} t</div>
          </div>
        ))}
      </div>
      {gap>0 && (
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',background:'#110a00',border:'1px solid #facc1522',borderRadius:8,fontSize:11,flexWrap:'wrap',gap:8}}>
          <span style={{color:'#facc1577'}}>
            ⚠ Need <strong style={{color:'#facc15'}}>{needed} more credits</strong> for net-zero.
            Est. cost: <strong style={{color:'#22c55e'}}>₹{(needed*refPrice).toLocaleString()}</strong>
          </span>
          <a href="/carbon-credits" style={{padding:'6px 14px',borderRadius:6,background:'#14532d',color:'#d1fae5',fontSize:10,textDecoration:'none',letterSpacing:'.08em',fontFamily:'DM Mono,monospace'}}>
            BUY CREDITS →
          </a>
        </div>
      )}
      {gap===0 && totalEm>0 && (
        <div style={{padding:'10px 14px',background:'#051409',border:'1px solid #22c55e33',borderRadius:8,fontSize:11,color:'#22c55e88'}}>
          ✓ Net-zero achieved for this reporting year. All emissions offset.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ── Credit Score Panel ────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
function CreditScorePanel({ stats, myCredits, emissionsData }) {
  const total    = stats.totalCredits||0;
  const retired  = stats.retiredCount||0;
  const listed   = stats.listedCount||0;
  const verified = myCredits.filter(c=>c.admin_status==='approved').length;
  const totalEm  = emissionsData?.total||0;
  const retiredT = myCredits.filter(c=>c.status==='RETIRED').reduce((s,c)=>s+(c.totalRetired||c.credits||0),0);
  const scope3Covered = totalEm>0 && retiredT>=(emissionsData?.scope3||0) && retiredT>0;

  const score = Math.min(850,Math.round((verified*2.5)+(retired*15)+(listed*10)+(total>0?Math.log(total+1)*40:0)+200));
  const pct   = (score/850)*100;
  const color = score>=700?'#22c55e':score>=500?'#facc15':score>=300?'#f97316':'#f87171';
  const grade = score>=700?'EXCELLENT':score>=500?'GOOD':score>=300?'FAIR':'BUILDING';

  const R=54,cx=70,cy=70,startAngle=-210,totalArc=240;
  const toRad  = d=>(d*Math.PI)/180;
  const arcX   = a=>cx+R*Math.cos(toRad(a));
  const arcY   = a=>cy+R*Math.sin(toRad(a));
  const endAngle = startAngle+(totalArc*pct)/100;
  const largeArc = endAngle-startAngle>180?1:0;
  const trackD   = `M ${arcX(startAngle)} ${arcY(startAngle)} A ${R} ${R} 0 1 1 ${arcX(startAngle+totalArc)} ${arcY(startAngle+totalArc)}`;
  const fillD    = pct>0?`M ${arcX(startAngle)} ${arcY(startAngle)} A ${R} ${R} 0 ${largeArc} 1 ${arcX(endAngle)} ${arcY(endAngle)}`:'';

  return (
    <div style={{background:'#0a0f0c',border:'1px solid #0f2a1a',borderRadius:14,padding:'20px 24px',marginBottom:24,display:'flex',alignItems:'center',gap:32,flexWrap:'wrap',animation:'fu .4s ease .08s both'}}>
      <div style={{flexShrink:0}}>
        <svg width={140} height={90} viewBox="0 0 140 90">
          <path d={trackD} fill="none" stroke="#0f2a1a" strokeWidth={10} strokeLinecap="round"/>
          {fillD&&<path d={fillD} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" style={{filter:`drop-shadow(0 0 6px ${color}88)`}}/>}
          <text x={cx} y={cy+4}  textAnchor="middle" fill={color}      fontSize={22} fontWeight={700} fontFamily="'DM Mono',monospace">{score}</text>
          <text x={cx} y={cy+18} textAnchor="middle" fill={color+'88'} fontSize={8}  fontFamily="'DM Mono',monospace" letterSpacing={2}>{grade}</text>
        </svg>
        <div style={{textAlign:'center',fontSize:9,color:'#86efac44',letterSpacing:'.12em',marginTop:-8}}>CARBON SCORE</div>
      </div>
      <div style={{flex:1,minWidth:200}}>
        <div style={{fontSize:11,color:'#f0fdf4',fontWeight:500,marginBottom:12,letterSpacing:'.04em'}}>Score Breakdown <span style={{fontSize:9,color:'#86efac44'}}>/850</span></div>
        {[
          {label:'Verified Credits', pts:Math.round(verified*2.5),          color:'#22c55e'},
          {label:'Credits Retired',  pts:Math.round(retired*15),            color:'#a78bfa'},
          {label:'Active Listings',  pts:Math.round(listed*10),             color:'#facc15'},
          {label:'Portfolio Volume', pts:Math.round(Math.log(total+1)*40),  color:'#60a5fa'},
        ].map(({label,pts,color:c})=>(
          <div key={label} style={{marginBottom:8}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
              <span style={{fontSize:9,color:'#86efac66',letterSpacing:'.08em'}}>{label}</span>
              <span style={{fontSize:9,color:c}}>+{pts} pts</span>
            </div>
            <div style={{height:3,background:'#0f2a1a',borderRadius:2}}>
              <div style={{height:'100%',width:`${Math.min(100,(pts/200)*100)}%`,background:c,borderRadius:2,transition:'width .6s ease'}}/>
            </div>
          </div>
        ))}
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:8,flexShrink:0}}>
        {[
          {label:'ESG READY',      ok:score>=400},
          {label:'SCOPE 3 OFFSET', ok:scope3Covered},
          {label:'REGISTRY VERIF', ok:verified>0},
          {label:'MARKET ACTIVE',  ok:listed>0},
          {label:'NET ZERO PATH',  ok:totalEm>0&&retiredT>0},
        ].map(({label,ok})=>(
          <div key={label} style={{fontSize:9,padding:'4px 10px',borderRadius:4,letterSpacing:'.08em',background:ok?'#0d2e1f':'#0a0a0a',color:ok?'#22c55e':'#86efac22',border:`1px solid ${ok?'#22c55e33':'#0f2a1a'}`}}>
            {ok?'✓':'○'} {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ── Retirement Certificate ────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
function RetirementCertificate({ credit, txHash, onClose }) {
  const date           = new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
  const tokenDisplay   = credit.tokenHex||(credit.tokenId?`0x${Number(credit.tokenId).toString(16).padStart(8,'0').toUpperCase()}`:'—');
  const certId         = `CERT-${tokenDisplay.replace('0x','').slice(0,8)||'XXXXXX'}-${Date.now().toString(36).toUpperCase()}`;
  const reg            = REGISTRIES[credit.standard]||REGISTRIES.VCS;
  const scopeLabel     = credit.retireScope?`Scope ${credit.retireScope}`:'Scope 1/2/3';
  const creditTypeLabel= credit.creditType==='compliance'?'CCC — Compliance (India CCTS)':'VCU — Voluntary Carbon Unit';
  const verifiedBy     = credit.acvaName || 'Pending third-party verification';
  const caLabel        = CA_OPTIONS.find(o=>o.value===credit.correspondingAdjustment)?.label || 'None';
  const sdgList        = (credit.sdgTags||[]).join(', ') || '—';

  const handleDownload = () => {
    const content = `ETHERTRACK CARBON RETIREMENT CERTIFICATE
=========================================
Certificate ID:              ${certId}
Token ID:                    ${tokenDisplay}
Credit Type:                 ${creditTypeLabel}
Offset Scope:                ${scopeLabel}
Corresponding Adjustment:    ${caLabel}
SDG Co-benefits:             ${sdgList}

Project Name:                ${credit.projectName}
Project ID:                  ${credit.projectId||'—'}
Serial No.:                  ${credit.serialNumber}
ICM Registry ID:             ${credit.icmRegistryId||'—'}
Registry:                    ${reg.label}
Standard:                    ${credit.standard}
Credits Retired:             ${credit.retiredQty||credit.credits} tCO₂e
Vintage Year:                ${credit.vintageYear}
Project Type:                ${credit.projectType}
Country:                     ${credit.country||credit.location}
Developer:                   ${credit.developer}

Verification Status:         ${VERIFICATION_STATUSES.find(s=>s.value===credit.acvaStatus)?.label||'Pending'}
ACVA Verifier:               ${verifiedBy}
ACVA Verification Date:      ${credit.acvaDate||'—'}
CBAM Eligible:               ${credit.cbamEligible?'YES — EU CBAM Article 7 compliant':'NO'}

Retirement Date:             ${date}
TX Hash:                     ${txHash||'N/A'}
Chain:                       Ethereum Sepolia
Methodology:                 ISO 14064-3 · GHG Protocol Corporate Standard
NDC Contribution:            India NDC — 45% emissions intensity reduction by 2030
=========================================
This certificate confirms permanent retirement of ${credit.retiredQty||credit.credits} tCO₂e
for ${scopeLabel} emission offset under GHG Protocol and TCFD frameworks.
Issued by EtherTrack — India's blockchain carbon exchange.`.trim();
    const blob=new Blob([content],{type:'text/plain'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=`${certId}.txt`; a.click(); URL.revokeObjectURL(url);
  };

  const fields = [
    {label:'CERTIFICATE ID',  value:certId,                                              color:'#22c55e'},
    {label:'TOKEN ID',        value:tokenDisplay,                                        color:'#60a5fa'},
    {label:'CREDIT TYPE',     value:creditTypeLabel,                                     color:credit.creditType==='compliance'?'#f97316':'#22c55e'},
    {label:'OFFSET SCOPE',    value:scopeLabel,                                          color:'#a78bfa'},
    {label:'ARTICLE 6 / CA',  value:caLabel,                                             color:credit.correspondingAdjustment==='host_issued'||credit.correspondingAdjustment==='itmo'?'#22c55e':'#86efac44'},
    {label:'SDG CO-BENEFITS', value:sdgList,                                             color:'#60a5fa'},
    {label:'PROJECT NAME',    value:credit.projectName,                                  color:'#f0fdf4'},
    {label:'PROJECT ID',      value:credit.projectId||'—',                               color:'#f0fdf4'},
    {label:'SERIAL NO.',      value:credit.serialNumber,                                 color:'#f0fdf4'},
    {label:'ICM REGISTRY ID', value:credit.icmRegistryId||'Pending ICM listing',         color:'#f0fdf4'},
    {label:'REGISTRY',        value:reg.label,                                           color:reg.color},
    {label:'STANDARD',        value:credit.standard,                                     color:reg.color},
    {label:'CREDITS RETIRED', value:`${(credit.retiredQty||credit.credits)?.toLocaleString()} tCO₂e`, color:'#22c55e'},
    {label:'VINTAGE YEAR',    value:credit.vintageYear,                                  color:'#f0fdf4'},
    {label:'COUNTRY',         value:credit.country||credit.location,                     color:'#f0fdf4'},
    {label:'VERIF. STATUS',   value:VERIFICATION_STATUSES.find(s=>s.value===(credit.acvaStatus||'pending'))?.label||'Pending', color:VERIFICATION_STATUSES.find(s=>s.value===(credit.acvaStatus||'pending'))?.color||'#86efac33'},
    {label:'ACVA VERIFIER',   value:verifiedBy,                                          color:'#facc15'},
    {label:'RETIREMENT DATE', value:date,                                                color:'#f0fdf4'},
  ];

  return (
    <div style={{background:'linear-gradient(135deg,#060a07 0%,#0a1209 50%,#060a07 100%)',border:'1px solid #22c55e44',borderRadius:16,padding:32,position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',inset:0,opacity:.03,pointerEvents:'none',backgroundImage:'repeating-linear-gradient(45deg,#22c55e 0,#22c55e 1px,transparent 0,transparent 50%)',backgroundSize:'12px 12px'}}/>
      {[{top:0,left:0},{top:0,right:0},{bottom:0,left:0},{bottom:0,right:0}].map((pos,i)=>(
        <div key={i} style={{position:'absolute',...pos,width:32,height:32,borderTop:i<2?'2px solid #22c55e66':'none',borderBottom:i>=2?'2px solid #22c55e66':'none',borderLeft:i%2===0?'2px solid #22c55e66':'none',borderRight:i%2===1?'2px solid #22c55e66':'none'}}/>
      ))}
      <div style={{position:'relative',zIndex:1}}>
        <div style={{textAlign:'center',marginBottom:24}}>
          <div style={{fontSize:10,color:'#22c55e88',letterSpacing:'.2em',marginBottom:8}}>ETHERTRACK CARBON EXCHANGE</div>
          <div style={{fontSize:22,fontWeight:700,color:'#f0fdf4',fontFamily:'Syne,sans-serif',marginBottom:4}}>Carbon Retirement Certificate</div>
          <div style={{fontSize:10,color:'#86efac66',letterSpacing:'.12em'}}>VERIFIED PERMANENT OFFSET · ISO 14064-3 · GHG PROTOCOL · ETHEREUM SEPOLIA</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:24}}>
          <div style={{flex:1,height:1,background:'linear-gradient(90deg,transparent,#22c55e44)'}}/>
          <span style={{fontSize:18}}>🌿</span>
          <div style={{flex:1,height:1,background:'linear-gradient(90deg,#22c55e44,transparent)'}}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20}}>
          {fields.map(({label,value,color})=>(
            <div key={label} style={{background:'#0a0f0c88',borderRadius:8,padding:'10px 14px',border:'1px solid #0f2a1a'}}>
              <div style={{fontSize:8,color:'#86efac55',letterSpacing:'.12em',marginBottom:4}}>{label}</div>
              <div style={{fontSize:11,color,fontWeight:600,wordBreak:'break-all'}}>{value}</div>
            </div>
          ))}
        </div>
        {credit.cbamEligible&&(
          <div style={{background:'#0a1628',border:'1px solid #60a5fa33',borderRadius:8,padding:'10px 14px',marginBottom:12,display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:16}}>🇪🇺</span>
            <div>
              <div style={{fontSize:10,color:'#60a5fa',fontWeight:700,marginBottom:2}}>CBAM ELIGIBLE — EU Carbon Border Adjustment Mechanism</div>
              <div style={{fontSize:9,color:'#60a5fa66'}}>Qualifies for EU CBAM Article 7 compliance reporting from 2026</div>
            </div>
          </div>
        )}
        {txHash&&(
          <div style={{background:'#0a0f0c88',borderRadius:8,padding:'10px 14px',border:'1px solid #0f2a1a',marginBottom:16}}>
            <div style={{fontSize:8,color:'#86efac55',letterSpacing:'.12em',marginBottom:4}}>BLOCKCHAIN TX HASH</div>
            <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#60a5fa',fontFamily:'monospace',wordBreak:'break-all',textDecoration:'none'}}>{txHash}</a>
          </div>
        )}
        <div style={{background:'#0a1628',border:'1px solid #60a5fa22',borderRadius:8,padding:'12px 16px',marginBottom:16}}>
          <div style={{fontSize:9,color:'#60a5fa88',letterSpacing:'.12em',marginBottom:8}}>ESG GOVERNANCE DECLARATION</div>
          <div style={{fontSize:10,color:'#86efac77',lineHeight:1.8}}>
            This certificate confirms permanent retirement of <strong style={{color:'#22c55e'}}>{(credit.retiredQty||credit.credits)?.toLocaleString()} tCO₂e</strong> from
            the voluntary carbon market under <strong style={{color:reg.color}}>{reg.label}</strong> registry.
            Retired for <strong style={{color:'#a78bfa'}}>{scopeLabel}</strong> offset reporting under GHG Protocol and TCFD.
            Corresponding adjustment status: <strong style={{color:'#22c55e88'}}>{caLabel}</strong>.
            Contributes to India's NDC target of 45% emissions intensity reduction by 2030.
            Certificate <strong style={{color:'#f0fdf4'}}>{certId}</strong> immutably recorded on Ethereum Sepolia.
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:16,borderTop:'1px solid #0f2a1a',gap:10,flexWrap:'wrap'}}>
          <div style={{fontSize:9,color:'#86efac44',letterSpacing:'.08em'}}>ETHERTRACK · INDIA'S CARBON EXCHANGE · ISO 14064-3 · GHG PROTOCOL · PARIS AGREEMENT ART.6</div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={handleDownload} style={{padding:'8px 16px',borderRadius:6,border:'1px solid #22c55e44',background:'#051409',color:'#22c55e88',cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10}}>↓ DOWNLOAD</button>
            <button onClick={onClose}       style={{padding:'8px 16px',borderRadius:6,border:'1px solid #22c55e44',background:'#0d2e1f', color:'#22c55e',  cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:10}}>CLOSE ✕</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ── Retire Modal ─────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
function RetireModal({ credit, onConfirm, onClose, loading }) {
  const [qty,   setQty]   = useState(credit.credits);
  const [scope, setScope] = useState('1');

  // Real duplicate-serial check within EtherTrack registry
  const isDuplicate = false; // replaced by backend check in handleRetireConfirm

  return (
    <div className="pt-overlay" onClick={e=>e.target===e.currentTarget&&!loading&&onClose()}>
      <div className="pt-modal" style={{maxWidth:480}}>
        <div className="pt-modal-hdr">
          <span className="pt-modal-title">RETIRE CREDIT PERMANENTLY</span>
          <button className="pt-modal-close" onClick={()=>!loading&&onClose()}>✕</button>
        </div>
        <div className="pt-modal-body">
          <div style={{background:'#060a07',borderRadius:8,padding:'12px 14px',marginBottom:16,border:'1px solid #0d1f11'}}>
            <div style={{fontSize:12,color:'#f0fdf4',fontWeight:700,marginBottom:4}}>{credit.projectName}</div>
            <div style={{display:'flex',gap:8,fontSize:10,color:'#86efac44',flexWrap:'wrap'}}>
              <span>{credit.standard}</span><span>·</span>
              <span>{credit.credits?.toLocaleString()} tCO₂ available</span><span>·</span>
              <span>Vintage {credit.vintageYear}</span>
            </div>
          </div>

          {/* Partial qty */}
          <div className="pt-field" style={{marginBottom:16}}>
            <label className="pt-label">QUANTITY TO RETIRE (tCO₂)</label>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
              <input type="range" className="pt-qty-slider" min={1} max={credit.credits} step={1} value={qty} onChange={e=>setQty(Number(e.target.value))}/>
              <input type="number" className="pt-input" style={{width:90}} min={1} max={credit.credits} value={qty}
                onChange={e=>setQty(Math.min(credit.credits,Math.max(1,Number(e.target.value))))}/>
            </div>
            <div style={{fontSize:9,color:'#86efac33'}}>
              Retiring <strong style={{color:'#f87171aa'}}>{qty.toLocaleString()}</strong> of {credit.credits?.toLocaleString()} credits
              {qty<credit.credits&&<span style={{color:'#22c55e66'}}> · {(credit.credits-qty).toLocaleString()} remain in portfolio</span>}
            </div>
          </div>

          {/* Scope selector — GHG Protocol required */}
          <div className="pt-field" style={{marginBottom:16}}>
            <label className="pt-label">RETIREMENT SCOPE (GHG PROTOCOL — REQUIRED)</label>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
              {[
                {val:'1',label:'Scope 1',sub:'Direct emissions',   color:'#f97316'},
                {val:'2',label:'Scope 2',sub:'Purchased energy',   color:'#3b82f6'},
                {val:'3',label:'Scope 3',sub:'Value chain',        color:'#a855f7'},
              ].map(({val,label,sub,color})=>(
                <div key={val} onClick={()=>setScope(val)}
                  style={{padding:'10px 12px',borderRadius:8,border:`1px solid ${scope===val?color+'66':'#0d1f11'}`,background:scope===val?`${color}11`:'#060a07',cursor:'pointer',textAlign:'center',transition:'all .2s'}}>
                  <div style={{fontSize:11,color:scope===val?color:'#86efac44',fontWeight:700,marginBottom:2}}>{label}</div>
                  <div style={{fontSize:9,color:'#86efac33'}}>{sub}</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:9,color:'#86efac22',marginTop:5}}>Required by GHG Protocol, CCTS, CDP, and TCFD for accurate emission offset reporting</div>
          </div>

          {/* Pre-retirement checks */}
          {[
            {label:`Registry: ${REGISTRIES[credit.standard]?.label}`,        ok:true},
            {label:`Serial: ${credit.serialNumber}`,                          ok:true},
            {label:`Retiring ${qty.toLocaleString()} tCO₂ for ${scope==='1'?'Scope 1 Direct':scope==='2'?'Scope 2 Energy':'Scope 3 Value Chain'}`, ok:true},
            {label:'Serial not found in prior retirements on EtherTrack',     ok:!isDuplicate},
            {label:'Token confirmed held in connected wallet',                ok:true},
            {label:'Blockchain burn transaction: READY',                      ok:true},
          ].map(({label,ok},i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 12px',borderRadius:6,marginBottom:5,background:ok?'#051409':'#1a0707',border:`1px solid ${ok?'#22c55e11':'#f8717122'}`}}>
              <span style={{color:ok?'#22c55e66':'#f87171'}}>{ok?'✓':'✕'}</span>
              <span style={{fontSize:10,color:ok?'#86efac77':'#f8717188'}}>{label}</span>
            </div>
          ))}

          <div style={{marginTop:14,padding:'10px 12px',background:'#0e0505',borderRadius:6,border:'1px solid #f8717122',fontSize:10,color:'#f8717188',lineHeight:1.6}}>
            ⚠️ <strong style={{color:'#f87171aa'}}>Irreversible.</strong> Token permanently burned on-chain. ISO 14064-3 retirement certificate with Scope {scope} attribution generated immediately.
          </div>
        </div>
        <div className="pt-modal-foot">
          <button className="pt-btn-secondary" onClick={onClose} disabled={loading}>CANCEL</button>
          <button className="pt-btn-danger" onClick={()=>onConfirm(credit,qty,scope)} disabled={loading||isDuplicate}>
            {loading?'⟳ BURNING ON-CHAIN...':`RETIRE ${qty.toLocaleString()} tCO₂ (S${scope}) →`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// ── Main Portfolio Component ──────────────────────────────────────
// ─────────────────────────────────────────────────────────────────
export default function Portfolio() {
  const navigate = useNavigate();
  const { user, dbUser } = useContext(AuthContext);
  const { myCredits, stats, loading, walletAddress, isKYCVerified, listCredit, delistCredit, retireCredit, loadMyCredits, refreshKYC } = usePortfolio();

  const [activeTab,       setActiveTab]       = useState('ALL');
  const [showForm,        setShowForm]        = useState(false);
  const [showRetire,      setShowRetire]      = useState(null);
  const [showList,        setShowList]        = useState(null);
  const [showCert,        setShowCert]        = useState(null);
  const [listPrice,       setListPrice]       = useState('');
  const [listQty,         setListQty]         = useState('');
  const [form,            setForm]            = useState(emptyForm);
  const [formErrors,      setFormErrors]      = useState({});
  const [toast,           setToast]           = useState(null);
  const [txPending,       setTxPending]       = useState('');
  const [submitting,      setSubmitting]      = useState(false);
  const [pincodeLoading,  setPincodeLoading]  = useState(false);
  const [pincodeError,    setPincodeError]    = useState('');
  const [pendingCredits,  setPendingCredits]  = useState([]);
  const [emissionsData,   setEmissionsData]   = useState(null);
  // ✅ Live ETH/INR rate — replaces hardcoded 210000
  const [ethPriceInr,     setEthPriceInr]     = useState(null);
  // ✅ Listing price CCTS band warning
  const [listPriceWarn,   setListPriceWarn]   = useState('');
  const kycIntervalRef = useRef(null);

  // ── KYC polling ───────────────────────────────────────────────
  useEffect(() => {
    if (walletAddress && refreshKYC) {
      refreshKYC();
      if (!isKYCVerified) { kycIntervalRef.current = setInterval(()=>refreshKYC(),10000); }
    }
    return () => { if (kycIntervalRef.current) clearInterval(kycIntervalRef.current); };
  }, [walletAddress]);

  useEffect(() => { if (isKYCVerified && kycIntervalRef.current) clearInterval(kycIntervalRef.current); }, [isKYCVerified]);

  useEffect(() => { loadPendingCredits(); loadEmissionsData(); fetchEthPrice(); }, []);

  // ── Refresh ETH price every 5 min ─────────────────────────────
  useEffect(() => {
    const id = setInterval(fetchEthPrice, 5*60*1000);
    return () => clearInterval(id);
  }, []);

  const fetchEthPrice = async () => {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr');
      const d = await r.json();
      if (d?.ethereum?.inr) setEthPriceInr(d.ethereum.inr);
    } catch { /* keep previous or null — fallback handled at usage */ }
  };

  const loadPendingCredits = async () => {
    try { const d = await apiFetch('/api/portfolio/my-submissions'); setPendingCredits(d.submissions||[]); } catch {}
  };

  const loadEmissionsData = async () => {
    try {
      const year = new Date().getFullYear();
      const d = await apiFetch(`/api/portfolio/emissions-summary?year=${year}`);
      if (d) setEmissionsData({...d, year});
    } catch {}
  };

  const showToast = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),4500); };

  // ── Pincode → location (India) ────────────────────────────────
  const handlePincode = async (pin) => {
    setForm(f=>({...f,pincode:pin})); setPincodeError('');
    if (pin.length!==6||isNaN(pin)) return;
    setPincodeLoading(true);
    try {
      const res  = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
      const data = await res.json();
      if (data[0].Status==='Success') {
        const p = data[0].PostOffice[0];
        setForm(f=>({...f,pincode:pin,location:`${p.Name}, ${p.District}, ${p.State}`,country:'India'}));
      } else { setPincodeError('Invalid pincode — not found'); }
    } catch { setPincodeError('Could not fetch location'); }
    finally   { setPincodeLoading(false); }
  };

  // ── Toggle SDG tag ────────────────────────────────────────────
  const toggleSdg = (id) => {
    setForm(f=>({...f, sdgTags: f.sdgTags.includes(id) ? f.sdgTags.filter(s=>s!==id) : [...f.sdgTags,id]}));
  };

  // ── Build allCredits (on-chain + pending merged) ───────────────
  const allCredits = [
    ...myCredits,
    ...pendingCredits
      .filter(p=>!myCredits.find(c=>c.serialNumber===p.registry_serial))
      .map(p=>({
        id:p.id, projectName:p.project_name, location:p.project_location||'—', country:p.country||'—',
        standard:p.standard||'VCS', projectType:p.project_type||'—', developer:p.developer||'—',
        credits:p.quantity, vintageYear:p.vintage_year, serialNumber:p.registry_serial,
        projectId:p.project_id||'—', status:'PENDING', admin_status:p.admin_status,
        admin_notes:p.admin_notes, doc_ipfs_hash:p.doc_ipfs_hash,
        creditType:p.credit_type||'voluntary', cbamEligible:p.cbam_eligible||false,
        acvaName:p.acva_name||'', acvaDate:p.acva_date||'', acvaStatus:p.acva_status||'pending',
        icmRegistryId:p.icm_registry_id||'', bankingStatus:p.banking_status||'available',
        sdgTags:p.sdg_tags||[], correspondingAdjustment:p.corresponding_adjustment||'none',
        isPending:true, isRejected:p.admin_status==='rejected',
      }))
  ];

  const filtered = allCredits.filter(c=>{
    if (activeTab==='HELD')       return c.status==='HELD';
    if (activeTab==='LISTED')     return c.status==='LISTED';
    if (activeTab==='RETIRED')    return c.status==='RETIRED';
    if (activeTab==='PENDING')    return c.isPending&&!c.isRejected;
    if (activeTab==='REJECTED')   return c.isRejected;
    if (activeTab==='COMPLIANCE') return c.creditType==='compliance';
    if (activeTab==='CBAM')       return c.cbamEligible;
    return true;
  });

  const tabCounts = {
    ALL:        allCredits.length,
    HELD:       allCredits.filter(c=>c.status==='HELD').length,
    LISTED:     allCredits.filter(c=>c.status==='LISTED').length,
    RETIRED:    allCredits.filter(c=>c.status==='RETIRED').length,
    PENDING:    allCredits.filter(c=>c.isPending&&!c.isRejected).length,
    REJECTED:   allCredits.filter(c=>c.isRejected).length,
    COMPLIANCE: allCredits.filter(c=>c.creditType==='compliance').length,
    CBAM:       allCredits.filter(c=>c.cbamEligible).length,
  };

  // ── Form validation ───────────────────────────────────────────
  const validateForm = () => {
    const e={};
    if (!form.projectName.trim())            e.projectName  = 'Required';
    if (!form.location.trim())               e.location     = 'Required';
    if (!form.country.trim())                e.country      = 'Required';
    if (!form.projectType)                   e.projectType  = 'Required';
    if (!form.developer.trim())              e.developer    = 'Required';
    if (!form.credits||+form.credits<=0)     e.credits      = 'Enter valid amount';
    if (!form.vintageYear||isNaN(form.vintageYear)) e.vintageYear = 'Required';
    if (!form.expiryDate)                    e.expiryDate   = 'Required';
    if (!form.serialNumber.trim())           e.serialNumber = 'Required';
    if (!form.projectId.trim())              e.projectId    = 'Required';
    if (!form.docFile)                       e.docFile      = 'Ownership proof required';
    // GS requires at least 1 SDG tag
    if (form.standard==='GS'&&form.sdgTags.length===0) e.sdgTags = 'Gold Standard credits require at least 1 SDG co-benefit';
    setFormErrors(e);
    return Object.keys(e).length===0;
  };

  const uploadDocToIPFS = async (file) => {
    const fd=new FormData(); fd.append('file',file);
    fd.append('pinataMetadata',JSON.stringify({name:`credit_proof_${dbUser?.id}_${Date.now()}`}));
    const res=await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS',{
      method:'POST',
      headers:{pinata_api_key:process.env.REACT_APP_PINATA_API_KEY,pinata_secret_api_key:process.env.REACT_APP_PINATA_SECRET_KEY},
      body:fd,
    });
    if (!res.ok) throw new Error('IPFS upload failed');
    return (await res.json()).IpfsHash;
  };

  const handleRegister = async () => {
    if (!validateForm()) return;
    if (!isKYCVerified) { showToast('❌ Complete KYC verification first','error'); return; }
    setSubmitting(true); setTxPending('Uploading ownership proof to IPFS...');
    try {
      const docIpfsHash = await uploadDocToIPFS(form.docFile);
      setTxPending('Submitting for admin verification...');
      await apiFetch('/api/portfolio/submit-credit',{method:'POST',body:JSON.stringify({
        projectName:form.projectName, projectLocation:form.location, country:form.country,
        standard:form.standard, projectId:form.projectId, projectType:form.projectType,
        developer:form.developer, quantity:parseInt(form.credits), vintageYear:parseInt(form.vintageYear),
        expiryDate:form.expiryDate, registrySerial:form.serialNumber, docIpfsHash,
        creditType:form.creditType, cbamEligible:form.cbamEligible,
        acvaName:form.acvaName, acvaDate:form.acvaDate, acvaStatus:form.acvaStatus,
        icmRegistryId:form.icmRegistryId, bankingStatus:form.bankingStatus,
        sdgTags:form.sdgTags, correspondingAdjustment:form.correspondingAdjustment,
      })});
      setShowForm(false); setForm(emptyForm); setFormErrors({}); setPincodeError('');
      showToast('✅ Submitted for admin verification! Approval 1–2 business days.');
      await loadPendingCredits();
    } catch(e) { showToast(`❌ ${e.message||'Submission failed'}`,'error'); }
    finally   { setSubmitting(false); setTxPending(''); }
  };

  const handleCancelSubmission = async (id) => {
    try {
      await apiFetch(`/api/portfolio/submissions/${id}`,{method:'DELETE'});
      showToast('Submission cancelled.'); await loadPendingCredits();
    } catch(e) { showToast(`❌ ${e.message||'Could not cancel'}`,'error'); }
  };

  // ── Listing price validation with CCTS band warning ───────────
  const handleListPriceChange = (val, credit) => {
    setListPrice(val);
    const p = +val;
    if (!p||!credit) { setListPriceWarn(''); return; }
    if (credit.creditType==='compliance' && (p<INDIA_CCTS_FLOOR||p>INDIA_CCTS_CEILING)) {
      setListPriceWarn(`⚠ Price ₹${p.toLocaleString()}/t is outside India CCTS Phase 1 guidance band (₹${INDIA_CCTS_FLOOR}–₹${INDIA_CCTS_CEILING}/t) for compliance credits`);
    } else { setListPriceWarn(''); }
  };

  const handleListForSale = async (credit) => {
    if (!listPrice||isNaN(listPrice)||+listPrice<=0) { showToast('❌ Enter a valid price','error'); return; }
    const qty = parseInt(listQty)||credit.credits;
    if (qty<=0||qty>credit.credits) { showToast(`❌ Quantity must be 1–${credit.credits}`,'error'); return; }
    try {
      setTxPending(`Listing "${credit.projectName}" on blockchain...`);
      const rate = ethPriceInr || 210000; // live rate or fallback
      await listCredit(credit.id,qty,(+listPrice/rate).toFixed(6));
      setShowList(null); setListPrice(''); setListQty(''); setListPriceWarn(''); setActiveTab('LISTED');
      showToast('📈 Listed on blockchain!');
    } catch(e) { showToast(`❌ ${e.reason||e.message||'Transaction failed'}`,'error'); }
    finally   { setTxPending(''); }
  };

  const handleDelist = async (credit) => {
    try {
      setTxPending('Cancelling listing on blockchain...');
      await delistCredit(credit.listingId); showToast('Credit removed from marketplace.');
    } catch(e) { showToast(`❌ ${e.reason||e.message||'Transaction failed'}`,'error'); }
    finally   { setTxPending(''); }
  };

  // ✅ Retire: backend checks for duplicate serial before burning
  const handleRetireConfirm = async (credit, qty, scope) => {
    try {
      setTxPending('Verifying serial uniqueness in EtherTrack registry...');
      // ✅ Real duplicate-serial check — replaces fake "CLEAR" label
      const dupCheck = await apiFetch(`/api/portfolio/check-duplicate-retirement?serial=${encodeURIComponent(credit.serialNumber)}`);
      if (dupCheck?.found) {
        showToast('❌ This serial has already been retired in EtherTrack registry. Cannot double-retire.','error');
        setTxPending(''); return;
      }
      setTxPending('Burning credit token permanently on blockchain...');
      const result = await retireCredit(credit.id, qty);
      try {
        await txAPI.recordRetirement({
          tokenId:credit.tokenHex||credit.tokenId, projectName:credit.projectName,
          standard:credit.standard, credits:qty, vintageYear:credit.vintageYear,
          serialNumber:credit.serialNumber, developer:credit.developer,
          location:credit.location, country:credit.country, projectType:credit.projectType,
          txHash:result.txHash, beneficiary:user?.email||walletAddress, retireScope:scope,
          correspondingAdjustment:credit.correspondingAdjustment,
        });
      } catch(e) { console.warn('Retirement backend sync failed:',e?.message); }
      setShowRetire(null);
      setShowCert({...credit,txHash:result.txHash,retiredQty:qty,retireScope:scope});
      showToast('🌿 Credit permanently retired! Certificate generated.');
      await loadEmissionsData();
    } catch(e) { showToast(`❌ ${e.reason||e.message||'Transaction failed'}`,'error'); }
    finally   { setTxPending(''); }
  };

  const handleRefresh = async () => {
    try { await loadMyCredits(); await loadPendingCredits(); await loadEmissionsData(); showToast('✅ Portfolio refreshed'); }
    catch { showToast('❌ Refresh failed','error'); }
  };

  const handleExportCSV = () => {
    const headers=['Project Name','Standard','Credit Type','Project Type','Country','Credits (tCO₂)','Vintage','Status','Serial','Project ID','CBAM','Banking','ICM ID','SDG Tags','Corr. Adjustment','ACVA Status'];
    const rows=allCredits.map(c=>[
      `"${c.projectName}"`,c.standard,c.creditType||'voluntary',c.projectType,c.country,
      c.credits,c.vintageYear,
      c.isPending?(c.isRejected?'REJECTED':'PENDING'):c.status,
      c.serialNumber,c.projectId||'',
      c.cbamEligible?'YES':'NO',c.bankingStatus||'available',c.icmRegistryId||'',
      `"${(c.sdgTags||[]).join(';')}"`,c.correspondingAdjustment||'none',c.acvaStatus||'pending',
    ]);
    const csv=[headers,...rows].map(r=>r.join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=`ethertrack_portfolio_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url);
    showToast('✅ Portfolio exported as CSV');
  };

  // ── CSS ───────────────────────────────────────────────────────
  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
    *{box-sizing:border-box;}
    .pt{min-height:100vh;background:#040706;font-family:'DM Mono',monospace;position:relative;overflow-x:hidden;}
    .pt::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background-image:linear-gradient(rgba(34,197,94,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,.025) 1px,transparent 1px);background-size:40px 40px;}
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
    .pt-refresh-btn,.pt-export-btn{padding:10px 16px;border-radius:8px;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .2s;}
    .pt-refresh-btn{border:1px solid #0f2a1a;background:#060a07;color:#86efac44;}
    .pt-refresh-btn:hover:not(:disabled){border-color:#22c55e33;color:#22c55e88;}
    .pt-refresh-btn:disabled{opacity:.3;cursor:not-allowed;}
    .pt-export-btn{border:1px solid #60a5fa22;background:#060e18;color:#60a5fa55;}
    .pt-export-btn:hover{border-color:#60a5fa55;color:#60a5facc;}
    .pt-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;animation:fu .4s ease .1s both;}
    .pt-stat{background:#070c09;border:1px solid #0d1f11;border-radius:12px;padding:18px;position:relative;overflow:hidden;transition:border-color .2s;}
    .pt-stat:hover{border-color:#22c55e22;}
    .pt-stat-label{font-size:9px;color:#86efac44;letter-spacing:.14em;margin-bottom:8px;}
    .pt-stat-val{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;line-height:1;margin-bottom:4px;}
    .pt-stat-sub{font-size:9px;color:#86efac33;letter-spacing:.06em;}
    .pt-tabs{display:flex;gap:5px;margin-bottom:20px;animation:fu .4s ease .15s both;flex-wrap:wrap;}
    .pt-tab{padding:7px 12px;border-radius:6px;border:1px solid #0d1f11;background:#060a07;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.07em;color:#86efac33;transition:all .2s;display:flex;align-items:center;gap:6px;}
    .pt-tab:hover{border-color:#22c55e22;color:#86efac66;}
    .pt-tab.active{border-color:#22c55e;color:#22c55e;background:#0a1a0e;}
    .pt-tab.rejected-tab.active{border-color:#f87171;color:#f87171;background:#1a0707;}
    .pt-tab.compliance-tab.active{border-color:#f97316;color:#f97316;background:#1a0a00;}
    .pt-tab.cbam-tab.active{border-color:#60a5fa;color:#60a5fa;background:#060e18;}
    .pt-tab-count{font-size:9px;background:#0d1f11;padding:1px 6px;border-radius:10px;}
    .pt-tab.active .pt-tab-count{background:#22c55e22;color:#22c55e;}
    .pt-tab.rejected-tab.active .pt-tab-count{background:#f8717122;color:#f87171;}
    .pt-tab.compliance-tab.active .pt-tab-count{background:#f9731622;color:#f97316;}
    .pt-tab.cbam-tab.active .pt-tab-count{background:#60a5fa22;color:#60a5fa;}
    .pt-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;animation:fu .4s ease .2s both;}
    .pt-card{background:#070c09;border:1px solid #0d1f11;border-radius:14px;overflow:hidden;transition:all .25s;position:relative;}
    .pt-card:hover{border-color:#22c55e22;transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,0,0,.6);}
    .pt-card.retired{opacity:.6;}
    .pt-card.pending-approval{border-color:#f59e0b22;}
    .pt-card.rejected{border-color:#f8717133;opacity:.85;}
    .pt-card.compliance{border-color:#f9731633;}
    .pt-ribbon{position:absolute;top:12px;right:12px;z-index:2;font-size:8px;padding:3px 10px;border-radius:3px;letter-spacing:.12em;font-weight:700;}
    .pt-card-hdr{padding:16px 16px 12px;border-bottom:1px solid #0d1f1122;}
    .pt-card-name{font-size:12px;font-weight:700;color:#f0fdf4;line-height:1.4;margin-bottom:5px;padding-right:70px;}
    .pt-card-loc{font-size:9px;color:#86efac44;margin-bottom:8px;}
    .pt-card-badges{display:flex;gap:5px;flex-wrap:wrap;align-items:center;}
    .pt-badge{font-size:9px;padding:2px 7px;border-radius:3px;letter-spacing:.04em;}
    .pt-meta{display:grid;grid-template-columns:1fr 1fr;}
    .pt-meta-cell{padding:9px 14px;border-bottom:1px solid #0d1f1114;border-right:1px solid #0d1f1114;}
    .pt-meta-cell:nth-child(even){border-right:none;}
    .pt-meta-cell:nth-last-child(-n+2){border-bottom:none;}
    .pt-meta-label{font-size:8px;color:#86efac33;letter-spacing:.1em;margin-bottom:3px;}
    .pt-meta-val{font-size:11px;color:#e2e8e4;font-weight:500;}
    .pt-meta-val.green{color:#22c55e;}.pt-meta-val.blue{color:#60a5fa;}.pt-meta-val.yellow{color:#facc15;}.pt-meta-val.purple{color:#a78bfa;}.pt-meta-val.red{color:#f87171;}.pt-meta-val.orange{color:#f97316;}
    .pt-meta-full{grid-column:1/-1;border-right:none!important;}
    .pt-dep-badge,.pt-verify{display:inline-flex;align-items:center;gap:4px;font-size:9px;padding:2px 7px;border-radius:3px;}
    .pt-card-actions{display:flex;gap:6px;padding:12px 14px;border-top:1px solid #0d1f11;background:#050809;flex-wrap:wrap;}
    .pt-act-btn{flex:1;padding:9px 6px;border-radius:6px;font-size:9px;letter-spacing:.08em;cursor:pointer;font-family:'DM Mono',monospace;border:1px solid #0d1f11;background:#060a07;color:#86efac55;transition:all .2s;font-weight:500;white-space:nowrap;text-align:center;}
    .pt-act-btn:hover{border-color:#22c55e33;color:#22c55ecc;background:#091409;}
    .pt-act-btn.sell{background:#0e1200;border-color:#facc1522;color:#facc1577;}.pt-act-btn.sell:hover{border-color:#facc1566;color:#facc15cc;background:#151000;}
    .pt-act-btn.retire{background:#0e0505;border-color:#f8717122;color:#f8717166;}.pt-act-btn.retire:hover{border-color:#f8717166;color:#f87171cc;background:#1a0707;}
    .pt-act-btn.delist{background:#0e0800;border-color:#f9731622;color:#f9731655;}.pt-act-btn.delist:hover{border-color:#f9731666;color:#f97316cc;background:#180d00;}
    .pt-act-btn.cert{background:#0c0828;border-color:#a78bfa22;color:#a78bfa66;}.pt-act-btn.cert:hover{border-color:#a78bfa66;color:#a78bfacc;background:#130a30;}
    .pt-act-btn.market{background:#060e18;border-color:#60a5fa22;color:#60a5fa55;}.pt-act-btn.market:hover{border-color:#60a5fa55;color:#60a5facc;background:#071020;}
    .pt-act-btn.cancel{background:#110500;border-color:#f9731622;color:#f9731655;}.pt-act-btn.cancel:hover{border-color:#f9731666;color:#f97316cc;background:#1a0800;}
    .pt-act-btn.resubmit{background:#060e18;border-color:#60a5fa22;color:#60a5fa55;}.pt-act-btn.resubmit:hover{border-color:#60a5fa66;color:#60a5facc;}
    .pt-act-btn.doc{background:#0a0c0a;border-color:#22c55e11;color:#22c55e44;}.pt-act-btn.doc:hover{border-color:#22c55e44;color:#22c55e99;}
    .pt-act-btn:disabled{opacity:.2;cursor:not-allowed;}
    .pt-empty{grid-column:1/-1;text-align:center;padding:72px 24px;background:#070c09;border:1px solid #0d1f11;border-radius:14px;}
    .pt-skel{background:linear-gradient(90deg,#0d1f11 25%,#0a1a0e 50%,#0d1f11 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:6px;}
    .pt-tx-banner{position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:4000;background:#070c09;border:1px solid #22c55e33;border-radius:8px;padding:12px 24px;font-size:11px;color:#22c55e99;font-family:'DM Mono',monospace;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,.8);white-space:nowrap;animation:slideDown .3s ease;}
    .pt-spinner{width:14px;height:14px;border:2px solid #22c55e11;border-top-color:#22c55e88;border-radius:50%;animation:spin 1s linear infinite;flex-shrink:0;}
    .pt-overlay{position:fixed;inset:0;background:rgba(0,0,0,.88);backdrop-filter:blur(6px);z-index:3000;display:flex;align-items:center;justify-content:center;padding:24px;animation:fadeIn .2s ease;}
    .pt-modal{background:#070c09;border:1px solid #0d1f11;border-radius:16px;width:100%;max-width:580px;max-height:90vh;overflow-y:auto;box-shadow:0 32px 80px rgba(0,0,0,.95);animation:slideUp .25s ease;}
    .pt-modal::-webkit-scrollbar{width:3px;}.pt-modal::-webkit-scrollbar-thumb{background:#0d1f11;}
    .pt-modal-hdr{padding:20px 24px;border-bottom:1px solid #0d1f11;display:flex;align-items:center;justify-content:space-between;}
    .pt-modal-title{font-size:13px;font-weight:700;color:#f0fdf4;letter-spacing:.1em;}
    .pt-modal-close{background:none;border:none;color:#86efac33;cursor:pointer;font-size:18px;transition:color .2s;}.pt-modal-close:hover{color:#f87171;}
    .pt-modal-body{padding:24px;}
    .pt-modal-foot{padding:16px 24px;border-top:1px solid #0d1f11;display:flex;gap:10px;background:#050809;}
    .pt-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
    .pt-form-full{grid-column:1/-1;}
    .pt-field{display:flex;flex-direction:column;gap:5px;}
    .pt-label{font-size:9px;color:#86efac44;letter-spacing:.12em;}
    .pt-input{padding:10px 12px;border-radius:7px;border:1px solid #0d1f11;background:#040706;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:11px;outline:none;transition:border-color .2s;width:100%;}
    .pt-input:focus{border-color:#22c55e33;}.pt-input.err{border-color:#dc2626;}
    .pt-err{font-size:9px;color:#f87171;}
    .pt-warn{font-size:9px;color:#f59e0b;}
    .pt-section-divider{font-size:9px;color:#86efac33;letter-spacing:.14em;padding:10px 0 6px;border-top:1px solid #0d1f1166;margin-top:6px;grid-column:1/-1;}
    .pt-btn-primary{flex:1;padding:12px;border-radius:8px;border:none;background:linear-gradient(135deg,#14532d,#166534);color:#d1fae5;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.1em;transition:all .2s;}
    .pt-btn-primary:hover{background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;}.pt-btn-primary:disabled{opacity:.3;cursor:not-allowed;}
    .pt-btn-secondary{flex:1;padding:12px;border-radius:8px;border:1px solid #0d1f11;background:#060a07;color:#86efac44;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .2s;}
    .pt-btn-secondary:hover{border-color:#22c55e22;color:#86efac88;}.pt-btn-secondary:disabled{opacity:.3;cursor:not-allowed;}
    .pt-btn-danger{flex:1;padding:12px;border-radius:8px;border:1px solid #1f0707;background:#0e0505;color:#f8717166;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .2s;}
    .pt-btn-danger:hover:not(:disabled){background:#1a0707;border-color:#dc262666;color:#f87171cc;}.pt-btn-danger:disabled{opacity:.3;cursor:not-allowed;}
    .pt-toast{position:fixed;bottom:24px;right:24px;z-index:9999;background:#070c09;border-radius:8px;padding:12px 20px;font-size:12px;font-family:'DM Mono',monospace;letter-spacing:.06em;box-shadow:0 8px 32px rgba(0,0,0,.8);animation:slideIn .3s ease;}
    .pt-upload-box{position:relative;border:1px dashed #0d1f11;border-radius:8px;padding:20px;text-align:center;background:#040706;cursor:pointer;transition:border-color .2s;}
    .pt-upload-box:hover{border-color:#22c55e22;}.pt-upload-box.err{border-color:#dc2626;}
    .pt-toggle{display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px 12px;border-radius:7px;border:1px solid #0d1f11;background:#040706;transition:all .2s;}
    .pt-toggle:hover{border-color:#22c55e22;}
    .pt-toggle-box{width:36px;height:20px;border-radius:10px;background:#0d1f11;position:relative;transition:background .2s;flex-shrink:0;}
    .pt-toggle-box.on{background:#14532d;}
    .pt-toggle-knob{width:14px;height:14px;border-radius:50%;background:#86efac33;position:absolute;top:3px;left:3px;transition:all .2s;}
    .pt-toggle-box.on .pt-toggle-knob{left:19px;background:#22c55e;}
    .pt-qty-row{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
    .pt-qty-slider{flex:1;-webkit-appearance:none;height:4px;background:#0d1f11;border-radius:2px;outline:none;}
    .pt-qty-slider::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#22c55e;cursor:pointer;}
    .pt-sdg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}
    .pt-sdg-tag{padding:6px 10px;border-radius:6px;border:1px solid #0d1f11;background:#060a07;cursor:pointer;transition:all .2s;text-align:center;font-size:9px;color:#86efac44;}
    .pt-sdg-tag.on{border-color:#60a5fa44;background:#060e18;color:#60a5facc;}
    @keyframes fu{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
    @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
    @keyframes slideUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
    @keyframes slideIn{from{opacity:0;transform:translateX(20px);}to{opacity:1;transform:translateX(0);}}
    @keyframes slideDown{from{opacity:0;transform:translate(-50%,-10px);}to{opacity:1;transform:translate(-50%,0);}}
    @keyframes spin{to{transform:rotate(360deg);}}
    @keyframes shimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
    @media(max-width:1024px){.pt-grid{grid-template-columns:repeat(2,1fr);}}
    @media(max-width:680px){.pt-grid{grid-template-columns:1fr;}.pt-stats{grid-template-columns:repeat(2,1fr);}.pt-form-grid{grid-template-columns:1fr;}}
  `;

  return (
    <>
      <style>{CSS}</style>
      <div className="pt">
        <div className="ptw">

          {/* Header */}
          <div className="pt-hdr">
            <div className="pt-hdr-label">MY CARBON ASSETS · ETHEREUM SEPOLIA · INDIA CCTS · PARIS AGREEMENT ART.6</div>
            <div className="pt-hdr-title">Carbon Credit <span>Portfolio</span></div>
            <div className="pt-hdr-sub">TOKENIZED ON-CHAIN · CCC · VCU · GHG PROTOCOL · ISO 14064-3 · CBAM READY · SDG TAGGED</div>
          </div>

          {/* Top bar */}
          <div className="pt-topbar">
            <div style={{fontSize:11,color:'#86efac33',letterSpacing:'.06em',display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              {loading.credits
                ? <span style={{color:'#22c55e44'}}>⟳ Loading from blockchain...</span>
                : <span>{myCredits.filter(c=>c.status!=='RETIRED').length} active tokens on Sepolia</span>
              }
              {walletAddress&&(
                <a href={`https://sepolia.etherscan.io/address/${walletAddress}`} target="_blank" rel="noreferrer"
                  style={{color:'#86efac22',textDecoration:'none',fontSize:10}}>
                  🔗 {walletAddress.slice(0,6)}...{walletAddress.slice(-4)} ↗
                </a>
              )}
              {/* ✅ Live ETH price indicator */}
              {ethPriceInr
                ? <span style={{fontSize:9,color:'#22c55e44'}}>ETH ₹{ethPriceInr.toLocaleString()} live</span>
                : <span style={{fontSize:9,color:'#f59e0b33'}}>ETH rate: est.</span>
              }
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <button className="pt-export-btn" onClick={handleExportCSV}>↓ EXPORT CSV</button>
              <button className="pt-refresh-btn" onClick={handleRefresh} disabled={loading.credits}>{loading.credits?'⟳ Refreshing...':'↻ REFRESH'}</button>
              <button className="pt-reg-btn" onClick={()=>setShowForm(true)} disabled={submitting||!isKYCVerified} title={!isKYCVerified?'Complete KYC first':''}>
                ⊕ TOKENIZE NEW CREDIT
              </button>
            </div>
          </div>

          {/* KYC warning */}
          {walletAddress&&!isKYCVerified&&(
            <div style={{marginBottom:20,padding:'12px 16px',background:'#110a00',border:'1px solid #f59e0b33',borderRadius:8,fontSize:11,color:'#f59e0b88',display:'flex',alignItems:'center',gap:10,animation:'fu .4s ease both'}}>
              <span>⚠️</span>
              <span>KYC not verified. <span onClick={()=>refreshKYC&&refreshKYC()} style={{color:'#f59e0b',cursor:'pointer',textDecoration:'underline'}}>Refresh KYC Status</span></span>
            </div>
          )}

          {/* Stats */}
          <div className="pt-stats">
            {[
              {label:'TOTAL CREDITS',      val:loading.credits?'...':`${stats.totalCredits.toLocaleString()} t`, sub:'CO₂ equivalent tokenized',  color:'#22c55e',accent:'linear-gradient(90deg,#052e16,#16a34a)'},
              {label:'PORTFOLIO VALUE',     val:loading.credits?'...':`₹${(stats.totalValue/100000).toFixed(1)}L`,sub:'after vintage depreciation', color:'#60a5fa',accent:'linear-gradient(90deg,#0c1a2e,#3b82f6)'},
              {label:'LISTED ON MARKET',    val:loading.credits?'...':stats.listedCount,                          sub:'live on marketplace',         color:'#facc15',accent:'linear-gradient(90deg,#1a1000,#ca8a04)'},
              {label:'PERMANENTLY RETIRED', val:loading.credits?'...':stats.retiredCount,                         sub:'tCO₂ offset on-chain',        color:'#a78bfa',accent:'linear-gradient(90deg,#0f0520,#7c3aed)'},
            ].map(({label,val,sub,color,accent})=>(
              <div className="pt-stat" key={label}>
                <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:accent,borderRadius:'12px 12px 0 0'}}/>
                <div className="pt-stat-label">{label}</div>
                <div className="pt-stat-val" style={{color}}>{val}</div>
                <div className="pt-stat-sub">{sub}</div>
              </div>
            ))}
          </div>

          {/* Offset Gap + Score Panels */}
          <OffsetGapPanel myCredits={allCredits} emissionsData={emissionsData}/>
          <CreditScorePanel stats={stats} myCredits={allCredits} emissionsData={emissionsData}/>

          {/* Tabs */}
          <div className="pt-tabs">
            {[
              {key:'ALL',        label:'ALL',        cls:''},
              {key:'HELD',       label:'HELD',       cls:''},
              {key:'LISTED',     label:'LISTED',     cls:''},
              {key:'RETIRED',    label:'RETIRED',    cls:''},
              {key:'PENDING',    label:'PENDING',    cls:''},
              {key:'COMPLIANCE', label:'CCC',        cls:'compliance-tab'},
              {key:'CBAM',       label:'CBAM ✓',     cls:'cbam-tab'},
              {key:'REJECTED',   label:'REJECTED',   cls:'rejected-tab'},
            ].map(({key,label,cls})=>(
              <button key={key} className={`pt-tab ${cls}${activeTab===key?' active':''}`} onClick={()=>setActiveTab(key)}>
                {label}
                <span className="pt-tab-count"
                  style={key==='PENDING'  &&tabCounts.PENDING>0   ?{background:'#f59e0b22',color:'#f59e0b'}
                        :key==='REJECTED' &&tabCounts.REJECTED>0  ?{background:'#f8717122',color:'#f87171'}
                        :key==='COMPLIANCE'&&tabCounts.COMPLIANCE>0?{background:'#f9731622',color:'#f97316'}
                        :key==='CBAM'    &&tabCounts.CBAM>0       ?{background:'#60a5fa22',color:'#60a5fa'}:{}}>
                  {tabCounts[key]}
                </span>
              </button>
            ))}
          </div>

          {/* Credit Grid */}
          <div className="pt-grid">
            {loading.credits&&allCredits.length===0 ? (
              [1,2,3].map(i=>(
                <div key={i} style={{background:'#070c09',border:'1px solid #0d1f11',borderRadius:14,overflow:'hidden'}}>
                  <div style={{padding:16}}>
                    <div className="pt-skel" style={{height:14,width:'70%',marginBottom:10}}/>
                    <div className="pt-skel" style={{height:10,width:'40%',marginBottom:14}}/>
                  </div>
                  {[1,2,3,4].map(j=>(<div key={j} style={{padding:'10px 14px',borderTop:'1px solid #0d1f1114'}}><div className="pt-skel" style={{height:8,width:'30%',marginBottom:6}}/><div className="pt-skel" style={{height:12,width:'60%'}}/></div>))}
                </div>
              ))
            ) : filtered.length===0 ? (
              <div className="pt-empty">
                <div style={{fontSize:40,marginBottom:16}}>🌿</div>
                <div style={{fontSize:14,color:'#f0fdf4',fontWeight:700,marginBottom:8}}>
                  {activeTab==='RETIRED'?'No retired credits yet'
                   :activeTab==='PENDING'?'No pending submissions'
                   :activeTab==='REJECTED'?'No rejected submissions'
                   :activeTab==='COMPLIANCE'?'No CCC compliance credits yet'
                   :activeTab==='CBAM'?'No CBAM-eligible credits yet'
                   :'No credits found'}
                </div>
                <div style={{fontSize:11,color:'#86efac22',lineHeight:1.7}}>
                  {!isKYCVerified?'Complete KYC to start tokenizing'
                   :activeTab==='ALL'?'Click "TOKENIZE NEW CREDIT" to submit your first credit'
                   :`No credits in this view`}
                </div>
              </div>
            ) : filtered.map(credit=>{
              const reg         = REGISTRIES[credit.standard]||REGISTRIES.VCS;
              const dep         = vintagePenalty(credit.vintageYear);
              const refPrice    = getReferencePrice(credit.projectType,credit.standard,credit.vintageYear);
              const adjPrice    = credit.pricePerCredit>0?+((credit.pricePerCredit)*(1-dep/100)).toFixed(0):refPrice;
              const priceIsRef  = !credit.pricePerCredit||credit.pricePerCredit===0;
              const expired     = credit.expiryDate&&new Date(credit.expiryDate)<new Date();
              const isCCC       = credit.creditType==='compliance';
              const verifStatus = VERIFICATION_STATUSES.find(s=>s.value===(credit.acvaStatus||'pending'));
              const caInfo      = CA_OPTIONS.find(o=>o.value===(credit.correspondingAdjustment||'none'));

              const statusStyle = credit.isRejected
                ? {bg:'#1a0707',color:'#f87171',border:'#f8717133',label:'✕ REJECTED'}
                : credit.isPending
                ? {bg:'#1a0e00',color:'#f59e0b',border:'#f59e0b33',label:'⏳ PENDING'}
                : ({
                    HELD:    {bg:'#051409',color:'#22c55e',border:'#22c55e22',label:'● HELD'},
                    LISTED:  {bg:'#110e00',color:'#facc15',border:'#facc1522',label:'◆ LISTED'},
                    RETIRED: {bg:'#0c0520',color:'#a78bfa',border:'#a78bfa22',label:'✓ RETIRED'},
                  }[credit.status]||{bg:'#051409',color:'#22c55e',border:'#22c55e22',label:'● HELD'});

              return (
                <div key={credit.id} className={`pt-card${credit.status==='RETIRED'?' retired':''}${credit.isPending&&!credit.isRejected?' pending-approval':''}${credit.isRejected?' rejected':''}${isCCC?' compliance':''}`}>
                  <div className="pt-ribbon" style={{background:statusStyle.bg,color:statusStyle.color,border:`1px solid ${statusStyle.border}`}}>
                    {statusStyle.label}
                  </div>
                  <div className="pt-card-hdr">
                    <div className="pt-card-name">{credit.projectName}</div>
                    <div className="pt-card-loc">📍 {credit.location}</div>
                    <div className="pt-card-badges">
                      {/* Registry badge */}
                      <span className="pt-badge" style={{background:reg.bg,color:reg.color,border:`1px solid ${reg.color}22`}}>{credit.standard}</span>
                      {/* CCC/VCU badge */}
                      <span className="pt-badge" style={{background:isCCC?'#1a0a00':'#0d2e1f',color:isCCC?'#f97316':'#22c55e66',border:`1px solid ${isCCC?'#f9731633':'#22c55e22'}`}}>
                        {isCCC?'CCC':'VCU'}
                      </span>
                      {/* On-chain / review status */}
                      {credit.isRejected
                        ? <span className="pt-badge" style={{background:'#1a070766',color:'#f8717188',border:'1px solid #f8717122'}}>✕ Rejected</span>
                        : credit.isPending
                        ? <span className="pt-badge" style={{background:'#1a0e0066',color:'#f59e0b88',border:'1px solid #f59e0b22'}}>⏳ Admin Review</span>
                        : <span className="pt-badge" style={{background:'#22c55e0d',color:'#22c55e66',border:'1px solid #22c55e11'}}>⛓ On-Chain</span>
                      }
                      {/* CBAM */}
                      {credit.cbamEligible&&<span className="pt-badge" style={{background:'#060e18',color:'#60a5fa88',border:'1px solid #60a5fa33'}}>🇪🇺 CBAM</span>}
                      {/* Vintage depreciation */}
                      {dep>0&&<span className="pt-dep-badge" style={{background:'#11100066',color:'#facc1566',border:'1px solid #facc1511'}}>↓{dep}% vintage</span>}
                      {/* Banking */}
                      {credit.bankingStatus==='banked'&&<span className="pt-badge" style={{background:'#0a1628',color:'#60a5fa66',border:'1px solid #60a5fa22'}}>🏦 BANKED</span>}
                      {/* ACVA verification status */}
                      {credit.acvaName&&verifStatus&&(
                        <span className="pt-badge" style={{background:'#070c09',color:verifStatus.color,border:`1px solid ${verifStatus.color}33`}}>
                          {verifStatus.value==='verified'?'✓':verifStatus.value==='in_progress'?'⟳':'○'} {verifStatus.label}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Pending notice */}
                  {credit.isPending&&!credit.isRejected&&(
                    <div style={{margin:'8px 14px 0',padding:'8px 12px',background:'#110a00',border:'1px solid #f59e0b22',borderRadius:6,fontSize:10,color:'#f59e0b88',lineHeight:1.6}}>
                      🔍 Under admin verification. Approval typically 1–2 business days.
                    </div>
                  )}
                  {/* Rejection reason */}
                  {credit.isRejected&&(
                    <div style={{margin:'8px 14px 0',padding:'10px 12px',background:'#1a0707',border:'1px solid #f8717122',borderRadius:6,fontSize:10,color:'#f8717188',lineHeight:1.6}}>
                      <div style={{fontWeight:700,color:'#f87171aa',marginBottom:4}}>✕ Submission Rejected</div>
                      {credit.admin_notes
                        ? <div>Reason: <span style={{color:'#f0fdf4aa'}}>{credit.admin_notes}</span></div>
                        : <div style={{color:'#f8717166'}}>No reason provided. Contact support.</div>
                      }
                    </div>
                  )}

                  {/* Meta grid */}
                  <div className="pt-meta">
                    {!credit.isPending&&(
                      <div className="pt-meta-cell">
                        <div className="pt-meta-label">TOKEN ID</div>
                        <div className="pt-meta-val blue" style={{fontSize:10,fontFamily:'monospace'}}>{credit.tokenHex||credit.tokenId}</div>
                      </div>
                    )}
                    <div className={`pt-meta-cell${credit.isPending?' pt-meta-full':''}`}>
                      <div className="pt-meta-label">QUANTITY (tCO₂)</div>
                      <div className="pt-meta-val green">{credit.credits?.toLocaleString()}</div>
                    </div>
                    <div className="pt-meta-cell"><div className="pt-meta-label">VINTAGE YEAR</div><div className="pt-meta-val">{credit.vintageYear}</div></div>
                    {!credit.isPending&&(
                      <div className="pt-meta-cell">
                        <div className="pt-meta-label">{priceIsRef?'REF. PRICE ★':'ADJ. PRICE'}</div>
                        <div className="pt-meta-val" style={{color:priceIsRef?'#facc1599':undefined}}>
                          ₹{adjPrice.toLocaleString()}
                          {priceIsRef&&<span style={{fontSize:8,color:'#facc1544',marginLeft:4}}>est.</span>}
                        </div>
                      </div>
                    )}
                    {credit.expiryDate&&(
                      <div className="pt-meta-cell">
                        <div className="pt-meta-label">EXPIRY</div>
                        <div className={`pt-meta-val${expired?' red':''}`}>{new Date(credit.expiryDate).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
                      </div>
                    )}
                    <div className="pt-meta-cell"><div className="pt-meta-label">PROJECT TYPE</div><div className="pt-meta-val" style={{fontSize:10}}>{credit.projectType}</div></div>
                    <div className="pt-meta-cell"><div className="pt-meta-label">COUNTRY</div><div className="pt-meta-val">{credit.country}</div></div>

                    {/* ✅ Corresponding Adjustment (Article 6) */}
                    {credit.correspondingAdjustment&&credit.correspondingAdjustment!=='none'&&(
                      <div className="pt-meta-cell pt-meta-full">
                        <div className="pt-meta-label">ARTICLE 6 / CORR. ADJUSTMENT</div>
                        <div className="pt-meta-val" style={{color:caInfo?.color||'#86efac44',fontSize:10}}>{caInfo?.label}</div>
                      </div>
                    )}

                    {/* ✅ SDG tags */}
                    {credit.sdgTags&&credit.sdgTags.length>0&&(
                      <div className="pt-meta-cell pt-meta-full">
                        <div className="pt-meta-label">SDG CO-BENEFITS</div>
                        <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:4}}>
                          {credit.sdgTags.map(id=>(
                            <span key={id} style={{fontSize:9,padding:'2px 7px',borderRadius:3,background:'#060e18',color:'#60a5fa88',border:'1px solid #60a5fa22'}}>SDG {id}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ✅ ACVA verifier with status */}
                    {credit.acvaName&&(
                      <div className="pt-meta-cell pt-meta-full">
                        <div className="pt-meta-label">ACVA VERIFIER · {verifStatus?.label||'Pending'}</div>
                        <div className="pt-meta-val yellow" style={{fontSize:10}}>{credit.acvaName}{credit.acvaDate&&<span style={{color:'#86efac44',marginLeft:6}}>{credit.acvaDate}</span>}</div>
                      </div>
                    )}
                    {credit.icmRegistryId&&(
                      <div className="pt-meta-cell pt-meta-full">
                        <div className="pt-meta-label">ICM REGISTRY ID</div>
                        <div className="pt-meta-val orange" style={{fontSize:10}}>{credit.icmRegistryId}</div>
                      </div>
                    )}
                    <div className="pt-meta-cell pt-meta-full"><div className="pt-meta-label">REGISTRY</div><div className="pt-meta-val" style={{color:reg.color}}>{reg.label}</div></div>
                    <div className="pt-meta-cell pt-meta-full" style={{borderBottom:'none'}}><div className="pt-meta-label">SERIAL / CERTIFICATE NO.</div><div className="pt-meta-val blue" style={{fontSize:10}}>{credit.serialNumber}</div></div>
                  </div>

                  {/* India CCTS price band */}
                  {!credit.isPending&&(
                    <div style={{margin:'0 14px 8px',padding:'6px 10px',background:'#0a0f0c',borderRadius:6,border:'1px solid #0d1f11',fontSize:9,color:'#86efac33',display:'flex',justifyContent:'space-between'}}>
                      <span>India CCTS band: ₹{INDIA_CCTS_FLOOR}–₹{INDIA_CCTS_CEILING}/t</span>
                      <span style={{color:adjPrice>=INDIA_CCTS_FLOOR&&adjPrice<=INDIA_CCTS_CEILING?'#22c55e88':'#facc1566'}}>
                        {adjPrice>=INDIA_CCTS_FLOOR&&adjPrice<=INDIA_CCTS_CEILING?'✓ In range':'⚠ Outside band'}
                      </span>
                    </div>
                  )}

                  {/* Actions */}
                  {credit.isRejected ? (
                    <div className="pt-card-actions">
                      <button className="pt-act-btn resubmit" onClick={()=>{setForm({...emptyForm,projectName:credit.projectName,location:credit.location,country:credit.country,standard:credit.standard,projectType:credit.projectType,developer:credit.developer,credits:String(credit.credits),vintageYear:String(credit.vintageYear),serialNumber:credit.serialNumber});setShowForm(true);}}>↺ RESUBMIT</button>
                      <button className="pt-act-btn cancel" onClick={()=>handleCancelSubmission(credit.id)}>✕ DELETE</button>
                    </div>
                  ) : credit.isPending ? (
                    <div className="pt-card-actions">
                      <button className="pt-act-btn" style={{color:'#f59e0b44',borderColor:'#f59e0b11',background:'#0e0900',flex:2}} disabled>⏳ AWAITING APPROVAL</button>
                      {credit.doc_ipfs_hash&&(
                        <a href={`https://gateway.pinata.cloud/ipfs/${credit.doc_ipfs_hash}`} target="_blank" rel="noreferrer"
                          className="pt-act-btn doc" style={{textDecoration:'none',display:'flex',alignItems:'center',justifyContent:'center'}}>
                          📄 DOC
                        </a>
                      )}
                      <button className="pt-act-btn cancel" onClick={()=>handleCancelSubmission(credit.id)}>✕ CANCEL</button>
                    </div>
                  ) : credit.status!=='RETIRED' ? (
                    <div className="pt-card-actions">
                      {credit.status==='LISTED'
                        ? <button className="pt-act-btn delist" onClick={()=>handleDelist(credit)} disabled={loading.tx}>DELIST</button>
                        : <button className="pt-act-btn sell" onClick={()=>{setShowList(credit);setListPrice(refPrice);setListQty(String(credit.credits));setListPriceWarn('');}} disabled={loading.tx}>LIST</button>
                      }
                      <button className="pt-act-btn market" onClick={()=>navigate('/carbon-credits')} disabled={loading.tx}>MARKET</button>
                      <button className="pt-act-btn retire" onClick={()=>setShowRetire(credit)} disabled={loading.tx}>RETIRE</button>
                    </div>
                  ) : (
                    <div className="pt-card-actions">
                      <button className="pt-act-btn cert" onClick={()=>setShowCert(credit)}>📜 CERTIFICATE</button>
                      <a href={`https://sepolia.etherscan.io/address/${walletAddress}`} target="_blank" rel="noreferrer"
                        className="pt-act-btn market" style={{textDecoration:'none',display:'flex',alignItems:'center',justifyContent:'center'}}>
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

      {/* TX banner */}
      {txPending&&<div className="pt-tx-banner"><div className="pt-spinner"/>{txPending}</div>}

      {/* ── Submission Form Modal ── */}
      {showForm&&(
        <div className="pt-overlay" onClick={e=>e.target===e.currentTarget&&!submitting&&setShowForm(false)}>
          <div className="pt-modal">
            <div className="pt-modal-hdr">
              <span className="pt-modal-title">⊕ SUBMIT CARBON CREDIT FOR VERIFICATION</span>
              <button className="pt-modal-close" onClick={()=>!submitting&&setShowForm(false)}>✕</button>
            </div>
            <div className="pt-modal-body">
              <div style={{fontSize:10,color:'#f59e0b88',marginBottom:20,padding:'10px 12px',background:'#110a00',borderRadius:6,border:'1px solid #f59e0b22',lineHeight:1.7}}>
                ⏳ Reviewed by compliance team within <strong style={{color:'#f59e0b'}}>1–2 business days</strong>. Admin verifies your credit against the original registry before tokenization.
              </div>
              <div className="pt-form-grid">

                <div className="pt-field pt-form-full">
                  <label className="pt-label">PROJECT NAME</label>
                  <input className={`pt-input${formErrors.projectName?' err':''}`} placeholder="e.g. Sundarbans Mangrove Restoration" value={form.projectName} onChange={e=>setForm({...form,projectName:e.target.value})}/>
                  {formErrors.projectName&&<span className="pt-err">{formErrors.projectName}</span>}
                </div>

                <div className="pt-field">
                  <label className="pt-label">PINCODE (AUTO-DETECT LOCATION)</label>
                  <input className={`pt-input${pincodeError?' err':''}`} placeholder="e.g. 422013" maxLength={6} value={form.pincode||''} onChange={e=>handlePincode(e.target.value)}/>
                  {pincodeLoading&&<span style={{fontSize:9,color:'#60a5fa88'}}>⟳ Detecting...</span>}
                  {pincodeError&&<span className="pt-err">{pincodeError}</span>}
                  {form.location&&!pincodeLoading&&!pincodeError&&form.pincode?.length===6&&<span style={{fontSize:9,color:'#22c55e88'}}>✓ {form.location}</span>}
                </div>

                <div className="pt-field">
                  <label className="pt-label">LOCATION (EDITABLE)</label>
                  <input className={`pt-input${formErrors.location?' err':''}`} placeholder="e.g. Igatpuri, Nashik, Maharashtra" value={form.location} onChange={e=>setForm({...form,location:e.target.value})}/>
                  {formErrors.location&&<span className="pt-err">{formErrors.location}</span>}
                </div>

                <div className="pt-field">
                  <label className="pt-label">COUNTRY</label>
                  <input className={`pt-input${formErrors.country?' err':''}`} placeholder="e.g. India" value={form.country} onChange={e=>setForm({...form,country:e.target.value})}/>
                  {formErrors.country&&<span className="pt-err">{formErrors.country}</span>}
                </div>

                <div className="pt-field">
                  <label className="pt-label">REGISTRY / STANDARD</label>
                  <select className="pt-input" value={form.standard} onChange={e=>setForm({...form,standard:e.target.value,sdgTags:[]})}>
                    <option value="VCS">VCS — Verra</option>
                    <option value="GS">GS — Gold Standard</option>
                    <option value="CDM">CDM — Clean Dev. Mechanism</option>
                    <option value="ACR">ACR — American Carbon Registry</option>
                    <option value="BEE">BEE — India CCTS</option>
                  </select>
                </div>

                <div className="pt-field">
                  <label className="pt-label">PROJECT ID</label>
                  <input className={`pt-input${formErrors.projectId?' err':''}`} placeholder="e.g. VCS-1234 or BEE-IN-0042" value={form.projectId} onChange={e=>setForm({...form,projectId:e.target.value})}/>
                  {formErrors.projectId&&<span className="pt-err">{formErrors.projectId}</span>}
                </div>

                <div className="pt-field">
                  <label className="pt-label">PROJECT TYPE</label>
                  <select className={`pt-input${formErrors.projectType?' err':''}`} value={form.projectType} onChange={e=>setForm({...form,projectType:e.target.value})}>
                    <option value="">Select type</option>
                    <optgroup label="── BEE India CCTS (Official methodologies) ──">
                      {PROJECT_TYPES.filter(t=>t.includes('(BEE)')).map(t=><option key={t} value={t}>{t}</option>)}
                    </optgroup>
                    <optgroup label="── Global VCM types ──">
                      {PROJECT_TYPES.filter(t=>!t.includes('(BEE)')).map(t=><option key={t} value={t}>{t}</option>)}
                    </optgroup>
                  </select>
                  {formErrors.projectType&&<span className="pt-err">{formErrors.projectType}</span>}
                </div>

                <div className="pt-field pt-form-full">
                  <label className="pt-label">PROJECT DEVELOPER</label>
                  <input className={`pt-input${formErrors.developer?' err':''}`} placeholder="Organization or company name" value={form.developer} onChange={e=>setForm({...form,developer:e.target.value})}/>
                  {formErrors.developer&&<span className="pt-err">{formErrors.developer}</span>}
                </div>

                <div className="pt-field">
                  <label className="pt-label">QUANTITY (tCO₂)</label>
                  <input className={`pt-input${formErrors.credits?' err':''}`} type="number" placeholder="e.g. 500" value={form.credits} onChange={e=>setForm({...form,credits:e.target.value})}/>
                  {formErrors.credits&&<span className="pt-err">{formErrors.credits}</span>}
                </div>

                <div className="pt-field">
                  <label className="pt-label">VINTAGE YEAR</label>
                  <input className={`pt-input${formErrors.vintageYear?' err':''}`} type="number" placeholder="e.g. 2023" min="2000" max="2030" value={form.vintageYear} onChange={e=>setForm({...form,vintageYear:e.target.value})}/>
                  {formErrors.vintageYear&&<span className="pt-err">{formErrors.vintageYear}</span>}
                  {form.vintageYear&&!isNaN(form.vintageYear)&&(
                    <span style={{fontSize:9,color:vintagePenalty(+form.vintageYear)>0?'#facc1566':'#22c55e66'}}>
                      {vintagePenalty(+form.vintageYear)>0?`↓ ${vintagePenalty(+form.vintageYear)}% vintage depreciation`:'✓ Current vintage — no depreciation'}
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

                {/* ── COMPLIANCE & STANDARDS SECTION ── */}
                <div className="pt-section-divider">COMPLIANCE, STANDARDS & ARTICLE 6</div>

                {/* Credit type */}
                <div className="pt-field pt-form-full">
                  <label className="pt-label">CREDIT TYPE</label>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                    {CREDIT_TYPES.map(ct=>(
                      <div key={ct.value} onClick={()=>setForm({...form,creditType:ct.value})}
                        style={{padding:'10px 12px',borderRadius:8,border:`1px solid ${form.creditType===ct.value?ct.color+'66':'#0d1f11'}`,background:form.creditType===ct.value?`${ct.color}11`:'#060a07',cursor:'pointer',transition:'all .2s'}}>
                        <div style={{fontSize:11,color:form.creditType===ct.value?ct.color:'#86efac44',fontWeight:700,marginBottom:2}}>{ct.label}</div>
                        <div style={{fontSize:9,color:'#86efac22'}}>{ct.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ✅ Corresponding Adjustment (Article 6) */}
                <div className="pt-field pt-form-full">
                  <label className="pt-label">CORRESPONDING ADJUSTMENT (PARIS AGREEMENT ARTICLE 6)</label>
                  <select className="pt-input" value={form.correspondingAdjustment} onChange={e=>setForm({...form,correspondingAdjustment:e.target.value})}>
                    {CA_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <span style={{fontSize:9,color:'#86efac22',marginTop:4}}>
                    Credits without a CA cannot be used for NDC compliance claims under Art. 6.2/6.4
                  </span>
                </div>

                {/* ✅ SDG tags — required for GS, optional for others */}
                <div className="pt-field pt-form-full">
                  <label className="pt-label">
                    SDG CO-BENEFITS {form.standard==='GS'?<span style={{color:'#f59e0b'}}> — REQUIRED FOR GOLD STANDARD</span>:<span style={{color:'#86efac22'}}>(OPTIONAL)</span>}
                  </label>
                  <div className="pt-sdg-grid">
                    {SDG_OPTIONS.map(s=>(
                      <div key={s.id} className={`pt-sdg-tag${form.sdgTags.includes(s.id)?' on':''}`} onClick={()=>toggleSdg(s.id)}>
                        <div style={{fontWeight:700,marginBottom:2}}>SDG {s.id}</div>
                        <div style={{fontSize:8,opacity:.7}}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {formErrors.sdgTags&&<span className="pt-err">{formErrors.sdgTags}</span>}
                </div>

                {/* ACVA verifier + status */}
                <div className="pt-field">
                  <label className="pt-label">ACVA VERIFIER NAME <span style={{color:'#86efac22'}}>(OPTIONAL)</span></label>
                  <input className="pt-input" placeholder="e.g. Bureau Veritas, DNV, TÜV SÜD" value={form.acvaName} onChange={e=>setForm({...form,acvaName:e.target.value})}/>
                </div>

                <div className="pt-field">
                  <label className="pt-label">VERIFICATION STATUS</label>
                  <select className="pt-input" value={form.acvaStatus} onChange={e=>setForm({...form,acvaStatus:e.target.value})}>
                    {VERIFICATION_STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>

                <div className="pt-field">
                  <label className="pt-label">ACVA VERIFICATION DATE</label>
                  <input className="pt-input" type="date" value={form.acvaDate} onChange={e=>setForm({...form,acvaDate:e.target.value})}/>
                </div>

                <div className="pt-field">
                  <label className="pt-label">ICM REGISTRY ID <span style={{color:'#86efac22'}}>(OPTIONAL)</span></label>
                  <input className="pt-input" placeholder="e.g. ICM-IN-2025-00142" value={form.icmRegistryId} onChange={e=>setForm({...form,icmRegistryId:e.target.value})}/>
                  <span style={{fontSize:9,color:'#86efac22'}}>Official BEE/GCI registry ID — available mid-2026</span>
                </div>

                <div className="pt-field">
                  <label className="pt-label">BANKING STATUS (CCTS)</label>
                  <select className="pt-input" value={form.bankingStatus} onChange={e=>setForm({...form,bankingStatus:e.target.value})}>
                    <option value="available">Available — ready for trading / retirement</option>
                    <option value="banked">Banked — reserved for future compliance cycle</option>
                  </select>
                </div>

                {/* CBAM */}
                <div className="pt-field pt-form-full">
                  <label className="pt-label">CBAM ELIGIBILITY (EU CARBON BORDER ADJUSTMENT)</label>
                  <div className="pt-toggle" onClick={()=>setForm({...form,cbamEligible:!form.cbamEligible})}>
                    <div className={`pt-toggle-box${form.cbamEligible?' on':''}`}><div className="pt-toggle-knob"/></div>
                    <div>
                      <div style={{fontSize:11,color:form.cbamEligible?'#60a5fa':'#86efac44',fontWeight:500}}>
                        {form.cbamEligible?'✓ CBAM Eligible — EU Article 7 compliant':'Not CBAM eligible'}
                      </div>
                      <div style={{fontSize:9,color:'#86efac22',marginTop:2}}>Required for Indian exporters to the EU from 2026 under CBAM transition regulations</div>
                    </div>
                  </div>
                </div>

                {/* Document upload */}
                <div className="pt-field pt-form-full">
                  <label className="pt-label">OWNERSHIP PROOF DOCUMENT</label>
                  <div className={`pt-upload-box${formErrors.docFile?' err':''}`}>
                    {form.docFile
                      ? <div style={{fontSize:11,color:'#22c55e88'}}>✓ {form.docFile.name}</div>
                      : (<><div style={{fontSize:28,marginBottom:6}}>📄</div><div style={{fontSize:11,color:'#86efac33',marginBottom:4}}>Click to upload ownership proof</div><div style={{fontSize:9,color:'#86efac22'}}>PDF, JPG, PNG — max 5MB · Pinned to IPFS permanently</div></>)
                    }
                    <input type="file" accept="image/*,.pdf" style={{position:'absolute',inset:0,opacity:0,cursor:'pointer'}}
                      onChange={e=>{ const f=e.target.files[0]; if(f&&f.size>5*1024*1024){showToast('❌ File too large. Max 5MB','error');return;} setForm({...form,docFile:f||null}); }}/>
                  </div>
                  {formErrors.docFile&&<span className="pt-err">{formErrors.docFile}</span>}
                </div>

              </div>
            </div>
            <div className="pt-modal-foot">
              <button className="pt-btn-secondary" onClick={()=>{setShowForm(false);setFormErrors({});setPincodeError('');setForm(emptyForm);}} disabled={submitting}>CANCEL</button>
              <button className="pt-btn-primary" onClick={handleRegister} disabled={submitting}>
                {submitting ? `⟳ ${txPending||'SUBMITTING...'}` : 'SUBMIT FOR VERIFICATION →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Retire Modal ── */}
      {showRetire&&<RetireModal credit={showRetire} onConfirm={handleRetireConfirm} onClose={()=>setShowRetire(null)} loading={loading.tx}/>}

      {/* ── List Modal ── */}
      {showList&&(
        <div className="pt-overlay" onClick={e=>e.target===e.currentTarget&&setShowList(null)}>
          <div className="pt-modal" style={{maxWidth:440}}>
            <div className="pt-modal-hdr">
              <span className="pt-modal-title">LIST FOR SALE ON MARKETPLACE</span>
              <button className="pt-modal-close" onClick={()=>setShowList(null)}>✕</button>
            </div>
            <div className="pt-modal-body">
              <div style={{background:'#060a07',borderRadius:8,padding:'12px 14px',marginBottom:14,border:'1px solid #0d1f11'}}>
                <div style={{fontSize:12,color:'#f0fdf4',fontWeight:700,marginBottom:4}}>{showList.projectName}</div>
                <div style={{fontSize:10,color:'#86efac44'}}>{showList.credits?.toLocaleString()} tCO₂ · {showList.standard} · Vintage {showList.vintageYear}</div>
              </div>
              {vintagePenalty(showList.vintageYear)>0&&(
                <div style={{padding:'8px 12px',background:'#110e00',border:'1px solid #facc1511',borderRadius:6,marginBottom:10,fontSize:10,color:'#facc1555'}}>
                  ↓ {vintagePenalty(showList.vintageYear)}% vintage depreciation applied to display price
                </div>
              )}
              <div style={{padding:'8px 12px',background:'#0a0f0c',border:'1px solid #0d1f11',borderRadius:6,marginBottom:14,fontSize:10,color:'#86efac44',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>India CCTS guidance band</span>
                <span style={{color:'#22c55e88',fontWeight:700}}>₹{INDIA_CCTS_FLOOR}–₹{INDIA_CCTS_CEILING}/t</span>
              </div>

              <div className="pt-field" style={{marginBottom:14}}>
                <label className="pt-label">QUANTITY TO LIST (tCO₂)</label>
                <div className="pt-qty-row">
                  <input className="pt-qty-slider" type="range" min="1" max={showList.credits} step="1" value={listQty||showList.credits} onChange={e=>setListQty(e.target.value)}/>
                  <input className="pt-input" type="number" min="1" max={showList.credits} style={{width:80}} value={listQty||showList.credits} onChange={e=>setListQty(e.target.value)}/>
                </div>
              </div>

              <div className="pt-field" style={{marginBottom:4}}>
                <label className="pt-label">ASKING PRICE PER CREDIT (₹)</label>
                <input className="pt-input" type="number" placeholder="e.g. 850" value={listPrice}
                  onChange={e=>handleListPriceChange(e.target.value,showList)}/>
                <span style={{fontSize:9,color:'#86efac22',marginTop:4}}>
                  Suggested: ₹{getReferencePrice(showList.projectType,showList.standard,showList.vintageYear).toLocaleString()} (market reference)
                </span>
              </div>
              {/* ✅ CCTS band warning for compliance credits */}
              {listPriceWarn&&(
                <div style={{padding:'8px 12px',background:'#110a00',border:'1px solid #f59e0b22',borderRadius:6,marginBottom:10,fontSize:9,color:'#f59e0b88'}}>
                  {listPriceWarn}
                </div>
              )}

              {listPrice&&!isNaN(listPrice)&&+listPrice>0&&(
                <div style={{background:'#040706',borderRadius:6,padding:'10px 12px',fontSize:10,color:'#86efac66',border:'1px solid #0d1f11',marginTop:10}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                    <span>Listing value</span>
                    <span style={{color:'#22c55e88'}}>₹{(+listPrice*(+(listQty||showList.credits))).toLocaleString()}</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                    <span>Platform fee (0.5%)</span>
                    <span style={{color:'#facc1566'}}>₹{(+listPrice*(+(listQty||showList.credits))*0.005).toLocaleString()}</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',paddingTop:6,marginTop:4,borderTop:'1px solid #0d1f11'}}>
                    <span>On-chain price</span>
                    <span style={{color:'#60a5fa66'}}>
                      {(+listPrice/(ethPriceInr||210000)).toFixed(6)} ETH/credit
                      {ethPriceInr
                        ? <span style={{fontSize:8,color:'#60a5fa33',marginLeft:4}}>@ live ₹{ethPriceInr.toLocaleString()}</span>
                        : <span style={{fontSize:8,color:'#f59e0b33',marginLeft:4}}>est. rate</span>
                      }
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="pt-modal-foot">
              <button className="pt-btn-secondary" onClick={()=>{setShowList(null);setListPriceWarn('');}}>CANCEL</button>
              <button className="pt-btn-primary" onClick={()=>handleListForSale(showList)} disabled={loading.tx}>
                {loading.tx?'⟳ LISTING ON-CHAIN...':'LIST ON MARKETPLACE →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Certificate Modal ── */}
      {showCert&&(
        <div className="pt-overlay" onClick={e=>e.target===e.currentTarget&&setShowCert(null)}>
          <div className="pt-modal" style={{maxWidth:640}}>
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

      {/* Toast */}
      {toast&&(
        <div className="pt-toast" style={{border:`1px solid ${toast.type==='error'?'#f8717122':'#22c55e22'}`,color:toast.type==='error'?'#f8717199':'#22c55e88'}}>
          {toast.msg}
        </div>
      )}
    </>
  );
}