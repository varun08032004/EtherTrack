// VerifyInvoice.jsx — EtherTrack public invoice/bill verification page
// Route: /verify/:invoiceNumber  →  fetches GET /api/invoices/verify/:invoiceNumber
//
// WIRING NEEDED (I don't have your React Router config, so add this yourself):
//   In your routes file (wherever <Route path="/portfolio" .../> etc. live):
//     import VerifyInvoice from './pages/VerifyInvoice';
//     <Route path="/verify/:invoiceNumber" element={<VerifyInvoice />} />
//
// This page is intentionally public — no AuthContext, no login required —
// since it's the destination of a QR code anyone (a customer, an auditor,
// a bank) might scan without being logged into EtherTrack.
'use strict';

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const API_BASE = process.env.REACT_APP_API_BASE || ''; // same-origin by default

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtINR(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function VerifyInvoice() {
  const { invoiceNumber } = useParams();
  const [data, setData]     = useState(null);
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/invoices/verify/${encodeURIComponent(invoiceNumber)}`)
      .then(async res => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.found) {
          throw new Error(json?.error || 'Invoice not found');
        }
        return json;
      })
      .then(json => { if (!cancelled) setData(json); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [invoiceNumber]);

  const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');
.vi-wrap{min-height:100vh;background:#040706;font-family:'DM Mono',monospace;
  display:flex;align-items:center;justify-content:center;padding:24px;}
.vi-card{width:100%;max-width:480px;background:#070c09;border:1px solid #0d1f11;
  border-radius:16px;overflow:hidden;}
.vi-hdr{background:#040706;padding:24px 28px;border-bottom:1px solid #0d1f11;}
.vi-logo{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#22c55e;}
.vi-sub{font-size:10px;color:#86efac66;letter-spacing:.1em;margin-top:4px;}
.vi-body{padding:28px;}
.vi-status{display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap;}
.vi-badge{font-size:9px;padding:5px 12px;border-radius:20px;letter-spacing:.1em;font-weight:700;}
.vi-row{display:flex;justify-content:space-between;padding:10px 0;
  border-bottom:1px solid #0d1f1122;font-size:12px;}
.vi-label{color:#86efac66;}
.vi-val{color:#f0fdf4;font-weight:600;text-align:right;}
.vi-hash{font-size:10px;color:#60a5fa88;word-break:break-all;margin-top:4px;}
.vi-loading,.vi-error{text-align:center;padding:40px;color:#86efac66;font-size:12px;}
.vi-footer{padding:16px 28px;background:#050809;font-size:9px;color:#86efac33;
  text-align:center;letter-spacing:.05em;}
`;

  return (
    <div className="vi-wrap">
      <style>{CSS}</style>
      <div className="vi-card">
        <div className="vi-hdr">
          <div className="vi-logo">EtherTrack</div>
          <div className="vi-sub">DOCUMENT VERIFICATION</div>
        </div>

        <div className="vi-body">
          {loading && <div className="vi-loading">⟳ Verifying {invoiceNumber}…</div>}

          {!loading && error && (
            <div className="vi-error">
              <div style={{ fontSize: 28, marginBottom: 12 }}>⚠️</div>
              <div style={{ color: '#f87171', fontWeight: 700, marginBottom: 6 }}>Not Found</div>
              <div>{error}</div>
              <div style={{ marginTop: 10, fontSize: 10, color: '#86efac33' }}>
                If you believe this is an error, contact support@ethertrack.in
              </div>
            </div>
          )}

          {!loading && !error && data && (
            <>
              <div className="vi-status">
                <span className="vi-badge" style={{ background: '#0d2e1f', color: '#22c55e', border: '1px solid #22c55e33' }}>
                  ✓ GENUINE DOCUMENT
                </span>
                {data.documentType === 'bill' ? (
                  <span className="vi-badge" style={{ background: '#0a1628', color: '#60a5fa', border: '1px solid #60a5fa33' }}>
                    NON-GST BILL
                  </span>
                ) : (
                  <span className="vi-badge" style={{ background: '#0d2e1f', color: '#22c55e', border: '1px solid #22c55e33' }}>
                    TAX INVOICE
                  </span>
                )}
                {data.onChain && (
                  <span className="vi-badge" style={{ background: '#0d2e1f', color: '#22c55e', border: '1px solid #22c55e33' }}>
                    ⛓ ON-CHAIN
                  </span>
                )}
              </div>

              <div className="vi-row">
                <span className="vi-label">Document No.</span>
                <span className="vi-val">{data.invoiceNumber}</span>
              </div>
              <div className="vi-row">
                <span className="vi-label">Issued</span>
                <span className="vi-val">{fmtDate(data.issuedAt)}</span>
              </div>
              {data.projectName && (
                <div className="vi-row">
                  <span className="vi-label">Project</span>
                  <span className="vi-val">{data.projectName}</span>
                </div>
              )}
              {data.totalAmount != null && (
                <div className="vi-row">
                  <span className="vi-label">Amount</span>
                  <span className="vi-val">{fmtINR(data.totalAmount)}</span>
                </div>
              )}
              {data.documentType !== undefined && (
                <div className="vi-row">
                  <span className="vi-label">GST Charged</span>
                  <span className="vi-val">{data.gstCharged ? `Yes (${fmtINR(data.gstAmount)})` : 'No'}</span>
                </div>
              )}
              <div className="vi-row">
                <span className="vi-label">Buyer</span>
                <span className="vi-val">{data.buyerName}</span>
              </div>

              {data.chainTxHash && (
                <div className="vi-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                  <span className="vi-label">Blockchain Transaction</span>
                  <a href={data.chainExplorerUrl} target="_blank" rel="noreferrer noopener" className="vi-hash">
                    {data.chainTxHash} ↗
                  </a>
                </div>
              )}

              {data.integrityHash && (
                <div className="vi-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6, borderBottom: 'none' }}>
                  <span className="vi-label">Integrity Hash</span>
                  <span className="vi-hash" style={{ color: '#86efac88' }}>{data.integrityHash}</span>
                  <span style={{ fontSize: 9, color: '#86efac33' }}>
                    Compare this to the hash printed on your PDF — they should match exactly.
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="vi-footer">
          EtherTrack Technologies Pvt Ltd · This page confirms document authenticity only
        </div>
      </div>
    </div>
  );
}