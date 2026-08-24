import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@/adapters/sqlite';
import { allSchemas } from '@/models/schema';

import { User, EmissionActivity, CarbonAsset, MRVPlan, Evidence, Trade } from '@/models';

const database = new Database({
  adapter: SQLiteAdapter,
  modelClasses: [
    User,
    EmissionActivity,
    CarbonAsset,
    MRVPlan,
    Evidence,
    Trade,
  ],
  schema: { tables: allSchemas },
});

export default database;