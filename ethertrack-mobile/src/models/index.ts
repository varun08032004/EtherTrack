import { Model } from '@nozbe/watermelondb';
import { field, text, number, date, readonly, lazy, children } from '@nozbe/watermelondb/decorators';
import { Associations } from '@nozbe/watermelondb/Model';

export class User extends Model {
  static table = 'users';
  static associations: Associations = {
    emission_activities: { type: 'has_many', foreignKey: 'user_id' },
    carbon_assets: { type: 'has_many', foreignKey: 'user_id' },
    mrv_plans: { type: 'has_many', foreignKey: 'user_id' },
    evidence: { type: 'has_many', foreignKey: 'user_id' },
    trades: { type: 'has_many', foreignKey: 'buyer_id' },
  };

  @text('email') email!: string;
  @text('full_name') fullName!: string;
  @text('company_name') companyName!: string;
  @text('role') role!: string;
  @text('kyc_status') kycStatus!: string;
  @text('subscription_plan') subscriptionPlan!: string;
  @text('wallet_address') walletAddress!: string;
  @field('inr_balance') inrBalance!: number;
  @date('subscription_renewal_date') subscriptionRenewalDate!: Date;
  @field('org_id') orgId?: string;
  @field('is_company_account') isCompanyAccount!: boolean;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;

  @lazy emissionActivities = this.collections.get('emission_activities').query(this.id);
  @lazy carbonAssets = this.collections.get('carbon_assets').query(this.id);
  @lazy mrvPlans = this.collections.get('mrv_plans').query(this.id);
  @lazy evidence = this.collections.get('evidence').query(this.id);
  @lazy trades = this.collections.get('trades').query(this.id);
}

export class EmissionActivity extends Model {
  static table = 'emission_activities';
  static associations = {
    user: { type: 'belongs_to', key: 'user_id' },
    org: { type: 'belongs_to', key: 'org_id' },
  };

  @field('date') date!: number;
  @text('activity') activity!: string;
  @field('quantity') quantity!: number;
  @text('unit') unit!: string;
  @field('scope') scope!: number;
  @text('category') category!: string;
  @field('factor') factor!: number;
  @field('co2e') co2e!: number;
  @text('notes') notes?: string;
  @text('source') source?: string;
  @field('verified') verified!: boolean;
  @field('ai_audit') aiAudit?: string;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
  @date('logged_at') loggedAt!: Date;
  @text('approval_state') approvalState!: string;
}

export class CarbonAsset extends Model {
  static table = 'carbon_assets';

  @text('asset_id') assetId!: string;
  @field('token_id') tokenId!: number;
  @text('project_id') projectId!: string;
  @text('registry') registry!: string;
  @field('vintage') vintage!: number;
  @text('methodology') methodology!: string;
  @text('serial_number') serialNumber!: string;
  @field('total_supply') totalSupply!: number;
  @field('retired_supply') retiredSupply!: number;
  @text('status') status!: string;
  @text('project_name') projectName!: string;
  @text('standard') standard!: string;
  @text('project_type') projectType!: string;
  @text('geography') geography!: string;
  @field('ecs_score') ecsScore!: number;
  @text('ecs_grade') ecsGrade!: string;
  @field('ecs_percentile') ecsPercentile!: number;
  @field('last_traded_price') lastTradedPrice!: number;
  @field('available_quantity') availableQuantity!: number;
  @field('compliance_eligible') complianceEligible!: boolean;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}

export class MRVPlan extends Model {
  static table = 'mrv_plans';

  @text('plan_id') planId!: string;
  @text('user_id') userId!: string;
  @text('org_id') orgId!: string;
  @text('plan_name') planName!: string;
  @text('description') description?: string;
  @field('reporting_year') reportingYear!: number;
  @text('methodology_template') methodologyTemplate!: string;
  @field('covers_scope_1') coversScope1!: boolean;
  @field('covers_scope_2') coversScope2!: boolean;
  @field('covers_scope_3') coversScope3!: boolean;
  @field('facility_ids') facilityIds!: string;
  @field('asset_ids') assetIds!: string;
  @field('reporting_period_start') reportingPeriodStart!: number;
  @field('reporting_period_end') reportingPeriodEnd!: number;
  @field('submission_deadline') submissionDeadline?: number;
  @field('verification_deadline') verificationDeadline?: number;
  @text('state') state!: string;
  @text('previous_state') previousState?: string;
  @field('submitted_at') submittedAt?: number;
  @field('verified_at') verifiedAt?: number;
  @field('approved_at') approvedAt?: number;
  @field('rejected_at') rejectedAt?: number;
  @text('rejection_reason') rejectionReason?: string;
  @text('submitted_by') submittedBy?: string;
  @text('verified_by') verifiedBy?: string;
  @text('approved_by') approvedBy?: string;
  @text('assigned_verifier') assignedVerifier?: string;
  @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;

  @lazy evidence = this.collections.get('evidence').query(this.plan_id);
  @lazy findings = this.collections.get('findings').query(this.plan_id);
}

export class Evidence extends Model {
  static table = 'evidence';
  static associations = {
    plan: { type: 'belongs_to', key: 'plan_id' },
    activity: { type: 'belongs_to', key: 'activity_id' },
  };

  @text('title') title!: string;
  @text('description') description?: string;
  @text('evidence_type') evidenceType!: string;
  @text('ipfs_cid') ipfsCid?: string;
  @text('ipfs_gateway_url') ipfsGatewayUrl?: string;
  @text('file_name') fileName?: string;
  @field('file_size') fileSize?: number;
  @text('mime_type') mimeType?: string;
  @text('file_hash_sha256') fileHashSha256?: string;
  @text('blockchain_tx_hash') blockchainTxHash?: string;
  @field('blockchain_log_index') blockchainLogIndex?: number;
  @field('anchored_at') anchoredAt?: number;
  @text('state') state!: string;
  @text('uploaded_by') uploadedBy!: string;
  @date('uploaded_at') uploadedAt!: Date;
  @text('verified_by') verifiedBy?: string;
  @date('verified_at') verifiedAt?: Date;
  @text('verification_notes') verificationNotes?: string;
  @text('ai_extracted_data') aiExtractedData?: string;
  @field('extraction_confidence') extractionConfidence?: number;
  @text('source_file_name') sourceFileName?: string;
  @field('was_edited') wasEdited?: boolean;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}

export class Trade extends Model {
  static table = 'trades';
  static associations = {
    buyer: { type: 'belongs_to', key: 'buyer_id' },
    seller: { type: 'belongs_to', key: 'seller_id' },
    asset: { type: 'belongs_to', key: 'asset_id' },
  };

  @text('buyer_id') buyerId!: string;
  @text('seller_id') sellerId!: string;
  @text('asset_id') assetId!: string;
  @field('quantity') quantity!: number;
  @field('price_per_credit_inr') pricePerCreditInr!: number;
  @field('subtotal_inr') subtotalInr!: number;
  @field('buyer_fee_inr') buyerFeeInr!: number;
  @field('seller_fee_inr') sellerFeeInr!: number;
  @field('total_fee_inr') totalFeeInr!: number;
  @field('gst_inr') gstInr!: number;
  @field('buyer_pays_inr') buyerPaysInr!: number;
  @field('seller_receives_inr') sellerReceivesInr!: number;
  @field('platform_net_inr') platformNetInr!: number;
  @field('price_per_credit_eth') pricePerCreditEth!: number;
  @field('total_eth') totalEth!: number;
  @field('eth_inr_rate') ethInrRate!: number;
  @field('fee_eth') feeEth!: number;
  @text('payment_mode') paymentMode!: string;
  @text('status') status!: string;
  @text('tx_hash') txHash?: string;
  @text('razorpay_payment_id') razorpayPaymentId?: string;
  @text('razorpay_order_id') razorpayOrderId?: string;
  @field('buyer_inr_deducted') buyerInrDeducted!: boolean;
  @field('seller_inr_credited') sellerInrCredited!: boolean;
  @date('inr_settlement_at') inrSettlementAt?: Date;
  @date('completed_at') completedAt?: Date;
  @text('idempotency_key') idempotencyKey?: string;
  @text('chain_status') chainStatus?: string;
  @text('chain_tx_hash') chainTxHash?: string;
  @field('chain_block') chainBlock?: number;
  @date('chain_logged_at') chainLoggedAt?: Date;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}