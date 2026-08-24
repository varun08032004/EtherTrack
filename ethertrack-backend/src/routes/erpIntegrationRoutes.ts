// ERP Integration API Routes
// Enterprise ERP/Accounting system integration endpoints

import { Router, Request, Response } from 'express';
import { ERPIntegrationService } from '../services/integrations/erpIntegrationService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { query } from '../db/pool.js';

const router = Router();

// ============================================
// ERP Connector Management
// ============================================

/**
 * Register new ERP connector
 * POST /api/integrations/erp/connectors
 */
router.post('/connectors', requireAuth, requireRole(['ADMIN', 'INTEGRATION_MANAGER']), async (req: Request, res: Response) => {
    try {
        const config = req.body;
        
        // Validate required fields
        if (!config.connectorId || !config.entityId || !config.erpType || !config.name || !config.credentials || !config.syncConfig) {
            return res.status(400).json({ 
                error: 'Missing required fields: connectorId, entityId, erpType, name, credentials, syncConfig' 
            });
        }
        
        // Validate ERP type
        const validTypes = ['SAP', 'ORACLE', 'NETSUITE', 'TALLY', 'ZOHO', 'QUICKBOOKS', 'XERO', 'SAGE', 'CUSTOM'];
        if (!validTypes.includes(config.erpType)) {
            return res.status(400).json({ error: `Invalid ERP type. Must be one of: ${validTypes.join(', ')}` });
        }
        
        const connector = await ERPIntegrationService.registerConnector(config);
        res.status(201).json(connector);
    } catch (error) {
        console.error('ERP connector registration error:', error);
        res.status(500).json({ error: 'Failed to register ERP connector' });
    }
});

/**
 * Get ERP connector
 * GET /api/integrations/erp/connectors/:connectorId
 */
router.get('/connectors/:connectorId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { connectorId } = req.params;
        const connector = await ERPIntegrationService.getConnector(connectorId);
        
        if (!connector) {
            return res.status(404).json({ error: 'Connector not found' });
        }
        
        // Don't return credentials in response
        const { credentials, ...safeConnector } = connector;
        res.json({ ...safeConnector, credentials: { configured: !!credentials } });
    } catch (error) {
        console.error('ERP connector fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch ERP connector' });
    }
});

/**
 * List ERP connectors for entity
 * GET /api/integrations/erp/connectors
 */
router.get('/connectors', requireAuth, async (req: Request, res: Response) => {
    try {
        const { entityId } = req.query;
        
        if (!entityId) {
            return res.status(400).json({ error: 'entityId query parameter required' });
        }
        
        const connectors = await ERPIntegrationService.listConnectors(entityId as string);
        
        // Don't return credentials
        const safeConnectors = connectors.map(({ credentials, ...c }) => ({ 
            ...c, 
            credentials: { configured: !!credentials } 
        }));
        
        res.json(safeConnectors);
    } catch (error) {
        console.error('ERP connectors list error:', error);
        res.status(500).json({ error: 'Failed to list ERP connectors' });
    }
});

/**
 * Update ERP connector
 * PUT /api/integrations/erp/connectors/:connectorId
 */
router.put('/connectors/:connectorId', requireAuth, requireRole(['ADMIN', 'INTEGRATION_MANAGER']), async (req: Request, res: Response) => {
    try {
        const { connectorId } = req.params;
        const updates = req.body;
        
        // Get existing connector
        const existing = await ERPIntegrationService.getConnector(connectorId);
        if (!existing) {
            return res.status(404).json({ error: 'Connector not found' });
        }
        
        // Merge updates
        const updated = { ...existing, ...updates, connectorId };
        
        // Re-register with updates
        const connector = await ERPIntegrationService.registerConnector(updated);
        const { credentials, ...safeConnector } = connector;
        
        res.json({ ...safeConnector, credentials: { configured: !!credentials } });
    } catch (error) {
        console.error('ERP connector update error:', error);
        res.status(500).json({ error: 'Failed to update ERP connector' });
    }
});

/**
 * Delete ERP connector
 * DELETE /api/integrations/erp/connectors/:connectorId
 */
router.delete('/connectors/:connectorId', requireAuth, requireRole(['ADMIN']), async (req: Request, res: Response) => {
    try {
        const { connectorId } = req.params;
        
        await query('DELETE FROM erp_connectors WHERE connector_id = $1', [connectorId]);
        res.json({ success: true, message: 'Connector deleted' });
    } catch (error) {
        console.error('ERP connector deletion error:', error);
        res.status(500).json({ error: 'Failed to delete ERP connector' });
    }
});

// ============================================
// Connection Testing
// ============================================

/**
 * Test ERP connection
 * POST /api/integrations/erp/connectors/:connectorId/test
 */
router.post('/connectors/:connectorId/test', requireAuth, requireRole(['ADMIN', 'INTEGRATION_MANAGER']), async (req: Request, res: Response) => {
    try {
        const { connectorId } = req.params;
        const result = await ERPIntegrationService.testConnection(connectorId);
        res.json(result);
    } catch (error) {
        console.error('ERP connection test error:', error);
        res.status(500).json({ error: 'Connection test failed' });
    }
});

// ============================================
// Sync Operations
// ============================================

/**
 * Execute full sync
 * POST /api/integrations/erp/connectors/:connectorId/sync
 */
router.post('/connectors/:connectorId/sync', requireAuth, requireRole(['ADMIN', 'INTEGRATION_MANAGER']), async (req: Request, res: Response) => {
    try {
        const { connectorId } = req.params;
        const { fullSync, entityTypes } = req.body;
        
        const result = await ERPIntegrationService.executeSync(connectorId, { fullSync, entityTypes });
        res.json(result);
    } catch (error) {
        console.error('ERP sync execution error:', error);
        res.status(500).json({ error: 'Sync execution failed' });
    }
});

/**
 * Sync specific entity type
 * POST /api/integrations/erp/connectors/:connectorId/sync/:entityType
 */
router.post('/connectors/:connectorId/sync/:entityType', requireAuth, requireRole(['ADMIN', 'INTEGRATION_MANAGER']), async (req: Request, res: Response) => {
    try {
        const { connectorId, entityType } = req.params;
        
        let result;
        switch (entityType) {
            case 'chart-of-accounts':
                result = await ERPIntegrationService.syncChartOfAccounts(connectorId);
                break;
            case 'cost-centers':
                result = await ERPIntegrationService.syncCostCenters(connectorId);
                break;
            case 'journal-entries': {
                const { dateRange } = req.body;
                result = await ERPIntegrationService.syncJournalEntries(connectorId, dateRange);
                break;
            }
            default:
                return res.status(400).json({ error: `Unknown entity type: ${entityType}` });
        }
        
        res.json({ success: true, entityType, count: result.length, data: result });
    } catch (error) {
        console.error(`ERP ${req.params.entityType} sync error:`, error);
        res.status(500).json({ error: `Failed to sync ${req.params.entityType}` });
    }
});

/**
 * Get sync history
 * GET /api/integrations/erp/connectors/:connectorId/sync-history
 */
router.get('/connectors/:connectorId/sync-history', requireAuth, async (req: Request, res: Response) => {
    try {
        const { connectorId } = req.params;
        const { limit = 50 } = req.query;
        
        const history = await ERPIntegrationService.getSyncHistory(connectorId, parseInt(limit as string));
        res.json(history);
    } catch (error) {
        console.error('ERP sync history error:', error);
        res.status(500).json({ error: 'Failed to fetch sync history' });
    }
});

// ============================================
// Carbon Data Push
// ============================================

/**
 * Push carbon data to ERP
 * POST /api/integrations/erp/connectors/:connectorId/push-carbon
 */
router.post('/connectors/:connectorId/push-carbon', requireAuth, requireRole(['ADMIN', 'INTEGRATION_MANAGER', 'CARBON_ANALYST']), async (req: Request, res: Response) => {
    try {
        const { connectorId } = req.params;
        const carbonData = req.body;
        
        const result = await ERPIntegrationService.pushCarbonDataToERP(connectorId, carbonData);
        res.json(result);
    } catch (error) {
        console.error('ERP carbon data push error:', error);
        res.status(500).json({ error: 'Failed to push carbon data to ERP' });
    }
});

// ============================================
// Data Retrieval
// ============================================

/**
 * Get chart of accounts from ERP
 * GET /api/integrations/erp/connectors/:connectorId/chart-of-accounts
 */
router.get('/connectors/:connectorId/chart-of-accounts', requireAuth, async (req: Request, res: Response) => {
    try {
        const { connectorId } = req.params;
        const { carbonRelated } = req.query;
        
        let sql = 'SELECT * FROM erp_chart_of_accounts WHERE connector_id = $1';
        const params: any[] = [connectorId];
        
        if (carbonRelated !== undefined) {
            sql += ' AND carbon_related = $2';
            params.push(carbonRelated === 'true');
        }
        
        sql += ' ORDER BY account_code';
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('ERP chart of accounts fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch chart of accounts' });
    }
});

/**
 * Get cost centers with carbon budgets
 * GET /api/integrations/erp/connectors/:connectorId/cost-centers
 */
router.get('/connectors/:connectorId/cost-centers', requireAuth, async (req: Request, res: Response) => {
    try {
        const { connectorId } = req.params;
        
        const { rows } = await query(
            `SELECT * FROM erp_cost_centers WHERE connector_id = $1 ORDER BY cost_center_code`,
            [connectorId]
        );
        
        // Calculate variance
        const enriched = rows.map(row => ({
            ...row,
            carbonVariance: row.carbon_budget && row.actual_emissions ? 
                row.carbon_budget - row.actual_emissions : null,
            carbonUtilization: row.carbon_budget && row.actual_emissions ? 
                (row.actual_emissions / row.carbon_budget) * 100 : null,
        }));
        
        res.json(enriched);
    } catch (error) {
        console.error('ERP cost centers fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch cost centers' });
    }
});

/**
 * Get journal entries with carbon data
 * GET /api/integrations/erp/connectors/:connectorId/journal-entries
 */
router.get('/connectors/:connectorId/journal-entries', requireAuth, async (req: Request, res: Response) => {
    try {
        const { connectorId } = req.params;
        const { startDate, endDate, carbonRelated, limit = 100, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM erp_journal_entries WHERE connector_id = $1';
        const params: any[] = [connectorId];
        let paramIndex = 2;
        
        if (startDate) {
            sql += ` AND entry_date >= $${paramIndex++}`;
            params.push(startDate);
        }
        
        if (endDate) {
            sql += ` AND entry_date <= $${paramIndex++}`;
            params.push(endDate);
        }
        
        if (carbonRelated !== undefined) {
            sql += ` AND carbon_related = $${paramIndex++}`;
            params.push(carbonRelated === 'true');
        }
        
        sql += ` ORDER BY entry_date DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        
        // Parse JSON fields
        const enriched = rows.map(row => ({
            ...row,
            lines: typeof row.lines === 'string' ? JSON.parse(row.lines) : row.lines,
            emission_data: row.emission_data ? (typeof row.emission_data === 'string' ? JSON.parse(row.emission_data) : row.emission_data) : null,
        }));
        
        res.json(enriched);
    } catch (error) {
        console.error('ERP journal entries fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch journal entries' });
    }
});

/**
 * Get carbon emissions from ERP data
 * GET /api/integrations/erp/connectors/:connectorId/emissions
 */
router.get('/connectors/:connectorId/emissions', requireAuth, async (req: Request, res: Response) => {
    try {
        const { connectorId } = req.params;
        const { startDate, endDate, scope, category } = req.query;
        
        let sql = `
            SELECT 
                je.entry_date,
                je.entry_number,
                je.description,
                je.emission_data,
                je.cost_center_code,
                je.project_code,
                SUM(je.total_debit) as amount
            FROM erp_journal_entries je
            WHERE je.connector_id = $1 
            AND je.carbon_related = true
            AND je.emission_data IS NOT NULL
        `;
        const params: any[] = [connectorId];
        let paramIndex = 2;
        
        if (startDate) {
            sql += ` AND je.entry_date >= $${paramIndex++}`;
            params.push(startDate);
        }
        
        if (endDate) {
            sql += ` AND je.entry_date <= $${paramIndex++}`;
            params.push(endDate);
        }
        
        if (scope) {
            sql += ` AND je.emission_data->>'scope' = $${paramIndex++}`;
            params.push(scope);
        }
        
        if (category) {
            sql += ` AND je.emission_data->>'category' = $${paramIndex++}`;
            params.push(category);
        }
        
        sql += ` GROUP BY je.entry_date, je.entry_number, je.description, je.emission_data, je.cost_center_code, je.project_code ORDER BY je.entry_date DESC`;
        
        const { rows } = await query(sql, params);
        
        // Aggregate by scope/category
        const summary = rows.reduce((acc, row) => {
            const ed = typeof row.emission_data === 'string' ? JSON.parse(row.emission_data) : row.emission_data;
            const key = `${ed.scope}-${ed.category}`;
            if (!acc[key]) {
                acc[key] = { scope: ed.scope, category: ed.category, totalEmissions: 0, entries: 0 };
            }
            acc[key].totalEmissions += parseFloat(ed.emissions || '0');
            acc[key].entries += 1;
            return acc;
        }, {} as Record<string, any>);
        
        res.json({
            details: rows,
            summary: Object.values(summary),
            totalEmissions: Object.values(summary).reduce((sum: number, s: any) => sum + s.totalEmissions, 0),
        });
    } catch (error) {
        console.error('ERP emissions fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch emissions data' });
    }
});

// ============================================
// ERP Templates
// ============================================

/**
 * Get ERP connector templates
 * GET /api/integrations/erp/templates
 */
router.get('/templates', requireAuth, async (req: Request, res: Response) => {
    const templates = {
        SAP: {
            erpType: 'SAP',
            name: 'SAP S/4HANA / ECC',
            description: 'SAP ERP integration via RFC/BAPI',
            credentials: {
                sapHost: 'sap-host.example.com',
                sapClient: '100',
                sapUser: 'INTEGRATION_USER',
                sapPassword: '***',
                sapSystemNumber: '00',
                sapLanguage: 'EN',
            },
            syncConfig: {
                syncChartOfAccounts: true,
                syncCostCenters: true,
                syncProjects: true,
                syncVendors: true,
                syncCustomers: true,
                syncInvoices: true,
                syncJournalEntries: true,
                syncInventory: false,
                syncFixedAssets: false,
                syncEmissionFactors: true,
                syncActivityData: true,
                syncCarbonCredits: true,
                syncCarbonPrices: true,
                scheduleEnabled: true,
                scheduleCron: '0 2 * * *',
                timezone: 'UTC',
                fieldMappings: [
                    { sourceField: 'GL_ACCOUNT', targetField: 'accountCode', transformation: 'TRIM', required: true },
                    { sourceField: 'ACCOUNT_NAME', targetField: 'accountName', transformation: 'TRIM', required: true },
                ],
                maxRetries: 3,
                retryDelayMinutes: 5,
                notifyOnError: true,
                errorNotificationEmails: [],
            },
        },
        NETSUITE: {
            erpType: 'NETSUITE',
            name: 'Oracle NetSuite',
            description: 'NetSuite integration via SuiteTalk REST API',
            credentials: {
                netsuiteAccountId: '1234567',
                netsuiteConsumerKey: '***',
                netsuiteConsumerSecret: '***',
                netsuiteTokenId: '***',
                netsuiteTokenSecret: '***',
                netsuiteEnvironment: 'PRODUCTION',
            },
            syncConfig: {
                syncChartOfAccounts: true,
                syncCostCenters: true,
                syncProjects: true,
                syncVendors: true,
                syncCustomers: true,
                syncInvoices: true,
                syncJournalEntries: true,
                syncInventory: true,
                syncFixedAssets: true,
                syncEmissionFactors: true,
                syncActivityData: true,
                syncCarbonCredits: true,
                syncCarbonPrices: true,
                scheduleEnabled: true,
                scheduleCron: '0 3 * * *',
                timezone: 'America/New_York',
                fieldMappings: [],
                maxRetries: 3,
                retryDelayMinutes: 5,
                notifyOnError: true,
                errorNotificationEmails: [],
            },
        },
        ZOHO: {
            erpType: 'ZOHO',
            name: 'Zoho Books',
            description: 'Zoho Books integration via REST API',
            credentials: {
                zohoClientId: '***',
                zohoClientSecret: '***',
                zohoRefreshToken: '***',
                zohoOrganizationId: '***',
                zohoRegion: 'US',
            },
            syncConfig: {
                syncChartOfAccounts: true,
                syncCostCenters: false,
                syncProjects: true,
                syncVendors: true,
                syncCustomers: true,
                syncInvoices: true,
                syncJournalEntries: true,
                syncInventory: true,
                syncFixedAssets: false,
                syncEmissionFactors: true,
                syncActivityData: true,
                syncCarbonCredits: false,
                syncCarbonPrices: false,
                scheduleEnabled: true,
                scheduleCron: '0 4 * * *',
                timezone: 'UTC',
                fieldMappings: [],
                maxRetries: 3,
                retryDelayMinutes: 5,
                notifyOnError: true,
                errorNotificationEmails: [],
            },
        },
        TALLY: {
            erpType: 'TALLY',
            name: 'TallyPrime / Tally.ERP 9',
            description: 'Tally integration via Tally XML/HTTP API',
            credentials: {
                tallyHost: 'localhost',
                tallyPort: 9000,
                tallyCompanyName: 'My Company',
                tallyUser: 'admin',
                tallyPassword: '***',
            },
            syncConfig: {
                syncChartOfAccounts: true,
                syncCostCenters: true,
                syncProjects: false,
                syncVendors: true,
                syncCustomers: true,
                syncInvoices: true,
                syncJournalEntries: true,
                syncInventory: true,
                syncFixedAssets: false,
                syncEmissionFactors: false,
                syncActivityData: false,
                syncCarbonCredits: false,
                syncCarbonPrices: false,
                scheduleEnabled: true,
                scheduleCron: '0 5 * * *',
                timezone: 'Asia/Kolkata',
                fieldMappings: [],
                maxRetries: 3,
                retryDelayMinutes: 5,
                notifyOnError: true,
                errorNotificationEmails: [],
            },
        },
    };
    
    res.json(templates);
});

export default router;