// MRV Workflow Service
// Plan → Collect → Verify → Approve workflow for emission data

import { safeQuery as query, withTransaction } from '../../db/pool.js';
import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';

export interface MRVPlan {
    planId: string;
    userId: string;
    orgId: string | null;
    planName: string;
    description: string | null;
    reportingYear: number;
    methodologyTemplate: string;
    coversScope1: boolean;
    coversScope2: boolean;
    coversScope3: boolean;
    facilityIds: string[];
    assetIds: string[];
    reportingPeriodStart: string;
    reportingPeriodEnd: string;
    submissionDeadline: string | null;
    verificationDeadline: string | null;
    state: MRVPlanState;
    previousState: string | null;
    submittedBy: string | null;
    submittedAt: string | null;
    assignedVerifier: string | null;
    verifiedBy: string | null;
    verifiedAt: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
    verificationFindings: any;
    overallConclusion: string | null;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}

export type MRVPlanState = 
    | 'DRAFT' 
    | 'SUBMITTED' 
    | 'UNDER_REVIEW' 
    | 'VERIFIED' 
    | 'APPROVED' 
    | 'REJECTED' 
    | 'ARCHIVED';

export interface Evidence {
    evidenceId: string;
    planId: string;
    activityId: string | null;
    title: string;
    description: string | null;
    evidenceType: string;
    ipfsCid: string | null;
    ipfsGatewayUrl: string | null;
    fileName: string | null;
    fileSizeBytes: number | null;
    mimeType: string | null;
    fileHashSha256: string | null;
    blockchainTxHash: string | null;
    blockchainLogIndex: number | null;
    chainId: number | null;
    anchoredAt: string | null;
    state: EvidenceState;
    uploadedBy: string;
    uploadedAt: string;
    verifiedBy: string | null;
    verifiedAt: string | null;
    verificationNotes: string | null;
    aiExtractedData: any | null;
    extractionConfidence: number | null;
    metadata: any | null;
    createdAt: string;
    updatedAt: string;
}

export type EvidenceState = 'UPLOADED' | 'PROCESSING' | 'VERIFIED' | 'REJECTED' | 'ARCHIVED';

export interface VerificationFinding {
    findingId: string;
    planId: string;
    evidenceId: string | null;
    severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'OBSERVATION';
    category: string;
    title: string;
    description: string;
    recommendation: string | null;
    referenceSection: string | null;
    referenceActivity: string | null;
    referenceEvidence: string | null;
    status: string;
    response: string | null;
    respondedBy: string | null;
    respondedAt: string | null;
    resolvedBy: string | null;
    resolvedAt: string | null;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}

export interface Verifier {
    verifierId: string;
    userId: string;
    accreditationBody: string | null;
    accreditationNumber: string | null;
    accreditationScope: any;
    accreditationValidFrom: string | null;
    accreditationValidTo: string | null;
    sectors: string[];
    methodologies: string[];
    isActive: boolean;
    isApproved: boolean;
    verificationsCompleted: number;
    avgTurnaroundDays: number | null;
    rating: number | null;
}

export class MRVService {
    // ============================================================
    // PLAN MANAGEMENT
    // ============================================================

    /**
     * Create a new MRV plan
     */
    static async createPlan(data: {
        userId: string;
        orgId?: string;
        planName: string;
        description?: string;
        reportingYear: number;
        methodologyTemplate: string;
        coversScope1?: boolean;
        coversScope2?: boolean;
        coversScope3?: boolean;
        facilityIds?: string[];
        assetIds?: string[];
        reportingPeriodStart: string;
        reportingPeriodEnd: string;
        submissionDeadline?: string;
        verificationDeadline?: string;
    }): Promise<MRVPlan> {
        const { rows } = await query(
            `INSERT INTO mrv_plans (
                user_id, org_id, plan_name, description, reporting_year,
                methodology_template, covers_scope_1, covers_scope_2, covers_scope_3,
                facility_ids, asset_ids, reporting_period_start, reporting_period_end,
                submission_deadline, verification_deadline, state, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            RETURNING *`,
            [
                data.userId,
                data.orgId || null,
                data.planName,
                data.description || null,
                data.reportingYear,
                data.methodologyTemplate,
                data.coversScope1 ?? true,
                data.coversScope2 ?? true,
                data.coversScope3 ?? false,
                data.facilityIds || [],
                data.assetIds || [],
                data.reportingPeriodStart,
                data.reportingPeriodEnd,
                data.submissionDeadline || null,
                data.verificationDeadline || null,
                'DRAFT',
                data.userId
            ]
        );
        return this.mapPlanRow(rows[0]);
    }

    /**
     * Get plan by ID
     */
    static async getPlan(planId: string): Promise<MRVPlan | null> {
        const { rows } = await query(
            `SELECT * FROM mrv_plans WHERE plan_id = $1`,
            [planId]
        );
        return rows[0] ? this.mapPlanRow(rows[0]) : null;
    }

    /**
     * List plans for a user
     */
    static async listPlans(userId: string, options?: {
        state?: string;
        year?: number;
        limit?: number;
        offset?: number;
    }): Promise<{ plans: MRVPlan[]; total: number }> {
        let sql = `SELECT * FROM mrv_plans WHERE user_id = $1`;
        const queryParams: any[] = [userId];
        let paramIndex = 2;

        if (options?.state) {
            sql += ` AND state = $${paramIndex++}`;
            queryParams.push(options.state);
        }
        if (options?.year) {
            sql += ` AND reporting_year = $${paramIndex++}`;
            queryParams.push(options.year);
        }

        sql += ` ORDER BY created_at DESC`;

        if (options?.limit) {
            sql += ` LIMIT $${paramIndex++}`;
            queryParams.push(options.limit);
        }
        if (options?.offset) {
            sql += ` OFFSET $${paramIndex++}`;
            queryParams.push(options.offset);
        }

        const { rows } = await query(sql, queryParams);
        
        // Get total count
        let countSql = `SELECT COUNT(*) FROM mrv_plans WHERE user_id = $1`;
        const countParams = [userId];
        if (options?.state) {
            countSql += ` AND state = $2`;
            countParams.push(options.state);
        }
        if (options?.year) {
            countSql += ` AND reporting_year = $${countParams.length + 1}`;
            countParams.push(String(options.year));
        }
        const { rows: countRows } = await query(countSql, countParams);

        return {
            plans: rows.map(this.mapPlanRow),
            total: parseInt(countRows[0].count)
        };
    }

    /**
     * Update plan state with validation
     */
    static async transitionState(
        planId: string,
        fromState: string,
        toState: string,
        userId: string,
        reason?: string
    ): Promise<MRVPlan> {
        const validTransitions: Record<string, string[]> = {
            'DRAFT': ['SUBMITTED', 'ARCHIVED'],
            'SUBMITTED': ['UNDER_REVIEW', 'REJECTED', 'DRAFT'],
            'UNDER_REVIEW': ['VERIFIED', 'REJECTED', 'SUBMITTED'],
            'VERIFIED': ['APPROVED', 'REJECTED'],
            'APPROVED': ['ARCHIVED'],
            'REJECTED': ['DRAFT'],
            'ARCHIVED': []
        };

        if (!validTransitions[fromState]?.includes(toState)) {
            throw new Error(`Invalid state transition: ${fromState} -> ${toState}`);
        }

        const { rows } = await query(
            `UPDATE mrv_plans 
             SET state = $1, previous_state = $2, updated_at = NOW(),
                 ${toState === 'SUBMITTED' ? 'submitted_by = $3, submitted_at = NOW(),' : ''}
                 ${toState === 'VERIFIED' ? 'verified_by = $3, verified_at = NOW(),' : ''}
                 ${toState === 'APPROVED' ? 'approved_by = $3, approved_at = NOW(),' : ''}
             WHERE plan_id = $4 AND state = $5
             RETURNING *`,
            [toState, fromState, userId, planId, fromState]
        );

        if (!rows.length) {
            throw new Error('Plan not found or invalid current state');
        }

        // Log transition
        await query(
            `INSERT INTO mrv_state_transitions (plan_id, from_state, to_state, transitioned_by, reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [planId, fromState, toState, userId, reason || `Transitioned from ${fromState} to ${toState}`]
        );

        return this.mapPlanRow(rows[0]);
    }

    /**
     * Submit plan for verification
     */
    static async submitPlan(planId: string, userId: string): Promise<MRVPlan> {
        const plan = await this.getPlan(planId);
        if (!plan) throw new Error('Plan not found');
        if (plan.userId !== plan.userId) throw new Error('Not authorized');
        
        return this.transitionState(planId, 'DRAFT', 'SUBMITTED', userId, 'Submitted for verification');
    }

    // ============================================================
    // EVIDENCE MANAGEMENT
    // ============================================================

    /**
     * Upload evidence with IPFS
     */
    static async uploadEvidence(data: {
        planId: string;
        activityId?: string;
        title: string;
        description?: string;
        evidenceType: string;
        file: Buffer;
        fileName: string;
        mimeType: string;
        uploadedBy: string;
        metadata?: any;
    }): Promise<Evidence> {
        const { file, fileName, mimeType, ...rest } = data;
        
        // Calculate file hash
        const crypto = require('crypto');
        const fileHash = crypto.createHash('sha256').update(file).digest('hex');
        const fileSize = file.length;

        // Upload to IPFS (placeholder - integrate with Pinata/IPFS service)
        const ipfsResult = await this.uploadToIPFS(file, fileName);
        const ipfsCid = ipfsResult.cid;
        const ipfsGatewayUrl = `https://gateway.pinata.cloud/ipfs/${ipfsCid}`;

        // Store in database
        const { rows } = await query(
            `INSERT INTO emission_evidence (
                plan_id, activity_id, title, description, evidence_type,
                ipfs_cid, ipfs_gateway_url, file_name, file_size_bytes,
                mime_type, file_hash_sha256, state, uploaded_by, metadata
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'UPLOADED',$10,$11)
            RETURNING *`,
            [
                data.planId,
                data.activityId || null,
                data.title,
                data.description || null,
                data.evidenceType,
                ipfsCid,
                ipfsGatewayUrl,
                fileName,
                fileSize,
                mimeType,
                fileHash,
                data.uploadedBy,
                JSON.stringify(data.metadata || {})
            ]
        );

        return this.mapEvidenceRow(rows[0]);
    }

    /**
     * Upload file to IPFS (placeholder - integrate with Pinata/Infura)
     */
    private static async uploadToIPFS(file: Buffer, fileName: string): Promise<{ cid: string }> {
        // TODO: Integrate with Pinata API or Infura IPFS
        // For now, return a mock CID for development
        const mockCid = `Qm${require('crypto').randomBytes(32).toString('hex').substring(0, 44)}`;
        return { cid: mockCid };
    }

    /**
     * Anchor evidence hash on-chain
     */
    static async anchorEvidenceOnChain(evidenceId: string, userId: string): Promise<{ txHash: string; blockNumber: number }> {
        const { rows } = await query(
            `SELECT file_hash_sha256 FROM emission_evidence WHERE evidence_id = $1`,
            [evidenceId]
        );

        if (!rows.length) throw new Error('Evidence not found');
        if (!rows[0].file_hash_sha256) throw new Error('Evidence has no file hash');

        const hash = rows[0].file_hash_sha256;

        // Call CreditLedger to anchor hash
        // This would call the blockchain service
        const { anchorHashOnChain } = require('../services/creditLedger');
        const result = await anchorHashOnChain({
            userId,
            tokenId: 0, // Special token for evidence anchoring
            amount: 0,
            actionType: 'ANCHOR_EVIDENCE',
            refTable: 'emission_evidence',
            refId: evidenceId,
            note: `Evidence anchor: ${evidenceId}`
        });

        // Update evidence with blockchain info
        await query(
            `UPDATE emission_evidence 
             SET blockchain_tx_hash = $1, blockchain_log_index = $2, 
                 chain_id = $3, anchored_at = NOW(), state = 'VERIFIED'
             WHERE evidence_id = $3`,
            [result.txHash, result.blockNumber, process.env.CHAIN_ID || 11155111, evidenceId]
        );

        return { txHash: result.txHash, blockNumber: result.blockNumber };
    }

    /**
     * Get evidence for a plan
     */
    static async getEvidenceForPlan(planId: string): Promise<Evidence[]> {
        const { rows } = await query(
            `SELECT * FROM emission_evidence WHERE plan_id = $1 ORDER BY uploaded_at DESC`,
            [planId]
        );
        return rows.map(this.mapEvidenceRow);
    }

    /**
     * Verify evidence
     */
    static async verifyEvidence(evidenceId: string, verifierId: string, notes?: string): Promise<Evidence> {
        const { rows } = await query(
            `UPDATE emission_evidence 
             SET state = 'VERIFIED', verified_by = $1, verified_at = NOW(), verification_notes = $2
             WHERE evidence_id = $1
             RETURNING *`,
            [evidenceId, verifierId, notes || null]
        );
        return this.mapEvidenceRow(rows[0]);
    }

    /**
     * Reject evidence
     */
    static async rejectEvidence(evidenceId: string, verifierId: string, notes: string): Promise<Evidence> {
        const { rows } = await query(
            `UPDATE emission_evidence 
             SET state = 'REJECTED', verified_by = $1, verified_at = NOW(), verification_notes = $2
             WHERE evidence_id = $1
             RETURNING *`,
            [evidenceId, verifierId, notes]
        );
        return this.mapEvidenceRow(rows[0]);
    }

    // ============================================================
    // VERIFICATION FINDINGS
    // ============================================================

    /**
     * Add verification finding
     */
    static async addFinding(data: {
        planId: string;
        evidenceId?: string;
        severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'OBSERVATION';
        category: string;
        title: string;
        description: string;
        recommendation?: string;
        referenceSection?: string;
        referenceActivity?: string;
        referenceEvidence?: string;
        createdBy: string;
    }): Promise<VerificationFinding> {
        const { rows } = await query(
            `INSERT INTO verification_findings (
                plan_id, evidence_id, severity, category, title,
                description, recommendation, reference_section,
                reference_activity, reference_evidence, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING *`,
            [
                data.planId,
                data.evidenceId || null,
                data.severity,
                data.category,
                data.title,
                data.description,
                data.recommendation || null,
                data.referenceSection || null,
                data.referenceActivity || null,
                data.referenceEvidence || null,
                data.createdBy
            ]
        );
        return this.mapFindingRow(rows[0]);
    }

    /**
     * Get findings for a plan
     */
    static async getFindings(planId: string): Promise<VerificationFinding[]> {
        const { rows } = await query(
            `SELECT * FROM verification_findings WHERE plan_id = $1 ORDER BY severity, created_at`,
            [planId]
        );
        return rows.map(this.mapFindingRow);
    }

    /**
     * Resolve finding
     */
    static async resolveFinding(findingId: string, userId: string, response: string): Promise<VerificationFinding> {
        const { rows } = await query(
            `UPDATE verification_findings
             SET status = 'RESOLVED', response = $1, responded_by = $2, responded_at = NOW()
             WHERE finding_id = $1
             RETURNING *`,
            [findingId, response, userId]
        );
        return this.mapFindingRow(rows[0]);
    }

    // ============================================================
    // VERIFIER MANAGEMENT
    // ============================================================

    /**
     * Register verifier
     */
    static async registerVerifier(data: {
        userId: string;
        accreditationBody: string;
        accreditationNumber: string;
        accreditationScope: string[];
        accreditationValidFrom: string;
        accreditationValidTo: string;
        sectors: string[];
        methodologies: string[];
    }): Promise<Verifier> {
        const { rows } = await query(
            `INSERT INTO emission_verifiers (
                user_id, accreditation_body, accreditation_number,
                accreditation_scope, accreditation_valid_from, accreditation_valid_to,
                sectors, methodologies
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (user_id) DO UPDATE SET
                accreditation_body = EXCLUDED.accreditation_body,
                accreditation_number = EXCLUDED.accreditation_number,
                accreditation_scope = EXCLUDED.accreditation_scope,
                accreditation_valid_from = EXCLUDED.accreditation_valid_from,
                accreditation_valid_to = EXCLUDED.accreditation_valid_to,
                sectors = EXCLUDED.sectors,
                methodologies = EXCLUDED.methodologies,
                updated_at = NOW()
            RETURNING *`,
            [
                data.userId,
                data.accreditationBody,
                data.accreditationNumber,
                JSON.stringify(data.accreditationScope),
                data.accreditationValidFrom,
                data.accreditationValidTo,
                data.sectors,
                data.methodologies
            ]
        );
        return this.mapVerifierRow(rows[0]);
    }

    /**
     * Approve verifier
     */
    static async approveVerifier(verifierId: string, adminId: string): Promise<Verifier> {
        const { rows } = await query(
            `UPDATE emission_verifiers
             SET is_approved = TRUE, approved_by = $1, approved_at = NOW()
             WHERE verifier_id = $1
             RETURNING *`,
            [verifierId, adminId]
        );
        return this.mapVerifierRow(rows[0]);
    }

    /**
     * Get available verifiers for a plan
     */
    static async getAvailableVerifiers(planId: string): Promise<Verifier[]> {
        const { rows: plan } = await query(
            `SELECT methodology_template, sectors FROM mrv_plans WHERE plan_id = $1`,
            [planId]
        );
        if (!plan.length) throw new Error('Plan not found');

        const methodology = plan[0].methodology_template;
        const sectors = plan[0].sectors || [];

        const { rows } = await query(
            `SELECT * FROM emission_verifiers
             WHERE is_active = TRUE AND is_approved = TRUE
             AND (accreditation_scope @> $1 OR methodologies && $2)
             AND (sectors && $3 OR array_length(sectors, 1) IS NULL)
             ORDER BY verifications_completed DESC, rating DESC`,
            [JSON.stringify([methodology]), JSON.stringify([methodology]), sectors]
        );
        return rows.map(this.mapVerifierRow);
    }

    /**
     * Assign verifier to plan
     */
    static async assignVerifier(planId: string, verifierId: string, assignedBy: string): Promise<void> {
        await withTransaction(async (client) => {
            await client.query(
                `UPDATE mrv_plans SET assigned_verifier = $1, state = 'UNDER_REVIEW', updated_at = NOW()
                 WHERE plan_id = $2 AND state = 'SUBMITTED'`,
                [verifierId, planId]
            );

            await client.query(
                `INSERT INTO verification_assignments (plan_id, verifier_id, assigned_by, due_date)
                 VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
                [planId, verifierId, 'system']
            );
        });
    }

    // ============================================================
    // VERIFICATION WORKFLOW
    // ============================================================

    /**
     * Complete verification
     */
    static async completeVerification(planId: string, verifierId: string, data: {
        findings: Array<{
            severity: 'CRITICAL' | 'MAJOR' | 'MINOR' | 'OBSERVATION';
            category: string;
            title: string;
            description: string;
            recommendation?: string;
            referenceSection?: string;
            referenceActivity?: string;
            referenceEvidence?: string;
        }>;
        overallConclusion: 'VERIFIED' | 'VERIFIED_WITH_QUALIFICATIONS' | 'NOT_VERIFIED';
    }): Promise<MRVPlan> {
        return withTransaction(async (client) => {
            // Add findings
            for (const finding of data.findings) {
                await client.query(
                    `INSERT INTO verification_findings (
                        plan_id, severity, category, title, description,
                        recommendation, reference_section, reference_activity,
                        created_by
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
                    [
                        planId,
                        finding.severity,
                        finding.category,
                        finding.title,
                        finding.description,
                        finding.recommendation || null,
                        finding.referenceSection || null,
                        finding.referenceActivity || null,
                        finding.referenceEvidence || null
                    ]
                );
            }

            // Update plan state
            const { rows } = await client.query(
                `UPDATE mrv_plans
                 SET state = 'VERIFIED', verified_by = $1, verified_at = NOW(),
                     verification_findings = $2, overall_conclusion = $3,
                     updated_at = NOW()
                 WHERE plan_id = $4 AND assigned_verifier = $1
                 RETURNING *`,
                [verifierId, JSON.stringify(data.findings), data.overallConclusion, planId]
            );

            if (!rows.length) throw new Error('Plan not found or not assigned to verifier');

            return this.mapPlanRow(rows[0]);
        });
    }

    /**
     * Approve verified plan
     */
    static async approvePlan(planId: string, adminId: string): Promise<MRVPlan> {
        const { rows } = await query(
            `UPDATE mrv_plans
             SET state = 'APPROVED', approved_by = $1, approved_at = NOW(), updated_at = NOW()
             WHERE plan_id = $1 AND state = 'VERIFIED'
             RETURNING *`,
            [planId, adminId]
        );
        if (!rows.length) throw new Error('Plan not found or not verified');
        return this.mapPlanRow(rows[0]);
    }

    // ============================================================
    // HELPERS
    // ============================================================

    private static mapPlanRow(row: any): MRVPlan {
        return {
            planId: row.plan_id,
            userId: row.user_id,
            orgId: row.org_id,
            planName: row.plan_name,
            description: row.description,
            reportingYear: row.reporting_year,
            methodologyTemplate: row.methodology_template,
            coversScope1: row.covers_scope_1,
            coversScope2: row.covers_scope_2,
            coversScope3: row.covers_scope_3,
            facilityIds: row.facility_ids || [],
            assetIds: row.asset_ids || [],
            reportingPeriodStart: row.reporting_period_start,
            reportingPeriodEnd: row.reporting_period_end,
            submissionDeadline: row.submission_deadline,
            verificationDeadline: row.verification_deadline,
            state: row.state,
            previousState: row.previous_state,
            submittedBy: row.submitted_by,
            submittedAt: row.submitted_at,
            assignedVerifier: row.assigned_verifier,
            verifiedBy: row.verified_by,
            verifiedAt: row.verified_at,
            approvedBy: row.approved_by,
            approvedAt: row.approved_at,
            verificationFindings: row.verification_findings,
            overallConclusion: row.overall_conclusion,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    private static mapEvidenceRow(row: any): Evidence {
        return {
            evidenceId: row.evidence_id,
            planId: row.plan_id,
            activityId: row.activity_id,
            title: row.title,
            description: row.description,
            evidenceType: row.evidence_type,
            ipfsCid: row.ipfs_cid,
            ipfsGatewayUrl: row.ipfs_gateway_url,
            fileName: row.file_name,
            fileSizeBytes: row.file_size_bytes,
            mimeType: row.mime_type,
            fileHashSha256: row.file_hash_sha256,
            blockchainTxHash: row.blockchain_tx_hash,
            blockchainLogIndex: row.blockchain_log_index,
            chainId: row.chain_id,
            anchoredAt: row.anchored_at,
            state: row.state,
            uploadedBy: row.uploaded_by,
            uploadedAt: row.uploaded_at,
            verifiedBy: row.verified_by,
            verifiedAt: row.verified_at,
            verificationNotes: row.verification_notes,
            aiExtractedData: row.ai_extracted_data,
            extractionConfidence: row.extraction_confidence,
            metadata: row.metadata,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    private static mapFindingRow(row: any): VerificationFinding {
        return {
            findingId: row.finding_id,
            planId: row.plan_id,
            evidenceId: row.evidence_id,
            severity: row.severity,
            category: row.category,
            title: row.title,
            description: row.description,
            recommendation: row.recommendation,
            referenceSection: row.reference_section,
            referenceActivity: row.reference_activity,
            referenceEvidence: row.reference_evidence,
            status: row.status,
            response: row.response,
            respondedBy: row.responded_by,
            respondedAt: row.responded_at,
            resolvedBy: row.resolved_by,
            resolvedAt: row.resolved_at,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    private static mapVerifierRow(row: any): Verifier {
        return {
            verifierId: row.verifier_id,
            userId: row.user_id,
            accreditationBody: row.accreditation_body,
            accreditationNumber: row.accreditation_number,
            accreditationScope: row.accreditation_scope,
            accreditationValidFrom: row.accreditation_valid_from,
            accreditationValidTo: row.accreditation_valid_to,
            sectors: row.sectors || [],
            methodologies: row.methodologies || [],
            isActive: row.is_active,
            isApproved: row.is_approved,
            verificationsCompleted: row.verifications_completed,
            avgTurnaroundDays: row.avg_turnaround_days,
            rating: row.rating
        };
    }
}

export default MRVService;