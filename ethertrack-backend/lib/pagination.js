// lib/pagination.js — EtherTrack Cursor-based Pagination
// Implements cursor-based pagination for all list endpoints
'use strict';

/**
 * Encode cursor to base64 string
 * @param {Object} cursorData - Cursor data (e.g., { createdAt, id })
 * @returns {string} Base64 encoded cursor
 */
function encodeCursor(cursorData) {
  if (!cursorData) return null;
  return Buffer.from(JSON.stringify(cursorData)).toString('base64');
}

/**
 * Decode cursor from base64 string
 * @param {string} cursor - Base64 encoded cursor
 * @returns {Object|null} Decoded cursor data or null if invalid
 */
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Build cursor-based pagination query
 * @param {Object} options - Pagination options
 * @param {string} options.table - Table name
 * @param {string} options.columns - Columns to select
 * @param {string} options.whereClause - WHERE clause (without WHERE keyword)
 * @param {Array} options.whereParams - Parameters for WHERE clause
 * @param {string} options.orderBy - ORDER BY clause
 * @param {string} options.cursorColumn - Column used for cursor (e.g., 'created_at')
 * @param {string} options.idColumn - Unique ID column (e.g., 'id')
 * @param {number} options.limit - Max results per page
 * @param {Object} cursor - Decoded cursor { createdAt, id }
 * @returns {Object} { query, params, nextCursor }
 */
function buildPaginationQuery({
  table,
  columns,
  whereClause = '',
  whereParams = [],
  orderBy = 'created_at DESC',
  cursorColumn = 'created_at',
  idColumn = 'id',
  limit = 50,
  cursor = null,
}) {
  const limitParam = Math.min(Math.max(parseInt(limit) || 20, 1), 500);
  
  const whereClauseStr = whereClause ? `WHERE ${whereClause}` : '';
  const params = [...whereParams];
  let cursorCondition = '';
  
  if (cursor) {
    // For DESC ordering: cursor represents the last item of previous page
    // We need items strictly before the cursor
    params.push(cursor[cursorColumn], cursor.id);
    cursorCondition = ` AND (${cursorColumn}, ${idColumn}) < ($${params.length - 1}, $${params.length})`;
  }
  
  const query = `
    SELECT ${columns}
    FROM ${table}
    ${whereClauseStr}
    ${cursorCondition}
    ORDER BY ${orderBy}
    LIMIT $${params.length + 1}
  `;
  
  params.push(limit + 1); // Fetch one extra to determine hasMore
  
  return { query, params };
}

/**
 * Execute paginated query
 * @param {Object} pool - pg pool
 * @param {Object} options - Pagination options
 * @returns {Promise<{ rows: Array, nextCursor: string|null, hasMore: boolean }>}
 */
async function paginateQuery(pool, options) {
  const { query, params } = buildPaginationQuery(options);
  const { rows: resultRows } = await safeQuery(query, params);
  
  const limit = Math.min(Math.max(parseInt(options.limit) || 20, 1), 500);
  const hasMore = resultRows.length > limit;
  const rows = hasMore ? resultRows.slice(0, limit) : resultRows;
  
  let nextCursor = null;
  if (hasMore && rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    const cursorData = {
      [options.cursorColumn || 'created_at']: lastRow[options.cursorColumn || 'created_at'],
      id: lastRow[options.idColumn || 'id'],
    };
    nextCursor = encodeCursor(cursorData);
  }
  
  return { rows, nextCursor, hasMore };
}

/**
 * Helper to build cursor from row
 * @param {Object} row - Last row in result set
 * @param {string} cursorColumn - Column used for cursor
 * @param {string} idColumn - ID column
 * @returns {string|null}
 */
function buildCursorFromRow(row, cursorColumn = 'created_at', idColumn = 'id') {
  if (!row) return null;
  return encodeCursor({
    [cursorColumn]: row[cursorColumn],
    id: row[idColumn],
  });
}

/**
 * Parse query parameters for pagination
 * @param {Object} query - Express query object
 * @returns {Object} { limit, cursor, cursorColumn, idColumn, sortBy, sortOrder }
 */
function parsePaginationParams(query) {
  const limit = Math.min(Math.max(parseInt(query.limit) || 20, 1), 500);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const sortBy = query.sortBy || 'created_at';
  const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
  const cursorColumn = query.cursorColumn || 'created_at';
  const idColumn = query.idColumn || 'id';
  
  return { limit, cursor, cursorColumn, idColumn, sortBy, sortOrder: sortOrder, cursorColumn, idColumn };
}

/**
 * Build standardized paginated response
 * @param {Array} rows - Result rows
 * @param {string|null} nextCursor - Next page cursor
 * @param {boolean} hasMore - Whether there are more results
 * @param {Object} meta - Additional metadata
 * @returns {Object} Standardized response
 */
function buildPaginatedResponse(rows, nextCursor, hasMore, meta = {}) {
  return {
    data: rows,
    pagination: {
      nextCursor,
      hasMore,
      count: rows.length,
    },
    meta,
  };
}

module.exports = {
  encodeCursor,
  decodeCursor,
  buildPaginationQuery,
  paginateQuery,
  buildCursorFromRow,
  parsePaginationParams,
  buildPaginatedResponse,
};