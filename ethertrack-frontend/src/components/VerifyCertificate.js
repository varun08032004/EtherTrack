// VerifyCertificate.js
// CHANGES FROM YOUR VERSION:
//   [1] Calls /api/certificates/:certId instead of /api/verify/:certId
//       (unified route that returns verifier_name, wallet_address, block_number)
//   [2] Verifier badge shown when data.verifier_name is present
//   [3] wallet_address and block_number now rendered (were in query, missing from display)

import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';

const API = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const REGISTRIES = {
  VCS: { label:'Verra VCS',                color:'#22c55e' },
  GS:  { label:'Gold Standard',            color:'#facc15' },
  CDM: { label:'Clean Dev. Mechanism',     color:'#60a5fa' },
  ACR: { label:'American Carbon Registry', color:'#a78bfa' },
  BEE: { label:'BEE India (CCTS)',         color:'#f97316' },
};

const REPORTING_LABELS = {
  GHG_PROTOCOL: 'GHG Protocol Corporate Standard',
  CDP:          'CDP Climate Change',
  BRSR:         'SEBI BRSR Core',
  TCFD:         'TCFD Climate Disclosure',
  ISO_14064:    'ISO 14064-3',
};

const PURPOSE_LABELS = {
  voluntary_offset: 'Voluntary Carbon Offset',
  compliance:       'Regulatory Compliance',
  net_zero:         'Net Zero Commitment',
  supply_chain:     'Supply Chain Decarbonisation',
  product_neutral:  'Product Carbon Neutrality',
  event_neutral:    'Event Carbon Neutrality',
};

function QRCode({ value, size = 100 }) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&bgcolor=040706&color=22c55e&margin=2`;
  return (
    <img src={url} alt="QR code" width={size} height={size}
      style={{ borderRadius:8, border:'1px solid #22c55e22', display:'block' }}
      onError={e => { e.target.style.display = 'none'; }}/>
  );
}

export default function VerifyCertificate() {
  const { certId }            = useParams();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (!certId) { setError('No certificate ID provided'); setLoading(false); return; }

    // [1] Use the new unified /api/certificates/:certId route
    //     which returns verifier_name, wallet_address, block_number
    fetch(`${API}/api/certificates/${encodeURIComponent(certId)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); })
      .catch(() => setError('Could not reach verification server'))
      .finally(() => setLoading(false));
  }, [certId]);

  const reg            = REGISTRIES[data?.standard] || REGISTRIES.VCS;
  const verifyUrl      = window.location.href;
  const retiredDate    = data?.retiredAt
    ? new Date(data.retiredAt).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })
    : '—';
  const hasBeneficiary = data?.beneficiaryName || data?.beneficiary_name;
  const hasCorpFields  = data?.reportingStd || data?.purpose;
  const isCCP          = data?.icvcmCcp || data?.icvcm_ccp_eligible;

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:#040706;}
    .vp{min-height:100vh;background:#040706;font-family:'DM Mono',monospace;
      display:flex;align-items:flex-start;justify-content:center;padding:40px 16px 80px;
      background-image:linear-gradient(rgba(34,197,94,.025) 1px,transparent 1px),
        linear-gradient(90deg,rgba(34,197,94,.025) 1px,transparent 1px);
      background-size:40px 40px;}
    .vc{background:#070c09;border:1px solid #0f2a1a;border-radius:16px;
      max-width:700px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.8);
      animation:fu .4s ease both;overflow:hidden;}
    .vc-bar{height:3px;background:linear-gradient(90deg,#22c55e,#16a34a,#15803d);}
    .vc-hdr{padding:32px 32px 24px;border-bottom:1px solid #0d1f11;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;}
    .vc-brand{font-size:9px;color:#22c55e88;letter-spacing:.2em;margin-bottom:10px;}
    .vc-title{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#f0fdf4;margin-bottom:4px;}
    .vc-sub{font-size:9px;color:#86efac33;letter-spacing:.1em;}
    .vc-status-ok{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;
      border-radius:8px;background:#0d2e1f;border:1px solid #22c55e44;
      color:#22c55e;font-size:11px;font-weight:700;letter-spacing:.1em;margin-top:16px;}
    .vc-status-fail{display:inline-flex;align-items:center;gap:8px;padding:10px 18px;
      border-radius:8px;background:#1a0707;border:1px solid #f8717144;
      color:#f87171;font-size:11px;font-weight:700;letter-spacing:.1em;margin-top:16px;}
    .vc-body{padding:24px 32px;}
    .vc-verifier{background:#0d0a1a;border:1px solid #a78bfa44;border-radius:10px;
      padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:14px;}
    .vc-bene{background:#0a1628;border:1px solid #60a5fa33;border-radius:10px;
      padding:16px 18px;margin-bottom:16px;}
    .vc-bene-label{font-size:9px;color:#60a5fa88;letter-spacing:.14em;margin-bottom:12px;}
    .vc-bene-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}
    .vc-ccp{background:#0e1a00;border:1px solid #84cc1633;border-radius:8px;
      padding:10px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px;}
    .vc-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;}
    .vc-field{background:#060a07;border:1px solid #0d1f11;border-radius:8px;padding:12px 14px;}
    .vc-field-full{grid-column:1/-1;}
    .vc-flabel{font-size:8px;color:#86efac44;letter-spacing:.12em;margin-bottom:5px;}
    .vc-fval{font-size:11px;color:#f0fdf4;font-weight:600;word-break:break-all;line-height:1.5;}
    .vc-chain{background:#0a1628;border:1px solid #60a5fa22;border-radius:8px;padding:14px 16px;margin-bottom:16px;}
    .vc-chain-label{font-size:9px;color:#60a5fa88;letter-spacing:.12em;margin-bottom:8px;}
    .vc-chain-val{font-size:10px;color:#60a5fa;font-family:monospace;word-break:break-all;line-height:1.6;}
    .vc-proof{background:#051409;border:1px solid #22c55e22;border-radius:8px;padding:14px 16px;margin-bottom:16px;}
    .vc-proof-title{font-size:9px;color:#22c55e88;letter-spacing:.12em;margin-bottom:10px;}
    .vc-proof-item{display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;font-size:10px;color:#86efac77;line-height:1.6;}
    .vc-verify-row{display:flex;align-items:center;gap:20px;padding:16px;
      background:#060a07;border:1px solid #0d1f11;border-radius:8px;margin-bottom:16px;flex-wrap:wrap;}
    .vc-corp{background:#0d0a1a;border:1px solid #a78bfa22;border-radius:8px;padding:14px 16px;margin-bottom:16px;}
    .vc-corp-label{font-size:9px;color:#a78bfa88;letter-spacing:.12em;margin-bottom:10px;}
    .vc-footer{padding:20px 32px;border-top:1px solid #0d1f11;background:#050809;
      display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;}
    .vc-footer-txt{font-size:9px;color:#86efac33;letter-spacing:.06em;line-height:1.8;}
    .vc-btn{padding:8px 16px;border-radius:6px;font-family:'DM Mono',monospace;
      font-size:10px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;
      transition:all .2s;cursor:pointer;border:none;}
    .vc-btn-eth{border:1px solid #60a5fa33;background:#060e18;color:#60a5fa88;}
    .vc-btn-eth:hover{border-color:#60a5fa66;color:#60a5facc;}
    .vc-btn-home{border:1px solid #22c55e33;background:#051409;color:#22c55e88;}
    .vc-btn-home:hover{border-color:#22c55e66;color:#22c55ecc;}
    .vc-loading{text-align:center;padding:60px 32px;}
    .vc-spin{width:32px;height:32px;border:2px solid #22c55e11;border-top-color:#22c55e44;
      border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px;}
    .vc-error{text-align:center;padding:60px 32px;}
    .vc-error-icon{font-size:48px;margin-bottom:16px;}
    .vc-error-title{font-size:18px;color:#f0fdf4;font-weight:700;margin-bottom:8px;font-family:'Syne',sans-serif;}
    .vc-error-sub{font-size:11px;color:#86efac44;line-height:1.8;}
    @keyframes fu{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
    @keyframes spin{to{transform:rotate(360deg);}}
    @media(max-width:600px){
      .vc-grid{grid-template-columns:1fr;}
      .vc-field-full{grid-column:1;}
      .vc-bene-grid{grid-template-columns:1fr;}
      .vc-hdr{padding:24px 20px 16px;}
      .vc-body{padding:16px 20px;}
      .vc-footer{padding:16px 20px;}
    }
  `;

  return (
    <>
      <style>{CSS}</style>
      <div className="vp">
        <div className="vc">
          <div className="vc-bar"/>

          {/* Header */}
          <div className="vc-hdr">
            <div>
              <div className="vc-brand">🌿 ETHERTRACK CARBON EXCHANGE · PUBLIC VERIFICATION</div>
              <div className="vc-title">Carbon Retirement Certificate</div>
              <div className="vc-sub">BLOCKCHAIN-VERIFIED · ISO 14064-3 · GHG PROTOCOL · BRSR · CDP · TCFD · IMMUTABLE</div>
              {!loading && data && <div className="vc-status-ok">✓ VERIFIED — PERMANENTLY RETIRED ON BLOCKCHAIN</div>}
              {!loading && error && <div className="vc-status-fail">✕ CERTIFICATE NOT VERIFIED</div>}
            </div>
            {!loading && data && (
              <div style={{ flexShrink:0, textAlign:'center' }}>
                <QRCode value={verifyUrl} size={90}/>
                <div style={{ fontSize:8, color:'#86efac33', marginTop:6, letterSpacing:'.08em' }}>SCAN TO VERIFY</div>
              </div>
            )}
          </div>

          {/* Loading */}
          {loading && (
            <div className="vc-loading">
              <div className="vc-spin"/>
              <div style={{ fontSize:11, color:'#86efac44', letterSpacing:'.1em' }}>VERIFYING ON BLOCKCHAIN...</div>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="vc-error">
              <div className="vc-error-icon">❌</div>
              <div className="vc-error-title">Certificate Not Found</div>
              <div className="vc-error-sub">
                Certificate <strong style={{ color:'#f0fdf4' }}>{certId}</strong> could not be verified.<br/>
                It may not exist or was issued before on-chain verification was enabled.<br/><br/>
                If you believe this is an error, contact{' '}
                <a href="https://mail.google.com/mail/?view=cm&to=support@ethertrack.in" target="_blank" rel="noreferrer" style={{ color:'#22c55e88' }}>support@ethertrack.in</a>
              </div>
              <div style={{ marginTop:24, display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
                <Link to="/" className="vc-btn vc-btn-home">← GO TO ETHERTRACK</Link>
              </div>
            </div>
          )}

          {/* Certificate */}
          {!loading && data && (
            <div className="vc-body">

              {/* [2] Verifier badge */}
              {data.verifierName && (
                <div className="vc-verifier">
                  <span style={{ fontSize:20 }}>🔍</span>
                  <div>
                    <div style={{ fontSize:11, color:'#a78bfa', fontWeight:700, marginBottom:2 }}>
                      INDEPENDENTLY VERIFIED — {data.verifierName}
                    </div>
                    <div style={{ fontSize:9, color:'#a78bfa66' }}>
                      ISO 14065 accredited · Enables CDP Verified + BRSR Level 2 submission
                    </div>
                  </div>
                  <span style={{ marginLeft:'auto', fontSize:9, padding:'3px 8px', borderRadius:4, background:'#22c55e11', color:'#22c55e', border:'1px solid #22c55e33' }}>VERIFIED</span>
                </div>
              )}

              {/* Beneficiary */}
              {hasBeneficiary && (
                <div className="vc-bene">
                  <div className="vc-bene-label">RETIREMENT BENEFICIARY — CORPORATE ENTITY</div>
                  <div className="vc-bene-grid">
                    {[
                      { l:'ENTITY NAME', v: data.beneficiaryName   || data.beneficiary_name   || '—' },
                      { l:'COMPANY',     v: data.beneficiaryEntity  || data.beneficiary_entity || '—' },
                      { l:'GSTIN',       v: data.beneficiaryGstin   || data.beneficiary_gstin  || '—' },
                    ].map(({ l, v }) => (
                      <div key={l}>
                        <div className="vc-flabel">{l}</div>
                        <div className="vc-fval" style={{ color:'#f0fdf4', fontSize:11 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ICVCM CCP */}
              {isCCP && (
                <div className="vc-ccp">
                  <span style={{ fontSize:18 }}>🏅</span>
                  <div>
                    <div style={{ fontSize:10, color:'#84cc16', fontWeight:700, marginBottom:2 }}>ICVCM CORE CARBON PRINCIPLES (CCP) ELIGIBLE</div>
                    <div style={{ fontSize:9, color:'#84cc1666' }}>{data.icvcmCcpLabel || data.icvcm_ccp_label || 'Meets ICVCM integrity standards'}</div>
                  </div>
                </div>
              )}

              {/* Main fields */}
              <div className="vc-grid">
                <div className="vc-field">
                  <div className="vc-flabel">CERTIFICATE ID</div>
                  <div className="vc-fval" style={{ color:'#22c55e', fontSize:10 }}>{data.certId || data.certificate_id}</div>
                </div>
                <div className="vc-field">
                  <div className="vc-flabel">RETIREMENT DATE</div>
                  <div className="vc-fval">{retiredDate}</div>
                </div>

                <div className="vc-field vc-field-full">
                  <div className="vc-flabel">PROJECT NAME</div>
                  <div className="vc-fval" style={{ fontSize:13, fontFamily:'Syne,sans-serif' }}>{data.projectName || data.project_name}</div>
                </div>

                <div className="vc-field">
                  <div className="vc-flabel">CREDITS RETIRED</div>
                  <div className="vc-fval" style={{ color:'#22c55e', fontSize:20, fontFamily:'Syne,sans-serif' }}>
                    {Number(data.amount).toLocaleString()} tCO₂e
                  </div>
                </div>
                <div className="vc-field">
                  <div className="vc-flabel">OFFSET SCOPE</div>
                  <div className="vc-fval" style={{ color:'#a78bfa' }}>
                    {data.retireScope || data.retire_scope ? `Scope ${data.retireScope || data.retire_scope}` : '—'}
                  </div>
                </div>

                <div className="vc-field">
                  <div className="vc-flabel">REGISTRY / STANDARD</div>
                  <div className="vc-fval" style={{ color:reg.color }}>{reg.label}</div>
                </div>
                <div className="vc-field">
                  <div className="vc-flabel">VINTAGE YEAR</div>
                  <div className="vc-fval">{data.vintageYear || data.vintage_year || '—'}</div>
                </div>

                <div className="vc-field">
                  <div className="vc-flabel">PROJECT TYPE</div>
                  <div className="vc-fval" style={{ fontSize:10 }}>{data.projectType || data.project_type || '—'}</div>
                </div>
                <div className="vc-field">
                  <div className="vc-flabel">COUNTRY</div>
                  <div className="vc-fval">{data.country || '—'}</div>
                </div>

                <div className="vc-field vc-field-full">
                  <div className="vc-flabel">SERIAL / CERTIFICATE NUMBER</div>
                  <div className="vc-fval" style={{ color:'#60a5fa', fontSize:10 }}>{data.serialNumber || data.serial_number || '—'}</div>
                </div>

                {(data.correspondingAdjustment || data.corresponding_adjustment) &&
                 (data.correspondingAdjustment || data.corresponding_adjustment) !== 'none' && (
                  <div className="vc-field vc-field-full">
                    <div className="vc-flabel">ARTICLE 6 / CORRESPONDING ADJUSTMENT</div>
                    <div className="vc-fval" style={{ color:'#22c55e', fontSize:10 }}>
                      {data.correspondingAdjustment || data.corresponding_adjustment}
                    </div>
                  </div>
                )}

                {/* [3] wallet_address — was in query, now shown */}
                {data.walletAddress && (
                  <div className="vc-field">
                    <div className="vc-flabel">RETIRED BY (WALLET)</div>
                    <div className="vc-fval" style={{ color:'#60a5fa', fontSize:9, fontFamily:'monospace' }}>
                      {`${data.walletAddress.slice(0,10)}...${data.walletAddress.slice(-6)}`}
                    </div>
                  </div>
                )}

                {/* [3] block_number — was in query, now shown */}
                {data.blockNumber && (
                  <div className="vc-field">
                    <div className="vc-flabel">BLOCK NUMBER</div>
                    <div className="vc-fval" style={{ color:'#60a5fa' }}>#{Number(data.blockNumber).toLocaleString()}</div>
                  </div>
                )}
              </div>

              {/* Corporate reporting */}
              {hasCorpFields && (
                <div className="vc-corp">
                  <div className="vc-corp-label">CORPORATE REPORTING DETAILS</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    {(data.reportingStd || data.reporting_standard) && (
                      <div>
                        <div className="vc-flabel">REPORTING FRAMEWORK</div>
                        <div className="vc-fval" style={{ color:'#a78bfa', fontSize:10 }}>
                          {REPORTING_LABELS[data.reportingStd || data.reporting_standard] || data.reportingStd || data.reporting_standard}
                        </div>
                      </div>
                    )}
                    {data.purpose && (
                      <div>
                        <div className="vc-flabel">RETIREMENT PURPOSE</div>
                        <div className="vc-fval" style={{ color:'#a78bfa', fontSize:10 }}>
                          {PURPOSE_LABELS[data.purpose] || data.purpose}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Blockchain TX */}
              <div className="vc-chain">
                <div className="vc-chain-label">BLOCKCHAIN TRANSACTION HASH · ETHEREUM SEPOLIA</div>
                <div className="vc-chain-val">{data.txHash || data.tx_hash || '—'}</div>
              </div>

              {/* Verification proof */}
              <div className="vc-proof">
                <div className="vc-proof-title">VERIFICATION PROOF</div>
                {[
                  'Token permanently burned on Ethereum Sepolia — cannot be reused or transferred',
                  'Retirement recorded immutably on blockchain — tamper-proof',
                  'Credits cannot be double-counted after retirement',
                  `Certificate ${data.certId || data.certificate_id} is unique and cryptographically verifiable`,
                  'Independently verifiable via Etherscan transaction hash above',
                  'Compliant with ISO 14064-3, GHG Protocol, BRSR Core, CDP, and TCFD standards',
                  ...(data.verifierName ? [`Independently verified by ${data.verifierName} — ISO 14065 accredited`] : []),
                ].map((s, i) => (
                  <div key={i} className="vc-proof-item">
                    <span style={{ color:'#22c55e', flexShrink:0 }}>✓</span>
                    <span>{s}</span>
                  </div>
                ))}
              </div>

              {/* QR + verify URL */}
              <div className="vc-verify-row">
                <QRCode value={verifyUrl} size={80}/>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:9, color:'#22c55e88', letterSpacing:'.12em', marginBottom:6 }}>PUBLIC VERIFICATION URL</div>
                  <div style={{ fontSize:10, color:'#22c55e66', wordBreak:'break-all', fontFamily:'monospace', marginBottom:8 }}>{verifyUrl}</div>
                  <div style={{ fontSize:9, color:'#86efac33', lineHeight:1.7 }}>
                    Anyone can scan this QR or open this URL to independently verify this retirement.
                    No login required. Suitable for CDP, BRSR, TCFD audit submissions.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          {!loading && (
            <div className="vc-footer">
              <div className="vc-footer-txt">
                ETHERTRACK · INDIA'S BLOCKCHAIN CARBON EXCHANGE<br/>
                ISO 14064-3 · GHG PROTOCOL · BRSR · CDP · TCFD · PARIS AGREEMENT ART.6
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {(data?.txHash || data?.tx_hash) && (
                  <a href={`https://sepolia.etherscan.io/tx/${data.txHash || data.tx_hash}`}
                    target="_blank" rel="noreferrer" className="vc-btn vc-btn-eth">
                    ETHERSCAN ↗
                  </a>
                )}
                <Link to="/" className="vc-btn vc-btn-home">🌿 ETHERTRACK</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}