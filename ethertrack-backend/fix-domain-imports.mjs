import fs from 'fs';
import path from 'path';

function fixDomainImports(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fixDomainImports(fullPath);
    } else if (file.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      // Fix ../../domain/types.js -> ../../domain/types.ts
      const oldPattern = "from '../../domain/types.js'";
      const newPattern = "from '../../../domain/types.ts'";
      
      if (content.includes(oldPattern)) {
        content = content.replace(new RegExp(oldPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newPattern);
        fs.writeFileSync(fullPath, content);
        console.log('Fixed:', fullPath);
      }
    }
  }
}

fixDomainImports('C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\src\\services');