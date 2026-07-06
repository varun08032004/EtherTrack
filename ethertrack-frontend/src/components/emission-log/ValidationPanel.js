// src/components/emission-log/ValidationPanel.jsx
// Validation UI — Priority 3
// Shows range checks, duplicate warnings, anomaly flags
// Called before any record touches the GHG ledger
// Integrates with emissionValidation.js service

import React from 'react';

const CSS = `
.vp-wrap{margin-bottom:14px;}
.vp-error{padding:10px 14px;border-radius:7px;background:#ef444408;border:1px solid #ef444433;margin-bottom:6px;font-size:11px;color:#ef4444;display:flex;align-items:flex-start;gap:8px;line-height:1.6;}
.vp-warn{padding:10px 14px;border-radius:7px;background:#f59e0b08;border:1px solid #f59e0b33;margin-bottom:6px;font-size:11px;color:#f59e0b;display:flex;align-items:flex-start;gap:8px;line-height:1.6;}
.vp-ok{padding:10px 14px;border-radius:7px;background:#10b98108;border:1px solid #10b98133;margin-bottom:6px;font-size:11px;color:#10b981;display:flex;align-items:center;gap:8px;}
.vp-type{font-size:9px;padding:2px 7px;border-radius:3px;letter-spacing:.06em;font-weight:700;flex-shrink:0;margin-top:1px;}
.vp-type-err{background:#ef444414;color:#ef4444;border:1px solid #ef444433;}
.vp-type-warn{background:#f59e0b14;color:#f59e0b;border:1px solid #f59e0b33;}
.vp-fix-btn{margin-left:auto;padding:4px 10px;border-radius:4px;border:1px solid #ef444433;background:none;color:#ef4444;cursor:pointer;font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.06em;flex-shrink:0;}
.vp-fix-btn:hover{background:#ef444414;}
.vp-override{padding:8px 12px;border-radius:6px;background:#f9731608;border:1px solid #f9731633;font-size:10px;color:#f97316;margin-top:8px;display:flex;align-items:center;gap:8px;}
.vp-override input{accent-color:#f97316;}
`;

// Type label map
const TYPE_LABELS = {
  RANGE:     'RANGE CHECK',
  DUPLICATE: 'DUPLICATE',
  ANOMALY:   'ANOMALY',
  DATE:      'DATE',
  REQUIRED:  'REQUIRED',
  UNIT:      'UNIT MISMATCH',
};

export default function ValidationPanel({
  validation,         // result from runAllValidations()
  onOverride,         // called when user overrides a warning
  overrideReason,     // current override reason text
  onOverrideReasonChange,
  showOverride,       // whether to show override option
}) {
  if (!validation) return null;

  const { passed, errors, warnings } = validation;

  // All clear
  if (passed && warnings.length === 0) {
    return (
      <>
        <style>{CSS}</style>
        <div className="vp-wrap">
          <div className="vp-ok">
            <span>✓</span>
            <span>All validation checks passed — record is ready to submit</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="vp-wrap">

        {/* Errors — block submission */}
        {errors.map((e, i) => (
          <div key={i} className="vp-error">
            <span className={`vp-type vp-type-err`}>{TYPE_LABELS[e.type] || e.type}</span>
            <span style={{ flex: 1 }}>{e.message}</span>
            {e.type === 'UNIT' && e.fixedQuantity && (
              <button className="vp-fix-btn" onClick={() => onOverride?.('unit_fix', e)}>
                USE {e.fixedQuantity.toLocaleString('en-IN')} {e.canonicalUnit}
              </button>
            )}
          </div>
        ))}

        {/* Warnings — allow submission with override */}
        {warnings.map((w, i) => (
          <div key={i} className="vp-warn">
            <span className={`vp-type vp-type-warn`}>{TYPE_LABELS[w.type] || w.type}</span>
            <div style={{ flex: 1 }}>
              <div>{w.message}</div>
              {w.type === 'DUPLICATE' && w.matchedRecord && (
                <div style={{ fontSize: 10, marginTop: 4, opacity: .8 }}>
                  Matched record: {w.matchedRecord.activity} · {w.matchedRecord.quantity} {w.matchedRecord.unit} · {w.matchedRecord.date}
                </div>
              )}
              {w.type === 'ANOMALY' && (
                <div style={{ fontSize: 10, marginTop: 4, opacity: .8 }}>
                  Previous month: {w.prevTotal?.toLocaleString('en-IN')} · This entry: {w.newQty?.toLocaleString('en-IN')} · Change: {w.changePct}%
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Override section — for warnings only */}
        {passed && warnings.length > 0 && showOverride && (
          <div className="vp-override">
            <input
              type="checkbox"
              id="vp-override-check"
              onChange={e => onOverride?.('acknowledge', e.target.checked)}
            />
            <label htmlFor="vp-override-check" style={{ cursor: 'pointer', flex: 1 }}>
              I have verified the above warnings and confirm this data is correct
            </label>
          </div>
        )}

        {/* Override reason — required for anomaly override */}
        {passed && warnings.some(w => w.type === 'ANOMALY') && showOverride && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 5 }}>
              REASON FOR OVERRIDE (required for anomaly)
            </div>
            <textarea
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '9px 11px', borderRadius: 6,
                background: '#0a1018', border: '1px solid var(--brd)',
                color: 'var(--txt)', fontFamily: 'Space Mono, monospace',
                fontSize: 11, outline: 'none', resize: 'vertical',
              }}
              rows={2}
              placeholder="e.g. New generator installed — higher diesel consumption expected from Jan 2025"
              value={overrideReason || ''}
              onChange={e => onOverrideReasonChange?.(e.target.value)}
              maxLength={500}
            />
          </div>
        )}

        {/* Block message */}
        {errors.length > 0 && (
          <div style={{
            padding: '10px 14px', borderRadius: 7, marginTop: 8,
            background: '#ef444408', border: '1px solid #ef444433',
            fontSize: 11, color: '#ef4444', fontWeight: 700,
          }}>
            ✕ {errors.length} error{errors.length > 1 ? 's' : ''} must be resolved before this record can be submitted
          </div>
        )}
      </div>
    </>
  );
}