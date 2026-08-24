// Adversarial Test: Retirement Immutability
// Tests that retired credits can never be transferred, listed, or un-retired

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ethers } from 'ethers';
import { CarbonCreditToken__factory, CreditLedger__factory, KYCRegistry__factory } from '../../typechain';
import { createTestUsers, cleanupTestUsers } from '../utils/test-utils.js';
import { setupContracts } from '../utils/contract-utils.js';

describe('Retirement Immutability', () => {
  let carbonCreditToken: any;
  let creditLedger: any;
  let kycRegistry: any;
  let deployer: any;
  let user1: any;
  let provider: ethers.JsonRpcProvider;
  let wallet1: ethers.Wallet;

  beforeAll(async () => {
    const contracts = await setupContracts();
    carbonCreditToken = contracts.carbonCreditToken;
    creditLedger = contracts.creditLedger;
    kycRegistry = contracts.kycRegistry;
    deployer = contracts.deployer;
    provider = contracts.provider;

    const users = await createTestUsers(1);
    user1 = users[0];

    wallet1 = new ethers.Wallet(user1.privateKey, provider);

    await kycRegistry.verifyKYC(user1.idHash, user1.kycDataHash);
    await kycRegistry.linkWallet(user1.idHash, user1.walletAddress);
  });

  it('should reject transfer of retired credits on-chain', async () => {
    // Mint 100 credits
    await carbonCreditToken.mintCredit({ to: user1.walletAddress, amount: 100, /* ... */ });

    // Retire 50 credits
    await carbonCreditToken.connect(wallet1).retireCredit(tokenId, 50);

    // Try to transfer retired credits
    await expect(
      carbonCreditToken.connect(wallet1).safeTransferFrom(
        user1.walletAddress,
        '0xOtherAddress',
        tokenId,
        10,
        '0x'
      )
    ).to.be.revertedWith('Insufficient credits');
  });

  it('should reject listing of retired credits on-chain', async () => {
    // User has 100 credits, retires 50
    await carbonCreditToken.mintCredit({ to: user1.walletAddress, amount: 100, /* ... */ });
    await carbonCreditToken.connect(wallet1).retireCredit(tokenId, 50);

    // Approve marketplace
    await carbonCreditToken.connect(wallet1).setApprovalForAll(marketplaceAddress, true);

    // Try to list remaining 50 (should work for remaining)
    // But try to list the retired 50 (should fail)
    await expect(
      marketplace.connect(wallet1).listCreditFor(
        user1.walletAddress,
        tokenId,
        50, // trying to list the retired amount
        priceEth,
        priceINR,
        duration
      )
    ).to.be.reverted; // Should fail due to insufficient balance
  });

  it('should reject ledger transfer of retired credits', async () => {
    // Mint 100 credits on-ledger
    await creditLedger.logOwnershipChange(
      user1.idHash,
      tokenId,
      100,
      0, // MINT
      refHash,
      'Initial mint'
    );

    // Retire 30 credits
    await creditLedger.logRetirement(
      user1.idHash,
      tokenId,
      30,
      refHash
    );

    // Try to transfer the retired credits
    await expect(
      creditLedger.logOwnershipChange(
        user1.idHash,
        tokenId,
        -30,
        4, // SELL
        refHash,
        'Attempt to sell retired'
      )
    ).to.be.revertedWith('Insufficient balance');
  });

  it('should reject listing of retired credits on-ledger', async () => {
    await creditLedger.logOwnershipChange(
      user1.idHash,
      tokenId,
      100,
      0, // MINT
      refHash,
      'Initial mint'
    );

    await creditLedger.logRetirement(
      user1.idHash,
      tokenId,
      50,
      refHash
    );

    // Try to list 60 (only 50 available)
    await expect(
      creditLedger.logOwnershipChange(
        user1.idHash,
        tokenId,
        -60,
        1, // LIST
        refHash,
        'Listing'
      )
    ).to.be.revertedWith('Insufficient balance');
  });

  it('should reject re-minting of retired credits', async () => {
    // Retire 50 credits
    await creditLedger.logOwnershipChange(
      user1.idHash,
      tokenId,
      100,
      0, // MINT
      refHash,
      'Initial mint'
    );
    await creditLedger.logRetirement(
      user1.idHash,
      tokenId,
      50,
      refHash
    );

    // Try to mint the same retired amount back
    await expect(
      creditLedger.logOwnershipChange(
        user1.idHash,
        tokenId,
        50, // Try to mint back retired amount
        0, // MINT
        refHash,
        'Attempt to un-retire'
      )
    ).to.not.be.reverted; // MINT is always allowed, but should not affect retired count

    // Verify retired count unchanged
    const retired = await creditLedger.getUserRetired(user1.idHash, tokenId);
    expect(retired).toBe(50);
  });
});