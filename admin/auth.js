// 管理画面の認証ガード（同期チェック部分）
// supabase-js のロード前に <head> で同期実行されるため、
// localStorage の sb-<ref>-auth-token を直接読んでセッション存在のみ判定する。
// 「管理者かどうか」の本判定は admin-account.js が supabase-js ロード後に
// is_admin() RPC で行う。RLS が真のセキュリティを担保しているため、
// このフロントの判定はあくまで UX 上のガード。
(function () {
    if (window.location.pathname.endsWith('login.html')) return;

    const SUPABASE_REF = 'tzkzsucrgifrxnbxwdlq';
    const STORAGE_KEY = `sb-${SUPABASE_REF}-auth-token`;

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

    window.adminSession = session;
})();
