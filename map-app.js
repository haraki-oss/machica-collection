// 公開サイトアクセス時に管理画面のセッションをリセットし、毎回パスワードを求めるようにする
sessionStorage.removeItem('machica_admin_logged_in');

document.addEventListener('DOMContentLoaded', async () => {
    // モバイルメニューのトグル（index.htmlと同様）
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const mobileNav = document.getElementById('mobileNav');
    if (hamburgerBtn && mobileNav) {
        hamburgerBtn.addEventListener('click', () => {
            mobileNav.classList.toggle('open');
        });
    }

    // データの読み込み
    await loadCardsOnMap();
});

// カテゴリ一覧から id をキーにしたマップを作る（slug 重複排除済み）
async function getCategoryMapById() {
    let customCats = [];
    let deletedIds = [];
    try {
        if (typeof machicaDB !== 'undefined') {
            customCats = await machicaDB.getAll('categories');
            const settings = await machicaDB.getAll('settings');
            deletedIds = settings.find(s => s.id === 'deleted_category_ids')?.value || [];
        }
    } catch (e) { /* noop */ }

    const defaults = (typeof CATEGORIES_DATA !== 'undefined' ? CATEGORIES_DATA : [])
        .filter(c => !deletedIds.includes(c.id));

    // slug ベースで重複排除（カスタム優先）
    const seen = new Set();
    const dedupedCustom = customCats.filter(c => {
        const k = c.slug || `id:${c.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    const customSlugs = new Set(dedupedCustom.map(c => c.slug).filter(Boolean));
    const customIds = new Set(dedupedCustom.map(c => c.id));
    const merged = [
        ...defaults.filter(c => !customSlugs.has(c.slug) && !customIds.has(c.id)),
        ...dedupedCustom,
    ];

    const map = new Map();
    merged.forEach(c => map.set(c.id, c));
    return map;
}

function buildMarkerHtml(cat) {
    const inner = cat?.icon_url
        ? `<img src="${cat.icon_url}" alt="${cat.name || ''}" />`
        : `<span class="amk-marker-emoji">${cat?.emoji || '📍'}</span>`;
    return `
        <div class="amk-marker">
            <div class="amk-marker-pin">${inner}</div>
            <div class="amk-marker-tail"></div>
        </div>
    `;
}

async function loadCardsOnMap() {
    // migration check (just in case)
    if (typeof migrateLocalStorageToIndexedDB === 'function') {
        await migrateLocalStorageToIndexedDB();
    }

    // IndexedDB（実体は Supabase）からカスタムカードと設定情報を取得
    let customCards = [];
    let deletedIds = [];
    try {
        if (typeof machicaDB !== 'undefined') {
            customCards = await machicaDB.getAll('cards');
            const settings = await machicaDB.getAll('settings');
            deletedIds = settings.find(s => s.id === 'deleted_card_ids')?.value || [];
        }
    } catch (e) {
        console.warn('DB load failed, using mock only.', e);
    }

    // モックデータから削除済みを除外
    const mocks = (typeof CARDS_DATA !== 'undefined' ? CARDS_DATA : [])
        .filter(c => !deletedIds.includes(c.id));
    const cards = [...customCards, ...mocks];

    // カテゴリ参照
    const catMap = await getCategoryMapById();

    // Leaflet 初期化（ズームコントロールは右下に再配置）
    const map = L.map('map', {
        zoomControl: false,
        attributionControl: true,
    }).setView([35.6812, 139.7671], 5);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // CartoDB Positron — 上品なライトモノトーン
    L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        {
            maxZoom: 20,
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
                'contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
        }
    ).addTo(map);

    const bounds = L.latLngBounds();
    let markerCount = 0;

    cards.forEach(card => {
        const lat = card.lat || card.latitude;
        const lng = card.lng || card.longitude;
        if (!lat || !lng) return;

        const cat = catMap.get(card.category_id);

        // カスタム divIcon
        const icon = L.divIcon({
            className: 'amk-marker-wrap',
            html: buildMarkerHtml(cat),
            iconSize: [44, 54],
            iconAnchor: [22, 54],   // ピン先端を緯度経度に合わせる
            popupAnchor: [0, -48],
        });

        const marker = L.marker([lat, lng], { icon, riseOnHover: true }).addTo(map);

        // ポップアップ
        const fallbackImg =
            "data:image/svg+xml;charset=UTF-8," +
            encodeURIComponent(
                "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='130'>" +
                "<rect fill='#F4F4F2' width='240' height='130'/>" +
                "<text fill='#A1A3A0' font-size='28' x='50%' y='50%' text-anchor='middle' dy='.3em'>📷</text>" +
                "</svg>"
            );

        const safeArea = card.area || 'AREA';
        const safeTitle = (card.title || '').replace(/"/g, '&quot;');
        const popupHtml = `
            <a class="popup-card" href="index.html?card=${card.id}">
                <img class="popup-img" src="${card.image_url || fallbackImg}"
                     alt="${safeTitle}"
                     onerror="this.src='${fallbackImg}'" />
                <div class="popup-info">
                    <p class="popup-area">${safeArea}</p>
                    <h3 class="popup-title">${safeTitle}</h3>
                    <span class="popup-btn">詳細を見る</span>
                </div>
            </a>
        `;

        marker.bindPopup(popupHtml, { closeButton: true, autoPan: true, maxWidth: 260 });
        bounds.extend([lat, lng]);
        markerCount++;
    });

    if (markerCount > 0) {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
    }
}
