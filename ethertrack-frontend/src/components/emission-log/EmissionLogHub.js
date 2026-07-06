// src/components/emission-log/EmissionLogHub.jsx
// Main hub for all emission data ingestion methods
// 4 pathways: Manual Entry | AI Parser | CSV Import | ERP Sync

import React, { useState } from 'react';
import ManualEntry from './ManualEntry';
import AIParser    from './AIParser';
import CSVImport   from './CSVImport';
import ERPSync     from './ERPSync';

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
.elh{width:100%;}
.elh-method-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;}
.elh-method-card{border-radius:10px;padding:16px;border:1px solid var(--brd);background:var(--surf);cursor:pointer;transition:all .2s;text-align:center;position:relative;overflow:hidden;}
.elh-method-card:hover{transform:translateY(-2px);}
.elh-method-card.active{border-color:var(--mc);background:color-mix(in srgb,var(--mc) 8%,transparent);}
.elh-method-card.active::after{content:'';position:absolute;bottom:0;left:0;right:0;height:2px;background:var(--mc);}
.elh-method-icon{font-size:28px;margin-bottom:8px;}
.elh-method-label{font-size:11px;font-weight:700;letter-spacing:.08em;margin-bottom:4px;}
.elh-method-desc{font-size:9px;color:var(--mut);line-height:1.5;}
.elh-method-badge{position:absolute;top:8px;right:8px;font-size:8px;padding:2px 6px;border-radius:3px;letter-spacing:.06em;font-weight:700;}
.elh-badge-new{background:#10b98122;color:#10b981;border:1px solid #10b98133;}
.elh-badge-soon{background:#f59e0b14;color:#f59e0b;border:1px solid #f59e0b33;}
@media(max-width:700px){.elh-method-grid{grid-template-columns:1fr 1fr;}}
`;

const METHODS = [
  {
    id:    'manual',
    icon:  '✏️',
    label: 'MANUAL ENTRY',
    desc:  'Enter activity, quantity and date directly',
    color: '#10b981',
    badge: null,
  },
  {
    id:    'ai',
    icon:  '🤖',
    label: 'AI PARSER',
    desc:  'Upload electricity bill, fuel invoice or receipt',
    color: '#3b82f6',
    badge: 'NEW',
    badgeClass: 'elh-badge-new',
  },
  {
    id:    'csv',
    icon:  '📊',
    label: 'CSV / EXCEL',
    desc:  'Bulk import via spreadsheet template',
    color: '#a855f7',
    badge: null,
  },
  {
    id:    'erp',
    icon:  '🔗',
    label: 'ERP SYNC',
    desc:  'Connect Tally, Zoho, SAP, Oracle',
    color: '#f97316',
    badge: 'SOON',
    badgeClass: 'elh-badge-soon',
  },
];

// ── Props ─────────────────────────────────────────────────────────────────────
// EF            — emission factors map
// year          — selected reporting year
// onRecordAdded — called with a single record after manual/AI entry
// onBulkAdded   — async (result: { inserted, skipped, total }) called after
//                 a successful CSV bulk import; parent should await loadAll()
//                 here and fire its own toast
// onImportError — (msg: string) called on bulk import failure so parent
//                 can surface the error in its own toast system
// profile       — company profile object

export default function EmissionLogHub({
  EF,
  year,
  onRecordAdded,
  onBulkAdded,
  onImportError,   // ← now declared in props
  profile,
}) {
  const [method, setMethod] = useState('manual');

  return (
    <>
      <style>{CSS}</style>
      <div className="elh">

        {/* ── Method selector ── */}
        <div className="elh-method-grid">
          {METHODS.map(m => (
            <div
              key={m.id}
              className={`elh-method-card${method === m.id ? ' active' : ''}`}
              style={{ '--mc': m.color }}
              onClick={() => setMethod(m.id)}
            >
              {m.badge && (
                <span className={`elh-method-badge ${m.badgeClass}`}>{m.badge}</span>
              )}
              <div className="elh-method-icon">{m.icon}</div>
              <div
                className="elh-method-label"
                style={{ color: method === m.id ? m.color : 'var(--txt)' }}
              >
                {m.label}
              </div>
              <div className="elh-method-desc">{m.desc}</div>
            </div>
          ))}
        </div>

        {/* ── Active method panel ── */}
        {method === 'manual' && (
          <ManualEntry
            EF={EF}
            year={year}
            onRecordAdded={onRecordAdded}
            profile={profile}
          />
        )}

        {method === 'ai' && (
          <AIParser
            EF={EF}
            year={year}
            onRecordAdded={onRecordAdded}
            profile={profile}
          />
        )}

        {method === 'csv' && (
          <CSVImport
            EF={EF}
            year={year}
            onBulkAdded={onBulkAdded}
            onImportError={onImportError}
          />
        )}

        {method === 'erp' && (
          <ERPSync profile={profile} />
        )}

      </div>
    </>
  );
}