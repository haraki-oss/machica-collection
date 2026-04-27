/**
 * カード管理一覧 JS
 */

let allCards = [];
let deleteTargetId = null;

document.addEventListener('DOMContentLoaded', async () => {
  // 1. 移行の実行
  await migrateLocalStorageToIndexedDB();

  // 2. データの初期化
  await initCards();
  renderCardTable();
  bindEvents();

  // 3. バックグラウンドで不足している英語データを翻訳補完 (IndexedDB版)
  backgroundAutoTranslateDB();
});

async function initCards() {
  // カスタムカードと設定情報を取得
  const customCards = await machicaDB.getAll('cards');
  const settings = await machicaDB.getAll('settings');
  const deletedIds = settings.find(s => s.id === 'deleted_card_ids')?.value || [];

  // モックデータから削除済みを除外
  const mocks = CARDS_DATA.filter(c => !deletedIds.includes(c.id));

  // 統合
  allCards = [...customCards, ...mocks];

  // ID降順
  allCards.sort((a, b) => b.id - a.id);
}

function renderCardTable() {
  const tbody = document.getElementById('adminCardTbody') || document.getElementById('cardTbody');
  const label = document.getElementById('cardCountLabel');
  if (!tbody) return;

  if (label) label.textContent = allCards.length;

  if (allCards.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:48px;color:var(--text-muted);">スポットが見つかりません</td></tr>`;
    return;
  }

  tbody.innerHTML = allCards.map(card => {
    const cat = getAllCategories().find(c => c.id === card.category_id);
    const area = card.area || '-';
    const address = card.address || '-';

    return `
            <tr>
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
                <td><span style="font-size:0.82rem; color:var(--text-muted);">${address}</span></td>
                <td>
                    <div style="display:flex; gap:6px;">
                        <a href="cards-edit.html?id=${card.id}" class="action-btn">編集</a>
                        <button class="action-btn danger" onclick="confirmDeleteCard(${card.id}, '${card.title.replace(/'/g, "\\'")}')">削除</button>
                    </div>
                </td>
            </tr>
        `;
  }).join('');
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

  // 検索フィルタ
  const searchInput = document.getElementById('cardSearch') || document.getElementById('adminSearch');
  searchInput?.addEventListener('input', (e) => {
    const val = e.target.value.toLowerCase();
    const rows = document.querySelectorAll('#adminCardTbody tr, #cardTbody tr');
    rows.forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(val) ? '' : 'none';
    });
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
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:#1E293B;color:#fff;padding:12px 20px;border-radius:10px;font-size:0.88rem;font-weight:500;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.15);animation:fadeInUp 0.3s ease;`;
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
