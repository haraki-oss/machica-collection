const SUPABASE_URL = 'https://tzkzsucrgifrxnbxwdlq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_QT0rigwD5DuxH2SmLBaYVg_fq23Q1im';

// Create a single supabase client for interacting with your database
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
