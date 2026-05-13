// RetirementCertificate.js — extracted from Portfolio.js
// FIXES:
//   1. jsPDF lazy import now shows loading spinner — no silent 300KB stall
//   2. certId always comes from DB (passed as prop) — never re-generated locally
//   3. QR code fallback to Etherscan link if QR server is down

import React, { useState } from 'react';

const VERIFY_BASE_URL = 'https://ethertrackapp.vercel.app/verify';

const REGISTRIES = {
  VCS: { label:'Verra VCS',                color:'#22c55e', bg:'#0d2e1f' },
  GS:  { label:'Gold Standard',            color:'#facc15', bg:'#1a1500' },
  CDM: { label:'Clean Dev. Mechanism',     color:'#60a5fa', bg:'#0a1628' },
  ACR: { label:'American Carbon Registry', color:'#a78bfa', bg:'#120a28' },
  BEE: { label:'BEE India (CCTS)',         color:'#f97316', bg:'#1a0a00' },
};

const CA_OPTIONS = [
  { value:'none',        label:'None — voluntary only (no CA)'        },
  { value:'host_issued', label:'Host country CA issued (Art. 6.2)'    },
  { value:'itmo',        label:'ITMO authorised (Art. 6.4)'           },
  { value:'pending',     label:'CA pending host country confirmation'  },
];

function QRCodeImg({ value, size = 120 }) {
  const [failed, setFailed] = useState(false);
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=0a0f0c&color=22c55e&margin=2`;
  if (failed) {
    return (
      <div style={{ width: size, height: size, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:4 }}>
        <span style={{ fontSize: 9, color:'#86efac33', textAlign:'center', lineHeight:1.4 }}>QR unavailable</span>
        <a href={value} target="_blank" rel="noreferrer" style={{ fontSize:8, color:'#22c55e88', textDecoration:'none' }}>Open link ↗</a>
      </div>
    );
  }
  return (
    <div style={{ textAlign:'center' }}>
      <img
        src={url} alt="QR Code" width={size} height={size}
        style={{ borderRadius:8, border:'1px solid #22c55e22', background:'#0a0f0c' }}
        onError={() => setFailed(true)}
      />
      <div style={{ fontSize:9, color:'#86efac66', marginTop:4, letterSpacing:'.08em' }}>SCAN TO VERIFY</div>
    </div>
  );
}

export function RetirementCertificate({ credit, txHash, onClose }) {
  // ✅ FIX: pdfLoading state — no silent stall on 300KB jsPDF import
  const [pdfLoading, setPdfLoading] = useState(false);

  const date           = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' });
  const tokenDisplay   = credit.tokenHex || (credit.tokenId ? `0x${Number(credit.tokenId).toString(16).padStart(8,'0').toUpperCase()}` : '—');

  // ✅ FIX: certId ALWAYS comes from the DB via props — never re-generated here.
  // Portfolio.js passes certId from retireSteps.certId which comes from backend response.
  // If certId is missing (old code path), we show a warning rather than silently wrong.
  const certId    = credit.certId || credit.certificate_id;
  const verifyUrl = certId ? `${VERIFY_BASE_URL}/${certId}` : null;

  const reg         = REGISTRIES[credit.standard] || REGISTRIES.VCS;
  const scopeLabel  = credit.retireScope ? `Scope ${credit.retireScope}` : 'Scope 1/2/3';
  const creditTypeLabel = credit.creditType === 'compliance' ? 'CCC — Compliance (India CCTS)' : 'VCU — Voluntary Carbon Unit';
  const verifiedBy  = credit.acvaName || 'Pending third-party verification';
  const caLabel     = CA_OPTIONS.find(o => o.value === credit.correspondingAdjustment)?.label || 'None';
  const sdgList     = (credit.sdgTags || []).join(', ') || '—';

  const handleDownloadPDF = async () => {
    // ✅ FIX: show loading state immediately — jsPDF is ~300KB
    setPdfLoading(true);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
      const W = 210, ml = 20, tw = W - 40;
      let y = 20;

      doc.setFillColor(4, 7, 6); doc.rect(0, 0, W, 297, 'F');
      doc.setFillColor(13, 46, 31); doc.rect(0, 0, W, 40, 'F');

      // Logo
      try {
        const logoRes = await fetch('/et_logo.png');
        if (logoRes.ok) {
          const blob = await logoRes.blob();
          const logoB64 = await new Promise((resolve) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.onload = () => {
              try {
                const canvas = document.createElement('canvas');
                canvas.width  = img.naturalWidth  || 200;
                canvas.height = img.naturalHeight || 200;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/jpeg', 0.92));
              } catch { URL.revokeObjectURL(url); resolve(null); }
            };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            img.src = url;
          });
          if (logoB64 && logoB64.startsWith('data:image/jpeg')) {
            doc.addImage(logoB64, 'JPEG', ml, 6, 28, 28);
          }
        }
      } catch { /* logo optional */ }

      doc.setTextColor(34,197,94); doc.setFontSize(8); doc.setFont('helvetica','normal');
      doc.text('ETHERTRACK CARBON EXCHANGE — CORPORATE RETIREMENT CERTIFICATE', W/2, y, { align:'center' }); y += 7;
      doc.setFontSize(16); doc.setFont('helvetica','bold'); doc.setTextColor(240,253,244);
      doc.text('Carbon Retirement Certificate', W/2, y, { align:'center' }); y += 6;
      doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(134,239,172);
      doc.text('VERIFIED · ISO 14064-3 · GHG PROTOCOL · BRSR · CDP · TCFD · ETHEREUM SEPOLIA', W/2, y, { align:'center' }); y += 14;

      const fields = [
        ['CERTIFICATE ID',      certId || 'PENDING'],
        ['TOKEN ID',            tokenDisplay],
        ['CREDIT TYPE',         creditTypeLabel],
        ['OFFSET SCOPE',        scopeLabel],
        ['ARTICLE 6 / CA',      caLabel],
        ['SDG CO-BENEFITS',     sdgList],
        ['PROJECT NAME',        credit.projectName || '—'],
        ['SERIAL NO.',          credit.serialNumber || '—'],
        ['REGISTRY',            reg.label],
        ['STANDARD',            credit.standard || '—'],
        ['CREDITS RETIRED',     `${(credit.retiredQty || credit.credits)?.toLocaleString()} tCO₂e`],
        ['VINTAGE YEAR',        String(credit.vintageYear || '—')],
        ['COUNTRY',             credit.country || '—'],
        ['BENEFICIARY NAME',    credit.beneficiaryName || '—'],
        ['BENEFICIARY ENTITY',  credit.beneficiaryEntity || '—'],
        ['BENEFICIARY GSTIN',   credit.beneficiaryGstin || '—'],
        ['REPORTING STANDARD',  credit.reportingStandard || 'GHG Protocol'],
        ['PURPOSE',             credit.purpose || 'Voluntary Offset'],
        ['ACVA VERIFIER',       verifiedBy],
        ['ICVCM CCP',           credit.icvcm_ccp_eligible ? `Yes — ${credit.icvcm_ccp_label || 'CCP Eligible'}` : 'Not assessed'],
        ['RETIREMENT DATE',     date],
        ['CBAM ELIGIBLE',       credit.cbamEligible ? 'YES — EU CBAM Article 7' : 'NO'],
      ];

      const colW = (tw - 6) / 2;
      fields.forEach(([label, value], i) => {
        const col = i % 2, x = ml + col * (colW + 6);
        if (col === 0 && i > 0) y += 16;
        doc.setFillColor(10, 15, 12); doc.roundedRect(x, y, colW, 14, 1.5, 1.5, 'F');
        doc.setDrawColor(15, 42, 26); doc.roundedRect(x, y, colW, 14, 1.5, 1.5, 'S');
        doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(134,239,172);
        doc.text(label, x+3, y+4.5);
        doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(240,253,244);
        doc.text(doc.splitTextToSize(String(value || '—'), colW-6)[0], x+3, y+10);
      });
      y += 20;

      if (txHash) {
        doc.setFillColor(10,22,40); doc.roundedRect(ml, y, tw, 14, 2, 2, 'F');
        doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(134,239,172);
        doc.text('BLOCKCHAIN TX HASH', ml+3, y+4.5);
        doc.setFontSize(7); doc.setTextColor(96,165,250);
        doc.text(doc.splitTextToSize(txHash, tw-6)[0], ml+3, y+10); y += 18;
      }

      if (verifyUrl) {
        doc.setFillColor(6,10,7); doc.roundedRect(ml, y, tw, 14, 2, 2, 'F');
        doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(134,239,172);
        doc.text('PUBLIC VERIFICATION URL', ml+3, y+4.5);
        doc.setFontSize(7.5); doc.setTextColor(34,197,94);
        doc.text(verifyUrl, ml+3, y+10); y += 18;
      }

      doc.setFontSize(7); doc.setTextColor(134,239,172);
      doc.text("ETHERTRACK · INDIA'S CARBON EXCHANGE · ISO 14064-3 · GHG PROTOCOL · BRSR · CDP · TCFD · PARIS AGREEMENT ART.6", W/2, y, { align:'center' });

      doc.save(`${certId || 'certificate'}.pdf`);
    } catch (err) {
      // Fallback to text file if jsPDF fails
      const content = `EtherTrack Carbon Retirement Certificate\nCertificate ID: ${certId}\nCredits: ${credit.retiredQty||credit.credits} tCO2e\nBeneficiary: ${credit.beneficiaryName||''} ${credit.beneficiaryEntity||''}\nTX: ${txHash||'N/A'}\nVerify: ${verifyUrl||'N/A'}`;
      const blob = new Blob([content], { type:'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url; a.download = `${certId || 'certificate'}.txt`; a.click();
      URL.revokeObjectURL(url);
    } finally {
      // ✅ FIX: always clears loading state
      setPdfLoading(false);
    }
  };

  return (
    <div style={{ background:'linear-gradient(135deg,#060a07 0%,#0a1209 50%,#060a07 100%)', border:'1px solid #22c55e44', borderRadius:16, padding:32, position:'relative', overflow:'hidden' }}>

      {/* ✅ FIX: certId warning if missing */}
      {!certId && (
        <div style={{ padding:'8px 12px', background:'#1a0707', border:'1px solid #f8717133', borderRadius:6, marginBottom:12, fontSize:10, color:'#f87171' }}>
          ⚠ Certificate ID not yet available — please refresh your portfolio
        </div>
      )}

      <div style={{ position:'relative', zIndex:1 }}>
        <div style={{ textAlign:'center', marginBottom:24 }}>
          <div style={{ fontSize:10, color:'#22c55e88', letterSpacing:'.2em', marginBottom:8 }}>ETHERTRACK CARBON EXCHANGE — CORPORATE CERTIFICATE</div>
          <div style={{ fontSize:22, fontWeight:700, color:'#f0fdf4', fontFamily:'Syne,sans-serif', marginBottom:4 }}>Carbon Retirement Certificate</div>
          <div style={{ fontSize:10, color:'#86efac66', letterSpacing:'.1em' }}>ISO 14064-3 · GHG PROTOCOL · BRSR · CDP · TCFD · ETHEREUM SEPOLIA</div>
        </div>

        {/* Beneficiary */}
        {(credit.beneficiaryName || credit.beneficiaryEntity) && (
          <div style={{ background:'#0a1628', border:'1px solid #60a5fa33', borderRadius:10, padding:'14px 18px', marginBottom:16 }}>
            <div style={{ fontSize:9, color:'#60a5fa88', letterSpacing:'.14em', marginBottom:8 }}>RETIREMENT BENEFICIARY — CORPORATE ENTITY</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
              {[
                { l:'ENTITY NAME', v:credit.beneficiaryName || '—' },
                { l:'COMPANY',     v:credit.beneficiaryEntity || '—' },
                { l:'GSTIN',       v:credit.beneficiaryGstin || '—' },
              ].map(({ l, v }) => (
                <div key={l}>
                  <div style={{ fontSize:8, color:'#60a5fa66', letterSpacing:'.1em', marginBottom:3 }}>{l}</div>
                  <div style={{ fontSize:11, color:'#f0fdf4', fontWeight:600 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ICVCM CCP badge */}
        {credit.icvcm_ccp_eligible && (
          <div style={{ background:'#0e1a00', border:'1px solid #84cc1633', borderRadius:8, padding:'10px 14px', marginBottom:12, display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:16 }}>🏅</span>
            <div>
              <div style={{ fontSize:10, color:'#84cc16', fontWeight:700, marginBottom:2 }}>ICVCM CORE CARBON PRINCIPLES (CCP) ELIGIBLE</div>
              <div style={{ fontSize:9, color:'#84cc1666' }}>{credit.icvcm_ccp_label || 'Meets ICVCM integrity standards'}</div>
            </div>
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
          {[
            { label:'CERTIFICATE ID',  value:certId || 'PENDING',                                   color:'#22c55e' },
            { label:'TOKEN ID',        value:tokenDisplay,                                           color:'#60a5fa' },
            { label:'CREDIT TYPE',     value:creditTypeLabel,                                        color:credit.creditType==='compliance'?'#f97316':'#22c55e' },
            { label:'OFFSET SCOPE',    value:scopeLabel,                                             color:'#a78bfa' },
            { label:'ARTICLE 6 / CA',  value:caLabel,                                               color:'#22c55e' },
            { label:'SDG CO-BENEFITS', value:sdgList,                                               color:'#60a5fa' },
            { label:'PROJECT NAME',    value:credit.projectName,                                    color:'#f0fdf4' },
            { label:'SERIAL NO.',      value:credit.serialNumber,                                   color:'#f0fdf4' },
            { label:'REGISTRY',        value:reg.label,                                             color:reg.color },
            { label:'CREDITS RETIRED', value:`${(credit.retiredQty||credit.credits)?.toLocaleString()} tCO₂e`, color:'#22c55e' },
            { label:'VINTAGE YEAR',    value:credit.vintageYear,                                    color:'#f0fdf4' },
            { label:'COUNTRY',         value:credit.country || credit.location,                     color:'#f0fdf4' },
            { label:'REPORTING STD',   value:credit.reportingStandard || 'GHG Protocol',            color:'#86efac88' },
            { label:'PURPOSE',         value:credit.purpose || 'Voluntary Offset',                  color:'#86efac88' },
            { label:'ACVA VERIFIER',   value:verifiedBy,                                            color:'#facc15' },
            { label:'RETIREMENT DATE', value:date,                                                  color:'#f0fdf4' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background:'#0a0f0c88', borderRadius:8, padding:'10px 14px', border:'1px solid #0f2a1a' }}>
              <div style={{ fontSize:8, color:'#86efac55', letterSpacing:'.12em', marginBottom:4 }}>{label}</div>
              <div style={{ fontSize:11, color, fontWeight:600, wordBreak:'break-all' }}>{value}</div>
            </div>
          ))}
        </div>

        {txHash && (
          <div style={{ background:'#0a0f0c88', borderRadius:8, padding:'10px 14px', border:'1px solid #0f2a1a', marginBottom:16 }}>
            <div style={{ fontSize:8, color:'#86efac55', letterSpacing:'.12em', marginBottom:4 }}>BLOCKCHAIN TX HASH</div>
            <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ fontSize:10, color:'#60a5fa', fontFamily:'monospace', wordBreak:'break-all', textDecoration:'none' }}>{txHash}</a>
          </div>
        )}

        {verifyUrl && (
          <div style={{ background:'#060a07', border:'1px solid #22c55e22', borderRadius:8, padding:16, marginBottom:16, display:'flex', alignItems:'center', gap:20, flexWrap:'wrap' }}>
            <QRCodeImg value={verifyUrl} size={100}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:9, color:'#22c55e88', letterSpacing:'.12em', marginBottom:6 }}>PUBLIC VERIFICATION URL</div>
              <div style={{ fontSize:10, color:'#22c55e66', wordBreak:'break-all', marginBottom:8, fontFamily:'monospace' }}>{verifyUrl}</div>
              <div style={{ fontSize:9, color:'#86efac66', lineHeight:1.7 }}>
                Scan to independently verify this retirement on-chain. Suitable for CDP, BRSR, TCFD submissions.
              </div>
            </div>
          </div>
        )}

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingTop:16, borderTop:'1px solid #0f2a1a', gap:10, flexWrap:'wrap' }}>
          <div style={{ fontSize:9, color:'#86efac44', letterSpacing:'.06em' }}>ETHERTRACK · ISO 14064-3 · GHG PROTOCOL · BRSR · CDP · TCFD · PARIS AGREEMENT ART.6</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {verifyUrl && (
              <a href={verifyUrl} target="_blank" rel="noreferrer"
                style={{ padding:'8px 16px', borderRadius:6, border:'1px solid #60a5fa33', background:'#060e18', color:'#60a5fa88', cursor:'pointer', fontFamily:'DM Mono,monospace', fontSize:10, textDecoration:'none', display:'inline-flex', alignItems:'center' }}>
                🔗 VERIFY PUBLIC
              </a>
            )}
            {/* ✅ FIX: Download button shows loading state while jsPDF imports */}
            <button
              onClick={handleDownloadPDF}
              disabled={pdfLoading}
              style={{ padding:'8px 16px', borderRadius:6, border:'1px solid #22c55e44', background:'#051409', color: pdfLoading ? '#86efac33' : '#22c55e88', cursor: pdfLoading ? 'not-allowed' : 'pointer', fontFamily:'DM Mono,monospace', fontSize:10, display:'flex', alignItems:'center', gap:6 }}>
              {pdfLoading ? (
                <>
                  <span style={{ width:10, height:10, border:'1.5px solid #22c55e22', borderTopColor:'#22c55e88', borderRadius:'50%', animation:'spin 1s linear infinite', display:'inline-block' }}/>
                  GENERATING PDF...
                </>
              ) : '↓ DOWNLOAD PDF'}
            </button>
            <button onClick={onClose} style={{ padding:'8px 16px', borderRadius:6, border:'1px solid #22c55e44', background:'#0d2e1f', color:'#22c55e', cursor:'pointer', fontFamily:'DM Mono,monospace', fontSize:10 }}>CLOSE ✕</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RetirementCertificate;