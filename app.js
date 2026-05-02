/**
 * machica - メインアプリケーションJavaScript
 * 公開サイト（index.html）用
 */

// 公開サイトアクセス時に管理画面のセッションをリセットし、毎回パスワードを求めるようにする
sessionStorage.removeItem('machica_admin_logged_in');

// ── 状態管理 ─────────────────────────────────────
let state = {
    cards: [],
    filtered: [],
    keyword: '',
    genre: 'all',
    area: 'all',
    lang: 'ja', // 'ja' or 'en'
    currentCard: null,
    map: null,
    marker: null,
    mapsLoaded: false,
    showLikedOnly: false, // MY LIKES モード
};

// ── Google Maps APIキー ──────────────────────────
const GOOGLE_MAPS_API_KEY = '';

// ── 初期化 ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // 移行の実行（公開側でも初回アクセス時に必要）
    await migrateLocalStorageToIndexedDB();

    // 言語設定読み込み
    const savedLang = localStorage.getItem('machica_lang');
    if (savedLang === 'en') state.lang = 'en';
    updateLanguageUI();

    await initCards();
    renderGenreButtons();
    populateAreaFilter();
    bindEvents();
    loadGoogleMapsAPI();
});

async function initCards() {
    // IndexedDB からカスタムカードと設定情報を取得
    const customCards = await machicaDB.getAll('cards');
    const settings = await machicaDB.getAll('settings');
    const deletedIds = settings.find(s => s.id === 'deleted_card_ids')?.value || [];

    // モックデータから削除済みを除外
    const mocks = CARDS_DATA.filter(c => !deletedIds.includes(c.id));

    // 統合（カスタム優先、降順）
    state.cards = [...customCards, ...mocks].map(c => ({ ...c }));
    state.cards.sort((a, b) => b.id - a.id);

    state.filtered = [...state.cards];
    renderCards(state.filtered);

    // URLパラメータのチェック（地図からの遷移など）
    const params = new URLSearchParams(window.location.search);
    const targetCardId = params.get('card');
    if (targetCardId) {
        const idNum = parseInt(targetCardId, 10);
        if (!isNaN(idNum) && state.cards.some(c => c.id === idNum)) {
            // DOM描画待ちのため少しだけ遅延させる
            setTimeout(() => {
                openModal(idNum);
            }, 100);
            
            // パラメータをURLから消去しておく（任意）
            const newUrl = window.location.pathname;
            window.history.replaceState({}, document.title, newUrl);
        }
    }
}

// ── ジャンルボタンを動的生成 ───────────────────────


// ── イベント登録 ──────────────────────────────────
function bindEvents() {
    // 言語切り替え
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.dataset.lang;
            if (state.lang !== lang) {
                state.lang = lang;
                localStorage.setItem('machica_lang', lang);
                updateLanguageUI();
            }
        });
    });

    // キーワード検索
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');

    searchInput?.addEventListener('input', (e) => {
        state.keyword = e.target.value.trim();
        searchClear?.classList.toggle('visible', state.keyword.length > 0);
        applyFilters();
    });

    searchClear?.addEventListener('click', () => {
        searchInput.value = '';
        state.keyword = '';
        searchClear.classList.remove('visible');
        applyFilters();
    });

    // エリアフィルター
    document.getElementById('areaSelect')?.addEventListener('change', (e) => {
        state.area = e.target.value;
        applyFilters();
    });

    // モーダル閉じる
    document.getElementById('modalClose')?.addEventListener('click', closeModal);
    document.getElementById('modalOverlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('modalOverlay')) closeModal();
    });

    // Escキー
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // シェアボタン
    document.getElementById('shareBtn')?.addEventListener('click', shareCard);

    // ハンバーガーメニュー
    document.getElementById('hamburgerBtn')?.addEventListener('click', () => {
        const nav = document.getElementById('mobileNav');
        nav?.classList.toggle('open');
    });

    // 裏面切り替え
    document.getElementById('flipBtn')?.addEventListener('click', () => {
        const card = state.currentCard;
        const backUrl = card.image_url_back || card.back_image_url;
        if (!card || !backUrl) return;

        const imgEl = document.getElementById('modalImage');
        if (imgEl.src.includes(backUrl)) {
            imgEl.src = card.image_url;
            imgEl.style.transform = 'scale(1)';
        } else {
            imgEl.src = backUrl;
        }
    });

    bindFilterAutoHide();
    bindMyLikes();
}

// ── MY LIKES モード切替 ──────────────────────────
function bindMyLikes() {
    const toggle = document.getElementById('myLikesToggle');
    const bannerClose = document.getElementById('myLikesBannerClose');
    const exitBtn = document.getElementById('exitMyLikes');

    toggle?.addEventListener('click', () => {
        state.showLikedOnly = !state.showLikedOnly;
        applyFilters();
    });

    const exitMyLikes = () => {
        if (!state.showLikedOnly) return;
        state.showLikedOnly = false;
        applyFilters();
    };
    bannerClose?.addEventListener('click', exitMyLikes);
    exitBtn?.addEventListener('click', exitMyLikes);

    updateMyLikesUI();
}

function updateMyLikesUI() {
    const liked = getLocalLiked();
    const count = liked.size;

    // ヘッダーのトグル
    const toggle = document.getElementById('myLikesToggle');
    const countEl = document.getElementById('myLikesCount');
    if (toggle) toggle.setAttribute('aria-pressed', state.showLikedOnly ? 'true' : 'false');
    if (countEl) countEl.textContent = count;

    // バナー本文を言語別に再描画（"MY LIKES n 件" / "MY LIKES n cards"）
    const banner = document.getElementById('myLikesBanner');
    if (banner) banner.style.display = state.showLikedOnly ? 'flex' : 'none';

    const bannerText = banner?.querySelector('.my-likes-banner-text');
    if (bannerText) {
        const noun = state.lang === 'en' ? (count === 1 ? 'card' : 'cards') : '件';
        bannerText.innerHTML = `MY LIKES <span id="myLikesBannerCount">${count}</span> ${noun}`;
    }
}

// フィルターセクションのオートハイド
// - 縦スクロールで一定量下に進むと隠れる
// - 上向きスクロールで再表示
// - 画面上部にマウスを近づけたとき再表示
function bindFilterAutoHide() {
    const filter = document.querySelector('.filter-section');
    if (!filter) return;

    const HIDE_THRESHOLD = 180; // hero を抜けたあたりから隠し始める
    const HOVER_REVEAL = 90;    // viewport top からこの距離以内に cursor が来たら表示

    let mouseAtTop = false;
    let lastScrollY = window.scrollY;
    let scrollingUp = false;

    function evaluate() {
        const y = window.scrollY;
        const passed = y > HIDE_THRESHOLD;
        const shouldShow = mouseAtTop || !passed || scrollingUp;
        filter.classList.toggle('is-hidden', !shouldShow);
    }

    window.addEventListener('scroll', () => {
        const y = window.scrollY;
        scrollingUp = y < lastScrollY;
        lastScrollY = y;
        evaluate();
    }, { passive: true });

    document.addEventListener('mousemove', (e) => {
        const next = e.clientY < HOVER_REVEAL;
        if (next !== mouseAtTop) {
            mouseAtTop = next;
            evaluate();
        }
    });

    // タッチデバイス用：上部タップでも一度だけ復活
    document.addEventListener('touchstart', (e) => {
        const t = e.touches && e.touches[0];
        if (t && t.clientY < HOVER_REVEAL) {
            mouseAtTop = true;
            evaluate();
            // 5秒後に解除
            setTimeout(() => { mouseAtTop = false; evaluate(); }, 5000);
        }
    }, { passive: true });

    evaluate();
}

function updateLanguageUI() {
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === state.lang);
        // インラインスタイルの調整
        if (btn.dataset.lang === state.lang) {
            btn.style.background = '#fff';
            btn.style.color = '#333';
            btn.style.opacity = '1';
        } else {
            btn.style.background = '#f0f0f0';
            btn.style.color = '#999';
            btn.style.opacity = '0.7';
        }
    });

    // テキスト要素の更新（machica collection ブランド版）
    const t_hero_title = {
        ja: 'machica collection',
        en: 'machica collection'
    };
    const t_hero_sub = {
        ja: '<span class="hero-sub-en">One card, one new experience.</span><span class="hero-sub-ja">1枚のカードから、旅の新しい一歩を。</span>',
        en: '<span class="hero-sub-en">One card, one new experience.</span><span class="hero-sub-ja">Begin a new chapter of your trip, in just one card.</span>'
    };

    const heroTitle = document.querySelector('.hero-title');
    const heroSub = document.querySelector('.hero-sub');
    if (heroTitle) heroTitle.innerHTML = t_hero_title[state.lang];
    if (heroSub) heroSub.innerHTML = t_hero_sub[state.lang];

    const areaAllText = state.lang === 'en' ? 'Area (All)' : 'エリア（全国）';
    const areaSelect = document.getElementById('areaSelect');
    if (areaSelect && areaSelect.options[0]) {
        areaSelect.options[0].textContent = areaAllText;
    }

    const resultSuffix = state.lang === 'en' ? ' spots found' : '件のスポットが見つかりました';
    const resultCountLabel = document.querySelector('.result-count');
    if (resultCountLabel) {
        // 数値を保持しつつテキストだけ変える
        resultCountLabel.innerHTML = `<span id="resultCount">${state.filtered.length}</span>${resultSuffix}`;
    }

    // 検索プレースホルダー
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.placeholder = state.lang === 'en'
            ? 'Search by spot or keyword…'
            : 'スポット名・キーワードで検索…';
    }

    // ヘッダー / モバイルナビのリンクラベル
    const navLabels = {
        'index.html': { ja: 'カード一覧', en: 'Cards' },
        'map.html':   { ja: '地図で見る', en: 'Map' },
    };
    document.querySelectorAll('.header-nav .nav-link, .mobile-nav .nav-link').forEach(a => {
        const key = (a.getAttribute('href') || '').split('/').pop();
        const t = navLabels[key];
        if (t) a.textContent = t[state.lang] || t.ja;
    });

    // フッターの管理画面リンク
    const footerAdmin = document.querySelector('.footer-admin-link');
    if (footerAdmin) {
        footerAdmin.textContent = state.lang === 'en' ? 'Admin' : '管理画面';
    }

    // 結果ゼロ時のメッセージ（条件不一致）
    const noResultsP = document.querySelector('#noResults p');
    if (noResultsP) {
        noResultsP.textContent = state.lang === 'en'
            ? '🔍 No spots match your filter'
            : '🔍 条件に合うスポットが見つかりませんでした';
    }
    const noResultsBtn = document.querySelector('#noResults button');
    if (noResultsBtn) {
        noResultsBtn.textContent = state.lang === 'en' ? 'Reset filters' : 'フィルターをリセット';
    }

    // MY LIKES 空状態
    const noLikesPs = document.querySelectorAll('#noLikes p');
    if (noLikesPs[0]) {
        noLikesPs[0].textContent = state.lang === 'en'
            ? '♡ No liked cards yet'
            : '♡ まだLIKEしたカードがありません';
    }
    if (noLikesPs[1]) {
        noLikesPs[1].textContent = state.lang === 'en'
            ? "Open a card you like and tap LIKE — it'll appear here."
            : '気に入ったカードを開いて LIKE を押すと、ここに表示されます。';
    }
    const exitBtn = document.getElementById('exitMyLikes');
    if (exitBtn) {
        exitBtn.textContent = state.lang === 'en' ? 'Browse all cards' : 'すべてのカードを見る';
    }

    // MY LIKES トグルの aria-label
    const myLikesToggle = document.getElementById('myLikesToggle');
    if (myLikesToggle) {
        myLikesToggle.setAttribute(
            'aria-label',
            state.lang === 'en' ? 'Show MY LIKES' : 'MY LIKES を表示'
        );
    }

    // バナークローズボタンの aria-label
    const bannerClose = document.getElementById('myLikesBannerClose');
    if (bannerClose) {
        bannerClose.setAttribute(
            'aria-label',
            state.lang === 'en' ? 'Close MY LIKES' : 'MY LIKES を閉じる'
        );
    }

    // 再描画
    renderGenreButtons();
    populateAreaFilter();
    applyFilters();
    updateMyLikesUI();
}

// 競合する非同期描画から後発の呼び出しのみ反映するための世代カウンタ
let _areaRenderGen = 0;
let _genreRenderGen = 0;

async function populateAreaFilter() {
    const select = document.getElementById('areaSelect');
    if (!select) return;

    const myGen = ++_areaRenderGen;
    const currentVal = state.area;
    const firstOpt = select.options[0];

    const areas = await getAllAreasAsync();

    // 後発の呼び出しが走り始めていたら自分の結果は捨てる
    if (myGen !== _areaRenderGen) return;

    select.innerHTML = '';
    select.appendChild(firstOpt);
    areas.forEach(area => {
        if (area.id === 99) return;
        const opt = document.createElement('option');
        opt.value = area.name;
        opt.textContent = state.lang === 'en' ? (area.name_en || area.name) : area.name;
        select.appendChild(opt);
    });
    select.value = currentVal;
}

async function renderGenreButtons() {
    const container = document.getElementById('genreFilters');
    if (!container) return;

    const myGen = ++_genreRenderGen;

    const categories = await getAllCategoriesAsync();

    // 後発の呼び出しが走り始めていたら自分の結果は捨てる
    if (myGen !== _genreRenderGen) return;

    container.innerHTML = '';

    // 「すべて」ボタン
    const allBtn = document.createElement('button');
    allBtn.className = `genre-btn ${state.genre === 'all' ? 'active' : ''}`;
    allBtn.dataset.genre = 'all';
    allBtn.textContent = state.lang === 'en' ? 'All' : 'すべて';
    allBtn.onclick = () => setGenre('all');
    container.appendChild(allBtn);

    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = `genre-btn ${state.genre == cat.id ? 'active' : ''}`;
        btn.dataset.genre = cat.id;

        const iconHtml = getCategoryIcon(cat);

        const name = state.lang === 'en' && cat.name_en ? cat.name_en : cat.name;
        btn.innerHTML = `${iconHtml}<span>${name}</span>`;
        btn.onclick = () => setGenre(cat.id);
        container.appendChild(btn);
    });
}

// ── ヘルパー（IndexedDB版データ取得） ────────────────
async function getAllAreasAsync() {
    const customAreas = await machicaDB.getAll('areas');
    const settings = await machicaDB.getAll('settings');
    const editedAreas = settings.find(s => s.id === 'edited_areas')?.value || [];
    const deletedIds = settings.find(s => s.id === 'deleted_area_ids')?.value || [];
    let areas = AREAS_DATA.map(a => {
        const edited = editedAreas.find(e => e.id === a.id);
        return edited ? { ...a, ...edited } : a;
    });
    areas = areas.filter(a => !deletedIds.includes(a.id));

    // カスタム側の自己重複を slug 優先で排除
    const seen = new Set();
    const dedupedCustom = customAreas.filter(a => {
        const key = a.slug || `id:${a.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // デフォルト側は slug / id どちらかで重複していたら除外
    const customSlugs = new Set(dedupedCustom.map(a => a.slug).filter(Boolean));
    const customIds = new Set(dedupedCustom.map(a => a.id));
    return [
        ...areas.filter(a => !customSlugs.has(a.slug) && !customIds.has(a.id)),
        ...dedupedCustom,
    ];
}

async function getAllCategoriesAsync() {
    const customCats = await machicaDB.getAll('categories');
    const settings = await machicaDB.getAll('settings');
    const deletedIds = settings.find(s => s.id === 'deleted_category_ids')?.value || [];
    const defaults = CATEGORIES_DATA.filter(c => !deletedIds.includes(c.id));

    // カスタム側の自己重複を slug 優先で排除
    const seen = new Set();
    const dedupedCustom = customCats.filter(c => {
        const key = c.slug || `id:${c.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // デフォルト側は slug / id どちらかでカスタムと重複していたら除外
    const customSlugs = new Set(dedupedCustom.map(c => c.slug).filter(Boolean));
    const customIds = new Set(dedupedCustom.map(c => c.id));
    const merged = [
        ...defaults.filter(c => !customSlugs.has(c.slug) && !customIds.has(c.id)),
        ...dedupedCustom,
    ];
    return merged.sort((a, b) => (a.id || 0) - (b.id || 0));
}

// ── ジャンルフィルター ────────────────────────────
function setGenre(genreId) {
    state.genre = genreId;
    document.querySelectorAll('.genre-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.genre == genreId);
    });
    applyFilters();
}

// ── フィルター適用 ────────────────────────────────
function applyFilters() {
    const kw = state.keyword.toLowerCase();
    const likedSet = state.showLikedOnly ? getLocalLiked() : null;

    state.filtered = state.cards.filter(card => {
        if (likedSet && !likedSet.has(String(card.id))) return false;
        const matchKeyword = !kw || card.title.toLowerCase().includes(kw) || card.description.toLowerCase().includes(kw);
        const matchGenre = state.genre === 'all' || card.category_id == state.genre;
        const matchArea = state.area === 'all' || card.area === state.area;
        return matchKeyword && matchGenre && matchArea;
    });

    renderCards(state.filtered);
    updateMyLikesUI();
}

function resetFilters() {
    state.keyword = '';
    state.genre = 'all';
    state.area = 'all';
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').classList.remove('visible');
    document.getElementById('areaSelect').value = 'all';
    document.querySelectorAll('.genre-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.genre === 'all');
    });
    applyFilters();
}

// ── カード描画 ────────────────────────────────────
function renderCards(cards) {
    const grid = document.getElementById('cardGrid');
    const noResults = document.getElementById('noResults');
    const noLikes = document.getElementById('noLikes');
    const resultCount = document.getElementById('resultCount');

    if (!grid) return;

    if (resultCount) resultCount.textContent = cards.length;

    if (cards.length === 0) {
        grid.innerHTML = '';
        // MY LIKES モードかつローカルに Like 履歴がゼロなら専用空状態を表示
        if (state.showLikedOnly && getLocalLiked().size === 0) {
            if (noLikes) noLikes.style.display = 'block';
            if (noResults) noResults.style.display = 'none';
        } else {
            if (noResults) noResults.style.display = 'block';
            if (noLikes) noLikes.style.display = 'none';
        }
        return;
    }

    if (noResults) noResults.style.display = 'none';
    if (noLikes) noLikes.style.display = 'none';

    grid.innerHTML = cards.map((card, i) => createCardHTML(card, i)).join('');

    // カードクリックでモーダル
    grid.querySelectorAll('.card-item').forEach(item => {
        item.addEventListener('click', () => openModal(parseInt(item.dataset.id)));
    });
}

function createCardHTML(card, index) {
    const cat = getCategoryById(card.category_id);

    // 多言語対応
    const lang = state.lang;
    const title = (lang === 'en' && card.title_en) ? card.title_en : card.title;
    const areaName = (lang === 'en') ? getAreaName(card.area, 'en') : card.area;

    const catName = cat ? ((lang === 'en' && cat.name_en) ? cat.name_en : cat.name) : '';

    const badgeStyle = cat ? `background:${cat.bg}; color:${cat.color};` : '';
    const iconHtml = cat ? getCategoryIcon(cat) : '';

    // 裏面画像
    const backUrl = card.image_url_back || card.back_image_url;
    const hasBack = !!backUrl;
    const backImageHtml = hasBack
        ? `<img src="${backUrl}" alt="${title} Back" class="card-image" loading="lazy" />`
        : `<div style="display:flex;flex-direction:column;align-items:center;color:var(--text-muted);"><span style="font-size:3rem;opacity:0.3;">🗾</span><span style="font-size:0.9rem;margin-top:8px;opacity:0.5;">machica</span></div>`;

    return `
    <article class="card-item" data-id="${card.id}" style="animation-delay:${index * 0.05}s" role="button" tabindex="0" aria-label="${title}">
      <div class="card-image-wrap ${hasBack ? 'has-back' : ''}">
        
        <!-- 表面 -->
        <div class="card-front">
          <img
            src="${card.image_url}"
            alt="${title}"
            class="card-image"
            loading="lazy"
            onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'600\' height=\'900\' viewBox=\'0 0 600 900\'%3E%3Crect fill=\'%23F1F5F9\' width=\'600\' height=\'900\'/%3E%3Ctext fill=\'%2394A3B8\' font-size=\'24\' x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\'%3E📷%3C/text%3E%3C/svg%3E'"
          />
          ${cat ? `<span class="card-category-badge" style="${badgeStyle}">${iconHtml}<span>${catName}</span></span>` : ''}
          
          <!-- スポット名オーバーレイ -->
          <div class="card-name-overlay">
            <p class="card-overlay-area">${areaName}</p>
            <h3 class="card-overlay-title">${title}</h3>
          </div>
        </div>

        <!-- 裏面 -->
        <div class="card-back">
          ${backImageHtml}
        </div>
      </div>
    </article>
  `;
}



// ── コレクト機能 ──────────────────────────────────
// ── コレクト機能機能削除 (互換性のため関数名のみ残すか、完全に消すか。今回は消す)
// function toggleCollect(cardId) { ... }

// ── モーダル ──────────────────────────────────────
function openModal(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    state.currentCard = card;

    const cat = getCategoryById(card.category_id);

    // メイン画像
    const mainImg = document.getElementById('modalImage');
    mainImg.src = card.image_url;
    mainImg.alt = card.title;

    // 裏面ボタン表示制御
    const flipBtn = document.getElementById('flipBtn');
    const backUrl = card.image_url_back || card.back_image_url;
    if (flipBtn) {
        flipBtn.style.display = backUrl ? 'flex' : 'none';
        mainImg.style.transform = 'scale(1)';
    }

    // ギャラリーサムネイル生成
    const thumbsContainer = document.getElementById('modalThumbs');
    if (thumbsContainer) {
        thumbsContainer.innerHTML = '';
        const images = [card.image_url];
        const gallery = card.gallery || card.gallery_images;
        if (gallery && Array.isArray(gallery)) {
            images.push(...gallery);
        }

        if (images.length > 1) {
            thumbsContainer.style.display = 'flex';
            images.forEach((src, idx) => {
                const thumb = document.createElement('img');
                thumb.src = src;
                thumb.className = `modal-thumb ${idx === 0 ? 'active' : ''}`;
                thumb.onclick = () => {
                    mainImg.src = src;
                    document.querySelectorAll('.modal-thumb').forEach(t => t.classList.remove('active'));
                    thumb.classList.add('active');
                };
                thumbsContainer.appendChild(thumb);
            });
        } else {
            thumbsContainer.style.display = 'none';
        }
    }

    // 多言語対応テキスト設定
    const lang = state.lang;
    let title = (lang === 'en' && card.title_en) ? card.title_en : card.title;
    let desc = (lang === 'en' && card.description_en) ? card.description_en : card.description;
    let address = (lang === 'en' && card.address_en) ? card.address_en : card.address;

    // 英語モードでデータがない場合の動的翻訳フォールバック
    if (lang === 'en' && (!card.title_en || !card.description_en || !card.address_en)) {
        // ロード中表示
        document.getElementById('modalTitle').textContent = 'Translating...';
        document.getElementById('modalDescription').textContent = 'Please wait while we translate the details...';

        (async () => {
            try {
                const separator = ' ::: ';
                const combined = [card.title, card.description, card.address].join(separator);
                const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(combined)}&langpair=ja|en`;
                const res = await fetch(url);
                const data = await res.json();
                const translated = data.responseData.translatedText.split(separator).map(s => s?.trim());

                if (translated.length >= 3) {
                    card.title_en = translated[0];
                    card.description_en = translated[1];
                    card.address_en = translated[2];

                    // 再表示（モーダルが開いている間のみ）
                    if (state.currentCard && state.currentCard.id === card.id) {
                        document.getElementById('modalTitle').textContent = card.title_en;
                        document.getElementById('modalDescription').textContent = card.description_en;
                        document.getElementById('modalAddress').textContent = card.address_en;
                    }
                }
            } catch (e) {
                console.error('Dynamic translation failed:', e);
            }
        })();
    }

    // areas.jsのgetAreaNameを使う
    const areaName = (lang === 'en') ? getAreaName(card.area, 'en') : card.area;

    // カテゴリ名
    const catName = cat ? ((lang === 'en' && cat.name_en) ? cat.name_en : cat.name) : '';

    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalDescription').textContent = desc;
    document.getElementById('modalAddress').textContent = address;
    document.getElementById('modalArea').textContent = areaName;
    // モーダルのジャンルバッジは廃止（旧 #modalCategory）。バッジは画像オーバーレイ側のみ。
    const modalCategoryEl = document.getElementById('modalCategory');
    if (modalCategoryEl) {
        modalCategoryEl.innerHTML = cat ? `${getCategoryIcon(cat)} <span>${catName}</span>` : '';
    }

    // バッジ
    const badge = document.getElementById('modalBadge');
    if (badge && cat) {
        badge.innerHTML = `${getCategoryIcon(cat)} <span>${catName}</span>`;
        badge.style.background = cat.bg;
        badge.style.color = cat.color;
        badge.style.backdropFilter = 'blur(8px)';
    }

    // Google Maps で該当スポットを表示するリンク
    // ルート検索ではなく、スポット名+住所で検索してビジネス情報を表示する
    const routeBtn = document.getElementById('routeBtn');
    const lat = card.lat || card.latitude;
    const lng = card.lng || card.longitude;
    if (routeBtn) {
        const query = encodeURIComponent(
            [card.title, card.address].filter(Boolean).join(' ')
        );
        if (query) {
            routeBtn.href = `https://www.google.com/maps/search/?api=1&query=${query}`;
        } else if (lat && lng) {
            routeBtn.href = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        } else {
            routeBtn.href = 'https://www.google.com/maps';
        }
    }

    // 地図初期化
    initModalMap(card);

    // LIKE ボタン初期化
    setupLikeButton(card);

    // モーダルを開く
    document.getElementById('modalOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
}

// ── LIKE ボタン制御 ──────────────────────────────
const LIKES_SETTINGS_KEY = 'card_likes';
const LOCAL_LIKED_KEY = 'machica_liked_cards';

function getLocalLiked() {
    try {
        return new Set(JSON.parse(localStorage.getItem(LOCAL_LIKED_KEY) || '[]'));
    } catch (e) {
        return new Set();
    }
}

function markLocalLiked(cardId) {
    const set = getLocalLiked();
    set.add(String(cardId));
    localStorage.setItem(LOCAL_LIKED_KEY, JSON.stringify([...set]));
}

function unmarkLocalLiked(cardId) {
    const set = getLocalLiked();
    set.delete(String(cardId));
    localStorage.setItem(LOCAL_LIKED_KEY, JSON.stringify([...set]));
}

async function fetchLikesMap() {
    try {
        const settings = await machicaDB.getAll('settings');
        const row = settings.find(s => s.id === LIKES_SETTINGS_KEY);
        return (row && row.value && typeof row.value === 'object') ? row.value : {};
    } catch (e) {
        console.error('fetchLikesMap failed:', e);
        return {};
    }
}

async function persistLikesMap(map) {
    try {
        await machicaDB.put('settings', { id: LIKES_SETTINGS_KEY, value: map });
    } catch (e) {
        console.error('persistLikesMap failed:', e);
        throw e;
    }
}

async function setupLikeButton(card) {
    const btn = document.getElementById('likeBtn');
    if (!btn) return;

    const cardKey = String(card.id);

    // 既存のリスナーを除去するため新しいボタンに置換
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    const countEl = fresh.querySelector('.like-count');
    const iconEl = fresh.querySelector('.like-icon');

    // 表示反映ヘルパ
    function applyState(isLiked, count) {
        fresh.classList.toggle('is-liked', isLiked);
        fresh.setAttribute('aria-pressed', isLiked ? 'true' : 'false');
        iconEl.textContent = isLiked ? '♥' : '♡';
        countEl.textContent = count;
    }

    // 初期状態
    let liked = getLocalLiked().has(cardKey);
    countEl.textContent = '…';
    fresh.classList.toggle('is-liked', liked);
    iconEl.textContent = liked ? '♥' : '♡';

    // Supabase から最新カウントを取得
    const likesMap = await fetchLikesMap();
    let count = Number(likesMap[cardKey] || 0);
    applyState(liked, count);

    fresh.addEventListener('click', async () => {
        if (fresh.disabled) return;
        fresh.disabled = true;

        const goingToLike = !liked; // クリック後の方向：true=Like、false=UnLike
        const delta = goingToLike ? 1 : -1;

        // 楽観的 UI 更新
        liked = goingToLike;
        count = Math.max(0, count + delta);
        applyState(liked, count);
        if (goingToLike) {
            fresh.classList.add('is-pulsing');
            setTimeout(() => fresh.classList.remove('is-pulsing'), 500);
        }

        try {
            // 最新値を取得してから増減（粗い同時操作対策）
            const current = await fetchLikesMap();
            const nextCount = Math.max(0, Number(current[cardKey] || 0) + delta);
            const nextMap = { ...current, [cardKey]: nextCount };
            await persistLikesMap(nextMap);

            if (goingToLike) markLocalLiked(cardKey);
            else unmarkLocalLiked(cardKey);

            // サーバーの最新値で上書き表示
            count = nextCount;
            applyState(liked, count);

            // ヘッダーのバッジ＆MY LIKES モード時は一覧側も再フィルタ
            updateMyLikesUI();
            if (state.showLikedOnly) applyFilters();
        } catch (e) {
            // ロールバック
            liked = !goingToLike;
            count = Math.max(0, count - delta);
            applyState(liked, count);
            alert('LIKEの保存に失敗しました。少し時間をおいて再試行してください。');
        } finally {
            fresh.disabled = false;
        }
    });
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
    document.body.style.overflow = '';
    state.currentCard = null;

    // 画像クリア（次回チラつき防止）
    setTimeout(() => {
        const img = document.getElementById('modalImage');
        if (img) img.src = '';
        const thumbs = document.getElementById('modalThumbs');
        if (thumbs) thumbs.innerHTML = '';
    }, 300);
}

// ── Google Maps 連携 ──────────────────────────────
function loadGoogleMapsAPI() {
    if (!GOOGLE_MAPS_API_KEY) {
        state.mapsLoaded = false;
        return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&callback=onGoogleMapsLoaded`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

// Google Maps SDK ロード完了コールバック（グローバル）
window.onGoogleMapsLoaded = function () {
    state.mapsLoaded = true;
};

function initModalMap(card) {
    const mapContainer = document.getElementById('googleMap');
    const placeholder = document.getElementById('mapPlaceholder');

    const latRaw = card.lat || card.latitude;
    const lngRaw = card.lng || card.longitude;

    if (!latRaw || !lngRaw) {
        if (placeholder) {
            placeholder.style.display = 'flex';
            placeholder.innerHTML = '<span>📍</span><p>座標情報がありません</p>';
        }
        if (mapContainer) mapContainer.innerHTML = '';
        return;
    }

    if (placeholder) placeholder.style.display = 'none';
    const lat = parseFloat(latRaw);
    const lng = parseFloat(lngRaw);

    if (state.mapsLoaded && window.google) {
        // Google Maps JS API が読み込まれている場合
        mapContainer.innerHTML = '';
        const latLng = { lat, lng };
        if (!state.map) {
            state.map = new google.maps.Map(mapContainer, {
                center: latLng,
                zoom: 15,
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
                styles: [
                    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
                ],
            });
        } else {
            state.map.setCenter(latLng);
            if (state.marker) state.marker.setMap(null);
        }
        state.marker = new google.maps.Marker({
            position: latLng,
            map: state.map,
            title: card.title,
            animation: google.maps.Animation.DROP,
        });
    } else {
        // フォールバック: Google Maps Embed（APIキー不要）
        // ※ローカルファイル(file://)では iframe が blocked になる場合があります。
        //   その場合はリンクボタンを表示します。
        mapContainer.innerHTML = `
      <iframe
        src="https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed"
        style="width:100%;height:100%;border:0;"
        loading="lazy"
        allowfullscreen
        referrerpolicy="no-referrer-when-downgrade"
        title="${card.title}の地図"
      ></iframe>
    `;
        // ローカルfile://でブロックされた場合のフォールバック表示
        const iframe = mapContainer.querySelector('iframe');
        if (iframe) {
            iframe.onerror = () => {
                mapContainer.innerHTML = buildMapFallback(lat, lng);
            };
        }
    }
}

function buildMapFallback(lat, lng) {
    return `
    <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}"
       target="_blank" rel="noopener"
       style="display:flex;flex-direction:column;align-items:center;justify-content:center;
              height:100%;gap:12px;text-decoration:none;color:var(--primary);
              background:#F4F4F2;">
      <span style="font-size:2rem;">🗺️</span>
      <span style="font-size:0.88rem;font-weight:600;">クリックして Google Maps で開く</span>
      <span style="font-size:0.75rem;color:#A1A3A0;">${lat.toFixed(4)}, ${lng.toFixed(4)}</span>
    </a>
  `;
}

// ── シェア機能 ────────────────────────────────────
function shareCard() {
    if (!state.currentCard) return;
    const card = state.currentCard;
    const text = `${card.title} - ${card.area}\n${card.description.slice(0, 80)}…`;

    if (navigator.share) {
        navigator.share({ title: card.title, text, url: window.location.href }).catch(() => { });
    } else {
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('shareBtn');
            if (btn) {
                const orig = btn.innerHTML;
                btn.innerHTML = '<span>✓</span> コピーしました';
                setTimeout(() => { btn.innerHTML = orig; }, 2000);
            }
        });
    }
}
