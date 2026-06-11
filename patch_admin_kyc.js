#!/usr/bin/env node
/**
 * patch_admin_kyc.js — EtherTrack
 * Applies all 11 KYC changes to AdminDashboard.jsx automatically.
 * 
 * Usage:
 *   node patch_admin_kyc.js path/to/AdminDashboard.jsx
 * 
 * Creates a backup at AdminDashboard.jsx.bak before patching.
 */

const fs   = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) { console.error('Usage: node patch_admin_kyc.js <path/to/AdminDashboard.jsx>'); process.exit(1); }

let src = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file + '.bak', src);
console.log('✅ Backup saved to', file + '.bak');

let changes = 0;

function replace(find, rep, label) {
  if (!src.includes(find)) { console.warn(`⚠  [${label}] Pattern not found — skipping`); return; }
  src = src.replace(find, rep);
  console.log(`✅ [${label}] Applied`);
  changes++;
}

// ─── [KYC-1] Add kycAPI to import ────────────────────────────────────────────
replace(
  `import { apiFetch as globalApiFetch } from '../services/api';`,
  `import { apiFetch as globalApiFetch, kycAPI } from '../services/api';`,
  'KYC-1 import'
);

// ─── [KYC-2] Add kycTier + kycDetailData state ───────────────────────────────
replace(
  `const [selectedKycIds, setSelectedKycIds]   = useState([]);`,
  `const [selectedKycIds, setSelectedKycIds]   = useState([]);
  const [kycTier,        setKycTier]           = useState('full');
  const [kycDetailData,  setKycDetailData]     = useState(null);`,
  'KYC-2 state'
);

// ─── [KYC-4] Replace loadKYC ─────────────────────────────────────────────────
replace(
  `const loadKYC         = useCallback(async () => { setLoading(true); try { const d = await api(\`/api/admin/kyc?status=\${kycFilter}\`); setKyc(d?.submissions ?? []); } catch {} finally { setLoading(false); } }, [kycFilter]);`,
  `const loadKYC = useCallback(async () => {
    setLoading(true);
    try {
      if (kycFilter === 'pending') {
        const d = await kycAPI.pending(0, 100);
        setKyc(d?.submissions ?? []);
      } else {
        try { const d = await api(\`/api/admin/kyc?status=\${kycFilter}\`); setKyc(d?.submissions ?? []); }
        catch { setKyc([]); }
      }
    } catch (e) {
      if (e.message === 'SESSION_EXPIRED') handleSessionExpiry();
      setKyc([]);
    } finally { setLoading(false); }
  }, [kycFilter, handleSessionExpiry]);`,
  'KYC-4 loadKYC'
);

// ─── [KYC-5] Replace kycAction ───────────────────────────────────────────────
replace(
  `const kycAction = (id, action) => safeAction(async () => {
    await api(\`/api/admin/kyc/\${id}/\${action}\`, { method: 'POST', body: JSON.stringify({ reason: sanitize(reason) }) });
    toast_(\`✅ KYC \${action}d\`, 3000, 'success'); setModal(null); setReason(''); loadKYC(); loadStats();
  });`,
  `const kycAction = (id, action) => safeAction(async () => {
    if (action === 'approve') {
      await kycAPI.approve(id, kycTier);
      toast_(\`✅ KYC approved — tier: \${kycTier.toUpperCase()}\`, 3000, 'success');
    } else {
      if (!sanitize(reason)) throw new Error('Rejection reason is required');
      await kycAPI.reject(id, sanitize(reason));
      toast_('✅ KYC rejected — user notified by email', 3000, 'success');
    }
    setModal(null); setReason(''); setKycTier('full');
    loadKYC(); loadStats();
  });`,
  'KYC-5 kycAction'
);

// ─── [KYC-6] Replace handleBulkKycApprove ────────────────────────────────────
replace(
  `const handleBulkKycApprove = () => safeAction(async () => {
    if (!selectedKycIds.length) throw new Error('Select at least one submission');
    if (!window.confirm(\`Bulk-approve \${selectedKycIds.length} KYC submissions?\`)) return;
    const r = await api('/api/admin/kyc/bulk-approve', { method: 'POST', body: JSON.stringify({ ids: selectedKycIds }) });
    toast_(\`✅ \${r?.approved} approved\`, 3000, 'success'); setSelectedKycIds([]); loadKYC(); loadStats();
  });`,
  `const handleBulkKycApprove = () => safeAction(async () => {
    if (!selectedKycIds.length) throw new Error('Select at least one submission');
    if (!window.confirm(\`Bulk-approve \${selectedKycIds.length} KYC submissions at tier "\${kycTier}"?\`)) return;
    let approved = 0, failed = 0;
    for (const id of selectedKycIds) {
      try { await kycAPI.approve(id, kycTier); approved++; }
      catch { failed++; }
    }
    toast_(\`✅ \${approved} approved\${failed ? \` · ❌ \${failed} failed\` : ''}\`, 4000, approved > 0 ? 'success' : 'error');
    setSelectedKycIds([]); loadKYC(); loadStats();
  });`,
  'KYC-6 bulkApprove'
);

// ─── [KYC-7] Add loadKycDetail after handleBulkKycApprove ────────────────────
replace(
  `const handleForceDelist`,
  `const loadKycDetail = useCallback(async (id) => {
    setKycDetailData(null);
    try { const d = await kycAPI.detail(id); setKycDetailData(d); }
    catch { setKycDetailData({ error: 'Failed to load detail' }); }
  }, []);

  const handleForceDelist`,
  'KYC-7 loadKycDetail'
);

// ─── [KYC-11] Bulk approve bar — add tier dropdown ───────────────────────────
replace(
  `{selectedKycIds.length > 0 && <button style={{ ...S.approveBtn, padding: '7px 14px', fontSize: 10 }} onClick={handleBulkKycApprove}>✓ BULK APPROVE {selectedKycIds.length}</button>}`,
  `{selectedKycIds.length > 0 && (
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <select style={{ ...S.searchInput, width:90, padding:'5px 8px', fontSize:10 }} value={kycTier} onChange={e => setKycTier(e.target.value)}>
                  <option value="phone">Phone</option>
                  <option value="basic">Basic</option>
                  <option value="full">Full</option>
                </select>
                <button style={{ ...S.approveBtn, padding:'7px 14px', fontSize:10 }} onClick={handleBulkKycApprove}>✓ BULK APPROVE {selectedKycIds.length}</button>
              </div>
            )}`,
  'KYC-11 bulk tier dropdown'
);

// ─── [KYC-10] DETAILS button — clear stale detail ────────────────────────────
replace(
  `<button style={S.viewBtn} onClick={() => setModal({ type: 'kyc_detail', data: k })}>DETAILS</button>`,
  `<button style={S.viewBtn} onClick={() => { setKycDetailData(null); setModal({ type: 'kyc_detail', data: k }); }}>DETAILS</button>`,
  'KYC-10 details button'
);

// ─── [KYC-8] Replace kyc_approve modal — add tier picker ─────────────────────
replace(
  `{modal?.type === 'kyc_approve' && <Dlg title="Approve KYC" onClose={() => { setModal(null); setReason(''); }}><div style={M.ct}>Approve KYC for <strong style={{ color: '#f0fdf4' }}>{modal.data.full_name}</strong>?</div><button style={M.aPrimary} onClick={() => kycAction(modal.data.id, 'approve')}>CONFIRM APPROVE</button></Dlg>}`,
  `{modal?.type === 'kyc_approve' && (
        <Dlg title="Approve KYC" onClose={() => { setModal(null); setReason(''); setKycTier('full'); }}>
          <div style={M.ct}>Approve KYC for <strong style={{ color: '#f0fdf4' }}>{modal.data.full_name}</strong>?</div>
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:9, color:'#f59e0bcc', letterSpacing:'.12em', marginBottom:8 }}>KYC TIER — determines which features unlock</div>
            <div style={{ display:'flex', gap:7 }}>
              {[{value:'phone',label:'Phone',desc:'Basic access'},{value:'basic',label:'Basic',desc:'Standard features'},{value:'full',label:'Full',desc:'All features'}].map(({value,label,desc}) => (
                <button key={value} onClick={() => setKycTier(value)} style={{ flex:1, padding:'10px 8px', borderRadius:7, cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:10, fontWeight:700, border:\`1px solid \${kycTier===value?'#22c55e':'#22c55e22'}\`, background:kycTier===value?'#0d2e1f':'transparent', color:kycTier===value?'#22c55e':'#22c55e66' }}>
                  <div>{label}</div>
                  <div style={{ fontSize:8, fontWeight:400, marginTop:2, opacity:.7 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div style={{ padding:'9px 12px', background:'#051409', border:'1px solid #22c55e22', borderRadius:6, fontSize:10, color:'#22c55e88', lineHeight:1.7, marginBottom:14 }}>
            ✅ Sets kyc_status=verified · tier={kycTier} · pushes SSE unlock · sends approval email
          </div>
          <button style={M.aPrimary} onClick={() => kycAction(modal.data.id, 'approve')}>
            CONFIRM APPROVE — {kycTier.toUpperCase()} TIER
          </button>
        </Dlg>
      )}`,
  'KYC-8 approve modal'
);

// ─── [KYC-9] Replace kyc_detail modal — add audit trail ──────────────────────
// Find the opening of the detail modal
const detailStart = `{modal?.type === 'kyc_detail' && <Dlg title="KYC Submission Details" onClose={() => setModal(null)} wide>`;
const detailEnd   = `{modal?.type === 'kyc_approve' && <Dlg title="Approve KYC"`;

if (src.includes(detailStart) && src.includes(detailEnd)) {
  const startIdx = src.indexOf(detailStart);
  const endIdx   = src.indexOf(detailEnd);
  const before   = src.slice(0, startIdx);
  const after    = src.slice(endIdx);

  const newDetail = `{modal?.type === 'kyc_detail' && (
        <Dlg title="KYC Submission Details" onClose={() => { setModal(null); setKycDetailData(null); }} wide>
          {[['Name',modal.data.full_name],['Email',modal.data.email],['ID Type',modal.data.id_type||'—'],['Phone',modal.data.phone||'—'],['KYC Tier',modal.data.kyc_tier||'—'],['Submitted',fmt(modal.data.submitted_at)],['Status',modal.data.status],['Prior Subs',modal.data.prior_submissions??'—']].map(([k,v]) => (
            <div key={k} style={M.row}><span style={M.key}>{k}</span><span style={{ ...M.val, color:k==='Status'&&modal.data.status==='rejected'?'#f87171':k==='Status'&&modal.data.status==='approved'?'#22c55e':undefined }}>{v}</span></div>
          ))}
          {modal.data.doc_ipfs_hash && (
            <div style={{ marginTop:12, padding:'10px 12px', background:'#051409', border:'1px solid #22c55e22', borderRadius:6 }}>
              <div style={{ fontSize:9, color:'#22c55eaa', letterSpacing:'.1em', marginBottom:6 }}>KYC DOCUMENT</div>
              <a href={\`\${PG}/\${modal.data.doc_ipfs_hash}\`} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'#60a5fa', textDecoration:'none' }}>📄 VIEW IPFS DOC ↗ ({modal.data.doc_ipfs_hash.slice(0,20)}...)</a>
            </div>
          )}
          {kycDetailData === null && (
            <button style={{ ...S.viewBtn, marginTop:12, borderColor:'#60a5fa33', color:'#60a5fa', padding:'6px 12px', fontSize:10 }} onClick={() => loadKycDetail(modal.data.id)}>
              🔍 LOAD FULL DETAIL + AUDIT TRAIL
            </button>
          )}
          {kycDetailData?.error && <div style={{ marginTop:10, fontSize:10, color:'#f87171' }}>⚠ {kycDetailData.error}</div>}
          {kycDetailData?.submission && (
            <>
              <div style={{ marginTop:12, padding:'10px 12px', background:'#060a07', border:'1px solid #0f2a1a', borderRadius:6 }}>
                <div style={{ fontSize:9, color:'#4ade8044', letterSpacing:'.12em', marginBottom:8 }}>CRYPTOGRAPHIC HASHES</div>
                {[['KYC Data Hash',kycDetailData.submission.kyc_data_hash],['Aadhaar Hash',kycDetailData.submission.aadhaar_hash],['PAN Hash',kycDetailData.submission.pan_hash]].filter(([,v])=>v).map(([k,v]) => (
                  <div key={k} style={{ ...M.row, padding:'4px 0' }}><span style={{ ...M.key, fontSize:9 }}>{k}</span><span style={{ fontSize:9, color:'#22c55e88', fontFamily:'monospace', maxWidth:280, textAlign:'right', wordBreak:'break-all' }}>{v.slice(0,14)}...{v.slice(-6)}</span></div>
                ))}
              </div>
              {kycDetailData.events?.length > 0 && (
                <div style={{ marginTop:12 }}>
                  <div style={{ fontSize:9, color:'#f59e0bcc', letterSpacing:'.14em', marginBottom:8 }}>AUDIT TRAIL ({kycDetailData.events.length} events)</div>
                  {kycDetailData.events.map((ev,i) => (
                    <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start', padding:'7px 0', borderBottom:'1px solid #f59e0b08' }}>
                      <div style={{ width:7, height:7, borderRadius:'50%', flexShrink:0, marginTop:4, background:ev.action==='approved'?'#22c55e':ev.action==='rejected'?'#f87171':'#f59e0b' }} />
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:10, color:'#f0fdf4', fontWeight:500 }}>
                          {ev.action.toUpperCase()}
                          {ev.from_status && ev.to_status && <span style={{ fontSize:9, color:'#f59e0baa', marginLeft:6 }}>{ev.from_status} → {ev.to_status}</span>}
                        </div>
                        <div style={{ fontSize:9, color:'#f59e0b88', marginTop:2 }}>{ev.actor_email||'system'} · {fmtT(ev.created_at)}</div>
                        {ev.meta && Object.keys(ev.meta).length>0 && <div style={{ fontSize:9, color:'#86efac44', marginTop:2 }}>{JSON.stringify(ev.meta)}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {modal.data.status==='pending' && (
            <div style={{ display:'flex', gap:8, marginTop:14 }}>
              <button style={M.aPrimary} onClick={() => { setKycTier('full'); setModal({ type:'kyc_approve', data:modal.data }); }}>✓ APPROVE KYC</button>
              <button style={M.rPrimary} onClick={() => { setReason(''); setModal({ type:'kyc_reject', data:modal.data }); }}>✕ REJECT KYC</button>
            </div>
          )}
          {modal.data.status==='approved' && <div style={{ marginTop:14, padding:'9px 12px', background:'#051409', border:'1px solid #22c55e22', borderRadius:6, fontSize:10, color:'#22c55e88' }}>✅ KYC approved — tier: {modal.data.kyc_tier?.toUpperCase()||'—'}</div>}
          {modal.data.status==='rejected' && (
            <div style={{ marginTop:14, padding:'9px 12px', background:'#1a0707', border:'1px solid #f8717133', borderRadius:6, fontSize:10, color:'#f87171' }}>
              ❌ KYC rejected — user must resubmit
              {modal.data.rejection_reason && <div style={{ marginTop:6, color:'#f8717188' }}>Reason: {modal.data.rejection_reason}</div>}
            </div>
          )}
        </Dlg>
      )}

      `;

  src = before + newDetail + after;
  console.log('✅ [KYC-9] kyc_detail modal replaced');
  changes++;
} else {
  console.warn('⚠  [KYC-9] Could not find kyc_detail modal boundaries — skipping');
}

// ─── Write output ─────────────────────────────────────────────────────────────
fs.writeFileSync(file, src);
console.log(`\n✅ Done — ${changes}/10 changes applied to ${file}`);
console.log('   Backup: ' + file + '.bak');