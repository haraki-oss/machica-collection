/**
 * machica Admin - Data Migration (localStorage to IndexedDB)
 */

async function migrateLocalStorageToIndexedDB() {
    const MIGRATION_KEY = 'machica_indexeddb_migrated';
    if (localStorage.getItem(MIGRATION_KEY)) return;

    console.log('Starting migration to IndexedDB...');

    try {
        // 1. 各データの取得
        const cards = JSON.parse(localStorage.getItem('spotcard_custom_cards') || '[]');
        const areas = JSON.parse(localStorage.getItem('machica_custom_areas') || '[]');
        const categories = JSON.parse(localStorage.getItem('machica_custom_categories') || '[]');

        // 削除済みIDなどの設定系
        const settings = [
            { id: 'deleted_area_ids', value: JSON.parse(localStorage.getItem('machica_deleted_area_ids') || '[]') },
            { id: 'deleted_category_ids', value: JSON.parse(localStorage.getItem('machica_deleted_category_ids') || '[]') },
            { id: 'edited_areas', value: JSON.parse(localStorage.getItem('machica_edited_areas') || '[]') }
        ];

        // 2. IndexedDB への保存
        if (cards.length > 0) await machicaDB.put('cards', cards);
        if (areas.length > 0) await machicaDB.put('areas', areas);
        if (categories.length > 0) await machicaDB.put('categories', categories);
        await machicaDB.put('settings', settings);

        // 3. 完了マーク
        localStorage.setItem(MIGRATION_KEY, 'true');
        console.log('Migration completed successfully.');

    } catch (error) {
        console.error('Migration failed:', error);
    }
}
