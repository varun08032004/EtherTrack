import React, { useState, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Dashboard.css';
import Header from '../components/Header'; // Adjust the path if needed
import { AuthContext } from '../App'; // Import AuthContext

const Dashboard = () => {
    const { handleLogout } = useContext(AuthContext); // Access handleLogout from context
    const [showApplications, setShowApplications] = useState(false);
    const [showUserInfo, setShowUserInfo] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const navigate = useNavigate();

    const toggleApplications = () => {
        setShowApplications(!showApplications);
        setShowUserInfo(false); // Close user info when applications are opened
        setShowMenu(false); // Close menu when applications are opened
    };

    const toggleUserInfo = () => {
        setShowUserInfo(!showUserInfo);
        setShowApplications(false); // Close applications when user info is opened
        setShowMenu(false); // Close menu when user info is opened
    };

    const toggleMenu = () => {
        setShowMenu(!showMenu);
        setShowApplications(false); // Close applications when menu is opened
        setShowUserInfo(false); // Close user info when menu is opened
    };

    const handleLogoutClick = () => {
        handleLogout(); // Call the handleLogout function from context
        navigate('/login'); // Redirect to login page
    };

    const handleNavigation = (path) => {
        setShowApplications(false); // Close applications when navigating
        setShowUserInfo(false); // Close user info when navigating
        setShowMenu(false); // Close menu when navigating
        navigate(path); // Navigate to the specified path
    };

    return (
        <div className="dashboard-container">
            <Header /> {/* Integrated Header */}
            <nav className="navbar">
                <div className="navbar-left">
                    <div className="menu-container">
                        <button className="menu-btn" onClick={toggleMenu}>
                            <span className="menu-line"></span>
                            <span className="menu-line"></span>
                            <span className="menu-line"></span>
                        </button>
                        {showMenu && (
                            <div className="menu-dropdown">
                                <Link to="/dashboard" onClick={() => handleNavigation('/dashboard')}>Dashboard</Link>
                                <button onClick={toggleApplications} className='application-btn'>Applications</button>
                                <Link to="/feedback" onClick={() => handleNavigation('/feedback')}>Feedback</Link>
                                <Link to="/contact" onClick={() => handleNavigation('/contact')}>Contact</Link>
                            </div>
                        )}
                    </div>
                </div>
                <div className="navbar-right">
                    <div className="help-container">
                        <Link to="/help" className="help-btn" onClick={() => setShowApplications(false)}> {/* Help button linked to the Help page */}
                            <span className="help-icon">❓</span>
                        </Link>
                    </div>
                    <div className="settings-container">
                        <button className="settings-btn">
                            <span className="settings-icon">⚙️</span>
                        </button>
                    </div>
                    <div className="profile-dropdown">
                        <button className="dropbtn" onClick={toggleUserInfo}>
                            <span className="profile-icon">👤</span>
                        </button>
                        {showUserInfo && (
                            <div className="dropdown-content">
                                <Link to="/profile" onClick={() => handleNavigation('/profile')}>View Profile</Link>
                                <Link to="/edit-profile" onClick={() => handleNavigation('/edit-profile')}>Edit Profile</Link>
                                <button onClick={handleLogoutClick}>Logout</button> {/* Logout button */}
                            </div>
                        )}
                    </div>
                </div>
            </nav>
            <div className="dashboard-content">
                {showApplications && (
                    <div className="application-boxes">
                        <div className="application-box">
                            <Link to="/emission-tracking" onClick={() => handleNavigation('/emission-tracking')}>
                                Carbon Emission Tracking
                            </Link>
                        </div>
                        <div className="application-box">
                            <Link to="/carbon-credits" onClick={() => handleNavigation('/carbon-credits')}>
                                Carbon Credit Trading
                            </Link>
                        </div>
                        {/* Removed Blockchain Wallet from applications */}
                    </div>
                )}
                {/* Default content when Dashboard is loaded */}
                {!showApplications && (
                    <div className="dashboard-default-content">
                        <h2>Welcome to Ethertrack</h2>
                        <p>
        Ethertrack is a pioneering blockchain solution transforming the way we approach carbon emission tracking and carbon credits trading.
    </p>
    <h3>Key Features:</h3>
    <ul>
        <li>Effortlessly monitor and manage your carbon emissions.</li>
        <li>Generate insightful reports to understand your impact.</li>
        <li>Trade carbon credits with confidence, all backed by blockchain technology.</li>
    </ul>
    <h3>Why Choose Ethertrack?</h3>
    <p>
        Join us on this vital journey toward sustainability. Empower your organization to:
    </p>
    <ul>
        <li>Make impactful environmental decisions.</li>
        <li>Foster a culture of accountability.</li>
        <li>Contribute to a greener future for all.</li>
    </ul>
    <p>
        Together, we can create a sustainable world for generations to come!
    </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dashboard;
