/**
 * カテゴリー管理 JS
 */

const LS_CUSTOM_CAT_KEY = 'machica_custom_categories';
const LS_DELETED_CAT_KEY = 'machica_deleted_category_ids';

let allCategories = [];
let editTargetId = null;
let deleteTargetId = null;

document.addEventListener('DOMContentLoaded', async () => {
  await migrateLocalStorageToIndexedDB();
  await initCategories();
  renderCategoryTable();
  bindEvents();
});

async function initCategories() {
  allCategories = await getAllCategoriesAsync();
}

/**
 * データの取得（モック、カスタムを統合。削除済みを除外）
 */
async function getAllCategoriesAsync() {
  const customCats = await machicaDB.getAll('categories');
  const settings = await machicaDB.getAll('settings');
  const deletedIds = settings.find(s => s.id === 'deleted_category_ids')?.value || [];

  let categories = CATEGORIES_DATA.filter(c => !deletedIds.includes(c.id));
  return [...categories, ...customCats];
}

function renderCategoryTable() {
  const tbody = document.getElementById('categoryTbody');
  if (!tbody) return;

  tbody.innerHTML = allCategories.map(cat => {
    const count = typeof CARDS_DATA !== 'undefined'
      ? CARDS_DATA.filter(c => c.category_id === cat.id).length
      : 0;

    const iconHtml = getCategoryIcon(cat);

    return `
            <tr data-id="${cat.id}">
                <td style="font-family:monospace; color:var(--text-muted);">${cat.id}</td>
                <td>
                    <div class="category-icon-cell" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, ${cat.id})">
                        ${iconHtml}
                        <div class="drop-hint">DROP</div>
                    </div>
                </td>
                <td style="font-weight:600;">${cat.name}</td>
                <td>${cat.name_en || '-'}</td>
                <td>
                   <div style="display:flex; align-items:center; gap:8px;">
                     <span style="width:14px; height:14px; border-radius:50%; background:${cat.color}; border:1px solid rgba(0,0,0,0.1);"></span>
                     <code style="font-size:0.75rem;">${cat.color}</code>
                   </div>
                </td>
                <td>
                    <div style="display:flex; gap:6px;">
                        <button class="action-btn" onclick="startEditCategory(${cat.id})">編集</button>
                        <button class="action-btn danger" onclick="confirmDeleteCategory(${cat.id}, '${cat.name}')">削除</button>
                    </div>
                </td>
            </tr>
        `;
  }).join('');
}

function bindEvents() {
  // カラーピッカー連動
  const colorInput = document.getElementById('categoryColor');
  const hexInput = document.getElementById('categoryColorHex');
  colorInput?.addEventListener('input', (e) => hexInput.value = e.target.value.toUpperCase());
  hexInput?.addEventListener('input', (e) => {
    if (/^#[0-9A-F]{6}$/i.test(e.target.value)) colorInput.value = e.target.value;
  });

  // フォーム送信
  document.getElementById('categoryForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveCategory();
  });

  // キャンセル
  document.getElementById('cancelEditBtn')?.addEventListener('click', resetForm);

  // 削除モーダル
  document.getElementById('deleteCancelBtn')?.addEventListener('click', closeDeleteModal);
  document.getElementById('deleteConfirmBtn')?.addEventListener('click', async () => {
    if (deleteTargetId) {
      await deleteCategory(deleteTargetId);
      closeDeleteModal();
    }
  });
}

// ── 保存・更新 ──────────────────────────────────────
async function saveCategory() {
  const name = document.getElementById('categoryName').value.trim();
  const nameEn = document.getElementById('categoryNameEn').value.trim();
  const color = document.getElementById('categoryColorHex').value.trim();

  if (!name || !nameEn) return;

  if (editTargetId) {
    // 更新
    const target = allCategories.find(c => c.id === editTargetId);
    const updated = {
      ...target,
      name,
      name_en: nameEn,
      color,
      bg: hexToLightRgba(color, 0.1)
    };
    await machicaDB.put('categories', updated);
    showToast(`カテゴリー「${name}」を更新しました`);
  } else {
    // 新規追加
    const newCat = {
      id: Date.now(),
      name,
      name_en: nameEn,
      slug: nameEn.toLowerCase().replace(/\s+/g, '-'),
      emoji: '🏷️',
      icon_url: '',
      color,
      bg: hexToLightRgba(color, 0.1)
    };
    await machicaDB.put('categories', newCat);
    showToast(`カテゴリー「${name}」を追加しました`);
  }

  resetForm();
  await initCategories();
  renderCategoryTable();
}

function startEditCategory(id) {
  const cat = allCategories.find(c => c.id === id);
  if (!cat) return;

  editTargetId = id;
  document.getElementById('categoryName').value = cat.name;
  document.getElementById('categoryNameEn').value = cat.name_en;
  document.getElementById('categoryColor').value = cat.color;
  document.getElementById('categoryColorHex').value = cat.color.toUpperCase();

  document.getElementById('formTitle').textContent = '📝 カテゴリーの編集';
  document.getElementById('submitBtn').textContent = '更新する';
  document.getElementById('cancelEditBtn').style.display = 'inline-block';

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  editTargetId = null;
  document.getElementById('categoryForm').reset();
  document.getElementById('formTitle').textContent = '➕ 新規カテゴリー追加';
  document.getElementById('submitBtn').textContent = '追加する';
  document.getElementById('cancelEditBtn').style.display = 'none';
}

// ── 削除 ──────────────────────────────────────────
function confirmDeleteCategory(id, name) {
  deleteTargetId = id;
  const modal = document.getElementById('deleteModal');
  const text = document.getElementById('deleteConfirmText');
  if (modal && text) {
    text.textContent = `カテゴリー「${name}」を削除します。よろしいですか？`;
    modal.style.display = 'flex';
  }
}

function closeDeleteModal() {
  deleteTargetId = null;
  document.getElementById('deleteModal').style.display = 'none';
}

async function deleteCategory(id) {
  if (id < 100) {
    // 初期データ
    const settings = await machicaDB.getAll('settings');
    let deletedIds = settings.find(s => s.id === 'deleted_category_ids')?.value || [];
    if (!deletedIds.includes(id)) {
      deletedIds.push(id);
      await machicaDB.put('settings', { id: 'deleted_category_ids', value: deletedIds });
    }
  } else {
    // カスタムデータ
    await machicaDB.delete('categories', id);
  }

  showToast('カテゴリーを削除しました');
  await initCategories();
  renderCategoryTable();
}

// ── ドラッグ＆ドロップ (アイコン画像) ────────────────
window.handleDragOver = (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  e.currentTarget.classList.add('drag-over');
};
window.handleDragLeave = (e) => {
  e.currentTarget.classList.remove('drag-over');
};
window.handleDrop = (e, id) => {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    const reader = new FileReader();
    reader.onload = async (event) => {
      // 画像を圧縮してから保存
      const compressed = await ImageUtils.compress(event.target.result, 400, 0.7); // アイコンは小さく
      await updateCategoryIcon(id, compressed);
    };
    reader.readAsDataURL(file);
  }
};

async function updateCategoryIcon(id, base64) {
  const target = allCategories.find(c => c.id === id);
  if (!target) return;

  const updated = { ...target, icon_url: base64 };
  await machicaDB.put('categories', updated);

  showToast('アイコン画像を更新しました');
  await initCategories();
  renderCategoryTable();
}

// ── ユーティリティ ──────────────────────────────────
function hexToLightRgba(hex, alpha) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:#1E293B;color:#fff;padding:12px 20px;border-radius:10px;font-size:0.88rem;font-weight:500;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.15);animation:fadeInUp 0.3s ease;`;
  toast.textContent = '✓ ' + msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// IndexedDBへの移行処理 (新規追加)
async function migrateLocalStorageToIndexedDB() {
  // カスタムカテゴリーの移行
  const customCategoriesJson = localStorage.getItem(LS_CUSTOM_CAT_KEY);
  if (customCategoriesJson) {
    const customCategories = JSON.parse(customCategoriesJson);
    for (const cat of customCategories) {
      await machicaDB.put('categories', cat);
    }
    localStorage.removeItem(LS_CUSTOM_CAT_KEY);
    console.log('Migrated custom categories from localStorage to IndexedDB.');
  }

  // 削除済みカテゴリーIDの移行
  const deletedCatIdsJson = localStorage.getItem(LS_DELETED_CAT_KEY);
  if (deletedCatIdsJson) {
    const deletedCatIds = JSON.parse(deletedCatIdsJson);
    await machicaDB.put('settings', { id: 'deleted_category_ids', value: deletedCatIds });
    localStorage.removeItem(LS_DELETED_CAT_KEY);
    console.log('Migrated deleted category IDs from localStorage to IndexedDB.');
  }
}
