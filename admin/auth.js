// auth.js
(function() {
    // ログインページ自体では認証チェックを行わない
    if (window.location.pathname.endsWith('login.html')) {
        return;
    }

    const isLoggedIn = sessionStorage.getItem('machica_admin_logged_in');
    if (!isLoggedIn) {
        // ログインしていない場合はログインページにリダイレクト
        window.location.href = 'login.html';
    }
})();
