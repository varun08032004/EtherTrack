# EtherTrack — Master Product Roadmap: From Foundation to Market Leadership

**Vision:** Build the **Zerodha/Groww layer for carbon assets in India** — the infrastructure through which businesses discover, evaluate, manage, transact, retire, and comply using carbon credits (VCM today → CCTS tomorrow).

**Current State:** Phase 0 not started. See `PHASE0_AUDIT_AND_IMPLEMENTATION_PLAN.md` for immediate tasks.

---

## 🏗️ PHASE ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ETHERTRACK PRODUCT LAYERS                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LAYER 7: INSTITUTIONAL DISTRIBUTION      ← Phase 5-6                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ White-label APIs • Bank/Insurer Embedding • ERP Integrations        │   │
│  │ Forward Contracts • Structured Products • Article 6 Readiness       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↑                                        │
│  LAYER 6: CCTS EXECUTION INFRASTRUCTURE   ← Phase 4-5                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ IEX/PXIL Adapters • ICM Registry Sync • Compliance CCC Surrender    │   │
│  │ GEI Calculator • Procurement Tracker • Deadline Alerts              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↑                                        │
│  LAYER 5: COMPLIANCE INTELLIGENCE         ← Phase 3-4                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ BRSR/CDP/TCFD/GHG Reports • Audit Trail • Verifier Portal           │   │
│  │ PAT/GEI/CCTS Position Engine • Supplier Scope 3 Network             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↑                                        │
│  LAYER 4: MARKETPLACE & LIQUIDITY         ← Phase 2-3                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Hybrid RFQ + Order Book • Price Indices • ECS Quality Scores        │   │
│  │ Institutional Bulk API • Seller Onboarding • Liquidity Incentives   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↑                                        │
│  LAYER 3: CARBON ASSET INFRASTRUCTURE     ← Phase 1-2                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Asset Passport (Provenance/Eligibility) • Registry Sync (Verra/GS)  │   │
│  │ Double-Entry Carbon Ledger • Retirement Certificates • Lifecycle    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↑                                        │
│  LAYER 2: CARBON INTELLIGENCE             ← Phase 1                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Emission Calculation Engine • India Factor Library • MRV Workflow   │   │
│  │ Scope 1/2/3 • BRSR Auto-Populate • ECS Quality Engine               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    ↑                                        │
│  LAYER 1: FOUNDATION (PHASE 0)            ← IMMEDIATE                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Single Settlement • Correct Reservations • KYC Enforcement          │   │
│  │ Operator Multi-Sig • Sync Chain Settlement • Double-Entry Ledgers   │   │
│  │ Reconciliation • State Machines • Adversarial Tests                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📅 DETAILED PHASE BREAKDOWN

### PHASE 0: FOUNDATION (Weeks 1-4) — **IN PROGRESS**
*Goal: Eliminate existential risks. No new features.*

| Week | Focus | Key Deliverables |
|------|-------|------------------|
| 1-2 | Legacy Removal + Reservation Fix | Single settlement path, on-chain reservations, frontend migrated |
| 2-3 | KYC Bypass + Operator Security | Contract fixes deployed, multi-sig retirement, role separation |
| 3-4 | Double-Entry Ledgers + Sync Settlement | Financial + carbon journals, synchronous chain, reconciliation, adversarial tests |

**Exit Criteria:** All 10 Definition of Done checks pass. Zero P0 risks remain.

---

### PHASE 1: CARBON INTELLIGENCE (Weeks 5-12)
*Goal: Best-in-class GHG accounting for Indian enterprises. Revenue: SaaS subscriptions.*

#### 1.1 Emission Calculation Engine (Weeks 5-8)
| Task | Details |
|------|---------|
| **India Factor Library** | Versioned CEA grid factors (0.727 tCO₂/MWh v20.0), IPCC 2006/2019, BEE sectoral, custom factors with source audit trail |
| **Methodology Templates** | GHG Protocol Corporate, ISO 14064-1, BRSR Core, SEBI BRSR, PAT, CCTS — each as selectable template with required fields |
| **Auto-Calculation** | Activity × Factor = CO₂e (server-side). No manual CO₂e entry. Factor selection UI with version pinning |
| **Scope 1/2/3 Guidance** | Interactive wizard: stationary combustion, mobile, fugitive, purchased electricity, T&D losses, purchased goods, capital goods, fuel/energy, transport, waste, business travel, employee commuting, leased assets, franchises, investments |

#### 1.2 MRV Workflow (Weeks 7-9)
| Task | Details |
|------|---------|
| **Plan → Collect → Verify → Approve** | Maker-checker for emission entries. Verifier role with evidence review (PDF, meter readings, invoices) |
| **Evidence Management** | IPFS storage for source documents. Hash recorded on-chain via CreditLedger (MINT action type) |
| **Version Control** | Every factor change creates new version. Historical calculations immutable. Recalculation on demand |
| **Audit Trail** | Hash-chained audit log (already in BRSR) extended to all emission entries |

#### 1.3 BRSR/CDP/TCFD Reporting (Weeks 8-10)
| Task | Details |
|------|---------|
| **Auto-Populate** | One-click: Emission Activities → BRSR Principle 6 (E1 GHG), Section A (Energy), Section B (Water/Waste) |
| **PDF Generation** | Professional reports with company letterhead, methodology appendix, verification statement |
| **CDP/TCFD Mapping** | Crosswalk tables: BRSR ↔ CDP climate change ↔ TCFD recommendations |
| **Assurance Ready** | Verifier portal with read-only access, sampling tools, evidence packaging |

#### 1.4 ECS Quality Engine (Weeks 10-12)
| Task | Details |
|------|---------|
| **Multi-Dimensional Scoring** | Additionality, Permanence, Methodology Risk, Verification Quality, Registry Provenance, Project Risk, Country Risk, Double-Counting Risk, Vintage, Transparency, Co-Benefits |
| **Data Pipeline** | Verra/GS API sync → project docs → satellite (forestry) → verifier DB → news/sanctions → corresponding adjustment registry |
| **Percentile Ranking** | Each asset ranked vs all in registry. Historical score tracking |
| **Disclaimer** | Prominent: "Not a certification. For informational purposes only." |

**Phase 1 Exit:** Growth plan (₹10k/mo) delivers complete GHG accounting + reporting. Corporate plan (custom) adds assurance + Scope 3.

---

### PHASE 2: VCM ASSET INFRASTRUCTURE (Weeks 10-20)
*Goal: Trusted VCM marketplace with institutional-grade asset data. Revenue: Transaction fees + listing fees.*

#### 2.1 Registry Integration (Weeks 10-14)
| Registry | Approach | Timeline |
|----------|----------|----------|
| **Verra (VCS)** | API partnership (read-only metadata + retirement status) | Weeks 10-12 |
| **Gold Standard** | API partnership | Weeks 11-13 |
| **CDM/ACR** | CSV bulk import (monthly) + manual verification | Weeks 12-14 |
| **ICM (CCTS)** | Wait for API spec → sandbox → production | Phase 4 |

#### 2.2 Asset Passport (Weeks 12-15)
| Component | Fields |
|-----------|--------|
| **Identity** | asset_id, instrument_type (VCM_CREDIT/CCTS_OFFSET_CCC/CCTS_COMPLIANCE_CCC), registry, project_id, methodology, vintage, geography |
| **Provenance** | Full chain: registry issuance → project → batch → current owner (on-chain + DB) |
| **Eligibility** | vcm_retirement, ccts_offset_use, ccts_compliance_surrender, corsia_eligible, article6_authorized |
| **Quality** | ECS score, percentile, data sources, last_updated |
| **Market** | Price history (30d/90d/1y), volume, bid/ask spread, liquidity score |

#### 2.3 Double-Entry Carbon Ledger (Weeks 13-16)
*Already designed in Phase 0 — implement fully:*
- Accounts: ASSET_INVENTORY, OWNER_POSITION, RESERVED, PENDING_SETTLEMENT, RETIRED, TRANSFER_CLEARING
- Journal entries for every MINT/LIST/DELIST/TRADE/RETIRE/TRANSFER
- Conservation invariants enforced by triggers

#### 2.4 Retirement & Certificates (Weeks 15-17)
- One-click retirement (VCM voluntary + CCTS offset)
- PDF certificate with QR verification (public `/verify/:certId`)
- On-chain retirement proof (CreditLedger.logRetirement + CarbonCreditToken.retireCreditFor)
- Batch retirement for corporate buyers

#### 2.5 Seller Onboarding (Weeks 16-18)
- Project submission → verification → approval → mint → list
- Developer dashboard: project status, batch tracking, sales analytics
- KYC + bank account verification (Razorpay fund_account)
- Revenue share: 0.5% buyer fee + 0.5% seller fee (configurable)

#### 2.6 Marketplace V1 (Weeks 17-20)
- Listings with filters: standard, methodology, vintage, geography, price, quantity, ECS score
- Price indices: VCS-Forestry-2023, GS-Renewable-2022, etc.
- Trade history (public + private)
- Basic analytics: volume, avg price, market cap

**Phase 2 Exit:** Starter plan (₹1k/mo) + transaction fees. 50+ projects, 1000+ credits listed, ₹50L+ GMV/mo.

---

### PHASE 3: MARKETPLACE & LIQUIDITY (Weeks 18-32)
*Goal: Deep liquidity for institutional buyers. Revenue: Transaction fees + premium analytics + API.*

#### 3.1 Hybrid Marketplace Model (Weeks 18-24)
| Segment | Mechanism | Features |
|---------|-----------|----------|
| **Retail (<10k credits)** | Order book (price-time priority) | Instant execution, familiar UX, market depth |
| **Institutional (10k-100k)** | RFQ (Request for Quote) | Negotiated pricing, compliance checks, multi-seller |
| **Large/Structured (>100k)** | OTC + API | Forward contracts, multi-leg, structured products |

#### 3.2 RFQ Engine (Weeks 20-26)
- Buyer posts RFQ: quantity, vintage range, methodology, max price, deadline
- Sellers respond with quotes (binding for 15 min)
- Buyer selects → auto-executes via SettlementEngine
- Audit trail: all quotes logged, best execution documented

#### 3.3 Price Indices & Analytics (Weeks 22-28)
- **Daily Indices**: VCS-Forestry, GS-Renewable, CDM-Industrial, Vintage-adjusted
- **Forward Curves**: 3M/6M/12M implied forwards from RFQ data
- **Liquidity Metrics**: Bid-ask spread, depth, turnover, days-to-sell
- **API Access**: REST + WebSocket for real-time prices

#### 3.4 Institutional Features (Weeks 24-30)
- **Bulk Procurement API**: POST /api/v1/procurement/batch { credits[], max_price, deadline }
- **Webhooks**: Trade executed, settlement confirmed, certificate issued
- **White-Label**: Embedded marketplace for banks/insurers/ERPs
- **Compliance Procurement**: Auto-filter for CCTS-eligible, CORSIA-eligible, Article 6 authorized

#### 3.5 Liquidity Incentives (Weeks 28-32)
- **Market Maker Program**: Rebates for 2-sided quotes, minimum depth
- **Seller Acquisition**: Zero listing fees for first 6 months, volume rebates
- **Buyer Incentives**: Fee discounts for >₹1Cr/mo volume

**Phase 3 Exit:** Growth plan + transaction fees. 200+ projects, ₹5Cr+ GMV/mo, 5+ institutional buyers via API.

---

### PHASE 4: CORPORATE COMPLIANCE (Weeks 30-44)
*Goal: Default compliance platform for Indian obligated entities. Revenue: Corporate SaaS + compliance procurement fees.*

#### 4.1 CCTS Compliance Engine (Weeks 30-36)
| Component | Details |
|----------|---------|
| **GEI Calculator** | Baseline/Target from BEE notification → production data → actual GEI → surplus/deficit CCCs |
| **Compliance Position** | Real-time: surplus CCCs (sellable) vs deficit CCCs (must procure) |
| **Procurement Tracker** | Required qty → RFQ → execution → ICM surrender → deadline countdown |
| **Multi-Entity** | Group consolidation: parent + subsidiaries, shared/split obligations |
| **Audit Trail** | Immutable log for verifier/BEE audit |

#### 4.2 Exchange Adapters (Weeks 32-38)
| Exchange | Integration |
|----------|-------------|
| **IEX** | Sandbox → production. Order routing, status polling, settlement confirmation |
| **PXIL** | Same as IEX |
| **ICM Registry** | Read API: holdings, surrender status, compliance certificates |

#### 4.3 Compliance Workflow (Weeks 36-42)
1. **Obligation Assessment** → GEI position calculated
2. **Procurement Plan** → Required CCCs, timeline, budget
3. **RFQ Execution** → Offset CCCs (voluntary) or Compliance CCCs (exchange)
4. **Surrender** → ICM Registry via exchange adapter
5. **Reporting** → Form A/B/C/D/E2 auto-filled, PDF for BEE submission

#### 4.4 BRSR/CDP/TCFD + CCTS Unified Reporting (Weeks 40-44)
- Single report: GHG inventory + BRSR Principle 6 + CCTS compliance position
- Verifier portal: evidence sampling, cross-check with registry
- Audit-ready package for statutory auditors

**Phase 4 Exit:** Corporate plan (custom pricing). 20+ obligated entities, ₹2Cr+ ARR from compliance SaaS.

---

### PHASE 5: CCTS EXECUTION INFRASTRUCTURE (Weeks 42-56)
*Goal: Authorized execution layer for CCTS. Revenue: Procurement fees + exchange rebates.*

#### 5.1 Exchange Membership / Broker Partnership (Weeks 42-48)
- **Option A**: Apply for IEX/PXIL trading membership (capital req: ~₹5Cr, 6-12 months)
- **Option B**: Partner with existing member (revenue share, faster)
- **Decision Gate**: Week 40 — evaluate based on Phase 4 traction

#### 5.2 ICM Registry Integration (Weeks 44-52)
- **Holdings API**: Real-time CCC balances per entity
- **Surrender API**: Programmatic compliance surrender
- **Certificate API**: Verified surrender certificates for auditors

#### 5.3 Compliance CCC Marketplace (Weeks 48-54)
- Separate instrument type: `CCTS_COMPLIANCE_CCC` (non-fungible with VCM)
- Exchange order routing → ICM surrender → compliance certificate
- Price discovery: Compliance CCC vs Offset CCC spread

#### 5.4 Article 6 / ITMO Readiness (Weeks 52-56)
- Corresponding adjustment tracking
- ITMO authorization workflow
- International registry connectors (CAD Trust, Climate Action Data Trust)

**Phase 5 Exit:** Authorized CCTS execution partner. ₹10Cr+ GMV/mo in compliance CCCs.

---

### PHASE 6: INSTITUTIONAL DISTRIBUTION (Weeks 54-72)
*Goal: Embedded carbon infrastructure. Revenue: API fees + enterprise SaaS + structured products.*

#### 6.1 Embedded Finance (Weeks 54-62)
| Partner | Product |
|---------|---------|
| **Banks** | Carbon-linked loans (lower rate for verified reduction), trade finance for CCC procurement |
| **Insurers** | Parametric climate risk covers, transition risk pricing |
| **Asset Managers** | Carbon credit funds, transition equity overlays |

#### 6.2 ERP / Accounting Integrations (Weeks 56-64)
- **Tally/Zoho/SAP**: Auto-sync emission data, carbon positions, compliance deadlines
- **Journal Entry Push**: Financial + carbon journals → ERP GL
- **Tax/GST**: Auto-calculate GST on carbon transactions, file returns

#### 6.3 Forward & Structured Products (Weeks 60-68)
- **Forward Contracts**: Lock price for future vintage delivery
- **Options**: Call/put on compliance CCCs
- **Structured Notes**: Principal-protected notes linked to carbon index

#### 6.4 International Expansion (Weeks 64-72)
| Market | Strategy |
|--------|----------|
| **SE Asia** | Partner with local registries (Thailand T-VER, Indonesia IDN-CC) |
| **Middle East** | GCC carbon markets (Saudi RCF, UAE Carbon Credits) |
| **Africa** | Article 6 host country partnerships |

**Phase 6 Exit:** Category leader. ₹100Cr+ ARR. 500+ enterprise clients. Default carbon infrastructure for India.

---

## 💰 REVENUE MODEL EVOLUTION

| Phase | Primary Revenue | Secondary | Target |
|-------|-----------------|-----------|--------|
| 0 | — | — | Risk elimination |
| 1 | SaaS (₹1k-₹10k+/mo) | Report generation | ₹50L ARR |
| 2 | Transaction fees (1% total) + Listing fees | Premium analytics | ₹2Cr ARR |
| 3 | Transaction fees + API fees + Market data | Market maker rebates | ₹10Cr ARR |
| 4 | Corporate SaaS (₹5-50L/yr) + Procurement fees (0.5%) | Verifier marketplace | ₹20Cr ARR |
| 5 | Procurement fees (1-2%) + Exchange rebates | Surrender fees | ₹50Cr ARR |
| 6 | API fees + Enterprise SaaS + Structured product margins | White-label licensing | ₹100Cr+ ARR |

---

## 🛡️ MOAT COMPOUNDING STRATEGY

| Moat | Phase Built | How It Compounds |
|------|-------------|------------------|
| **CCTS Compliance Intelligence** | 1-4 | First-mover in regulatory complexity → mandatory for obligated entities |
| **INR-Native Settlement** | 0-2 | Zero crypto friction → mass adoption → network effects |
| **Unified GHG→Offset→Compliance** | 1-4 | Single workflow → high switching cost → data gravity |
| **CreditLedger.sol Audit Trail** | 0 | Tamper-evident ownership → adopted by registries/exchanges → standard |
| **EtherTrack Carbon Score (ECS)** | 1-2 | Proprietary quality data → improves with every trade → pricing power |
| **Supplier Scope 3 Network** | 1-3 | Largest Indian corporate emission dataset → mandatory for supply chain reporting |
| **Exchange-Agnostic Routing** | 4-5 | Best execution → locked-in order flow → volume discounts |
| **Regulatory Advisory Moat** | 3-5 | In-house legal interpreting CCTS/BEE/SEBI → productized compliance |

---

## 🚫 WHAT NOT TO BUILD (EVER)

| Feature | Reason |
|---------|--------|
| AMM / DEX for carbon credits | Non-fungible assets, no liquidity, wrong model |
| Fractional credit tokenization | Securities law risk, no institutional demand |
| Internal CCTS exchange | Regulatory capture — must use CERC-approved exchanges |
| Governance token / DAO | Regulatory distraction, no revenue |
| Multi-chain (beyond Polygon) | Complexity without user demand |
| Retail gamification | Trivializes compliance asset |
| Speculative trading features | Reputational risk, regulatory scrutiny |

---

## 📊 SUCCESS METRICS BY PHASE

| Metric | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |
|--------|---------|---------|---------|---------|---------|---------|---------|
| **GMV/mo** | — | — | ₹50L | ₹5Cr | ₹20Cr | ₹50Cr | ₹200Cr |
| **ARR** | — | ₹50L | ₹2Cr | ₹10Cr | ₹20Cr | ₹50Cr | ₹100Cr+ |
| **Projects** | — | — | 50 | 200 | 300 | 400 | 500+ |
| **Institutional Buyers** | — | — | 5 | 20 | 50 | 100 | 200+ |
| **Obligated Entities** | — | — | — | — | 20 | 50 | 100+ |
| **API Partners** | — | — | — | 5 | 15 | 30 | 50+ |
| **Carbon Credits Tracked** | — | — | 10k | 100k | 1M | 5M | 20M+ |

---

## 🔄 DEPENDENCY MAP (Critical Path)

```
Phase 0 (Foundation)
    │
    ├─→ Phase 1 (Carbon Intelligence) ──┐
    │                                    │
    ├─→ Phase 2 (VCM Assets) ←───────────┘
    │         │
    ├─→ Phase 3 (Marketplace) ←──────────┘
    │         │
    ├─→ Phase 4 (Compliance) ←───────────┘
    │         │
    ├─→ Phase 5 (CCTS Execution) ←───────┘
    │         │
    └─→ Phase 6 (Distribution) ←─────────┘
```

**Critical Path:** Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 (sequential dependencies)
**Parallel Tracks:** Phase 1 & 2 can overlap after Phase 0 Week 2. Phase 3 starts when Phase 2 Week 3 delivers Asset Passport.

---

## 📁 FILE STRUCTURE FOR TRACKING

```
EtherTrack/
├── PHASE0_AUDIT_AND_IMPLEMENTATION_PLAN.md    ← Phase 0 detailed tracker
├── MASTER_PRODUCT_ROADMAP.md                   ← This file
├── docs/
│   ├── PHASE1_SPEC.md                          ← To create after Phase 0
│   ├── PHASE2_SPEC.md
│   ├── PHASE3_SPEC.md
│   ├── PHASE4_SPEC.md
│   ├── PHASE5_SPEC.md
│   ├── PHASE6_SPEC.md
│   ├── ARCHITECTURE_DECISIONS.md               ← ADR log
│   ├── REGULATORY_COMPLIANCE.md                ← Legal opinions, gate decisions
│   └── ROLLBACK_PLANS.md                       ← Per-phase rollback
└── scripts/
    ├── deploy-phase0.sh
    ├── deploy-phase1.sh
    └── rollback-phase0.sh
```

---

## 🎯 NEXT ACTIONS

1. **Complete Phase 0** (4 weeks) — Use `PHASE0_AUDIT_AND_IMPLEMENTATION_PLAN.md`
2. **Create Phase 1 Spec** — Week 3 of Phase 0, detail Emission Calculation Engine
3. **Hire/Assign** — Phase 1 needs: Carbon domain expert, Backend (calculation engine), Frontend (reporting UI)
4. **Legal Gate** — Week 2 of Phase 0: Confirm CCTS interpretation with regulatory counsel (blocking for Phase 4+)

---

**Update this file at each phase gate. Add timestamps, decisions, metric actuals vs targets.**