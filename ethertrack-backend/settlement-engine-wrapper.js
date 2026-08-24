require('ts-node').register({
  transpileOnly: true,
  project: './tsconfig.json',
});

const { SettlementEngine } = require('./src/services/settlement/SettlementEngine.ts');

module.exports = { SettlementEngine };