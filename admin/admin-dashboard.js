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
  renderTopLiked();
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
        <div style="flex:1;background:#F4F4F2;border-radius:100px;height:8px;overflow:hidden;">
          <div style="width:${pct}%;height:100%;background:${cat.color || '#ccc'};border-radius:100px;transition:width 0.8s ease;"></div>
        </div>
        <span style="font-size:0.82rem;color:var(--text-muted);width:40px;text-align:right;">${count}件</span>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

async function renderTopLiked() {
  const container = document.getElementById('topLikedPodium');
  if (!container) return;

  // LIKE 数マップを取得（公開サイトと同じく settings.card_likes に保存されている）
  const settings = await machicaDB.getAll('settings');
  const likesMap = settings.find(s => s.id === 'card_likes')?.value || {};

  // 各カードに likes を付与してソート
  const ranked = allCards
    .map(c => ({ card: c, likes: Number(likesMap[String(c.id)] || 0) }))
    .filter(x => x.likes > 0)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 3);

  // 表彰台の表示順は 2位 → 1位 → 3位（中央が一番高い）
  const slots = [
    { rank: 2, data: ranked[1] },
    { rank: 1, data: ranked[0] },
    { rank: 3, data: ranked[2] },
  ];

  container.innerHTML = slots.map(slot => renderPodiumSlot(slot.rank, slot.data)).join('');

  // 一件もまだ LIKE が無い場合のメッセージ
  if (!ranked.length) {
    container.innerHTML = `
      <div class="podium-empty">
        ♡ まだ LIKE されたスポットがありません<br/>
        <span style="font-size:0.8rem;color:var(--text-muted);">公開サイトでカードに LIKE が付くとここにランキング表示されます</span>
      </div>
    `;
  }
}

function renderPodiumSlot(rank, item) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
  const rankClass = rank === 1 ? 'podium-1st' : rank === 2 ? 'podium-2nd' : 'podium-3rd';

  if (!item) {
    return `
      <div class="podium-item ${rankClass} podium-item--vacant">
        <div class="podium-thumb podium-thumb--vacant">${medal}</div>
        <p class="podium-title">—</p>
        <span class="podium-like-count podium-like-count--vacant">—</span>
        <div class="podium-pedestal">
          <span class="podium-rank-num">${rank}</span>
        </div>
      </div>
    `;
  }

  const { card, likes } = item;
  const fallback = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='160' viewBox='0 0 120 160'%3E%3Crect fill='%23F1F5F9' width='120' height='160'/%3E%3Ctext fill='%2394A3B8' font-size='32' x='50%25' y='50%25' text-anchor='middle' dy='.3em'%3E📷%3C/text%3E%3C/svg%3E";
  const subtitle = card.area ? `📍 ${card.area}` : '';

  return `
    <div class="podium-item ${rankClass}">
      <div class="podium-medal" aria-hidden="true">${medal}</div>
      <img
        src="${card.image_url || fallback}"
        alt="${card.title}"
        class="podium-thumb"
        onerror="this.src='${fallback}'"
      />
      <p class="podium-title" title="${card.title}">${card.title}</p>
      <p class="podium-sub">${subtitle}</p>
      <span class="podium-like-count">
        <span class="podium-like-icon">♥</span>
        <span>${likes}</span>
      </span>
      <div class="podium-pedestal">
        <span class="podium-rank-num">${rank}</span>
      </div>
    </div>
  `;
}
