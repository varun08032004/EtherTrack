import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { KNOWLEDGE_BASE, INTENT_PATTERNS, BOT_PERSONA } from "./knowledgeBase";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
import { supportAPI } from "../services/api"; // adjust relative path if SupportWidget.jsx lives elsewhere
const STORAGE_KEY   = "et_support_chat_v1";
const MAX_HISTORY   = 60; // max messages to persist
const STUCK_THRESHOLD = 3; // consecutive no-results before auto-escalate

// ─── COMMAND SHORTCUTS ────────────────────────────────────────────────────────
const COMMANDS = {
  "/kyc":        { moduleId: "kyc",            label: "KYC Verification" },
  "/wallet":     { moduleId: "wallet",          label: "Wallet & Blockchain" },
  "/plans":      { moduleId: "subscription",    label: "Plans & Billing" },
  "/credits":    { moduleId: "carbon-credits",  label: "Carbon Credits" },
  "/emissions":  { moduleId: "emissions",       label: "Emissions Tracking" },
  "/org":        { moduleId: "org",             label: "Organization & Team" },
  "/ticket":     { action: "ticket",            label: "Raise a Support Ticket" },
  "/reset":      { action: "reset",             label: "Start New Chat" },
  "/help":       { action: "help",              label: "Show All Commands" },
};

// ─── PAGE CONTEXT ─────────────────────────────────────────────────────────────
const PAGE_CONTEXT = {
  "/kyc":                { label: "KYC Verification",  suggestions: ["what-is-kyc","how-to-complete-kyc","kyc-documents"] },
  "/wallet":             { label: "Wallet",             suggestions: ["connect-wallet","wallet-mismatch","transaction-failed"] },
  "/carbon-credits":     { label: "Carbon Credits",     suggestions: ["buy-credits","sell-credits","retire-credits"] },
  "/portfolio":          { label: "Portfolio",           suggestions: ["sell-credits","retire-credits","certificate"] },
  "/emission-tracking":  { label: "Emissions Tracking", suggestions: ["log-emissions","scope-types","brsr"] },
  "/compliance":         { label: "Compliance",          suggestions: ["brsr","scope-types","log-emissions"] },
  "/billing":            { label: "Plans & Billing",     suggestions: ["plans-overview","upgrade-plan","billing-issues"] },
  "/team":               { label: "Team Management",     suggestions: ["invite-team","create-org","join-org"] },
  "/dashboard":          { label: "Dashboard",           suggestions: ["what-is-ethertrack","how-to-signup","what-is-kyc"] },
  "/transaction-status": { label: "Transactions",        suggestions: ["transactions","transaction-failed","connect-wallet"] },
  "/settings":           { label: "Settings",            suggestions: ["connect-wallet","upgrade-plan","invite-team"] },
};

function getPageContext() {
  return PAGE_CONTEXT[window.location.pathname] || null;
}

function getSubtopicById(id) {
  for (const mod of KNOWLEDGE_BASE) {
    const sub = mod.subtopics.find(s => s.id === id);
    if (sub) return { ...sub, moduleLabel: mod.label, moduleIcon: mod.icon };
  }
  return null;
}

function getModuleById(id) {
  return KNOWLEDGE_BASE.find(m => m.id === id) || null;
}

// ─── SOUND ────────────────────────────────────────────────────────────────────
function playPop() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);
  } catch {}
}

// ─── FUZZY SEARCH ─────────────────────────────────────────────────────────────
function fuzzyMatch(str, query) {
  if (!str || !query) return 0;
  const s = str.toLowerCase();
  const q = query.toLowerCase();
  if (s.includes(q)) return 1;
  // Levenshtein-lite: check if each query token is "close" to any word in str
  const qTokens = q.split(/\s+/);
  const sTokens = s.split(/\s+/);
  let matched = 0;
  for (const qt of qTokens) {
    for (const st of sTokens) {
      if (levenshtein(qt, st) <= Math.floor(qt.length / 3.5)) { matched++; break; }
    }
  }
  return matched / qTokens.length;
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[a.length][b.length];
}

function searchKB(query, contextTopicId = null) {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/);
  const results = [];

  for (const module of KNOWLEDGE_BASE) {
    for (const sub of module.subtopics) {
      let score = 0;
      // Exact matches
      if (sub.question.toLowerCase().includes(q)) score += 6;
      // Keyword exact + fuzzy
      sub.keywords.forEach(k => {
        if (q.includes(k) || k.includes(q)) score += 3;
        else {
          const fz = fuzzyMatch(k, q);
          if (fz > 0.6) score += fz * 2;
          else if (tokens.some(t => k.includes(t) || t.includes(k))) score += 1;
        }
      });
      // Fuzzy question match
      const qFuzz = fuzzyMatch(sub.question, q);
      if (qFuzz > 0.5) score += qFuzz * 3;
      // Answer body
      if (sub.answer.toLowerCase().includes(q)) score += 1;
      // Follow-up match
      if (sub.followUps?.some(f => f.toLowerCase().includes(q) || q.includes(f.toLowerCase()))) score += 2;
      // Tag match
      if (sub.tags?.some(tag => q.includes(tag))) score += 2;
      // Context memory boost
      if (contextTopicId && sub.id === contextTopicId) score += 2;

      if (score > 0) results.push({ ...sub, moduleLabel: module.label, moduleIcon: module.icon, score });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 3);
}

function detectIntent(text) {
  const t = text.toLowerCase();
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (patterns.some(p => t.includes(p))) return intent;
  }
  return null;
}

function getAutocompleteSuggestions(query) {
  if (!query || query.trim().length < 2) return [];
  // Handle command autocomplete
  if (query.startsWith("/")) {
    return Object.entries(COMMANDS)
      .filter(([cmd]) => cmd.startsWith(query.toLowerCase()))
      .map(([cmd, info]) => ({ text: cmd, icon: "⚡", label: info.label, isCommand: true }))
      .slice(0, 6);
  }
  const q = query.toLowerCase();
  const suggestions = [];
  for (const module of KNOWLEDGE_BASE) {
    for (const sub of module.subtopics) {
      const qMatch = sub.question.toLowerCase().includes(q);
      const kMatch = sub.keywords.some(k => k.includes(q) || q.includes(k));
      const fuzz   = fuzzyMatch(sub.question, q) > 0.55;
      if (qMatch || kMatch || fuzz) {
        suggestions.push({ text: sub.question, icon: module.icon, id: sub.id });
      }
    }
  }
  return suggestions.slice(0, 5);
}

// ─── PERSIST CHAT ─────────────────────────────────────────────────────────────
function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { messages, lastTopicId, ts } = JSON.parse(raw);
    // Expire after 24h
    if (Date.now() - ts > 86400000) { localStorage.removeItem(STORAGE_KEY); return null; }
    return { messages, lastTopicId };
  } catch { return null; }
}

function saveHistory(messages, lastTopicId) {
  try {
    const toSave = messages.slice(-MAX_HISTORY).filter(m => m.type !== "topics"); // don't re-save init
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: toSave, lastTopicId, ts: Date.now() }));
  } catch {}
}

// ─── BACKEND LOGGING (fire-and-forget, never blocks UI) ──────────────────────
function logFeedback({ topicId, topicQuestion, helpful, userQuery }) {
  supportAPI
    .logFeedback({
      topicId,
      topicQuestion,
      helpful,
      page: window.location.pathname,
      userQuery: userQuery || null,
    })
    .catch(() => {}); // analytics — safe to silently fail
}

function logUnanswered(query) {
  supportAPI
    .logUnanswered({ query, page: window.location.pathname })
    .catch(() => {});
}

// ─── TYPING INDICATOR ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div style={s.botRow}>
      <EthiAvatar />
      <div style={{ ...s.bubble, ...s.botBubble, padding: "12px 16px" }}>
        <div style={s.typing}>
          <span style={{ ...s.dot, animationDelay: "0ms" }} />
          <span style={{ ...s.dot, animationDelay: "160ms" }} />
          <span style={{ ...s.dot, animationDelay: "320ms" }} />
        </div>
      </div>
    </div>
  );
}

// ─── ETHI AVATAR ─────────────────────────────────────────────────────────────
function EthiAvatar({ size = 28 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.3,
      background: "linear-gradient(135deg,#166534,#14532d)",
      border: "1.5px solid #22c55e44",
      flexShrink: 0, display: "flex", alignItems: "center",
      justifyContent: "center", marginTop: 2, fontSize: size * 0.45,
    }}>🌿</div>
  );
}

// ─── BOT MESSAGE ─────────────────────────────────────────────────────────────
function BotMessage({ msg, onFollowUp, onTicket, onFeedback }) {
  const [feedback, setFeedback] = useState(msg._feedback || null);

  const handleFeedback = (val) => {
    setFeedback(val);
    onFeedback && onFeedback(val, msg);
  };

  return (
    <div style={s.botRow}>
      <EthiAvatar />
      <div style={{ maxWidth: "85%", width: "85%" }}>
        {msg.moduleLabel && (
          <div style={s.msgMeta}>{msg.moduleIcon} {msg.moduleLabel}</div>
        )}
        <div style={{ ...s.bubble, ...s.botBubble }}>
          <p style={s.msgText}>{msg.text}</p>

          {msg.steps && msg.steps.length > 0 && (
            <div style={s.stepsWrap}>
              {msg.steps.map((step, i) => (
                <div key={i} style={s.stepRow}>
                  <div style={s.stepNum}>{i + 1}</div>
                  <div style={s.stepText}>{step}</div>
                </div>
              ))}
            </div>
          )}

          {/* Related articles */}
          {msg.related && msg.related.length > 0 && (
            <div style={s.relatedWrap}>
              <div style={s.relatedLabel}>📎 Related</div>
              {msg.related.map((r, i) => (
                <button key={i} style={s.relatedItem} onClick={() => onFollowUp(r.question)}
                  onMouseEnter={e => e.currentTarget.style.color = "#22c55e"}
                  onMouseLeave={e => e.currentTarget.style.color = "#6b7280"}
                >{r.moduleIcon} {r.question}</button>
              ))}
            </div>
          )}

          {/* Feedback row */}
          <div style={s.feedbackRow}>
            {feedback === null ? (
              <>
                <span style={s.feedbackLabel}>Helpful?</span>
                <button style={s.fbBtn} onClick={() => handleFeedback("yes")} title="Yes">👍</button>
                <button style={s.fbBtn} onClick={() => handleFeedback("no")}  title="No">👎</button>
              </>
            ) : feedback === "yes" ? (
              <span style={{ color: "#22c55e", fontSize: 11 }}>Glad that helped! 🎉</span>
            ) : (
              <span style={{ color: "#f87171", fontSize: 11 }}>
                Sorry! <button style={s.inlineLink} onClick={onTicket}>Raise a ticket →</button>
              </span>
            )}
          </div>

          {msg.escalate && feedback !== "yes" && (
            <button style={s.inlineCTA} onClick={onTicket}>🎫 Raise a support ticket</button>
          )}
        </div>

        {msg.followUps && msg.followUps.length > 0 && (
          <div style={s.followUpWrap}>
            {msg.followUps.slice(0, 3).map((f, i) => (
              <button key={i} style={s.followUpChip} onClick={() => onFollowUp(f)}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#22c55e"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2a2a"}
              >{f}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserMessage({ text }) {
  return (
    <div style={s.userRow}>
      <div style={{ ...s.bubble, ...s.userBubble }}>
        <p style={{ ...s.msgText, color: "#fff" }}>{text}</p>
      </div>
    </div>
  );
}

function TopicMenu({ onSelect, onTicket, pageCtx }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={s.botRow}>
        <EthiAvatar />
        <div style={{ maxWidth: "90%", width: "100%" }}>
          <div style={{ ...s.bubble, ...s.botBubble }}>
            <p style={s.msgText}>{BOT_PERSONA.greeting}</p>
            <p style={{ ...s.msgText, marginTop: 6, color: "#6b7280", fontSize: 11 }}>
              💡 Tip: type <code style={{ background: "#222", padding: "1px 5px", borderRadius: 4, color: "#22c55e" }}>/kyc</code>, <code style={{ background: "#222", padding: "1px 5px", borderRadius: 4, color: "#22c55e" }}>/wallet</code>, <code style={{ background: "#222", padding: "1px 5px", borderRadius: 4, color: "#22c55e" }}>/plans</code> for quick access
            </p>
          </div>
        </div>
      </div>

      {pageCtx && (
        <div style={s.botRow}>
          <EthiAvatar />
          <div style={{ maxWidth: "90%", width: "100%" }}>
            <div style={{ ...s.bubble, ...s.botBubble }}>
              <p style={{ ...s.msgText, marginBottom: 8 }}>
                📍 You're on <strong style={{ color: "#22c55e" }}>{pageCtx.label}</strong>. Relevant questions:
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pageCtx.suggestions.map(id => {
                  const sub = getSubtopicById(id);
                  if (!sub) return null;
                  return (
                    <button key={id} style={s.ctxChip}
                      onClick={() => onSelect({ sub })}
                      onMouseEnter={e => e.currentTarget.style.borderColor = "#22c55e"}
                      onMouseLeave={e => e.currentTarget.style.borderColor = "#166534"}
                    >
                      <span>{sub.moduleIcon} {sub.question}</span>
                      <span style={{ color: "#22c55e" }}>›</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={s.botRow}>
        <EthiAvatar />
        <div style={{ maxWidth: "90%", width: "100%" }}>
          <div style={{ ...s.bubble, ...s.botBubble }}>
            <p style={{ ...s.msgText, marginBottom: 8 }}>Browse all topics:</p>
            <div style={s.topicGrid}>
              {KNOWLEDGE_BASE.map(mod => (
                <button key={mod.id} style={s.topicChip}
                  onClick={() => onSelect({ module: mod })}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#22c55e"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2a2a"}
                >{mod.icon} {mod.label}</button>
              ))}
            </div>
          </div>
          <button style={s.escalateChip} onClick={onTicket}>🎫 Raise a support ticket</button>
        </div>
      </div>
    </div>
  );
}

function SubtopicMenu({ module, onSelect, onBack }) {
  return (
    <div style={s.botRow}>
      <EthiAvatar />
      <div style={{ maxWidth: "90%", width: "100%" }}>
        <div style={{ ...s.bubble, ...s.botBubble }}>
          <p style={s.msgText}>
            <strong style={{ color: "#22c55e" }}>{module.icon} {module.label}</strong> — pick a question:
          </p>
        </div>
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          {module.subtopics.map(sub => (
            <button key={sub.id} style={s.subChip}
              onClick={() => onSelect(sub, module)}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#22c55e"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2a2a"}
            >
              <span>{sub.question}</span>
              <span style={{ color: "#22c55e", fontSize: 16 }}>›</span>
            </button>
          ))}
        </div>
        <button style={{ ...s.escalateChip, marginTop: 8 }} onClick={onBack}>← Back</button>
      </div>
    </div>
  );
}

function StuckMessage({ onTicket, onBrowse }) {
  return (
    <div style={s.botRow}>
      <EthiAvatar />
      <div style={{ maxWidth: "85%" }}>
        <div style={{ ...s.bubble, ...s.botBubble }}>
          <p style={s.msgText}>
            Looks like I'm not finding what you need 😔 Let me connect you with our support team — they'll sort it out fast.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={{ ...s.inlineCTA, flex: 1 }} onClick={onTicket}>🎫 Raise Ticket</button>
            <button style={{ ...s.inlineCTA, flex: 1, background: "#1a1a1a", color: "#9ca3af", border: "1px solid #2a2a2a" }} onClick={onBrowse}>📂 Browse Topics</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AUTOCOMPLETE ─────────────────────────────────────────────────────────────
function AutocompleteDropdown({ suggestions, onSelect, visible }) {
  if (!visible || suggestions.length === 0) return null;
  return (
    <div style={s.autocomplete}>
      {suggestions.map((item, i) => (
        <button key={i} style={s.acItem}
          onMouseDown={e => { e.preventDefault(); onSelect(item.text); }}
          onMouseEnter={e => e.currentTarget.style.background = "#1e1e1e"}
          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
        >
          <span style={{ marginRight: 8, fontSize: 13 }}>{item.icon}</span>
          <span style={{ flex: 1, color: item.isCommand ? "#22c55e" : "#d1d5db" }}>{item.text}</span>
          {item.isCommand && <span style={{ color: "#4b5563", fontSize: 10 }}>{item.label}</span>}
        </button>
      ))}
    </div>
  );
}

// ─── TICKET FORM ─────────────────────────────────────────────────────────────
function TicketForm({ onClose, prefillSubject }) {
  const [form, setForm] = useState({ name: "", email: "", subject: prefillSubject || "", message: "" });
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  const [ticketId, setTicketId] = useState("");
  const [errors, setErrors]   = useState({});
  const [submitError, setSubmitError] = useState("");

  const validate = () => {
    const e = {};
    if (!form.name.trim())    e.name    = "Required";
    if (!form.email.trim())   e.email   = "Required";
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = "Invalid email";
    if (!form.message.trim()) e.message = "Required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setLoading(true);
    setSubmitError("");
    try {
      const data = await supportAPI.raiseTicket({
        name: form.name,
        email: form.email,
        subject: form.subject,
        message: form.message,
        page: window.location.pathname,
      });
      if (!data) throw new Error("Failed to submit ticket. Please try again.");
      setTicketId(data.ticketId);
      setDone(true);
    } catch (err) {
      setSubmitError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (done) return (
    <div style={s.ticketSuccess}>
      <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
      <div style={{ color: "#22c55e", fontWeight: 800, fontSize: 20, marginBottom: 6 }}>Ticket Raised!</div>
      <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 4 }}>Ticket ID</div>
      <div style={{ color: "#fff", fontWeight: 700, fontSize: 18, letterSpacing: 2, marginBottom: 12 }}>{ticketId}</div>
      <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 24 }}>
        We'll reply to <strong style={{ color: "#fff" }}>{form.email}</strong> within 24 hours.
      </div>
      <button style={s.backBtn} onClick={onClose}>← Back to chat</button>
    </div>
  );

  return (
    <div style={{ padding: "0 2px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button style={s.backBtn} onClick={onClose}>←</button>
        <span style={{ color: "#e5e5e5", fontWeight: 700, fontSize: 15 }}>Raise a Support Ticket</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { k:"name",    label:"Full Name",          type:"text",  ph:"Your name" },
          { k:"email",   label:"Email",              type:"email", ph:"you@company.com" },
          { k:"subject", label:"Subject (optional)", type:"text",  ph:"Brief issue title" },
        ].map(({ k, label, type, ph }) => (
          <div key={k}>
            <div style={s.formLabel}>{label} {errors[k] && <span style={{ color: "#f87171" }}>— {errors[k]}</span>}</div>
            <input type={type} placeholder={ph} value={form[k]}
              onChange={e => { setForm({ ...form, [k]: e.target.value }); setErrors(prev => ({ ...prev, [k]: "" })); }}
              style={{ ...s.formInput, ...(errors[k] ? { borderColor: "#f87171" } : {}) }} />
          </div>
        ))}
        <div>
          <div style={s.formLabel}>Describe your issue {errors.message && <span style={{ color: "#f87171" }}>— {errors.message}</span>}</div>
          <textarea rows={4} placeholder="Tell us what's going wrong..."
            value={form.message}
            onChange={e => { setForm({ ...form, message: e.target.value }); setErrors(prev => ({ ...prev, message: "" })); }}
            style={{ ...s.formInput, ...(errors.message ? { borderColor: "#f87171" } : {}), resize: "vertical", fontFamily: "inherit" }}
          />
        </div>
        {submitError && (
          <div style={{ color: "#f87171", fontSize: 12, textAlign: "center" }}>{submitError}</div>
        )}
        <button style={{ ...s.submitBtn, opacity: loading ? 0.7 : 1 }} onClick={submit} disabled={loading}>
          {loading ? "Submitting..." : "Submit Ticket"}
        </button>
      </div>
    </div>
  );
}

// ─── MINIMIZED BAR ────────────────────────────────────────────────────────────
function MinimizedBar({ unreadCount, onClick }) {
  return (
    <button style={s.minBar} onClick={onClick}>
      <EthiAvatar size={22} />
      <span style={{ color: "#d1d5db", fontSize: 13, fontWeight: 600 }}>Ethi — EtherTrack Support</span>
      {unreadCount > 0 && <span style={s.unreadBadge}>{unreadCount}</span>}
      <span style={{ color: "#22c55e", marginLeft: "auto", fontSize: 12 }}>▲</span>
    </button>
  );
}

// ─── MAIN WIDGET ─────────────────────────────────────────────────────────────
export default function SupportWidget() {
  const saved = useMemo(() => loadHistory(), []);

  const [panelState, setPanelState] = useState("closed"); // closed | open | minimized
  const [messages, setMessages]     = useState(() => {
    if (saved?.messages?.length) return [{ id:"init", type:"topics" }, ...saved.messages];
    return [{ id:"init", type:"topics" }];
  });
  const [input, setInput]           = useState("");
  const [typing, setTyping]         = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [ticketSubject, setTicketSubject] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [acSuggestions, setAcSuggestions] = useState([]);
  const [acVisible, setAcVisible]   = useState(false);
  const [lastTopicId, setLastTopicId] = useState(saved?.lastTopicId || null);
  const [noResultStreak, setNoResultStreak] = useState(0);
  const [animated, setAnimated]     = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const pageCtx   = useMemo(() => getPageContext(), []);
  const isOpen    = panelState === "open";
  const isMin     = panelState === "minimized";

  // Scroll to bottom
  useEffect(() => {
    if (isOpen) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing, isOpen]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      setTimeout(() => inputRef.current?.focus(), 150);
      setAnimated(true);
    }
  }, [isOpen]);

  // Persist history
  useEffect(() => {
    if (messages.length > 1) saveHistory(messages, lastTopicId);
  }, [messages, lastTopicId]);

  const pushMsg = useCallback((msg) => {
    setMessages(prev => [...prev, { ...msg, _id: Date.now() + Math.random() }]);
    if (!isOpen) setUnreadCount(c => c + 1);
  }, [isOpen]);

  const handleOpen = () => {
    playPop();
    setPanelState("open");
    setAnimated(false);
    requestAnimationFrame(() => setAnimated(true));
  };

  const handleInputChange = (val) => {
    setInput(val);
    const sugg = getAutocompleteSuggestions(val);
    setAcSuggestions(sugg);
    setAcVisible(sugg.length > 0 && val.trim().length > 1);
  };

  const handleSend = useCallback(async (text) => {
    const q = (text || input).trim();
    if (!q) return;
    setInput("");
    setAcVisible(false);
    setAcSuggestions([]);

    // Handle commands
    if (q.startsWith("/")) {
      const cmd = q.toLowerCase().split(" ")[0];
      if (COMMANDS[cmd]) {
        const cmdInfo = COMMANDS[cmd];
        pushMsg({ type: "user", text: q });
        if (cmdInfo.action === "ticket")  { setShowTicket(true); return; }
        if (cmdInfo.action === "reset")   { resetChat(); return; }
        if (cmdInfo.action === "help") {
          setTyping(true);
          await new Promise(r => setTimeout(r, 400));
          setTyping(false);
          pushMsg({
            type: "bot",
            text: "Here are all available shortcuts:",
            steps: Object.entries(COMMANDS).map(([cmd, info]) => `${cmd} — ${info.label}`),
            followUps: [],
          });
          return;
        }
        const mod = getModuleById(cmdInfo.moduleId);
        if (mod) {
          setTyping(true);
          await new Promise(r => setTimeout(r, 400));
          setTyping(false);
          pushMsg({ type: "subtopics", module: mod });
          return;
        }
      }
    }

    pushMsg({ type: "user", text: q });
    setTyping(true);
    await new Promise(r => setTimeout(r, 500 + Math.random() * 400));
    setTyping(false);

    const intent = detectIntent(q);

    if (intent === "greeting") {
      pushMsg({ type: "bot", text: "Hey! 👋 What can I help you with today?", followUps: ["How do I complete KYC?","How do I connect my wallet?","How do I buy carbon credits?"] });
      return;
    }
    if (intent === "thanks") {
      pushMsg({ type: "bot", text: "You're welcome! 😊 Anything else I can help with?", followUps: [] });
      return;
    }
    if (intent === "escalate") {
      setTicketSubject(q);
      setShowTicket(true);
      return;
    }

    const results = searchKB(q, lastTopicId);

    if (results.length === 0) {
      logUnanswered(q); // fire-and-forget — helps you find KB gaps later
      const newStreak = noResultStreak + 1;
      setNoResultStreak(newStreak);

      if (newStreak >= STUCK_THRESHOLD) {
        setNoResultStreak(0);
        pushMsg({ type: "stuck" });
        return;
      }

      pushMsg({
        type: "bot",
        text: intent === "frustration"
          ? "I can see you're stuck 😟 I don't have an answer for that yet, but I can connect you with our team."
          : BOT_PERSONA.notFound,
        followUps: ["How do I complete KYC?","How do I connect my wallet?","Raise a support ticket"],
        escalate: true,
      });
      return;
    }

    setNoResultStreak(0);
    const top = results[0];
    setLastTopicId(top.id);

    // Build related articles from other results
    const related = results.slice(1).map(r => ({ question: r.question, moduleIcon: r.moduleIcon }));

    pushMsg({
      type:        "bot",
      text:        top.answer,
      steps:       top.steps   || [],
      followUps:   top.followUps || [],
      related:     related,
      moduleLabel: top.moduleLabel,
      moduleIcon:  top.moduleIcon,
      escalate:    top.escalate || false,
      topicId:     top.id,
      questionAsked: top.question,
      userQuery:   q,
    });
  }, [input, pushMsg, lastTopicId, noResultStreak]);

  const handleTopicMenuSelect = useCallback(async ({ module, sub }) => {
    if (sub) {
      pushMsg({ type: "user", text: sub.question });
      setTyping(true);
      await new Promise(r => setTimeout(r, 500));
      setTyping(false);
      setLastTopicId(sub.id);
      pushMsg({
        type: "bot", text: sub.answer,
        steps: sub.steps || [], followUps: sub.followUps || [],
        moduleLabel: sub.moduleLabel, moduleIcon: sub.moduleIcon,
        escalate: sub.escalate || false,
        topicId: sub.id,
        questionAsked: sub.question,
      });
      return;
    }
    if (module) pushMsg({ type: "subtopics", module });
  }, [pushMsg]);

  const handleSubtopicSelect = useCallback(async (sub, module) => {
    pushMsg({ type: "user", text: sub.question });
    setTyping(true);
    await new Promise(r => setTimeout(r, 500));
    setTyping(false);
    setLastTopicId(sub.id);
    pushMsg({
      type: "bot", text: sub.answer,
      steps: sub.steps || [], followUps: sub.followUps || [],
      moduleLabel: module.label, moduleIcon: module.icon,
      escalate: sub.escalate || false,
      topicId: sub.id,
      questionAsked: sub.question,
    });
  }, [pushMsg]);

  const handleFollowUp = useCallback((text) => {
    if (text === "Raise a support ticket") { setShowTicket(true); return; }
    handleSend(text);
  }, [handleSend]);

  const handleFeedback = useCallback((val, msg) => {
    logFeedback({
      topicId: msg.topicId || msg.moduleLabel || "unknown",
      topicQuestion: msg.questionAsked || msg.text,
      helpful: val === "yes",
      userQuery: msg.userQuery,
    });
    if (val === "no") setTimeout(() => { setTicketSubject(msg.text || ""); }, 300);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === "Escape") { setAcVisible(false); }
  };

  const resetChat = () => {
    setMessages([{ id: "init", type: "topics" }]);
    setShowTicket(false);
    setInput("");
    setLastTopicId(null);
    setNoResultStreak(0);
    setAcVisible(false);
    localStorage.removeItem(STORAGE_KEY);
  };

  // Render
  return (
    <>
      {/* Minimized bar */}
      {isMin && <MinimizedBar unreadCount={unreadCount} onClick={handleOpen} />}

      {/* Bubble */}
      {!isMin && (
        <button
          style={{ ...s.bubble_btn, ...(isOpen ? s.bubble_open : {}) }}
          onClick={isOpen ? () => setPanelState("minimized") : handleOpen}
          aria-label="EtherTrack Support"
        >
          {isOpen
            ? <span style={{ fontSize: 18 }}>—</span>
            : <>
                <span style={{ fontSize: 22 }}>💬</span>
                {unreadCount > 0 && <span style={s.unreadBadge}>{unreadCount > 9 ? "9+" : unreadCount}</span>}
              </>
          }
        </button>
      )}

      {/* Panel */}
      {isOpen && (
        <div style={{ ...s.panel, ...(animated ? s.panelIn : s.panelOut) }}>
          {/* Header */}
          <div style={s.header}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <EthiAvatar size={38} />
              <div>
                <div style={s.headerTitle}>{BOT_PERSONA.name} · EtherTrack Support</div>
                <div style={s.headerSub}><span style={s.onlineDot} /> Online · Usually replies instantly</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 2 }}>
              <button style={s.hdrBtn} onClick={resetChat} title="New chat">↺</button>
              <button style={s.hdrBtn} onClick={() => setPanelState("minimized")} title="Minimize">—</button>
              <button style={s.hdrBtn} onClick={() => setPanelState("closed")} title="Close">✕</button>
            </div>
          </div>

          {/* Body */}
          <div style={s.body}>
            {showTicket ? (
              <TicketForm onClose={() => setShowTicket(false)} prefillSubject={ticketSubject} />
            ) : (
              <>
                {messages.map((msg, i) => {
                  if (msg.type === "topics")    return <TopicMenu    key={i} onSelect={handleTopicMenuSelect} onTicket={() => setShowTicket(true)} pageCtx={pageCtx} />;
                  if (msg.type === "subtopics") return <SubtopicMenu key={i} module={msg.module} onSelect={handleSubtopicSelect} onBack={() => pushMsg({ type: "topics" })} />;
                  if (msg.type === "user")      return <UserMessage  key={i} text={msg.text} />;
                  if (msg.type === "stuck")     return <StuckMessage key={i} onTicket={() => setShowTicket(true)} onBrowse={() => pushMsg({ type: "topics" })} />;
                  if (msg.type === "bot")       return <BotMessage   key={i} msg={msg} onFollowUp={handleFollowUp} onTicket={() => { setTicketSubject(msg.text || ""); setShowTicket(true); }} onFeedback={handleFeedback} />;
                  return null;
                })}
                {typing && <TypingIndicator />}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Input */}
          {!showTicket && (
            <div style={s.inputArea}>
              <AutocompleteDropdown suggestions={acSuggestions} visible={acVisible}
                onSelect={text => { setInput(text); setAcVisible(false); inputRef.current?.focus(); }}
              />
              <div style={s.inputWrap}>
                <input
                  ref={inputRef}
                  style={s.input}
                  placeholder="Ask anything, or type / for shortcuts..."
                  value={input}
                  onChange={e => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => input.trim().length > 1 && setAcVisible(acSuggestions.length > 0)}
                  onBlur={() => setTimeout(() => setAcVisible(false), 150)}
                />
                <button style={{ ...s.sendBtn, opacity: input.trim() ? 1 : 0.4 }}
                  onClick={() => handleSend()} disabled={!input.trim()}>➤</button>
              </div>
            </div>
          )}

          <div style={s.footer}>Powered by <strong>EtherTrack</strong> · Ethi 🌿</div>
        </div>
      )}

      <style>{`
        @keyframes et-blink { 0%,80%,100%{opacity:0.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }
        @keyframes et-ping   { 0%{transform:scale(1);opacity:1} 100%{transform:scale(2.2);opacity:0} }
        @keyframes et-slide-in { from{opacity:0;transform:translateY(16px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
        @media (max-width: 480px) {
          .et-panel { width: 100vw !important; height: 100dvh !important; bottom: 0 !important; right: 0 !important; border-radius: 0 !important; max-height: 100dvh !important; }
          .et-bubble { bottom: 16px !important; right: 16px !important; }
        }
      `}</style>
    </>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const s = {
  bubble_btn: {
    position: "fixed", bottom: 28, right: 28,
    width: 58, height: 58, borderRadius: "50%",
    background: "linear-gradient(135deg,#16a34a,#15803d)",
    border: "none", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 4px 24px rgba(22,163,74,0.45)", zIndex: 9999,
    className: "et-bubble",
  },
  bubble_open: { background: "#1c1c1c", boxShadow: "0 4px 20px rgba(0,0,0,0.5)" },
  unreadBadge: {
    position: "absolute", top: 4, right: 4,
    minWidth: 18, height: 18, borderRadius: 9,
    background: "#ef4444", color: "#fff",
    fontSize: 10, fontWeight: 800,
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "0 4px", boxShadow: "0 0 0 2px #111",
  },
  minBar: {
    position: "fixed", bottom: 0, right: 24,
    height: 44, borderRadius: "10px 10px 0 0",
    background: "#1a1a1a", border: "1px solid #2a2a2a", borderBottom: "none",
    display: "flex", alignItems: "center", gap: 8, padding: "0 16px",
    cursor: "pointer", zIndex: 9998,
    boxShadow: "0 -4px 16px rgba(0,0,0,0.3)",
    minWidth: 220,
  },
  panel: {
    position: "fixed", bottom: 100, right: 28,
    width: 370, maxHeight: 590,
    borderRadius: 18, background: "#111",
    border: "1px solid #1e1e1e",
    boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
    zIndex: 9998, display: "flex", flexDirection: "column",
    overflow: "hidden", fontFamily: "'Inter','Segoe UI',sans-serif",
    className: "et-panel",
  },
  panelIn:  { animation: "et-slide-in 0.22s cubic-bezier(0.34,1.56,0.64,1) forwards" },
  panelOut: { opacity: 0 },
  header: {
    background: "linear-gradient(135deg,#14532d,#166534)",
    padding: "14px 16px",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    flexShrink: 0,
  },
  headerTitle: { color: "#fff", fontWeight: 700, fontSize: 14 },
  headerSub:   { color: "#86efac", fontSize: 11, display: "flex", alignItems: "center", gap: 5, marginTop: 2 },
  onlineDot:   { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#4ade80" },
  hdrBtn: {
    background: "transparent", border: "none",
    color: "#86efac", fontSize: 15, cursor: "pointer",
    padding: "4px 7px", borderRadius: 6,
  },
  body: {
    flex: 1, overflowY: "auto", padding: "16px 14px",
    display: "flex", flexDirection: "column", gap: 14,
    scrollbarWidth: "thin", scrollbarColor: "#2a2a2a transparent",
  },
  botRow:     { display: "flex", alignItems: "flex-start", gap: 8 },
  userRow:    { display: "flex", justifyContent: "flex-end" },
  bubble:     { borderRadius: 12, padding: "10px 14px", maxWidth: "100%" },
  botBubble:  { background: "#1a1a1a", border: "1px solid #242424" },
  userBubble: { background: "linear-gradient(135deg,#166534,#15803d)", maxWidth: "80%" },
  msgMeta:    { color: "#22c55e", fontSize: 10, fontWeight: 600, marginBottom: 4, letterSpacing: 0.5 },
  msgText:    { color: "#d1d5db", fontSize: 13, lineHeight: 1.65, margin: 0 },
  stepsWrap:  { marginTop: 10, display: "flex", flexDirection: "column", gap: 7 },
  stepRow:    { display: "flex", alignItems: "flex-start", gap: 8 },
  stepNum: {
    width: 20, height: 20, borderRadius: 6, flexShrink: 0,
    background: "#14532d", color: "#22c55e",
    fontSize: 10, fontWeight: 800,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  stepText: { color: "#9ca3af", fontSize: 12, lineHeight: 1.6, paddingTop: 2 },
  relatedWrap: { marginTop: 10, paddingTop: 8, borderTop: "1px solid #2a2a2a" },
  relatedLabel: { color: "#4b5563", fontSize: 10, fontWeight: 600, marginBottom: 6, letterSpacing: 0.5 },
  relatedItem: {
    display: "block", width: "100%", background: "none", border: "none",
    color: "#6b7280", fontSize: 11, cursor: "pointer",
    textAlign: "left", padding: "3px 0", transition: "color 0.15s",
  },
  feedbackRow: {
    display: "flex", alignItems: "center", gap: 6,
    marginTop: 10, paddingTop: 8, borderTop: "1px solid #2a2a2a",
  },
  feedbackLabel: { color: "#4b5563", fontSize: 11 },
  fbBtn: { background: "transparent", border: "none", cursor: "pointer", fontSize: 14, padding: "2px 4px", borderRadius: 4 },
  inlineLink: { background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 11, textDecoration: "underline", padding: 0 },
  inlineCTA: {
    marginTop: 10, width: "100%", padding: "9px 12px",
    background: "#14532d", border: "1px solid #22c55e33",
    borderRadius: 8, color: "#22c55e", fontSize: 12,
    fontWeight: 600, cursor: "pointer", textAlign: "center",
  },
  followUpWrap: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, paddingLeft: 36 },
  followUpChip: {
    padding: "5px 10px", background: "#161616",
    border: "1px solid #2a2a2a", borderRadius: 20,
    color: "#9ca3af", fontSize: 11, cursor: "pointer",
    transition: "border-color 0.15s", whiteSpace: "nowrap",
  },
  topicGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 8 },
  topicChip: {
    padding: "9px 10px", background: "#161616",
    border: "1px solid #2a2a2a", borderRadius: 10,
    color: "#d1d5db", fontSize: 12, fontWeight: 600,
    cursor: "pointer", textAlign: "left", transition: "border-color 0.15s",
  },
  ctxChip: {
    width: "100%", padding: "9px 12px", background: "#0f2d1a",
    border: "1px solid #166534", borderRadius: 10,
    color: "#d1fae5", fontSize: 12, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    textAlign: "left", transition: "border-color 0.15s",
  },
  subChip: {
    width: "100%", padding: "10px 14px", background: "#161616",
    border: "1px solid #2a2a2a", borderRadius: 10,
    color: "#d1d5db", fontSize: 12, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    textAlign: "left", transition: "border-color 0.15s",
  },
  escalateChip: {
    marginTop: 8, width: "100%", padding: "9px 12px",
    background: "#161616", border: "1px solid #2a2a2a",
    borderRadius: 10, color: "#86efac", fontSize: 12,
    fontWeight: 600, cursor: "pointer", textAlign: "center",
  },
  typing: { display: "flex", gap: 4, alignItems: "center", height: 16 },
  dot: {
    width: 7, height: 7, borderRadius: "50%", background: "#22c55e",
    display: "inline-block", animation: "et-blink 1.2s ease-in-out infinite",
  },
  inputArea: { flexShrink: 0, borderTop: "1px solid #1a1a1a", position: "relative" },
  inputWrap: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "10px 14px", background: "#111",
  },
  input: {
    flex: 1, background: "#1a1a1a", border: "1px solid #2a2a2a",
    borderRadius: 10, padding: "9px 13px",
    color: "#e5e5e5", fontSize: 13, outline: "none", fontFamily: "inherit",
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
    background: "linear-gradient(135deg,#16a34a,#15803d)",
    border: "none", color: "#fff", fontSize: 14, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  autocomplete: {
    position: "absolute", bottom: "100%", left: 14, right: 14,
    background: "#1a1a1a", border: "1px solid #2a2a2a",
    borderRadius: 10, overflow: "hidden",
    boxShadow: "0 -8px 24px rgba(0,0,0,0.4)", zIndex: 10,
  },
  acItem: {
    width: "100%", padding: "9px 14px", background: "transparent",
    border: "none", borderBottom: "1px solid #222",
    color: "#d1d5db", fontSize: 12, cursor: "pointer",
    textAlign: "left", display: "flex", alignItems: "center",
    transition: "background 0.1s",
  },
  footer: {
    padding: "8px 14px", borderTop: "1px solid #161616",
    color: "#333", fontSize: 10, textAlign: "center", flexShrink: 0,
  },
  ticketSuccess: { textAlign: "center", padding: "32px 16px" },
  formLabel: { color: "#6b7280", fontSize: 11, fontWeight: 600, marginBottom: 5 },
  formInput: {
    width: "100%", background: "#1a1a1a", border: "1px solid #2a2a2a",
    borderRadius: 8, padding: "9px 12px", color: "#e5e5e5",
    fontSize: 13, outline: "none", boxSizing: "border-box",
  },
  submitBtn: {
    width: "100%", padding: 12,
    background: "linear-gradient(135deg,#16a34a,#15803d)",
    border: "none", borderRadius: 10,
    color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer",
  },
  backBtn: {
    background: "transparent", border: "1px solid #2a2a2a",
    borderRadius: 8, color: "#22c55e",
    padding: "7px 16px", fontSize: 12, cursor: "pointer", fontWeight: 600,
  },
};