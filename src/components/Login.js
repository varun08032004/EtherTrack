import React, { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import "./Login.css";
import { AuthContext } from "../App";
import { auth } from "../firebaseConfigure";

const Login = () => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(""); // Success message for reset
    const { handleLogin } = useContext(AuthContext);
    const navigate = useNavigate();

    // 🔹 Login Function
    const handleLoginClick = async () => {
        if (!email || !password) {
            setError("Please enter both email and password.");
            return;
        }

        setLoading(true);
        setError(""); // Clear previous errors

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;
            handleLogin({ email: user.email });
            navigate("/dashboard");
        } catch (error) {
            console.error("Login Error:", error);

            // 🔹 Better error messages
            switch (error.code) {
                case "auth/invalid-credential":
                    setError("Incorrect email or password.");
                    break;
                case "auth/user-not-found":
                    setError("No account found with this email.");
                    break;
                case "auth/wrong-password":
                    setError("Incorrect password.");
                    break;
                case "auth/too-many-requests":
                    setError("Too many failed attempts. Try again later or reset your password.");
                    break;
                default:
                    setError("Login failed. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    // 🔹 Forgot Password Function
    const handleForgotPassword = async () => {
        if (!email) {
            setError("Please enter your email to reset your password.");
            return;
        }

        setLoading(true);
        setError("");
        setMessage("");

        try {
            await sendPasswordResetEmail(auth, email);
            setMessage("Password reset link sent! Check your email.");
        } catch (error) {
            console.error("Reset Error:", error);

            switch (error.code) {
                case "auth/user-not-found":
                    setError("No account found with this email.");
                    break;
                case "auth/invalid-email":
                    setError("Invalid email format.");
                    break;
                default:
                    setError("Failed to send reset email. Try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <h1>Login</h1>
            <input
                type="text"
                placeholder="Email"
                value={email}
                onChange={(e) => {
                    setEmail(e.target.value);
                    setError("");
                    setMessage("");
                }}
            />
            <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
            />

            {error && <p className="error-message">{error}</p>}
            {message && <p className="success-message">{message}</p>}

            <div className="remember-me">
                <input type="checkbox" id="remember" />
                <label htmlFor="remember">Remember Me</label>
            </div>

            <button onClick={handleLoginClick} disabled={loading}>
                {loading ? "Logging in..." : "Login"}
            </button>

            <p>
            <Link to="#" onClick={handleForgotPassword} className="forgot-password">
                    Forgot Password?
                </Link>
            </p>

            <p>Don't have an account? <Link to="/signup" className="signup-link">Sign up</Link></p>
        </div>
    );
};

export default Login;
