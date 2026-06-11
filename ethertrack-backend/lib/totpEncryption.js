// lib/totpEncryption.js — EtherTrack
// ─────────────────────────────────────────────────────────────────
// AES-256-GCM encryption for TOTP secrets stored in the database.
//
// WHY THIS EXISTS:
//   TOTP secrets are long-term credentials. If the users table is
//   leaked (SQL injection, DB backup exposure, insider threat), every
//   user's 2FA is instantly compromised without this layer.
//   AES-256-GCM provides authenticated encryption — the ciphertext
//   cannot be tampered with without detection.
//
// HOW IT WORKS:
//   Encrypt: plaintext → random 12-byte IV + AES-256-GCM ciphertext
//            + 16-byte auth tag → stored as "iv:ciphertext:tag" (hex)
//
//   Decrypt: stored string → split → verify auth tag → plaintext
//
// KEY MANAGEMENT:
//   TOTP_ENCRYPTION_KEY must be a 64-char hex string (32 bytes / 256 bits).
//   Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//   Store in .env — NEVER in source code or DB.
//   Rotate by re-encrypting all rows (see migration 003).
//
// FORMAT STORED IN DB:
//   "iv_hex:ciphertext_hex:tag_hex"
//   Example: "a1b2c3...:d4e5f6...:g7h8i9..."
//            (24 chars  : variable : 32 chars)
//
// BACKWARD COMPATIBILITY:
//   encryptTotp()  — always produces the new format
//   decryptTotp()  — detects old plaintext (no colons in correct positions)
//                    and returns it as-is during migration window.
//                    Once all rows are migrated, remove the legacy path.
// ─────────────────────────────────────────────────────────────────
'use strict';

const crypto = require('crypto');

const ALGORITHM  = 'aes-256-gcm';
const IV_BYTES   = 12;  // 96-bit IV — recommended for GCM
const TAG_BYTES  = 16;  // 128-bit auth tag — GCM default
const KEY_BYTES  = 32;  // 256-bit key

// ── Key loading ───────────────────────────────────────────────────
let _key = null;

function getKey() {
  if (_key) return _key;

  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      '[totpEncryption] FATAL: TOTP_ENCRYPTION_KEY environment variable is not set.\n' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
      'Then add it to your .env file.'
    );
  }

  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error(
      '[totpEncryption] TOTP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).\n' +
      `Got ${raw.length} characters.`
    );
  }

  _key = Buffer.from(raw, 'hex');
  if (_key.length !== KEY_BYTES) {
    throw new Error(`[totpEncryption] Key must be ${KEY_BYTES} bytes, got ${_key.length}`);
  }

  return _key;
}

// ── Encrypt ───────────────────────────────────────────────────────
/**
 * Encrypt a TOTP secret (base32 string) for storage.
 * @param {string} plaintext — the base32 TOTP secret
 * @returns {string} — "iv_hex:ciphertext_hex:tag_hex"
 */
function encryptTotp(plaintext) {
  if (!plaintext) return null;

  const key    = getKey();
  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

// ── Decrypt ───────────────────────────────────────────────────────
/**
 * Decrypt a stored TOTP secret.
 * Handles legacy plaintext during migration window.
 * @param {string} stored — either "iv:ciphertext:tag" or legacy plaintext
 * @returns {string} — the base32 TOTP secret
 */
function decryptTotp(stored) {
  if (!stored) return null;

  // ── Legacy detection ──────────────────────────────────────────
  // Encrypted format is "hex:hex:hex" where first segment is exactly
  // 24 chars (12-byte IV as hex). Base32 TOTP secrets use [A-Z2-7]
  // and are typically 32-52 chars — they never contain colons.
  // If stored doesn't match the encrypted format, treat as plaintext.
  const parts = stored.split(':');
  if (
    parts.length !== 3 ||
    parts[0].length !== IV_BYTES * 2 ||   // IV must be 24 hex chars
    parts[2].length !== TAG_BYTES * 2     // Tag must be 32 hex chars
  ) {
    // Legacy plaintext — return as-is during migration window
    // Remove this branch once migration 003 has run on all rows
    return stored;
  }

  const key        = getKey();
  const iv         = Buffer.from(parts[0], 'hex');
  const ciphertext = Buffer.from(parts[1], 'hex');
  const tag        = Buffer.from(parts[2], 'hex');

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (e) {
    // Auth tag mismatch — data was tampered with or key is wrong
    throw new Error(`[totpEncryption] Decryption failed — auth tag mismatch or wrong key: ${e.message}`);
  }
}

// ── Is encrypted? ─────────────────────────────────────────────────
/**
 * Check if a stored value is already in encrypted format.
 * Useful for migration scripts.
 */
function isEncrypted(stored) {
  if (!stored) return false;
  const parts = stored.split(':');
  return (
    parts.length === 3 &&
    parts[0].length === IV_BYTES * 2 &&
    parts[2].length === TAG_BYTES * 2
  );
}

// ── Key validation ────────────────────────────────────────────────
/**
 * Validate the encryption key at startup.
 * Call this from server.js before starting the HTTP server.
 */
function validateEncryptionKey() {
  try {
    getKey();
    // Test round-trip
    const test      = 'JBSWY3DPEHPK3PXP'; // example base32
    const encrypted = encryptTotp(test);
    const decrypted = decryptTotp(encrypted);
    if (decrypted !== test) {
      throw new Error('Round-trip test failed');
    }
    console.log('[totpEncryption] ✅ TOTP encryption key validated');
    return true;
  } catch (e) {
    console.error('[totpEncryption] ❌ Key validation failed:', e.message);
    return false;
  }
}

module.exports = {
  encryptTotp,
  decryptTotp,
  isEncrypted,
  validateEncryptionKey,
};