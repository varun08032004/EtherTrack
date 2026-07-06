// services/emailQueue.js — EtherTrack · In-memory email queue (zero Redis commands)
// Replaces BullMQ to stay within Upstash free tier on testnet.
// Retries up to 3x with exponential backoff. Jobs survive process restart
// via a lightweight JSON file journal (no Redis needed).
'use strict';

const nodemailer = require('nodemailer');
const logger     = require('./logger');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');

// ── Journal file (survives restarts, no Redis) ────────────────────────────────
// On production swap this path to a persistent volume, or just remove journaling
// entirely if you're OK losing in-flight emails on restart (fine for testnet).
const JOURNAL_PATH = path.join(__dirname, '../data/email-queue.json');
const USE_JOURNAL  = process.env.EMAIL_QUEUE_JOURNAL !== 'false';

// ── From addresses ────────────────────────────────────────────────────────────
const SUPPORT_FROM = process.env.SMTP_SUPPORT_FROM || 'support@ethertrack.in';
const ADMIN_FROM   = process.env.SMTP_ADMIN_FROM   || 'admin@ethertrack.in';
const ADMIN_TEMPLATES = new Set(['kyc-admin-new']);

// ── Nodemailer transport ──────────────────────────────────────────────────────
const createTransport = () => nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  pool:           true,
  maxConnections: 3,
  maxMessages:    100,
  rateDelta:      1000,
  rateLimit:      5,
});

let transport = null;
const getTransport = () => { if (!transport) transport = createTransport(); return transport; };

// ── HTML email templates ──────────────────────────────────────────────────────
const TEMPLATES = {
  'kyc-submitted': ({ fullName, submissionId }) => ({
    subject: 'EtherTrack — KYC Submission Received',
    html: `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#080c0a;font-family:'Courier New',monospace">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#0a0f0c;border:1px solid #0f2a1a;border-radius:12px;overflow:hidden">
  <tr><td style="background:linear-gradient(135deg,#0d2e1f,#0a1f15);padding:32px 36px;border-bottom:1px solid #0f2a1a">
    <div style="font-size:10px;color:#4ade8044;letter-spacing:.15em;margin-bottom:6px">ETHERTRACK · KYC</div>
    <div style="font-size:22px;font-weight:700;color:#22c55e">KYC Submitted ✅</div>
  </td></tr>
  <tr><td style="padding:32px 36px;color:#86efac88;font-size:13px;line-height:1.8">
    <p style="margin:0 0 16px">Hi <strong style="color:#f0fdf4">${fullName}</strong>,</p>
    <p style="margin:0 0 16px">We've received your KYC submission. Our compliance team will review your details within <strong style="color:#facc15">1–2 business days</strong>.</p>
    <div style="background:#060a07;border:1px solid #0f2a1a;border-radius:8px;padding:16px;margin:20px 0">
      <div style="font-size:10px;color:#4ade8044;letter-spacing:.12em;margin-bottom:4px">SUBMISSION ID</div>
      <div style="font-size:13px;color:#22c55e;font-family:'Courier New',monospace">${submissionId}</div>
    </div>
    <p style="margin:0 0 16px">You'll receive another email once your KYC is approved and your account is fully activated.</p>
    <p style="margin:0;font-size:10px;color:#4ade8033">EtherTrack · Carbon Credit Exchange · Do not reply to this email</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
  }),

  'kyc-approved': ({ fullName, tier, dashboardUrl }) => ({
    subject: 'EtherTrack — KYC Approved 🎉',
    html: `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#080c0a;font-family:'Courier New',monospace">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#0a0f0c;border:1px solid #0f2a1a;border-radius:12px;overflow:hidden">
  <tr><td style="background:linear-gradient(135deg,#0d2e1f,#052e16);padding:32px 36px;border-bottom:1px solid #22c55e22">
    <div style="font-size:10px;color:#4ade8044;letter-spacing:.15em;margin-bottom:6px">ETHERTRACK · KYC</div>
    <div style="font-size:22px;font-weight:700;color:#22c55e">KYC Approved 🎉</div>
  </td></tr>
  <tr><td style="padding:32px 36px;color:#86efac88;font-size:13px;line-height:1.8">
    <p style="margin:0 0 16px">Hi <strong style="color:#f0fdf4">${fullName}</strong>,</p>
    <p style="margin:0 0 16px">Your KYC has been <strong style="color:#22c55e">approved</strong>! Your account is now fully activated at tier <strong style="color:#facc15">${tier.toUpperCase()}</strong>.</p>
    <p style="margin:0 0 8px;color:#f0fdf4">You can now:</p>
    <ul style="margin:0 0 24px;padding-left:20px;color:#86efac88">
      <li style="margin-bottom:6px">List and trade carbon credits</li>
      <li style="margin-bottom:6px">Track emissions and offsets</li>
      <li style="margin-bottom:6px">Manage your full portfolio</li>
    </ul>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:linear-gradient(135deg,#16a34a,#15803d);border-radius:8px;padding:14px 28px">
      <a href="${dashboardUrl}" style="color:#fff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:.08em">Go to Dashboard →</a>
    </td></tr></table>
    <p style="margin:24px 0 0;font-size:10px;color:#4ade8033">EtherTrack · Carbon Credit Exchange · Do not reply to this email</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
  }),

  'kyc-rejected': ({ fullName, reason, resubmitUrl }) => ({
    subject: 'EtherTrack — KYC Requires Resubmission',
    html: `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#080c0a;font-family:'Courier New',monospace">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#0a0f0c;border:1px solid #0f2a1a;border-radius:12px;overflow:hidden">
  <tr><td style="background:linear-gradient(135deg,#1a0a0a,#0f0606);padding:32px 36px;border-bottom:1px solid #f8717122">
    <div style="font-size:10px;color:#f8717144;letter-spacing:.15em;margin-bottom:6px">ETHERTRACK · KYC</div>
    <div style="font-size:22px;font-weight:700;color:#f87171">Resubmission Required</div>
  </td></tr>
  <tr><td style="padding:32px 36px;color:#86efac88;font-size:13px;line-height:1.8">
    <p style="margin:0 0 16px">Hi <strong style="color:#f0fdf4">${fullName}</strong>,</p>
    <p style="margin:0 0 16px">Your KYC submission could not be approved. Please review the reason below and resubmit with the correct information.</p>
    <div style="background:#1a0808;border:1px solid #f8717122;border-radius:8px;padding:16px;margin:20px 0">
      <div style="font-size:10px;color:#f8717144;letter-spacing:.12em;margin-bottom:8px">REASON</div>
      <div style="font-size:12px;color:#f87171;line-height:1.7">${reason}</div>
    </div>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:linear-gradient(135deg,#16a34a,#15803d);border-radius:8px;padding:14px 28px">
      <a href="${resubmitUrl}" style="color:#fff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:.08em">Resubmit KYC →</a>
    </td></tr></table>
    <p style="margin:24px 0 0;font-size:10px;color:#4ade8033">EtherTrack · Carbon Credit Exchange · Do not reply to this email</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
  }),

  'kyc-admin-new': ({ userEmail, fullName, idType, submissionId, submittedAt, adminUrl }) => ({
    subject: `[EtherTrack Admin] New KYC — ${fullName}`,
    html: `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#080c0a;font-family:'Courier New',monospace">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#0a0f0c;border:1px solid #0f2a1a;border-radius:12px;overflow:hidden">
  <tr><td style="background:linear-gradient(135deg,#1a1200,#0f0d00);padding:32px 36px;border-bottom:1px solid #facc1522">
    <div style="font-size:10px;color:#facc1544;letter-spacing:.15em;margin-bottom:6px">ETHERTRACK · ADMIN ALERT</div>
    <div style="font-size:20px;font-weight:700;color:#facc15">New KYC Submission</div>
  </td></tr>
  <tr><td style="padding:32px 36px;color:#86efac88;font-size:13px;line-height:1.8">
    ${[
      ['User email',    userEmail],
      ['Full name',     fullName],
      ['ID type',       idType],
      ['Submission ID', submissionId],
      ['Submitted at',  submittedAt],
    ].map(([label, value]) => `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #0f2a1a">
      <span style="font-size:10px;color:#4ade8044;letter-spacing:.1em">${label.toUpperCase()}</span>
      <span style="font-size:12px;color:#f0fdf4">${value}</span>
    </div>`).join('')}
    <div style="margin-top:24px">
      <table cellpadding="0" cellspacing="0"><tr><td style="background:linear-gradient(135deg,#16a34a,#15803d);border-radius:8px;padding:14px 28px">
        <a href="${adminUrl}" style="color:#fff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:.08em">Review in Admin Panel →</a>
      </td></tr></table>
    </div>
    <p style="margin:24px 0 0;font-size:10px;color:#4ade8033">EtherTrack · Internal admin notification</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
  }),
};

// ── In-memory queue ───────────────────────────────────────────────────────────
// Simple FIFO array. Zero Redis commands. Retries with exponential backoff.
const queue   = [];   // { id, to, template, data, attempts, nextRetry, enqueuedAt }
let isRunning = false;
let workerTimer = null;

const MAX_ATTEMPTS    = 3;
const BACKOFF_BASE_MS = 30_000;  // 30s, 60s, 120s
const POLL_INTERVAL_MS = process.env.NODE_ENV === 'production' ? 5_000 : 10_000;

// ── Journal helpers (optional, keeps queue across restarts) ───────────────────
const ensureDataDir = () => {
  const dir = path.dirname(JOURNAL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const saveJournal = () => {
  if (!USE_JOURNAL) return;
  try {
    ensureDataDir();
    fs.writeFileSync(JOURNAL_PATH, JSON.stringify(queue, null, 2));
  } catch (e) {
    logger.warn({ err: e.message }, 'emailQueue.journal_write_failed');
  }
};

const loadJournal = () => {
  if (!USE_JOURNAL) return;
  try {
    if (!fs.existsSync(JOURNAL_PATH)) return;
    const raw = fs.readFileSync(JOURNAL_PATH, 'utf8');
    const saved = JSON.parse(raw);
    // Re-queue pending/failed jobs that haven't exhausted retries
    for (const job of saved) {
      if (job.attempts < MAX_ATTEMPTS) {
        job.nextRetry = Date.now(); // retry immediately on restart
        queue.push(job);
      }
    }
    if (queue.length > 0) {
      logger.info({ count: queue.length }, 'emailQueue.journal_restored');
    }
    fs.unlinkSync(JOURNAL_PATH); // clear journal; will rewrite on next save
  } catch (e) {
    logger.warn({ err: e.message }, 'emailQueue.journal_load_failed');
  }
};

// ── Core send logic ───────────────────────────────────────────────────────────
const sendNow = async (job) => {
  const tmplFn = TEMPLATES[job.template];
  if (!tmplFn) throw new Error(`Unknown email template: ${job.template}`);

  const { subject, html } = tmplFn(job.data);
  const from = ADMIN_TEMPLATES.has(job.template)
    ? `"EtherTrack Admin" <${ADMIN_FROM}>`
    : `"EtherTrack" <${SUPPORT_FROM}>`;

  await getTransport().sendMail({
    from, to: job.to, subject, html,
    headers: { 'X-Mailer': 'EtherTrack v2', 'X-Job-ID': job.id, 'X-Template': job.template },
  });
};

// ── Worker loop ───────────────────────────────────────────────────────────────
const tick = async () => {
  if (isRunning) return;
  const now = Date.now();

  // Find jobs ready to process (not currently running, retry time reached)
  const ready = queue.filter(j => !j.running && j.nextRetry <= now);
  if (ready.length === 0) return;

  isRunning = true;
  try {
    // Process up to 3 at a time (concurrency cap without Redis limiter overhead)
    const batch = ready.slice(0, 3);
    await Promise.allSettled(batch.map(async (job) => {
      job.running = true;
      job.attempts += 1;
      try {
        await sendNow(job);
        logger.info(
          { jobId: job.id, template: job.template, attempt: job.attempts },
          'email.sent'
        );
        // Remove from queue on success
        const idx = queue.indexOf(job);
        if (idx !== -1) queue.splice(idx, 1);
      } catch (err) {
        job.running = false;
        if (job.attempts >= MAX_ATTEMPTS) {
          logger.error(
            { jobId: job.id, template: job.template, attempts: job.attempts, err: err.message },
            'email.job_failed_permanent'
          );
          const idx = queue.indexOf(job);
          if (idx !== -1) queue.splice(idx, 1); // drop it after max retries
        } else {
          const delay = BACKOFF_BASE_MS * Math.pow(2, job.attempts - 1);
          job.nextRetry = Date.now() + delay;
          logger.warn(
            { jobId: job.id, template: job.template, attempt: job.attempts, nextRetryMs: delay },
            'email.job_retrying'
          );
        }
      }
    }));
  } finally {
    isRunning = false;
    saveJournal();
  }
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enqueue an email. Same interface as old BullMQ version.
 * @param {{ to: string, template: string, data: object }} opts
 * @returns {string} jobId
 */
const enqueueEmail = async ({ to, template, data }) => {
  if (!to || !template) throw new Error('enqueueEmail: to and template are required');

  const job = {
    id:          `email-${template}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    to,
    template,
    data,
    attempts:    0,
    nextRetry:   Date.now(), // process immediately
    enqueuedAt:  new Date().toISOString(),
    running:     false,
  };

  queue.push(job);
  saveJournal();
  logger.info(
    { jobId: job.id, template, to: to.replace(/(.{2}).*(@)/, '$1***$2') },
    'email.enqueued'
  );

  // Kick the worker immediately instead of waiting for next poll
  setImmediate(tick);
  return job.id;
};

/**
 * Start the background worker loop.
 * Call once at app startup (replaces startEmailWorker + attachQueueMonitoring).
 */
const startEmailWorker = () => {
  loadJournal(); // restore any jobs from last run
  workerTimer = setInterval(tick, POLL_INTERVAL_MS);
  // Ensure timer doesn't block process exit
  if (workerTimer.unref) workerTimer.unref();
  logger.info({ pollIntervalMs: POLL_INTERVAL_MS }, 'email.worker_started (in-memory, zero Redis)');
  return { stop: () => clearInterval(workerTimer) };
};

/**
 * No-op — kept for API compatibility with old code that calls attachQueueMonitoring().
 */
const attachQueueMonitoring = () => {
  logger.info('email.monitoring: in-memory queue (no QueueEvents needed)');
  return { close: () => {} };
};

/**
 * Expose queue state for admin/debug endpoints.
 */
const getQueueStats = () => ({
  pending:  queue.filter(j => !j.running).length,
  running:  queue.filter(j =>  j.running).length,
  total:    queue.length,
});

// Flush journal on clean shutdown
process.on('SIGTERM', saveJournal);
process.on('SIGINT',  saveJournal);

module.exports = { enqueueEmail, startEmailWorker, attachQueueMonitoring, getQueueStats };