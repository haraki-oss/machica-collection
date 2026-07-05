/**
 * machica ARスキャン (プロトタイプ)
 *
 * カード表面画像を画像トラッキングし、カード上に動画をオーバーレイ表示する。
 * ターゲットは admin/ar-compile.html で生成した assets/ar/targets.mind を使用。
 *
 * AR_CARDS の並び順は targets.mind のコンパイル時の画像順 (targetIndex) と
 * 必ず一致させること。
 */

const AR_TARGETS_SRC = 'assets/ar/targets.mind';

const AR_CARDS = [
    {
        id: 1,
        title: '炉端焼き 漁火',
        description: '北海道の新鮮な海の幸を囲炉裏端でじっくり焼き上げる老舗料理店。サンマ、ホッケ、ホタテなど旬の食材を豪快に炭火で調理。',
        // プロトタイプ用サンプル動画。本運用では Supabase Storage の URL に差し替える
        video: 'assets/ar/demo1.mp4',
        ratio: 337 / 600, // 画像の 高さ/幅 (動画プレーンのサイズに使用)
    },
    {
        id: 2,
        title: '森の隠れ家カフェ ふじの杜',
        description: '富士山麓の森の中にひっそりと佇む一軒家カフェ。自家農園のブルーベリーを使ったスイーツと丁寧に淹れたコーヒーが自慢。',
        video: 'assets/ar/demo2.mp4',
        ratio: 397 / 600,
    },
];

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

    let activeIndex = -1;

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
        const card = AR_CARDS[index];
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

    // ---- A-Frame シーンを AR_CARDS から動的に構築 ----
    function buildScene() {
        const scene = document.createElement('a-scene');
        scene.setAttribute('mindar-image',
            `imageTargetSrc: ${AR_TARGETS_SRC}; maxTrack: 1; uiScanning: no; uiLoading: no; uiError: no`);
        scene.setAttribute('color-space', 'sRGB');
        scene.setAttribute('renderer', 'colorManagement: true');
        scene.setAttribute('vr-mode-ui', 'enabled: false');
        scene.setAttribute('device-orientation-permission-ui', 'enabled: false');
        scene.setAttribute('embedded', '');

        const assets = document.createElement('a-assets');
        AR_CARDS.forEach((card, i) => {
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

        AR_CARDS.forEach((card, i) => {
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

    // カメラ非対応環境の早期検出
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        arError.classList.add('show');
        return;
    }

    buildScene();
})();
