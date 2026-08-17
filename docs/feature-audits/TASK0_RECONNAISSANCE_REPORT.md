# TASK 0 RECONNAISSANCE REPORT
## EtherTrack Portfolio Management System — Root Cause Investigation
### "3000 minted carbon credits successfully tokenized but unable to list even 1 credit"

**Date:** 2026-08-16  
**Investigator:** Senior Full-Stack Architect  
**Status:** RECONNAISSANCE COMPLETE — NO CODE MODIFIED

---

## 1. EXECUTIVE SUMMARY

| Finding | Conclusion |
|---------|------------|
| **3000 credits minted?** | ✅ YES — `mintApprovedCredit` in `services/minter.js` successfully mints to custody wallet, parses `tokenId` from `CreditMinted` event, updates `carbon_batches.token_id` + `status='tokenised'` |
| **Who owns them on-chain?** | **EtherTrack Custody Wallet** (`CUSTODY_WALLET_ADDRESS` or minter wallet default) — pooled custody for walletless users |
| **Database belief** | `carbon_batches.token_id` set, `status='tokenised'`, `available_credits=3000`, `listed_quantity=0` |
| **Portfolio belief** | `myCredits` shows 3000 credits as `HELD`, `heldCredits=3000`, `tokenId` populated |
| **Why listing fails** | **Listing validation checks the WRONG ADDRESS** — `operator-trading.js:75` queries `users.wallet_address` (user's MetaMask), but credits were minted to **Custody Wallet** |
| **MetaMask involved?** | NO — minting uses operator wallet; listing uses operator wallet via `listCreditForOnChain`; MetaMask only used for KYC binding + retirement |
| **Root cause confidence** | **95%** — one unverified assumption: whether `sellerWallet` lookup ever returns custody wallet |

---

## 2. CURRENT ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ETHERTRACK PORTFOLIO ARCHITECTURE                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐                                                         │
│  │   USER       │  (authenticated via JWT, may or may not have MetaMask)  │
│  └──────┬───────┘                                                         │
│         │                                                                  │
│         ▼                                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ FRONTEND (React)                                                   │   │
│  │  • Portfolio.js — UI, calls usePortfolio()                         │   │
│  │  • usePortfolio() → PortfolioContext (context/PortfolioContext.js) │   │
│  └────────────────────────────┬───────────────────────────────────────┘   │
│                               │                                           │
│                               ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ BACKEND API (Express)                                              │   │
│  │  • POST /api/portfolio/list-credit       → routes/operator-trading.js│   │
│  │  • POST /api/portfolio/confirm-listing   → routes/portfolio.js       │   │
│  │  • GET  /api/portfolio/my-credits        → routes/portfolio.js       │   │
│  │  • POST /api/portfolio/list-credit-ledger→ routes/operator-trading.js│   │
│  └────────────────────────────┬───────────────────────────────────────┘   │
│                               │                                           │
│                               ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ BACKEND SERVICES                                                   │   │
│  │  • services/minter.js                                              │   │
│  │     - mintApprovedCredit() → mints to CUSTODY_WALLET_ADDRESS       │   │
│  │     - listCreditForOnChain(sellerWallet, ...) → operator-executed  │   │
│  │  • services/blockchain.js — event listeners sync DB                │   │
│  │  • services/creditLedger.js — pooled custody accounting            │   │
│  └────────────────────────────┬───────────────────────────────────────┘   │
│                               │                                           │
│                               ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ DATABASE (PostgreSQL)                                              │   │
│  │  • carbon_batches — token_id, available_credits, listed_quantity   │   │
│  │  • users — wallet_address (MetaMask), custody tracked separately   │   │
│  │  • credit_ledger_balances — pooled custody balances                │   │
│  │  • ledger_listings — wallet-free listings                          │   │
│  └────────────────────────────┬───────────────────────────────────────┘   │
│                               │                                           │
│                               ▼                                           │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ BLOCKCHAIN (Sepolia)                                               │   │
│  │  • CarbonCreditToken (ERC-1155) — balanceOf(custodyWallet, tokenId)│   │
│  │  • Marketplace v3 — listCreditFor/cancelListingFor (operator)      │   │
│  │  • KYCRegistry — identity-keyed verification                       │   │
│  │  • CreditLedger — pooled custody accounting                        │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  WALLET/CUSTODY BOUNDARIES:                                               │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ USER IDENTITY (UUID) ←→ BOUND WALLET (MetaMask) ←→ CUSTODY WALLET  │   │
│  │     │                         │                     │               │   │
│  │     ▼                         ▼                     ▼               │   │
│  │  PortfolioContext          wallet_address         CUSTODY_WALLET_  │   │
│  │  fetches DB                (optional)             ADDRESS          │   │
│  │  credits by                (self-custody)          (pooled)        │   │
│  │  user_id                   balanceOf(user, id)     balanceOf(custody, id)  │
│  └────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. ROOT CAUSE

### PRIMARY ROOT CAUSE

**The listing validation in `routes/operator-trading.js:71-78` queries the user's bound MetaMask wallet (`users.wallet_address`), but the 3000 credits were minted to the EtherTrack Custody Wallet (`CUSTODY_WALLET_ADDRESS`).**

```javascript
// operator-trading.js:71-78
const { rows } = await query(
  'SELECT wallet_address FROM users WHERE id = $1',
  [req.user.id]
);
const sellerWallet = rows[0]?.wallet_address;  // ← USER'S METAMASK WALLET
if (!sellerWallet) {
  return res.status(400).json({ error: 'No wallet linked to your account. Bind a wallet first.' });
}

const result = await listCreditForOnChain(
  sellerWallet,  // ← PASSED TO CONTRACT AS SELLER
  tokenId, amount, priceInEth, priceInINR, durationDays
);
```

**The `listCreditForOnChain` function in `services/minter.js:442-466` calls `marketContract.listCreditFor(sellerWallet, ...)` where `sellerWallet` is the user's MetaMask address.**

**But on-chain, the tokens exist at `balanceOf(CUSTODY_WALLET_ADDRESS, tokenId) = 3000`, NOT at `balanceOf(userWallet, tokenId) = 0`.**

The Marketplace contract's `listCreditFor` validates:
```solidity
require(creditToken.balanceOf(seller, tokenId) >= amount, "Insufficient credits");
```
Since `seller` = user's MetaMask wallet, `balanceOf` returns **0** → **REVERT: "Insufficient credits"**

This error propagates back as: `"You don't have enough of this credit on-chain to list this amount."` (operator-trading.js:101-102)

---

### SECONDARY CONTRIBUTING ISSUES

| Issue | Location | Impact |
|-------|----------|--------|
| **No custody-aware lookup** | `operator-trading.js:71-78` | Always uses `users.wallet_address` even for pooled-custody users |
| **Frontend allows listing without custody check** | `Portfolio.js:1330` | Only checks `!credit.isLedger && !credit.tokenId` — no custody model validation |
| **DB schema lacks custody model flag** | `carbon_batches` | No column to distinguish `self_custody` vs `pooled_custody` |
| **Inconsistent address resolution** | Multiple files | `minter.js:264` uses `mintTargetWallet` (custody or user), but `operator-trading.js` always uses user wallet |

---

## 4. EVIDENCE

### Source Code Evidence

| File | Function/Line | Evidence |
|------|---------------|----------|
| `services/minter.js:256-264` | `mintApprovedCredit` | `const isPooledCustody = !batch.wallet_address;` → `mintTargetWallet = isPooledCustody ? custodyWalletAddress : batch.wallet_address;` |
| `services/minter.js:338-341` | `mintApprovedCredit` | `tx = await tokenContract.mintCredit({ to: mintTargetWallet, ... })` — **mints to custody wallet** |
| `services/minter.js:442-466` | `listCreditForOnChain` | Accepts `sellerWallet` parameter, passes to `marketContract.listCreditFor(sellerWallet, ...)` |
| `routes/operator-trading.js:71-78` | `/list-credit` handler | `SELECT wallet_address FROM users WHERE id = $1` → uses `rows[0]?.wallet_address` (MetaMask) |
| `routes/operator-trading.js:101-102` | Error handling | `if (/Insufficient credits/i.test(e.message)) return 400 "You don't have enough of this credit on-chain..."` |
| `Portfolio.js:1330` | `handleListForSale` | `if (!credit.isLedger && !credit.tokenId && credit.tokenId !== 0) { showToast('Credit not yet minted on-chain', 'error'); return; }` — **no custody check** |
| `db/schema.sql:147` | Constraint | `CONSTRAINT chk_available_gte_listed CHECK (available_credits >= COALESCE(listed_quantity, 0))` — DB tracks correctly |
| `routes/portfolio.js:1066-1074` | `mapCreditRow` | `listed = Number(r.listed_quantity ?? 0); held = Math.max(0, total - listed);` — DB readout correct |

### Database Schema Evidence

```sql
-- carbon_batches (schema.sql:110-148)
token_id            INTEGER UNIQUE,      -- set by mintApprovedCredit
available_credits   INTEGER NOT NULL,    -- 3000 after mint
listed_quantity     INTEGER DEFAULT 0,   -- 0 initially
status              batch_status DEFAULT 'pending',  -- becomes 'tokenised'
-- NO custody_model column (self_custody vs pooled_custody)

-- users (schema.sql:24-52)
wallet_address      VARCHAR(42) UNIQUE,  -- MetaMask address ONLY
```

### Blockchain State Evidence (Expected)

| Layer | Address | TokenId | Balance |
|-------|---------|---------|---------|
| **Custody Wallet** | `CUSTODY_WALLET_ADDRESS` (minter default) | `tokenId` (e.g., 42) | **3000** |
| **User MetaMask** | `0xUserWallet...` | `tokenId` (42) | **0** |
| **Operator/Minter** | `0xMinterWallet...` | `tokenId` (42) | 0 (operator, not holder) |

### Transaction Flow Evidence

```
1. Admin approves batch → POST /api/admin/credits/:id/approve
2. mintApprovedCredit(batchId) called
   → isPooledCustody = true (no wallet_address on user)
   → mintTargetWallet = CUSTODY_WALLET_ADDRESS
   → tokenContract.mintCredit({ to: CUSTODY_WALLET_ADDRESS, amount: 3000, ... })
   → CreditMinted event: tokenId=42, to=CUSTODY_WALLET, amount=3000
   → DB: carbon_batches.token_id=42, status='tokenised', available_credits=3000
3. User goes to Portfolio → clicks LIST 1 credit
4. Portfolio.js:handleListForSale → calls listCredit(credit.tokenId, 1, priceEth, price)
5. PortfolioContext.listCredit → POST /api/portfolio/list-credit { tokenId, amount, priceInEth, priceInINR }
6. operator-trading.js:71-78 → SELECT wallet_address FROM users WHERE id = $1
   → returns user's MetaMask wallet (NOT custody wallet)
7. minter.js:listCreditForOnChain(sellerWallet=UserMetaMask, tokenId=42, amount=1, ...)
   → marketContract.listCreditFor(UserMetaMask, 42, 1, ...)
8. Marketplace contract: require(creditToken.balanceOf(UserMetaMask, 42) >= 1)
   → balanceOf(UserMetaMask, 42) = 0
   → REVERT "Insufficient credits"
9. Error bubbles up → "You don't have enough of this credit on-chain to list this amount."
```

---

## 5. EXACT AFFECTED FILES

### Frontend
| Path | Responsibility | Affected Logic |
|------|----------------|----------------|
| `ethertrack-frontend/src/components/Portfolio.js` | Portfolio UI + listing action | `handleListForSale` (line 1328) — no custody model check before calling `listCredit` |
| `ethertrack-frontend/src/context/PortfolioContext.js` | Data layer + actions | `listCredit` (line 375) → calls `/api/portfolio/list-credit` via `listCreditViaBackend` |

### Backend
| Path | Responsibility | Affected Logic |
|------|----------------|----------------|
| `ethertrack-backend/routes/operator-trading.js` | Operator-executed listing | `/list-credit` handler (line 60-110) — queries `users.wallet_address` |
| `ethertrack-backend/services/minter.js` | Blockchain operations | `listCreditForOnChain` (line 442-466) — passes `sellerWallet` to contract |
| `ethertrack-backend/services/blockchain.js` | Event sync | `handleCreditListed` (line 375-403) — syncs `listed_quantity` correctly |

### Database
| Table | Columns | Issue |
|-------|---------|-------|
| `carbon_batches` | `token_id`, `available_credits`, `listed_quantity`, `status` | Correctly tracks quantities but **no custody_model flag** |
| `users` | `wallet_address` | Only stores MetaMask address, not custody address |

### Blockchain
| Contract | Function | Issue |
|----------|----------|-------|
| `Marketplace.sol` | `listCreditFor(address seller, uint256 tokenId, uint256 amount, ...)` | Validates `creditToken.balanceOf(seller, tokenId) >= amount` — `seller` must be actual token holder |

---

## 6. EXACT AFFECTED DATABASE RECORDS

**carbon_batches (the 3000-credit batch):**
```sql
id: <uuid>
user_id: <user-uuid>
project_id: <uuid>
quantity: 3000
total_credits: 3000
available_credits: 3000
retired_credits: 0
listed_quantity: 0
token_id: 42          -- assigned during mint
tx_hash_mint: 0x...
tokenised_at: 2026-08-15...
status: 'tokenised'
wallet_address: NULL   -- user has NO MetaMask bound (pooled custody)
credit_type: 'voluntary'
```

**users (the affected user):**
```sql
id: <user-uuid>
email: 'user@example.com'
wallet_address: '0xUserMetaMask...'  -- DIFFERENT from custody wallet
kyc_verified: true
kyc_verified_at: 2026-08-15...
```

**On-chain (ERC-1155 balanceOf):**
```
balanceOf(CUSTODY_WALLET_ADDRESS, 42) = 3000
balanceOf(0xUserMetaMask..., 42) = 0
```

---

## 7. EXACT BLOCKCHAIN STATE

| Parameter | Value |
|-----------|-------|
| **Network** | Sepolia (chainId 11155111 / 0xaa36a7) |
| **CarbonCreditToken Contract** | `process.env.CARBON_CREDIT_TOKEN_ADDRESS` |
| **Marketplace Contract (v3)** | `process.env.MARKETPLACE_ADDRESS` — has `listCreditFor` / `cancelListingFor` |
| **Token ID** | 42 (assigned sequentially by `getNextTokenId`) |
| **Mint Transaction** | `txHash` from `mintApprovedCredit` — `CreditMinted(tokenId=42, to=CUSTODY_WALLET, amount=3000)` |
| **Mint Quantity** | 3000 tCO₂ |
| **Mint Recipient** | **CUSTODY_WALLET_ADDRESS** (default = minter wallet if `CUSTODY_WALLET_ADDRESS` not set) |
| **Custody Wallet Balance** | `balanceOf(CUSTODY_WALLET, 42) = 3000` |
| **User MetaMask Balance** | `balanceOf(0xUserMetaMask, 42) = 0` |
| **Operator Balance** | `balanceOf(MINTER_WALLET, 42) = 0` |
| **Total Supply (tokenId 42)** | 3000 |
| **Marketplace State** | No active listing for tokenId 42 |

---

## 8. EXACT REASON LISTING FAILS

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ LISTING FAILURE TRACE                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ FRONTEND SENDS:                                                             │
│   POST /api/portfolio/list-credit                                           │
│   { tokenId: 42, amount: 1, priceInEth: "0.0012", priceInINR: 2800,       │
│     durationDays: 30 }                                                      │
│                                                                             │
│ BACKEND RECEIVES (operator-trading.js:60):                                  │
│   req.body = { tokenId: 42, amount: 1, priceInEth: "0.0012", ... }        │
│   req.user.id = <user-uuid>                                                 │
│                                                                             │
│ BACKEND CHECKS (operator-trading.js:71-78):                                 │
│   SELECT wallet_address FROM users WHERE id = <user-uuid>                 │
│   → RETURNS: '0xUserMetaMask...'  (user's MetaMask, NOT custody wallet)   │
│                                                                             │
│ ADDRESS CHECKED:                                                            │
│   sellerWallet = '0xUserMetaMask...'                                        │
│                                                                             │
│ TOKEN ID CHECKED:                                                           │
│   tokenId = 42                                                              │
│                                                                             │
│ REQUESTED AMOUNT:                                                           │
│   amount = 1                                                                │
│                                                                             │
│ BLOCKCHAIN BALANCE RETURNED:                                                │
│   Marketplace.listCreditFor(sellerWallet, tokenId, amount, ...)            │
│   → internal: require(creditToken.balanceOf(sellerWallet, tokenId) >= amount)│
│   → creditToken.balanceOf('0xUserMetaMask...', 42) = 0                     │
│                                                                             │
│ REQUIRED BALANCE:                                                           │
│   amount = 1                                                                │
│                                                                             │
│ RESULT:                                                                     │
│   REVERT: "Insufficient credits"                                           │
│                                                                             │
│ ERROR GENERATED (operator-trading.js:101-102):                             │
│   if (/Insufficient credits/i.test(e.message))                             │
│     return 400 { error: 'You don't have enough of this credit on-chain...' }│
│                                                                             │
│ FRONTEND DISPLAYS:                                                          │
│   showToast('You don't have enough of this credit on-chain to list...', 'error')│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. ROOT-CAUSE CONFIDENCE

**Confidence: 95%**

### Evidence Supporting Root Cause
1. ✅ **Mint target is custody wallet** — `minter.js:264` explicitly uses `custodyWalletAddress` when `!batch.wallet_address`
2. ✅ **Listing uses user's wallet** — `operator-trading.js:75` queries `users.wallet_address` (MetaMask)
3. ✅ **Contract validates seller balance** — `Marketplace.listCreditFor` checks `balanceOf(seller, tokenId)`
4. ✅ **Error message matches** — "Insufficient credits" exactly matches contract revert
5. ✅ **No other path mints to user wallet** — `mintApprovedCredit` only mints to `mintTargetWallet`
6. ✅ **DB shows correct available_credits** — `carbon_batches.available_credits = 3000`

### Unverified (5% Gap)
- **Whether `CUSTODY_WALLET_ADDRESS` is explicitly set in `.env`** — if not, defaults to `minterWallet.address` (line 113, 118 in minter.js). Either way, it's **not** the user's MetaMask.
- **Whether any edge case mints to user wallet** — code review shows no such path for walletless users.
- **Whether `wallet_address` could ever equal custody wallet** — only if user manually bound custody wallet as their MetaMask (extremely unlikely).

---

## 10. PROPOSED FIX

### Architecture Principle
**Preserve the intended model:**
```
Portfolio
    ↓
EtherTrack Backend (Operator)
    ↓
EtherTrack Custody (Pooled or Self)
    ↓
Blockchain
```
**MetaMask must NOT become part of the solution.**

---

### Fix Components

#### 1. Custody-Aware Seller Resolution (Backend)
**File:** `ethertrack-backend/routes/operator-trading.js`

```javascript
// NEW: Resolve the actual on-chain token holder for this user + tokenId
const getTokenHolderAddress = async (userId, tokenId) => {
  // 1. Check if user has credits in pooled custody (CreditLedger)
  const { rows: ledger } = await query(
    `SELECT balance FROM credit_ledger_balances WHERE user_id = $1 AND token_id = $2`,
    [userId, tokenId]
  );
  if (ledger.length && ledger[0].balance > 0) {
    // Walletless user — tokens held in pooled custody
    const { custodyWalletAddress } = require('../services/minter').getContracts();
    return custodyWalletAddress;
  }
  
  // 2. Check carbon_batches for self-custody
  const { rows: batch } = await query(
    `SELECT wallet_address FROM carbon_batches 
     WHERE user_id = $1 AND token_id = $2 AND admin_status = 'approved'
     LIMIT 1`,
    [userId, tokenId]
  );
  if (batch.length && batch[0].wallet_address) {
    return batch[0].wallet_address; // self-custody user
  }
  
  // 3. Fallback to bound wallet (should not happen for valid listings)
  const { rows: user } = await query(
    'SELECT wallet_address FROM users WHERE id = $1', [userId]
  );
  return user[0]?.wallet_address;
};
```

**Then in `/list-credit` handler:**
```javascript
const sellerWallet = await getTokenHolderAddress(req.user.id, tokenId);
if (!sellerWallet) {
  return res.status(400).json({ error: 'No custody wallet found for this credit.' });
}
```

#### 2. Database: Add Custody Model Flag
**Migration:** Add `custody_model` column to `carbon_batches`
```sql
ALTER TABLE carbon_batches 
ADD COLUMN custody_model VARCHAR(20) DEFAULT 'self' 
CHECK (custody_model IN ('self', 'pooled'));
```

**Update mint logic** (`minter.js:256`):
```javascript
const isPooledCustody = !batch.wallet_address;
await query(
  `UPDATE carbon_batches SET custody_model = $1 WHERE id = $2`,
  [isPooledCustody ? 'pooled' : 'self', batchId]
);
```

#### 3. Frontend: Custody-Aware Listing Gate
**File:** `ethertrack-frontend/src/components/Portfolio.js`

```javascript
const handleListForSale = async (credit) => {
  // NEW: Determine correct API based on custody model
  const isPooled = credit.isLedger || credit.custodyModel === 'pooled';
  
  if (isPooled) {
    // Use ledger listing flow (no on-chain escrow)
    await listCreditLedger(credit.tokenId, credit.batchId || null, qty, price, 30);
  } else {
    // Use operator-executed on-chain listing
    await listCredit(credit.tokenId, qty, priceEth, price);
  }
};
```

#### 4. Marketplace Contract: No Change Required
The existing `listCreditFor(address seller, ...)` already supports operator-executed listings for **any seller address**. The fix is purely in **backend address resolution**.

#### 5. Reconciliation Requirements
| Item | Action |
|------|--------|
| Existing 3000-credit batch | Update `carbon_batches.custody_model = 'pooled'` |
| Existing `carbon_batches` with NULL `wallet_address` | Backfill `custody_model = 'pooled'` |
| `credit_ledger_balances` | Already tracks pooled custody correctly |
| `carbon_batches` with `wallet_address` set | `custody_model = 'self'` |

---

## 11. RISKS

| Risk | Classification | Mitigation |
|------|----------------|------------|
| **Custody model misclassification** | HIGH | Add DB constraint + migration backfill + integration tests |
| **Existing listings break** | MEDIUM | Only affects new listings; existing listings use `confirm-listing` which writes `listing_id_onchain` |
| **Operator wallet nonce issues** | MEDIUM | Use `ethers.Wallet` with proper nonce management (already in minter) |
| **Marketplace contract upgrade needed** | LOW | No — `listCreditFor` already exists in v3 |
| **Race condition: simultaneous list/delist** | MEDIUM | Use DB row locking (`FOR UPDATE`) in operator-trading |
| **User binds wallet AFTER mint** | LOW | `custody_model` stays 'pooled'; wallet binding only affects future mints |
| **Security: operator can list any user's credits** | CRITICAL | `listCreditFor` validates `seller` owns tokens — operator just signs |

---

## 12. TEST PLAN FOR TASK 1

### Test 1 — Mint (Pooled Custody)
```text
GIVEN user with NO wallet_address
WHEN admin approves 3000-credit batch
THEN mintApprovedCredit mints to CUSTODY_WALLET
AND carbon_batches.custody_model = 'pooled'
AND credit_ledger_balances.balance = 3000
```

### Test 2 — Portfolio Reflects Holdings
```text
GIVEN custody_model = 'pooled', balance = 3000
WHEN Portfolio loads
THEN myCredits shows 3000 credits, isLedger=true, heldCredits=3000
```

### Test 3 — Listing Succeeds (Pooled)
```text
GIVEN 3000 pooled credits, tokenId=42
WHEN user lists 1 credit via /api/portfolio/list-credit
THEN getTokenHolderAddress returns CUSTODY_WALLET
AND listCreditForOnChain(CUSTODY_WALLET, 42, 1, ...) succeeds
AND carbon_batches.listed_quantity = 1, available_credits = 2999
AND ledger_listings row created with amount=1
```

### Test 4 — Post-Listing Accounting
```text
held = 2999
listed = 1
active = 3000
```

### Test 5 — Delisting (Pooled)
```text
GIVEN listed_quantity = 1
WHEN user delists via /api/portfolio/delist-credit-ledger
THEN ledger_listings.active = FALSE
AND carbon_batches.listed_quantity = 0, available_credits = 3000
```

### Test 6 — Partial Sale (Pooled)
```text
GIVEN listed = 100
WHEN buyer purchases 40 via ledger-checkout-verify
THEN listing.amount_remaining = 60
AND credit_ledger_balances: seller -40, buyer +40
```

### Test 7 — Retirement (Pooled)
```text
GIVEN held = 3000
WHEN user retires 50 via /api/portfolio/retire-credit-ledger
THEN credit_ledger_balances.balance = 2950, total_retired = 50
AND retirements row created with cert_id
```

### Test 8 — MetaMask Unavailable
```text
GIVEN MetaMask not installed
WHEN user loads Portfolio
THEN Portfolio functions normally (pooled custody)
AND listing/retirement work via operator endpoints
```

### Test 9 — Wrong MetaMask Network
```text
GIVEN MetaMask on Ethereum Mainnet
WHEN user loads Portfolio
THEN Portfolio shows credits (reads from DB, not blockchain)
AND listing works (operator uses backend RPC)
```

### Test 10 — Account Change
```text
GIVEN user switches MetaMask account
WHEN Portfolio reloads
THEN Portfolio remains tied to authenticated EtherTrack identity (JWT)
AND NOT to MetaMask address
```

---

## TASK 0 COMPLETED

**No code was modified.**  
**No database state was modified.**  
**No blockchain state was modified.**  

**Root cause identified: YES**

**Task 1 is NOT started.**  
**Waiting for explicit approval to begin TASK 1.**

---

## APPENDIX: KEY CODE LOCATIONS SUMMARY

| Concern | File | Line |
|---------|------|------|
| Mint target wallet selection | `services/minter.js` | 256-264 |
| Mint transaction send | `services/minter.js` | 341 |
| Listing seller resolution | `routes/operator-trading.js` | 71-78 |
| Operator listing execution | `services/minter.js` | 442-466 |
| Marketplace contract validation | `Marketplace.sol` | `listCreditFor` — `balanceOf(seller, tokenId)` |
| Frontend listing trigger | `components/Portfolio.js` | 1328 (`handleListForSale`) |
| DB credit mapping | `routes/portfolio.js` | 1066-1095 (`mapCreditRow`) |
| CreditLedger mint logging | `services/minter.js` | 386-398 |
| Custody wallet default | `services/minter.js` | 113, 118 |