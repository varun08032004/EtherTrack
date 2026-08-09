// Find non-admin routes with dynamic params but no owner/org check
const fs = require('fs');
const path = require('path');

function walk(dir) {
  let files = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else if (f.endsWith('.js')) files.push(full);
  }
  return files;
}

const allFiles = walk('routes').filter(f => !f.includes('node_modules') && !f.includes('.git'));

console.log('=== NON-ADMIN ROUTES WITH DYNAMIC PARAMS BUT NO OWNER/ORG CHECK ===\n');

for (const f of allFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/router\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/);
    if (match) {
      const method = match[1].toUpperCase();
      const route = match[2];
      if (!/:/.test(route)) continue;
      
      let hasAuth = false;
      let hasAdmin = false;
      let hasOrgCheck = false;
      let hasOwnerCheck = false;
      let hasServiceToken = false;
      for (let j = i; j < Math.min(i + 15, lines.length); j++) {
        const l = lines[j];
        if (l.includes('authenticate') || l.includes('requireAuth')) hasAuth = true;
        if (l.includes('isAdmin') || l.includes('requireRole')) hasAdmin = true;
        if (l.includes('org_id') || l.includes('orgId') || l.includes('requireOrg') || l.includes('orgMember')) hasOrgCheck = true;
        if (l.includes('user_id') || l.includes('req.user.id') || l.includes('owner') || l.includes('created_by') || l.includes('retired_by') || l.includes('buyer_id') || l.includes('seller_id')) hasOwnerCheck = true;
        if (l.includes('requireServiceToken') || l.includes('requireServiceTokenFor')) hasServiceToken = true;
      }
      
      if (hasAuth && !hasAdmin && !hasOrgCheck && !hasOwnerCheck && !hasServiceToken) {
        console.log(f.replace('routes\\\\', '') + ':' + (i+1) + ' ' + method + ' ' + route);
      }
    }
  }
}