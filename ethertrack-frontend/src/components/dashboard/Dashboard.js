/**
 * Dashboard.jsx — EtherTrack v6 PRODUCTION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Architecture:
 *   Dashboard (error boundary wrapper)
 *     └─ DashboardInner (orchestrator — reads hooks, passes slices to cards)
 *          ├─ useEthRate()          — ETH/INR rate, circuit breaker, stale detection
 *          ├─ useWalletBalance()    — MetaMask + fallback RPC
 *          ├─ useDashboardData()    — all API data, retry, polling
 *          ├─ useRefreshCooldown()  — button countdown, no cascade re-renders
 *          │
 *          ├─ Ticker               — CSS animation, IntersectionObserver, no RAF
 *          ├─ SessionExpiredModal  — focus trap, createPortal
 *          ├─ KYCSuccessBanner / KYCExpiryWarning
 *          ├─ PageSkeleton         — shown while critical data loads
 *          │
 *          └─ [12 card components] — each memo-wrapped, receives own state slice only
 *               PortfolioValueCard · INRWalletCard · ETHWalletCard · PlatformTradesCard
 *               MarketCard · QuickActionsCard · EmissionOffsetCard
 *               PortfolioBreakdownCard · NetworkStatusCard · NewsCard · RecentTradesCard
 *
 * All critical audit fixes applied:
 *   ✅ No hardcoded ethRate fallback — null until fetched, skeleton shown
 *   ✅ CSS Modules — no 'unsafe-inline' CSP requirement
 *   ✅ DashboardInner split into hooks + card components (was 900-line God Component)
 *   ✅ SessionExpiredModal has focus trap + proper aria attributes
 *   ✅ Circuit breaker on all external API families
 *   ✅ Exponential backoff with jitter via withRetry()
 *   ✅ Fallback RPC chain: MetaMask → Alchemy → Infura → public
 *   ✅ safeOpen() validates against allowlisted news domains (not just https:)
 *   ✅ RAF ticker replaced with CSS animation + IntersectionObserver
 *   ✅ tickerItems: 2 copies (CSS) instead of 3 (DOM), stable id-based keys
 *   ✅ Priority loading: critical data first (stats/trades/inr), secondary after
 *   ✅ Health check polls every 15 s (was 60 s)
 *   ✅ NETWORK_DISPLAY_NAME / CONTRACT_DISPLAY_NAME from env (not hardcoded)
 *   ✅ fmt() guards against NaN/undefined
 *   ✅ Financial calculations extracted to pure testable functions
 *   ✅ console.warn → Sentry for hostname-blocked wallet connect
 *   ✅ Refresh cooldown initialises from localStorage (survives F5)
 *   ✅ All state scoped — a rate tick doesn't re-render the news list
 */

import React, { useContext, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthContext }           from '../../App';                          // FIX: was ../App
import { usePortfolio }          from '../../context/PortfolioContext';     // FIX: was ../context/PortfolioContext

import { DashboardErrorBoundary }   from './DashboardErrorBoundary';        // FIX: was ./dashboard/DashboardErrorBoundary
import { SessionExpiredModal,
         KYCSuccessBanner,
         KYCExpiryWarning,
         PageSkeleton,
         Clock }                    from './DashboardPrimitives';           // FIX: was ./dashboard/DashboardPrimitives (merged Clock import too)
import {
  PortfolioValueCard, INRWalletCard, ETHWalletCard, PlatformTradesCard,
  MarketCard, QuickActionsCard, EmissionOffsetCard,
  PortfolioBreakdownCard, NetworkStatusCard, NewsCard, RecentTradesCard,
} from './DashboardCards';                                                  // FIX: was ./dashboard/DashboardCards
import { Ticker }                   from './Ticker';                        // FIX: was ./dashboard/Ticker

import { useEthRate }           from '../../hooks/useEthRate';              // FIX: was ../hooks/useEthRate
import { useWalletBalance }     from '../../hooks/useWalletBalance';        // FIX: was ../hooks/useWalletBalance
import { useDashboardData }     from '../../hooks/useDashboardData';        // FIX: was ../hooks/useDashboardData
import { useRefreshCooldown }   from '../../hooks/useRefreshCooldown';      // FIX: was ../hooks/useRefreshCooldown

import { calcPnL, getGreeting } from '../../utils/dashboard';              // FIX: was ../utils/dashboard
import s from './Dashboard.module.css';                                     // FIX: was ./dashboard/Dashboard.module.css

// ── Status region — announces refresh state to screen readers ──────────────
function RefreshStatus({ isRefreshing }) {
  return (
    <div aria-live="polite" aria-atomic="true" className={s.srOnly}>
      {isRefreshing ? 'Refreshing dashboard data…' : ''}
    </div>
  );
}

// ── DashboardInner ─────────────────────────────────────────────────────────
function DashboardInner() {
  const { user, dbUser, kycCompleted } = useContext(AuthContext);
  const navigate = useNavigate();
  const {
    myCredits, stats, listings, walletAddress,
    isKYCVerified, loading,
  } = usePortfolio();

  // ── Domain hooks (each manages its own re-render surface) ──────────────
  const { rate: ethRate, isStale: ethRateIsStale, ageMin: ethRateAgeMin, forceRefresh: refreshEthRate } = useEthRate();
  const { balance: walletBal, error: walletError, connectWallet, refetch: refetchWallet } = useWalletBalance(walletAddress);
  const { state: ds, actions }   = useDashboardData();
  const { cooldown, start: startCooldown, canRefresh } = useRefreshCooldown();

  // ── Derived display values ─────────────────────────────────────────────
  const isKYC       = kycCompleted || isKYCVerified;
  const displayName = dbUser?.full_name || user?.displayName || user?.email?.split('@')[0] || 'Trader';
  const firstName   = displayName.split(' ')[0];
  const greeting    = getGreeting(new Date().getHours());
  const kycExpiresAt = dbUser?.kyc_expires_at || null;
  const isPageReady  = !ds.statsLoading && !ds.tradesLoading;

  // Portfolio maths — pure, memoized
  const totalCreditsOwned   = stats?.totalCredits || 0;
  const totalPortfolioValue = stats?.totalValue   || 0;
  const totalRetiredCount   = stats?.retiredCount || 0;
  const costBasis           = stats?.costBasis    || 0;
  const pnlResult = useMemo(
    () => calcPnL(totalPortfolioValue, costBasis),
    [totalPortfolioValue, costBasis],
  );

  const activeCredits = useMemo(
    () => myCredits.filter((c) => c.status !== 'RETIRED'),
    [myCredits],
  );

  // ── Refresh handler ────────────────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    if (!canRefresh) return;
    startCooldown();
    await actions.refresh(refreshEthRate);
    await refetchWallet();
  }, [canRefresh, startCooldown, actions, refreshEthRate, refetchWallet]);

  return (
    <>
      <SessionExpiredModal visible={ds.sessionExpired} />
      <RefreshStatus isRefreshing={ds.isRefreshing} />

      <div className={s.d} role="main" aria-label="EtherTrack Dashboard">
        <div className={s.dw}>

          {/* Live ticker */}
          <Ticker listings={listings} ethRate={ethRate} />

          {/* Topbar */}
          <div className={s.topbar}>
            <div>
              <div className={s.greeting}>
                {greeting}, <span>{firstName}</span> 👋
              </div>
              <div className={s.sub}>
                {isKYC ? '✅ KYC VERIFIED · FULL ACCESS' : '⚠️ COMPLETE KYC TO UNLOCK TRADING'}
                {' · '}ETHERTRACK CARBON EXCHANGE
              </div>
              <button
                className={s.refreshBtn}
                onClick={handleRefresh}
                disabled={!canRefresh}
                aria-label={canRefresh ? 'Refresh all dashboard data' : `Refresh available in ${cooldown}s`}
              >
                <span className={ds.isRefreshing ? s.spin : ''} style={{ marginRight: 5 }}>↻</span>
                {ds.isRefreshing ? 'REFRESHING…' : cooldown > 0 ? `REFRESH IN ${cooldown}s` : 'REFRESH DATA'}
              </button>
            </div>
            <div className={s.clockHide}><Clock /></div>
          </div>

          {/* Pending tx banner */}
          {ds.pendingTxCount > 0 && (
            <div className={s.pendingBanner} role="status" aria-live="polite">
              <span className={s.ldot} style={{ background: '#60a5fa' }} aria-hidden="true" />
              ⏳ {ds.pendingTxCount} transaction{ds.pendingTxCount > 1 ? 's' : ''} confirming on-chain — this may take a few minutes
            </div>
          )}

          {/* Alert strip */}
          {ds.alertCount > 0 && (
            <div className={s.alertStrip} role="status" aria-live="polite">
              <span>🔔</span>
              <span>{ds.alertCount} active price alert{ds.alertCount > 1 ? 's' : ''} — go to the exchange to manage them</span>
              <button className={s.alertViewBtn} onClick={() => navigate('/carbon-credits')}>VIEW →</button>
            </div>
          )}

          {/* KYC banners */}
          {!isKYC && (
            <div className={s.kycBanner} role="alert">
              <div>
                <div style={{ fontSize: 12, color: '#facc15', fontWeight: 700, marginBottom: 2 }}>⚠️ KYC Verification Required</div>
                <div style={{ fontSize: 11, color: '#facc1566', letterSpacing: '.06em' }}>
                  Complete KYC to access trading, portfolio management and emission tracking.
                </div>
              </div>
              <button className={s.kycBtn} onClick={() => navigate('/kyc')}>VERIFY NOW →</button>
            </div>
          )}
          {isKYC && kycExpiresAt && <KYCExpiryWarning expiresAt={kycExpiresAt} onNavigate={navigate} />}
          {isKYC && <KYCSuccessBanner kycCompleted={isKYC} />}

          {/* Main grid */}
          {!isPageReady ? <PageSkeleton /> : (
            <div className={s.grid}>

              {/* Row 1 — Stats */}
              <PortfolioValueCard
                totalPortfolioValue={totalPortfolioValue}
                totalCreditsOwned={totalCreditsOwned}
                pnl={pnlResult?.pnl ?? null}
                pnlPct={pnlResult?.pnlPct ?? null}
                statsTs={ds.statsTs}
                loading={loading.credits}
              />
              <INRWalletCard
                inrBalance={ds.inrBalance}
                inrBalError={ds.inrBalError}
                onRetry={actions.fetchInrBalance}
                onDeposit={() => navigate('/wallet')}
              />
              <ETHWalletCard
                walletBal={walletBal}
                walletError={walletError}
                ethRate={ethRate}
                ethRateIsStale={ethRateIsStale}
                ethRateAgeMin={ethRateAgeMin}
                onRetry={refetchWallet}
                onConnect={connectWallet}
              />
              <PlatformTradesCard
                platformStats={ds.platformStats}
                statsError={ds.statsError}
                statsTs={ds.statsTs}
                onRetry={actions.fetchStats}
              />

              {/* Row 2 — Market + Actions */}
              <MarketCard listings={listings} ethRate={ethRate} />
              <QuickActionsCard isKYC={isKYC} alertCount={ds.alertCount} />

              {/* Row 3 — Emissions + Portfolio + Network */}
              <EmissionOffsetCard
                emissionsData={ds.emissionsData}
                emissionsError={ds.emissionsError}
                emissionsTs={ds.emissionsTs}
                totalRetiredCount={totalRetiredCount}
                onRetry={actions.fetchEmissions}
              />
              <PortfolioBreakdownCard activeCredits={activeCredits} />
              <NetworkStatusCard
                networkStatus={ds.networkStatus}
                ethRate={ethRate}
                ethRateIsStale={ethRateIsStale}
              />

              {/* Row 4 — News + Trades */}
              <NewsCard
                newsItems={ds.newsItems}
                newsLive={ds.newsLive}
                newsLoading={ds.newsLoading}
              />
              <RecentTradesCard
                myTrades={ds.myTrades}
                tradesError={ds.tradesError}
                tradesLoading={ds.tradesLoading}
                tradesTs={ds.tradesTs}
                onRetry={actions.fetchTrades}
              />

            </div>
          )}

          <footer className={s.dashFooter}>
            <span>ETHERTRACK © 2026 — INDIA'S CARBON CREDIT EXCHANGE</span>
            <span>ETHEREUM · VOLUNTARY MARKET · CCTS-READY</span>
          </footer>

        </div>
      </div>
    </>
  );
}

// ── Public export ──────────────────────────────────────────────────────────
export default function Dashboard() {
  return (
    <DashboardErrorBoundary>
      <DashboardInner />
    </DashboardErrorBoundary>
  );
}