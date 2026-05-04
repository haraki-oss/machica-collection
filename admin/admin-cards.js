/**
 * カード管理一覧 JS
 */

let allCards = [];
let deleteTargetId = null;
let sortState = { column: null, direction: 'asc' };
let filterState = { keyword: '', area: 'all', staff: 'all', category: 'all' };

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 移行の実行
  await migrateLocalStorageToIndexedDB();

  // 2. データの初期化
  await initCards();
  await populateAdminFilters();
  renderCardTable();
  bindEvents();

  // 3. バックグラウンドで不足している英語データを翻訳補完 (IndexedDB版)
  backgroundAutoTranslateDB();
});

// 現在の filterState を反映したカード集合
function getDisplayedCards() {
  const kw = (filterState.keyword || '').trim().toLowerCase();
  return allCards.filter(card => {
    if (filterState.area !== 'all' && (card.area || '') !== filterState.area) return false;
    if (filterState.staff !== 'all' && (card.recommended_by || '').trim() !== filterState.staff) return false;
    if (filterState.category !== 'all' && String(card.category_id) !== String(filterState.category)) return false;
    if (kw) {
      const blob = [
        card.title, card.title_en,
        card.description, card.description_en,
        card.address, card.address_en,
        card.area, card.recommended_by
      ].filter(Boolean).join(' ').toLowerCase();
      if (!blob.includes(kw)) return false;
    }
    return true;
  });
}

function isFiltered() {
  return !!filterState.keyword
    || filterState.area !== 'all'
    || filterState.staff !== 'all'
    || filterState.category !== 'all';
}

// ドロップダウンの選択肢を生成（カード読み込み後に1回呼ぶ）
async function populateAdminFilters() {
  // ── 地域 ──
  const customAreas = await machicaDB.getAll('areas');
  const settings = await machicaDB.getAll('settings');
  const editedAreas = settings.find(s => s.id === 'edited_areas')?.value || [];
  const deletedAreaIds = settings.find(s => s.id === 'deleted_area_ids')?.value || [];
  const baseAreas = (typeof AREAS_DATA !== 'undefined' ? AREAS_DATA : []).map(a => {
    const ed = editedAreas.find(e => e.id === a.id);
    return ed ? { ...a, ...ed } : a;
  }).filter(a => !deletedAreaIds.includes(a.id) && a.id !== 99);
  const seenAreaIds = new Set(baseAreas.map(a => a.id));
  const allAreasMerged = [...baseAreas, ...customAreas.filter(c => !seenAreaIds.has(c.id))]
    .sort((a, b) => (a.id || 0) - (b.id || 0));

  const areaSel = document.getElementById('adminFilterArea');
  if (areaSel) {
    areaSel.innerHTML = '<option value="all">すべての地域</option>';
    allAreasMerged.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.name;
      opt.textContent = a.name;
      areaSel.appendChild(opt);
    });
  }

  // ── ジャンル ──
  const customCats = await machicaDB.getAll('categories');
  const deletedCatIds = settings.find(s => s.id === 'deleted_category_ids')?.value || [];
  const baseCats = (typeof CATEGORIES_DATA !== 'undefined' ? CATEGORIES_DATA : [])
    .filter(c => !deletedCatIds.includes(c.id));
  const seenCatIds = new Set(baseCats.map(c => c.id));
  const allCatsMerged = [...baseCats, ...customCats.filter(c => !seenCatIds.has(c.id))]
    .sort((a, b) => (a.id || 0) - (b.id || 0));

  const catSel = document.getElementById('adminFilterCategory');
  if (catSel) {
    catSel.innerHTML = '<option value="all">すべてのジャンル</option>';
    allCatsMerged.forEach(c => {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      opt.textContent = c.name;
      catSel.appendChild(opt);
    });
  }

  // ── スタッフ ──（renderCardTable から都度再構築）
  rebuildStaffOptions();

  refreshFilterUiState();
}

/**
 * スタッフ用ドロップダウンを「他のフィルター条件に合致するカードに登録されているスタッフ」だけ
 * 表示するよう再構築する。スタッフ自身の絞り込みは除外して文脈を作る。
 * 例: 地域=旭川, ジャンル=観光 → そのカードに居るスタッフのみが選択肢に出る。
 *
 * 現在選択中のスタッフは、たとえ文脈外でもオプションに残す（外したつもりが残っていた等の混乱を防ぐ）。
 */
function rebuildStaffOptions() {
  const staffSel = document.getElementById('adminFilterStaff');
  if (!staffSel) return;

  const ctxKw = (filterState.keyword || '').trim().toLowerCase();
  const contextCards = allCards.filter(card => {
    if (filterState.area !== 'all' && (card.area || '') !== filterState.area) return false;
    if (filterState.category !== 'all' && String(card.category_id) !== String(filterState.category)) return false;
    if (ctxKw) {
      const blob = [
        card.title, card.title_en,
        card.description, card.description_en,
        card.address, card.address_en,
        card.area, card.recommended_by
      ].filter(Boolean).join(' ').toLowerCase();
      if (!blob.includes(ctxKw)) return false;
    }
    return true;
  });

  const staffSet = new Set();
  contextCards.forEach(c => {
    const v = (c.recommended_by || '').trim();
    if (v) staffSet.add(v);
  });
  // 現在選択中のスタッフが文脈外でも残す
  if (filterState.staff !== 'all') staffSet.add(filterState.staff);

  const staffList = [...staffSet].sort((a, b) => a.localeCompare(b, 'ja'));
  const baseLabel = staffList.length === 0 ? 'スタッフが登録されていません' : 'すべてのスタッフ';

  staffSel.innerHTML = `<option value="all">${baseLabel}</option>`;
  staffList.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    staffSel.appendChild(opt);
  });
  staffSel.value = filterState.staff;
}

// アクティブな絞り込み状態を見た目に反映
function refreshFilterUiState() {
  const map = {
    adminFilterArea: filterState.area,
    adminFilterStaff: filterState.staff,
    adminFilterCategory: filterState.category,
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('is-active', val !== 'all');
    el.value = val;
  });
  const resetBtn = document.getElementById('adminFilterReset');
  if (resetBtn) resetBtn.classList.toggle('is-visible', isFiltered());
  const searchInput = document.getElementById('adminSearch');
  if (searchInput && searchInput.value !== filterState.keyword) {
    searchInput.value = filterState.keyword;
  }
}

async function initCards() {
  // カスタムカードと設定情報を取得
  const customCards = await machicaDB.getAll('cards');
  const settings = await machicaDB.getAll('settings');
  const deletedIds = settings.find(s => s.id === 'deleted_card_ids')?.value || [];
  const orderIds = settings.find(s => s.id === 'card_order')?.value || [];

  // モックデータから削除済みを除外
  const mocks = CARDS_DATA.filter(c => !deletedIds.includes(c.id));

  // 統合
  allCards = [...customCards, ...mocks];

  // ユーザーが定義した並び順を優先、未指定はID降順で末尾
  allCards = sortByCardOrder(allCards, orderIds);
}

/**
 * card_order（IDの並び順配列）を使ってカードをソート。
 * 配列に含まれないカードは ID 降順で末尾に並べる。
 */
function sortByCardOrder(cards, orderIds) {
  const indexMap = new Map(orderIds.map((id, i) => [String(id), i]));
  return [...cards].sort((a, b) => {
    const aIdx = indexMap.get(String(a.id));
    const bIdx = indexMap.get(String(b.id));
    if (aIdx !== undefined && bIdx !== undefined) return aIdx - bIdx;
    if (aIdx !== undefined) return -1;
    if (bIdx !== undefined) return 1;
    return b.id - a.id;
  });
}

async function persistCardOrder(orderedIds) {
  await machicaDB.put('settings', { id: 'card_order', value: orderedIds });
}

function renderCardTable() {
  const tbody = document.getElementById('adminCardTbody') || document.getElementById('cardTbody');
  const label = document.getElementById('cardCountLabel');
  if (!tbody) return;

  const displayed = getDisplayedCards();
  const filtered = isFiltered();
  const dragEnabled = !filtered; // フィルター中は D&D を無効化（部分順序の混乱を避ける）

  // 件数表示：フィルター中は「○件 / 全○件」、未フィルター時は単純な件数
  if (label) {
    label.textContent = filtered
      ? `${displayed.length} / ${allCards.length}`
      : String(allCards.length);
  }

  // 空状態
  if (displayed.length === 0) {
    const msg = filtered ? '条件に合うスポットがありません' : 'スポットが見つかりません';
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:48px;color:var(--text-muted);">${msg}</td></tr>`;
    rebuildStaffOptions();
    refreshFilterUiState();
    return;
  }

  tbody.innerHTML = displayed.map(card => {
    const cat = getAllCategories().find(c => c.id === card.category_id);
    const area = card.area || '-';
    const recommender = card.recommended_by || '';
    const recommenderHtml = recommender
      ? `<span style="font-size:0.85rem;">${recommender}</span>`
      : `<span style="font-size:0.82rem;color:var(--text-muted);">—</span>`;

    const handleAttrs = dragEnabled
      ? 'title="ドラッグして並び替え"'
      : 'title="フィルター解除後に並び替えできます" style="opacity:0.25;cursor:not-allowed;"';

    return `
            <tr ${dragEnabled ? 'draggable="true"' : ''} data-id="${card.id}">
                <td class="drag-handle" ${handleAttrs}>⋮⋮</td>
                <td>
                    <div class="card-thumb">
                        <img src="${card.image_url}" alt="" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'48\' height=\'36\'%3E%3Crect fill=\'%23F1F5F9\' width=\'48\' height=\'36\'/%3E%3Ctext fill=\'%2394A3B8\' font-size=\'14\' x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\'%3E📷%3C/text%3E%3C/svg%3E'">
                    </div>
                </td>
                <td>
                    <div style="font-weight:600; margin-bottom:2px;">${card.title}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${card.title_en || '-'}</div>
                </td>
                <td>
                    <span class="badge" style="background:${cat?.bg || '#f0f0f0'}; color:${cat?.color || '#666'};">
                        ${cat?.name || '不明'}
                    </span>
                </td>
                <td><span style="font-size:0.85rem;">${area}</span></td>
                <td>${recommenderHtml}</td>
                <td>
                    <div style="display:flex; gap:6px;">
                        <a href="cards-edit.html?id=${card.id}" class="action-btn">編集</a>
                        <button class="action-btn danger" onclick="confirmDeleteCard(${card.id}, '${card.title.replace(/'/g, "\\'")}')">削除</button>
                    </div>
                </td>
            </tr>
        `;
  }).join('');

  if (dragEnabled) setupRowDragAndDrop(tbody);
  updateSortIndicators();
  rebuildStaffOptions();
  refreshFilterUiState();
}

/**
 * テーブル行のドラッグ&ドロップ並び替え。
 * - 行に draggable=true を付与
 * - dragover で挿入位置を判定し DOM を即時更新（プレビュー）
 * - drop 時に最終順序を Supabase の card_order に保存
 */
function setupRowDragAndDrop(tbody) {
  let draggedRow = null;

  tbody.querySelectorAll('tr[draggable="true"]').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      draggedRow = row;
      row.classList.add('row-dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox はデータをセットしないと drag が始まらない
      try { e.dataTransfer.setData('text/plain', row.dataset.id); } catch (_) { }
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('row-dragging');
      tbody.querySelectorAll('tr.row-drop-above, tr.row-drop-below')
        .forEach(r => r.classList.remove('row-drop-above', 'row-drop-below'));
      draggedRow = null;
    });

    row.addEventListener('dragover', (e) => {
      if (!draggedRow || draggedRow === row) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const rect = row.getBoundingClientRect();
      const isAbove = (e.clientY - rect.top) < (rect.height / 2);

      // 視覚的フィードバック（直接 DOM 移動はせずクラスでガイド線）
      tbody.querySelectorAll('tr.row-drop-above, tr.row-drop-below')
        .forEach(r => r.classList.remove('row-drop-above', 'row-drop-below'));
      row.classList.add(isAbove ? 'row-drop-above' : 'row-drop-below');
    });

    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!draggedRow || draggedRow === row) return;

      const rect = row.getBoundingClientRect();
      const isAbove = (e.clientY - rect.top) < (rect.height / 2);

      if (isAbove) {
        tbody.insertBefore(draggedRow, row);
      } else {
        tbody.insertBefore(draggedRow, row.nextSibling);
      }

      const orderedIds = [...tbody.querySelectorAll('tr[draggable="true"]')]
        .map(r => parseInt(r.dataset.id, 10))
        .filter(n => !isNaN(n));

      // メモリ上の allCards も同じ順序に並べ替え
      const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
      allCards.sort((a, b) => (orderMap.get(a.id) ?? Infinity) - (orderMap.get(b.id) ?? Infinity));

      // 手動ドラッグ後はカラムソート状態を解除
      sortState = { column: null, direction: 'asc' };
      updateSortIndicators();

      try {
        await persistCardOrder(orderedIds);
        showToast('順序を保存しました');
      } catch (err) {
        console.error('Failed to persist card order:', err);
        showToast('順序の保存に失敗しました');
      }
    });
  });
}

function bindEvents() {
  // 削除モーダル
  document.getElementById('deleteCancelBtn')?.addEventListener('click', closeDeleteModal);
  document.getElementById('deleteConfirmBtn')?.addEventListener('click', async () => {
    if (deleteTargetId) {
      await deleteCard(deleteTargetId);
      closeDeleteModal();
    }
  });

  // 検索フィルタ（複数フィールド横断・他の絞り込みと AND）
  const searchInput = document.getElementById('cardSearch') || document.getElementById('adminSearch');
  searchInput?.addEventListener('input', (e) => {
    filterState.keyword = e.target.value;
    renderCardTable();
  });

  // 地域・スタッフ・ジャンル
  document.getElementById('adminFilterArea')?.addEventListener('change', (e) => {
    filterState.area = e.target.value;
    renderCardTable();
  });
  document.getElementById('adminFilterStaff')?.addEventListener('change', (e) => {
    filterState.staff = e.target.value;
    renderCardTable();
  });
  document.getElementById('adminFilterCategory')?.addEventListener('change', (e) => {
    filterState.category = e.target.value;
    renderCardTable();
  });

  // リセット
  document.getElementById('adminFilterReset')?.addEventListener('click', () => {
    filterState = { keyword: '', area: 'all', staff: 'all', category: 'all' };
    renderCardTable();
  });

  // 列ヘッダークリックで並び替え
  document.querySelectorAll('.admin-table th.sortable').forEach(th => {
    th.addEventListener('click', () => handleSortClick(th.dataset.sortKey));
  });
}

/**
 * 列ヘッダー：1回目クリック=昇順、同じ列を再クリック=降順を交互。
 * 別の列をクリックしたら昇順から再開。
 */
async function handleSortClick(column) {
  if (!column) return;
  if (sortState.column === column) {
    sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.column = column;
    sortState.direction = 'asc';
  }
  sortAllCardsBy(column, sortState.direction);
  renderCardTable();

  // 並び順を保存（公開サイトにも反映）
  const orderedIds = allCards.map(c => c.id);
  try {
    await persistCardOrder(orderedIds);
    showToast(`${labelOfSortKey(column)} を${sortState.direction === 'asc' ? '昇順' : '降順'}で並び替えました`);
  } catch (err) {
    console.error('Failed to persist sort order:', err);
    showToast('順序の保存に失敗しました');
  }
}

function labelOfSortKey(key) {
  switch (key) {
    case 'title': return 'スポット名';
    case 'category': return 'ジャンル';
    case 'area': return 'エリア';
    case 'recommender': return 'レコメンドスタッフ';
    default: return key;
  }
}

/**
 * 指定列で allCards を昇順/降順に並べ替える（日本語対応の localeCompare 使用）
 */
function sortAllCardsBy(column, direction) {
  const cats = getAllCategories();
  const catMap = new Map(cats.map(c => [c.id, c]));

  const keyFn = (card) => {
    switch (column) {
      case 'title': return (card.title || '').toLowerCase();
      case 'category': {
        const cat = catMap.get(card.category_id);
        return (cat?.name || '').toLowerCase();
      }
      case 'area': return (card.area || '').toLowerCase();
      case 'recommender': return (card.recommended_by || '').toLowerCase();
      default: return '';
    }
  };

  allCards.sort((a, b) => {
    const av = keyFn(a);
    const bv = keyFn(b);
    const cmp = String(av).localeCompare(String(bv), 'ja');
    return direction === 'desc' ? -cmp : cmp;
  });
}

/**
 * テーブルヘッダーのソートインジケーター（↕ ↑ ↓）を更新
 */
function updateSortIndicators() {
  document.querySelectorAll('.admin-table th.sortable').forEach(th => {
    const ind = th.querySelector('.sort-indicator');
    if (!ind) return;
    if (th.dataset.sortKey === sortState.column) {
      ind.textContent = sortState.direction === 'asc' ? '↑' : '↓';
      ind.classList.add('active');
      th.classList.add('is-sorted');
    } else {
      ind.textContent = '↕';
      ind.classList.remove('active');
      th.classList.remove('is-sorted');
    }
  });
}

function confirmDeleteCard(id, title) {
  deleteTargetId = id;
  const modal = document.getElementById('deleteModal');
  const text = document.getElementById('deleteConfirmText');
  if (modal && text) {
    text.textContent = `スポット「${title}」を削除します。よろしいですか？`;
    modal.classList.add('active');
    modal.style.display = '';
  }
}

function closeDeleteModal() {
  deleteTargetId = null;
  const modal = document.getElementById('deleteModal');
  if (modal) modal.classList.remove('active');
}

async function deleteCard(id) {
  // 1. メモリから削除
  allCards = allCards.filter(c => c.id !== id);

  // 2. 永続化
  if (id < 1000000) {
    // 初期データ（モック）の場合
    const settings = await machicaDB.getAll('settings');
    let deletedIds = settings.find(s => s.id === 'deleted_card_ids')?.value || [];
    if (!deletedIds.includes(id)) {
      deletedIds.push(id);
      await machicaDB.put('settings', { id: 'deleted_card_ids', value: deletedIds });
    }
  } else {
    // カスタムデータの場合
    await machicaDB.delete('cards', id);
  }

  renderCardTable();
  showToast('カードを削除しました');
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:#1E1B19;color:#fff;padding:12px 20px;border-radius:10px;font-size:0.88rem;font-weight:500;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.15);animation:fadeInUp 0.3s ease;`;
  toast.textContent = '✓ ' + msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/**
 * バックグラウンド翻訳 (IndexedDB版)
 */
async function backgroundAutoTranslateDB() {
  const cards = await machicaDB.getAll('cards');
  const needsTranslation = cards.filter(c => !c.title_en || !c.description_en);

  if (needsTranslation.length === 0) return;

  for (const card of needsTranslation) {
    try {
      const sep = " [|] ";
      const combinedText = [card.title, card.description, card.address].join(sep);
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(combinedText)}&langpair=ja|en`;

      const res = await fetch(url);
      const data = await res.json();
      if (!data.responseData) continue;

      const translatedCombined = data.responseData.translatedText;
      const parts = translatedCombined.split(/\s*\[\|\]\s*/);

      if (parts.length >= 3) {
        card.title_en = parts[0]?.trim() || '';
        card.description_en = parts[1]?.trim() || '';
        card.address_en = parts[2]?.trim() || '';

        await machicaDB.put('cards', card);
        console.log(`Translated/Updated in DB: ${card.title}`);

        // 再描画
        renderCardTable();
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.error('Background translation failed:', e);
    }
  }
}
