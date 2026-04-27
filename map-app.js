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

async function loadCardsOnMap() {
    // migration check (just in case)
    if (typeof migrateLocalStorageToIndexedDB === 'function') {
        await migrateLocalStorageToIndexedDB();
    }

    // IndexedDB からカスタムカードと設定情報を取得
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
    const mocks = (typeof CARDS_DATA !== 'undefined' ? CARDS_DATA : []).filter(c => !deletedIds.includes(c.id));

    // 統合（カスタム優先、降順）
    const cards = [...customCards, ...mocks];

    // Mapbox や Google Maps を使わずに、完全に無料で使える OpenStreetMap (OSM) を使用
    // Leaflet初期化
    const map = L.map('map', {
        zoomControl: false // デフォルトのズームコントロールを消して後で再配置
    }).setView([35.6812, 139.7671], 5); // 初期の中心（日本全体くらい）

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // マーカーアイコンの設定
    const customIcon = L.icon({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    const bounds = L.latLngBounds();
    let markerCount = 0;

    cards.forEach(card => {
        const lat = card.lat || card.latitude;
        const lng = card.lng || card.longitude;

        if (lat && lng) {
            const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);
            
            // PopupのHTML
            const popupHtml = `
                <div class="popup-card">
                    <img src="${card.image_url}" alt="${card.title}" class="popup-img" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'200\\' height=\\'120\\'%3E%3Crect fill=\\'%23F1F5F9\\' width=\\'200\\' height=\\'120\\'/%3E%3Ctext fill=\\'%2394A3B8\\' font-size=\\'24\\' x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\' dy=\\'.3em\\'%3E📷%3C/text%3E%3C/svg%3E'">
                    <div class="popup-info">
                        <p class="popup-area">📌 ${card.area || 'エリア未設定'}</p>
                        <h3 class="popup-title">${card.title}</h3>
                        <a href="index.html?card=${card.id}" class="popup-btn">詳細を見る</a>
                    </div>
                </div>
            `;
            
            marker.bindPopup(popupHtml);
            bounds.extend([lat, lng]);
            markerCount++;
        }
    });

    if (markerCount > 0) {
        // マーカーが一つ以上あれば全体が収まるようにズーム・パン
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
}
