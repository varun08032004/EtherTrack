const fs = require('fs');

// Check SQL injection protection - parameterized queries
const routesDir = 'routes';
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
let paramQueries = 0;
let rawQueries = 0;

files.forEach(f => {
  const content = fs.readFileSync('routes/' + f, 'utf8');
  // Count parameterized queries (using $1, $2, etc.)
  const paramMatches = content.match(/\$\d+/g);
  if (paramMatches) paramQueries += paramMatches.length;
  
  // Check for raw string concatenation in queries
  const rawMatches = content.match(/query\(['"][^'"]*\$\{[^}]+\}[^'"]*['"]/g);
  if (rawMatches) rawQueries += rawMatches.length;
});

console.log('Parameterized query placeholders found:', paramQueries);
console.log('Potential raw string concatenation in queries:', rawQueries);