/**
 * utils/toast.js
 *
 * Lightweight toast utility — no external library.
 * Matches the dark green carbon-exchange theme.
 *
 * Usage:
 *   import { showToast } from "../utils/toast";
 *   showToast("✅ Account created!", "success");
 *   showToast("⚠ Sync failed.", "warning");
 *   showToast("Something went wrong.", "error");
 */

const STYLES = {
  base: `
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%) translateY(0);
    z-index: 99999;
    font-family: 'DM Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.06em;
    padding: 12px 20px;
    border-radius: 8px;
    border: 1px solid;
    max-width: 90vw;
    white-space: nowrap;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    opacity: 0;
    transition: opacity 0.25s ease, transform 0.25s ease;
    pointer-events: none;
  `,
  success: `background:#0d2e1f;border-color:#16a34a44;color:#22c55e;`,
  warning: `background:#1c1a09;border-color:#facc1544;color:#facc15;`,
  error:   `background:#450a0a;border-color:#dc262644;color:#f87171;`,
};

let currentToast = null;

export const showToast = (message, type = "success", duration = 3500) => {
  // Remove existing toast if any
  if (currentToast) {
    currentToast.remove();
    currentToast = null;
  }

  const el = document.createElement("div");
  el.style.cssText = STYLES.base + STYLES[type] || STYLES.success;
  el.textContent = message;
  document.body.appendChild(el);
  currentToast = el;

  // Animate in
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateX(-50%) translateY(-4px)";
  });

  // Animate out and remove
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateX(-50%) translateY(4px)";
    setTimeout(() => {
      if (el.parentNode) el.remove();
      if (currentToast === el) currentToast = null;
    }, 280);
  }, duration);
};