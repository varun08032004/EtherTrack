-- Run these in Supabase SQL Editor

-- 1. Check ledger balance
SELECT * FROM credit_ledger_balances 
WHERE user_id = '706c67a4-de98-4a9a-9287-bed77d33b1a4' AND token_id = 3;

-- 2. Check ledger entries
SELECT action_type, amount_delta, ref_table, ref_id, tx_hash, block_number, chain_status, created_at
FROM credit_ledger_entries
WHERE user_id = '706c67a4-de98-4a9a-9287-bed77d33b1a4' AND token_id = 3
ORDER BY created_at DESC LIMIT 20;

-- 3. Check active ledger listings
SELECT * FROM ledger_listings 
WHERE seller_id = '706c67a4-de98-4a9a-9287-bed77d33b1a4' AND token_id = 3 AND active = TRUE;

-- 4. Check market cache (if Redis available)
-- The cache key would be like: market:listings:{"standard":"ALL","projectType":"ALL","sortBy":"priceAsc"}