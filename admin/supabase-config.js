// Supabase 接続設定（管理画面）
// 注: sb_publishable_* キーだと supabase-js v2 の auth 系（getSession /
// signInWithPassword）が Promise を resolve しないハングが発生するため、
// Legacy JWT anon key（eyJ...）を使う。Clip 側と同じキー。
const SUPABASE_URL = 'https://tzkzsucrgifrxnbxwdlq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6a3pzdWNyZ2lmcnhuYnh3ZGxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMzgwMTYsImV4cCI6MjA5MjkxNDAxNn0.M0Ks6T8UEdulBZu-mmzGY6LtSHrGdgqvTRP1Z_DUnKQ';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
    },
});
