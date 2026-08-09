// Find dynamic SQL (table/column names)
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

for (const f of allFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Dynamic table/column names or template interpolation
    if (line.includes('query') && 
        (line.includes('${') || line.includes('table') || line.includes('column')) &&
        !line.startsWith('//') &&
        !line.includes('$1') && !line.includes('$2')) {
      console.log(f + ':' + (i+1) + ' -> ' + line.substring(0, 200));
    }
  }
}