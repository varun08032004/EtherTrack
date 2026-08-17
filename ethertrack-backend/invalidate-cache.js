// invalidate-cache.js
const { cacheStrategy } = require('./services/cacheStrategy');

const userIds = [
  '706c67a4-de98-4a9a-9287-bed77d33b1a4',
  '45aced03-8164-44d8-9f39-c6bb828ba9cd'
];

userIds.forEach(userId => {
  cacheStrategy.invalidate(cacheStrategy.KEYS.portfolioCredits(userId));
  cacheStrategy.invalidate(cacheStrategy.KEYS.portfolioLedger(userId));
  cacheStrategy.invalidate(cacheStrategy.KEYS.portfolioBought(userId));
  console.log(`Invalidated cache for user: ${userId}`);
});

console.log('All cache invalidated');