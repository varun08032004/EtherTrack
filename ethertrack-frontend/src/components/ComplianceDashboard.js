// ComplianceDashboard.jsx — EtherTrack CCTS Compliance Dashboard - 28/05/2026

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../services/api';

// ── Formatters ────────────────────────────────────────────────────
const fmtINR  = n  => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtNum  = n  => n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtPct  = n  => n == null ? '—' : `${Number(n).toFixed(1)}%`;
const fmtDate = d  => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// ── Urgency colours ───────────────────────────────────────────────
const URGENCY = {
  critical: { color: '#f87171', bg: '#450a0a', border: '#f8717133', label: 'CRITICAL' },
  high:     { color: '#fb923c', bg: '#431407', border: '#fb923c33', label: 'HIGH'     },
  medium:   { color: '#facc15', bg: '#1a1500', border: '#facc1533', label: 'MEDIUM'   },
  low:      { color: '#22c55e', bg: '#0d2e1f', border: '#22c55e33', label: 'LOW'      },
};

const STATUS_COLOR = {
  deficit:  '#f87171',
  surplus:  '#22c55e',
  balanced: '#facc15',
};

const CONTRACT_LABELS = {
  forward_buy:  { label: 'Forward Buy',  color: '#22c55e', icon: '📈' },
  forward_sell: { label: 'Forward Sell', color: '#f87171', icon: '📉' },
  budget_lock:  { label: 'Budget Lock',  color: '#60a5fa', icon: '🔒' },
  price_cap:    { color: '#a78bfa', label: 'Price Cap', icon: '🎯'   },
};

// ── Skeleton loader ───────────────────────────────────────────────
const Skel = ({ w = '100%', h = 16, mb = 0 }) => (
  <div style={{ width: w, height: h, borderRadius: 4, marginBottom: mb,
    background: '#0f2a1a55', animation: 'cdPulse 1.5s ease infinite' }}/>
);

// ── Progress bar ──────────────────────────────────────────────────
const ProgressBar = ({ pct, color = '#22c55e', height = 8 }) => (
  <div style={{ width: '100%', height, borderRadius: height / 2,
    background: '#0f2a1a', overflow: 'hidden' }}>
    <div style={{ width: `${Math.min(100, Math.max(0, parseFloat(pct) || 0))}%`,
      height: '100%', borderRadius: height / 2, background: color,
      transition: 'width 0.6s ease' }}/>
  </div>
);

function PriceTicker({ prices }) {
  if (!prices?.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      {prices.map(p => (
        <div key={p.source} style={{
          padding: '8px 14px', borderRadius: 8,
          background: p.is_official ? '#0d2e1f' : '#080c0a',
          border: `1px solid ${p.is_official ? '#22c55e33' : '#0f2a1a'}`,
          minWidth: 140,
        }}>
          <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.12em', marginBottom: 3 }}>
            {p.source} {p.is_official && <span style={{ color: '#22c55e88' }}>● OFFICIAL</span>}
          </div>
          <div style={{ fontSize: 18, fontWeight: 500, color: '#f0fdf4' }}>
            {fmtINR(p.price_inr)}
          </div>
          {p.bid_price_inr && p.ask_price_inr && (
            <div style={{ fontSize: 9, color: '#86efac55', marginTop: 2 }}>
              B: {fmtINR(p.bid_price_inr)} / A: {fmtINR(p.ask_price_inr)}
            </div>
          )}
          {p.volume_ccc && (
            <div style={{ fontSize: 9, color: '#86efac44' }}>Vol: {fmtNum(p.volume_ccc)} CCCs</div>
          )}
        </div>
      ))}
    </div>
  );
}

function SummaryCards({ summary, period, marketContext, loading }) {
  const gap        = parseFloat(summary?.netGap ?? 0);
  const pct        = parseFloat(summary?.completionPct ?? 0);
  const urgConfig  = URGENCY[period?.urgency] || URGENCY.low;
  const posColor   = STATUS_COLOR[summary?.positionStatus] || '#86efac88';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
      <div className="cd-card">
        <div className="cd-card-label">COMPLIANCE TARGET</div>
        {loading ? <Skel w="80px" h={28} mb={6}/> : (
          <div className="cd-card-val">{fmtNum(summary?.totalTarget)} <span className="cd-unit">CCCs</span></div>
        )}
        <div style={{ fontSize: 10, color: '#86efac55' }}>{period?.cycleName}</div>
      </div>
      <div className="cd-card">
        <div className="cd-card-label">CURRENTLY HELD</div>
        {loading ? <Skel w="80px" h={28} mb={6}/> : (
          <div className="cd-card-val" style={{ color: '#22c55e' }}>
            {fmtNum(summary?.totalHeld)} <span className="cd-unit">CCCs</span>
          </div>
        )}
        <ProgressBar pct={pct} color="#22c55e"/>
        <div style={{ fontSize: 10, color: '#86efac55', marginTop: 4 }}>{fmtPct(pct)} complete</div>
      </div>
      <div className="cd-card" style={{ borderColor: gap < 0 ? '#f8717133' : '#22c55e33' }}>
        <div className="cd-card-label">{gap < 0 ? 'DEFICIT' : gap > 0 ? 'SURPLUS' : 'POSITION'}</div>
        {loading ? <Skel w="80px" h={28} mb={6}/> : (
          <div className="cd-card-val" style={{ color: posColor }}>
            {gap < 0 ? '-' : gap > 0 ? '+' : ''}{fmtNum(Math.abs(gap))} <span className="cd-unit">CCCs</span>
          </div>
        )}
        <div style={{ fontSize: 10, color: posColor, opacity: 0.7 }}>
          {summary?.positionStatus?.toUpperCase()}
        </div>
      </div>
      <div className="cd-card">
        <div className="cd-card-label">COST TO COMPLY</div>
        {loading ? <Skel w="80px" h={28} mb={6}/> : (
          <div className="cd-card-val" style={{ fontSize: 20 }}>
            {marketContext?.costToComply ? fmtINR(marketContext.costToComply) : '—'}
          </div>
        )}
        <div style={{ fontSize: 10, color: '#86efac55' }}>
          @ {marketContext?.currentPriceInr ? fmtINR(marketContext.currentPriceInr) + '/CCC' : 'awaiting price'}
        </div>
      </div>
      <div className="cd-card" style={{ borderColor: marketContext?.penaltyIfShort ? '#f8717122' : undefined }}>
        <div className="cd-card-label">PENALTY IF SHORT</div>
        {loading ? <Skel w="80px" h={28} mb={6}/> : (
          <div className="cd-card-val" style={{ color: marketContext?.penaltyIfShort ? '#f87171' : '#86efac44', fontSize: 20 }}>
            {marketContext?.penaltyIfShort ? fmtINR(marketContext.penaltyIfShort) : '—'}
          </div>
        )}
        <div style={{ fontSize: 10, color: '#86efac55' }}>
          {period?.penaltyPerCCC ? `₹${period.penaltyPerCCC}/CCC per CERC` : ''}
        </div>
      </div>
      <div className="cd-card" style={{ borderColor: urgConfig.border }}>
        <div className="cd-card-label">SURRENDER DEADLINE</div>
        {loading ? <Skel w="80px" h={28} mb={6}/> : (
          <div className="cd-card-val" style={{ color: urgConfig.color, fontSize: 18 }}>
            {fmtDate(period?.surrenderDeadline)}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 10,
            background: urgConfig.bg, color: urgConfig.color, border: `1px solid ${urgConfig.border}`,
            letterSpacing: '.08em' }}>
            {urgConfig.label}
          </span>
          <span style={{ fontSize: 10, color: '#86efac55' }}>{period?.daysLeft} days left</span>
        </div>
      </div>
    </div>
  );
}

function PlantBreakdown({ plants, loading, onEditPosition }) {
  if (loading) return (
    <div className="cd-panel">
      <div className="cd-panel-title">PLANT-WISE POSITION</div>
      {[1,2,3].map(i => <div key={i} style={{ padding: '12px 0', borderBottom: '1px solid #0f2a1a08' }}>
        <Skel w="60%" h={12} mb={6}/><Skel w="40%" h={9}/>
      </div>)}
    </div>
  );

  return (
    <div className="cd-panel" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="cd-panel-title" style={{ marginBottom: 0 }}>PLANT-WISE POSITION</div>
        <button className="cd-btn-sm" onClick={onEditPosition}>+ UPDATE POSITIONS</button>
      </div>
      {!plants?.length ? (
        <div style={{ textAlign: 'center', padding: '32px', color: '#86efac33', fontSize: 12 }}>
          No plants added yet. Add plants to see position breakdown.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', gap: 8,
            padding: '0 8px 8px', fontSize: 8, color: '#86efac44',
            letterSpacing: '.12em', borderBottom: '1px solid #0f2a1a' }}>
            <span>PLANT</span><span>TARGET</span><span>HELD</span><span>GAP</span><span>STATUS</span>
          </div>
          {plants.map(p => {
            const gap = parseFloat(p.plant_gap);
            const color = gap >= 0 ? '#22c55e' : '#f87171';
            return (
              <div key={p.plant_id} style={{ display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', gap: 8,
                padding: '10px 8px', borderBottom: '1px solid #0f2a1a08',
                alignItems: 'center', fontSize: 11 }}>
                <div>
                  <div style={{ color: '#f0fdf4', fontWeight: 500 }}>{p.plant_name}</div>
                  <div style={{ fontSize: 9, color: '#86efac44' }}>{p.state} · {p.sector}</div>
                </div>
                <span style={{ color: '#86efac77' }}>{fmtNum(p.target_ccc)}</span>
                <span style={{ color: '#22c55e' }}>{fmtNum(p.held_ccc)}</span>
                <span style={{ color, fontWeight: 500 }}>
                  {gap > 0 ? '+' : ''}{fmtNum(gap)}
                </span>
                <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 10, textAlign: 'center',
                  background: gap >= 0 ? '#0d2e1f' : '#450a0a',
                  color, border: `1px solid ${color}33` }}>
                  {gap >= 0 ? 'SURPLUS' : 'DEFICIT'}
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function NettingEngine({ onNettingComplete }) {
  const [result,    setResult]    = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [exchange,  setExchange]  = useState('IEX');
  const [error,     setError]     = useState('');
  const [sessions,  setSessions]  = useState([]);

  useEffect(() => {
    apiFetch('/api/compliance/netting').then(d => setSessions(d?.sessions || [])).catch(() => {});
  }, []);

  const calculate = async () => {
    setLoading(true); setError('');
    try {
      const data = await apiFetch('/api/compliance/netting/calculate');
      setResult(data);
    } catch (e) {
      setError(e.message || 'Calculation failed');
    } finally { setLoading(false); }
  };

  const confirm = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const data = await apiFetch('/api/compliance/netting/confirm', { method: 'POST', body: JSON.stringify({
        netPosition:   result.netPosition,
        netAction:     result.netAction,
        grossSurplus:  result.grossSurplus,
        grossDeficit:  result.grossDeficit,
        lines:         result.lines,
      }) });
      setResult(null);
      setSessions(prev => [{ id: data.sessionId, net_action: result.netAction,
        net_position_ccc: result.netPosition, created_at: new Date().toISOString() }, ...prev]);
      onNettingComplete?.(data);
    } catch (e) {
      setError(e.message || 'Failed to save session');
    } finally { setSaving(false); }
  };

  return (
    <div className="cd-panel" style={{ marginBottom: 16 }}>
      <div className="cd-panel-title">INTRA-GROUP NETTING ENGINE</div>
      <div style={{ fontSize: 11, color: '#86efac55', marginBottom: 14, lineHeight: 1.6 }}>
        Net surplus from one plant against deficit in another before routing to exchange.
        Reduces trading costs by avoiding unnecessary buys and sells.
      </div>
      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 6, background: '#450a0a',
          border: '1px solid #f8717133', color: '#f87171', fontSize: 11, marginBottom: 10 }}>
          {error}
        </div>
      )}
      {!result ? (
        <button className="cd-btn" onClick={calculate} disabled={loading}>
          {loading ? '⏳ CALCULATING...' : '⚡ RUN NETTING CALCULATION'}
        </button>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
            {[
              { label: 'GROSS SURPLUS', val: `+${fmtNum(result.grossSurplus)} CCCs`, color: '#22c55e' },
              { label: 'GROSS DEFICIT', val: `-${fmtNum(result.grossDeficit)} CCCs`, color: '#f87171' },
              { label: 'NET POSITION',  val: `${result.netPosition >= 0 ? '+' : ''}${fmtNum(result.netPosition)} CCCs`,
                color: result.netAction === 'sell' ? '#22c55e' : result.netAction === 'buy' ? '#f87171' : '#facc15' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ padding: '10px 12px', borderRadius: 7,
                background: '#060908', border: '1px solid #0f2a1a', textAlign: 'center' }}>
                <div style={{ fontSize: 8, color: '#86efac44', letterSpacing: '.12em', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 500, color }}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: '10px 14px', borderRadius: 7, marginBottom: 14,
            background: result.netAction === 'flat' ? '#0d2e1f' : result.netAction === 'buy' ? '#450a0a' : '#0d2e1f',
            border: `1px solid ${result.netAction === 'buy' ? '#f8717133' : '#22c55e33'}`,
            fontSize: 12, color: '#f0fdf4', lineHeight: 1.6 }}>
            <strong>Recommendation:</strong> {result.recommendation}
            {result.netValueInr && (
              <span style={{ color: '#86efac77', marginLeft: 8 }}>
                (≈ {fmtINR(result.netValueInr)} at current market price)
              </span>
            )}
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.12em',
              padding: '0 8px 6px', borderBottom: '1px solid #0f2a1a',
              display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 8 }}>
              <span>PLANT</span><span>POSITION</span><span>ALLOCATED</span><span>POST-NET GAP</span><span>ACTION</span>
            </div>
            {result.lines?.map(l => (
              <div key={l.plantId} style={{ display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 8,
                padding: '8px', fontSize: 10, borderBottom: '1px solid #0f2a1a08',
                alignItems: 'center' }}>
                <span style={{ color: '#f0fdf4' }}>{l.plantName}</span>
                <span style={{ color: l.plantPosition >= 0 ? '#22c55e' : '#f87171' }}>
                  {l.plantPosition >= 0 ? '+' : ''}{fmtNum(l.plantPosition)}
                </span>
                <span style={{ color: '#60a5fa88' }}>{fmtNum(l.allocatedCcc)}</span>
                <span style={{ color: l.postNettingGap >= 0 ? '#22c55e' : '#f87171' }}>
                  {l.postNettingGap >= 0 ? '+' : ''}{fmtNum(l.postNettingGap)}
                </span>
                <span style={{ fontSize: 9, color: l.postNettingGap < 0 ? '#f87171' : '#86efac44' }}>
                  {l.postNettingGap < 0 ? `BUY ${Math.abs(l.postNettingGap).toFixed(0)}` : 'OK'}
                </span>
              </div>
            ))}
          </div>
          {result.netAction !== 'flat' && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.1em', marginBottom: 6 }}>
                ROUTE NET {result.netAction.toUpperCase()} TO EXCHANGE
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['IEX', 'PXIL'].map(ex => (
                  <button key={ex} onClick={() => setExchange(ex)} style={{
                    padding: '7px 16px', borderRadius: 5, cursor: 'pointer',
                    fontFamily: 'DM Mono, monospace', fontSize: 10, letterSpacing: '.08em',
                    border: `1px solid ${exchange === ex ? '#22c55e44' : '#0f2a1a'}`,
                    background: exchange === ex ? '#0d2e1f22' : 'transparent',
                    color: exchange === ex ? '#22c55e' : '#86efac44',
                  }}>{ex}</button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="cd-btn" onClick={confirm} disabled={saving}>
              {saving ? '⏳ SAVING...' : '✅ CONFIRM NETTING SESSION'}
            </button>
            <button className="cd-btn-outline" onClick={() => setResult(null)}>RECALCULATE</button>
          </div>
        </>
      )}
      {sessions.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #0f2a1a' }}>
          <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.12em', marginBottom: 8 }}>
            PREVIOUS SESSIONS
          </div>
          {sessions.slice(0, 3).map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between',
              padding: '6px 0', fontSize: 10, borderBottom: '1px solid #0f2a1a08' }}>
              <span style={{ color: '#86efac55' }}>{fmtDate(s.created_at)}</span>
              <span style={{ color: s.net_action === 'buy' ? '#f87171' : '#22c55e' }}>
                {s.net_action?.toUpperCase()} {fmtNum(Math.abs(s.net_position_ccc))} CCCs
              </span>
              <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3,
                background: '#0d2e1f', color: '#22c55e', border: '1px solid #22c55e22' }}>
                {s.status?.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HedgeManager({ currentPrice }) {
  const [hedges,  setHedges]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    apiFetch('/api/compliance/hedges')
      .then(d => { setHedges(d?.hedges || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!form) return;
    setSaving(true); setError('');
    try {
      const data = await apiFetch('/api/compliance/hedges', { method: 'POST', body: JSON.stringify(form) });
      if (data?.hedge) setHedges(prev => [data.hedge, ...prev]);
      setForm(null);
    } catch (e) {
      setError(e.message || 'Failed to create hedge');
    } finally { setSaving(false); }
  };

  const cancel = async (id) => {
    try {
      await apiFetch(`/api/compliance/hedges/${id}`, { method: 'DELETE' });
      setHedges(prev => prev.map(h => h.id === id ? { ...h, status: 'cancelled' } : h));
    } catch (e) { setError(e.message); }
  };

  const activeHedges  = hedges.filter(h => h.status === 'active');
  const totalHedgedQty = activeHedges.reduce((s, h) => s + parseFloat(h.quantity_ccc || 0), 0);
  const totalBudget    = activeHedges.filter(h => h.contract_type === 'budget_lock')
    .reduce((s, h) => s + parseFloat(h.budget_inr || 0), 0);

  return (
    <div className="cd-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="cd-panel-title" style={{ marginBottom: 0 }}>HEDGE PORTFOLIO</div>
        <button className="cd-btn-sm" onClick={() => setForm({
          contractType: 'forward_buy', quantityCcc: '', lockedPriceInr: currentPrice || '',
          expiryDate: '', notes: '',
        })}>+ NEW HEDGE</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
        {[
          { label: 'HEDGED QUANTITY', val: `${fmtNum(totalHedgedQty)} CCCs` },
          { label: 'BUDGET LOCKED',   val: fmtINR(totalBudget) },
          { label: 'ACTIVE CONTRACTS', val: activeHedges.length },
        ].map(({ label, val }) => (
          <div key={label} style={{ padding: '8px 12px', borderRadius: 6,
            background: '#060908', border: '1px solid #0f2a1a', textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: '#86efac44', letterSpacing: '.12em', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#f0fdf4' }}>{val}</div>
          </div>
        ))}
      </div>
      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 6, background: '#450a0a',
          border: '1px solid #f8717133', color: '#f87171', fontSize: 11, marginBottom: 10 }}>
          {error}
        </div>
      )}
      {form && (
        <div style={{ padding: 14, borderRadius: 8, background: '#060908',
          border: '1px solid #0f2a1a', marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: '#86efac88', letterSpacing: '.1em', marginBottom: 12 }}>
            NEW HEDGE CONTRACT
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 9, color: '#86efac44', marginBottom: 4 }}>CONTRACT TYPE</div>
              <select className="cd-inp" value={form.contractType}
                onChange={e => setForm(p => ({ ...p, contractType: e.target.value }))}>
                <option value="forward_buy">Forward Buy</option>
                <option value="forward_sell">Forward Sell</option>
                <option value="budget_lock">Budget Lock</option>
                <option value="price_cap">Price Cap</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#86efac44', marginBottom: 4 }}>QUANTITY (CCCs)</div>
              <input className="cd-inp" type="number" placeholder="e.g. 500"
                value={form.quantityCcc}
                onChange={e => setForm(p => ({ ...p, quantityCcc: e.target.value }))}/>
            </div>
            {['forward_buy','forward_sell'].includes(form.contractType) && (
              <div>
                <div style={{ fontSize: 9, color: '#86efac44', marginBottom: 4 }}>LOCKED PRICE (₹/CCC)</div>
                <input className="cd-inp" type="number" placeholder={currentPrice || '850'}
                  value={form.lockedPriceInr}
                  onChange={e => setForm(p => ({ ...p, lockedPriceInr: e.target.value }))}/>
              </div>
            )}
            {form.contractType === 'budget_lock' && (
              <div>
                <div style={{ fontSize: 9, color: '#86efac44', marginBottom: 4 }}>BUDGET (₹)</div>
                <input className="cd-inp" type="number" placeholder="e.g. 500000"
                  value={form.budgetInr || ''}
                  onChange={e => setForm(p => ({ ...p, budgetInr: e.target.value }))}/>
              </div>
            )}
            {form.contractType === 'price_cap' && (
              <div>
                <div style={{ fontSize: 9, color: '#86efac44', marginBottom: 4 }}>MAX PRICE (₹/CCC)</div>
                <input className="cd-inp" type="number" placeholder="e.g. 1000"
                  value={form.maxPriceInr || ''}
                  onChange={e => setForm(p => ({ ...p, maxPriceInr: e.target.value }))}/>
              </div>
            )}
            <div>
              <div style={{ fontSize: 9, color: '#86efac44', marginBottom: 4 }}>EXPIRY DATE</div>
              <input className="cd-inp" type="date"
                value={form.expiryDate}
                onChange={e => setForm(p => ({ ...p, expiryDate: e.target.value }))}/>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="cd-btn" onClick={save} disabled={saving}>
              {saving ? '⏳...' : '✅ CREATE HEDGE'}
            </button>
            <button className="cd-btn-outline" onClick={() => setForm(null)}>CANCEL</button>
          </div>
        </div>
      )}
      {loading ? <Skel h={60}/> : hedges.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px', color: '#86efac33', fontSize: 12 }}>
          No hedges yet. Use forward contracts or budget locks to manage price risk.
        </div>
      ) : (
        hedges.map(h => {
          const cfg = CONTRACT_LABELS[h.contract_type] || {};
          return (
            <div key={h.id} style={{ display: 'flex', gap: 12, alignItems: 'center',
              padding: '10px 0', borderBottom: '1px solid #0f2a1a08' }}>
              <span style={{ fontSize: 18 }}>{cfg.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: cfg.color || '#86efac88' }}>
                    {cfg.label}
                  </span>
                  <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10,
                    background: h.status === 'active' ? '#0d2e1f' : '#1a1a1a',
                    color: h.status === 'active' ? '#22c55e' : '#86efac44',
                    border: '1px solid #22c55e22' }}>
                    {h.status?.toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: '#86efac55' }}>
                  {fmtNum(h.quantity_ccc)} CCCs
                  {h.locked_price_inr && ` @ ${fmtINR(h.locked_price_inr)}/CCC`}
                  {h.budget_inr && ` — Budget: ${fmtINR(h.budget_inr)}`}
                  {h.max_price_inr && ` — Cap: ${fmtINR(h.max_price_inr)}/CCC`}
                  <span style={{ marginLeft: 8, color: '#86efac33' }}>
                    Expires {fmtDate(h.expiry_date)}
                  </span>
                </div>
              </div>
              {h.status === 'active' && (
                <button onClick={() => cancel(h.id)} style={{
                  background: 'none', border: '1px solid #f8717133', borderRadius: 4,
                  color: '#f87171', cursor: 'pointer', fontSize: 10, padding: '3px 8px',
                  fontFamily: 'DM Mono, monospace' }}>
                  CANCEL
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function OnboardingWizard({ onComplete }) {
  const [step,    setStep]   = useState(1);
  const [entity,  setEntity] = useState({ entityName: '', entityType: 'steel', dcId: '', gstin: '', complianceOfficer: '', complianceEmail: '' });
  const [plant,   setPlant]  = useState({ plantName: '', state: '', sector: '', installedCapacity: '', capacityUnit: 'MW', baselineSec: '', secUnit: 'GJ/tonne' });
  const [pos,     setPos]    = useState({ targetCcc: '', heldCcc: '', surrenderedCcc: '0' });
  const [saving,  setSaving] = useState(false);
  const [error,   setError]  = useState('');

  const ENTITY_TYPES = ['steel','cement','aluminium','fertiliser','power','textile','pulp_paper','chlor_alkali','railway','other'];

  const saveStep1 = async () => {
    if (!entity.entityName || !entity.entityType) { setError('Entity name and type required'); return; }
    setSaving(true); setError('');
    try {
      await apiFetch('/api/compliance/entity', { method: 'POST', body: JSON.stringify(entity) });
      setStep(2);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const saveStep2 = async () => {
    if (!plant.plantName) { setError('Plant name required'); return; }
    setSaving(true); setError('');
    try {
      await apiFetch('/api/compliance/plants', { method: 'POST', body: JSON.stringify(plant) });
      setStep(3);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const saveStep3 = async () => {
    if (!pos.targetCcc || !pos.heldCcc) { setError('Target and held CCCs required'); return; }
    setSaving(true); setError('');
    try {
      await apiFetch('/api/compliance/positions', { method: 'POST', body: JSON.stringify(pos) });
      onComplete();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 20px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.18em', marginBottom: 4 }}>
          ETHERTRACK · CCTS COMPLIANCE SETUP
        </div>
        <div style={{ fontSize: 22, fontWeight: 500, color: '#f0fdf4' }}>
          Compliance <span style={{ color: '#22c55e' }}>Onboarding</span>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
          {[1,2,3].map(s => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 2,
              background: step >= s ? '#22c55e' : '#0f2a1a', transition: 'background .3s' }}/>
          ))}
        </div>
      </div>
      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 6, background: '#450a0a',
          border: '1px solid #f8717133', color: '#f87171', fontSize: 11, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div className="cd-panel">
        {step === 1 && (
          <>
            <div className="cd-panel-title">STEP 1 OF 3 — ENTITY DETAILS</div>
            <label className="cd-label">Entity Name *</label>
            <input className="cd-inp" placeholder="e.g. Tata Steel Ltd"
              value={entity.entityName} onChange={e => setEntity(p => ({ ...p, entityName: e.target.value }))}/>
            <label className="cd-label">Sector *</label>
            <select className="cd-inp" value={entity.entityType}
              onChange={e => setEntity(p => ({ ...p, entityType: e.target.value }))}>
              {ENTITY_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ').toUpperCase()}</option>)}
            </select>
            <label className="cd-label">BEE Designated Consumer ID</label>
            <input className="cd-inp" placeholder="DC-XXXX-XXXX"
              value={entity.dcId} onChange={e => setEntity(p => ({ ...p, dcId: e.target.value }))}/>
            <label className="cd-label">GSTIN</label>
            <input className="cd-inp" placeholder="27XXXXX..."
              value={entity.gstin} onChange={e => setEntity(p => ({ ...p, gstin: e.target.value }))}/>
            <label className="cd-label">Compliance Officer</label>
            <input className="cd-inp" placeholder="Name"
              value={entity.complianceOfficer} onChange={e => setEntity(p => ({ ...p, complianceOfficer: e.target.value }))}/>
            <label className="cd-label">Compliance Email</label>
            <input className="cd-inp" type="email" placeholder="compliance@company.com"
              value={entity.complianceEmail} onChange={e => setEntity(p => ({ ...p, complianceEmail: e.target.value }))}/>
            <button className="cd-btn" onClick={saveStep1} disabled={saving}>
              {saving ? '⏳ SAVING...' : 'NEXT →'}
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <div className="cd-panel-title">STEP 2 OF 3 — ADD FIRST PLANT</div>
            <label className="cd-label">Plant Name *</label>
            <input className="cd-inp" placeholder="e.g. Jamshedpur Unit 1"
              value={plant.plantName} onChange={e => setPlant(p => ({ ...p, plantName: e.target.value }))}/>
            <label className="cd-label">State</label>
            <input className="cd-inp" placeholder="e.g. Jharkhand"
              value={plant.state} onChange={e => setPlant(p => ({ ...p, state: e.target.value }))}/>
            <label className="cd-label">Installed Capacity</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="cd-inp" type="number" placeholder="e.g. 500"
                value={plant.installedCapacity}
                onChange={e => setPlant(p => ({ ...p, installedCapacity: e.target.value }))}/>
              <select className="cd-inp" style={{ width: 'auto', flexShrink: 0 }}
                value={plant.capacityUnit}
                onChange={e => setPlant(p => ({ ...p, capacityUnit: e.target.value }))}>
                {['MW','MTPA','TPD','KW','TPA'].map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <label className="cd-label">Baseline SEC</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="cd-inp" type="number" placeholder="e.g. 5.2"
                value={plant.baselineSec}
                onChange={e => setPlant(p => ({ ...p, baselineSec: e.target.value }))}/>
              <select className="cd-inp" style={{ width: 'auto', flexShrink: 0 }}
                value={plant.secUnit}
                onChange={e => setPlant(p => ({ ...p, secUnit: e.target.value }))}>
                {['GJ/tonne','kWh/kWh','GJ/MT','kCal/kWh'].map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="cd-btn-outline" onClick={() => setStep(1)}>← BACK</button>
              <button className="cd-btn" onClick={saveStep2} disabled={saving}>
                {saving ? '⏳ SAVING...' : 'NEXT →'}
              </button>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <div className="cd-panel-title">STEP 3 OF 3 — COMPLIANCE POSITION</div>
            <div style={{ fontSize: 11, color: '#86efac55', marginBottom: 14, lineHeight: 1.6 }}>
              Enter your PAT Cycle 1 target and current CCC holding.
              You can update this anytime — or sync from GCI once connected.
            </div>
            <label className="cd-label">CCC Target for PAT Cycle 1 *</label>
            <input className="cd-inp" type="number" placeholder="CCCs required by Sep 2026"
              value={pos.targetCcc} onChange={e => setPos(p => ({ ...p, targetCcc: e.target.value }))}/>
            <label className="cd-label">CCCs Currently Held *</label>
            <input className="cd-inp" type="number" placeholder="CCCs you currently hold"
              value={pos.heldCcc} onChange={e => setPos(p => ({ ...p, heldCcc: e.target.value }))}/>
            <label className="cd-label">CCCs Already Surrendered</label>
            <input className="cd-inp" type="number" placeholder="0"
              value={pos.surrenderedCcc} onChange={e => setPos(p => ({ ...p, surrenderedCcc: e.target.value }))}/>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="cd-btn-outline" onClick={() => setStep(2)}>← BACK</button>
              <button className="cd-btn" onClick={saveStep3} disabled={saving}>
                {saving ? '⏳ SAVING...' : '🎉 COMPLETE SETUP'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ComplianceDashboard() {
  const navigate = useNavigate();
  const [dashboard, setDashboard]     = useState(null);
  const [prices,    setPrices]        = useState([]);
  const [loading,   setLoading]       = useState(true);
  const [tab,       setTab]           = useState('overview');
  const [error,     setError]         = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [dash, allPrices] = await Promise.allSettled([
        apiFetch('/api/compliance/dashboard'),
        fetch(`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/ccc/prices/all`)
          .then(r => r.json()),
      ]);
      if (dash.status === 'fulfilled')        setDashboard(dash.value);
      if (allPrices.status === 'fulfilled')   setPrices(allPrices.value?.prices || []);
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const currentPrice = useMemo(() => {
    const official = prices.find(p => p.is_official);
    return official?.price_inr || prices[0]?.price_inr || null;
  }, [prices]);

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    .cd{min-height:100vh;background:#060908;font-family:'DM Mono',monospace;color:#f0fdf4;}
    .cd-wrap{max-width:1300px;margin:0 auto;padding:24px 20px 80px;}
    .cd-panel{background:#080c0a;border:1px solid #0f2a1a;border-radius:10px;padding:16px;margin-bottom:12px;}
    .cd-panel-title{font-size:9px;color:#86efac55;letter-spacing:.14em;margin-bottom:12px;}
    .cd-card{background:#080c0a;border:1px solid #0f2a1a;border-radius:10px;padding:14px 16px;}
    .cd-card-label{font-size:8px;color:#86efac55;letter-spacing:.14em;margin-bottom:8px;}
    .cd-card-val{font-size:24px;font-weight:500;color:#f0fdf4;margin-bottom:6px;}
    .cd-unit{font-size:12px;color:#86efac44;font-weight:400;}
    .cd-btn{width:100%;padding:11px;border-radius:7px;border:none;cursor:pointer;
      font-family:'DM Mono',monospace;font-size:12px;font-weight:500;letter-spacing:.08em;
      background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;transition:opacity .2s;}
    .cd-btn:disabled{opacity:.4;cursor:not-allowed;}
    .cd-btn-outline{flex:1;padding:11px;border-radius:7px;border:1px solid #0f2a1a;
      background:transparent;color:#86efac44;cursor:pointer;
      font-family:'DM Mono',monospace;font-size:12px;letter-spacing:.08em;}
    .cd-btn-sm{padding:5px 12px;border-radius:5px;border:1px solid #22c55e33;
      background:#0d2e1f22;color:#22c55e88;cursor:pointer;
      font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.08em;}
    .cd-inp{width:100%;padding:9px 11px;border-radius:6px;border:1px solid #0f2a1a;
      background:#040706;color:#f0fdf4;font-family:'DM Mono',monospace;
      font-size:11px;outline:none;margin-bottom:8px;transition:border-color .2s;}
    .cd-inp:focus{border-color:#22c55e33;}
    .cd-label{display:block;font-size:9px;color:#86efac44;letter-spacing:.1em;
      margin-bottom:4px;margin-top:4px;}
    .cd-tab{padding:9px 16px;border:none;border-bottom:2px solid transparent;
      background:transparent;cursor:pointer;font-family:'DM Mono',monospace;
      font-size:10px;letter-spacing:.1em;color:#86efac44;transition:all .2s;margin-bottom:-1px;}
    .cd-tab:hover{color:#86efac88;}
    .cd-tab.act{color:#22c55e;border-bottom-color:#22c55e;}
    @keyframes cdPulse{0%,100%{opacity:.4;}50%{opacity:.9;}}
    @media(max-width:768px){.cd-cards-grid{grid-template-columns:1fr 1fr!important;}}
  `;

  if (!loading && dashboard && !dashboard.onboarded) {
    return (
      <>
        <style>{CSS}</style>
        <div className="cd">
          <OnboardingWizard onComplete={load} />
        </div>
      </>
    );
  }

  const d = dashboard;

  return (
    <>
      <style>{CSS}</style>
      <div className="cd">
        <div className="cd-wrap">
          <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between',
            alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.18em', marginBottom: 4 }}>
                ETHERTRACK · CCTS COMPLIANCE · {d?.period?.cycleName || 'PAT CYCLE 1'}
              </div>
              <div style={{ fontSize: 22, fontWeight: 500, color: '#f0fdf4' }}>
                Compliance <span style={{ color: '#22c55e' }}>Dashboard</span>
              </div>
              {d?.entity && (
                <div style={{ fontSize: 11, color: '#86efac44', marginTop: 2 }}>
                  {d.entity.name} · {d.entity.type?.replace('_',' ').toUpperCase()}
                  {d.entity.dcId && <span style={{ color: '#86efac33' }}> · DC: {d.entity.dcId}</span>}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {d?.entity?.isVerified && (
                <span style={{ fontSize: 9, padding: '4px 10px', borderRadius: 20,
                  background: '#0d2e1f', border: '1px solid #22c55e33', color: '#22c55e', letterSpacing: '.08em' }}>
                  ✅ ENTITY VERIFIED
                </span>
              )}
              <button onClick={load} style={{ padding: '6px 14px', borderRadius: 6,
                border: '1px solid #0f2a1a', background: 'transparent', color: '#86efac44',
                cursor: 'pointer', fontFamily: 'DM Mono, monospace', fontSize: 9 }}>
                ↻ REFRESH
              </button>
            </div>
          </div>
          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 7, marginBottom: 16,
              background: '#1a0707', border: '1px solid #f8717133', color: '#f87171', fontSize: 11 }}>
              {error}
              <button onClick={load} style={{ marginLeft: 12, background: 'none', border: '1px solid #f8717133',
                borderRadius: 4, color: '#f87171', cursor: 'pointer', fontSize: 9, padding: '2px 8px',
                fontFamily: 'DM Mono, monospace' }}>RETRY</button>
            </div>
          )}
          <PriceTicker prices={prices} />
          {d?.marketContext?.recommendation && (
            <div style={{ padding: '12px 16px', borderRadius: 8, marginBottom: 16,
              background: '#0d2e1f', border: '1px solid #22c55e22', fontSize: 12,
              color: '#f0fdf4', lineHeight: 1.6, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>💡</span>
              <div>
                <div style={{ fontWeight: 500, marginBottom: 2 }}>CFO Recommendation</div>
                <div style={{ color: '#86efac77' }}>{d.marketContext.recommendation}</div>
              </div>
              {d.summary?.positionStatus === 'deficit' && (
                <button onClick={() => navigate('/carbon-credits')} style={{
                  marginLeft: 'auto', padding: '8px 16px', borderRadius: 6, flexShrink: 0,
                  border: '1px solid #22c55e44', background: '#0d2e1f22', color: '#22c55e',
                  cursor: 'pointer', fontFamily: 'DM Mono, monospace', fontSize: 10 }}>
                  BUY CCCs →
                </button>
              )}
            </div>
          )}
          <SummaryCards
            summary={d?.summary}
            period={d?.period}
            marketContext={d?.marketContext}
            loading={loading}
          />
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #0f2a1a',
            marginBottom: 16, paddingBottom: 0 }}>
            {[
              ['overview',  'OVERVIEW'],
              ['netting',   'NETTING ENGINE'],
              ['hedges',    'HEDGE PORTFOLIO'],
              ['exchange',  'EXCHANGE ORDERS'],
              ['gci',       'GCI SYNC'],
            ].map(([t, label]) => (
              <button key={t} className={`cd-tab${tab === t ? ' act' : ''}`}
                onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'overview' && (
            <PlantBreakdown
              plants={d?.plantBreakdown}
              loading={loading}
              onEditPosition={() => navigate('/compliance/positions')}
            />
          )}
          {tab === 'netting' && <NettingEngine onNettingComplete={load}/>}
          {tab === 'hedges'  && <HedgeManager currentPrice={currentPrice}/>}
          {tab === 'exchange' && <ExchangeOrdersPanel />}
          {tab === 'gci'     && <GCISyncPanel onSync={load}/>}
        </div>
      </div>
    </>
  );
}

function ExchangeOrdersPanel() {
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  useEffect(() => {
    apiFetch('/api/ccc/exchange/orders')
      .then(d => { setOrders(d?.orders || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const submit = async () => {
    if (!form) return;
    setSaving(true); setError('');
    try {
      const data = await apiFetch('/api/ccc/exchange/order', { method: 'POST', body: JSON.stringify(form) });
      if (data?.order) setOrders(prev => [data.order, ...prev]);
      setForm(null);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const STATUS_COLOR_MAP = {
    submitted: '#60a5fa', filled: '#22c55e', cancelled: '#86efac33',
    rejected: '#f87171', pending: '#facc15', partial: '#fb923c',
  };

  return (
    <div className="cd-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="cd-panel-title" style={{ marginBottom: 0 }}>EXCHANGE ORDERS (IEX / PXIL)</div>
        <button className="cd-btn-sm" onClick={() => setForm({
          exchange: 'IEX', orderSide: 'buy', orderType: 'limit',
          quantityCcc: '', limitPriceInr: '',
        })}>+ PLACE ORDER</button>
      </div>
      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 6, background: '#450a0a',
          border: '1px solid #f8717133', color: '#f87171', fontSize: 11, marginBottom: 10 }}>
          {error}
        </div>
      )}
      {form && (
        <div style={{ padding: 14, borderRadius: 8, background: '#060908',
          border: '1px solid #0f2a1a', marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: '#86efac88', letterSpacing: '.1em', marginBottom: 12 }}>
            PLACE ORDER ON EXCHANGE
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 9, color: '#86efac44', marginBottom: 4 }}>EXCHANGE</div>
              <select className="cd-inp" value={form.exchange}
                onChange={e => setForm(p => ({ ...p, exchange: e.target.value }))}>
                <option value="IEX">IEX</option>
                <option value="PXIL">PXIL</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#86efac44', marginBottom: 4 }}>SIDE</div>
              <select className="cd-inp" value={form.orderSide}
                onChange={e => setForm(p => ({ ...p, orderSide: e.target.value }))}>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#86efac44', marginBottom: 4 }}>QUANTITY (CCCs)</div>
              <input className="cd-inp" type="number" placeholder="e.g. 200"
                value={form.quantityCcc}
                onChange={e => setForm(p => ({ ...p, quantityCcc: e.target.value }))}/>
            </div>
            <div>
              <div style={{ fontSize: 9, color: '#86efac44', marginBottom: 4 }}>LIMIT PRICE (₹/CCC)</div>
              <input className="cd-inp" type="number" placeholder="e.g. 860"
                value={form.limitPriceInr}
                onChange={e => setForm(p => ({ ...p, limitPriceInr: e.target.value }))}/>
            </div>
          </div>
          <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 10,
            background: '#0a1628', border: '1px solid #60a5fa22', color: '#60a5fa88', lineHeight: 1.6 }}>
            ⚠ Orders are routed to {form.exchange} via their API. In stub mode (before API certification),
            orders are recorded in EtherTrack and simulated. Set {form.exchange}_API_KEY to enable live routing.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="cd-btn" onClick={submit} disabled={saving}>
              {saving ? '⏳ SUBMITTING...' : `SUBMIT TO ${form.exchange}`}
            </button>
            <button className="cd-btn-outline" onClick={() => setForm(null)}>CANCEL</button>
          </div>
        </div>
      )}
      {loading ? <Skel h={80}/> : orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px', color: '#86efac33', fontSize: 12 }}>
          No exchange orders yet.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 80px 80px 80px 90px', gap: 8,
            padding: '0 8px 8px', fontSize: 8, color: '#86efac44', letterSpacing: '.12em',
            borderBottom: '1px solid #0f2a1a' }}>
            <span>EXCHANGE</span><span>SIDE / QTY</span><span>LIMIT</span>
            <span>EXECUTED</span><span>PRICE</span><span>STATUS</span>
          </div>
          {orders.map(o => (
            <div key={o.id} style={{ display: 'grid',
              gridTemplateColumns: '80px 1fr 80px 80px 80px 90px', gap: 8,
              padding: '10px 8px', borderBottom: '1px solid #0f2a1a08',
              fontSize: 10, alignItems: 'center' }}>
              <span style={{ color: o.exchange === 'IEX' ? '#22c55e' : '#60a5fa' }}>{o.exchange}</span>
              <div>
                <div style={{ color: o.order_side === 'buy' ? '#22c55e' : '#f87171', fontWeight: 500 }}>
                  {o.order_side.toUpperCase()} {fmtNum(o.quantity_ccc)} CCCs
                </div>
                <div style={{ fontSize: 9, color: '#86efac33' }}>{fmtDate(o.created_at)}</div>
              </div>
              <span style={{ color: '#86efac77' }}>{o.limit_price_inr ? fmtINR(o.limit_price_inr) : '—'}</span>
              <span>{o.executed_quantity ? fmtNum(o.executed_quantity) : '—'}</span>
              <span>{o.executed_price_inr ? fmtINR(o.executed_price_inr) : '—'}</span>
              <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 10, textAlign: 'center',
                color: STATUS_COLOR_MAP[o.order_status] || '#86efac44',
                border: `1px solid ${STATUS_COLOR_MAP[o.order_status] || '#86efac22'}22`,
                background: '#060908' }}>
                {o.order_status?.toUpperCase()}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function GCISyncPanel({ onSync }) {
  const [history, setHistory]  = useState([]);
  const [loading, setLoading]  = useState(true);
  const [syncing, setSyncing]  = useState(false);
  const [msg,     setMsg]      = useState('');

  useEffect(() => {
    apiFetch('/api/ccc/gci/sync-history')
      .then(d => { setHistory(d?.history || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const sync = async () => {
    setSyncing(true); setMsg('');
    try {
      const data = await apiFetch('/api/ccc/gci/sync', { method: 'POST', body: JSON.stringify({}) });
      setMsg(data?.result?.isStub
        ? '✅ Sync simulated (stub mode — set GCI_API_KEY for live sync)'
        : `✅ Synced ${data?.result?.heldCCC} CCCs from GCI registry`);
      onSync?.();
      apiFetch('/api/ccc/gci/sync-history').then(d => setHistory(d?.history || []));
    } catch (e) {
      setMsg(`❌ Sync failed: ${e.message}`);
    } finally { setSyncing(false); }
  };

  const STATUS_COLOR_MAP = { success: '#22c55e', failed: '#f87171', pending: '#facc15', partial: '#fb923c' };

  return (
    <div className="cd-panel">
      <div className="cd-panel-title">GCI REGISTRY SYNC</div>
      <div style={{ fontSize: 11, color: '#86efac55', marginBottom: 14, lineHeight: 1.6 }}>
        Sync your CCC holding from the Grid Controller of India registry.
        When GCI_API_KEY is set, this pulls live data. Until then, it runs in stub mode.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className="cd-btn" style={{ flex: 1 }} onClick={sync} disabled={syncing}>
          {syncing ? '⏳ SYNCING WITH GCI...' : '🔄 SYNC FROM GCI REGISTRY'}
        </button>
      </div>
      {msg && (
        <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 14,
          background: msg.startsWith('✅') ? '#0d2e1f' : '#450a0a',
          border: `1px solid ${msg.startsWith('✅') ? '#22c55e33' : '#f8717133'}`,
          color: msg.startsWith('✅') ? '#22c55e' : '#f87171', fontSize: 11 }}>
          {msg}
        </div>
      )}
      <div style={{ fontSize: 9, color: '#86efac44', letterSpacing: '.12em', marginBottom: 8 }}>
        SYNC HISTORY
      </div>
      {loading ? <Skel h={60}/> : history.length === 0 ? (
        <div style={{ color: '#86efac33', fontSize: 11, textAlign: 'center', padding: '16px' }}>
          No sync history yet.
        </div>
      ) : (
        history.map(h => (
          <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between',
            padding: '8px 0', borderBottom: '1px solid #0f2a1a08', fontSize: 10 }}>
            <span style={{ color: '#86efac55' }}>{fmtDate(h.initiated_at)}</span>
            <span style={{ color: '#86efac77' }}>{h.sync_type?.replace('_', ' ').toUpperCase()}</span>
            <span style={{ color: STATUS_COLOR_MAP[h.status] || '#86efac44' }}>
              {h.status?.toUpperCase()}
            </span>
            {h.gci_reference_id && (
              <span style={{ fontSize: 9, color: '#86efac33' }}>{h.gci_reference_id}</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}