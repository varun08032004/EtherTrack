// Seller Onboarding Service
// Handles seller project submission, verification, and batch management

import { safeQuery as query, withTransaction } from '../../../db/pool.js';
import { v4 as uuidv4 } from 'uuid';

export interface SellerProject {
    project_id: string;
    seller_id: string;
    project_name: string;
    description: string;
    project_type: string;
    methodology: string;
    standard: string;
    country: string;
    region: string;
    coordinates: any;
    land_tenure: string;
    land_area_hectares: number;
    annual_credits_estimate: number;
    vintage_start: number;
    vintage_end: number;
    pd_document_id: string;
    validation_report_id: string;
    monitoring_plan_id: string;
    registry: string;
    registry_project_id: string;
    state: string;
    submitted_at: string | null;
    verified_at: string | null;
    approved_at: string | null;
    rejected_at: string | null;
    rejection_reason: string | null;
    created_at: string;
    updated_at: string;
}

export interface ProjectDocument {
    document_id: string;
    project_id: string;
    document_type: string;
    title: string;
    description: string;
    ipfs_cid: string;
    file_name: string;
    file_size: number;
    mime_type: string;
    file_hash_sha256: string;
    blockchain_tx_hash: string | null;
    anchored_at: string | null;
    verified: boolean;
    verified_by: string | null;
    verified_at: string | null;
    metadata: any;
    uploaded_by: string;
    uploaded_at: string;
}

export interface ProjectVerificationFinding {
    finding_id: string;
    project_id: string;
    severity: string;
    category: string;
    title: string;
    description: string;
    recommendation: string;
    reference_section: string;
    reference_document: string;
    status: string;
    response: string;
    responded_by: string;
    responded_at: string;
    resolved_by: string;
    resolved_at: string;
    created_by: string;
    created_at: string;
    updated_at: string;
}

export interface SellerBatch {
    batch_id: string;
    project_id: string;
    seller_id: string;
    batch_name: string;
    vintage: number;
    quantity: number;
    available_quantity: number;
    registry: string;
    registry_serial_start: string;
    registry_serial_end: string;
    serial_numbers: string[];
    verification_report_id: string;
    verification_date: string;
    verifier_firm: string;
    state: string;
    minted_at: string;
    listed_at: string;
    metadata: any;
    created_at: string;
    updated_at: string;
}

export interface SellerPayout {
    payout_id: string;
    seller_id: string;
    trade_id: string;
    order_id: string;
    gross_amount_inr: number;
    fee_inr: number;
    tax_inr: number;
    net_amount_inr: number;
    bank_account_number: string;
    bank_ifsc: string;
    bank_name: string;
    account_holder_name: string;
    status: string;
    razorpay_payout_id: string | null;
    processed_at: string | null;
    failed_reason: string | null;
    metadata: any;
    created_at: string;
    updated_at: string;
}

export class SellerOnboardingService {
    /**
     * Create a new project
     */
    static async createProject(data: {
        seller_id: string;
        project_name: string;
        description: string;
        project_type: string;
        methodology: string;
        standard: string;
        country: string;
        region: string;
        coordinates?: any;
        land_tenure: string;
        land_area_hectares: number;
        annual_credits_estimate: number;
        vintage_start: number;
        vintage_end: number;
        registry: string;
        registry_project_id?: string;
    }): Promise<{ project_id: string }> {
        const project_id = uuidv4();

        await query(
            `INSERT INTO seller_projects (
                project_id, seller_id, project_name, description, project_type,
                methodology, standard, country, region, coordinates,
                land_tenure, land_area_hectares, annual_credits_estimate,
                vintage_start, vintage_end, registry, registry_project_id, state
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            RETURNING project_id`,
            [
                uuidv4(), data.seller_id, data.project_name, data.description,
                data.project_type, data.methodology, data.standard,
                data.country, data.region, data.coordinates || null,
                data.land_tenure, data.land_area_hectares, data.annual_credits_estimate,
                data.vintage_start, data.vintage_end, data.registry,
                data.registry_project_id || null, 'DRAFT'
            ]
        );

        return { project_id: uuidv4() };
    }

    /**
     * Get project by ID
     */
    static async getProject(projectId: string) {
        const { rows } = await query(
            `SELECT * FROM seller_projects WHERE project_id = $1`,
            [projectId]
        );
        return rows[0] || null;
    }

    /**
     * List seller's projects
     */
    static async listProjects(sellerId: string, state?: string) {
        let sql = `SELECT * FROM seller_projects WHERE seller_id = $1`;
        const params: any[] = [sellerId];
        let paramIndex = 2;

        if (state) {
            sql += ` AND state = $${paramIndex++}`;
            params.push(state);
        }

        sql += ` ORDER BY created_at DESC`;
        const { rows } = await query(sql, params);
        return rows;
    }

    /**
     * Submit project for verification
     */
    static async submitForVerification(projectId: string, sellerId: string): Promise<void> {
        const { rows } = await query(
            `UPDATE seller_projects 
             SET state = 'SUBMITTED', submitted_at = NOW(), updated_at = NOW()
             WHERE project_id = $1 AND seller_id = $2 AND state = 'DRAFT'
             RETURNING project_id`,
            [projectId, sellerId]
        );

        if (!rows.length) {
            throw new Error('Project not found or not in draft state');
        }
    }

    /**
     * Upload project document
     */
    static async uploadDocument(data: {
        project_id: string;
        document_type: string;
        title: string;
        description?: string;
        ipfs_cid: string;
        file_name: string;
        file_size: number;
        mime_type: string;
        file_hash_sha256: string;
        uploaded_by: string;
    }): Promise<{ document_id: string }> {
        const document_id = uuidv4();

        await query(
            `INSERT INTO project_documents (
                document_id, project_id, document_type, title, description,
                ipfs_cid, file_name, file_size, mime_type, file_hash_sha256,
                uploaded_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING document_id`,
            [
                uuidv4(), data.project_id, data.document_type, data.title,
                data.description || null, data.ipfs_cid, data.file_name,
                data.file_size, data.mime_type, data.file_hash_sha256,
                data.uploaded_by
            ]
        );

        return { document_id: uuidv4() };
    }

    /**
     * Get project documents
     */
    static async getProjectDocuments(projectId: string) {
        const { rows } = await query(
            `SELECT * FROM project_documents WHERE project_id = $1 ORDER BY uploaded_at DESC`,
            [projectId]
        );
        return rows;
    }

    /**
     * Submit project for verification
     */
    static async submitForVerification(projectId: string, verifierId: string): Promise<void> {
        await query(
            `UPDATE seller_projects 
             SET state = 'UNDER_REVIEW', verifier_id = $1, updated_at = NOW()
             WHERE project_id = $1 AND state = 'SUBMITTED'
             RETURNING project_id`,
            [projectId, verifierId]
        );
    }

    /**
     * Add verification finding
     */
    static async addFinding(data: {
        project_id: string;
        severity: string;
        category: string;
        title: string;
        description: string;
        recommendation?: string;
        reference_section?: string;
        reference_document?: string;
        created_by: string;
    }): Promise<{ finding_id: string }> {
        const finding_id = uuidv4();

        await query(
            `INSERT INTO project_verification_findings (
                finding_id, project_id, severity, category, title, description,
                recommendation, reference_section, reference_document, status, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OPEN',$9)
            RETURNING finding_id`,
            [
                uuidv4(), data.project_id, data.severity, data.category,
                data.title, data.description, data.recommendation || null,
                data.reference_section || null, data.reference_document || null,
                data.created_by
            ]
        );

        return { finding_id: uuidv4() };
    }

    /**
     * Resolve verification finding
     */
    static async resolveFinding(findingId: string, resolverId: string, response: string): Promise<void> {
        await query(
            `UPDATE project_verification_findings
             SET status = 'RESOLVED', response = $1, responded_by = $2, responded_at = NOW(),
                 resolved_by = $2, resolved_at = NOW(), updated_at = NOW()
             WHERE finding_id = $1 AND status = 'OPEN'`,
            [findingId, response, resolverId]
        );
    }

    /**
     * Approve project
     */
    static async approveProject(projectId: string, approverId: string): Promise<void> {
        await query(
            `UPDATE seller_projects 
             SET state = 'APPROVED', approved_at = NOW(), updated_at = NOW()
             WHERE project_id = $1 AND state IN ('VERIFIED', 'UNDER_REVIEW')
             RETURNING project_id`,
            [projectId, approverId]
        );
    }

    /**
     * Reject project
     */
    static async rejectProject(projectId: string, rejectorId: string, reason: string): Promise<void> {
        await query(
            `UPDATE seller_projects 
             SET state = 'REJECTED', rejected_at = NOW(), rejection_reason = $1, updated_at = NOW()
             WHERE project_id = $1 AND state IN ('SUBMITTED', 'UNDER_REVIEW', 'VERIFIED')
             RETURNING project_id`,
            [projectId, reason, rejectorId]
        );
    }

    /**
     * Create a batch from verified project
     */
    static async createBatch(data: {
        project_id: string;
        seller_id: string;
        batch_name: string;
        vintage: number;
        quantity: number;
        registry: string;
        registry_serial_start: string;
        registry_serial_end: string;
        serial_numbers: string[];
        verification_report_id: string;
        verification_date: string;
        verifier_firm: string;
    }): Promise<{ batch_id: string }> {
        // Verify project is approved
        const { rows: projectRows } = await query(
            `SELECT * FROM seller_projects WHERE project_id = $1 AND seller_id = $2 AND state = 'APPROVED'`,
            [data.project_id, data.seller_id]
        );

        if (!projectRows.length) {
            throw new Error('Project not found, not approved, or not owned by seller');
        }

        const batch_id = uuidv4();

        await query(
            `INSERT INTO seller_batches (
                batch_id, project_id, seller_id, batch_name, vintage, quantity,
                available_quantity, registry, registry_serial_start, registry_serial_end,
                serial_numbers, verification_report_id, verification_date, verifier_firm, state
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13,'VERIFIED')
            RETURNING batch_id`,
            [
                uuidv4(), data.project_id, data.seller_id, data.batch_name,
                data.vintage, data.quantity, data.quantity,
                data.registry, data.registry_serial_start, data.registry_serial_end,
                data.serial_numbers, data.verification_report_id,
                data.verification_date, data.verifier_firm
            ]
        );

        return { batch_id: uuidv4() };
    }

    /**
     * List seller's batches
     */
    static async listBatches(sellerId: string, state?: string) {
        let sql = `SELECT b.*, p.project_name, p.registry FROM seller_batches b
                   JOIN seller_projects p ON p.project_id = b.project_id
                   WHERE b.seller_id = $1`;
        const params: any[] = [sellerId];
        let paramIndex = 2;

        if (state) {
            sql += ` AND b.state = $${paramIndex++}`;
            params.push(state);
        }

        sql += ` ORDER BY b.created_at DESC`;
        const { rows } = await query(sql, params);
        return rows;
    }

    /**
     * List batch for sale
     */
    static async listBatchForSale(data: {
        seller_id: string;
        batch_id: string;
        quantity: number;
        price_per_credit_inr: number;
        price_per_credit_usd?: number;
        currency?: string;
        min_order_qty?: number;
        max_order_qty?: number;
        listing_type?: string;
        expires_at?: string;
        buyer_fee_bps?: number;
        seller_fee_bps?: number;
    }): Promise<{ listing_id: string }> {
        // Verify batch ownership and availability
        const { rows: batchRows } = await query(
            `SELECT * FROM seller_batches WHERE batch_id = $1 AND seller_id = $2 AND state = 'VERIFIED'`,
            [data.batch_id, data.seller_id]
        );

        if (!batchRows.length) {
            throw new Error('Batch not found or not verified');
        }

        const batch = batchRows[0];
        if (batch.available_quantity < data.quantity) {
            throw new Error(`Insufficient quantity. Available: ${batch.available_quantity}`);
        }

        const listing_id = uuidv4();
        const currency = data.currency || 'INR';

        await query(
            `INSERT INTO marketplace_listings (
                listing_id, seller_id, batch_id, asset_passport_id,
                quantity, remaining_quantity, price_per_credit_inr, price_per_credit_usd,
                currency, buyer_fee_bps, seller_fee_bps, min_order_qty, max_order_qty,
                listing_type, expires_at, state, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),'ACTIVE',$16)
            RETURNING listing_id`,
            [
                uuidv4(), data.seller_id, data.batch_id, null,
                data.quantity, data.quantity, data.price_per_credit_inr,
                data.price_per_credit_usd || null, currency,
                data.buyer_fee_bps || 50, data.seller_fee_bps || 50,
                data.min_order_qty || 1, data.max_order_qty || null,
                data.listing_type || 'limit', data.expires_at || null,
                data.seller_id
            ]
        );

        // Update batch state
        await query(
            `UPDATE seller_batches SET state = 'LISTED', listed_at = NOW(), updated_at = NOW() WHERE batch_id = $1`,
            [data.batch_id]
        );

        return { listing_id: uuidv4() };
    }

    /**
     * Get seller's payouts
     */
    static async getPayouts(sellerId: string, status?: string) {
        let sql = `SELECT sp.*, t.quantity, t.price_per_credit_inr, t.project_name
                   FROM seller_payouts sp
                   LEFT JOIN trades t ON t.id = sp.trade_id
                   WHERE sp.seller_id = $1`;
        const params: any[] = [sellerId];
        let paramIndex = 2;

        if (status) {
            sql += ` AND sp.status = $${paramIndex++}`;
            params.push(status);
        }

        sql += ` ORDER BY sp.created_at DESC`;
        const { rows } = await query(sql, params);
        return rows;
    }

    /**
     * Request payout
     */
    static async requestPayout(data: {
        seller_id: string;
        trade_id: string;
        amount_inr: number;
        bank_account_number: string;
        bank_ifsc: string;
        bank_name: string;
        account_holder_name: string;
    }): Promise<{ payout_id: string }> {
        const payout_id = uuidv4();
        const fee_inr = Math.round(data.amount_inr * 0.005); // 0.5% fee
        const tax_inr = Math.round(data.amount_inr * 0.18); // 18% GST
        const net_amount_inr = data.amount_inr - fee_inr - tax_inr;

        await query(
            `INSERT INTO seller_payouts (
                payout_id, seller_id, trade_id, gross_amount_inr, fee_inr, tax_inr,
                net_amount_inr, bank_account_number, bank_ifsc, bank_name, account_holder_name, status
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING')
            RETURNING payout_id`,
            [
                uuidv4(), data.seller_id, data.trade_id, data.amount_inr,
                fee_inr, tax_inr, net_amount_inr,
                data.bank_account_number, data.bank_ifsc, data.bank_name, data.account_holder_name
            ]
        );

        return { payout_id: uuidv4() };
    }

    /**
     * Get seller dashboard stats
     */
    static async getSellerStats(sellerId: string) {
        const { rows } = await query(
            `SELECT 
                (SELECT COUNT(*) FROM seller_projects WHERE seller_id = $1) as total_projects,
                (SELECT COUNT(*) FROM seller_projects WHERE seller_id = $1 AND state = 'APPROVED') as approved_projects,
                (SELECT COUNT(*) FROM seller_batches WHERE seller_id = $1 AND state = 'VERIFIED') as verified_batches,
                (SELECT COUNT(*) FROM seller_batches WHERE seller_id = $1 AND state = 'LISTED') as listed_batches,
                (SELECT COUNT(*) FROM seller_batches WHERE seller_id = $1 AND state = 'SOLD') as sold_batches,
                (SELECT COALESCE(SUM(quantity), 0) FROM seller_batches WHERE seller_id = $1 AND state = 'SOLD') as total_credits_sold,
                (SELECT COALESCE(SUM(net_amount_inr), 0) FROM seller_payouts WHERE seller_id = $1 AND status = 'COMPLETED') as total_earnings,
                (SELECT COALESCE(SUM(net_amount_inr), 0) FROM seller_payouts WHERE seller_id = $1 AND status = 'PENDING') as pending_payouts
            `,
            [sellerId]
        );

        return rows[0];
    }
}

export default SellerOnboardingService;