// __mocks__/email.js
module.exports = {
  sendCreditSubmittedEmail: jest.fn().mockResolvedValue(true),
  sendListingConfirmedEmail: jest.fn().mockResolvedValue(true),
  sendDelistingConfirmedEmail: jest.fn().mockResolvedValue(true),
  sendPaymentFailedEmail: jest.fn().mockResolvedValue(true),
  sendPlanSelectedEmail: jest.fn().mockResolvedValue(true),
  sendSubscriptionCancelledEmail: jest.fn().mockResolvedValue(true),
  sendKycApprovedEmail: jest.fn().mockResolvedValue(true),
  sendKycRejectedEmail: jest.fn().mockResolvedValue(true),
  sendWalletWithdrawalEmail: jest.fn().mockResolvedValue(true),
};