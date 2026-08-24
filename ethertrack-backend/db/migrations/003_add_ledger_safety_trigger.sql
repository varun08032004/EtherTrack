-- Migration: Add safety trigger for tokenised batches
-- Ensures credit_ledger_balances entry exists when carbon_batches gets token_id

BEGIN;

-- Function to auto-create ledger balance on tokenisation
CREATE OR REPLACE FUNCTION ensure_credit_ledger_on_tokenise()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act when token_id is set and custody_model is pooled
  IF NEW.token_id IS NOT NULL 
     AND NEW.custody_model = 'pooled'
     AND (OLD.token_id IS NULL OR OLD.custody_model != 'pooled') THEN
    
    -- Get the quantity from the batch
    DECLARE
      credit_amount INTEGER := COALESCE(NEW.quantity, NEW.total_credits, NEW.available_credits, 0);
      user_id_hash BYTEA;
      ref_hash BYTEA;
    BEGIN
      -- Insert/update credit_ledger_balances
      INSERT INTO credit_ledger_balances (user_id, token_id, balance, total_retired)
      VALUES (NEW.user_id, NEW.token_id, credit_amount, 0)
      ON CONFLICT (user_id, token_id) DO UPDATE SET
        balance = EXCLUDED.balance,
        updated_at = NOW();
      
      -- Add ledger entry
      user_id_hash := encode(digest(NEW.user_id::TEXT, 'sha256'), 'hex')::BYTEA;
      ref_hash := encode(digest(
        NEW.user_id || ':' || NEW.token_id || ':' || credit_amount || ':MINT:carbon_batches:' || NEW.id, 
        'sha256'
      ), 'hex')::BYTEA;
      
      INSERT INTO credit_ledger_entries 
        (user_id, user_id_hash, token_id, amount_delta, action_type, ref_hash, ref_table, ref_id, note, chain_status)
      VALUES 
        (NEW.user_id, user_id_hash, NEW.token_id, credit_amount, 'MINT', ref_hash, 'carbon_batches', NEW.id, 'Auto-created on tokenisation', 'confirmed');
      
      RAISE NOTICE 'Auto-created ledger for batch % token % amount %', NEW.id, NEW.token_id, credit_amount;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger
DROP TRIGGER IF EXISTS trg_ensure_ledger_on_tokenise ON carbon_batches;
CREATE TRIGGER trg_ensure_ledger_on_tokenise
AFTER UPDATE OF token_id, custody_model ON carbon_batches
FOR EACH ROW
EXECUTE FUNCTION ensure_credit_ledger_on_tokenise();

COMMIT;