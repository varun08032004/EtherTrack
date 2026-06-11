/**
 * Login.jsx — EtherTrack
 * Updated: invite token flow wired up
 */

import React, { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signInWithPopup,
} from "firebase/auth";
import { FaEye, FaEyeSlash, FaGoogle, FaFacebook } from "react-icons/fa";
import { AuthContext } from "../App";
import { auth, googleProvider, facebookProvider } from "../firebaseConfigure";
import { authAPI } from "../services/api";
import { showToast } from "../utils/toast";

let Sentry = null;
try { Sentry = require("@sentry/react"); } catch {}

const getFriendlyError = (err) => {
  switch (err.code) {
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many failed attempts. Reset your password or try later.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact support.";
    case "auth/account-exists-with-different-credential":
      return "An account already exists with this email. Try a different sign-in method.";
    case "auth/popup-closed-by-user":
      return null;
    case "auth/popup-blocked":
      return "Popup blocked. Please allow popups for this site.";
    default:
      return "Login failed. Please try again.";
  }
};

const Login = () => {
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [remember,     setRemember]     = useState(false);
  const [error,        setError]        = useState("");
  const [message,      setMessage]      = useState("");
  const [loading,      setLoading]      = useState(false);
  const [activeMethod, setActiveMethod] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const { handleLogin } = useContext(AuthContext);
  const navigate = useNavigate();

  const clearMessages = ()       => { setError(""); setMessage(""); };
  const startLoading  = (method) => { setLoading(true); setActiveMethod(method); clearMessages(); };
  const stopLoading   = ()       => { setLoading(false); setActiveMethod(""); };

  // ── Resolve redirect after login ──────────────────────────────
  const resolveRedirect = (result) => {
    const dbUser = result?.dbUser || result;
    if (dbUser?.role === "admin") return "/admin";
    if (result?.redirect)        return result.redirect;
    return "/dashboard";
  };

  // ── Email/password login ──────────────────────────────────────
  const handleLoginSubmit = async (e) => {
    e?.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Please enter both email and password.");
      return;
    }
    startLoading("email");
    try {
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
      const userCredential = await signInWithEmailAndPassword(auth, trimmedEmail, password);
      const firebaseUser   = userCredential.user;

      const result = await handleLogin({ email: firebaseUser.email }, firebaseUser);
      showToast("✅ Welcome back!", "success");
      navigate(resolveRedirect(result), { replace: true });
    } catch (err) {
      if (err?.status === 403 || err?.error === "Email not verified") {
        setError("Please verify your email before logging in. Check your inbox.");
        stopLoading();
        return;
      }
      if (!err.code) Sentry?.captureException(err);
      const msg = getFriendlyError(err);
      if (msg) setError(msg);
      stopLoading();
    }
  };

  // ── Social login ──────────────────────────────────────────────
  const handleSocialLogin = async (provider, providerLabel) => {
    startLoading(providerLabel.toLowerCase());
    try {
      const cred = await signInWithPopup(auth, provider);
      try {
        await authAPI.syncUser(
          {
            email:         cred.user.email,
            firebaseUid:   cred.user.uid,
            fullName:      cred.user.displayName || "",
            provider:      providerLabel.toLowerCase(),
            emailVerified: cred.user.emailVerified,
          },
          await cred.user.getIdToken()
        );
      } catch (syncErr) {
        console.error("Backend sync failed:", syncErr.message);
        showToast("⚠ Signed in but profile sync failed. Some features may be limited.", "warning");
      }

      const result = await handleLogin({ email: cred.user.email }, cred.user);
      showToast("✅ Welcome back!", "success");
      navigate(resolveRedirect(result), { replace: true });
    } catch (err) {
      if (!err.code) Sentry?.captureException(err);
      const msg = getFriendlyError(err);
      if (msg) setError(msg);
      stopLoading();
    }
  };

  // ── Forgot password ───────────────────────────────────────────
  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) { setError("Enter your email address first."); return; }
    startLoading("forgot");
    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setMessage("✅ Reset link sent! Check your inbox.");
    } catch (err) {
      switch (err.code) {
        case "auth/user-not-found": setError("No account with this email."); break;
        case "auth/invalid-email":  setError("Invalid email format."); break;
        default:                    setError("Failed to send reset email. Try again.");
      }
    } finally { stopLoading(); }
  };

  const isEmailLoading  = loading && activeMethod === "email";
  const isGoogleLoading = loading && activeMethod === "google";
  const isFBLoading     = loading && activeMethod === "facebook";
  const isForgotLoading = loading && activeMethod === "forgot";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        .et-auth-page{min-height:100vh;background:#080c0a;display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;position:relative;overflow:hidden}
        .et-auth-page::before{content:'';position:fixed;inset:0;z-index:0;background-image:linear-gradient(rgba(34,197,94,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,0.03) 1px,transparent 1px);background-size:40px 40px;pointer-events:none}
        .et-auth-glow{position:fixed;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(22,163,74,0.06) 0%,transparent 70%);top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:0}
        .et-auth-card{position:relative;z-index:1;width:100%;max-width:420px;background:#0a0f0c;border:1px solid #0f2a1a;border-radius:14px;padding:40px 36px;box-shadow:0 24px 64px rgba(0,0,0,0.6),0 0 0 1px #22c55e0a;animation:cardIn .5s ease both}
        @keyframes cardIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        .et-auth-title{font-size:22px;font-weight:700;color:#f0fdf4;letter-spacing:.04em;margin-bottom:6px;text-align:center}
        .et-auth-subtitle{font-size:11px;color:#4ade8066;letter-spacing:.1em;text-align:center;margin-bottom:28px}
        .et-auth-label{display:block;font-size:10px;color:#4ade8088;letter-spacing:.12em;margin-bottom:6px;margin-top:14px}
        .et-input-wrap{position:relative;display:flex;align-items:center}
        .et-auth-input{width:100%;padding:11px 40px 11px 14px;background:#060a07;border:1px solid #0f2a1a;border-radius:7px;color:#e2e8e4;font-family:'DM Mono',monospace;font-size:13px;outline:none;transition:border-color .2s,box-shadow .2s;box-sizing:border-box}
        .et-auth-input:focus{border-color:#22c55e44;box-shadow:0 0 0 3px rgba(34,197,94,0.06)}
        .et-auth-input::placeholder{color:#4ade8033}
        .et-eye-btn{position:absolute;right:12px;background:none;border:none;cursor:pointer;color:#4ade8055;padding:4px;display:flex;align-items:center;transition:color .2s;flex-shrink:0}
        .et-eye-btn:hover,.et-eye-btn:focus-visible{color:#4ade80;outline:2px solid #22c55e44;border-radius:3px}
        .et-auth-row{display:flex;align-items:center;justify-content:space-between;margin:14px 0}
        .et-auth-check{display:flex;align-items:center;gap:8px;font-size:11px;color:#4ade8066;cursor:pointer}
        .et-auth-check input[type="checkbox"]{width:14px;height:14px;accent-color:#22c55e;cursor:pointer}
        .et-auth-forgot{font-size:11px;color:#22c55e88;cursor:pointer;background:none;border:none;font-family:inherit;letter-spacing:.06em;transition:color .2s;padding:0}
        .et-auth-forgot:hover{color:#22c55e}
        .et-auth-btn{width:100%;padding:13px;border-radius:7px;border:none;cursor:pointer;font-family:'DM Mono',monospace;font-size:13px;font-weight:700;letter-spacing:.1em;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;margin-top:20px;transition:opacity .2s,transform .1s}
        .et-auth-btn:hover:not(:disabled){opacity:.88;transform:translateY(-1px)}
        .et-auth-btn:disabled{opacity:.5;cursor:not-allowed}
        .et-social-btn{width:100%;padding:11px;border-radius:7px;border:1px solid #0f2a1a;background:#060a07;color:#e2e8e4;cursor:pointer;font-family:'DM Mono',monospace;font-size:12px;letter-spacing:.06em;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:10px;transition:border-color .2s,background .2s}
        .et-social-btn:hover:not(:disabled){border-color:#22c55e44;background:#0d2e1f}
        .et-social-btn:disabled{opacity:.5;cursor:not-allowed}
        .et-auth-divider{display:flex;align-items:center;gap:12px;margin:22px 0}
        .et-auth-divider::before,.et-auth-divider::after{content:'';flex:1;height:1px;background:#0f2a1a}
        .et-auth-divider span{font-size:10px;color:#4ade8033;letter-spacing:.1em}
        .et-auth-error{margin-top:12px;padding:10px 14px;background:#450a0a;border:1px solid #dc262644;border-radius:6px;color:#f87171;font-size:12px;animation:fadeIn .3s ease}
        .et-auth-success{margin-top:12px;padding:10px 14px;background:#0d2e1f;border:1px solid #16a34a44;border-radius:6px;color:#22c55e;font-size:12px;animation:fadeIn .3s ease}
        .et-invite-banner{padding:10px 14px;background:#0a1a0e;border:1px solid #22c55e33;border-radius:8px;font-size:11px;color:#22c55e88;margin-bottom:16px;line-height:1.7;text-align:center}
        @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        .et-auth-footer{text-align:center;margin-top:24px;font-size:12px;color:#4ade8055}
        .et-auth-footer a{color:#22c55e;text-decoration:none;transition:color .2s}
        .et-auth-footer a:hover{color:#4ade80}
      `}</style>

      <div className="et-auth-page">
        <div className="et-auth-glow" />
        <div className="et-auth-card">
          <div className="et-auth-title">Welcome Back</div>
          <div className="et-auth-subtitle">SIGN IN TO YOUR ACCOUNT</div>

          {/* Show invite banner if pending token exists */}
          {sessionStorage.getItem('pending_invite_token') && (
            <div className="et-invite-banner">
              🎉 Sign in to accept your team invitation
            </div>
          )}

          <form onSubmit={handleLoginSubmit} noValidate>
            <label className="et-auth-label" htmlFor="login-email">EMAIL ADDRESS</label>
            <div className="et-input-wrap">
              <input
                id="login-email"
                className="et-auth-input"
                type="email"
                placeholder="you@company.com"
                value={email}
                autoComplete="email"
                onChange={e => { setEmail(e.target.value); clearMessages(); }}
              />
            </div>

            <label className="et-auth-label" htmlFor="login-password">PASSWORD</label>
            <div className="et-input-wrap">
              <input
                id="login-password"
                className="et-auth-input"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                autoComplete="current-password"
                onChange={e => { setPassword(e.target.value); clearMessages(); }}
              />
              <button
                type="button"
                className="et-eye-btn"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <FaEyeSlash size={14} /> : <FaEye size={14} />}
              </button>
            </div>

            <div className="et-auth-row">
              <label className="et-auth-check">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={e => setRemember(e.target.checked)}
                />
                Remember me
              </label>
              <button
                type="button"
                className="et-auth-forgot"
                onClick={handleForgotPassword}
                disabled={loading}
              >
                {isForgotLoading ? "Sending..." : "Forgot password?"}
              </button>
            </div>

            {error   && <div className="et-auth-error"   role="alert"  aria-live="assertive">{error}</div>}
            {message && <div className="et-auth-success" role="status" aria-live="polite">{message}</div>}

            <button className="et-auth-btn" type="submit" disabled={loading}>
              {isEmailLoading ? "AUTHENTICATING..." : "SIGN IN →"}
            </button>
          </form>

          <div className="et-auth-divider"><span>OR CONTINUE WITH</span></div>

          <button
            className="et-social-btn"
            onClick={() => handleSocialLogin(googleProvider, "Google")}
            disabled={loading}
            type="button"
          >
            <FaGoogle size={14} color="#4ade80" />
            {isGoogleLoading ? "CONNECTING..." : "SIGN IN WITH GOOGLE"}
          </button>
          <button
            className="et-social-btn"
            onClick={() => handleSocialLogin(facebookProvider, "Facebook")}
            disabled={loading}
            type="button"
          >
            <FaFacebook size={14} color="#4ade80" />
            {isFBLoading ? "CONNECTING..." : "SIGN IN WITH FACEBOOK"}
          </button>

          <div className="et-auth-footer">
            Don't have an account? <Link to="/signup">Create account</Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default Login;