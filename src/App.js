import React, { useState } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import './App.css';
import Login from './components/Login';
import Signup from './components/Signup';
import Dashboard from './components/Dashboard';
import NotFound from './components/NotFound';
import Help from './components/Help';
import Feedback from './components/Feedback';
import BlockchainWallet from './components/BlockchainWallet';
import TransactionStatus from './components/TransactionStatus';
import TradingHistory from './components/TradingHistory';
import Profile from './components/Profile';
import EditProfile from './components/EditProfile';
import EmissionTracking from './components/EmissionTracking';
import CarbonCredits from './components/CarbonCredits';
import Home from './components/Home'; // Import Home component

// Create an AuthContext to manage authentication across components
export const AuthContext = React.createContext();

function App() {
    // State management for user authentication and user data
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [user, setUser] = useState({ email: '', name: '' });

    // Login handler
    const handleLogin = (userData) => {
        setIsAuthenticated(true);
        setUser(userData);
    };

    // Logout handler
    const handleLogout = () => {
        console.log('Logging out user:', user);
        setIsAuthenticated(false);
        setUser({ email: '', name: '' });
    };

    return (
        <Router>
            <AuthContext.Provider value={{ isAuthenticated, setIsAuthenticated, user, setUser, handleLogin, handleLogout }}>
                <div className="main-content">
                    <Routes>
                        {/* Home route */}
                        <Route 
                            path="/" 
                            element={
                                isAuthenticated 
                                ? <Navigate to="/dashboard" /> 
                                : <Signup />
                            } 
                        />
                        
                        {/* Home page */}
                        <Route 
                            path="/home" 
                            element={<Home />} 
                        />
                        
                        {/* Login page */}
                        <Route 
                            path="/login" 
                            element={
                                isAuthenticated 
                                ? <Navigate to="/dashboard" /> 
                                : <Login onLogin={handleLogin} />
                            } 
                        />
                        
                        {/* Signup page */}
                        <Route 
                            path="/signup" 
                            element={
                                isAuthenticated 
                                ? <Navigate to="/dashboard" /> 
                                : <Signup />
                            } 
                        />
                        
                        {/* Dashboard route (protected, requires authentication) */}
                        <Route 
                            path="/dashboard" 
                            element={
                                isAuthenticated 
                                ? <Dashboard /> 
                                : <Navigate to="/login" />
                            } 
                        />
                        
                        {/* Emission Tracking route (protected, requires authentication) */}
                        <Route 
                            path="/emission-tracking" 
                            element={
                                isAuthenticated 
                                ? <EmissionTracking /> 
                                : <Navigate to="/login" />
                            } 
                        />
                        
                        {/* Carbon Credits route (protected, requires authentication) */}
                        <Route 
                            path="/carbon-credits" 
                            element={
                                isAuthenticated 
                                ? <CarbonCredits /> 
                                : <Navigate to="/login" />
                            } 
                        />
                        
                        {/* Public routes */}
                        <Route path="/help" element={<Help />} />
                        <Route path="/feedback" element={<Feedback />} />
                        <Route path="/blockchain-wallet" element={
                            isAuthenticated ? <BlockchainWallet /> : <Navigate to="/login" />
                        } />
                        <Route path="/transaction-status" element={
                            isAuthenticated ? <TransactionStatus /> : <Navigate to="/login" />
                        } />
                        <Route path="/trading-history" element={
                            isAuthenticated ? <TradingHistory /> : <Navigate to="/login" />
                        } />
                        <Route path="/profile" element={
                            isAuthenticated ? <Profile /> : <Navigate to="/login" />
                        } />
                        <Route path="/edit-profile" element={
                            isAuthenticated ? <EditProfile /> : <Navigate to="/login" />
                        } />
                        
                        {/* Catch-all route for 404 errors */}
                        <Route path="*" element={<NotFound />} />
                    </Routes>
                </div>
            </AuthContext.Provider>
        </Router>
    );
}

export default App;
