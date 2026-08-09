// XSS Audit - Find dangerous patterns
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

const allFiles = walk('.').filter(f => !f.includes('node_modules') && !f.includes('.git'));

const patterns = [
  { name: 'res.send with template literal', regex: /res\.(send|json|render)\(`/ },
  { name: 'res.send with concat', regex: /res\.(send|json)\([^)]*\+/ },
  { name: 'innerHTML / dangerouslySetInnerHTML', regex: /(innerHTML|dangerouslySetInnerHTML)/ },
  { name: 'eval / Function constructor', regex: /\b(eval|new Function)\s*\(/ },
  { name: 'document.write', regex: /document\.write/ },
];

console.log('=== XSS AUDIT RESULTS ===\n');

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
  console.log('No obvious XSS patterns found in backend JS.');
} else {
  findings.forEach(f => console.log(f.file + ':' + f.line + ' [' + f.type + '] ' + f.code));
  console.log('\nTotal: ' + findings.length);
}

// Also check for user input reflection without sanitization
console.log('\n=== USER INPUT REFLECTION CHECK ===\n');
let reflections = [];
for (const f of allFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for req.body/req.query/req.params used directly in response
    if ((line.includes('req.body') || line.includes('req.query') || line.includes('req.params')) &&
        (line.includes('res.') || line.includes('return ')) &&
        !line.includes('sanitize') && !line.includes('validate') &&
        !line.includes('san') && !line.trim().startsWith('//')) {
      reflections.push({ file: f, line: i+1, code: line.trim().substring(0, 150) });
    }
  }
}

reflections.slice(0, 50).forEach(f => console.log(f.file + ':' + f.line + ' ' + f.code));
console.log('\nTotal potential reflections: ' + reflections.length);