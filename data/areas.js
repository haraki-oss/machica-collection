/**
 * エリアマスターデータ
 * =====================================================
 * IDは固定で管理します。
 * name: 日本語名
 * name_en: 英語名
 * =====================================================
 */
const AREAS = [
    { id: 1, name: '旭川', name_en: 'Asahikawa' },
    { id: 2, name: '東京', name_en: 'Tokyo' },
    { id: 3, name: '金沢', name_en: 'Kanazawa' },
    { id: 4, name: '高山', name_en: 'Takayama' },
    { id: 5, name: '大阪', name_en: 'Osaka' },
    { id: 6, name: '京都', name_en: 'Kyoto' },
    { id: 7, name: '別府', name_en: 'Beppu' },
    { id: 99, name: '全国', name_en: 'Nationwide' }
];

/**
 * IDからエリア名を取得（言語指定可）
 */
function getAreaName(nameOrId, lang = 'ja') {
    // IDまたは名前で検索
    const area = getAllAreas().find(a => a.id == nameOrId || a.name === nameOrId);
    if (!area) return nameOrId; // 見つからない場合はそのまま返す
    return lang === 'en' ? area.name_en : area.name;
}

/**
 * 全エリアを取得（LocalStorageのカスタムエリアを含み、削除済みデータを除外）
 */
function getAllAreas() {
    // 1. 固定データ
    const defaultAreas = AREAS;

    // 2. 削除済みIDの読み込み
    let deletedIds = [];
    try {
        deletedIds = JSON.parse(localStorage.getItem('machica_deleted_area_ids') || '[]');
    } catch (e) { deletedIds = []; }

    // 3. LocalStorage のカスタムデータ
    let customAreas = [];
    try {
        customAreas = JSON.parse(localStorage.getItem('machica_custom_areas') || '[]');
    } catch (e) { customAreas = []; }

    // 削除済みを除外してマージ
    const filteredDefaults = defaultAreas.filter(a => !deletedIds.includes(a.id));

    // IDで重複排除（カスタムを優先）
    const customIds = new Set(customAreas.map(a => a.id));
    const combined = [...filteredDefaults.filter(a => !customIds.has(a.id)), ...customAreas];

    // IDの昇順で返す
    return combined.sort((a, b) => a.id - b.id);
}

// admin側JSとの互換性のためエイリアスを定義
const AREAS_DATA = AREAS;
