// routes/compliance.js
// EtherTrack Compliance Layer
// AML · TDS 194S · CTR · FEMA conversion logging
// ─────────────────────────────────────────────────────────────────
// NOTE: This is a technical implementation of compliance logic.
// Before real-money launch, have a CA / legal counsel review:
//   1. TDS deduction & deposit process (Section 194S)
//   2. PPI licence requirement (RBI Master Directions 2021)
//   3. FEMA reporting obligations for INR-crypto conversions
// ─────────────────────────────────────────────────────────────────

const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// Inline admin guard — matches how your existing admin routes work
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

// Get compliance config value from DB (with fallback)
async function getConfig(key, fallback) {
  try {
    const { rows } = await query(
      'SELECT value FROM compliance_config WHERE key = $1', [key]
    );
    return rows.length ? parseFloat(rows[0].value) : fallback;
  } catch { return fallback; }
}

// Get current financial year string e.g. '2025-26'
function getFinancialYear() {
  const now  = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(2)}`;
}

// Get current quarter Q1-Q4 (Indian FY: Apr-Jun=Q1, Jul-Sep=Q2, Oct-Dec=Q3, Jan-Mar=Q4)
function getQuarter() {
  const month = new Date().getMonth() + 1; // 1-12
  if (month >= 4  && month <= 6)  return 'Q1';
  if (month >= 7  && month <= 9)  return 'Q2';
  if (month >= 10 && month <= 12) return 'Q3';
  return 'Q4';
}

// Upsert AML limit counter
async function updateAMLCounter(userId, amount, txType) {
  const today      = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const monthStart = today.slice(0, 8) + '01';              // YYYY-MM-01
  const col        = txType === 'credit' ? 'total_deposited' : 'total_withdrawn';

  for (const [period, date] of [['daily', today], ['monthly', monthStart]]) {
    await query(
      `INSERT INTO aml_limits (user_id, period_date, period_type, ${col}, tx_count)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (user_id, period_date, period_type)
       DO UPDATE SET
         ${col}   = aml_limits.${col} + $4,
         tx_count = aml_limits.tx_count + 1,
         updated_at = NOW()`,
      [userId, date, period, amount]
    );
  }
}

// Create a compliance flag
async function createFlag(userId, walletTxId, flagType, amount, description, severity = 'medium') {
  try {
    await query(
      `INSERT INTO compliance_flags
         (user_id, wallet_tx_id, flag_type, amount, description, severity)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, walletTxId || null, flagType, amount, description, severity]
    );
    console.warn(`⚠️  Compliance flag [${severity.toUpperCase()}]: ${flagType} — User ${userId} — ${description}`);
  } catch (e) {
    console.error('Failed to create compliance flag:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// MAIN: runComplianceChecks
// Called from wallet.js before every deposit / withdrawal
// Returns { allowed: bool, reason: string, tdsAmount: number }
// ─────────────────────────────────────────────────────────────────
async function runComplianceChecks(userId, amount, txType, walletTxId = null) {
  const result = { allowed: true, reason: null, tdsAmount: 0, netAmount: amount };

  try {
    // ── Load config limits ─────────────────────────────────────
    const [
      dailyDepLimit, dailyWdLimit,
      monthlyDepLimit, monthlyWdLimit,
      ctrThreshold, tdsThreshold, tdsRate,
      velocityCount, structuringThreshold,
    ] = await Promise.all([
      getConfig('daily_deposit_limit',    100000),
      getConfig('daily_withdraw_limit',   100000),
      getConfig('monthly_deposit_limit',  1000000),
      getConfig('monthly_withdraw_limit', 1000000),
      getConfig('ctr_threshold',          1000000),
      getConfig('tds_threshold',          10000),
      getConfig('tds_rate',               0.01),
      getConfig('velocity_tx_count',      10),
      getConfig('structuring_threshold',  900000),
    ]);

    const isDeposit  = txType === 'credit';
    const today      = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + '01';

    // ── 1. Daily limit check ───────────────────────────────────
    const { rows: dailyRows } = await query(
      `SELECT total_deposited, total_withdrawn, tx_count
       FROM aml_limits
       WHERE user_id=$1 AND period_date=$2 AND period_type='daily'`,
      [userId, today]
    );
    const daily         = dailyRows[0] || { total_deposited:0, total_withdrawn:0, tx_count:0 };
    const dailyTotal    = isDeposit
      ? parseFloat(daily.total_deposited) + amount
      : parseFloat(daily.total_withdrawn) + amount;
    const dailyLimit    = isDeposit ? dailyDepLimit : dailyWdLimit;

    if (dailyTotal > dailyLimit) {
      await createFlag(userId, walletTxId, 'daily_limit', amount,
        `Daily ${isDeposit?'deposit':'withdrawal'} limit ₹${dailyLimit.toLocaleString('en-IN')} exceeded. Attempted: ₹${dailyTotal.toLocaleString('en-IN')}`,
        'high'
      );
      return { allowed:false, reason:`Daily ${isDeposit?'deposit':'withdrawal'} limit of ₹${dailyLimit.toLocaleString('en-IN')} exceeded`, tdsAmount:0, netAmount:0 };
    }

    // ── 2. Monthly limit check ─────────────────────────────────
    const { rows: monthlyRows } = await query(
      `SELECT total_deposited, total_withdrawn
       FROM aml_limits
       WHERE user_id=$1 AND period_date=$2 AND period_type='monthly'`,
      [userId, monthStart]
    );
    const monthly       = monthlyRows[0] || { total_deposited:0, total_withdrawn:0 };
    const monthlyTotal  = isDeposit
      ? parseFloat(monthly.total_deposited) + amount
      : parseFloat(monthly.total_withdrawn) + amount;
    const monthlyLimit  = isDeposit ? monthlyDepLimit : monthlyWdLimit;

    if (monthlyTotal > monthlyLimit) {
      await createFlag(userId, walletTxId, 'monthly_limit', amount,
        `Monthly ${isDeposit?'deposit':'withdrawal'} limit ₹${monthlyLimit.toLocaleString('en-IN')} exceeded. Attempted: ₹${monthlyTotal.toLocaleString('en-IN')}`,
        'high'
      );
      return { allowed:false, reason:`Monthly ${isDeposit?'deposit':'withdrawal'} limit of ₹${monthlyLimit.toLocaleString('en-IN')} exceeded`, tdsAmount:0, netAmount:0 };
    }

    // ── 3. CTR — Cash Transaction Report (>₹10L) ──────────────
    if (amount >= ctrThreshold) {
      await createFlag(userId, walletTxId, 'ctr', amount,
        `CTR: Single ${isDeposit?'deposit':'withdrawal'} of ₹${amount.toLocaleString('en-IN')} exceeds ₹${ctrThreshold.toLocaleString('en-IN')} threshold. Requires reporting.`,
        'critical'
      );
      // CTR does NOT block transaction — it flags for reporting
      console.warn(`🚨 CTR ALERT: User ${userId} — ₹${amount.toLocaleString('en-IN')} ${isDeposit?'deposit':'withdrawal'}`);
    }

    // ── 4. Velocity check — too many transactions per hour ─────
    const { rows: velocityRows } = await query(
      `SELECT COUNT(*) as cnt FROM wallet_transactions
       WHERE user_id=$1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [userId]
    );
    if (parseInt(velocityRows[0].cnt) >= velocityCount) {
      await createFlag(userId, walletTxId, 'velocity', amount,
        `Velocity alert: ${velocityRows[0].cnt} transactions in last 1 hour (limit: ${velocityCount})`,
        'medium'
      );
      // Velocity flag does NOT block — flags for review
    }

    // ── 5. Structuring detection ───────────────────────────────
    // Multiple transactions just below CTR threshold in 24hrs
    if (amount >= structuringThreshold && amount < ctrThreshold) {
      const { rows: structRows } = await query(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total
         FROM wallet_transactions
         WHERE user_id=$1
           AND type=$2
           AND amount >= $3
           AND created_at > NOW() - INTERVAL '24 hours'`,
        [userId, txType, structuringThreshold]
      );
      const priorCount = parseInt(structRows[0].cnt);
      const priorTotal = parseFloat(structRows[0].total);
      if (priorCount >= 2 || (priorTotal + amount) >= ctrThreshold) {
        await createFlag(userId, walletTxId, 'structuring', amount,
          `Possible structuring: ${priorCount} prior transactions of ≥₹${structuringThreshold.toLocaleString('en-IN')} in last 24hrs. Combined total: ₹${(priorTotal+amount).toLocaleString('en-IN')}`,
          'critical'
        );
      }
    }

    // ── 6. TDS 194S — only on withdrawals above threshold ──────
    // NOTE: Legal interpretation — TDS applies when EtherTrack pays
    // user (withdrawal = payment for VDA transfer). Consult CA.
    if (!isDeposit && amount >= tdsThreshold) {
      const tdsAmount = Math.round(amount * tdsRate * 100) / 100; // round to paise
      const netAmount = amount - tdsAmount;
      result.tdsAmount = tdsAmount;
      result.netAmount = netAmount;
      result.tdsInfo   = {
        section: '194S',
        rate:    `${(tdsRate * 100).toFixed(0)}%`,
        gross:   amount,
        tds:     tdsAmount,
        net:     netAmount,
        fy:      getFinancialYear(),
        quarter: getQuarter(),
      };
    }

  } catch (e) {
    // Compliance check failure should NOT block transactions in test mode
    // In production: block on error (fail-safe)
    console.error('Compliance check error:', e.message);
    if (process.env.NODE_ENV === 'production') {
      return { allowed:false, reason:'Compliance check failed. Please try again.', tdsAmount:0, netAmount:0 };
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────
// Record TDS after successful withdrawal
// ─────────────────────────────────────────────────────────────────
async function recordTDS(userId, walletTxId, amount, tdsInfo, userPan) {
  try {
    await query(
      `INSERT INTO tds_records
         (user_id, wallet_tx_id, financial_year, quarter,
          transaction_amount, tds_rate, tds_amount, net_amount,
          section, pan, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'deducted')`,
      [
        userId, walletTxId,
        tdsInfo.fy, tdsInfo.quarter,
        amount, tdsInfo.rate.replace('%','') / 100,
        tdsInfo.tds, tdsInfo.net,
        tdsInfo.section, userPan || null,
      ]
    );
  } catch (e) {
    console.error('TDS record failed:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// Record INR→Crypto conversion (FEMA log)
// ─────────────────────────────────────────────────────────────────
async function recordINRCryptoConversion(userId, walletTxId, inrAmount, cryptoAmount, ethRate, txHash) {
  try {
    await query(
      `INSERT INTO inr_crypto_conversions
         (user_id, wallet_tx_id, inr_amount, crypto_amount,
          eth_inr_rate, tx_hash, purpose)
       VALUES ($1,$2,$3,$4,$5,$6,'carbon_credit_purchase')`,
      [userId, walletTxId, inrAmount, cryptoAmount, ethRate, txHash || null]
    );
  } catch (e) {
    console.error('FEMA log failed:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────
// Export helpers for use in wallet.js
// ─────────────────────────────────────────────────────────────────
module.exports.runComplianceChecks      = runComplianceChecks;
module.exports.updateAMLCounter         = updateAMLCounter;
module.exports.recordTDS                = recordTDS;
module.exports.recordINRCryptoConversion = recordINRCryptoConversion;
module.exports.createFlag               = createFlag;

// ─────────────────────────────────────────────────────────────────
// ADMIN ROUTES — view flags, limits, TDS records
// ─────────────────────────────────────────────────────────────────

// GET /api/compliance/flags
router.get('/flags', authenticate, requireAdmin, async (req, res) => {
  try {
    const { status, severity, limit = 50 } = req.query;
    let sql = `
      SELECT cf.*, u.email, u.full_name, u.company_name
      FROM compliance_flags cf
      JOIN users u ON u.id = cf.user_id
      WHERE 1=1
    `;
    const params = [];
    if (status)   { params.push(status);   sql += ` AND cf.status = $${params.length}`; }
    if (severity) { params.push(severity); sql += ` AND cf.severity = $${params.length}`; }
    params.push(parseInt(limit));
    sql += ` ORDER BY cf.created_at DESC LIMIT $${params.length}`;

    const { rows } = await query(sql, params);
    res.json({ flags: rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch flags' });
  }
});

// PUT /api/compliance/flags/:id — review a flag
router.put('/flags/:id', authenticate, requireAdmin, async (req, res) => {
  const { status, reviewNotes } = req.body;
  try {
    const { rows } = await query(
      `UPDATE compliance_flags SET
         status       = $1,
         review_notes = $2,
         reviewed_by  = $3,
         reviewed_at  = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, reviewNotes || null, req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Flag not found' });
    res.json({ success: true, flag: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update flag' });
  }
});

// GET /api/compliance/tds — TDS records
router.get('/tds', authenticate, requireAdmin, async (req, res) => {
  try {
    const { fy, quarter } = req.query;
    let sql = `
      SELECT tr.*, u.email, u.full_name, u.company_pan
      FROM tds_records tr
      JOIN users u ON u.id = tr.user_id
      WHERE 1=1
    `;
    const params = [];
    if (fy)      { params.push(fy);      sql += ` AND tr.financial_year = $${params.length}`; }
    if (quarter) { params.push(quarter); sql += ` AND tr.quarter = $${params.length}`; }
    sql += ' ORDER BY tr.created_at DESC LIMIT 200';

    const { rows } = await query(sql, params);
    const totalTds = rows.reduce((s, r) => s + parseFloat(r.tds_amount), 0);
    res.json({ records: rows, totalTds, fy: fy || getFinancialYear() });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch TDS records' });
  }
});

// GET /api/compliance/limits — user transaction limits status
router.get('/limits/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const today      = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + '01';

    const { rows } = await query(
      `SELECT * FROM aml_limits
       WHERE user_id = $1
         AND period_date IN ($2, $3)`,
      [req.params.userId, today, monthStart]
    );

    const [dailyDep, monthlyDep, monthlyWd] = await Promise.all([
      getConfig('daily_deposit_limit',   100000),
      getConfig('monthly_deposit_limit', 1000000),
      getConfig('monthly_withdraw_limit',1000000),
    ]);

    const daily   = rows.find(r => r.period_type === 'daily')   || { total_deposited:0, total_withdrawn:0, tx_count:0 };
    const monthly = rows.find(r => r.period_type === 'monthly') || { total_deposited:0, total_withdrawn:0 };

    res.json({
      daily: {
        deposited:  parseFloat(daily.total_deposited),
        withdrawn:  parseFloat(daily.total_withdrawn),
        txCount:    daily.tx_count,
        depositLimit:  dailyDep,
        depositRemaining: Math.max(0, dailyDep - parseFloat(daily.total_deposited)),
      },
      monthly: {
        deposited:  parseFloat(monthly.total_deposited),
        withdrawn:  parseFloat(monthly.total_withdrawn),
        depositLimit:   monthlyDep,
        withdrawLimit:  monthlyWd,
        depositRemaining:  Math.max(0, monthlyDep  - parseFloat(monthly.total_deposited)),
        withdrawRemaining: Math.max(0, monthlyWd   - parseFloat(monthly.total_withdrawn)),
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch limits' });
  }
});

// GET /api/compliance/fema — INR crypto conversion log
router.get('/fema', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT icc.*, u.email, u.full_name
       FROM inr_crypto_conversions icc
       JOIN users u ON u.id = icc.user_id
       ORDER BY icc.created_at DESC
       LIMIT 200`
    );
    const totalInr = rows.reduce((s, r) => s + parseFloat(r.inr_amount), 0);
    res.json({ conversions: rows, totalInr, totalTx: rows.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch FEMA log' });
  }
});

// GET /api/compliance/config — view limits config
router.get('/config', authenticate, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM compliance_config ORDER BY key');
    res.json({ config: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// PUT /api/compliance/config/:key — update a limit
router.put('/config/:key', authenticate, requireAdmin, async (req, res) => {
  const { value } = req.body;
  if (!value) return res.status(400).json({ error: 'Value required' });
  try {
    await query(
      `UPDATE compliance_config SET value=$1, updated_at=NOW() WHERE key=$2`,
      [value, req.params.key]
    );
    res.json({ success: true, key: req.params.key, value });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// GET /api/compliance/my-limits — user sees their own remaining limits
router.get('/my-limits', authenticate, async (req, res) => {
  try {
    const today      = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + '01';

    const { rows } = await query(
      `SELECT * FROM aml_limits WHERE user_id=$1 AND period_date IN ($2,$3)`,
      [req.user.id, today, monthStart]
    );

    const [dailyDep, dailyWd, monthlyDep, monthlyWd] = await Promise.all([
      getConfig('daily_deposit_limit',    100000),
      getConfig('daily_withdraw_limit',   100000),
      getConfig('monthly_deposit_limit',  1000000),
      getConfig('monthly_withdraw_limit', 1000000),
    ]);

    const daily   = rows.find(r => r.period_type === 'daily')   || { total_deposited:0, total_withdrawn:0 };
    const monthly = rows.find(r => r.period_type === 'monthly') || { total_deposited:0, total_withdrawn:0 };

    res.json({
      deposit: {
        dailyUsed:      parseFloat(daily.total_deposited),
        dailyLimit:     dailyDep,
        dailyRemaining: Math.max(0, dailyDep   - parseFloat(daily.total_deposited)),
        monthlyUsed:    parseFloat(monthly.total_deposited),
        monthlyLimit:   monthlyDep,
        monthlyRemaining: Math.max(0, monthlyDep - parseFloat(monthly.total_deposited)),
      },
      withdrawal: {
        dailyUsed:      parseFloat(daily.total_withdrawn),
        dailyLimit:     dailyWd,
        dailyRemaining: Math.max(0, dailyWd    - parseFloat(daily.total_withdrawn)),
        monthlyUsed:    parseFloat(monthly.total_withdrawn),
        monthlyLimit:   monthlyWd,
        monthlyRemaining: Math.max(0, monthlyWd - parseFloat(monthly.total_withdrawn)),
      },
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch limits' });
  }
});

module.exports.router = router;