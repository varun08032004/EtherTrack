import React, { useState, useContext } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import './Login.css';
import { AuthContext } from '../App';
import Header from '../components/Header'; // Importing Header

const Login = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const { setIsAuthenticated } = useContext(AuthContext);
    const navigate = useNavigate();

    const handleLogin = () => {
        // Simulate authentication
        setIsAuthenticated(true);
        navigate('/dashboard');
    };

    return (
        <div className="login-container">
            <Header /> {/* Integrated Header */}
            <h1>Login</h1>
            <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
            />
            <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
            />
            <button onClick={handleLogin}>Login</button>
            <p>Don't have an account? <Link to="/signup">Sign up</Link></p> {/* Link to signup */}
        </div>
    );
};

export default Login;
