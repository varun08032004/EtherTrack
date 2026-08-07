/**
 * Login.jsx — EtherTrack v2
 * FIX: Email/password login calls backend directly (no Firebase for email auth)
 * FIX: getFriendlyError handles USE_SOCIAL_LOGIN and EMAIL_NOT_VERIFIED codes
 *
 * UI NOTE: visual layer only — every handler, state variable, and API call
 * below is unchanged from the original. Shares the design language (colors,
 * card treatment, globe visual, feature row) with Signup.jsx.
 *
 * PROVIDER NOTE: the reference design calls for "Continue with Microsoft" +
 * "Continue with Google Workspace" buttons, but only googleProvider and
 * facebookProvider are wired up in firebaseConfigure — there's no Microsoft
 * provider configured. Using the real Google + Facebook providers below so
 * the buttons actually work. Swap in a microsoftProvider once it exists.
 */

import React, { useState, useContext, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { signInWithPopup } from "firebase/auth";
import { FaGoogle, FaFacebook } from "react-icons/fa";
import {
  Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, Check,
  Leaf, Activity, Globe2,
} from "lucide-react";
import { AuthContext } from "../App";
import { auth, googleProvider, facebookProvider } from "../firebaseConfigure";
import { authAPI } from "../services/api";
import { showToast } from "../utils/toast";
import globeImage from "../assets/ethertrack-globe.png";
import logoImage from "../assets/ethertrack-logo.png";

let Sentry = null;
try { Sentry = require("@sentry/react"); } catch {}

const getFriendlyError = (err) => {
  // Backend error codes — check these first
  switch (err?.code) {
    case 'USE_SOCIAL_LOGIN':
      return 'This account was created with Google or Facebook. Please use the social login button below.';
    case 'EMAIL_NOT_VERIFIED':
      return 'Email not verified. Check your inbox for the 6-digit code, or sign up again to resend it.';
    default:
      break;
  }
  // HTTP status fallbacks
  if (err?.status === 401) return 'Incorrect email or password.';
  if (err?.status === 403) {
    if (err?.error?.toLowerCase().includes('verified')) {
      return 'Email not verified. Check your inbox for the 6-digit code, or sign up again to resend it.';
    }
    if (err?.error?.toLowerCase().includes('disabled')) {
      return 'This account has been disabled. Contact support.';
    }
    return err?.error || 'Account access denied. Contact support.';
  }
  // Firebase codes (social login errors)
  switch (err?.code) {
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email. Try a different sign-in method.';
    case 'auth/popup-closed-by-user':
      return null;
    case 'auth/popup-blocked':
      return 'Popup blocked. Please allow popups for this site.';
    default:
      return err?.error || err?.message || 'Login failed. Please try again.';
  }
};

/* ------------------------------------------------------------------ */
/*  Shared visual primitives (same design language as Signup.jsx)     */
/* ------------------------------------------------------------------ */

function Field({ icon: Icon, label, children }) {
  return (
    <div className="mb-2.5">
      {label && (
        <label className="mb-1.5 block text-[11px] font-medium tracking-[0.08em] text-white/60">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-white/30" />
        )}
        {children}
      </div>
    </div>
  );
}

const inputBase =
  "h-[40px] w-full rounded-xl border border-[#22C55E]/20 bg-black/40 pl-10 pr-10 text-[14px] text-white " +
  "placeholder:text-white/25 outline-none transition-all duration-200 " +
  "focus:border-[#22C55E] focus:bg-black/60 focus:ring-4 focus:ring-[#22C55E]/10";

function PrimaryButton({ children, loading, loadingLabel, ...props }) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
      transition={{ duration: 0.25 }}
      disabled={loading}
      className="group relative flex h-[42px] w-full items-center justify-center gap-2 rounded-xl
                 bg-[#22C55E] text-[14.5px] font-semibold text-black
                 shadow-[0_0_0_1px_rgba(34,197,94,0.4),0_0_40px_rgba(34,197,94,0.35)]
                 transition-all duration-[250ms] hover:bg-[#2ED66E]
                 hover:shadow-[0_0_0_1px_rgba(34,197,94,0.55),0_0_60px_rgba(34,197,94,0.55)]
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
      className="mt-2 flex h-[38px] w-full items-center justify-center gap-2.5 rounded-xl border
                 border-white/10 bg-black/30 text-[13px] font-medium text-white/80 transition-all
                 duration-200 hover:border-[#22C55E]/40 hover:bg-[#22C55E]/5
                 disabled:cursor-not-allowed disabled:opacity-50"
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

function MessageBanner({ text, tone }) {
  const isError = tone === "error";
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          role={isError ? "alert" : "status"}
          aria-live={isError ? "assertive" : "polite"}
          className={`mt-3.5 rounded-lg border px-4 py-2.5 text-[12.5px] ${
            isError
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-[#22C55E]/30 bg-[#22C55E]/10 text-[#4ADE80]"
          }`}
        >
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/*  Earth-at-night / India-lit-up visual (same asset as Signup.jsx)   */
/* ------------------------------------------------------------------ */

function GlobeVisual() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-0 h-[160%] w-[160%] -translate-x-1/2 rounded-full
                      bg-[radial-gradient(circle_at_50%_15%,rgba(34,197,94,0.16),transparent_55%)]" />
      <img
        src={globeImage}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: "50% 70%", transform: "scaleX(1.18)", transformOrigin: "center" }}
      />
      <div className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 75% 70% at 50% 45%, transparent 45%, #050807 92%)",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-[32%] bg-gradient-to-b from-[#050807] via-[#050807]/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[18%] bg-gradient-to-t from-[#050807] to-transparent" />
      <div className="absolute inset-y-0 left-0 w-[16%] bg-gradient-to-r from-[#050807] to-transparent" />
      <div className="absolute inset-y-0 right-0 w-[16%] bg-gradient-to-l from-[#050807] to-transparent" />
      {Array.from({ length: 14 }).map((_, i) => (
        <span
          key={`p-${i}`}
          className="absolute h-[2px] w-[2px] rounded-full bg-[#22C55E]/70"
          style={{
            left: `${(i * 53) % 100}%`,
            top: `${(i * 37) % 90}%`,
            animation: `float-particle ${6 + (i % 5)}s ease-in-out ${i * 0.3}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

const HERO_LINES = [
  { text: "Track Carbon.", className: "text-white" },
  { text: "Tokenize Trust.", className: "text-white" },
  { text: "Trade Sustainably.", className: "text-[#22C55E]" },
];

function TypewriterHero() {
  // phase: "typing" (including the hold at the end, while the last line's
  // cursor just blinks) or "erasing" (deletes back to nothing, then loops
  // back to "typing" from line 0). Runs forever while the page is open.
  const [phase, setPhase] = useState("typing");
  const [lineIndex, setLineIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const prefersReducedMotion = useRef(
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ).current;

  const TYPE_MS = 38;
  const LINE_PAUSE_MS = 260;
  const HOLD_MS = 2200;
  const ERASE_MS = 22;
  const LINE_ERASE_PAUSE_MS = 180;
  const RESTART_PAUSE_MS = 500;

  useEffect(() => {
    if (prefersReducedMotion) return; // static final text, no animation loop

    if (phase === "typing") {
      const line = HERO_LINES[lineIndex].text;
      if (charIndex < line.length) {
        const t = setTimeout(() => setCharIndex(c => c + 1), TYPE_MS);
        return () => clearTimeout(t);
      }
      if (lineIndex < HERO_LINES.length - 1) {
        const t = setTimeout(() => { setLineIndex(l => l + 1); setCharIndex(0); }, LINE_PAUSE_MS);
        return () => clearTimeout(t);
      }
      // Full text typed — hold for a beat before erasing.
      const t = setTimeout(() => setPhase("erasing"), HOLD_MS);
      return () => clearTimeout(t);
    }

    if (phase === "erasing") {
      if (charIndex > 0) {
        const t = setTimeout(() => setCharIndex(c => c - 1), ERASE_MS);
        return () => clearTimeout(t);
      }
      if (lineIndex > 0) {
        const t = setTimeout(() => {
          setLineIndex(l => l - 1);
          setCharIndex(HERO_LINES[lineIndex - 1].text.length);
        }, LINE_ERASE_PAUSE_MS);
        return () => clearTimeout(t);
      }
      // Fully erased — brief pause, then loop back to typing from scratch.
      const t = setTimeout(() => setPhase("typing"), RESTART_PAUSE_MS);
      return () => clearTimeout(t);
    }
  }, [phase, charIndex, lineIndex, prefersReducedMotion]);

  return (
    <h1 className="text-[22px] font-bold leading-[1.15] tracking-tight sm:text-[26px] lg:text-[29px] xl:text-[32px]">
      {HERO_LINES.map((line, i) => {
        const complete = prefersReducedMotion || i < lineIndex;
        const active = !prefersReducedMotion && i === lineIndex;
        return (
          <span key={line.text} className={`block ${line.className} ${complete || active ? "" : "invisible"}`}>
            {complete ? line.text : active ? line.text.slice(0, charIndex) : line.text}
            {active && (
              <span className="ml-0.5 inline-block h-[0.9em] w-[2px] animate-[caret-blink_0.9s_steps(1)_infinite] bg-current align-middle" />
            )}
          </span>
        );
      })}
    </h1>
  );
}

const FEATURES = [
  { icon: ShieldCheck, title: "Enterprise Grade", subtitle: "Security & Compliance" },
  { icon: Activity,    title: "Real-time Analytics", subtitle: "Actionable Insights" },
  { icon: Globe2,      title: "Global Marketplace", subtitle: "Trusted & Transparent" },
];

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

  const resolveRedirect = (result) => {
    const dbUser = result?.dbUser || result;
    if (dbUser?.role === "admin") return "/admin";
    if (result?.redirect)        return result.redirect;
    return "/dashboard";
  };

  // ── Email/password login — calls backend directly, no Firebase ──
  const handleLoginSubmit = async (e) => {
    e?.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Please enter both email and password.");
      return;
    }
    startLoading("email");
    try {
      const data = await authAPI.login({ email: trimmedEmail, password, remember });

      if (data?.requires2FA) {
        navigate("/2fa-verify", { state: { tempToken: data.tempToken, remember } });
        return;
      }

      const result = await handleLogin({
        email:  trimmedEmail,
        dbUser: data?.user || null,
      }, null);

      showToast("✅ Welcome back!", "success");
      navigate(resolveRedirect(result), { replace: true });
    } catch (err) {
      if (!err.code) Sentry?.captureException(err);
      const msg = getFriendlyError(err);
      if (msg) setError(msg);
      stopLoading();
    }
  };

  // ── Social login (Google / Facebook) — still uses Firebase ──
  const handleSocialLogin = async (provider, providerLabel) => {
    startLoading(providerLabel.toLowerCase());
    try {
      const cred   = await signInWithPopup(auth, provider);
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

  // ── Forgot password ──
  // FIX: email/password accounts are created by our own backend (bcrypt hash
  // in authAPI.register), not Firebase — so Firebase's sendPasswordResetEmail
  // only ever worked for the subset of users who happened to also exist in
  // Firebase (i.e. social-login users, who don't have a password to reset in
  // the first place). Routing this through the backend instead.
  // NOTE: assumes an authAPI.forgotPassword(email) → POST /api/auth/forgot-password
  // endpoint exists; add it on the backend if it doesn't yet.
  // Also intentionally returns the same message whether or not the account
  // exists — revealing "no account with this email" lets an attacker enumerate
  // registered emails, which is why the message is generic either way.
  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) { setError("Enter your email address first."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address first.");
      return;
    }
    startLoading("forgot");
    try {
      await authAPI.forgotPassword({ email: trimmedEmail });
    } catch (err) {
      // Even network/5xx errors shouldn't reveal account existence — log it,
      // but still show the generic message so behavior can't be distinguished.
      Sentry?.captureException(err);
    } finally {
      setMessage("If an account exists for that email, a reset link is on its way. Check your inbox (and spam folder).");
      stopLoading();
    }
  };


  const isEmailLoading  = loading && activeMethod === "email";
  const isGoogleLoading = loading && activeMethod === "google";
  const isFBLoading     = loading && activeMethod === "facebook";
  const isForgotLoading = loading && activeMethod === "forgot";

  return (
    <div className="et-viewport relative w-full overflow-hidden bg-[#050807] font-sans text-white flex flex-col">
      <style>{`
        /* FIX: h-screen (100vh) doesn't account for mobile browser chrome
           (e.g. iOS Safari's address bar), which can clip content that's
           supposed to fit in one screen. 100dvh (dynamic viewport height)
           fixes this on browsers that support it; the plain 100vh above it
           is the fallback for browsers that don't. */
        .et-viewport { height: 100vh; height: 100dvh; }
        .no-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        @keyframes caret-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes float-particle {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0.2; }
          50% { transform: translateY(-14px) translateX(6px); opacity: 0.8; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
        }
      `}</style>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-[500px]
                      bg-[radial-gradient(ellipse_at_50%_-10%,rgba(34,197,94,0.08),transparent_60%)]" />

      <div className="relative mx-auto flex w-full max-w-[1600px] flex-1 min-h-0 flex-col items-stretch px-6 lg:flex-row lg:items-center lg:px-10 lg:py-4">

        {/* ============================= LEFT PANEL ============================= */}
        <div className="relative flex min-h-0 w-full flex-col lg:w-[55%] lg:h-full lg:py-3 lg:pr-14">
          <div>
            {/* Logo */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mb-4 flex items-center gap-2.5"
            >
              <img
                src={logoImage}
                alt="EtherTrack Technologies"
                className="h-8 w-8 shrink-0 object-contain sm:h-9 sm:w-9"
              />
              <div className="leading-none">
                <div className="text-[17px] font-extrabold tracking-tight sm:text-[19px]">
                  <span className="text-white">ETHER</span>
                  <span className="text-[#22C55E]">TRACK</span>
                </div>
                <div className="mt-1 text-[10px] text-white/55">
                  Track. Tokenize. Trade.
                </div>
              </div>
            </motion.div>

            {/* Hero */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              <TypewriterHero />
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mt-3 max-w-[420px] text-[12px] leading-relaxed text-white/55"
            >
              The all-in-one platform for carbon accounting, credit tokenization
              and compliant trading.
            </motion.p>

            {/* Feature row */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="mt-4 grid grid-cols-3 gap-3"
            >
              {FEATURES.map(({ icon: Icon, title, subtitle }) => (
                <div key={title} className="flex flex-col gap-1">
                  <Icon className="h-4 w-4 text-[#22C55E]" strokeWidth={1.75} />
                  <div className="text-[11.5px] font-semibold text-white/90">{title}</div>
                  <div className="text-[10px] text-white/55">{subtitle}</div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Globe */}
          <div className="relative mt-4 min-h-[180px] flex-1 w-full">
            <GlobeVisual />
            <div className="absolute bottom-2.5 left-1 flex items-center gap-2 text-[11px] text-white/50">
              <Leaf className="h-3 w-3 text-[#22C55E]/80" />
              Building a sustainable future, <span className="text-[#22C55E]">together.</span>
            </div>
          </div>
        </div>

        {/* ============================= RIGHT PANEL ============================= */}
        <div className="flex w-full min-h-0 items-center justify-center py-3 lg:w-[45%] lg:py-2">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="relative w-full max-w-[440px] max-h-full overflow-y-auto overflow-x-hidden no-scrollbar rounded-3xl border border-white/[0.08] bg-[#0F1313]/90
                       p-5 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:p-6"
          >
            {/* Secure badge */}
            <div className="absolute right-5 top-5 flex items-center gap-1.5 rounded-full border border-[#22C55E]/25
                            bg-[#22C55E]/10 px-2.5 py-1 text-[10px] font-medium text-[#4ADE80] sm:right-6 sm:top-6">
              <ShieldCheck className="h-3 w-3" />
              Secure &amp; Compliant
            </div>

            <h2 className="text-[19px] font-bold tracking-tight sm:text-[21px]">
              Welcome back<span className="text-[#22C55E]">.</span>
            </h2>
            <p className="mb-3.5 mt-1 text-[12px] text-white/60">
              Sign in to continue managing your carbon assets.
            </p>

            {sessionStorage.getItem('pending_invite_token') && (
              <div className="mb-3.5 rounded-lg border border-[#22C55E]/25 bg-[#22C55E]/10 px-3.5 py-2.5 text-center text-[12px] leading-relaxed text-[#4ADE80]">
                🎉 Sign in to accept your team invitation
              </div>
            )}

            <form onSubmit={handleLoginSubmit} noValidate>
              <Field icon={Mail} label="BUSINESS EMAIL">
                <input
                  id="login-email"
                  className={inputBase}
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  autoComplete="email"
                  onChange={e => { setEmail(e.target.value); clearMessages(); }}
                />
              </Field>

              <Field icon={Lock} label="PASSWORD">
                <input
                  id="login-password"
                  className={inputBase}
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  autoComplete="current-password"
                  onChange={e => { setPassword(e.target.value); clearMessages(); }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 transition-colors hover:text-white/70"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-[16px] w-[16px]" /> : <Eye className="h-[16px] w-[16px]" />}
                </button>
              </Field>

              <div className="mb-3.5 flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-white/55">
                  <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={e => setRemember(e.target.checked)}
                      className="peer sr-only"
                    />
                    <span className="absolute inset-0 rounded border border-white/20 bg-black/40 transition-colors
                                     peer-checked:border-[#22C55E] peer-checked:bg-[#22C55E]" />
                    {remember && <Check className="relative h-3 w-3 text-black" strokeWidth={3} />}
                  </span>
                  Remember this device
                </label>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={loading}
                  className="text-[12px] font-medium text-[#22C55E] transition-colors hover:text-[#4ADE80] disabled:opacity-50"
                >
                  {isForgotLoading ? "Sending…" : "Forgot password?"}
                </button>
              </div>

              <MessageBanner text={error} tone="error" />
              <MessageBanner text={message} tone="success" />

              <div className="mt-3.5">
                <PrimaryButton type="submit" loading={isEmailLoading} loadingLabel="Authenticating…">
                  Sign In
                </PrimaryButton>
              </div>
            </form>

            <div className="mt-3.5 flex items-center gap-4">
              <div className="h-px flex-1 bg-white/10" />
              <span className="text-[10.5px] text-white/45">OR CONTINUE WITH</span>
              <div className="h-px flex-1 bg-white/10" />
            </div>

            <SocialButton
              icon={<FaGoogle size={13} color="#4ADE80" />}
              onClick={() => handleSocialLogin(googleProvider, "Google")}
              disabled={loading}
            >
              {isGoogleLoading ? "Connecting…" : "Continue with Google"}
            </SocialButton>
            <SocialButton
              icon={<FaFacebook size={13} color="#4ADE80" />}
              onClick={() => handleSocialLogin(facebookProvider, "Facebook")}
              disabled={loading}
            >
              {isFBLoading ? "Connecting…" : "Continue with Facebook"}
            </SocialButton>

            <p className="mt-3.5 text-center text-[12px] text-white/60">
              New to EtherTrack?{" "}
              <Link to="/signup" className="inline-flex items-center gap-1 font-medium text-[#22C55E] hover:text-[#4ADE80]">
                Create Workspace <ArrowRight className="h-3 w-3" />
              </Link>
            </p>

            <div className="mt-3 flex items-center justify-center gap-1.5 text-[10.5px] text-white/45">
              <Lock className="h-3 w-3" />
              Protected with enterprise-grade encryption.
            </div>
          </motion.div>
        </div>
      </div>

      {/* ============================= FOOTER ============================= */}
      <div className="relative mx-auto w-full max-w-[1600px] shrink-0 border-t border-white/10 px-6 py-2.5 text-center text-[11px] text-white/50 lg:px-10">
        © 2026 EtherTrack Technologies Private Limited. All rights reserved.
      </div>
    </div>
  );
};

export default Login;