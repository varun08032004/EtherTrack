import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  throw new Error('Missing required Supabase config: REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY must be set');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);