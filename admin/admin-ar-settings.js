/**
 * AR管理ページ
 *
 * カードごとに「AR対応 + 動画」を設定し、ワンクリックで公開する。
 * 公開処理の内訳:
 *   1. 新規選択された動画を Supabase Storage (images バケット) にアップロード
 *   2. AR対応カードの表面画像 (image_url) から MindAR ターゲット (.mind) をブラウザ内で生成
 *   3. .mind を Storage にアップロード
 *   4. settings テーブル (id='ar_config') に構成を保存 → 公開ARスキャン画面が参照
 *
 * ar_config.value の形:
 *   { mind_url, updated_at, targets: [{ card_id, ratio, video_url }] }  ※配列順 = targetIndex
 */
import { Compiler } from 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js';

const AR_CONFIG_KEY = 'ar_config';
const MAX_VIDEO_MB = 40;

const tbody = document.getElementById('arTbody');
const cardCountLabel = document.getElementById('cardCountLabel');
const publishBtn = document.getElementById('publishBtn');
const publishSummary = document.getElementById('publishSummary');
const progressWrap = document.getElementById('arProgress');
const progressFill = document.getElementById('arProgressFill');
const progressLabel = document.getElementById('arProgressLabel');

// card_id(文字列キー) → { enabled, videoUrl, file } の編集状態
const state = new Map();
let cards = [];

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function updateSummary() {
    const enabled = cards.filter(c => state.get(String(c.id))?.enabled);
    const missing = enabled.filter(c => {
        const s = state.get(String(c.id));
        return !s.videoUrl && !s.file;
    });
    let text = `AR対応: <strong>${enabled.length}枚</strong>`;
    if (missing.length > 0) {
        text += ` ／ ⚠ 動画未設定: ${missing.length}枚（公開するには動画を選択してください）`;
    }
    publishSummary.innerHTML = text;
    publishBtn.disabled = enabled.length === 0 || missing.length > 0;
}

function renderRows() {
    tbody.innerHTML = '';
    for (const card of cards) {
        const key = String(card.id);
        const s = state.get(key);
        const tr = document.createElement('tr');
        if (!s.enabled) tr.classList.add('ar-row-disabled');

        const tdCheck = document.createElement('td');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = s.enabled;
        checkbox.addEventListener('change', () => {
            s.enabled = checkbox.checked;
            tr.classList.toggle('ar-row-disabled', !s.enabled);
            updateSummary();
        });
        tdCheck.appendChild(checkbox);

        const tdThumb = document.createElement('td');
        if (card.image_url) {
            const img = document.createElement('img');
            img.className = 'ar-thumb';
            img.loading = 'lazy';
            img.src = card.image_url;
            tdThumb.appendChild(img);
        } else {
            tdThumb.textContent = '－';
        }

        const tdTitle = document.createElement('td');
        tdTitle.innerHTML = `<strong>${esc(card.title)}</strong><br><span style="font-size:0.75rem;color:var(--text-muted);">${esc(card.area || '')}</span>`;

        const tdVideo = document.createElement('td');
        tdVideo.className = 'ar-video-cell';
        const status = document.createElement('div');
        status.className = 'video-status';
        if (s.videoUrl) {
            status.classList.add('ok');
            status.innerHTML = `✅ 設定済み <a href="${esc(s.videoUrl)}" target="_blank" style="font-weight:400;">確認</a>`;
        } else {
            status.textContent = '未設定';
        }
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'video/mp4,video/quicktime,video/webm';
        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0] || null;
            if (file && file.size > MAX_VIDEO_MB * 1024 * 1024) {
                alert(`動画は ${MAX_VIDEO_MB}MB 以下にしてください（選択: ${Math.round(file.size / 1024 / 1024)}MB）`);
                fileInput.value = '';
                s.file = null;
            } else {
                s.file = file;
                if (file) {
                    status.classList.add('ok');
                    status.textContent = `🎬 ${file.name}（公開時にアップロード）`;
                }
            }
            updateSummary();
        });
        tdVideo.appendChild(status);
        tdVideo.appendChild(fileInput);

        tr.appendChild(tdCheck);
        tr.appendChild(tdThumb);
        tr.appendChild(tdTitle);
        tr.appendChild(tdVideo);
        tbody.appendChild(tr);
    }
}

function setProgress(percent, label) {
    progressWrap.classList.add('show');
    progressFill.style.width = percent + '%';
    progressLabel.textContent = label;
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('カード画像を読み込めませんでした: ' + url));
        img.src = url;
    });
}

async function uploadToStorage(path, body, contentType) {
    const { error } = await supabaseClient.storage.from('images').upload(path, body, {
        cacheControl: '3600',
        contentType,
        upsert: false,
    });
    if (error) throw new Error('アップロードに失敗しました: ' + (error.message || JSON.stringify(error)));
    const { data } = supabaseClient.storage.from('images').getPublicUrl(path);
    return data.publicUrl;
}

async function publish() {
    const enabledCards = cards.filter(c => state.get(String(c.id))?.enabled);
    if (enabledCards.length === 0) return;
    if (enabledCards.length > 15 &&
        !confirm(`${enabledCards.length}枚が対象です。処理に${Math.round(enabledCards.length * 0.5)}分以上かかる場合があります。続けますか？`)) {
        return;
    }

    publishBtn.disabled = true;
    const ts = Date.now();

    try {
        // 1. 新規動画のアップロード
        for (let i = 0; i < enabledCards.length; i++) {
            const s = state.get(String(enabledCards[i].id));
            if (s.file) {
                setProgress(
                    (i / enabledCards.length) * 20,
                    `動画をアップロード中 (${i + 1}/${enabledCards.length}): ${s.file.name}`
                );
                const ext = (s.file.name.split('.').pop() || 'mp4').toLowerCase();
                s.videoUrl = await uploadToStorage(`ar_video_${enabledCards[i].id}_${ts}.${ext}`, s.file, s.file.type || 'video/mp4');
                s.file = null;
            }
        }

        // 2. カード画像からターゲット生成
        setProgress(20, 'カード画像を読み込み中...');
        const images = [];
        const ratios = [];
        for (const card of enabledCards) {
            const img = await loadImage(card.image_url);
            images.push(img);
            ratios.push(img.naturalHeight / img.naturalWidth);
        }

        const compiler = new Compiler();
        await compiler.compileImageTargets(images, (p) => {
            setProgress(20 + p * 0.6, `認識データを生成中... ${p.toFixed(0)}%（${enabledCards.length}枚）`);
        });
        const buffer = await compiler.exportData();

        // 3. .mind のアップロード（キャッシュ回避のためタイムスタンプ付きファイル名）
        setProgress(85, '認識データをアップロード中...');
        const mindUrl = await uploadToStorage(`ar_targets_${ts}.mind`, new Blob([buffer]), 'application/octet-stream');

        // 4. ar_config の保存
        setProgress(95, '設定を保存中...');
        const value = {
            mind_url: mindUrl,
            updated_at: new Date().toISOString(),
            targets: enabledCards.map((card, i) => ({
                card_id: card.id,
                ratio: ratios[i],
                video_url: state.get(String(card.id)).videoUrl,
            })),
        };
        await machicaDB.put('settings', { id: AR_CONFIG_KEY, value });

        setProgress(100, '公開完了！');
        renderRows();
        updateSummary();
        alert(`AR設定を公開しました（対応カード: ${enabledCards.length}枚）。\nARスキャン画面 (ar.html) に反映されています。`);
    } catch (e) {
        console.error('AR publish failed:', e);
        alert('公開に失敗しました:\n' + (e.message || JSON.stringify(e)));
    } finally {
        publishBtn.disabled = false;
        setTimeout(() => progressWrap.classList.remove('show'), 3000);
    }
}

async function init() {
    try {
        cards = await machicaDB.getAll('cards');
        cards.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ja'));

        const existing = await machicaDB.get('settings', AR_CONFIG_KEY);
        const targets = existing?.value?.targets || [];
        const byId = new Map(targets.map(t => [String(t.card_id), t]));

        for (const card of cards) {
            const t = byId.get(String(card.id));
            state.set(String(card.id), {
                enabled: !!t,
                videoUrl: t ? t.video_url : null,
                file: null,
            });
        }

        cardCountLabel.textContent = cards.length;
        renderRows();
        updateSummary();

        if (existing?.value?.updated_at) {
            const d = new Date(existing.value.updated_at);
            publishSummary.innerHTML += `<br><span style="font-size:0.78rem;">最終公開: ${d.toLocaleString('ja-JP')}</span>`;
        }
    } catch (e) {
        console.error('AR settings init failed:', e);
        publishSummary.textContent = '読み込みに失敗しました。再読み込みしてください。';
    }
}

publishBtn.addEventListener('click', publish);
init();
