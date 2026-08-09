const fs = require('fs');
const content = fs.readFileSync('routes/trades.js', 'utf8');
const lines = content.split('\n');
for (let i = 195; i < 515; i++) {
  const line = lines[i];
  let inSingle = false, inDouble = false;
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    const prev = line[j-1];
    if (ch === "'" && prev !== '\\') inSingle = !inSingle;
    if (ch === '"' && prev !== '\\') inDouble = !inDouble;
  }
  if (inSingle || inDouble) {
    console.log('UNCLOSED QUOTE at line', i+1, ':', lines[i].trim().substring(0, 80));
  }
}