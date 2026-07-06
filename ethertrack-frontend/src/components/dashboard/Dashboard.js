/**
 * Dashboard.jsx — EtherTrack v6 PRODUCTION
 *
 * [FEAT-ESG-SUMMARY]        EmissionOffsetCard receives esgData, esgError, esgTs
 * [FIX-PORTFOLIO-BREAKDOWN] PortfolioBreakdownCard now receives allActiveCredits
 *                           (myCredits + myBoughtCredits) instead of only myCredits.
 *                           Bought credits were silently excluded because activeCredits
 *                           was derived from myCredits alone.
 */

import React, { useContext, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { AuthContext }           from '../../App';
import { usePortfolio }          from '../../context/PortfolioContext';

import { DashboardErrorBoundary }   from './DashboardErrorBoundary';
import { SessionExpiredModal,
         KYCSuccessBanner,
         KYCExpiryWarning,
         PageSkeleton,
         Clock }                    from './DashboardPrimitives';
import {
  PortfolioValueCard, INRWalletCard, ETHWalletCard, PlatformTradesCard,
  MarketCard, QuickActionsCard, EmissionOffsetCard,
  PortfolioBreakdownCard, NetworkStatusCard, NewsCard, RecentTradesCard,
} from './DashboardCards';
import { Ticker }                   from './Ticker';

import { useEthRate }           from '../../hooks/useEthRate';
import { useWalletBalance }     from '../../hooks/useWalletBalance';
import { useDashboardData }     from '../../hooks/useDashboardData';
import { useRefreshCooldown }   from '../../hooks/useRefreshCooldown';

import { calcPnL, getGreeting } from '../../utils/dashboard';
import s from './Dashboard.module.css';

function RefreshStatus({ isRefreshing }) {
  return (
    <div aria-live="polite" aria-atomic="true" className={s.srOnly}>
      {isRefreshing ? 'Refreshing dashboard data…' : ''}
    </div>
  );
}

function DashboardInner() {
  const { user, dbUser, kycCompleted } = useContext(AuthContext);
  const navigate = useNavigate();
  const {
    myCredits, myBoughtCredits, stats, listings, walletAddress,
    isKYCVerified, loading,
  } = usePortfolio();

  const { rate: ethRate, isStale: ethRateIsStale, ageMin: ethRateAgeMin, forceRefresh: refreshEthRate } = useEthRate();
  const { balance: walletBal, error: walletError, connectWallet, refetch: refetchWallet } = useWalletBalance(walletAddress);
  const { state: ds, actions }   = useDashboardData();
  const { cooldown, start: startCooldown, canRefresh } = useRefreshCooldown();

  const isKYC        = kycCompleted || isKYCVerified;
  const displayName  = dbUser?.full_name || user?.displayName || user?.email?.split('@')[0] || 'Trader';
  const firstName    = displayName.split(' ')[0];
  const greeting     = getGreeting(new Date().getHours());
  const kycExpiresAt = dbUser?.kyc_expires_at || null;
  const isPageReady  = !ds.statsLoading && !ds.tradesLoading;

  const totalCreditsOwned   = stats?.totalCredits || 0;
  const totalPortfolioValue = stats?.totalValue   || 0;
  const totalRetiredCount   = stats?.retiredCount || 0;
  const costBasis           = stats?.costBasis    || 0;

  const pnlResult = useMemo(
    () => calcPnL(totalPortfolioValue, costBasis),
    [totalPortfolioValue, costBasis],
  );

  // [FIX-PORTFOLIO-BREAKDOWN] Include both owned and bought credits.
  // Previously only myCredits (owned/minted) was used, so bought credits
  // never appeared in the breakdown chart.
  const allActiveCredits = useMemo(() => {
    const owned  = myCredits.filter(c => c.status !== 'RETIRED');
    const bought = (myBoughtCredits || []).map(b => ({
      ...b,
      status:       'HELD',
      isBought:     true,
      heldCredits:  b.quantity || b.credits || 0,
      credits:      b.quantity || b.credits || 0,
    }));
    return [...owned, ...bought];
  }, [myCredits, myBoughtCredits]);

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
              {/* [FEAT-ESG-SUMMARY] esgData wired in */}
              <EmissionOffsetCard
                emissionsData={ds.emissionsData}
                emissionsError={ds.emissionsError}
                emissionsTs={ds.emissionsTs}
                totalRetiredCount={totalRetiredCount}
                onRetry={actions.fetchEmissions}
                esgData={ds.esgData}
                esgError={ds.esgError}
                esgTs={ds.esgTs}
              />

              {/* [FIX-PORTFOLIO-BREAKDOWN] allActiveCredits includes bought credits */}
              <PortfolioBreakdownCard activeCredits={allActiveCredits} />

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

export default function Dashboard() {
  return (
    <DashboardErrorBoundary>
      <DashboardInner />
    </DashboardErrorBoundary>
  );
}