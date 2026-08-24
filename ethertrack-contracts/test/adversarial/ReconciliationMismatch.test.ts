// Adversarial Test: Reconciliation Mismatch Detection
// Tests that DB/chain divergences are detected and surfaced

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ethers } from 'ethers';
import { createTestUsers, cleanupTestUsers } from '../utils/test-utils.js';
import { setupContracts } from '../utils/contract-utils.js';
import { ReconciliationEngine } from '../../../src/services/reconciliation/ReconciliationEngine.js';
import { safeQuery as query } from '../../../db/pool.js';

describe('Reconciliation Mismatch Detection', () => {
  let carbonCreditToken: any;
  let creditLedger: any;
  let kycRegistry: any;
  let deployer: any;
  let user1: any;
  let provider: ethers.JsonRpcProvider;
  let wallet1: ethers.Wallet;
  let reconciliationEngine: ReconciliationEngine;

  beforeAll(async () => {
    const contracts = await setupContracts();
    carbonCreditToken = contracts.carbonCreditToken;
    creditLedger = contracts.creditLedger;
    kycRegistry = contracts.kycRegistry;
    deployer = contracts.deployer;
    provider = contracts.provider;

    const users = await createTestUsers(1);
    user1 = users[0];

    const wallet1 = new ethers.Wallet(user1.privateKey, provider);

    await kycRegistry.verifyKYC(user1.idHash, user1.kycDataHash);
    await kycRegistry.linkWallet(user1.idHash, user1.walletAddress);

    reconciliationEngine = new ReconciliationEngine();
  });

  it('should detect financial ledger imbalance (debit != credit)', async () => {
    // Manually create unbalanced journal entry
    const { rows } = await query(
      `INSERT INTO journal_entries (entry_id, entry_number, entry_date, reference_type, reference_id, description, created_by)
       VALUES (extensions.uuid_generate_v4(), nextval('journal_entries_entry_number_seq'), NOW(), 'TEST', extensions.uuid_generate_v4(), 'Test unbalanced', $1)
       RETURNING entry_id`,
       [deployer.id]
    );
    const entryId = rows[0].entry_id;

    // Create unbalanced lines (debit != credit)
    await query(
      `INSERT INTO journal_lines (entry_id, account_id, debit_amount, credit_amount, description, line_number)
       VALUES ($1, (SELECT account_id FROM financial_accounts WHERE account_code = '1100'), 100, 0, 'Test debit', 1),
             ($1, (SELECT account_id FROM financial_accounts WHERE account_code = '4100'), 0, 50, 'Test credit', 2)`,
      [entryId]
    );

    // Run reconciliation
    const results = await reconciliationEngine.runAllChecks();
    const financialCheck = results.find(r => r.checkName === 'financial_ledger_integrity');
    
    expect(financialCheck.status).toBe('FAIL');
    expect(financialCheck.mismatches).toBeGreaterThan(0);

    // Cleanup
    await query(`DELETE FROM journal_lines WHERE entry_id = $1`, [entryId]);
    await query(`DELETE FROM journal_entries WHERE entry_id = $1`, [entryId]);
  });

  it('should detect carbon ledger conservation violation', async () => {
    // Manually create unbalanced carbon journal entry
    const { rows } = await query(
      `INSERT INTO carbon_journal_entries (entry_id, entry_number, entry_date, reference_type, reference_id, description, created_by)
       VALUES (extensions.uuid_generate_v4(), nextval('carbon_journal_entries_entry_number_seq'), NOW(), 'TEST', extensions.uuid_generate_v4(), 'Test unbalanced', $1)
       RETURNING entry_id`,
       [deployer.id]
    );
    const entryId = rows[0].entry_id;

    // Get asset account
    const { rows: assetRows } = await query(
      `SELECT account_id FROM carbon_accounts WHERE account_type = 'ASSET_INVENTORY' LIMIT 1`
    );
    const assetAccountId = assetRows[0].account_id;

    // Create unbalanced carbon lines
    await query(
      `INSERT INTO carbon_journal_lines (entry_id, account_id, debit_quantity, credit_quantity, description, line_number)
       VALUES ($1, $2, 100, 0, 'Test debit', 1),
              ($1, (SELECT account_id FROM carbon_accounts WHERE account_type = 'OWNER_POSITION' LIMIT 1), 0, 50, 'Test credit', 2)`,
      [entryId, assetAccountId]
    );

    // Run reconciliation
    const results = await reconciliationEngine.runAllChecks();
    const carbonCheck = results.find(r => r.checkName === 'carbon_ledger_integrity');
    
    expect(carbonCheck.status).toBe('FAIL');
    expect(carbonCheck.mismatches).toBeGreaterThan(0);

    // Cleanup
    await query(`DELETE FROM carbon_journal_lines WHERE entry_id = $1`, [entryId]);
    await query(`DELETE FROM carbon_journal_entries WHERE entry_id = $1`, [entryId]);
  });

  it('should detect carbon conservation violation (issued != accounted)', async () => {
    // Create asset with known supply
    const { rows } = await query(
      `INSERT INTO carbon_assets (asset_id, batch_code, registry, standard, vintage, methodology, serial_number, total_supply, retired_supply, status, project_id)
       VALUES (extensions.uuid_generate_v4(), 'TEST-001', 'VCS', 'VM001', 2024, 'Test Method', 'SN123', 1000, 0, 'active', (SELECT id FROM projects LIMIT 1))
       RETURNING asset_id`,
    );
    const assetId = rows[0].asset_id;

    // Create accounts with wrong totals
    const { rows: assetAccountRows } = await query(
      `INSERT INTO carbon_accounts (account_code, account_type, batch_id, owner_id, custody_type)
       VALUES ('ASSET:TEST:001', 'ASSET_INVENTORY', $1, NULL, 'ledger')
       RETURNING account_id`,
      [assetId]
    );
    const assetAccountId = assetAccountRows[0].account_id;

    const { rows: positionRows } = await query(
      `INSERT INTO carbon_accounts (account_code, account_type, batch_id, owner_id, custody_type)
       VALUES ('POS:USER1:TEST', 'OWNER_POSITION', $1, $2, 'ledger')
       RETURNING account_id`,
      [assetId, deployer.id]
    );
    const positionAccountId = positionRows[0].account_id;

    // Set balances that don't add up (issued=1000, but accounted=800)
    await query(
      `INSERT INTO carbon_account_balances (account_id, balance)
       VALUES ($1, 500), ($2, 300)
       ON CONFLICT (account_id) DO UPDATE SET balance = EXCLUDED.balance`,
      [assetAccountId, positionAccountId]
    );

    // Run reconciliation
    const results = await reconciliationEngine.runAllChecks();
    const conservationCheck = results.find(r => r.checkName === 'carbon_conservation');
    
    expect(conservationCheck.status).toBe('FAIL');
    expect(conservationCheck.mismatches).toBeGreaterThan(0);
  });

  it('should detect reserved > balance violation', async () => {
    // Create carbon account with reserved > balance
    const { rows: assetAccountRows } = await query(
      `INSERT INTO carbon_accounts (account_code, account_type, batch_id, owner_id, custody_type, reserved_balance)
       VALUES ('POS:USER1:TEST2', 'OWNER_POSITION', (SELECT id FROM carbon_batches LIMIT 1), $1, 'ledger', 100)
       RETURNING account_id`,
      [deployer.id]
    );
    const accountId = assetAccountRows[0].account_id;

    // Set balance less than reserved
    await query(
      `INSERT INTO carbon_account_balances (account_id, balance)
       VALUES ($1, 50)
       ON CONFLICT (account_id) DO UPDATE SET balance = 50`,
      [accountId]
    );

    // Run reconciliation
    const results = await reconciliationEngine.runAllChecks();
    const carbonCheck = results.find(r => r.checkName === 'carbon_ledger_integrity');
    
    expect(carbonCheck.status).toBe('FAIL');
    expect(carbonCheck.details.reservedExceedsBalance).toBeGreaterThan(0);
  });
});