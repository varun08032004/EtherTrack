// Adversarial Test: KYC Bypass Attempts
// Tests that KYC cannot be bypassed through contract interactions

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ethers } from 'ethers';
import { CarbonCreditToken__factory, KYCRegistry__factory } from '../../typechain';
import { createTestUsers, cleanupTestUsers } from '../utils/test-utils.js';
import { setupContracts } from '../utils/contract-utils.js';

describe('KYC Bypass Attempts', () => {
  let carbonCreditToken: any;
  let kycRegistry: any;
  let deployer: any;
  let user1: any;
  let user2: any;
  let maliciousContract: any;
  let provider: ethers.JsonRpcProvider;
  let wallet1: ethers.Wallet;
  let wallet2: ethers.Wallet;

  beforeAll(async () => {
    const contracts = await setupContracts();
    carbonCreditToken = contracts.carbonCreditToken;
    kycRegistry = contracts.kycRegistry;
    deployer = contracts.deployer;
    provider = contracts.provider;

    // Create test users with wallets
    const users = await createTestUsers(2);
    user1 = users[0];
    user2 = users[1];

    wallet1 = new ethers.Wallet(user1.privateKey, provider);
    wallet2 = new ethers.Wallet(user2.privateKey, provider);

    // KYC verify user1 only
    await kycRegistry.verifyKYC(user1.idHash, user1.kycDataHash);
    await kycRegistry.linkWallet(user1.idHash, user1.walletAddress);
  });

  afterAll(async () => {
    // Cleanup handled by test framework
  });

  it('should reject transfer from non-KYC EOA to KYC EOA', async () => {
    // Mint credits to user1 (KYC verified)
    await carbonCreditToken.mintCredit({
      to: user1.walletAddress,
      amount: 100,
      // ... other params
    });

    // user2 (non-KYC) tries to receive transfer from user1
    await expect(
      carbonCreditToken.connect(wallet1).safeTransferFrom(
        user1.walletAddress,
        user2.walletAddress,
        tokenId,
        10,
        '0x'
      )
    ).to.be.revertedWith('Receiver not KYC verified');
  });

  it('should reject transfer from KYC EOA to non-KYC EOA', async () => {
    // user1 (KYC) tries to send to user2 (non-KYC)
    await expect(
      carbonCreditToken.connect(wallet1).safeTransferFrom(
        user1.walletAddress,
        user2.walletAddress,
        tokenId,
        10,
        '0x'
      )
    ).to.be.revertedWith('Receiver not KYC verified');
  });

  it('should reject transfer from non-KYC contract to KYC EOA', async () => {
    // Deploy malicious contract
    const MaliciousContract = await ethers.getContractFactory('MaliciousReceiver');
    maliciousContract = await MaliciousContract.deploy(carbonCreditToken.target);
    await maliciousContract.waitForDeployment();

    // Mint to malicious contract (admin)
    await carbonCreditToken.mintCredit({
      to: maliciousContract.target,
      amount: 100,
      // ...
    });

    // Contract tries to transfer to KYC user
    await expect(
      maliciousContract.attackTransfer(user1.walletAddress, tokenId, 10)
    ).to.be.revertedWith('Sender not KYC verified');
  });

  it('should reject transfer from KYC EOA to non-KYC contract', async () => {
    // Deploy malicious contract
    const MaliciousContract = await ethers.getContractFactory('MaliciousReceiver');
    maliciousContract = await MaliciousContract.deploy(carbonCreditToken.target);
    await maliciousContract.waitForDeployment();

    // KYC user tries to transfer to malicious contract
    await expect(
      carbonCreditToken.connect(wallet1).safeTransferFrom(
        user1.walletAddress,
        maliciousContract.target,
        tokenId,
        10,
        '0x'
      )
    ).to.be.revertedWith('Receiver not KYC verified');
  });

  it('should allow transfer to approved contract', async () => {
    // Deploy legitimate contract (e.g., Marketplace)
    const Marketplace = await ethers.getContractFactory('MarketplaceUpgradeable');
    marketplace = await Marketplace.deploy(/* ... */);
    await marketplace.waitForDeployment();

    // Approve marketplace as receiver
    await carbonCreditToken.setApprovedReceiver(marketplace.target, true);

    // KYC user transfers to approved marketplace
    await expect(
      carbonCreditToken.connect(wallet1).safeTransferFrom(
        user1.walletAddress,
        marketplace.target,
        tokenId,
        10,
        '0x'
      )
    ).to.not.be.reverted;
  });
});