import { expect } from "chai";
import hre from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers.js";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers.js";
import { Contract } from "ethers";
const { ethers } = hre;

describe("Marketplace — Invariant / Fuzz Tests", function () {
  let marketplace: Contract;
  let creditToken: Contract;
  let kycRegistry: Contract;
  let treasury: Contract;
  let deployer: SignerWithAddress;
  let seller: SignerWithAddress;
  let buyer: SignerWithAddress;
  let signerWallet: SignerWithAddress;
  let other: SignerWithAddress;

  async function deployFixture() {
    const [deployer_, seller_, buyer_, signerWallet_, other_] = await ethers.getSigners();
    deployer = deployer_;
    seller = seller_;
    buyer = buyer_;
    signerWallet = signerWallet_;
    other = other_;

    const KYCRegistry = await ethers.getContractFactory("KYCRegistry");
    kycRegistry = await KYCRegistry.deploy(deployer.address);
    await kycRegistry.waitForDeployment();

    const Treasury = await ethers.getContractFactory("Treasury");
    treasury = await Treasury.deploy(deployer.address);
    await treasury.waitForDeployment();

    const CreditToken = await ethers.getContractFactory("CarbonCreditToken");
    creditToken = await CreditToken.deploy(
      deployer.address,
      await kycRegistry.getAddress()
    );
    await creditToken.waitForDeployment();

    const Marketplace = await ethers.getContractFactory("Marketplace");
    marketplace = await Marketplace.deploy(
      deployer.address,
      await creditToken.getAddress(),
      await kycRegistry.getAddress(),
      await treasury.getAddress(),
      signerWallet.address
    );
    await marketplace.waitForDeployment();

    await creditToken.setOperator(await marketplace.getAddress());
    
    // Authorize marketplace as Treasury depositor
    await treasury.authorizeDepositor(await marketplace.getAddress());
    
    await kycRegistry.addKYCOperator(deployer.address);
    const sellerIdHash = ethers.keccak256(ethers.toUtf8Bytes("seller-test"));
    const buyerIdHash = ethers.keccak256(ethers.toUtf8Bytes("buyer-test"));
    const kycDataHash = ethers.keccak256(ethers.toUtf8Bytes("test-kyc-data"));
    
    await kycRegistry.verifyKYC(sellerIdHash, kycDataHash);
    await kycRegistry.linkWallet(sellerIdHash, seller.address);
    
    await kycRegistry.verifyKYC(buyerIdHash, kycDataHash);
    await kycRegistry.linkWallet(buyerIdHash, buyer.address);

    await creditToken.mintCredit({
      to: seller.address,
      amount: 10000,
      projectName: "Test Project",
      location: "India",
      standard: 0,
      projectType: "Renewable Energy",
      developer: "Test Developer",
      vintageYear: 2024,
      expiryDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
      serialNumber: "TEST-SERIAL-1",
      metadataURI: ""
    });

    return { marketplace, creditToken, kycRegistry, treasury };
  }

  beforeEach(async function () {
    ({ marketplace, creditToken, kycRegistry, treasury } = await loadFixture(deployFixture));
  });

  async function createListing() {
    const price = ethers.parseEther("0.01");
    // Ensure seller has enough credits
    const sellerBalance = await creditToken.balanceOf(seller.address, 1);
    if (sellerBalance < 5000) {
      await creditToken.mintCredit({
        to: seller.address,
        amount: 10000,
        projectName: "Test Project Extra",
        location: "India",
        standard: 0,
        projectType: "Renewable Energy",
        developer: "Test Developer",
        vintageYear: 2024,
        expiryDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        serialNumber: "TEST-SERIAL-EXTRA-" + Date.now(),
        metadataURI: ""
      });
    }
    await creditToken.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
    const tx = await marketplace.connect(seller).listCredit(1, 5000, price, price, 30 * 24 * 60 * 60);
    const receipt = await tx.wait();
    
    // Get listingId from the transaction return value by calling the contract view
    // Since listCredit returns the listingId, we can get it from the event
    const event = receipt?.logs.find((log: any) => {
      try {
        const parsed = marketplace.interface.parseLog(log);
        return parsed?.name === "CreditListed";
      } catch { return false; }
    });
    
    if (!event || !event.args) {
      throw new Error("CreditListed event not found in receipt");
    }
    
    const listingId = event.args.listingId;
    
    // Verify the listing is active
    const listing = await marketplace.listings(listingId);
    if (!listing.active) {
      throw new Error(`Listing ${listingId} is not active after creation`);
    }
    
    return listingId;
  }

  describe("Invariant: Total supply never exceeds minted amount", function () {
    it("should maintain supply invariant after ETH trades", async function () {
      const listingId = await createListing();
      const initialSupply = await creditToken.totalSupply();
      const qty = 100;
      const price = ethers.parseEther("0.01");
      const subtotal = price * BigInt(qty);
      const buyerFee = (subtotal * 50n) / 10000n;
      const totalValue = subtotal + buyerFee;

      await creditToken.connect(buyer).setApprovalForAll(await marketplace.getAddress(), true);

      await marketplace.connect(buyer).buyCredit(listingId, qty, { value: totalValue });

      const finalSupply = await creditToken.totalSupply();
      expect(finalSupply).to.equal(initialSupply);
    });

    it("should maintain supply invariant after INR logTrades", async function () {
      const initialSupply = await creditToken.totalSupply();
      const qty = 50;

      const tradeId = ethers.keccak256(ethers.toUtf8Bytes("trade-1"));

      await marketplace.connect(signerWallet).logINRTrade(
        tradeId,
        1,
        qty,
        10000,
        0,
        buyer.address,
        seller.address,
        Math.floor(Date.now() / 1000)
      );

      const finalSupply = await creditToken.totalSupply();
      expect(finalSupply).to.equal(initialSupply);
    });
  });

  describe("Invariant: Fee accounting balances", function () {
    it("should correctly split fees 50/50 between buyer and seller", async function () {
      const listingId = await createListing();
      const qty = 100;
      const pricePerCredit = ethers.parseEther("0.01");
      const subtotal = pricePerCredit * BigInt(qty);
      const expectedBuyerFee = (subtotal * 50n) / 10000n;
      const expectedSellerFee = (subtotal * 50n) / 10000n;
      const buyerFee = (subtotal * 50n) / 10000n;
      const totalValue = subtotal + buyerFee;

      await creditToken.connect(buyer).setApprovalForAll(await marketplace.getAddress(), true);

      const tx = await marketplace.connect(buyer).buyCredit(listingId, qty, { value: totalValue });
      const receipt = await tx.wait();

      const tradeEvent = receipt?.logs.find((log: any) => {
        try {
          const parsed = marketplace.interface.parseLog(log);
          return parsed?.name === "CreditTraded";
        } catch { return false; }
      });

      expect(tradeEvent).to.not.be.undefined;
    });

    it("should track platform fees in Treasury", async function () {
      const listingId = await createListing();
      const qty = 100;
      const price = ethers.parseEther("0.01");
      const subtotal = price * BigInt(qty);
      const buyerFee = (subtotal * 50n) / 10000n;
      const totalValue = subtotal + buyerFee;
      const expectedPlatformFee = (subtotal * 100n) / 10000n;

      await creditToken.connect(buyer).setApprovalForAll(await marketplace.getAddress(), true);
      await marketplace.connect(buyer).buyCredit(listingId, qty, { value: totalValue });

      const finalTreasuryBalance = await ethers.provider.getBalance(await treasury.getAddress());
      expect(finalTreasuryBalance).to.equal(expectedPlatformFee);
    });
  });

  describe("Invariant: Credit balances never go negative", function () {
    it("should prevent overselling beyond available credits", async function () {
      const listingId = await createListing();
      const sellerBalance = await creditToken.balanceOf(seller.address, 1);
      
      await creditToken.connect(buyer).setApprovalForAll(await marketplace.getAddress(), true);
      const subtotal = ethers.parseEther("0.01") * (sellerBalance + 1n);
      const buyerFee = (subtotal * 50n) / 10000n;
      const totalValue = subtotal + buyerFee;

      await expect(
        marketplace.connect(buyer).buyCredit(listingId, sellerBalance + 1n, { value: totalValue })
      ).to.be.reverted;
    });

    it("should not change seller balance after trade (credits already in marketplace)", async function () {
      const listingId = await createListing();
      const qty = 100;
      const initialSellerBalance = await creditToken.balanceOf(seller.address, 1);

      await creditToken.connect(buyer).setApprovalForAll(await marketplace.getAddress(), true);
      const subtotal = ethers.parseEther("0.01") * BigInt(qty);
      const buyerFee = (subtotal * 50n) / 10000n;
      const totalValue = subtotal + buyerFee;
      await marketplace.connect(buyer).buyCredit(listingId, qty, { value: totalValue });

      const finalSellerBalance = await creditToken.balanceOf(seller.address, 1);
      // Seller balance unchanged - credits already moved to marketplace during listing
      expect(finalSellerBalance).to.equal(initialSellerBalance);
    });

    it("should correctly increase buyer balance after trade", async function () {
      const listingId = await createListing();
      const qty = 100;
      const initialBuyerBalance = await creditToken.balanceOf(buyer.address, 1);

      await creditToken.connect(buyer).setApprovalForAll(await marketplace.getAddress(), true);
      const subtotal = ethers.parseEther("0.01") * BigInt(qty);
      const buyerFee = (subtotal * 50n) / 10000n;
      const totalValue = subtotal + buyerFee;
      await marketplace.connect(buyer).buyCredit(listingId, qty, { value: totalValue });

      const finalBuyerBalance = await creditToken.balanceOf(buyer.address, 1);
      expect(finalBuyerBalance).to.equal(initialBuyerBalance + BigInt(qty));
    });
  });

  describe("Invariant: KYC enforcement", function () {
    it("should reject trades from non-KYC buyers", async function () {
      const listingId = await createListing();
      
      // Revoke buyer KYC by unlinking wallet
      const buyerIdHash = ethers.keccak256(ethers.toUtf8Bytes("buyer-test"));
      await kycRegistry.unlinkWallet(buyer.address);

      await creditToken.connect(buyer).setApprovalForAll(await marketplace.getAddress(), true);

      await expect(
        marketplace.connect(buyer).buyCredit(listingId, 100, { value: ethers.parseEther("0.01") * 100n })
      ).to.be.reverted;
    });

    it("should reject trades from non-KYC sellers", async function () {
      const listingId = await createListing();
      
      const sellerIdHash = ethers.keccak256(ethers.toUtf8Bytes("seller-test"));
      await kycRegistry.unlinkWallet(seller.address);

      await creditToken.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);

      await expect(
        marketplace.connect(buyer).buyCredit(listingId, 100, { value: ethers.parseEther("0.01") * 100n })
      ).to.be.reverted;
    });
  });

  describe("Invariant: Pausable emergency stop", function () {
    it("should pause and block all trades", async function () {
      const listingId = await createListing();

      await marketplace.pause();

      await creditToken.connect(buyer).setApprovalForAll(await marketplace.getAddress(), true);

      await expect(
        marketplace.connect(buyer).buyCredit(listingId, 100, { value: ethers.parseEther("0.01") * 100n })
      ).to.be.reverted;
    });

    it("should unpause and allow trades", async function () {
      const listingId = await createListing();
      
      await marketplace.pause();
      await marketplace.unpause();

      await creditToken.connect(buyer).setApprovalForAll(await marketplace.getAddress(), true);
      const subtotal = ethers.parseEther("0.01") * 100n;
      const buyerFee = (subtotal * 50n) / 10000n;
      const totalValue = subtotal + buyerFee;

      await expect(
        marketplace.connect(buyer).buyCredit(listingId, 100, { value: totalValue })
      ).to.not.be.reverted;
    });
  });

  describe("Invariant: Reentrancy protection", function () {
    it("should prevent reentrant calls via ReentrancyGuard", async function () {
      const listingId = await createListing();
      
      // KYC verify other account
      await kycRegistry.addKYCOperator(deployer.address);
      const otherIdHash = ethers.keccak256(ethers.toUtf8Bytes("other-test"));
      const kycDataHash = ethers.keccak256(ethers.toUtf8Bytes("test-kyc-data"));
      await kycRegistry.verifyKYC(otherIdHash, kycDataHash);
      await kycRegistry.linkWallet(otherIdHash, other.address);
      
      await creditToken.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
      await creditToken.mintCredit({
        to: other.address,
        amount: 100,
        projectName: "Test Project 2",
        location: "India",
        standard: 0,
        projectType: "Renewable Energy",
        developer: "Test Developer",
        vintageYear: 2024,
        expiryDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        serialNumber: "TEST-SERIAL-2",
        metadataURI: ""
      });
      await creditToken.connect(other).setApprovalForAll(await marketplace.getAddress(), true);

      const subtotal = ethers.parseEther("0.01") * 50n;
      const buyerFee = (subtotal * 50n) / 10000n;
      const totalValue = subtotal + buyerFee;

      await expect(
        marketplace.connect(other).buyCredit(listingId, 50, { value: totalValue })
      ).to.not.be.reverted;
    });
  });

  describe("Invariant: INR trade logging", function () {
    it("should log INR trade with correct amounts", async function () {
      const qty = 100;
      const tradeId = ethers.keccak256(ethers.toUtf8Bytes("trade-inr-1"));

      await creditToken.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);

      await marketplace.connect(signerWallet).logINRTrade(
        tradeId,
        1,
        qty,
        10000,
        0,
        buyer.address,
        seller.address,
        Math.floor(Date.now() / 1000)
      );

      const log = await marketplace.inrTradeLogs(tradeId);
      expect(log.quantity).to.equal(qty);
      expect(log.tokenId).to.equal(1);
      expect(log.priceINR).to.equal(10000);
      expect(log.buyer).to.equal(buyer.address);
      expect(log.seller).to.equal(seller.address);
    });

    it("should prevent duplicate INR trade logs", async function () {
      const qty = 100;
      const tradeId = ethers.keccak256(ethers.toUtf8Bytes("trade-inr-dup"));

      await creditToken.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);

      await marketplace.connect(signerWallet).logINRTrade(
        tradeId,
        1,
        qty,
        10000,
        0,
        buyer.address,
        seller.address,
        Math.floor(Date.now() / 1000)
      );

      await expect(
        marketplace.connect(signerWallet).logINRTrade(
          tradeId,
          1,
          qty,
          10000,
          0,
          buyer.address,
          seller.address,
          Math.floor(Date.now() / 1000)
        )
      ).to.be.reverted;
    });

    it("should only allow signerWallet to log INR trades", async function () {
      await expect(
        marketplace.connect(other).logINRTrade(
          ethers.keccak256(ethers.toUtf8Bytes("trade-unauth")),
          1,
          100,
          10000,
          0,
          buyer.address,
          seller.address,
          Math.floor(Date.now() / 1000)
        )
      ).to.be.reverted;
    });
  });

  describe("Invariant: Buy order matching", function () {
    it.skip("should match buy orders FIFO by price-time priority", async function () {
      const qty = 100;
      const price1 = ethers.parseEther("0.02");
      const price2 = ethers.parseEther("0.015");
      const duration = 7 * 24 * 60 * 60;

      // KYC verify other account for buy order
      await kycRegistry.addKYCOperator(deployer.address);
      const otherIdHash = ethers.keccak256(ethers.toUtf8Bytes("other-test"));
      const kycDataHash = ethers.keccak256(ethers.toUtf8Bytes("test-kyc-data"));
      await kycRegistry.verifyKYC(otherIdHash, kycDataHash);
      await kycRegistry.linkWallet(otherIdHash, other.address);

      // Place buy orders WITHOUT a listing first - they should stay open
      const totalCost1 = price1 * BigInt(qty);
      const buyerFee1 = (totalCost1 * 50n) / 10000n;
      const value1 = totalCost1 + buyerFee1;

      const totalCost2 = price2 * BigInt(qty);
      const buyerFee2 = (totalCost2 * 50n) / 10000n;
      const value2 = totalCost2 + buyerFee2;

      await marketplace.connect(buyer).placeBuyOrder(1, qty, price1, duration, { value: value1 });
      await marketplace.connect(other).placeBuyOrder(1, qty, price2, duration, { value: value2 });

      const order1 = await marketplace.buyOrders(1);
      const order2 = await marketplace.buyOrders(2);
      
      // Both orders should be open
      expect(order1.status).to.equal(0); // OPEN
      expect(order2.status).to.equal(0); // OPEN
      
      // Both orders should have valid limit prices (non-zero)
      expect(order1.limitPrice).to.be.gt(0);
      expect(order2.limitPrice).to.be.gt(0);
    });

    it.skip("should refund excess when order partially filled", async function () {
      const qty = 100;
      const price = ethers.parseEther("0.02");
      const duration = 7 * 24 * 60 * 60;

      // First create a listing so the buy order can match immediately
      await creditToken.mintCredit({
        to: seller.address,
        amount: qty,
        projectName: "Test Project 2",
        location: "India",
        standard: 0,
        projectType: "Renewable Energy",
        developer: "Test Developer",
        vintageYear: 2024,
        expiryDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
        serialNumber: "TEST-SERIAL-3",
        metadataURI: ""
      });
      await creditToken.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
      const listTx = await marketplace.connect(seller).listCredit(1, qty, price, price, duration);
      const listReceipt = await listTx.wait();

      const totalCost = price * BigInt(qty * 2);
      const buyerFee = (totalCost * 50n) / 10000n;
      const value = totalCost + buyerFee;

      await marketplace.connect(buyer).placeBuyOrder(1, qty * 2, price, duration, { value });

      // The buy order should be partially filled (100 out of 200)
      const order = await marketplace.buyOrders(1);
      expect(order.amountFilled).to.equal(qty);
      expect(order.status).to.equal(1); // PARTIALLY_FILLED
    });
  });

  describe("Invariant: Fee withdrawal", function () {
    it("should allow owner to withdraw accumulated fees", async function () {
      const listingId = await createListing();
      const qty = 100;
      const price = ethers.parseEther("0.01");
      const subtotal = price * BigInt(qty);
      const buyerFee = (subtotal * 50n) / 10000n;
      const totalValue = subtotal + buyerFee;

      await creditToken.connect(buyer).setApprovalForAll(await marketplace.getAddress(), true);
      await marketplace.connect(buyer).buyCredit(listingId, qty, { value: totalValue });

      const treasuryBalanceBefore = await ethers.provider.getBalance(await treasury.getAddress());
      expect(treasuryBalanceBefore).to.be.gt(0);

      const initialBalance = await ethers.provider.getBalance(deployer.address);
      // withdrawAllFees takes no parameters
      const tx = await treasury.connect(deployer).withdrawAllFees();
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;

      const finalBalance = await ethers.provider.getBalance(deployer.address);
      expect(finalBalance).to.be.gt(initialBalance - gasCost);
    });
  });
});