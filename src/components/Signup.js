/**
 * Signup.jsx — EtherTrack
 * Updated: invite token flow wired up
 */

import React, { useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { FaGoogle, FaFacebook, FaEye, FaEyeSlash } from "react-icons/fa";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithPopup,
} from "firebase/auth";
import { auth, googleProvider, facebookProvider } from "../firebaseConfigure";
import { authAPI } from "../services/api";
import { showToast } from "../utils/toast";

let Sentry = null;
try { Sentry = require("@sentry/react"); } catch {}

const withRetry = async (fn, retries = 3, delayMs = 800) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r =>
        setTimeout(r, delayMs * Math.pow(2, attempt - 1) + Math.random() * 200)
      );
    }
  }
};

const syncToBackend = async (firebaseUser, provider = "email") => {
  const idToken = await firebaseUser.getIdToken();
  await withRetry(() =>
    authAPI.syncUser(
      {
        email:         firebaseUser.email,
        firebaseUid:   firebaseUser.uid,
        fullName:      firebaseUser.displayName || "",
        provider,
        emailVerified: firebaseUser.emailVerified,
      },
      idToken
    )
  );
};

const getFriendlyError = (err) => {
  switch (err.code) {
    case "auth/email-already-in-use":
      return "Account already exists. Please log in.";
    case "auth/weak-password":
      return "Password too weak. Use 8+ characters.";
    case "auth/popup-closed-by-user":
      return null;
    case "auth/popup-blocked":
      return "Popup blocked. Please allow popups for this site.";
    case "auth/account-exists-with-different-credential":
      return "An account already exists with this email. Try signing in instead.";
    default:
      return "Signup failed. Please try again.";
  }
};

const Signup = () => {
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [confirm,      setConfirm]      = useState("");
  const [error,        setError]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [activeMethod, setActiveMethod] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isInvited = searchParams.get('invite') === '1';

  const validateEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const startLoading  = (method) => { setLoading(true); setActiveMethod(method); setError(""); };
  const stopLoading   = ()       => { setLoading(false); setActiveMethod(""); };

  // ── Email/password signup ─────────────────────────────────────
  const handleSignupSubmit = async (e) => {
    e?.preventDefault();

    // Save invite token from URL into sessionStorage before navigating away
    const urlParams  = new URLSearchParams(window.location.search);
    const inviteToken = urlParams.get('token');
    if (inviteToken) sessionStorage.setItem('pending_invite_token', inviteToken);

    const trimmedEmail = email.trim();
    if (!validateEmail(trimmedEmail)) { setError("Invalid email format."); return; }
    if (password.length < 8)          { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm)         { setError("Passwords do not match."); return; }

    startLoading("email");
    try {
      const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);

      try {
        await sendEmailVerification(cred.user);
      } catch (verifyErr) {
        console.warn("Verification email failed (non-fatal):", verifyErr.message);
      }

      try {
        await syncToBackend(cred.user, "email");
      } catch (syncErr) {
        console.error("Backend sync failed after retries:", syncErr.message);
        showToast("⚠ Account created but profile sync failed. Some features may be limited.", "warning");
      }

      showToast("✅ Account created! Verify your email, then log in.", "success");
      // Keep invite token in sessionStorage — it will be read after login
      navigate(isInvited || sessionStorage.getItem('pending_invite_token') ? "/login?invite=1" : "/login");
    } catch (err) {
      if (!err.code) Sentry?.captureException(err);
      const msg = getFriendlyError(err);
      if (msg) setError(msg);
    } finally {
      stopLoading();
    }
  };

  // ── Social signup ─────────────────────────────────────────────
  const handleSocialSignup = async (provider, providerLabel) => {
    // Save invite token before social flow navigates away
    const urlParams   = new URLSearchParams(window.location.search);
    const inviteToken = urlParams.get('token');
    if (inviteToken) sessionStorage.setItem('pending_invite_token', inviteToken);

    startLoading(providerLabel.toLowerCase());
    try {
      const cred = await signInWithPopup(auth, provider);
      try {
        await syncToBackend(cred.user, providerLabel.toLowerCase());
      } catch (syncErr) {
        console.error("Backend sync failed after retries:", syncErr.message);
        showToast("⚠ Signed in but profile sync failed. Some features may be limited.", "warning");
      }
      showToast(`✅ Welcome! Signed up with ${providerLabel}.`, "success");
      // Social signup skips email verify — go straight to dashboard or invite
      const pendingToken = sessionStorage.getItem('pending_invite_token');
      navigate(pendingToken ? `/join-org?token=${pendingToken}` : "/dashboard");
    } catch (err) {
      if (!err.code) Sentry?.captureException(err);
      const msg = getFriendlyError(err);
      if (msg) setError(msg);
    } finally {
      stopLoading();
    }
  };

  // ── Password strength ─────────────────────────────────────────
  const strengthChecks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];
  const strengthLevel = strengthChecks.filter(Boolean).length;
  const strengthColor = ["#dc2626", "#dc2626", "#f97316", "#facc15", "#22c55e"][strengthLevel];
  const strengthLabel = ["Weak", "Weak", "Fair", "Good", "Strong"][strengthLevel];

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
        .et-auth-subtitle{font-size:11px;color:#4ade8066;letter-spacing:.1em;text-align:center;margin-bottom:16px}
        .et-invite-banner{padding:10px 14px;background:#0a1a0e;border:1px solid #22c55e33;border-radius:8px;font-size:11px;color:#22c55e88;margin-bottom:16px;line-height:1.7;text-align:center}
        .et-auth-label{display:block;font-size:10px;color:#4ade8088;letter-spacing:.12em;margin-bottom:6px;margin-top:14px}
        .et-input-wrap{position:relative;display:flex;align-items:center}
        .et-auth-input{width:100%;padding:11px 40px 11px 14px;background:#060a07;border:1px solid #0f2a1a;border-radius:7px;color:#e2e8e4;font-family:'DM Mono',monospace;font-size:13px;outline:none;transition:border-color .2s,box-shadow .2s;box-sizing:border-box}
        .et-auth-input:focus{border-color:#22c55e44;box-shadow:0 0 0 3px rgba(34,197,94,0.06)}
        .et-auth-input::placeholder{color:#4ade8033}
        .et-auth-input.invalid{border-color:#dc262644}
        .et-eye-btn{position:absolute;right:12px;background:none;border:none;cursor:pointer;color:#4ade8055;padding:4px;display:flex;align-items:center;transition:color .2s;flex-shrink:0}
        .et-eye-btn:hover,.et-eye-btn:focus-visible{color:#4ade80;outline:2px solid #22c55e44;border-radius:3px}
        .et-strength-wrap{display:flex;align-items:center;gap:8px;margin-top:6px}
        .et-strength{display:flex;gap:4px;flex:1}
        .et-strength-bar{flex:1;height:3px;border-radius:2px;transition:background .3s}
        .et-strength-label{font-size:9px;letter-spacing:.08em;min-width:36px;transition:color .3s}
        .et-auth-btn{width:100%;padding:13px;border-radius:7px;border:none;cursor:pointer;font-family:'DM Mono',monospace;font-size:13px;font-weight:700;letter-spacing:.1em;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;margin-top:20px;transition:opacity .2s,transform .1s}
        .et-auth-btn:hover:not(:disabled){opacity:.88;transform:translateY(-1px)}
        .et-auth-btn:disabled{opacity:.5;cursor:not-allowed}
        .et-social-btn{width:100%;padding:11px;border-radius:7px;border:1px solid #0f2a1a;background:#060a07;color:#e2e8e4;cursor:pointer;font-family:'DM Mono',monospace;font-size:12px;letter-spacing:.06em;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:10px;transition:border-color .2s,background .2s}
        .et-social-btn:hover:not(:disabled){border-color:#22c55e44;background:#0d2e1f}
        .et-social-btn:disabled{opacity:.5;cursor:not-allowed}
        .et-auth-divider{display:flex;align-items:center;gap:12px;margin:20px 0}
        .et-auth-divider::before,.et-auth-divider::after{content:'';flex:1;height:1px;background:#0f2a1a}
        .et-auth-divider span{font-size:10px;color:#4ade8033;letter-spacing:.1em}
        .et-auth-error{margin-top:12px;padding:10px 14px;background:#450a0a;border:1px solid #dc262644;border-radius:6px;color:#f87171;font-size:12px;animation:fadeIn .3s ease}
        @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
        .et-auth-footer{text-align:center;margin-top:24px;font-size:12px;color:#4ade8055}
        .et-auth-footer a{color:#22c55e;text-decoration:none}
        .et-auth-footer a:hover{color:#4ade80}
        .et-verify-notice{margin-top:14px;padding:11px 14px;background:#0a1f12;border:1px solid #16a34a22;border-radius:7px;color:#4ade8099;font-size:11px;line-height:1.6;letter-spacing:.03em}
      `}</style>

      <div className="et-auth-page">
        <div className="et-auth-glow" />
        <div className="et-auth-card">
          <div className="et-auth-title">Create Account</div>
          <div className="et-auth-subtitle">START TRACKING YOUR PORTFOLIO</div>

          {/* Invite banner */}
          {(isInvited || sessionStorage.getItem('pending_invite_token')) && (
            <div className="et-invite-banner">
              🎉 You've been invited to join a team — create your account to accept
            </div>
          )}

          <form onSubmit={handleSignupSubmit} noValidate>
            <label className="et-auth-label" htmlFor="signup-email">EMAIL ADDRESS</label>
            <div className="et-input-wrap">
              <input
                id="signup-email"
                className="et-auth-input"
                type="email"
                placeholder="you@company.com"
                value={email}
                autoComplete="email"
                onChange={e => { setEmail(e.target.value); setError(""); }}
              />
            </div>

            <label className="et-auth-label" htmlFor="signup-password">PASSWORD</label>
            <div className="et-input-wrap">
              <input
                id="signup-password"
                className="et-auth-input"
                type={showPassword ? "text" : "password"}
                placeholder="Min. 8 characters"
                value={password}
                autoComplete="new-password"
                onChange={e => { setPassword(e.target.value); setError(""); }}
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

            <div className="et-strength-wrap">
              <div className="et-strength">
                {[1,2,3,4].map(i => (
                  <div key={i} className="et-strength-bar" style={{
                    background: password ? (strengthLevel >= i ? strengthColor : "#1f2937") : "#1f2937",
                  }}/>
                ))}
              </div>
              {password && (
                <span className="et-strength-label" style={{ color: strengthColor }}>
                  {strengthLabel}
                </span>
              )}
            </div>

            <label className="et-auth-label" htmlFor="signup-confirm">CONFIRM PASSWORD</label>
            <div className="et-input-wrap">
              <input
                id="signup-confirm"
                className={`et-auth-input${confirm && confirm !== password ? " invalid" : ""}`}
                type={showConfirm ? "text" : "password"}
                placeholder="Re-enter password"
                value={confirm}
                autoComplete="new-password"
                onChange={e => { setConfirm(e.target.value); setError(""); }}
                onPaste={e => e.preventDefault()}
              />
              <button
                type="button"
                className="et-eye-btn"
                onClick={() => setShowConfirm(v => !v)}
                aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
              >
                {showConfirm ? <FaEyeSlash size={14} /> : <FaEye size={14} />}
              </button>
            </div>

            <div className="et-verify-notice">
              📧 A verification link will be sent to your email. You must verify before logging in.
            </div>

            {error && (
              <div className="et-auth-error" role="alert" aria-live="assertive">
                {error}
              </div>
            )}

            <button className="et-auth-btn" type="submit" disabled={loading}>
              {activeMethod === "email" ? "CREATING ACCOUNT..." : "CREATE ACCOUNT →"}
            </button>
          </form>

          <div className="et-auth-divider"><span>OR CONTINUE WITH</span></div>

          <button
            className="et-social-btn"
            type="button"
            onClick={() => handleSocialSignup(googleProvider, "Google")}
            disabled={loading}
          >
            <FaGoogle size={14} color="#4ade80" />
            {activeMethod === "google" ? "CONNECTING..." : "SIGN UP WITH GOOGLE"}
          </button>
          <button
            className="et-social-btn"
            type="button"
            onClick={() => handleSocialSignup(facebookProvider, "Facebook")}
            disabled={loading}
          >
            <FaFacebook size={14} color="#4ade80" />
            {activeMethod === "facebook" ? "CONNECTING..." : "SIGN UP WITH FACEBOOK"}
          </button>

          <div className="et-auth-footer">
            Already have an account? <Link to="/login">Sign in</Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default Signup;