// scripts/backup-critical-data.js — EtherTrack
// Custom backup script for critical data (runs via cron)
// Supports: wallet_transactions, subscription_payments, trades, users, kyc_submissions
// Outputs: timestamped JSON files + Supabase storage upload
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../services/logger');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '../backups');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS) || 30;

const CRITICAL_TABLES = [
  { name: 'wallet_transactions', pk: 'id', orderBy: 'created_at DESC' },
  { name: 'subscription_payments', pk: 'id', orderBy: 'created_at DESC' },
  { name: 'trades', pk: 'id', orderBy: 'created_at DESC' },
  { name: 'users', pk: 'id', orderBy: 'created_at DESC' },
  { name: 'kyc_submissions', pk: 'id', orderBy: 'submitted_at DESC' },
  { name: 'credit_ledger_entries', pk: 'id', orderBy: 'created_at DESC' },
  { name: 'credit_ledger_balances', pk: 'user_id,token_id', orderBy: 'updated_at DESC' },
  { name: 'carbon_batches', pk: 'id', orderBy: 'created_at DESC' },
  { name: 'projects', pk: 'id', orderBy: 'created_at DESC' },
  { name: 'admin_audit_log', pk: 'id', orderBy: 'created_at DESC' },
];

async function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

async function cleanupOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('backup-') && f.endsWith('.json.gz'))
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

async function backupTable(pool, table) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${table.name}-${timestamp}.json.gz`;
  const filepath = path.join(BACKUP_DIR, filename);

  logger.info({ table: table.name }, 'Starting backup');

  const query = `SELECT * FROM ${table.name} ORDER BY ${table.orderBy}`;
  const { rows } = await pool.query(query);

  // Write compressed JSON
  const json = JSON.stringify({
    table: table.name,
    exportedAt: new Date().toISOString(),
    recordCount: rows.length,
    primaryKey: table.pk,
    data: rows
  }, null, 2);

  const gzip = execSync(`gzip -c`, { input: json, maxBuffer: 50 * 1024 * 1024 });
  fs.writeFileSync(filepath, gzip);

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
        contentType: 'application/gzip',
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
      .filter(f => f.startsWith('backup-') && f.endsWith('.json.gz'))
      .filter(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return stat.mtime.getTime() > startTime - 60000; // Created in last minute
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

main().catch(e => {
  logger.error({ err: e.message, stack: e.stack }, 'Backup script failed');
  process.exit(1);
});