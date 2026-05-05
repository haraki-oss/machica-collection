// 管理画面トップバーにアカウントメニュー（ログアウト・パスワード変更）を注入する。
// すべての管理ページで supabase-config.js のあとに読み込まれる前提。
(function () {
    if (window.location.pathname.endsWith('login.html')) return;
    if (typeof supabaseClient === 'undefined') {
        console.warn('[admin-account] supabaseClient not available');
        return;
    }

    const SUPABASE_REF = 'tzkzsucrgifrxnbxwdlq';
    const STORAGE_KEY = `sb-${SUPABASE_REF}-auth-token`;

    function injectStyles() {
        if (document.getElementById('admin-account-styles')) return;
        const style = document.createElement('style');
        style.id = 'admin-account-styles';
        style.textContent = `
            .admin-account {
                position: relative;
                display: flex;
                align-items: center;
            }
            .admin-account-trigger {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 8px 14px;
                border-radius: 999px;
                border: 1px solid var(--border);
                background: var(--bg-white);
                color: var(--text-primary);
                font-size: 0.85rem;
                cursor: pointer;
                transition: background 0.15s;
            }
            .admin-account-trigger:hover { background: var(--bg-soft); }
            .admin-account-avatar {
                width: 26px; height: 26px;
                border-radius: 50%;
                background: var(--amanek-black, #1E1B19);
                color: #fff;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 0.8rem;
                font-weight: 700;
            }
            .admin-account-menu {
                position: absolute;
                top: calc(100% + 8px);
                right: 0;
                min-width: 240px;
                background: var(--bg-white);
                border: 1px solid var(--border);
                border-radius: var(--radius-md, 8px);
                box-shadow: var(--shadow-lg);
                padding: 8px;
                z-index: 100;
                display: none;
            }
            .admin-account-menu.open { display: block; }
            .admin-account-email {
                padding: 8px 12px;
                font-size: 0.78rem;
                color: var(--text-muted);
                border-bottom: 1px solid var(--border);
                margin-bottom: 4px;
                word-break: break-all;
            }
            .admin-account-item {
                display: block;
                width: 100%;
                text-align: left;
                background: none;
                border: none;
                padding: 10px 12px;
                font-size: 0.88rem;
                color: var(--text-primary);
                border-radius: 6px;
                cursor: pointer;
            }
            .admin-account-item:hover { background: var(--bg-soft); }
            .admin-account-item.danger { color: #EF4444; }

            .admin-modal-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.45);
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 1000;
            }
            .admin-modal-backdrop.open { display: flex; }
            .admin-modal {
                background: var(--bg-white);
                width: 100%;
                max-width: 420px;
                padding: 28px;
                border-radius: var(--radius-lg);
                box-shadow: var(--shadow-lg);
            }
            .admin-modal h2 {
                margin: 0 0 6px;
                font-size: 1.1rem;
            }
            .admin-modal-sub {
                font-size: 0.82rem;
                color: var(--text-muted);
                margin-bottom: 20px;
            }
            .admin-modal .form-group { margin-bottom: 14px; }
            .admin-modal-error {
                color: #EF4444;
                font-size: 0.82rem;
                min-height: 1.2em;
                margin-bottom: 8px;
            }
            .admin-modal-actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
                margin-top: 8px;
            }
        `;
        document.head.appendChild(style);
    }

    function getInitial(email) {
        return (email || '?').trim().charAt(0).toUpperCase();
    }

    function buildMenu(email) {
        const wrapper = document.createElement('div');
        wrapper.className = 'admin-account';
        wrapper.innerHTML = `
            <button type="button" class="admin-account-trigger" id="adminAccountTrigger" aria-haspopup="menu" aria-expanded="false">
                <span class="admin-account-avatar">${getInitial(email)}</span>
                <span>アカウント</span>
            </button>
            <div class="admin-account-menu" id="adminAccountMenu" role="menu">
                <div class="admin-account-email" id="adminAccountEmail">${email || ''}</div>
                <button type="button" class="admin-account-item" id="adminChangePasswordBtn">🔑 パスワードを変更</button>
                <button type="button" class="admin-account-item danger" id="adminLogoutBtn">↪ ログアウト</button>
            </div>
        `;
        return wrapper;
    }

    function buildPasswordModal() {
        const backdrop = document.createElement('div');
        backdrop.className = 'admin-modal-backdrop';
        backdrop.id = 'adminPasswordModal';
        backdrop.innerHTML = `
            <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="adminPasswordTitle">
                <h2 id="adminPasswordTitle">パスワードを変更</h2>
                <div class="admin-modal-sub">新しいパスワードを 2 回入力してください（8 文字以上）。</div>
                <form id="adminPasswordForm">
                    <div class="form-group">
                        <label class="form-label" for="adminNewPassword">新しいパスワード</label>
                        <input type="password" id="adminNewPassword" class="form-control" autocomplete="new-password" minlength="8" required />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="adminNewPasswordConfirm">確認のためもう一度</label>
                        <input type="password" id="adminNewPasswordConfirm" class="form-control" autocomplete="new-password" minlength="8" required />
                    </div>
                    <div class="admin-modal-error" id="adminPasswordError"></div>
                    <div class="admin-modal-actions">
                        <button type="button" class="btn-secondary" id="adminPasswordCancel">キャンセル</button>
                        <button type="submit" class="btn-primary" id="adminPasswordSave">変更する</button>
                    </div>
                </form>
            </div>
        `;
        return backdrop;
    }

    function mount() {
        const session = window.adminSession;
        if (!session || !session.user) return;
        const email = session.user.email;

        injectStyles();

        // トップバーにメニューを注入
        const topbarActions = document.querySelector('.admin-topbar .topbar-actions');
        if (!topbarActions) return;
        const menu = buildMenu(email);
        topbarActions.appendChild(menu);

        // パスワード変更モーダルを注入
        const modal = buildPasswordModal();
        document.body.appendChild(modal);

        const trigger = document.getElementById('adminAccountTrigger');
        const dropdown = document.getElementById('adminAccountMenu');
        const logoutBtn = document.getElementById('adminLogoutBtn');
        const changeBtn = document.getElementById('adminChangePasswordBtn');
        const passwordModal = document.getElementById('adminPasswordModal');
        const passwordForm = document.getElementById('adminPasswordForm');
        const newPwdInput = document.getElementById('adminNewPassword');
        const confirmPwdInput = document.getElementById('adminNewPasswordConfirm');
        const errorEl = document.getElementById('adminPasswordError');
        const saveBtn = document.getElementById('adminPasswordSave');
        const cancelBtn = document.getElementById('adminPasswordCancel');

        function closeMenu() {
            dropdown.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
        }
        function openMenu() {
            dropdown.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
        }
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.contains('open') ? closeMenu() : openMenu();
        });
        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target)) closeMenu();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeMenu();
                passwordModal.classList.remove('open');
            }
        });

        logoutBtn.addEventListener('click', async () => {
            if (!confirm('ログアウトしますか？')) return;
            try {
                const p = supabaseClient.auth.signOut();
                const t = new Promise((resolve) => setTimeout(resolve, 4000));
                await Promise.race([p, t]);
            } catch (_) {}
            try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
            window.location.href = 'login.html';
        });

        function openPasswordModal() {
            errorEl.textContent = '';
            newPwdInput.value = '';
            confirmPwdInput.value = '';
            passwordModal.classList.add('open');
            setTimeout(() => newPwdInput.focus(), 50);
        }
        function closePasswordModal() {
            passwordModal.classList.remove('open');
        }
        changeBtn.addEventListener('click', () => {
            closeMenu();
            openPasswordModal();
        });
        cancelBtn.addEventListener('click', closePasswordModal);
        passwordModal.addEventListener('click', (e) => {
            if (e.target === passwordModal) closePasswordModal();
        });

        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorEl.textContent = '';
            const pwd = newPwdInput.value;
            const confirmPwd = confirmPwdInput.value;
            if (pwd.length < 8) {
                errorEl.textContent = 'パスワードは 8 文字以上にしてください。';
                return;
            }
            if (pwd !== confirmPwd) {
                errorEl.textContent = 'パスワードが一致しません。';
                return;
            }
            saveBtn.disabled = true;
            saveBtn.textContent = '保存中...';
            try {
                const callP = supabaseClient.auth.updateUser({ password: pwd });
                const timeoutP = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('updateUser timeout')), 8000)
                );
                const { data, error } = await Promise.race([callP, timeoutP]);
                if (error) throw error;
                alert('パスワードを変更しました。次回ログイン時から新しいパスワードを使用してください。');
                closePasswordModal();
            } catch (err) {
                errorEl.textContent = '変更に失敗しました: ' + (err?.message || err);
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = '変更する';
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();
