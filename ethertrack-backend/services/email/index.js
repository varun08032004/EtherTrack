// services/email/index.js — EtherTrack
// Public entry point.
//   const email = require('./services/email');
//   await email.sendWelcomeEmail(user.email, { name: user.full_name, dashboardUrl });
//
// Drop-in notes:
//   - routes/kyc.js: no changes needed, enqueueEmail({to,template,data}) still works.
//   - routes/auth.js: swap `require('../services/email')` to this folder;
//     sendVerificationEmail/sendWelcomeEmail signatures below match old ones
//     closely but now take an options object instead of positional args — see below.
//   - routes/admin.js, cron/jobs.js, services/invoice.js: these build raw HTML
//     inline today. Recommended: replace each inline sendEmail({...html...}) call
//     with the matching named wrapper below so admin-triggered and cron-triggered
//     versions of the same email (e.g. KYC approved, mint success) render identically.
'use strict';

const { send, sendEmail, enqueueEmail, startEmailWorker, getQueueStats, generateOTP } = require('./mailer');

module.exports = {
  // low-level
  send, sendEmail, enqueueEmail, startEmailWorker, getQueueStats, generateOTP,

  // ── Auth / account (support@) ────────────────────────────────────────────
  sendVerificationEmail: (to, { name, otp }) => send('verify-account', to, { name, otp }),
  sendWelcomeEmail:      (to, { name, dashboardUrl }) => send('welcome', to, { name, dashboardUrl }),
  sendPasswordChangedEmail: (to, { name, time, ipAddress }) => send('password-changed', to, { name, time, ipAddress }),
  sendTwoFactorDisabledEmail: (to, { name }) => send('two-factor-disabled', to, { name }),
  sendAccountDeactivatedEmail: (to, { name, inrBalance }) => send('account-deactivated', to, { name, inrBalance }),
  sendAccountDeletedEmail: (to, { name }) => send('account-deleted', to, { name }),
  sendAccountSuspendedEmail: (to, { name, reason }) => send('account-suspended', to, { name, reason }),
  sendAccountReinstatedEmail: (to, { name }) => send('account-reinstated', to, { name }),
  sendWalletUpdatedEmail: (to, { name, walletAddress }) => send('wallet-updated', to, { name, walletAddress }),

  // ── KYC (support@ / admin@) ──────────────────────────────────────────────
  sendKycSubmittedEmail: (to, { fullName, submissionId }) => send('kyc-submitted', to, { fullName, submissionId }),
  sendKycApprovedEmail: (to, { fullName, tier, dashboardUrl }) => send('kyc-approved', to, { fullName, tier, dashboardUrl }),
  sendKycRejectedEmail: (to, { fullName, reason, resubmitUrl }) => send('kyc-rejected', to, { fullName, reason, resubmitUrl }),
  sendKycResubmissionRequiredEmail: (to, { fullName, reason, kycUrl }) => send('kyc-resubmission-required', to, { fullName, reason, kycUrl }),
  sendKycExpiringSoonEmail: (to, { fullName, daysLeft, expiresOn, kycUrl }) => send('kyc-expiring-soon', to, { fullName, daysLeft, expiresOn, kycUrl }),
  sendKycExpiredEmail: (to, { fullName, expiredOn, listingsRemovedCount, kycUrl }) => send('kyc-expired', to, { fullName, expiredOn, listingsRemovedCount, kycUrl }),
  sendKycAdminAlert: (to, { userEmail, fullName, idType, submissionId, submittedAt, adminUrl }) => send('kyc-admin-new', to, { userEmail, fullName, idType, submissionId, submittedAt, adminUrl }),

  // ── Marketplace (support@) ───────────────────────────────────────────────
  sendCreditListingRejectedEmail: (to, { name, projectName, reason, portfolioUrl }) => send('credit-listing-rejected', to, { name, projectName, reason, portfolioUrl }),
  sendListingExpiredEmail: (to, { name, projectName, expiredOn, creditsReturned, portfolioUrl }) => send('listing-expired', to, { name, projectName, expiredOn, creditsReturned, portfolioUrl }),
  sendMintSuccessEmail: (to, { name, projectName, tokenId, txHash, portfolioUrl }) => send('mint-success', to, { name, projectName, tokenId, txHash, portfolioUrl }),

  // ── Support tickets (support@ / admin@) ──────────────────────────────────
  sendSupportTicketReceivedEmail: (to, { name, ticketNumber }) => send('support-ticket-received', to, { name, ticketNumber }),
  sendNewTicketInternalAlert: (to, { ticketNumber, userEmail, userId, userName, type, subjectLine, page, message, adminUrl }) =>
    send('new-ticket-internal', to, { ticketNumber, userEmail, userId, userName, type, subjectLine, page, message, adminUrl }),

  // ── Admin-authored messages (support@) ───────────────────────────────────
  sendAdminMessageToUserEmail: (to, { name, subject, message }) => send('admin-message-to-user', to, { name, subject, message }),
  sendPlatformAnnouncementEmail: (to, { name, subject, message }) => send('platform-announcement', to, { name, subject, message }),

  // ── Org (support@) ───────────────────────────────────────────────────────
  sendOrgInviteEmail: (to, { orgName, inviterName, roleDescription, inviteUrl }) => send('org-invite', to, { orgName, inviterName, roleDescription, inviteUrl }),

  // ── GHG verification (support@) ──────────────────────────────────────────
  sendVerificationPackageCreatedEmail: (to, { name, companyName, year, auditorFirm, auditorEmail, portalUrl, expiresAt, dashboardUrl }) =>
    send('verification-package-created', to, { name, companyName, year, auditorFirm, auditorEmail, portalUrl, expiresAt, dashboardUrl }),
  sendVerificationSealedEmail: (to, { name, companyName, year, verifierName, fileHash, sealTxHash, sealExplorerUrl, dashboardUrl }) =>
    send('verification-sealed', to, { name, companyName, year, verifierName, fileHash, sealTxHash, sealExplorerUrl, dashboardUrl }),
  sendVerificationReceivedEmail: (to, { name, companyName, year, fileHash, sealTxHash, sealExplorerUrl }) =>
    send('verification-received', to, { name, companyName, year, fileHash, sealTxHash, sealExplorerUrl }),

  // ── Billing (billing@) ───────────────────────────────────────────────────
  sendSubscriptionInvoiceEmail: (to, { name, invoiceNumber, planLabel, cycleLabel, invoiceUrl }, opts) =>
    send('subscription-invoice', to, { name, invoiceNumber, planLabel, cycleLabel, invoiceUrl }, opts),
  sendTradeInvoiceEmail: (to, { buyerName, invoiceNumber, projectName, qty, totalPaidINR, invoiceUrl }, opts) =>
    send('trade-invoice', to, { buyerName, invoiceNumber, projectName, qty, totalPaidINR, invoiceUrl }, opts),
  sendTradeInvoiceChainConfirmedEmail: (to, { invoiceNumber, invoiceUrl }, opts) =>
    send('trade-invoice-chain-confirmed', to, { invoiceNumber, invoiceUrl }, opts),
  sendTradeBillEthEmail: (to, { buyerName, invoiceNumber, projectName, qty, invoiceUrl }, opts) =>
    send('trade-bill-eth', to, { buyerName, invoiceNumber, projectName, qty, invoiceUrl }, opts),
  sendBuyOrderCancelledEmail: (to, { orderId, reason, ethEscrowed }) =>
    send('buy-order-cancelled', to, { orderId, reason, ethEscrowed }),

  // billing gap-fillers (not wired to a cron yet)
  sendSubscriptionExpiringSoonEmail: (to, { name, plan, expiryDate, daysLeft, renewUrl }) => send('subscription-expiring-soon', to, { name, plan, expiryDate, daysLeft, renewUrl }),
  sendSubscriptionExpiredEmail: (to, { name, plan, downgradeTo, renewUrl }) => send('subscription-expired', to, { name, plan, downgradeTo, renewUrl }),
  sendPaymentFailedEmail: (to, { name, plan, amount, currency, retryUrl }) => send('payment-failed', to, { name, plan, amount, currency, retryUrl }),

  // ── Sales (sales@) ────────────────────────────────────────────────────────
  sendCorporatePlanActivatedEmail: (to, { name, seatDisplay, cycle, renewalDateLabel, priceINR, notes, billingUrl }) => send('corporate-plan-activated', to, { name, seatDisplay, cycle, renewalDateLabel, priceINR, notes, billingUrl }),

  // ── Wallet (support@ / billing@) ──────────────────────────────────────────
  sendWalletConnectedEmail: (to, { name, walletAddress, walletUrl }) => send('wallet-connected', to, { name, walletAddress, walletUrl }),
  sendDepositConfirmedEmail: (to, { name, amount, method, balanceAfter, reference, walletUrl }) => send('deposit-confirmed', to, { name, amount, method, balanceAfter, reference, walletUrl }),
  sendWithdrawalProcessedEmail: (to, { name, amount, accountName, accountNumberMasked, reference, walletUrl }) => send('withdrawal-processed', to, { name, amount, accountName, accountNumberMasked, reference, walletUrl }),
  sendWithdrawalFailedEmail: (to, { name, amount, reason, walletUrl }) => send('withdrawal-failed', to, { name, amount, reason, walletUrl }),
  sendBankAccountAddedEmail: (to, { name, bankName, accountNumberMasked, walletUrl }) => send('bank-account-added', to, { name, bankName, accountNumberMasked, walletUrl }),
  sendBankAccountRemovedEmail: (to, { name, bankName, accountNumberMasked, walletUrl }) => send('bank-account-removed', to, { name, bankName, accountNumberMasked, walletUrl }),

  // ── Plan selection (support@ / billing@) ──────────────────────────────────
  sendPlanSelectedEmail: (to, { name, dashboardUrl }) => send('plan-selected', to, { name, dashboardUrl }),
  sendSubscriptionCancelledEmail: (to, { name, fromPlan, downgradeTo, effectiveNow, renewUrl }) => send('subscription-cancelled', to, { name, fromPlan, downgradeTo, effectiveNow, renewUrl }),
};