// scripts/backup-cron.js — EtherTrack
// Cron wrapper for backup-critical-data.js with locking to prevent concurrent runs
'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const { execSync } = require('child_process');
const logger = require('../services/logger');

const LOCK_KEY = 'backup:critical-data:lock';
const LOCK_TTL = 30 * 60 * 1000; // 30 minutes

async function acquireLock(pool) {
  const result = await pool.query(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET 
      value = $2, 
      updated_at = NOW()
    WHERE app_state.updated_at < NOW() - INTERVAL '30 minutes'
    RETURNING key
  `, [LOCK_KEY, process.pid.toString()]);
  
  return result.rowCount > 0;
}

async function releaseLock(pool) {
  await pool.query(`DELETE FROM app_state WHERE key = $1 AND value = $2`, [LOCK_KEY, process.pid.toString()]);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL not configured');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const hasLock = await acquireLock(pool);
  if (!hasLock) {
    logger.info('Backup already running, skipping');
    await pool.end();
    process.exit(0);
  }

  logger.info('Acquired backup lock, starting backup');

  try {
    execSync(`node ${__dirname}/backup-critical-data.js`, {
      stdio: 'inherit',
      timeout: 15 * 60 * 1000 // 15 minutes max
    });
    logger.info('Backup completed successfully');
  } catch (e) {
    logger.error({ err: e.message }, 'Backup failed');
    process.exitCode = 1;
  } finally {
    await releaseLock(pool);
    await pool.end();
  }
}

main().catch(e => {
  logger.error({ err: e.message }, 'Backup cron failed');
  process.exit(1);
});