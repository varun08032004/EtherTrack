// Native platform (iOS/Android) - Custom Expo SQLite adapter for WatermelonDB
import { openDatabaseSync } from 'expo-sqlite';
import { allSchemas } from '@/models/schema';

const db = openDatabaseSync('ethertrack.db');

class ExpoSQLiteAdapter {
  db: any;
  schema: any;

  constructor() {
    this.db = db;
    this.schema = { tables: allSchemas };
  }

  getDb() {
    return this.db;
  }

  async execute(sql: string, args: any[] = []) {
    return new Promise((resolve, reject) => {
      this.db.execAsync(sql, args)
        .then((result: any) => {
          resolve({
            rows: { _array: result.rows || [] },
            rowsAffected: result.changes || 0,
            insertId: result.lastInsertRowId || null,
          });
        })
        .catch(reject);
    });
  }

  unsafeExecute(sql: string) {
    return this.db.execAsync(sql).then(() => {});
  }

  close() {
    return Promise.resolve();
  }

  onCreate(fn: (db: any) => void) {
    fn(this);
  }
}

const adapter = new ExpoSQLiteAdapter();
export default adapter;