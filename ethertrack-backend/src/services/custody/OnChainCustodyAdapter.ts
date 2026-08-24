// On-Chain Custody Adapter - Interacts with Marketplace.sol and CarbonCreditToken.sol

import { ethers } from 'ethers';
import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import { 
  CustodyAdapter, 
  CustodyAdapterConfig, 
  CustodyType,
  CreditTransferOperationType,
  CreditTransferOperation,
  CarbonAsset,
  InsufficientBalanceError,
  TransferFailedError,
  KYCNotVerifiedError,
  ContractCallError,
  BalanceMismatchError
} from './CustodyAdapter';

const MARKETPLACE_ABI = [
  'function listCreditFor(address seller, uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR, uint256 duration) external returns (uint256 listingId)',
  'function cancelListingFor(address seller, uint256 listingId) external',
  'function settleINRTrade(uint256 listingId, address buyer, uint256 amount, uint256 priceINR, bytes32 tradeId, uint8 payMode, uint256 timestamp) external returns (uint256 recordedTradeId)',
  'function buyCredit(uint256 listingId, uint256 amount) external payable returns (uint256)',
  'function listings(uint256) view returns (uint256 listingId, address seller, uint256 tokenId, uint256 amount, uint256 amountRemaining, uint256 pricePerUnit, uint256 pricePerUnitINR, uint256 listedAt, uint256 expiresAt, bool active)',
  'function getSellerListings(address seller) view returns (uint256[])',
  'event CreditListed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR)',
  'event CreditTraded(uint256 indexed tradeId, uint256 indexed listingId, uint256 indexed buyOrderId, address buyer, address seller, uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR, uint256 totalPrice, uint256 buyerFee, uint256 sellerFee, uint256 totalFee, bool isAMM)',
  'event ListingCancelled(uint256 indexed listingId, address indexed seller)',
  'event INRTradeLogged(bytes32 indexed tradeId, uint256 indexed tokenId, uint256 quantity, uint256 priceINR, uint8 payMode, address buyer, address seller, bytes32 tradeHash, uint256 timestamp)',
];

const TOKEN_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
  'function getCreditMetadata(uint256 tokenId) view returns (tuple(string projectName, string location, uint8 standard, string projectType, string developer, uint256 vintageYear, uint256 expiryDate, string serialNumber, string metadataURI, bool active, address registeredBy, uint256 registeredAt))',
  'function retireCreditFor(address beneficiary, uint256 tokenId, uint256 amount) external',
  'function isExpired(uint256 tokenId) view returns (bool)',
  'function getTotalRetired(uint256 tokenId) view returns (uint256)',
  'function setApprovalForAll(address operator, bool approved) external',
  'function isApprovedForAll(address account, address operator) view returns (bool)',
  'event CreditMinted(uint256 indexed tokenId, address indexed to, uint256 amount, string projectName, uint8 standard, string serialNumber)',
  'event CreditRetired(uint256 indexed tokenId, address indexed retiredBy, uint256 amount, string projectName)',
];

const KYC_ABI = [
  'function isKYCVerified(address wallet) view returns (bool)',
  'function isKYCVerifiedById(bytes32 userIdHash) view returns (bool)',
  'function verifyKYC(bytes32 userIdHash, bytes32 kycDataHash) external',
  'function linkWallet(bytes32 userIdHash, address wallet) external',
  'function userToWallet(bytes32) view returns (address)',
];

const STANDARD_ENUM = { VCS: 0, GS: 1, CDM: 2, ACR: 3, BEE: 0 };
const STANDARD_FROM_ENUM = { 0: 'VCS', 1: 'GS', 2: 'CDM', 3: 'ACR' };

const PAY_MODE = { INR_WALLET: 0, RAZORPAY: 1 };

export class OnChainCustodyAdapter implements CustodyAdapter {
  readonly custodyType: CustodyType = 'onchain';
  
  private provider: ethers.JsonRpcProvider;
  private custodyWallet: ethers.Wallet;
  private minterWallet: ethers.Wallet;
  private marketplace: ethers.Contract;
  private token: ethers.Contract;
  private kyc: ethers.Contract;
  private config: CustodyAdapterConfig;

  constructor(config: CustodyAdapterConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.custodyWallet = new ethers.Wallet(config.custodyWallet.privateKey, this.provider);
    this.minterWallet = new ethers.Wallet(config.minterWallet.privateKey, this.provider);
    
    this.marketplace = new ethers.Contract(config.contracts.marketplace, MARKETPLACE_ABI, this.custodyWallet);
    this.token = new ethers.Contract(config.contracts.carbonCreditToken, TOKEN_ABI, this.custodyWallet);
    this.kyc = new ethers.Contract(config.contracts.kycRegistry, KYC_ABI, this.custodyWallet);
  }

  async getOwnedBalance(userId: string, assetId: string): Promise<number> {
    const { rows } = await query(
      `SELECT cb.token_id, u.wallet_address
       FROM carbon_batches cb
       JOIN users u ON u.id = cb.user_id
       WHERE cb.user_id = $1 AND cb.asset_id = $2 AND cb.admin_status = 'approved'
       LIMIT 1`,
      [userId, assetId]
    );
    
    if (!rows.length) return 0;
    
    const walletAddress = rows[0].wallet_address;
    if (!walletAddress) return 0;
    
    const tokenId = rows[0].token_id;
    const balance = await this.token.balanceOf(walletAddress, tokenId);
    return Number(balance);
  }

  async getReservedBalance(userId: string, assetId: string): Promise<number> {
    const { rows } = await query(
      `SELECT COALESCE(SUM(l.remaining_quantity), 0) as reserved
       FROM listings l
       JOIN ownership_positions op ON op.position_id = l.position_id
       WHERE op.owner_id = $1 AND op.asset_id = $2 AND op.custody_type = 'onchain'
         AND l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at > NOW())`,
      [userId, assetId]
    );
    return Number(rows[0]?.reserved || 0);
  }

  async getAvailableBalance(userId: string, assetId: string): Promise<number> {
    const owned = await this.getOwnedBalance(userId, assetId);
    const reserved = await this.getReservedBalance(userId, assetId);
    return Math.max(0, owned - reserved);
  }

  async reserveCredits(userId: string, assetId: string, quantity: number, listingId: string): Promise<void> {
    const { rows } = await query(
      `SELECT op.position_id, u.wallet_address, cb.token_id
       FROM ownership_positions op
       JOIN users u ON u.id = op.owner_id
       JOIN carbon_batches cb ON cb.asset_id = op.asset_id
       WHERE op.owner_id = $1 AND op.asset_id = $2 AND op.custody_type = 'onchain'
       LIMIT 1`,
      [userId, assetId]
    );
    
    if (!rows.length) {
      throw new InsufficientBalanceError(this.custodyType, userId, assetId, quantity, 0);
    }
    
    const walletAddress = rows[0].wallet_address;
    const tokenId = rows[0].token_id;
    
    if (!walletAddress) {
      throw new KYCNotVerifiedError(this.custodyType, userId);
    }
    
    // Check on-chain balance
    const balance = await this.token.balanceOf(walletAddress, tokenId);
    if (Number(balance) < quantity) {
      throw new InsufficientBalanceError(this.custodyType, userId, assetId, quantity, Number(balance));
    }
    
    // Check approval
    const isApproved = await this.token.isApprovedForAll(walletAddress, this.config.contracts.marketplace);
    if (!isApproved) {
      throw new ContractCallError(this.custodyType, userId, assetId, 'isApprovedForAll', 
        new Error('Seller must approve Marketplace for all tokens first'));
    }
    
    // Reservation is tracked in DB listings table, no on-chain action needed at reservation time
    // The actual escrow happens at listing creation
  }

  async releaseReservation(userId: string, assetId: string, quantity: number, listingId: string): Promise<void> {
    const { rows } = await query(
      `SELECT l.onchain_listing_id, u.wallet_address
       FROM listings l
       JOIN users u ON u.id = l.seller_id
       WHERE l.listing_id = $1 AND l.seller_id = $2 AND l.custody_type = 'onchain'`,
      [listingId, userId]
    );
    
    if (!rows.length || !rows[0].onchain_listing_id) {
      // No on-chain listing to cancel, just DB cleanup
      return;
    }
    
    const onchainListingId = rows[0].onchain_listing_id;
    const walletAddress = rows[0].wallet_address;
    
    try {
      const tx = await this.marketplace.cancelListingFor(walletAddress, onchainListingId);
      const receipt = await tx.wait();
      if (receipt.status !== 1) {
        throw new Error(`cancelListingFor reverted: ${tx.hash}`);
      }
    } catch (error) {
      throw new TransferFailedError(this.custodyType, userId, assetId, quantity, 'ESCROW_RELEASE', error as Error);
    }
  }

  async executeSell(
    transferId: string, 
    sellerId: string, 
    assetId: string, 
    quantity: number, 
    operation: CreditTransferOperation
  ): Promise<CreditTransferOperation> {
    // For on-chain custody, the SELL side is handled by the Marketplace contract
    // when the buyer calls buyCredit() or settleINRTrade()
    // The seller's credits are already in escrow from listing creation
    
    return {
      ...operation,
      status: 'CONFIRMED',
      confirmedAt: new Date()
    };
  }

  async executeBuy(
    transferId: string, 
    buyerId: string, 
    assetId: string, 
    quantity: number, 
    operation: CreditTransferOperation
  ): Promise<CreditTransferOperation> {
    const { rows } = await query(
      `SELECT l.onchain_listing_id, l.price_per_unit, l.price_per_unit_inr, u.wallet_address, cb.token_id
       FROM listings l
       JOIN users u ON u.id = l.buyer_id
       JOIN carbon_batches cb ON cb.asset_id = l.asset_id
       WHERE l.listing_id = $1 AND l.custody_type = 'onchain'
       LIMIT 1`,
      [operation.operationId] // Using operationId to link to listing
    );
    
    if (!rows.length || !rows[0].onchain_listing_id) {
      throw new TransferFailedError(this.custodyType, buyerId, assetId, quantity, 'ERC1155_TRANSFER', 
        new Error('No on-chain listing found for buy operation'));
    }
    
    const onchainListingId = rows[0].onchain_listing_id;
    const buyerWallet = rows[0].wallet_address;
    const pricePerUnit = rows[0].price_per_unit;
    const pricePerUnitINR = rows[0].price_per_unit_inr;
    const tokenId = rows[0].token_id;
    
    if (!buyerWallet) {
      throw new KYCNotVerifiedError(this.custodyType, buyerId);
    }
    
    try {
      let tx: ethers.ContractTransactionResponse;
      let receipt: ethers.ContractTransactionReceipt;
      
      if (operation.type === 'ERC1155_TRANSFER') {
        // Direct ETH purchase via MetaMask - already executed on-chain
        // This is just confirmation
        return { ...operation, status: 'CONFIRMED', confirmedAt: new Date() };
      } else if (operation.type === 'ESCROW_RELEASE') {
        // INR/Razorpay settlement - backend executes settleINRTrade
        const tradeIdHash = ethers.keccak256(ethers.toUtf8Bytes(transferId));
        const payMode = operation.custodyType === 'ledger' ? PAY_MODE.RAZORPAY : PAY_MODE.INR_WALLET;
        
        tx = await this.marketplace.settleINRTrade(
          onchainListingId,
          buyerWallet,
          quantity,
          pricePerUnitINR,
          tradeIdHash,
          payMode,
          Math.floor(Date.now() / 1000)
        );
        receipt = await tx.wait();
        
        if (receipt.status !== 1) {
          throw new Error(`settleINRTrade reverted: ${tx.hash}`);
        }
      }
      
      return {
        ...operation,
        blockchainTxHash: tx?.hash,
        blockchainLogIndex: receipt?.logs.findIndex(l => {
          try {
            const parsed = this.marketplace.interface.parseLog(l);
            return parsed?.name === 'CreditTraded' || parsed?.name === 'INRTradeLogged';
          } catch { return false; }
        }) ?? 0,
        chainId: this.config.chainId,
        contractAddress: this.config.contracts.marketplace,
        status: 'CONFIRMED',
        confirmedAt: new Date()
      };
    } catch (error) {
      throw new TransferFailedError(this.custodyType, buyerId, assetId, quantity, operation.type, error as Error);
    }
  }

  async retireCredits(userId: string, assetId: string, quantity: number, retirementId: string): Promise<{ txHash: string; logIndex: number }> {
    const { rows } = await query(
      `SELECT u.wallet_address, cb.token_id
       FROM carbon_batches cb
       JOIN users u ON u.id = cb.user_id
       WHERE cb.user_id = $1 AND cb.asset_id = $2 AND cb.admin_status = 'approved'
       LIMIT 1`,
      [userId, assetId]
    );
    
    if (!rows.length || !rows[0].wallet_address) {
      throw new KYCNotVerifiedError(this.custodyType, userId);
    }
    
    const walletAddress = rows[0].wallet_address;
    const tokenId = rows[0].token_id;
    
    // Check balance
    const balance = await this.token.balanceOf(walletAddress, tokenId);
    if (Number(balance) < quantity) {
      throw new InsufficientBalanceError(this.custodyType, userId, assetId, quantity, Number(balance));
    }
    
    // Check KYC
    const isVerified = await this.kyc.isKYCVerified(walletAddress);
    if (!isVerified) {
      throw new KYCNotVerifiedError(this.custodyType, userId);
    }
    
    try {
      const tx = await this.token.retireCreditFor(walletAddress, tokenId, quantity);
      const receipt = await tx.wait();
      
      if (receipt.status !== 1) {
        throw new Error(`retireCreditFor reverted: ${tx.hash}`);
      }
      
      const logIndex = receipt.logs.findIndex(l => {
        try {
          const parsed = this.token.interface.parseLog(l);
          return parsed?.name === 'CreditRetired';
        } catch { return false; }
      });
      
      return { txHash: tx.hash, logIndex: Math.max(0, logIndex) };
    } catch (error) {
      throw new TransferFailedError(this.custodyType, userId, assetId, quantity, 'LEDGER_BUY', error as Error);
    }
  }

  async verifyBalance(userId: string, assetId: string): Promise<{ matches: boolean; onChain: number; db: number }> {
    const { rows } = await query(
      `SELECT op.owned_quantity, op.reserved_quantity, u.wallet_address, cb.token_id
       FROM ownership_positions op
       JOIN users u ON u.id = op.owner_id
       JOIN carbon_batches cb ON cb.asset_id = op.asset_id
       WHERE op.owner_id = $1 AND op.asset_id = $2 AND op.custody_type = 'onchain'
       LIMIT 1`,
      [userId, assetId]
    );
    
    if (!rows.length || !rows[0].wallet_address) {
      return { matches: false, onChain: 0, db: 0 };
    }
    
    const walletAddress = rows[0].wallet_address;
    const tokenId = rows[0].token_id;
    const dbOwned = Number(rows[0].owned_quantity);
    
    const onChainBalance = await this.token.balanceOf(walletAddress, tokenId);
    const onChain = Number(onChainBalance);
    
    return {
      matches: onChain === dbOwned,
      onChain,
      db: dbOwned
    };
  }

  async getAssetInfo(assetId: string): Promise<CarbonAsset | null> {
    const { rows } = await query(
      `SELECT ca.*, cb.token_id
       FROM carbon_assets ca
       JOIN carbon_batches cb ON cb.asset_id = ca.asset_id
       WHERE ca.asset_id = $1
       LIMIT 1`,
      [assetId]
    );
    
    if (!rows.length) return null;
    
    const row = rows[0];
    return {
      assetId: row.asset_id,
      tokenId: row.token_id,
      projectId: row.project_id,
      registry: row.registry,
      vintage: row.vintage,
      methodology: row.methodology,
      serialNumber: row.serial_number,
      totalSupply: row.total_supply,
      retiredSupply: row.retired_supply,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // Helper methods for event processing
  getMarketplaceContract(): ethers.Contract {
    return this.marketplace;
  }

  getTokenContract(): ethers.Contract {
    return this.token;
  }

  getKYCContract(): ethers.Contract {
    return this.kyc;
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  getCustodyWalletAddress(): string {
    return this.custodyWallet.address;
  }
}