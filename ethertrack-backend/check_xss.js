const fs = require('fs');

// Check frontend XSS protection
const frontendDir = 'ethertrack-frontend/src';
const frontendFiles = fs.readdirSync(frontendDir).filter(f => f.endsWith('.js') || f.endsWith('.jsx'));
let xssWarnings = 0;

frontendFiles.forEach(f => {
  const content = fs.readFileSync('ethertrack-frontend/src/' + f, 'utf8');
  if (content.includes('dangerouslySetInnerHTML')) {
    console.log('WARNING: dangerouslySetInnerHTML in ' + f);
    xssWarnings++;
  }
  if (content.includes('innerHTML')) {
    console.log('WARNING: innerHTML in ' + f);
    xssWarnings++;
  }
});

console.log('Frontend XSS check done. Warnings:', xssWarnings);

// Check components directory
const componentsDir = 'ethertrack-frontend/src/components';
if (fs.existsSync(componentsDir)) {
  fs.readdirSync(componentsDir).filter(f => f.endsWith('.js') || f.endsWith('.jsx')).forEach(f => {
    const content = fs.readFileSync(componentsDir + '/' + f, 'utf8');
    if (content.includes('dangerouslySetInnerHTML')) {
      console.log('WARNING: dangerouslySetInnerHTML in components/' + f);
      xssWarnings++;
    }
    if (content.includes('innerHTML')) {
      console.log('WARNING: innerHTML in components/' + f);
      xssWarnings++;
    }
  });

console.log('Total XSS warnings:', xssWarnings);