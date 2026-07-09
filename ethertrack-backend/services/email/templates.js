// services/email/templates.js — EtherTrack
// All transactional email HTML in one place. Each entry: (data) => { subject, html }
// Field names match what each real call site (auth.js/admin.js/kyc.js/cron/jobs.js/
// invoice.js/etc.) already computes — minimal rewiring needed at call sites.
'use strict';

// Hosted logo. Defaults to your existing live site logo (ethertrack.in/logo.png)
// so it works out of the box — override with EMAIL_LOGO_URL if you want a
// different (e.g. transparent-background) version for dark email headers.
const LOGO_URL = process.env.EMAIL_LOGO_URL || 'https://ethertrack.in/logo.png';

const LEGAL_FOOTER = 'EtherTrack Technologies Private Limited · Carbon Credit Exchange · Do not reply to this email';

// ── Shared layout (dark green / monospace, matches existing product emails) ──
// Brightened pass: body copy was #86efac88 (53% alpha) — too dim to read
// comfortably. Bumped to solid, high-contrast colors throughout.
const layout = ({ eyebrow, title, titleColor = '#22c55e', headerBg = 'linear-gradient(135deg,#12432c,#0d331f)', headerBorder = '#1a4d30', bodyHtml, footer }) => `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0f0c;font-family:'Courier New',monospace">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#0d1410;border:1px solid #1a4d30;border-radius:12px;overflow:hidden">
  <tr><td style="background:${headerBg};padding:28px 36px 32px;border-bottom:1px solid ${headerBorder}">
    ${LOGO_URL
      ? `<img src="${LOGO_URL}" alt="EtherTrack" width="36" height="36" style="display:block;margin-bottom:12px;border:0;outline:0;border-radius:6px" />`
      : ''}
    <div style="font-size:11px;color:#6ee7b7;letter-spacing:.15em;margin-bottom:6px;font-weight:700">ETHERTRACK${eyebrow ? ' · ' + eyebrow : ''}</div>
    <div style="font-size:23px;font-weight:700;color:${titleColor}">${title}</div>
  </td></tr>
  <tr><td style="padding:32px 36px;color:#d6f5e3;font-size:13px;line-height:1.8">
    ${bodyHtml}
    <p style="margin:24px 0 0;font-size:11px;color:#6ee7b799">${footer || LEGAL_FOOTER}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

const button = (href, label, color = 'linear-gradient(135deg,#22c55e,#16a34a)') => `
  <table cellpadding="0" cellspacing="0"><tr><td style="background:${color};border-radius:8px;padding:14px 28px">
    <a href="${href}" style="color:#fff;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:.08em">${label}</a>
  </td></tr></table>`;

// Table-based, NOT flexbox — display:flex silently fails in Outlook desktop
// (Word rendering engine has zero flexbox support) and columns collapse.
const kv = (rows) => `
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a130e;border:1px solid #1a4d30;border-radius:8px;margin:20px 0">
    ${rows.map(([label, value], i) => `
    <tr>
      <td style="padding:10px 16px;font-size:10px;color:#5eead4;letter-spacing:.1em;white-space:nowrap;font-weight:700;${i < rows.length - 1 ? 'border-bottom:1px solid #1a4d3055;' : ''}">${String(label ?? '').toUpperCase()}</td>
      <td align="right" style="padding:10px 16px;font-size:12px;color:#f0fdf4;${i < rows.length - 1 ? 'border-bottom:1px solid #1a4d3055;' : ''}">${value ?? '—'}</td>
    </tr>`).join('')}
  </table>`;

const warnBox = (text, color = '#facc15') => `
  <div style="background:#221a05;border:1px solid ${color}44;border-radius:8px;padding:16px;margin:20px 0;font-size:12px;color:${color};white-space:pre-wrap">
    ${text}
  </div>`;

const RED = { titleColor: '#f87171', headerBg: 'linear-gradient(135deg,#2a1010,#1a0808)', headerBorder: '#5c1f1f' };
const AMBER = { titleColor: '#facc15', headerBg: 'linear-gradient(135deg,#2a1f05,#1a1400)', headerBorder: '#5c4a1f' };
const BLUE_BTN = 'linear-gradient(135deg,#3b82f6,#2563eb)';

const TEMPLATES = {

  // ═══════════════════════════════ AUTH / ACCOUNT ═══════════════════════════

  'verify-account': ({ name, otp }) => ({
    subject: 'Verify your EtherTrack account',
    html: layout({
      eyebrow: 'ACCOUNT',
      title: 'Verify your email',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'},</p>
        <p style="margin:0 0 16px">Your verification code is:</p>
        <div style="background:#0d2e1f;border:1px solid #22c55e44;border-radius:8px;padding:24px;text-align:center;margin:24px 0">
          <span style="font-size:36px;font-weight:bold;letter-spacing:.3em;color:#22c55e">${otp}</span>
        </div>
        <p style="font-size:12px">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>`,
    }),
  }),

  'welcome': ({ name, dashboardUrl }) => ({
    subject: 'Welcome to EtherTrack',
    html: layout({
      eyebrow: 'ACCOUNT',
      title: 'Welcome aboard 🌱',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your EtherTrack account is verified and ready.</p>
        <ul style="margin:0 0 24px;padding-left:20px">
          <li style="margin-bottom:6px">Connect your MetaMask wallet</li>
          <li style="margin-bottom:6px">Complete KYC verification</li>
          <li style="margin-bottom:6px">Start tracking emissions or trading carbon credits</li>
        </ul>
        ${button(dashboardUrl, 'Go to Dashboard →')}`,
    }),
  }),

  'password-changed': ({ name, time, ipAddress }) => ({
    subject: 'EtherTrack — Your password was changed',
    html: layout({
      eyebrow: 'SECURITY',
      title: 'Password Changed',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, this confirms your password was changed successfully.</p>
        ${kv([['Time', time || new Date().toISOString()], ['IP address', ipAddress || 'Unknown']])}
        <p style="margin:16px 0">If you didn't make this change, contact support immediately — your account may be compromised.</p>`,
    }),
  }),

  'two-factor-disabled': ({ name }) => ({
    subject: 'EtherTrack — 2FA Disabled',
    html: layout({
      eyebrow: 'SECURITY', title: '2FA Disabled', ...AMBER,
      bodyHtml: `<p style="margin:0 0 16px">Hi ${name || 'there'}, two-factor authentication has been disabled on your account. If you didn't do this, contact support immediately.</p>`,
    }),
  }),

  'account-deactivated': ({ name, inrBalance }) => ({
    subject: 'EtherTrack — Account Deactivated',
    html: layout({
      eyebrow: 'ACCOUNT', title: 'Account Deactivated', ...AMBER,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your account has been deactivated as requested.</p>
        ${inrBalance != null ? `<p style="margin:0 0 16px">Your funds (₹${Number(inrBalance).toLocaleString('en-IN')}) are safe and will be available when you reactivate.</p>` : ''}
        <p>You can log back in any time to reactivate it.</p>`,
    }),
  }),

  'account-deleted': ({ name }) => ({
    subject: 'EtherTrack — Account Deleted',
    html: layout({
      eyebrow: 'ACCOUNT', title: 'Account Deleted', ...RED,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your EtherTrack account and associated personal data have been permanently deleted as requested.</p>
        <p style="font-size:12px">Transaction records are retained for regulatory compliance as required by RBI and SEBI guidelines.</p>`,
    }),
  }),

  'account-suspended': ({ name, reason }) => ({
    subject: 'EtherTrack — Account Suspended',
    html: layout({
      eyebrow: 'ACCOUNT', title: 'Account Suspended', ...RED,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your account has been suspended.</p>
        ${reason ? warnBox(reason, '#f87171') : ''}
        <p>Contact support if you believe this is a mistake.</p>`,
    }),
  }),

  'account-reinstated': ({ name }) => ({
    subject: 'EtherTrack — Account Reinstated',
    html: layout({
      eyebrow: 'ACCOUNT', title: 'Account Reinstated',
      bodyHtml: `<p style="margin:0 0 16px">Hi ${name || 'there'}, your account has been reinstated and full access is restored.</p>`,
    }),
  }),

  'wallet-updated': ({ name, walletAddress }) => ({
    subject: 'EtherTrack — Wallet Address Updated',
    html: layout({
      eyebrow: 'SECURITY', title: 'Wallet Updated 🔑', titleColor: '#60a5fa',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your linked wallet address has been updated.</p>
        ${kv([['New wallet', walletAddress]])}
        <p>If you did not request this, contact support immediately.</p>`,
    }),
  }),

  // ═══════════════════════════════ KYC ═══════════════════════════════════════

  'kyc-submitted': ({ fullName, submissionId }) => ({
    subject: 'EtherTrack — KYC Submission Received',
    html: layout({
      eyebrow: 'KYC', title: 'KYC Submitted ✅',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi <strong style="color:#f0fdf4">${fullName}</strong>, we've received your KYC submission. Our compliance team will review it within <strong style="color:#facc15">1–2 business days</strong>.</p>
        ${kv([['Submission ID', submissionId]])}`,
    }),
  }),

  'kyc-approved': ({ fullName, tier, dashboardUrl }) => ({
    subject: 'EtherTrack — KYC Approved 🎉',
    html: layout({
      eyebrow: 'KYC', title: 'KYC Approved 🎉', headerBg: 'linear-gradient(135deg,#0d2e1f,#052e16)',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi <strong style="color:#f0fdf4">${fullName}</strong>, your KYC is approved.${tier ? ` Account activated at tier <strong style="color:#facc15">${tier.toUpperCase()}</strong>.` : ' You now have full access to trading, portfolio, and emission tracking.'}</p>
        ${button(dashboardUrl, 'Go to Dashboard →')}`,
    }),
  }),

  'kyc-rejected': ({ fullName, reason, resubmitUrl }) => ({
    subject: 'EtherTrack — KYC Requires Resubmission',
    html: layout({
      eyebrow: 'KYC', title: 'Resubmission Required', ...RED,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi <strong style="color:#f0fdf4">${fullName}</strong>, your KYC submission couldn't be approved.</p>
        ${warnBox(reason, '#f87171')}
        ${button(resubmitUrl, 'Resubmit KYC →')}`,
    }),
  }),

  'kyc-resubmission-required': ({ fullName, reason, kycUrl }) => ({
    subject: 'EtherTrack — Fresh KYC Submission Required',
    html: layout({
      eyebrow: 'KYC', title: 'Re-KYC Required 🔄', ...AMBER,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi <strong style="color:#f0fdf4">${fullName}</strong>, you need to resubmit your KYC.</p>
        ${warnBox(reason, '#facc15')}
        ${button(kycUrl, 'Resubmit KYC →', 'linear-gradient(135deg,#f59e0b,#d97706)')}`,
    }),
  }),

  'kyc-expiring-soon': ({ fullName, daysLeft, expiresOn, kycUrl }) => ({
    subject: `EtherTrack — KYC Expiring in ${daysLeft} Day${daysLeft === 1 ? '' : 's'}`,
    html: layout({
      eyebrow: 'KYC', title: 'KYC Expiring Soon ⚠', ...AMBER,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${fullName}, your KYC expires in <strong style="color:#f59e0b">${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong> on ${expiresOn}.</p>
        <p>Renew now to avoid trading suspension.</p>
        ${button(kycUrl, 'Renew KYC Now →', 'linear-gradient(135deg,#f59e0b,#d97706)')}`,
    }),
  }),

  'kyc-expired': ({ fullName, expiredOn, listingsRemovedCount, kycUrl }) => ({
    subject: 'EtherTrack — KYC Expired · Action Required',
    html: layout({
      eyebrow: 'KYC', title: 'KYC Expired ⚠', ...RED,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${fullName}, your KYC verification expired on <strong style="color:#f87171">${expiredOn}</strong>.</p>
        <p>Your account has been suspended from trading, listing, and retiring credits until you renew.</p>
        ${listingsRemovedCount > 0 ? `<p style="color:#f59e0b">⚠ ${listingsRemovedCount} active listing(s) have been removed and credits returned to your portfolio.</p>` : ''}
        ${button(kycUrl, 'Renew KYC Now →', 'linear-gradient(135deg,#dc2626,#991b1b)')}`,
    }),
  }),

  // ═══════════════════════════════ MARKETPLACE ═══════════════════════════════

  'credit-listing-rejected': ({ name, projectName, reason, portfolioUrl }) => ({
    subject: 'EtherTrack — Credit Listing Requires Resubmission',
    html: layout({
      eyebrow: 'MARKETPLACE', title: 'Credit Rejected', ...RED,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your listing <strong style="color:#f0fdf4">"${projectName}"</strong> was rejected.</p>
        ${warnBox(reason, '#f87171')}
        ${button(portfolioUrl, 'Go to Portfolio →', 'linear-gradient(135deg,#dc2626,#991b1b)')}`,
    }),
  }),

  'listing-expired': ({ name, projectName, expiredOn, creditsReturned, portfolioUrl }) => ({
    subject: 'EtherTrack — Listing Expired',
    html: layout({
      eyebrow: 'MARKETPLACE', title: 'Listing Expired ⏰', ...AMBER,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name}, your listing for <strong style="color:#f0fdf4">"${projectName}"</strong> expired on ${expiredOn}.</p>
        <p><strong style="color:#22c55e">${creditsReturned} credits</strong> have been returned to your portfolio. You can re-list them any time.</p>
        ${button(portfolioUrl, 'Go to Portfolio →')}`,
    }),
  }),

  'mint-success': ({ name, projectName, tokenId, txHash, portfolioUrl }) => ({
    subject: 'EtherTrack — Carbon Credits Tokenised ⛓',
    html: layout({
      eyebrow: 'MARKETPLACE', title: 'Carbon Credits Minted ⛓',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name}, your carbon credits <strong style="color:#f0fdf4">"${projectName}"</strong> have been successfully tokenised.</p>
        ${kv([['Token ID', `#${tokenId}`], ['Tx hash', txHash ? `${txHash.slice(0, 20)}...` : '—']])}
        ${button(portfolioUrl, 'View in Portfolio →')}`,
    }),
  }),

  // ═══════════════════════════════ SUPPORT TICKETS ═══════════════════════════

  'support-ticket-received': ({ name, ticketNumber }) => ({
    subject: `We've received your request — ${ticketNumber}`,
    html: layout({
      eyebrow: 'SUPPORT', title: 'Ticket Received',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, we've received your support request.</p>
        ${kv([['Ticket number', ticketNumber]])}
        <p>Our team will get back to you within 1 business day.</p>`,
    }),
  }),

  'new-ticket-internal': ({ ticketNumber, userEmail, userId, userName, type, subjectLine, page, message, adminUrl }) => ({
    subject: `🎫 New Support Ticket — ${ticketNumber}`,
    html: layout({
      eyebrow: 'ADMIN ALERT', title: 'New Support Ticket', ...AMBER,
      bodyHtml: `
        ${kv([
          ['Ticket', ticketNumber],
          ['From', userName ? `${userName} (${userEmail})` : userEmail],
          ...(userId ? [['User ID', userId]] : []),
          ...(type ? [['Type', type]] : []),
          ...(subjectLine ? [['Subject', subjectLine]] : []),
          ...(page ? [['Page', page]] : []),
        ])}
        ${message ? `<p style="margin:16px 0 8px;color:#f0fdf4"><strong>Message:</strong></p>${warnBox(message, '#facc15')}` : ''}
        ${adminUrl ? button(adminUrl, 'Open Ticket →') : ''}`,
      footer: 'EtherTrack · Internal admin notification',
    }),
  }),

  // ═══════════════════════════════ ADMIN-AUTHORED MESSAGES ═══════════════════

  'admin-message-to-user': ({ name, subject, message }) => ({
    subject: `EtherTrack — ${subject}`,
    html: layout({
      eyebrow: 'MESSAGE', title: 'Message from EtherTrack Support', titleColor: '#f59e0b',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'},</p>
        ${warnBox(message, '#f59e0b')}`,
    }),
  }),

  'platform-announcement': ({ name, subject, message }) => ({
    subject: `EtherTrack — ${subject}`,
    html: layout({
      eyebrow: 'ANNOUNCEMENT', title: '📢 Platform Announcement', titleColor: '#f59e0b',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'},</p>
        ${warnBox(message, '#f59e0b')}`,
    }),
  }),

  // ═══════════════════════════════ ORG ═══════════════════════════════════════

  'org-invite': ({ orgName, inviterName, roleDescription, inviteUrl }) => ({
    subject: `You've been invited to join ${orgName} on EtherTrack`,
    html: layout({
      eyebrow: 'ORGANIZATION', title: 'You\'re Invited 🤝',
      bodyHtml: `
        <p style="margin:0 0 16px">${inviterName ? `${inviterName} has invited` : "You've been invited"} you to join <strong style="color:#f0fdf4">${orgName}</strong> on EtherTrack.</p>
        ${roleDescription ? `<p style="margin:0 0 16px">${roleDescription}</p>` : ''}
        ${button(inviteUrl, 'Accept Invitation →')}
        <p style="margin:16px 0 0;font-size:12px">This invite expires in 7 days.</p>`,
    }),
  }),

  // ═══════════════════════════════ GHG VERIFICATION ═══════════════════════════

  'verification-package-created': ({ name, companyName, year, auditorFirm, auditorEmail, portalUrl, expiresAt, dashboardUrl }) => ({
    subject: `Verification package created — FY ${year} · ${companyName}`,
    html: layout({
      eyebrow: 'GHG AUDIT TRAIL · ISO 14064-3', title: 'Verification Package Created',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your verification package for FY ${year} has been created for <strong style="color:#f0fdf4">${companyName}</strong>.</p>
        ${kv([['Auditor', auditorFirm || auditorEmail], ['Reporting year', `FY ${year}`], ['Link expires', expiresAt]])}
        <p style="margin:16px 0 8px;font-size:12px">Share this portal link with your auditor — they'll sign with their DSC and upload it back:</p>
        <div style="background:#060e18;border:1px solid #3b82f633;border-radius:6px;padding:12px;font-size:11px;color:#60a5fa;word-break:break-all;margin-bottom:20px">${portalUrl}</div>
        ${button(dashboardUrl, 'View Audit Trail →')}
        <p style="color:#6ee7b799;font-size:11px;margin-top:20px">EtherTrack Technologies Private Limited · ISO 14064-3 · Ethereum Sepolia</p>`,
    }),
  }),

  'verification-sealed': ({ name, companyName, year, verifierName, fileHash, sealTxHash, sealExplorerUrl, dashboardUrl }) => ({
    subject: `✓ GHG Inventory Sealed on Ethereum — FY ${year} · ${companyName}`,
    html: layout({
      eyebrow: 'GHG AUDIT TRAIL · SEALED', title: 'Verification Sealed ✅',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your GHG inventory for FY ${year} has been <strong style="color:#22c55e">verified and sealed on Ethereum</strong> by <strong style="color:#f0fdf4">${verifierName || 'your auditor'}</strong>.</p>
        <div style="background:#040f09;border:1px solid #10b98133;border-radius:8px;padding:20px;margin:20px 0">
          <div style="font-size:12px;font-weight:700;color:#10b981;margin-bottom:12px;letter-spacing:.08em">SEALED ON ETHEREUM SEPOLIA</div>
          ${kv([
            ['Company', companyName], ['Reporting year', `FY ${year}`], ['Verified by', verifierName || '—'],
            ['SHA-256', fileHash ? `${fileHash.slice(0, 24)}...` : '—'],
            ...(sealTxHash ? [['Tx hash', `${sealTxHash.slice(0, 24)}...`]] : []),
          ])}
        </div>
        <p style="margin:16px 0;font-size:12px">This seal is permanent and immutable. Your BRSR, CDP, and TCFD reports can now reference this verification.</p>
        ${sealExplorerUrl ? `<div style="margin-bottom:12px">${button(sealExplorerUrl, 'Verify on Etherscan →', 'linear-gradient(135deg,#627eea,#4c51bf)')}</div>` : ''}
        ${button(dashboardUrl, 'View Audit Trail →')}
        <p style="color:#6ee7b799;font-size:11px;margin-top:20px">EtherTrack Technologies Private Limited · ISO 14064-3 · Ethereum Sepolia</p>`,
    }),
  }),

  'verification-received': ({ name, companyName, year, fileHash, sealTxHash, sealExplorerUrl }) => ({
    subject: `Verification received — ${companyName} FY ${year}`,
    html: layout({
      eyebrow: 'AUDITOR CONFIRMATION', title: 'Verification Received',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your signed verification document for <strong style="color:#f0fdf4">${companyName} FY ${year}</strong> has been received and ${sealTxHash ? '<strong style="color:#22c55e">anchored on Ethereum</strong>' : 'saved securely'}.</p>
        ${kv([['SHA-256', fileHash ? `${fileHash.slice(0, 24)}...` : '—'], ...(sealTxHash ? [['On-chain tx', `${sealTxHash.slice(0, 24)}...`]] : [])])}
        <p style="margin:16px 0;font-size:12px">The SHA-256 hash is the cryptographic fingerprint of your signature — anyone can verify it matches your signed PDF by computing the hash independently.</p>
        ${sealExplorerUrl ? button(sealExplorerUrl, 'Verify on Etherscan →', 'linear-gradient(135deg,#627eea,#4c51bf)') : ''}
        <p style="color:#6ee7b799;font-size:11px;margin-top:20px">EtherTrack Technologies Private Limited · ISO 14064-3 · Ethereum Sepolia</p>`,
    }),
  }),

  // ═══════════════════════════════ BILLING / INVOICES ═════════════════════════

  'subscription-invoice': ({ name, invoiceNumber, planLabel, cycleLabel, invoiceUrl }) => ({
    subject: `EtherTrack Tax Invoice ${invoiceNumber}`,
    html: layout({
      eyebrow: 'BILLING', title: 'Payment Received',
      bodyHtml: `
        <p style="margin:0 0 16px">Thank you for subscribing! Your GST tax invoice is attached.</p>
        ${kv([['Invoice', invoiceNumber], ['Plan', `${planLabel} (${cycleLabel})`]])}
        ${button(invoiceUrl, 'Download Invoice →')}`,
    }),
  }),

  'trade-invoice': ({ buyerName, invoiceNumber, projectName, qty, totalPaidINR, invoiceUrl }) => ({
    subject: `EtherTrack Trade Invoice ${invoiceNumber}`,
    html: layout({
      eyebrow: 'BILLING', title: 'Trade Confirmed',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${buyerName || 'there'}, your carbon credit purchase invoice is attached.</p>
        ${kv([['Invoice No', invoiceNumber], ['Project', projectName], ['Quantity', `${qty} tCO₂`], ['Total paid', `₹${totalPaidINR}`]])}
        ${button(invoiceUrl, 'Download Invoice →')}`,
    }),
  }),

  'trade-invoice-chain-confirmed': ({ invoiceNumber, invoiceUrl }) => ({
    subject: `EtherTrack Invoice ${invoiceNumber} — On-Chain Confirmation Added`,
    html: layout({
      eyebrow: 'BILLING', title: 'Invoice Updated',
      bodyHtml: `
        <p style="margin:0 0 16px">Your trade has been confirmed on-chain. The updated invoice with the blockchain transaction record is attached.</p>
        ${button(invoiceUrl, 'Download Updated Invoice →')}`,
    }),
  }),

  'trade-bill-eth': ({ buyerName, invoiceNumber, projectName, qty, invoiceUrl }) => ({
    subject: `EtherTrack Payment Bill ${invoiceNumber}`,
    html: layout({
      eyebrow: 'BILLING', title: 'ETH Payment Bill',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${buyerName || 'there'}, your ETH-settled carbon credit purchase bill is attached. This is a non-GST payment bill, not a tax invoice.</p>
        ${kv([['Bill No', invoiceNumber], ['Project', projectName], ['Quantity', `${qty} tCO₂e`]])}
        ${button(invoiceUrl, 'Download Bill →')}`,
    }),
  }),

  'buy-order-cancelled': ({ orderId, reason, ethEscrowed }) => ({
    subject: 'EtherTrack — Buy Order Cancelled',
    html: layout({
      eyebrow: 'BILLING', title: 'Buy Order Cancelled', titleColor: '#f59e0b',
      bodyHtml: `
        <p style="margin:0 0 16px">Order #${orderId} was cancelled. Reason: ${reason}</p>
        <p>ETH escrowed: <strong style="color:#f0fdf4">${ethEscrowed} ETH</strong> will be refunded to your wallet.</p>`,
    }),
  }),

  // ── Billing gap-fillers — templates ready, not yet wired to a cron ─────────

  'subscription-expiring-soon': ({ name, plan, expiryDate, daysLeft, renewUrl }) => ({
    subject: `EtherTrack — Your ${plan} plan expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    html: layout({
      eyebrow: 'BILLING', title: 'Subscription Expiring Soon', ...AMBER,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your <strong style="color:#f0fdf4">${plan}</strong> plan expires on <strong style="color:#facc15">${expiryDate}</strong>.</p>
        ${button(renewUrl, 'Renew Now →', 'linear-gradient(135deg,#f59e0b,#d97706)')}`,
    }),
  }),

  'subscription-expired': ({ name, plan, downgradeTo, renewUrl }) => ({
    subject: `EtherTrack — Your ${plan} plan has expired`,
    html: layout({
      eyebrow: 'BILLING', title: 'Subscription Expired', ...RED,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your <strong style="color:#f0fdf4">${plan}</strong> plan has expired. Your account has been moved to <strong>${downgradeTo || 'the Free'}</strong> plan.</p>
        ${button(renewUrl, 'Reactivate →', 'linear-gradient(135deg,#dc2626,#991b1b)')}`,
    }),
  }),

  'payment-failed': ({ name, plan, amount, currency = 'INR', retryUrl }) => ({
    subject: `EtherTrack — Payment failed for ${plan} plan`,
    html: layout({
      eyebrow: 'BILLING', title: 'Payment Failed', ...RED,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, we couldn't process your payment of ${currency} ${amount} for the <strong style="color:#f0fdf4">${plan}</strong> plan.</p>
        ${button(retryUrl, 'Update Payment Method →', 'linear-gradient(135deg,#dc2626,#991b1b)')}`,
    }),
  }),

  // ═══════════════════════════════ SALES ═══════════════════════════════════

  'corporate-plan-activated': ({ name, seatDisplay, cycle, renewalDateLabel, priceINR, notes, billingUrl }) => ({
    subject: 'EtherTrack — Corporate Plan Activated 🏢',
    html: layout({
      eyebrow: 'SALES', title: 'Corporate Plan Activated 🏢', titleColor: '#f59e0b',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your Corporate plan has been activated by the EtherTrack team.</p>
        <ul style="margin:0 0 20px;padding-left:20px;line-height:2.2">
          <li>Full Scope 3 (all 15 categories)</li>
          <li>BRSR / CDP / TCFD / GHG PDF reports</li>
          <li>Audit trail + verifier integration</li>
          <li>PAT scheme + CCTS + GEI / BEE compliance</li>
          <li>5-year decarbonisation plan + MRV calendar</li>
          <li>SBTi target setting · Supplier data portal</li>
          <li>Multi-entity consolidation · Carbon neutrality certificate</li>
          <li>${seatDisplay} seats · Team management</li>
        </ul>
        ${notes ? `<p style="color:#f59e0b88;font-size:12px;margin:0 0 12px">Note: ${notes}</p>` : ''}
        <p style="font-size:12px;margin:0 0 16px">Cycle: ${cycle} · Renews: ${renewalDateLabel}${priceINR > 0 ? ` · Amount: ₹${priceINR.toLocaleString('en-IN')}` : ''}</p>
        ${button(billingUrl, 'Go to Billing →', 'linear-gradient(135deg,#f59e0b,#d97706)')}`,
    }),
  }),

  // ═══════════════════════════════ ADMIN ALERTS ═══════════════════════════════

  'retirement-certificate': ({ name, amount, certificateId, projectName, beneficiary, txHash, certUrl }) => ({
    subject: `Retirement Certificate — ${certificateId}`,
    html: layout({
      eyebrow: 'RETIREMENT', title: 'Credits Retired 🌱',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, you've retired <strong style="color:#22c55e">${amount} tCO₂</strong> in carbon credits.</p>
        ${kv([
          ['Certificate ID', certificateId], ['Project', projectName],
          ['Beneficiary', beneficiary || 'Self'],
          ['Tx hash', txHash ? `${txHash.slice(0, 20)}...` : '—'],
        ])}
        ${button(certUrl, 'View Certificate →')}`,
    }),
  }),

  // ═══════════════════════════════ EMISSION TRACKING ═══════════════════════════

  'emission-record-approved': ({ name, activity, co2e, dashboardUrl }) => ({
    subject: `EtherTrack — Emission Record Approved`,
    html: layout({
      eyebrow: 'EMISSION TRACKING', title: 'Record Approved ✓',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your emission record has been approved and included in your inventory.</p>
        ${kv([['Activity', activity], ['Emissions', `${co2e} tCO₂e`]])}
        ${button(dashboardUrl, 'View in Dashboard →')}`,
    }),
  }),

  'emission-record-rejected': ({ name, activity, co2e, reason, dashboardUrl }) => ({
    subject: `EtherTrack — Emission Record Rejected`,
    html: layout({
      eyebrow: 'EMISSION TRACKING', title: 'Record Rejected', ...RED,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your emission record was rejected and needs correction.</p>
        ${kv([['Activity', activity], ['Emissions', `${co2e} tCO₂e`]])}
        ${reason ? warnBox(reason, '#f87171') : ''}
        ${button(dashboardUrl, 'Review & Resubmit →', 'linear-gradient(135deg,#dc2626,#991b1b)')}`,
    }),
  }),

  'emission-record-adjusted': ({ name, activity, field, oldValue, newValue, reason, dashboardUrl }) => ({
    subject: `EtherTrack — Locked Emission Record Adjusted`,
    html: layout({
      eyebrow: 'EMISSION TRACKING', title: 'Record Adjusted 📝', ...AMBER,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, a locked emission record was corrected and is now pending re-approval.</p>
        ${kv([['Activity', activity], [field || 'Value', `${oldValue} → ${newValue}`]])}
        ${reason ? warnBox(reason, '#facc15') : ''}
        ${button(dashboardUrl, 'View Record →', 'linear-gradient(135deg,#f59e0b,#d97706)')}`,
    }),
  }),

  'credits-sold': ({ name, projectName, quantity, amountINR, pending, walletUrl }) => ({
    subject: `EtherTrack — Your Credits Sold: ₹${amountINR} ${pending ? 'Pending' : 'Credited'} 💰`,
    html: layout({
      eyebrow: 'MARKETPLACE · SALE', title: pending ? 'Credits Sold — Payment Pending' : 'Credits Sold 💰',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your listing just sold.</p>
        ${kv([
          ['Project', projectName], ['Quantity sold', `${quantity} tCO₂`],
          [pending ? 'Amount pending' : 'Amount credited', `₹${amountINR}`],
        ])}
        ${pending ? `<p style="font-size:12px">This trade was settled in ETH — your INR proceeds will credit once the on-chain transaction confirms.</p>` : ''}
        ${button(walletUrl, 'View Wallet →')}`,
    }),
  }),

  // ═══════════════════════════════ PORTFOLIO / TOKENIZATION ═══════════════════

  'credit-submitted': ({ name, projectName, quantity, submissionId, portfolioUrl }) => ({
    subject: `EtherTrack — Credit Listing Submitted for Review`,
    html: layout({
      eyebrow: 'PORTFOLIO', title: 'Listing Submitted ✅',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, we've received your carbon credit submission for review.</p>
        ${kv([['Project', projectName], ['Quantity', `${quantity} tCO₂`], ['Submission ID', submissionId]])}
        <p style="font-size:12px">Our compliance team typically reviews within 1-2 business days.</p>
        ${button(portfolioUrl, 'View in Portfolio →')}`,
    }),
  }),

  'tokenization-failed': ({ name, projectName, reason, portfolioUrl }) => ({
    subject: `EtherTrack — Tokenization Failed for "${projectName}"`,
    html: layout({
      eyebrow: 'PORTFOLIO', title: 'Tokenization Failed ⚠', ...RED,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your approved credit <strong style="color:#f0fdf4">"${projectName}"</strong> could not be minted on-chain.</p>
        ${reason ? warnBox(reason, '#f87171') : ''}
        <p style="font-size:12px">Our team has been notified and will retry shortly. No action is needed from you.</p>
        ${button(portfolioUrl, 'View in Portfolio →', 'linear-gradient(135deg,#dc2626,#991b1b)')}`,
    }),
  }),

  'listing-confirmed': ({ name, projectName, quantity, pricePerCreditInr, marketUrl }) => ({
    subject: `EtherTrack — "${projectName}" is Now Listed`,
    html: layout({
      eyebrow: 'MARKETPLACE', title: 'Listing Live 📋',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your credits are now live on the marketplace.</p>
        ${kv([['Project', projectName], ['Quantity listed', `${quantity} tCO₂`], ...(pricePerCreditInr ? [['Price', `₹${pricePerCreditInr}/credit`]] : [])])}
        ${button(marketUrl, 'View Listing →')}`,
    }),
  }),

  'delisting-confirmed': ({ name, projectName, quantity, portfolioUrl }) => ({
    subject: `EtherTrack — "${projectName}" Delisted`,
    html: layout({
      eyebrow: 'MARKETPLACE', title: 'Listing Removed',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your listing has been removed from the marketplace and returned to your portfolio.</p>
        ${kv([['Project', projectName], ['Quantity returned', `${quantity} tCO₂`]])}
        ${button(portfolioUrl, 'View Portfolio →')}`,
    }),
  }),

  // ═══════════════════════════════ RETIREMENT ═════════════════════════════════

  'org-retirement-requested': ({ name, projectName, quantity, orgName }) => ({
    subject: `EtherTrack — Retirement Request Submitted`,
    html: layout({
      eyebrow: 'ORGANIZATION · RETIREMENT', title: 'Request Submitted ✅',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your retirement request for <strong style="color:#f0fdf4">${orgName}</strong> has been submitted for approval.</p>
        ${kv([['Project', projectName], ['Quantity', `${quantity} tCO₂`]])}
        <p style="font-size:12px">You'll be notified once an org admin reviews it.</p>`,
    }),
  }),

  'org-retirement-rejected': ({ name, projectName, quantity, orgName, reason }) => ({
    subject: `EtherTrack — Retirement Request Rejected`,
    html: layout({
      eyebrow: 'ORGANIZATION · RETIREMENT', title: 'Request Rejected', ...RED,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your retirement request for <strong style="color:#f0fdf4">${quantity} tCO₂ · ${projectName}</strong> at ${orgName} was rejected.</p>
        ${reason ? warnBox(reason, '#f87171') : ''}`,
    }),
  }),

  'kyc-admin-new': ({ userEmail, fullName, idType, submissionId, submittedAt, adminUrl }) => ({
    subject: `[EtherTrack Admin] New KYC — ${fullName}`,
    html: layout({
      eyebrow: 'ADMIN ALERT', title: 'New KYC Submission', ...AMBER,
      bodyHtml: `
        ${kv([['User email', userEmail], ['Full name', fullName], ['ID type', idType], ['Submission ID', submissionId], ['Submitted at', submittedAt]])}
        ${button(adminUrl, 'Review in Admin Panel →')}`,
      footer: 'EtherTrack · Internal admin notification',
    }),
  }),

  // ═══════════════════════════════ WALLET ═══════════════════════════════════

  'wallet-connected': ({ name, walletAddress, walletUrl }) => ({
    subject: 'EtherTrack — MetaMask Wallet Connected ✅',
    html: layout({
      eyebrow: 'WALLET', title: 'Wallet Connected 🦊',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your MetaMask wallet is now linked to your EtherTrack account.</p>
        ${kv([['Wallet address', walletAddress]])}
        <p style="font-size:12px">This wallet can now be used for on-chain trades and retirements. If you didn't do this, contact support immediately.</p>
        ${walletUrl ? button(walletUrl, 'View Wallet →') : ''}`,
    }),
  }),

  'deposit-confirmed': ({ name, amount, method, balanceAfter, reference, walletUrl }) => ({
    subject: `EtherTrack — ₹${amount} Deposited 💰`,
    html: layout({
      eyebrow: 'WALLET', title: 'Funds Deposited 💰',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your deposit has been credited to your EtherTrack wallet.</p>
        ${kv([
          ['Amount', `₹${amount}`], ['Method', (method || 'UPI').toUpperCase()],
          ['New balance', `₹${balanceAfter}`], ['Reference', reference],
        ])}
        ${walletUrl ? button(walletUrl, 'View Wallet →') : ''}`,
    }),
  }),

  'withdrawal-processed': ({ name, amount, accountName, accountNumberMasked, reference, walletUrl }) => ({
    subject: `EtherTrack — ₹${amount} Withdrawal Processed ✅`,
    html: layout({
      eyebrow: 'WALLET', title: 'Withdrawal Processed ✅',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your withdrawal has been sent to your bank account.</p>
        ${kv([
          ['Amount', `₹${amount}`], ['To account', `${accountName} · ${accountNumberMasked}`], ['Reference', reference],
        ])}
        <p style="font-size:12px">Funds typically reflect within 1-2 business days depending on your bank.</p>
        ${walletUrl ? button(walletUrl, 'View Wallet →') : ''}`,
    }),
  }),

  'withdrawal-failed': ({ name, amount, reason, walletUrl }) => ({
    subject: `EtherTrack — Withdrawal Failed, Funds Returned`,
    html: layout({
      eyebrow: 'WALLET', title: 'Withdrawal Failed ⚠', ...AMBER,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your withdrawal of <strong style="color:#facc15">₹${amount}</strong> couldn't be completed by our banking partner.</p>
        <p style="margin:0 0 16px">The full amount has been returned to your EtherTrack wallet balance — no funds were lost.</p>
        ${reason ? warnBox(reason, '#facc15') : ''}
        <p style="font-size:12px">Please check your bank account details and try again.</p>
        ${walletUrl ? button(walletUrl, 'View Wallet →', 'linear-gradient(135deg,#f59e0b,#d97706)') : ''}`,
    }),
  }),

  'bank-account-added': ({ name, bankName, accountNumberMasked, walletUrl }) => ({
    subject: 'EtherTrack — Bank Account Added',
    html: layout({
      eyebrow: 'WALLET · SECURITY', title: 'Bank Account Added',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, a new bank account was added to your EtherTrack account for withdrawals.</p>
        ${kv([['Bank', bankName], ['Account', accountNumberMasked]])}
        <p style="font-size:12px">If you didn't do this, contact support immediately.</p>
        ${walletUrl ? button(walletUrl, 'Manage Bank Accounts →') : ''}`,
    }),
  }),

  'bank-account-removed': ({ name, bankName, accountNumberMasked, walletUrl }) => ({
    subject: 'EtherTrack — Bank Account Removed',
    html: layout({
      eyebrow: 'WALLET · SECURITY', title: 'Bank Account Removed', ...AMBER,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, a bank account was removed from your EtherTrack account.</p>
        ${kv([['Bank', bankName], ['Account', accountNumberMasked]])}
        <p style="font-size:12px">If you didn't do this, contact support immediately.</p>
        ${walletUrl ? button(walletUrl, 'Manage Bank Accounts →', 'linear-gradient(135deg,#f59e0b,#d97706)') : ''}`,
    }),
  }),

  // ═══════════════════════════════ PLAN SELECTION ═════════════════════════════

  'plan-selected': ({ name, dashboardUrl }) => ({
    subject: 'EtherTrack — You\'re All Set on the Free Plan 🌱',
    html: layout({
      eyebrow: 'ACCOUNT', title: 'Free Plan Activated',
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, you're set up on the <strong style="color:#f0fdf4">Free</strong> plan.</p>
        <p style="margin:0 0 16px">Upgrade any time from your billing settings for higher limits, more facilities, and priority support.</p>
        ${button(dashboardUrl, 'Go to Dashboard →')}`,
    }),
  }),

  'subscription-cancelled': ({ name, fromPlan, downgradeTo, effectiveNow, renewUrl }) => ({
    subject: `EtherTrack — Your ${fromPlan} Plan Was Cancelled`,
    html: layout({
      eyebrow: 'BILLING', title: 'Subscription Cancelled', ...AMBER,
      bodyHtml: `
        <p style="margin:0 0 16px">Hi ${name || 'there'}, your <strong style="color:#f0fdf4">${fromPlan}</strong> plan has been cancelled${effectiveNow ? '' : ' and won\'t renew'}. Your account is now on the <strong>${downgradeTo || 'Free'}</strong> plan${effectiveNow ? '' : ' once your current cycle ends'}.</p>
        <p style="font-size:12px">Changed your mind? You can resubscribe any time.</p>
        ${button(renewUrl, 'Resubscribe →', 'linear-gradient(135deg,#f59e0b,#d97706)')}`,
    }),
  }),

};

module.exports = { TEMPLATES, layout, button, kv, warnBox };