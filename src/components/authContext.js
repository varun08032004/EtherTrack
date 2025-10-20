// src/authContext.js
import React, { createContext, useContext, useState, useEffect } from 'react';

// Create AuthContext to store authentication status and actions
const AuthContext = createContext();

// Custom hook to access authentication status
export const useAuth = () => useContext(AuthContext);

// AuthProvider to manage authentication state globally
export const AuthProvider = ({ children }) => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    // Check localStorage for token when app loads
    useEffect(() => {
        const token = localStorage.getItem('authToken');
        if (token) {
            setIsAuthenticated(true);
        }
    }, []);

    // Login function: Store token in localStorage and update state
    const login = (token) => {
        localStorage.setItem('authToken', token);
        setIsAuthenticated(true);
    };

    // Logout function: Remove token from localStorage and update state
    const logout = () => {
        localStorage.removeItem('authToken');
        setIsAuthenticated(false);
    };

    return (
        <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};
