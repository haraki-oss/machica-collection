/**
 * タグ管理 JS
 * - data/tags.js の TAGS_DATA / TAG_CATEGORIES（初期データ）と
 *   Supabase の `tags` / `tag_categories` テーブル（管理画面で追加・編集したもの）を統合
 * - 削除済み初期データは settings.deleted_*_ids/keys に soft-delete
 * - 編集差分は settings.tag_overrides / tag_category_overrides に格納
 */

const SETTINGS_DELETED_TAG_IDS = 'deleted_tag_ids';
const SETTINGS_TAG_OVERRIDES   = 'tag_overrides';
const SETTINGS_DELETED_CAT_KEYS = 'deleted_tag_category_keys';
const SETTINGS_CAT_OVERRIDES    = 'tag_category_overrides';

let allTags = [];
let allCategories = [];           // 統合されたカテゴリ
let categoryMap = new Map();      // key -> category 速引き

let editTagId = null;
let deleteTagId = null;
let editCatKey = null;
let deleteCatKey = null;

let collapsedCats = new Set();
let tagSearchQuery = '';

document.addEventListener('DOMContentLoaded', async () => {
    await refreshAllCategories();
    await refreshAllTags();
    populateCategorySelect();
    bindEvents();
    bindCategoryEvents();
    renderTagList();
    renderCategoryListMini();
});

// ── カテゴリ ─────────────────────────────────────────
async function refreshAllCategories() {
    if (typeof loadMergedTagCategories === 'function') {
        allCategories = await loadMergedTagCategories();
    } else {
        allCategories = (typeof TAG_CATEGORIES !== 'undefined' ? TAG_CATEGORIES : []).map(c => ({ ...c, is_seed: true }));
    }
    categoryMap = new Map(allCategories.map(c => [c.key, c]));
}

// ── タグ ─────────────────────────────────────────────
async function fetchUnifiedTags() {
    const customTags = await machicaDB.getAll('tags');
    const settings = await machicaDB.getAll('settings');
    const deletedIds = (settings.find(s => s.id === SETTINGS_DELETED_TAG_IDS)?.value) || [];
    const overrides  = (settings.find(s => s.id === SETTINGS_TAG_OVERRIDES)?.value) || {};

    const seedTags = (typeof TAGS_DATA !== 'undefined' ? TAGS_DATA : [])
        .filter(t => !deletedIds.includes(t.id))
        .map(t => {
            const ov = overrides[t.id];
            return ov ? { ...t, ...ov } : t;
        });

    const customIds = new Set(customTags.map(t => t.id));
    const merged = [...seedTags.filter(t => !customIds.has(t.id)), ...customTags];

    // カテゴリ順 → 同カテゴリ内は id 順
    const catOrder = allCategories.map(c => c.key);
    merged.sort((a, b) => {
        const ai = catOrder.indexOf(a.category);
        const bi = catOrder.indexOf(b.category);
        if (ai !== bi) return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
        return String(a.id).localeCompare(String(b.id));
    });
    return merged;
}

async function refreshAllTags() {
    allTags = await fetchUnifiedTags();
}

function populateCategorySelect() {
    const sel = document.getElementById('tagCategory');
    if (!sel) return;
    const currentValue = sel.value;
    sel.innerHTML = allCategories.map(c => `<option value="${c.key}">${escapeHtml(c.name)}</option>`).join('');
    // 既存の選択値が残っていれば復元
    if (currentValue && allCategories.some(c => c.key === currentValue)) {
        sel.value = currentValue;
    }
}

// ── イベントバインド：タグ ────────────────────────────
function bindEvents() {
    document.getElementById('tagForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveTag();
    });
    document.getElementById('tagCancelBtn')?.addEventListener('click', resetForm);

    const colorInput = document.getElementById('tagColor');
    const hexInput   = document.getElementById('tagColorHex');
    colorInput?.addEventListener('input', (e) => hexInput.value = e.target.value.toUpperCase());
    hexInput?.addEventListener('input', (e) => {
        if (/^#[0-9A-F]{6}$/i.test(e.target.value)) colorInput.value = e.target.value;
    });

    document.getElementById('tagCategory')?.addEventListener('change', (e) => {
        if (editTagId) return;
        const cat = categoryMap.get(e.target.value);
        if (cat) {
            colorInput.value = cat.color;
            hexInput.value = '';
            hexInput.placeholder = cat.color + '（カテゴリ色）';
        }
    });

    document.getElementById('tagSearchInput')?.addEventListener('input', (e) => {
        tagSearchQuery = e.target.value.trim().toLowerCase();
        renderTagList();
    });

    document.getElementById('tagExpandAllBtn')?.addEventListener('click', () => {
        collapsedCats.clear();
        renderTagList();
    });
    document.getElementById('tagCollapseAllBtn')?.addEventListener('click', () => {
        collapsedCats = new Set(allCategories.map(c => c.key));
        renderTagList();
    });

    document.getElementById('tagDeleteCancelBtn')?.addEventListener('click', closeTagDeleteModal);
    document.getElementById('tagDeleteConfirmBtn')?.addEventListener('click', async () => {
        if (deleteTagId) {
            await deleteTag(deleteTagId);
            closeTagDeleteModal();
        }
    });
}

// ── イベントバインド：カテゴリ ────────────────────────
function bindCategoryEvents() {
    document.getElementById('categoryForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveCategory();
    });
    document.getElementById('catCancelBtn')?.addEventListener('click', resetCategoryForm);

    const colorInput = document.getElementById('catColor');
    const hexInput   = document.getElementById('catColorHex');
    colorInput?.addEventListener('input', (e) => hexInput.value = e.target.value.toUpperCase());
    hexInput?.addEventListener('input', (e) => {
        if (/^#[0-9A-F]{6}$/i.test(e.target.value)) colorInput.value = e.target.value;
    });

    document.getElementById('catDeleteCancelBtn')?.addEventListener('click', closeCatDeleteModal);
    document.getElementById('catDeleteConfirmBtn')?.addEventListener('click', async () => {
        if (deleteCatKey) {
            await deleteCategory(deleteCatKey);
            closeCatDeleteModal();
        }
    });
}

// ── タグ一覧描画 ──────────────────────────────────────
function renderTagList() {
    const root = document.getElementById('tagCategoryList');
    if (!root) return;

    const matches = allTags.filter(t => !tagSearchQuery || t.name.toLowerCase().includes(tagSearchQuery));
    const byCat = {};
    for (const cat of allCategories) byCat[cat.key] = [];
    for (const t of matches) {
        if (byCat[t.category]) byCat[t.category].push(t);
    }

    root.innerHTML = allCategories.map(cat => {
        const items = byCat[cat.key] || [];
        if (tagSearchQuery && items.length === 0) return '';
        const collapsed = collapsedCats.has(cat.key) && !tagSearchQuery;
        return `
        <section class="tag-cat-card" data-cat="${cat.key}">
            <header class="tag-cat-header" onclick="toggleCategory('${cat.key}')">
                <span class="tag-cat-color-dot" style="background:${cat.color}"></span>
                <span class="tag-cat-title">${escapeHtml(cat.name)}</span>
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
    const cat = categoryMap.get(tag.category);
    const color = tag.color || cat?.color || '#888';
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

// ── カテゴリ一覧描画（コンパクトチップ） ──────────────
function renderCategoryListMini() {
    const root = document.getElementById('categoryListMini');
    if (!root) return;

    if (allCategories.length === 0) {
        root.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">カテゴリがありません</p>';
        return;
    }

    root.innerHTML = allCategories.map(c => {
        const tagCount = allTags.filter(t => t.category === c.key).length;
        return `
        <div class="cat-mini-pill" data-key="${escapeHtml(c.key)}">
            <span class="cat-mini-dot" style="background:${c.color}"></span>
            <span class="cat-mini-name">${escapeHtml(c.name)}</span>
            <span class="cat-mini-count">${tagCount}</span>
            ${c.is_seed ? '<span class="cat-mini-badge">初期</span>' : ''}
            <button class="action-btn" onclick="startEditCategory('${escapeHtml(c.key)}')">編集</button>
            <button class="action-btn danger" onclick="confirmDeleteCategory('${escapeHtml(c.key)}')">削除</button>
        </div>`;
    }).join('');
}

// ── タグ：保存・編集・削除 ────────────────────────────
async function saveTag() {
    const name = document.getElementById('tagName').value.trim();
    const category = document.getElementById('tagCategory').value;
    const colorHex = document.getElementById('tagColorHex').value.trim();
    const colorRaw = document.getElementById('tagColor').value;
    const color = colorHex || colorRaw || (categoryMap.get(category)?.color) || '#888';

    if (!name || !category) return;

    if (editTagId) {
        const target = allTags.find(t => t.id === editTagId);
        if (!target) return;

        if (target.is_seed) {
            const settings = await machicaDB.getAll('settings');
            const overrides = (settings.find(s => s.id === SETTINGS_TAG_OVERRIDES)?.value) || {};
            overrides[editTagId] = { name, color };
            await machicaDB.put('settings', { id: SETTINGS_TAG_OVERRIDES, value: overrides });
        } else {
            const updated = { ...target, name, category, color, updated_at: new Date().toISOString() };
            await machicaDB.put('tags', updated);
        }
        showToast(`タグ「${name}」を更新しました`);
    } else {
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
    renderCategoryListMini();
}

window.startEditTag = (id) => {
    const tag = allTags.find(t => t.id === id);
    if (!tag) return;

    editTagId = id;
    document.getElementById('editTagId').value = id;
    document.getElementById('tagName').value = tag.name;
    document.getElementById('tagCategory').value = tag.category;
    document.getElementById('tagCategory').disabled = !!tag.is_seed;
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

window.confirmDeleteTag = (id) => {
    const tag = allTags.find(t => t.id === id);
    if (!tag) return;
    deleteTagId = id;
    document.getElementById('tagDeleteConfirmText').textContent = `タグ「${tag.name}」を削除します。よろしいですか？`;
    document.getElementById('tagDeleteModal').style.display = 'flex';
};

function closeTagDeleteModal() {
    deleteTagId = null;
    document.getElementById('tagDeleteModal').style.display = 'none';
}

async function deleteTag(id) {
    const tag = allTags.find(t => t.id === id);
    if (!tag) return;

    if (tag.is_seed) {
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
    renderCategoryListMini();
}

// ── カテゴリ：保存・編集・削除 ────────────────────────
async function saveCategory() {
    const name = document.getElementById('catName').value.trim();
    const colorHex = document.getElementById('catColorHex').value.trim();
    const colorRaw = document.getElementById('catColor').value;
    const color = colorHex || colorRaw || '#888';

    if (!name) return;

    if (editCatKey) {
        const target = categoryMap.get(editCatKey);
        if (!target) return;

        if (target.is_seed) {
            // seed の編集差分として settings に記録（key は変更不可）
            const settings = await machicaDB.getAll('settings');
            const overrides = (settings.find(s => s.id === SETTINGS_CAT_OVERRIDES)?.value) || {};
            overrides[editCatKey] = { name, color };
            await machicaDB.put('settings', { id: SETTINGS_CAT_OVERRIDES, value: overrides });
        } else {
            const updated = { ...target, name, color, updated_at: new Date().toISOString() };
            await machicaDB.put('tag_categories', updated);
        }
        showToast(`カテゴリ「${name}」を更新しました`);
    } else {
        // 新規追加：custom-<timestamp>-<random> 形式の key
        const key = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
        const sortOrder = 200 + allCategories.filter(c => !c.is_seed).length;
        const newCat = {
            key,
            name,
            color,
            sort_order: sortOrder,
            is_seed: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        await machicaDB.put('tag_categories', newCat);
        showToast(`カテゴリ「${name}」を追加しました`);
    }

    resetCategoryForm();
    await refreshAllCategories();
    populateCategorySelect();
    await refreshAllTags();           // タグ並び替え
    renderTagList();
    renderCategoryListMini();
}

window.startEditCategory = (key) => {
    const cat = categoryMap.get(key);
    if (!cat) return;

    editCatKey = key;
    document.getElementById('editCatKey').value = key;
    document.getElementById('catName').value = cat.name;
    document.getElementById('catColor').value = cat.color || '#888888';
    document.getElementById('catColorHex').value = (cat.color || '').toUpperCase();

    document.getElementById('catFormTitle').textContent = '📝 カテゴリの編集';
    document.getElementById('catSubmitBtn').textContent = '更新する';
    document.getElementById('catCancelBtn').style.display = 'inline-block';

    window.scrollTo({ top: 0, behavior: 'smooth' });
};

function resetCategoryForm() {
    editCatKey = null;
    document.getElementById('categoryForm').reset();
    document.getElementById('editCatKey').value = '';
    document.getElementById('catColor').value = '#9B59B6';
    document.getElementById('catColorHex').value = '#9B59B6';
    document.getElementById('catFormTitle').textContent = '📁 カテゴリ管理（タグの大分類）';
    document.getElementById('catSubmitBtn').textContent = '追加する';
    document.getElementById('catCancelBtn').style.display = 'none';
}

window.confirmDeleteCategory = (key) => {
    const cat = categoryMap.get(key);
    if (!cat) return;

    const tagsInCat = allTags.filter(t => t.category === key);
    deleteCatKey = key;
    document.getElementById('catDeleteConfirmText').textContent = `カテゴリ「${cat.name}」を削除します。よろしいですか？`;
    const warn = document.getElementById('catDeleteCascadeWarn');
    if (tagsInCat.length > 0) {
        warn.textContent = `※ このカテゴリに属する ${tagsInCat.length} 個のタグも一緒に削除されます。これらのタグを使っているカードからはタグが外れます。`;
        warn.style.display = '';
    } else {
        warn.style.display = 'none';
    }
    document.getElementById('catDeleteModal').style.display = 'flex';
};

function closeCatDeleteModal() {
    deleteCatKey = null;
    document.getElementById('catDeleteModal').style.display = 'none';
}

async function deleteCategory(key) {
    const cat = categoryMap.get(key);
    if (!cat) return;

    // カスケード：このカテゴリに属するタグを全て削除（seed/custom 両方）
    const tagsInCat = allTags.filter(t => t.category === key);
    for (const t of tagsInCat) {
        await deleteTag(t.id);
    }

    // カテゴリ自体の削除
    if (cat.is_seed) {
        const settings = await machicaDB.getAll('settings');
        let deletedKeys = (settings.find(s => s.id === SETTINGS_DELETED_CAT_KEYS)?.value) || [];
        if (!deletedKeys.includes(key)) {
            deletedKeys.push(key);
            await machicaDB.put('settings', { id: SETTINGS_DELETED_CAT_KEYS, value: deletedKeys });
        }
    } else {
        await machicaDB.delete('tag_categories', key);
    }

    showToast('カテゴリを削除しました');
    await refreshAllCategories();
    populateCategorySelect();
    await refreshAllTags();
    renderTagList();
    renderCategoryListMini();
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
