// Custody Adapter Interface - All custody implementations must conform to this

import { 
  CustodyType, 
  CreditTransferOperationType, 
  CreditTransferOperation,
  CarbonAsset 
} from '../../domain/types';

export interface CustodyAdapter {
  readonly custodyType: CustodyType;
  
  // Balance queries
  getOwnedBalance(userId: string, assetId: string): Promise<number>;
  getReservedBalance(userId: string, assetId: string): Promise<number>;
  getAvailableBalance(userId: string, assetId: string): Promise<number>;
  
  // Reservation (for listings)
  reserveCredits(userId: string, assetId: string, quantity: number, listingId: string): Promise<void>;
  releaseReservation(userId: string, assetId: string, quantity: number, listingId: string): Promise<void>;
  
  // Transfers (for trades)
  executeSell(transferId: string, sellerId: string, assetId: string, quantity: number, operation: CreditTransferOperation): Promise<CreditTransferOperation>;
  executeBuy(transferId: string, buyerId: string, assetId: string, quantity: number, operation: CreditTransferOperation): Promise<CreditTransferOperation>;
  
  // Retirement
  retireCredits(userId: string, assetId: string, quantity: number, retirementId: string): Promise<{ txHash: string; logIndex: number }>;
  
  // Verification
  verifyBalance(userId: string, assetId: string): Promise<{ matches: boolean; onChain: number; db: number }>;
  
  // Asset info
  getAssetInfo(assetId: string): Promise<CarbonAsset | null>;
}

export interface CustodyAdapterConfig {
  rpcUrl: string;
  chainId: number;
  contracts: {
    marketplace: string;
    carbonCreditToken: string;
    kycRegistry: string;
    creditLedger: string;
  };
  custodyWallet: {
    address: string;
    privateKey: string;
  };
  minterWallet: {
    address: string;
    privateKey: string;
  };
}

// Error classes for custody operations
export class CustodyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly custodyType: CustodyType,
    public readonly userId: string,
    public readonly assetId: string,
    public readonly quantity?: number
  ) {
    super(message);
    this.name = 'CustodyError';
  }
}

export class InsufficientBalanceError extends CustodyError {
  constructor(custodyType: CustodyType, userId: string, assetId: string, required: number, available: number) {
    super(
      `Insufficient ${custodyType} balance: required ${required}, available ${available}`,
      'INSUFFICIENT_BALANCE',
      custodyType,
      userId,
      assetId,
      required
    );
    this.name = 'InsufficientBalanceError';
  }
}

export class ReservationConflictError extends CustodyError {
  constructor(custodyType: CustodyType, userId: string, assetId: string, listingId: string) {
    super(
      `Reservation conflict for listing ${listingId}`,
      'RESERVATION_CONFLICT',
      custodyType,
      userId,
      assetId
    );
    this.name = 'ReservationConflictError';
  }
}

export class TransferFailedError extends CustodyError {
  constructor(
    custodyType: CustodyType, 
    userId: string, 
    assetId: string, 
    quantity: number, 
    operationType: CreditTransferOperationType,
    originalError: Error
  ) {
    super(
      `${operationType} failed: ${originalError.message}`,
      'TRANSFER_FAILED',
      custodyType,
      userId,
      assetId,
      quantity
    );
    this.name = 'TransferFailedError';
  }
}

export class BalanceMismatchError extends CustodyError {
  constructor(custodyType: CustodyType, userId: string, assetId: string, onChain: number, db: number) {
    super(
      `Balance mismatch: on-chain ${onChain}, DB ${db}`,
      'BALANCE_MISMATCH',
      custodyType,
      userId,
      assetId
    );
    this.name = 'BalanceMismatchError';
  }
}

export class KYCNotVerifiedError extends CustodyError {
  constructor(custodyType: CustodyType, userId: string) {
    super(
      `User ${userId} not KYC verified on-chain`,
      'KYC_NOT_VERIFIED',
      custodyType,
      userId,
      ''
    );
    this.name = 'KYCNotVerifiedError';
  }
}

export class ContractCallError extends CustodyError {
  constructor(
    custodyType: CustodyType,
    userId: string,
    assetId: string,
    method: string,
    originalError: Error
  ) {
    super(
      `Contract call ${method} failed: ${originalError.message}`,
      'CONTRACT_CALL_FAILED',
      custodyType,
      userId,
      assetId
    );
    this.name = 'ContractCallError';
  }
}