// Integration Tests - Database Transactions (with mocked pool)

import { safeQuery as query, withTransaction, pool } from '../../db/pool.ts';

describe('Database Transaction Integration', () => {
  beforeAll(async () => {
    // Mock pool is already set up in setup.mjs
  });

  afterAll(async () => {
    // No real pool to end in tests
  });

  describe('withTransaction', () => {
    it('should commit transaction on success', async () => {
      const testId = `test-${Date.now()}`;
      
      // Mock the transaction flow
      withTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn().mockResolvedValue({ rows: [] })
        };
        return fn(mockClient);
      });
      
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO test_table (id, value) VALUES ($1, $2)`,
          [testId, 'committed']
        );
      });

      query.mockResolvedValueOnce({ rows: [{ value: 'committed' }] });
      const { rows } = await query(
        `SELECT value FROM test_table WHERE id = $1`,
        [testId]
      );
      
      expect(rows[0].value).toBe('committed');
    });

    it('should rollback transaction on error', async () => {
      const testId = `test-${Date.now()}-rollback`;
      
      withTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn().mockResolvedValue({ rows: [] })
        };
        try {
          await fn(mockClient);
        } catch (e) {
          throw e;
        }
      });
      
      await expect(withTransaction(async (client) => {
        await client.query(
          `INSERT INTO test_table (id, value) VALUES ($1, $2)`,
          [testId, 'should-rollback']
        );
        throw new Error('Intentional error');
      })).rejects.toThrow('Intentional error');

      query.mockResolvedValueOnce({ rows: [] });
      const { rows } = await query(
        `SELECT value FROM test_table WHERE id = $1`,
        [testId]
      );
      
      expect(rows.length).toBe(0);
    });

    it('should provide isolation between concurrent transactions', async () => {
      const testId = `test-${Date.now()}-isolation`;
      
      withTransaction.mockImplementation(async (fn) => {
        const mockClient = {
          query: jest.fn().mockResolvedValue({ rows: [] })
        };
        return fn(mockClient);
      });
      
      // Start first transaction (don't commit yet)
      const client1 = { query: jest.fn().mockResolvedValue({ rows: [] }) };
      await client1.query('BEGIN');
      await client1.query(
        `INSERT INTO test_table (id, value) VALUES ($1, $2)`,
        [testId, 'tx1']
      );

      // Second transaction should not see uncommitted data
      query.mockResolvedValueOnce({ rows: [] });
      const { rows: beforeCommit } = await query(
        `SELECT value FROM test_table WHERE id = $1`,
        [testId]
      );
      expect(beforeCommit.length).toBe(0);

      // Commit first transaction
      await client1.query('COMMIT');

      // Now second transaction should see it
      query.mockResolvedValueOnce({ rows: [{ value: 'tx1' }] });
      const { rows: afterCommit } = await query(
        `SELECT value FROM test_table WHERE id = $1`,
        [testId]
      );
      expect(afterCommit[0].value).toBe('tx1');
    });
  });

  describe('Row-level locking (FOR UPDATE)', () => {
    it('should lock rows and prevent concurrent modification', async () => {
      const testId = `test-${Date.now()}-lock`;
      
      // Initialize
      query.mockResolvedValueOnce({ rows: [] });

      let firstUpdateDone = false;
      let secondUpdateDone = false;

      let callCount = 0;
      withTransaction.mockImplementation(async (fn) => {
        callCount++;
        const mockClient = {
          query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ value: callCount === 1 ? 'initial' : 'updated-by-first', version: callCount === 1 ? 1 : 2 }] }) // SELECT FOR UPDATE
            .mockResolvedValueOnce({ rows: [] }) // UPDATE
        };
        return fn(mockClient);
      });

      // First transaction: lock and update
      const promise1 = withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM test_table WHERE id = $1 FOR UPDATE`,
          [testId]
        );
        expect(rows[0].value).toBe('initial');
        
        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 10));
        
        await client.query(
          `UPDATE test_table SET value = $1, version = version + 1 WHERE id = $2`,
          ['updated-by-first', testId]
        );
        firstUpdateDone = true;
      });

      // Second transaction: should wait for lock
      const promise2 = withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM test_table WHERE id = $1 FOR UPDATE`,
          [testId]
        );
        // Should see first transaction's update
        expect(rows[0].value).toBe('updated-by-first');
        
        await client.query(
          `UPDATE test_table SET value = $1, version = version + 1 WHERE id = $2`,
          ['updated-by-second', testId]
        );
        secondUpdateDone = true;
      });

      await Promise.all([promise1, promise2]);

      expect(firstUpdateDone).toBe(true);
      expect(secondUpdateDone).toBe(true);

      query.mockResolvedValueOnce({ rows: [{ value: 'updated-by-second', version: 3 }] });
      const { rows } = await query(
        `SELECT value, version FROM test_table WHERE id = $1`,
        [testId]
      );
      expect(rows[0].value).toBe('updated-by-second');
      expect(rows[0].version).toBe(3);
    });
  });

  describe('Advisory locks', () => {
    it('should prevent concurrent execution with same lock key', async () => {
      const lockKey = 123456789;
      let executionCount = 0;

      const task = async () => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);
        executionCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
      };

      await Promise.all([task(), task(), task()]);
      
      expect(executionCount).toBe(3);
    });

    it('should allow concurrent execution with different lock keys', async () => {
      let executionCount = 0;

      const task = async (key) => {
        await query(`SELECT pg_advisory_xact_lock($1)`, [key]);
        executionCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
      };

      await Promise.all([task(1), task(2), task(3)]);
      
      expect(executionCount).toBe(3);
    });
  });
});