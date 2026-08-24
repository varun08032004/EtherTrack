import fs from 'fs';
import path from 'path';

function fixImports(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fixImports(fullPath);
    } else if (file.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      // Fix ../../db/pool.js -> ../../../db/pool.js
      const oldPattern1 = "from '../../db/pool.js'";
      const oldPattern2 = "from '../../db/pool'";
      const newPattern = "from '../../../db/pool.js'";
      
      if (content.includes(oldPattern1) || content.includes(oldPattern2)) {
        content = content.replace(new RegExp(oldPattern1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newPattern);
        content = content.replace(new RegExp(oldPattern2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newPattern);
        fs.writeFileSync(fullPath, content);
        console.log('Fixed:', fullPath);
      }
    }
  }
}

fixImports('C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\src\\services');