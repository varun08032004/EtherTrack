-- Migration: Drop ghost MINT trigger
-- The trigger `trg_ensure_ledger_on_tokenise` creates ledger entries when token_id is set
-- on carbon_batches, but this fires BEFORE on-chain mint succeeds, creating ghost entries.
-- The minter service (mintApprovedCredit) properly logs MINT to CreditLedger AFTER
-- successful on-chain mint. Remove the trigger to prevent duplicates/ghost entries.

BEGIN;

DROP TRIGGER IF EXISTS trg_ensure_ledger_on_tokenise ON carbon_batches;
DROP FUNCTION IF EXISTS ensure_credit_ledger_on_tokenise();

COMMIT;