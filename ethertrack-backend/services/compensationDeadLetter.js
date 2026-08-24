require('dotenv').config();
const { safeQuery: query } = require('./db/pool.js');

async function addToDeadLetter(tradeId, failurePoint, errorMessage, compensationData) {
  await query(
    `INSERT INTO compensation_dead_letter (trade_id, failure_point, error_message, compensation_data)
     VALUES ($1, $2, $3, $4)`,
    [tradeId, failurePoint, errorMessage, JSON.stringify(compensationData)]
  );
}

async function getDeadLetterEntries(limit = 50) {
  const { rows } = await query(`
    SELECT cdl.*, t.settlement_state, t.chain_status
    FROM compensation_dead_letter cdl
    JOIN trades t ON t.id = cdl.trade_id
    WHERE cdl.resolved_at IS NULL
    ORDER BY cdl.created_at DESC
    LIMIT $1
  `, [limit]);
  return rows;
}

async function retryDeadLetter(entryId) {
  const { rows } = await query('SELECT * FROM compensation_dead_letter WHERE id = $1', [entryId]);
  if (!rows.length) throw new Error('Entry not found');
  
  const entry = rows[0];
  if (entry.resolved_at) throw new Error('Already resolved');
  
  // Increment retry count
  await query(
    `UPDATE compensation_dead_letter SET retry_count = retry_count + 1, last_retry_at = NOW() WHERE id = $1`,
    [entryId]
  );
  
  return entry;
}

async function markResolved(entryId, userId, notes) {
  await query(
    `UPDATE compensation_dead_letter SET resolved_at = NOW(), resolved_by = $1, resolution_notes = $2 WHERE id = $3`,
    [userId, notes, entryId]
  );
}

module.exports = { addToDeadLetter, getDeadLetterEntries, retryDeadLetter, markResolved };