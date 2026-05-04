/**
 * エリア管理 JS
 */

const LS_AREAS_KEY = 'machica_custom_areas'; // 後方互換性用
let allAreas = [];
let deleteTargetId = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. 移行の実行
    await migrateLocalStorageToIndexedDB();

    // 1b. 旧エリア名でロックされたカードを現エリア名に追従させる（一回性、冪等）
    await migrateLegacyCardAreaNames();

    // 2. データの初期化
    await initAreas();
    renderAreaTable();
    bindEvents();
});

/**
 * カードの area フィールドが旧エリア名のままになっているケースを救済する。
 * 例: 過去に「北海道」→「旭川」とリネームされたが、所属カードは area:"北海道"
 *      のまま。これだと公開サイトのフィルターから外れる。
 *
 * 戦略:
 *   現在の有効エリア名集合に存在しない card.area を「孤児」と見做し、
 *   {OLD: NEW} の対応表（LEGACY_AREA_RENAMES）で書き換える。
 *   何度実行しても安全（対象が無ければ何もしない）。
 */
const LEGACY_AREA_RENAMES = {
    '北海道': '旭川',
};

async function migrateLegacyCardAreaNames() {
    try {
        const cards = await machicaDB.getAll('cards');
        const stale = cards.filter(c => c && LEGACY_AREA_RENAMES[c.area]);
        if (!stale.length) return;
        for (const c of stale) c.area = LEGACY_AREA_RENAMES[c.area];
        await machicaDB.put('cards', stale);
        console.log(`Migrated ${stale.length} card(s) to renamed area names.`);
    } catch (e) {
        console.warn('migrateLegacyCardAreaNames failed:', e);
    }
}

async function initAreas() {
    allAreas = await getAllAreasAsync();
    // IDの降順（新しい順）
    allAreas.sort((a, b) => b.id - a.id);
}

/**
 * データの取得（モック、編集済み、カスタムを統合）
 */
async function getAllAreasAsync() {
    // IndexedDB からカスタムエリアと編集済み情報を取得
    const customAreas = await machicaDB.getAll('areas');
    const settings = await machicaDB.getAll('settings');

    const editedAreas = settings.find(s => s.id === 'edited_areas')?.value || [];
    const deletedIds = settings.find(s => s.id === 'deleted_area_ids')?.value || [];

    // モックデータ（AREAS_DATA）に、編集・削除・カスタムを適用
    let areas = AREAS_DATA.map(a => {
        const edited = editedAreas.find(e => e.id === a.id);
        return edited ? { ...a, ...edited } : a;
    });

    // 削除済みを除外
    areas = areas.filter(a => !deletedIds.includes(a.id));

    // カスタムを追加
    return [...areas, ...customAreas];
}

function renderAreaTable() {
    const tbody = document.getElementById('areaTbody');
    const label = document.getElementById('areaCountLabel');
    if (!tbody) return;

    label.textContent = allAreas.length;

    tbody.innerHTML = allAreas.map(area => {
        return `
            <tr>
                <td style="font-family:monospace; font-size:0.8rem; color:var(--text-muted);">${area.id}</td>
                <td style="font-weight:600;">${area.name}</td>
                <td>${area.name_en || '-'}</td>
                <td>
                    <div style="display:flex; gap:6px;">
                        <button class="action-btn" onclick="startEditArea(${area.id})">編集</button>
                        <button class="action-btn danger" onclick="confirmDeleteArea(${area.id}, '${area.name}')">削除</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function bindEvents() {
    // 追加フォーム
    document.getElementById('addAreaForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('areaName').value.trim();
        const nameEn = document.getElementById('areaNameEn').value.trim();

        if (!name || !nameEn) return;

        const newArea = {
            id: Date.now(),
            name,
            name_en: nameEn
        };

        // IndexedDB に追加
        await machicaDB.put('areas', newArea);

        // メモリ反映と再描画
        allAreas.unshift(newArea);
        renderAreaTable();

        // フォームリセット
        e.target.reset();
        showToast(`エリア「${name}」を追加しました`);
    });

    // 編集モーダル
    document.getElementById('editCancelBtn')?.addEventListener('click', closeEditModal);
    document.getElementById('editSaveBtn')?.addEventListener('click', saveAreaEdit);

    // 削除モーダル
    document.getElementById('deleteCancelBtn')?.addEventListener('click', closeDeleteModal);
    document.getElementById('deleteConfirmBtn')?.addEventListener('click', async () => {
        if (deleteTargetId) {
            await deleteArea(deleteTargetId);
            closeDeleteModal();
        }
    });
}

function confirmDeleteArea(id, name) {
    deleteTargetId = id;
    const modal = document.getElementById('deleteModal');
    const text = document.getElementById('deleteConfirmText');
    if (modal && text) {
        text.textContent = `エリア「${name}」を削除します。よろしいですか？`;
        modal.classList.add('active');
    }
}

function closeDeleteModal() {
    deleteTargetId = null;
    const modal = document.getElementById('deleteModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

async function deleteArea(id) {
    // 1. メモリから削除
    allAreas = allAreas.filter(a => a.id !== id);

    // 2. 永続化
    if (id < 1000) {
        // 初期データの場合：削除済みIDリストに追加
        const settings = await machicaDB.getAll('settings');
        let deletedIds = settings.find(s => s.id === 'deleted_area_ids')?.value || [];
        if (!deletedIds.includes(id)) {
            deletedIds.push(id);
            await machicaDB.put('settings', { id: 'deleted_area_ids', value: deletedIds });
        }
    } else {
        // カスタムデータの場合：物理削除
        await machicaDB.delete('areas', id);
    }

    renderAreaTable();
    showToast('エリアを削除しました');
}

// ── 編集 ──────────────────────────────────────────
let editTargetId = null;

function startEditArea(id) {
    const area = allAreas.find(a => a.id === id);
    if (!area) return;

    editTargetId = id;
    document.getElementById('editAreaName').value = area.name;
    document.getElementById('editAreaNameEn').value = area.name_en || '';

    const modal = document.getElementById('editModal');
    if (modal) modal.classList.add('active');
}

function closeEditModal() {
    editTargetId = null;
    const modal = document.getElementById('editModal');
    if (modal) modal.classList.remove('active');
}

async function saveAreaEdit() {
    if (!editTargetId) return;

    const name = document.getElementById('editAreaName').value.trim();
    const nameEn = document.getElementById('editAreaNameEn').value.trim();

    if (!name || !nameEn) {
        alert('全ての項目を入力してください');
        return;
    }

    // 1. メモリ反映（旧名は事前に控える）
    const target = allAreas.find(a => a.id === editTargetId);
    const oldName = target?.name;
    if (target) {
        target.name = name;
        target.name_en = nameEn;
    }

    // 2. IndexedDB 反映
    if (editTargetId < 1000) {
        // 初期データ
        const settings = await machicaDB.getAll('settings');
        let editedAreas = settings.find(s => s.id === 'edited_areas')?.value || [];
        const idx = editedAreas.findIndex(a => a.id === editTargetId);
        const updated = { id: editTargetId, name, name_en: nameEn };
        if (idx !== -1) {
            editedAreas[idx] = updated;
        } else {
            editedAreas.push(updated);
        }
        await machicaDB.put('settings', { id: 'edited_areas', value: editedAreas });
    } else {
        // カスタムデータ
        await machicaDB.put('areas', { id: editTargetId, name, name_en: nameEn });
    }

    // 3. 名称が変わった場合は所属カードの area 文字列も追従させる
    let migrated = 0;
    if (oldName && oldName !== name) {
        try {
            const cards = await machicaDB.getAll('cards');
            const stale = cards.filter(c => c && c.area === oldName);
            if (stale.length) {
                for (const c of stale) c.area = name;
                await machicaDB.put('cards', stale);
                migrated = stale.length;
            }
        } catch (e) {
            console.warn('Card area migration failed:', e);
        }
    }

    renderAreaTable();
    closeEditModal();
    const suffix = migrated > 0 ? `（カード ${migrated} 件も更新）` : '';
    showToast(`エリア「${name}」を更新しました${suffix}`);
}

function showToast(msg) {
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:#1E1B19;color:#fff;padding:12px 20px;border-radius:10px;font-size:0.88rem;font-weight:500;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.15);animation:fadeInUp 0.3s ease;`;
    toast.textContent = '✓ ' + msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}
