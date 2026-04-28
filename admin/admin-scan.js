'use strict';

let frontImageBase64 = null;
let backImageBase64 = null;

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await migrateLocalStorageToIndexedDB();
    await populateCategorySelect();
    await populateAreaSelect();
    setupDropZones();
    setupForm();
});

// ── Drop Zones ────────────────────────────────────────
function setupDropZones() {
    // 表面（英語カード）= image_url
    setupZone('frontDropZone', 'frontFileInput', 'frontPreviewImg', 'frontChangeBtn', true);
    // 裏面（日本語カード）= image_url_back → QR・OCR対象
    setupZone('backDropZone', 'backFileInput', 'backPreviewImg', 'backChangeBtn', false);
}

function setupZone(zoneId, inputId, imgId, changeBtnId, isFront) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const img = document.getElementById(imgId);
    const changeBtn = document.getElementById(changeBtnId);

    if (!zone || !input) return;

    const handleFile = async (file) => {
        if (!file || !file.type.startsWith('image/')) return;
        const compressed = await compressImage(file, 1400);
        img.src = compressed;
        img.style.display = 'block';
        zone.style.display = 'none';
        if (changeBtn) {
            changeBtn.style.display = 'block';
            changeBtn.onclick = () => {
                img.style.display = 'none';
                zone.style.display = '';
                changeBtn.style.display = 'none';
                if (isFront) {
                    frontImageBase64 = null;
                } else {
                    backImageBase64 = null;
                    resetStatus();
                }
                updateSubmitState();
            };
        }

        if (isFront) {
            // 表面 = 英語カード（image_url）
            frontImageBase64 = compressed;
            updateSubmitState();
        } else {
            // 裏面 = 日本語カード（image_url_back）→ QR・OCR 対象
            backImageBase64 = compressed;
            document.getElementById('ocrBtn').disabled = false;
            await detectAndProcessQR(file);
        }
    };

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });
    input.addEventListener('change', (e) => handleFile(e.target.files[0]));
}

async function compressImage(file, maxWidth = 1200) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const compressed = await ImageUtils.compress(e.target.result, maxWidth, 0.78);
            resolve(compressed);
        };
        reader.readAsDataURL(file);
    });
}

// ── QR Detection ─────────────────────────────────────
async function detectAndProcessQR(imageFile) {
    setStatus('qrStatus', 'scanning', 'QRコードを読み取り中…');
    setStatus('locationStatus', 'idle', '📍 座標：QR待ち');
    setStatus('addressStatus', 'idle', '🏠 住所：座標待ち');
    document.getElementById('qrUrlSection').style.display = 'none';

    const qrUrl = await detectQR(imageFile);

    if (!qrUrl) {
        setStatus('qrStatus', 'err', 'QRコードが見つかりませんでした。手動で住所・座標を入力してください。');
        return;
    }

    setStatus('qrStatus', 'ok', `QRコード検出: ${truncate(qrUrl, 60)}`);
    setStatus('locationStatus', 'scanning', '座標を取得中…');

    const coords = await getCoordinatesFromUrl(qrUrl);
    if (coords) {
        document.getElementById('cardLat').value = coords.lat;
        document.getElementById('cardLng').value = coords.lng;
        setStatus('locationStatus', 'ok', `緯度 ${coords.lat}、経度 ${coords.lng}`);

        setStatus('addressStatus', 'scanning', '住所を取得中（Nominatim）…');
        const address = await reverseGeocode(coords.lat, coords.lng);
        if (address) {
            document.getElementById('cardAddress').value = address;
            setStatus('addressStatus', 'ok', `${address}`);
        } else {
            setStatus('addressStatus', 'err', '住所の自動取得に失敗しました。手動で入力してください。');
        }
    } else {
        setStatus('locationStatus', 'err', '座標を自動取得できませんでした。');
        // Show the URL so user can open it manually
        const urlSection = document.getElementById('qrUrlSection');
        document.getElementById('qrDecodedUrl').textContent = qrUrl;
        const openLink = document.getElementById('qrOpenLink');
        openLink.href = qrUrl;
        urlSection.style.display = 'block';
    }
}

function detectQR(imageFile) {
    return new Promise(async (resolve) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(imageFile);
        
        img.onload = async () => {
            // 1. BarcodeDetector API (Native, high accuracy)
            if ('BarcodeDetector' in window) {
                try {
                    const barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
                    const barcodes = await barcodeDetector.detect(img);
                    if (barcodes.length > 0) {
                        URL.revokeObjectURL(objectUrl);
                        resolve(barcodes[0].rawValue);
                        return;
                    }
                } catch (e) {
                    console.warn('BarcodeDetector failed or no barcode found', e);
                }
            }

            // 2. Fallback to jsQR
            // Try multiple scales for better QR detection
            const scales = [1.0, 2.0, 0.5];
            for (const scale of scales) {
                const canvas = document.createElement('canvas');
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
                if (code) { URL.revokeObjectURL(objectUrl); resolve(code.data); return; }
                // Also try with inverted
                const code2 = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'onlyInvert' });
                if (code2) { URL.revokeObjectURL(objectUrl); resolve(code2.data); return; }
            }
            URL.revokeObjectURL(objectUrl);
            resolve(null);
        };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
        img.src = objectUrl;
    });
}

async function getCoordinatesFromUrl(url) {
    // 1. Try direct parsing
    const direct = parseGMapInput(url);
    if (direct) return direct;

    // 2. For short URLs, resolve via CORS proxy
    if (/goo\.gl|maps\.app|bit\.ly/i.test(url)) {
        try {
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
            const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
            const data = await res.json();
            // allorigins returns the final redirected URL in status.url
            const finalUrl = data?.status?.url || '';
            console.log('Resolved to:', finalUrl);
            if (finalUrl) {
                const parsed = parseGMapInput(finalUrl);
                if (parsed) return parsed;
            }
            // Also try parsing from page contents (Google Maps embeds coords in page)
            const contents = data?.contents || '';
            const match = contents.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
        } catch (e) {
            console.error('URL resolution failed:', e);
        }
    }
    return null;
}

async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ja`,
            { headers: { 'User-Agent': 'machica-card-portal-admin/1.0' } }
        );
        const data = await res.json();
        return data.display_name || null;
    } catch (e) {
        console.error('Reverse geocode failed:', e);
        return null;
    }
}

// ── OCR (Tesseract.js - lazy loaded) ──────────────────
async function preprocessImageForOCR(base64) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // シンプルな二値化（グレースケール化＋閾値処理）
            // 閾値は少し高めにして、背景の桜や薄い点線を白に飛ばす
            const threshold = 160; 
            
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                // 輝度（Luminance）の計算
                const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
                
                if (luminance > threshold) {
                    data[i] = 255;     // R
                    data[i + 1] = 255; // G
                    data[i + 2] = 255; // B
                } else {
                    data[i] = 0;       // R
                    data[i + 1] = 0;   // G
                    data[i + 2] = 0;   // B
                }
            }
            
            ctx.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = reject;
        img.src = base64;
    });
}

async function runOCR() {
    // OCR対象は裏面（日本語カード）
    const targetImage = backImageBase64;
    if (!targetImage) {
        alert('裏面カード（日本語）が未アップロードです。');
        return;
    }
    const btn = document.getElementById('ocrBtn');
    btn.disabled = true;
    btn.textContent = '⟳ 言語データをダウンロード中…（初回のみ数十秒）';
    setOcrStatus('scanning', 'Tesseract.js を読み込み中…');

    try {
        if (!window.Tesseract) {
            await loadScript('https://unpkg.com/tesseract.js@v4.1.1/dist/tesseract.min.js');
        }
        
        btn.textContent = '⟳ OCR実行中…';
        setOcrStatus('scanning', '画像の前処理（二値化）を実行中…');
        const processedImage = await preprocessImageForOCR(targetImage);

        setOcrStatus('scanning', 'Japanese OCR 実行中…（20〜60秒）');
        const worker = await Tesseract.createWorker('jpn', 1, {
            logger: m => { if (m.status === 'recognizing text') btn.textContent = `⟳ OCR ${Math.round(m.progress * 100)}%…`; }
        });
        const { data: { text } } = await worker.recognize(processedImage);
        await worker.terminate();

        processOCRText(text);
        setOcrStatus('ok', 'OCR完了！テキストを確認・修正してください。');
    } catch (e) {
        console.error('OCR failed:', e);
        setOcrStatus('err', 'OCRに失敗しました。手動で入力してください。');
    }

    btn.disabled = false;
    btn.textContent = '🔍 OCR でスポット名・説明文を読み取る';
}

function processOCRText(rawText) {
    // 改行で分割し、前後の空白を削除
    let lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // 1. 不要な行を除去
    lines = lines.filter(l => {
        // 記号や数字だけの行を除外（点線、バーコードの誤認識など）
        if (/^[0-9\s!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?・〜〜ー]+$/.test(l)) return false;
        // 完全に英語の行を除外
        if (/^[a-zA-Z\s]+$/.test(l)) return false;
        // 特定キーワードを含む行を除外
        const ignoreWords = ['AMANEK', 'walk away', 'min', 'machica'];
        if (ignoreWords.some(w => l.toLowerCase().includes(w.toLowerCase()))) return false;
        return true;
    });

    // 2. タイトルの抽出
    const titleEl = document.getElementById('cardTitle');
    if (!titleEl.value) {
        // 日本語が含まれ、短めの行をタイトル候補とする
        const titleLine = lines.find(l => l.length >= 2 && l.length <= 25 && /[\u3000-\u9fff]/.test(l));
        if (titleLine) {
            // 先頭にある数字やスペース（例: "26 "）を除去
            titleEl.value = titleLine.replace(/^[0-9\s.、]+/, '').trim();
        }
    }

    // 3. 説明文の抽出
    const descEl = document.getElementById('cardDesc');
    if (!descEl.value) {
        // タイトルとして選ばれた行以降の、ある程度長い日本語行を説明文とする
        const titleIndex = lines.findIndex(l => titleEl.value && l.includes(titleEl.value.substring(0, 3)));
        const startIndex = titleIndex >= 0 ? titleIndex + 1 : 0;
        
        const descLines = lines.slice(startIndex).filter(l => l.length > 5 && /[\u3000-\u9fff]/.test(l));
        if (descLines.length > 0) {
            descEl.value = descLines.join('\n'); // 繋げて1つのテキストに
        }
    }

    // Show debug
    console.log('[OCR Raw]', rawText);
    console.log('[OCR Processed]', lines);
}

function setOcrStatus(state, msg) {
    const el = document.getElementById('ocrStatus');
    el.style.display = 'block';
    el.className = `status-item ${state === 'scanning' ? 'scanning' : state === 'ok' ? 'ok' : 'err'}`;
    el.innerHTML = `<span ${state === 'scanning' ? 'class="spin"' : ''}>
        ${state === 'scanning' ? '⟳' : state === 'ok' ? '✓' : '⚠'}
    </span> ${msg}`;
}

// ── Category & Area selects ───────────────────────────
async function populateCategorySelect() {
    const select = document.getElementById('cardCategory');
    if (!select) return;
    const cats = await getAllCategoriesAsync();
    cats.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = (cat.emoji || '🏷️') + ' ' + cat.name;
        // Default to 観光
        if (cat.slug === 'sightseeing' || cat.name === '観光') opt.selected = true;
        select.appendChild(opt);
    });
}

async function getAllCategoriesAsync() {
    const customCats = await machicaDB.getAll('categories');
    const settings = await machicaDB.getAll('settings');
    const deletedIds = settings.find(s => s.id === 'deleted_category_ids')?.value || [];
    const categories = CATEGORIES_DATA.filter(c => !deletedIds.includes(c.id));
    return [...categories, ...customCats];
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

async function getAllAreasAsync() {
    const customAreas = await machicaDB.getAll('areas');
    const settings = await machicaDB.getAll('settings');
    const editedAreas = settings.find(s => s.id === 'edited_areas')?.value || [];
    const deletedIds = settings.find(s => s.id === 'deleted_area_ids')?.value || [];
    let areas = AREAS_DATA.map(a => {
        const edited = editedAreas.find(e => e.id === a.id);
        return edited ? { ...a, ...edited } : a;
    }).filter(a => !deletedIds.includes(a.id));
    return [...areas, ...customAreas];
}

// ── Form ──────────────────────────────────────────────
function setupForm() {
    const form = document.getElementById('scanCardForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => { e.preventDefault(); await saveCard(); });
    document.getElementById('ocrBtn').addEventListener('click', runOCR);
}

function updateSubmitState() {
    const btn = document.getElementById('submitBtn');
    const hint = document.getElementById('submitHint');
    // 表面（英語カード）が必須
    if (frontImageBase64) {
        btn.disabled = false;
        if (hint) hint.style.display = 'none';
    } else {
        btn.disabled = true;
        if (hint) hint.style.display = 'block';
    }
}

async function saveCard() {
    const title = document.getElementById('cardTitle').value.trim();
    const categoryId = parseInt(document.getElementById('cardCategory').value);
    const area = document.getElementById('cardArea').value;

    if (!title || isNaN(categoryId) || !area || !frontImageBase64) {
        showMessage('スポット名、ジャンル、エリア、表面写真は必須です', 'error');
        return;
    }

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = '保存中…';

    const newCard = {
        id: Date.now(),
        title,
        title_en: document.getElementById('cardTitleEn').value.trim(),
        description: document.getElementById('cardDesc').value.trim(),
        description_en: document.getElementById('cardDescEn').value.trim(),
        category_id: categoryId,
        area,
        address: document.getElementById('cardAddress').value.trim(),
        lat: parseFloat(document.getElementById('cardLat').value) || null,
        lng: parseFloat(document.getElementById('cardLng').value) || null,
        image_url: frontImageBase64,
        image_url_back: backImageBase64,
        gallery: [],
        created_at: new Date().toISOString()
    };

    try {
        await machicaDB.put('cards', newCard);
        showMessage(`「${title}」を登録しました！`, 'success');
        setTimeout(() => { window.location.href = 'cards.html'; }, 1500);
    } catch (err) {
        console.error(err);
        showMessage('保存に失敗しました。', 'error');
        btn.disabled = false;
        btn.textContent = '💾 カードを登録する';
    }
}

// ── Utilities ─────────────────────────────────────────
function setStatus(elementId, state, message) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const cfg = {
        idle:     { cls: 'idle',     prefix: '' },
        scanning: { cls: 'scanning', prefix: '<span class="spin">⟳</span> ' },
        ok:       { cls: 'ok',       prefix: '✓ ' },
        err:      { cls: 'err',      prefix: '⚠ ' }
    }[state] || { cls: 'idle', prefix: '' };
    el.className = `status-item ${cfg.cls}`;
    el.innerHTML = cfg.prefix + message;
}

function resetStatus() {
    setStatus('qrStatus', 'idle', '📱 QRコード：未読み取り');
    setStatus('locationStatus', 'idle', '📍 座標：未取得');
    setStatus('addressStatus', 'idle', '🏠 住所：未取得');
    document.getElementById('qrUrlSection').style.display = 'none';
    document.getElementById('ocrBtn').disabled = true;
}

function showMessage(msg, type) {
    const el = document.getElementById('formMessage');
    if (!el) return;
    el.style.display = 'block';
    el.textContent = (type === 'success' ? '✓ ' : '⚠ ') + msg;
    el.style.background = type === 'success' ? '#F0FFF4' : '#FEF2F2';
    el.style.color = type === 'success' ? '#166534' : '#991B1B';
    el.style.border = `1px solid ${type === 'success' ? '#BBF7D0' : '#FECACA'}`;
    el.style.padding = '12px 16px';
    el.style.borderRadius = '8px';
    el.style.marginBottom = '12px';
    el.style.fontSize = '0.88rem';
}

function parseGMapInput(raw) {
    if (!raw) return null;
    const s = raw.trim();
    const atMatch = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
    const qMatch = s.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) };
    const llMatch = s.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (llMatch) return { lat: parseFloat(llMatch[1]), lng: parseFloat(llMatch[2]) };
    const cMatch = s.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
    if (cMatch) return { lat: parseFloat(cMatch[1]), lng: parseFloat(cMatch[2]) };
    return null;
}

function truncate(str, n) { return str.length > n ? str.slice(0, n) + '…' : str; }

async function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
}
