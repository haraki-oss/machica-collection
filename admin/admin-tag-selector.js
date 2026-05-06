/**
 * 共通タグセレクター
 * - cards-new.html / cards-edit.html の両方で利用
 * - グローバルに `TagSelector` を公開し、各画面の JS から呼ぶ
 *
 * 使い方:
 *   const selector = await TagSelector.mount('#tagSelectorCard');
 *   selector.setSelected(['genre-01','emotion-03']);
 *   selector.getSelected();      // -> ['genre-01', ...]
 *   selector.validate();         // -> {ok:true} or {ok:false, message:'...'}
 */

(function () {
    const SETTINGS_DELETED_TAG_IDS = 'deleted_tag_ids';
    const SETTINGS_TAG_OVERRIDES = 'tag_overrides';

    async function loadAllTagsUnified() {
        const customTags = await machicaDB.getAll('tags');
        const settings = await machicaDB.getAll('settings');
        const deletedIds = (settings.find(s => s.id === SETTINGS_DELETED_TAG_IDS)?.value) || [];
        const overrides = (settings.find(s => s.id === SETTINGS_TAG_OVERRIDES)?.value) || {};

        const seedTags = (typeof TAGS_DATA !== 'undefined' ? TAGS_DATA : [])
            .filter(t => !deletedIds.includes(t.id))
            .map(t => {
                const ov = overrides[t.id];
                return ov ? { ...t, ...ov } : t;
            });

        const customIds = new Set(customTags.map(t => t.id));
        return [...seedTags.filter(t => !customIds.has(t.id)), ...customTags];
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    class Selector {
        constructor(rootEl) {
            this.root = rootEl;
            this.max = parseInt(rootEl.dataset.max || '5', 10);
            this.requiredCats = (rootEl.dataset.requiredCategories || '').split(',').map(s => s.trim()).filter(Boolean);
            this.recommendedCats = (rootEl.dataset.recommendedCategories || '').split(',').map(s => s.trim()).filter(Boolean);
            this.searchEl = rootEl.querySelector('.tag-selector-search');
            this.selectedListEl = rootEl.querySelector('.tag-selector-selected');
            this.catsEl = rootEl.querySelector('.tag-selector-categories');
            this.statusEl = rootEl.querySelector('.tag-selector-status');
            this.allTags = [];
            this.byId = new Map();
            this.categories = [];     // 統合済みカテゴリ
            this.catMap = new Map();
            this.selectedIds = new Set();
            this.searchQuery = '';
        }

        async load() {
            // カテゴリ（seed + custom + 編集差分・削除反映）
            if (typeof loadMergedTagCategories === 'function') {
                this.categories = await loadMergedTagCategories();
            } else {
                this.categories = (typeof TAG_CATEGORIES !== 'undefined' ? TAG_CATEGORIES : []).slice();
            }
            this.catMap = new Map(this.categories.map(c => [c.key, c]));
            // タグ
            this.allTags = await loadAllTagsUnified();
            this.byId = new Map(this.allTags.map(t => [t.id, t]));
            this.bindEvents();
            this.render();
        }

        bindEvents() {
            this.searchEl?.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.trim().toLowerCase();
                this.renderCats();
            });
        }

        setSelected(ids) {
            this.selectedIds = new Set((ids || []).filter(id => this.byId.has(id)));
            this.render();
        }

        getSelected() {
            // 並び順を維持するため Array に
            return Array.from(this.selectedIds);
        }

        toggle(id) {
            if (this.selectedIds.has(id)) {
                this.selectedIds.delete(id);
            } else {
                if (this.selectedIds.size >= this.max) {
                    this._flashStatus(`最大${this.max}つまでです`);
                    return;
                }
                this.selectedIds.add(id);
            }
            this.render();
        }

        validate() {
            // 必須カテゴリのチェック（例：ジャンル必須）
            for (const cat of this.requiredCats) {
                const has = Array.from(this.selectedIds)
                    .some(id => this.byId.get(id)?.category === cat);
                if (!has) {
                    const catName = this.catMap.get(cat)?.name
                        || TAG_CATEGORY_MAP?.[cat]?.name
                        || cat;
                    return { ok: false, message: `「${catName}」のタグを1つ以上選択してください` };
                }
            }
            return { ok: true };
        }

        // 推奨カテゴリ警告（必須ではないので true 返す。UI に注意マークを表示する程度）
        getRecommendationStatus() {
            const missing = [];
            for (const cat of this.recommendedCats) {
                const has = Array.from(this.selectedIds)
                    .some(id => this.byId.get(id)?.category === cat);
                if (!has) missing.push(cat);
            }
            return { missing };
        }

        // ── 描画 ─────────────────────────────────────
        render() {
            this.renderSelected();
            this.renderCats();
            this.renderStatus();
        }

        renderSelected() {
            const items = Array.from(this.selectedIds)
                .map(id => this.byId.get(id))
                .filter(Boolean);
            this.selectedListEl.innerHTML = items.map(t => {
                const color = t.color || this.catMap.get(t.category)?.color || '#888';
                return `<button type="button" class="tag-chip" style="--tag-color:${color}" data-id="${escapeHtml(t.id)}">
                    <span class="tag-chip-name">${escapeHtml(t.name)}</span>
                    <span class="tag-chip-x" aria-hidden="true">×</span>
                </button>`;
            }).join('');
            this.selectedListEl.querySelectorAll('.tag-chip').forEach(chip => {
                chip.addEventListener('click', () => this.toggle(chip.dataset.id));
            });
        }

        renderCats() {
            const cats = this.categories;
            const filtered = this.searchQuery
                ? this.allTags.filter(t => t.name.toLowerCase().includes(this.searchQuery))
                : this.allTags;
            const byCat = {};
            for (const c of cats) byCat[c.key] = [];
            for (const t of filtered) if (byCat[t.category]) byCat[t.category].push(t);

            this.catsEl.innerHTML = cats.map(cat => {
                const items = byCat[cat.key] || [];
                if (this.searchQuery && items.length === 0) return '';
                const isRequired = this.requiredCats.includes(cat.key);
                const isRecommended = this.recommendedCats.includes(cat.key);
                return `<div class="tag-selector-cat">
                    <div class="tag-selector-cat-title">
                        <span style="width:10px;height:10px;border-radius:50%;background:${cat.color};display:inline-block;"></span>
                        <span>${escapeHtml(cat.name)}</span>
                        ${isRequired ? '<span class="tag-selector-cat-required">必須</span>' : ''}
                        ${isRecommended ? '<span class="tag-selector-cat-recommend">推奨</span>' : ''}
                    </div>
                    <div class="tag-selector-pills">
                        ${items.length === 0
                            ? '<span style="color:var(--text-muted);font-size:0.78rem;">タグがありません</span>'
                            : items.map(t => this._renderPick(t)).join('')
                        }
                    </div>
                </div>`;
            }).join('') || '<p style="color:var(--text-muted);font-size:0.85rem;padding:8px;">該当するタグがありません</p>';

            this.catsEl.querySelectorAll('.tag-pick').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (btn.classList.contains('is-disabled')) return;
                    this.toggle(btn.dataset.id);
                });
            });
        }

        _renderPick(t) {
            const color = t.color || this.catMap.get(t.category)?.color || '#888';
            const selected = this.selectedIds.has(t.id);
            const disabled = !selected && this.selectedIds.size >= this.max;
            const cls = ['tag-pick'];
            if (selected) cls.push('is-selected');
            if (disabled) cls.push('is-disabled');
            return `<button type="button" class="${cls.join(' ')}" style="--tag-color:${color}" data-id="${escapeHtml(t.id)}">
                ${escapeHtml(t.name)}
            </button>`;
        }

        renderStatus() {
            if (!this.statusEl) return;
            const n = this.selectedIds.size;
            this.statusEl.textContent = `${n} / ${this.max}`;
            this.statusEl.classList.toggle('is-warn', n >= this.max);

            // 推奨警告
            const rec = this.getRecommendationStatus();
            if (rec.missing.length) {
                const names = rec.missing.map(k => this.catMap.get(k)?.name || TAG_CATEGORY_MAP?.[k]?.name || k).join('・');
                this.statusEl.textContent += `（${names}があると◎）`;
            }
        }

        _flashStatus(msg) {
            if (!this.statusEl) return;
            const orig = this.statusEl.textContent;
            this.statusEl.textContent = msg;
            this.statusEl.classList.add('is-warn');
            setTimeout(() => {
                this.statusEl.classList.remove('is-warn');
                this.renderStatus();
            }, 1500);
        }
    }

    async function mount(selectorOrEl) {
        const el = typeof selectorOrEl === 'string'
            ? document.querySelector(selectorOrEl)
            : selectorOrEl;
        if (!el) return null;
        const inst = new Selector(el);
        await inst.load();
        return inst;
    }

    window.TagSelector = { mount };
})();
