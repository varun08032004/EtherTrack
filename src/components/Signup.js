import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { FaGoogle, FaFacebook } from "react-icons/fa";
import { auth, googleProvider, facebookProvider } from "../firebaseConfigure";
import { signInWithPopup, createUserWithEmailAndPassword } from "firebase/auth";
import { authAPI } from "../services/api";

const Signup = () => {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();

  const validateEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  // Sync to backend after Firebase creates user (non-fatal)
  const syncToBackend = async (firebaseUser) => {
    try {
      await authAPI.syncUser({
        email:       firebaseUser.email,
        firebaseUid: firebaseUser.uid,
        fullName:    firebaseUser.displayName || '',
      });
    } catch (e) {
      console.warn('Backend sync failed (non-fatal):', e?.message || e);
    }
  };

  const handleSignup = async () => {
    if (!validateEmail(email)) { setError("Invalid email format."); return; }
    if (password.length < 6)   { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm)  { setError("Passwords do not match."); return; }
    setLoading(true); setError("");
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await syncToBackend(cred.user); // ← sync to backend
      navigate("/login");
    } catch (err) {
      switch (err.code) {
        case "auth/email-already-in-use": setError("Account already exists. Please log in."); break;
        case "auth/weak-password":        setError("Password too weak. Use 6+ characters."); break;
        default:                          setError("Signup failed. Please try again.");
      }
    } finally { setLoading(false); }
  };

  const handleGoogleSignup = async () => {
    setLoading(true); setError("");
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await syncToBackend(cred.user); // ← sync to backend
      navigate("/login");
    } catch (err) {
      setError("Google sign-up failed. Please try again.");
    } finally { setLoading(false); }
  };

  const handleFacebookSignup = async () => {
    setLoading(true); setError("");
    try {
      const cred = await signInWithPopup(auth, facebookProvider);
      await syncToBackend(cred.user); // ← sync to backend
      navigate("/login");
    } catch (err) {
      setError("Facebook sign-up failed. Please try again.");
    } finally { setLoading(false); }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") handleSignup(); };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        .et-auth-page { min-height:100vh;background:#080c0a;display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;position:relative;overflow:hidden; }
        .et-auth-page::before { content:'';position:fixed;inset:0;z-index:0;background-image:linear-gradient(rgba(34,197,94,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,0.03) 1px,transparent 1px);background-size:40px 40px;pointer-events:none; }
        .et-auth-glow { position:fixed;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(22,163,74,0.06) 0%,transparent 70%);top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:0; }
        .et-auth-card { position:relative;z-index:1;width:100%;max-width:420px;background:#0a0f0c;border:1px solid #0f2a1a;border-radius:14px;padding:40px 36px;box-shadow:0 24px 64px rgba(0,0,0,0.6),0 0 0 1px #22c55e0a;animation:cardIn 0.5s ease both; }
        @keyframes cardIn { from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)} }
        .et-auth-title { font-size:22px;font-weight:700;color:#f0fdf4;letter-spacing:0.04em;margin-bottom:6px;text-align:center; }
        .et-auth-subtitle { font-size:11px;color:#4ade8066;letter-spacing:0.1em;text-align:center;margin-bottom:28px; }
        .et-auth-label { display:block;font-size:10px;color:#4ade8088;letter-spacing:0.12em;margin-bottom:6px;margin-top:14px; }
        .et-auth-input { width:100%;padding:11px 14px;background:#060a07;border:1px solid #0f2a1a;border-radius:7px;color:#e2e8e4;font-family:'DM Mono',monospace;font-size:13px;outline:none;transition:border-color 0.2s,box-shadow 0.2s;box-sizing:border-box; }
        .et-auth-input:focus { border-color:#22c55e44;box-shadow:0 0 0 3px rgba(34,197,94,0.06); }
        .et-auth-input::placeholder { color:#4ade8033; }
        .et-auth-input.invalid { border-color:#dc262644; }
        .et-auth-btn { width:100%;padding:13px;border-radius:7px;border:none;cursor:pointer;font-family:'DM Mono',monospace;font-size:13px;font-weight:700;letter-spacing:0.1em;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;margin-top:20px;transition:opacity 0.2s,transform 0.1s; }
        .et-auth-btn:hover:not(:disabled) { opacity:0.88;transform:translateY(-1px); }
        .et-auth-btn:disabled { opacity:0.5;cursor:not-allowed; }
        .et-social-btn { width:100%;padding:11px;border-radius:7px;border:1px solid #0f2a1a;background:#060a07;color:#e2e8e4;cursor:pointer;font-family:'DM Mono',monospace;font-size:12px;letter-spacing:0.06em;margin-top:10px;display:flex;align-items:center;justify-content:center;gap:10px;transition:border-color 0.2s,background 0.2s; }
        .et-social-btn:hover { border-color:#22c55e44;background:#0d2e1f; }
        .et-auth-divider { display:flex;align-items:center;gap:12px;margin:20px 0; }
        .et-auth-divider::before,.et-auth-divider::after { content:'';flex:1;height:1px;background:#0f2a1a; }
        .et-auth-divider span { font-size:10px;color:#4ade8033;letter-spacing:0.1em; }
        .et-auth-error { margin-top:12px;padding:10px 14px;background:#450a0a;border:1px solid #dc262644;border-radius:6px;color:#f87171;font-size:12px;animation:fadeIn 0.3s ease; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)} }
        .et-auth-footer { text-align:center;margin-top:24px;font-size:12px;color:#4ade8055; }
        .et-auth-footer a { color:#22c55e;text-decoration:none; }
        .et-auth-footer a:hover { color:#4ade80; }
        .et-strength { display:flex;gap:4px;margin-top:6px; }
        .et-strength-bar { flex:1;height:3px;border-radius:2px;background:#0f2a1a;transition:background 0.3s; }
      `}</style>

      <div className="et-auth-page">
        <div className="et-auth-glow" />
        <div className="et-auth-card">
          <div className="et-auth-title">Create Account</div>
          <div className="et-auth-subtitle">JOIN INDIA'S CARBON EXCHANGE</div>

          <label className="et-auth-label">EMAIL ADDRESS</label>
          <input className={`et-auth-input${error && !email ? " invalid" : ""}`}
            type="email" placeholder="you@company.com" value={email}
            onChange={e => { setEmail(e.target.value); setError(""); }}
            onKeyDown={handleKeyDown} />

          <label className="et-auth-label">PASSWORD</label>
          <input className="et-auth-input" type="password" placeholder="Min. 6 characters"
            value={password} onChange={e => { setPassword(e.target.value); setError(""); }}
            onKeyDown={handleKeyDown} />
          <div className="et-strength">
            {[1,2,3,4].map(i => (
              <div key={i} className="et-strength-bar" style={{
                background: password.length >= i * 3
                  ? i<=1?"#dc2626":i<=2?"#f97316":i<=3?"#facc15":"#22c55e" : "#0f2a1a"
              }} />
            ))}
          </div>

          <label className="et-auth-label">CONFIRM PASSWORD</label>
          <input className={`et-auth-input${confirm && confirm !== password ? " invalid" : ""}`}
            type="password" placeholder="Re-enter password" value={confirm}
            onChange={e => { setConfirm(e.target.value); setError(""); }}
            onKeyDown={handleKeyDown} />

          {error && <div className="et-auth-error">{error}</div>}

          <button className="et-auth-btn" onClick={handleSignup} disabled={loading}>
            {loading ? "CREATING ACCOUNT..." : "CREATE ACCOUNT →"}
          </button>

          <div className="et-auth-divider"><span>OR CONTINUE WITH</span></div>

          <button className="et-social-btn" onClick={handleGoogleSignup} disabled={loading}>
            <FaGoogle size={14} color="#4ade80" /> SIGN UP WITH GOOGLE
          </button>
          <button className="et-social-btn" onClick={handleFacebookSignup} disabled={loading}>
            <FaFacebook size={14} color="#4ade80" /> SIGN UP WITH FACEBOOK
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