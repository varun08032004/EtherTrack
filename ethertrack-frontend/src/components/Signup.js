/**
 * Signup.jsx — EtherTrack v2
 *
 * FIX: Email/password signup now calls backend /register directly (no Firebase).
 *      After register succeeds, an inline OTP step appears.
 *      Once verified, backend sets httpOnly cookies and navigates to dashboard.
 *      Firebase is only used for Google/Facebook OAuth (unchanged).
 *
 * NEW: Account type toggle (Individual / Business) added up front.
 *      Business accounts additionally collect Company Name + Position,
 *      both sent to the backend on register so an organisation can be
 *      auto-provisioned server-side once the account is verified.
 *
 * NEW (this pass): The registration step is now a 2-slide wizard instead of
 *      one long form, so the card never has to grow past the viewport:
 *        Slide 1 "info"        — account type, full name, company/position
 *        Slide 2 "credentials" — email, password, confirm
 *      Slides animate horizontally (framer-motion), with a small dot
 *      progress indicator. Data persists across slides (state lives in the
 *      parent, slides are just a view). The OTP step is effectively slide 3
 *      and is unchanged apart from also getting a "step 3 of 3" dot.
 *
 * NEW (this pass): hero headline on the left panel now types itself out
 *      line by line (see TypewriterHero) instead of appearing statically.
 *
 * Flow:
 *   1a. Slide "info": user picks account type, enters name (+ company/position
 *       if business) → Continue
 *   1b. Slide "credentials": email + password → POST /api/auth/register
 *   2. Backend creates user with bcrypt hash, sends OTP via Resend
 *   3. OTP input shown inline → POST /api/auth/verify-email
 *   4. Backend sets cookies → /api/auth/me → navigate to dashboard
 *
 * UI NOTE: visual layer only — every handler, state variable, and API call
 * below is unchanged from the original except where noted above. See
 * Login.jsx for the shared design language (colors, card treatment, globe
 * visual) this page reuses.
 */

import React, { useState, useContext, useEffect, useRef } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { FaGoogle, FaFacebook } from "react-icons/fa";
import {
  User, Mail, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, ShieldCheck,
  CheckCircle2, Circle, Check, Leaf, Activity, Globe2, Building2, Briefcase,
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

const syncToBackend = async (firebaseUser, provider = "google", extra = {}) => {
  const idToken = await firebaseUser.getIdToken();
  return withRetry(() =>
    authAPI.syncUser(
      {
        email:         firebaseUser.email,
        firebaseUid:   firebaseUser.uid,
        fullName:      firebaseUser.displayName || "",
        provider,
        emailVerified: firebaseUser.emailVerified,
        // FIX: account type / company / position were being collected on the
        // "info" slide but only ever sent to the backend via authAPI.register
        // — if someone picked "Business", filled in company + position, then
        // used a social button instead of continuing to email/password, all
        // of that was silently dropped. Now forwarded through here too.
        ...extra,
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
/*  Shared visual primitives (same design language as Login.jsx)      */
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
          className="mt-3.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-[12.5px] text-red-400"
        >
          {error}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Small dot progress indicator for the wizard (info → credentials → verify)
function StepDots({ index, total }) {
  return (
    <div className="mb-4 flex items-center justify-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`h-[5px] rounded-full transition-all duration-300 ${
            i === index ? "w-5 bg-[#22C55E]" : "w-[5px] bg-white/15"
          }`}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Earth-at-night / India-lit-up visual (same asset as Login.jsx)    */
/* ------------------------------------------------------------------ */

function GlobeVisual() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Ambient glow behind the image */}
      <div className="absolute left-1/2 top-0 h-[160%] w-[160%] -translate-x-1/2 rounded-full
                      bg-[radial-gradient(circle_at_50%_15%,rgba(34,197,94,0.16),transparent_55%)]" />

      {/* Reference globe photo — stretched wider for a more panoramic feel,
          object-position keeps India fully in frame */}
      <img
        src={globeImage}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{ objectPosition: "50% 70%", transform: "scaleX(1.18)", transformOrigin: "center" }}
      />

      {/* Soft radial vignette so the whole image dissolves into the page bg
          instead of reading as a pasted rectangle */}
      <div className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 75% 70% at 50% 45%, transparent 45%, #050807 92%)",
        }}
      />

      {/* Directional edge fades layered on top of the vignette */}
      <div className="absolute inset-x-0 top-0 h-[32%] bg-gradient-to-b from-[#050807] via-[#050807]/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[18%] bg-gradient-to-t from-[#050807] to-transparent" />
      <div className="absolute inset-y-0 left-0 w-[16%] bg-gradient-to-r from-[#050807] to-transparent" />
      <div className="absolute inset-y-0 right-0 w-[16%] bg-gradient-to-l from-[#050807] to-transparent" />

      {/* Floating particles for subtle ambient motion */}
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

const FEATURES = [
  { icon: ShieldCheck, title: "Enterprise Grade", subtitle: "Security & Compliance" },
  { icon: Activity,    title: "Real-time Analytics", subtitle: "Actionable Insights" },
  { icon: Globe2,      title: "Global Marketplace", subtitle: "Trusted & Transparent" },
];

/* ------------------------------------------------------------------ */
/*  Typewriter hero — types each line in sequence, respects reduced   */
/*  motion, reserves the final height upfront so nothing reflows.     */
/* ------------------------------------------------------------------ */

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

// Slide transition: moves in from the direction you're navigating toward,
// exits toward the opposite direction. `dir` is 1 for forward, -1 for back.
const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
};

// ── Component ─────────────────────────────────────────────────────
const Signup = () => {
  // Account category — asked up front so we know whether to collect
  // company details and can auto-provision an organisation on verify.
  const [accountType,  setAccountType]  = useState("individual"); // "individual" | "business"
  const [companyName,  setCompanyName]  = useState("");
  const [designation,  setDesignation]  = useState("");

  // Step 1 fields
  const [fullName,     setFullName]     = useState("");
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [confirm,      setConfirm]      = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Step 2 — OTP
  const [step,        setStep]        = useState("register"); // "register" | "verify"
  const [otp,         setOtp]         = useState("");
  const [resendTimer, setResendTimer] = useState(0);

  // Wizard slide within "register": "info" (account type/name/company) →
  // "credentials" (email/password). `direction` drives which way the
  // slide animates (1 = forward/right, -1 = backward/left).
  const [subStep,   setSubStep]   = useState("info");
  const [direction, setDirection] = useState(1);

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

  // ── Slide 1 → 2: validate name/company, then advance ───────────
  const handleContinueToCredentials = (e) => {
    e?.preventDefault();
    const trimmedName        = fullName.trim();
    const trimmedCompany     = companyName.trim();
    const trimmedDesignation = designation.trim();
    const isBusiness         = accountType === "business";

    if (!trimmedName) { setError("Please enter your full name."); return; }
    if (isBusiness && !trimmedCompany)     { setError("Please enter your company name."); return; }
    if (isBusiness && !trimmedDesignation) { setError("Please enter your position at the company."); return; }

    setError("");
    setDirection(1);
    setSubStep("credentials");
  };

  const handleBackToInfo = () => {
    setError("");
    setDirection(-1);
    setSubStep("info");
  };

  // ── Slide 2: Register via backend ───────────────────────────────
  const handleRegister = async (e) => {
    e?.preventDefault();

    const urlParams   = new URLSearchParams(window.location.search);
    const inviteToken = urlParams.get("token");
    if (inviteToken) sessionStorage.setItem("pending_invite_token", inviteToken);

    const trimmedEmail = email.trim();
    const trimmedName  = fullName.trim();

    const trimmedCompany     = companyName.trim();
    const trimmedDesignation = designation.trim();
    const isBusiness         = accountType === "business";

    if (!trimmedName)                 { setError("Please enter your full name."); return; }
    if (!validateEmail(trimmedEmail)) { setError("Invalid email format."); return; }
    if (password.length < 8)         { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm)        { setError("Passwords do not match."); return; }
    if (isBusiness && !trimmedCompany)     { setError("Please enter your company name."); return; }
    if (isBusiness && !trimmedDesignation) { setError("Please enter your position at the company."); return; }
    if (!agreedToTerms) { setError("Please agree to the Terms of Service and Privacy Policy to continue."); return; }

    startLoading("email");
    try {
      await authAPI.register({
        email:    trimmedEmail,
        password,
        fullName: trimmedName,
        accountType,
        ...(isBusiness ? { companyName: trimmedCompany, designation: trimmedDesignation } : {}),
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
    // FIX: same validation as handleContinueToCredentials — if someone picked
    // "Business" but hasn't filled in company/position yet, don't let a social
    // button skip past that and create an incomplete business account.
    const isBusiness = accountType === "business";
    if (isBusiness && !companyName.trim())  { setError("Please enter your company name."); return; }
    if (isBusiness && !designation.trim())  { setError("Please enter your position at the company."); return; }

    const urlParams   = new URLSearchParams(window.location.search);
    const inviteToken = urlParams.get("token");
    if (inviteToken) sessionStorage.setItem("pending_invite_token", inviteToken);

    startLoading(providerLabel.toLowerCase());
    try {
      const cred = await signInWithPopup(auth, provider);
      const res  = await syncToBackend(cred.user, providerLabel.toLowerCase(), {
        accountType,
        ...(isBusiness ? { companyName: companyName.trim(), designation: designation.trim() } : {}),
      });
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

  // FIX: previously required clicking "Verify & Sign In" even after typing
  // all 6 digits — small but real friction. Auto-submits once complete.
  useEffect(() => {
    if (step === "verify" && otp.length === 6 && !loading) {
      handleVerifyOtp();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step]);

  // Which dot index to highlight: 0 = info, 1 = credentials, 2 = verify
  const dotIndex = step === "verify" ? 2 : (subStep === "credentials" ? 1 : 0);

  return (
    <div className="et-viewport relative w-full overflow-hidden bg-[#050807] font-sans text-white flex flex-col">
      <style>{`
        /* FIX: 100vh doesn't account for mobile browser chrome (e.g. iOS
           Safari's address bar). 100dvh fixes this where supported; 100vh
           above it is the fallback for browsers that don't support dvh. */
        .et-viewport { height: 100vh; height: 100dvh; }
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
        .no-scrollbar {
          scrollbar-width: none;       /* Firefox */
          -ms-overflow-style: none;    /* IE/Edge */
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;               /* Chrome/Safari */
        }
      `}</style>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-[500px]
                      bg-[radial-gradient(ellipse_at_50%_-10%,rgba(34,197,94,0.08),transparent_60%)]" />

      <div className="relative mx-auto flex w-full max-w-[1600px] flex-1 min-h-0 flex-col items-stretch gap-6 overflow-x-hidden px-6 lg:flex-row lg:gap-10 lg:px-10 lg:py-4">

        {/* ============================= LEFT PANEL ============================= */}
        <div className="relative flex min-h-0 w-full flex-col lg:w-[55%] lg:h-full lg:py-3">
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

            {/* Hero — typewriter */}
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
        <div className="flex w-full min-h-0 h-full items-center justify-center py-3 lg:w-[45%] lg:py-2">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="relative w-full max-w-[400px] max-h-full overflow-y-auto overflow-x-hidden no-scrollbar rounded-3xl border border-white/[0.08] bg-[#0F1313]/90
                       p-4 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:p-5"
          >
            {/* Secure badge — shown across all slides of the register step */}
            {step === "register" && (
              <div className="absolute right-5 top-5 flex items-center gap-1.5 rounded-full border border-[#22C55E]/25
                              bg-[#22C55E]/10 px-2.5 py-1 text-[10px] font-medium text-[#4ADE80] sm:right-6 sm:top-6">
                <ShieldCheck className="h-3 w-3" />
                Secure &amp; Compliant
              </div>
            )}

            <StepDots index={dotIndex} total={3} />

            <AnimatePresence mode="wait" custom={direction}>
              {/* ── Slide 1: account info ── */}
              {step === "register" && subStep === "info" && (
                <motion.div
                  key="info"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                >
                  <h2 className="text-[19px] font-bold tracking-tight sm:text-[21px]">
                    Create <span className="text-[#22C55E]">your account</span>
                  </h2>
                  <p className="mb-3.5 mt-1 text-[12px] text-white/60">
                    Join EtherTrack and build a sustainable future.
                  </p>

                  {(isInvited || sessionStorage.getItem("pending_invite_token")) && (
                    <div className="mb-4 rounded-lg border border-[#22C55E]/25 bg-[#22C55E]/10 px-3.5 py-2.5 text-center text-[12px] leading-relaxed text-[#4ADE80]">
                      🎉 You&apos;ve been invited to join a team — create your account to accept
                    </div>
                  )}

                  {/* Account category — determines whether we collect company
                      details and auto-provision an organisation on verify */}
                  <div className="mb-3.5">
                    <label className="mb-1.5 block text-[11px] font-medium tracking-[0.08em] text-white/60">
                      ACCOUNT TYPE
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => { setAccountType("individual"); setError(""); }}
                        aria-pressed={accountType === "individual"}
                        className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[12.5px] font-medium transition-all duration-200 ${
                          accountType === "individual"
                            ? "border-[#22C55E] bg-[#22C55E]/10 text-[#4ADE80]"
                            : "border-white/10 bg-black/30 text-white/60 hover:border-white/20"
                        }`}
                      >
                        <User className="h-4 w-4" />
                        Individual
                      </button>
                      <button
                        type="button"
                        onClick={() => { setAccountType("business"); setError(""); }}
                        aria-pressed={accountType === "business"}
                        className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[12.5px] font-medium transition-all duration-200 ${
                          accountType === "business"
                            ? "border-[#22C55E] bg-[#22C55E]/10 text-[#4ADE80]"
                            : "border-white/10 bg-black/30 text-white/60 hover:border-white/20"
                        }`}
                      >
                        <Building2 className="h-4 w-4" />
                        Business
                      </button>
                    </div>
                    <p className="mt-1.5 text-[10.5px] text-white/50">
                      {accountType === "business"
                        ? "For companies tracking emissions, tokenizing credits, and generating compliance reports."
                        : "For individuals buying, selling, and managing a carbon credit portfolio."}
                    </p>
                  </div>

                  <form onSubmit={handleContinueToCredentials} noValidate>
                    <Field icon={User} label="FULL NAME">
                      <input
                        id="signup-name"
                        className={inputBase}
                        type="text"
                        placeholder="Enter your full name"
                        value={fullName}
                        autoComplete="name"
                        autoFocus
                        onChange={e => { setFullName(e.target.value); setError(""); }}
                      />
                    </Field>

                    {accountType === "business" && (
                      <>
                        <Field icon={Building2} label="COMPANY NAME">
                          <input
                            id="signup-company"
                            className={inputBase}
                            type="text"
                            placeholder="Enter your company's registered name"
                            value={companyName}
                            autoComplete="organization"
                            onChange={e => { setCompanyName(e.target.value); setError(""); }}
                          />
                        </Field>

                        <Field icon={Briefcase} label="YOUR POSITION">
                          <input
                            id="signup-designation"
                            className={inputBase}
                            type="text"
                            placeholder="e.g. Sustainability Manager, CFO, Director"
                            value={designation}
                            autoComplete="organization-title"
                            onChange={e => { setDesignation(e.target.value); setError(""); }}
                          />
                        </Field>
                      </>
                    )}

                    <ErrorBanner error={error} />

                    <div className="mt-3.5">
                      <PrimaryButton type="submit">
                        Continue
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
                    onClick={() => handleSocialSignup(googleProvider, "Google")}
                    disabled={loading}
                  >
                    {activeMethod === "google" ? "Connecting…" : "Sign up with Google"}
                  </SocialButton>
                  <SocialButton
                    icon={<FaFacebook size={13} color="#4ADE80" />}
                    onClick={() => handleSocialSignup(facebookProvider, "Facebook")}
                    disabled={loading}
                  >
                    {activeMethod === "facebook" ? "Connecting…" : "Sign up with Facebook"}
                  </SocialButton>

                  <p className="mt-3.5 text-center text-[12px] text-white/60">
                    Already have an account?{" "}
                    <Link to="/login" className="inline-flex items-center gap-1 font-medium text-[#22C55E] hover:text-[#4ADE80]">
                      Sign in <ArrowRight className="h-3 w-3" />
                    </Link>
                  </p>
                </motion.div>
              )}

              {/* ── Slide 2: email + password ── */}
              {step === "register" && subStep === "credentials" && (
                <motion.div
                  key="credentials"
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                >
                  <button
                    type="button"
                    onClick={handleBackToInfo}
                    className="mb-3 flex items-center gap-1.5 text-[11.5px] text-white/55 transition-colors hover:text-white"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </button>

                  <h2 className="text-[19px] font-bold tracking-tight sm:text-[21px]">
                    Secure <span className="text-[#22C55E]">your account</span>
                  </h2>
                  <p className="mb-3.5 mt-1 text-[12px] text-white/60">
                    Almost there, {fullName.trim().split(" ")[0] || "there"} — just your login details.
                  </p>

                  <form onSubmit={handleRegister} noValidate>
                    <Field icon={Mail} label="BUSINESS EMAIL">
                      <input
                        id="signup-email"
                        className={inputBase}
                        type="email"
                        placeholder="Enter your business email"
                        value={email}
                        autoComplete="email"
                        autoFocus
                        onChange={e => { setEmail(e.target.value); setError(""); }}
                      />
                    </Field>

                    <Field icon={Lock} label="PASSWORD">
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
                        {showPassword ? <EyeOff className="h-[16px] w-[16px]" /> : <Eye className="h-[16px] w-[16px]" />}
                      </button>
                    </Field>

                    <Field icon={Lock} label="CONFIRM PASSWORD">
                      <input
                        id="signup-confirm"
                        className={`${inputBase} ${confirm && confirm !== password ? "border-red-500/40 focus:border-red-500/60 focus:ring-red-500/10" : ""}`}
                        type={showConfirm ? "text" : "password"}
                        placeholder="Re-enter your password"
                        value={confirm}
                        autoComplete="new-password"
                        aria-invalid={Boolean(confirm && confirm !== password)}
                        aria-describedby={confirm && confirm !== password ? "confirm-mismatch" : undefined}
                        onChange={e => { setConfirm(e.target.value); setError(""); }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm(v => !v)}
                        aria-label={showConfirm ? "Hide password" : "Show password"}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/30 transition-colors hover:text-white/70"
                        tabIndex={-1}
                      >
                        {showConfirm ? <EyeOff className="h-[16px] w-[16px]" /> : <Eye className="h-[16px] w-[16px]" />}
                      </button>
                    </Field>
                    {/* FIX: mismatch was color-only (red border) — invisible to
                        colorblind users until submit. Explicit text instead. */}
                    {confirm && confirm !== password && (
                      <p id="confirm-mismatch" className="-mt-1.5 mb-2.5 text-[11px] text-red-400">
                        Passwords don&apos;t match.
                      </p>
                    )}

                    {/* Password requirement checklist */}
                    {password && (
                      <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1">
                        {strengthChecks.map(({ label, pass }) => (
                          <div key={label} className="flex items-center gap-1.5 text-[10.5px]">
                            {pass ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#22C55E]" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 shrink-0 text-white/20" />
                            )}
                            <span className={pass ? "text-white/70" : "text-white/35"}>{label}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Required ToS/Privacy consent — a carbon-credit trading
                        platform needs explicit consent captured at signup,
                        not just implied by using the product. */}
                    <label className="mb-1 flex cursor-pointer items-start gap-2 text-[11.5px] leading-relaxed text-white/55">
                      <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                        <input
                          type="checkbox"
                          checked={agreedToTerms}
                          onChange={e => { setAgreedToTerms(e.target.checked); setError(""); }}
                          className="peer sr-only"
                        />
                        <span className="absolute inset-0 rounded border border-white/20 bg-black/40 transition-colors
                                         peer-checked:border-[#22C55E] peer-checked:bg-[#22C55E]" />
                        {agreedToTerms && <Check className="relative h-3 w-3 text-black" strokeWidth={3} />}
                      </span>
                      <span>
                        I agree to the{" "}
                        <Link to="/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-[#22C55E] hover:text-[#4ADE80]">
                          Terms of Service
                        </Link>{" "}
                        and{" "}
                        <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-[#22C55E] hover:text-[#4ADE80]">
                          Privacy Policy
                        </Link>
                      </span>
                    </label>

                    <ErrorBanner error={error} />

                    <div className="mt-3.5">
                      <PrimaryButton
                        type="submit"
                        loading={loading && activeMethod === "email"}
                        loadingLabel="Creating account…"
                        disabled={loading || !agreedToTerms}
                      >
                        Create Account
                      </PrimaryButton>
                    </div>
                  </form>

                  <div className="mt-3 flex items-center justify-center gap-1.5 text-[10.5px] text-white/45">
                    <Lock className="h-3 w-3" />
                    Your data is encrypted and secure with us.
                  </div>
                </motion.div>
              )}

              {/* ── Slide 3: OTP verification ── */}
              {step === "verify" && (
                <motion.div
                  key="verify"
                  custom={1}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                >
                  <h2 className="text-[22px] font-bold tracking-tight sm:text-[24px]">
                    Verify <span className="text-[#22C55E]">your email</span>
                  </h2>
                  <p className="mb-6 mt-1 text-[13px] text-white/60">
                    Enter your 6-digit code
                  </p>

                  <form onSubmit={handleVerifyOtp} noValidate>
                    <div className="flex flex-col items-center gap-5 py-1">
                      <p className="text-center text-[12.5px] leading-relaxed text-white/55">
                        We sent a code to <span className="text-[#4ADE80]">{email}</span>.
                        <br />
                        It expires in 10 minutes. Check spam if you don&apos;t see it.
                      </p>

                      <input
                        className="h-[64px] w-[200px] rounded-xl border border-[#22C55E]/40 bg-black/40
                                   text-center text-[26px] font-bold tracking-[0.3em] text-[#4ADE80] outline-none
                                   transition-all duration-200 focus:border-[#22C55E] focus:ring-4 focus:ring-[#22C55E]/10"
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

                      <p className="text-[11.5px] text-white/50">
                        {resendTimer > 0 ? (
                          <span>Resend in {resendTimer}s</span>
                        ) : (
                          <button
                            type="button"
                            className="font-medium text-[#22C55E] transition-colors hover:text-[#4ADE80]"
                            onClick={handleResendOtp}
                          >
                            Resend code →
                          </button>
                        )}
                      </p>
                    </div>

                    <ErrorBanner error={error} />

                    <div className="mt-5">
                      <PrimaryButton type="submit" loading={loading && activeMethod === "verify"} loadingLabel="Verifying…" disabled={loading || otp.length !== 6}>
                        Verify &amp; Sign In
                      </PrimaryButton>
                    </div>
                  </form>

                  <button
                    type="button"
                    onClick={() => { setStep("register"); setSubStep("credentials"); setDirection(-1); setOtp(""); setError(""); }}
                    className="mt-4 w-full text-center text-[12.5px] text-white/55 transition-colors hover:text-white"
                  >
                    ← Back to sign up
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
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

export default Signup;