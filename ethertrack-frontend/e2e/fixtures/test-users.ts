// src/__tests__/fixtures/test-users.ts
import { expect } from '@playwright/test';

export const SELECTORS = {
  // Auth
  loginEmail: '#login-email',
  loginPassword: '#login-password',
  loginSubmit: 'button[type="submit"]',
  loginButton: 'button[type="submit"]',
  forgotPassword: 'button:has-text("Forgot password?")',
  registerLink: 'a[href="/signup"]',
  
  // Signup
  signupName: '#signup-name',
  signupCompany: '#signup-company',
  signupDesignation: '#signup-designation',
  signupEmail: '#signup-email',
  signupPassword: '#signup-password',
  signupConfirm: '#signup-confirm',
  signupSubmit: 'button[type="submit"]',
  signupContinue: 'button[type="submit"]',
  signupBack: 'button:has-text("Back")',
  
  // OTP
  otpInput: 'input[inputMode="numeric"][maxLength="6"]',
  
  // Navigation
  navDashboard: 'a[href="/dashboard"]',
  navMarketplace: 'a[href="/marketplace"]',
  navPortfolio: 'a[href="/portfolio"]',
  navWallet: 'a[href="/wallet"]',
  navSubscription: 'a[href="/subscription"]',
  navAdmin: 'a[href="/admin"]',
  
  // Wallet
  walletBalance: '[data-testid="wallet-balance"]',
  walletDeposit: 'button:has-text("Deposit")',
  walletWithdraw: 'button:has-text("Withdraw")',
  depositAmount: 'input[name="amount"]',
  withdrawAmount: 'input[name="amount"]',
  confirmDeposit: 'button:has-text("Confirm")',
  confirmWithdraw: 'button:has-text("Confirm")',
  
  // Marketplace
  listCredits: 'button:has-text("List Credits")',
  listingTokenId: 'select[name="tokenId"]',
  listingAmount: 'input[name="amount"]',
  listingPrice: 'input[name="price"]',
  listingSubmit: 'button:has-text("List")',
  buyButton: 'button:has-text("Buy")',
  buyQuantity: 'input[name="quantity"]',
  confirmBuy: 'button:has-text("Confirm")',
  
  // Portfolio
  portfolioCredits: '.portfolio-credit',
  portfolioValue: '[data-testid="portfolio-value"]',
  retireButton: 'button:has-text("Retire")',
  retireAmount: 'input[name="amount"]',
  retireReason: 'select[name="reason"]',
  confirmRetire: 'button:has-text("Confirm")',
  
  // Subscription
  subscriptionPlans: '.plans',
  selectPlan: 'button:has-text("Select")',
  paymentModal: '.modal',
  razorpayOption: 'button:has-text("Razorpay")',
  walletOption: 'button:has-text("Wallet Balance")',
  confirmPayment: 'button:has-text("Pay")',
  couponInput: 'input[name="coupon"]',
  applyCoupon: 'button:has-text("Apply")',
  cancelSubscription: 'button:has-text("Cancel")',
  confirmCancel: 'button:has-text("Yes, Cancel")',
  
  // Admin
  adminStats: '.admin-stats',
  usersTable: '.users-table',
  kycTable: '.kyc-table',
  kycApprove: 'button:has-text("Approve")',
  kycReject: 'button:has-text("Reject")',
  creditsTable: '.credits-table',
  forceDelist: 'button:has-text("Force Delist")',
  tradesTable: '.trades-table',
  reconcileTrade: 'button:has-text("Reconcile")',
  
  // KYC
  kycStart: 'button:has-text("Start KYC")',
  kycDocument: 'input[type="file"]',
  kycSubmit: 'button:has-text("Submit")',
  kycStatus: '[data-testid="kyc-status"]',
  
  // Operator
  logInrTrade: 'button:has-text("Log INR Trade")',
  batchLog: 'button:has-text("Batch Log")',
  
  // ERP
  addErp: 'button:has-text("Add ERP")',
  erpType: 'select[name="type"]',
  erpUrl: 'input[name="url"]',
  erpUsername: 'input[name="username"]',
  erpPassword: 'input[name="password"]',
  testConnection: 'button:has-text("Test Connection")',
  saveErp: 'button:has-text("Save")',
  
  // Common
  toast: '.toast, [role="alert"]',
  modal: '.modal, [role="dialog"]',
  modalClose: 'button:has-text("Close")',
  confirmDialog: '[data-testid="confirm-dialog"]',
  confirmYes: 'button:has-text("Yes")',
  confirmNo: 'button:has-text("No")',
  loadingSpinner: '.spinner, .loading',
};

export const WAIT_TIMEOUTS = {
  short: 5000,
  medium: 15000,
  long: 30000,
  veryLong: 60000,
};

function generateUniqueEmail(prefix = 'e2e') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}@test.example.com`;
}

export { generateUniqueEmail };

export async function waitForToast(page, message, timeout = 15000) {
  await page.waitForSelector('.toast, [role="alert"]', { timeout });
  const toast = page.locator('.toast, [role="alert"]').filter({ hasText: message });
  await expect(toast.first()).toBeVisible({ timeout });
}

export async function waitForModal(page, visible = true, timeout = 15000) {
  if (visible) {
    await page.waitForSelector('.modal, [role="dialog"]', { state: 'visible', timeout });
  } else {
    await page.waitForSelector('.modal, [role="dialog"]', { state: 'hidden', timeout });
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