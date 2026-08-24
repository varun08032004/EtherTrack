// Web-compatible SQLite adapter for WatermelonDB - Mock for development
import { allSchemas } from '@/models/schema';

class MockSQLiteAdapter {
  dbName: string;
  schema: any;
  db: any;

  constructor({ dbName, onCreate }: { dbName: string; onCreate?: (db: any) => void }) {
    this.dbName = dbName;
    this.schema = { tables: allSchemas };
    this.db = null;

    console.log('[MockSQLite] Constructor, dbName:', dbName);
    if (onCreate) {
      setTimeout(() => onCreate(this), 0);
    }
  }

  getDb() {
    return this.db;
  }

  async execute(sql: string, args: any[] = []) {
    console.log('[MockSQLite] execute:', sql, args);
    return { rows: { _array: [] }, rowsAffected: 0, insertId: null };
  }

  unsafeExecute(sql: string) {
    console.log('[MockSQLite] unsafeExecute:', sql);
    return Promise.resolve();
  }

  onCreate(fn: (db: any) => void) {
    console.log('[MockSQLite] onCreate');
    setTimeout(() => fn(this), 0);
  }

  close() {
    console.log('[MockSQLite] close');
    return Promise.resolve();
  }
}

export default MockSQLiteAdapter;