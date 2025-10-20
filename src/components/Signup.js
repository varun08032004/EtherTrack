import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Signup.css";
import { FaGoogle, FaFacebook } from "react-icons/fa";
import { auth, googleProvider, facebookProvider } from "../firebaseConfigure";
import { signInWithPopup, createUserWithEmailAndPassword } from "firebase/auth";

const Signup = () => {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [emailError, setEmailError] = useState("");
    const navigate = useNavigate();

    const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    // 🔹 Signup with Email & Password
    const handleSignup = async () => {
        if (!validateEmail(email)) {
            setEmailError("Invalid email format");
            return;
        }

        try {
            await createUserWithEmailAndPassword(auth, email, password);
            alert("Signup successful! Please log in.");  // Notify user
            navigate("/login");  // Redirect to login page
        } catch (error) {
            console.error("Signup Error:", error);
            setEmailError(error.message);
        }
    };

    // 🔹 Google Signup
    const handleGoogleSignup = async () => {
        try {
            await signInWithPopup(auth, googleProvider);
            alert("Signup successful! Please log in.");
            navigate("/login");
        } catch (error) {
            console.error("Google Sign-Up Error:", error);
        }
    };

    // 🔹 Facebook Signup
    const handleFacebookSignup = async () => {
        try {
            await signInWithPopup(auth, facebookProvider);
            alert("Signup successful! Please log in.");
            navigate("/login");
        } catch (error) {
            console.error("Facebook Sign-Up Error:", error);
        }
    };

    return (
        <div className="signup-container">
            <h1>Signup</h1>
            <input
                type="text"
                placeholder="Email"
                value={email}
                onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError("");
                }}
                className={emailError ? "invalid" : ""}
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
                <button className="google-signup" onClick={handleGoogleSignup}>
                    <FaGoogle /> Sign Up with Google
                </button>
                <button className="facebook-signup" onClick={handleFacebookSignup}>
                    <FaFacebook /> Sign Up with Facebook
                </button>
            </div>

            <p>Already a user? <a href="/login">Login</a></p>
        </div>
    );
};

export default Signup;
