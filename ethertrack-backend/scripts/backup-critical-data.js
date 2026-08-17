// scripts/backup-critical-data.js — EtherTrack
// Custom backup script for critical data (runs via cron)
// Supports: wallet_transactions, subscription_payments, trades, users, kyc_submissions
// Outputs: timestamped JSON files + Supabase storage upload
// SECURITY: Uses explicit column allowlists, AES-256-GCM encryption
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const logger = require('../services/logger');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '../backups');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;

// Encryption key from environment (base64 encoded 32-byte key)
const ENCRYPTION_KEY_B64 = process.env.BACKUP_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY_B64) {
  logger.warn('BACKUP_ENCRYPTION_KEY not set — backups will NOT be encrypted');
}
const ENCRYPTION_KEY = ENCRYPTION_KEY_B64 ? Buffer.from(ENCRYPTION_KEY_B64, 'base64') : null;

// Column allowlists per table — ONLY these columns will be backed up
const COLUMN_ALLOWLISTS = {
  wallet_transactions: [
    'id', 'user_id', 'type', 'method', 'amount', 'status',
    'balance_before', 'balance_after', 'reference',
    'razorpay_order_id', 'razorpay_payment_id', 'razorpay_payout_id',
    'razorpay_signature', 'gst_invoice_no', 'trade_id', 'trade_type',
    'idempotency_key', 'created_at', 'updated_at'
  ],
  subscription_payments: [
    'id', 'user_id', 'plan', 'cycle', 'amount_paise', 'gst_amount_paise',
    'total_amount_paise', 'pay_method', 'status', 'idempotency_key',
    'razorpay_order_id', 'wallet_address', 'signature',
    'metamask_address', 'metamask_message', 'gstin', 'pan',
    'renewal_date', 'amount', 'gst_type', 'buyer_state_code',
    'cgst_paise', 'sgst_paise', 'igst_paise', 'coupon_code',
    'discount_paise', 'invoice_number', 'invoice_url', 'invoice_pdf',
    'webhook_event_id', 'created_at', 'updated_at'
  ],
  trades: [
    'id', 'buyer_id', 'seller_id', 'buyer_wallet', 'seller_wallet',
    'batch_id', 'token_id', 'listing_id_onchain', 'trade_id_onchain',
    'quantity', 'price_per_credit_inr', 'subtotal_inr', 'buyer_fee_inr',
    'seller_fee_inr', 'total_fee_inr', 'buyer_pays_inr', 'seller_receives_inr',
    'price_per_credit_eth', 'total_eth', 'eth_inr_rate', 'fee_eth',
    'payment_mode', 'status', 'tx_hash', 'block_number',
    'buyer_inr_deducted', 'seller_inr_credited', 'inr_settlement_at',
    'completed_at', 'error_message', 'retry_count', 'idempotency_key',
    'chain_tx_hash', 'chain_status', 'chain_block', 'chain_logged_at',
    'gst_inr', 'platform_net_inr', 'razorpay_payment_id', 'razorpay_order_id',
    'trade_invoice_number', 'trade_invoice_pdf', 'trade_invoice_url',
    'trade_invoice_generated_at', 'created_at', 'updated_at'
  ],
  users: [
    'id', 'email', 'full_name', 'wallet_address', 'subscription_plan',
    'subscription_cycle', 'subscription_renewal_date', 'subscription_activated_at',
    'inr_balance', 'inr_balance_paise', 'kyc_verified', 'kyc_status',
    'two_fa_enabled', 'provider', 'created_at', 'updated_at'
    // EXCLUDED: password_hash, email_otp, otp_attempts, company_pan, etc.
  ],
  kyc_submissions: [
    'id', 'user_id', 'id_type', 'id_number_hash', 'aadhaar_hash', 'pan_hash',
    'kyc_type', 'entity_name', 'gstin_hash', 'business_pan_hash', 'cin',
    'doc_ipfs_hash', 'business_doc_ipfs_hash', 'status', 'submitted_at',
    'verified_at', 'rejected_at', 'rejection_reason', 'tier', 'created_at', 'updated_at'
    // EXCLUDED: raw id_number, raw documents
  ],
  credit_ledger_entries: [
    'id', 'onchain_log_id', 'user_id', 'user_id_hash', 'token_id',
    'amount_delta', 'action_type', 'ref_hash', 'ref_table', 'ref_id',
    'note', 'tx_hash', 'block_number', 'chain_status', 'created_at'
  ],
  credit_ledger_balances: [
    'user_id', 'token_id', 'balance', 'total_retired', 'updated_at'
  ],
  carbon_batches: [
    'id', 'project_id', 'token_id', 'batch_number', 'vintage_year',
    'total_credits', 'available_credits', 'listed_quantity', 'retired_credits',
    'status', 'price_per_credit_inr', 'price_per_credit_eth',
    'standard', 'serial_number_from', 'serial_number_to',
    'project_name', 'standard', 'vintage_year', 'created_at', 'updated_at'
  ],
  projects: [
    'id', 'developer_id', 'name', 'project_code', 'standard', 'project_type',
    'status', 'location', 'country', 'vintage_year', 'total_credits',
    'verified_credits', 'methodology', 'verifier_name', 'verifier_contact',
    'ipfs_image_hash', 'created_at', 'updated_at'
  ],
  admin_audit_log: [
    'id', 'admin_id', 'actor_role', 'action', 'meta', 'ip_address', 'created_at'
  ]
};

async function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

async function cleanupOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup-') && f.endsWith('.json.gz.enc'))
    .map(f => ({
      name: f,
      time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of files) {
    if (file.time < cutoff) {
      fs.unlinkSync(path.join(BACKUP_DIR, file.name));
      logger.info({ file: file.name }, 'Deleted old backup');
    }
  }
}

function encrypt(data) {
  if (!ENCRYPTION_KEY) {
    logger.warn('Encryption key not set — writing plaintext backup');
    return Buffer.from(data);
  }
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: IV (12 bytes) + AuthTag (16 bytes) + Encrypted Data
  return Buffer.concat([iv, authTag, encrypted]);
}

async function backupTable(pool, table) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${table.name}-${timestamp}.json.gz.enc`;
  const filepath = path.join(BACKUP_DIR, filename);

  logger.info({ table: table.name }, 'Starting backup');

  const columns = COLUMN_ALLOWLISTS[table.name] || ['*'];
  const columnList = columns.join(', ');
  const query = `SELECT ${columnList} FROM ${table.name} ORDER BY ${table.orderBy}`;
  const { rows } = await pool.query(query);

  // Write compressed JSON then encrypt
  const json = JSON.stringify({
    table: table.name,
    exportedAt: new Date().toISOString(),
    recordCount: rows.length,
    primaryKey: table.pk,
    columns: columns,
    data: rows
  }, null, 2);

  const gzip = execSync(`gzip -c`, { input: json, maxBuffer: 50 * 1024 * 1024 });
  const encrypted = encrypt(gzip);
  fs.writeFileSync(filepath, encrypted);

  const stats = fs.statSync(filepath);
  logger.info({ table: table.name, records: rows.length, size: stats.size, file: filename }, 'Backup completed');

  return {
    table: table.name,
    file: filename,
    records: rows.length,
    size: stats.size,
    timestamp: new Date().toISOString()
  };
}

async function createManifest(backups) {
  const manifest = {
    generatedAt: new Date().toISOString(),
    database: process.env.DATABASE_URL?.split('@')[1] || 'unknown',
    tables: backups,
    totalRecords: backups.reduce((sum, b) => sum + b.records, 0),
    totalSize: backups.reduce((sum, b) => sum + b.size, 0)
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-manifest-${timestamp}.json`;
  const filepath = path.join(BACKUP_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(manifest, null, 2));
  logger.info({ file: filename }, 'Manifest created');
  return manifest;
}

async function uploadToSupabase(filepath) {
  if (!process.env.SUPABASE_BACKUP_BUCKET) {
    logger.warn('SUPABASE_BACKUP_BUCKET not configured, skipping upload');
    return;
  }

  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const filename = path.basename(filepath);
    const { error } = await supabase.storage
      .from(process.env.SUPABASE_BACKUP_BUCKET)
      .upload(`backups/${filename}`, fs.readFileSync(filepath), {
        contentType: 'application/octet-stream',
        upsert: false
      });

    if (error) throw error;
    logger.info({ file: filename }, 'Uploaded to Supabase storage');
  } catch (e) {
    logger.error({ err: e.message, file: filepath }, 'Supabase upload failed');
  }
}

async function main() {
  const startTime = Date.now();
  logger.info('Starting critical data backup');

  await ensureBackupDir();

  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL not configured');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5
  });

  try {
    const results = [];

    for (const table of CRITICAL_TABLES) {
      try {
        const result = await backupTable(pool, table);
        results.push(result);
      } catch (e) {
        logger.error({ table: table.name, err: e.message }, 'Table backup failed');
      }
    }

    await createManifest(results);
    await cleanupOldBackups();

    // Upload all new backups
    const newFiles = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('backup-') && f.endsWith('.json.gz.enc'))
      .filter(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return stat.mtime.getTime() > startTime - 60000;
      });

    for (const file of newFiles) {
      await uploadToSupabase(path.join(BACKUP_DIR, file));
    }

    const duration = Date.now() - startTime;
    logger.info({ durationMs: duration, tables: results.length }, 'Backup completed');
  } finally {
    await pool.end();
  }
}

async function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

async function cleanupOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup-') && f.endsWith('.json.gz.enc'))
    .map(f => ({
      name: f,
      time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of files) {
    if (file.time < cutoff) {
      fs.unlinkSync(path.join(BACKUP_DIR, file.name));
      logger.info({ file: file.name }, 'Deleted old backup');
    }
  }
}

main().catch(e => {
  logger.error({ err: e.message, stack: e.stack }, 'Backup script failed');
  process.exit(1);
});