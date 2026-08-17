// scripts/compliance/change-log.js
// Evidence collection for SOC2 change management
// Usage: node scripts/compliance/change-log.js --pr <number> --workflow <name>

'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function collectChangeLog() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[ERROR] DATABASE_URL not set');
    process.exit(1);
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  const prNumber = args.find((a, i) => a === '--pr' && args[i + 1]) ? args[args.indexOf('--pr') + 1] : null;
  const workflowName = args.find((a, i) => a === '--workflow' && args[i + 1]) ? args[args.indexOf('--workflow') + 1] : 'manual';
  const outputDir = args.find((a, i) => a === '--output' && args[i + 1]) ? args[args.indexOf('--output') + 1] : null;

  if (!prNumber && workflowName === 'manual') {
    console.error('[ERROR] Either --pr <number> or --workflow <name> required');
    process.exit(1);
  }

  const pool = new Pool({ 
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });

  try {
    let changeRecord = {
      timestamp: new Date().toISOString(),
      workflow: workflowName,
      prNumber: prNumber ? parseInt(prNumber) : null,
      collectedAt: new Date().toISOString(),
    };

    // Get git commit info
    try {
      const gitLog = execSync('git log -1 --pretty=format:"%H|%an|%ae|%s|%ci"', { encoding: 'utf8' }).trim();
      const [hash, author, email, subject, date] = gitLog.split('|');
      changeRecord.git = {
        commitHash: hash,
        author,
        email,
        subject,
        date,
      };
    } catch (e) {
      changeRecord.git = { error: 'Failed to get git info' };
    }

    // Get changed files
    try {
      const diff = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf8' }).trim();
      changeRecord.changedFiles = diff ? diff.split('\n') : [];
    } catch (e) {
      changeRecord.changedFiles = [];
    }

    // If PR number provided, get PR info from GitHub API (if token available)
    if (prNumber && process.env.GITHUB_TOKEN) {
      try {
        const response = await fetch(`https://api.github.com/repos/ethertrack/platform/pulls/${prNumber}`, {
          headers: { 'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (response.ok) {
          const pr = await response.json();
          changeRecord.pr = {
            number: pr.number,
            title: pr.title,
            state: pr.state,
            merged: pr.merged,
            mergedAt: pr.merged_at,
            baseBranch: pr.base.ref,
            headBranch: pr.head.ref,
            reviewers: pr.requested_reviewers?.map(r => r.login) || [],
            labels: pr.labels?.map(l => l.name) || [],
          };
        }
      } catch (e) {
        console.warn('[SOC2] Could not fetch PR details:', e.message);
      }
    }

    // Save to evidence directory
    const evidenceDir = outputDir || path.join(
      __dirname,
      '..',
      '..',
      '..',
      'docs',
      'compliance',
      'evidence',
      'change-logs',
      new Date().toISOString().split('T')[0]
    );

    fs.mkdirSync(evidenceDir, { recursive: true });

    const outputFile = path.join(evidenceDir, `change-${prNumber || Date.now()}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(changeRecord, null, 2));

    console.log('[SOC2] Change log evidence collected');
    console.log(`[SOC2] Saved to: ${outputFile}`);
    console.log('[SOC2] Evidence collection complete');

  } catch (error) {
    console.error('[SOC2] Change log collection failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

collectChangeLog();