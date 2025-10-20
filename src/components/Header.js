import React, { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';
import './Header.css';
import logo from '../Images/ET.png'; // Ensure this path is correct

const Header = () => {
    const { isAuthenticated, handleLogout } = useContext(AuthContext);
    const navigate = useNavigate();

    return (
        <header className="app-header">
            <Link to="/" className="logo-link">
                <img src={logo} alt="EtherTrack Logo" className="logo" />
                <h1>EtherTrack</h1>
            </Link>

           
            
        </header>
    );
};

export default Header;
