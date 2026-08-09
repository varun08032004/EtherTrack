// Check backend response types
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
  { name: 'res.send with user input', regex: /res\.send\([^)]*req\.(body|query|params)/ },
  { name: 'res.type text/html', regex: /res\.type\(['"]text\/html/ },
  { name: 'res.writeHead with html', regex: /res\.writeHead\([^)]*text\/html/ },
];

for (const f of allFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of patterns) {
      if (p.regex.test(line) && !line.trim().startsWith('//')) {
        console.log(f + ':' + (i+1) + ' [' + p.name + '] ' + line.trim().substring(0, 150));
      }
    }
  }
}