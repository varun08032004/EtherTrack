import { useState, useRef, useEffect, useCallback } from "react";
import { KNOWLEDGE_BASE, INTENT_PATTERNS, BOT_PERSONA } from "./knowledgeBase";

// ─── CHAT ENGINE ─────────────────────────────────────────────────────────────

function detectIntent(text) {
  const t = text.toLowerCase();
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (patterns.some((p) => t.includes(p))) return intent;
  }
  return null;
}

function searchKB(query) {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/);
  const results = [];

  for (const module of KNOWLEDGE_BASE) {
    for (const sub of module.subtopics) {
      let score = 0;
      // Exact question match — highest weight
      if (sub.question.toLowerCase().includes(q)) score += 6;
      // Keyword matching
      sub.keywords.forEach((k) => {
        if (q.includes(k)) score += 3;
        else if (tokens.some((t) => k.includes(t) || t.includes(k))) score += 1;
      });
      // Answer body match
      if (sub.answer.toLowerCase().includes(q)) score += 1;
      // Follow-up match
      if (sub.followUps?.some((f) => f.toLowerCase().includes(q) || q.includes(f.toLowerCase()))) score += 2;
      // Tag match
      if (sub.tags?.some((tag) => q.includes(tag))) score += 2;

      if (score > 0) results.push({ ...sub, moduleLabel: module.label, moduleIcon: module.icon, score });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 3);
}

function buildBotMessage(result) {
  return { id: result.id, question: result.question, answer: result.answer, steps: result.steps || [], followUps: result.followUps || [], moduleLabel: result.moduleLabel, moduleIcon: result.moduleIcon, escalate: result.escalate || false };
}

// ─── CHAT BUBBLE COMPONENTS ──────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div style={s.botRow}>
      <div style={s.avatar}>E</div>
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

function BotMessage({ msg, onFollowUp, onTicket }) {
  return (
    <div style={s.botRow}>
      <div style={s.avatar}>E</div>
      <div style={{ maxWidth: "85%" }}>
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

          {msg.escalate && (
            <button style={s.inlineCTA} onClick={onTicket}>
              🎫 Raise a support ticket
            </button>
          )}
        </div>

        {msg.followUps && msg.followUps.length > 0 && (
          <div style={s.followUpWrap}>
            {msg.followUps.slice(0, 3).map((f, i) => (
              <button key={i} style={s.followUpChip} onClick={() => onFollowUp(f)}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#22c55e"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2a2a"}
              >
                {f}
              </button>
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

function TopicMenu({ onSelect, onTicket }) {
  return (
    <div style={s.botRow}>
      <div style={s.avatar}>E</div>
      <div style={{ maxWidth: "90%", width: "100%" }}>
        <div style={{ ...s.bubble, ...s.botBubble }}>
          <p style={s.msgText}>{BOT_PERSONA.greeting}</p>
        </div>
        <div style={s.topicGrid}>
          {KNOWLEDGE_BASE.map((mod) => (
            <button key={mod.id} style={s.topicChip}
              onClick={() => onSelect(mod)}
              onMouseEnter={e => e.currentTarget.style.borderColor = "#22c55e"}
              onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2a2a"}
            >
              {mod.icon} {mod.label}
            </button>
          ))}
        </div>
        <button style={s.escalateChip} onClick={onTicket}>🎫 Raise a support ticket</button>
      </div>
    </div>
  );
}

function SubtopicMenu({ module, onSelect, onBack }) {
  return (
    <div style={s.botRow}>
      <div style={s.avatar}>E</div>
      <div style={{ maxWidth: "90%", width: "100%" }}>
        <div style={{ ...s.bubble, ...s.botBubble }}>
          <p style={s.msgText}>Here's what I can help you with under <strong style={{ color: "#22c55e" }}>{module.icon} {module.label}</strong>:</p>
        </div>
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          {module.subtopics.map((sub) => (
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
        <button style={{ ...s.escalateChip, marginTop: 8 }} onClick={onBack}>← Back to topics</button>
      </div>
    </div>
  );
}

// ─── TICKET FORM ─────────────────────────────────────────────────────────────

function TicketForm({ onClose }) {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [ticketId, setTicketId] = useState("");

  const submit = async () => {
    if (!form.name || !form.email || !form.message) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1200));
    const id = "ET-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    setTicketId(id);
    setLoading(false);
    setDone(true);
  };

  if (done) return (
    <div style={s.ticketSuccess}>
      <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
      <div style={{ color: "#22c55e", fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Ticket Raised!</div>
      <div style={{ color: "#9ca3af", fontSize: 13, lineHeight: 1.6, marginBottom: 4 }}>
        Ticket ID: <strong style={{ color: "#fff" }}>{ticketId}</strong>
      </div>
      <div style={{ color: "#9ca3af", fontSize: 13, marginBottom: 20 }}>
        We'll reply to <strong style={{ color: "#fff" }}>{form.email}</strong> within 24 hours.
      </div>
      <button style={s.backBtn} onClick={onClose}>← Back to chat</button>
    </div>
  );

  return (
    <div style={{ padding: "0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <button style={s.backBtn} onClick={onClose}>←</button>
        <span style={{ color: "#e5e5e5", fontWeight: 700, fontSize: 15 }}>Raise a Support Ticket</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          { k: "name",    label: "Full Name",         type: "text",  ph: "Your name" },
          { k: "email",   label: "Email",             type: "email", ph: "you@company.com" },
          { k: "subject", label: "Subject (optional)", type: "text",  ph: "Brief issue title" },
        ].map(({ k, label, type, ph }) => (
          <div key={k}>
            <div style={s.formLabel}>{label}</div>
            <input type={type} placeholder={ph} value={form[k]}
              onChange={e => setForm({ ...form, [k]: e.target.value })}
              style={s.formInput} />
          </div>
        ))}
        <div>
          <div style={s.formLabel}>Describe your issue</div>
          <textarea rows={4} placeholder="Tell us what's going wrong..."
            value={form.message} onChange={e => setForm({ ...form, message: e.target.value })}
            style={{ ...s.formInput, resize: "vertical", fontFamily: "inherit" }} />
        </div>
        <button style={{ ...s.submitBtn, opacity: loading ? 0.7 : 1 }}
          onClick={submit} disabled={loading}>
          {loading ? "Submitting..." : "Submit Ticket"}
        </button>
      </div>
    </div>
  );
}

// ─── MAIN WIDGET ─────────────────────────────────────────────────────────────

export default function SupportWidget() {
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState([{ id: "init", type: "topics" }]);
  const [input, setInput]       = useState("");
  const [typing, setTyping]     = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [browseModule, setBrowseModule] = useState(null);
  const [unread, setUnread]     = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    if (open) {
      setUnread(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const pushMsg = useCallback((msg) => {
    setMessages((prev) => [...prev, { ...msg, _id: Date.now() + Math.random() }]);
  }, []);

  const handleSend = useCallback(async (text) => {
    const q = (text || input).trim();
    if (!q) return;
    setInput("");
    setBrowseModule(null);

    // Push user message
    pushMsg({ type: "user", text: q });
    setTyping(true);
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
    setTyping(false);

    const intent = detectIntent(q);

    // Greeting
    if (intent === "greeting") {
      pushMsg({ type: "bot", text: "Hey! 👋 What can I help you with today?", followUps: ["How do I complete KYC?", "How do I connect my wallet?", "How do I buy carbon credits?"] });
      return;
    }

    // Thanks
    if (intent === "thanks") {
      pushMsg({ type: "bot", text: "You're welcome! 😊 Let me know if there's anything else I can help with.", followUps: [] });
      return;
    }

    // Escalate
    if (intent === "escalate") {
      setShowTicket(true);
      return;
    }

    // Search KB
    const results = searchKB(q);

    if (results.length === 0) {
      const isFrustrated = intent === "frustration";
      pushMsg({
        type: "bot",
        text: isFrustrated
          ? "I can see you're running into an issue 😟 I don't have a specific answer for that yet, but our support team can help directly."
          : BOT_PERSONA.notFound,
        followUps: ["How do I complete KYC?", "How do I connect my wallet?", "Raise a support ticket"],
        escalate: true,
      });
      return;
    }

    // Best match answer
    const top = results[0];
    pushMsg({
      type:        "bot",
      text:        top.answer,
      steps:       top.steps || [],
      followUps:   top.followUps || [],
      moduleLabel: top.moduleLabel,
      moduleIcon:  top.moduleIcon,
      escalate:    top.escalate || false,
    });

    // If more results, suggest them
    if (results.length > 1) {
      await new Promise((r) => setTimeout(r, 400));
      pushMsg({
        type: "bot",
        text: "You might also find these helpful:",
        followUps: results.slice(1).map((r) => r.question),
      });
    }
  }, [input, pushMsg]);

  const handleTopicSelect = useCallback((mod) => {
    setBrowseModule(mod);
    pushMsg({ type: "subtopics", module: mod });
  }, [pushMsg]);

  const handleSubtopicSelect = useCallback(async (sub, module) => {
    setBrowseModule(null);
    pushMsg({ type: "user", text: sub.question });
    setTyping(true);
    await new Promise((r) => setTimeout(r, 500));
    setTyping(false);
    pushMsg({
      type:        "bot",
      text:        sub.answer,
      steps:       sub.steps || [],
      followUps:   sub.followUps || [],
      moduleLabel: module.label,
      moduleIcon:  module.icon,
      escalate:    sub.escalate || false,
    });
  }, [pushMsg]);

  const handleFollowUp = useCallback((text) => {
    if (text === "Raise a support ticket") { setShowTicket(true); return; }
    handleSend(text);
  }, [handleSend]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const resetChat = () => {
    setMessages([{ id: "init", type: "topics" }]);
    setBrowseModule(null);
    setShowTicket(false);
    setInput("");
  };

  return (
    <>
      {/* Bubble */}
      <button style={{ ...s.bubble_btn, ...(open ? s.bubble_open : {}) }}
        onClick={() => setOpen(o => !o)} aria-label="Support">
        {open ? <span style={{ fontSize: 20 }}>✕</span> : (
          <>
            <span style={{ fontSize: 22 }}>💬</span>
            {unread && <span style={s.ping} />}
          </>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={s.panel}>
          {/* Header */}
          <div style={s.header}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={s.headerAvatar}>E</div>
              <div>
                <div style={s.headerTitle}>{BOT_PERSONA.name} · EtherTrack Support</div>
                <div style={s.headerSub}><span style={s.onlineDot} /> Online · Usually replies instantly</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button style={s.hdrBtn} onClick={resetChat} title="New chat">↺</button>
              <button style={s.hdrBtn} onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>

          {/* Body */}
          <div style={s.body}>
            {showTicket ? (
              <TicketForm onClose={() => setShowTicket(false)} />
            ) : (
              <>
                {messages.map((msg, i) => {
                  if (msg.type === "topics") return (
                    <TopicMenu key={i} onSelect={handleTopicSelect} onTicket={() => setShowTicket(true)} />
                  );
                  if (msg.type === "subtopics") return (
                    <SubtopicMenu key={i} module={msg.module}
                      onSelect={handleSubtopicSelect}
                      onBack={() => pushMsg({ type: "topics" })} />
                  );
                  if (msg.type === "user") return <UserMessage key={i} text={msg.text} />;
                  if (msg.type === "bot")  return (
                    <BotMessage key={i} msg={msg}
                      onFollowUp={handleFollowUp}
                      onTicket={() => setShowTicket(true)} />
                  );
                  return null;
                })}
                {typing && <TypingIndicator />}
                <div ref={bottomRef} />
              </>
            )}
          </div>

          {/* Input */}
          {!showTicket && (
            <div style={s.inputWrap}>
              <input
                ref={inputRef}
                style={s.input}
                placeholder="Ask me anything about EtherTrack..."
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button style={{ ...s.sendBtn, opacity: input.trim() ? 1 : 0.4 }}
                onClick={() => handleSend()} disabled={!input.trim()}>
                ➤
              </button>
            </div>
          )}

          <div style={s.footer}>Powered by <strong>EtherTrack</strong> · Built by Ethi 🌿</div>
        </div>
      )}

      <style>{`
        @keyframes et-blink { 0%,80%,100%{opacity:0.2;transform:scale(0.8)} 40%{opacity:1;transform:scale(1)} }
        @keyframes et-ping   { 0%{transform:scale(1);opacity:1} 100%{transform:scale(2.2);opacity:0} }
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
    transition: "transform 0.2s",
  },
  bubble_open: { background: "#1c1c1c", boxShadow: "0 4px 20px rgba(0,0,0,0.5)" },
  ping: {
    position: "absolute", top: 8, right: 8,
    width: 10, height: 10, borderRadius: "50%",
    background: "#22c55e", boxShadow: "0 0 0 2px #111",
    animation: "et-ping 1.5s ease-out infinite",
  },
  panel: {
    position: "fixed", bottom: 100, right: 28,
    width: 370, maxHeight: 580,
    borderRadius: 18, background: "#111",
    border: "1px solid #1e1e1e",
    boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
    zIndex: 9998, display: "flex", flexDirection: "column",
    overflow: "hidden", fontFamily: "'Inter','Segoe UI',sans-serif",
  },
  header: {
    background: "linear-gradient(135deg,#14532d,#166534)",
    padding: "14px 16px",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    flexShrink: 0,
  },
  headerAvatar: {
    width: 38, height: 38, borderRadius: 10,
    background: "#22c55e", color: "#fff",
    fontWeight: 800, fontSize: 16,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  headerTitle: { color: "#fff", fontWeight: 700, fontSize: 14 },
  headerSub:   { color: "#86efac", fontSize: 11, display: "flex", alignItems: "center", gap: 5, marginTop: 2 },
  onlineDot:   { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#4ade80" },
  hdrBtn: {
    background: "transparent", border: "none",
    color: "#86efac", fontSize: 16, cursor: "pointer",
    padding: "4px 8px", borderRadius: 6,
  },
  body: {
    flex: 1, overflowY: "auto", padding: "16px 14px",
    display: "flex", flexDirection: "column", gap: 14,
    scrollbarWidth: "thin", scrollbarColor: "#2a2a2a transparent",
  },
  botRow:   { display: "flex", alignItems: "flex-start", gap: 8 },
  userRow:  { display: "flex", justifyContent: "flex-end" },
  avatar: {
    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
    background: "#166534", color: "#86efac",
    fontWeight: 800, fontSize: 12,
    display: "flex", alignItems: "center", justifyContent: "center",
    marginTop: 2,
  },
  bubble: { borderRadius: 12, padding: "10px 14px", maxWidth: "100%" },
  botBubble:  { background: "#1a1a1a", border: "1px solid #242424" },
  userBubble: { background: "linear-gradient(135deg,#166534,#15803d)", maxWidth: "80%" },
  msgMeta: { color: "#22c55e", fontSize: 10, fontWeight: 600, marginBottom: 4, letterSpacing: 0.5 },
  msgText: { color: "#d1d5db", fontSize: 13, lineHeight: 1.65, margin: 0 },
  stepsWrap: { marginTop: 10, display: "flex", flexDirection: "column", gap: 7 },
  stepRow:   { display: "flex", alignItems: "flex-start", gap: 8 },
  stepNum: {
    width: 20, height: 20, borderRadius: 6, flexShrink: 0,
    background: "#14532d", color: "#22c55e",
    fontSize: 10, fontWeight: 800,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  stepText: { color: "#9ca3af", fontSize: 12, lineHeight: 1.6, paddingTop: 2 },
  inlineCTA: {
    marginTop: 12, width: "100%", padding: "9px 12px",
    background: "#14532d", border: "1px solid #22c55e33",
    borderRadius: 8, color: "#22c55e", fontSize: 12,
    fontWeight: 600, cursor: "pointer", textAlign: "center",
  },
  followUpWrap: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, paddingLeft: 36 },
  followUpChip: {
    padding: "5px 10px",
    background: "#161616", border: "1px solid #2a2a2a",
    borderRadius: 20, color: "#9ca3af", fontSize: 11,
    cursor: "pointer", transition: "border-color 0.15s",
    whiteSpace: "nowrap",
  },
  topicGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7, marginTop: 10 },
  topicChip: {
    padding: "9px 10px", background: "#161616",
    border: "1px solid #2a2a2a", borderRadius: 10,
    color: "#d1d5db", fontSize: 12, fontWeight: 600,
    cursor: "pointer", textAlign: "left",
    transition: "border-color 0.15s",
  },
  subChip: {
    width: "100%", padding: "10px 14px",
    background: "#161616", border: "1px solid #2a2a2a",
    borderRadius: 10, color: "#d1d5db", fontSize: 12,
    cursor: "pointer", display: "flex",
    alignItems: "center", justifyContent: "space-between",
    textAlign: "left", transition: "border-color 0.15s",
  },
  escalateChip: {
    marginTop: 8, width: "100%", padding: "9px 12px",
    background: "#161616", border: "1px solid #2a2a2a",
    borderRadius: 10, color: "#86efac", fontSize: 12,
    fontWeight: 600, cursor: "pointer", textAlign: "center",
  },
  typing:  { display: "flex", gap: 4, alignItems: "center", height: 16 },
  dot: {
    width: 7, height: 7, borderRadius: "50%", background: "#22c55e",
    display: "inline-block",
    animation: "et-blink 1.2s ease-in-out infinite",
  },
  inputWrap: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "10px 14px", borderTop: "1px solid #1a1a1a",
    background: "#111", flexShrink: 0,
  },
  input: {
    flex: 1, background: "#1a1a1a",
    border: "1px solid #2a2a2a", borderRadius: 10,
    padding: "9px 13px", color: "#e5e5e5",
    fontSize: 13, outline: "none",
    fontFamily: "inherit",
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
    background: "linear-gradient(135deg,#16a34a,#15803d)",
    border: "none", color: "#fff", fontSize: 14,
    cursor: "pointer", display: "flex",
    alignItems: "center", justifyContent: "center",
  },
  footer: {
    padding: "8px 14px", borderTop: "1px solid #161616",
    color: "#333", fontSize: 10, textAlign: "center", flexShrink: 0,
  },
  // Ticket
  ticketSuccess: { textAlign: "center", padding: "32px 16px" },
  formLabel: { color: "#6b7280", fontSize: 11, fontWeight: 600, marginBottom: 5 },
  formInput: {
    width: "100%", background: "#1a1a1a",
    border: "1px solid #2a2a2a", borderRadius: 8,
    padding: "9px 12px", color: "#e5e5e5",
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