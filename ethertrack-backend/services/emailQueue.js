// services/emailQueue.js — EtherTrack · Async email queue via BullMQ - 08/06/2026
'use strict';

const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis    = require('ioredis');
const nodemailer = require('nodemailer');
const logger     = require('./logger');

// ── Redis connection for BullMQ ───────────────────────────────────────────────
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null, // required by BullMQ
  tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
});

connection.on('connect', () => console.log('[emailQueue] ✅ Redis connected'));
connection.on('error',   (e) => console.warn('[emailQueue] Redis error:', e.message));

// ── From addresses ────────────────────────────────────────────────────────────
const SUPPORT_FROM = process.env.SMTP_SUPPORT_FROM || 'support@ethertrack.in';
const ADMIN_FROM   = process.env.SMTP_ADMIN_FROM   || 'admin@ethertrack.in';

// Templates that go from admin@ethertrack.in
const ADMIN_TEMPLATES = new Set(['kyc-admin-new']);

// ── Queue definition ──────────────────────────────────────────────────────────
const EMAIL_QUEUE_NAME = 'ethertrack-emails';

const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts:    3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 500 },
    removeOnFail:     { count: 200 },
  },
});

// ── Nodemailer transport ──────────────────────────────────────────────────────
const createTransport = () => nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  pool:           true,
  maxConnections: 5,
  maxMessages:    100,
  rateDelta:      1000,
  rateLimit:      10,
});

let transport = null;
const getTransport = () => {
  if (!transport) transport = createTransport();
  return transport;
};

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

// ── Enqueue helper ────────────────────────────────────────────────────────────
const enqueueEmail = async ({ to, subject, template, data }) => {
  if (!to || !template) throw new Error('enqueueEmail: to and template are required');
  const jobData = { to, subject, template, data, enqueuedAt: new Date().toISOString() };
  const job = await emailQueue.add(`email:${template}`, jobData, {
    jobId: `email-${template}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  logger.info({ jobId: job.id, template, to: to.replace(/(.{2}).*(@)/, '$1***$2') }, 'email.enqueued');
  return job.id;
};

// ── Worker ────────────────────────────────────────────────────────────────────
const startEmailWorker = () => {
  const worker = new Worker(
    EMAIL_QUEUE_NAME,
    async (job) => {
      const { to, template, data } = job.data;
      const tmplFn = TEMPLATES[template];
      if (!tmplFn) throw new Error(`Unknown email template: ${template}`);
      const { subject, html } = tmplFn(data);

      const from = ADMIN_TEMPLATES.has(template)
        ? `"EtherTrack Admin" <${ADMIN_FROM}>`
        : `"EtherTrack" <${SUPPORT_FROM}>`;

      const t = getTransport();
      await t.sendMail({
        from,
        to,
        subject,
        html,
        headers: {
          'X-Mailer':   'EtherTrack v2',
          'X-Job-ID':   job.id,
          'X-Template': template,
        },
      });
      logger.info({ jobId: job.id, template, attempt: job.attemptsMade + 1 }, 'email.sent');
    },
    {
      connection,
      concurrency: 5,
      limiter: { max: 10, duration: 1000 },
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, template: job?.data?.template, attempt: job?.attemptsMade, err },
      'email.job_failed'
    );
  });
  worker.on('error', (err) => logger.error({ err }, 'email.worker_error'));
  logger.info('email.worker_started');
  return worker;
};

// ── Queue monitoring ──────────────────────────────────────────────────────────
const attachQueueMonitoring = () => {
  const queueEvents = new QueueEvents(EMAIL_QUEUE_NAME, { connection });
  queueEvents.on('stalled', ({ jobId }) => logger.warn({ jobId }, 'email.job_stalled'));
  return queueEvents;
};

module.exports = { enqueueEmail, startEmailWorker, attachQueueMonitoring, emailQueue };