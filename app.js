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
    staff: 'all', // レコメンドスタッフ絞り込み
    lang: 'ja', // 'ja' or 'en'
    currentCard: null,
    map: null,
    marker: null,
    mapsLoaded: false,
    showLikedOnly: false, // MY LIKES モード
    tags: [],          // タグ一覧（初期データ + Supabase 由来をマージ済み）
    tagById: new Map(), // id → tag のルックアップ
    selectedTagIds: new Set(),     // 公開側タグフィルター：選択中のタグID
    tagFilterCollapsedCats: new Set(), // 公開側タグフィルター：折りたたみ中のカテゴリ key
    tagFilterOpen: false,          // タグフィルターパネルの開閉
};

// ── Google Maps APIキー ──────────────────────────
const GOOGLE_MAPS_API_KEY = '';

// ── Machica Clip（別アプリ）連携 URL ──────────────
// Machica Clip は別の Vercel プロジェクト (haraki-oss/machica-clip) として独立稼働しています。
// 末尾は `/` で終えてください（その後ろに `index.html#add?...` を連結します）。
const MACHICA_CLIP_URL = 'https://machica-clip.vercel.app/';

// ── 初期化 ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // 移行の実行（公開側でも初回アクセス時に必要）
    await migrateLocalStorageToIndexedDB();

    // 言語設定読み込み
    const savedLang = localStorage.getItem('machica_lang');
    if (savedLang === 'en') state.lang = 'en';
    updateLanguageUI();

    await initTags();   // カード描画前にタグを読み込んでおく
    await initCards();
    renderGenreButtons();
    populateAreaFilter();
    populateStaffFilter();
    bindEvents();
    bindTagFilterEvents();
    loadGoogleMapsAPI();
});

// ── タグ初期化 ─────────────────────────────────────
async function initTags() {
    try {
        const customTags = await machicaDB.getAll('tags');
        const settings = await machicaDB.getAll('settings');
        const deletedIds = settings.find(s => s.id === 'deleted_tag_ids')?.value || [];
        const overrides  = settings.find(s => s.id === 'tag_overrides')?.value || {};

        const seedTags = (typeof TAGS_DATA !== 'undefined' ? TAGS_DATA : [])
            .filter(t => !deletedIds.includes(t.id))
            .map(t => {
                const ov = overrides[t.id];
                return ov ? { ...t, ...ov } : t;
            });

        const customIds = new Set(customTags.map(t => t.id));
        state.tags = [...seedTags.filter(t => !customIds.has(t.id)), ...customTags];
        state.tagById = new Map(state.tags.map(t => [t.id, t]));
    } catch (e) {
        // tags テーブル未作成等のエラーは握りつぶし、初期データのみで動かす
        console.warn('initTags: failed to load custom tags, using seed only.', e);
        state.tags = (typeof TAGS_DATA !== 'undefined' ? TAGS_DATA : []).slice();
        state.tagById = new Map(state.tags.map(t => [t.id, t]));
    }
}

// カード -> タグ id 配列を引いて、表示用オブジェクトの配列に変換
function getCardTags(card) {
    const ids = Array.isArray(card?.tags) ? card.tags : [];
    return ids.map(id => state.tagById.get(id)).filter(Boolean);
}

function renderTagPills(card, opts) {
    const tags = getCardTags(card);
    if (!tags.length) return '';
    const limit = opts && opts.limit ? opts.limit : tags.length;
    const variant = (opts && opts.variant) || 'default'; // 'default' | 'compact'
    const visible = tags.slice(0, limit);
    const overflow = tags.length - visible.length;
    return visible.map(t => {
        const color = t.color || (typeof TAG_CATEGORY_MAP !== 'undefined' ? TAG_CATEGORY_MAP[t.category]?.color : '') || '#888';
        return `<span class="card-tag-pill ${variant === 'compact' ? 'is-compact' : ''}" style="--tag-color:${color}">${escapeHtmlSafe(t.name)}</span>`;
    }).join('') + (overflow > 0 ? `<span class="card-tag-more">+${overflow}</span>` : '');
}

function escapeHtmlSafe(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ── タグフィルター（公開側、折りたたみ） ─────────────
function bindTagFilterEvents() {
    const toggle = document.getElementById('tagFilterToggle');
    const panel  = document.getElementById('tagFilterPanel');
    const wrap   = document.getElementById('tagFilterWrap');
    const clearBtn = document.getElementById('tagFilterClearBtn');

    toggle?.addEventListener('click', () => {
        state.tagFilterOpen = !state.tagFilterOpen;
        panel.hidden = !state.tagFilterOpen;
        toggle.setAttribute('aria-expanded', state.tagFilterOpen ? 'true' : 'false');
        wrap.classList.toggle('is-open', state.tagFilterOpen);
        if (state.tagFilterOpen) renderTagFilterPanel();
    });

    clearBtn?.addEventListener('click', () => {
        state.selectedTagIds.clear();
        renderTagFilterPanel();
        renderTagFilterSelected();
        applyFilters();
    });

    // 初期描画（パネル中身）
    renderTagFilterPanel();
}

function renderTagFilterPanel() {
    const root = document.getElementById('tagFilterCats');
    if (!root) return;

    const cats = (typeof TAG_CATEGORIES !== 'undefined' ? TAG_CATEGORIES : []);
    const tagsByCat = {};
    for (const c of cats) tagsByCat[c.key] = [];
    for (const t of state.tags) {
        if (tagsByCat[t.category]) tagsByCat[t.category].push(t);
    }

    root.innerHTML = cats.map(cat => {
        const items = tagsByCat[cat.key] || [];
        if (items.length === 0) return '';
        const collapsed = state.tagFilterCollapsedCats.has(cat.key);
        const selectedInCat = items.filter(t => state.selectedTagIds.has(t.id)).length;
        return `
        <div class="tag-filter-cat ${collapsed ? 'is-collapsed' : ''}" data-cat="${cat.key}">
            <button type="button" class="tag-filter-cat-header" onclick="window.toggleTagFilterCat('${cat.key}')">
                <span class="tag-filter-cat-color" style="background:${cat.color}"></span>
                <span class="tag-filter-cat-name">${escapeHtmlSafe(cat.name)}</span>
                ${selectedInCat > 0 ? `<span class="tag-filter-cat-badge">${selectedInCat}</span>` : ''}
                <span class="tag-filter-cat-arrow" aria-hidden="true">▼</span>
            </button>
            <div class="tag-filter-cat-pills" ${collapsed ? 'hidden' : ''}>
                ${items.map(t => {
                    const color = t.color || cat.color;
                    const sel = state.selectedTagIds.has(t.id);
                    return `<button type="button" class="tag-filter-pick ${sel ? 'is-selected' : ''}" style="--tag-color:${color}" data-id="${escapeHtmlSafe(t.id)}" onclick="window.toggleTagFilterPick('${escapeHtmlSafe(t.id)}')">${escapeHtmlSafe(t.name)}</button>`;
                }).join('')}
            </div>
        </div>`;
    }).join('');
}

function renderTagFilterSelected() {
    const row = document.getElementById('tagFilterSelectedRow');
    const list = document.getElementById('tagFilterSelected');
    if (!row || !list) return;

    if (!state.selectedTagIds || state.selectedTagIds.size === 0) {
        row.hidden = true;
        list.innerHTML = '';
        return;
    }

    row.hidden = false;
    list.innerHTML = Array.from(state.selectedTagIds).map(id => {
        const t = state.tagById.get(id);
        if (!t) return '';
        const color = t.color || (TAG_CATEGORY_MAP?.[t.category]?.color) || '#888';
        return `<button type="button" class="tag-filter-chip" style="--tag-color:${color}" onclick="window.toggleTagFilterPick('${escapeHtmlSafe(id)}')">
            <span>${escapeHtmlSafe(t.name)}</span>
            <span class="tag-filter-chip-x" aria-hidden="true">×</span>
        </button>`;
    }).join('');
}

function updateTagFilterCount() {
    const badge = document.getElementById('tagFilterCount');
    if (!badge) return;
    const n = state.selectedTagIds ? state.selectedTagIds.size : 0;
    if (n > 0) {
        badge.textContent = String(n);
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

window.toggleTagFilterCat = (key) => {
    if (state.tagFilterCollapsedCats.has(key)) state.tagFilterCollapsedCats.delete(key);
    else state.tagFilterCollapsedCats.add(key);
    renderTagFilterPanel();
};

window.toggleTagFilterPick = (id) => {
    if (state.selectedTagIds.has(id)) state.selectedTagIds.delete(id);
    else state.selectedTagIds.add(id);
    renderTagFilterPanel();
    renderTagFilterSelected();
    applyFilters();
};

async function initCards() {
    // IndexedDB からカスタムカードと設定情報を取得
    const customCards = await machicaDB.getAll('cards');
    const settings = await machicaDB.getAll('settings');
    const deletedIds = settings.find(s => s.id === 'deleted_card_ids')?.value || [];
    const orderIds = settings.find(s => s.id === 'card_order')?.value || [];

    // モックデータから削除済みを除外
    const mocks = CARDS_DATA.filter(c => !deletedIds.includes(c.id));

    // 統合：同じ id のカードがあればカスタム（Supabase 側）を優先する。
    // これがないと、admin で編集したカードのモック版とカスタム版が両方表示され、
    // 訪問者が古い（店舗情報なしの）モック版を開いてしまうことがある。
    const customIds = new Set(customCards.map(c => c.id));
    state.cards = [
        ...customCards,
        ...mocks.filter(m => !customIds.has(m.id)),
    ].map(c => ({ ...c }));

    // 管理画面で設定された並び順を優先、未指定はID降順で末尾
    const indexMap = new Map(orderIds.map((id, i) => [String(id), i]));
    state.cards.sort((a, b) => {
        const aIdx = indexMap.get(String(a.id));
        const bIdx = indexMap.get(String(b.id));
        if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
        if (aIdx !== undefined) return -1;
        if (bIdx !== undefined) return 1;
        return b.id - a.id;
    });

    // 直接 state.filtered を全件で上書きすると ?area= で先に設定された state.area
    // を無視して全カードを描画してしまう（fill→filter の競合）。applyFilters を
    // 通すことで現在の state.area / state.genre / state.keyword に従わせる。
    applyFilters();

    // URL パラメータ ?card=N のチェック。
    // 旧仕様では開いた瞬間にパラメータを除去していたが、共有用 URL として
    // 残しておきたいので消さない。openModal 側で重複 push を抑止している。
    const params = new URLSearchParams(window.location.search);
    const targetCardId = params.get('card');
    if (targetCardId) {
        const idNum = parseInt(targetCardId, 10);
        if (!isNaN(idNum) && state.cards.some(c => c.id === idNum)) {
            // DOM 描画待ちのため少しだけ遅延させる
            setTimeout(() => { openModal(idNum); }, 100);
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
        syncAreaToUrl();
        applyFilters();
    });

    // スタッフフィルター
    document.getElementById('staffSelect')?.addEventListener('change', (e) => {
        state.staff = e.target.value;
        syncStaffToUrl();
        updateStaffFilterUI();
        applyFilters();
    });

    // スタッフフィルター解除ボタン
    document.getElementById('staffClearBtn')?.addEventListener('click', () => {
        if (state.staff === 'all') return;
        state.staff = 'all';
        const sel = document.getElementById('staffSelect');
        if (sel) sel.value = 'all';
        syncStaffToUrl();
        updateStaffFilterUI();
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

    // クリップボタン（Machica Clip 連携）
    document.getElementById('clipBtn')?.addEventListener('click', () => {
        const card = state.currentCard;
        if (!card) return;

        const lang = state.lang;
        const title = (lang === 'en' && card.title_en) ? card.title_en : card.title;
        const imageUrl = encodeURIComponent(card.image_url || '');
        const encodedTitle = encodeURIComponent(title);

        // 連携先は MACHICA_CLIP_URL 定数（最上部）で設定。相対 / 絶対どちらでも可。
        const base = MACHICA_CLIP_URL.endsWith('/') ? MACHICA_CLIP_URL : MACHICA_CLIP_URL + '/';
        const clipUrl = `${base}index.html#add?card_id=${card.id}&title=${encodedTitle}&image=${imageUrl}`;

        window.location.href = clipUrl;
    });

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

    // クリップボタン（LIKE 横の compact 版に合わせてラベル要素を維持したまま差し替え）
    const clipBtn = document.getElementById('clipBtn');
    if (clipBtn) {
        const labelEl = clipBtn.querySelector('.btn-clip-label');
        const ariaLabel = state.lang === 'en' ? 'Save to Clip' : 'クリップに保存';
        const labelText = state.lang === 'en' ? 'Save to Clip' : 'クリップに保存';
        if (labelEl) {
            labelEl.textContent = labelText;
        } else {
            clipBtn.innerHTML = `<span class="btn-clip-icon">📎</span><span class="btn-clip-label">${labelText}</span>`;
        }
        clipBtn.setAttribute('aria-label', ariaLabel);
    }

    // 再描画
    renderGenreButtons();
    populateAreaFilter();
    populateStaffFilter();
    applyFilters();
    updateMyLikesUI();
}

// 競合する非同期描画から後発の呼び出しのみ反映するための世代カウンタ
let _areaRenderGen = 0;
let _genreRenderGen = 0;

// エリア URL パラメータ用キャッシュ
let _cachedAreas = [];
let _areaUrlApplied = false;

async function populateAreaFilter() {
    const select = document.getElementById('areaSelect');
    if (!select) return;

    const myGen = ++_areaRenderGen;
    const firstOpt = select.options[0];

    const areas = await getAllAreasAsync();

    // 後発の呼び出しが走り始めていたら自分の結果は捨てる
    if (myGen !== _areaRenderGen) return;

    _cachedAreas = areas;

    select.innerHTML = '';
    select.appendChild(firstOpt);
    areas.forEach(area => {
        if (area.id === 99) return;
        const opt = document.createElement('option');
        opt.value = area.name;
        opt.textContent = state.lang === 'en' ? (area.name_en || area.name) : area.name;
        select.appendChild(opt);
    });

    // 初回のみ URL の ?area= パラメータを反映
    if (!_areaUrlApplied) {
        const before = state.area;
        applyAreaFromUrl();
        _areaUrlApplied = true;
        // URL でエリアが切り替わった場合は、initCards の初回描画を上書きするため
        // ここでフィルターを再適用する
        if (state.area !== before) applyFilters();
    }
    select.value = state.area;
    updateDocumentTitle();
}

// URL の ?area= を読み取って state.area に適用（初期ロード用）
function applyAreaFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('area');
    if (!raw) return;
    const v = decodeURIComponent(raw).toLowerCase();
    const match = _cachedAreas.find(a =>
        (a.name_en && a.name_en.toLowerCase() === v) ||
        (a.name && a.name.toLowerCase() === v)
    );
    if (match) {
        state.area = match.name;
    }
}

// state.area を URL ?area= に同期する（共有用）
function syncAreaToUrl() {
    const params = new URLSearchParams(window.location.search);
    if (!state.area || state.area === 'all') {
        params.delete('area');
    } else {
        const area = _cachedAreas.find(a => a.name === state.area);
        params.set('area', area?.name_en || state.area);
    }
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
    updateDocumentTitle();
}

// ── スタッフフィルター（レコメンドスタッフ） ─────────────
let _staffUrlApplied = false;

function populateStaffFilter() {
    const select = document.getElementById('staffSelect');
    if (!select) return;

    // 全カードの recommended_by からユニークなスタッフ名を抽出
    const staffSet = new Set();
    state.cards.forEach(c => {
        const name = (c.recommended_by || '').trim();
        if (name) staffSet.add(name);
    });
    const staffList = [...staffSet].sort((a, b) => a.localeCompare(b, 'ja'));

    const firstOpt = select.options[0]; // 「スタッフで絞り込み」を保持
    if (firstOpt) {
        firstOpt.textContent = state.lang === 'en' ? 'Filter by staff' : 'スタッフで絞り込み';
    }
    const clearBtn = document.getElementById('staffClearBtn');
    if (clearBtn) {
        clearBtn.textContent = state.lang === 'en' ? '✕ Clear' : '✕ 解除';
        clearBtn.setAttribute('aria-label', state.lang === 'en' ? 'Clear staff filter' : 'スタッフフィルターを解除');
    }
    select.innerHTML = '';
    if (firstOpt) select.appendChild(firstOpt);
    staffList.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });

    // 該当スタッフが居なくなったら状態をリセット（ただし state.cards 未ロード時は触らない）
    if (state.cards.length > 0 && state.staff !== 'all' && !staffSet.has(state.staff)) {
        state.staff = 'all';
    }

    // 初回のみ URL の ?staff= パラメータを反映。
    // state.cards が空のうちに走らせるとマッチが取れないので、データ到着まで先送りする。
    if (!_staffUrlApplied && state.cards.length > 0) {
        const before = state.staff;
        applyStaffFromUrl();
        _staffUrlApplied = true;
        if (state.staff !== before) applyFilters();
    }
    select.value = state.staff;
    updateStaffFilterUI();
}

// スタッフフィルターのアクティブ状態を見た目に反映
function updateStaffFilterUI() {
    const select = document.getElementById('staffSelect');
    const clearBtn = document.getElementById('staffClearBtn');
    const active = state.staff && state.staff !== 'all';
    if (select) select.classList.toggle('is-active', active);
    if (clearBtn) clearBtn.classList.toggle('is-visible', active);
}

function applyStaffFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('staff');
    if (!raw) return;
    const v = decodeURIComponent(raw).trim().toLowerCase();
    // カードに登録されているスタッフ名の中から大小無視で一致するものを採用
    const match = state.cards.find(c =>
        (c.recommended_by || '').trim().toLowerCase() === v
    );
    if (match) state.staff = match.recommended_by.trim();
}

function syncStaffToUrl() {
    const params = new URLSearchParams(window.location.search);
    if (!state.staff || state.staff === 'all') {
        params.delete('staff');
    } else {
        params.set('staff', state.staff);
    }
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
}

// 選択中のエリアに合わせて document.title を更新
function updateDocumentTitle() {
    const baseTitle = state.lang === 'en'
        ? 'AMANEK machi FAVE | Local Spot Collection'
        : 'AMANEK machi FAVE | 地域を旅するコレクション';
    if (!state.area || state.area === 'all') {
        document.title = baseTitle;
        return;
    }
    const area = _cachedAreas.find(a => a.name === state.area);
    const label = state.lang === 'en'
        ? (area?.name_en || state.area)
        : (area?.name || state.area);
    document.title = `${label} | AMANEK machi FAVE`;
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

    // タグフィルター用：選択中タグをカテゴリ別にグループ化
    // 同カテゴリ内は OR、別カテゴリ間は AND（典型的なファセット検索）
    const selectedByCategory = {};
    if (state.selectedTagIds && state.selectedTagIds.size > 0) {
        for (const id of state.selectedTagIds) {
            const tag = state.tagById.get(id);
            if (!tag) continue;
            (selectedByCategory[tag.category] ||= []).push(id);
        }
    }
    const tagFilterActive = Object.keys(selectedByCategory).length > 0;

    state.filtered = state.cards.filter(card => {
        if (likedSet && !likedSet.has(String(card.id))) return false;
        const matchKeyword = !kw || card.title.toLowerCase().includes(kw) || card.description.toLowerCase().includes(kw);
        const matchGenre = state.genre === 'all' || card.category_id == state.genre;
        const matchArea = state.area === 'all' || card.area === state.area;
        const matchStaff = state.staff === 'all' || (card.recommended_by || '').trim() === state.staff;
        if (!(matchKeyword && matchGenre && matchArea && matchStaff)) return false;

        if (tagFilterActive) {
            const cardTagIds = Array.isArray(card.tags) ? card.tags : [];
            for (const cat in selectedByCategory) {
                const ids = selectedByCategory[cat];
                if (!ids.some(id => cardTagIds.includes(id))) return false;
            }
        }
        return true;
    });

    renderCards(state.filtered);
    updateMyLikesUI();
    updateTagFilterCount();
}

function resetFilters() {
    state.keyword = '';
    state.genre = 'all';
    state.area = 'all';
    state.staff = 'all';
    if (state.selectedTagIds) state.selectedTagIds.clear();
    renderTagFilterPanel();
    renderTagFilterSelected();
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').classList.remove('visible');
    document.getElementById('areaSelect').value = 'all';
    const staffSel = document.getElementById('staffSelect');
    if (staffSel) staffSel.value = 'all';
    document.querySelectorAll('.genre-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.genre === 'all');
    });
    syncAreaToUrl();
    syncStaffToUrl();
    updateStaffFilterUI();
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
    // 多言語対応
    const lang = state.lang;
    const title = (lang === 'en' && card.title_en) ? card.title_en : card.title;
    const areaName = (lang === 'en') ? getAreaName(card.area, 'en') : card.area;

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
          ${areaName ? `<span class="card-area-badge"><span class="card-area-badge-pin">📍</span><span>${areaName}</span></span>` : ''}

          <!-- スポット名オーバーレイ -->
          <div class="card-name-overlay">
            <h3 class="card-overlay-title">${title}</h3>
            ${(() => {
                const pills = renderTagPills(card, { limit: 3, variant: 'compact' });
                return pills ? `<div class="card-tags">${pills}</div>` : '';
            })()}
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
// popstate（ブラウザ戻る/進む）経由で開閉する場合は URL を再 push しない
let _modalNavInProgress = false;

function openModal(cardId) {
    const card = state.cards.find(c => c.id === cardId);
    if (!card) return;
    state.currentCard = card;

    // URL に ?card=N を反映（既に同じ値なら no-op）
    if (!_modalNavInProgress) {
        const params = new URLSearchParams(window.location.search);
        if (params.get('card') !== String(cardId)) {
            params.set('card', String(cardId));
            const qs = params.toString();
            const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
            window.history.pushState({ card: cardId }, '', newUrl);
        }
    }

    const cat = getCategoryById(card.category_id);

    // 裏面ボタン表示制御
    const flipBtn = document.getElementById('flipBtn');
    const backUrl = card.image_url_back || card.back_image_url;
    const mainImg = document.getElementById('modalImage');
    if (flipBtn) {
        flipBtn.style.display = backUrl ? 'flex' : 'none';
        mainImg.style.transform = 'scale(1)';
    }
    mainImg.alt = card.title;

    // ギャラリー順序：内装・料理などの追加写真を先に、カードの表裏は最後に表示
    const gallery = card.gallery || card.gallery_images || [];
    const galleryArr = Array.isArray(gallery) ? gallery.filter(Boolean) : [];
    const cardImages = [];
    if (card.image_url) cardImages.push(card.image_url);
    if (backUrl) cardImages.push(backUrl);
    const images = [...galleryArr, ...cardImages];

    // メイン画像は先頭の写真（ギャラリーがあればそれ、無ければカード表）
    mainImg.src = images[0] || card.image_url || '';

    const thumbsContainer = document.getElementById('modalThumbs');
    if (thumbsContainer) {
        thumbsContainer.innerHTML = '';
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
                        // 住所は店舗情報パネル内に表示しているので再描画でリフレッシュ
                        loadPlaceDetails(card);
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
    document.getElementById('modalArea').textContent = areaName;

    // モーダル内のタグ表示
    const tagsEl = document.getElementById('modalTags');
    if (tagsEl) {
        const pills = renderTagPills(card, { variant: 'default' });
        if (pills) {
            tagsEl.innerHTML = pills;
            tagsEl.style.display = '';
        } else {
            tagsEl.innerHTML = '';
            tagsEl.style.display = 'none';
        }
    }

    // レコメンドスタッフ（任意項目）。空の場合は要素ごと非表示。
    // クリックでそのスタッフのフィルターを適用しモーダルを閉じる。
    const recEl = document.getElementById('modalRecommender');
    if (recEl) {
        const rec = (card.recommended_by || '').trim();
        if (rec) {
            const prefix = lang === 'en' ? 'by ' : 'by ';
            recEl.textContent = `${prefix}${rec}`;
            recEl.style.display = '';
            recEl.classList.add('is-clickable');
            recEl.setAttribute('role', 'button');
            recEl.setAttribute('tabindex', '0');
            recEl.setAttribute('title',
                lang === 'en'
                    ? `Show all spots recommended by ${rec}`
                    : `${rec} がレコメンドしたスポットだけ表示`);

            const triggerStaffFilter = () => {
                state.staff = rec;
                const sel = document.getElementById('staffSelect');
                if (sel) sel.value = rec;
                syncStaffToUrl();
                updateStaffFilterUI();
                closeModal();
                applyFilters();
                // フィルター位置に視線を戻す
                const filterSec = document.querySelector('.filter-section');
                if (filterSec) filterSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
            };
            recEl.onclick = triggerStaffFilter;
            recEl.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    triggerStaffFilter();
                }
            };
        } else {
            recEl.textContent = '';
            recEl.style.display = 'none';
            recEl.classList.remove('is-clickable');
            recEl.removeAttribute('role');
            recEl.removeAttribute('tabindex');
            recEl.removeAttribute('title');
            recEl.onclick = null;
            recEl.onkeydown = null;
        }
    }
    // 住所は店舗情報パネル内に表示するのでここでは設定しない
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

    // Google Places から店舗情報（営業時間・電話・HP・評価）を取得して表示
    loadPlaceDetails(card);

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
    // LIKE+クリップを束ねるラッパー。.show-clip でクリップを出現させる
    const cluster = document.getElementById('metaActions');

    // 表示反映ヘルパ
    function applyState(isLiked, count) {
        fresh.classList.toggle('is-liked', isLiked);
        fresh.setAttribute('aria-pressed', isLiked ? 'true' : 'false');
        iconEl.textContent = isLiked ? '♥' : '♡';
        countEl.textContent = count;
        if (cluster) cluster.classList.toggle('show-clip', isLiked);
    }

    // 初期状態（モーダルが見える前にここで .show-clip を確定させて、
    // 出現アニメを誤発火させない）
    let liked = getLocalLiked().has(cardKey);
    countEl.textContent = '…';
    fresh.classList.toggle('is-liked', liked);
    iconEl.textContent = liked ? '♥' : '♡';
    if (cluster) {
        cluster.classList.remove('just-revealed');
        cluster.classList.toggle('show-clip', liked);
        // 直後にカウント反映で applyState が走るが、すでに同じ値なのでアニメは発火しない
    }

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
            // クリップボタンを注目アニメ付きで出現させる
            if (cluster) {
                cluster.classList.add('just-revealed');
                setTimeout(() => cluster.classList.remove('just-revealed'), 1700);
            }
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

    // URL から ?card= を除去（他のフィルターパラメータは維持）
    if (!_modalNavInProgress) {
        const params = new URLSearchParams(window.location.search);
        if (params.has('card')) {
            params.delete('card');
            const qs = params.toString();
            const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
            window.history.replaceState({}, '', newUrl);
        }
    }

    // 画像クリア（次回チラつき防止）
    setTimeout(() => {
        const img = document.getElementById('modalImage');
        if (img) img.src = '';
        const thumbs = document.getElementById('modalThumbs');
        if (thumbs) thumbs.innerHTML = '';
    }, 300);
}

// ブラウザの戻る/進むで URL の ?card= が変化したらモーダルを連動させる
window.addEventListener('popstate', () => {
    _modalNavInProgress = true;
    try {
        const params = new URLSearchParams(window.location.search);
        const cardParam = params.get('card');
        if (cardParam) {
            const idNum = parseInt(cardParam, 10);
            if (!isNaN(idNum) && state.cards.some(c => c.id === idNum)) {
                if (!state.currentCard || state.currentCard.id !== idNum) {
                    openModal(idNum);
                }
            }
        } else if (state.currentCard) {
            closeModal();
        }
    } finally {
        _modalNavInProgress = false;
    }
});

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

// ── 店舗情報の表示（カードに手動入力された情報をそのまま描画） ──
// 取得元は admin での「自動取得（OSM 由来）」または手動入力。
// 表示時には API を呼ばないので追加のコストはかからない。
function loadPlaceDetails(card) {
    const container = document.getElementById('modalBusinessInfo');
    if (!container) return;

    container.style.display = 'none';
    container.innerHTML = '';

    const lang = state.lang;
    const address = (lang === 'en' && card.address_en) ? card.address_en : card.address;

    // パネルは住所＋店舗情報を統合表示。住所もしくは店舗情報のいずれかがあればパネルを出す。
    const data = {
        address: address || null,
        opening_hours: card.opening_hours || null,
        closed_days: card.closed_days || null,
        phone: card.phone || null,
        website: card.website || null,
    };

    // 住所も店舗情報も完全に空の場合のみパネルを隠す
    if (!data.address && !data.opening_hours && !data.closed_days && !data.phone && !data.website) return;

    renderBusinessInfo(data, container);
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
    return escapeHtml(s);
}

// 営業時間文字列を日本語向けに軽く整形（OSM 形式 "Mo-Fr 09:00-17:00" を "月-金 09:00-17:00" に）
function humanizeOpeningHours(raw) {
    if (!raw) return '';
    const dayMap = { Mo: '月', Tu: '火', We: '水', Th: '木', Fr: '金', Sa: '土', Su: '日' };
    let s = raw;
    Object.keys(dayMap).forEach(k => {
        s = s.replace(new RegExp(k, 'g'), dayMap[k]);
    });
    return s;
}

// 定休日コード ("mon,tue") を表示用の文字列に。lang が 'en' なら英語短縮、それ以外は日本語短縮。
const CLOSED_DAY_LABELS = {
    ja: { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' },
    en: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
};
const CLOSED_DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function formatClosedDays(raw, lang) {
    if (!raw) return '';
    const set = new Set(String(raw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    if (!set.size) return '';
    const ordered = CLOSED_DAY_ORDER.filter(c => set.has(c));
    if (ordered.length === 7) return lang === 'en' ? 'Closed daily' : '毎日定休';
    const labels = CLOSED_DAY_LABELS[lang === 'en' ? 'en' : 'ja'];
    const sep = lang === 'en' ? ', ' : '・';
    const prefix = lang === 'en' ? 'Closed: ' : '定休日：';
    return prefix + ordered.map(c => labels[c] || c).join(sep);
}

function renderBusinessInfo(data, container) {
    const lang = state.lang;
    const parts = [];
    const PLACEHOLDER = 'ー'; // 未登録時のフォールバック

    // 住所（常時表示。無ければハイフン）
    const addressText = data.address ? escapeHtml(data.address) : PLACEHOLDER;
    parts.push(`
        <div class="bi-row bi-address-row">
            <span class="bi-icon">📍</span>
            <span class="bi-summary-text">${addressText}</span>
        </div>
    `);

    // 営業時間
    if (data.opening_hours) {
        const display = lang === 'en' ? data.opening_hours : humanizeOpeningHours(data.opening_hours);
        const safe = escapeHtml(display).replace(/\n/g, '<br>');
        parts.push(`
            <div class="bi-row bi-hours-static">
                <span class="bi-icon">⏰</span>
                <span class="bi-summary-text">${safe}</span>
            </div>
        `);
    } else {
        parts.push(`
            <div class="bi-row bi-empty">
                <span class="bi-icon">⏰</span>
                <span class="bi-summary-text">${PLACEHOLDER}</span>
            </div>
        `);
    }

    // 定休日（曜日チェックボックスから来る "mon,tue" 形式）
    const closedText = formatClosedDays(data.closed_days, lang);
    if (closedText) {
        parts.push(`
            <div class="bi-row bi-closed-row">
                <span class="bi-icon">🚫</span>
                <span class="bi-summary-text">${escapeHtml(closedText)}</span>
            </div>
        `);
    } else {
        parts.push(`
            <div class="bi-row bi-empty">
                <span class="bi-icon">🚫</span>
                <span class="bi-summary-text">${PLACEHOLDER}</span>
            </div>
        `);
    }

    // 電話番号
    if (data.phone) {
        const telHref = data.phone.replace(/[^\d+]/g, '');
        parts.push(`
            <a class="bi-row" href="tel:${telHref}">
                <span class="bi-icon">📞</span>
                <span>${escapeHtml(data.phone)}</span>
            </a>
        `);
    } else {
        parts.push(`
            <div class="bi-row bi-empty">
                <span class="bi-icon">📞</span>
                <span>${PLACEHOLDER}</span>
            </div>
        `);
    }

    // ウェブサイト
    if (data.website) {
        let display = data.website;
        try { display = new URL(data.website).hostname.replace(/^www\./, ''); } catch (e) { }
        parts.push(`
            <a class="bi-row" href="${escapeAttr(data.website)}" target="_blank" rel="noopener noreferrer">
                <span class="bi-icon">🌐</span>
                <span>${escapeHtml(display)}</span>
            </a>
        `);
    } else {
        parts.push(`
            <div class="bi-row bi-empty">
                <span class="bi-icon">🌐</span>
                <span>${PLACEHOLDER}</span>
            </div>
        `);
    }

    const titleText = lang === 'en' ? 'Spot info' : '店舗情報';
    container.style.display = 'block';
    container.innerHTML = `
        <h4 class="business-info-title">${titleText}</h4>
        <div class="business-info-list">
            ${parts.join('')}
        </div>
    `;
}

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

    // 共有用 URL：?card= が必ず付いた絶対 URL を組み立てる
    // （URL バーは常に同期しているのでそのまま使ってもよいが、確実性のため再構築）
    const params = new URLSearchParams(window.location.search);
    params.set('card', String(card.id));
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;

    const desc = (card.description || '').slice(0, 80);
    const summary = `${card.title} - ${card.area}${desc ? '\n' + desc + '…' : ''}`;

    if (navigator.share) {
        navigator.share({ title: card.title, text: summary, url }).catch(() => { });
        return;
    }

    // クリップボード fallback：本文 + URL を一緒にコピー
    const fullText = `${summary}\n${url}`;
    navigator.clipboard.writeText(fullText).then(() => {
        const btn = document.getElementById('shareBtn');
        if (btn) {
            const orig = btn.innerHTML;
            btn.innerHTML = '<span>✓</span> リンクをコピーしました';
            setTimeout(() => { btn.innerHTML = orig; }, 2000);
        }
    }).catch(() => {
        // 古いブラウザ向け：プロンプトでコピー
        try { window.prompt('リンクをコピーしてください', url); } catch (_) { }
    });
}
