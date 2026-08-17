require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const MIGRATIONS_TABLE = 'schema_migrations';

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      version VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      checksum VARCHAR(64)
    );
    CREATE INDEX IF NOT EXISTS idx_${MIGRATIONS_TABLE}_applied_at ON ${MIGRATIONS_TABLE}(applied_at);
  `);
}

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .map(f => {
      const version = f.split('_')[0];
      const name = f.replace(`${version}_`, '').replace('.sql', '');
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      const checksum = require('crypto').createHash('sha256').update(content).digest('hex').substring(0, 16);
      return { version, name, file: f, content, checksum };
    })
    .sort((a, b) => a.version.localeCompare(b.version));
}

async function getAppliedMigrations() {
  const result = await pool.query(`SELECT version, checksum FROM ${MIGRATIONS_TABLE} ORDER BY version`);
  return result.rows.reduce((acc, row) => {
    acc[row.version] = row.checksum;
    return acc;
  }, {});
}

function calculateChecksum(content) {
  return require('crypto').createHash('sha256').update(content).digest('hex').substring(0, 16);
}

async function migrateUp(targetVersion = null) {
  console.log('Running EtherTrack DB migrations...');
  
  await ensureMigrationsTable();
  const migrations = getMigrationFiles();
  const applied = await getAppliedMigrations();
  
  if (migrations.length === 0) {
    console.log('No migration files found');
    return;
  }
  
  let appliedCount = 0;
  
  for (const migration of migrations) {
    if (targetVersion && migration.version > targetVersion) {
      break;
    }
    
    if (applied[migration.version]) {
      if (applied[migration.version] !== migration.checksum) {
        console.error(`❌ Checksum mismatch for migration ${migration.version}!`);
        console.error('   Database has different content than migration file.');
        console.error('   This indicates the migration file was modified after being applied.');
        process.exit(1);
      }
      console.log(`⏭️  Skipping ${migration.version} (already applied)`);
      continue;
    }
    
    console.log(`🔄 Applying ${migration.version}: ${migration.name}...`);
    
    try {
      await pool.query('BEGIN');
      await pool.query(migration.content);
      await pool.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (version, name, checksum) VALUES ($1, $2, $3)
         ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name, checksum = EXCLUDED.checksum, applied_at = NOW()`,
        [migration.version, migration.name, migration.checksum]
      );
      await pool.query('COMMIT');
      
      console.log(`✅ Applied ${migration.version}: ${migration.name}`);
      appliedCount++;
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error(`❌ Failed to apply ${migration.version}:`, e.message);
      throw e;
    }
  }
  
  if (appliedCount === 0) {
    console.log('✅ Database is up to date');
  } else {
    console.log(`✅ Applied ${appliedCount} migration(s) successfully`);
  }
}

async function migrateDown(targetVersion) {
  if (!targetVersion) {
    console.error('Target version required for rollback');
    process.exit(1);
  }
  
  console.log(`Rolling back to version: ${targetVersion}`);
  
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const migrations = getMigrationFiles().reverse();
  
  let rolledBack = 0;
  
  for (const migration of migrations) {
    if (migration.version <= targetVersion) {
      break;
    }
    
    if (!applied[migration.version]) {
      console.log(`⏭️  ${migration.version} not applied, skipping`);
      continue;
    }
    
    console.log(`🔄 Rolling back ${migration.version}...`);
    
    // For rollback, we need down migration files
    const downFile = path.join(__dirname, 'migrations', `${migration.version}_${migration.name}.down.sql`);
    if (!fs.existsSync(downFile)) {
      console.error(`❌ No down migration file found: ${downFile}`);
      console.error('   Create a .down.sql file for rollback support');
      process.exit(1);
    }
    
    const downContent = fs.readFileSync(downFile, 'utf8');
    
    try {
      await pool.query('BEGIN');
      await pool.query(downContent);
      await pool.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE version = $1`, [migration.version]);
      await pool.query('COMMIT');
      
      console.log(`✅ Rolled back ${migration.version}`);
    } catch (e) {
      await pool.query('ROLLBACK');
      console.error(`❌ Failed to rollback ${migration.version}:`, e.message);
      throw e;
    }
  }
  
  console.log(`✅ Rollback completed`);
}

async function showStatus() {
  await ensureMigrationsTable();
  const migrations = getMigrationFiles();
  const applied = await getAppliedMigrations();
  
  console.log('\n📋 Migration Status:');
  console.log('════════════════════════════════════════');
  
  if (migrations.length === 0) {
    console.log('No migration files found');
    return;
  }
  
  for (const migration of migrations) {
    const isApplied = !!applied[migration.version];
    const status = isApplied ? '✅ Applied' : '⏳ Pending';
    const checksumMatch = isApplied && applied[migration.version] === migration.checksum ? '✓' : (isApplied ? '⚠️ MISMATCH' : '');
    
    console.log(`  ${migration.version} | ${migration.name.padEnd(40)} | ${status} ${checksumMatch}`);
  }
  
  const pending = migrations.filter(m => !applied[m.version]);
  const appliedCount = Object.keys(applied).length;
  
  console.log(`\n📊 Summary: ${appliedCount} applied, ${pending.length} pending`);
  
  if (pending.length > 0) {
    console.log('\n📋 Pending migrations:');
    pending.forEach(m => console.log(`  - ${m.version}: ${m.name}`));
  }
}

async function createMigration(name) {
  if (!name) {
    console.error('Usage: node migrate.js create <migration_name>');
    process.exit(1);
  }
  
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0];
  const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const filename = `${Date.now()}_${safeName}.sql`;
  const filepath = path.join(MIGRATIONS_DIR, filename);
  
  const template = `-- Migration: ${name}
-- Date: ${new Date().toISOString().split('T')[0]}
-- Description: ${name}

BEGIN;

-- Add your SQL here

COMMIT;
`;
  
  fs.writeFileSync(path.join(MIGRATIONS_DIR, filename), template);
  console.log(`✅ Created migration: ${filename}`);
}

async function validateMigrations() {
  console.log('Validating migration files...');
  
  const migrations = getMigrationFiles();
  let errors = 0;
  
  for (const m of migrations) {
    if (!/^\d{14}$/.test(m.version)) {
      console.error(`❌ Invalid version format: ${m.version} (expected YYYYMMDDHHMMSS)`);
      errors++;
    }
    
    if (!m.content.includes('BEGIN;')) {
      console.warn(`⚠️  Missing BEGIN in ${m.version}`);
    }
    if (!m.content.includes('COMMIT;')) {
      console.warn(`⚠️  Missing COMMIT in ${m.version}`);
    }
    
    // Check for dangerous operations
    const dangerous = ['DROP TABLE', 'DROP DATABASE', 'TRUNCATE', 'ALTER TABLE ... DROP'];
    for (const danger of dangerous) {
      if (m.content.toUpperCase().includes(danger.toUpperCase())) {
        console.warn(`⚠️  Potentially dangerous operation "${danger}" in ${m.version}`);
      }
    }
  }
  
  if (errors > 0) {
    console.error(`\n❌ Found ${errors} validation error(s)`);
    process.exit(1);
  } else {
    console.log('✅ All migration files valid');
  }
}

async function main() {
  const command = process.argv[2];
  const arg = process.argv[3];
  
  try {
    switch (command) {
      case 'up':
        await migrateUp(process.argv[3]);
        break;
      case 'down':
        if (!process.argv[3]) {
          console.error('Target version required for rollback');
          process.exit(1);
        }
        await migrateDown(process.argv[3]);
        break;
      case 'status':
        await showStatus();
        break;
      case 'create':
        await createMigration(process.argv[3]);
        break;
      case 'validate':
        await validateMigrations();
        break;
      default:
        console.log(`
EtherTrack Database Migration Tool

Usage: node migrate.js <command> [args]

Commands:
  up [version]     Run pending migrations (up to version if specified)
  down <version>   Rollback to specific version
  status           Show migration status
  create <name>    Create new migration file
  validate         Validate migration files

Examples:
  node migrate.js up
  node migrate.js up 20260815000001
  node migrate.js down 20260815000001
  node migrate.js status
  node migrate.js create add_user_kyc_status
  node migrate.js validate
`);
    }
  } catch (e) {
    console.error('Migration error:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();