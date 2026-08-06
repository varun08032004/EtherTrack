/**
 * Signup.jsx — EtherTrack v2
 *
 * FIX: Email/password signup now calls backend /register directly (no Firebase).
 *      After register succeeds, an inline OTP step appears.
 *      Once verified, backend sets httpOnly cookies and navigates to dashboard.
 *      Firebase is only used for Google/Facebook OAuth (unchanged).
 *
 * Flow:
 *   1. User fills name + email + password → POST /api/auth/register
 *   2. Backend creates user with bcrypt hash, sends OTP via Resend
 *   3. OTP input shown inline → POST /api/auth/verify-email
 *   4. Backend sets cookies → /api/auth/me → navigate to dashboard
 *
 * NOTE: All handlers, state, and API calls below are unchanged from the
 * previous version. Only the JSX / Tailwind classes were rebuilt to match
 * the new reference design and to avoid complex arbitrary-value class
 * patterns (e.g. multi-layer bracket shadows) that were causing the
 * PostCSS/Tailwind build to silently fail to generate rules for this file.
 */

import React, { useState, useContext } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FaGoogle, FaFacebook } from "react-icons/fa";
import {
  User, Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck,
  CheckCircle2, Circle, Leaf, Activity, Globe2,
} from "lucide-react";
import { signInWithPopup } from "firebase/auth";
import { auth, googleProvider, facebookProvider } from "../firebaseConfigure";
import { authAPI } from "../services/api";
import { AuthContext } from "../App";
import { showToast } from "../utils/toast";
import globeImage from "../assets/ethertrack-globe.png";
import logoImage from "../assets/ethertrack-logo.png";

let Sentry = null;
try { Sentry = require("@sentry/react"); } catch {}

// ── Helpers ───────────────────────────────────────────────────────
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

const syncToBackend = async (firebaseUser, provider = "google") => {
  const idToken = await firebaseUser.getIdToken();
  return withRetry(() =>
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
  if (err?.error) return err.error;
  switch (err?.code) {
    case "auth/popup-closed-by-user":       return null;
    case "auth/popup-blocked":              return "Popup blocked. Please allow popups for this site.";
    case "auth/account-exists-with-different-credential":
      return "An account with this email already exists. Try signing in instead.";
    default:
      return err?.message || "Something went wrong. Please try again.";
  }
};

/* ------------------------------------------------------------------ */
/*  Shared visual primitives                                          */
/* ------------------------------------------------------------------ */

function Field({ icon: Icon, label, children }) {
  return (
    <div className="mb-4">
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-white/90">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        )}
        {children}
      </div>
    </div>
  );
}

const inputBase =
  "h-12 w-full rounded-xl border border-white/10 bg-black/30 pl-10 pr-10 text-sm text-white " +
  "placeholder-white/25 outline-none transition-colors duration-200 " +
  "focus:border-green-500 focus:bg-black/50";

function PrimaryButton({ children, loading, loadingLabel, ...props }) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.2 }}
      disabled={loading}
      className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl
                 bg-green-500 text-base font-semibold text-black shadow-lg shadow-green-500/30
                 transition-colors duration-200 hover:bg-green-400
                 disabled:cursor-not-allowed disabled:opacity-60"
      {...props}
    >
      <span>{loading ? loadingLabel : children}</span>
      {!loading && (
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      )}
    </motion.button>
  );
}

function SocialButton({ icon, children, ...props }) {
  return (
    <button
      type="button"
      className="mt-2.5 flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border
                 border-white/10 bg-black/20 text-sm font-medium text-white/80 transition-colors
                 duration-200 hover:border-green-500/40 hover:bg-green-500/5
                 disabled:cursor-not-allowed disabled:opacity-50"
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

function ErrorBanner({ error }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          role="alert"
          aria-live="assertive"
          className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400"
        >
          {error}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/*  Earth-at-night / India-lit-up visual                              */
/* ------------------------------------------------------------------ */

function GlobeVisual() {
  return (
    <div className="relative w-full overflow-hidden rounded-2xl">
      <img
        src={globeImage}
        alt=""
        className="h-full w-full object-cover"
      />
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black to-transparent" />
    </div>
  );
}

const FEATURES = [
  { icon: ShieldCheck, title: "Enterprise Grade", subtitle: "Security & Compliance" },
  { icon: Activity,    title: "Real-time Analytics", subtitle: "Actionable Insights" },
  { icon: Globe2,      title: "Global Marketplace", subtitle: "Trusted & Transparent" },
];

// ── Component ─────────────────────────────────────────────────────
const Signup = () => {
  // Step 1 fields
  const [fullName,     setFullName]     = useState("");
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [confirm,      setConfirm]      = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);

  // Step 2 — OTP
  const [step,        setStep]        = useState("register"); // "register" | "verify"
  const [otp,         setOtp]         = useState("");
  const [resendTimer, setResendTimer] = useState(0);

  // Shared
  const [error,        setError]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [activeMethod, setActiveMethod] = useState("");

  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();
  const isInvited      = searchParams.get("invite") === "1";
  const { handleLogin } = useContext(AuthContext);

  const validateEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const startLoading  = (method) => { setLoading(true); setActiveMethod(method); setError(""); };
  const stopLoading   = ()       => { setLoading(false); setActiveMethod(""); };

  // ── Resend countdown ───────────────────────────────────────────
  const startResendTimer = () => {
    setResendTimer(60);
    const id = setInterval(() => {
      setResendTimer(t => {
        if (t <= 1) { clearInterval(id); return 0; }
        return t - 1;
      });
    }, 1000);
  };

  // ── Step 1: Register via backend ───────────────────────────────
  const handleRegister = async (e) => {
    e?.preventDefault();

    const urlParams   = new URLSearchParams(window.location.search);
    const inviteToken = urlParams.get("token");
    if (inviteToken) sessionStorage.setItem("pending_invite_token", inviteToken);

    const trimmedEmail = email.trim();
    const trimmedName  = fullName.trim();

    if (!trimmedName)                 { setError("Please enter your full name."); return; }
    if (!validateEmail(trimmedEmail)) { setError("Invalid email format."); return; }
    if (password.length < 8)         { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm)        { setError("Passwords do not match."); return; }

    startLoading("email");
    try {
      await authAPI.register({
        email:    trimmedEmail,
        password,
        fullName: trimmedName,
      });
      setStep("verify");
      startResendTimer();
      showToast("✅ Account created! Check your email for the verification code.", "success");
    } catch (err) {
      Sentry?.captureException(err);
      const msg = getFriendlyError(err);
      if (msg) setError(msg);
    } finally {
      stopLoading();
    }
  };

  // ── Step 2: Verify OTP ─────────────────────────────────────────
  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    if (otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    startLoading("verify");
    try {
      await authAPI.verifyEmail({ email: email.trim(), otp });
      // Backend set cookies — pull full user object then hydrate app state
      const me = await authAPI.me();
      if (me?.id) {
        await handleLogin({ email: email.trim(), dbUser: me }, null);
      }
      showToast("✅ Email verified! Welcome to EtherTrack.", "success");
      const pendingToken = sessionStorage.getItem("pending_invite_token");
      navigate(pendingToken ? `/join-org?token=${pendingToken}` : "/dashboard", { replace: true });
    } catch (err) {
      Sentry?.captureException(err);
      const msg = getFriendlyError(err);
      if (msg) setError(msg);
    } finally {
      stopLoading();
    }
  };

  // ── Resend OTP ─────────────────────────────────────────────────
  const handleResendOtp = async () => {
    if (resendTimer > 0) return;
    setError("");
    try {
      await authAPI.resendOtp({ email: email.trim() });
      startResendTimer();
      showToast("New code sent! Check your inbox.", "success");
    } catch {
      setError("Failed to resend code. Please try again.");
    }
  };

  // ── Social signup — still uses Firebase ───────────────────────
  const handleSocialSignup = async (provider, providerLabel) => {
    const urlParams   = new URLSearchParams(window.location.search);
    const inviteToken = urlParams.get("token");
    if (inviteToken) sessionStorage.setItem("pending_invite_token", inviteToken);

    startLoading(providerLabel.toLowerCase());
    try {
      const cred = await signInWithPopup(auth, provider);
      const res  = await syncToBackend(cred.user, providerLabel.toLowerCase());
      if (res?.user) {
        await handleLogin({ email: cred.user.email, dbUser: res.user }, cred.user);
      }
      showToast(`✅ Welcome! Signed up with ${providerLabel}.`, "success");
      const pendingToken = sessionStorage.getItem("pending_invite_token");
      navigate(pendingToken ? `/join-org?token=${pendingToken}` : "/dashboard", { replace: true });
    } catch (err) {
      if (!err.code) Sentry?.captureException(err);
      const msg = getFriendlyError(err);
      if (msg) setError(msg);
    } finally {
      stopLoading();
    }
  };

  // ── Password strength ──────────────────────────────────────────
  const strengthChecks = [
    { label: "At least 8 characters", pass: password.length >= 8 },
    { label: "One uppercase letter",  pass: /[A-Z]/.test(password) },
    { label: "One number",            pass: /[0-9]/.test(password) },
    { label: "One special character", pass: /[^A-Za-z0-9]/.test(password) },
  ];

  const handleOtpChange = (e) => {
    setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
    setError("");
  };

  return (
    <div className="min-h-screen w-full bg-black font-sans text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-6 py-10 lg:flex-row lg:items-center lg:gap-16 lg:px-10">

        {/* ============================= LEFT PANEL ============================= */}
        <div className="w-full lg:w-1/2">
          {/* Logo */}
          <div className="mb-8 flex items-center gap-3">
            <img
              src={logoImage}
              alt="EtherTrack Technologies"
              className="h-10 w-10 shrink-0 object-contain"
            />
            <div className="leading-tight">
              <div className="text-xl font-extrabold tracking-tight">
                <span className="text-white">ETHER</span>
                <span className="text-green-500">TRACK</span>
              </div>
              <div className="text-xs text-white/40">
                Track. Tokenize. Trade.
              </div>
            </div>
          </div>

          {/* Hero */}
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
            <span className="block text-white">Track Carbon.</span>
            <span className="block text-white">Tokenize Trust.</span>
            <span className="block text-green-500">Trade Sustainably.</span>
          </h1>

          <p className="mt-5 max-w-md text-base leading-relaxed text-white/50">
            The all-in-one platform for carbon accounting, credit tokenization
            and compliant trading.
          </p>

          {/* Feature row */}
          <div className="mt-8 grid grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, title, subtitle }) => (
              <div key={title} className="flex flex-col gap-2">
                <Icon className="h-6 w-6 text-green-500" strokeWidth={1.75} />
                <div className="text-sm font-semibold text-white">{title}</div>
                <div className="text-xs text-white/40">{subtitle}</div>
              </div>
            ))}
          </div>

          {/* Globe */}
          <div className="mt-10">
            <GlobeVisual />
            <div className="mt-3 flex items-center gap-2 text-sm text-white/50">
              <Leaf className="h-4 w-4 text-green-500/80" />
              Building a sustainable future, <span className="text-green-500">together.</span>
            </div>
          </div>
        </div>

        {/* ============================= RIGHT PANEL ============================= */}
        <div className="w-full lg:w-1/2">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="relative mx-auto w-full max-w-md rounded-3xl border border-white/10
                       bg-neutral-950 p-8 shadow-2xl"
          >
            <AnimatePresence mode="wait">
              {/* ── Step 1: Registration ── */}
              {step === "register" && (
                <motion.div key="register" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {/* Secure badge */}
                  <div className="absolute right-8 top-8 flex items-center gap-1.5 rounded-full border border-green-500/30
                                  bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Secure &amp; Compliant
                  </div>

                  <h2 className="text-2xl font-bold tracking-tight">
                    Create <span className="text-green-500">your account</span>
                  </h2>
                  <p className="mb-6 mt-1 text-sm text-white/50">
                    Join EtherTrack and build a sustainable future.
                  </p>

                  {(isInvited || sessionStorage.getItem("pending_invite_token")) && (
                    <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2.5 text-center text-sm leading-relaxed text-green-400">
                      🎉 You&apos;ve been invited to join a team — create your account to accept
                    </div>
                  )}

                  <form onSubmit={handleRegister} noValidate>
                    <Field icon={User} label="Full Name">
                      <input
                        id="signup-name"
                        className={inputBase}
                        type="text"
                        placeholder="Enter your full name"
                        value={fullName}
                        autoComplete="name"
                        onChange={e => { setFullName(e.target.value); setError(""); }}
                      />
                    </Field>

                    <Field icon={Mail} label="Business Email">
                      <input
                        id="signup-email"
                        className={inputBase}
                        type="email"
                        placeholder="Enter your business email"
                        value={email}
                        autoComplete="email"
                        onChange={e => { setEmail(e.target.value); setError(""); }}
                      />
                    </Field>

                    <Field icon={Lock} label="Password">
                      <input
                        id="signup-password"
                        className={inputBase}
                        type={showPassword ? "text" : "password"}
                        placeholder="Create a strong password"
                        value={password}
                        autoComplete="new-password"
                        onChange={e => { setPassword(e.target.value); setError(""); }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 transition-colors hover:text-white/70"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </Field>

                    <Field icon={Lock} label="Confirm Password">
                      <input
                        id="signup-confirm"
                        className={`${inputBase} ${confirm && confirm !== password ? "border-red-500/50 focus:border-red-500" : ""}`}
                        type={showConfirm ? "text" : "password"}
                        placeholder="Re-enter your password"
                        value={confirm}
                        autoComplete="new-password"
                        onChange={e => { setConfirm(e.target.value); setError(""); }}
                        onPaste={e => e.preventDefault()}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm(v => !v)}
                        aria-label={showConfirm ? "Hide password" : "Show password"}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 transition-colors hover:text-white/70"
                        tabIndex={-1}
                      >
                        {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </Field>

                    {/* Password requirement checklist */}
                    {password && (
                      <div className="mb-5 flex flex-wrap gap-x-5 gap-y-1.5">
                        {strengthChecks.map(({ label, pass }) => (
                          <div key={label} className="flex items-center gap-1.5 text-xs">
                            {pass ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 shrink-0 text-white/20" />
                            )}
                            <span className={pass ? "text-white/70" : "text-white/35"}>{label}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <ErrorBanner error={error} />

                    <div className="mt-2">
                      <PrimaryButton type="submit" loading={loading && activeMethod === "email"} loadingLabel="Creating account…">
                        Create Account
                      </PrimaryButton>
                    </div>
                  </form>

                  <div className="mt-6 flex items-center gap-4">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-xs text-white/35">OR CONTINUE WITH</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>

                  <SocialButton
                    icon={<FaGoogle size={14} color="#4ADE80" />}
                    onClick={() => handleSocialSignup(googleProvider, "Google")}
                    disabled={loading}
                  >
                    {activeMethod === "google" ? "Connecting…" : "Sign up with Google"}
                  </SocialButton>
                  <SocialButton
                    icon={<FaFacebook size={14} color="#4ADE80" />}
                    onClick={() => handleSocialSignup(facebookProvider, "Facebook")}
                    disabled={loading}
                  >
                    {activeMethod === "facebook" ? "Connecting…" : "Sign up with Facebook"}
                  </SocialButton>

                  <p className="mt-6 text-center text-sm text-white/50">
                    Already have an account?{" "}
                    <Link to="/login" className="inline-flex items-center gap-1 font-medium text-green-500 hover:text-green-400">
                      Sign in <ArrowRight className="h-3 w-3" />
                    </Link>
                  </p>

                  <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-white/30">
                    <Lock className="h-3 w-3" />
                    Your data is encrypted and secure with us.
                  </div>
                </motion.div>
              )}

              {/* ── Step 2: OTP verification ── */}
              {step === "verify" && (
                <motion.div key="verify" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <h2 className="text-2xl font-bold tracking-tight">
                    Verify <span className="text-green-500">your email</span>
                  </h2>
                  <p className="mb-6 mt-1 text-sm text-white/50">
                    Enter your 6-digit code
                  </p>

                  <form onSubmit={handleVerifyOtp} noValidate>
                    <div className="flex flex-col items-center gap-5 py-1">
                      <p className="text-center text-sm leading-relaxed text-white/50">
                        We sent a code to <span className="text-green-400">{email}</span>.
                        <br />
                        It expires in 10 minutes. Check spam if you don&apos;t see it.
                      </p>

                      <input
                        className="h-16 w-52 rounded-xl border border-green-500/40 bg-black/30
                                   text-center text-2xl font-bold tracking-widest text-green-400 outline-none
                                   transition-colors duration-200 focus:border-green-500"
                        type="text"
                        inputMode="numeric"
                        pattern="\d{6}"
                        maxLength={6}
                        placeholder="——————"
                        value={otp}
                        autoFocus
                        onChange={handleOtpChange}
                        aria-label="6-digit verification code"
                      />

                      <p className="text-xs text-white/35">
                        {resendTimer > 0 ? (
                          <span>Resend in {resendTimer}s</span>
                        ) : (
                          <button
                            type="button"
                            className="font-medium text-green-500 transition-colors hover:text-green-400"
                            onClick={handleResendOtp}
                          >
                            Resend code →
                          </button>
                        )}
                      </p>
                    </div>

                    <ErrorBanner error={error} />

                    <div className="mt-6">
                      <PrimaryButton type="submit" loading={loading && activeMethod === "verify"} loadingLabel="Verifying…" disabled={loading || otp.length !== 6}>
                        Verify &amp; Sign In
                      </PrimaryButton>
                    </div>
                  </form>

                  <button
                    type="button"
                    onClick={() => { setStep("register"); setOtp(""); setError(""); }}
                    className="mt-4 w-full text-center text-sm text-white/40 transition-colors hover:text-white"
                  >
                    ← Back to sign up
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default Signup;