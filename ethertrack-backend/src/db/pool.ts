// Re-export pool from root db folder for src/ imports
export { safeQuery, withTransaction, pool, readPool, healthCheck, shutdown } from '../../db/pool.js';