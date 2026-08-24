// Canonical Domain Types - Single Source of Truth
// All services must use these types

export type CustodyType = 'onchain' | 'ledger';
export type Currency = 'INR' | 'ETH';
export type ListingStatus = 'active' | 'filled' | 'cancelled' | 'expired';
export type TradeSettlementState = 
  | 'CREATED'
  | 'VALIDATED'
  | 'FUNDS_RESERVED'
  | 'CREDITS_RESERVED'
  | 'SETTLEMENT_PENDING'
  | 'CREDIT_TRANSFER_SUBMITTED'
  | 'CREDIT_TRANSFER_CONFIRMED'
  | 'PAYMENT_SETTLED'
  | 'FEES_COLLECTED'
  | 'SELLER_PAID'
  | 'BUYER_CREDITED'
  | 'SETTLED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REQUIRES_RECONCILIATION';

export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'SETTLED' | 'FAILED' | 'REFUNDED' | 'REVERSED';
export type PaymentMode = 'inr_wallet' | 'razorpay' | 'eth' | 'razorpay_transfer';
export type PaymentProvider = 'razorpay' | 'ethereum' | 'internal';

export type CreditTransferStatus = 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'REQUIRES_RECONCILIATION';
export type CreditTransferOperationType = 
  | 'ESCROW_RELEASE'
  | 'ERC1155_TRANSFER'
  | 'LEDGER_SELL'
  | 'LEDGER_BUY'
  | 'CUSTODY_WALLET_MOVE';

export type FeeType = 'BUYER_TRANSACTION_FEE' | 'SELLER_TRANSACTION_FEE';
export type TaxType = 'CGST_SGST' | 'IGST';

export type SettlementOperationType = 
  | 'VALIDATE'
  | 'RESERVE_FUNDS'
  | 'RESERVE_CREDITS'
  | 'SUBMIT_CHAIN'
  | 'CONFIRM_CHAIN'
  | 'SETTLE_PAYMENT'
  | 'COLLECT_FEES'
  | 'PAY_SELLER'
  | 'CREDIT_BUYER'
  | 'COMPENSATE'
  | 'RECONCILE';

export type SettlementOperationContext = 'buyer' | 'seller' | 'platform' | 'both';
export type SettlementOperationStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'COMPENSATED';

export type BlockchainEventStatus = 'PENDING' | 'PROCESSED' | 'FAILED' | 'DUPLICATE';
export type GHGScope = 1 | 2 | 3;

export interface CarbonAsset {
  assetId: string;
  tokenId: number;
  projectId: string;
  registry: 'VCS' | 'GS' | 'CDM' | 'ACR' | 'BEE';
  vintage: number;
  methodology: string;
  serialNumber: string;
  totalSupply: number;
  retiredSupply: number;
  status: 'active' | 'expired' | 'depleted';
  createdAt: Date;
  updatedAt: Date;
}

export interface OwnershipPosition {
  positionId: string;
  ownerId: string;
  assetId: string;
  custodyType: CustodyType;
  ownedQuantity: number;
  reservedQuantity: number;
  status: 'active' | 'frozen' | 'exhausted';
  createdAt: Date;
  updatedAt: Date;
}

export interface Listing {
  listingId: string;
  positionId: string;
  assetId: string;
  sellerId: string;
  custodyType: CustodyType;
  quantity: number;
  remainingQuantity: number;
  pricePerUnit: number;
  currency: Currency;
  buyerFeeBps: number;
  sellerFeeBps: number;
  status: ListingStatus;
  expiresAt: Date | null;
  onchainListingId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Trade {
  tradeId: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  assetId: string;
  sellerCustodyType: CustodyType;
  buyerCustodyType: CustodyType;
  quantity: number;
  executionPrice: number;
  currency: Currency;
  buyerGross: number;
  sellerGross: number;
  buyerFeeBps: number;
  sellerFeeBps: number;
  paymentId: string | null;
  creditTransferId: string | null;
  buyerFeeId: string | null;
  sellerFeeId: string | null;
  settlementState: TradeSettlementState;
  idempotencyKey: string;
  createdAt: Date;
  settledAt: Date | null;
  updatedAt: Date;
}

export interface Payment {
  paymentId: string;
  tradeId: string;
  payerId: string;
  payeeId: string;
  amount: number;
  currency: Currency;
  paymentMode: PaymentMode;
  provider: PaymentProvider;
  providerReference: string | null;
  status: PaymentStatus;
  idempotencyKey: string;
  createdAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface PaymentAttempt {
  attemptId: string;
  paymentId: string;
  providerReference: string | null;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface CreditTransfer {
  transferId: string;
  tradeId: string;
  assetId: string;
  quantity: number;
  fromCustodyType: CustodyType;
  toCustodyType: CustodyType;
  status: CreditTransferStatus;
  idempotencyKey: string;
  createdAt: Date;
  completedAt: Date | null;
  updatedAt: Date;
}

export interface CreditTransferOperation {
  operationId: string;
  transferId: string;
  type: CreditTransferOperationType;
  custodyType: CustodyType;
  fromAddress: string | null;
  toAddress: string | null;
  blockchainTxHash: string | null;
  blockchainLogIndex: number | null;
  chainId: number | null;
  contractAddress: string | null;
  status: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
  errorMessage: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}

export interface Fee {
  feeId: string;
  tradeId: string;
  type: FeeType;
  amount: number;
  currency: 'INR';
  taxAmount: number;
  taxType: TaxType;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  status: 'PENDING' | 'COLLECTED' | 'FAILED';
  collectedAt: Date | null;
  createdAt: Date;
}

export interface PlatformFee {
  platformFeeId: string;
  tradeId: string;
  buyerFeeAmount: number;
  sellerFeeAmount: number;
  totalFeeAmount: number;
  gstAmount: number;
  platformNetAmount: number;
  feeEth: number | null;
  ethRate: number | null;
  paymentMode: PaymentMode;
  status: 'collected' | 'pending' | 'failed';
  gstType: TaxType;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  razorpayPaymentId: string | null;
  createdAt: Date;
}

export interface SettlementOperation {
  operationId: string;
  tradeId: string;
  type: SettlementOperationType;
  custodyContext: SettlementOperationContext;
  status: SettlementOperationStatus;
  inputData: Record<string, any>;
  outputData: Record<string, any> | null;
  errorMessage: string | null;
  idempotencyKey: string;
  startedAt: Date;
  completedAt: Date | null;
}

export interface WalletTransaction {
  transactionId: string;
  userId: string;
  type: 'credit' | 'debit';
  method: PaymentMode | 'system';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reference: string;
  tradeId: string | null;
  paymentId: string | null;
  feeId: string | null;
  notes: string | null;
  status: 'pending' | 'success' | 'failed';
  createdAt: Date;
}

export interface Retirement {
  retirementId: string;
  positionId: string;
  assetId: string;
  ownerId: string;
  quantity: number;
  custodyType: CustodyType;
  scope: GHGScope;
  beneficiaryName: string | null;
  beneficiaryEntity: string | null;
  beneficiaryGstin: string | null;
  reportingStandard: string;
  purpose: string;
  certificateId: string;
  blockchainTxHash: string | null;
  blockchainLogIndex: number | null;
  chainId: number | null;
  contractAddress: string | null;
  status: 'pending' | 'completed' | 'failed';
  retiredAt: Date;
  createdAt: Date;
}

export interface BlockchainEvent {
  eventId: string;
  chainId: number;
  contractAddress: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  eventName: string;
  decodedArgs: Record<string, any>;
  processedAt: Date | null;
  processingStatus: BlockchainEventStatus;
  errorMessage: string | null;
  idempotencyKey: string;
  createdAt: Date;
}

export interface OutboxEvent {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, any>;
  metadata: Record<string, any>;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface TaxContext {
  buyerGstin: string | null;
  sellerGstin: string | null;
  platformGstin: string;
  placeOfSupply: string;
  transactionType: 'B2B' | 'B2C' | 'EXPORT';
}

export interface TaxBreakdown {
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  taxRate: number;
  hsCode: string;
  explanation: string;
}

export interface Quote {
  quoteId: string;
  listingId: string;
  quantity: number;
  executionPrice: number;
  currency: Currency;
  buyerGross: number;
  buyerFee: number;
  buyerTax: number;
  buyerTotalDebit: number;
  sellerGross: number;
  sellerFee: number;
  sellerTax: number;
  sellerNetCredit: number;
  platformRevenue: number;
  platformTaxLiability: number;
  expiresAt: Date;
  idempotencyKey: string;
}

export interface MarketListingParams {
  standard?: string;
  projectType?: string;
  custodyType?: CustodyType;
  sortBy?: 'priceAsc' | 'priceDesc' | 'amount' | 'vintage' | 'name' | 'recent';
  cursor?: string;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

// Derived/computed properties (not stored in DB)
export function getAvailableQuantity(position: OwnershipPosition): number {
  return position.ownedQuantity - position.reservedQuantity;
}

export function validatePositionInvariant(position: OwnershipPosition): boolean {
  return position.ownedQuantity >= position.reservedQuantity && position.reservedQuantity >= 0;
}

export function validateListingInvariant(listing: Listing): boolean {
  return listing.remainingQuantity <= listing.quantity && listing.remainingQuantity >= 0 && listing.quantity > 0;
}