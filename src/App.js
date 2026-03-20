import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate, useNavigate } from 'react-router-dom';
import './App.css';
import './index.css';

import Login              from './components/Login';
import Signup             from './components/Signup';
import Dashboard          from './components/Dashboard';
import Header             from './components/Header';
import Profile            from './components/Profile';
import EditProfile        from './components/EditProfile';
import EmissionTracking   from './components/EmissionTracking';
import CarbonCredits      from './components/CarbonCredits';
import TradingHistory     from './components/TradingHistory';
import KYCForm            from './components/KYCForm';
import Portfolio          from './components/Portfolio';
import KYCGate            from './components/KYCGate';
import AdminDashboard     from './components/AdminDashboard';
import VerifyCertificate  from './components/VerifyCertificate';
import TeamManagement     from './components/TeamManagement';
import JoinOrg            from './components/JoinOrg';
import Wallet             from './components/Wallet';

import { NotificationProvider } from './context/NotificationContext';
import { PortfolioProvider }    from './context/PortfolioContext';
import { authAPI, tokenStorage } from './services/api';

// ── Optional components — safe fallbacks ─────────────────────────
let Settings, Notifications, WalletMismatchBanner, Help, Feedback, TransactionStatus, NotFound;
try { Settings             = require('./components/Settings').default;             } catch { Settings             = () => <div style={{color:'#22c55e',fontFamily:'monospace',padding:40}}>Settings coming soon</div>; }
try { Notifications        = require('./components/Notifications').default;        } catch { Notifications        = () => <div style={{color:'#22c55e',fontFamily:'monospace',padding:40}}>Notifications coming soon</div>; }
try { WalletMismatchBanner = require('./components/WalletMismatchBanner').default; } catch { WalletMismatchBanner = () => null; }
try { Help                 = require('./components/Help').default;                 } catch { Help                 = () => <div style={{color:'#22c55e',fontFamily:'monospace',padding:40}}>Help coming soon</div>; }
try { Feedback             = require('./components/Feedback').default;             } catch { Feedback             = () => <div style={{color:'#22c55e',fontFamily:'monospace',padding:40}}>Feedback coming soon</div>; }
try { TransactionStatus    = require('./components/TransactionStatus').default;    } catch { TransactionStatus    = () => <div style={{color:'#22c55e',fontFamily:'monospace',padding:40}}>Transaction Status coming soon</div>; }
try { NotFound             = require('./components/NotFound').default;             } catch { NotFound             = () => <div style={{color:'#22c55e',fontFamily:'monospace',padding:40}}>404 — Page not found</div>; }

export const AuthContext = React.createContext();

const getUserKey = (email) => `user_${email}`;

// ── Guards ────────────────────────────────────────────────────────

// Waits for dbUser to load before deciding — no flash redirects
const AdminGuard = ({ dbUser, sessionChecked, children }) => {
  if (!sessionChecked) return null;                      // still loading
  if (!dbUser)         return <Navigate to="/login" replace />;
  if (dbUser.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
};

// Redirects unauthenticated users to login
const UserGuard = ({ isAuthenticated, sessionChecked, children }) => {
  if (!sessionChecked) return null;                      // still loading
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
};

// ── Spinner ───────────────────────────────────────────────────────
const FullPageSpinner = () => (
  <div style={{ minHeight:'100vh', background:'#080c0a', display:'flex', alignItems:'center', justifyContent:'center' }}>
    <div style={{ width:20, height:20, border:'2px solid #22c55e22', borderTopColor:'#22c55e', borderRadius:'50%', animation:'spin 1s linear infinite' }}/>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// ── AppInner ──────────────────────────────────────────────────────
function AppInner({ isAuthenticated, sessionChecked, user, setUser, kycCompleted, handleLogin, handleLogout, handleKycComplete, dbUser, setDbUser }) {
  const isAdmin = dbUser?.role === 'admin';

  // Show spinner until session is resolved
  if (!sessionChecked) return <FullPageSpinner />;

  return (
    <AuthContext.Provider value={{
      isAuthenticated, user, setUser, kycCompleted,
      handleLogin, handleLogout, handleKycComplete, dbUser, setDbUser,
    }}>
      {/* Header only for regular users */}
      {isAuthenticated && !isAdmin && <Header />}
      {isAuthenticated && !isAdmin && <WalletMismatchBanner />}

      <div className="main-content" style={{
        paddingTop:  isAuthenticated && !isAdmin ? '60px' : '0',
        background:  '#080c0a',
        minHeight:   '100vh',
      }}>
        <Routes>

          {/* ── Public routes ── */}
          <Route path="/verify/:certId" element={<VerifyCertificate />} />
          <Route path="/help"           element={<Help />} />
          <Route path="/feedback"       element={<Feedback />} />

          {/* ── Root redirect ── */}
          <Route path="/" element={
            !isAuthenticated
              ? <Navigate to="/signup" replace />
              : isAdmin
                ? <Navigate to="/admin" replace />
                : <Navigate to="/dashboard" replace />
          } />

          {/* ── Auth routes — redirect if already logged in ── */}
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

          {/* ── Admin routes ── */}
          <Route path="/admin" element={
            <AdminGuard dbUser={dbUser} sessionChecked={sessionChecked}>
              <AdminDashboard />
            </AdminGuard>
          } />
          <Route path="/admin/*" element={
            <AdminGuard dbUser={dbUser} sessionChecked={sessionChecked}>
              <AdminDashboard />
            </AdminGuard>
          } />

          {/* ── Join org — auth required, no KYC gate ── */}
          <Route path="/join-org" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <JoinOrg />
            </UserGuard>
          } />

          {/* ── User routes — auth + not admin ── */}
          <Route path="/dashboard" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              {isAdmin ? <Navigate to="/admin" replace /> : <Dashboard />}
            </UserGuard>
          } />
          <Route path="/profile" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <Profile />
            </UserGuard>
          } />
          <Route path="/edit-profile" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <EditProfile />
            </UserGuard>
          } />
          <Route path="/settings" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <Settings />
            </UserGuard>
          } />
          <Route path="/notifications" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <Notifications />
            </UserGuard>
          } />
          <Route path="/kyc" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              {kycCompleted
                ? <Navigate to="/dashboard" replace />
                : <KYCForm onComplete={handleKycComplete} />
              }
            </UserGuard>
          } />
          <Route path="/team" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <TeamManagement />
            </UserGuard>
          } />

          {/* ── KYC gated routes ── */}
          <Route path="/portfolio" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <KYCGate><Portfolio /></KYCGate>
            </UserGuard>
          } />
          <Route path="/carbon-credits" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <KYCGate><CarbonCredits /></KYCGate>
            </UserGuard>
          } />
          <Route path="/emission-tracking" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <KYCGate><EmissionTracking /></KYCGate>
            </UserGuard>
          } />
          <Route path="/wallet" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <KYCGate><Wallet /></KYCGate>
            </UserGuard>
          } />
          <Route path="/trading-history" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <KYCGate><TradingHistory /></KYCGate>
            </UserGuard>
          } />
          <Route path="/transaction-status" element={
            <UserGuard isAuthenticated={isAuthenticated} sessionChecked={sessionChecked}>
              <KYCGate><TransactionStatus /></KYCGate>
            </UserGuard>
          } />

          {/* ── 404 ── */}
          <Route path="*" element={<NotFound />} />

        </Routes>
      </div>
    </AuthContext.Provider>
  );
}

// ── App ───────────────────────────────────────────────────────────
function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user,            setUser]            = useState(null);
  const [kycCompleted,    setKycCompleted]    = useState(false);
  const [dbUser,          setDbUser]          = useState(null);
  const [sessionChecked,  setSessionChecked]  = useState(false);

  const handleLogout = useCallback(async () => {
    try { await authAPI.logout(); } catch {}
    setIsAuthenticated(false);
    setUser(null);
    setKycCompleted(false);
    setDbUser(null);
    localStorage.removeItem('activeEmail');
  }, []);

  // ── Restore session on mount ──────────────────────────────────
  useEffect(() => {
    const restoreSession = async () => {
      const hasToken = !!tokenStorage.getAccess();
      if (!hasToken) { setSessionChecked(true); return; }
      try {
        const me = await authAPI.me();
        if (me?.id) {
          setDbUser(me);
          setKycCompleted(!!me.kyc_verified);
          setIsAuthenticated(true);
          const activeEmail = localStorage.getItem('activeEmail');
          if (activeEmail) {
            const stored = localStorage.getItem(getUserKey(activeEmail));
            if (stored) setUser(JSON.parse(stored));
            else        setUser({ email: me.email, name: me.full_name });
          } else {
            setUser({ email: me.email, name: me.full_name });
          }
        }
      } catch {
        tokenStorage.clear();
      } finally {
        setSessionChecked(true);
      }
    };
    restoreSession();
  }, []);

  // ── Listen for forced logout events (e.g. token expired) ─────
  useEffect(() => {
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, [handleLogout]);

  // ── Persist user to localStorage ─────────────────────────────
  useEffect(() => {
    if (user?.email) localStorage.setItem(getUserKey(user.email), JSON.stringify(user));
  }, [user]);

  // ── Login handler ─────────────────────────────────────────────
  const handleLogin = async (userData, firebaseUser = null) => {
    setUser(userData);
    localStorage.setItem('activeEmail', userData.email);

    let resolvedDbUser = null;

    if (firebaseUser) {
      try {
        const res = await authAPI.syncUser({
          email:       firebaseUser.email,
          firebaseUid: firebaseUser.uid,
          fullName:    firebaseUser.displayName || '',
        });
        if (res?.user) {
          resolvedDbUser = res.user;
          setDbUser(res.user);
          if (res.user.kyc_verified) setKycCompleted(true);
        }
      } catch(e) { console.warn('Backend sync failed:', e?.message || e); }
    } else if (userData.accessToken) {
      if (userData.dbUser) {
        resolvedDbUser = userData.dbUser;
        setDbUser(userData.dbUser);
        if (userData.dbUser.kyc_verified) setKycCompleted(true);
      }
    }

    setIsAuthenticated(true);

    // ── Navigate based on role using resolvedDbUser (not state) ──
    if (resolvedDbUser?.role === 'admin') {
      window.location.replace('/admin');
      return;
    }

    // ── Check for pending org invite ──────────────────────────
    const pendingToken = sessionStorage.getItem('pending_invite_token');
    if (pendingToken) {
      sessionStorage.removeItem('pending_invite_token');
      setTimeout(() => {
        window.location.replace(`/join-org?token=${pendingToken}`);
      }, 300);
      return;
    }

    // ── Regular user goes to dashboard ────────────────────────
    window.location.replace('/dashboard');
  };

  const handleKycComplete = (status) => {
    setKycCompleted(status);
    setDbUser(prev => prev ? { ...prev, kyc_verified: status } : prev);
  };

  return (
    <NotificationProvider>
      <PortfolioProvider>
        <Router>
          <AppInner
            isAuthenticated={isAuthenticated}
            sessionChecked={sessionChecked}
            user={user}
            setUser={setUser}
            kycCompleted={kycCompleted}
            handleLogin={handleLogin}
            handleLogout={handleLogout}
            handleKycComplete={handleKycComplete}
            dbUser={dbUser}
            setDbUser={setDbUser}
          />
        </Router>
      </PortfolioProvider>
    </NotificationProvider>
  );
}

export default App;