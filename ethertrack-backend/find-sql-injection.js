// Find SQL injection risks - template literals or string concatenation in queries
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
let suspicious = [];

for (const f of allFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if ((line.includes('query') || line.includes('query(')) && 
        (line.includes('`') || (line.includes('+') && !line.includes('$'))) &&
        !line.startsWith('//')) {
      suspicious.push({ file: f, line: i+1, code: line.substring(0, 150) });
    }
  }
}

suspicious.forEach(f => console.log(f.file + ':' + f.line + ' -> ' + f.code));
console.log('\nSuspicious count: ' + suspicious.length);