const fs = require('fs');

// Check secret rotation documentation
const rotationMatrix = fs.readFileSync('ROTATION_MATRIX.md', 'utf8');
if (rotationMatrix.includes('SECRET') && rotationMatrix.includes('Rotation Type')) console.log('PASS: ROTATION_MATRIX.md exists');
else console.log('FAIL: ROTATION_MATRIX.md missing');

const runbook = fs.readFileSync('PRODUCTION_SECRET_ROTATION_RUNBOOK.md', 'utf8');
if (runbook.includes('SECRET') && runbook.includes('PHASE')) console.log('PASS: PRODUCTION_SECRET_ROTATION_RUNBOOK.md exists');
else console.log('FAIL: PRODUCTION_SECRET_ROTATION_RUNBOOK.md missing');

// Check .gitignore
const gitignore = fs.readFileSync('.gitignore', 'utf8');
if (gitignore.includes('.env') || gitignore.includes('*.env')) console.log('PASS: .env files in .gitignore');
else console.log('FAIL: .env not in .gitignore');

// Check frontend .gitignore
const frontendGitignore = fs.readFileSync('ethertrack-frontend/.gitignore', 'utf8');
if (frontendGitignore.includes('.env') || frontendGitignore.includes('*.env')) console.log('PASS: Frontend .env in .gitignore');
else console.log('FAIL: Frontend .env not in .gitignore');

// Check Gitleaks config
const gitleaks = fs.readFileSync('.gitleaks.toml', 'utf8');
if (gitleaks.includes('allowlist') && gitleaks.includes('allowlist')) console.log('PASS: Gitleaks config with allowlist');
else console.log('FAIL: Gitleaks config missing');

// Check .env files not committed
const envFiles = require('fs').readdirSync('.').filter(f => f.startsWith('.env') && !f.endsWith('.example') && !f.endsWith('.template'));
console.log('.env files in root:', envFiles);

// Check frontend .gitignore
const frontendGitignore2 = fs.readFileSync('ethertrack-frontend/.gitignore', 'utf8');
if (frontendGitignore2.includes('.env') || frontendGitignore2.includes('*.env')) console.log('PASS: Frontend .env in .gitignore');
else console.log('FAIL: Frontend .env not in .gitignore');