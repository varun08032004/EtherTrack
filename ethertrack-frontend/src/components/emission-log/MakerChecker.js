// src/components/emission-log/MakerChecker.jsx
// Maker-Checker Approval Workflow
// State machine: draft → submitted → reviewed → approved → locked
// Locked records only editable via tracked adjustment — never silent edit
//
// [FIX-API-WIRE] Replaced raw apiFetch calls with emissionsAPI methods
//                from services/api.js — consistent with rest of the app's
//                CSRF handling, auto-refresh, and error format.

import React, { useState } from 'react';
import { emissionsAPI } from '../../services/api';

// ─────────────────────────────────────────────────────────────────────────────
// STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────
export const RECORD_STATES = {
  draft:     { label: 'DRAFT',     color: '#5a7a8a', bg: '#5a7a8a14', border: '#5a7a8a33', icon: '✏️',  desc: 'Entry in progress — not yet submitted for review' },
  submitted: { label: 'SUBMITTED', color: '#f59e0b', bg: '#f59e0b14', border: '#f59e0b33', icon: '📤', desc: 'Submitted for reviewer approval' },
  reviewed:  { label: 'REVIEWED',  color: '#3b82f6', bg: '#3b82f614', border: '#3b82f633', icon: '👁',  desc: 'Reviewed — pending final approval' },
  approved:  { label: 'APPROVED',  color: '#10b981', bg: '#10b98114', border: '#10b98133', icon: '✓',   desc: 'Approved — included in GHG inventory' },
  locked:    { label: 'LOCKED',    color: '#f97316', bg: '#f9731614', border: '#f9731633', icon: '🔒', desc: 'Locked — corrections require tracked adjustment' },
  rejected:  { label: 'REJECTED',  color: '#ef4444', bg: '#ef444414', border: '#ef444433', icon: '✕',   desc: 'Rejected — needs correction and resubmission' },
};

// Valid transitions per role
const TRANSITIONS = {
  maker: {
    draft:     ['submitted'],
    rejected:  ['submitted'],
  },
  reviewer: {
    submitted: ['reviewed', 'rejected'],
  },
  approver: {
    reviewed:  ['approved', 'rejected'],
    approved:  ['locked'],
  },
  admin: {
    draft:     ['submitted', 'approved', 'locked'],
    submitted: ['reviewed', 'approved', 'rejected', 'locked'],
    reviewed:  ['approved', 'rejected', 'locked'],
    approved:  ['locked', 'rejected'],
  },
};

export const getAvailableTransitions = (currentState, userRole) => {
  const roleTransitions = TRANSITIONS[userRole] || TRANSITIONS.maker;
  return roleTransitions[currentState] || [];
};

const CSS = `
.mc-wrap{width:100%;}
.mc-card{background:var(--surf);border:1px solid var(--brd);border-radius:10px;padding:20px;margin-bottom:12px;animation:fU .4s ease both;}
.mc-ctit{font-size:10px;letter-spacing:.15em;color:var(--mut);margin-bottom:16px;display:flex;align-items:center;gap:8px;}
.mc-ctit::before{content:'';width:12px;height:1px;background:#10b981;}
.mc-state-bar{display:flex;align-items:center;gap:0;margin-bottom:20px;overflow-x:auto;padding-bottom:4px;}
.mc-state-step{display:flex;align-items:center;flex-shrink:0;}
.mc-state-node{padding:8px 14px;border-radius:6px;font-size:10px;font-weight:700;letter-spacing:.08em;white-space:nowrap;border:1px solid;}
.mc-state-node.active{box-shadow:0 0 0 2px currentColor;}
.mc-state-arrow{width:24px;height:1px;background:var(--brd);flex-shrink:0;}
.mc-record-row{display:grid;grid-template-columns:100px 1fr 80px 80px 100px 120px auto;gap:8px;align-items:center;padding:10px 14px;border-radius:8px;border:1px solid var(--brd);background:#080b0e;margin-bottom:6px;font-size:11px;transition:border-color .2s;}
.mc-record-row:hover{border-color:#10b98122;}
.mc-hdr{display:grid;grid-template-columns:100px 1fr 80px 80px 100px 120px auto;gap:8px;padding:8px 14px;font-size:9px;letter-spacing:.08em;color:var(--mut);border-bottom:1px solid var(--brd);margin-bottom:8px;}
.mc-pill{font-size:9px;padding:3px 9px;border-radius:3px;letter-spacing:.05em;font-weight:700;white-space:nowrap;}
.mc-btn{padding:7px 14px;border-radius:5px;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:9px;letter-spacing:.08em;font-weight:700;transition:all .2s;white-space:nowrap;}
.mc-btn:disabled{opacity:.4;cursor:not-allowed;}
.mc-btn-grn{background:linear-gradient(135deg,#10b981,#059669);color:#fff;}
.mc-btn-red{background:#ef444414;border:1px solid #ef444433;color:#ef4444;}
.mc-btn-blu{background:#3b82f614;border:1px solid #3b82f633;color:#3b82f6;}
.mc-btn-g{background:var(--surf);border:1px solid var(--brd2);color:var(--txt);}
.mc-btn-org{background:#f9731614;border:1px solid #f9731633;color:#f97316;}
.mc-modal-overlay{position:fixed;inset:0;z-index:2000;background:#00000099;display:flex;align-items:center;justify-content:center;}
.mc-modal{background:var(--surf);border:1px solid var(--brd2);border-radius:12px;padding:24px;max-width:440px;width:90%;box-shadow:0 24px 80px #00000088;}
.mc-modal-title{font-size:14px;font-weight:700;margin-bottom:8px;color:var(--txt);}
.mc-modal-sub{font-size:11px;color:var(--mut);margin-bottom:16px;line-height:1.7;}
.mc-ta{padding:10px 12px;border-radius:6px;background:#0a1018;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:11px;outline:none;width:100%;box-sizing:border-box;resize:vertical;}
.mc-ta:focus{border-color:#10b98144;}
.mc-adj-form{border:1px solid #f9731633;border-radius:8px;padding:16px;background:#f9731608;margin-top:12px;}
.mc-adj-title{font-size:11px;color:#f97316;font-weight:700;margin-bottom:10px;}
.mc-inp{padding:9px 11px;border-radius:6px;background:#0a1018;border:1px solid var(--brd);color:var(--txt);font-family:'Space Mono',monospace;font-size:11px;outline:none;width:100%;box-sizing:border-box;}
.mc-inp:focus{border-color:#f9731644;}
.mc-toast{position:fixed;top:76px;right:24px;z-index:9999;padding:12px 20px;border-radius:8px;font-family:'Space Mono',monospace;font-size:11px;box-shadow:0 8px 32px #00000066;animation:fU .3s ease;}
.mc-toast-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.mc-toast-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
.mc-stats{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px;}
.mc-stat{background:#080b0e;border-radius:7px;padding:10px;border:1px solid var(--brd);text-align:center;}
.mc-stat-val{font-family:'Syne',sans-serif;font-size:18px;font-weight:800;margin-bottom:2px;}
.mc-stat-lbl{font-size:9px;color:var(--mut);letter-spacing:.06em;}
@media(max-width:900px){.mc-record-row,.mc-hdr{grid-template-columns:80px 1fr 70px 100px auto;}.mc-stats{grid-template-columns:repeat(3,1fr);}}
`;

export default function MakerChecker({ records = [], userRole = 'maker', year, onStateChange }) {
  const [pendingAction, setPendingAction] = useState(null); // { record, newState }
  const [comment,       setComment]       = useState('');
  const [adjForm,       setAdjForm]       = useState(null); // { record, field, oldVal, newVal, reason }
  const [saving,        setSaving]        = useState(false);
  const [filterState,   setFilterState]   = useState('all');
  const [notif,         setNotif]         = useState(null);

  const toast = (msg, type = 'ok') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 4000);
  };

  // ── Transition a record to new state ──────────────────────────────────────
  const handleTransition = async () => {
    if (!pendingAction || saving) return;
    setSaving(true);
    try {
      await emissionsAPI.transitionState(pendingAction.record.id, pendingAction.newState, comment);
      toast(`✓ Record ${pendingAction.newState}`);
      onStateChange?.();
    } catch (err) {
      toast(err?.message || 'Failed to update state — please try again', 'err');
    } finally {
      setSaving(false);
      setPendingAction(null);
      setComment('');
    }
  };

  // ── Submit a tracked adjustment (for locked records) ──────────────────────
  const handleAdjustment = async () => {
    if (!adjForm || saving) return;
    if (!adjForm.reason?.trim()) { toast('Reason for adjustment is required', 'err'); return; }
    setSaving(true);
    try {
      await emissionsAPI.submitAdjustment(adjForm.record.id, {
        field:   adjForm.field,
        old_val: adjForm.oldVal,
        new_val: adjForm.newVal,
        reason:  adjForm.reason,
      });
      toast('✓ Tracked adjustment submitted — pending re-approval');
      onStateChange?.();
    } catch (err) {
      toast(err?.message || 'Adjustment failed — please try again', 'err');
    } finally {
      setSaving(false);
      setAdjForm(null);
    }
  };

  // ── Filter records ────────────────────────────────────────────────────────
  const filtered = filterState === 'all'
    ? records
    : records.filter(r => (r.approval_state || 'draft') === filterState);

  // ── State counts ──────────────────────────────────────────────────────────
  const counts = Object.keys(RECORD_STATES).reduce((acc, s) => {
    acc[s] = records.filter(r => (r.approval_state || 'draft') === s).length;
    return acc;
  }, {});

  const STATE_ORDER = ['draft', 'submitted', 'reviewed', 'approved', 'locked', 'rejected'];

  return (
    <>
      <style>{CSS}</style>

      {notif && (
        <div className={`mc-toast ${notif.type === 'err' ? 'mc-toast-err' : 'mc-toast-ok'}`}>
          {notif.msg}
        </div>
      )}

      {/* Transition modal */}
      {pendingAction && (
        <div className="mc-modal-overlay" onClick={() => setPendingAction(null)}>
          <div className="mc-modal" onClick={e => e.stopPropagation()}>
            <div className="mc-modal-title">
              {pendingAction.newState === 'rejected' ? '✕ Reject Record' :
               pendingAction.newState === 'locked'   ? '🔒 Lock Record' :
               pendingAction.newState === 'approved' ? '✓ Approve Record' :
               `Move to ${RECORD_STATES[pendingAction.newState]?.label}`}
            </div>
            <div className="mc-modal-sub">
              {pendingAction.record.activity} · {pendingAction.record.quantity} {pendingAction.record.unit} · {pendingAction.record.date}
              {pendingAction.newState === 'locked' && (
                <div style={{ marginTop: 8, color: '#f97316' }}>
                  ⚠ Locked records can only be changed via a tracked adjustment with mandatory reason and re-approval.
                </div>
              )}
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 6 }}>
                {pendingAction.newState === 'rejected' ? 'REJECTION REASON (required)' : 'COMMENT (optional)'}
              </div>
              <textarea
                className="mc-ta"
                rows={3}
                placeholder={
                  pendingAction.newState === 'rejected'
                    ? 'Explain why this record is being rejected…'
                    : 'Add a note for the audit trail…'
                }
                value={comment}
                onChange={e => setComment(e.target.value)}
                maxLength={1000}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className={`mc-btn ${
                  pendingAction.newState === 'rejected' ? 'mc-btn-red' :
                  pendingAction.newState === 'locked'   ? 'mc-btn-org' : 'mc-btn-grn'
                }`}
                style={{ flex: 1, padding: '10px' }}
                onClick={handleTransition}
                disabled={saving || (pendingAction.newState === 'rejected' && !comment.trim())}
              >
                {saving ? '⟳ SAVING…' : `CONFIRM ${RECORD_STATES[pendingAction.newState]?.label}`}
              </button>
              <button className="mc-btn mc-btn-g" onClick={() => { setPendingAction(null); setComment(''); }}>
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjustment modal */}
      {adjForm && (
        <div className="mc-modal-overlay" onClick={() => setAdjForm(null)}>
          <div className="mc-modal" onClick={e => e.stopPropagation()}>
            <div className="mc-modal-title">📝 Tracked Adjustment — Locked Record</div>
            <div className="mc-modal-sub">
              This record is locked. Any change creates an immutable adjustment entry in the audit trail and requires re-approval.
            </div>
            <div className="mc-adj-form">
              <div className="mc-adj-title">ADJUSTMENT DETAILS</div>
              <div style={{ fontSize: 11, color: 'var(--mut)', marginBottom: 10 }}>
                Original: <strong style={{ color: 'var(--txt)' }}>{adjForm.oldVal}</strong>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--mut)', marginBottom: 5 }}>NEW VALUE</div>
                <input
                  className="mc-inp"
                  type="text"
                  value={adjForm.newVal}
                  onChange={e => setAdjForm(f => ({ ...f, newVal: e.target.value }))}
                  placeholder="Corrected value"
                />
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--mut)', marginBottom: 5 }}>REASON FOR ADJUSTMENT (required)</div>
                <textarea
                  className="mc-ta"
                  rows={3}
                  placeholder="e.g. Data entry error — original value was in MWh, should be kWh. Corrected per invoice #INV-2025-0423."
                  value={adjForm.reason || ''}
                  onChange={e => setAdjForm(f => ({ ...f, reason: e.target.value }))}
                  maxLength={1000}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                className="mc-btn mc-btn-org"
                style={{ flex: 1, padding: '10px' }}
                onClick={handleAdjustment}
                disabled={saving || !adjForm.reason?.trim()}
              >
                {saving ? '⟳ SAVING…' : 'SUBMIT ADJUSTMENT →'}
              </button>
              <button className="mc-btn mc-btn-g" onClick={() => setAdjForm(null)}>CANCEL</button>
            </div>
          </div>
        </div>
      )}

      <div className="mc-wrap">
        <div className="mc-card">
          <div className="mc-ctit">APPROVAL WORKFLOW — FY {year}</div>

          {/* State machine diagram */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 10 }}>
              WORKFLOW STAGES
            </div>
            <div className="mc-state-bar">
              {STATE_ORDER.filter(s => s !== 'rejected').map((s, i, arr) => {
                const st = RECORD_STATES[s];
                return (
                  <div key={s} className="mc-state-step">
                    <div
                      className="mc-state-node"
                      style={{
                        color:            st.color,
                        background:       st.bg,
                        borderColor:      st.border,
                        cursor:           'pointer',
                        opacity:          filterState === s || filterState === 'all' ? 1 : 0.4,
                      }}
                      onClick={() => setFilterState(filterState === s ? 'all' : s)}
                      title={st.desc}
                    >
                      {st.icon} {st.label}
                      {counts[s] > 0 && (
                        <span style={{
                          marginLeft: 6, fontSize: 9, padding: '1px 6px',
                          borderRadius: 10, background: st.color, color: '#fff',
                        }}>
                          {counts[s]}
                        </span>
                      )}
                    </div>
                    {i < arr.length - 1 && <div className="mc-state-arrow"/>}
                  </div>
                );
              })}
              {/* Rejected pill separately */}
              <div style={{ marginLeft: 16 }}>
                <div
                  className="mc-state-node"
                  style={{
                    color:       RECORD_STATES.rejected.color,
                    background:  RECORD_STATES.rejected.bg,
                    borderColor: RECORD_STATES.rejected.border,
                    cursor:      'pointer',
                    opacity:     filterState === 'rejected' || filterState === 'all' ? 1 : 0.4,
                  }}
                  onClick={() => setFilterState(filterState === 'rejected' ? 'all' : 'rejected')}
                >
                  {RECORD_STATES.rejected.icon} REJECTED
                  {counts.rejected > 0 && (
                    <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 6px', borderRadius: 10, background: RECORD_STATES.rejected.color, color: '#fff' }}>
                      {counts.rejected}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="mc-stats">
            {STATE_ORDER.map(s => (
              <div key={s} className="mc-stat">
                <div className="mc-stat-val" style={{ color: RECORD_STATES[s].color, fontSize: 16 }}>
                  {counts[s] || 0}
                </div>
                <div className="mc-stat-lbl">{RECORD_STATES[s].label}</div>
              </div>
            ))}
          </div>

          {/* Your role badge */}
          <div style={{
            fontSize: 11, color: 'var(--mut)', marginBottom: 14,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            Your role:
            <span style={{
              fontSize: 10, padding: '3px 10px', borderRadius: 4,
              background: '#10b98114', color: '#10b981', border: '1px solid #10b98133',
              fontWeight: 700, letterSpacing: '.06em',
            }}>
              {userRole.toUpperCase()}
            </span>
            <span style={{ fontSize: 10, color: 'var(--mut)' }}>
              {userRole === 'maker'    ? '— can submit draft records for review' :
               userRole === 'reviewer' ? '— can review submitted records and approve/reject' :
               userRole === 'approver' ? '— can approve reviewed records and lock inventory' :
               '— full workflow control'}
            </span>
          </div>

          {/* Records table */}
          {filtered.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>
              {filterState === 'all'
                ? 'No records yet — log emissions using the Manual, AI Parser or CSV methods'
                : `No ${filterState} records`}
            </div>
          ) : (
            <>
              <div className="mc-hdr">
                <span>DATE</span>
                <span>ACTIVITY</span>
                <span>tCO₂e</span>
                <span>SCOPE</span>
                <span>STATE</span>
                <span>EF VERSION</span>
                <span>ACTIONS</span>
              </div>

              {filtered.map(r => {
                const state       = r.approval_state || 'draft';
                const st          = RECORD_STATES[state] || RECORD_STATES.draft;
                const transitions = getAvailableTransitions(state, userRole);
                const isLocked    = state === 'locked';
                const SC          = { 1: '#f97316', 2: '#3b82f6', 3: '#a855f7' };

                return (
                  <div key={r.id} className="mc-record-row" style={{ borderColor: st.border }}>
                    <span style={{ color: 'var(--mut)', fontSize: 10 }}>{r.date}</span>

                    <div>
                      <div style={{ fontSize: 11, color: 'var(--txt)' }}>{r.activity}</div>
                      {r.notes && <div style={{ fontSize: 10, color: 'var(--mut)' }}>{r.notes}</div>}
                    </div>

                    <span style={{ color: SC[r.scope], fontWeight: 700 }}>
                      {(r.co2e || 0).toFixed(3)}
                    </span>

                    <span style={{ fontSize: 10 }}>
                      <span style={{
                        padding: '2px 7px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                        background: `${SC[r.scope]}14`, color: SC[r.scope], border: `1px solid ${SC[r.scope]}33`,
                      }}>
                        S{r.scope}
                      </span>
                    </span>

                    <span>
                      <span className="mc-pill" style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                        {st.icon} {st.label}
                      </span>
                    </span>

                    <span style={{ fontSize: 9, color: 'var(--mut)' }}>
                      {r.ef_version_id || 'CURRENT'}
                    </span>

                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {transitions.map(newState => (
                        <button
                          key={newState}
                          className={`mc-btn ${
                            newState === 'rejected' ? 'mc-btn-red'  :
                            newState === 'locked'   ? 'mc-btn-org'  :
                            newState === 'approved' ? 'mc-btn-grn'  : 'mc-btn-blu'
                          }`}
                          onClick={() => setPendingAction({ record: r, newState })}
                        >
                          {RECORD_STATES[newState]?.icon} {RECORD_STATES[newState]?.label}
                        </button>
                      ))}

                      {/* Tracked adjustment for locked records */}
                      {isLocked && (userRole === 'admin' || userRole === 'approver') && (
                        <button
                          className="mc-btn mc-btn-org"
                          onClick={() => setAdjForm({
                            record: r,
                            field:  'quantity',
                            oldVal: r.quantity,
                            newVal: r.quantity,
                            reason: '',
                          })}
                        >
                          📝 ADJUST
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* Action needed banner */}
          {counts.submitted > 0 && (userRole === 'reviewer' || userRole === 'admin') && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 8,
              background: '#f59e0b08', border: '1px solid #f59e0b33',
              fontSize: 11, color: '#f59e0b',
            }}>
              ⚠ {counts.submitted} record{counts.submitted > 1 ? 's' : ''} waiting for your review
            </div>
          )}
          {counts.reviewed > 0 && (userRole === 'approver' || userRole === 'admin') && (
            <div style={{
              marginTop: 14, padding: '12px 16px', borderRadius: 8,
              background: '#3b82f608', border: '1px solid #3b82f633',
              fontSize: 11, color: '#3b82f6',
            }}>
              ℹ {counts.reviewed} record{counts.reviewed > 1 ? 's' : ''} ready for your approval
            </div>
          )}
        </div>
      </div>
    </>
  );
}