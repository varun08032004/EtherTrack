import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import './App.css';
import './index.css';

import Login            from './components/Login';
import Signup           from './components/Signup';
import Dashboard        from './components/Dashboard';
import Header           from './components/Header';
import Profile          from './components/Profile';
import EditProfile      from './components/EditProfile';
import EmissionTracking from './components/EmissionTracking';
import CarbonCredits    from './components/CarbonCredits';
import TradingHistory   from './components/TradingHistory';
import KYCForm          from './components/KYCForm';
import Portfolio        from './components/Portfolio';
import KYCGate          from './components/KYCGate';
import Settings         from './components/Settings';
import Notifications    from './components/Notifications';
import AdminDashboard   from './components/AdminDashboard';
import WalletMismatchBanner from './components/WalletMismatchBanner'; // ← added
import { NotificationProvider } from './context/NotificationContext';
import { PortfolioProvider }    from './context/PortfolioContext';
import { authAPI } from './services/api';

let Help, Feedback, TransactionStatus, NotFound;
try { Help              = require('./components/Help').default;              } catch { Help              = () => <div style={{color:'#22c55e',fontFamily:'monospace',padding:40}}>Help page coming soon</div>; }
try { Feedback          = require('./components/Feedback').default;          } catch { Feedback          = () => <div style={{color:'#22c55e',fontFamily:'monospace',padding:40}}>Feedback coming soon</div>; }
try { TransactionStatus = require('./components/TransactionStatus').default; } catch { TransactionStatus = () => <div style={{color:'#22c55e',fontFamily:'monospace',padding:40}}>Transaction Status coming soon</div>; }
try { NotFound          = require('./components/NotFound').default;          } catch { NotFound          = () => <div style={{color:'#22c55e',fontFamily:'monospace',padding:40}}>404 — Page not found</div>; }

export const AuthContext = React.createContext();

const getUserKey = (email) => `user_${email}`;

const AdminGuard = ({ dbUser, children }) => {
  if (!dbUser) return <Navigate to="/dashboard" />;
  if (dbUser.role !== 'admin') return <Navigate to="/dashboard" />;
  return children;
};

function AppInner({ isAuthenticated, user, setUser, kycCompleted, handleLogin, handleLogout, handleKycComplete, dbUser, setDbUser }) {
  const isAdmin = dbUser?.role === 'admin';

  return (
    <AuthContext.Provider value={{
      isAuthenticated,
      user, setUser,
      kycCompleted,
      handleLogin,
      handleLogout,
      handleKycComplete,
      dbUser,
      setDbUser,
    }}>
      {!isAdmin && <Header />}
      {/* Wallet mismatch banner — only shown to logged-in non-admin users */}
      {isAuthenticated && !isAdmin && <WalletMismatchBanner />}
      <div className="main-content" style={{ paddingTop: isAdmin ? '0' : '60px', background: '#080c0a', minHeight: '100vh' }}>
        <Routes>
          <Route path="/"       element={isAuthenticated ? <Navigate to={isAdmin ? '/admin' : '/dashboard'} /> : <Navigate to="/signup" />} />
          <Route path="/login"  element={isAuthenticated ? <Navigate to={isAdmin ? '/admin' : '/dashboard'} /> : <Login />} />
          <Route path="/signup" element={isAuthenticated ? <Navigate to={isAdmin ? '/admin' : '/dashboard'} /> : <Signup />} />
          <Route path="/help"     element={<Help />} />
          <Route path="/feedback" element={<Feedback />} />

          {isAuthenticated ? (
            <>
              <Route path="/admin" element={
                <AdminGuard dbUser={dbUser}>
                  <AdminDashboard />
                </AdminGuard>
              } />

              {!isAdmin && (
                <>
                  <Route path="/dashboard"     element={<Dashboard />} />
                  <Route path="/profile"       element={<Profile />} />
                  <Route path="/edit-profile"  element={<EditProfile />} />
                  <Route path="/settings"      element={<Settings />} />
                  <Route path="/notifications" element={<Notifications />} />

                  <Route path="/kyc" element={
                    kycCompleted
                      ? <Navigate to="/dashboard" />
                      : <KYCForm onComplete={handleKycComplete} />
                  } />

                  <Route path="/portfolio"          element={<KYCGate><Portfolio /></KYCGate>} />
                  <Route path="/carbon-credits"     element={<KYCGate><CarbonCredits /></KYCGate>} />
                  <Route path="/emission-tracking"  element={<KYCGate><EmissionTracking /></KYCGate>} />
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
            else setUser({ email: me.email, name: me.full_name });
          } else {
            setUser({ email: me.email, name: me.full_name });
          }
        }
      } catch {
        // cookie expired — stay logged out
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
    if (user?.email) {
      localStorage.setItem(getUserKey(user.email), JSON.stringify(user));
    }
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
      } catch (e) {
        console.warn('Backend sync failed:', e?.message || e);
      }
    }
    setIsAuthenticated(true);
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