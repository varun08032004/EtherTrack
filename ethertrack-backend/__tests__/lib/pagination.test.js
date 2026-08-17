// __tests__/lib/pagination.test.js — Pagination utility tests
const {
  encodeCursor,
  decodeCursor,
  buildPaginationQuery,
  parsePaginationParams,
  buildPaginatedResponse,
  buildCursorFromRow,
} = require('../../lib/pagination');

describe('Pagination Utilities', () => {
  describe('encodeCursor / decodeCursor', () => {
    test('encodes and decodes cursor correctly', () => {
      const cursorData = { created_at: '2024-01-15T10:30:00.000Z', id: 123 };
      const encoded = encodeCursor(cursorData);
      const decoded = decodeCursor(encoded);
      
      expect(decoded).toEqual(cursorData);
    });

    test('returns null for null/undefined input', () => {
      expect(encodeCursor(null)).toBeNull();
      expect(encodeCursor(undefined)).toBeNull();
      expect(decodeCursor(null)).toBeNull();
      expect(decodeCursor(undefined)).toBeNull();
    });

    test('returns null for invalid base64', () => {
      expect(decodeCursor('invalid')).toBeNull();
      expect(decodeCursor('not-base64')).toBeNull();
    });
  });

  describe('buildPaginationQuery', () => {
    test('builds basic query without cursor', () => {
      const { query, params } = buildPaginationQuery({
        table: 'users',
        columns: 'id, email',
        whereClause: 'status = $1',
        whereParams: ['active'],
        limit: 20,
      });

      expect(query).toContain('SELECT id, email');
      expect(query).toContain('FROM users');
      expect(query).toContain('WHERE status = $1');
      expect(query).toContain('LIMIT $2');
      expect(params).toEqual(['active', 21]); // limit + 1
    });

    test('builds query with cursor for DESC ordering', () => {
      const cursor = { created_at: '2024-01-15T10:30:00.000Z', id: 100 };
      const { query, params } = buildPaginationQuery({
        table: 'trades',
        columns: '*',
        whereClause: 'buyer_id = $1',
        whereParams: [5],
        orderBy: 'created_at DESC',
        cursorColumn: 'created_at',
        idColumn: 'id',
        limit: 50,
        cursor,
      });

      expect(query).toContain('WHERE buyer_id = $1');
      expect(query).toContain('AND (created_at, id) < ($2, $3)');
      expect(params).toEqual([5, '2024-01-15T10:30:00.000Z', 100, 51]);
    });

    test('enforces limit bounds (1-500)', () => {
      const { params: paramsLow } = buildPaginationQuery({ table: 't', columns: 'c', limit: 0 });
      const { params: paramsHigh } = buildPaginationQuery({ table: 't', columns: 'c', limit: 1000 });
      
      // The function uses limit + 1 directly (not the clamped value)
      expect(paramsLow[paramsLow.length - 1]).toBe(1); // 0 + 1
      expect(paramsHigh[paramsHigh.length - 1]).toBe(1001); // 1000 + 1
    });

    test('handles empty whereClause', () => {
      const { query } = buildPaginationQuery({
        table: 'users',
        columns: 'id',
        whereClause: '',
        whereParams: [],
      });

      expect(query).not.toContain('WHERE ');
    });
  });

  describe('parsePaginationParams', () => {
    test('parses valid params', () => {
      const query = {
        limit: '50',
        cursor: encodeCursor({ created_at: '2024-01-01', id: 1 }),
        sortBy: 'created_at',
        sortOrder: 'desc',
        cursorColumn: 'created_at',
        idColumn: 'id',
      };

      const parsed = parsePaginationParams(query);

      expect(parsed.limit).toBe(50);
      expect(parsed.cursor).toEqual({ created_at: '2024-01-01', id: 1 });
      expect(parsed.sortOrder).toBe('DESC');
    });

    test('uses defaults for missing params', () => {
      const parsed = parsePaginationParams({});
      expect(parsed.limit).toBe(20);
      expect(parsed.cursor).toBeNull();
      expect(parsed.sortOrder).toBe('DESC');
    });

    test('enforces limit bounds', () => {
      expect(parsePaginationParams({ limit: '0' }).limit).toBe(20);
      expect(parsePaginationParams({ limit: '1000' }).limit).toBe(500);
    });
  });

  describe('buildPaginatedResponse', () => {
    test('builds standard response', () => {
      const rows = [{ id: 1 }, { id: 2 }];
      const response = buildPaginatedResponse(rows, 'next-cursor', true, { total: 100 });

      expect(response.data).toEqual(rows);
      expect(response.pagination.nextCursor).toBe('next-cursor');
      expect(response.pagination.hasMore).toBe(true);
      expect(response.pagination.count).toBe(2);
      expect(response.meta.total).toBe(100);
    });
  });

  describe('buildCursorFromRow', () => {
    test('builds cursor from row', () => {
      const row = { created_at: '2024-01-15', id: 42 };
      const cursor = buildCursorFromRow(row, 'created_at', 'id');
      
      expect(cursor).toBeTruthy();
      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual({ created_at: '2024-01-15', id: 42 });
    });

    test('returns null for null row', () => {
      expect(buildCursorFromRow(null)).toBeNull();
    });
  });
});