# EtherTrack — Phase 2 Implementation Plan: VCM Asset Infrastructure & Marketplace

**Generated:** 2025-08-22  
**Status:** Phase 2 Planning — Ready to implement  
**Reference:** This file tracks Phase 2 implementation progress.

---

## 🎯 PHASE 2 OBJECTIVE

> Build the **VCM Asset Infrastructure & Marketplace** — the commercial layer that enables discovery, evaluation, trading, and settlement of voluntary carbon credits. This transforms EtherTrack from a compliance tool into a **two-sided carbon marketplace** with institutional-grade infrastructure.

---

## 📋 PHASE 2 SCOPE

| Component | Weeks | Status |
|-----------|-------|--------|
| **2.1 Asset Passport** | 1-3 | 🔄 Planning |
| **2.2 Registry Sync** | 3-5 | 🔄 Planning |
| **2.3 Hybrid Marketplace** | 5-8 | 🔄 Planning |
| **2.4 Seller Onboarding** | 8-10 | 🔄 Planning |
| **2.5 Institutional API** | 10-12 | 🔄 Planning |

---

## 🎯 PHASE 2 OBJECTIVE

> Build the **VCM marketplace infrastructure** that connects carbon credit suppliers (project developers, brokers) with buyers (corporates, institutions) through a transparent, liquid, and compliant marketplace — the "Zerodha for carbon credits."

---

## 📋 PHASE 2 SCOPE

| Component | Weeks | Status |
|-----------|-------|--------|
| **2.1 Asset Passport** | 1-3 | 🔄 Planning |
| **2.2 Registry Sync** | 3-5 | 🔄 Planning |
| **2.3 Hybrid Marketplace** | 5-8 | 🔄 Planning |
| **2.4 Seller Onboarding** | 8-10 | 🔄 Planning |
| **2.5 Institutional API** | 10-12 | 🔄 Planning |

---

## ✅ IMPLEMENTATION TRACKER

### 2.1 Asset Passport (Weeks 1-3) 🔄 Planning

#### Database
- [ ] **Migration 017**: `carbon_asset_passports` table with full provenance chain
- [ ] **Migration 018**: `asset_eligibility_rules` for VCM/CCTS/Article 6 eligibility
- [ ] **Migration 019**: `asset_quality_scores` with ECS breakdown
- [ ] **Migration 020**: `asset_price_history` for market data

#### Service Layer
- [ ] **AssetPassportService.ts**: CRUD for passports, provenance chain building
- [ ] **EligibilityEngine.ts**: Real-time eligibility checks (VCM, CCTS Offset, CCTS Compliance, Article 6, CORSIA)
- [ ] **PriceIndexService.ts**: Daily price indices by vintage/methodology/geography
- [ ] **AssetSearchService.ts**: Full-text + faceted search (methodology, vintage, geography, price, ECS)

#### API Routes (`/api/assets`)
| Endpoint | Method | Auth | Plan | Description |
|----------|--------|------|------|-------------|
| `/assets` | GET | ✅ | Growth | List with filters (methodology, vintage, geography, price, ECS) |
| `/assets/:id` | GET | ✅ | Growth | Full passport with provenance chain |
| `/assets/:id/eligibility` | GET | ✅ | Growth | Eligibility matrix for all schemes |
| `/assets/:id/price-history` | GET | ✅ | Growth | Price history with volume |
| `/assets/search` | POST | ✅ | Growth | Advanced search with facets |
| `/assets/price-indices` | GET | ✅ | Growth | Daily price indices by vintage/methodology |

#### Frontend
- [ ] **AssetPassportPage.jsx**: Full passport view with provenance tree
- [ ] **AssetSearch.jsx**: Faceted search with filters sidebar
- [ ] **PriceCharts.jsx**: Interactive price charts with volume
- [ ] **EligibilityMatrix.jsx**: Visual eligibility matrix

---

### 2.2 Registry Sync (Weeks 3-5) 🔄 Planning

#### Registry Adapters
- [ ] **VerraAdapter.ts**: Verra API v1 integration (projects, credits, retirements)
- [ ] **GoldStandardAdapter.ts**: Gold Standard API (projects, credits, retirements)
- [ ] **CDMAdapter.ts**: UNFCCC CDM registry (projects, CERs)
- [ ] **ACRAdapter.ts**: American Carbon Registry API
- [ ] **ICMAdapter.ts**: India ICM Registry (when API available)

#### Sync Engine
- [ ] **RegistrySyncService.ts**: Orchestrates periodic sync with conflict resolution
- [ ] **DeltaSyncEngine.ts**: Incremental sync using last-modified timestamps
- [ ] **ConflictResolver.ts**: Handles conflicts (registry wins, manual override, flag for review)
- [ ] **SyncScheduler.ts**: Cron-based scheduler with exponential backoff

#### Data Models
- [ ] **RegistryProject**: Canonical project metadata from registry
- [ ] **RegistryCredit**: Credit batches with serial numbers, vintage, status
- [ ] **SyncJob**: Sync job tracking with status, errors, records processed

#### API Routes (`/api/registry`)
| Endpoint | Method | Auth | Plan | Description |
|----------|--------|------|------|-------------|
| `/sync` | POST | ✅ | Admin | Trigger manual sync for registry |
| `/sync/status` | GET | ✅ | Admin | Sync status dashboard |
| `/projects` | GET | ✅ | Growth | Search registry projects |
| `/projects/:id` | GET | ✅ | Growth | Project details with credits |
| `/credits` | GET | ✅ | Growth | Search credits across registries |
| `/credits/:serial` | GET | ✅ | Growth | Credit details by serial number |

#### Features
- [ ] **Incremental Sync**: Only fetch changes since last sync
- [ ] **Conflict Resolution**: Registry wins by default, manual override queue
- [ ] **Data Quality**: Validation rules, anomaly detection, alerts
- [ ] **Historical Snapshots**: Point-in-time registry state for audit

---

### 2.3 Hybrid Marketplace (Weeks 5-8) 🔄 Planning

#### Market Models
| Segment | Mechanism | Target Users | Settlement |
|---------|-----------|--------------|------------|
| **Retail** | Order Book (price-time priority) | Individual buyers, small corporates | Instant (INR wallet) / T+1 (Razorpay) |
| **Institutional** | RFQ (Request for Quote) | Corporates, funds, banks | T+2 (escrow) / OTC |
| **Large/Structured** | OTC Negotiated + API | Utilities, airlines, banks | Custom (forward, structured) |

#### Core Services
- [ ] **OrderBookService.ts**: Price-time priority matching, depth, spread
- [ ] **RFQService.ts**: Quote requests, binding quotes (15-min validity), multi-seller
- [ ] **OTCService.ts**: Negotiation workflow, counterparty KYC, escrow
- [ ] **MatchingEngine.ts**: Core matching logic with price-time priority
- [ ] **MarketDataService.ts**: Real-time feeds, depth, VWAP, OHLCV

#### Order Types
| Type | Description | Use Case |
|------|-------------|----------|
| **Market Order** | Immediate execution at best price | Retail, urgent |
| **Limit Order** | Execute at specified price or better | Price-sensitive |
| **RFQ** | Request quotes from sellers | Institutional, large volume |
| **OTC Block** | Negotiated bilateral | Structured, forward |

#### Market Data
- [ ] **Price Indices**: Daily indices by vintage/methodology/geography
- [ ] **Market Depth**: Order book depth, spread, liquidity score
- [ ] **Historical Data**: OHLCV, volume, VWAP
- [ ] **Market Analytics**: Liquidity metrics, concentration, turnover

#### API Routes (`/api/market`)
| Endpoint | Method | Auth | Plan | Description |
|----------|--------|------|------|-------------|
| `/listings` | GET | ✅ | Growth | Public listings with filters |
| `/listings` | POST | ✅ | Growth | Create listing (seller) |
| `/listings/:id` | GET/PUT/DELETE | ✅ | Growth | Listing CRUD |
| `/orders` | POST | ✅ | Growth | Place order (market/limit) |
| `/orders/:id` | GET/PUT/DELETE | ✅ | Growth | Order management |
| `/rfq` | POST | ✅ | Corporate | Create RFQ |
| `/rfq/:id/quotes` | POST/GET | ✅ | Corporate | Submit/get quotes |
| `/otc/negotiate` | POST | ✅ | Corporate | Initiate OTC negotiation |
| `/market/depth` | GET | ✅ | Growth | Order book depth |
| `/market/stats` | GET | ✅ | Growth | Market statistics |
| `/market/indices` | GET | ✅ | Growth | Price indices |

#### Frontend
- [ ] **MarketplacePage.jsx**: Unified marketplace with tabs (Browse, RFQ, OTC)
- [ ] **OrderBookWidget.jsx**: Real-time order book with depth chart
- [ ] **RFQDashboard.jsx**: RFQ creation, quote comparison
- [ ] **OTCWorkspace.jsx**: Negotiation workspace with chat, documents
- [ ] **MarketAnalytics.jsx**: Charts, indices, liquidity metrics

---

### 2.4 Seller Onboarding (Weeks 8-10) 🔄 Planning

#### Workflow
```
REGISTER → KYC → PROJECT SUBMISSION → VERIFICATION → MINTING → LISTING
```

#### Seller Portal
- [ ] **SellerDashboard.jsx**: Dashboard with portfolio, listings, sales, payouts
- [ ] **ProjectWizard.jsx**: Multi-step project submission (metadata, documents, validation)
- [ ] **BatchManager.jsx**: Batch creation, minting, listing management
- [ ] **PayoutDashboard.jsx**: Sales history, pending payouts, bank details

#### Verification Workflow
- [ ] **DocumentValidator.ts**: AI-assisted document validation (OCR + rules)
- [ ] **VerificationQueue.ts**: Admin/verifier review queue with SLA
- [ ] **ProjectVerifier.ts**: Cross-registry validation, additionality check

#### API Routes (`/api/seller`)
| Endpoint | Method | Auth | Plan | Description |
|----------|--------|------|------|-------------|
| `/projects` | GET/POST | ✅ | Growth | List/create projects |
| `/projects/:id` | GET/PUT | ✅ | Growth | Project details |
| `/projects/:id/submit` | POST | ✅ | Growth | Submit for verification |
| `/projects/:id/batches` | GET/POST | ✅ | Growth | Batch management |
| `/batches/:id/mint` | POST | ✅ | Growth | Mint credits |
| `/batches/:id/list` | POST | ✅ | Growth | Create listing |
| `/payouts` | GET | ✅ | Growth | Payout history |
| `/payouts/bank-details` | PUT | ✅ | Growth | Bank account management |

---

### 2.5 Institutional API (Weeks 10-12) 🔄 Planning

#### API Products
| Product | Description | Pricing |
|---------|-------------|---------|
| **Procurement API** | Bulk credit procurement, recurring orders | Per-transaction |
| **Market Data API** | Real-time prices, indices, depth | Subscription |
| **Compliance API** | Portfolio compliance, CCTS position | Subscription |
| **White-label Marketplace** | Embedded marketplace for banks/insurers | Revenue share |

#### API Routes (`/api/v1/institutional`)
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/procurement/quote` | POST | API Key | Get firm quote for bulk procurement |
| `/procurement/order` | POST | API Key | Place bulk order |
| `/procurement/orders` | GET | API Key | Order history |
| `/market/data` | GET | API Key | Real-time market data |
| `/market/indices` | GET | API Key | Price indices |
| `/compliance/position` | GET | API Key | CCTS compliance position |
| `/compliance/procurement-plan` | POST | API Key | Generate procurement plan |
| `/webhooks` | POST | API Key | Register webhook endpoints |

#### Features
- [ ] **API Key Management**: Scoped keys (read/write), rotation, rate limits
- [ ] **Webhooks**: Order updates, price alerts, compliance alerts
- [ ] **Rate Limiting**: Tiered (Starter/Growth/Corporate/Enterprise)
- [ ] **SDKs**: TypeScript, Python, Go
- [ ] **Documentation**: OpenAPI spec, Postman collection, guides

#### White-label
- [ ] **Embeddable Widget**: Marketplace iframe for partner sites
- [ ] **Custom Branding**: Logo, colors, domain
- [ ] **SSO Integration**: SAML/OIDC for enterprise

---

## 📊 SUCCESS METRICS

| Metric | Target |
|--------|--------|
| **Asset Coverage** | 100% of listed credits with passports |
| **Registry Sync Latency** | < 24 hours |
| **Marketplace Liquidity** | ₹10Cr+ GMV/month by month 6 |
| **Order Fill Rate** | > 95% for limit orders |
| **RFQ Response Time** | < 30 minutes median |
| **Seller Onboarding Time** | < 48 hours (KYC + verification) |
| **API Uptime** | 99.9% |
| **API Latency (p99)** | < 200ms |

---

## 📁 FILE STRUCTURE FOR PHASE 2

```
src/
├── services/
│   ├── assetPassportService.ts
│   ├── eligibilityEngine.ts
│   ├── priceIndexService.ts
│   ├── assetSearchService.ts
│   ├── registrySyncService.ts
│   ├── registryAdapters/
│   │   ├── verraAdapter.ts
│   │   ├── goldStandardAdapter.ts
│   │   ├── cdpAdapter.ts
│   │   ├── acrAdapter.ts
│   │   └── icmAdapter.ts
│   ├── marketplace/
│   │   ├── orderBookService.ts
│   │   ├── rfqService.ts
│   │   ├── otcService.ts
│   │   ├── matchingEngine.ts
│   │   └── marketDataService.ts
│   ├── sellerOnboardingService.ts
│   ├── institutionalApiService.ts
│   └── webhookService.ts
├── routes/
│   ├── assets.js
│   ├── registry.js
│   ├── market.js
│   ├── seller.js
│   └── institutional.js
├── components/
│   ├── AssetPassportPage.jsx
│   ├── AssetSearch.jsx
│   ├── PriceCharts.jsx
│   ├── MarketplacePage.jsx
│   ├── OrderBookWidget.jsx
│   ├── RFQDashboard.jsx
│   ├── OTCWorkspace.jsx
│   ├── SellerDashboard.jsx
│   └── InstitutionalDashboard.jsx
├── db/migrations/
│   ├── 017_carbon_asset_passports.sql
│   ├── 018_asset_eligibility_rules.sql
│   ├── 019_asset_quality_scores.sql
│   ├── 020_asset_price_history.sql
│   ├── 021_registry_sync.sql
│   ├── 022_marketplace_listings.sql
│   ├── 023_marketplace_orders.sql
│   ├── 024_rfq_quotes.sql
│   ├── 025_otc_negotiations.sql
│   ├── 026_seller_onboarding.sql
│   ├── 027_institutional_api.sql
│   └── 028_webhooks.sql
```

---

## 🔧 TECHNICAL DEBT TO ADDRESS (Post-Phase 2)

| Item | Priority | Effort |
|------|----------|--------|
| Registry API rate limiting | High | 3 days |
| Order book snapshot recovery | High | 2 days |
| RFQ quote expiration handling | Medium | 2 days |
| OTC escrow smart contract | High | 5 days |
| Webhook retry with exponential backoff | Medium | 2 days |
| API versioning strategy | Medium | 2 days |

---

## 📝 NOTES & DECISIONS LOG

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-08-22 | Hybrid marketplace (Order Book + RFQ + OTC) | Different segments need different mechanisms |
| 2025-08-22 | Registry sync with conflict resolution | Registry is source of truth; manual override for exceptions |
| 2025-08-22 | RFQ over pure order book for institutional | Large blocks need negotiation, not just price-time |
| 2025-08-22 | OTC workspace with chat/docs | Structured negotiation reduces disputes |
| 2025-08-22 | Institutional API with webhooks | Enterprise integration requires real-time updates |
| 2025-08-22 | White-label with SSO | Banks/insurers need brand + security compliance |

---

## 🏁 PHASE 2 COMPLETION CRITERIA

| Criteria | Target |
|----------|--------|
| Asset Passport Coverage | 100% of listed credits |
| Registry Sync Success Rate | > 99.5% |
| Marketplace Uptime | 99.9% |
| Order Fill Rate | > 95% |
| Seller Onboarding Time | < 48 hours |
| Institutional API Latency (p99) | < 200ms |
| GMV Month 6 | ₹10Cr+ |
| Active Sellers | 50+ |
| Active Buyers | 200+ |

---

**Ready to begin implementation. Starting with 2.1 Asset Passport infrastructure.**