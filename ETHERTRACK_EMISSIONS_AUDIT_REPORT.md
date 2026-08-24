# EtherTrack Emission Tracking & Reporting: Independent Master Audit Report

---

## 1. Executive Summary

EtherTrack is a **carbon credit trading platform with emission tracking bolted on**, not a purpose-built GHG accounting platform. The emission tracking module (≈15% of the codebase) shows thoughtful feature work (AI parsing, validation, approval workflows, lineage) but has **fundamental carbon-accounting architectural gaps** that prevent it from being audit-ready or enterprise-grade.

**Overall Audit Readiness Score: 38/100**

| Category | Score | Status |
|----------|-------|--------|
| Functional Maturity | 65/100 | Features exist but incomplete |
| Carbon-Accounting Maturity | 25/100 | **Critical gaps in methodology** |
| Enterprise Maturity | 35/100 | Missing core enterprise features |
| Audit Maturity | 30/100 | Cannot reproduce calculations |
| Reporting Maturity | 45/100 | PDF generation works but content weak |
| India Readiness | 40/100 | BRSR partly done, CCTS/PAT stubs only |
| International Readiness | 20/100 | No ISO 14064, limited GHG Protocol |
| Competitive Maturity | 15/100 | Far from Watershed/Persefoni/Salesforce |

---

## 2. Current Architecture (System Map)

```
Input Sources (4 channels)
       ↓
┌─────────────────────────────────────────┐
│ Manual Entry  │  AI Parser (OCR)        │
│ CSV Import    │  ERP Sync (stub)        │
└─────────────────────────────────────────┘
       ↓
Validation Layer (client-side only)
  - Range checks
  - Unit mismatch detection
  - Duplicate fingerprinting
  - MoM anomaly detection
  - EF versioning (client-side)
       ↓
Server-Side Verification (routes/emissions.js:183-188)
  - verifyCO2e() against hardcoded SERVER_EF map
  - No factor version resolution
  - No methodology enforcement
       ↓
emission_activities table (single flat table)
  - Stores: activity, quantity, unit, scope, category, factor, co2e, date
  - approval_state: draft→submitted→reviewed→approved→locked
  - ai_audit JSON blob
  - ef_version_id (stored but not enforced)
       ↓
Aggregation (routes/emissions.js:619-632 + cacheStrategy.js:343-387)
  - getEmissionsSummary() → scope1/2/3 totals by year
  - Monthly trends, category breakdown
  - Previous year comparison
       ↓
Reporting
  - PDF (Puppeteer): GHG Protocol, BRSR, CDP, TCFD, GRI
  - CSV export
  - Dashboard charts (Chart.js)
```

---

## 3. Capability Matrix

| Capability | Status | Evidence |
|------------|--------|----------|
| **Scope 1 - Stationary Combustion** | IMPLEMENTED BUT WEAK | ManualEntry.js EF map has 7 fuels; no boiler/generator distinction |
| **Scope 1 - Mobile Combustion** | PARTIALLY IMPLEMENTED | Company vehicle km factors only; no fleet management |
| **Scope 1 - Fugitive/Refrigerants** | IMPLEMENTED BUT WEAK | 3 refrigerants (R-410A, R-22, R-32); no SF6, no leak rate methods |
| **Scope 1 - Industrial Processes** | PLACEHOLDER | BEE PAT factors seeded (cement, steel, aluminium, urea) but no process logic |
| **Scope 2 - Location-based** | IMPLEMENTED | CEA V20.0 grid factor (0.000727 tCO2/kWh) hardcoded in EF map + DB seed |
| **Scope 2 - Market-based** | PARTIALLY IMPLEMENTED | REC/PPA/Green Tariff factors exist (0.0, 0.041, 0.011) but no instrument tracking |
| **Scope 2 - Dual Reporting** | PLACEHOLDER | Both factors in UI but no mandatory dual disclosure enforcement |
| **Scope 3 - All 15 Categories** | PARTIALLY IMPLEMENTED | 15 categories in GHG Protocol template but only ~25 activity types in EF map; no spend-based, no supplier-specific |
| **Emission Factor Versioning** | PARTIALLY IMPLEMENTED | Client-side versioning (emissionFactorVersioning.js); server has version tables but not enforced in calculations |
| **Calculation Engine** | WEAK | `activity × factor = co2e` only; no unit conversion, no GWP handling, no allocation |
| **Organizational Boundaries** | NOT IMPLEMENTED | Single org_id; no consolidation method (equity/control), no facility hierarchy |
| **Operational Boundaries** | NOT IMPLEMENTED | No facility/assets, no emission source registration |
| **Base Year Management** | PLACEHOLDER | profile.base_year field only; no recalculation policy, no structural change handling |
| **Evidence Management** | PARTIALLY IMPLEMENTED | emission_evidence table (MRV workflow); AI parser attaches metadata; no OCR on backend |
| **Approval Workflow** | IMPLEMENTED AND STRONG | Maker-Checker (draft→submitted→reviewed→approved→locked), adjustments, audit log |
| **Data Lineage** | IMPLEMENTED AND STRONG | /lineage endpoint shows file→user→EF version→approver→blockchain |
| **BRSR Reporting** | PARTIALLY IMPLEMENTED | Section A/B/P1-P9 forms + environmental; auto-populate from trades+emissions |
| **CCTS/PAT Compliance** | PLACEHOLDER | Profile tables + stub routes; no GEI calculation engine |
| **Uncertainty/Quality Scoring** | NOT IMPLEMENTED | uncertainty_pct column in emission_factors but never used |
| **Historical Reproducibility** | WEAK | ef_version_id stored but calculation re-run uses current factor library |

---

## 4. Scope 1 Audit

| Sub-category | Status | Gaps |
|--------------|--------|------|
| Stationary Combustion | WEAK | 7 fuels only; no boiler efficiency, no NCV/GCV, no fuel analysis |
| Mobile Combustion | WEAK | Distance-based only (km); no fuel-based method for owned fleet |
| Fugitive Emissions | WEAK | 3 refrigerants only; no SF6, no equipment inventories, no leak detection methods |
| Industrial Processes | PLACEHOLDER | BEE PAT sectoral factors seeded as "examples" (commented as such); no clinker fraction, no process CO2 |
| Other Direct | NOT IMPLEMENTED | No biomass combustion CO2 (biogenic), no land use |

**Critical Finding**: The `SERVER_EF` map in `routes/emissions.js:168-181` is **hardcoded** and **diverges** from the seeded database factors. Server-side verification uses this hardcoded map, not the versioned DB factors.

---

## 5. Scope 2 Audit

| Sub-category | Status | Gaps |
|--------------|--------|------|
| Location-based (Grid Average) | IMPLEMENTED | CEA V20.0 factor correct (0.000727 tCO2/kWh); T&D losses separate factor |
| Market-based | PARTIAL | REC=0, Solar PPA=0.041, Wind PPA=0.011, Green Tariff=0; **no instrument tracking** (no REC serial, no PPA contract, no vintage) |
| Dual Reporting | PLACEHOLDER | Both shown in UI/report but **not enforced**; no "shall report both" logic |
| Supplier-specific | NOT IMPLEMENTED | No utility-specific factors, no contract-based allocation |
| Renewable Energy Instruments | NOT IMPLEMENTED | No REC registry integration, no GO, no I-REC |

**Critical Finding**: Market-based factors in EF map use **kgCO2/kWh** (0.041 for solar) while location-based uses **tCO2/kWh** (0.000727). Unit inconsistency.

---

## 6. Scope 3 Audit (15 Categories)

| GHG Protocol Category | EtherTrack Support | Implementation |
|----------------------|-------------------|----------------|
| 1. Purchased Goods & Services | WEAK | 8 materials (steel, aluminium, plastic, cement, paper, glass, copper, IT); kg-based only; no spend-based |
| 2. Capital Goods | WEAK | 2 types (equipment Lakh, construction m2); no asset registry |
| 3. Fuel & Energy Activities | WEAK | Upstream NG, diesel, T&D losses only; no transmission, no extraction |
| 4. Upstream Transport | WEAK | 4 modes (road/sea/air/rail) tonne-km; no vehicle-specific, no load factor |
| 5. Waste Generated | WEAK | 5 disposal methods; no waste composition, no wastewater treatment detail |
| 6. Business Travel | MODERATE | Air (short/long), rail, hotel, car rental; no class distinction, no radiative forcing |
| 7. Employee Commuting | WEAK | 4 modes (car/bus/metro/WFH); no survey, no distance distribution |
| 8. Upstream Leased Assets | PLACEHOLDER | 2 types (office m2-yr, vehicle km); no asset list |
| 9. Downstream Transport | PLACEHOLDER | Road freight + last-mile only |
| 10. Processing of Sold Products | PLACEHOLDER | 1 factor (kg) |
| 11. Use of Sold Products | PLACEHOLDER | Grid electricity only (CEA factor) |
| 12. End-of-Life Treatment | PLACEHOLDER | Landfill + recycling only |
| 13. Downstream Leased Assets | PLACEHOLDER | Leased asset electricity only |
| 14. Franchises | PLACEHOLDER | Lakh revenue only |
| 15. Investments | PLACEHOLDER | PCAF proxy (equity/debt Cr); no asset-class breakdown |

**Verdict**: Scope 3 is **checkbox-complete** (categories exist in methodology template) but **functionally hollow** — no spend-based methods, no supplier engagement, no allocation logic.

---

## 7. Calculation Engine Audit

### 7.1 Current Formula
```typescript
// emissionFactorLibrary.ts:165
const co2e = quantity * factor.factorValue;
// factorValue stored as tCO2 per unit_denominator
```

### 7.2 Critical Defects

| Defect | Location | Impact |
|--------|----------|--------|
| **Hardcoded SERVER_EF map** | routes/emissions.js:168-181 | Server verification uses different factors than DB; factors cannot be updated without code deploy |
| **No unit conversion** | emissionFactorLibrary.ts:159-161 | Throws error if unit ≠ factor.unitDenominator; no kWh↔MWh, L↔m3, kg↔tonne |
| **No GWP handling** | emissionFactorLibrary.ts | Refrigerant factors stored as tCO2e/kg (already GWP-applied); no gas composition breakdown |
| **Single formula only** | All calculation paths | `Activity × Factor = Emissions` — no Tier 2/3, no mass balance, no stoichiometric |
| **Floating point precision** | JavaScript `number` throughout | No decimal library; rounding at 6dp (ts:168) but aggregation loses precision |
| **No allocation logic** | N/A | Shared facilities, co-generation, leased assets — all manual |
| **Factor resolution** | emissionFactorLibrary.ts:124-139 | `getFactorByCode` uses `effective_from/to` but calculation engine doesn't pass date for historical accuracy |

### 7.3 Calculation Pathways Identified

| Pathway | Code Location | Uses Versioned Factors? |
|---------|--------------|------------------------|
| Manual Entry (client preview) | ManualEntry.js:92-94 | Yes (calcWithVersion) |
| Manual Entry (server save) | routes/emissions.js:312-314 | No (verifyCO2e uses SERVER_EF) |
| AI Parser | AIParser.js | No (uses EF map from parent) |
| CSV Import | CSVImport.js | No (bulk endpoint validates via SERVER_EF) |
| Calculation API | routes/emissionCalculation.js | Yes (EmissionCalculationEngine → EmissionFactorLibrary) |
| Bulk Calculation API | Same | Yes |
| Report Generation | reports.js | Client-supplied emissions array |

**Critical**: 4 of 6 pathways **bypass the versioned calculation engine entirely**.

---

## 8. Emission Factor Audit

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Source/publisher tracked | YES | `source` enum (CEA_V20_0, IPCC_2006, BEE_PAT, etc.) |
| Geographic applicability | YES | `geography` + `region` columns |
| Year/version | YES | `source_version`, `effective_from/to` |
| Unit (numerator/denominator) | YES | Separate columns |
| GHG Scope | YES | `ghg_scope` CHECK(1,2,3) |
| Gas/GWP basis | PARTIAL | Refrigerants store GWP in factor_value; no gas composition |
| Uncertainty | SCHEMA ONLY | `uncertainty_pct` column exists, never used |
| Provenance/approval | YES | `created_by`, `is_custom`, `quality_rating` |
| Historical reproducibility | BROKEN | `emission_factor_versions` table exists but `calculateCO2e` doesn't use it for point-in-time |
| "Which factor produced this number?" | PARTIAL | `ef_version_id` stored on activity but not validated; server recalc uses current factor |

**Critical Gap**: The `emission_factor_versions` table (migration 013) is **never read** by `calculateCO2e()` — it only reads current `emission_factors` row. Historical calculations **cannot be reproduced** after factor updates.

---

## 9. GHG Protocol Alignment

| Principle | Status | Evidence |
|-----------|--------|----------|
| Relevance | PARTIAL | Boundaries not defined; Scope 3 categories present but not actionable |
| Completeness | WEAK | No exclusion disclosure; no significance threshold |
| Consistency | BROKEN | No base year recalculation policy; factor changes not tracked in calculations |
| Transparency | MODERATE | Lineage shows factor version; but methodology not disclosed in reports |
| Accuracy | WEAK | Tier 1 only; no uncertainty quantification; hardcoded factors diverge from DB |
| Organizational Boundaries | NOT IMPLEMENTED | No consolidation approach (equity/control); single org_id only |
| Operational Boundaries | NOT IMPLEMENTED | No facility registration; no source categorization |
| Base Year | PLACEHOLDER | Field exists; no policy, no recalculation triggers |
| Scope 2 Dual Reporting | PLACEHOLDER | Factors exist; no mandatory dual disclosure |
| Scope 3 Methodology | NOT IMPLEMENTED | No method selection (spend/activity/hybrid); no supplier data |
| Biogenic CO2 | NOT IMPLEMENTED | Biomass factor exists (0.015) but no separate reporting |
| Avoided Emissions | NOT IMPLEMENTED | Solar export uses negative quantity hack; no formal methodology |
| Removals | NOT IMPLEMENTED | No carbon removal categories |
| Offsets | PARTIAL | Retirement tracking exists; no quality criteria, no vintage tracking in inventory |

---

## 10. ISO / International Standards Readiness

| Standard | Alignment | Evidence |
|----------|-----------|----------|
| ISO 14064-1 | WEAK | No organizational boundary, no base year procedure, no uncertainty |
| ISO 14064-2 | NOT APPLICABLE | Project-level not supported |
| ISO 14064-3 | WEAK | Verifier registry exists; but no verification protocol, no assurance levels |
| ISO 14067 | NOT IMPLEMENTED | Product carbon footprint not supported |
| GHG Protocol Corporate | PARTIAL | Structure mirrors standard but missing requirements |
| GHG Protocol Scope 2 | PARTIAL | Dual factors exist; no instrument tracking, no residual mix |
| GHG Protocol Scope 3 | WEAK | Categories listed; no calculation methods implemented |

---

## 11. India-Specific Audit (BRSR / CCTS / PAT)

| Requirement | Status | Gaps |
|-------------|--------|------|
| BRSR Core (Principle 6) | MODERATE | Section A/B/P1-P9 forms work; environmental (energy/water/waste) stored; auto-populate from trades+emissions |
| BRSR Energy (GJ) | PARTIAL | energyData JSON stored; no conversion from kWh→GJ validated |
| BRSR Water (KL) | PARTIAL | waterData JSON stored; withdrawal/consumption/recycling tracked |
| BRSR Waste (MT) | PARTIAL | wasteData JSON stored; by category but no hazardous waste detail |
| BRSR GHG Disclosure | PARTIAL | Scope 1/2 auto-populated; Scope 3 not in BRSR Core; no intensity metrics auto-filled |
| CCTS (Carbon Credit Trading Scheme) | PLACEHOLDER | Profile table + monthly data stub; **no GEI calculation engine**, no CCC surrender logic |
| PAT (Perform Achieve Trade) | PLACEHOLDER | Profile table + SEC baseline/target; **no SEC calculation**, no ESCert logic |
| CEA Grid Factors | CORRECT | CEA V20.0 (0.727 tCO2/MWh) used correctly in EF map and DB seed |
| BEE Sectoral Factors | PLACEHOLDER | 4 sectors seeded as "examples" with placeholder values (commented) |
| Indian Grid T&D Losses | IMPLEMENTED | Separate factor (0.000073 tCO2/kWh) |
| RECs / Green Tariff | PARTIAL | Factors exist (0.0, 0.041, 0.011); no registry integration |

---

## 12. Data Architecture Audit

### 12.1 Table Separation

| Layer | Table | Status |
|-------|-------|--------|
| Raw activity data | `emission_activities` | ✅ Single table (conflates raw + calculated) |
| Normalized activity data | — | ❌ Not separated |
| Emission factors | `emission_factors`, `emission_factor_versions` | ✅ Versioned |
| Calculation inputs | `emission_calculations` | ✅ Audit trail only |
| Calculated emissions | `emission_activities.co2e` | ❌ Mixed with raw data |
| Aggregated emissions | — | ❌ Computed on-demand (cached) |
| Reported emissions | `emission_reports` (legacy) | ⚠️ Legacy table, not used by new flow |
| Offsets/credits | `retirements`, `trades` | ✅ Separate |

### 12.2 Traceability Questions

| Question | Answerable? | Evidence |
|----------|-------------|----------|
| Who entered this data? | YES | `emission_activities.user_id`, `created_at` |
| When? | YES | `logged_at`, `created_at` |
| From which source? | PARTIAL | `source` field + `ai_audit.extractionMethod` |
| What evidence supports it? | PARTIAL | `emission_evidence` linked via `plan_id` (MRV), not directly to activity |
| Which factor was used? | YES | `factor`, `ef_version_id` stored |
| Which methodology? | PARTIAL | `methodologyTemplate` in calculation API; not on manual/AI/CSV |
| Which calculation produced the result? | PARTIAL | `emission_calculations` table for API calculations only |
| Who approved it? | YES | `approved_by`, `approved_at`, approval_state |
| Was it subsequently changed? | YES | `emission_adjustments` + `emission_audit_log` |
| Why was it changed? | YES | `adjustment.reason`, `audit_log.comment` |

**Critical Gap**: Evidence (`emission_evidence`) links to **MRV plans**, not individual activities. No direct activity→evidence link for manual/CSV/AI entries.

---

## 13. Data Quality & Evidence

| Feature | Status | Implementation |
|---------|--------|----------------|
| Evidence attachment | PARTIAL | MRV workflow only (emission_evidence table); AI parser stores metadata in `ai_audit` |
| OCR | CLIENT-SIDE ONLY | Tesseract.js in browser (AIParser.js); no server-side OCR |
| Structured extraction | PARTIAL | AIParser.js has 12 parsers for Indian docs; regex-based, no ML |
| Source confidence | YES | `ai_audit.confidenceTier` (high/medium/low) + `ocrConfidence` |
| Manual verification | YES | Maker-Checker workflow requires approval |
| Approval workflows | YES | Draft→Submitted→Reviewed→Approved→Locked |
| Data quality scoring | NO | `quality_rating` on factors unused; no record-level score |
| Anomaly detection | YES | MoM anomaly (300% threshold) in validation layer |
| Missing-data detection | NO | No scheduled gap analysis |
| Duplicate detection | YES | Fingerprint-based (activity+qty_month+scope) |
| Estimation methodology | NO | No estimation flag on records; no method hierarchy |
| Evidence retention | NO | No retention policy; IPFS used but no lifecycle |

---

## 14. Uncertainty & Data Quality

| Concept | Implemented? |
|---------|--------------|
| Measured vs Estimated vs Derived vs Assumed | ❌ No classification |
| Data quality tiers | ❌ Only AI confidence tiers |
| Uncertainty propagation | ❌ `uncertainty_pct` column unused |
| Spend-based vs activity-based | ❌ Only activity-based factors |
| Proxy data flagging | ❌ |
| Tier 2/3 methods | ❌ Only Tier 1 (activity × average factor) |

**Result**: All emissions reported as **single-point estimates** with no uncertainty range — **not audit-ready**.

---

## 15. Reporting Engine Audit

| Output | Status | Quality |
|--------|--------|---------|
| PDF (GHG Protocol) | WORKS | Professional layout; includes Scope 1/2/3, YoY, intensity, retirements, uncertainty table (hardcoded), declaration page |
| PDF (BRSR) | WORKS | Complete Annexure II format; Sections A/B/C(P1-P9); energy/water/waste tables |
| PDF (CDP/TCFD/GRI) | WORKS | Templates exist; content thin (mostly placeholders) |
| CSV Export | WORKS | Flat export of filtered ledger |
| Dashboard Charts | WORKS | Monthly trends, donut, category breakdown (Chart.js) |
| Methodology Disclosure | WEAK | Hardcoded in PDF templates; not data-driven |
| Emission Factor Disclosure | PARTIAL | Shows grid EF version in PDF; not per-activity |
| Assumptions/Exclusions | NOT IN REPORTS | No exclusion disclosure section |
| Evidence References | NOT IN REPORTS | No evidence links in PDF |
| Audit Information | PARTIAL | Audit hash in header; verifier block if assigned |
| Reproducibility | NO | Report cannot be independently recalculated from source data |

**Critical**: Reports are **presentation-grade, not decision-grade**. An auditor cannot reproduce the numbers from the report alone.

---

## 16. Enterprise Benchmark Gap

| Capability | Watershed/Persefoni/Salesforce | EtherTrack | Gap |
|------------|-------------------------------|------------|-----|
| Organizational hierarchy | Full (parent/subsidiary/facility) | Single org_id | **Architectural** |
| Multi-methodology calculations | Tier 1/2/3 per source | Tier 1 only | **Methodological** |
| Spend-based Scope 3 | Automated ERP integration | Not implemented | **Data + Engine** |
| Supplier engagement portal | Yes | Stub only (SupplierPortal.js) | **Product** |
| Target setting (SBTi) | Validated pathways | Manual entry only | **Methodological** |
| Scenario analysis | Built-in | Not implemented | **Engine** |
| Uncertainty quantification | Monte Carlo / analytical | Not implemented | **Engine** |
| Audit workpapers | Auto-generated | Lineage only | **Workflow** |
| Regulatory mapping (CSRD, SEC, etc.) | Live updates | Static templates | **Maintenance** |
| Data connectors (ERP, utility, travel) | 100+ pre-built | 0 (ERP Sync stub) | **Integration** |
| Role-based access (RACI) | Granular | Maker/Reviewer/Approver/Admin only | **Governance** |

---

## 17. Technical Architecture Audit

| Aspect | Assessment |
|--------|------------|
| **Backend** | Node.js/Express + TypeScript migration in progress (`src/services/*.ts`) |
| **Database** | PostgreSQL (Supabase); read replica support; connection pooling |
| **Calculation Engine** | **Not centralized** — 4 different pathways with different factor sources |
| **API Design** | REST + SSE; inconsistent (some `/api/emissions`, some `/api/emissions/calculate`) |
| **Async Processing** | Bull/Redis queue for PDF (`pdfQueue.js`); no job queue for calculations |
| **Numerical Precision** | JavaScript `number` (IEEE 754); no decimal library; rounding errors inevitable at scale |
| **Idempotency** | Idempotency keys on trades/subscriptions; **missing on emission logs** |
| **Deterministic Calculations** | **NO** — client preview ≠ server save ≠ report generation |
| **Testing** | Jest unit tests for financial invariants; **no carbon calculation tests** |
| **Observability** | Basic logging; no distributed tracing for calculations |

---

## 18. Security & Governance

| Control | Status |
|---------|--------|
| Authorization | RBAC (owner/admin/manager/auditor/viewer); org-scoped emissions |
| Tenant Isolation | `org_id` on activities; `ledgerScope()` helper enforces |
| Audit Logs | `audit_log` table + `emission_audit_log` + blockchain chain log |
| Tamper Resistance | Blockchain anchoring (IPFS + chain log hash); locked records immutable |
| Calculation Integrity | **WEAK** — server verify uses hardcoded map; factor version not enforced |
| Report Integrity | PDF metadata + audit hash; but content not cryptographically bound to source |
| Upload Security | File type/size validation; IPFS pinning; no virus scan |
| Admin Privileges | Separate admin routes; 2FA for admin actions |

---

## 19. Auditability Assessment

**Audit Readiness Score: 30/100**

| Criterion | Score | Deduction Reason |
|-----------|-------|------------------|
| Reproducibility from raw data | 20 | 4/6 pathways bypass calculation engine; hardcoded factors |
| Exact factor identification | 50 | `ef_version_id` stored but not used for recalculation |
| Factor source/version traceability | 60 | DB has full metadata; but not linked in calculation result |
| Methodology identification | 30 | Only for API calculations; manual/AI/CSV have no methodology tag |
| Evidence access | 40 | Evidence linked to MRV plans, not activities |
| Change history | 80 | `emission_adjustments` + `emission_audit_log` comprehensive |
| Historical reproduction | 20 | Factor versions table exists but calculation engine ignores it |
| Estimated data identification | 10 | No estimation classification |
| Exclusion disclosure | 0 | Not tracked |
| Source-to-report traceability | 40 | Lineage exists per-record; not aggregated to report level |

---

## 20. Product Quality Assessment

| Category | Score | Rationale |
|----------|-------|-----------|
| **A. Functional Maturity** | 65/100 | Core CRUD + approvals + lineage work; AI parser impressive; but CSV/ERP weak |
| **B. Carbon-Accounting Maturity** | 25/100 | **Fundamental methodology gaps**; no boundaries, no Tier 2/3, no uncertainty |
| **C. Enterprise Maturity** | 35/100 | No org hierarchy, no connectors, no scenario analysis, no target validation |
| **D. Audit Maturity** | 30/100 | Cannot reproduce; no workpapers; uncertainty missing |
| **E. Reporting Maturity** | 45/100 | Pretty PDFs but content not decision-grade |
| **F. India Readiness** | 40/100 | BRSR forms good; CCTS/PAT are stubs; CEA factors correct |
| **G. International Readiness** | 20/100 | No ISO 14064, limited GHG Protocol, no CSRD/SEC/ISSB |
| **H. Competitive Maturity** | 15/100 | 3-5 years behind leaders |

---

## 21. Hidden Problems (Adversarial Findings)

| # | Problem | Severity | Location |
|---|---------|----------|----------|
| 1 | **Hardcoded SERVER_EF diverges from seeded DB factors** | P0 | `routes/emissions.js:168-181` vs `emissionFactorLibrary.ts:392-763` |
| 2 | **Unit inconsistency**: Market-based EFs in kgCO2/kWh vs Location in tCO2/kWh | P0 | `EmissionTracking.js:148-151` |
| 3 | **Calculation engine not used by 4/6 ingestion pathways** | P0 | Manual/AI/CSV/bulk all bypass `EmissionCalculationEngine` |
| 4 | **ef_version_id stored but calculation re-run uses current factor** | P0 | `emissionFactorLibrary.ts:145-153` ignores version table |
| 5 | **No unit conversion** — MWh vs kWh, L vs m3, kg vs tonne all error | P1 | `emissionFactorLibrary.ts:159-161` |
| 6 | **No organizational boundary model** — single org_id only | P1 | `emission_activities.org_id` only |
| 7 | **No facility/asset registry** — cannot do operational boundaries | P1 | Missing tables |
| 8 | **Scope 3 spend-based method absent** — 60%+ of corporate Scope 3 | P1 | Only activity-based factors |
| 9 | **Market-based Scope 2 instruments not tracked** — no REC serial, PPA ID | P1 | Factors exist but no metadata |
| 10 | **Floating point aggregation** — no decimal library for financial-grade | P2 | All `number` types |
| 11 | **Idempotency missing on emission log/bulk** — duplicate risk | P2 | Only on trades/subscriptions |
| 12 | **AI Parser regex brittle** — 2000+ lines of patterns; no test coverage | P2 | `AIParser.js` |
| 13 | **BRSR auto-populate uses trades as offsets** — conflates voluntary offsets with Scope 2 market instruments | P2 | `brsr.js:331-332` |
| 14 | **No base year recalculation policy** — structural changes untracked | P2 | `profile.base_year` only |
| 15 | **Uncertainty column exists but never used** — false confidence | P3 | `emission_factors.uncertainty_pct` |

---

## 22. Gap Analysis (Master Table)

| Area | Current State | Evidence | Severity | Business Impact | Best-Practice Target | Gap |
|------|---------------|----------|----------|-----------------|---------------------|-----|
| Calculation Engine Centralization | 4 disparate pathways | 6 entry points, only 2 use engine | P0 | Audit failure; inconsistent results | Single deterministic engine | **Complete rewrite** |
| Emission Factor Management | Versioned DB but ignored | `emission_factor_versions` unread | P0 | Historical irreproducibility | Point-in-time factor resolution | **Engine fix** |
| Organizational Boundaries | Single org_id | No facility/hierarchy tables | P0 | Cannot serve groups/subsidiaries | GHG Protocol consolidation | **New data model** |
| Operational Boundaries | None | No facility/asset registry | P0 | No source-level accountability | Facility + source registration | **New data model** |
| Scope 2 Market Instruments | Factors only | No REC/PPA/contract tracking | P1 | Greenwashing risk; non-compliant | Instrument registry + allocation | **New module** |
| Scope 3 Methodology | Categories only | 15 cats in template; ~25 factors | P1 | 80% of emissions unaddressed | Spend/activity/hybrid per category | **Engine + data** |
| Uncertainty Quantification | Schema only | `uncertainty_pct` unused | P1 | False precision; audit finding | Monte Carlo / analytical | **New engine module** |
| Base Year Management | Field only | No recalculation triggers | P1 | Non-comparable years | Policy + auto-recalc | **Workflow + engine** |
| Evidence-Activity Link | MRV only | `emission_evidence.activity_id` nullable | P1 | Cannot trace manual/CSV/AI to evidence | Direct activity→evidence | **Schema fix** |
| Data Quality Classification | None | No measured/estimated/derived flags | P2 | Auditor cannot assess quality | 4-tier classification | **Schema + UI** |
| ERP/Utility Connectors | Stub only | `ERPSync.js` empty | P2 | Manual entry at scale | 50+ pre-built connectors | **Integration platform** |
| SBTi Target Validation | Manual entry | No pathway validation | P2 | Invalid targets accepted | SBTi criteria engine | **New module** |
| Scenario Analysis | None | Not implemented | P3 | No transition planning | NGFS/IEA scenarios | **New engine** |
| ISO 14064-3 Verification | Verifier registry | No protocol/assurance levels | P3 | Cannot offer verification | Full verification workflow | **New module** |

---

## 23. Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TARGET ETHERTRACK EMISSIONS ARCHITECTURE             │
└─────────────────────────────────────────────────────────────────────────────┘

Data Sources                    Ingestion Layer                    Raw Data Store
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐
│ Utility APIs│  │ ERP (Tally, │  │ Email/Upload│  │ Raw immutable append-   │
│ Smart Meters│  │  SAP, Oracle)│  │  (PDF/CSV/  │  │ only event store        │
│ Fuel Cards  │  │ Travel Sys  │  │   images)   │  │ (partitioned by tenant) │
│ Travel Mgmt │  │ Suppliers   │  │  AI Parser  │  │                         │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘
       │                │                │                    │
       └────────────────┼────────────────┼────────────────────┘
                        ▼
            ┌─────────────────────────────┐
            │   VALIDATION & NORMALIZATION │
            │  - Unit standardization      │
            │  - Schema validation         │
            │  - Duplicate detection       │
            │  - Anomaly scoring           │
            │  - Evidence attachment       │
            └──────────────┬──────────────┘
                           ▼
            ┌─────────────────────────────┐
            │     ACTIVITY DATA LAYER      │
            │  - Normalized activities     │
            │  - Facility/source refs      │
            │  - Quality tier (M/E/D/A)    │
            │  - Evidence links            │
            │  - Versioned immutable       │
            └──────────────┬──────────────┘
                           ▼
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌────────────────┐ ┌───────────────┐ ┌────────────────┐
│  EMISSION      │ │  METHODOLOGY  │ │  CALCULATION   │
│  FACTOR        │ │  REGISTRY     │ │  ENGINE        │
│  REGISTRY      │ │               │ │                │
│                │ │ - GHG Protocol│ │ - Tier 1/2/3   │
│ - Versioned    │ │ - ISO 14064   │ │ - Unit conv.   │
│ - Geo/sector   │ │ - BRSR/PAT    │ │ - Allocation   │
│ - Uncertainty  │ │ - CCTS        │ │ - GWP handling │
│ - Provenance   │ │ - Custom      │ │ - Deterministic│
└───────┬────────┘ └───────┬───────┘ └───────┬────────┘
        │                 │                 │
        └─────────────────┼─────────────────┘
                          ▼
            ┌─────────────────────────────┐
            │       GHG LEDGER            │
            │  - Calculated emissions     │
            │  - Factor version pinned    │
            │  - Methodology versioned    │
            │  - Uncertainty propagated   │
            │  - Approval state machine   │
            │  - Append-only              │
            └──────────────┬──────────────┘
                           ▼
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌────────────────┐ ┌───────────────┐ ┌────────────────┐
│ AGGREGATION    │ │ ANALYTICS     │ │ REPORTING      │
│ ENGINE         │ │ ENGINE        │ │ ENGINE         │
│                │ │               │ │                │
│ - Org hierarchy│ │ - Trends      │ │ - GHG Protocol │
│ - Consolidation│ │ - Benchmarks  │ │ - BRSR Core    │
│ - Base year    │ │ - Targets     │ │ - CDP/TCFD     │
│ - Recalculation│ │ - Scenarios   │ │ - ISO 14064    │
│ - Audit trail  │ │ - Uncertainty │ │ - Audit papers │
└────────────────┘ └───────────────┘ └────────────────┘
```

---

## 24. Prioritized Improvement Roadmap

### P0: Critical Correctness/Security (Do First — Blocks Everything)

| # | Problem | Why It Matters | Current State | Target | Complexity |
|---|---------|----------------|---------------|--------|------------|
| P0-1 | **Unify all calculation pathways through single engine** | 4/6 pathways produce different results; audit will fail | Manual/AI/CSV/bulk bypass engine | All ingestion → `EmissionCalculationEngine` | High (2-3 weeks) |
| P0-2 | **Remove hardcoded SERVER_EF map** | Server verify uses different factors than DB | `routes/emissions.js:168-181` | `verifyCO2e` reads from `emission_factors` with version resolution | Medium (1 week) |
| P0-3 | **Fix unit inconsistency in EF map** | Market-based factors in kg vs location in t | `EmissionTracking.js:148-151` | All factors in tCO2/unit; add unit conversion layer | Medium (1 week) |
| P0-4 | **Make `calculateCO2e` use `emission_factor_versions` for historical dates** | Cannot reproduce prior-year calculations | Version table exists but ignored | Point-in-time factor resolution mandatory | Medium (1 week) |
| P0-5 | **Add idempotency keys to emission log/bulk** | Duplicate records on retry | Missing on `/log` and `/bulk` | Idempotency-key header required | Low (3 days) |

### P1: Enterprise-Grade Foundations (Required Before Enterprise Sales)

| # | Feature | Why It Matters | Current State | Target | Complexity |
|---|---------|----------------|---------------|--------|------------|
| P1-1 | **Organizational boundary model** | Groups/subsidiaries cannot consolidate | Single `org_id` | Facilities → Business Units → Org hierarchy; consolidation method (equity/control) | High (3-4 weeks) |
| P1-2 | **Facility & emission source registry** | No operational boundaries | Missing tables | Register facilities, assets, sources; link to activities | High (2-3 weeks) |
| P1-3 | **Scope 2 market instrument tracking** | REC/PPA claims unverifiable | Factors only | Instrument registry (serial, vintage, registry, contract) + allocation engine | High (3-4 weeks) |
| P1-4 | **Scope 3 spend-based calculation engine** | 60-80% of corporate Scope 3 | Activity-based only | ERP integration → spend mapping → EEIO factors (EXIOBASE/DEFRA) | Very High (6-8 weeks) |
| P1-5 | **Uncertainty propagation** | Single-point estimates not auditable | Column exists, unused | Monte Carlo engine; per-source uncertainty → portfolio uncertainty | High (3-4 weeks) |
| P1-6 | **Base year management with recalculation** | Structural changes break comparability | Field only | Policy engine: trigger recalc on boundary/methodology/factor changes | Medium (2-3 weeks) |
| P1-7 | **Evidence→Activity direct linkage** | Cannot trace manual/CSV/AI to evidence | MRV-only link | `activity_id` FK on `emission_evidence`; required on submit | Medium (1-2 weeks) |
| P1-8 | **Data quality classification (M/E/D/A)** | Auditor cannot assess reliability | Not implemented | 4-tier flag on every activity record; survives to reports | Medium (2 weeks) |

### P2: Best-in-Class Differentiation (Competitive Moats)

| # | Feature | Why It Matters | Complexity |
|---|---------|----------------|------------|
| P2-1 | **Automated ERP/Utility connectors** | Eliminates manual entry (biggest pain point) | Very High |
| P2-2 | **Supplier engagement portal with data requests** | Scope 3 primary data collection | High |
| P2-3 | **SBTi target validation engine** | Auto-check ambition, coverage, pathways | Medium |
| P2-4 | **Scenario analysis (NGFS/IEA)** | Transition planning mandatory for listed cos | High |
| P2-5 | **ISO 14064-3 verification workflow** | Enables assurance revenue stream | Medium |
| P2-6 | **Carbon removal / avoidance tracking** | Emerging regulatory requirement | Medium |
| P2-7 | **Real-time intensity dashboards (PPP, revenue, FTE, area)** | CFO/Board reporting | Low |

### P3: Future Capabilities (Do Not Distract From P0/P1)

| # | Feature | Note |
|---|---------|------|
| P3-1 | Product carbon footprint (ISO 14067) | Separate product line |
| P3-2 | Nature/TNFD integration | Separate module |
| P3-3 | AI-powered anomaly detection (ML not regex) | Replace AIParser.js regex |
| P3-4 | Blockchain-anchored audit trail (beyond hash) | Current hash chain sufficient |
| P3-5 | Multi-language regulatory templates (CSRD, SEC, ISSB) | Maintenance burden high |

---

## 25. Final Scores Summary

| Dimension | Score | Verdict |
|-----------|-------|---------|
| **Carbon-Accounting Correctness** | 25/100 | **Fail** — methodology gaps fundamental |
| **Data Integrity** | 55/100 | Partial — approval workflow good; evidence link broken |
| **Traceability** | 60/100 | Good lineage per-record; not at report level |
| **Calculation Accuracy** | 30/100 | **Fail** — hardcoded factors, no unit conversion, 4 pathways |
| **Emission Factor Management** | 45/100 | Good schema; engine doesn't use versions |
| **Scope 1 Coverage** | 40/100 | Basic fuels only; no processes |
| **Scope 2 Coverage** | 50/100 | Dual factors but no instruments |
| **Scope 3 Coverage** | 25/100 | Categories listed; methods missing |
| **India Readiness (BRSR/CCTS/PAT)** | 40/100 | BRSR forms work; CCTS/PAT stubs |
| **International Standards** | 20/100 | No ISO 14064, weak GHG Protocol |
| **Enterprise Usability** | 35/100 | No hierarchy, connectors, scenarios |
| **Reporting Quality** | 45/100 | Pretty PDFs; not decision-grade |
| **Audit Readiness** | 30/100 | **Cannot reproduce calculations** |
| **Security/Governance** | 70/100 | RBAC, audit logs, blockchain anchoring solid |
| **Technical Scalability** | 60/100 | Read replica, pooling; but calculation not async |
| **Competitive Position** | 15/100 | 3-5 years behind leaders |

---

## 26. "What EtherTrack Must Become to Be Best-in-Class in India"

### The Honest Assessment

EtherTrack today is a **carbon credit marketplace with a GHG logging feature**. To become a **best-in-class Indian enterprise carbon management platform**, it must:

1. **Rebuild the calculation engine as a standalone, deterministic, versioned service** — not embedded in routes, not duplicated in frontend. Every pathway (manual, AI, CSV, ERP, API) must produce **bit-identical results** for the same inputs.

2. **Model organizational and operational boundaries properly** — facilities, assets, sources, consolidation methods. This is the foundation for everything else (BRSR, CCTS, PAT, GHG Protocol).

3. **Implement Scope 3 properly** — spend-based + activity-based hybrid with supplier portal. This is where 70%+ of emissions live for Indian manufacturers.

4. **Make market-based Scope 2 auditable** — track every REC, PPA, green tariff with serial numbers, vintage, registry. No more "factor = 0" handwaving.

5. **Build uncertainty into every number** — not as a column, as a propagated distribution. Monte Carlo on the ledger.

6. **Automate data ingestion** — the 4 manual pathways (manual, AI, CSV, ERP stub) are a competitive disadvantage. Pre-built connectors for Tally, Zoho, SAP, utility APIs, fuel cards, travel systems are table stakes.

7. **Align every report to a specific standard's requirements** — not generic templates. BRSR Core must pass SEBI scrutiny; CCTS must compute GEI per gazette formula; PAT must calculate SEC per BEE notification.

8. **Invest in the verification workflow** — the verifier registry + MRV tables are a good start. Build the full ISO 14064-3 assurance process (strategic review → risk assessment → detailed testing → opinion).

### The Strategic Choice

**Option A**: Stay a carbon credit trading platform with "good enough" emission tracking for BRSR filing.
- **Investment**: Low (polish existing)
- **Market**: SMEs filing BRSR voluntarily
- **Moat**: None — commoditized

**Option B**: Build the calculation engine + boundary model + Scope 3 engine properly.
- **Investment**: 6-9 months, 4-6 engineers
- **Market**: Listed Indian corporates (BRSR mandatory for top 1000), MNCs with India ops, PAT/CCTS obligated entities
- **Moat**: **Calculation correctness + India-specific regulatory depth + audit reproducibility**

**Recommendation**: **Option B**. The Indian regulatory tailwind (BRSR Core mandatory for top 1000, CCTS operationalizing, PAT Cycle 7) creates a **time-bounded window** to become the default compliance platform. But the window closes if the platform cannot survive a Big 4 audit.

---

## 27. Immediate Next Steps (Week 1-2)

1. **Freeze new feature work** on emission tracking
2. **Create `CalculationEngine` as standalone package** with:
   - Input: `ActivityData + FactorVersion + MethodologyConfig`
   - Output: `CalculatedEmission + Uncertainty + Provenance`
   - Tests: Property-based (same input → same output forever)
3. **Migrate all 6 ingestion pathways** to use this engine
4. **Delete `SERVER_EF` hardcoded map** — enforce DB factor resolution
5. **Add facility/source tables** + foreign keys on `emission_activities`
6. **Write the first adversarial test**: "Can I reproduce FY2024 Scope 2 from raw meter data after CEA V21.0 is released?"

---

*End of Audit Report*