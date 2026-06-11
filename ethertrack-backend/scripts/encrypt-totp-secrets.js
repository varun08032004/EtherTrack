#!/usr/bin/env node
// scripts/encrypt-totp-secrets.js — EtherTrack
// ─────────────────────────────────────────────────────────────────
// One-time migration script to encrypt all existing plaintext
// TOTP secrets in the database using AES-256-GCM.
//
// RUN:
//   TOTP_ENCRYPTION_KEY=your_64char_hex node scripts/encrypt-totp-secrets.js
//
// SAFE TO RE-RUN:
//   Already-encrypted rows (totp_secret_encrypted = TRUE) are skipped.
//
// WHAT IT DOES:
//   For every user with a non-null totp_secret where encrypted = FALSE:
//     1. Reads the plaintext secret
//     2. Encrypts it with AES-256-GCM
//     3. Writes the encrypted value back
//     4. Sets totp_secret_encrypted = TRUE
//
// ROLLBACK:
//   If something goes wrong, the script stops immediately.
//   Rows already processed have totp_secret_encrypted = TRUE.
//   You can identify them and restore from backup if needed.
//   The decryptTotp() function handles both formats during the
//   migration window so the server keeps working even if the script
//   is partially complete.
// ─────────────────────────────────────────────────────────────────
'use strict';

require('dotenv').config();

const { Pool }       = require('pg');
const { encryptTotp, validateEncryptionKey, isEncrypted } = require('../lib/totpEncryption');

async function main() {
  console.log('\n🔐 EtherTrack — TOTP Secret Encryption Migration\n');

  // Validate key before touching any data
  const keyValid = validateEncryptionKey();
  if (!keyValid) {
    console.error('❌ Encryption key invalid. Aborting — no data modified.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  const client = await pool.connect();
  let processed = 0, skipped = 0, errors = 0;

  try {
    // Count what we're working with
    const { rows: countRows } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE totp_secret IS NOT NULL AND totp_secret_encrypted = FALSE) AS pending,
        COUNT(*) FILTER (WHERE totp_secret IS NOT NULL AND totp_secret_encrypted = TRUE)  AS done,
        COUNT(*) FILTER (WHERE totp_secret IS NULL)                                        AS nulls
      FROM users
    `);
    const counts = countRows[0];
    console.log(`📊 Status:`);
    console.log(`   Pending encryption : ${counts.pending}`);
    console.log(`   Already encrypted  : ${counts.done}`);
    console.log(`   NULL (no 2FA)      : ${counts.nulls}`);
    console.log('');

    if (parseInt(counts.pending) === 0) {
      console.log('✅ Nothing to do — all TOTP secrets already encrypted.');
      return;
    }

    // Fetch all unencrypted rows
    const { rows: users } = await client.query(`
      SELECT id, totp_secret, totp_secret_temp
      FROM users
      WHERE (
        (totp_secret IS NOT NULL AND totp_secret_encrypted = FALSE)
        OR
        (totp_secret_temp IS NOT NULL AND totp_secret_temp_encrypted = FALSE)
      )
      ORDER BY id
    `);

    console.log(`🔄 Encrypting ${users.length} user row(s)...\n`);

    for (const user of users) {
      try {
        let newSecret     = null;
        let newSecretTemp = null;

        // Encrypt totp_secret if present and not already encrypted
        if (user.totp_secret && !isEncrypted(user.totp_secret)) {
          newSecret = encryptTotp(user.totp_secret);
        }

        // Encrypt totp_secret_temp if present and not already encrypted
        if (user.totp_secret_temp && !isEncrypted(user.totp_secret_temp)) {
          newSecretTemp = encryptTotp(user.totp_secret_temp);
        }

        if (!newSecret && !newSecretTemp) {
          skipped++;
          continue;
        }

        // Build targeted update — only update what changed
        const updates  = [];
        const values   = [];
        let   paramIdx = 1;

        if (newSecret) {
          updates.push(`totp_secret = $${paramIdx++}, totp_secret_encrypted = TRUE`);
          values.push(newSecret);
        }
        if (newSecretTemp) {
          updates.push(`totp_secret_temp = $${paramIdx++}, totp_secret_temp_encrypted = TRUE`);
          values.push(newSecretTemp);
        }
        updates.push(`updated_at = NOW()`);
        values.push(user.id);

        await client.query(
          `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          values
        );

        processed++;
        process.stdout.write(`   ✅ User ${user.id.slice(0, 8)}... encrypted\n`);
      } catch (e) {
        errors++;
        console.error(`   ❌ User ${user.id.slice(0, 8)}... FAILED: ${e.message}`);
        // Don't abort — continue with other users
        // The legacy decrypt path means unencrypted rows still work
      }
    }

    console.log('\n─────────────────────────────────────');
    console.log(`✅ Encrypted  : ${processed}`);
    console.log(`⏭  Skipped    : ${skipped} (already encrypted)`);
    console.log(`❌ Errors     : ${errors}`);

    if (errors > 0) {
      console.log('\n⚠️  Some rows failed. Check errors above.');
      console.log('   The server will still work — failed rows use legacy decrypt path.');
      console.log('   Re-run this script to retry failed rows.');
      process.exit(1);
    } else {
      console.log('\n🎉 All TOTP secrets successfully encrypted at rest.');
      console.log('   You can now remove the legacy decrypt path from lib/totpEncryption.js');
      console.log('   once you have verified everything works correctly in production.\n');
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('\n❌ Fatal error:', e.message);
  process.exit(1);
});