// IDOR/BOLA Audit - Find routes with dynamic params
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

const paramPatterns = [
  /:id/,
  /:userId/,
  /:orgId/,
  /:listingId/,
  /:orderId/,
  /:tradeId/,
  /:batchId/,
  /:projectId/,
  /:certId/,
  /:serial/,
];

console.log('=== ROUTES WITH DYNAMIC PARAMS ===\n');

for (const f of allFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/router\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/);
    if (match) {
      const method = match[1].toUpperCase();
      const route = match[2];
      // Check if route has dynamic params
      let hasParam = false;
      for (const p of paramPatterns) {
        if (p.test(route)) {
          hasParam = true;
          break;
        }
      }
      if (!hasParam) continue;
      
      // Look for auth middleware in the next few lines
      let hasAuth = false;
      let hasOrgCheck = false;
      let hasOwnerCheck = false;
      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        const l = lines[j];
        if (l.includes('authenticate') || l.includes('requireAuth') || l.includes('requireRole') || l.includes('isAdmin') || l.includes('optionalAuth')) hasAuth = true;
        if (l.includes('org_id') || l.includes('orgId') || l.includes('requireOrg') || l.includes('orgMember')) hasOrgCheck = true;
        if (l.includes('user_id') || l.includes('req.user.id') || l.includes('owner') || l.includes('created_by')) hasOwnerCheck = true;
      }
      console.log(f.replace('routes\\\\', '') + ':' + (i+1) + ' ' + method + ' ' + route + ' | auth=' + hasAuth + ' org=' + hasOrgCheck + ' owner=' + hasOwnerCheck);
    }
  }
}