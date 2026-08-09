// Frontend Real XSS Patterns
const fs = require('fs');
const path = require('path');

function walk(dir) {
  let files = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else if (f.endsWith('.js') || f.endsWith('.jsx') || f.endsWith('.ts') || f.endsWith('.tsx')) files.push(full);
  }
  return files;
}

const allFiles = walk('src').filter(f => !f.includes('node_modules') && !f.includes('.git'));

const patterns = [
  { name: 'dangerouslySetInnerHTML (actual usage)', regex: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html/ },
  { name: 'innerHTML assignment', regex: /\.innerHTML\s*=/ },
  { name: 'eval / Function constructor', regex: /\b(eval|new Function)\s*\(/ },
  { name: 'document.write', regex: /document\.write/ },
  { name: 'href=javascript:', regex: /href\s*=\s*['"]javascript:/i },
];

console.log('=== FRONTEND REAL XSS PATTERNS ===\n');

let findings = [];
for (const f of allFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of patterns) {
      if (p.regex.test(line) && !line.trim().startsWith('//')) {
        findings.push({ file: f, line: i+1, type: p.name, code: line.trim().substring(0, 150) });
      }
    }
  }
}

if (findings.length === 0) {
  console.log('No actual XSS vulnerabilities found in frontend.');
} else {
  findings.forEach(f => console.log(f.file + ':' + f.line + ' [' + f.type + '] ' + f.code));
  console.log('\nTotal: ' + findings.length);
}