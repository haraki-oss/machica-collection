/**
 * タグマスターデータ
 * =====================================================
 * - 12 カテゴリ × 初期タグ群
 * - tag.id は安定した文字列キー（"<category-en>-<index>"）
 * - tag.color はカテゴリのデフォルト色を継承（個別オーバーライド可）
 * - 管理画面で追加されたタグは Supabase の `tags` テーブルに格納される
 *   （こちらのファイルの初期データは「コードに同梱」される常設マスタ）
 * =====================================================
 */

// カテゴリ定義（key は内部識別子・en 名、name は表示名、color はカテゴリ色）
const TAG_CATEGORIES = [
    { key: 'genre',     name: 'ジャンル',   color: '#FF6B6B' },
    { key: 'scene',     name: 'シーン',     color: '#4ECDC4' },
    { key: 'price',     name: '価格帯',     color: '#F2B705' },
    { key: 'feature',   name: '特徴',       color: '#6BCB77' },
    { key: 'space',     name: '空間',       color: '#8E9AAF' },
    { key: 'experience',name: '体験',       color: '#9B59B6' },
    { key: 'emotion',   name: '感情',       color: '#E0245E' },
    { key: 'story',     name: 'ストーリー', color: '#F39C12' },
    { key: 'action',    name: '行動',       color: '#3498DB' },
    { key: 'time',      name: '時間',       color: '#34495E' },
    { key: 'target',    name: 'ターゲット', color: '#E67E22' },
    { key: 'season',    name: '季節',       color: '#FF9FF3' }
];

// カテゴリ別の初期タグ名リスト
const _TAG_NAMES_BY_CATEGORY = {
    genre:      ['カフェ','レストラン','居酒屋','バー','和食','イタリアン','フレンチ','ラーメン','スイーツ','パン','観光','体験','ショッピング'],
    scene:      ['一人','デート','友人','家族','子連れ','朝','昼','夜','深夜','雨の日','晴れの日','散歩中','仕事帰り','休日'],
    price:      ['〜1000円','1000〜3000円','3000円以上','コスパ良し','高級'],
    feature:    ['駅近','空いている','混雑','予約可','テイクアウト','イートイン','Wi-Fiあり','コンセントあり','駐車場あり'],
    space:      ['おしゃれ','落ち着く','静か','にぎやか','開放的','隠れ家','レトロ','モダン','和風','ナチュラル'],
    experience: ['絶景','夜景','食べ歩き','散歩','写真映え','アート','文化体験','温泉','イベント','季節限定'],
    emotion:    ['癒される','ワクワク','楽しい','落ち着く','感動','非日常','心地よい','リラックス','元気になる'],
    story:      ['地元民おすすめ','スタッフ推し','常連が通う','穴場','知る人ぞ知る','昔ながら','新オープン','隠れスポット'],
    action:     ['朝活','昼休み','仕事帰り','散歩ついで','デート途中','観光ついで','雨の日でもOK','休憩','ちょい寄り'],
    time:       ['早朝営業','モーニング','ランチ','ディナー','深夜営業'],
    target:     ['カップル','女性向け','男性向け','学生','ファミリー','観光客','ビジネス利用'],
    season:     ['春','夏','秋','冬','花見','紅葉','イルミネーション']
};

// 平坦化された初期タグ配列
// id 形式: "<category-en>-<2桁ゼロパディングindex>"  例: "genre-01"
const TAGS_DATA = (() => {
    const list = [];
    for (const cat of TAG_CATEGORIES) {
        const names = _TAG_NAMES_BY_CATEGORY[cat.key] || [];
        names.forEach((name, i) => {
            list.push({
                id: `${cat.key}-${String(i + 1).padStart(2, '0')}`,
                name,
                category: cat.key,
                color: cat.color,
                is_seed: true   // 初期データから来たタグの目印（管理画面で削除する際に soft-delete 対応する）
            });
        });
    }
    return list;
})();

// カテゴリ key → 表示名 / 色 を引くヘルパ
const TAG_CATEGORY_MAP = TAG_CATEGORIES.reduce((acc, c) => { acc[c.key] = c; return acc; }, {});

// グローバル公開（vanilla 構成のため）
if (typeof window !== 'undefined') {
    window.TAG_CATEGORIES = TAG_CATEGORIES;
    window.TAGS_DATA = TAGS_DATA;
    window.TAG_CATEGORY_MAP = TAG_CATEGORY_MAP;
}
