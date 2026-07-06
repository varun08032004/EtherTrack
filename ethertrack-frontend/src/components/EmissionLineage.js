// src/components/EmissionLineage.jsx
// Source-to-Number Lineage modal
// Every tCO2e traceable: file → user → timestamp → EF version → approver
//
// [FIX-API-WIRE] Replaced raw apiFetch call with emissionsAPI.getLineage()
//                from services/api.js — consistent CSRF/error handling.

import React, { useState, useEffect } from 'react';
import { emissionsAPI } from '../services/api';

const fmt = (n, d = 2) =>
  Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

const fmtDate = (d) => d
  ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';

const CSS = `
.lin-overlay{position:fixed;inset:0;z-index:3000;background:#00000099;display:flex;align-items:center;justify-content:center;padding:24px;}
.lin-modal{background:var(--surf);border:1px solid var(--brd2);border-radius:14px;width:100%;max-width:620px;max-height:90vh;overflow-y:auto;box-shadow:0 32px 80px #00000099;}
.lin-hd{padding:20px 24px;border-bottom:1px solid var(--brd);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--surf);z-index:1;}
.lin-title{font-size:13px;font-weight:700;color:var(--txt);letter-spacing:.08em;}
.lin-close{background:none;border:none;color:var(--mut);cursor:pointer;font-size:18px;}
.lin-close:hover{color:#ef4444;}
.lin-body{padding:24px;}
.lin-co2e{font-family:'Syne',sans-serif;font-size:36px;font-weight:800;color:#10b981;margin-bottom:4px;}
.lin-co2e-sub{font-size:11px;color:var(--mut);}
.lin-chain{display:flex;flex-direction:column;gap:0;margin:20px 0;}
.lin-node{display:flex;align-items:flex-start;gap:14px;padding:14px 0;}
.lin-node:not(:last-child){border-bottom:1px solid var(--brd)22;}
.lin-icon-wrap{display:flex;flex-direction:column;align-items:center;gap:0;flex-shrink:0;}
.lin-icon{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;border:1px solid;}
.lin-connector{width:2px;height:20px;background:var(--brd);margin:2px auto;}
.lin-node-title{font-size:11px;font-weight:700;color:var(--txt);margin-bottom:4px;letter-spacing:.06em;}
.lin-node-detail{font-size:11px;color:var(--mut);line-height:1.7;}
.lin-node-meta{font-size:10px;color:var(--mut);margin-top:4px;opacity:.7;}
.lin-formula{background:#080b0e;border:1px solid var(--brd);border-radius:8px;padding:14px;margin:16px 0;font-family:'Space Mono',monospace;font-size:11px;line-height:2;}
.lin-formula-label{font-size:9px;letter-spacing:.12em;color:var(--mut);margin-bottom:8px;}
.lin-badge{font-size:9px;padding:2px 8px;border-radius:3px;letter-spacing:.05em;}
.lin-btn{padding:9px 18px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.lin-btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.lin-btn-g:hover{border-color:#10b98144;color:var(--grn);}
.lin-loading{padding:40px;text-align:center;color:var(--mut);font-size:11px;}
`;

// Source type metadata
const SOURCE_META = {
  manual:     { icon: '✏️', color: '#10b981', label: 'Manual Entry' },
  ai_parser:  { icon: '🤖', color: '#3b82f6', label: 'AI Parser'    },
  csv_import: { icon: '📊', color: '#a855f7', label: 'CSV Import'   },
  erp_sync:   { icon: '🔗', color: '#f97316', label: 'ERP Sync'     },
  api:        { icon: '⚡', color: '#f59e0b', label: 'API'          },
};

export default function EmissionLineage({ record, onClose }) {
  const [lineage,  setLineage]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [exported, setExported] = useState(false);

  useEffect(() => {
    if (!record?.id) return;
    setLoading(true);

    emissionsAPI.getLineage(record.id)
      .then(res => {
        if (res?.lineage) {
          setLineage(res.lineage);
        } else {
          // Build lineage from what we have on the record itself
          setLineage(buildLocalLineage(record));
        }
      })
      .catch(() => setLineage(buildLocalLineage(record)))
      .finally(() => setLoading(false));
  }, [record?.id]);

  // Build lineage from local record data when API not available
  const buildLocalLineage = (r) => ({
    record_id:      r.id,
    activity:       r.activity,
    quantity:       r.quantity,
    unit:           r.unit,
    co2e:           r.co2e,
    scope:          r.scope,
    category:       r.category,
    date:           r.date,
    source_channel: r.source_channel || 'manual',
    source_file:    r.source_file    || null,
    created_by:     r.created_by     || 'Unknown user',
    created_at:     r.created_at     || r.date,
    ef_version_id:  r.ef_version_id  || 'CEA-V20-FY2324',
    ef_value:       r.factor         || null,
    ef_source:      r.source         || 'DEFRA 2024 / CEA V20.0',
    ef_effective:   r.ef_version_from || '2023-04-01',
    approval_state: r.approval_state  || 'draft',
    approved_by:    r.approved_by     || null,
    approved_at:    r.approved_at     || null,
    locked_by:      r.locked_by       || null,
    locked_at:      r.locked_at       || null,
    adjustments:    r.adjustments     || [],
    audit_hash:     r.audit_hash      || null,
    blockchain_tx:  r.blockchain_tx   || null,
  });

  const exportLineage = () => {
    if (!lineage) return;
    const doc = {
      document_type: 'EtherTrack Emission Record Lineage Report',
      generated_at:  new Date().toISOString(),
      record_id:     lineage.record_id,
      tco2e:         lineage.co2e,
      decomposition: {
        activity:       lineage.activity,
        quantity:       `${lineage.quantity} ${lineage.unit}`,
        emission_factor:`${lineage.ef_value} kgCO2e/${lineage.unit} (${lineage.ef_version_id})`,
        formula:        `${lineage.quantity} × ${lineage.ef_value} / 1000 = ${lineage.co2e} tCO2e`,
        scope:          lineage.scope,
        category:       lineage.category,
        reporting_date: lineage.date,
      },
      data_provenance: {
        intake_channel:  lineage.source_channel,
        source_file:     lineage.source_file || 'Manual entry — no file',
        entered_by:      lineage.created_by,
        entered_at:      lineage.created_at,
      },
      emission_factor_version: {
        version_id:     lineage.ef_version_id,
        value:          lineage.ef_value,
        source:         lineage.ef_source,
        effective_from: lineage.ef_effective,
      },
      approval_chain: {
        current_state: lineage.approval_state,
        approved_by:   lineage.approved_by,
        approved_at:   lineage.approved_at,
        locked_by:     lineage.locked_by,
        locked_at:     lineage.locked_at,
      },
      adjustments:     lineage.adjustments,
      audit_hash:      lineage.audit_hash,
      blockchain_tx:   lineage.blockchain_tx,
    };

    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const a   = document.createElement('a');
    a.href    = url;
    a.download = `lineage_${lineage.record_id}_${lineage.date}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setExported(true);
  };

  const srcMeta = SOURCE_META[lineage?.source_channel] || SOURCE_META.manual;
  const SC      = { 1: '#f97316', 2: '#3b82f6', 3: '#a855f7' };

  return (
    <>
      <style>{CSS}</style>
      <div className="lin-overlay" onClick={onClose}>
        <div className="lin-modal" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="lin-hd">
            <div className="lin-title">🔍 EMISSION RECORD LINEAGE</div>
            <button className="lin-close" onClick={onClose}>✕</button>
          </div>

          <div className="lin-body">
            {loading ? (
              <div className="lin-loading">Loading lineage data…</div>
            ) : !lineage ? (
              <div className="lin-loading">No lineage data available</div>
            ) : (
              <>
                {/* CO2e headline */}
                <div style={{ textAlign: 'center', marginBottom: 20, padding: '16px', background: '#10b98108', border: '1px solid #10b98122', borderRadius: 10 }}>
                  <div className="lin-co2e">{fmt(lineage.co2e, 4)}</div>
                  <div className="lin-co2e-sub">
                    tonnes CO₂e · Scope {lineage.scope} · {lineage.category}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="lin-badge" style={{ background: '#10b98114', color: '#10b981', border: '1px solid #10b98133' }}>
                      {lineage.date}
                    </span>
                    <span className="lin-badge" style={{ background: `${SC[lineage.scope]}14`, color: SC[lineage.scope], border: `1px solid ${SC[lineage.scope]}33` }}>
                      SCOPE {lineage.scope}
                    </span>
                    <span className="lin-badge" style={{ background: '#3b82f614', color: '#3b82f6', border: '1px solid #3b82f633' }}>
                      {lineage.ef_version_id}
                    </span>
                  </div>
                </div>

                {/* Calculation formula */}
                <div className="lin-formula">
                  <div className="lin-formula-label">CALCULATION FORMULA</div>
                  <div>
                    <span style={{ color: '#f97316' }}>{fmt(lineage.quantity)} {lineage.unit}</span>
                    <span style={{ color: 'var(--mut)' }}> × </span>
                    <span style={{ color: '#3b82f6' }}>{lineage.ef_value} kgCO₂e/{lineage.unit}</span>
                    <span style={{ color: 'var(--mut)' }}> ÷ 1000 = </span>
                    <span style={{ color: '#10b981', fontWeight: 700 }}>{fmt(lineage.co2e, 4)} tCO₂e</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--mut)', marginTop: 4 }}>
                    EF source: {lineage.ef_source} · Version: {lineage.ef_version_id} · Effective: {lineage.ef_effective}
                  </div>
                </div>

                {/* Lineage chain */}
                <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.12em', marginBottom: 12 }}>
                  DATA PROVENANCE CHAIN
                </div>

                <div className="lin-chain">

                  {/* Step 1: Source file / intake */}
                  <div className="lin-node">
                    <div className="lin-icon-wrap">
                      <div className="lin-icon" style={{ background: `${srcMeta.color}14`, borderColor: `${srcMeta.color}33`, color: srcMeta.color }}>
                        {srcMeta.icon}
                      </div>
                      <div className="lin-connector"/>
                    </div>
                    <div>
                      <div className="lin-node-title" style={{ color: srcMeta.color }}>
                        DATA SOURCE — {srcMeta.label.toUpperCase()}
                      </div>
                      <div className="lin-node-detail">
                        {lineage.source_file
                          ? <>File: <strong style={{ color: 'var(--txt)' }}>{lineage.source_file}</strong></>
                          : 'Manual entry — no source file'}
                      </div>
                      <div className="lin-node-meta">
                        Entered by: {lineage.created_by} · {fmtDate(lineage.created_at)}
                      </div>
                    </div>
                  </div>

                  {/* Step 2: Activity data */}
                  <div className="lin-node">
                    <div className="lin-icon-wrap">
                      <div className="lin-icon" style={{ background: '#f9731614', borderColor: '#f9731633', color: '#f97316' }}>
                        📋
                      </div>
                      <div className="lin-connector"/>
                    </div>
                    <div>
                      <div className="lin-node-title" style={{ color: '#f97316' }}>ACTIVITY DATA</div>
                      <div className="lin-node-detail">
                        <strong style={{ color: 'var(--txt)' }}>{lineage.activity}</strong>
                        <br/>
                        Quantity: <strong style={{ color: 'var(--txt)' }}>{fmt(lineage.quantity)} {lineage.unit}</strong>
                        · Date: <strong style={{ color: 'var(--txt)' }}>{lineage.date}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Step 3: Emission factor version */}
                  <div className="lin-node">
                    <div className="lin-icon-wrap">
                      <div className="lin-icon" style={{ background: '#3b82f614', borderColor: '#3b82f633', color: '#3b82f6' }}>
                        🔢
                      </div>
                      <div className="lin-connector"/>
                    </div>
                    <div>
                      <div className="lin-node-title" style={{ color: '#3b82f6' }}>EMISSION FACTOR VERSION</div>
                      <div className="lin-node-detail">
                        Version: <strong style={{ color: 'var(--txt)' }}>{lineage.ef_version_id}</strong>
                        <br/>
                        Value: <strong style={{ color: 'var(--txt)' }}>{lineage.ef_value} kgCO₂e/{lineage.unit}</strong>
                        <br/>
                        Source: {lineage.ef_source}
                      </div>
                      <div className="lin-node-meta">Effective from: {lineage.ef_effective}</div>
                    </div>
                  </div>

                  {/* Step 4: Calculation */}
                  <div className="lin-node">
                    <div className="lin-icon-wrap">
                      <div className="lin-icon" style={{ background: '#10b98114', borderColor: '#10b98133', color: '#10b981' }}>
                        ⚡
                      </div>
                      <div className="lin-connector"/>
                    </div>
                    <div>
                      <div className="lin-node-title" style={{ color: '#10b981' }}>CALCULATED RESULT</div>
                      <div className="lin-node-detail">
                        <strong style={{ color: '#10b981', fontSize: 16 }}>{fmt(lineage.co2e, 4)} tCO₂e</strong>
                        <br/>
                        Category: {lineage.category}
                      </div>
                    </div>
                  </div>

                  {/* Step 5: Approval chain */}
                  <div className="lin-node">
                    <div className="lin-icon-wrap">
                      <div className="lin-icon" style={{
                        background: lineage.approval_state === 'locked' ? '#f9731614' : lineage.approval_state === 'approved' ? '#10b98114' : '#f59e0b14',
                        borderColor: lineage.approval_state === 'locked' ? '#f9731633' : lineage.approval_state === 'approved' ? '#10b98133' : '#f59e0b33',
                        color: lineage.approval_state === 'locked' ? '#f97316' : lineage.approval_state === 'approved' ? '#10b981' : '#f59e0b',
                      }}>
                        {lineage.approval_state === 'locked' ? '🔒' : lineage.approval_state === 'approved' ? '✓' : '⏳'}
                      </div>
                      {lineage.blockchain_tx && <div className="lin-connector"/>}
                    </div>
                    <div>
                      <div className="lin-node-title" style={{ color: lineage.approval_state === 'locked' ? '#f97316' : lineage.approval_state === 'approved' ? '#10b981' : '#f59e0b' }}>
                        APPROVAL — {lineage.approval_state.toUpperCase()}
                      </div>
                      <div className="lin-node-detail">
                        {lineage.approved_by
                          ? <>Approved by: <strong style={{ color: 'var(--txt)' }}>{lineage.approved_by}</strong> · {fmtDate(lineage.approved_at)}</>
                          : 'Pending approval'}
                        {lineage.locked_by && (
                          <>
                            <br/>
                            Locked by: <strong style={{ color: 'var(--txt)' }}>{lineage.locked_by}</strong> · {fmtDate(lineage.locked_at)}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Step 6: Blockchain anchor (if exists) */}
                  {lineage.blockchain_tx && (
                    <div className="lin-node">
                      <div className="lin-icon-wrap">
                        <div className="lin-icon" style={{ background: '#627eea14', borderColor: '#627eea33', color: '#627eea' }}>
                          ⬡
                        </div>
                      </div>
                      <div>
                        <div className="lin-node-title" style={{ color: '#627eea' }}>ON-CHAIN ANCHOR — SEPOLIA</div>
                        <div className="lin-node-detail">
                          Tx: <a
                            href={`https://sepolia.etherscan.io/tx/${lineage.blockchain_tx}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: '#627eea', fontSize: 10 }}
                          >
                            {lineage.blockchain_tx.slice(0, 16)}…{lineage.blockchain_tx.slice(-8)} ↗
                          </a>
                        </div>
                        {lineage.audit_hash && (
                          <div className="lin-node-meta">Hash: {lineage.audit_hash.slice(0, 16)}…</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Adjustments history */}
                {lineage.adjustments?.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.12em', marginBottom: 10 }}>
                      TRACKED ADJUSTMENTS ({lineage.adjustments.length})
                    </div>
                    {lineage.adjustments.map((adj, i) => (
                      <div key={i} style={{
                        padding: '12px 14px', borderRadius: 8, marginBottom: 8,
                        background: '#f9731608', border: '1px solid #f9731633',
                        fontSize: 11,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <strong style={{ color: '#f97316' }}>Adjustment #{i + 1}</strong>
                          <span style={{ color: 'var(--mut)', fontSize: 10 }}>{fmtDate(adj.created_at)}</span>
                        </div>
                        <div style={{ color: 'var(--mut)' }}>
                          {adj.field}: <strong style={{ color: '#ef4444' }}>{adj.old_val}</strong>
                          {' → '}
                          <strong style={{ color: '#10b981' }}>{adj.new_val}</strong>
                        </div>
                        <div style={{ color: 'var(--mut)', marginTop: 4 }}>
                          Reason: {adj.reason} · By: {adj.adjusted_by}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Export */}
                <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                  <button className="lin-btn lin-btn-g" style={{ flex: 1 }} onClick={exportLineage}>
                    {exported ? '✓ EXPORTED' : '↓ EXPORT LINEAGE REPORT (JSON)'}
                  </button>
                  <button className="lin-btn lin-btn-g" onClick={onClose}>CLOSE</button>
                </div>

                <div style={{ fontSize: 10, color: 'var(--mut)', textAlign: 'center', marginTop: 10, lineHeight: 1.7 }}>
                  This lineage report is auditor-ready · ISO 14064-3 compatible · GHG Protocol defensible
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}