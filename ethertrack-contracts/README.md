# EtherTrack Smart Contracts

Carbon Credit Exchange on Polygon — Production-grade Solidity contracts.

## Contracts

| Contract | Purpose | Replaces in Frontend |
|---|---|---|
| `KYCRegistry.sol` | KYC verification per wallet | `AuthContext.kycCompleted` |
| `CarbonCreditToken.sol` | ERC-1155 carbon credits | `Portfolio.js credits[]` |
| `Marketplace.sol` | Order book, buy/sell, limit orders | `CarbonCredits.js` all state |
| `EmissionRegistry.sol` | Emission logging + calculation | `EmissionTracking.js` |
| `Treasury.sol` | Platform fee collection (0.5%) | Display-only fee in UI |

## Setup

```bash
cd ethertrack-contracts
npm install
cp .env.example .env
# Fill in your PRIVATE_KEY and API keys in .env
```

## Deploy

```bash
# Mumbai Testnet
npm run deploy:mumbai

# Polygon Mainnet
npm run deploy:mainnet

# Local (for testing)
npx hardhat node
npm run deploy:local
```

After deploy, copy the generated `.env` file from `deployments/` to your React `src/.env`.

## Connect Frontend

Copy hooks to your React project:
```
src/hooks/useContracts.js   ← master hook
src/hooks/useKYC.js         ← replaces AuthContext.kycCompleted
src/hooks/usePortfolio.js   ← replaces Portfolio.js state
src/hooks/useMarket.js      ← replaces CarbonCredits.js state
src/hooks/useEmissions.js   ← replaces EmissionTracking.js state
src/config/contracts.config.js ← addresses + ABIs
```

### Usage in Portfolio.js
```jsx
// BEFORE
const [credits, setCredits] = useState(SEED_CREDITS);

// AFTER
const { credits, fetchCredits, registerCredit, retireCredit, listCredit } = usePortfolio();
useEffect(() => { fetchCredits(walletAddress); }, [walletAddress]);
```

### Usage in CarbonCredits.js
```jsx
// BEFORE
const [listings] = useState(MOCK_LISTINGS);

// AFTER
const { listings, buyCredit, placeLimitOrder } = useMarket();
useEffect(() => { fetchListings(); }, []);
```

## Contract Architecture

```
KYCRegistry
    ↑ checks KYC
    |
CarbonCreditToken (ERC-1155)
    ↑ holds credits
    |
Marketplace ──── Treasury (0.5% fee)
    ↑ trades
    |
EmissionRegistry (logs emissions)
```

## Testnet Faucet (Mumbai MATIC)
Get free test MATIC: https://faucet.polygon.technology

## Polygonscan Verification
```bash
npm run verify:mumbai
```
