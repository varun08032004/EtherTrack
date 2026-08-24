require('dotenv').config();
const { safeQuery } = require('./db/pool.js');

safeQuery('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')
  .then(() => console.log('Extension created'))
  .catch(console.error);