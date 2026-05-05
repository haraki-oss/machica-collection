// 管理画面の認証ガード
// supabase-js のロード前に <head> で同期実行されるため、
// localStorage の sb-<ref>-auth-token を直接読んで判定する（Clip と同じパターン）。
// 真のセキュリティは Supabase 側の RLS が担う。これはあくまで UX 上のガード。
(function () {
    if (window.location.pathname.endsWith('login.html')) return;

    const SUPABASE_REF = 'tzkzsucrgifrxnbxwdlq';
    const STORAGE_KEY = `sb-${SUPABASE_REF}-auth-token`;
    const adminEmails = (window.ADMIN_EMAILS || []).map(e => String(e).toLowerCase());

    function readStoredSession() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.user) return null;
            if (parsed.expires_at && parsed.expires_at * 1000 <= Date.now()) return null;
            return parsed;
        } catch (_) {
            return null;
        }
    }

    function redirectToLogin() {
        const target = location.pathname.split('/').pop() + location.search + location.hash;
        sessionStorage.setItem('machica_admin_return_to', target);
        window.location.href = 'login.html';
    }

    const session = readStoredSession();
    if (!session) {
        redirectToLogin();
        return;
    }

    const email = String(session.user.email || '').toLowerCase();
    if (adminEmails.length && !adminEmails.includes(email)) {
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        alert('このアカウントには管理画面へのアクセス権がありません。');
        redirectToLogin();
        return;
    }

    window.adminSession = session;
})();
