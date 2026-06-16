// src/context/rbac.js — EtherTrack Frontend RBAC
// Use this everywhere to guard UI elements by role

// Mirror of backend PERMISSIONS map
export const PERMISSIONS = {
  'portfolio:read':            ['owner','admin','manager','auditor','viewer'],
  'portfolio:write':           ['owner','admin','manager'],
  'portfolio:submit_credit':   ['owner','admin','manager'],
  'portfolio:retire':          ['owner','admin','manager'],
  'portfolio:list':            ['owner','admin','manager'],
  'portfolio:export':          ['owner','admin','manager','auditor'],
  'emissions:read':            ['owner','admin','manager','auditor','viewer'],
  'emissions:write':           ['owner','admin','manager'],
  'emissions:export':          ['owner','admin','manager','auditor'],
  'emissions:delete':          ['owner','admin'],
  'reports:read':              ['owner','admin','manager','auditor','viewer'],
  'reports:generate':          ['owner','admin','manager'],
  'reports:export_pdf':        ['owner','admin','manager','auditor'],
  'reports:submit':            ['owner','admin'],
  'team:read':                 ['owner','admin','manager','auditor','viewer'],
  'team:invite':               ['owner','admin'],
  'team:remove':               ['owner','admin'],
  'team:change_role':          ['owner'],
  'team:view_audit_log':       ['owner','admin','auditor'],
  'org:read':                  ['owner','admin','manager','auditor','viewer'],
  'org:update':                ['owner','admin'],
  'org:billing':               ['owner'],
  'verifier:read':             ['owner','admin','manager','auditor','viewer'],
  'verifier:connect':          ['owner','admin'],
};

export const ROLE_META = {
  owner:   { color:'#f97316', label:'Owner',   icon:'👑', level:100 },
  admin:   { color:'#f87171', label:'Admin',   icon:'🛡', level:80  },
  manager: { color:'#22c55e', label:'Manager', icon:'📊', level:60  },
  auditor: { color:'#a78bfa', label:'Auditor', icon:'🔍', level:40  },
  viewer:  { color:'#60a5fa', label:'Viewer',  icon:'👁', level:20  },
};

// Check if a role has a permission
export const hasPermission = (role, permission) => {
  if (!role) return false;
  const allowed = PERMISSIONS[permission] || [];
  return allowed.includes(role);
};

// RoleGuard component — wraps children, hides if insufficient role
export const RoleGuard = ({ role, permission, children, fallback = null }) => {
  if (!hasPermission(role, permission)) return fallback;
  return children;
};

// useRBAC hook — use in any component
export const useRBAC = (teamRole) => {
  const can    = (permission) => hasPermission(teamRole, permission);
  const cannot = (permission) => !hasPermission(teamRole, permission);
  const role   = ROLE_META[teamRole] || ROLE_META.viewer;
  return { can, cannot, role, teamRole };
};