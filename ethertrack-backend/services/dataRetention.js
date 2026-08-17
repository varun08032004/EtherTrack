// services/dataRetention.js
// Data retention and deletion service for GDPR/DPDP compliance

'use strict';

const { safeQuery: query } = require('../db/pool');
const logger = require('./logger');

class DataRetentionService {
  constructor(pool) {
    this.pool = pool;
  }

  // Schedule deletion for a user's data
  async scheduleDeletion(userId, dataType, retentionDate) {
    const { rows } = await this.pool.query(
      `INSERT INTO scheduled_deletions (user_id, data_type, scheduled_at, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [userId, dataType, retentionDate]
    );
    return rows[0];
  }

  // Process all due scheduled deletions
  async processScheduledDeletions() {
    const { rows } = await this.pool.query(
      `SELECT * FROM scheduled_deletions 
       WHERE status = 'pending' AND scheduled_at <= NOW()
       ORDER BY scheduled_at ASC`
    );

    const results = { processed: 0, failed: 0, errors: [] };

    for (const deletion of rows) {
      try {
        await this.executeDeletion(deletion);
        await this.pool.query(
          `UPDATE scheduled_deletions SET status = 'completed', completed_at = NOW() WHERE id = $1`,
          [deletion.id]
        );
        results.processed++;
      } catch (error) {
        await this.pool.query(
          `UPDATE scheduled_deletions SET status = 'failed', error = $1 WHERE id = $2`,
          [error.message, deletion.id]
        );
        results.failed++;
        results.errors.push({ id: deletion.id, error: error.message });
      }
    }

    return results;
  }

  async executeDeletion(deletion) {
    switch (deletion.data_type) {
      case 'user_account':
        return this.anonymizeUser(deletion.user_id);
      case 'marketing_data':
        return this.suppressMarketing(deletion.user_id);
      case 'analytics_data':
        return this.purgeAnalytics(deletion.user_id);
      case 'consent_records':
        return this.deleteConsentRecords(deletion.user_id);
      case 'audit_logs':
        return this.purgeAuditLogs(deletion.user_id, deletion.scheduled_at);
      case 'notifications':
        return this.purgeNotifications(deletion.user_id);
      default:
        throw new Error(`Unknown data type: ${deletion.data_type}`);
    }
  }

  // Anonymize user (Art. 17 GDPR - Right to erasure)
  async anonymizeUser(userId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get user info before anonymization
      const { rows: [user] } = await this.pool.query(
        `SELECT email, full_name, wallet_address FROM users WHERE id = $1`,
        [userId]
      );

      // Anonymize user record
      await this.pool.query(
        `UPDATE users SET
           email = CONCAT('deleted_', id, '@deleted.ethertrack.in'),
           full_name = 'Deleted User',
           phone = NULL,
           company_name = NULL,
           company_gstin = NULL,
           company_pan = NULL,
           company_cin = NULL,
           bio = NULL,
           avatar_url = NULL,
           wallet_address = NULL,
           kyc_data_hash = NULL,
           kyc_aadhaar_hash = NULL,
           kyc_pan_hash = NULL,
           totp_secret = NULL,
           totp_secret_temp = NULL,
           totp_backup_codes = NULL,
           notification_prefs = NULL,
           is_active = FALSE,
           frozen = TRUE,
           freeze_reason = 'GDPR_ERASURE',
           updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );

      // Log the erasure
      await this.pool.query(
        `INSERT INTO audit_logs (user_id, action, metadata, created_at)
         VALUES ($1, 'GDPR_ERASURE', $2, NOW())`,
        [userId, JSON.stringify({
          erasedAt: new Date().toISOString(),
          hadWallet: !!user.wallet_address,
          emailHash: require('crypto').createHash('sha256').update(user.email).digest('hex'),
        })]
      );

      await this.pool.query('COMMIT');
      return { success: true, userId };
    } catch (error) {
      await this.pool.query('ROLLBACK');
      throw error;
    }
  }

  // Suppress marketing data (Art. 21 GDPR - Right to object)
  async suppressMarketing(userId) {
    await this.pool.query(
      `UPDATE users SET
         notification_prefs = jsonb_set(
           COALESCE(notification_prefs, '{}'),
           '{newsletter}',
           'false'
         ),
         updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    // Also remove from any marketing lists
    await this.pool.query(
      `DELETE FROM marketing_subscriptions WHERE user_id = $1`,
      [userId]
    );

    return { success: true, userId };
  }

  // Purge analytics data (Art. 5 GDPR - Storage limitation)
  async purgeAnalytics(userId) {
    // Archive then delete old analytics events
    const archiveDate = new Date();
    archiveDate.setFullYear(archiveDate.getFullYear() - 2);

    await this.pool.query(
      `DELETE FROM analytics_events 
       WHERE user_id = $1 AND created_at < $2`,
      [userId, archiveDate]
    );

    // Anonymize remaining analytics (keep for aggregate stats but remove PII)
    await this.pool.query(
      `UPDATE analytics_events 
       SET user_id = NULL, session_id = NULL, ip_address = NULL, user_agent = NULL
       WHERE user_id = $1`,
      [userId]
    );

    return { success: true, userId };
  }

  // Delete consent records (Art. 7 GDPR - Consent withdrawal)
  async deleteConsentRecords(userId) {
    await this.pool.query(
      `DELETE FROM user_consents WHERE user_id = $1`,
      [userId]
    );
    return { success: true, userId };
  }

  // Purge old audit logs (Art. 5 GDPR - Storage limitation)
  async purgeAuditLogs(userId, cutoffDate) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM audit_logs 
       WHERE user_id = $1 AND created_at < $2`,
      [userId, cutoffDate]
    );
    return { success: true, deleted: rowCount };
  }

  // Purge old notifications
  async purgeNotifications(userId) {
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);

    const { rowCount } = await this.pool.query(
      `DELETE FROM notifications 
       WHERE user_id = $1 AND created_at < $2`,
      [userId, cutoffDate]
    );
    return { success: true, deleted: rowCount };
  }

  // Get retention policy for a data type
  getRetentionPolicy(dataType) {
    const policies = {
      user_account: { period: '7 years post-closure', legalBasis: 'Contract + Legal obligation' },
      kyc_documents: { period: '7 years post-closure', legalBasis: 'Legal obligation (AML/KYC)' },
      transaction_records: { period: '10 years', legalBasis: 'Legal obligation (Tax/AML)' },
      marketing_data: { period: 'Until withdrawal', legalBasis: 'Consent (Art. 6.1.a GDPR)' },
      analytics_data: { period: '2 years', legalBasis: 'Legitimate interest (Art. 6.1.f GDPR)' },
      audit_logs: { period: '7 years', legalBasis: 'Legal obligation (PCI DSS, Tax)' },
      consent_records: { period: '7 years', legalBasis: 'Legal obligation (GDPR Art. 7)' },
      support_tickets: { period: '3 years', legalBasis: 'Contract + Legal obligation' },
      notifications: { period: '1 year', legalBasis: 'Legitimate interest' },
    };
    return policies[dataType] || { period: 'Not defined', legalBasis: 'Unknown' };
  }
}

module.exports = { DataRetentionService };