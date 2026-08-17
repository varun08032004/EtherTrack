// scripts/restore-from-backup.js — EtherTrack
// Restores critical data from backup files (disaster recovery)
// Usage: node restore-from-backup.js --file backup-wallet_transactions-2024-01-15T10-30-00.json.gz.enc --table wallet_transactions
//        node restore-from-backup.js --manifest backup-manifest-2024-01-15T10-30-00.json --tables wallet_transactions,trades
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const logger = require('../services/logger');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '../backups');

// Encryption key from environment (base64 encoded 32-byte key)
const ENCRYPTION_KEY_B64 = process.env.BACKUP_ENCRYPTION_KEY;
const ENCRYPTION_KEY = ENCRYPTION_KEY_B64 ? Buffer.from(ENCRYPTION_KEY_B64, 'base64') : null;

function decrypt(encryptedData) {
  if (!ENCRYPTION_KEY) {
    // Assume unencrypted if no key provided
    return encryptedData;
  }
  // Format: IV (12 bytes) + AuthTag (16 bytes) + Encrypted Data
  if (encryptedData.length < 28) {
    throw new Error('Invalid encrypted data format');
  }
  const iv = encryptedData.subarray(0, 12);
  const authTag = encryptedData.subarray(12, 28);
  const encrypted = encryptedData.subarray(28);
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted;
}

async function restoreTable(pool, tableName, filepath, options = {}) {
  logger.info({ table: tableName, file: path.basename(filepath) }, 'Starting restore');

  // Read and decrypt
  const encryptedData = fs.readFileSync(filepath);
  const decrypted = decrypt(encryptedData);
  
  // Decompress
  const decompressed = execSync(`gunzip -c`, { input: decrypted, maxBuffer: 100 * 1024 * 1024 });
  const backup = JSON.parse(decompressed.toString());

  if (backup.table !== tableName) {
    throw new Error(`Backup file table (${backup.table}) doesn't match target (${tableName})`);
  }

  const records = backup.data;
  if (!records.length) {
    logger.warn({ table: tableName }, 'No records to restore');
    return { table: tableName, restored: 0 };
  }

  // Get column names from backup metadata or first record
  const columns = backup.columns || Object.keys(records[0]);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const columnNames = columns.join(', ');

  // Check if table exists and get primary key
  const pkResult = await pool.query(`
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = $1::regclass AND i.indisprimary
  `, [tableName]);
  
  const primaryKey = pkResult.rows[0]?.attname || 'id';

  let restored = 0;
  let skipped = 0;
  const batchSize = 100;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const record of batch) {
        const values = columns.map(c => record[c]);
        
        // Upsert on primary key
        const conflictColumns = primaryKey;
        const updateColumns = columns.filter(c => c !== primaryKey).map(c => `${c} = EXCLUDED.${c}`).join(', ');
        
        const query = `
          INSERT INTO ${tableName} (${columnNames})
          VALUES (${placeholders})
          ON CONFLICT (${conflictColumns}) DO UPDATE SET ${updateColumns}
        `;
        
        await client.query(query, values);
        restored++;
      }
      
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      logger.error({ table: tableName, err: e.message, batch: i }, 'Batch restore failed');
      if (!options.continueOnError) throw e;
    } finally {
      client.release();
    }
  }

  logger.info({ table: tableName, restored, skipped }, 'Restore completed');
  return { table: tableName, restored, skipped };
}

async function restoreFromManifest(pool, manifestPath, tableFilter) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const tablesToRestore = tableFilter 
    ? tableFilter.split(',').map(t => t.trim())
    : manifest.tables.map(t => t.table);

  logger.info({ tables: tablesToRestore }, 'Restoring from manifest');

  const results = [];
  for (const tableInfo of manifest.tables) {
    if (!tablesToRestore.includes(tableInfo.table)) continue;

    const filepath = path.join(BACKUP_DIR, tableInfo.file);
    if (!fs.existsSync(filepath)) {
      logger.warn({ file: tableInfo.file }, 'Backup file not found, skipping');
      continue;
    }

    try {
      const result = await restoreTable(pool, tableInfo.table, filepath, { continueOnError: true });
      results.push(result);
    } catch (e) {
      logger.error({ table: tableInfo.table, err: e.message }, 'Table restore failed');
      if (!tableInfo.optional) throw e;
    }
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage:
  node restore-from-backup.js --file <backup-file> --table <table-name>
  node restore-from-backup.js --manifest <manifest-file> [--tables table1,table2]

Options:
  --file <path>       Single backup file to restore
  --table <name>      Target table name (required with --file)
  --manifest <path>   Manifest file to restore multiple tables
  --tables <list>     Comma-separated tables to restore from manifest
  --continue-on-error Continue restoring other tables if one fails
  --dry-run           Show what would be restored without making changes
  --help              Show this help
`);
    process.exit(0);
  }

  const fileIndex = args.indexOf('--file');
  const tableIndex = args.indexOf('--table');
  const manifestIndex = args.indexOf('--manifest');
  const tablesIndex = args.indexOf('--tables');
  const continueOnError = args.includes('--continue-on-error');
  const dryRun = args.includes('--dry-run');

  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL not configured');
    process.exit(1);
  }

  if (!process.env.BACKUP_ENCRYPTION_KEY) {
    logger.warn('BACKUP_ENCRYPTION_KEY not set — assuming unencrypted backups');
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    if (fileIndex >= 0 && tableIndex >= 0) {
      const file = args[fileIndex + 1];
      const table = args[tableIndex + 1];
      const filepath = path.isAbsolute(file) ? file : path.join(BACKUP_DIR, file);

      if (!fs.existsSync(filepath)) {
        logger.error({ file: filepath }, 'Backup file not found');
        process.exit(1);
      }

      if (dryRun) {
        logger.info({ file: filepath, table }, 'DRY RUN: Would restore');
        process.exit(0);
      }

      await restoreTable(pool, table, filepath, { continueOnError });
    } else if (manifestIndex >= 0) {
      const manifestFile = args[manifestIndex + 1];
      const manifestPath = path.isAbsolute(manifestFile) ? manifestFile : path.join(BACKUP_DIR, manifestFile);
      const tableFilter = tablesIndex >= 0 ? args[tablesIndex + 1] : null;

      if (!fs.existsSync(manifestPath)) {
        logger.error({ file: manifestPath }, 'Manifest file not found');
        process.exit(1);
      }

      if (dryRun) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const tables = tableFilter 
          ? tableFilter.split(',').map(t => t.trim())
          : manifest.tables.map(t => t.table);
        logger.info({ manifest: manifestPath, tables }, 'DRY RUN: Would restore');
        process.exit(0);
      }

      await restoreFromManifest(pool, manifestPath, tableFilter);
    } else {
      logger.error('Either --file --table or --manifest required');
      process.exit(1);
    }

    logger.info('Restore completed successfully');
  } catch (e) {
    logger.error({ err: e.message, stack: e.stack }, 'Restore failed');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();