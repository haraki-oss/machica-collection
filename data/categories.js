/**
 * カテゴリーマスターデータ
 * =====================================================
 * アイコンの変更方法:
 *   1. emoji: 絵文字アイコン（現在使用中）
 *   2. icon_url: 画像ファイルのパス（例: "icons/restaurant.png"）
 *      → icon_url を設定すると、emoji の代わりに画像が使われます
 *
 * 画像アイコンを使う場合:
 *   icon_url に画像パスを入力してください。
 *   例: icon_url: "icons/restaurant.png"
 * =====================================================
 */
const CATEGORIES = [
    {
        id: 1,
        name: "飲食店",
        name_en: "Restaurant",
        slug: "restaurant",
        emoji: "🍽️",
        icon_url: "",          // ← 画像アイコンのパスをここに設定
        color: "#FF6B6B",
        bg: "#FFF0F0",
    },
    {
        id: 2,
        name: "カフェ",
        name_en: "Cafe",
        slug: "cafe",
        emoji: "☕",
        icon_url: "",
        color: "#A0845C",
        bg: "#FFF8F0",
    },
    {
        id: 3,
        name: "地域食",
        name_en: "Local Food",
        slug: "local-food",
        emoji: "🌾",
        icon_url: "",
        color: "#5CAF6A",
        bg: "#F0FFF3",
    },
    {
        id: 4,
        name: "観光",
        name_en: "Sightseeing",
        slug: "sightseeing",
        emoji: "🗺️",
        icon_url: "",
        color: "#4A90D9",
        bg: "#F0F7FF",
    },
    {
        id: 5,
        name: "総合",
        name_en: "General",
        slug: "general",
        emoji: "🏪",
        icon_url: "",
        color: "#9B59B6",
        bg: "#F9F0FF",
    },
    {
        id: 6,
        name: "体験",
        name_en: "Experience",
        slug: "experience",
        emoji: "🎯",
        icon_url: "",
        color: "#E67E22",
        bg: "#FFF5E0",
    },
];

/**
 * 全カテゴリーを取得（LocalStorageのカスタムデータを含み、削除済みデータを除外）
 */
function getAllCategories() {
    // 1. 固定データ
    const defaultCategories = CATEGORIES;

    // 2. 削除済みIDの読み込み
    let deletedIds = [];
    try {
        deletedIds = JSON.parse(localStorage.getItem('machica_deleted_category_ids') || '[]');
    } catch (e) { deletedIds = []; }

    // 3. LocalStorage のカスタムデータ
    let customCategories = [];
    try {
        customCategories = JSON.parse(localStorage.getItem('machica_custom_categories') || '[]');
    } catch (e) { customCategories = []; }

    // 削除済みを除外してマージ
    const filteredDefaults = defaultCategories.filter(c => !deletedIds.includes(c.id));

    // IDで重複排除（カスタムを優先）
    const customIds = new Set(customCategories.map(c => c.id));
    const combined = [...filteredDefaults.filter(c => !customIds.has(c.id)), ...customCategories];

    // IDの昇順で返す
    return combined.sort((a, b) => a.id - b.id);
}

/**
 * IDからカテゴリーを取得
 */
function getCategoryById(id) {
    return getAllCategories().find((c) => c.id === id) || null;
}

/**
 * カテゴリーのアイコンHTMLを返す（画像 or 絵文字）
 */
function getCategoryIcon(category) {
    if (category.icon_url) {
        return `<img src="${category.icon_url}" alt="${category.name}" class="category-icon-img" />`;
    }
    return `<span class="category-icon-emoji">${category.emoji}</span>`;
}

// admin側JSとの互換性のためエイリアスを定義
const CATEGORIES_DATA = CATEGORIES;
