const LS_KEY = 'spotcard_custom_cards';

let targetCardId = null;
let imageBase64 = null;      // 表面画像
let imageBase64Back = null;  // 裏面画像
let galleryImages = [];      // ギャラリー画像（配列）

// エラーキャッチ（デバッグ用）
window.onerror = function (msg, url, line) {
    alert("エラーが発生しました:\n" + msg + "\n場所: " + url + ":" + line);
    return false;
};

document.addEventListener('DOMContentLoaded', async () => {
    // IDをパラメータから取得
    const params = new URLSearchParams(window.location.search);
    targetCardId = parseInt(params.get('id'));

    if (!targetCardId) {
        alert('IDが指定されていません。一覧に戻ります。');
        window.location.href = 'cards.html';
        return;
    }

    // 1. 移行の実行
    await migrateLocalStorageToIndexedDB();

    // 2. データの初期化
    await populateCategorySelect();
    await populateAreaSelect();
    await loadCardData();
    bindUploadEvents();
    bindFormEvents();
    bindAutoGeoEvent();
    bindAutoGeoOnBlur();
    bindAutoTranslate();
    bindGMapPaste();     // Google Maps 賌り付け
});

// ── データの読み込み ──────────────────────────────────
async function loadCardData() {
    // 1. IndexedDB から取得
    let card = await machicaDB.get('cards', targetCardId);

    // 2. 見つからない場合はモックデータから検索
    if (!card) {
        card = CARDS_DATA.find(c => c.id === targetCardId);
        if (card) {
            console.log('Editing mock data - will be saved as custom card');
        }
    }

    if (!card) {
        alert('指定されたカードが見つかりません。');
        window.location.href = 'cards.html';
        return;
    }

    // フォームに反映
    document.getElementById('cardTitle').value = card.title || '';
    document.getElementById('cardTitleEn').value = card.title_en || '';
    document.getElementById('cardDesc').value = card.description || '';
    document.getElementById('cardDescEn').value = card.description_en || '';
    document.getElementById('cardCategory').value = card.category_id || '';
    document.getElementById('cardArea').value = card.area || '';
    document.getElementById('cardAddress').value = card.address || '';
    document.getElementById('cardAddressEn').value = card.address_en || '';
    document.getElementById('cardLat').value = card.lat || card.latitude || '';
    document.getElementById('cardLng').value = card.lng || card.longitude || '';
    // 店舗情報
    if (document.getElementById('cardOpeningHours')) {
        document.getElementById('cardOpeningHours').value = card.opening_hours || '';
    }
    if (document.getElementById('cardPhone')) {
        document.getElementById('cardPhone').value = card.phone || '';
    }
    if (document.getElementById('cardWebsite')) {
        document.getElementById('cardWebsite').value = card.website || '';
    }

    // 画像の復元
    if (card.image_url) {
        imageBase64 = card.image_url;
        setPreview('uploadZone', 'previewWrap', 'previewImg', 'previewFilename', imageBase64, '表面写真');
    }
    if (card.image_url_back || card.back_image_url) {
        imageBase64Back = card.image_url_back || card.back_image_url;
        setPreview('uploadZoneBack', 'previewWrapBack', 'previewImgBack', 'previewFilenameBack', imageBase64Back, '裏面写真');
    }
    if (card.gallery || card.gallery_images) {
        galleryImages = [...(card.gallery || card.gallery_images)];
        renderGalleryGrid();
    }
}

function setPreview(zoneId, wrapId, imgId, nameId, data, label) {
    const zone = document.getElementById(zoneId);
    const wrap = document.getElementById(wrapId);
    const img = document.getElementById(imgId);
    const name = document.getElementById(nameId);

    if (zone && wrap && img && name) {
        img.src = data;
        name.textContent = `${label} (保存済み)`;
        zone.style.display = 'none';
        wrap.classList.add('visible');
    }
}

// ── セレクトボックス生成 ───────────────────────
async function populateCategorySelect() {
    const select = document.getElementById('cardCategory');
    if (!select) return;
    const cats = await getAllCategoriesAsync();
    cats.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = (cat.icon_url ? '' : (cat.emoji || '🏷️') + ' ') + cat.name;
        select.appendChild(opt);
    });
}

async function populateAreaSelect() {
    const select = document.getElementById('cardArea');
    if (!select) return;
    select.innerHTML = '<option value="">-- 選択してください --</option>';
    const areas = await getAllAreasAsync();
    areas.forEach(area => {
        const opt = document.createElement('option');
        opt.value = area.name;
        opt.textContent = area.name;
        select.appendChild(opt);
    });
}

// ── データ取得ユーティリティ ────────────────────
async function getAllCategoriesAsync() {
    const customCats = await machicaDB.getAll('categories');
    const settings = await machicaDB.getAll('settings');
    const deletedIds = settings.find(s => s.id === 'deleted_category_ids')?.value || [];
    let categories = CATEGORIES_DATA.filter(c => !deletedIds.includes(c.id));
    return [...categories, ...customCats];
}

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
    return [...areas, ...customAreas];
}

// ── アップロード関連 ──────────────────────────
function bindUploadEvents() {
    setupDropZone('uploadZone', 'imageFile', 'previewWrap', 'previewImg', 'previewFilename', 'removeImg', (base64) => {
        imageBase64 = base64;
    });
    setupDropZone('uploadZoneBack', 'imageFileBack', 'previewWrapBack', 'previewImgBack', 'previewFilenameBack', 'removeImgBack', (base64) => {
        imageBase64Back = base64;
    });
    setupGalleryDropZone();
}

function setupDropZone(zoneId, inputId, wrapId, imgId, nameId, removeId, onUpdate) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const wrap = document.getElementById(wrapId);
    const img = document.getElementById(imgId);
    const nameLabel = document.getElementById(nameId);
    const removeBtn = document.getElementById(removeId);

    if (!zone || !input) return;

    const handleFile = async (file) => {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const compressed = await ImageUtils.compress(e.target.result, 1200, 0.75);
            img.src = compressed;
            wrap.classList.add('visible');
            zone.style.display = 'none';
            if (nameLabel) nameLabel.textContent = file.name + ` (圧縮後: ${Math.round(compressed.length / 1024)}KB)`;
            onUpdate(compressed);
        };
        reader.readAsDataURL(file);
    };

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        handleFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', (e) => handleFile(e.target.files[0]));

    removeBtn.addEventListener('click', () => {
        onUpdate(null);
        img.src = '';
        wrap.classList.remove('visible');
        zone.style.display = 'block';
        input.value = '';
    });
}

function setupGalleryDropZone() {
    const zone = document.getElementById('uploadZoneGallery');
    const input = document.getElementById('imageFileGallery');
    const grid = document.getElementById('galleryPreviewGrid');
    if (!zone || !input || !grid) return;

    const handleFiles = async (files) => {
        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;
            const reader = new FileReader();
            reader.onload = async (e) => {
                const compressed = await ImageUtils.compress(e.target.result, 1000, 0.7);
                galleryImages.push(compressed);
                renderGalleryGrid();
            };
            reader.readAsDataURL(file);
        }
    };

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files);
    });
    input.addEventListener('change', (e) => handleFiles(e.target.files));
}

function renderGalleryGrid() {
    const grid = document.getElementById('galleryPreviewGrid');
    grid.innerHTML = '';
    galleryImages.forEach((base64, idx) => {
        const item = document.createElement('div');
        item.style.cssText = `position:relative;aspect-ratio:1;border-radius:8px;overflow:hidden;border:1px solid var(--border);`;
        item.innerHTML = `
            <img src="${base64}" style="width:100%;height:100%;object-fit:cover;" />
            <button type="button" onclick="removeGalleryImg(${idx})" style="position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,0.8);border:none;font-size:12px;cursor:pointer;">✕</button>
        `;
        grid.appendChild(item);
    });
}

window.removeGalleryImg = (idx) => {
    galleryImages.splice(idx, 1);
    renderGalleryGrid();
};

// ── フォーム送信 ────────────────────────────
function bindFormEvents() {
    const form = document.getElementById('editCardForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const title = document.getElementById('cardTitle').value.trim();
        const categoryId = parseInt(document.getElementById('cardCategory').value);
        const area = document.getElementById('cardArea').value;

        if (!title || isNaN(categoryId) || !area || !imageBase64) {
            showFormMessage('名前、ジャンル、エリア、写真は必須です', 'error');
            return;
        }

        const btn = document.getElementById('submitBtn');
        btn.disabled = true;
        btn.textContent = '保存中...';

        const updatedCard = {
            id: targetCardId,
            title: title,
            title_en: document.getElementById('cardTitleEn').value.trim(),
            description: document.getElementById('cardDesc').value.trim(),
            description_en: document.getElementById('cardDescEn').value.trim(),
            category_id: categoryId,
            area: area,
            address: document.getElementById('cardAddress').value.trim(),
            address_en: document.getElementById('cardAddressEn').value.trim(),
            lat: parseFloat(document.getElementById('cardLat').value) || null,
            lng: parseFloat(document.getElementById('cardLng').value) || null,
            // 店舗情報
            opening_hours: document.getElementById('cardOpeningHours')?.value.trim() || null,
            phone: document.getElementById('cardPhone')?.value.trim() || null,
            website: document.getElementById('cardWebsite')?.value.trim() || null,
            image_url: imageBase64,
            image_url_back: imageBase64Back,
            gallery: galleryImages,
            updated_at: new Date().toISOString()
        };

        try {
            await machicaDB.put('cards', updatedCard);
            showFormMessage('更新しました！一覧へ戻ります...', 'success');
            setTimeout(() => { window.location.href = 'cards.html'; }, 1500);
        } catch (error) {
            console.error(error);
            showFormMessage('更新に失敗しました。', 'error');
            btn.disabled = false;
            btn.textContent = '💾 更新する';
        }
    });
}

// ── その他ユーティリティ ───────────────────────
async function fetchCoordinates(name, address) {
    // Nominatim 経由は extratags=1 で営業時間・電話・HP も同時に取得
    if (address) {
        try {
            const cleanAddress = address.replace(/[ 　].*$/, '').replace(/ビル.*$/, '');
            const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(cleanAddress)}`);
            const data = await res.json();
            if (data && data.length > 0) {
                const result = { lat: data[0].geometry.coordinates[1], lng: data[0].geometry.coordinates[0] };
                const extras = await fetchBusinessTagsFromNominatim(name, address);
                if (extras) result.extras = extras;
                return result;
            }
        } catch (e) { console.warn('GSI API failed', e); }
    }

    const query = [name, address].filter(Boolean).join(' ');
    if (query) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&extratags=1&addressdetails=1&q=${encodeURIComponent(query)}`);
            const data = await res.json();
            if (data && data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lng: parseFloat(data[0].lon),
                    extras: extractBusinessExtras(data[0]),
                };
            }
        } catch (e) { console.warn('Nominatim failed', e); }
    }

    if (name) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&extratags=1&q=${encodeURIComponent(name)}`);
            const data = await res.json();
            if (data && data.length > 0) {
                return {
                    lat: parseFloat(data[0].lat),
                    lng: parseFloat(data[0].lon),
                    extras: extractBusinessExtras(data[0]),
                };
            }
        } catch (e) { console.warn('Nominatim name failed', e); }
    }

    return null;
}

function extractBusinessExtras(item) {
    if (!item) return null;
    const tags = item.extratags || {};
    const out = {
        opening_hours: tags.opening_hours || null,
        phone: tags.phone || tags['contact:phone'] || null,
        website: tags.website || tags['contact:website'] || tags.url || null,
    };
    if (!out.opening_hours && !out.phone && !out.website) return null;
    return out;
}

async function fetchBusinessTagsFromNominatim(name, address) {
    const query = [name, address].filter(Boolean).join(' ');
    if (!query) return null;
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&extratags=1&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data && data.length > 0) {
            return extractBusinessExtras(data[0]);
        }
    } catch (e) { console.warn('Nominatim extras failed', e); }
    return null;
}

function applyBusinessExtras(extras) {
    if (!extras) return;
    const map = [
        ['cardOpeningHours', extras.opening_hours],
        ['cardPhone', extras.phone],
        ['cardWebsite', extras.website],
    ];
    map.forEach(([id, value]) => {
        if (!value) return;
        const el = document.getElementById(id);
        if (!el) return;
        if (el.value && el.value.trim()) return;
        el.value = value;
        el.style.background = '#F0FFF4';
        setTimeout(() => { el.style.background = ''; }, 1500);
    });
}

function listExtraKeys(extras) {
    if (!extras) return '';
    const labels = [];
    if (extras.opening_hours) labels.push('営業時間');
    if (extras.phone) labels.push('電話');
    if (extras.website) labels.push('HP');
    return labels.join(' / ');
}

function bindAutoGeoEvent() {
    const btn = document.getElementById('autoGeoBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const address = document.getElementById('cardAddress').value.trim();
        const name = document.getElementById('cardTitle').value.trim();
        
        if (!address && !name) {
            alert('スポット名または住所を入力してください');
            return;
        }

        const originalText = btn.textContent;
        btn.textContent = '🔍 検索中...';
        btn.disabled = true;

        try {
            const coords = await fetchCoordinates(name, address);

            if (coords) {
                document.getElementById('cardLat').value = coords.lat;
                document.getElementById('cardLng').value = coords.lng;

                // 店舗情報（取得できた場合のみ既存値を上書きしない形で反映）
                applyBusinessExtras(coords.extras);

                // Google Maps URLも自動生成してセット
                const mapQuery = name ? `${name} ${address}` : address;
                const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery.trim())}`;

                const urlInput = document.getElementById('gMapPaste');
                if (urlInput) {
                    urlInput.value = mapUrl;
                    urlInput.style.borderColor = '#34D399';

                    const resultEl = document.getElementById('gMapParseResult');
                    if (resultEl) {
                        resultEl.style.display = 'block';
                        resultEl.style.background = '#F0FFF4';
                        resultEl.style.borderColor = '#BBF7D0';
                        resultEl.style.color = '#166534';
                        const extraNote = coords.extras
                            ? ` 店舗情報も自動取得しました（${listExtraKeys(coords.extras)}）。`
                            : ' 店舗情報は OSM に登録が無かったため、必要なら手動で入力してください。';
                        resultEl.textContent = `✓ 座標とURLを取得しました！${extraNote}`;
                    }
                }
            } else {
                alert('座標が見つかりませんでした。名称や住所を少し変更して再度お試しください。');
            }
        } catch (e) {
            console.error(e);
            alert('検索エラーが発生しました');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });
}

function bindAutoGeoOnBlur() {
    const addressInput = document.getElementById('cardAddress');
    const btn = document.getElementById('autoGeoBtn');
    if (!addressInput || !btn) return;
    addressInput.addEventListener('blur', () => { if (addressInput.value.trim()) btn.click(); });
}

function bindAutoTranslate() {
    const btn = document.getElementById('autoTranslateBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const title = document.getElementById('cardTitle').value.trim();
        const desc = document.getElementById('cardDesc').value.trim();
        const addr = document.getElementById('cardAddress').value.trim();
        if (!title && !desc) return;
        btn.disabled = true;
        try {
            const sep = " [|] ";
            const combined = [title, desc, addr].join(sep);
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(combined)}&langpair=ja|en`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.responseData) {
                const parts = data.responseData.translatedText.split(/\s*\[\|\]\s*/);
                document.getElementById('cardTitleEn').value = parts[0]?.trim() || '';
                document.getElementById('cardDescEn').value = parts[1]?.trim() || '';
                document.getElementById('cardAddressEn').value = parts[2]?.trim() || '';
            }
        } catch (e) { console.error(e); }
        btn.disabled = false;
    });
}

function showFormMessage(msg, type) {
    const el = document.getElementById('formMessage');
    if (!el) return;
    el.style.display = 'block';
    el.textContent = msg;
    el.style.background = type === 'success' ? '#ECFDF5' : '#FEF2F2';
    el.style.color = type === 'success' ? '#059669' : '#DC2626';
}

// ── Google Maps URL / 座標 貼り付けパーサー ────────────────
function parseGMapInput(raw) {
    const s = raw.trim();
    const atMatch = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
    const qMatch = s.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
    const llMatch = s.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (llMatch) return { lat: parseFloat(llMatch[1]), lng: parseFloat(llMatch[2]) };
    const coordMatch = s.match(/^(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)$/);
    if (coordMatch) return { lat: parseFloat(coordMatch[1]), lng: parseFloat(coordMatch[2]) };
    const dMatch = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (dMatch) return { lat: parseFloat(dMatch[1]), lng: parseFloat(dMatch[2]) };
    return null;
}

function bindGMapPaste() {
    const input = document.getElementById('gMapPaste');
    const resultEl = document.getElementById('gMapParseResult');
    if (!input) return;

    const tryParse = async () => {
        const url = input.value.trim();
        if (!url) {
            if (resultEl) resultEl.style.display = 'none';
            input.style.borderColor = 'var(--border)';
            return;
        }

        let result = parseGMapInput(url);

        if (!result && /goo\.gl|maps\.app|bit\.ly/i.test(url)) {
            if (resultEl) {
                resultEl.style.display = 'block';
                resultEl.style.background = '#F4F4F2';
                resultEl.style.borderColor = '#E5E4E1';
                resultEl.style.color = '#1E1B19';
                resultEl.textContent = '🔄 URLを展開して座標を取得中…';
            }
            try {
                const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
                const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
                const data = await res.json();
                
                const finalUrl = data?.status?.url || '';
                if (finalUrl) {
                    result = parseGMapInput(finalUrl);
                }
                
                if (!result) {
                    const contents = data?.contents || '';
                    const match = contents.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || contents.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
                    if (match) result = { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
                }
            } catch (e) {
                console.error('URL resolution failed:', e);
            }
        }

        if (result) {
            document.getElementById('cardLat').value = result.lat;
            document.getElementById('cardLng').value = result.lng;
            if (resultEl) {
                resultEl.style.display = 'block';
                resultEl.style.background = '#F0FFF4';
                resultEl.style.borderColor = '#BBF7D0';
                resultEl.style.color = '#166534';
                resultEl.textContent = `✓ 座標を取得しました：緯度 ${result.lat}、経度 ${result.lng}`;
            }
            input.style.borderColor = '#34D399';
        } else {
            if (resultEl) {
                resultEl.style.display = 'block';
                resultEl.style.background = '#FEF2F2';
                resultEl.style.borderColor = '#FECACA';
                resultEl.style.color = '#991B1B';
                resultEl.textContent = '⚠ 座標を読み取れませんでした。Google Maps の共有URLか、右クリックでコピーした座標を貼り付けてください。';
            }
            input.style.borderColor = '#F87171';
        }
    };

    input.addEventListener('paste', () => setTimeout(tryParse, 50));
    input.addEventListener('input', tryParse);
}
