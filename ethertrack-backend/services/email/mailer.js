// services/email/mailer.js — EtherTrack
// Transport: Resend API. Reliability: in-memory retry queue + disk journal.
// Exposes compat shims (sendEmail, enqueueEmail, generateOTP) so existing
// call sites in auth.js / admin.js / kyc.js / invoice.js / cron/jobs.js can
// switch imports without rewriting every call.
'use strict';

const { Resend } = require('resend');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const logger = require('../logger'); // adjust path to your real logger if different

const { FROM, TEMPLATE_CATEGORY, IMMEDIATE_TEMPLATES } = require('./config');
const { TEMPLATES } = require('./templates');
const { safeQuery: dbQuery } = require('../../db/pool');

// ── Unsubscribe (informational emails only — never for security/transactional) ─
// Templates here are the ONLY ones a user can opt out of. Everything else
// (KYC, security, money movement, approvals) is transactional and always
// sends — Gmail/Yahoo's one-click-unsubscribe rules explicitly exempt
// transactional mail, and a user shouldn't be able to "opt out" of knowing
// their withdrawal failed.
const INFORMATIONAL_TEMPLATES = new Set([
  'platform-announcement',
]);

const UNSUB_SECRET = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || 'change-me-unsubscribe-secret';
if (!process.env.UNSUBSCRIBE_SECRET && !process.env.JWT_SECRET) {
  console.warn('[email] UNSUBSCRIBE_SECRET not set — falling back to a default. Set this in production.');
}

const generateUnsubscribeToken = (email) =>
  crypto.createHmac('sha256', UNSUB_SECRET).update(email.toLowerCase()).digest('hex').slice(0, 32);

const verifyUnsubscribeToken = (email, token) =>
  generateUnsubscribeToken(email) === token;

const buildUnsubscribeUrl = (email) => {
  const token = generateUnsubscribeToken(email);
  return `${process.env.BACKEND_URL || process.env.FRONTEND_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
};

const isUnsubscribed = async (email) => {
  try {
    const { rows } = await dbQuery('SELECT marketing_emails_enabled FROM users WHERE email=$1', [email]);
    return rows[0]?.marketing_emails_enabled === false;
  } catch (e) {
    console.warn('[email] preference check failed, sending anyway:', e.message);
    return false; // fail open — don't block a send over a DB hiccup
  }
};

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Journal (survives restarts, zero Redis) ───────────────────────────────────
const JOURNAL_PATH = path.join(__dirname, 'data', 'email-queue.json');
const USE_JOURNAL   = process.env.EMAIL_QUEUE_JOURNAL !== 'false';

const MAX_ATTEMPTS     = 3;
const BACKOFF_BASE_MS  = 30_000; // 30s, 60s, 120s
const POLL_INTERVAL_MS = process.env.NODE_ENV === 'production' ? 5_000 : 10_000;

const queue = []; // { id, to, template?, data?, subject?, html?, attachments, attempts, nextRetry, running, enqueuedAt }
let isRunning = false;
let workerTimer = null;

const ensureDataDir = () => {
  const dir = path.dirname(JOURNAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const saveJournal = () => {
  if (!USE_JOURNAL) return;
  try {
    ensureDataDir();
    // Attachments (Buffers) aren't journaled — too large / not JSON-safe.
    // Best-effort on restart (fine for our volumes; direct sendEmail() calls
    // with attachments are never queued anyway, see sendEmailCompat below).
    const safe = queue.map(({ attachments, ...rest }) => rest);
    fs.writeFileSync(JOURNAL_PATH, JSON.stringify(safe, null, 2));
  } catch (e) {
    logger.warn({ err: e.message }, 'emailQueue.journal_write_failed');
  }
};

const loadJournal = () => {
  if (!USE_JOURNAL) return;
  try {
    if (!fs.existsSync(JOURNAL_PATH)) return;
    const saved = JSON.parse(fs.readFileSync(JOURNAL_PATH, 'utf8'));
    for (const job of saved) {
      if (job.attempts < MAX_ATTEMPTS) {
        job.nextRetry = Date.now();
        job.running = false;
        queue.push(job);
      }
    }
    if (queue.length) logger.info({ count: queue.length }, 'emailQueue.journal_restored');
    fs.unlinkSync(JOURNAL_PATH);
  } catch (e) {
    logger.warn({ err: e.message }, 'emailQueue.journal_load_failed');
  }
};

const buildAttachments = (attachments) => (attachments || []).map(a => ({
  filename: a.filename,
  content: Buffer.isBuffer(a.content) ? a.content.toString('base64') : a.content,
}));

// Naive HTML->text fallback. Not pretty, but real inboxes and spam filters
// score multipart/alternative (html + text) noticeably better than html-only.
const htmlToText = (html) => html
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(p|div|tr|td|table)>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

// ── Build + send a single job via Resend ──────────────────────────────────────
// Supports two job shapes:
//  (a) templated:  { template, to, data, attachments }
//  (b) raw html:   { to, subject, html, attachments, category } — for the
//      compat sendEmail() shim used by call sites not yet migrated to templates
const sendNow = async (job) => {
  let subject, html, category;
  const isInformational = job.template && INFORMATIONAL_TEMPLATES.has(job.template);

  if (isInformational) {
    const skip = await isUnsubscribed(job.to);
    if (skip) {
      logger.info({ template: job.template, to: maskEmail(job.to) }, 'email.skipped_unsubscribed');
      return;
    }
  }

  if (job.template) {
    const tmplFn = TEMPLATES[job.template];
    if (!tmplFn) throw new Error(`Unknown email template: ${job.template}`);
    const data = isInformational
      ? { ...job.data, unsubscribeUrl: buildUnsubscribeUrl(job.to) }
      : job.data;
    ({ subject, html } = tmplFn(data || {}));
    category = TEMPLATE_CATEGORY[job.template] || 'support';
  } else {
    subject = job.subject;
    html = job.html;
    category = job.category || 'support';
  }

  const payload = { from: FROM[category] || FROM.support, to: job.to, subject, html, text: htmlToText(html) };
  if (job.attachments?.length) payload.attachments = buildAttachments(job.attachments);

  if (isInformational) {
    const unsubUrl = buildUnsubscribeUrl(job.to);
    payload.headers = {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  const { error } = await resend.emails.send(payload);
  if (error) throw new Error(typeof error === 'string' ? error : JSON.stringify(error));
};

// ── Worker loop ────────────────────────────────────────────────────────────────
const tick = async () => {
  if (isRunning) return;
  const now = Date.now();
  const ready = queue.filter(j => !j.running && j.nextRetry <= now);
  if (!ready.length) return;

  isRunning = true;
  try {
    const batch = ready.slice(0, 3); // concurrency cap, no Redis limiter needed
    await Promise.allSettled(batch.map(async (job) => {
      job.running = true;
      job.attempts += 1;
      try {
        await sendNow(job);
        logger.info({ jobId: job.id, template: job.template, attempt: job.attempts }, 'email.sent');
        const idx = queue.indexOf(job);
        if (idx !== -1) queue.splice(idx, 1);
      } catch (err) {
        job.running = false;
        if (job.attempts >= MAX_ATTEMPTS) {
          logger.error({ jobId: job.id, template: job.template, attempts: job.attempts, err: err.message }, 'email.job_failed_permanent');
          const idx = queue.indexOf(job);
          if (idx !== -1) queue.splice(idx, 1);
        } else {
          const delay = BACKOFF_BASE_MS * Math.pow(2, job.attempts - 1);
          job.nextRetry = Date.now() + delay;
          logger.warn({ jobId: job.id, template: job.template, attempt: job.attempts, nextRetryMs: delay }, 'email.job_retrying');
        }
      }
    }));
  } finally {
    isRunning = false;
    saveJournal();
  }
};

const maskEmail = (email) => String(email).replace(/(.{2}).*(@)/, '$1***$2');

const enqueue = (job) => {
  queue.push(job);
  saveJournal();
  logger.info({ jobId: job.id, template: job.template, to: maskEmail(job.to) }, 'email.enqueued');
  setImmediate(tick);
  return job.id;
};

// ── Public API (new code should use this) ──────────────────────────────────────

/**
 * Send a templated email. Queued with retry+backoff by default;
 * 'verify-account' (OTP) sends immediately since the user is waiting live.
 */
const send = async (template, to, data = {}, opts = {}) => {
  if (!TEMPLATES[template]) throw new Error(`send(): unknown template "${template}"`);
  if (!to) throw new Error('send(): "to" is required');

  const forceImmediate = opts.immediate ?? IMMEDIATE_TEMPLATES.has(template);
  const job = {
    id: `email-${template}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    to, template, data, attachments: opts.attachments,
    attempts: 0, nextRetry: Date.now(), enqueuedAt: new Date().toISOString(), running: false,
  };

  if (forceImmediate) {
    await sendNow(job);
    logger.info({ template, to: maskEmail(to) }, 'email.sent_immediate');
    return;
  }
  return enqueue(job);
};

// ── Compat shims — drop-in for old services/email.js and services/emailQueue.js ─

/**
 * Compat for services/emailQueue.js's enqueueEmail({ to, subject, template, data }).
 * kyc.js calls this exact shape — no changes needed there.
 */
const enqueueEmail = async ({ to, template, data, attachments }) => {
  if (!to || !template) throw new Error('enqueueEmail: to and template are required');
  return send(template, to, data, { attachments });
};

/**
 * Compat for services/email.js's sendEmail({ to, subject, html, attachments, isAdmin }).
 * For call sites still using raw HTML (admin.js, cron/jobs.js, invoice.js) that
 * haven't been migrated to a named template yet. Sends immediately + with
 * attachments since these are usually PDF invoices the user is waiting on.
 * NOTE: this bypasses the FROM-address-by-category routing since there's no
 * template key to look up — pass { category: 'billing' | 'sales' | 'admin' }
 * explicitly in opts if it's not a support@ email.
 */
const sendEmail = async ({ to, subject, html, attachments, category = 'support' }) => {
  await sendNow({ to, subject, html, attachments, category });
};

const startEmailWorker = () => {
  loadJournal();
  workerTimer = setInterval(tick, POLL_INTERVAL_MS);
  if (workerTimer.unref) workerTimer.unref();
  logger.info({ pollIntervalMs: POLL_INTERVAL_MS }, 'email.worker_started');
  return { stop: () => clearInterval(workerTimer) };
};

const getQueueStats = () => ({
  pending: queue.filter(j => !j.running).length,
  running: queue.filter(j =>  j.running).length,
  total: queue.length,
});

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

process.on('SIGTERM', saveJournal);
process.on('SIGINT', saveJournal);

module.exports = {
  send, enqueueEmail, sendEmail,
  startEmailWorker, getQueueStats, generateOTP,
  verifyUnsubscribeToken, INFORMATIONAL_TEMPLATES,
};