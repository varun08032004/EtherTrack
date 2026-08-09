// Analyze CSRF coverage
const fs = require('fs');
const path = require('path');

const routesDir = 'routes';
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js') && !f.endsWith('.routes.js'));

const skipPrefixes = [
  '/api/wallet/webhook',
  '/api/subscription/webhook',
  '/api/invoices',
  '/api/kyc/stream',
  '/api/erp',
  '/api/ops-integration-corporate',
  '/api/ops-integration-coupons',
  '/api/ops-integration-pricing',
  '/health',
];

// Map of mount points from server.js
const mountPoints = {
  'auth.js': '/api/auth',
  'wallet.js': '/api/wallet',
  'registry.js': '/api/registry',
  'transactions.js': '/api/transactions',
  'emissions.js': '/api/emissions',
  'kyc.js': '/api/kyc',
  'admin.js': '/api/admin',
  'portfolio.js': '/api/portfolio',
  'operator-trading.js': '/api/portfolio', // also mounted here
  'verify.js': '/api/verify',
  'invoiceVerify.js': '/api/invoices',
  'opsIntegration.js': '/api/ops-integration',
  'trade.js': '/api/trades',
  'market.js': '/api/market',
  'ipfsRoute.js': '/api/ipfs',
  'certificatePDF.js': '/api/certificates',
  'user.js': '/api/user',
  'watchlist.js': '/api/watchlist',
  'certificates.js': '/api/cert',
  'entities.js': '/api/entities',
  'audit.js': '/api/audit',
  'auditor-verification.js': '/api/audit',
  'audit-auditor-access.js': '/api/audit',
  'brsr.js': '/api/brsr',
  'brsrDataRoutes.js': '/api/brsr',
  'pat.js': '/api/pat',
  'ccts.js': '/api/ccts',
  'alert.js': '/api/alerts',
  'news.js': '/api/news',
  'support.js': '/api/support',
  'org.js': '/api/org',
  'notifications.js': '/api/notifications',
  'cctsCFORoutes.js': '/api/compliance',
  'priceFeed.js': '/api/ccc',
  'supplier.js': '/api/suppliers',
  'subscription.js': '/api/subscription',
  'erp.js': '/api/erp',
  'emissions-approval.js': '/api/emissions',
  'retirementApproval.js': '/api/org',
  'compliance.js': '/api/compliance',
  'suppliers.js': '/api/suppliers',
  'report.js': '/api/reports',
  'auditor-verification.js': '/api/audit',
  'audit-auditor-access.js': '/api/audit',
  'cctsCFORoutes.js': '/api/compliance',
  'admin2FA.routes.js': '/api/admin',
  'auth2fa.js': '/api/auth',
};

console.log('=== CSRF COVERAGE ANALYSIS ===\n');

let issues = [];

for (const f of files) {
  const mountPath = mountPoints[f];
  if (!mountPath) continue;
  
  const content = fs.readFileSync(path.join(routesDir, f), 'utf8');
  const lines = content.split('\n');
  
  const isSkipped = skipPrefixes.some(p => mountPath.startsWith(p) || mountPath === p.replace('/api/', ''));
  
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/router\.(post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/);
    if (m) {
      const method = m[1].toUpperCase();
      const route = m[2];
      const fullPath = mountPath + route;
      
      // Check if this specific path is in skip exact
      const skipExact = ['/api/auth/firebase-sync','/api/auth/register','/api/auth/login','/api/auth/verify-email','/api/auth/resend-otp','/api/auth/refresh','/api/auth/csrf'];
      const exactSkipped = skipExact.includes(fullPath);
      
      // Check if mount path is in skip prefix
      const prefixSkipped = skipPrefixes.some(p => fullPath.startsWith(p));
      
      if (exactSkipped || prefixSkipped) {
        if (isSkipped) {
          issues.push({ file: f, method, route: fullPath, status: 'SKIPPED', mountPath });
        }
      }
    }
  }
}

// Print skipped state-changing endpoints
console.log('STATE-CHANGING ENDPOINTS IN CSRF_SKIP_PREFIX:\n');
const skipped = issues.filter(i => i.status === 'SKIPPED');
skipped.forEach(i => {
  console.log(`  ${i.method} ${i.route}  (${i.file}, mount: ${i.mountPath})`);
});

console.log(`\nTotal: ${skipped.length} endpoints skipped\n`);

// Also check non-skipped endpoints that use cookie auth
console.log('=== ENDPOINTS PROTECTED BY CSRF (not in skip list) ===\n');
const protectedEndpoints = [];
for (const f of files) {
  const mountPath = mountPoints[f];
  if (!mountPath) continue;
  
  const content = fs.readFileSync(path.join(routesDir, f), 'utf8');
  const lines = content.split('\n');
  
  const isSkipped = skipPrefixes.some(p => mountPath.startsWith(p) || mountPath === p.replace('/api/', ''));
  
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/router\.(post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/);
    if (m) {
      const method = m[1].toUpperCase();
      const route = m[2];
      const fullPath = mountPath + route;
      
      const skipExact = ['/api/auth/firebase-sync','/api/auth/register','/api/auth/login','/api/auth/verify-email','/api/auth/resend-otp','/api/auth/refresh','/api/auth/csrf'];
      const exactSkipped = skipExact.includes(fullPath);
      const prefixSkipped = skipPrefixes.some(p => fullPath.startsWith(p));
      
      if (!exactSkipped && !prefixSkipped) {
        protectedEndpoints.push({ file: f, method, route: fullPath, mountPath });
      }
    }
  }
}

protectedEndpoints.slice(0, 50).forEach(i => {
  console.log(`  ${i.method} ${i.route}  (${i.file})`);
});
console.log(`\nTotal protected: ${protectedEndpoints.length}`);