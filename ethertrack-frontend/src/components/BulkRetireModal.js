// src/components/BulkRetireModal.jsx
// Allows retiring multiple credits in one operation.
// Each credit is retired sequentially — if one fails the rest still proceed.

import React, { useState, useCallback } from 'react';
import { useModal } from '../hooks/useModal';

const SCOPES = [
  { val: '1', label: 'Scope 1', color: '#f97316' },
  { val: '2', label: 'Scope 2', color: '#3b82f6' },
  { val: '3', label: 'Scope 3', color: '#a855f7' },
];

const PURPOSES = [
  { value: 'voluntary_offset', label: 'Voluntary offset'             },
  { value: 'compliance',       label: 'Regulatory compliance'        },
  { value: 'net_zero',         label: 'Net zero commitment'          },
  { value: 'supply_chain',     label: 'Supply chain decarbonisation' },
];

export default function BulkRetireModal({
  credits,
  totalTco2,
  onConfirm,
  onClose,
}) {
  const [scope,             setScope]             = useState('1');
  const [beneficiaryName,   setBeneficiaryName]   = useState('');
  const [beneficiaryEntity, setBeneficiaryEntity] = useState('');
  const [beneficiaryGstin,  setBeneficiaryGstin]  = useState('');
  const [purpose,           setPurpose]           = useState('voluntary_offset');
  const [progress,          setProgress]          = useState(null); // { done, total, failed }
  const [retiring,          setRetiring]          = useState(false);

  const { overlayProps, dialogProps } = useModal(true, () => !retiring && onClose());

  const handleConfirm = useCallback(async () => {
    setRetiring(true);
    setProgress({ done: 0, total: credits.length, failed: 0 });

    const corporateData = { beneficiaryName, beneficiaryEntity, beneficiaryGstin, purpose };
    let failed = 0;

    for (let i = 0; i < credits.length; i++) {
      const credit = credits[i];
      try {
        await onConfirm(credit, credit.credits, scope, corporateData);
        setProgress({ done: i + 1, total: credits.length, failed });
      } catch {
        failed += 1;
        setProgress({ done: i + 1, total: credits.length, failed });
      }
    }

    setRetiring(false);
    onClose();
  }, [credits, scope, beneficiaryName, beneficiaryEntity, beneficiaryGstin, purpose, onConfirm, onClose]);

  return (
    <div {...overlayProps}>
      <div {...dialogProps}
        aria-labelledby="bulk-retire-title"
        style={{
          background: '#070c09', border: '1px solid #0d1f11',
          borderRadius: 16, width: '100%', maxWidth: 540,
          maxHeight: '90vh', overflowY: 'auto',
        }}>

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #0d1f11', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div id="bulk-retire-title" style={{ fontSize: 13, fontWeight: 700, color: '#f0fdf4' }}>
              BULK RETIRE — {credits.length} CREDITS
            </div>
            <div style={{ fontSize: 9, color: '#f8717188', marginTop: 2 }}>
              {totalTco2.toLocaleString()} tCO₂e total · Irreversible on-chain operation
            </div>
          </div>
          <button
            aria-label="Close"
            onClick={() => !retiring && onClose()}
            style={{ background: 'none', border: 'none', color: '#86efac44', cursor: 'pointer', fontSize: 18 }}>
            ✕
          </button>
        </div>

        <div style={{ padding: 24 }}>
          {/* Credit list */}
          <div style={{ background: '#060a07', border: '1px solid #0d1f11', borderRadius: 8, padding: '10px 14px', marginBottom: 20, maxHeight: 150, overflowY: 'auto' }}>
            {credits.map((c, i) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: i < credits.length - 1 ? '1px solid #0d1f1166' : 'none' }}>
                <span style={{ fontSize: 10, color: '#86efac88', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{c.projectName}</span>
                <span style={{ fontSize: 10, color: '#22c55e', flexShrink: 0 }}>{(c.heldCredits || c.credits).toLocaleString()} t</span>
              </div>
            ))}
          </div>

          {/* Scope */}
          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px 0' }}>
            <legend style={{ fontSize: 9, color: '#86efac88', letterSpacing: '.12em', marginBottom: 6 }}>OFFSET SCOPE (APPLIED TO ALL)</legend>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {SCOPES.map(({ val, label, color }) => (
                <button key={val} type="button" aria-pressed={scope === val} onClick={() => setScope(val)}
                  style={{ padding: '10px', borderRadius: 8, border: `1px solid ${scope === val ? color + '66' : '#0d1f11'}`, background: scope === val ? `${color}11` : '#060a07', cursor: 'pointer', textAlign: 'center' }}>
                  <span style={{ fontSize: 11, color: scope === val ? color : '#86efac44', fontWeight: 700 }}>{label}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {/* Beneficiary */}
          <div style={{ background: '#0a1628', border: '1px solid #60a5fa22', borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 9, color: '#60a5fa88', letterSpacing: '.14em', marginBottom: 10 }}>CORPORATE BENEFICIARY (APPLIED TO ALL)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label htmlFor="bulk-ben-name" style={{ fontSize: 9, color: '#86efac88', display: 'block', marginBottom: 5 }}>NAME</label>
                <input id="bulk-ben-name" value={beneficiaryName} onChange={e => setBeneficiaryName(e.target.value)}
                  style={{ width: '100%', padding: '9px 10px', borderRadius: 6, border: '1px solid #0d1f11', background: '#040706', color: '#f0fdf4', fontFamily: 'DM Mono,monospace', fontSize: 11, outline: 'none' }} />
              </div>
              <div>
                <label htmlFor="bulk-ben-entity" style={{ fontSize: 9, color: '#86efac88', display: 'block', marginBottom: 5 }}>COMPANY</label>
                <input id="bulk-ben-entity" value={beneficiaryEntity} onChange={e => setBeneficiaryEntity(e.target.value)}
                  style={{ width: '100%', padding: '9px 10px', borderRadius: 6, border: '1px solid #0d1f11', background: '#040706', color: '#f0fdf4', fontFamily: 'DM Mono,monospace', fontSize: 11, outline: 'none' }} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label htmlFor="bulk-gstin" style={{ fontSize: 9, color: '#86efac88', display: 'block', marginBottom: 5 }}>GSTIN</label>
                <input id="bulk-gstin" value={beneficiaryGstin} onChange={e => setBeneficiaryGstin(e.target.value.toUpperCase())} maxLength={15}
                  style={{ width: '100%', padding: '9px 10px', borderRadius: 6, border: '1px solid #0d1f11', background: '#040706', color: '#f0fdf4', fontFamily: 'DM Mono,monospace', fontSize: 11, outline: 'none' }} />
              </div>
              <div>
                <label htmlFor="bulk-purpose" style={{ fontSize: 9, color: '#86efac88', display: 'block', marginBottom: 5 }}>PURPOSE</label>
                <select id="bulk-purpose" value={purpose} onChange={e => setPurpose(e.target.value)}
                  style={{ width: '100%', padding: '9px 10px', borderRadius: 6, border: '1px solid #0d1f11', background: '#040706', color: '#f0fdf4', fontFamily: 'DM Mono,monospace', fontSize: 11, outline: 'none' }}>
                  {PURPOSES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          {progress && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#86efac77', marginBottom: 6 }}>
                <span>Retiring {progress.done} of {progress.total}</span>
                {progress.failed > 0 && <span style={{ color: '#f87171' }}>{progress.failed} failed</span>}
              </div>
              <div style={{ height: 6, background: '#0d1f11', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${(progress.done / progress.total) * 100}%`, background: progress.failed > 0 ? '#f97316' : '#22c55e', borderRadius: 3, transition: 'width .3s ease' }} />
              </div>
            </div>
          )}

          <div style={{ padding: '10px 12px', background: '#0e0505', borderRadius: 6, border: '1px solid #f8717122', fontSize: 10, color: '#f8717188' }}>
            ⚠️ <strong style={{ color: '#f87171aa' }}>Irreversible.</strong> All {credits.length} selected tokens will be permanently burned on-chain.
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #0d1f11', display: 'flex', gap: 10, background: '#050809' }}>
          <button onClick={onClose} disabled={retiring}
            style={{ flex: 1, padding: '12px', borderRadius: 8, border: '1px solid #0d1f11', background: '#060a07', color: '#86efac66', cursor: 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 12 }}>
            CANCEL
          </button>
          <button onClick={handleConfirm} disabled={retiring} data-testid="bulk-retire-confirm"
            style={{ flex: 2, padding: '12px', borderRadius: 8, border: '1px solid #f8717133', background: '#0e0505', color: '#f87171', cursor: retiring ? 'not-allowed' : 'pointer', fontFamily: 'DM Mono,monospace', fontSize: 12, fontWeight: 700 }}>
            {retiring
              ? `⟳ RETIRING ${progress?.done || 0}/${credits.length}…`
              : `🔥 RETIRE ALL ${credits.length} CREDITS (${totalTco2.toLocaleString()} tCO₂) →`
            }
          </button>
        </div>
      </div>
    </div>
  );
}