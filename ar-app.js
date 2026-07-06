/**
 * machica ARスキャン
 *
 * カード表面画像を画像トラッキングし、カード上に動画をオーバーレイ表示する。
 *
 * 構成は Supabase の settings テーブル (id='ar_config') から読み込む。
 * ar_config は管理画面の「AR管理」(admin/ar-settings.html) から公開される:
 *   { mind_url, updated_at, targets: [{ card_id, ratio, video_url }] }  ※配列順 = targetIndex
 *
 * ar_config が未公開・読込失敗の場合は、リポジトリ同梱のデモ構成
 * (assets/ar/targets.mind + モックカード2枚) にフォールバックする。
 */

const AR_DEMO_CONFIG = {
    mindSrc: 'assets/ar/targets.mind',
    cards: [
        {
            id: 1,
            title: '炉端焼き 漁火（デモ）',
            description: '北海道の新鮮な海の幸を囲炉裏端でじっくり焼き上げる老舗料理店。サンマ、ホッケ、ホタテなど旬の食材を豪快に炭火で調理。',
            video: 'assets/ar/demo1.mp4',
            ratio: 337 / 600,
        },
        {
            id: 2,
            title: '森の隠れ家カフェ ふじの杜（デモ）',
            description: '富士山麓の森の中にひっそりと佇む一軒家カフェ。自家農園のブルーベリーを使ったスイーツと丁寧に淹れたコーヒーが自慢。',
            video: 'assets/ar/demo2.mp4',
            ratio: 397 / 600,
        },
    ],
};

(function () {
    const scanGuide = document.getElementById('scanGuide');
    const infoPanel = document.getElementById('infoPanel');
    const infoTitle = document.getElementById('infoTitle');
    const infoDesc = document.getElementById('infoDesc');
    const infoLink = document.getElementById('infoLink');
    const replayBtn = document.getElementById('replayBtn');
    const tapToPlay = document.getElementById('tapToPlay');
    const tapPlayBtn = document.getElementById('tapPlayBtn');
    const arError = document.getElementById('arError');

    let arCards = [];
    let activeIndex = -1;

    /**
     * Supabase から公開済み AR 構成を取得。無ければ null。
     */
    async function loadPublishedConfig() {
        if (typeof supabaseClient === 'undefined') return null;
        try {
            const { data, error } = await supabaseClient
                .from('settings').select('value').eq('id', 'ar_config').single();
            if (error || !data || !data.value) return null;
            const cfg = data.value;
            if (!cfg.mind_url || !Array.isArray(cfg.targets) || cfg.targets.length === 0) return null;

            // カードのタイトル・説明は常に最新をDBから取得する
            const ids = cfg.targets.map(t => t.card_id);
            const { data: rows } = await supabaseClient
                .from('cards').select('id,title,description').in('id', ids);
            const byId = new Map((rows || []).map(r => [String(r.id), r]));

            return {
                mindSrc: cfg.mind_url,
                cards: cfg.targets.map(t => {
                    const card = byId.get(String(t.card_id));
                    return {
                        id: t.card_id,
                        title: card ? card.title : 'machica カード',
                        description: card ? (card.description || '') : '',
                        video: t.video_url,
                        ratio: t.ratio || 0.6,
                    };
                }),
            };
        } catch (e) {
            console.warn('AR config load failed, falling back to demo:', e);
            return null;
        }
    }

    function videoEl(index) {
        return document.getElementById('ar-video-' + index);
    }

    function tryPlay(video) {
        video.play().catch(() => {
            // iOS Safari はユーザー操作なしの再生を拒否することがある
            tapToPlay.classList.add('show');
        });
    }

    function showInfo(index) {
        const card = arCards[index];
        infoTitle.textContent = card.title;
        infoDesc.textContent = card.description;
        infoLink.href = 'index.html?card=' + encodeURIComponent(card.id);
        infoPanel.classList.add('show');
        scanGuide.classList.add('hidden');
    }

    function hideInfo() {
        infoPanel.classList.remove('show');
        scanGuide.classList.remove('hidden');
    }

    // ---- A-Frame シーンを構成から動的に構築 ----
    function buildScene(config) {
        arCards = config.cards;

        const scene = document.createElement('a-scene');
        scene.setAttribute('mindar-image',
            `imageTargetSrc: ${config.mindSrc}; maxTrack: 1; uiScanning: no; uiLoading: no; uiError: no`);
        scene.setAttribute('color-space', 'sRGB');
        scene.setAttribute('renderer', 'colorManagement: true');
        scene.setAttribute('vr-mode-ui', 'enabled: false');
        scene.setAttribute('device-orientation-permission-ui', 'enabled: false');
        scene.setAttribute('embedded', '');

        const assets = document.createElement('a-assets');
        arCards.forEach((card, i) => {
            const video = document.createElement('video');
            video.id = 'ar-video-' + i;
            video.src = card.video;
            video.setAttribute('preload', 'auto');
            video.setAttribute('loop', '');
            video.setAttribute('muted', '');
            video.muted = true; // 属性だけでは効かないブラウザ対策
            video.setAttribute('playsinline', '');
            video.setAttribute('crossorigin', 'anonymous');
            assets.appendChild(video);
        });
        scene.appendChild(assets);

        const camera = document.createElement('a-camera');
        camera.setAttribute('position', '0 0 0');
        camera.setAttribute('look-controls', 'enabled: false');
        scene.appendChild(camera);

        arCards.forEach((card, i) => {
            const target = document.createElement('a-entity');
            target.setAttribute('mindar-image-target', 'targetIndex: ' + i);

            // カードの真上に動画を重ねる (ターゲット幅 = 1 に正規化されている)
            const plane = document.createElement('a-video');
            plane.setAttribute('src', '#ar-video-' + i);
            plane.setAttribute('width', '1');
            plane.setAttribute('height', String(card.ratio));
            plane.setAttribute('position', '0 0 0.01');
            plane.setAttribute('rotation', '0 0 0');
            target.appendChild(plane);

            target.addEventListener('targetFound', () => {
                activeIndex = i;
                showInfo(i);
                tryPlay(videoEl(i));
            });
            target.addEventListener('targetLost', () => {
                if (activeIndex === i) activeIndex = -1;
                videoEl(i).pause();
                hideInfo();
            });

            scene.appendChild(target);
        });

        scene.addEventListener('arError', () => {
            arError.classList.add('show');
        });

        document.body.appendChild(scene);
    }

    // ---- UI イベント ----
    tapPlayBtn.addEventListener('click', () => {
        tapToPlay.classList.remove('show');
        if (activeIndex >= 0) videoEl(activeIndex).play().catch(() => {});
    });

    replayBtn.addEventListener('click', () => {
        if (activeIndex < 0) return;
        const video = videoEl(activeIndex);
        video.currentTime = 0;
        tryPlay(video);
    });

    // ---- 左→右スワイプでカード一覧に戻る (index.html からのスワイプ遷移と対) ----
    if ('ontouchstart' in window) {
        const EDGE = 24, MIN_X = 80, MAX_Y = 70, MAX_MS = 600;
        let sx = 0, sy = 0, st = 0, tracking = false;
        document.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) { tracking = false; return; }
            const t = e.touches[0];
            if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) { tracking = false; return; }
            sx = t.clientX; sy = t.clientY; st = Date.now(); tracking = true;
        }, { passive: true });
        document.addEventListener('touchend', (e) => {
            if (!tracking) return;
            tracking = false;
            const t = e.changedTouches[0];
            const dx = t.clientX - sx;
            const dy = t.clientY - sy;
            if (Date.now() - st <= MAX_MS && dx >= MIN_X && Math.abs(dy) <= MAX_Y && Math.abs(dx) > Math.abs(dy) * 2) {
                document.body.classList.add('page-swipe-back');
                setTimeout(() => { window.location.href = 'index.html'; }, 240);
            }
        }, { passive: true });
    }

    // カメラ非対応環境の早期検出
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        arError.classList.add('show');
        return;
    }

    loadPublishedConfig().then((config) => {
        buildScene(config || AR_DEMO_CONFIG);
    });
})();
