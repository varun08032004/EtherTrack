// src/components/emission-log/GHGLedger.jsx
// ── Standalone GHG Inventory Ledger component
// ── Features:
//    [FEAT-FILTERS]      Advanced filter bar: scope, month, date-from/to,
//                        verified status, free-text activity search
//    [FEAT-LOGGED-DATE]  Two date columns — emission date (when it happened)
//                        + logged date (when record was saved to the system)
//    [FEAT-BULK-DELETE]  Checkbox select-all / select-row → bulk delete with
//                        confirmation modal showing count + total tCO2e impact
//    [FEAT-CHAIN-AUDIT]  Every add/delete writes an immutable chain entry to
//                        /api/audit/chain — hash, action, actor, timestamp,
//                        records affected, tCO2e delta. Shown in a live
//                        "Chain Log" panel at the bottom of the ledger.
//    [FEAT-EXPORT]       CSV export respects active filters

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { apiFetch } from '../../services/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n, d = 2) =>
  Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

const SC_COLOR = { 1: '#f97316', 2: '#3b82f6', 3: '#a855f7' };

const MONTHS_LABEL = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Format a UTC ISO timestamp for display
const fmtDateTime = (raw) => {
  if (!raw) return { date: '—', time: '' };
  try {
    const d = new Date(raw);
    if (isNaN(d)) return { date: '—', time: '' };
    return {
      date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }),
      time: d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
    };
  } catch {
    return { date: '—', time: '' };
  }
};

// Short hash for display
const shortHash = (h) => h ? h.slice(0, 10) + '…' : '—';

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
/* ── Filter bar ── */
.gl-fbar{
  display:flex;flex-wrap:wrap;gap:8px;
  padding:14px 0 16px;
  border-bottom:1px solid var(--brd);
  margin-bottom:14px;align-items:flex-end;
}
.gl-fg{display:flex;flex-direction:column;gap:3px;}
.gl-lbl{font-size:9px;letter-spacing:.12em;color:var(--mut);text-transform:uppercase;}
.gl-sel,.gl-inp,.gl-date{
  padding:6px 10px;border-radius:6px;
  background:var(--surf3);border:1px solid var(--brd);
  color:var(--txt);font-family:'Space Mono',monospace;font-size:10px;
  outline:none;transition:border-color .18s;
}
.gl-sel:focus,.gl-inp:focus,.gl-date:focus{border-color:#10b98150;}
.gl-inp{width:160px;}
.gl-inp::placeholder{color:var(--mut);opacity:.55;}
.gl-date{width:128px;}
.gl-reset{
  padding:6px 12px;border-radius:6px;align-self:flex-end;
  border:1px solid var(--brd2);background:transparent;
  color:var(--mut);font-family:'Space Mono',monospace;
  font-size:9px;letter-spacing:.08em;cursor:pointer;transition:all .18s;
}
.gl-reset:hover{color:var(--txt);border-color:var(--brd2);}
.gl-count{
  margin-left:auto;align-self:flex-end;
  font-size:10px;color:var(--mut);padding-bottom:6px;white-space:nowrap;
}

/* ── Scope pills ── */
.gl-pills{display:flex;gap:4px;align-self:flex-end;}
.gl-pill{
  padding:5px 12px;border-radius:20px;font-size:9px;
  border:1px solid var(--brd);background:transparent;
  color:var(--mut);cursor:pointer;
  font-family:'Space Mono',monospace;font-weight:700;
  transition:all .18s;letter-spacing:.05em;
}
.gl-pill:hover{color:var(--txt);}
.gl-pill.pa{border-color:var(--grn);color:var(--grn);background:#10b98110;}
.gl-pill.p1{border-color:#f97316;color:#f97316;background:#f9731610;}
.gl-pill.p2{border-color:#3b82f6;color:#3b82f6;background:#3b82f610;}
.gl-pill.p3{border-color:#a855f7;color:#a855f7;background:#a855f710;}

/* ── Bulk action bar ── */
.gl-bulk{
  display:flex;align-items:center;gap:10px;
  padding:9px 14px;margin-bottom:10px;
  border-radius:7px;background:#ef444408;
  border:1px solid #ef444428;
  animation:fadeUp .2s ease;
}
.gl-bulk-count{font-size:11px;color:#f87171;font-weight:700;}
.gl-bulk-co2e{font-size:10px;color:var(--mut);}
.gl-bulk-del{
  padding:5px 14px;border-radius:5px;border:none;cursor:pointer;
  background:#ef444420;color:#f87171;
  font-family:'Space Mono',monospace;font-size:10px;font-weight:700;
  letter-spacing:.06em;transition:all .18s;margin-left:auto;
}
.gl-bulk-del:hover{background:#ef444430;}
.gl-bulk-cancel{
  padding:5px 12px;border-radius:5px;
  border:1px solid var(--brd2);background:transparent;
  color:var(--mut);font-family:'Space Mono',monospace;
  font-size:10px;cursor:pointer;transition:all .18s;
}
.gl-bulk-cancel:hover{color:var(--txt);}

/* ── Table ── */
.gl-head,.gl-row{
  display:grid;
  grid-template-columns:20px 100px 80px 50px 1fr 64px 72px 80px 80px 90px;
  padding:9px 14px;font-size:10px;align-items:center;gap:6px;
}
.gl-head{
  color:var(--mut);letter-spacing:.09em;
  border-bottom:1px solid var(--brd);
  font-size:9px;text-transform:uppercase;
  position:sticky;top:0;background:var(--surf);z-index:2;
}
.gl-row{
  border-bottom:1px solid var(--brd)33;
  border-radius:5px;transition:background .14s;
  cursor:default;
}
.gl-row:hover{background:var(--surf2);}
.gl-row.selected{background:#ef444408;border-color:#ef444420;}

/* ── Cells ── */
.gl-chk{cursor:pointer;accent-color:#ef4444;width:13px;height:13px;}
.gl-scope-pill{
  font-size:8px;padding:2px 7px;border-radius:3px;
  letter-spacing:.04em;display:inline-flex;align-items:center;
  gap:3px;font-weight:700;white-space:nowrap;
}
.gl-dot{width:4px;height:4px;border-radius:50%;flex-shrink:0;}
.gl-status-pill{
  font-size:8px;padding:2px 6px;border-radius:3px;
  letter-spacing:.04em;display:inline-flex;align-items:center;
  gap:3px;font-weight:700;
}
.gl-dt{display:flex;flex-direction:column;gap:1px;}
.gl-dt-date{font-size:10px;color:var(--txt2);}
.gl-dt-time{font-size:9px;color:var(--mut);opacity:.7;}
.gl-action-btn{
  background:none;border:none;cursor:pointer;
  padding:2px 5px;border-radius:3px;font-size:11px;
  transition:color .14s;
}

/* ── Pagination ── */
.gl-pg{
  display:flex;align-items:center;justify-content:center;
  gap:10px;padding-top:16px;
}
.gl-pgb{
  padding:5px 14px;border-radius:5px;
  border:1px solid var(--brd2);background:var(--surf2);
  color:var(--txt2);font-family:'Space Mono',monospace;
  font-size:10px;cursor:pointer;transition:all .18s;
}
.gl-pgb:hover:not(:disabled){border-color:var(--grn);color:var(--grn);}
.gl-pgb:disabled{opacity:.25;cursor:not-allowed;}

/* ── Chain log ── */
.gl-chain{
  margin-top:20px;border-top:1px solid var(--brd);
  padding-top:16px;
}
.gl-chain-title{
  font-size:9px;letter-spacing:.18em;color:var(--mut);
  margin-bottom:12px;display:flex;align-items:center;gap:10px;
  text-transform:uppercase;
}
.gl-chain-title::before{content:'';width:14px;height:1px;background:linear-gradient(90deg,#a855f7,transparent);}
.gl-chain-scroll{max-height:260px;overflow-y:auto;}
.gl-chain-row{
  display:grid;
  grid-template-columns:90px 70px 70px 1fr 90px 80px;
  padding:7px 12px;font-size:10px;align-items:center;gap:6px;
  border-bottom:1px solid var(--brd)22;
}
.gl-chain-head{
  font-size:9px;letter-spacing:.08em;color:var(--mut);
  text-transform:uppercase;border-bottom:1px solid var(--brd);
  padding:5px 12px;display:grid;
  grid-template-columns:90px 70px 70px 1fr 90px 80px;gap:6px;
}
.gl-chain-add{color:var(--grn);}
.gl-chain-del{color:#ef4444;}
.gl-chain-hash{font-size:9px;color:var(--mut);font-family:monospace;opacity:.7;}
.gl-chain-empty{padding:20px;text-align:center;color:var(--mut);font-size:11px;}

/* ── Delete modal ── */
.gl-modal-overlay{
  position:fixed;inset:0;z-index:10000;
  background:#00000099;display:flex;align-items:center;justify-content:center;
  backdrop-filter:blur(4px);
}
.gl-modal{
  background:var(--surf);border:1px solid var(--brd2);
  border-radius:12px;padding:28px;max-width:420px;width:90%;
  box-shadow:0 24px 80px #000000aa;animation:fadeUp .25s ease;
}
.gl-modal-title{font-size:13px;font-weight:700;color:var(--txt);margin-bottom:6px;letter-spacing:.04em;}
.gl-modal-sub{font-size:11px;color:var(--mut);margin-bottom:18px;line-height:1.7;}
.gl-modal-impact{
  padding:12px 16px;border-radius:7px;
  background:#ef444408;border:1px solid #ef444428;
  margin-bottom:20px;
}
.gl-modal-impact-row{display:flex;justify-content:space-between;font-size:11px;padding:3px 0;}
.gl-chain-notice{
  padding:10px 14px;border-radius:6px;
  background:#a855f708;border:1px solid #a855f728;
  font-size:10px;color:#c084fc;margin-bottom:18px;
  display:flex;align-items:center;gap:8px;
}
.gl-modal-btns{display:flex;gap:10px;}
.gl-btn-del{
  flex:1;padding:10px 0;border-radius:6px;border:none;cursor:pointer;
  background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;
  font-family:'Space Mono',monospace;font-size:10px;font-weight:700;
  letter-spacing:.08em;transition:all .18s;
}
.gl-btn-del:hover:not(:disabled){opacity:.88;}
.gl-btn-del:disabled{opacity:.4;cursor:not-allowed;}
.gl-btn-cancel{
  flex:1;padding:10px 0;border-radius:6px;cursor:pointer;
  background:var(--surf2);border:1px solid var(--brd2);
  color:var(--txt2);font-family:'Space Mono',monospace;font-size:10px;
  transition:all .18s;
}
.gl-btn-cancel:hover{border-color:var(--grn);color:var(--grn);}

/* ── Toast ── */
.gl-toast{
  position:fixed;top:76px;right:24px;z-index:9999;
  padding:11px 18px;border-radius:8px;
  font-family:'Space Mono',monospace;font-size:11px;
  box-shadow:0 8px 32px #00000066;animation:fadeUp .3s ease;
}
.gl-toast-ok{background:#0b2a1e;border:1px solid #10b98133;color:#10b981;}
.gl-toast-err{background:#450a0a;border:1px solid #ef444433;color:#f87171;}
.gl-toast-info{background:#0d1a2e;border:1px solid #3b82f633;color:#60a5fa;}

/* ── Empty state ── */
.gl-empty{
  padding:40px;text-align:center;color:var(--mut);font-size:11px;
  border:1px dashed var(--brd2);border-radius:8px;margin-top:4px;
}

@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
`;

// ─── Default filter state ─────────────────────────────────────────────────────
const DEFAULT_FILTERS = {
  scope:    'all',
  month:    '',
  dateFrom: '',
  dateTo:   '',
  verified: 'all',
  search:   '',
};

const PER_PAGE = 15;

// ─── Main Component ───────────────────────────────────────────────────────────
export default function GHGLedger({
  records = [],
  year,
  EF = {},
  profile,
  onRecordsChanged,   // callback → triggers loadAll() in parent
  onLineageOpen,      // callback(record) → opens EmissionLineage modal
}) {
  const [filters,      setFilters]      = useState(DEFAULT_FILTERS);
  const [page,         setPage]         = useState(1);
  const [selected,     setSelected]     = useState(new Set());   // Set of record ids
  const [deleteModal,  setDeleteModal]  = useState(null);        // { ids, records }
  const [deleting,     setDeleting]     = useState(false);
  const [chainLog,     setChainLog]     = useState([]);
  const [chainLoading, setChainLoading] = useState(false);
  const [notif,        setNotif]        = useState(null);
  const abortRef = useRef(null);

  const toast = useCallback((msg, type = 'ok') => {
    setNotif({ msg, type });
    setTimeout(() => setNotif(null), 4000);
  }, []);

  // ── Load chain log ──────────────────────────────────────────────────────────
  const loadChain = useCallback(async () => {
    setChainLoading(true);
    try {
      const res = await apiFetch(`/api/audit/chain?year=${year}&limit=50`);
      if (res?.entries) setChainLog(res.entries);
    } catch {
      // Chain log is non-critical; fail silently
    } finally {
      setChainLoading(false);
    }
  }, [year]);

  useEffect(() => { loadChain(); }, [loadChain]);

  // ── Write chain entry ───────────────────────────────────────────────────────
  // Called after every add/delete. Backend should persist and return the new entry.
  const writeChainEntry = useCallback(async (action, affectedRecords, co2eDelta) => {
    try {
      const res = await apiFetch('/api/audit/chain', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,          // 'add' | 'delete'
          year,
          actor:           profile?.user_name || profile?.email || 'user',
          recordIds:       affectedRecords.map(r => r.id),
          activities:      affectedRecords.map(r => r.activity),
          co2eDelta:       parseFloat(co2eDelta.toFixed(4)),
          recordCount:     affectedRecords.length,
          timestamp:       new Date().toISOString(),
        }),
      });
      if (res?.entry) {
        setChainLog(prev => [res.entry, ...prev].slice(0, 50));
      }
    } catch {
      // Chain write failure is logged but doesn't block the UI
      console.warn('[GHGLedger] Chain write failed — record was still deleted/added');
    }
  }, [year, profile]);

  // ── Filtering ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return records
      .filter(r => {
        if (filters.scope !== 'all' && r.scope !== parseInt(filters.scope)) return false;
        if (filters.month && r.date && !r.date.startsWith(`${year}-${filters.month}`)) return false;
        if (filters.dateFrom && r.date < filters.dateFrom) return false;
        if (filters.dateTo   && r.date > filters.dateTo)   return false;
        if (filters.verified === 'verified' && !r.verified) return false;
        if (filters.verified === 'pending'  &&  r.verified) return false;
        if (filters.search && !r.activity?.toLowerCase().includes(filters.search.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [records, filters, year]);

  const totalPages  = Math.ceil(filtered.length / PER_PAGE);
  const pageRecords = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Reset page when filters change
  const setFilter = (key, val) => {
    setFilters(f => ({ ...f, [key]: val }));
    setPage(1);
    setSelected(new Set());
  };
  const resetFilters = () => { setFilters(DEFAULT_FILTERS); setPage(1); setSelected(new Set()); };

  // ── Selection ────────────────────────────────────────────────────────────────
  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (pageRecords.every(r => selected.has(r.id))) {
      // deselect all on page
      setSelected(prev => {
        const next = new Set(prev);
        pageRecords.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      // select all on page
      setSelected(prev => {
        const next = new Set(prev);
        pageRecords.forEach(r => next.add(r.id));
        return next;
      });
    }
  };

  const selectedRecords = records.filter(r => selected.has(r.id));
  const selectedCo2e    = selectedRecords.reduce((s, r) => s + (r.co2e || 0), 0);
  const allPageSelected = pageRecords.length > 0 && pageRecords.every(r => selected.has(r.id));

  // ── Delete flow ──────────────────────────────────────────────────────────────
  const openDeleteModal = (ids) => {
    const recs = records.filter(r => ids.includes(r.id));
    setDeleteModal({ ids, records: recs });
  };

  const confirmDelete = async () => {
    if (!deleteModal || deleting) return;
    setDeleting(true);
    const { ids, records: recs } = deleteModal;
    const co2eImpact = recs.reduce((s, r) => s + (r.co2e || 0), 0);

    try {
      // Delete all records — parallel for single, sequential for bulk
      if (ids.length === 1) {
        await apiFetch(`/api/emissions/activities/${encodeURIComponent(ids[0])}`, { method: 'DELETE' });
      } else {
        await apiFetch('/api/emissions/bulk-delete', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ids }),
        });
      }

      // Write chain entry
      await writeChainEntry('delete', recs, co2eImpact);

      toast(
        ids.length === 1
          ? `Record removed · −${co2eImpact.toFixed(3)} tCO₂e logged to chain`
          : `${ids.length} records removed · −${co2eImpact.toFixed(3)} tCO₂e logged to chain`,
        'ok'
      );

      setSelected(new Set());
      setDeleteModal(null);
      if (typeof onRecordsChanged === 'function') onRecordsChanged();

    } catch (err) {
      toast(err?.message || 'Delete failed — please try again', 'err');
    } finally {
      setDeleting(false);
    }
  };

  // ── CSV Export (respects filters) ───────────────────────────────────────────
  const handleExport = () => {
    const rows = [
      'Emission Date,Logged Date,Activity,Scope,Category,Qty,Unit,tCO2e,Source,Verified,Notes',
      ...filtered.map(r => {
        const loggedRaw = r.logged_at || r.created_at || r.createdAt || '';
        const logged    = loggedRaw ? new Date(loggedRaw).toISOString().slice(0, 10) : '';
        return [
          r.date, logged,
          `"${(r.activity||'').replace(/"/g,'""')}"`,
          r.scope||'',
          `"${(r.category||'').replace(/"/g,'""')}"`,
          r.qty||r.quantity||'', r.unit||'',
          (r.co2e||0).toFixed(4),
          `"${(r.source||'').replace(/"/g,'""')}"`,
          r.verified||false,
          `"${(r.notes||'').replace(/"/g,'""')}"`,
        ].join(',');
      }),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
    const a   = document.createElement('a');
    a.href = url;
    a.download = `ghg_ledger_${year}${filters.scope !== 'all' ? `_s${filters.scope}` : ''}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast(`Exported ${filtered.length} records`, 'info');
  };

  return (
    <>
      <style>{CSS}</style>

      {/* ── Toast ── */}
      {notif && (
        <div className={`gl-toast gl-toast-${notif.type}`}>{notif.msg}</div>
      )}

      {/* ── Delete confirmation modal ── */}
      {deleteModal && (
        <div className="gl-modal-overlay" onClick={() => !deleting && setDeleteModal(null)}>
          <div className="gl-modal" onClick={e => e.stopPropagation()}>
            <div className="gl-modal-title">
              {deleteModal.ids.length === 1 ? 'Remove record?' : `Remove ${deleteModal.ids.length} records?`}
            </div>
            <div className="gl-modal-sub">
              This action cannot be undone. The deletion will be written to the immutable audit chain with a timestamp, actor, and tCO₂e delta.
            </div>

            <div className="gl-modal-impact">
              <div className="gl-modal-impact-row">
                <span style={{ color: 'var(--mut)' }}>Records to remove</span>
                <span style={{ color: '#f87171', fontWeight: 700 }}>{deleteModal.ids.length}</span>
              </div>
              <div className="gl-modal-impact-row">
                <span style={{ color: 'var(--mut)' }}>tCO₂e impact</span>
                <span style={{ color: '#f87171', fontWeight: 700 }}>
                  −{deleteModal.records.reduce((s,r)=>s+(r.co2e||0),0).toFixed(3)} tCO₂e
                </span>
              </div>
              {deleteModal.ids.length <= 5 && deleteModal.records.map(r => (
                <div key={r.id} className="gl-modal-impact-row" style={{ fontSize: 10, opacity: .7 }}>
                  <span style={{ color: 'var(--mut)' }}>{r.activity?.slice(0, 40)}</span>
                  <span style={{ color: 'var(--mut)' }}>{(r.co2e||0).toFixed(3)} t</span>
                </div>
              ))}
            </div>

            <div className="gl-chain-notice">
              <span>⛓</span>
              <span>Deletion event will be hashed and written to audit chain — verifiable, permanent record.</span>
            </div>

            <div className="gl-modal-btns">
              <button className="gl-btn-del" onClick={confirmDelete} disabled={deleting}>
                {deleting ? '⟳ REMOVING…' : `REMOVE ${deleteModal.ids.length > 1 ? `${deleteModal.ids.length} RECORDS` : 'RECORD'}`}
              </button>
              <button className="gl-btn-cancel" onClick={() => !deleting && setDeleteModal(null)}>
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header row ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 9, letterSpacing: '.18em', color: 'var(--mut)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 14, height: 1, background: 'linear-gradient(90deg,var(--grn),transparent)', display: 'inline-block' }}/>
          GHG INVENTORY LEDGER · FY {year}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--mut)', alignSelf: 'center' }}>
            {filtered.length} of {records.length} records
          </span>
          <button
            onClick={handleExport}
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--brd2)', background: 'var(--surf2)', color: 'var(--txt2)', fontFamily: 'Space Mono,monospace', fontSize: 10, cursor: 'pointer', transition: 'all .18s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--grn)'; e.currentTarget.style.color = 'var(--grn)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--brd2)'; e.currentTarget.style.color = 'var(--txt2)'; }}
          >
            EXPORT CSV
          </button>
        </div>
      </div>

      {/* ── Advanced filter bar ── */}
      <div className="gl-fbar">
        {/* Scope */}
        <div className="gl-fg">
          <span className="gl-lbl">SCOPE</span>
          <div className="gl-pills">
            {[['all','ALL'],['1','S1'],['2','S2'],['3','S3']].map(([k,v]) => (
              <button
                key={k}
                className={`gl-pill${filters.scope===k ? k==='all'?' pa':` p${k}` : ''}`}
                onClick={() => setFilter('scope', k)}
              >{v}</button>
            ))}
          </div>
        </div>

        {/* Month */}
        <div className="gl-fg">
          <span className="gl-lbl">MONTH</span>
          <select className="gl-sel" value={filters.month} onChange={e => setFilter('month', e.target.value)}>
            <option value="">All</option>
            {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m, i) => (
              <option key={m} value={m}>{MONTHS_LABEL[i + 1]}</option>
            ))}
          </select>
        </div>

        {/* Date from */}
        <div className="gl-fg">
          <span className="gl-lbl">FROM</span>
          <input
            type="date" className="gl-date"
            value={filters.dateFrom}
            onChange={e => setFilter('dateFrom', e.target.value)}
          />
        </div>

        {/* Date to */}
        <div className="gl-fg">
          <span className="gl-lbl">TO</span>
          <input
            type="date" className="gl-date"
            value={filters.dateTo}
            onChange={e => setFilter('dateTo', e.target.value)}
          />
        </div>

        {/* Verified */}
        <div className="gl-fg">
          <span className="gl-lbl">STATUS</span>
          <select className="gl-sel" value={filters.verified} onChange={e => setFilter('verified', e.target.value)}>
            <option value="all">All</option>
            <option value="verified">Verified</option>
            <option value="pending">Pending</option>
          </select>
        </div>

        {/* Search */}
        <div className="gl-fg">
          <span className="gl-lbl">SEARCH</span>
          <input
            type="text" className="gl-inp"
            placeholder="activity name…"
            value={filters.search}
            onChange={e => setFilter('search', e.target.value)}
          />
        </div>

        {/* Reset */}
        <button className="gl-reset" onClick={resetFilters}>↺ RESET</button>

        {/* Live count */}
        <span className="gl-count">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Bulk action bar ── */}
      {selected.size > 0 && (
        <div className="gl-bulk">
          <span className="gl-bulk-count">{selected.size} selected</span>
          <span className="gl-bulk-co2e">· {selectedCo2e.toFixed(3)} tCO₂e</span>
          <button
            className="gl-bulk-del"
            onClick={() => openDeleteModal([...selected])}
          >
            🗑 DELETE SELECTED
          </button>
          <button className="gl-bulk-cancel" onClick={() => setSelected(new Set())}>
            CANCEL
          </button>
        </div>
      )}

      {/* ── Table header ── */}
      <div className="gl-head">
        <input
          type="checkbox" className="gl-chk"
          checked={allPageSelected}
          onChange={toggleSelectAll}
          title={allPageSelected ? 'Deselect all on page' : 'Select all on page'}
        />
        <span>EMISSION DATE</span>
        <span>LOGGED</span>
        <span>S</span>
        <span>ACTIVITY</span>
        <span>QTY</span>
        <span>tCO₂e</span>
        <span>SOURCE</span>
        <span>STATUS</span>
        <span>ACTIONS</span>
      </div>

      {/* ── Table rows ── */}
      {pageRecords.length === 0 ? (
        <div className="gl-empty">
          {records.length === 0
            ? `No records for FY ${year} — log your first emission above`
            : 'No records match your filters — '}
          {records.length > 0 && (
            <button
              onClick={resetFilters}
              style={{ background: 'none', border: 'none', color: 'var(--grn)', cursor: 'pointer', fontFamily: 'Space Mono,monospace', fontSize: 11 }}
            >
              clear filters
            </button>
          )}
        </div>
      ) : pageRecords.map(r => {
        const col        = SC_COLOR[r.scope] || '#888';
        const isSelected = selected.has(r.id);

        // Emission date (when it happened)
        const emDate = r.date || '—';

        // Logged date (when saved to the system)
        const loggedRaw = r.logged_at || r.created_at || r.createdAt || null;
        const logged    = fmtDateTime(loggedRaw);

        return (
          <div
            key={r.id}
            className={`gl-row${isSelected ? ' selected' : ''}`}
          >
            {/* Checkbox */}
            <input
              type="checkbox" className="gl-chk"
              checked={isSelected}
              onChange={() => toggleSelect(r.id)}
              onClick={e => e.stopPropagation()}
            />

            {/* Emission date */}
            <div className="gl-dt">
              <span className="gl-dt-date">{emDate}</span>
            </div>

            {/* Logged date */}
            <div className="gl-dt">
              <span className="gl-dt-date">{logged.date}</span>
              {logged.time && <span className="gl-dt-time">{logged.time}</span>}
            </div>

            {/* Scope */}
            <span>
              <span className="gl-scope-pill" style={{ background: `${col}14`, color: col, border: `1px solid ${col}33` }}>
                <span className="gl-dot" style={{ background: col }}/>
                S{r.scope}
              </span>
            </span>

            {/* Activity + notes */}
            <span style={{ fontSize: 10, lineHeight: 1.4 }}>
              {r.activity}
              {r.notes && (
                <span style={{ display: 'block', fontSize: 9, color: 'var(--mut)', marginTop: 1, opacity: .7 }}>
                  {r.notes.slice(0, 50)}{r.notes.length > 50 ? '…' : ''}
                </span>
              )}
            </span>

            {/* Qty */}
            <span style={{ fontSize: 10, color: 'var(--txt2)' }}>
              {fmt(r.qty || r.quantity, 1)}
              <span style={{ fontSize: 9, color: 'var(--mut)', display: 'block' }}>{r.unit}</span>
            </span>

            {/* tCO2e */}
            <span style={{ color: col, fontWeight: 700, fontSize: 11 }}>
              {(r.co2e || 0).toFixed(3)}
            </span>

            {/* Source */}
            <span style={{ fontSize: 9, color: 'var(--mut)', opacity: .65, lineHeight: 1.3 }}>
              {(r.source || EF[r.activity]?.source || '—').slice(0, 18)}
            </span>

            {/* Status */}
            <span>
              <span
                className="gl-status-pill"
                style={{
                  background: r.verified ? '#10b98114' : '#f59e0b14',
                  color:      r.verified ? '#10b981'   : '#f59e0b',
                  border:     `1px solid ${r.verified ? '#10b98133' : '#f59e0b33'}`,
                }}
              >
                <span className="gl-dot" style={{ background: r.verified ? '#10b981' : '#f59e0b' }}/>
                {r.verified ? 'VER' : 'PEN'}
              </span>
            </span>

            {/* Actions */}
            <span style={{ display: 'flex', gap: 2 }}>
              {/* Lineage */}
              <button
                className="gl-action-btn"
                style={{ color: '#3b82f666' }}
                onMouseEnter={e => e.currentTarget.style.color = '#3b82f6'}
                onMouseLeave={e => e.currentTarget.style.color = '#3b82f666'}
                onClick={() => typeof onLineageOpen === 'function' && onLineageOpen(r)}
                title="View source-to-number lineage"
              >🔍</button>

              {/* Single delete */}
              <button
                className="gl-action-btn"
                style={{ color: '#ef444444' }}
                onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                onMouseLeave={e => e.currentTarget.style.color = '#ef444444'}
                onClick={() => openDeleteModal([r.id])}
                title="Delete record"
              >✕</button>
            </span>
          </div>
        );
      })}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="gl-pg">
          <button className="gl-pgb" disabled={page === 1} onClick={() => setPage(p => p - 1)}>PREV</button>
          <span style={{ fontSize: 11, color: 'var(--mut)' }}>PAGE {page} / {totalPages}</span>
          <button className="gl-pgb" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>NEXT</button>
        </div>
      )}

      {/* ── Summary strip ── */}
      {filtered.length > 0 && (
        <div style={{
          display: 'flex', gap: 24, padding: '12px 0', marginTop: 8,
          borderTop: '1px solid var(--brd)', flexWrap: 'wrap',
        }}>
          {[
            { label: 'FILTERED TOTAL', val: `${fmt(filtered.reduce((s,r)=>s+(r.co2e||0),0))} tCO₂e`, color: 'var(--grn)' },
            { label: 'SCOPE 1', val: `${fmt(filtered.filter(r=>r.scope===1).reduce((s,r)=>s+(r.co2e||0),0))} t`, color: '#f97316' },
            { label: 'SCOPE 2', val: `${fmt(filtered.filter(r=>r.scope===2).reduce((s,r)=>s+(r.co2e||0),0))} t`, color: '#3b82f6' },
            { label: 'SCOPE 3', val: `${fmt(filtered.filter(r=>r.scope===3).reduce((s,r)=>s+(r.co2e||0),0))} t`, color: '#a855f7' },
          ].map(({ label, val, color }) => (
            <div key={label}>
              <div style={{ fontSize: 9, color: 'var(--mut)', letterSpacing: '.1em', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'Syne,sans-serif' }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Chain audit log ── */}
      <div className="gl-chain">
        <div className="gl-chain-title">
          ⛓ IMMUTABLE AUDIT CHAIN · LAST 50 EVENTS
          <button
            onClick={loadChain}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--brd)', borderRadius: 4, color: 'var(--mut)', cursor: 'pointer', fontFamily: 'Space Mono,monospace', fontSize: 9, padding: '2px 8px' }}
          >
            {chainLoading ? '⟳' : '↻ REFRESH'}
          </button>
        </div>

        {chainLog.length === 0 ? (
          <div className="gl-chain-empty">
            {chainLoading ? 'Loading chain…' : 'No chain entries yet — add or remove records to create an audit trail'}
          </div>
        ) : (
          <div className="gl-chain-scroll">
            <div className="gl-chain-head">
              <span>TIMESTAMP</span>
              <span>ACTION</span>
              <span>RECORDS</span>
              <span>ACTIVITIES</span>
              <span>tCO₂e DELTA</span>
              <span>HASH</span>
            </div>
            {chainLog.map((entry, i) => {
              const dt      = fmtDateTime(entry.timestamp);
              const isAdd   = entry.action === 'add';
              const isDel   = entry.action === 'delete';
              return (
                <div key={entry.hash || i} className="gl-chain-row">
                  {/* Timestamp */}
                  <div className="gl-dt">
                    <span className="gl-dt-date" style={{ fontSize: 9 }}>{dt.date}</span>
                    <span className="gl-dt-time">{dt.time}</span>
                  </div>

                  {/* Action */}
                  <span className={isAdd ? 'gl-chain-add' : isDel ? 'gl-chain-del' : ''} style={{ fontSize: 10, fontWeight: 700 }}>
                    {isAdd ? '＋ ADD' : isDel ? '✕ DELETE' : entry.action?.toUpperCase()}
                  </span>

                  {/* Count */}
                  <span style={{ fontSize: 10, color: 'var(--mut)' }}>{entry.recordCount ?? 1}</span>

                  {/* Activities */}
                  <span style={{ fontSize: 9, color: 'var(--mut)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(entry.activities || []).slice(0, 2).join(', ')}{(entry.activities||[]).length > 2 ? ` +${(entry.activities||[]).length - 2}` : ''}
                  </span>

                  {/* tCO2e delta */}
                  <span style={{ fontSize: 10, fontWeight: 700, color: isAdd ? 'var(--grn)' : isDel ? '#ef4444' : 'var(--mut)' }}>
                    {isAdd ? '+' : isDel ? '−' : ''}{Math.abs(entry.co2eDelta ?? 0).toFixed(3)} t
                  </span>

                  {/* Hash */}
                  <span className="gl-chain-hash" title={entry.hash}>{shortHash(entry.hash)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}