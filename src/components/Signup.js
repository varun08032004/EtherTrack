import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import './Signup.css';
import { AuthContext } from '../App';
import { FaGoogle, FaFacebook } from 'react-icons/fa';
import Header from '../components/Header'; // Importing Header

const Signup = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [emailError, setEmailError] = useState('');
    const { setIsAuthenticated } = useContext(AuthContext);
    const navigate = useNavigate();

    const validateEmail = (email) => {
        // Simple regex for email validation
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    };

    const handleSignup = () => {
        if (validateEmail(email)) {
            // Simulate authentication
            setIsAuthenticated(true);
            navigate('/login'); // Redirect to login page after successful signup
        } else {
            setEmailError('Invalid email format'); // Show error message if email is invalid
        }
    };

    return (
        <div className="signup-container">
            <Header /> {/* Integrated Header */}
            <h1>Signup</h1>
            <input
                type="text"
                placeholder="Email"
                value={email}
                onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError(''); // Clear error on change
                }}
                className={emailError ? 'invalid' : ''}
            />
            {emailError && <span className="error-message">{emailError}</span>}
            <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
            />
            <button onClick={handleSignup}>Sign Up</button>
            <div className="social-buttons">
                <button>
                    <FaGoogle /> Sign Up with Google
                </button>
                <button>
                    <FaFacebook /> Sign Up with Facebook
                </button>
            </div>
            <p>Already a user? <a href="/login">Login</a></p>
        </div>
    );
};

export default Signup;
