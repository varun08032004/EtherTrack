# Phase 1: Financial Invariants Definition (Revised)

**Date:** 2026-08-18  
**Status:** Complete — Incorporating Review Feedback

---

## 1. Canonical Domain Model

### 1.1 Carbon Asset (Immutable Provenance)
```typescript
interface CarbonAsset {
  assetId: string;           // UUID
  tokenId: number;           // On-chain token ID (ERC-1155)
  projectId: string;         // Project UUID
  registry: 'VCS' | 'GS' | 'CDM' | 'ACR' | 'BEE';
  vintage: number;           // Year
  methodology: string;
  serialNumber: string;      // Registry serial (unique per asset)
  totalSupply: number;       // Total credits minted for this asset
  retiredSupply: number;     // Credits permanently retired
  status: 'active' | 'expired' | 'depleted';
  createdAt: Date;
}
```

**Invariant:** `retiredSupply <= totalSupply`

---

### 1.2 Ownership Position (Mutable State) — **FIXED: ownedQuantity semantics**

```typescript
interface OwnershipPosition {
  positionId: string;        // UUID
  ownerId: string;           // User UUID
  assetId: string;           // CarbonAsset.assetId
  custodyType: 'onchain' | 'ledger';
  
  // Owned = credits minted to this custody type for this owner/asset
  // This is the authoritative "what the user holds" in this custody
  ownedQuantity: number;     
  
  // Reserved = credits committed to ACTIVE listings (not filled, not cancelled)
  // Derived from listings, but cached here for locking/validation
  reservedQuantity: number;  
  
  // Available = owned - reserved (DERIVED, never stored)
  // Represents credits the user can freely transfer/list/retire RIGHT NOW
  // availableQuantity = ownedQuantity - reservedQuantity
  
  status: 'active' | 'frozen' | 'exhausted';
  createdAt: Date;
  updatedAt: Date;
}
```

**Core Invariant (MUST hold at all times):**
```
ownedQuantity >= reservedQuantity >= 0
// availableQuantity is DERIVED: ownedQuantity - reservedQuantity
```

**Enforcement:**
- Database CHECK constraint: `owned_quantity >= reserved_quantity`
- Application-level: Row-level locking (`FOR UPDATE`) on position during any mutation
- Trigger: `UPDATE` on position validates invariant before commit
- **Reconciliation job:** `position.reservedQuantity = SUM(active listing.remainingQuantity for position)`

---

### 1.3 Listing (First-Class Market Object) — **FIXED: Listing Invariant**

```typescript
interface Listing {
  listingId: string;         // UUID
  positionId: string;        // OwnershipPosition.positionId (FK)
  assetId: string;           // CarbonAsset.assetId (denormalized)
  sellerId: string;          // User UUID (denormalized)
  custodyType: 'onchain' | 'ledger';
  quantity: number;          // Total credits in this listing (original amount)
  remainingQuantity: number; // Credits still available to buy (decrements on fills)
  pricePerUnit: number;      // Minor units (paise for INR, wei for ETH)
  currency: 'INR' | 'ETH';
  buyerFeeBps: number;       // Platform fee charged to buyer (basis points)
  sellerFeeBps: number;      // Platform fee charged to seller (basis points)
  status: 'active' | 'filled' | 'cancelled' | 'expired';
  expiresAt: Date | null;
  onchainListingId: number | null;  // Marketplace.sol listing ID (if onchain)
  createdAt: Date;
  updatedAt: Date;
}
```

**Listing Invariants:**
```
remainingQuantity <= quantity
remainingQuantity >= 0
quantity > 0
```

**Cross-Reference Invariant (FIXED):**
```
position.reservedQuantity = SUM(active listing.remainingQuantity for position)
```

This is the **single source of truth** for reserved quantity. Not `<=`, but `=`.

---

### 1.4 Decomposed Settlement Entities — **NEW: Separate Trade, Payment, CreditTransfer, Fee, SettlementOperation**

#### 1.4.1 Trade (The Commercial Agreement)
```typescript
interface Trade {
  tradeId: string;           // UUID
  listingId: string;         // Listing.listingId (FK)
  buyerId: string;           // User UUID
  sellerId: string;          // User UUID
  assetId: string;           // CarbonAsset.assetId
  
  // Custody types are SEPARATE for buyer and seller — **FIXED**
  sellerCustodyType: 'onchain' | 'ledger';
  buyerCustodyType: 'onchain' | 'ledger';
  
  quantity: number;          // Credits transferred
  executionPrice: number;    // Minor units per credit
  currency: 'INR' | 'ETH';
  
  // Commercial terms (immutable once trade created)
  buyerGross: number;        // quantity * executionPrice
  sellerGross: number;       // = buyerGross
  buyerFeeBps: number;
  sellerFeeBps: number;
  
  // References to child entities
  paymentId: string | null;           // Payment.paymentId
  creditTransferId: string | null;    // CreditTransfer.transferId
  buyerFeeId: string | null;          // Fee.feeId
  sellerFeeId: string | null;         // Fee.feeId
  
  settlementState: SettlementState;   // See §4
  idempotencyKey: string;             // **FIXED: Globally unique**
  createdAt: Date;
  settledAt: Date | null;
}
```

#### 1.4.2 Payment (Fiat/Crypto Money Movement)
```typescript
interface Payment {
  paymentId: string;         // UUID
  tradeId: string;           // Trade.tradeId (FK)
  payerId: string;           // User UUID (buyer)
  payeeId: string;           // User UUID (seller) — for direct payouts
  amount: number;            // Minor units (paise for INR, wei for ETH)
  currency: 'INR' | 'ETH';
  paymentMode: 'inr_wallet' | 'razorpay' | 'eth' | 'razorpay_transfer';
  
  // Provider references
  providerReference: string | null;   // razorpay_order_id / razorpay_payment_id / tx_hash
  provider: 'razorpay' | 'ethereum' | 'internal';
  
  // State machine
  status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'SETTLED' | 'FAILED' | 'REFUNDED' | 'REVERSED';
  
  // Attempts for idempotency
  attempts: PaymentAttempt[];
  
  createdAt: Date;
  completedAt: Date | null;
}

interface PaymentAttempt {
  attemptId: string;
  paymentId: string;
  providerReference: string | null;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}
```

#### 1.4.3 CreditTransfer (Ownership Movement)
```typescript
interface CreditTransfer {
  transferId: string;        // UUID
  tradeId: string;           // Trade.tradeId (FK)
  assetId: string;           // CarbonAsset.assetId
  quantity: number;          // Credits transferred
  
  // **FIXED: Separate custody types**
  fromCustodyType: 'onchain' | 'ledger';
  toCustodyType: 'onchain' | 'ledger';
  
  // Blockchain/Ledger operation(s)
  operations: CreditTransferOperation[];
  
  status: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'REQUIRES_RECONCILIATION';
  createdAt: Date;
  completedAt: Date | null;
}

interface CreditTransferOperation {
  operationId: string;
  transferId: string;
  type: 'ESCROW_RELEASE' | 'ERC1155_TRANSFER' | 'LEDGER_SELL' | 'LEDGER_BUY' | 'CUSTODY_WALLET_MOVE';
  custodyType: 'onchain' | 'ledger';
  fromAddress: string | null;      // Wallet address or userIdHash
  toAddress: string | null;        // Wallet address or userIdHash
  blockchainTxHash: string | null;
  blockchainLogIndex: number | null;  // **FIXED: Part of event identity**
  chainId: number;                 // **FIXED: Part of event identity**
  contractAddress: string;         // **FIXED: Part of event identity**
  status: 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
  errorMessage: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
}
```

#### 1.4.4 Fee (Platform Revenue)
```typescript
interface Fee {
  feeId: string;             // UUID
  tradeId: string;           // Trade.tradeId (FK)
  type: 'BUYER_TRANSACTION_FEE' | 'SELLER_TRANSACTION_FEE';
  amount: number;            // Minor units
  currency: 'INR';           // Fees always accounted in INR
  taxAmount: number;         // GST on this fee
  taxType: 'CGST_SGST' | 'IGST';
  status: 'PENDING' | 'COLLECTED' | 'FAILED';
  collectedAt: Date | null;
}
```

#### 1.4.5 SettlementOperation (Audit Trail)
```typescript
interface SettlementOperation {
  operationId: string;
  tradeId: string;
  type: 'VALIDATE' | 'RESERVE_FUNDS' | 'RESERVE_CREDITS' | 'SUBMIT_CHAIN' | 'CONFIRM_CHAIN' | 'SETTLE_PAYMENT' | 'COLLECT_FEES' | 'PAY_SELLER' | 'CREDIT_BUYER' | 'COMPENSATE' | 'RECONCILE';
  custodyContext: 'buyer' | 'seller' | 'platform' | 'both';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'COMPENSATED';
  input: Record<string, any>;
  output: Record<string, any> | null;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
}
```

---

### 1.5 Settlement State Machine — **FIXED: Custody-Independent**

```typescript
type SettlementState =
  | 'CREATED'                      // Trade record created
  | 'VALIDATED'                    // Preconditions checked (KYC, balances, listing active)
  | 'FUNDS_RESERVED'               // Payment authorized/locked (INR wallet / Razorpay / ETH escrow)
  | 'CREDITS_RESERVED'             // Listing remainingQuantity decremented, position reserved updated
  | 'SETTLEMENT_PENDING'           // Ready for credit transfer submission
  | 'CREDIT_TRANSFER_SUBMITTED'    // Blockchain/ledger operation(s) sent
  | 'CREDIT_TRANSFER_CONFIRMED'    // Credit transfer finalized on-chain/ledger
  | 'PAYMENT_SETTLED'              // Payment captured, seller payable created
  | 'FEES_COLLECTED'               // Platform fees recorded
  | 'SELLER_PAID'                  // Seller net proceeds credited
  | 'BUYER_CREDITED'               // Buyer ownership position created/updated
  | 'SETTLED'                      // All steps complete, immutable
  | 'FAILED'                       // Terminal failure, compensation executed
  | 'CANCELLED'                    // Cancelled before FUNDS_RESERVED
  | 'EXPIRED'                      // Quote/listing expired
  | 'REQUIRES_RECONCILIATION';     // Inconsistent state detected
```

**State Transitions (Custody-Agnostic):**
```
CREATED → VALIDATED → FUNDS_RESERVED → CREDITS_RESERVED → SETTLEMENT_PENDING
                                                         ↓
                                               CREDIT_TRANSFER_SUBMITTED
                                                         ↓
                                               CREDIT_TRANSFER_CONFIRMED
                                                         ↓
                                               PAYMENT_SETTLED → FEES_COLLECTED
                                                         ↓
                                               SELLER_PAID → BUYER_CREDITED → SETTLED

Any state → FAILED → compensation → REQUIRES_RECONCILIATION (if partial)
Any state → CANCELLED (before FUNDS_RESERVED)
VALIDATED/FUNDS_RESERVED/CREDITS_RESERVED → EXPIRED (timeout)
```

---

### 1.6 Cross-Custody Failure/Recovery — **EXPLICIT DESIGN**

#### 1.6.1 On-Chain Seller → Ledger Buyer (`sellerCustodyType='onchain', buyerCustodyType='ledger'`)

```
Failure Scenarios:
─────────────────────────────────────────────────────────────────
1. settleINRTradeOnChain() REVERTS (blockchain)
   → CreditTransferOperation.status = 'FAILED'
   → Trade.settlementState = 'FAILED'
   → Compensation: Release escrow back to seller (Marketplace.sol cancelListingFor)
   → Payment: REFUNDED (Razorpay refund / INR wallet credit)
   → Listing: remainingQuantity RESTORED, position.reserved DECREMENTED

2. settleINRTradeOnChain() SUCCEEDS but CreditLedger BUY log FAILS
   → Credits moved to custody wallet on-chain
   → CreditTransferOperation(type='LEDGER_BUY').status = 'FAILED'
   → Trade.settlementState = 'REQUIRES_RECONCILIATION'
   → Alert: "Buyer credits not logged to ledger — manual backfill required"
   → Recovery: Retry logOwnershipChangeOnChain(BUY) with same refHash (idempotent)
   → Seller already paid (INR credited via handleCreditTraded)

3. Payment CAPTURED but settleINRTradeOnChain() TIMEOUT (no receipt)
   → Poll for transaction receipt (ethers provider.waitForTransaction)
   → If found: proceed to step 2
   → If not found after max retries: REQUIRES_RECONCILIATION
   → Do NOT retry settleINRTradeOnChain blindly (nonce/replay risk)
```

#### 1.6.2 Ledger Seller → On-Chain Buyer (`sellerCustodyType='ledger', buyerCustodyType='onchain'`)

```
Failure Scenarios:
─────────────────────────────────────────────────────────────────
1. Ledger SELL succeeds, Marketplace settleINRTrade() FAILS
   → CreditTransfer.operations[0] (LEDGER_SELL) = CONFIRMED
   → CreditTransfer.operations[1] (ERC1155_TRANSFER) = FAILED
   → Trade.settlementState = 'REQUIRES_RECONCILIATION'
   → Seller ledger debited, buyer NOT credited on-chain
   → Recovery: 
      a) Retry settleINRTrade() with same tradeIdHash (idempotent in contract)
      b) If buyer already paid (Razorpay captured): complete transfer
      c) If buyer NOT paid: compensate seller ledger credit (LEDGER_BUY back to seller)

2. Razorpay payment FAILS after ledger SELL
   → Payment.status = 'FAILED'
   → Trade.settlementState = 'FAILED'
   → Compensation: CreditTransferOperation(type='LEDGER_BUY') to restore seller ledger
   → Listing: remainingQuantity RESTORED

3. ETH buyer (MetaMask) — buyCredit() REVERTS
   → No ledger SELL executed yet (buyer initiates on-chain)
   → Trade never created (frontend handles revert)
   → No compensation needed
```

#### 1.6.3 Cross-Custody Compensation Principles — **FIXED: Not ACID Rollback**

```
NEVER: "Rollback" across PostgreSQL + Ethereum + CreditLedger
   - These are SEPARATE consensus systems
   - No distributed transaction manager exists

ALWAYS: Explicit compensation operations
   - Each compensation is a NEW SettlementOperation
   - Has its own idempotency key
   - Recorded in audit trail
   - Can be retried independently
   - Human approval required for REQUIRES_RECONCILIATION

Compensation Types:
   REFUND_PAYMENT       → Razorpay refund / INR wallet credit / ETH return
   RESTORE_LISTING      → Increment listing.remainingQuantity, decrement position.reserved
   RESTORE_LEDGER_CREDIT → logOwnershipChangeOnChain(BUY/SELL) opposite direction
   RELEASE_ESCROW       → Marketplace.sol cancelListingFor (on-chain)
   MANUAL_RECONCILIATION → Human intervention, tracked in admin_audit_log
```

---

### 1.7 Tax Model — **FIXED: Removed Hardcoded Assumptions**

```typescript
// Tax calculation is PLUGGABLE, not hardcoded
interface TaxCalculator {
  // Returns tax breakdown for a fee amount
  calculate(feeAmount: number, feeType: 'BUYER' | 'SELLER', context: TaxContext): TaxBreakdown;
}

interface TaxContext {
  buyerGstin: string | null;
  sellerGstin: string | null;
  platformGstin: string;
  placeOfSupply: string;           // State code
  transactionType: 'B2B' | 'B2C' | 'EXPORT';
  // ... other jurisdiction-specific fields
}

interface TaxBreakdown {
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  taxRate: number;                 // e.g., 0.18 for 18%
  hsCode: string;                  // Harmonized System code
  explanation: string;             // Human-readable for audit
}

// Default implementation for India GST (18% CGST+SGST or IGST)
// But can be swapped for other jurisdictions
const defaultTaxCalculator: TaxCalculator = { ... };
```

**Invariants (Tax-Agnostic):**
```
feeAmount + taxAmount = totalFeeInclTax
platformTaxLiability = SUM(fee.taxAmount for all fees in trade)
buyerTotalDebit = buyerGross + buyerFee + buyerTax
sellerNetCredit = sellerGross - sellerFee - sellerTax
```

---

### 1.8 Idempotency — **FIXED: Globally Unique Keys**

```typescript
// Trade idempotency: GLOBALLY unique (not per-user)
CREATE UNIQUE INDEX ON trades (idempotency_key);

// Payment idempotency: GLOBALLY unique
CREATE UNIQUE INDEX ON payments (idempotency_key);

// CreditTransfer idempotency: GLOBALLY unique
CREATE UNIQUE INDEX ON credit_transfers (idempotency_key);

// Blockchain event identity — **FIXED: Full composite key**
// chain_id + contract_address + tx_hash + log_index
CREATE UNIQUE INDEX ON blockchain_events (chain_id, contract_address, tx_hash, log_index);

// Usage in code:
const idempotencyKey = `${serviceName}:${operationType}:${businessKey}:${timestamp}:${randomSuffix}`;
// Example: "trades:create:listing_123_user_456:20260818T103000Z:a7f2"
```

---

### 1.9 Blockchain Event Identity — **FIXED**

```typescript
interface BlockchainEvent {
  eventId: string;                    // UUID
  chainId: number;                    // e.g., 80001 (Mumbai), 137 (Polygon)
  contractAddress: string;            // Lowercase, checksummed
  txHash: string;                     // 0x...
  logIndex: number;                   // Position within transaction
  blockNumber: number;
  eventName: string;                  // 'CreditListed', 'CreditTraded', etc.
  decodedArgs: Record<string, any>;
  processedAt: Date | null;
  processingStatus: 'PENDING' | 'PROCESSED' | 'FAILED' | 'DUPLICATE';
  idempotencyKey: string;             // Derived: `${chainId}:${contractAddress}:${txHash}:${logIndex}`
}
```

**Processing Guarantee:**
```
INSERT INTO blockchain_events (...) VALUES (...) 
ON CONFLICT (chain_id, contract_address, tx_hash, log_index) DO NOTHING;

If INSERT succeeds → process event
If INSERT conflicts → event already processed, skip
```

---

### 1.10 Financial vs Carbon Accounting Separation — **FIXED**

| Domain | Tables | Invariants |
|--------|--------|------------|
| **Carbon-Credit Inventory** | `ownership_positions`, `listings`, `credit_transfers`, `carbon_assets`, `retirements` | `owned >= reserved`, `Σ listing.remaining = position.reserved`, credits conserved |
| **Financial Accounting** | `trades`, `payments`, `fees`, `wallet_transactions`, `platform_fees`, `settlement_operations` | Double-entry: Σ debits = Σ credits, payment ↔ trade linkage |

**No Cross-Contamination:**
- Carbon tables NEVER store INR/ETH amounts
- Financial tables NEVER store credit quantities (except as denormalized `trade.quantity` for reference)
- Reconciliation jobs compare ACROSS domains but never mix columns

---

## 2. Canonical Accounting Model (Double-Entry) — **SEPARATED**

### 2.1 Financial Chart of Accounts (Financial Domain Only)
| Account Code | Name | Type | Normal Balance |
|-------------|------|------|----------------|
| 1000 | Buyer Cash (INR) | Asset | Debit |
| 1010 | Buyer Cash (ETH) | Asset | Debit |
| 1100 | Seller Receivable | Asset | Debit |
| 1200 | Settlement Clearing | Asset | Debit |
| 1300 | Platform Fee Receivable | Asset | Debit |
| 2000 | Seller Payable | Liability | Credit |
| 2100 | Platform Tax Payable | Liability | Credit |
| 3000 | Platform Revenue | Revenue | Credit |
| 3100 | Platform Fee Revenue | Revenue | Credit |

### 2.2 Carbon Inventory Chart of Accounts (Carbon Domain Only)
| Account Code | Name | Type | Normal Balance |
|-------------|------|------|----------------|
| 4000 | Carbon Inventory (On-Chain) | Asset | Debit |
| 4100 | Carbon Inventory (Ledger) | Asset | Debit |
| 4200 | Reserved Inventory | Asset | Debit |
| 4300 | Retired Inventory | Asset | Credit |

### 2.3 Journal Entry: Settled Trade (Financial Domain)
```
Debit  1000/1010  Buyer Cash              buyerTotalDebit
Credit 2000       Seller Payable          sellerNetCredit
Credit 2100       Platform Tax Payable    platformTaxLiability
Credit 3100       Platform Fee Revenue    platformRevenue
```

### 2.4 Journal Entry: Credit Transfer (Carbon Domain)
```
# On-Chain Seller → On-Chain Buyer
Debit  4000  Carbon Inventory (On-Chain)  buyerGross   [Buyer position]
Credit 4200  Reserved Inventory            buyerGross   [Release seller reservation]
Debit  4200  Reserved Inventory            sellerGross  [Seller reservation]
Credit 4000  Carbon Inventory (On-Chain)  sellerGross  [Seller position]

# Ledger Seller → Ledger Buyer (single PG transaction)
Debit  4100  Carbon Inventory (Ledger)    buyerGross   [Buyer position]
Credit 4200  Reserved Inventory            buyerGross   [Release seller reservation]
Debit  4200  Reserved Inventory            sellerGross  [Seller reservation]
Credit 4100  Carbon Inventory (Ledger)    sellerGross  [Seller position]
```

---

## 3. Summary: Updated Invariant Checklist

| # | Invariant | Enforcement Layer |
|---|-----------|-------------------|
| 1 | `owned >= reserved >= 0` | DB CHECK + App FOR UPDATE |
| 2 | `available = owned - reserved` (DERIVED) | View / Computed column |
| 3 | `position.reserved = Σ active listing.remaining` | App + Reconciliation job |
| 4 | `buyerTotalDebit = sellerNetCredit + platformRevenue + taxes` | App (fee calc) + DB constraint |
| 5 | `buyer receives exactly trade.quantity credits` | CreditTransfer + Reconciliation |
| 6 | `seller relinquishes exactly trade.quantity credits` | CreditTransfer + Reconciliation |
| 7 | Retired credits never return to available | DB (no UPDATE on retired) |
| 8 | Single trade per idempotency_key (GLOBAL) | UNIQUE INDEX |
| 9 | Single payment per idempotency_key (GLOBAL) | UNIQUE INDEX |
| 10 | Single credit_transfer per idempotency_key (GLOBAL) | UNIQUE INDEX |
| 11 | Single blockchain event per (chain_id, contract, tx_hash, log_index) | UNIQUE INDEX |
| 12 | Fee calculation server-authoritative, tax pluggable | App (single calcFees + TaxCalculator) |
| 13 | All money in minor units (integer) | App (no float) |
| 14 | Settlement state machine custody-independent | DB enum + App transitions |
| 15 | Cross-custody tracked via sellerCustodyType/buyerCustodyType | Trade columns |
| 16 | Cross-custody failure → explicit compensation (not rollback) | SettlementOperation + Admin audit |
| 17 | Financial accounting separated from carbon accounting | Separate tables, separate journals |
| 18 | Daily reconciliation detects drift in both domains | Cron jobs + Alerts |

---

**Next Phase:** Phase 2 — Target Architecture & Database Schema