// Compliance API Routes
// Multi-jurisdiction compliance reporting endpoints

import { Router, Request, Response } from 'express';
import { CBAMengine } from '../services/compliance/cbamEngine.js';
import { SECClimateEngine } from '../services/compliance/secClimateEngine.js';
import { ISSBengine } from '../services/compliance/issbEngine.js';
import { TNFDEngine } from '../services/compliance/tnfdEngine.js';
import { ComplianceEngineFactory, UnifiedComplianceReportGenerator } from '../services/compliance/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validate.js';
import { query } from '../db/pool.js';

const router = Router();

// ============================================
// CBAM Routes
// ============================================

/**
 * Generate CBAM quarterly report
 * POST /api/compliance/cbam/reports
 */
router.post('/cbam/reports', requireAuth, requireRole(['COMPLIANCE_OFFICER', 'ADMIN']), async (req: Request, res: Response) => {
    try {
        const { declarantId, quarter, year } = req.body;
        
        if (!declarantId || !quarter || !year) {
            return res.status(400).json({ error: 'declarantId, quarter, and year are required' });
        }

        const report = await CBAMengine.generateQuarterlyReport(declarantId, quarter, year);
        res.status(201).json(report);
    } catch (error) {
        console.error('CBAM report generation error:', error);
        res.status(500).json({ error: 'Failed to generate CBAM report' });
    }
});

/**
 * Validate CBAM report
 * POST /api/compliance/cbam/reports/:reportId/validate
 */
router.post('/cbam/reports/:reportId/validate', requireAuth, async (req: Request, res: Response) => {
    try {
        const { reportId } = req.params;
        const validation = await CBAMengine.validateReport(reportId);
        res.json(validation);
    } catch (error) {
        console.error('CBAM validation error:', error);
        res.status(500).json({ error: 'Failed to validate CBAM report' });
    }
});

/**
 * Submit CBAM report
 * POST /api/compliance/cbam/reports/:reportId/submit
 */
router.post('/cbam/reports/:reportId/submit', requireAuth, requireRole(['COMPLIANCE_OFFICER', 'ADMIN']), async (req: Request, res: Response) => {
    try {
        const { reportId } = req.params;
        const result = await CBAMengine.submitReport(reportId);
        res.json(result);
    } catch (error) {
        console.error('CBAM submission error:', error);
        res.status(500).json({ error: 'Failed to submit CBAM report' });
    }
});

/**
 * Get CBAM compliance status
 * GET /api/compliance/cbam/status/:declarantId/:year
 */
router.get('/cbam/status/:declarantId/:year', requireAuth, async (req: Request, res: Response) => {
    try {
        const { declarantId, year } = req.params;
        const status = await CBAMengine.getComplianceStatus(declarantId, parseInt(year));
        res.json(status);
    } catch (error) {
        console.error('CBAM status error:', error);
        res.status(500).json({ error: 'Failed to get CBAM compliance status' });
    }
});

/**
 * Calculate embedded emissions for a good
 * POST /api/compliance/cbam/calculate
 */
router.post('/cbam/calculate', requireAuth, async (req: Request, res: Response) => {
    try {
        const calculation = CBAMengine.calculateEmbeddedEmissions(req.body);
        res.json(calculation);
    } catch (error) {
        console.error('CBAM calculation error:', error);
        res.status(500).json({ error: 'Failed to calculate embedded emissions' });
    }
});

/**
 * Get CBAM reports for declarant
 * GET /api/compliance/cbam/reports/:declarantId
 */
router.get('/cbam/reports/:declarantId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { declarantId } = req.params;
        const { year, status, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM cbam_reports WHERE declarant_id = $1';
        const params: any[] = [declarantId];
        let paramIndex = 2;
        
        if (year) {
            sql += ` AND EXTRACT(YEAR FROM reporting_period_start) = $${paramIndex++}`;
            params.push(parseInt(year as string));
        }
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        sql += ` ORDER BY reporting_period_start DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('CBAM reports fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch CBAM reports' });
    }
});

// ============================================
// SEC Climate Disclosure Routes
// ============================================

/**
 * Generate SEC Climate report
 * POST /api/compliance/sec/reports
 */
router.post('/sec/reports', requireAuth, requireRole(['COMPLIANCE_OFFICER', 'ADMIN']), async (req: Request, res: Response) => {
    try {
        const { companyId, fiscalYear } = req.body;
        
        if (!companyId || !fiscalYear) {
            return res.status(400).json({ error: 'companyId and fiscalYear are required' });
        }

        const report = await SECClimateEngine.generateReport(companyId, fiscalYear);
        res.status(201).json(report);
    } catch (error) {
        console.error('SEC Climate report generation error:', error);
        res.status(500).json({ error: 'Failed to generate SEC Climate report' });
    }
});

/**
 * Validate SEC Climate report
 * POST /api/compliance/sec/reports/:reportId/validate
 */
router.post('/sec/reports/:reportId/validate', requireAuth, async (req: Request, res: Response) => {
    try {
        const { reportId } = req.params;
        const validation = await SECClimateEngine.validateReport(reportId);
        res.json(validation);
    } catch (error) {
        console.error('SEC Climate validation error:', error);
        res.status(500).json({ error: 'Failed to validate SEC Climate report' });
    }
});

/**
 * Generate XBRL tags for SEC filing
 * GET /api/compliance/sec/reports/:reportId/xbrl
 */
router.get('/sec/reports/:reportId/xbrl', requireAuth, async (req: Request, res: Response) => {
    try {
        const { reportId } = req.params;
        const { rows } = await query('SELECT * FROM sec_climate_reports WHERE report_id = $1', [reportId]);
        
        if (!rows.length) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        const xbrlTags = SECClimateEngine.generateXBRLTags(rows[0]);
        res.json(xbrlTags);
    } catch (error) {
        console.error('SEC XBRL generation error:', error);
        res.status(500).json({ error: 'Failed to generate XBRL tags' });
    }
});

/**
 * Get SEC Climate reports for company
 * GET /api/compliance/sec/reports/:companyId
 */
router.get('/sec/reports/:companyId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { companyId } = req.params;
        const { year, status, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM sec_climate_reports WHERE company_id = $1';
        const params: any[] = [companyId];
        let paramIndex = 2;
        
        if (year) {
            sql += ` AND fiscal_year = $${paramIndex++}`;
            params.push(parseInt(year as string));
        }
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        sql += ` ORDER BY fiscal_year DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('SEC Climate reports fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch SEC Climate reports' });
    }
});

// ============================================
// ISSB S2 Routes
// ============================================

/**
 * Generate ISSB S2 report
 * POST /api/compliance/issb/reports
 */
router.post('/issb/reports', requireAuth, requireRole(['COMPLIANCE_OFFICER', 'ADMIN']), async (req: Request, res: Response) => {
    try {
        const { entityId, reportingPeriod } = req.body;
        
        if (!entityId || !reportingPeriod) {
            return res.status(400).json({ error: 'entityId and reportingPeriod are required' });
        }

        const report = await ISSBengine.generateReport(entityId, reportingPeriod);
        res.status(201).json(report);
    } catch (error) {
        console.error('ISSB S2 report generation error:', error);
        res.status(500).json({ error: 'Failed to generate ISSB S2 report' });
    }
});

/**
 * Validate ISSB S2 report
 * POST /api/compliance/issb/reports/:reportId/validate
 */
router.post('/issb/reports/:reportId/validate', requireAuth, async (req: Request, res: Response) => {
    try {
        const { reportId } = req.params;
        const validation = await ISSBengine.validateReport(reportId);
        res.json(validation);
    } catch (error) {
        console.error('ISSB S2 validation error:', error);
        res.status(500).json({ error: 'Failed to validate ISSB S2 report' });
    }
});

/**
 * Generate XBRL tags for ISSB S2
 * GET /api/compliance/issb/reports/:reportId/xbrl
 */
router.get('/issb/reports/:reportId/xbrl', requireAuth, async (req: Request, res: Response) => {
    try {
        const { reportId } = req.params;
        const { rows } = await query('SELECT * FROM issb_s2_reports WHERE report_id = $1', [reportId]);
        
        if (!rows.length) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        const xbrlTags = ISSBengine.generateXBRLTags(rows[0]);
        res.json(xbrlTags);
    } catch (error) {
        console.error('ISSB XBRL generation error:', error);
        res.status(500).json({ error: 'Failed to generate XBRL tags' });
    }
});

/**
 * Get ISSB S2 reports for entity
 * GET /api/compliance/issb/reports/:entityId
 */
router.get('/issb/reports/:entityId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { entityId } = req.params;
        const { startDate, endDate, status, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM issb_s2_reports WHERE entity_id = $1';
        const params: any[] = [entityId];
        let paramIndex = 2;
        
        if (startDate) {
            sql += ` AND reporting_period_start >= $${paramIndex++}`;
            params.push(startDate);
        }
        
        if (endDate) {
            sql += ` AND reporting_period_end <= $${paramIndex++}`;
            params.push(endDate);
        }
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        sql += ` ORDER BY reporting_period_start DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('ISSB S2 reports fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch ISSB S2 reports' });
    }
});

// ============================================
// TNFD Routes
// ============================================

/**
 * Generate TNFD report
 * POST /api/compliance/tnfd/reports
 */
router.post('/tnfd/reports', requireAuth, requireRole(['COMPLIANCE_OFFICER', 'ADMIN']), async (req: Request, res: Response) => {
    try {
        const { entityId, reportingPeriod } = req.body;
        
        if (!entityId || !reportingPeriod) {
            return res.status(400).json({ error: 'entityId and reportingPeriod are required' });
        }

        const report = await TNFDEngine.generateReport(entityId, reportingPeriod);
        res.status(201).json(report);
    } catch (error) {
        console.error('TNFD report generation error:', error);
        res.status(500).json({ error: 'Failed to generate TNFD report' });
    }
});

/**
 * Validate TNFD report
 * POST /api/compliance/tnfd/reports/:reportId/validate
 */
router.post('/tnfd/reports/:reportId/validate', requireAuth, async (req: Request, res: Response) => {
    try {
        const { reportId } = req.params;
        const validation = await TNFDEngine.validateReport(reportId);
        res.json(validation);
    } catch (error) {
        console.error('TNFD validation error:', error);
        res.status(500).json({ error: 'Failed to validate TNFD report' });
    }
});

/**
 * Get LEAP assessment framework
 * GET /api/compliance/tnfd/leap/:entityId
 */
router.get('/tnfd/leap/:entityId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { entityId } = req.params;
        const leap = TNFDEngine.performLEAPAssessment(entityId);
        res.json(leap);
    } catch (error) {
        console.error('LEAP assessment error:', error);
        res.status(500).json({ error: 'Failed to get LEAP assessment' });
    }
});

/**
 * Get TNFD reports for entity
 * GET /api/compliance/tnfd/reports/:entityId
 */
router.get('/tnfd/reports/:entityId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { entityId } = req.params;
        const { startDate, endDate, status, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM tnfd_reports WHERE entity_id = $1';
        const params: any[] = [entityId];
        let paramIndex = 2;
        
        if (startDate) {
            sql += ` AND reporting_period_start >= $${paramIndex++}`;
            params.push(startDate);
        }
        
        if (endDate) {
            sql += ` AND reporting_period_end <= $${paramIndex++}`;
            params.push(endDate);
        }
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        sql += ` ORDER BY reporting_period_start DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('TNFD reports fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch TNFD reports' });
    }
});

// ============================================
// Unified Compliance Routes
// ============================================

/**
 * Get supported compliance standards
 * GET /api/compliance/standards
 */
router.get('/standards', requireAuth, async (req: Request, res: Response) => {
    try {
        const standards = ComplianceEngineFactory.getSupportedStandards();
        const details = standards.map(s => ({
            standard: s,
            ...ComplianceEngineFactory.getStandardInfo(s),
        }));
        res.json(details);
    } catch (error) {
        console.error('Standards fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch compliance standards' });
    }
});

/**
 * Generate all applicable compliance reports for entity
 * POST /api/compliance/reports/generate-all
 */
router.post('/reports/generate-all', requireAuth, requireRole(['COMPLIANCE_OFFICER', 'ADMIN']), async (req: Request, res: Response) => {
    try {
        const { entityId, reportingPeriod } = req.body;
        
        if (!entityId || !reportingPeriod) {
            return res.status(400).json({ error: 'entityId and reportingPeriod are required' });
        }

        const results = await UnifiedComplianceReportGenerator.generateAllReports(entityId, reportingPeriod);
        res.json(results);
    } catch (error) {
        console.error('Unified compliance generation error:', error);
        res.status(500).json({ error: 'Failed to generate compliance reports' });
    }
});

/**
 * Get entity compliance dashboard
 * GET /api/compliance/dashboard/:entityId
 */
router.get('/dashboard/:entityId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { entityId } = req.params;
        const { year } = req.query;
        const targetYear = year ? parseInt(year as string) : new Date().getFullYear();
        
        // Fetch compliance status across all standards
        const [
            cbamStatus,
            secReports,
            issbReports,
            tnfdReports,
        ] = await Promise.all([
            // CBAM
            query(
                `SELECT * FROM cbam_reports WHERE declarant_id = $1 AND EXTRACT(YEAR FROM reporting_period_start) = $2 ORDER BY reporting_period_start`,
                [entityId, targetYear]
            ).catch(() => ({ rows: [] })),
            
            // SEC Climate
            query(
                `SELECT * FROM sec_climate_reports WHERE company_id = $1 AND fiscal_year = $2 ORDER BY created_at DESC`,
                [entityId, targetYear]
            ).catch(() => ({ rows: [] })),
            
            // ISSB S2
            query(
                `SELECT * FROM issb_s2_reports WHERE entity_id = $1 AND EXTRACT(YEAR FROM reporting_period_start) = $2 ORDER BY reporting_period_start`,
                [entityId, targetYear]
            ).catch(() => ({ rows: [] })),
            
            // TNFD
            query(
                `SELECT * FROM tnfd_reports WHERE entity_id = $1 AND EXTRACT(YEAR FROM reporting_period_start) = $2 ORDER BY reporting_period_start`,
                [entityId, targetYear]
            ).catch(() => ({ rows: [] })),
        ]);
        
        res.json({
            entityId,
            year: targetYear,
            cbam: {
                reportsCount: cbamStatus.rows.length,
                latestStatus: cbamStatus.rows[0]?.status || 'NOT_STARTED',
                totalEmissions: cbamStatus.rows.reduce((sum, r) => sum + parseFloat(r.total_embedded_emissions || '0'), 0),
            },
            secClimate: {
                reportsCount: secReports.rows.length,
                latestStatus: secReports.rows[0]?.status || 'NOT_STARTED',
            },
            issbS2: {
                reportsCount: issbReports.rows.length,
                latestStatus: issbReports.rows[0]?.status || 'NOT_STARTED',
            },
            tnfd: {
                reportsCount: tnfdReports.rows.length,
                latestStatus: tnfdReports.rows[0]?.status || 'NOT_STARTED',
            },
            overallCompliance: {
                standardsApplicable: [
                    ...(cbamStatus.rows.length > 0 ? ['CBAM'] : []),
                    ...(secReports.rows.length > 0 ? ['SEC_CLIMATE'] : []),
                    ...(issbReports.rows.length > 0 ? ['ISSB_S2'] : []),
                    ...(tnfdReports.rows.length > 0 ? ['TNFD'] : []),
                ],
                reportsCompleted: [
                    ...cbamStatus.rows.filter(r => r.status === 'VALIDATED' || r.status === 'SUBMITTED').length,
                    ...secReports.rows.filter(r => r.status === 'FILED').length,
                    ...issbReports.rows.filter(r => r.status === 'PUBLISHED').length,
                    ...tnfdReports.rows.filter(r => r.status === 'PUBLISHED').length,
                ].reduce((a, b) => a + b, 0),
            },
        });
    } catch (error) {
        console.error('Compliance dashboard error:', error);
        res.status(500).json({ error: 'Failed to fetch compliance dashboard' });
    }
});

export default router;