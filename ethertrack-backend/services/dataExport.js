// services/dataExport.js
// Data export service for GDPR/DPDP DSAR requests (Art. 15, 20 GDPR / Sec. 11 DPDP)

'use strict';

const { safeQuery: query } = require('../db/pool');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { createWriteStream } = require('fs');
const archiver = require('archiver');

class DataExportService {
  constructor(pool) {
    this.pool = pool;
  }

  // Generate complete user data export for DSAR
  async generateUserDataExport(userId, requestId) {
    const exportData = {
      meta: {
        exportedAt: new Date().toISOString(),
        requestId,
        userId,
        format: 'json',
        version: '1.0',
      },
      profile: await this.getProfileData(userId),
      emissions: await this.getEmissionsData(userId),
      wallet: await this.getWalletData(userId),
      trades: await this.getTradesData(userId),
      subscriptions: await this.getSubscriptionsData(userId),
      kyc: await this.getKYCData(userId),
      portfolio: await this.getPortfolioData(userId),
      auditLogs: await this.getAuditLogs(userId),
      consents: await this.getConsentData(userId),
      notifications: await this.getNotificationsData(userId),
      supportTickets: await this.getSupportTicketsData(userId),
      organizations: await this.getOrganizationsData(userId),
    };

    return exportData;
  }

  async getProfileData(userId) {
    const { rows } = await this.pool.query(
      `SELECT id, email, full_name, phone, company_name, company_gstin, company_pan, 
              company_cin, bio, avatar_url, timezone, notification_prefs, 
              subscription_plan, subscription_cycle, subscription_renewal_date,
              subscription_activated_at, plan_selected, kyc_verified, kyc_submitted_at,
              kyc_approved_at, is_active, frozen, freeze_reason, wallet_address,
              created_at, updated_at, last_login_at
       FROM users WHERE id = $1`,
      [userId]
    );
    return rows[0] || {};
  }

  async getEmissionsData(userId) {
    const { rows } = await this.pool.query(
      `SELECT e.*, o.name as org_name
       FROM emissions e
       LEFT JOIN organisations o ON e.org_id = o.id
       WHERE e.user_id = $1
       ORDER BY e.date DESC`,
      [userId]
    );
    return rows;
  }

  async getWalletData(userId) {
    const { rows: transactions } = await this.pool.query(
      `SELECT * FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    const { rows: balances } = await this.pool.query(
      `SELECT * FROM wallet_balances WHERE user_id = $1`,
      [userId]
    );
    const { rows: bankAccounts } = await this.pool.query(
      `SELECT * FROM user_bank_accounts WHERE user_id = $1`,
      [userId]
    );
    return { transactions, balances, bankAccounts };
  }

  async getTradesData(userId) {
    const { rows: trades } = await this.pool.query(
      `SELECT t.*, o.name as org_name
       FROM trades t
       LEFT JOIN organisations o ON t.org_id = o.id
       WHERE t.user_id = $1 OR t.buyer_id = $1 OR t.seller_id = $1
       ORDER BY t.created_at DESC`,
      [userId]
    );
    const { rows: orders } = await this.pool.query(
      `SELECT * FROM buy_orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return { trades, orders };
  }

  async getSubscriptionsData(userId) {
    const { rows: payments } = await this.pool.query(
      `SELECT * FROM subscription_payments WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    const { rows: history } = await this.pool.query(
      `SELECT * FROM subscription_history WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return { payments, history };
  }

  async getKYCData(userId) {
    const { rows } = await this.pool.query(
      `SELECT * FROM kyc_submissions WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  }

  async getPortfolioData(userId) {
    const { rows } = await this.pool.query(
      `SELECT p.*, o.name as org_name
       FROM portfolios p
       LEFT JOIN organisations o ON p.org_id = o.id
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC`,
      [userId]
    );
    return rows;
  }

  async getAuditLogs(userId) {
    const { rows } = await this.pool.query(
      `SELECT id, action, resource_type, resource_id, metadata, ip_address, created_at
       FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000`,
      [userId]
    );
    return rows;
  }

  async getConsentData(userId) {
    const { rows } = await this.pool.query(
      `SELECT * FROM user_consents WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    return rows;
  }

  async getNotificationsData(userId) {
    const { rows } = await this.pool.query(
      `SELECT id, type, title, message, data, read, created_at
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500`,
      [userId]
    );
    return rows;
  }

  async getSupportTicketsData(userId) {
    const { rows } = await this.pool.query(
      `SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  }

  async getOrganizationsData(userId) {
    const { rows: memberships } = await this.pool.query(
      `SELECT om.*, o.name, o.gstin, o.pan, o.cin
       FROM org_members om
       JOIN organisations o ON om.org_id = o.id
       WHERE om.user_id = $1`,
      [userId]
    );
    const { rows: owned } = await this.pool.query(
      `SELECT * FROM organisations WHERE owner_id = $1`,
      [userId]
    );
    return { memberships, owned };
  }

  // Write export to JSON file and create ZIP archive
  async writeExportPackage(exportData, outputPath) {
    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const output = require('fs').createWriteStream(outputPath);
      
      output.on('close', () => resolve(outputPath));
      archive.on('error', reject);
      archive.pipe(output);

      // Main JSON file
      archive.append(JSON.stringify(exportData, null, 2), { name: 'export.json' });

      // Individual CSV files for each data category
      if (exportData.emissions && exportData.emissions.length) {
        archive.append(this.toCSV(exportData.emissions), { name: 'emissions.csv' });
      }
      if (exportData.wallet?.transactions?.length) {
        archive.append(this.toCSV(exportData.wallet.transactions), { name: 'wallet_transactions.csv' });
      }
      if (exportData.trades?.trades?.length) {
        archive.append(this.toCSV(exportData.trades.trades), { name: 'trades.csv' });
      }
      if (exportData.emissions?.length) {
        archive.append(this.toCSV(exportData.emissions), { name: 'emissions.csv' });
      }
      if (exportData.auditLogs?.length) {
        archive.append(this.toCSV(exportData.auditLogs), { name: 'audit_logs.csv' });
      }
      if (exportData.consents?.length) {
        archive.append(this.toCSV(exportData.consents), { name: 'consents.csv' });
      }
      if (exportData.notifications?.length) {
        archive.append(this.toCSV(exportData.notifications), { name: 'notifications.csv' });
      }
      if (exportData.supportTickets?.length) {
        archive.append(this.toCSV(exportData.supportTickets), { name: 'support_tickets.csv' });
      }
      if (exportData.organizations?.memberships?.length) {
        archive.append(this.toCSV(exportData.organizations.memberships), { name: 'org_memberships.csv' });
      }

      archive.finalize();
    });
  }

  toCSV(data) {
    if (!data || !data.length) return '';
    const headers = Object.keys(data[0]);
    const rows = data.map(row => 
      headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val).replace(/"/g, '""');
      }).map(v => `"${v}"`).join(',')
    );
    return [headers.map(h => `"${h}"`).join(','), ...rows].join('\n');
  }
}

module.exports = { DataExportService };