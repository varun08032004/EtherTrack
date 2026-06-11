// App.jsx — EtherTrack v8 PRODUCTION
// ─────────────────────────────────────────────────────────────────────────────
// CHANGES vs v7:
//
// [INVITE-1] UserGuard saves invite token to sessionStorage before redirecting
//            unauthenticated users to /signup?invite=1 instead of /login.
//            New users can sign up first, then auto-accept the invite after login.
//
// [INVITE-2] handleLogin returns { dbUser, redirect } — Login.jsx uses the
//            redirect value to navigate to /join-org after login if a pending
//            invite token exists.
//
// [PLAN-GATE] Subscription tier locking retained from v7:
//          FREE      — dashboard, carbon-credits, trading-history, wallet, profile/settings/notifications/billing
//          STARTER   — + portfolio
//          GROWTH    — + emission-tracking
//          CORPORATE — + compliance, team (everything unlocked)
//
// [KYC-1]  handleKycComplete sets kyc_status + kyc_tier (retained from v7)
//
// [PLAN-SYNC] Background poll every 5 mins retained from v7
// ─────────────────────────────────────────────────────────────────────────────

import React, {
  useState, useEffect, useCallback, useMemo,
  lazy, Suspense, createContext, useContext,
} from 'react';
import {
  BrowserRouter as Router,
  Route, Routes, Navigate, useNavigate,
} from 'react-router-dom';
import * as Sentry from '@sentry/react';

import './App.css';
import './index.css';

// ── Eagerly loaded ────────────────────────────────────────────────────────────
import Login             from './components/Login';
import Signup            from './components/Signup';
import Header            from './components/Header';
import KYCForm           from './components/KYCForm';
import KYCGate           from './components/KYCGate';
import AdminDashboard    from './components/AdminDashboard';
import VerifyCertificate from './components/VerifyCertificate';
import JoinOrg           from './components/JoinOrg';
import PlanSelection     from './components/PlanSelection';
import Dashboard         from './components/dashboard/Dashboard';

import { NotificationProvider } from './context/NotificationContext';
import { PortfolioProvider }    from './context/PortfolioContext';
import { authAPI }              from './services/api';

// ── Lazily loaded ─────────────────────────────────────────────────────────────
const Profile             = lazy(() => import('./components/Profile'));
const EditProfile         = lazy(() => import('./components/EditProfile'));
const EmissionTracking    = lazy(() => import('./components/EmissionTracking'));
const CarbonCredits       = lazy(() => import('./components/CarbonCredits'));
const TradingHistory      = lazy(() => import('./components/TradingHistory'));
const Portfolio           = lazy(() => import('./components/Portfolio'));
const TeamManagement      = lazy(() => import('./components/TeamManagement'));
const Wallet              = lazy(() => import('./components/Wallet'));
const SubscriptionBilling = lazy(() => import('./components/SubscriptionBilling'));

const ComplianceDashboard = lazy(() =>
  import('./components/ComplianceDashboard').catch(() => ({
    default: () => <ComingSoon label="Compliance Dashboard" />,
  }))
);
const Settings = lazy(() =>
  import('./components/Settings').catch(() => ({
    default: () => <ComingSoon label="Settings" />,
  }))
);
const Notifications = lazy(() =>
  import('./components/Notifications').catch(() => ({
    default: () => <ComingSoon label="Notifications" />,
  }))
);
const WalletMismatchBanner = lazy(() =>
  import('./components/WalletMismatchBanner').catch(() => ({
    default: () => null,
  }))
);
const Help = lazy(() =>
  import('./components/Help').catch(() => ({
    default: () => <ComingSoon label="Help" />,
  }))
);
const Feedback = lazy(() =>
  import('./components/Feedback').catch(() => ({
    default: () => <ComingSoon label="Feedback" />,
  }))
);
const TransactionStatus = lazy(() =>
  import('./components/TransactionStatus').catch(() => ({
    default: () => <ComingSoon label="Transaction Status" />,
  }))
);
const NotFound = lazy(() =>
  import('./components/NotFound').catch(() => ({
    default: () => <ComingSoon label="404 — Page not found" />,
  }))
);

// ── Constants ─────────────────────────────────────────────────────────────────
const USER_CACHE_EXPIRY_MS = 24 * 60 * 60 * 1_000;
const IS_DEV = process.env.NODE_ENV === 'development';

function devLog(...args) {
  if (IS_DEV) console.log(...args);
}

function getUserKey(email) { return `et:user_${email}`; }

function safeUserCache(userData) {
  return {
    email:       userData.email       || '',
    displayName: userData.displayName || userData.name || '',
    cachedAt:    Date.now(),
  };
}

function readUserCache(email) {
  try {
    const raw = localStorage.getItem(getUserKey(email));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - (parsed.cachedAt || 0) > USER_CACHE_EXPIRY_MS) {
      localStorage.removeItem(getUserKey(email));
      return null;
    }
    return parsed;
  } catch { return null; }
}

// ── Subscription tier helpers ─────────────────────────────────────────────────
const TIER_RANK = { free: 0, starter: 1, growth: 2, corporate: 3 };

function getPlanTier(plan) {
  if (!plan) return 'free';
  const p = plan.toLowerCase();
  if (p.includes('corporate')) return 'corporate';
  if (p.includes('growth'))    return 'growth';
  if (p.includes('starter'))   return 'starter';
  return 'free';
}

function tierRank(plan) {
  return TIER_RANK[getPlanTier(plan)] ?? 0;
}

const PLAN_INFO = {
  starter: {
    name:  'Starter',
    price: '₹1,000/mo',
    color: '#3b82f6',
    features: [
      'Everything in Free',
      'Portfolio management',
      'List & sell credits',
      'Credit retirement',
      'Portfolio export',
      '3 seats',
    ],
  },
  growth: {
    name:  'Growth',
    price: '₹10,000/mo',
    color: '#22c55e',
    features: [
      'Everything in Starter',
      'Scope 1, 2 & 3 emissions logging',
      'GHG inventory ledger + CSV export',
      'Analytics dashboard',
      'Carbon intensity metrics',
      'Decarbonisation scenarios',
      'GHG Protocol PDF report',
      '10 seats',
    ],
  },
  corporate: {
    name:  'Corporate',
    price: 'Contact Sales',
    color: '#f97316',
    features: [
      'Everything in Growth',
      'BRSR / CDP / TCFD / GHG PDF reports',
      'Audit trail + verifier integration',
      'GEI / BEE / PAT / CCTS compliance',
      '5-year decarbonisation plan',
      'MRV calendar + SBTi target setting',
      'Supplier data portal',
      'Multi-entity consolidation',
      'Custom seats',
    ],
  },
};

// ── Upgrade Modal ─────────────────────────────────────────────────────────────
function UpgradeModal({ requiredPlan, onClose }) {
  const info = PLAN_INFO[requiredPlan];
  if (!info) return null;
  const isCorporate = requiredPlan === 'corporate';

  return (
    <div
      onClick={onClose}
      style={{
        position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',
        backdropFilter:'blur(4px)',display:'flex',alignItems:'center',
        justifyContent:'center',zIndex:9999,padding:'20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background:'#0f1a10',border:`1px solid ${info.color}44`,
          borderRadius:'12px',padding:'32px',maxWidth:'440px',width:'100%',
          fontFamily:'monospace',position:'relative',
          boxShadow:`0 0 40px ${info.color}22`,
        }}
      >
        <button
          onClick={onClose}
          style={{position:'absolute',top:'16px',right:'16px',background:'none',
            border:'none',color:'#6b7280',fontSize:'18px',cursor:'pointer',lineHeight:1}}
        >✕</button>

        <div style={{fontSize:'32px',marginBottom:'12px'}}>🔒</div>
        <h2 style={{color:info.color,margin:'0 0 6px',fontSize:'20px'}}>
          {info.name} Plan Required
        </h2>
        <p style={{color:'#9ca3af',margin:'0 0 20px',fontSize:'13px',lineHeight:1.6}}>
          This feature is available on the{' '}
          <strong style={{color:info.color}}>{info.name}</strong> plan
          {!isCorporate && <> — starting at <strong style={{color:'#fff'}}>{info.price}</strong></>}.
        </p>

        <ul style={{margin:'0 0 24px',padding:0,listStyle:'none'}}>
          {info.features.map((f) => (
            <li key={f} style={{display:'flex',alignItems:'flex-start',gap:'8px',
              color:'#d1fae5',fontSize:'13px',marginBottom:'8px'}}>
              <span style={{color:info.color,flexShrink:0,marginTop:'1px'}}>✓</span>
              {f}
            </li>
          ))}
        </ul>

        {isCorporate ? (
          <a href="https://mail.google.com/mail/?view=cm&to=support@ethertrack.in" target="_blank" rel="noreferrer" style={{
            display:'block',textAlign:'center',padding:'12px',
            background:info.color,color:'#000',borderRadius:'6px',
            fontWeight:'bold',fontSize:'14px',textDecoration:'none',letterSpacing:'0.5px',
          }}>
            Contact Sales → sales@ethertrack.in
          </a>
        ) : (
          <a href="/billing" style={{
            display:'block',textAlign:'center',padding:'12px',
            background:info.color,color:'#000',borderRadius:'6px',
            fontWeight:'bold',fontSize:'14px',textDecoration:'none',letterSpacing:'0.5px',
          }}>
            Upgrade to {info.name} →
          </a>
        )}

        <p style={{color:'#4b5563',fontSize:'11px',textAlign:'center',margin:'12px 0 0'}}>
          Cancel anytime. Billed monthly.
        </p>
      </div>
    </div>
  );
}

// ── Plan Gate ─────────────────────────────────────────────────────────────────
function PlanGate({ requiredPlan, children }) {
  const { dbUser }                = useContext(AuthContext);
  const [showModal, setShowModal] = useState(false);
  const navigate                  = useNavigate();

  const userPlan  = dbUser?.subscription_plan || 'free';
  const hasAccess = tierRank(userPlan) >= tierRank(requiredPlan);

  useEffect(() => {
    if (!hasAccess) setShowModal(true);
  }, [hasAccess]);

  if (hasAccess) return children;

  return (
    <>
      <div style={{
        minHeight:'60vh',display:'flex',alignItems:'center',
        justifyContent:'center',color:'#374151',
        fontFamily:'monospace',fontSize:'13px',userSelect:'none',
      }}>
        — restricted —
      </div>
      {showModal && (
        <UpgradeModal
          requiredPlan={requiredPlan}
          onClose={() => { setShowModal(false); navigate(-1); }}
        />
      )}
    </>
  );
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
function ComingSoon({ label }) {
  return (
    <div style={{ color: '#22c55e', fontFamily: 'monospace', padding: 40 }}>
      {label} — coming soon
    </div>
  );
}

const FullPageSpinner = () => (
  <div style={{
    minHeight:'100vh',background:'#080c0a',
    display:'flex',alignItems:'center',justifyContent:'center',
  }}>
    <div style={{
      width:20,height:20,
      border:'2px solid #22c55e22',borderTopColor:'#22c55e',
      borderRadius:'50%',animation:'et-spin 1s linear infinite',
    }}/>
    <style>{`@keyframes et-spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

function Lazy({ children }) {
  return <Suspense fallback={<FullPageSpinner />}>{children}</Suspense>;
}

// ── Error Boundary ────────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, errorInfo) {
    Sentry.captureException(error, { contexts: { react: errorInfo } });
    if (IS_DEV) { console.error('🔴 ErrorBoundary:', error, errorInfo); this.setState({ errorInfo }); }
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{minHeight:'100vh',background:'#080c0a',display:'flex',alignItems:'center',
        justifyContent:'center',flexDirection:'column',padding:'40px',fontFamily:'monospace'}}>
        <div style={{border:'1px solid #ef4444',borderRadius:'8px',padding:'32px',
          maxWidth:'700px',width:'100%',background:'#0f1a10'}}>
          <h2 style={{color:'#ef4444',margin:'0 0 12px'}}>⚠ App crashed</h2>
          <p style={{color:'#fca5a5',margin:'0 0 16px',fontSize:'14px'}}>
            An unexpected error occurred. Your data is safe — please reload.
          </p>
          {IS_DEV && this.state.errorInfo && (
            <details style={{color:'#6b7280',fontSize:'12px'}}>
              <summary style={{cursor:'pointer',color:'#9ca3af',marginBottom:'8px'}}>
                Component stack (dev only)
              </summary>
              <pre style={{overflowX:'auto',whiteSpace:'pre-wrap',lineHeight:1.5}}>
                {this.state.error?.toString()}
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
          <button onClick={() => window.location.reload()} style={{
            marginTop:'20px',padding:'8px 20px',background:'#22c55e',color:'#000',
            border:'none',borderRadius:'4px',cursor:'pointer',fontFamily:'monospace',fontWeight:'bold',
          }}>
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

// ── Auth Context ──────────────────────────────────────────────────────────────
export const AuthContext = createContext();

// ── Route Guards ──────────────────────────────────────────────────────────────
const AdminGuard = ({ dbUser, sessionChecked, children }) => {
  if (!sessionChecked)         return <FullPageSpinner />;
  if (!dbUser)                 return <Navigate to="/login"     replace />;
  if (dbUser.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
};

// [INVITE-1] UserGuard saves invite token + redirects new users to signup
const UserGuard = ({ isAuthenticated, sessionChecked, children }) => {
  if (!sessionChecked) return <FullPageSpinner />;
  if (!isAuthenticated) {
    const params      = new URLSearchParams(window.location.search);
    const inviteToken = params.get('token');
    if (inviteToken && window.location.pathname === '/join-org') {
      sessionStorage.setItem('pending_invite_token', inviteToken);
      return <Navigate to="/signup?invite=1" replace />;
    }
    return <Navigate to="/login" replace />;
  }
  return children;
};

// ── AppInner ──────────────────────────────────────────────────────────────────
function AppInner() {
  const {
    isAuthenticated, sessionChecked,
    kycCompleted, handleKycComplete,
    dbUser, setDbUser,
    planSelected, setPlanSelected,
  } = useContext(AuthContext);

  const isAdmin = dbUser?.role === 'admin';

  if (!sessionChecked) return <FullPageSpinner />;

  if (isAuthenticated && !isAdmin && kycCompleted && !planSelected) {
    return (
      <PlanSelection
        userName={dbUser?.full_name}
        onPlanSelected={(planKey) => {
          setPlanSelected(true);
          setDbUser((prev) =>
            prev ? { ...prev, subscription_plan: planKey, plan_selected: true } : prev
          );
        }}
      />
    );
  }

  return (
    <>
      {isAuthenticated && !isAdmin && <Header />}
      {isAuthenticated && !isAdmin && <Lazy><WalletMismatchBanner /></Lazy>}

      <div
        className="main-content"
        style={{
          paddingTop: isAuthenticated && !isAdmin ? '20px' : '0',
          background: '#080c0a',
          minHeight:  '100vh',
        }}
      >
        <Routes>

          {/* ── Public ── */}
          <Route path="/verify/:certId" element={<Lazy><VerifyCertificate /></Lazy>} />
          <Route path="/help"           element={<Lazy><Help /></Lazy>} />
          <Route path="/feedback"       element={<Lazy><Feedback /></Lazy>} />

          {/* ── Root redirect ── */}
          <Route path="/" element={
            !isAuthenticated
              ? <Navigate to="/signup"    replace />
              : isAdmin
                ? <Navigate to="/admin"     replace />
                : <Navigate to="/dashboard" replace />
          } />

          {/* ── Auth ── */}
          <Route path="/login" element={
            isAuthenticated
              ? <Navigate to={isAdmin ? '/admin' : '/dashboard'} replace />
              : <Login />
          } />
          <Route path="/signup" element={
            isAuthenticated
              ? <Navigate to={isAdmin ? '/admin' : '/dashboard'} replace />
              : <Signup />
          } />

          {/* ── Admin ── */}
          <Route path="/admin"   element={<AdminGuard dbUser={dbUser} sessionChecked={sessionChecked}><AdminDashboard /></AdminGuard>} />
          <Route path="/admin/*" element={<AdminGuard dbUser={dbUser} sessionChecked={sessionChecked}><AdminDashboard /></AdminGuard>} />

          {/* ── Join org — [INVITE-1] UserGuard handles token save + redirect ── */}
          <Route path="/join-org" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <Lazy><JoinOrg /></Lazy>
            </UserGuard>
          } />

          {/* ── KYC ── */}
          <Route path="/kyc" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              {kycCompleted
                ? <Navigate to="/dashboard" replace />
                : <KYCForm onComplete={handleKycComplete} />
              }
            </UserGuard>
          } />

          {/* ── FREE: Dashboard ── */}
          <Route path="/dashboard" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              {isAdmin ? <Navigate to="/admin" replace /> : <Dashboard />}
            </UserGuard>
          } />

          {/* ── FREE: Profile / settings / notifications / billing ── */}
          <Route path="/profile" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <Lazy><Profile /></Lazy>
            </UserGuard>
          } />
          <Route path="/edit-profile" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <Lazy><EditProfile /></Lazy>
            </UserGuard>
          } />
          <Route path="/settings" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <Lazy><Settings /></Lazy>
            </UserGuard>
          } />
          <Route path="/notifications" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <Lazy><Notifications /></Lazy>
            </UserGuard>
          } />
          <Route path="/billing" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <Lazy>
                <SubscriptionBilling
                  currentPlan={dbUser?.subscription_plan || 'free'}
                  orgName={dbUser?.org_name || ''}
                />
              </Lazy>
            </UserGuard>
          } />

          {/* ── FREE: Marketplace ── */}
          <Route path="/carbon-credits" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <Lazy><CarbonCredits /></Lazy>
            </UserGuard>
          } />

          {/* ── FREE: Wallet ── */}
          <Route path="/wallet" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <KYCGate><Lazy><Wallet /></Lazy></KYCGate>
            </UserGuard>
          } />

          {/* ── FREE: Trading history ── */}
          <Route path="/trading-history" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <KYCGate><Lazy><TradingHistory /></Lazy></KYCGate>
            </UserGuard>
          } />

          {/* ── FREE: Transaction status ── */}
          <Route path="/transaction-status" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <KYCGate><Lazy><TransactionStatus /></Lazy></KYCGate>
            </UserGuard>
          } />

          {/* ── STARTER: Portfolio ── */}
          <Route path="/portfolio" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <PlanGate requiredPlan="starter">
                <KYCGate><Lazy><Portfolio /></Lazy></KYCGate>
              </PlanGate>
            </UserGuard>
          } />

          {/* ── GROWTH: Emission tracking ── */}
          <Route path="/emission-tracking" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <PlanGate requiredPlan="growth">
                <KYCGate><Lazy><EmissionTracking /></Lazy></KYCGate>
              </PlanGate>
            </UserGuard>
          } />

          {/* ── CORPORATE: Compliance ── */}
          <Route path="/compliance" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <PlanGate requiredPlan="corporate">
                <KYCGate><Lazy><ComplianceDashboard /></Lazy></KYCGate>
              </PlanGate>
            </UserGuard>
          } />

          {/* ── ALL PAID: Team management ── */}
          <Route path="/team" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <Lazy><TeamManagement /></Lazy>
            </UserGuard>
          } />

          {/* ── 404 ── */}
          <Route path="*" element={<Lazy><NotFound /></Lazy>} />

        </Routes>
      </div>
    </>
  );
}

// ── App root ──────────────────────────────────────────────────────────────────
function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user,            setUser]            = useState(null);
  const [kycCompleted,    setKycCompleted]    = useState(false);
  const [dbUser,          setDbUser]          = useState(null);
  const [sessionChecked,  setSessionChecked]  = useState(false);
  const [planSelected,    setPlanSelected]    = useState(false);

  const handleLogout = useCallback(async () => {
    try { await authAPI.logout(); } catch {}
    setIsAuthenticated(false);
    setUser(null);
    setKycCompleted(false);
    setDbUser(null);
    setPlanSelected(false);
    const activeEmail = localStorage.getItem('activeEmail');
    if (activeEmail) localStorage.removeItem(getUserKey(activeEmail));
    localStorage.removeItem('activeEmail');
  }, []);

  // Restore session on mount
  useEffect(() => {
    const restoreSession = async () => {
      devLog('🔵 restoreSession: starting...');
      try {
        const me = await authAPI.me();
        devLog('🟢 restoreSession: me =', me);
        if (me?.id) {
          setDbUser(me);
          setKycCompleted(!!me.kyc_verified);
          setPlanSelected(!!me.plan_selected);
          setIsAuthenticated(true);
          const activeEmail = localStorage.getItem('activeEmail');
          const cached      = activeEmail ? readUserCache(activeEmail) : null;
          setUser(cached || { email: me.email, displayName: me.full_name });
        }
      } catch (e) {
        devLog('🟡 restoreSession: not authenticated:', e?.message);
      } finally {
        devLog('🔵 restoreSession: sessionChecked = true');
        setSessionChecked(true);
      }
    };
    restoreSession();
  }, []);

  // Global logout event from API interceptor
  useEffect(() => {
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, [handleLogout]);

  // Cache safe display fields only
  useEffect(() => {
    if (user?.email) {
      localStorage.setItem('activeEmail', user.email);
      localStorage.setItem(getUserKey(user.email), JSON.stringify(safeUserCache(user)));
    }
  }, [user]);

  // [PLAN-SYNC] Background poll every 5 mins — keeps subscription_plan fresh
  useEffect(() => {
    if (!isAuthenticated) return;
    const POLL_MS = 5 * 60 * 1000;
    const poll = setInterval(async () => {
      try {
        const me = await authAPI.me();
        if (me?.id) {
          setDbUser(prev => {
            if (
              prev?.subscription_plan === me.subscription_plan &&
              prev?.kyc_verified      === me.kyc_verified &&
              prev?.plan_selected     === me.plan_selected
            ) return prev;
            return { ...prev, ...me };
          });
          if (me.kyc_verified)  setKycCompleted(true);
          if (me.plan_selected) setPlanSelected(true);
        }
      } catch { /* silent */ }
    }, POLL_MS);
    return () => clearInterval(poll);
  }, [isAuthenticated]);

  // [INVITE-2] handleLogin returns { dbUser, redirect }
  // redirect = /join-org?token=xxx if pending invite token exists
  const handleLogin = useCallback(async (userData, firebaseUser = null) => {
    setUser(userData);
    localStorage.setItem('activeEmail', userData.email);

    let resolvedDbUser = null;
    let redirect       = null;

    if (firebaseUser) {
      try {
        const idToken = await firebaseUser.getIdToken();
        const res = await authAPI.syncUser({
          email:       firebaseUser.email,
          firebaseUid: firebaseUser.uid,
          fullName:    firebaseUser.displayName || '',
        }, idToken);
        if (res?.user) {
          resolvedDbUser = res.user;
          setDbUser(res.user);
          if (res.user.kyc_verified)  setKycCompleted(true);
          if (res.user.plan_selected) setPlanSelected(true);
        }
      } catch (e) {
        devLog('Backend sync failed:', e?.message);
      }
    } else if (userData.dbUser) {
      resolvedDbUser = userData.dbUser;
      setDbUser(userData.dbUser);
      if (userData.dbUser.kyc_verified)  setKycCompleted(true);
      if (userData.dbUser.plan_selected) setPlanSelected(true);
    }

    setIsAuthenticated(true);

    // Check for pending invite — return redirect so Login.jsx navigates correctly
    const pendingToken = sessionStorage.getItem('pending_invite_token');
    if (pendingToken) {
      // Don't remove here — JoinOrg.js removes it after successful accept
      redirect = `/join-org?token=${pendingToken}`;
    }

    return { dbUser: resolvedDbUser, redirect };
  }, []);

  // [KYC-1] also set kyc_status + kyc_tier so KYCGate unlocks on SSE push
  const handleKycComplete = useCallback((status, payload = {}) => {
    setKycCompleted(status);
    setDbUser((prev) => prev ? {
      ...prev,
      kyc_verified : status,
      kyc_status   : status ? 'verified' : prev.kyc_status,
      kyc_tier     : payload.tier || (status ? 'full' : prev.kyc_tier),
    } : prev);
  }, []);

  const authContextValue = useMemo(() => ({
    isAuthenticated,
    sessionChecked,
    user,
    setUser,
    kycCompleted,
    handleLogin,
    handleLogout,
    handleKycComplete,
    dbUser,
    setDbUser,
    planSelected,
    setPlanSelected,
  }), [
    isAuthenticated, sessionChecked, user,
    kycCompleted, handleLogin, handleLogout, handleKycComplete,
    dbUser, planSelected,
  ]);

  return (
    <ErrorBoundary>
      <NotificationProvider>
        <PortfolioProvider>
          <AuthContext.Provider value={authContextValue}>
            <Router>
              <AppInner />
            </Router>
          </AuthContext.Provider>
        </PortfolioProvider>
      </NotificationProvider>
    </ErrorBoundary>
  );
}

export default App;