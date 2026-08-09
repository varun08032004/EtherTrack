// Rate Limiting Coverage Audit
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

const limiterNames = [
  'kycSubmitLimiter',
  'adminActionLimiter',
  'tradeLimiter',
  'writeLimiter',
  'walletWriteLimiter',
  'walletActionLimiter',
  'destructiveLimiter',
  'entityActionLimiter',
  'orgActionLimiter',
  'alertLimiter',
  'watchlistLimiter',
  'twoFactorLimiter',
  'readLimiter',
];

console.log('=== RATE LIMITING COVERAGE ===\n');

let withLimiter = 0;
let withoutLimiter = 0;
let getWithoutLimiter = 0;

for (const f of allFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/router\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/);
    if (match) {
      const method = match[1].toUpperCase();
      const route = match[2];
      
      // Check for rate limiter in the same line or next few lines
      let hasLimiter = false;
      let limiterName = '';
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        for (const lim of limiterNames) {
          if (lines[j].includes(lim)) {
            hasLimiter = true;
            limiterName = lim;
            break;
          }
        }
        if (hasLimiter) break;
      }
      
      // Also check if router.use has limiter earlier in file
      if (!hasLimiter) {
        const fileContent = lines.join('\n');
        const routerUseMatch = fileContent.match(/router\.use\(([^)]+)\)/g);
        if (routerUseMatch) {
          for (const ru of routerUseMatch) {
            for (const lim of limiterNames) {
              if (ru.includes(lim)) {
                hasLimiter = true;
                limiterName = lim + ' (router.use)';
                break;
              }
            }
            if (hasLimiter) break;
          }
        }
      }
      
      if (hasLimiter) {
        withLimiter++;
        // console.log(f.replace('routes\\\\', '') + ':' + (i+1) + ' ' + method + ' ' + route + ' -> ' + limiterName);
      } else {
        withoutLimiter++;
        if (method === 'GET') getWithoutLimiter++;
        console.log(f.replace('routes\\\\', '') + ':' + (i+1) + ' ' + method + ' ' + route + ' -> NO LIMITER');
      }
    }
  }
}

console.log('\n=== SUMMARY ===');
console.log('With limiter: ' + withLimiter);
console.log('Without limiter: ' + withoutLimiter);
console.log('  GET without limiter: ' + getWithoutLimiter);