// scripts/compliance/vuln-scan.js
// Evidence collection for SOC2 vulnerability management
// Usage: node scripts/compliance/vuln-scan.js

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function collectVulnScan() {
  const scanDirs = [
    { name: 'backend', dir: path.join(__dirname, '..', '..', 'ethertrack-backend') },
    { name: 'frontend', dir: path.join(__dirname, '..', '..', 'ethertrack-frontend') },
    { name: 'contracts', dir: path.join(__dirname, '..', '..', 'ethertrack-contracts') },
  ];

  const results = {
    timestamp: new Date().toISOString(),
    scans: {},
  };

  for (const { name, dir } of scanDirs) {
    console.log(`[SOC2] Scanning ${name}...`);
    
    try {
      // Run npm audit
      const auditOutput = execSync('npm audit --json', { 
        cwd: dir, 
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      const audit = JSON.parse(auditOutput);
      
      // Count vulnerabilities by severity
      const vulns = audit.vulnerabilities || {};
      const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
      
      for (const [pkg, vuln] of Object.entries(vulns)) {
        if (vuln.severity) counts[vuln.severity] = (counts[vuln.severity] || 0) + 1;
      }
      
      results.scans[name] = {
        summary: counts,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
        details: audit,
      };
      
      console.log(`[SOC2] ${name}: ${counts.critical} critical, ${counts.high} high, ${counts.moderate} moderate, ${counts.low} low`);
    } catch (e) {
      console.error(`[SOC2] Failed to scan ${name}:`, e.message);
      results.scans[name] = { error: e.message };
    }
  }

  // Save results
  const outputDir = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'docs',
    'compliance',
    'evidence',
    'vulnerability-scans',
    new Date().toISOString().split('T')[0]
  );
  
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `vuln-scan-${Date.now()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

  console.log('[SOC2] Vulnerability scan evidence collected');
  console.log(`[SOC2] Saved to: ${outputFile}`);
  console.log('[SOC2] Evidence collection complete');
}

collectVulnScan().catch(e => {
  console.error('[SOC2] Fatal:', e.message);
  process.exit(1);
});