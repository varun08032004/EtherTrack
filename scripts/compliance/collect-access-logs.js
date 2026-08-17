// scripts/compliance/collect-access-logs.js
// Evidence collection for SOC2 access control logs
// Usage: node scripts/compliance/collect-access-logs.js

'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function collectAccessLogs() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[ERROR] DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({ 
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30000,
  });

  try {
    const daysBack = parseInt(process.argv[2]) || 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    const result = await pool.query(`
      SELECT 
        al.id, al.user_id, al.action, al.resource_type, al.resource_id,
        al.ip_address, al.user_agent, al.created_at,
        u.email, u.role
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE al.created_at >= $1
      ORDER BY al.created_at DESC
    `, [cutoff]);

    const outputDir = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'docs',
      'compliance',
      'evidence',
      'access-logs',
      new Date().toISOString().split('T')[0]
    );

    fs.mkdirSync(outputDir, { recursive: true });

    const outputFile = path.join(outputDir, 'access-logs.json');
    fs.writeFileSync(outputFile, JSON.stringify({
      collectedAt: new Date().toISOString(),
      periodDays: daysBack,
      recordCount: result.rows.length,
      logs: result.rows
    }, null, 2));

    console.log(`[SOC2] Collected ${result.rows.length} access log records`);
    console.log(`[SOC2] Saved to: ${outputFile}`);
    console.log(`[SOC2] Evidence collection complete`);

  } catch (error) {
    console.error('[SOC2] Evidence collection failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

collectAccessLogs();