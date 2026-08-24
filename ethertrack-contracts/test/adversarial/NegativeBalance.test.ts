// Adversarial Test: Negative Balance Attempts
// Tests that no operation can create negative balances

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ethers } from 'ethers';
import { CarbonCreditToken__factory, CreditLedger__factory, KYCRegistry__factory } from '../../typechain';
import { createTestUsers, cleanupTestUsers } from '../utils/test-utils.js';
import { setupContracts } from '../utils/contract-utils.js';

describe('Negative Balance Attempts', () => {
  let carbonCreditToken: any;
  let creditLedger: any;
  let kycRegistry: any;
  let deployer: any;
  let user1: any;
  let user2: any;
  let provider: ethers.JsonRpcProvider;
  let wallet1: ethers.Wallet;
  let wallet2: ethers.Wallet;

  beforeAll(async () => {
    const contracts = await setupContracts();
    carbonCreditToken = contracts.carbonCreditToken;
    creditLedger = contracts.creditLedger;
    kycRegistry = contracts.kycRegistry;
    deployer = contracts.deployer;
    provider = contracts.provider;

    const users = await createTestUsers(2);
    user1 = users[0];
    user2 = users[1];

    wallet1 = new ethers.Wallet(user1.privateKey, provider);
    wallet2 = new ethers.Wallet(user2.privateKey, provider);

    // KYC verify both users
    await kycRegistry.verifyKYC(user1.idHash, user1.kycDataHash);
    await kycRegistry.linkWallet(user1.idHash, user1.walletAddress);
    await kycRegistry.verifyKYC(user2.idHash, user2.kycDataHash);
    await kycRegistry.linkWallet(user2.idHash, user2.walletAddress);
  });

  it('should reject on-chain transfer exceeding balance', async () => {
    // Mint 50 credits to user1
    await carbonCreditToken.mintCredit({ to: user1.walletAddress, amount: 50, /* ... */ });

    // Try to transfer 100 (more than balance)
    await expect(
      carbonCreditToken.connect(wallet1).safeTransferFrom(
        user1.walletAddress,
        user2.walletAddress,
        tokenId,
        100,
        '0x'
      )
    ).to.be.revertedWith('Insufficient credits');
  });

  it('should reject ledger transfer exceeding available balance', async () => {
    // User1 has 50 credits on-ledger
    await creditLedger.logOwnershipChange(
      user1.idHash,
      tokenId,
      50,
      0, // MINT
      refHash,
      'Initial mint'
    );

    // Try to list 60 credits for sale
    await expect(
      creditLedger.logOwnershipChange(
        user1.idHash,
        tokenId,
        -60, // LIST with amount > balance
        1, // LIST
        refHash,
        'Listing'
      )
    ).to.be.revertedWith('Insufficient balance');
  });

  it('should reject retirement exceeding available balance', async () => {
    // User1 has 30 credits on-ledger
    await creditLedger.logOwnershipChange(
      user1.idHash,
      tokenId,
      30,
      0, // MINT
      refHash,
      'Initial mint'
    );

    // Try to retire 50 credits
    await expect(
      creditLedger.logRetirement(
        user1.idHash,
        tokenId,
        50, // More than balance
        refHash
      )
    ).to.be.revertedWith('Insufficient balance');
  });

  it('should reject transfer from reserved credits', async () => {
    // User1 has 100 credits, creates listing for 60
    await creditLedger.logOwnershipChange(
      user1.idHash,
      tokenId,
      100,
      0, // MINT
      refHash,
      'Initial mint'
    );

    // Reserve 60 for listing
    await creditLedger.logOwnershipChange(
      user1.idHash,
      tokenId,
      -60,
      1, // LIST (reserve)
      refHash,
      'Create listing'
    );

    // Try to transfer 50 more (only 40 available)
    await expect(
      creditLedger.logOwnershipChange(
        user1.idHash,
        tokenId,
        -50,
        4, // SELL
        refHash,
        'Sell'
      )
    ).to.be.revertedWith('Insufficient balance');
  });
});