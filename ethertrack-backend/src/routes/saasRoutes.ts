// White-label SaaS Platform API Routes
// Multi-tenancy, SSO/SCIM, RBAC, audit logs, API gateway endpoints

import { Router, Request, Response } from 'express';
import { WhiteLabelSaaSService } from '../services/saas/whiteLabelSaaS.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { query } from '../db/pool.js';

const router = Router();

// ============================================
// Tenant Management
// ============================================

/**
 * Create new tenant
 * POST /api/saas/tenants
 */
router.post('/tenants', requireAuth, requireRole(['SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const tenant = req.body;
        
        const required = ['name', 'displayName', 'emailFromName', 'emailFromAddress', 'supportEmail', 'plan'];
        for (const field of required) {
            if (!tenant[field]) {
                return res.status(400).json({ error: `Missing required field: ${field}` });
            }
        }
        
        const created = await WhiteLabelSaaSService.createTenant({
            ...tenant,
            status: tenant.status || 'TRIAL',
            billingCycle: tenant.billingCycle || 'MONTHLY',
            maxUsers: tenant.maxUsers || 10,
            maxProjects: tenant.maxProjects || 50,
            maxApiCalls: tenant.maxApiCalls || 100000,
            storageLimitGb: tenant.storageLimitGb || 10,
            features: tenant.features || {},
            settings: tenant.settings || {}
        });
        
        res.status(201).json(created);
    } catch (error) {
        console.error('Tenant creation error:', error);
        res.status(500).json({ error: 'Failed to create tenant' });
    }
});

/**
 * Get tenant by ID
 * GET /api/saas/tenants/:tenantId
 */
router.get('/tenants/:tenantId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        
        // Check permission - user can only access their own tenant unless super admin
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const tenant = await WhiteLabelSaaSService.getTenant(tenantId);
        
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        
        res.json(tenant);
    } catch (error) {
        console.error('Tenant fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch tenant' });
    }
});

/**
 * Get tenant by subdomain (public endpoint for subdomain routing)
 * GET /api/saas/tenants/subdomain/:subdomain
 */
router.get('/tenants/subdomain/:subdomain', async (req: Request, res: Response) => {
    try {
        const { subdomain } = req.params;
        const tenant = await WhiteLabelSaaSService.getTenantBySubdomain(subdomain);
        
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        
        // Return public info only
        res.json({
            tenantId: tenant.tenantId,
            name: tenant.name,
            displayName: tenant.displayName,
            subdomain: tenant.subdomain,
            domain: tenant.domain,
            logoUrl: tenant.logoUrl,
            primaryColor: tenant.primaryColor,
            secondaryColor: tenant.secondaryColor,
            faviconUrl: tenant.faviconUrl,
            status: tenant.status,
            plan: tenant.plan
        });
    } catch (error) {
        console.error('Tenant by subdomain fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch tenant' });
    }
});

/**
 * Update tenant
 * PUT /api/saas/tenants/:tenantId
 */
router.put('/tenants/:tenantId', requireAuth, requireRole(['TENANT_ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const tenant = await WhiteLabelSaaSService.updateTenant(tenantId, req.body);
        
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        
        res.json(tenant);
    } catch (error) {
        console.error('Tenant update error:', error);
        res.status(500).json({ error: 'Failed to update tenant' });
    }
});

/**
 * List all tenants (super admin only)
 * GET /api/saas/tenants
 */
router.get('/tenants', requireAuth, requireRole(['SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const { status, plan, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM tenants WHERE 1=1';
        const params: any[] = [];
        let paramIndex = 1;
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        if (plan) {
            sql += ` AND plan = $${paramIndex++}`;
            params.push(plan);
        }
        
        sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Tenants list error:', error);
        res.status(500).json({ error: 'Failed to list tenants' });
    }
});

/**
 * Get tenant dashboard
 * GET /api/saas/tenants/:tenantId/dashboard
 */
router.get('/tenants/:tenantId/dashboard', requireAuth, async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const { rows } = await query('SELECT * FROM tenant_dashboard WHERE tenant_id = $1', [tenantId]);
        
        if (!rows.length) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('Tenant dashboard error:', error);
        res.status(500).json({ error: 'Failed to fetch tenant dashboard' });
    }
});

// ============================================
// User Management
// ============================================

/**
 * Invite user to tenant
 * POST /api/saas/tenants/:tenantId/users/invite
 */
router.post('/tenants/:tenantId/users/invite', requireAuth, requireRole(['TENANT_ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        const { email, roles, firstName, lastName } = req.body;
        
        if (!email || !roles?.length) {
            return res.status(400).json({ error: 'Email and roles are required' });
        }
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const user = await WhiteLabelSaaSService.inviteUser(tenantId, email, roles, req.user.id);
        res.status(201).json(user);
    } catch (error) {
        console.error('User invitation error:', error);
        res.status(500).json({ error: 'Failed to invite user' });
    }
});

/**
 * Get tenant users
 * GET /api/saas/tenants/:tenantId/users
 */
router.get('/tenants/:tenantId/users', requireAuth, async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        const { status, limit = 50, offset = 0 } = req.query;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        let sql = 'SELECT user_id, tenant_id, email, first_name, last_name, status, roles, groups, mfa_enabled, last_login_at, created_at FROM tenant_users WHERE tenant_id = $1';
        const params: any[] = [tenantId];
        let paramIndex = 2;
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Tenant users fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch tenant users' });
    }
});

/**
 * Update user
 * PUT /api/saas/tenants/:tenantId/users/:userId
 */
router.put('/tenants/:tenantId/users/:userId', requireAuth, requireRole(['TENANT_ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const { tenantId, userId } = req.params;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const updates = req.body;
        delete updates.userId;
        delete updates.tenantId;
        delete updates.createdAt;
        
        const { rows } = await query(
            `UPDATE tenant_users SET 
                email = COALESCE($1, email),
                first_name = COALESCE($2, first_name),
                last_name = COALESCE($3, last_name),
                phone = COALESCE($4, phone),
                avatar_url = COALESCE($5, avatar_url),
                status = COALESCE($6, status),
                roles = COALESCE($7, roles),
                groups = COALESCE($8, groups),
                mfa_enabled = COALESCE($9, mfa_enabled),
                updated_at = NOW()
             WHERE user_id = $10 AND tenant_id = $11
             RETURNING *`,
            [
                updates.email, updates.firstName, updates.lastName, updates.phone,
                updates.avatarUrl, updates.status, updates.roles ? JSON.stringify(updates.roles) : null,
                updates.groups ? JSON.stringify(updates.groups) : null, updates.mfaEnabled,
                userId, tenantId
            ]
        );
        
        if (!rows.length) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('User update error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// ============================================
// Role Management
// ============================================

/**
 * Create role
 * POST /api/saas/tenants/:tenantId/roles
 */
router.post('/tenants/:tenantId/roles', requireAuth, requireRole(['TENANT_ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        const role = req.body;
        
        if (!role.name || !role.displayName || !role.permissions) {
            return res.status(400).json({ error: 'name, displayName, and permissions are required' });
        }
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const created = await WhiteLabelSaaSService.createRole({
            ...role,
            tenantId,
            isSystem: false
        });
        
        res.status(201).json(created);
    } catch (error) {
        console.error('Role creation error:', error);
        res.status(500).json({ error: 'Failed to create role' });
    }
});

/**
 * Get tenant roles
 * GET /api/saas/tenants/:tenantId/roles
 */
router.get('/tenants/:tenantId/roles', requireAuth, async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const { rows } = await query('SELECT * FROM tenant_roles WHERE tenant_id = $1 ORDER BY is_system DESC, name', [tenantId]);
        res.json(rows);
    } catch (error) {
        console.error('Roles fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch roles' });
    }
});

// ============================================
// API Key Management
// ============================================

/**
 * Create API key
 * POST /api/saas/tenants/:tenantId/api-keys
 */
router.post('/tenants/:tenantId/api-keys', requireAuth, requireRole(['TENANT_ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        const apiKey = req.body;
        
        if (!apiKey.name) {
            return res.status(400).json({ error: 'name is required' });
        }
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const { apiKey: created, rawKey } = await WhiteLabelSaaSService.createApiKey({
            ...apiKey,
            tenantId,
            rateLimit: apiKey.rateLimit || 60,
            ipWhitelist: apiKey.ipWhitelist || [],
            expiresAt: apiKey.expiresAt,
            createdBy: req.user.id
        });
        
        // Return raw key only once
        res.status(201).json({
            ...created,
            rawKey: rawKey // Only shown once!
        });
    } catch (error) {
        console.error('API key creation error:', error);
        res.status(500).json({ error: 'Failed to create API key' });
    }
});

/**
 * Get API keys
 * GET /api/saas/tenants/:tenantId/api-keys
 */
router.get('/tenants/:tenantId/api-keys', requireAuth, async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const { rows } = await query(
            'SELECT api_key_id, tenant_id, name, key_prefix, permissions, rate_limit, ip_whitelist, expires_at, last_used_at, status, created_by, created_at FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC',
            [tenantId]
        );
        
        res.json(rows);
    } catch (error) {
        console.error('API keys fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch API keys' });
    }
});

/**
 * Revoke API key
 * DELETE /api/saas/tenants/:tenantId/api-keys/:keyId
 */
router.delete('/tenants/:tenantId/api-keys/:keyId', requireAuth, requireRole(['TENANT_ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const { tenantId, keyId } = req.params;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        await query(
            'UPDATE api_keys SET status = $1, updated_at = NOW() WHERE api_key_id = $2 AND tenant_id = $3',
            ['REVOKED', keyId, tenantId]
        );
        
        res.json({ success: true, message: 'API key revoked' });
    } catch (error) {
        console.error('API key revocation error:', error);
        res.status(500).json({ error: 'Failed to revoke API key' });
    }
});

// ============================================
// SSO Configuration
// ============================================

/**
 * Configure SSO
 * POST /api/saas/tenants/:tenantId/sso
 */
router.post('/tenants/:tenantId/sso', requireAuth, requireRole(['TENANT_ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        const sso = req.body;
        
        if (!sso.provider || !sso.name || !sso.config || !sso.attributeMapping) {
            return res.status(400).json({ error: 'provider, name, config, and attributeMapping are required' });
        }
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const created = await WhiteLabelSaaSService.configureSSO({
            ...sso,
            tenantId,
            enabled: sso.enabled || false,
            justInTimeProvisioning: sso.justInTimeProvisioning ?? true,
            defaultRole: sso.defaultRole,
            defaultGroups: sso.defaultGroups || []
        });
        
        res.status(201).json(created);
    } catch (error) {
        console.error('SSO configuration error:', error);
        res.status(500).json({ error: 'Failed to configure SSO' });
    }
});

/**
 * Get SSO config
 * GET /api/saas/tenants/:tenantId/sso
 */
router.get('/tenants/:tenantId/sso', requireAuth, async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const { rows } = await query('SELECT * FROM sso_configs WHERE tenant_id = $1', [tenantId]);
        res.json(rows);
    } catch (error) {
        console.error('SSO config fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch SSO config' });
    }
});

// ============================================
// SCIM Configuration
// ============================================

/**
 * Configure SCIM
 * POST /api/saas/tenants/:tenantId/scim
 */
router.post('/tenants/:tenantId/scim', requireAuth, requireRole(['TENANT_ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        const scim = req.body;
        
        if (!scim.baseUrl || !scim.bearerToken) {
            return res.status(400).json({ error: 'baseUrl and bearerToken are required' });
        }
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const created = await WhiteLabelSaaSService.configureSCIM({
            ...scim,
            tenantId,
            enabled: scim.enabled || false,
            schemas: scim.schemas || ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:ietf:params:scim:schemas:core:2.0:Group"],
            userProvisioning: scim.userProvisioning ?? true,
            groupProvisioning: scim.groupProvisioning ?? true
        });
        
        res.status(201).json(created);
    } catch (error) {
        console.error('SCIM configuration error:', error);
        res.status(500).json({ error: 'Failed to configure SCIM' });
    }
});

// ============================================
// Custom Domains
// ============================================

/**
 * Add custom domain
 * POST /api/saas/tenants/:tenantId/domains
 */
router.post('/tenants/:tenantId/domains', requireAuth, requireRole(['TENANT_ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        const { domain, sslEnabled } = req.body;
        
        if (!domain) {
            return res.status(400).json({ error: 'domain is required' });
        }
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Check if domain already exists
        const { rows: existing } = await query('SELECT * FROM custom_domains WHERE domain = $1', [domain]);
        if (existing.length) {
            return res.status(409).json({ error: 'Domain already in use' });
        }
        
        const created = await WhiteLabelSaaSService.addCustomDomain({
            tenantId,
            domain,
            sslEnabled: sslEnabled !== false
        });
        
        res.status(201).json(created);
    } catch (error) {
        console.error('Custom domain creation error:', error);
        res.status(500).json({ error: 'Failed to add custom domain' });
    }
});

/**
 * Verify custom domain
 * POST /api/saas/tenants/:tenantId/domains/:domainId/verify
 */
router.post('/tenants/:tenantId/domains/:domainId/verify', requireAuth, requireRole(['TENANT_ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const { tenantId, domainId } = req.params;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const verified = await WhiteLabelSaaSService.verifyCustomDomain(domainId);
        
        if (!verified) {
            return res.status(404).json({ error: 'Domain not found' });
        }
        
        res.json(verified);
    } catch (error) {
        console.error('Domain verification error:', error);
        res.status(500).json({ error: 'Failed to verify domain' });
    }
});

/**
 * Get custom domains
 * GET /api/saas/tenants/:tenantId/domains
 */
router.get('/tenants/:tenantId/domains', requireAuth, async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const { rows } = await query('SELECT * FROM custom_domains WHERE tenant_id = $1 ORDER BY created_at DESC', [tenantId]);
        res.json(rows);
    } catch (error) {
        console.error('Custom domains fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch custom domains' });
    }
});

// ============================================
// Webhooks
// ============================================

/**
 * Create webhook
 * POST /api/saas/tenants/:tenantId/webhooks
 */
router.post('/tenants/:tenantId/webhooks', requireAuth, requireRole(['TENANT_ADMIN', 'SUPER_ADMIN']), async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        const webhook = req.body;
        
        if (!webhook.name || !webhook.url || !webhook.events?.length) {
            return res.status(400).json({ error: 'name, url, and events are required' });
        }
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const { webhook: created, secret } = await WhiteLabelSaaSService.createWebhook({
            ...webhook,
            tenantId,
            headers: webhook.headers || {},
            retryPolicy: webhook.retryPolicy || {},
            createdBy: req.user.id
        });
        
        // Return secret only once
        res.status(201).json({
            ...created,
            secret // Only shown once!
        });
    } catch (error) {
        console.error('Webhook creation error:', error);
        res.status(500).json({ error: 'Failed to create webhook' });
    }
});

/**
 * Get webhooks
 * GET /api/saas/tenants/:tenantId/webhooks
 */
router.get('/tenants/:tenantId/webhooks', requireAuth, async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const { rows } = await query(
            'SELECT webhook_id, tenant_id, name, url, events, headers, retry_policy, status, last_triggered_at, failure_count, created_by, created_at FROM webhooks WHERE tenant_id = $1 ORDER BY created_at DESC',
            [tenantId]
        );
        
        res.json(rows);
    } catch (error) {
        console.error('Webhooks fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch webhooks' });
    }
});

/**
 * Get webhook deliveries
 * GET /api/saas/tenants/:tenantId/webhooks/:webhookId/deliveries
 */
router.get('/tenants/:tenantId/webhooks/:webhookId/deliveries', requireAuth, async (req: Request, res: Response) => {
    try {
        const { tenantId, webhookId } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const { rows } = await query(
            'SELECT * FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
            [webhookId, parseInt(limit as string), parseInt(offset as string)]
        );
        
        res.json(rows);
    } catch (error) {
        console.error('Webhook deliveries fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch webhook deliveries' });
    }
});

// ============================================
// Audit Logs
// ============================================

/**
 * Get audit logs
 * GET /api/saas/tenants/:tenantId/audit-logs
 */
router.get('/tenants/:tenantId/audit-logs', requireAuth, requireRole(['TENANT_ADMIN', 'SUPER_ADMIN', 'AUDITOR']), async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        const { userId, action, resource, resourceId, startDate, endDate, status, limit = 100, offset = 0 } = req.query;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        let sql = 'SELECT * FROM audit_logs WHERE tenant_id = $1';
        const params: any[] = [tenantId];
        let paramIndex = 2;
        
        if (userId) {
            sql += ` AND user_id = $${paramIndex++}`;
            params.push(userId);
        }
        
        if (action) {
            sql += ` AND action = $${paramIndex++}`;
            params.push(action);
        }
        
        if (resource) {
            sql += ` AND resource = $${paramIndex++}`;
            params.push(resource);
        }
        
        if (resourceId) {
            sql += ` AND resource_id = $${paramIndex++}`;
            params.push(resourceId);
        }
        
        if (startDate) {
            sql += ` AND created_at >= $${paramIndex++}`;
            params.push(startDate);
        }
        
        if (endDate) {
            sql += ` AND created_at <= $${paramIndex++}`;
            params.push(endDate);
        }
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Audit logs fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

// ============================================
// Rate Limits
// ============================================

/**
 * Get rate limit config
 * GET /api/saas/tenants/:tenantId/rate-limits
 */
router.get('/tenants/:tenantId/rate-limits', requireAuth, async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const config = await WhiteLabelSaaSService.getRateLimitConfig(tenantId);
        res.json(config);
    } catch (error) {
        console.error('Rate limit config fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch rate limit config' });
    }
});

// ============================================
// Subscription/Billing
// ============================================

/**
 * Get tenant subscription
 * GET /api/saas/tenants/:tenantId/subscription
 */
router.get('/tenants/:tenantId/subscription', requireAuth, async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const { rows } = await query('SELECT * FROM tenant_subscriptions WHERE tenant_id = $1 AND status = $2', [tenantId, 'ACTIVE']);
        
        if (!rows.length) {
            return res.status(404).json({ error: 'No active subscription found' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('Subscription fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch subscription' });
    }
});

/**
 * Get usage metrics
 * GET /api/saas/tenants/:tenantId/usage
 */
router.get('/tenants/:tenantId/usage', requireAuth, async (req: Request, res: Response) => {
    try {
        const { tenantId } = req.params;
        const { startDate, endDate, limit = 30 } = req.query;
        
        if (req.user.tenantId !== tenantId && !req.user.roles?.includes('SUPER_ADMIN')) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        let sql = 'SELECT * FROM tenant_usage_metrics WHERE tenant_id = $1';
        const params: any[] = [tenantId];
        let paramIndex = 2;
        
        if (startDate) {
            sql += ` AND date >= $${paramIndex++}`;
            params.push(startDate);
        }
        
        if (endDate) {
            sql += ` AND date <= $${paramIndex++}`;
            params.push(endDate);
        }
        
        sql += ` ORDER BY date DESC LIMIT $${paramIndex++}`;
        params.push(parseInt(limit as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Usage metrics fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch usage metrics' });
    }
});

export default router;