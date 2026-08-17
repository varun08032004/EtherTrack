// src/__tests__/fixtures/test-users.ts
import { vi } from 'vitest';

export const SELECTORS = {
  // Auth
  loginEmail: '#login-email',
  loginPassword: '#login-password',
  loginSubmit: 'button[type="submit"]', // PrimaryButton type="submit"
  loginButton: 'button[type="submit"]', // "Sign In"
  forgotPassword: 'button:has-text("Forgot password?")',
  registerLink: 'a[href="/signup"]', // "Create Workspace" link
  
  // Signup
  signupName: '#signup-name',
  signupCompany: '#signup-company',
  signupDesignation: '#signup-designation',
  signupEmail: '#signup-email',
  signupPassword: '#signup-password',
  signupConfirm: '#signup-confirm',
  signupSubmit: 'button[type="submit"]', // "Create Account" / "Continue"
  signupContinue: 'button[type="submit"]', // "Continue" on info slide
  signupBack: 'button:has-text("Back")',
  
  // OTP
  otpInput: 'input[inputMode="numeric"][maxLength="6"]',
  
  // Navigation
  navDashboard: '[data-testid="nav-dashboard"], a[href="/dashboard"]',
  navMarketplace: '[data-testid="nav-marketplace"], a[href="/marketplace"]',
  navPortfolio: '[data-testid="nav-portfolio"], a[href="/portfolio"]',
  navWallet: '[data-testid="nav-wallet"], a[href="/wallet"]',
  navSubscription: '[data-testid="nav-subscription"], a[href="/subscription"]',
  navAdmin: '[data-testid="nav-admin"], a[href="/admin"]',
  
  // Wallet
  walletBalance: '[data-testid="wallet-balance"]',
  walletDeposit: '[data-testid="wallet-deposit"], button:has-text("Deposit")',
  walletWithdraw: '[data-testid="wallet-withdraw"], button:has-text("Withdraw")',
  depositAmount: '[data-testid="deposit-amount"], input[name="amount"]',
  withdrawAmount: '[data-testid="withdraw-amount"], input[name="amount"]',
  confirmDeposit: '[data-testid="confirm-deposit"], button:has-text("Confirm")',
  confirmWithdraw: '[data-testid="confirm-withdraw"], button:has-text("Confirm")',
  
  // Marketplace
  listCredits: '[data-testid="list-credits"], button:has-text("List Credits")',
  listingTokenId: '[data-testid="listing-token-id"], select[name="tokenId"]',
  listingAmount: '[data-testid="listing-amount"], input[name="amount"]',
  listingPrice: '[data-testid="listing-price"], input[name="price"]',
  listingSubmit: '[data-testid="listing-submit"], button:has-text("List")',
  buyButton: '[data-testid="buy-button"], button:has-text("Buy")',
  buyQuantity: '[data-testid="buy-quantity"], input[name="quantity"]',
  confirmBuy: '[data-testid="confirm-buy"], button:has-text("Confirm")',
  
  // Portfolio
  portfolioCredits: '[data-testid="portfolio-credit"], .portfolio-credit',
  portfolioValue: '[data-testid="portfolio-value"]',
  retireButton: '[data-testid="retire-button"], button:has-text("Retire")',
  retireAmount: '[data-testid="retire-amount"], input[name="amount"]',
  retireReason: '[data-testid="retire-reason"], select[name="reason"]',
  confirmRetire: '[data-testid="confirm-retire"], button:has-text("Confirm")',
  
  // Subscription
  subscriptionPlans: '[data-testid="subscription-plans"], .plans',
  selectPlan: '[data-testid="select-plan"], button:has-text("Select")',
  paymentModal: '[data-testid="payment-modal"], .modal',
  razorpayOption: '[data-testid="razorpay-option"], button:has-text("Razorpay")',
  walletOption: '[data-testid="wallet-option"], button:has-text("Wallet Balance")',
  confirmPayment: '[data-testid="confirm-payment"], button:has-text("Pay")',
  couponInput: '[data-testid="coupon-input"], input[name="coupon"]',
  applyCoupon: '[data-testid="apply-coupon"], button:has-text("Apply")',
  cancelSubscription: '[data-testid="cancel-subscription"], button:has-text("Cancel")',
  confirmCancel: '[data-testid="confirm-cancel"], button:has-text("Yes, Cancel")',
  
  // Admin
  adminStats: '[data-testid="admin-stats"], .admin-stats',
  usersTable: '[data-testid="users-table"], .users-table',
  kycTable: '[data-testid="kyc-table"], .kyc-table',
  kycApprove: '[data-testid="kyc-approve"], button:has-text("Approve")',
  kycReject: '[data-testid="kyc-reject"], button:has-text("Reject")',
  creditsTable: '[data-testid="credits-table"], .credits-table',
  forceDelist: '[data-testid="force-delist"], button:has-text("Force Delist")',
  tradesTable: '[data-testid="trades-table"], .trades-table',
  reconcileTrade: '[data-testid="reconcile-trade"], button:has-text("Reconcile")',
  
  // KYC
  kycStart: '[data-testid="kyc-start"], button:has-text("Start KYC")',
  kycDocument: '[data-testid="kyc-document-upload"], input[type="file"]',
  kycSubmit: '[data-testid="kyc-submit"], button:has-text("Submit")',
  kycStatus: '[data-testid="kyc-status"]',
  
  // Operator
  logInrTrade: '[data-testid="log-inr-trade"], button:has-text("Log INR Trade")',
  batchLog: '[data-testid="batch-log"], button:has-text("Batch Log")',
  
  // ERP
  addErp: '[data-testid="add-erp"], button:has-text("Add ERP")',
  erpType: '[data-testid="erp-type"], select[name="type"]',
  erpUrl: '[data-testid="erp-url"], input[name="url"]',
  erpUsername: '[data-testid="erp-username"], input[name="username"]',
  erpPassword: '[data-testid="erp-password"], input[name="password"]',
  testConnection: '[data-testid="test-connection"], button:has-text("Test Connection")',
  saveErp: '[data-testid="save-erp"], button:has-text("Save")',
  
  // Common
  toast: '[data-testid="toast"], .toast, [role="alert"]',
  modal: '[data-testid="modal"], .modal, [role="dialog"]',
  modalClose: '[data-testid="modal-close"], button:has-text("Close")',
  confirmDialog: '[data-testid="confirm-dialog"]',
  confirmYes: '[data-testid="confirm-yes"], button:has-text("Yes")',
  confirmNo: '[data-testid="confirm-no"], button:has-text("No")',
  loadingSpinner: '[data-testid="loading"], .spinner, .loading',
};

export const WAIT_TIMEOUTS = {
  short: 5000,
  medium: 15000,
  long: 30000,
  veryLong: 60000,
};

export function generateUniqueEmail(prefix = 'e2e') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}@test.example.com`;
}

export async function waitForToast(page, message, timeout = WAIT_TIMEOUTS.medium) {
  await page.waitForSelector(SELECTORS.toast, { timeout });
  const toast = page.locator(SELECTORS.toast).filter({ hasText: message });
  await expect(toast).toBeVisible({ timeout });
}

export async function waitForModal(page, visible = true, timeout = WAIT_TIMEOUTS.medium) {
  if (visible) {
    await page.waitForSelector(SELECTORS.modal, { state: 'visible', timeout });
  } else {
    await page.waitForSelector(SELECTORS.modal, { state: 'hidden', timeout });
  }
}

export async function fillAndSubmit(page, selectors, values) {
  for (const [selector, value] of Object.entries(values)) {
    const element = page.locator(selector);
    await element.fill(value);
  }
  if (selectors.submit) {
    await page.click(selectors.submit);
  }
}