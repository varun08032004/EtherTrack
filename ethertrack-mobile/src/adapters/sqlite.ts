// Platform-specific SQLite adapter for WatermelonDB
import { Platform } from 'react-native';

let adapter: any;

if (Platform.OS === 'web') {
  const MockSQLiteAdapter = require('./sqlite.web').default;
  adapter = new MockSQLiteAdapter({ dbName: 'ethertrack' });
} else {
  adapter = require('./sqlite.native').default;
}

export default adapter;