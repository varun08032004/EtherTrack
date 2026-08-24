// White-label SaaS Platform - Multi-tenant Architecture
// Enterprise-grade multi-tenancy, SSO/SCIM, RBAC, audit logs, API gateway

import { safeQuery as query, withTransaction } from '../../db/pool.js';
import { createHash, randomBytes } from 'crypto';

export interface Tenant {
    tenantId: string;
    name: string;
    displayName: string;
    domain?: string; // Custom domain
    subdomain: string; // tenant.ethertrack.com
    logoUrl?: string;
    primaryColor: string;
    secondaryColor: string;
    faviconUrl?: string;
    emailFromName: string;
    emailFromAddress: string;
    supportEmail: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'EXPIRED' | 'PENDING_SETUP';
    plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' | 'CUSTOM';
    billingCycle: 'MONTHLY' | 'ANNUAL';
    trialEndsAt?: string;
    subscriptionEndsAt?: string;
    maxUsers: number;
    maxProjects: number;
    maxApiCalls: number; // per month
    storageLimitGb: number;
    features: TenantFeatures;
    settings: TenantSettings;
    createdAt: string;
    updatedAt: string;
}

export interface TenantFeatures {
    // Core features
    carbonAccounting: boolean;
    mrvWorkflow: boolean;
    marketplace: boolean;
    registrySync: boolean;
    reporting: boolean;
    apiAccess: boolean;
    
    // Advanced features
    advancedAnalytics: boolean;
    aiInsights: boolean;
    defiIntegration: boolean;
    satelliteMrv: boolean;
    complianceEngine: boolean;
    erpIntegration: boolean;
    
    // Enterprise features
    sso: boolean;
    scim: boolean;
    auditLogs: boolean;
    customDomain: boolean;
    whiteLabel: boolean;
    dedicatedSupport: boolean;
    sla: boolean;
}

export interface TenantSettings {
    // Localization
    defaultLanguage: string;
    supportedLanguages: string[];
    timezone: string;
    dateFormat: string;
    numberFormat: string;
    
    // Carbon settings
    defaultMethodology: string;
    emissionFactorLibrary: string;
    autoCalculateEmissions: boolean;
    requireVerification: boolean;
    
    // Notification settings
    emailNotifications: boolean;
    webhookNotifications: boolean;
    smsNotifications: boolean;
    pushNotifications: boolean;
    
    // Security settings
    passwordPolicy: PasswordPolicy;
    sessionTimeoutMinutes: number;
    mfaRequired: boolean;
    ipWhitelist: string[];
    
    // Data retention
    dataRetentionYears: number;
    autoArchive: boolean;
    exportFormat: string[];
}

export interface PasswordPolicy {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSymbols: boolean;
    maxAgeDays: number;
    historyCount: number;
    lockoutThreshold: number;
    lockoutDurationMinutes: number;
}

export interface TenantUser {
    userId: string;
    tenantId: string;
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    avatarUrl?: string;
    status: 'ACTIVE' | 'INACTIVE' | 'PENDING_INVITE' | 'SUSPENDED' | 'LOCKED';
    roles: string[]; // Role IDs
    groups: string[]; // Group IDs
    mfaEnabled: boolean;
    mfaSecret?: string;
    lastLoginAt?: string;
    lastLoginIp?: string;
    failedLoginAttempts: number;
    lockedUntil?: string;
    passwordChangedAt: string;
    emailVerified: boolean;
    phoneVerified: boolean;
    createdAt: string;
    updatedAt: string;
    invitedBy?: string;
    invitedAt?: string;
}

export interface Role {
    roleId: string;
    tenantId: string;
    name: string;
    displayName: string;
    description: string;
    permissions: Permission[];
    isSystem: boolean; // Cannot be deleted/modified
    createdAt: string;
    updatedAt: string;
}

export interface Permission {
    permissionId: string;
    resource: string; // e.g., 'projects', 'reports', 'marketplace', 'admin'
    action: string; // e.g., 'create', 'read', 'update', 'delete', 'export', 'approve'
    scope: 'OWN' | 'TEAM' | 'TENANT' | 'GLOBAL';
    conditions?: Record<string, any>;
}

export interface Group {
    groupId: string;
    tenantId: string;
    name: string;
    description: string;
    parentGroupId?: string;
    members: string[]; // User IDs
    roles: string[]; // Role IDs
    createdAt: string;
    updatedAt: string;
}

export interface ApiKey {
    apiKeyId: string;
    tenantId: string;
    name: string;
    keyPrefix: string; // First 8 chars for display
    keyHash: string; // Bcrypt hash
    permissions: string[]; // Permission IDs
    rateLimit: number; // requests per minute
    ipWhitelist: string[];
    expiresAt?: string;
    lastUsedAt?: string;
    status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}

export interface AuditLog {
    logId: string;
    tenantId: string;
    userId?: string;
    apiKeyId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    resourceType?: string;
    oldValues?: Record<string, any>;
    newValues?: Record<string, any>;
    ipAddress: string;
    userAgent: string;
    requestId: string;
    status: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
    errorMessage?: string;
    durationMs: number;
    metadata: Record<string, any>;
    createdAt: string;
}

export interface SSOConfig {
    ssoId: string;
    tenantId: string;
    provider: 'SAML2' | 'OIDC' | 'OAUTH2' | 'LDAP' | 'CUSTOM';
    name: string;
    enabled: boolean;
    config: SSOProviderConfig;
    attributeMapping: AttributeMapping;
    justInTimeProvisioning: boolean;
    defaultRole: string;
    defaultGroups: string[];
    createdAt: string;
    updatedAt: string;
}

export interface SSOProviderConfig {
    // SAML2
    entityId?: string;
    ssoUrl?: string;
    sloUrl?: string;
    x509Cert?: string;
    privateKey?: string;
    
    // OIDC/OAuth2
    clientId?: string;
    clientSecret?: string;
    issuer?: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    userinfoEndpoint?: string;
    jwksUri?: string;
    scopes?: string[];
    pkce?: boolean;
    
    // LDAP
    ldapUrl?: string;
    bindDn?: string;
    bindPassword?: string;
    searchBase?: string;
    searchFilter?: string;
    
    // Custom
    customConfig?: Record<string, any>;
}

export interface AttributeMapping {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
    groups?: string;
    roles?: string;
    department?: string;
    title?: string;
}

export interface SCIMConfig {
    scimId: string;
    tenantId: string;
    enabled: boolean;
    baseUrl: string;
    bearerToken: string;
    schemas: string[];
    userProvisioning: boolean;
    groupProvisioning: boolean;
    filter?: string;
    createdAt: string;
    updatedAt: string;
}

export interface CustomDomain {
    domainId: string;
    tenantId: string;
    domain: string;
    status: 'PENDING' | 'VERIFIED' | 'ACTIVE' | 'FAILED' | 'EXPIRED';
    verificationToken: string;
    verificationRecord: string;
    sslEnabled: boolean;
    sslCertificate?: string;
    sslPrivateKey?: string;
    sslExpiresAt?: string;
    cnameTarget: string;
    createdAt: string;
    updatedAt: string;
    verifiedAt?: string;
}

export interface Webhook {
    webhookId: string;
    tenantId: string;
    name: string;
    url: string;
    events: string[];
    secret: string;
    headers: Record<string, string>;
    retryPolicy: RetryPolicy;
    status: 'ACTIVE' | 'DISABLED' | 'FAILED';
    lastTriggeredAt?: string;
    failureCount: number;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}

export interface RetryPolicy {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    retryableStatusCodes: number[];
}

export interface RateLimitConfig {
    tenantId: string;
    apiCallsPerMinute: number;
    apiCallsPerHour: number;
    apiCallsPerDay: number;
    apiCallsPerMonth: number;
    burstAllowance: number;
    customLimits: Record<string, { limit: number; windowMs: number }>;
}

export class WhiteLabelSaaSService {
    /**
     * Create new tenant
     */
    static async createTenant(tenant: Omit<Tenant, 'tenantId' | 'createdAt' | 'updatedAt'>): Promise<Tenant> {
        const tenantId = `TNT-${Date.now()}-${randomBytes(6).toString('hex')}`;
        const subdomain = tenant.name.toLowerCase().replace(/[^a-z0-9]/g, '-') + `-${randomBytes(4).toString('hex')}`;
        
        const fullTenant: Tenant = {
            ...tenant,
            tenantId,
            subdomain,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO tenants 
             (tenant_id, name, display_name, domain, subdomain, logo_url, primary_color, secondary_color, favicon_url,
              email_from_name, email_from_address, support_email, status, plan, billing_cycle,
              trial_ends_at, subscription_ends_at, max_users, max_projects, max_api_calls, storage_limit_gb,
              features, settings, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW(), NOW())`,
            [
                tenantId, tenant.name, tenant.displayName, tenant.domain, subdomain,
                tenant.logoUrl, tenant.primaryColor, tenant.secondaryColor, tenant.faviconUrl,
                tenant.emailFromName, tenant.emailFromAddress, tenant.supportEmail,
                tenant.status, tenant.plan, tenant.billingCycle,
                tenant.trialEndsAt, tenant.subscriptionEndsAt,
                tenant.maxUsers, tenant.maxProjects, tenant.maxApiCalls, tenant.storageLimitGb,
                JSON.stringify(tenant.features), JSON.stringify(tenant.settings)
            ]
        );
        
        // Create default system roles
        await this.createDefaultRoles(tenantId);
        
        // Create default admin user
        // In production, would send invite email
        
        return fullTenant;
    }
    
    /**
     * Create default system roles for tenant
     */
    private static async createDefaultRoles(tenantId: string): Promise<void> {
        const defaultRoles = [
            {
                name: 'TENANT_ADMIN',
                displayName: 'Tenant Administrator',
                description: 'Full access to tenant settings and all resources',
                permissions: [
                    { resource: '*', action: '*', scope: 'TENANT' }
                ],
                isSystem: true
            },
            {
                name: 'PROJECT_MANAGER',
                displayName: 'Project Manager',
                description: 'Manage projects, MRV workflows, and team members',
                permissions: [
                    { resource: 'projects', action: '*', scope: 'TEAM' },
                    { resource: 'mrv', action: '*', scope: 'TEAM' },
                    { resource: 'reports', action: 'create,read,update,export', scope: 'TEAM' },
                    { resource: 'team', action: 'read,update', scope: 'TEAM' }
                ],
                isSystem: true
            },
            {
                name: 'CARBON_ANALYST',
                displayName: 'Carbon Analyst',
                description: 'Calculate emissions, generate reports, access analytics',
                permissions: [
                    { resource: 'projects', action: 'read', scope: 'TEAM' },
                    { resource: 'emissions', action: 'create,read,update', scope: 'TEAM' },
                    { resource: 'reports', action: 'create,read,export', scope: 'TEAM' },
                    { resource: 'analytics', action: 'read', scope: 'TEAM' }
                ],
                isSystem: true
            },
            {
                name: 'VERIFIER',
                displayName: 'Verifier',
                description: 'Verify MRV data and approve reports',
                permissions: [
                    { resource: 'mrv', action: 'read,approve', scope: 'TENANT' },
                    { resource: 'reports', action: 'read,approve', scope: 'TENANT' }
                ],
                isSystem: true
            },
            {
                name: 'VIEWER',
                displayName: 'Viewer',
                description: 'Read-only access to assigned projects and reports',
                permissions: [
                    { resource: 'projects', action: 'read', scope: 'OWN' },
                    { resource: 'reports', action: 'read', scope: 'OWN' },
                    { resource: 'analytics', action: 'read', scope: 'OWN' }
                ],
                isSystem: true
            },
            {
                name: 'API_USER',
                displayName: 'API User',
                description: 'Programmatic access via API keys',
                permissions: [
                    { resource: 'api', action: 'read', scope: 'TENANT' }
                ],
                isSystem: true
            }
        ];
        
        for (const role of defaultRoles) {
            const roleId = `ROL-${Date.now()}-${randomBytes(6).toString('hex')}`;
            await query(
                `INSERT INTO tenant_roles 
                 (role_id, tenant_id, name, display_name, description, permissions, is_system, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
                [roleId, tenantId, role.name, role.displayName, role.description, JSON.stringify(role.permissions), role.isSystem]
            );
        }
    }
    
    /**
     * Get tenant by ID
     */
    static async getTenant(tenantId: string): Promise<Tenant | null> {
        const { rows } = await query('SELECT * FROM tenants WHERE tenant_id = $1', [tenantId]);
        return rows.length ? this.mapRowToTenant(rows[0]) : null;
    }
    
    /**
     * Get tenant by subdomain
     */
    static async getTenantBySubdomain(subdomain: string): Promise<Tenant | null> {
        const { rows } = await query('SELECT * FROM tenants WHERE subdomain = $1', [subdomain]);
        return rows.length ? this.mapRowToTenant(rows[0]) : null;
    }
    
    /**
     * Get tenant by custom domain
     */
    static async getTenantByDomain(domain: string): Promise<Tenant | null> {
        const { rows } = await query('SELECT * FROM tenants WHERE domain = $1', [domain]);
        return rows.length ? this.mapRowToTenant(rows[0]) : null;
    }
    
    /**
     * Update tenant
     */
    static async updateTenant(tenantId: string, updates: Partial<Tenant>): Promise<Tenant | null> {
        const tenant = await this.getTenant(tenantId);
        if (!tenant) return null;
        
        const updated = { ...tenant, ...updates, updatedAt: new Date().toISOString() };
        
        await query(
            `UPDATE tenants SET 
                name = $1, display_name = $2, domain = $3, logo_url = $4, primary_color = $5,
                secondary_color = $6, favicon_url = $7, email_from_name = $8, email_from_address = $9,
                support_email = $10, status = $11, plan = $12, billing_cycle = $13,
                trial_ends_at = $14, subscription_ends_at = $15, max_users = $16,
                max_projects = $17, max_api_calls = $18, storage_limit_gb = $19,
                features = $20, settings = $21, updated_at = NOW()
             WHERE tenant_id = $22`,
            [
                updated.name, updated.displayName, updated.domain, updated.logoUrl,
                updated.primaryColor, updated.secondaryColor, updated.faviconUrl,
                updated.emailFromName, updated.emailFromAddress, updated.supportEmail,
                updated.status, updated.plan, updated.billingCycle,
                updated.trialEndsAt, updated.subscriptionEndsAt,
                updated.maxUsers, updated.maxProjects, updated.maxApiCalls, updated.storageLimitGb,
                JSON.stringify(updated.features), JSON.stringify(updated.settings), tenantId
            ]
        );
        
        return updated;
    }
    
    /**
     * Create tenant user
     */
    static async createUser(user: Omit<TenantUser, 'userId' | 'createdAt' | 'updatedAt'>): Promise<TenantUser> {
        const userId = `USR-${Date.now()}-${randomBytes(6).toString('hex')}`;
        
        const fullUser: TenantUser = {
            ...user,
            userId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO tenant_users 
             (user_id, tenant_id, email, first_name, last_name, phone, avatar_url, status, roles, groups,
              mfa_enabled, mfa_secret, failed_login_attempts, password_changed_at, email_verified, phone_verified,
              invited_by, invited_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())`,
            [
                userId, user.tenantId, user.email, user.firstName, user.lastName,
                user.phone, user.avatarUrl, user.status, JSON.stringify(user.roles), JSON.stringify(user.groups),
                user.mfaEnabled, user.mfaSecret, user.failedLoginAttempts, user.passwordChangedAt,
                user.emailVerified, user.phoneVerified, user.invitedBy, user.invitedAt
            ]
        );
        
        return fullUser;
    }
    
    /**
     * Invite user to tenant
     */
    static async inviteUser(tenantId: string, email: string, roles: string[], invitedBy: string): Promise<TenantUser> {
        const user = await this.createUser({
            tenantId,
            email,
            firstName: '',
            lastName: '',
            status: 'PENDING_INVITE',
            roles,
            groups: [],
            mfaEnabled: false,
            failedLoginAttempts: 0,
            passwordChangedAt: new Date().toISOString(),
            emailVerified: false,
            phoneVerified: false,
            invitedBy,
            invitedAt: new Date().toISOString()
        });
        
        // Send invitation email (would integrate with email service)
        await this.sendInvitationEmail(user);
        
        return user;
    }
    
    /**
     * Create role
     */
    static async createRole(role: Omit<Role, 'roleId' | 'createdAt' | 'updatedAt'>): Promise<Role> {
        const roleId = `ROL-${Date.now()}-${randomBytes(6).toString('hex')}`;
        
        const fullRole: Role = {
            ...role,
            roleId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO tenant_roles 
             (role_id, tenant_id, name, display_name, description, permissions, is_system, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
            [roleId, role.tenantId, role.name, role.displayName, role.description, JSON.stringify(role.permissions), role.isSystem]
        );
        
        return fullRole;
    }
    
    /**
     * Create API key
     */
    static async createApiKey(apiKey: Omit<ApiKey, 'apiKeyId' | 'keyPrefix' | 'keyHash' | 'createdAt' | 'updatedAt'>): Promise<{ apiKey: ApiKey; rawKey: string }> {
        const apiKeyId = `KEY-${Date.now()}-${randomBytes(8).toString('hex')}`;
        const rawKey = `etk_${randomBytes(32).toString('hex')}`;
        const keyPrefix = rawKey.substring(0, 12);
        const keyHash = await this.hashApiKey(rawKey);
        
        const fullApiKey: ApiKey = {
            ...apiKey,
            apiKeyId,
            keyPrefix,
            keyHash,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO api_keys 
             (api_key_id, tenant_id, name, key_prefix, key_hash, permissions, rate_limit, ip_whitelist,
              expires_at, status, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', $10, NOW(), NOW())`,
            [
                apiKeyId, apiKey.tenantId, apiKey.name, keyPrefix, keyHash,
                JSON.stringify(apiKey.permissions), apiKey.rateLimit, JSON.stringify(apiKey.ipWhitelist),
                apiKey.expiresAt, apiKey.createdBy
            ]
        );
        
        return { apiKey: fullApiKey, rawKey };
    }
    
    /**
     * Validate API key
     */
    static async validateApiKey(rawKey: string): Promise<ApiKey | null> {
        const keyPrefix = rawKey.substring(0, 12);
        
        const { rows } = await query(
            `SELECT * FROM api_keys WHERE key_prefix = $1 AND status = 'ACTIVE'`,
            [keyPrefix]
        );
        
        if (!rows.length) return null;
        
        const apiKey = rows[0];
        const valid = await this.verifyApiKey(rawKey, apiKey.key_hash);
        
        if (!valid) return null;
        
        // Check expiration
        if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
            await query('UPDATE api_keys SET status = $1 WHERE api_key_id = $2', ['EXPIRED', apiKey.api_key_id]);
            return null;
        }
        
        // Update last used
        await query('UPDATE api_keys SET last_used_at = NOW() WHERE api_key_id = $1', [apiKey.api_key_id]);
        
        return this.mapRowToApiKey(apiKey);
    }
    
    /**
     * Create audit log
     */
    static async createAuditLog(log: Omit<AuditLog, 'logId' | 'createdAt'>): Promise<AuditLog> {
        const logId = `AUD-${Date.now()}-${randomBytes(8).toString('hex')}`;
        
        const fullLog: AuditLog = {
            ...log,
            logId,
            createdAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO audit_logs 
             (log_id, tenant_id, user_id, api_key_id, action, resource, resource_id, resource_type,
              old_values, new_values, ip_address, user_agent, request_id, status, error_message,
              duration_ms, metadata, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())`,
            [
                logId, log.tenantId, log.userId, log.apiKeyId, log.action, log.resource,
                log.resourceId, log.resourceType, JSON.stringify(log.oldValues), JSON.stringify(log.newValues),
                log.ipAddress, log.userAgent, log.requestId, log.status, log.errorMessage,
                log.durationMs, JSON.stringify(log.metadata)
            ]
        );
        
        return fullLog;
    }
    
    /**
     * Configure SSO
     */
    static async configureSSO(sso: Omit<SSOConfig, 'ssoId' | 'createdAt' | 'updatedAt'>): Promise<SSOConfig> {
        const ssoId = `SSO-${Date.now()}-${randomBytes(6).toString('hex')}`;
        
        const fullSSO: SSOConfig = {
            ...sso,
            ssoId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO sso_configs 
             (sso_id, tenant_id, provider, name, enabled, config, attribute_mapping,
              just_in_time_provisioning, default_role, default_groups, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
             ON CONFLICT (tenant_id, provider) DO UPDATE SET
                name = EXCLUDED.name, enabled = EXCLUDED.enabled, config = EXCLUDED.config,
                attribute_mapping = EXCLUDED.attribute_mapping, just_in_time_provisioning = EXCLUDED.just_in_time_provisioning,
                default_role = EXCLUDED.default_role, default_groups = EXCLUDED.default_groups, updated_at = NOW()`,
            [
                ssoId, sso.tenantId, sso.provider, sso.name, sso.enabled,
                JSON.stringify(sso.config), JSON.stringify(sso.attributeMapping),
                sso.justInTimeProvisioning, sso.defaultRole, JSON.stringify(sso.defaultGroups)
            ]
        );
        
        return fullSSO;
    }
    
    /**
     * Configure SCIM
     */
    static async configureSCIM(scim: Omit<SCIMConfig, 'scimId' | 'createdAt' | 'updatedAt'>): Promise<SCIMConfig> {
        const scimId = `SCIM-${Date.now()}-${randomBytes(6).toString('hex')}`;
        
        const fullSCIM: SCIMConfig = {
            ...scim,
            scimId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO scim_configs 
             (scim_id, tenant_id, enabled, base_url, bearer_token, schemas,
              user_provisioning, group_provisioning, filter, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
             ON CONFLICT (tenant_id) DO UPDATE SET
                enabled = EXCLUDED.enabled, base_url = EXCLUDED.base_url, bearer_token = EXCLUDED.bearer_token,
                schemas = EXCLUDED.schemas, user_provisioning = EXCLUDED.user_provisioning,
                group_provisioning = EXCLUDED.group_provisioning, filter = EXCLUDED.filter, updated_at = NOW()`,
            [
                scimId, scim.tenantId, scim.enabled, scim.baseUrl, scim.bearerToken,
                JSON.stringify(scim.schemas), scim.userProvisioning, scim.groupProvisioning, scim.filter
            ]
        );
        
        return fullSCIM;
    }
    
    /**
     * Add custom domain
     */
    static async addCustomDomain(domain: Omit<CustomDomain, 'domainId' | 'verificationToken' | 'verificationRecord' | 'cnameTarget' | 'createdAt' | 'updatedAt'>): Promise<CustomDomain> {
        const domainId = `DOM-${Date.now()}-${randomBytes(6).toString('hex')}`;
        const verificationToken = randomBytes(16).toString('hex');
        const verificationRecord = `ethertrack-verify=${verificationToken}`;
        const cnameTarget = `${domain.tenantId}.ethertrack.com`;
        
        const fullDomain: CustomDomain = {
            ...domain,
            domainId,
            verificationToken,
            verificationRecord,
            cnameTarget,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO custom_domains 
             (domain_id, tenant_id, domain, status, verification_token, verification_record, ssl_enabled, cname_target, created_at, updated_at)
             VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, NOW(), NOW())`,
            [domainId, domain.tenantId, domain.domain, verificationToken, verificationRecord, domain.sslEnabled, cnameTarget]
        );
        
        return fullDomain;
    }
    
    /**
     * Verify custom domain
     */
    static async verifyCustomDomain(domainId: string): Promise<CustomDomain | null> {
        const { rows } = await query('SELECT * FROM custom_domains WHERE domain_id = $1', [domainId]);
        if (!rows.length) return null;
        
        const domain = rows[0];
        
        // Check DNS TXT record
        const verified = await this.checkDNSVerification(domain.domain, domain.verification_record);
        
        if (verified) {
            await query(
                `UPDATE custom_domains SET status = 'VERIFIED', verified_at = NOW(), updated_at = NOW() WHERE domain_id = $1`,
                [domainId]
            );
            
            // Provision SSL certificate (would use Let's Encrypt or similar)
            await this.provisionSSL(domainId);
        } else {
            await query(
                `UPDATE custom_domains SET status = 'FAILED', updated_at = NOW() WHERE domain_id = $1`,
                [domainId]
            );
        }
        
        const { rows: updated } = await query('SELECT * FROM custom_domains WHERE domain_id = $1', [domainId]);
        return updated.length ? this.mapRowToCustomDomain(updated[0]) : null;
    }
    
    /**
     * Create webhook
     */
    static async createWebhook(webhook: Omit<Webhook, 'webhookId' | 'secret' | 'createdAt' | 'updatedAt'>): Promise<{ webhook: Webhook; secret: string }> {
        const webhookId = `WH-${Date.now()}-${randomBytes(6).toString('hex')}`;
        const secret = `whsec_${randomBytes(32).toString('hex')}`;
        
        const fullWebhook: Webhook = {
            ...webhook,
            webhookId,
            secret,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO webhooks 
             (webhook_id, tenant_id, name, url, events, secret, headers, retry_policy, status, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, NOW(), NOW())`,
            [
                webhookId, webhook.tenantId, webhook.name, webhook.url,
                JSON.stringify(webhook.events), secret, JSON.stringify(webhook.headers),
                JSON.stringify(webhook.retryPolicy), webhook.createdBy
            ]
        );
        
        return { webhook: fullWebhook, secret };
    }
    
    /**
     * Trigger webhook
     */
    static async triggerWebhook(tenantId: string, event: string, payload: any): Promise<void> {
        const { rows } = await query(
            `SELECT * FROM webhooks WHERE tenant_id = $1 AND status = 'ACTIVE' AND $3 = ANY(events)`,
            [tenantId, event]
        );
        
        for (const webhook of rows) {
            await this.deliverWebhook(webhook, event, payload);
        }
    }
    
    /**
     * Get rate limit config
     */
    static async getRateLimitConfig(tenantId: string): Promise<RateLimitConfig> {
        const { rows } = await query('SELECT * FROM rate_limit_configs WHERE tenant_id = $1', [tenantId]);
        
        if (rows.length) {
            return rows[0];
        }
        
        // Return defaults based on plan
        const { rows: tenant } = await query('SELECT plan FROM tenants WHERE tenant_id = $1', [tenantId]);
        const plan = tenant[0]?.plan || 'STARTER';
        
        const defaults: Record<string, RateLimitConfig> = {
            STARTER: { tenantId, apiCallsPerMinute: 60, apiCallsPerHour: 1000, apiCallsPerDay: 10000, apiCallsPerMonth: 100000, burstAllowance: 10, customLimits: {} },
            PROFESSIONAL: { tenantId, apiCallsPerMinute: 300, apiCallsPerHour: 10000, apiCallsPerDay: 100000, apiCallsPerMonth: 1000000, burstAllowance: 50, customLimits: {} },
            ENTERPRISE: { tenantId, apiCallsPerMinute: 1000, apiCallsPerHour: 100000, apiCallsPerDay: 1000000, apiCallsPerMonth: 10000000, burstAllowance: 200, customLimits: {} },
            CUSTOM: { tenantId, apiCallsPerMinute: 5000, apiCallsPerHour: 500000, apiCallsPerDay: 5000000, apiCallsPerMonth: 50000000, burstAllowance: 1000, customLimits: {} }
        };
        
        return defaults[plan] || defaults.STARTER;
    }
    
    // Private helpers
    private static async hashApiKey(key: string): Promise<string> {
        // In production, use bcrypt
        return createHash('sha256').update(key).digest('hex');
    }
    
    private static async verifyApiKey(key: string, hash: string): Promise<boolean> {
        const computedHash = await this.hashApiKey(key);
        return computedHash === hash;
    }
    
    private static async sendInvitationEmail(user: TenantUser): Promise<void> {
        // Integrate with email service
        console.log(`Sending invitation to ${user.email}`);
    }
    
    private static async checkDNSVerification(domain: string, record: string): Promise<boolean> {
        // In production, use dns.resolveTxt
        return true; // Mock
    }
    
    private static async provisionSSL(domainId: string): Promise<void> {
        // In production, use Let's Encrypt or similar
        console.log(`Provisioning SSL for domain ${domainId}`);
    }
    
    private static async deliverWebhook(webhook: any, event: string, payload: any): Promise<void> {
        // In production, use fetch with retry logic
        console.log(`Delivering webhook ${webhook.webhook_id} for event ${event}`);
    }
    
    private static mapRowToTenant(row: any): Tenant {
        return {
            tenantId: row.tenant_id,
            name: row.name,
            displayName: row.display_name,
            domain: row.domain,
            subdomain: row.subdomain,
            logoUrl: row.logo_url,
            primaryColor: row.primary_color,
            secondaryColor: row.secondary_color,
            faviconUrl: row.favicon_url,
            emailFromName: row.email_from_name,
            emailFromAddress: row.email_from_address,
            supportEmail: row.support_email,
            status: row.status,
            plan: row.plan,
            billingCycle: row.billing_cycle,
            trialEndsAt: row.trial_ends_at,
            subscriptionEndsAt: row.subscription_ends_at,
            maxUsers: row.max_users,
            maxProjects: row.max_projects,
            maxApiCalls: row.max_api_calls,
            storageLimitGb: row.storage_limit_gb,
            features: JSON.parse(row.features),
            settings: JSON.parse(row.settings),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    
    private static mapRowToApiKey(row: any): ApiKey {
        return {
            apiKeyId: row.api_key_id,
            tenantId: row.tenant_id,
            name: row.name,
            keyPrefix: row.key_prefix,
            keyHash: row.key_hash,
            permissions: JSON.parse(row.permissions),
            rateLimit: row.rate_limit,
            ipWhitelist: JSON.parse(row.ip_whitelist),
            expiresAt: row.expires_at,
            lastUsedAt: row.last_used_at,
            status: row.status,
            createdBy: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    
    private static mapRowToCustomDomain(row: any): CustomDomain {
        return {
            domainId: row.domain_id,
            tenantId: row.tenant_id,
            domain: row.domain,
            status: row.status,
            verificationToken: row.verification_token,
            verificationRecord: row.verification_record,
            sslEnabled: row.ssl_enabled,
            sslCertificate: row.ssl_certificate,
            sslPrivateKey: row.ssl_private_key,
            sslExpiresAt: row.ssl_expires_at,
            cnameTarget: row.cname_target,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            verifiedAt: row.verified_at,
        };
    }
}

export default WhiteLabelSaaSService;