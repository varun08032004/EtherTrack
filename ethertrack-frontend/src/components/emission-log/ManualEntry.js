// src/components/emission-log/ManualEntry.jsx
// Manual emission entry form
// [FEAT-VALIDATION]   Wired runAllValidations() — range checks, duplicate
//                     detection, month-over-month anomaly flagging before
//                     any record reaches the GHG ledger.
// [FEAT-EF-VERSION]   Wired calcWithVersion() — every record now stores
//                     which emission factor version was active on the
//                     activity date, for audit traceability.
// [FEAT-OVERRIDE]     Warnings (not errors) can be acknowledged via the
//                     ValidationPanel override checkbox. Anomaly overrides
//                     additionally require a written reason, sent to the
//                     backend as part of notes so it's preserved on record.

import React, { useState, useEffect } from 'react';
import { emissionsAPI } from '../../services/api';
import { runAllValidations } from '../../services/emissionValidation';
import { calcWithVersion }   from '../../services/emissionFactorVersioning';
import ValidationPanel       from './ValidationPanel';

const sanitise = (str = '') =>
  String(str).replace(/<[^>]*>/g, '').replace(/['"`;]/g, '').trim().slice(0, 500);

const safeNum = (val, min = 0, max = 1e12) => {
  const n = parseFloat(val);
  if (!isFinite(n) || n < min || n > max) return null;
  return n;
};

// Fallback calc — used only if calcWithVersion can't resolve a version
// (keeps the live preview working even for activities with no version history)
const calcFallback = (EF, activity, qty) => {
  const e = EF[activity];
  const q = safeNum(qty);
  if (!e || q === null) return null;
  return {
    co2e:   q * e.factor / 1000,
    scope:  e.scope,
    cat:    e.cat,
    unit:   e.unit,
    factor: e.factor,
    source: e.source,
    method: e.method || null,
  };
};

const SC = { 1: '#f97316', 2: '#3b82f6', 3: '#a855f7' };
const fmt = (n, d = 2) =>
  Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

const CSS = `
.me-wrap{display:grid;grid-template-columns:2fr 1fr;gap:16px;}
.me-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:22px;animation:fU .4s ease both;}
.me-ctit{font-size:10px;letter-spacing:.15em;color:var(--mut);margin-bottom:18px;display:flex;align-items:center;gap:8px;}
.me-ctit::before{content:'';width:12px;height:1px;background:var(--grn);}
.me-prev{padding:14px 16px;border-radius:7px;background:#10b98108;border:1px solid #10b98122;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.me-prev-val{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;color:var(--grn);}
.me-fg4{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:12px;margin-bottom:14px;}
.me-fg{display:flex;flex-direction:column;gap:5px;}
.me-lbl{font-size:11px;letter-spacing:.1em;color:var(--mut);}
.me-inp,.me-sel{padding:10px 12px;border-radius:6px;background:#0a1018;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;width:100%;box-sizing:border-box;}
.me-inp:focus,.me-sel:focus{border-color:#10b98144;}
.me-inp::placeholder{color:var(--mut);opacity:.9;}
.me-btn{padding:10px 18px;border-radius:6px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:10px;letter-spacing:.1em;font-weight:700;transition:all .2s;}
.me-btn:disabled{opacity:.5;cursor:not-allowed;}
.me-btn-p{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
.me-btn-p:hover:not(:disabled){opacity:.88;transform:translateY(-1px);}
.me-btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.me-btn-g:hover:not(:disabled){border-color:#10b98144;color:var(--grn);}
.me-toast{position:fixed;top:76px;right:24px;z-index:9999;padding:12px 20px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000066;animation:fU .3s ease;}
.me-toast-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.me-toast-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
.me-ef-scroll{max-height:480px;overflow-y:auto;}
.me-ef-version-tag{font-size:9px;color:#3b82f6;background:#3b82f614;border:1px solid #3b82f633;padding:2px 7px;border-radius:3px;margin-left:8px;letter-spacing:.04em;}
@media(max-width:900px){.me-wrap{grid-template-columns:1fr;}.me-fg4{grid-template-columns:1fr 1fr;}}
`;

export default function ManualEntry({ EF, year, onRecordAdded, profile, existingRecords = [] }) {
  const [form,           setForm]           = useState({ date: '', activity: '', qty: '', notes: '' });
  const [submitting,     setSubmitting]     = useState(false);
  const [notif,          setNotif]          = useState(null);
  const [validation,     setValidation]     = useState(null);
  const [overrideOk,     setOverrideOk]     = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  const toast = (msg, type = 'ok') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 4000);
  };

  // ── Live preview — uses versioned calc when a date is set, falls back
  //    to the plain EF table calc when date isn't filled yet ──────────────
  const preview = form.date
    ? calcWithVersion(form.activity, safeNum(form.qty), form.date, EF)
    : calcFallback(EF, form.activity, form.qty);

  // ── [FEAT-VALIDATION] Run validation whenever the key fields change ────
  useEffect(() => {
    if (!form.activity || !form.qty || !form.date) { setValidation(null); setOverrideOk(false); return; }
    const qty = safeNum(form.qty);
    if (qty === null) { setValidation(null); return; }

    const candidate = {
      activity: form.activity,
      quantity: qty,
      date:     form.date,
      scope:    EF[form.activity]?.scope,
    };
    setValidation(runAllValidations(candidate, existingRecords));
    setOverrideOk(false); // reset override whenever inputs change — must re-acknowledge
  }, [form.activity, form.qty, form.date, existingRecords, EF]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.date || !form.activity || !form.qty) return;

    const cleanDate  = sanitise(form.date);
    const cleanNotes = sanitise(form.notes);
    const qty        = safeNum(form.qty, 0.001, 1e9);

    if (!qty)                                    { toast('Invalid quantity', 'err');    return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate))  { toast('Invalid date format', 'err'); return; }

    // ── [FEAT-VALIDATION] Hard block on errors ──────────────────────────────
    if (validation && !validation.passed) {
      toast('Fix validation errors before submitting', 'err');
      return;
    }
    // ── [FEAT-VALIDATION] Warnings require explicit acknowledgement ────────
    if (validation?.warnings?.length > 0 && !overrideOk) {
      toast('Please acknowledge the warnings above before submitting', 'err');
      return;
    }
    // ── Anomaly warnings additionally require a written reason ─────────────
    const hasAnomaly = validation?.warnings?.some(w => w.type === 'ANOMALY');
    if (hasAnomaly && !overrideReason.trim()) {
      toast('Please provide a reason for the unusual month-over-month change', 'err');
      return;
    }

    // ── [FEAT-EF-VERSION] Calculate with the EF version active on this date ─
    const p = calcWithVersion(form.activity, qty, cleanDate, EF);
    if (!p) { toast('Unknown activity', 'err'); return; }

    setSubmitting(true);

    const finalNotes = hasAnomaly && overrideReason.trim()
      ? `${cleanNotes ? cleanNotes + ' — ' : ''}Override: ${sanitise(overrideReason, 300)}`
      : cleanNotes;

    // Optimistic record
    const tmp = {
      id:       `tmp-${Date.now()}`,
      date:     cleanDate,
      activity: form.activity,
      qty,
      notes:    finalNotes,
      verified: false,
      ...p,
    };

    onRecordAdded(tmp);
    setForm({ date: '', activity: '', qty: '', notes: '' });
    setValidation(null);
    setOverrideOk(false);
    setOverrideReason('');
    toast(`✓ Logged ${p.co2e.toFixed(3)} tCO₂e · Scope ${p.scope} · ${p.source} (${p.ef_version_id})`);

    try {
      const res = await emissionsAPI.log({
        date:     cleanDate,
        activity: form.activity,
        quantity: qty,
        unit:     p.unit,
        scope:    p.scope,
        category: p.cat,
        factor:   p.factor,
        co2e:     p.co2e,
        notes:    finalNotes,
        source:   p.source,
        // [FEAT-EF-VERSION] Persisted for audit lineage — backend stores this
        // on emission_activities.ef_version_id (see add_approval_workflow_tables.sql)
        ef_version_id: p.ef_version_id,
      });
      if (res?.activity) {
        // Replace tmp with real record
        onRecordAdded({
          ...tmp,
          ...res.activity,
          qty:  parseFloat(res.activity.quantity),
          co2e: parseFloat(res.activity.co2e),
          date: (res.activity.date || '').slice(0, 10),
        });
      }
    } catch {
      toast('Failed to save — please try again', 'err');
    } finally {
      setSubmitting(false);
    }
  };

  const blockedByErrors  = validation && !validation.passed;
  const blockedByWarning = validation?.passed && validation?.warnings?.length > 0 && !overrideOk;
  const submitDisabled   = submitting || blockedByErrors || blockedByWarning;

  return (
    <>
      <style>{CSS}</style>

      {notif && (
        <div className={`me-toast ${notif.type === 'err' ? 'me-toast-err' : 'me-toast-ok'}`}>
          {notif.msg}
        </div>
      )}

      <div className="me-wrap">

        {/* ── Left: form ── */}
        <div className="me-card">
          <div className="me-ctit">LOG NEW EMISSION RECORD</div>

          {/* Live preview */}
          {preview && (
            <div className="me-prev">
              <div>
                <div style={{ fontSize: 11, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 6 }}>
                  CALCULATED CO₂e
                </div>
                <div className="me-prev-val">{preview.co2e.toFixed(4)}</div>
                <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 2 }}>
                  tonnes CO₂e · Scope {preview.scope} · {preview.cat}
                </div>
                {preview.method && (
                  <div style={{ fontSize: 10, marginTop: 4, color: preview.method === 'market' ? '#10b981' : '#3b82f6' }}>
                    {preview.method === 'market' ? 'Market-based Scope 2' : 'Location-based Scope 2'}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--mut)', textAlign: 'right', lineHeight: 1.9 }}>
                Factor: <strong style={{ color: 'var(--txt)' }}>{preview.factor} kg CO₂e/{preview.unit}</strong><br/>
                Source: <strong style={{ color: 'var(--grn)' }}>{preview.source}</strong>
                {preview.ef_version_id && <span className="me-ef-version-tag">{preview.ef_version_id}</span>}
                <br/>
                Method: Activity-based GHG
              </div>
            </div>
          )}

          <form onSubmit={handleAdd}>
            <div className="me-fg4">
              <div className="me-fg">
                <label className="me-lbl">EMISSION ACTIVITY</label>
                <select
                  className="me-sel"
                  value={form.activity}
                  onChange={e => setForm(f => ({ ...f, activity: e.target.value }))}
                  required
                >
                  <option value="">Select activity…</option>
                  {[1, 2, 3].map(s => (
                    <optgroup key={s} label={`── SCOPE ${s} ──`}>
                      {Object.entries(EF)
                        .filter(([, ef]) => ef.scope === s)
                        .map(([name]) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="me-fg">
                <label className="me-lbl">
                  QUANTITY{EF[form.activity] ? ` (${EF[form.activity].unit})` : ''}
                </label>
                <input
                  className="me-inp"
                  type="number"
                  step="0.001"
                  min="0.001"
                  max="999999999"
                  placeholder="0.000"
                  value={form.qty}
                  onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                  required
                />
              </div>

              <div className="me-fg">
                <label className="me-lbl">DATE</label>
                <input
                  className="me-inp"
                  type="date"
                  value={form.date}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  required
                />
              </div>

              <div className="me-fg">
                <label className="me-lbl">NOTES</label>
                <input
                  className="me-inp"
                  type="text"
                  placeholder="Description"
                  maxLength={200}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>

            {/* ── [FEAT-VALIDATION] Validation panel ── */}
            <ValidationPanel
              validation={validation}
              showOverride={true}
              overrideReason={overrideReason}
              onOverrideReasonChange={setOverrideReason}
              onOverride={(type, val) => {
                if (type === 'acknowledge') setOverrideOk(val);
                if (type === 'unit_fix' && val?.fixedQuantity) {
                  setForm(f => ({ ...f, qty: String(val.fixedQuantity) }));
                }
              }}
            />

            <button
              type="submit"
              className="me-btn me-btn-p"
              disabled={submitDisabled}
            >
              {submitting ? '⟳ SAVING…' : blockedByErrors ? 'FIX ERRORS TO CONTINUE' : 'LOG EMISSION →'}
            </button>
          </form>
        </div>

        {/* ── Right: EF reference ── */}
        <div className="me-card">
          <div className="me-ctit">EMISSION FACTOR REFERENCE</div>
          <div className="me-ef-scroll">
            {[1, 2, 3].map(s => (
              <div key={s} style={{ marginBottom: 16 }}>
                <div style={{
                  fontSize: 11, letterSpacing: '.1em', color: SC[s],
                  marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ width: 8, height: 1, background: SC[s], display: 'inline-block' }}/>
                  SCOPE {s}
                  {s === 2 && (
                    <span style={{ fontSize: 9, color: 'var(--mut)', marginLeft: 4 }}>
                      (Location: 0.000727 tCO₂e/kWh — CEA V20.0)
                    </span>
                  )}
                </div>
                {Object.entries(EF)
                  .filter(([, ef]) => ef.scope === s)
                  .map(([name, ef]) => (
                    <div
                      key={name}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '5px 0',
                        borderBottom: '1px solid var(--brd)44',
                        fontSize: 11,
                      }}
                    >
                      <span style={{ color: 'var(--mut)', flex: 1 }}>{name}</span>
                      <span style={{ color: SC[s], marginRight: 12 }}>{ef.factor} kg/{ef.unit}</span>
                      <span style={{ fontSize: 9, color: 'var(--mut)', opacity: .6 }}>{ef.source}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--mut)', lineHeight: 1.9 }}>
            Sources: DEFRA 2024 · IPCC AR6 GWP100 · IEA 2024 · CEA V20.0 Dec 2024 · BEE India PAT
          </div>
        </div>

      </div>
    </>
  );
}