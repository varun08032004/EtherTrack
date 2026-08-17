const { pool } = require('./db/pool');
pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'carbon_batches'")
  .then(r => console.log(r.rows.map(x => x.column_name)))
  .catch(e => console.error(e))
  .finally(() => pool.end());