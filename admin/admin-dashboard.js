/**
 * 管理ダッシュボード JS
 */
let allCards = [];
let allCategories = [];

document.addEventListener('DOMContentLoaded', async () => {
  // 1. データの同期
  await migrateLocalStorageToIndexedDB();

  // 2. データの取得
  const customCards = await machicaDB.getAll('cards');
  const settings = await machicaDB.getAll('settings');
  const deletedIds = settings.find(s => s.id === 'deleted_card_ids')?.value || [];
  const mocks = typeof CARDS_DATA !== 'undefined' ? CARDS_DATA.filter(c => !deletedIds.includes(c.id)) : [];

  allCards = [...customCards, ...mocks];
  allCategories = await getAllCategoriesAsync();

  // 3. 表示
  renderStats();
  renderGenreStats();
  renderRecentCards();
});

async function getAllCategoriesAsync() {
  const customCats = await machicaDB.getAll('categories');
  const settings = await machicaDB.getAll('settings');
  const deletedIds = settings.find(s => s.id === 'deleted_category_ids')?.value || [];
  let categories = typeof CATEGORIES_DATA !== 'undefined' ? CATEGORIES_DATA.filter(c => !deletedIds.includes(c.id)) : [];
  return [...categories, ...customCats];
}

function renderStats() {
  const areas = new Set(allCards.map(c => c.area));
  const withImg = allCards.filter(c => c.image_url).length;

  document.getElementById('statTotal').textContent = allCards.length;
  document.getElementById('statAreas').textContent = areas.size;
  document.getElementById('statWithImg').textContent = withImg;
}

function renderGenreStats() {
  const container = document.getElementById('genreStats');
  if (!container) return;

  const html = allCategories.map(cat => {
    const count = allCards.filter(c => c.category_id === cat.id).length;
    const pct = allCards.length > 0 ? Math.round((count / allCards.length) * 100) : 0;
    const iconHtml = cat.icon_url
      ? `<img src="${cat.icon_url}" alt="${cat.name}" style="width:20px;height:20px;object-fit:contain;" />`
      : `<span>${cat.emoji || '🏷️'}</span>`;

    return `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;width:100px;flex-shrink:0;">
          ${iconHtml}
          <span style="font-size:0.88rem;font-weight:600;color:var(--text-primary);">${cat.name}</span>
        </div>
        <div style="flex:1;background:#F1F5F9;border-radius:100px;height:8px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${cat.color || '#ccc'};border-radius:100px;transition:width 0.8s ease;"></div>
        </div>
        <span style="font-size:0.82rem;color:var(--text-muted);width:40px;text-align:right;">${count}件</span>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

function renderRecentCards() {
  const container = document.getElementById('recentCards');
  if (!container) return;

  // ID降順 = 最近登録した順
  const sorted = [...allCards].sort((a, b) => b.id - a.id);
  const recent = sorted.slice(0, 6);

  container.innerHTML = recent.map(card => {
    const cat = allCategories.find(c => c.id === card.category_id);
    return `
      <div class="recent-card">
        <img
          src="${card.image_url}"
          alt="${card.title}"
          class="recent-card-img"
          onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'120\' viewBox=\'0 0 200 120\'%3E%3Crect fill=\'%23F1F5F9\' width=\'200\' height=\'120\'/%3E%3Ctext fill=\'%2394A3B8\' font-size=\'20\' x=\'50%25\' y=\'50%25\' text-anchor=\'middle\' dy=\'.3em\'%3E📷%3C/text%3E%3C/svg%3E'"
        />
        <div class="recent-card-info">
          <p class="recent-card-title">${card.title}</p>
          <p class="recent-card-area">${cat ? (cat.emoji || '🏷️') + ' ' + cat.name : ''} · ${card.area}</p>
        </div>
      </div>
    `;
  }).join('');
}
