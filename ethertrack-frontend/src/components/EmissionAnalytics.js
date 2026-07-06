// src/components/EmissionAnalytics.jsx
// ── Owns the Analytics tab. Pure presentational component — calculation
//    logic lives in ../utils/emissionAnalyticsCalculations.js so it's
//    unit-testable independent of rendering.
//
// ── v3 (production-hardening pass):
//    [GAP-CLOSE-TESTABLE]  Math extracted to emissionAnalyticsCalculations.js
//                          (see its .test.js for the invariants it's held to).
//    [GAP-CLOSE-ERRBOUND]  Every chart wrapped in ChartErrorBoundary — a
//                          Chart.js render error now shows a graceful
//                          inline fallback instead of blanking the tab.
//    [GAP-CLOSE-PNG]       Monthly trend + YoY bridge charts get an "Export
//                          PNG" button for board decks (chart.toBase64Image).
//    [GAP-CLOSE-CLIPBOARD] Copy Summary button now has a distinct failure
//                          state instead of silently doing nothing.
//    [GAP-CLOSE-MULTIYEAR] Optional `multiYearSummaries` prop renders a
//                          multi-year stacked trend. Absent gracefully if
//                          the parent hasn't been updated to fetch it yet.
//    Bugs fixed from v2: future report years no longer flagged as having
//    "missing months"; KPI strip no longer stranded a 4th tile on a
//    3-column grid; anomaly values now use the shared fmt() formatter;
//    clickable rows are keyboard-accessible (role/tabIndex/onKeyDown).
//
// ── NOT closed here — these need a decision/change outside this file's
//    reach, not more frontend code (see the chat write-up for why):
//    - Per-facility / per-site breakdown — there is no facility/site field
//      on emission records in the current data model.
//    - True backend-side aggregation for very large record volumes (current
//      client-side math is fine at the existing limit=500 records/year cap).
//
// ── Props:
//    records              array   current-year normalised emission records
//    summary              object  server summary (monthlyTrend,
//                                  categoryBreakdown, yoyChange) or null
//    prevYearEmissions    array   prior-year records, or null
//    multiYearSummaries   array   optional. [{year, scope1, scope2, scope3}, ...]
//                                  sorted ascending. Renders nothing if absent.
//    year                 number  selected reporting year
//    profile              object  company profile (net_zero_year / target)
//    SC                   object  scope -> color map
//    CHART_OPTS           object  shared chart.js options from the parent
//    fmt                  fn      shared number formatter from the parent
//    onDrilldown          fn(scope:number)  jump to Ledger filtered by scope

import React, { useMemo, useState, useRef } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
  computeMissingMonths,
  computeAnomalies,
  computeWaterfall,
  buildNarrative,
  MONTHS,
} from '../utils/emissionAnalyticsCalculations';

// [GAP-CLOSE-ERRBOUND] Class component is required for error boundaries —
// hooks can't catch render errors. Scoped narrowly around each chart so one
// broken chart never takes the rest of Analytics down with it.
class ChartErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[EmissionAnalytics chart error]', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>
          This chart couldn't be rendered. The rest of Analytics is unaffected —
          try refreshing, or check the GHG Ledger directly for the underlying records.
        </div>
      );
    }
    return this.props.children;
  }
}

const exportChartPng = (chartRef, filename) => {
  const chart = chartRef.current;
  if (!chart) return;
  const url = chart.toBase64Image ? chart.toBase64Image() : chart.canvas?.toDataURL?.('image/png');
  if (!url) return;
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
};

export default function EmissionAnalytics({
  records = [],
  summary = null,
  prevYearEmissions = null,
  multiYearSummaries = null,
  year,
  profile = null,
  SC,
  CHART_OPTS,
  fmt,
  onDrilldown = () => {},
}) {
  const total = useMemo(() => records.reduce((s, r) => s + (r.co2e || 0), 0), [records]);

  const trendChartRef = useRef(null);
  const waterfallChartRef = useRef(null);

  // ── Monthly totals by scope, current year ──────────────────────────────
  const byMonthScope = useMemo(() => (sc) => MONTHS.map((_, i) => {
    const m = String(i + 1).padStart(2, '0');
    if (summary?.monthlyTrend?.length) {
      const row = summary.monthlyTrend.find(r => r.scope === sc && r.month === (i + 1));
      return parseFloat(row?.total_co2e || 0);
    }
    return records
      .filter(r => r.scope === sc && r.date?.includes(`${year}-${m}`))
      .reduce((s, r) => s + r.co2e, 0);
  }), [summary, records, year]);

  const prevTotalByMonth = useMemo(() => {
    if (!prevYearEmissions?.length) return null;
    return MONTHS.map((_, i) => {
      const m = String(i + 1).padStart(2, '0');
      return prevYearEmissions
        .filter(r => (r.date || '').slice(5, 7) === m)
        .reduce((s, r) => s + (r.co2e || 0), 0);
    });
  }, [prevYearEmissions]);

  const trendData = useMemo(() => ({
    labels: MONTHS,
    datasets: [
      { label: 'Scope 1', data: byMonthScope(1), borderColor: SC[1], backgroundColor: `${SC[1]}12`, fill: true, tension: .4, pointRadius: 3 },
      { label: 'Scope 2', data: byMonthScope(2), borderColor: SC[2], backgroundColor: `${SC[2]}12`, fill: true, tension: .4, pointRadius: 3 },
      { label: 'Scope 3', data: byMonthScope(3), borderColor: SC[3], backgroundColor: `${SC[3]}12`, fill: true, tension: .4, pointRadius: 3 },
      ...(prevTotalByMonth ? [{
        label: `Total ${year - 1}`,
        data: prevTotalByMonth,
        borderColor: '#5a7a96',
        borderDash: [4, 4],
        fill: false,
        tension: .4,
        pointRadius: 0,
        borderWidth: 1.5,
      }] : []),
    ],
  }), [byMonthScope, prevTotalByMonth, year, SC]);

  // ── Scope 2 dual reporting ──────────────────────────────────────────────
  const byMonthScope2 = useMemo(() => (method) => MONTHS.map((_, i) => {
    const m = String(i + 1).padStart(2, '0');
    const tag = method === 'location' ? 'Location-based' : 'Market-based';
    return records
      .filter(r => r.scope === 2 && r.category?.includes(tag) && r.date?.includes(`${year}-${m}`))
      .reduce((s, r) => s + r.co2e, 0);
  }), [records, year]);

  const scope2HasData = useMemo(() => records.some(r => r.scope === 2), [records]);

  const scope2DualData = useMemo(() => ({
    labels: MONTHS,
    datasets: [
      { label: 'Location-based', data: byMonthScope2('location'), borderColor: '#3b82f6', backgroundColor: '#3b82f612', fill: true, tension: .4, pointRadius: 3 },
      { label: 'Market-based',   data: byMonthScope2('market'),   borderColor: '#10b981', backgroundColor: '#10b98112', fill: true, tension: .4, pointRadius: 3 },
    ],
  }), [byMonthScope2]);

  // ── Category breakdown ──────────────────────────────────────────────────
  const catSource = useMemo(() => {
    if (summary?.categoryBreakdown?.length) return summary.categoryBreakdown;
    const c = {};
    records.forEach(r => { c[r.category || 'Other'] = (c[r.category || 'Other'] || 0) + r.co2e; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([category, total_co2e]) => ({ category, total_co2e }));
  }, [summary, records]);

  const catData = useMemo(() => ({
    labels: catSource.map(r => r.category),
    datasets: [{
      label: 'tCO2e',
      data: catSource.map(r => +parseFloat(r.total_co2e).toFixed(3)),
      backgroundColor: '#10b98120', borderColor: '#10b981', borderWidth: 2, borderRadius: 4,
    }],
  }), [catSource]);

  const biggestMover = useMemo(() => {
    if (!catSource.length || !total) return null;
    const top = catSource[0];
    return { name: top.category, share: (top.total_co2e / total) * 100 };
  }, [catSource, total]);

  const topActivities = useMemo(() => [...records].sort((a, b) => b.co2e - a.co2e).slice(0, 5), [records]);

  // ── KPI inputs ───────────────────────────────────────────────────────────
  const prevTotalAll = useMemo(
    () => (prevYearEmissions ? prevYearEmissions.reduce((s, r) => s + (r.co2e || 0), 0) : null),
    [prevYearEmissions]
  );

  const yoyPct = useMemo(() => {
    if (summary?.yoyChange != null) return summary.yoyChange;
    if (prevTotalAll == null || prevTotalAll === 0) return null;
    return ((total - prevTotalAll) / prevTotalAll) * 100;
  }, [summary, prevTotalAll, total]);

  const verifiedPct = useMemo(
    () => (records.length ? (records.filter(r => r.verified).length / records.length) * 100 : null),
    [records]
  );

  const recordsDeltaPct = useMemo(() => {
    if (!prevYearEmissions?.length) return null;
    return ((records.length - prevYearEmissions.length) / prevYearEmissions.length) * 100;
  }, [records, prevYearEmissions]);

  // [GAP-CLOSE-TESTABLE] Delegated to the pure calculations module
  const missingMonths = useMemo(() => computeMissingMonths(records, year), [records, year]);
  const anomalies = useMemo(() => computeAnomalies(records), [records]);
  const waterfall = useMemo(() => computeWaterfall(records, prevYearEmissions, year), [records, prevYearEmissions, year]);

  const waterfallData = useMemo(() => {
    if (!waterfall) return null;
    return { labels: waterfall.labels, datasets: [{ label: 'tCO2e', data: waterfall.bars, backgroundColor: waterfall.colors, borderRadius: 4 }] };
  }, [waterfall]);

  const waterfallOpts = useMemo(() => ({
    ...CHART_OPTS,
    plugins: {
      ...CHART_OPTS.plugins,
      legend: { display: false },
      tooltip: {
        ...CHART_OPTS.plugins?.tooltip,
        callbacks: {
          label: (ctx) => {
            const i = ctx.dataIndex;
            const delta = waterfall?.deltas?.[i];
            if (delta == null) {
              const v = Array.isArray(ctx.raw) ? ctx.raw[1] : ctx.raw;
              return `Total: ${fmt(v)} tCO2e`;
            }
            return `${delta > 0 ? '+' : ''}${fmt(delta)} tCO2e`;
          },
        },
      },
    },
  }), [CHART_OPTS, waterfall, fmt]);

  // [GAP-CLOSE-MULTIYEAR] Optional — absent gracefully until the parent
  // fetches and passes it.
  const multiYearData = useMemo(() => {
    if (!multiYearSummaries?.length) return null;
    return {
      labels: multiYearSummaries.map(s => `FY ${s.year}`),
      datasets: [
        { label: 'Scope 1', data: multiYearSummaries.map(s => s.scope1 || 0), backgroundColor: SC[1] },
        { label: 'Scope 2', data: multiYearSummaries.map(s => s.scope2 || 0), backgroundColor: SC[2] },
        { label: 'Scope 3', data: multiYearSummaries.map(s => s.scope3 || 0), backgroundColor: SC[3] },
      ],
    };
  }, [multiYearSummaries, SC]);

  const multiYearOpts = useMemo(() => ({
    ...CHART_OPTS,
    scales: {
      ...CHART_OPTS.scales,
      x: { ...CHART_OPTS.scales?.x, stacked: true },
      y: { ...CHART_OPTS.scales?.y, stacked: true },
    },
  }), [CHART_OPTS]);

  // [GAP-CLOSE-TESTABLE] Narrative built via the pure function
  const narrative = useMemo(() => buildNarrative({
    year, total, recordCount: records.length, yoyPct, biggestMover, profile,
    prevTotalAll, verifiedPct, missingMonths, anomalies, fmt,
  }), [year, total, records.length, yoyPct, biggestMover, profile, prevTotalAll, verifiedPct, missingMonths, anomalies, fmt]);

  // [GAP-CLOSE-CLIPBOARD] Distinct failure state — previously failed silently
  const [copyState, setCopyState] = useState('idle'); // idle | copied | failed
  const handleCopy = () => {
    if (!navigator.clipboard?.writeText) {
      setCopyState('failed');
      setTimeout(() => setCopyState('idle'), 2500);
      return;
    }
    navigator.clipboard.writeText(narrative)
      .then(() => { setCopyState('copied'); setTimeout(() => setCopyState('idle'), 2000); })
      .catch(() => { setCopyState('failed'); setTimeout(() => setCopyState('idle'), 2500); });
  };
  const copyLabel = copyState === 'copied' ? 'COPIED ✓' : copyState === 'failed' ? 'COPY FAILED — SELECT TEXT' : 'COPY SUMMARY';

  if (records.length === 0) {
    return (
      <div className="em-card" style={{ textAlign: 'center', padding: 48, color: 'var(--mut)', fontSize: 12 }}>
        No emissions logged for FY {year} yet — log activity to see trends, YoY analysis, and data quality checks here.
      </div>
    );
  }

  const dataFlagCount = anomalies.length + missingMonths.length;
  const kpis = [
    { label: 'YOY CHANGE', value: yoyPct != null ? `${yoyPct > 0 ? '+' : ''}${fmt(yoyPct, 1)}%` : '—', color: yoyPct == null ? 'var(--mut)' : yoyPct > 0 ? 'var(--red)' : 'var(--grn)' },
    { label: 'VERIFIED RECORDS', value: verifiedPct != null ? `${fmt(verifiedPct, 1)}%` : '—', color: verifiedPct == null ? 'var(--mut)' : verifiedPct >= 80 ? 'var(--grn)' : verifiedPct >= 50 ? 'var(--ylw)' : 'var(--red)' },
    { label: 'RECORDS LOGGED', value: `${records.length}${recordsDeltaPct != null ? ` (${recordsDeltaPct > 0 ? '+' : ''}${fmt(recordsDeltaPct, 0)}%)` : ''}`, color: 'var(--txt)' },
    { label: 'DATA QUALITY FLAGS', value: String(dataFlagCount), color: dataFlagCount === 0 ? 'var(--grn)' : 'var(--ylw)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div className="em-card">
        <div className="em-ctit">
          EXECUTIVE SUMMARY · FY {year}
          <span className="em-ctit-action">
            <button className="em-btn em-btn-g em-btn-sm" onClick={handleCopy}>{copyLabel}</button>
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.9 }}>{narrative}</div>
      </div>

      <div className="em-esg-g" style={{ marginBottom: 0, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {kpis.map(({ label, value, color }) => (
          <div key={label} className="em-fw">
            <div style={{ fontSize: 9, letterSpacing: '.1em', color: 'var(--mut)', marginBottom: 8, textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 20, fontWeight: 800, color }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="em-g2">
        <div className="em-card">
          <div className="em-ctit">
            MONTHLY TREND BY SCOPE · {year}
            {prevTotalByMonth && (
              <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--mut)', fontWeight: 400, letterSpacing: '.04em', textTransform: 'none' }}>
                vs {year - 1} total (dashed)
              </span>
            )}
            <span className="em-ctit-action">
              <button className="em-btn em-btn-g em-btn-sm" onClick={() => exportChartPng(trendChartRef, `ghg_trend_fy${year}.png`)}>
                EXPORT PNG
              </button>
            </span>
          </div>
          <ChartErrorBoundary>
            <div className="em-chart-wrap"><Line ref={trendChartRef} data={trendData} options={CHART_OPTS} /></div>
          </ChartErrorBoundary>
        </div>

        <div className="em-card">
          <div className="em-ctit">
            YOY CARBON BRIDGE · FY {year - 1} → FY {year}
            {waterfallData && (
              <span className="em-ctit-action">
                <button className="em-btn em-btn-g em-btn-sm" onClick={() => exportChartPng(waterfallChartRef, `ghg_yoy_bridge_fy${year}.png`)}>
                  EXPORT PNG
                </button>
              </span>
            )}
          </div>
          {waterfallData ? (
            <>
              <ChartErrorBoundary>
                <div className="em-chart-wrap"><Bar ref={waterfallChartRef} data={waterfallData} options={waterfallOpts} /></div>
              </ChartErrorBoundary>
              <div style={{ fontSize: 9, color: 'var(--mut)', marginTop: 8, lineHeight: 1.6 }}>
                Shows exactly which scope drove the year-on-year change. Red segments grew emissions, green segments reduced them.
              </div>
            </>
          ) : (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>
              No FY {year - 1} baseline yet — add prior-year records to see the YoY bridge.
            </div>
          )}
        </div>
      </div>

      {/* [GAP-CLOSE-MULTIYEAR] Renders only once the parent supplies it */}
      {multiYearData && (
        <div className="em-card">
          <div className="em-ctit">MULTI-YEAR EMISSIONS TREND</div>
          <ChartErrorBoundary>
            <div className="em-chart-wrap"><Bar data={multiYearData} options={multiYearOpts} /></div>
          </ChartErrorBoundary>
        </div>
      )}

      <div className="em-g2">
        <div className="em-card">
          <div className="em-ctit">SCOPE 2 — LOCATION VS MARKET-BASED · {year}</div>
          {scope2HasData ? (
            <>
              <ChartErrorBoundary>
                <div className="em-chart-wrap"><Line data={scope2DualData} options={CHART_OPTS} /></div>
              </ChartErrorBoundary>
              <div style={{ fontSize: 9, color: 'var(--mut)', marginTop: 8, lineHeight: 1.6 }}>
                GHG Protocol Scope 2 Guidance requires dual reporting. The gap between the lines
                reflects RECs, PPAs, or green tariffs applied against grid-average emissions.
              </div>
            </>
          ) : (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--mut)', fontSize: 11 }}>
              No Scope 2 records logged for {year} yet.
            </div>
          )}
        </div>

        <div className="em-card">
          <div className="em-ctit">EMISSIONS BY CATEGORY (tCO2e)</div>
          <ChartErrorBoundary>
            <div className="em-chart-wrap"><Bar data={catData} options={CHART_OPTS} /></div>
          </ChartErrorBoundary>
        </div>
      </div>

      <div className="em-card">
        <div className="em-ctit">DATA QUALITY & AUDIT READINESS</div>

        {dataFlagCount === 0 ? (
          <div className="em-alert em-alg">
            <span className="em-alert-icon">✓</span>
            <span>No data quality issues detected across {records.length} records checked.</span>
          </div>
        ) : (
          <>
            {missingMonths.length > 0 && (
              <div className="em-alert em-aly" style={{ marginBottom: 12 }}>
                <span className="em-alert-icon">⚠</span>
                <span>No activity logged for <strong>{missingMonths.join(', ')}</strong>. Auditors and BRSR/CDP reviewers will flag data gaps.</span>
              </div>
            )}
            {anomalies.length > 0 && (
              <>
                <div style={{ fontSize: 10, letterSpacing: '.1em', color: 'var(--mut)', marginBottom: 8 }}>
                  POTENTIAL ENTRY ERRORS — {anomalies.length} flagged
                </div>
                {anomalies.map((r, i) => (
                  <div
                    key={r.id || i}
                    onClick={() => onDrilldown(r.scope)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDrilldown(r.scope); } }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', padding: '10px 12px',
                      borderRadius: 6, marginBottom: 6, cursor: 'pointer',
                      background: '#f59e0b08', border: '1px solid #f59e0b28',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#f59e0b14'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = '#f59e0b08'; }}
                  >
                    <span style={{ fontSize: 11 }}>
                      <span style={{ color: SC[r.scope], marginRight: 8 }}>S{r.scope}</span>{r.activity}
                      <span style={{ color: 'var(--mut)', fontSize: 11, display: 'block' }}>{r.date}</span>
                    </span>
                    <span style={{ textAlign: 'right', fontSize: 11 }}>
                      <span style={{ color: 'var(--ylw)', fontWeight: 700 }}>{fmt(r.co2e, 3)} t</span>
                      <span style={{ color: 'var(--mut)', display: 'block' }}>activity avg {fmt(r.activityMean, 3)} t</span>
                    </span>
                  </div>
                ))}
                <div style={{ fontSize: 9, color: 'var(--mut)', marginTop: 6, opacity: .6 }}>
                  Flagged when a value is 2.5+ standard deviations from that activity's typical entry. Click to review in the GHG Ledger.
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="em-card">
        <div className="em-ctit">TOP 5 EMITTING ACTIVITIES</div>
        {topActivities.map((r, i) => (
          <div
            key={r.id || i}
            onClick={() => onDrilldown(r.scope)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDrilldown(r.scope); } }}
            style={{
              display: 'flex', justifyContent: 'space-between', padding: '10px 0',
              borderBottom: '1px solid var(--brd)44', fontSize: 12, cursor: 'pointer',
              borderRadius: 6, transition: 'background .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surf2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ color: 'var(--mut)' }}>
              <span style={{ color: SC[r.scope], marginRight: 8, fontSize: 11 }}>S{r.scope}</span>{r.activity}
              <span style={{ color: 'var(--mut)', fontSize: 11, display: 'block' }}>{r.date} · {r.notes}</span>
            </span>
            <span style={{ color: SC[r.scope], fontWeight: 700, flexShrink: 0, marginLeft: 12 }}>
              {(r.co2e || 0).toFixed(3)} t
            </span>
          </div>
        ))}
        <div style={{ fontSize: 9, color: 'var(--mut)', marginTop: 6, opacity: .6 }}>
          Click a row to view that scope in the GHG Ledger
        </div>
      </div>
    </div>
  );
}