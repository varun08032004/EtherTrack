import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import './App.css';
import Login from './components/Login';
import Signup from './components/Signup';
import Dashboard from './components/Dashboard';
import NotFound from './components/NotFound';
import Help from './components/Help';
import Feedback from './components/Feedback';
import TransactionStatus from './components/TransactionStatus';
import TradingHistory from './components/TradingHistory';
import Profile from './components/Profile';
import EditProfile from './components/EditProfile';
import EmissionTracking from './components/EmissionTracking';
import CarbonCredits from './components/CarbonCredits';
import Home from './components/Home';
import Header from './components/Header';

export const AuthContext = React.createContext();

function App() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState(null);

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            setIsAuthenticated(true);
            setUser(JSON.parse(storedUser));
        }
    }, []);

    // Ensure localStorage is updated when user state changes
    useEffect(() => {
        if (user) {
            localStorage.setItem('user', JSON.stringify(user));
        } else {
            localStorage.removeItem('user');
        }
    }, [user]);

    const handleLogin = (userData) => {
        setIsAuthenticated(true);
        setUser(userData);
    };

    const handleLogout = () => {
        setIsAuthenticated(false);
        setUser(null);
    };

    return (
        <Router>
            <AuthContext.Provider value={{ isAuthenticated, user, setUser, handleLogin, handleLogout }}>
                <Header isAuthenticated={isAuthenticated} handleLogout={handleLogout} />
                <div className="main-content">
                    <Routes>
                        <Route path="/" element={isAuthenticated ? <Navigate to="/dashboard" /> : <Signup />} />
                        <Route path="/home" element={<Home />} />
                        <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" /> : <Login />} />
                        <Route path="/signup" element={isAuthenticated ? <Navigate to="/dashboard" /> : <Signup />} />

                        {/* Protected Routes */}
                        {isAuthenticated ? (
                            <>
                                <Route path="/dashboard" element={<Dashboard />} />
                                <Route path="/emission-tracking" element={<EmissionTracking />} />
                                <Route path="/carbon-credits" element={<CarbonCredits />} />
                                <Route path="/transaction-status" element={<TransactionStatus />} />
                                <Route path="/trading-history" element={<TradingHistory />} />
                                <Route path="/profile" element={<Profile />} />
                                <Route path="/edit-profile" element={<EditProfile />} />
                            </>
                        ) : (
                            <Route path="*" element={<Navigate to="/login" />} />
                        )}

                        {/* Public Routes */}
                        <Route path="/help" element={<Help />} />
                        <Route path="/feedback" element={<Feedback />} />

                        {/* Catch-all route for 404 errors */}
                        <Route path="*" element={<NotFound />} />
                    </Routes>
                </div>
            </AuthContext.Provider>
        </Router>
    );
}

export default App;
