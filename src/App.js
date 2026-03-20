import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
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
import TeamManagement     from './components/TeamManagement';   // ✅ NEW
import JoinOrg            from './components/JoinOrg';          // ✅ NEW
import Wallet             from './components/Wallet';

import { NotificationProvider } from './context/NotificationContext';
import { PortfolioProvider }    from './context/PortfolioContext';
import { authAPI, tokenStorage } from './services/api';

// ── Optional components — safe fallbacks if file doesn't exist ────
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

const AdminGuard = ({ dbUser, children }) => {
  if (!dbUser)                 return <Navigate to="/dashboard" />;
  if (dbUser.role !== 'admin') return <Navigate to="/dashboard" />;
  return children;
};

function AppInner({ isAuthenticated, user, setUser, kycCompleted, handleLogin, handleLogout, handleKycComplete, dbUser, setDbUser }) {
  const isAdmin = dbUser?.role === 'admin';

  return (
    <AuthContext.Provider value={{
      isAuthenticated, user, setUser, kycCompleted,
      handleLogin, handleLogout, handleKycComplete, dbUser, setDbUser,
    }}>
      {!isAdmin && <Header />}
      {isAuthenticated && !isAdmin && <WalletMismatchBanner />}
      <div className="main-content" style={{ paddingTop: isAdmin ? '0' : '60px', background:'#080c0a', minHeight:'100vh' }}>
        <Routes>

          {/* ── Fully public routes — no auth required ── */}
          <Route path="/verify/:certId" element={<VerifyCertificate />} />
          <Route path="/help"           element={<Help />} />
          <Route path="/feedback"       element={<Feedback />} />

          <Route path="/"       element={isAuthenticated ? <Navigate to={isAdmin ? '/admin' : '/dashboard'} /> : <Navigate to="/signup" />} />
          <Route path="/login"  element={isAuthenticated ? <Navigate to={isAdmin ? '/admin' : '/dashboard'} /> : <Login />} />
          <Route path="/signup" element={isAuthenticated ? <Navigate to={isAdmin ? '/admin' : '/dashboard'} /> : <Signup />} />

          {/* ✅ Join org — requires auth but NOT KYC */}
          <Route path="/join-org" element={
            isAuthenticated
              ? <JoinOrg />
              : (() => {
                  // Save token to sessionStorage before redirecting to login
                  const token = new URLSearchParams(window.location.search).get('token');
                  if (token) sessionStorage.setItem('pending_invite_token', token);
                  return <Navigate to="/login" />;
                })()
          } />

          {isAuthenticated ? (
            <>
              <Route path="/admin" element={
                <AdminGuard dbUser={dbUser}>
                  <AdminDashboard />
                </AdminGuard>
              } />

              {!isAdmin && (
                <>
                  <Route path="/dashboard"          element={<Dashboard />} />
                  <Route path="/profile"            element={<Profile />} />
                  <Route path="/edit-profile"       element={<EditProfile />} />
                  <Route path="/settings"           element={<Settings />} />
                  <Route path="/notifications"      element={<Notifications />} />

                  <Route path="/kyc" element={
                    kycCompleted
                      ? <Navigate to="/dashboard" />
                      : <KYCForm onComplete={handleKycComplete} />
                  } />

                  {/* ✅ Team management — auth required, no KYC gate */}
                  <Route path="/team"               element={<TeamManagement />} />

                  <Route path="/portfolio"          element={<KYCGate><Portfolio /></KYCGate>} />
                  <Route path="/carbon-credits"     element={<KYCGate><CarbonCredits /></KYCGate>} />
                  <Route path="/emission-tracking"  element={<KYCGate><EmissionTracking /></KYCGate>} />
                  <Route path="/wallet" element={<KYCGate><Wallet /></KYCGate>} />
                  <Route path="/trading-history"    element={<KYCGate><TradingHistory /></KYCGate>} />
                  <Route path="/transaction-status" element={<KYCGate><TransactionStatus /></KYCGate>} />
                </>
              )}
            </>
          ) : (
            <Route path="*" element={<Navigate to="/login" />} />
          )}

          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </AuthContext.Provider>
  );
}

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

  useEffect(() => {
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, [handleLogout]);

  useEffect(() => {
    if (user?.email) localStorage.setItem(getUserKey(user.email), JSON.stringify(user));
  }, [user]);

  const handleLogin = async (userData, firebaseUser = null) => {
    setUser(userData);
    localStorage.setItem('activeEmail', userData.email);
    if (firebaseUser) {
      try {
        const res = await authAPI.syncUser({
          email:       firebaseUser.email,
          firebaseUid: firebaseUser.uid,
          fullName:    firebaseUser.displayName || '',
        });
        if (res?.user) {
          setDbUser(res.user);
          if (res.user.kyc_verified) setKycCompleted(true);
        }
      } catch(e) { console.warn('Backend sync failed:', e?.message || e); }
    } else if (userData.accessToken) {
      if (userData.dbUser) {
        setDbUser(userData.dbUser);
        if (userData.dbUser.kyc_verified) setKycCompleted(true);
      }
    }
    setIsAuthenticated(true);

    // ✅ Check for pending org invite — redirect to join-org after login
    const pendingToken = sessionStorage.getItem('pending_invite_token');
    if (pendingToken) {
      sessionStorage.removeItem('pending_invite_token');
      // Small delay to let auth state settle
      setTimeout(() => {
        window.location.href = `/join-org?token=${pendingToken}`;
      }, 300);
    }
  };

  const handleKycComplete = (status) => {
    setKycCompleted(status);
    setDbUser(prev => prev ? { ...prev, kyc_verified: status } : prev);
  };

  if (!sessionChecked) {
    return (
      <div style={{ minHeight:'100vh', background:'#080c0a', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ width:20, height:20, border:'2px solid #22c55e22', borderTopColor:'#22c55e', borderRadius:'50%', animation:'spin 1s linear infinite' }}/>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <NotificationProvider>
      <PortfolioProvider>
        <Router>
          <AppInner
            isAuthenticated={isAuthenticated}
            user={user} setUser={setUser}
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