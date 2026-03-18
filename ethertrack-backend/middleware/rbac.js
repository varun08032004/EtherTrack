// middleware/rbac.js — EtherTrack Role-Based Access Control
// ─────────────────────────────────────────────────────────────────
// ROLE HIERARCHY:
//   owner   → full control of org (billing, delete org, all below)
//   admin   → manage team, approve credits, all below
//   manager → emissions + portfolio read/write, exports
//   viewer  → read-only dashboard, no exports
//   auditor → read-only + exports + verification badge (external)
// ─────────────────────────────────────────────────────────────────

const { safeQuery: query } = require('../db/pool');

// Role hierarchy levels — higher = more permissions
const ROLE_LEVELS = {
  owner:   100,
  admin:    80,
  manager:  60,
  auditor:  40,
  viewer:   20,
};

// Permission map — what each role can do
const PERMISSIONS = {
  // Portfolio
  'portfolio:read':            ['owner','admin','manager','auditor','viewer'],
  'portfolio:write':           ['owner','admin','manager'],
  'portfolio:submit_credit':   ['owner','admin','manager'],
  'portfolio:retire':          ['owner','admin','manager'],
  'portfolio:list':            ['owner','admin','manager'],
  'portfolio:export':          ['owner','admin','manager','auditor'],

  // Emissions
  'emissions:read':            ['owner','admin','manager','auditor','viewer'],
  'emissions:write':           ['owner','admin','manager'],
  'emissions:export':          ['owner','admin','manager','auditor'],
  'emissions:delete':          ['owner','admin'],

  // Reports
  'reports:read':              ['owner','admin','manager','auditor','viewer'],
  'reports:generate':          ['owner','admin','manager'],
  'reports:export_pdf':        ['owner','admin','manager','auditor'],
  'reports:submit':            ['owner','admin'],

  // Team management
  'team:read':                 ['owner','admin','manager','auditor','viewer'],
  'team:invite':               ['owner','admin'],
  'team:remove':               ['owner','admin'],
  'team:change_role':          ['owner'],
  'team:view_audit_log':       ['owner','admin','auditor'],

  // Organisation
  'org:read':                  ['owner','admin','manager','auditor','viewer'],
  'org:update':                ['owner','admin'],
  'org:billing':               ['owner'],
  'org:delete':                ['owner'],

  // Verifier
  'verifier:read':             ['owner','admin','manager','auditor','viewer'],
  'verifier:connect':          ['owner','admin'],
  'verifier:verify_report':    ['auditor'],

  // Admin (platform-level)
  'platform:admin':            ['admin'],  // EtherTrack platform admin only
};

// ── Middleware: require specific permission ───────────────────────
const requirePermission = (permission) => async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    // Platform admin bypasses all org-level checks
    if (req.user.role === 'admin') return next();

    // Get team role from org_members for this user's org
    const orgId = req.user.org_id || req.params.orgId || req.body.orgId;

    if (!orgId) {
      // No org context — use global role
      const globalRole = req.user.role === 'admin' ? 'admin' : 'viewer';
      const allowed    = PERMISSIONS[permission] || [];
      if (!allowed.includes(globalRole)) {
        return res.status(403).json({
          error:      'Insufficient permissions',
          required:   permission,
          yourRole:   globalRole,
          allowedFor: allowed,
        });
      }
      return next();
    }

    // Fetch team role from org_members
    const { rows } = await query(
      `SELECT team_role, status FROM org_members
       WHERE org_id = $1 AND user_id = $2`,
      [orgId, req.user.id]
    );

    if (!rows.length || rows[0].status !== 'active') {
      return res.status(403).json({ error: 'Not a member of this organisation' });
    }

    const teamRole = rows[0].team_role;
    const allowed  = PERMISSIONS[permission] || [];

    if (!allowed.includes(teamRole)) {
      return res.status(403).json({
        error:      'Insufficient permissions',
        required:   permission,
        yourRole:   teamRole,
        allowedFor: allowed,
      });
    }

    // Attach team role to request for downstream use
    req.teamRole = teamRole;
    req.orgId    = orgId;
    next();
  } catch (e) {
    console.error('RBAC error:', e.message);
    res.status(500).json({ error: 'Permission check failed' });
  }
};

// ── Middleware: require minimum role level ────────────────────────
const requireRole = (...roles) => async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role === 'admin') return next(); // platform admin always passes

    const orgId = req.user.org_id || req.params.orgId;
    let   userRole = req.user.role;

    if (orgId) {
      const { rows } = await query(
        `SELECT team_role FROM org_members
         WHERE org_id = $1 AND user_id = $2 AND status = 'active'`,
        [orgId, req.user.id]
      );
      if (rows.length) userRole = rows[0].team_role;
    }

    if (!roles.includes(userRole)) {
      return res.status(403).json({
        error:    `This action requires one of: ${roles.join(', ')}`,
        yourRole: userRole,
      });
    }

    req.teamRole = userRole;
    next();
  } catch (e) {
    console.error('requireRole error:', e.message);
    res.status(500).json({ error: 'Role check failed' });
  }
};

// ── Middleware: read-only guard (viewer + auditor allowed) ────────
const readOnly = async (req, res, next) => {
  // Block write methods for viewer/auditor
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    if (req.teamRole === 'viewer' || req.teamRole === 'auditor') {
      return res.status(403).json({
        error:   'Read-only access — this role cannot modify data',
        role:    req.teamRole,
        upgrade: 'Contact your org admin to upgrade your role',
      });
    }
  }
  next();
};

// ── Helper: check permission programmatically ─────────────────────
const hasPermission = (role, permission) => {
  const allowed = PERMISSIONS[permission] || [];
  return allowed.includes(role);
};

// ── Helper: get all permissions for a role ────────────────────────
const getPermissions = (role) => {
  return Object.entries(PERMISSIONS)
    .filter(([, roles]) => roles.includes(role))
    .map(([perm]) => perm);
};

module.exports = {
  requirePermission,
  requireRole,
  readOnly,
  hasPermission,
  getPermissions,
  ROLE_LEVELS,
  PERMISSIONS,
};