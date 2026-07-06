/**
 * ゲスト画面 → ARスキャン画面へのスワイプナビゲーション
 *
 * カード一覧 (index.html) で右→左に横スワイプすると、スライドアニメーション付きで
 * ARスキャン画面 (ar.html) に切り替わる。タッチ端末のみ有効。
 *
 * 誤発動ガード:
 *  - カード詳細モーダル (#modalOverlay.open) 表示中は無効
 *  - 横スクロール可能な要素 (サムネイル帯など) 内で始まったスワイプは無視
 *  - 画面端 24px から始まるスワイプは無視 (ブラウザの戻る/進むジェスチャと衝突するため)
 */
(function () {
    if (!('ontouchstart' in window)) return; // タッチ端末のみ

    const EDGE = 24;          // 画面端の不感帯 (px)
    const MIN_X = 80;         // 発動に必要な横移動量 (px)
    const MAX_Y = 70;         // 許容する縦ブレ (px)
    const MAX_MS = 600;       // スワイプとみなす最大時間

    let startX = 0, startY = 0, startTime = 0, tracking = false;

    function modalOpen() {
        const overlay = document.getElementById('modalOverlay');
        return overlay && overlay.classList.contains('open');
    }

    function inHorizontalScroller(el) {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
            const s = getComputedStyle(n);
            if ((s.overflowX === 'auto' || s.overflowX === 'scroll') &&
                n.scrollWidth > n.clientWidth + 4) {
                return true;
            }
        }
        return false;
    }

    function goToAR() {
        document.body.classList.add('page-swipe-out');
        setTimeout(() => { window.location.href = 'ar.html'; }, 240);
    }

    document.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) { tracking = false; return; }
        const t = e.touches[0];
        if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) { tracking = false; return; }
        if (modalOpen() || inHorizontalScroller(e.target)) { tracking = false; return; }
        startX = t.clientX;
        startY = t.clientY;
        startTime = Date.now();
        tracking = true;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;
        if (modalOpen()) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        const dt = Date.now() - startTime;
        if (dt <= MAX_MS && dx <= -MIN_X && Math.abs(dy) <= MAX_Y && Math.abs(dx) > Math.abs(dy) * 2) {
            goToAR();
        }
    }, { passive: true });

    // ARスキャンへの導線ヒント (タップでも遷移できる)
    const hint = document.createElement('button');
    hint.className = 'ar-swipe-hint';
    hint.type = 'button';
    hint.innerHTML = '<span class="ar-swipe-hint-arrow">◀</span> スワイプでARスキャン <span style="font-size:1.05em;">📷</span>';
    hint.addEventListener('click', goToAR);
    document.body.appendChild(hint);
})();
