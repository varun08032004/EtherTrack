// services/email.js — EtherTrack (PRODUCTION-HARDENED)
// ─────────────────────────────────────────────────────────────────────────────
// FIXES APPLIED:
//
// [FIX-1]  sendEmail now supports attachments for Resend.
//          Resend requires content to be a base64-encoded string.
//          If a Buffer is passed (from invoice.js pdfBuffer), it is
//          automatically converted to base64. Invoice PDF emails now
//          correctly attach the PDF instead of silently failing.
//
// [FIX-2]  Separated FROM addresses:
//          - SUPPORT_FROM (support@ethertrack.in) for all user-facing emails
//          - ADMIN_FROM   (admin@ethertrack.in)   for admin/internal emails

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const SUPPORT_FROM = process.env.EMAIL_SUPPORT_FROM || 'support@ethertrack.in';
const ADMIN_FROM   = process.env.EMAIL_ADMIN_FROM   || 'admin@ethertrack.in';

// ── Generate 6-digit OTP ──────────────────────────────────────────────────────
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ── Generic sendEmail — [FIX-1] now handles PDF attachments for Resend ────────
const sendEmail = async ({ to, subject, html, attachments, isAdmin = false }) => {
  const payload = {
    from: isAdmin ? ADMIN_FROM : SUPPORT_FROM,
    to,
    subject,
    html,
  };

  // [FIX-1] Resend requires base64 strings — convert Buffer if needed
  if (attachments?.length) {
    payload.attachments = attachments.map(a => ({
      filename: a.filename,
      content:  Buffer.isBuffer(a.content)
        ? a.content.toString('base64')
        : a.content, // already base64 string — pass through
    }));
  }

  await resend.emails.send(payload);
};

// ── Send verification OTP ─────────────────────────────────────────────────────
const sendVerificationEmail = async (email, otp, name = '') => {
  await resend.emails.send({
    from:    SUPPORT_FROM,
    to:      email,
    subject: 'Verify your EtherTrack account',
    html: `
      <div style="font-family:monospace;background:#020f07;color:#f0fdf4;padding:40px;border-radius:12px;max-width:480px">
        <h2 style="color:#22c55e;letter-spacing:.1em">ETHERTRACK</h2>
        <p>Hi ${name || 'there'},</p>
        <p>Your verification code is:</p>
        <div style="background:#0d2e1f;border:1px solid #22c55e44;border-radius:8px;padding:24px;text-align:center;margin:24px 0">
          <span style="font-size:36px;font-weight:bold;letter-spacing:.3em;color:#22c55e">${otp}</span>
        </div>
        <p style="color:#86efac88;font-size:12px">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
};

// ── Send welcome email ────────────────────────────────────────────────────────
const sendWelcomeEmail = async (email, name = '') => {
  await resend.emails.send({
    from:    SUPPORT_FROM,
    to:      email,
    subject: 'Welcome to EtherTrack',
    html: `
      <div style="font-family:monospace;background:#020f07;color:#f0fdf4;padding:40px;border-radius:12px;max-width:480px">
        <h2 style="color:#22c55e;letter-spacing:.1em">ETHERTRACK</h2>
        <p>Hi ${name || 'there'}, welcome to EtherTrack.</p>
        <p>Your account is ready. Next steps:</p>
        <ul style="color:#86efac88">
          <li>Connect your MetaMask wallet</li>
          <li>Complete KYC verification</li>
          <li>Start trading carbon credits</li>
        </ul>
        <a href="${process.env.FRONTEND_URL}/dashboard"
           style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:16px">
          Go to Dashboard →
        </a>
      </div>
    `,
  });
};

// ── Send retirement certificate ───────────────────────────────────────────────
const sendRetirementEmail = async (email, name, cert) => {
  await resend.emails.send({
    from:    SUPPORT_FROM,
    to:      email,
    subject: `Retirement Certificate — ${cert.certificateId}`,
    html: `
      <div style="font-family:monospace;background:#020f07;color:#f0fdf4;padding:40px;border-radius:12px;max-width:480px">
        <h2 style="color:#22c55e;letter-spacing:.1em">ETHERTRACK</h2>
        <p>Hi ${name || 'there'},</p>
        <p>You have successfully retired <strong style="color:#22c55e">${cert.amount} tCO₂</strong> carbon credits.</p>
        <div style="background:#0d2e1f;border:1px solid #22c55e44;border-radius:8px;padding:16px;margin:16px 0;font-size:12px">
          <div>Certificate ID: <span style="color:#22c55e">${cert.certificateId}</span></div>
          <div>Project: ${cert.projectName}</div>
          <div>Beneficiary: ${cert.beneficiary || 'Self'}</div>
          <div>Tx Hash: <span style="color:#60a5fa88">${cert.txHash?.slice(0, 20)}...</span></div>
        </div>
        <a href="${cert.ipfsUrl}"
           style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none">
          View Certificate on IPFS →
        </a>
      </div>
    `,
  });
};

module.exports = {
  generateOTP,
  sendEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendRetirementEmail,
};