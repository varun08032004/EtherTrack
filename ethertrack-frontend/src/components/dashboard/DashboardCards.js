/**
 * components/dashboard/DashboardCards.jsx
 *
 * [FEAT-ESG-SUMMARY] EmissionOffsetCard now receives esgData + esgError + esgTs
 *   and displays:
 *     · Net emissions (gross − offsets purchased)
 *     · Offsets purchased this year (tCO₂ + spend ₹)
 *     · Carbon neutral badge when net ≤ 0
 *     · BRSR filed status
 *     · YoY change in emissions
 *   Falls back gracefully to old behaviour if esgData is null.
 *
 * All other cards unchanged.
 */

import React, { memo, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import s from './Dashboard.module.css';
import {
  ErrorCard, LastRefreshed, Spark,
  EmptyMarketState, ConnectWalletCTA,
} from './DashboardPrimitives';
import {
  fmt, calcEmissionOffset, buildPortfolioBreakdown,
  safeOpen, getTagColor,
} from '../../utils/dashboard';
import { EmissionArc } from './DashboardPrimitives';
import {
  TAG_COLORS, NEWS_SOURCE_LINKS,
  NETWORK_DISPLAY_NAME, CONTRACT_DISPLAY_NAME, NETWORK_COLOR,
} from '../../constants/dashboard';

// ── Portfolio Value card ───────────────────────────────────────────────────
export const PortfolioValueCard = memo(function PortfolioValueCard({
  totalPortfolioValue, totalCreditsOwned, pnl, pnlPct, statsTs, loading,
}) {
  return (
    <div className={`${s.card} ${s.c3}`} role="region" aria-label="Portfolio value">
      <div className={s.cardAccent} style={{ background: 'linear-gradient(90deg,#16a34a,#22c55e)' }} />
      <div className={s.clabel}>PORTFOLIO VALUE</div>
      <div className={s.cval} style={{ color: '#22c55e' }}>
        {loading
          ? <span className={s.shimmer} style={{ display: 'block', height: 32, width: 100 }} aria-label="Loading" />
          : `₹${(totalPortfolioValue / 100_000).toFixed(1)}L`}
      </div>
      <div className={s.csub}>{loading ? '—' : `${(totalCreditsOwned || 0).toLocaleString()} tCO₂ held`}</div>
      {pnl !== null && !loading && (
        <div className={pnl >= 0 ? `${s.cchg} ${s.pnlPos}` : `${s.cchg} ${s.pnlNeg}`}
          aria-label={`P&L: ${pnl >= 0 ? '+' : ''}${fmt(Math.round(pnl))} (${pnlPct}%)`}>
          {pnl >= 0 ? '▲' : '▼'} {fmt(Math.abs(Math.round(pnl)))} ({pnlPct}%)
        </div>
      )}
      {pnl === null && !loading && (
        <div className={s.cchg} style={{ color: '#22c55e22', fontSize: 11 }}>Cost basis unavailable</div>
      )}
      <LastRefreshed ts={statsTs} />
    </div>
  );
});

// ── INR Wallet card ────────────────────────────────────────────────────────
export const INRWalletCard = memo(function INRWalletCard({
  inrBalance, inrBalError, onRetry, onDeposit,
}) {
  return (
    <div className={`${s.card} ${s.c3}`} role="region" aria-label="INR wallet balance">
      <div className={s.cardAccent} style={{ background: 'linear-gradient(90deg,#22c55e,#4ade80)' }} />
      <div className={s.clabel}>INR WALLET</div>
      {inrBalError ? (
        <ErrorCard label="INR WALLET" onRetry={onRetry} />
      ) : inrBalance !== null ? (
        <>
          <div className={s.cval} style={{ color: '#4ade80' }}>{fmt(Math.round(inrBalance))}</div>
          <div className={s.csub}>Available to trade</div>
          <div className={s.cchg} style={{ color: '#4ade8055', fontSize: 11 }}>Deposit via UPI · NEFT · Net Banking</div>
        </>
      ) : (
        <>
          <div className={s.cval} style={{ color: '#4ade8044', fontSize: 14, marginBottom: 8 }}>₹0</div>
          <div className={s.csub} style={{ marginBottom: 8 }}>No INR deposited</div>
          <button className={s.depositBtn} onClick={onDeposit}>DEPOSIT VIA UPI →</button>
        </>
      )}
    </div>
  );
});

// ── ETH Wallet card ────────────────────────────────────────────────────────
export const ETHWalletCard = memo(function ETHWalletCard({
  walletBal, walletError, ethRate, ethRateIsStale, ethRateAgeMin, onRetry, onConnect,
}) {
  const inrValue = walletBal && ethRate
    ? fmt(Math.round(parseFloat(walletBal) * ethRate))
    : null;

  return (
    <div className={`${s.card} ${s.c3}`} role="region" aria-label="ETH wallet balance">
      <div className={s.cardAccent} style={{ background: 'linear-gradient(90deg,#60a5fa,#818cf8)' }} />
      <div className={s.clabel}>ETH WALLET</div>
      {walletError ? (
        <ErrorCard label="WALLET" onRetry={onRetry} />
      ) : walletBal ? (
        <>
          <div className={s.cval} style={{ color: '#60a5fa' }}>
            {walletBal}<span style={{ fontSize: 13, color: '#60a5fa66' }}> ETH</span>
          </div>
          <div className={s.csub}>
            {inrValue ? `≈ ${inrValue}` : <span className={s.shimmer} style={{ display: 'inline-block', width: 80, height: 14 }} />}
          </div>
          <div className={s.cchg} style={{ color: '#60a5fa55', fontSize: 11 }}>
            {ethRate
              ? `1 ETH = ₹${ethRate.toLocaleString('en-IN')}`
              : <span className={s.shimmer} style={{ display: 'inline-block', width: 100, height: 11 }} />}
            {ethRateIsStale && ethRateAgeMin !== null && (
              <div className={s.rateStaleWarn}>⚠ Rate {ethRateAgeMin}min old — fetching live price…</div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className={s.cval} style={{ color: '#60a5fa44', fontSize: 14, marginBottom: 8 }}>No wallet</div>
          <ConnectWalletCTA onConnect={onConnect} />
        </>
      )}
    </div>
  );
});

// ── Platform Trades card ───────────────────────────────────────────────────
export const PlatformTradesCard = memo(function PlatformTradesCard({
  platformStats, statsError, statsTs, onRetry,
}) {
  const trades = platformStats?.totalTrades    || 0;
  const volume = platformStats?.totalVolumeINR || 0;
  return (
    <div className={`${s.card} ${s.c3}`} role="region" aria-label="Platform trades">
      <div className={s.cardAccent} style={{ background: 'linear-gradient(90deg,#a78bfa,#c084fc)' }} />
      <div className={s.clabel}>PLATFORM TRADES</div>
      {statsError ? (
        <ErrorCard label="STATS" onRetry={onRetry} />
      ) : (
        <>
          <div className={s.cval} style={{ color: '#a78bfa' }}>{trades.toLocaleString()}</div>
          <div className={s.csub}>total on-chain trades</div>
          <div className={s.cchg} style={{ color: '#a78bfa33', fontSize: 11 }}>
            {volume > 0 ? `₹${(volume / 100_000).toFixed(1)}L total volume` : 'No trades yet'}
          </div>
          <LastRefreshed ts={statsTs} />
        </>
      )}
    </div>
  );
});

// ── Live Market card ───────────────────────────────────────────────────────
export const MarketCard = memo(function MarketCard({ listings, ethRate }) {
  const navigate = useNavigate();
  return (
    <div className={`${s.card} ${s.c8}`} role="region" aria-label="Live carbon credit market">
      <div className={s.clabel}>
        {listings.length > 0 ? `LIVE MARKET — ${listings.length} ON-CHAIN LISTINGS` : 'MARKET'}
        <span className={s.liveBadge} aria-hidden="true"><span className={s.ldot} />LIVE</span>
      </div>
      {listings.length > 0 ? (
        <>
          <div className={s.mrowHd} aria-hidden="true">
            <span>PROJECT</span><span>STD</span><span>PRICE (₹)</span>
            <span className={s.mobileHide}>VINTAGE</span>
            <span className={s.mobileHide}>TREND</span>
          </div>
          {listings.slice(0, 4).map((c, i) => {
            const priceINR = ethRate ? Math.round((c.adjPrice || 0) * ethRate) : null;
            const reg = { VCS: '#22c55e', GS: '#facc15', CDM: '#60a5fa', ACR: '#a78bfa' }[c.standard] || '#22c55e';
            const hasPH = Array.isArray(c.priceHistory) && c.priceHistory.length >= 2;
            return (
              <div key={`${c.id || i}-${i}`} className={s.mrow} role="row" tabIndex={0}
                aria-label={`${c.projectName}, ${c.standard}${priceINR ? `, ₹${priceINR.toLocaleString('en-IN')}` : ''}`}
                onClick={() => navigate('/carbon-credits')}
                onKeyDown={(e) => e.key === 'Enter' && navigate('/carbon-credits')}>
                <div>
                  <div style={{ fontSize: 12, color: '#f0fdf4', fontWeight: 600, marginBottom: 2 }}>{c.projectName}</div>
                  <div style={{ fontSize: 11, color: '#86efac99' }}>{c.serialNumber}</div>
                </div>
                <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 3, background: `${reg}22`, color: reg, border: `1px solid ${reg}33` }}>{c.standard}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>
                  {priceINR !== null ? `₹${priceINR.toLocaleString('en-IN')}` : <span className={s.shimmer} style={{ display: 'inline-block', width: 60, height: 14 }} />}
                </span>
                <span className={s.mobileHide} style={{ fontSize: 11, color: '#86efac66' }}>{c.vintageYear || '—'}</span>
                <span className={s.mobileHide}>
                  {hasPH ? <Spark data={c.priceHistory} color="#22c55e" /> : <span style={{ fontSize: 11, color: '#86efac22' }}>—</span>}
                </span>
              </div>
            );
          })}
        </>
      ) : (
        <EmptyMarketState onAction={() => navigate('/carbon-credits')} />
      )}
      {listings.length > 0 && (
        <button className={s.btnGhost} onClick={() => navigate('/carbon-credits')}>
          VIEW ALL {listings.length} LISTINGS →
        </button>
      )}
    </div>
  );
});

// ── Quick Actions card ─────────────────────────────────────────────────────
export const QuickActionsCard = memo(function QuickActionsCard({ isKYC, alertCount }) {
  const navigate = useNavigate();
  const actions = useMemo(() => [
    { icon: '🌿', label: 'BUY CREDITS',   path: '/carbon-credits',    color: '#22c55e', bg: '#0d2e1f', badge: alertCount > 0 ? alertCount : null },
    { icon: '📊', label: 'MY PORTFOLIO',  path: '/portfolio',         color: '#60a5fa', bg: '#0a1628' },
    { icon: '🏭', label: 'LOG EMISSIONS', path: '/emission-tracking', color: '#f97316', bg: '#1a0e00' },
    { icon: '📈', label: 'TRADE HISTORY', path: '/trading-history',   color: '#a78bfa', bg: '#120a28' },
    isKYC
      ? { icon: '🔥', label: 'RETIRE CREDITS', path: '/portfolio', color: '#22c55e', bg: '#0d2e1f' }
      : { icon: '🔐', label: 'KYC VERIFY',      path: '/kyc',      color: '#facc15', bg: '#1a1500' },
    { icon: '⚙️', label: 'SETTINGS', path: '/settings', color: '#4ade80', bg: '#052e16' },
  ], [isKYC, alertCount]);

  return (
    <div className={`${s.card} ${s.c4}`} role="region" aria-label="Quick navigation">
      <div className={s.clabel}>QUICK ACTIONS</div>
      <div className={s.actionsGrid}>
        {actions.map(({ icon, label, path, color, bg, badge }) => (
          <button key={label} className={s.actionBtn} style={{ background: bg }}
            onClick={() => navigate(path)} aria-label={label}>
            {badge && <span className={s.actionBadge} aria-label={`${badge} active alerts`}>{badge}</span>}
            <div className={s.actionIcon} aria-hidden="true">{icon}</div>
            <div className={s.actionLabel} style={{ color }}>{label}</div>
          </button>
        ))}
      </div>
    </div>
  );
});

// ── Emission Offset card ───────────────────────────────────────────────────
// [FEAT-ESG-SUMMARY] Now shows full ESG data when available:
//   · Net emissions (gross − offsets purchased this year)
//   · Carbon neutral badge
//   · Offsets spend in ₹
//   · BRSR filed status
//   · YoY change
// Falls back to old behaviour if esgData is null.
export const EmissionOffsetCard = memo(function EmissionOffsetCard({
  emissionsData, emissionsError, emissionsTs, totalRetiredCount, onRetry,
  esgData, esgError, esgTs,
}) {
  const navigate = useNavigate();

  // [FEAT-ESG-SUMMARY] Use ESG summary if available, else fall back to basic emissions
  const hasEsg = Boolean(esgData && !esgError);

  const grossEmissions   = hasEsg ? (esgData.emissions?.gross_tco2e   || 0) : (emissionsData?.totalEmitted || 0);
  const offsetPurchased  = hasEsg ? (esgData.offsets?.purchased_tco2e || 0) : totalRetiredCount;
  const netEmissions     = hasEsg ? (esgData.net?.net_emissions_tco2e ?? null) : null;
  const carbonNeutral    = hasEsg ? Boolean(esgData.net?.carbon_neutral)       : false;
  const offsetSpendINR   = hasEsg ? (esgData.offsets?.spend_inr        || 0)  : 0;
  const brsrFiled        = hasEsg ? Boolean(esgData.brsr?.filed)               : false;
  const yoyChange        = hasEsg ? (esgData.emissions?.yoy_change_pct ?? null): null;
  const tradeCount       = hasEsg ? (esgData.offsets?.trade_count       || 0)  : 0;
  const certCount        = hasEsg ? (esgData.offsets?.cert_count        || 0)  : totalRetiredCount;
  const offsetRatioPct   = hasEsg ? (esgData.net?.offset_ratio_pct     || 0)  : 0;

  const { pct, creditsRetiredButNoEmissions } = calcEmissionOffset(grossEmissions, certCount);
  const net = netEmissions !== null ? netEmissions : (grossEmissions > 0 ? Math.max(0, grossEmissions - offsetPurchased) : null);

  const displayError = emissionsError && esgError;

  return (
    <div className={`${s.card} ${s.c4}`} role="region" aria-label="Your emission offset progress">
      <div className={s.clabel}>
        {hasEsg ? 'ESG SUMMARY' : 'MY EMISSION OFFSET'}
        {' '}
        <span style={{ fontSize: 11, color: hasEsg ? '#22c55e33' : '#86efac33' }}>
          {hasEsg ? 'LIVE' : 'MY DATA'}
        </span>
        {/* [FEAT-ESG-SUMMARY] Carbon neutral badge */}
        {carbonNeutral && (
          <span style={{ marginLeft: 8, fontSize: 9, padding: '2px 7px', borderRadius: 10,
            background: '#0d2e1f', color: '#22c55e', border: '1px solid #22c55e33',
            letterSpacing: '.06em', fontWeight: 700 }}>
            🌿 CARBON NEUTRAL
          </span>
        )}
      </div>

      {displayError ? (
        <ErrorCard label="EMISSIONS" onRetry={onRetry} />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 0' }}>
            <EmissionArc pct={hasEsg ? offsetRatioPct : pct} creditsRetiredButNoEmissions={creditsRetiredButNoEmissions} />
            <div style={{ marginTop: -4, textAlign: 'center' }}>
              <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 30, fontWeight: 800, lineHeight: 1,
                color: carbonNeutral ? '#4ade80' : creditsRetiredButNoEmissions ? '#4ade80' : '#22c55e' }}>
                {carbonNeutral ? '✓' : creditsRetiredButNoEmissions ? '✓' : `${hasEsg ? Math.round(offsetRatioPct) : pct}%`}
              </div>
              <div style={{ fontSize: 11, color: '#86efac55', marginTop: 3, letterSpacing: '.06em' }}>
                {carbonNeutral
                  ? 'CARBON NEUTRAL THIS YEAR'
                  : creditsRetiredButNoEmissions
                  ? 'CREDITS RETIRED — LOG EMISSIONS TO TRACK %'
                  : grossEmissions > 0 ? 'OF EMISSIONS OFFSET' : 'LOG EMISSIONS TO TRACK'}
              </div>
            </div>
          </div>

          {/* [FEAT-ESG-SUMMARY] ESG data grid — shown when esgData available */}
          {hasEsg ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
              {[
                { l: 'GROSS EMISSIONS',  v: grossEmissions  > 0 ? `${grossEmissions.toLocaleString('en-IN', { maximumFractionDigits: 1 })} tCO₂` : '—', c: '#f87171' },
                { l: 'OFFSETS BOUGHT',   v: offsetPurchased > 0 ? `${offsetPurchased.toLocaleString('en-IN', { maximumFractionDigits: 1 })} tCO₂` : '—', c: '#22c55e' },
                { l: 'NET EMISSIONS',    v: net !== null          ? `${net.toLocaleString('en-IN', { maximumFractionDigits: 1 })} tCO₂`           : '—', c: carbonNeutral ? '#22c55e' : '#facc15' },
                { l: 'OFFSET SPEND',     v: offsetSpendINR  > 0 ? `₹${(offsetSpendINR / 1000).toFixed(1)}K`                                      : '—', c: '#60a5fa' },
                { l: 'TRADES',           v: tradeCount  > 0     ? `${tradeCount} trades`                                                           : '—', c: '#a78bfa' },
                { l: 'BRSR STATUS',      v: brsrFiled           ? '✓ Filed'                                                                        : '⚠ Not filed', c: brsrFiled ? '#22c55e' : '#f59e0b' },
              ].map(({ l, v, c }) => (
                <div key={l} style={{ background: '#060a07', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ fontSize: 10, color: '#86efac88', letterSpacing: '.06em', marginBottom: 3 }}>{l}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: c }}>{v}</div>
                </div>
              ))}
            </div>
          ) : (
            /* Fallback: original basic grid */
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
              {[
                { l: 'MY EMITTED',     v: grossEmissions > 0    ? `${grossEmissions} tCO₂`  : '—', c: '#f87171' },
                { l: 'MY RETIRED',     v: totalRetiredCount > 0 ? `${totalRetiredCount} tCO₂` : '—', c: '#22c55e' },
                { l: 'NET',            v: net !== null          ? `${net} tCO₂`              : '—', c: '#facc15' },
                { l: 'CREDITS BURNED', v: `${totalRetiredCount}`,                                   c: '#60a5fa' },
              ].map(({ l, v, c }) => (
                <div key={l} style={{ background: '#060a07', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, color: '#86efac88', letterSpacing: '.06em', marginBottom: 3 }}>{l}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: c }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {/* [FEAT-ESG-SUMMARY] YoY change strip */}
          {yoyChange !== null && (
            <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6,
              background: yoyChange > 0 ? '#1a070788' : '#0d2e1f88',
              border: `1px solid ${yoyChange > 0 ? '#f8717122' : '#22c55e22'}`,
              fontSize: 10, color: yoyChange > 0 ? '#f87171' : '#22c55e',
              display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{yoyChange > 0 ? '↑' : '↓'}</span>
              <span>
                Emissions {yoyChange > 0 ? '+' : ''}{yoyChange.toFixed(1)}% vs last year
              </span>
            </div>
          )}

          <LastRefreshed ts={hasEsg ? esgTs : emissionsTs} />
        </>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button className={s.btnGhost} style={{ flex: 1 }} onClick={() => navigate('/emission-tracking')}>
          LOG EMISSIONS →
        </button>
        {hasEsg && (
          <button className={s.btnGhost} style={{ flex: 1 }} onClick={() => navigate('/emission-tracking?tab=brsr')}>
            BRSR →
          </button>
        )}
      </div>
    </div>
  );
});

// ── Portfolio Breakdown card ───────────────────────────────────────────────
export const PortfolioBreakdownCard = memo(function PortfolioBreakdownCard({ activeCredits }) {
  const navigate = useNavigate();
  const breakdown = useMemo(() => buildPortfolioBreakdown(activeCredits), [activeCredits]);

  return (
    <div className={`${s.card} ${s.c4}`} role="region" aria-label="Portfolio breakdown by project">
      <div className={s.clabel}>PORTFOLIO BREAKDOWN <span style={{ fontSize: 11, color: '#22c55e33' }}>SNAPSHOT</span></div>
      {breakdown.length > 0 ? breakdown.map(({ name, std, credits, color, pct }) => (
        <div key={name} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 11, color: '#f0fdf4' }}>{name}</div>
              <div style={{ fontSize: 11, color: '#86efac99' }}>{std} · {credits.toLocaleString()} tCO₂</div>
            </div>
            <div style={{ fontSize: 11, color, fontWeight: 700 }}>{pct}%</div>
          </div>
          <div className={s.volBar} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${name} ${pct}% of portfolio`}>
            <div className={s.volFill} style={{ width: `${pct}%`, background: color }} />
          </div>
        </div>
      )) : (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#86efac22', fontSize: 11, lineHeight: 1.8 }}>
          No approved credits yet.<br />Submit credits for admin verification.
        </div>
      )}
      <button className={s.btnGhost} onClick={() => navigate('/portfolio')}>VIEW FULL PORTFOLIO →</button>
    </div>
  );
});

// ── Network Status card ────────────────────────────────────────────────────
export const NetworkStatusCard = memo(function NetworkStatusCard({
  networkStatus, ethRate, ethRateIsStale,
}) {
  const ncol = (st) => NETWORK_COLOR[st] || '#f87171';
  const rows = [
    { label: 'BLOCKCHAIN',     value: NETWORK_DISPLAY_NAME,  status: 'ONLINE', color: '#22c55e' },
    { label: 'SMART CONTRACT', value: CONTRACT_DISPLAY_NAME, status: 'ACTIVE', color: '#22c55e' },
    {
      label: 'BACKEND API',
      value: networkStatus.backend === 'ONLINE'
        ? `Connected${networkStatus.backendMs ? ` · ${networkStatus.backendMs}ms` : ''}`
        : networkStatus.backend === 'CHECKING' ? 'Checking…' : 'Degraded — retrying',
      status: networkStatus.backend,
      color:  ncol(networkStatus.backend),
    },
    {
      label: 'ETH/INR RATE',
      value: ethRate
        ? `₹${ethRate.toLocaleString('en-IN')}${ethRateIsStale ? ' (stale)' : ' · live'}`
        : 'Fetching…',
      status: !ethRate ? 'FETCHING' : ethRateIsStale ? 'STALE' : 'LIVE',
      color:  !ethRate ? '#facc15' : ethRateIsStale ? '#facc15' : '#22c55e',
    },
    { label: 'MARKET TYPE', value: 'Voluntary Carbon',  status: 'LIVE', color: '#60a5fa' },
    { label: 'CCTS STATUS', value: 'Integration Ready', status: 'BETA', color: '#a78bfa' },
  ];

  return (
    <div className={`${s.card} ${s.c4}`} role="region" aria-label="Platform network status">
      <div className={s.clabel}>NETWORK STATUS</div>
      {rows.map(({ label, value, status, color }) => (
        <div key={label} className={s.netRow}>
          <div>
            <div style={{ fontSize: 11, color: '#86efac99', letterSpacing: '.08em', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 11, color: '#f0fdf4' }}>{value}</div>
          </div>
          <span aria-label={`${label}: ${status}`}
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 3, letterSpacing: '.06em', background: `${color}18`, color, border: `1px solid ${color}33` }}>
            {['ONLINE', 'ACTIVE', 'LIVE'].includes(status) && (
              <span className={s.ldot} style={{ width: 4, height: 4, background: color }} aria-hidden="true" />
            )}
            {status}
          </span>
        </div>
      ))}
    </div>
  );
});

// ── News card ──────────────────────────────────────────────────────────────
export const NewsCard = memo(function NewsCard({ newsItems, newsLive, newsLoading }) {
  return (
    <div className={`${s.card} ${s.c8}`} role="region" aria-label="Carbon market news">
      <div className={s.clabel}>
        CARBON MARKET NEWS
        <span style={{ fontSize: 11, color: newsLive ? '#22c55e88' : '#86efac33' }} aria-live="polite">
          {newsLoading ? 'FETCHING LATEST…' : newsLive ? '● LIVE' : 'CURATED'}
        </span>
      </div>
      {newsItems.map((n, idx) => {
        const tc = getTagColor(n.tag);
        return (
          <div key={n.id || idx} className={s.newsItem} role="article" tabIndex={0}
            aria-label={`${n.tag}: ${n.title}`}
            onClick={() => safeOpen(n.url)}
            onKeyDown={(e) => e.key === 'Enter' && safeOpen(n.url)}>
            <span className={s.newsTag} style={{ background: tc.bg, color: tc.c, border: `1px solid ${tc.border}` }}>{n.tag}</span>
            <div style={{ flex: 1 }}>
              <div className={s.newsTitle}>{n.title}</div>
              <div className={s.newsSource}>
                {n.source}
                {n.publishedAt && ` · ${new Date(n.publishedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`}
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {NEWS_SOURCE_LINKS.map(({ label, url }) => (
          <a key={label} href={url} target="_blank" rel="noopener noreferrer" className={s.newsSrcLink}>{label} ↗</a>
        ))}
      </div>
    </div>
  );
});

// ── Recent Trades card ─────────────────────────────────────────────────────
export const RecentTradesCard = memo(function RecentTradesCard({
  myTrades, tradesError, tradesLoading, tradesTs, onRetry,
}) {
  const navigate = useNavigate();
  return (
    <div className={`${s.card} ${s.c4}`} role="region" aria-label="Recent trades" aria-busy={tradesLoading}>
      <div className={s.clabel}>
        RECENT TRADES
        <button style={{ cursor: 'pointer', color: '#22c55e44', fontSize: 11, background: 'none', border: 'none', fontFamily: 'inherit', padding: 0 }}
          onClick={() => navigate('/trading-history')} aria-label="View all trades">
          ALL →
        </button>
      </div>
      {tradesError ? (
        <ErrorCard label="TRADES" onRetry={onRetry} />
      ) : myTrades.length > 0 ? (
        myTrades.map((t, i) => {
          const isBuy    = t.tx_type === 'buy';
          const valueINR = t.total_price_inr || 0;
          return (
            <div key={t.id || i} className={s.tradeRow} role="row"
              aria-label={`${isBuy ? 'Buy' : 'Sell'} ${t.project_name} ${fmt(valueINR)}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 6, background: isBuy ? '#0d2e1f' : '#450a0a',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  color: isBuy ? '#22c55e' : '#f87171' }} aria-hidden="true">
                  <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1 }}>{isBuy ? '↓' : '↑'}</span>
                  <span style={{ fontSize: 9, letterSpacing: '.04em', lineHeight: 1.2 }}>{isBuy ? 'BUY' : 'SELL'}</span>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#f0fdf4' }}>{t.project_name || t.tx_type?.toUpperCase()}</div>
                  <div style={{ fontSize: 11, color: '#86efac99' }}>
                    {t.quantity} credits · {new Date(t.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: isBuy ? '#f87171' : '#22c55e' }}>
                  {isBuy ? '-' : '+'}{fmt(valueINR)}
                </div>
                <div style={{ fontSize: 11, color: '#86efac33', padding: '2px 6px', borderRadius: 3, background: '#0d2e1f' }}>
                  {t.standard || '—'}
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#86efac22', fontSize: 11, lineHeight: 1.8 }}>
          No trades yet.<br />Buy or sell credits to see history.
        </div>
      )}
      <LastRefreshed ts={tradesTs} />
      <button className={s.btnGhost} onClick={() => navigate('/trading-history')}>FULL HISTORY →</button>
    </div>
  );
});