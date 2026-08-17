const fs = require('fs');
const content = fs.readFileSync('C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\services\\cacheStrategy.js', 'utf8');
let braces = 0;
let lastOpen = -1;
for (let i = 0; i < content.length; i++) {
  if (content[i] === '{') { braces++; lastOpen = i; }
  if (content[i] === '}') braces--;
  if (braces < 0) { console.log('Extra closing at', i); break; }
}
console.log('Final brace count:', braces);
if (braces > 0) {
  console.log('Missing', braces, 'closing braces');
  // Find the last unmatched opening brace
  let count = 0;
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i] === '}') count++;
    if (content[i] === '{') {
      count--;
      if (count <= 0) {
        console.log('Unmatched { at position', i, 'context:', content.slice(i, i+50));
        break;
      }
    }
  }