require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });
const { safeQuery: query } = require('./db/pool');

query(`
  SELECT 
    cb.id, cb.project_name, cb.token_id, cb.custody_model,
    cb.quantity, cb.total_credits, cb.available_credits, cb.retired_credits,
    COALESCE(
      (SELECT SUM(ll.amount_remaining) 
       FROM ledger_listings ll 
       WHERE ll.seller_id = cb.user_id 
         AND ll.token_id = cb.token_id 
         AND ll.active = TRUE), 0
    ) AS listed_quantity
  FROM carbon_batches cb
  WHERE cb.user_id = '706c67a4-de98-4a9a-9287-bed77d33b1a4'
    AND cb.admin_status = 'approved'
`)
  .then(r => console.table(r.rows))
  .catch(console.error)
  .finally(() => require('./db/pool').pool.end());