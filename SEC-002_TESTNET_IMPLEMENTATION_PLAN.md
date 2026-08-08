# SEC-002: Operator Wallet Decentralization - Testnet Implementation Plan

**Status:** READY FOR TESTNET IMPLEMENTATION  
**Network:** Sepolia Testnet (Chain ID: 11155111)  
**Contracts Deployed:** ✅ All 8 contracts deployed on Sepolia

---

## Problem Statement

**Current Architecture (Single Hot Wallet Risk):**
A single hot wallet (`MINTER_PRIVATE_KEY` = `0xe19f...`) controls ALL operator functions across 4 contracts:
- `CarbonCreditToken.operator` - mint, retire, mintAdditional
- `Marketplace.signerWallet` - logINRTrade, settleINRTrade, listCreditFor, cancelListingFor
- `CreditLedger.operator` - logOwnershipChange, logRetirement
- `KYCRegistry` KYC operator - verifyKYC, linkWallet, revokeKYC, add/remove operators

**Risk:** Single private key compromise = total platform compromise (minting, trading, KYC, ledger)

---

## Solution: TimelockController + Multi-Sig Governance

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    TimelockController                        │
│  (Gnosis Safe / OpenZeppelin TimelockController)             │
│                                                              │
│  Proposers: [Multi-sig]  →  Timelock (48h delay)  →  Executors │
│                              (contracts as executors)          │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│CarbonCredit   │    │ Marketplace   │    │ CreditLedger  │
│Token          │    │               │    │               │
│.operator      │    │.signerWallet  │    │.operator      │
└───────────────┘    └───────────────┘    └───────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   KYCRegistry │    │  Treasury     │    │  CreditLedger │
│  KYC Operator │    │  (fee collector)        (ledger)    │
└───────────────┘    └───────────────┘    └───────────────┘
```

---

## Implementation Plan

### Phase 1: Deploy TimelockController (Sepolia)

```solidity
// TimelockController.sol (OpenZeppelin)
// Deploy with:
// - minDelay: 48 hours (172800 seconds)
// - proposers: [Multi-sig wallet]
// - executors: [contract addresses that need operator access]
// - admin: Multi-sig wallet (or timelock itself after setup)
```

### Phase 2: Deploy Multi-Sig Wallet (Gnosis Safe)

```bash
# Deploy Gnosis Safe on Sepolia
# Owners: [Platform Lead, Security Lead, DevOps Lead, Legal/Compliance]
# Threshold: 3/4
# Safe address: 0xSAFE_ADDRESS
```

### Phase 3: Configure Timelock

```solidity
// Timelock setup
TimelockController timelock = new TimelockController(
    172800,                    // 48 hours minDelay
    [safeAddress],             // proposers
    [],                        // executors (empty = anyone can execute after delay)
    safeAddress                // admin
);

// Grant proposer role to Safe
timelock.grantRole(PROPOSER_ROLE, safeAddress);

// Grant executor role to each contract that needs operator access
timelock.grantRole(EXECUTOR_ROLE, carbonCreditTokenAddress);
timelock.grantRole(EXECUTOR_ROLE, marketplaceAddress);
timelock.grantRole(EXECUTOR_ROLE, creditLedgerAddress);
timelock.grantRole(EXECUTOR_ROLE, kycRegistryAddress);
timelock.grantRole(EXECUTOR_ROLE, treasuryAddress);

// Transfer ownership of operator roles to Timelock
carbonCreditToken.transferOwnership(timelockAddress);
marketplace.transferOwnership(timelockAddress);  // or setSignerWallet via timelock
creditLedger.transferOwnership(timelockAddress);
kycRegistry.transferOwnership(timelockAddress);
```

### Phase 3: Update Contracts to Use Timelock

For contracts where operator is not owner (Marketplace.signerWallet, KYCRegistry operator):

```solidity
// Marketplace.sol - Add timelock-controlled setter
function setSignerWalletTimelock(address _signer) external {
    require(msg.sender == address(timelock), "Only timelock");
    emit SignerWalletUpdated(signerWallet, _signer);
    signerWallet = _signer;
}

// KYCRegistry - already has addKYCOperator/removeKYCOperator (onlyOwner)
// Transfer ownership to timelock, then onlyOwner = timelock
```

---

## Sepolia Testnet Deployment Plan

### Contract Addresses (Sepolia - Already Deployed)

| Contract | Sepolia Address |
|----------|-----------------|
| KYC_REGISTRY | 0x443e068FE6F2F7B57C71A3Bc5492aA98b5069597 |
| TREASURY | 0x2504e917A78C8094Aee0cba8e076fc3891b95265 |
| CARBON_CREDIT_TOKEN | 0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2 |
| EMISSION_REGISTRY | 0xb978fB9661ED48C4Fac92a73034E619bc640c18b |
| MARKETPLACE | 0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A |
| AMM_POOL | 0x17d897aa29919cA5a39bcC165dE6E63eaB554c2F |
| AUDIT_CONTRACT | 0x98D9f9555bd2049Fb52DCe040C1B895CB55BcE81 |
| CREDIT_LEDGER | 0x2046625FC6181DeE411a35F160Cb00b9FEC9d830 |

### Current Operator Wallets (Sepolia)
- **MINTER_PRIVATE_KEY** (0xe19f...): CarbonCreditToken.operator, Marketplace.signerWallet, CreditLedger.operator, KYCRegistry KYC operator
- **CHAIN_SIGNER_PRIVATE_KEY** (0x4d09...): Marketplace.signerWallet (for INR trade logging)
- **RELAYER_PRIVATE_KEY** (0x9ef4...): AuditTrail relayer

---

## Testnet Implementation Steps

### Step 1: Deploy TimelockController on Sepolia

```bash
# Deploy script: deploy-timelock.sepolia.ts
npx hardhat run scripts/deploy-timelock.ts --network sepolia
```

### Step 2: Deploy Gnosis Safe (Multi-Sig) on Sepolia

```bash
# Use Gnosis Safe UI or script
# Owners: [Platform Lead, Security Lead, DevOps Lead, Compliance Lead]
# Threshold: 3/4
```

### Step 3: Configure Timelock

```typescript
// scripts/configure-timelock.sepolia.ts
const TIMELOCK_ADDRESS = "0x...";
const SAFE_ADDRESS = "0x...";
const CONTRACTS = {
  carbonCreditToken: "0x...",
  marketplace: "0x...",
  creditLedger: "0x...",
  kycRegistry: "0x...",
  treasury: "0x...",
  auditTrail: "0x...",
};
```

### Step 4: Transfer Operator Roles to Timelock

```typescript
// For each contract:
await carbonCreditToken.setOperator(timelockAddress);  // via timelock proposal
await creditLedger.setOperator(timelockAddress);
await kycRegistry.transferOwnership(timelockAddress);  // makes timelock the owner
await marketplace.transferOwnership(timelockAddress);  // or use setSignerWallet via timelock
```

### Step 5: Configure Gnosis Safe as Proposer

```bash
# In Gnosis Safe UI:
# 1. Add Timelock as a module or use Safe Apps
# 2. Configure proposers = [Safe Address]
# 3. Configure executors = [Timelock Address]
```

---

## Testnet Validation Checklist

- [ ] TimelockController deployed on Sepolia
- [ ] Gnosis Safe deployed on Sepolia (3/4 threshold)
- [ ] Timelock configured with 48h delay
- [ ] Proposer role granted to Gnosis Safe
- [ ] Executor roles granted to all 6 contracts
- [ ] Ownership of operator roles transferred to Timelock
- [ ] Test proposal execution flow:
  - [ ] Propose via Safe → [ ] Wait 48h → [ ] Execute via Timelock
- [ ] Verify operator functions work via Timelock:
  - [ ] CarbonCreditToken.setOperator via Timelock
  - [ ] Marketplace.setSignerWallet via Timelock
  - [ ] CreditLedger.setOperator via Timelock
  - [ ] KYCRegistry.addKYCOperator via Timelock
  - [ ] CarbonCreditToken.mintCredit via Timelock
  - [ ] Marketplace.settleINRTrade via Timelock
  - [ ] CreditLedger.logOwnershipChange via Timelock

---

## Smart Contract Modifications Needed

### 1. Marketplace.sol - Add Timelock-Compatible Setters

```solidity
// Add to Marketplace.sol
function setSignerWalletViaTimelock(address _signer) external {
    require(msg.sender == address(timelockController), "Only timelock");
    emit SignerWalletUpdated(signerWallet, _signer);
    signerWallet = _signer;
}

function setKYCRegistryViaTimelock(address _registry) external {
    require(msg.sender == address(timelockController), "Only timelock");
    emit KYCRegistryUpdated(address(kycRegistry), _registry);
    kycRegistry = KYCRegistry(_registry);
}
```

### 2. CarbonCreditToken.sol - Already has setOperator(onlyOwner)

### 3. CreditLedger.sol - Already has setOperator(onlyOwner)

### 3. KYCRegistry.sol - Already has addKYCOperator/removeKYCOperator (onlyOwner)

### 4. Treasury.sol - May need timelock-compatible functions

---

## Testnet Verification Checklist

- [ ] TimelockController deployed on Sepolia
- [ ] Gnosis Safe deployed on Sepolia (3/4 threshold)
- [ ] Timelock delay = 48 hours (testnet: can use 1 hour for faster testing)
- [ ] Proposer role granted to Gnosis Safe
- [ ] Executor roles granted to all 6 contracts
- [ ] Ownership transferred to Timelock for all operator roles
- [ ] Test proposal → wait → execute flow works
- [ ] Verify operator functions work via Timelock
- [ ] Frontend integration test with new flow

---

## Migration to Mainnet (After Testnet Success)

1. Deploy TimelockController on Polygon Mainnet
2. Deploy Gnosis Safe on Polygon Mainnet (same owners, 3/4 threshold)
3. Configure Timelock with 48h delay (production)
4. Transfer operator roles via Timelock proposals
5. Update backend `.env` with new operator addresses
5. Update frontend contract addresses
6. Verify all operator flows work via Timelock

---

## Rollback Plan

If issues discovered on testnet:
1. Timelock admin (Gnosis Safe) can cancel pending proposals
2. Timelock admin can update delay (emergency)
3. Timelock admin can revoke proposer/executor roles
4. Emergency: Timelock admin can transfer ownership back to EOA (emergency multisig)

---

## Next Steps

1. **Deploy TimelockController on Sepolia** - Run deployment script
2. **Create Gnosis Safe** - 3/4 threshold, add team members
3. **Configure Timelock** - Set proposers/executors/admins
4. **Transfer Ownership** - Propose via Safe, execute via Timelock
5. **Test Full Flow** - Propose → Wait → Execute → Verify

---

**Ready to start testnet implementation. Begin with Step 1: Deploy TimelockController on Sepolia.**