import React from 'react';
import { Link } from 'react-router-dom';
import './Header.css';
import logo from '../Images/ET.png'; // Adjust the path as needed

const Header = () => {
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
