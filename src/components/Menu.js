// src/components/Menu.js
import React, { useState } from 'react';
import './Menu.css';

const Menu = () => {
    const [showMenu, setShowMenu] = useState(false);

    const toggleMenu = () => {
        setShowMenu(!showMenu);
    };

    return (
        <div className="menu-container">
            <button className="menu-btn" onClick={toggleMenu}>
                <span className="menu-line"></span>
                <span className="menu-line"></span>
                <span className="menu-line"></span>
            </button>
            {showMenu && (
                <div className="menu-dropdown">
                    <a href="/help">Help</a>
                    <a href="/settings">Settings</a>
                    <a href="/profile">User Info</a>
                </div>
            )}
        </div>
    );
};

export default Menu;
