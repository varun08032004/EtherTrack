// src/types/portfolio.ts
// Single source of truth for all portfolio data types.
// Import these wherever you use portfolio data — prevents silent breaks
// when backend field names change.

// ── Enums ─────────────────────────────────────────────────────────

export type CreditStandard = 'VCS' | 'GS' | 'CDM' | 'ACR' | 'BEE';

export type CreditType = 'voluntary' | 'compliance';

export type CreditStatus = 'HELD' | 'LISTED' | 'RETIRED' | 'PENDING' | 'PARTIAL' | 'BOUGHT';

export type CorrespondingAdjustment = 'none' | 'host_issued' | 'itmo' | 'pending';

export type AdminStatus = 'pending' | 'approved' | 'rejected';

export type OrgRole = 'owner' | 'admin' | 'manager' | 'auditor' | 'viewer';

export type SubscriptionPlan = 'starter' | 'growth' | 'enterprise';

export type RetirementPurpose =
  | 'voluntary_offset'
  | 'compliance'
  | 'net_zero'
  | 'supply_chain';

export type ReportingStandard =
  | 'GHG_PROTOCOL'
  | 'CDP'
  | 'BRSR'
  | 'TCFD'
  | 'ISO_14064';

// ── Core credit types ─────────────────────────────────────────────

export interface CarbonCredit {
  id:                      string | number;
  projectName:             string;
  location:                string;
  country:                 string;
  standard:                CreditStandard;
  projectType:             string;
  developer:               string;
  credits:                 number;
  heldCredits:             number;
  listedCredits:           number;
  vintageYear:             number;
  expiryDate:              string | null;
  serialNumber:            string;
  projectId:               string;
  status:                  CreditStatus;
  adminStatus:             AdminStatus;
  creditType:              CreditType;
  cbamEligible:            boolean;
  correspondingAdjustment: CorrespondingAdjustment;
  sdgTags:                 number[];
  icvcmCcpEligible:        boolean;
  icvcmCcpLabel:           string;
  methodologyId:           string;
  registryLink:            string;
  coBenefitsVerified:      boolean;
  tokenId:                 number | null;
  tokenHex:                string | null;
  isOnChain:               boolean;
  isBought:                boolean;
  isPending:               boolean;
  isRejected:              boolean;
  pricePerCredit:          number;
  adminNotes:              string | null;
  docIpfsHash:             string | null;
  registeredAt:            string | null;
  listingId:               number | null;
}

export interface BoughtCredit extends CarbonCredit {
  tradeId:       string | number;
  totalPaid:     number;
  paymentMode:   'eth' | 'inr';
  txHash:        string | null;
  boughtAt:      string;
  sellerName:    string;
  sellerWallet:  string;
  batchId:       string | number;
  quantity:      number;
}

// ── Retirement types ──────────────────────────────────────────────

export interface RetirementRecord {
  id:                 string | number;
  cert_id:            string | null;
  certificate_id:     string | null;
  project_name:       string;
  projectName:        string;
  amount:             number;
  credits:            number;
  standard:           CreditStandard;
  vintage_year:       number;
  retire_scope:       number;
  reporting_standard: ReportingStandard;
  tx_hash:            string | null;
  created_at:         string;
  retired_at:         string | null;
  approved_by_name:   string | null;
  beneficiary_name:   string | null;
  beneficiary_entity: string | null;
  beneficiary_gstin:  string | null;
  purpose:            RetirementPurpose;
  country:            string;
  serial_number:      string;
}

export interface RetirementRequest {
  id:               string | number;
  projectName:      string;
  qty:              number;
  scope:            number;
  requesterName:    string;
  reportingStandard:ReportingStandard;
  purpose:          RetirementPurpose;
  beneficiaryName:  string | null;
  beneficiaryEntity:string | null;
  beneficiaryGstin: string | null;
  status:           'pending' | 'approved' | 'rejected';
}

// ── Organisation types ────────────────────────────────────────────

export interface Organisation {
  id:                  string | number;
  name:                string;
  subscription_plan:   SubscriptionPlan;
  subscription_status: 'active' | 'trial' | 'expired' | 'cancelled';
  seats_limit:         number;
  plan_selected:       boolean;
}

export interface OrgMember {
  id:         string | number;
  email:      string;
  full_name:  string;
  team_role:  OrgRole;
  status:     'active' | 'invited' | 'inactive';
  joined_at:  string;
}

export interface Verifier {
  id:            string | number;
  verifier_name: string;
  verifier_code: string;
  status:        'connected' | 'disconnected' | 'pending';
}

// ── Stats ─────────────────────────────────────────────────────────

export interface PortfolioStats {
  totalCredits:  number;   // sum of tCO₂, not card count
  retiredCount:  number;   // sum of tCO₂ retired
  listedCount:   number;   // sum of tCO₂ listed
  totalValue:    number;   // INR, vintage-adjusted
}

export interface StatTotals {
  totalTco2:      number;
  listedTco2:     number;
  portfolioValue: number;
  retiredTco2:    number;
}

// ── Emissions ─────────────────────────────────────────────────────

export interface EmissionsData {
  total:  number;
  scope1: number;
  scope2: number;
  scope3: number;
  year:   number;
}

// ── KYC ──────────────────────────────────────────────────────────

export interface KycStatus {
  kycVerified:     boolean;
  kycStatus:       string;
  kycExpiresAt:    string | null;
  daysUntilExpiry: number | null;
  isExpired:       boolean;
  isExpiringSoon:  boolean;
  needsRenewal:    boolean;
}

// ── Form ──────────────────────────────────────────────────────────

export interface CreditForm {
  projectName:            string;
  location:               string;
  country:                string;
  standard:               CreditStandard;
  projectType:            string;
  developer:              string;
  credits:                string;
  vintageYear:            string;
  expiryDate:             string;
  serialNumber:           string;
  projectId:              string;
  docFile:                File | null;
  pincode:                string;
  creditType:             CreditType;
  cbamEligible:           boolean;
  acvaName:               string;
  acvaDate:               string;
  acvaStatus:             string;
  icmRegistryId:          string;
  bankingStatus:          string;
  sdgTags:                number[];
  correspondingAdjustment:CorrespondingAdjustment;
  icvcmCcpEligible:       boolean;
  icvcmCcpLabel:          string;
  icvcmCcpDate:           string;
  registryLink:           string;
  methodologyId:          string;
  additionalityType:      string;
  permanenceRating:       string;
  coBenefitsVerified:     boolean;
}

// ── Audit ─────────────────────────────────────────────────────────

export interface AuditLog {
  id:           string | number;
  action:       string;
  actor_name:   string;
  actor_role:   OrgRole;
  meta:         string;
  created_at:   string;
}

// ── Watchlist ─────────────────────────────────────────────────────

export interface WatchlistItem {
  id:       string | number;
  name:     string;
  standard: CreditStandard;
  price:    number;
}

// ── RBAC ─────────────────────────────────────────────────────────

export type Permission =
  | 'portfolio:read'
  | 'portfolio:write'
  | 'portfolio:submit_credit'
  | 'portfolio:retire'
  | 'portfolio:retire_request'
  | 'portfolio:approve_retire'
  | 'portfolio:export'
  | 'portfolio:list'
  | 'emissions:read'
  | 'emissions:write'
  | 'emissions:export'
  | 'reports:generate'
  | 'reports:export_pdf'
  | 'team:invite'
  | 'team:remove'
  | 'team:change_role'
  | 'verifier:connect'
  | 'org:billing';

export interface PlanLimit {
  credits: number;
  exports: string[];
  label:   SubscriptionPlan;
  color:   string;
}