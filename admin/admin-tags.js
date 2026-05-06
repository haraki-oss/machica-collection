/**
 * タグ管理 JS
 * - data/tags.js の TAGS_DATA（初期データ・コードに同梱）と
 *   Supabase の `tags` テーブル（管理画面で追加・編集したタグ）を統合表示
 * - 削除済み初期タグは settings.deleted_tag_ids に記録（soft delete）
 */

const SETTINGS_DELETED_TAG_IDS = 'deleted_tag_ids';
const SETTINGS_TAG_OVERRIDES   = 'tag_overrides'; // 初期タグの編集差分（id -> {name?, color?}）

let allTags = [];
let editTagId = null;
let deleteTagId = null;
let collapsedCats = new Set(); // ローカル状態（折りたたみ中のカテゴリ key）
let tagSearchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
    populateCategorySelect();
    bindEvents();
    await refreshAllTags();
    renderTagList();
});

/**
 * 初期タグ + カスタムタグを統合し、削除・編集差分を反映した一覧を返す
 */
async function fetchUnifiedTags() {
    const customTags = await machicaDB.getAll('tags');
    const settings = await machicaDB.getAll('settings');
    const deletedIds = (settings.find(s => s.id === SETTINGS_DELETED_TAG_IDS)?.value) || [];
    const overrides  = (settings.find(s => s.id === SETTINGS_TAG_OVERRIDES)?.value) || {};

    // 初期データ（削除済みを除外、編集差分を反映）
    const seedTags = (typeof TAGS_DATA !== 'undefined' ? TAGS_DATA : [])
        .filter(t => !deletedIds.includes(t.id))
        .map(t => {
            const ov = overrides[t.id];
            return ov ? { ...t, ...ov } : t;
        });

    // カスタムタグ（同じ id がある場合はカスタム優先）
    const customIds = new Set(customTags.map(t => t.id));
    const merged = [...seedTags.filter(t => !customIds.has(t.id)), ...customTags];

    // カテゴリ順 → 同カテゴリ内は id 順
    const catOrder = (typeof TAG_CATEGORIES !== 'undefined' ? TAG_CATEGORIES : []).map(c => c.key);
    merged.sort((a, b) => {
        const ai = catOrder.indexOf(a.category);
        const bi = catOrder.indexOf(b.category);
        if (ai !== bi) return ai - bi;
        return String(a.id).localeCompare(String(b.id));
    });
    return merged;
}

async function refreshAllTags() {
    allTags = await fetchUnifiedTags();
}

function populateCategorySelect() {
    const sel = document.getElementById('tagCategory');
    if (!sel || typeof TAG_CATEGORIES === 'undefined') return;
    sel.innerHTML = TAG_CATEGORIES.map(c => `<option value="${c.key}">${c.name}</option>`).join('');
}

function bindEvents() {
    // フォーム
    document.getElementById('tagForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveTag();
    });
    document.getElementById('tagCancelBtn')?.addEventListener('click', resetForm);

    // カラーピッカー連動
    const colorInput = document.getElementById('tagColor');
    const hexInput   = document.getElementById('tagColorHex');
    colorInput?.addEventListener('input', (e) => hexInput.value = e.target.value.toUpperCase());
    hexInput?.addEventListener('input', (e) => {
        if (/^#[0-9A-F]{6}$/i.test(e.target.value)) colorInput.value = e.target.value;
    });

    // カテゴリ変更でデフォルト色を提案
    document.getElementById('tagCategory')?.addEventListener('change', (e) => {
        if (editTagId) return; // 編集中はユーザー入力を尊重
        const cat = TAG_CATEGORY_MAP[e.target.value];
        if (cat) {
            colorInput.value = cat.color;
            hexInput.value = '';
            hexInput.placeholder = cat.color + '（カテゴリ色）';
        }
    });

    // 検索
    document.getElementById('tagSearchInput')?.addEventListener('input', (e) => {
        tagSearchQuery = e.target.value.trim().toLowerCase();
        renderTagList();
    });

    // 全展開 / 全折りたたみ
    document.getElementById('tagExpandAllBtn')?.addEventListener('click', () => {
        collapsedCats.clear();
        renderTagList();
    });
    document.getElementById('tagCollapseAllBtn')?.addEventListener('click', () => {
        collapsedCats = new Set(TAG_CATEGORIES.map(c => c.key));
        renderTagList();
    });

    // 削除モーダル
    document.getElementById('tagDeleteCancelBtn')?.addEventListener('click', closeDeleteModal);
    document.getElementById('tagDeleteConfirmBtn')?.addEventListener('click', async () => {
        if (deleteTagId) {
            await deleteTag(deleteTagId);
            closeDeleteModal();
        }
    });
}

function renderTagList() {
    const root = document.getElementById('tagCategoryList');
    if (!root) return;

    const matches = allTags.filter(t => !tagSearchQuery || t.name.toLowerCase().includes(tagSearchQuery));
    const byCat = {};
    for (const cat of TAG_CATEGORIES) byCat[cat.key] = [];
    for (const t of matches) {
        if (byCat[t.category]) byCat[t.category].push(t);
    }

    root.innerHTML = TAG_CATEGORIES.map(cat => {
        const items = byCat[cat.key] || [];
        if (tagSearchQuery && items.length === 0) return ''; // 検索ヒット 0 のカテゴリは隠す
        const collapsed = collapsedCats.has(cat.key) && !tagSearchQuery;
        return `
        <section class="tag-cat-card" data-cat="${cat.key}">
            <header class="tag-cat-header" onclick="toggleCategory('${cat.key}')">
                <span class="tag-cat-color-dot" style="background:${cat.color}"></span>
                <span class="tag-cat-title">${cat.name}</span>
                <span class="tag-cat-count">${items.length}</span>
                <span class="tag-cat-arrow ${collapsed ? 'is-collapsed' : ''}">▼</span>
            </header>
            <div class="tag-cat-body" ${collapsed ? 'hidden' : ''}>
                ${items.length === 0
                    ? '<p class="tag-cat-empty">タグがありません</p>'
                    : items.map(t => renderTagPill(t)).join('')
                }
            </div>
        </section>`;
    }).join('');
}

function renderTagPill(tag) {
    const color = tag.color || (TAG_CATEGORY_MAP[tag.category]?.color) || '#888';
    const isSeed = !!tag.is_seed;
    return `
    <div class="tag-admin-pill" style="--tag-color:${color}" data-id="${tag.id}">
        <span class="tag-admin-pill-dot"></span>
        <span class="tag-admin-pill-name">${escapeHtml(tag.name)}</span>
        <span class="tag-admin-pill-id">${escapeHtml(tag.id)}</span>
        ${isSeed ? '<span class="tag-admin-pill-badge">初期</span>' : ''}
        <div class="tag-admin-pill-actions">
            <button class="action-btn" onclick="startEditTag('${tag.id}')">編集</button>
            <button class="action-btn danger" onclick="confirmDeleteTag('${tag.id}')">削除</button>
        </div>
    </div>`;
}

window.toggleCategory = (key) => {
    if (collapsedCats.has(key)) collapsedCats.delete(key);
    else collapsedCats.add(key);
    renderTagList();
};

// ── 保存・更新 ───────────────────────────────────────
async function saveTag() {
    const name = document.getElementById('tagName').value.trim();
    const category = document.getElementById('tagCategory').value;
    const colorHex = document.getElementById('tagColorHex').value.trim();
    const colorRaw = document.getElementById('tagColor').value;
    const color = colorHex || colorRaw || (TAG_CATEGORY_MAP[category]?.color) || '#888';

    if (!name || !category) return;

    if (editTagId) {
        const target = allTags.find(t => t.id === editTagId);
        if (!target) return;

        if (target.is_seed) {
            // 初期タグは settings.tag_overrides に差分として記録
            const settings = await machicaDB.getAll('settings');
            const overrides = (settings.find(s => s.id === SETTINGS_TAG_OVERRIDES)?.value) || {};
            overrides[editTagId] = { name, color };
            // category は初期タグでは変更不可（入力はあっても無視）
            await machicaDB.put('settings', { id: SETTINGS_TAG_OVERRIDES, value: overrides });
        } else {
            // カスタムタグはそのまま更新
            const updated = { ...target, name, category, color, updated_at: new Date().toISOString() };
            await machicaDB.put('tags', updated);
        }
        showToast(`タグ「${name}」を更新しました`);
    } else {
        // 新規追加
        const id = `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const newTag = {
            id,
            name,
            category,
            color,
            is_seed: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        await machicaDB.put('tags', newTag);
        showToast(`タグ「${name}」を追加しました`);
    }

    resetForm();
    await refreshAllTags();
    renderTagList();
}

window.startEditTag = (id) => {
    const tag = allTags.find(t => t.id === id);
    if (!tag) return;

    editTagId = id;
    document.getElementById('editTagId').value = id;
    document.getElementById('tagName').value = tag.name;
    document.getElementById('tagCategory').value = tag.category;
    document.getElementById('tagCategory').disabled = !!tag.is_seed; // 初期タグはカテゴリ変更不可
    document.getElementById('tagColor').value = tag.color || '#888888';
    document.getElementById('tagColorHex').value = (tag.color || '').toUpperCase();

    document.getElementById('tagFormTitle').textContent = '📝 タグの編集';
    document.getElementById('tagSubmitBtn').textContent = '更新する';
    document.getElementById('tagCancelBtn').style.display = 'inline-block';

    window.scrollTo({ top: 0, behavior: 'smooth' });
};

function resetForm() {
    editTagId = null;
    document.getElementById('tagForm').reset();
    document.getElementById('editTagId').value = '';
    document.getElementById('tagCategory').disabled = false;
    document.getElementById('tagFormTitle').textContent = '➕ 新規タグ追加';
    document.getElementById('tagSubmitBtn').textContent = '追加する';
    document.getElementById('tagCancelBtn').style.display = 'none';
    document.getElementById('tagColorHex').placeholder = 'カテゴリ色';
}

// ── 削除 ─────────────────────────────────────────────
window.confirmDeleteTag = (id) => {
    const tag = allTags.find(t => t.id === id);
    if (!tag) return;
    deleteTagId = id;
    document.getElementById('tagDeleteConfirmText').textContent = `タグ「${tag.name}」を削除します。よろしいですか？`;
    document.getElementById('tagDeleteModal').style.display = 'flex';
};

function closeDeleteModal() {
    deleteTagId = null;
    document.getElementById('tagDeleteModal').style.display = 'none';
}

async function deleteTag(id) {
    const tag = allTags.find(t => t.id === id);
    if (!tag) return;

    if (tag.is_seed) {
        // 初期タグは settings に削除済みリストとして記録
        const settings = await machicaDB.getAll('settings');
        let deletedIds = (settings.find(s => s.id === SETTINGS_DELETED_TAG_IDS)?.value) || [];
        if (!deletedIds.includes(id)) {
            deletedIds.push(id);
            await machicaDB.put('settings', { id: SETTINGS_DELETED_TAG_IDS, value: deletedIds });
        }
    } else {
        await machicaDB.delete('tags', id);
    }

    showToast('タグを削除しました');
    await refreshAllTags();
    renderTagList();
}

// ── ユーティリティ ───────────────────────────────────
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function showToast(msg) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1E1B19;color:#fff;padding:12px 20px;border-radius:10px;font-size:0.88rem;font-weight:500;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.15);';
    toast.textContent = '✓ ' + msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
