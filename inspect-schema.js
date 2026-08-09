const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres.pnszmtgodypwadkuecch:4g9Ea0QWIoOyeqBt@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function inspectSchema() {
  // Get all tables
  const tables = await pool.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name
  `);
  console.log('=== TABLES ===');
  for (const row of tables.rows) {
    console.log(row.table_name);
  }
  
  // Get columns for key tables
  const keyTables = ['users', 'carbon_batches', 'projects', 'trades', 'wallet_transactions', 'carbon_batches'];
  for (const table of keyTables) {
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [table]);
    console.log('\n=== ' + table.toUpperCase() + ' COLUMNS ===');
    for (const col of cols.rows) {
      console.log(col.column_name + ' | ' + col.data_type + ' | nullable: ' + col.is_nullable + ' | default: ' + (col.column_default || 'none'));
    }
  }
  
  // Get indexes
  const indexes = await pool.query(`
    SELECT indexname, tablename, indexdef
    FROM pg_indexes 
    WHERE schemaname = 'public'
    ORDER BY tablename, indexname
  `);
  console.log('\n=== INDEXES ===');
  for (const idx of indexes.rows) {
    console.log(idx.tablename + '.' + idx.indexname + ' -> ' + idx.indexdef.substring(0, 120));
  }
  
  // Get constraints
  const constraints = await pool.query(`
    SELECT tc.table_name, tc.constraint_name, tc.constraint_type, cc.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage cc ON tc.constraint_name = cc.constraint_name
    WHERE tc.table_schema = 'public'
    ORDER BY tc.table_name, tc.constraint_name
  `);
  console.log('\n=== CONSTRAINTS ===');
  for (const c of constraints.rows) {
    console.log(c.table_name + '.' + c.constraint_name + ' (' + c.constraint_type + ') -> ' + c.column_name);
  }
  
  // Get RLS policies
  const policies = await pool.query(`
    SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);
  console.log('\n=== RLS POLICIES ===');
  for (const p of policies.rows) {
    console.log(p.tablename + '.' + p.policyname + ' -> ' + p.cmd + ' | ' + (p.qual || 'no condition').substring(0, 100));
  }
  
  // Get functions
  const functions = await pool.query(`
    SELECT n.nspname as schema_name, p.proname as function_name, 
           pg_get_function_identity_arguments(p.oid) as args,
           p.proretset as returns_set
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    ORDER BY p.proname
  `);
  console.log('\n=== FUNCTIONS ===');
  for (const f of functions.rows) {
    console.log(f.schema_name + '.' + f.function_name + '(' + f.args + ')' + (f.returns_set ? ' RETURNS SETOF' : ''));
  }
  
  await pool.end();
}

inspectSchema().catch(e => { console.error(e); process.exit(1); });