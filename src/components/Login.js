import React, { useState, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { AuthContext } from "../App";
import { auth } from "../firebaseConfigure";

const Login = () => {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError]       = useState("");
  const [message, setMessage]   = useState("");
  const [loading, setLoading]   = useState(false);

  const { handleLogin } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLoginClick = async () => {
    if (!email || !password) { setError("Please enter both email and password."); return; }
    setLoading(true); setError(""); setMessage("");
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      // ← Only change from original: pass firebaseUser as second arg for backend sync
      handleLogin(
        { email: userCredential.user.email },
        userCredential.user
      );
      navigate("/dashboard");
    } catch (err) {
      switch (err.code) {
        case "auth/invalid-credential":   setError("Incorrect email or password."); break;
        case "auth/user-not-found":       setError("No account found with this email."); break;
        case "auth/wrong-password":       setError("Incorrect password."); break;
        case "auth/too-many-requests":    setError("Too many attempts. Reset your password."); break;
        default:                          setError("Login failed. Please try again.");
      }
    } finally { setLoading(false); }
  };

  const handleForgotPassword = async () => {
    if (!email) { setError("Enter your email first."); return; }
    setLoading(true); setError(""); setMessage("");
    try {
      await sendPasswordResetEmail(auth, email);
      setMessage("✅ Reset link sent! Check your inbox.");
    } catch (err) {
      switch (err.code) {
        case "auth/user-not-found": setError("No account with this email."); break;
        case "auth/invalid-email":  setError("Invalid email format."); break;
        default:                    setError("Failed to send reset email.");
      }
    } finally { setLoading(false); }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") handleLoginClick(); };

  // ── JSX identical to original ─────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        .et-auth-page { min-height:100vh;background:#080c0a;display:flex;align-items:center;justify-content:center;font-family:'DM Mono',monospace;position:relative;overflow:hidden; }
        .et-auth-page::before { content:'';position:fixed;inset:0;z-index:0;background-image:linear-gradient(rgba(34,197,94,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,0.03) 1px,transparent 1px);background-size:40px 40px;pointer-events:none; }
        .et-auth-glow { position:fixed;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(22,163,74,0.06) 0%,transparent 70%);top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:0; }
        .et-auth-card { position:relative;z-index:1;width:100%;max-width:420px;background:#0a0f0c;border:1px solid #0f2a1a;border-radius:14px;padding:40px 36px;box-shadow:0 24px 64px rgba(0,0,0,0.6),0 0 0 1px #22c55e0a;animation:cardIn 0.5s ease both;top:-100px; }
        @keyframes cardIn { from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)} }
        .et-auth-title { font-size:22px;font-weight:700;color:#f0fdf4;letter-spacing:0.04em;margin-bottom:6px;text-align:center; }
        .et-auth-subtitle { font-size:11px;color:#4ade8066;letter-spacing:0.1em;text-align:center;margin-bottom:28px; }
        .et-auth-label { display:block;font-size:10px;color:#4ade8088;letter-spacing:0.12em;margin-bottom:6px;margin-top:14px; }
        .et-auth-input { width:100%;padding:11px 14px;background:#060a07;border:1px solid #0f2a1a;border-radius:7px;color:#e2e8e4;font-family:'DM Mono',monospace;font-size:13px;outline:none;transition:border-color 0.2s,box-shadow 0.2s;box-sizing:border-box; }
        .et-auth-input:focus { border-color:#22c55e44;box-shadow:0 0 0 3px rgba(34,197,94,0.06); }
        .et-auth-input::placeholder { color:#4ade8033; }
        .et-auth-row { display:flex;align-items:center;justify-content:space-between;margin:14px 0; }
        .et-auth-check { display:flex;align-items:center;gap:8px;font-size:11px;color:#4ade8066;cursor:pointer; }
        .et-auth-check input[type="checkbox"] { width:14px;height:14px;accent-color:#22c55e;cursor:pointer; }
        .et-auth-forgot { font-size:11px;color:#22c55e88;cursor:pointer;background:none;border:none;font-family:inherit;letter-spacing:0.06em;transition:color 0.2s;padding:0; }
        .et-auth-forgot:hover { color:#22c55e; }
        .et-auth-btn { width:100%;padding:13px;border-radius:7px;border:none;cursor:pointer;font-family:'DM Mono',monospace;font-size:13px;font-weight:700;letter-spacing:0.1em;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;margin-top:20px;transition:opacity 0.2s,transform 0.1s; }
        .et-auth-btn:hover:not(:disabled) { opacity:0.88;transform:translateY(-1px); }
        .et-auth-btn:disabled { opacity:0.5;cursor:not-allowed; }
        .et-auth-divider { display:flex;align-items:center;gap:12px;margin:22px 0; }
        .et-auth-divider::before,.et-auth-divider::after { content:'';flex:1;height:1px;background:#0f2a1a; }
        .et-auth-divider span { font-size:10px;color:#4ade8033;letter-spacing:0.1em; }
        .et-auth-error { margin-top:12px;padding:10px 14px;background:#450a0a;border:1px solid #dc262644;border-radius:6px;color:#f87171;font-size:12px;animation:fadeIn 0.3s ease; }
        .et-auth-success { margin-top:12px;padding:10px 14px;background:#0d2e1f;border:1px solid #16a34a44;border-radius:6px;color:#22c55e;font-size:12px;animation:fadeIn 0.3s ease; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)} }
        .et-auth-footer { text-align:center;margin-top:24px;font-size:12px;color:#4ade8055; }
        .et-auth-footer a { color:#22c55e;text-decoration:none;transition:color 0.2s; }
        .et-auth-footer a:hover { color:#4ade80; }
      `}</style>

      <div className="et-auth-page">
        <div className="et-auth-glow" />
        <div className="et-auth-card">
          <div className="et-auth-title">Welcome Back</div>
          <div className="et-auth-subtitle">SIGN IN TO YOUR ACCOUNT</div>

          <label className="et-auth-label">EMAIL ADDRESS</label>
          <input className="et-auth-input" type="email" placeholder="you@company.com"
            value={email} onChange={e => { setEmail(e.target.value); setError(""); setMessage(""); }}
            onKeyDown={handleKeyDown} />

          <label className="et-auth-label">PASSWORD</label>
          <input className="et-auth-input" type="password" placeholder="••••••••"
            value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={handleKeyDown} />

          <div className="et-auth-row">
            <label className="et-auth-check">
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
              Remember me
            </label>
            <button className="et-auth-forgot" onClick={handleForgotPassword} disabled={loading}>
              Forgot password?
            </button>
          </div>

          {error   && <div className="et-auth-error">{error}</div>}
          {message && <div className="et-auth-success">{message}</div>}

          <button className="et-auth-btn" onClick={handleLoginClick} disabled={loading}>
            {loading ? "AUTHENTICATING..." : "SIGN IN →"}
          </button>

          <div className="et-auth-divider"><span>OR</span></div>

          <div className="et-auth-footer">
            Don't have an account? <Link to="/signup">Create account</Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default Login;