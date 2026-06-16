import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = 'https://pnszmtgodypwadkuecch.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBuc3ptdGdvZHlwd2Fka3VlY2NoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NDU5MjAsImV4cCI6MjA4ODUyMTkyMH0.5w9TVyQLQDl_gc_gZZ7GZho_DlCyfgMDgXlm_4YVULE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);