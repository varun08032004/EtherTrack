import React, { useState, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Dashboard.css';
import Header from '../components/Header';
import { AuthContext } from '../App';

const Dashboard = () => {
    const { handleLogout, user } = useContext(AuthContext);
    const [showMenu, setShowMenu] = useState(false);
    const [showUserInfo, setShowUserInfo] = useState(false);
    const navigate = useNavigate();

    const toggleMenu = () => {
        setShowMenu(!showMenu);
        setShowUserInfo(false);
    };

    const toggleUserInfo = () => {
        setShowUserInfo(!showUserInfo);
        setShowMenu(false);
    };

    const handleLogoutClick = () => {
        handleLogout();
        navigate('/login');
    };

    const handleNavigation = (path) => {
        setShowMenu(false);
        setShowUserInfo(false);
        navigate(path);
    };

    return (
        <div className="dashboard-container">
            <Header />
            <nav className="navbar">
                <div className="navbar-left">
                    <div className="menu-container">
                        <button
                            className="menu-btn"
                            onClick={toggleMenu}
                            aria-expanded={showMenu}
                            aria-label="Toggle menu"
                        >
                            <span className="menu-line"></span>
                            <span className="menu-line"></span>
                            <span className="menu-line"></span>
                        </button>
                        {showMenu && (
                            <div className="menu-dropdown">
                                <Link to="/dashboard" onClick={() => handleNavigation('/dashboard')}>Dashboard</Link>
                                <Link to="/emission-tracking" onClick={() => handleNavigation('/emission-tracking')}>EmissionTracking</Link>
                                <Link to="/carbon-credits" onClick={() => handleNavigation('/carbon-credits')}>Credits Trading</Link>
                                <Link to="/feedback" onClick={() => handleNavigation('/feedback')}>Feedback</Link>
                                
                            </div>
                        )}
                    </div>
                </div>
                <div className="navbar-right">
                    <div className="help-container">
                        <Link to="/help" className="help-btn" aria-label="Help">
                            <span className="help-icon">❓</span>
                        </Link>
                    </div>
                    <div className="profile-dropdown">
                        <button
                            className="dropbtn"
                            onClick={toggleUserInfo}
                            aria-expanded={showUserInfo}
                            aria-label="Profile options"
                        >
                            {user?.profileImage ? (
                                <img src={user.profileImage} alt="Profile" className="profile-icon" />
                            ) : (
                                <span className="profile-icon">👤</span>
                            )}
                        </button>
                        {showUserInfo && (
                            <div className="dropdown-content">
                                <Link to="/profile" onClick={() => handleNavigation('/profile')}>View Profile</Link>
                                <Link to="/edit-profile" onClick={() => handleNavigation('/edit-profile')}>Edit Profile</Link>
                                <button onClick={handleLogoutClick}>Logout</button>
                            </div>
                        )}
                    </div>
                </div>
            </nav>
            <div className="dashboard-content">
                <div className="dashboard-default-content">
                    <h2>Welcome to EtherTrack</h2>
                    <p>EtherTrack is a blockchain solution transforming carbon emission tracking and carbon credits trading.</p>
                    <h3>Key Features:</h3>
                    <ul>
                        <li>Monitor and manage your carbon emissions.</li>
                        <li>Generate insightful reports.</li>
                        <li>Trade carbon credits with blockchain security.</li>
                    </ul>
                    <h3>Why Choose EtherTrack?</h3>
                    <p>
                        Join us on this vital journey toward sustainability. Empower your organization to:
                    </p>
                    <ul>
                        <li>Make impactful environmental decisions.</li>
                        <li>Foster a culture of accountability.</li>
                        <li>Contribute to a greener future for all.</li>
                    </ul>
                    <p>Join us on a journey toward sustainability and contribute to a greener future.</p>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
