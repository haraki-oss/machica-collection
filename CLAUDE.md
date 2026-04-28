# machica プロジェクト引き継ぎ書 (AI Context)

このドキュメントは、Claude Code や Cursor などの AI コーディングエージェントが、本プロジェクト「machica」の構造と文脈を即座に理解し、シームレスに開発を引き継ぐためのコンテキストガイドです。AI はファイル変更や新機能追加の前に必ずこのファイルに目を通してください。

---

## 1. プロジェクト概要
**machica（マチカ）** は、地域の飲食店、カフェ、観光地、体験スポットなどをデジタル「コレクションカード」として集め、管理し、探すことができるポータルWebアプリケーションです。

## 2. 技術スタック・アーキテクチャ
本プロジェクトは、Node.js や React などのモダンフレームワーク・ビルドツールを**使用せず**、ブラウザネイティブな技術のみで構築された「Standalone (Vanilla)」構成です。

- **フロントエンド**: HTML5, Vanilla JavaScript (ES2020+), CSS3 (Vanilla CSS)
- **データベース**: IndexedDB (ブラウザローカルストレージ・`admin/db.js` にてラッパー実装)
- **外部 API連携**:
  - Google Maps API: 座標・マップ表示、ルート検索
  - Tesseract.js: 写真(OCR)からのスポット情報自動読み取り
- **インフラ/ホスティング**: Vercel (GitHub 連携による自動デプロイ)

> **⚠️ 最重要コンテキスト (データベース仕様)**: 
> 現在、マスタデータ（カード、エリア、カテゴリ）はすべて**クライアントのブラウザ（IndexedDB）**に保存されています。Vercel に公開されていますが、バックエンド（サーバーサイド DB）は未実装のため、ユーザーがスマホで追加したカードをPCで見ることはできません。今後のフェーズで Supabase または Firebase への移行が検討されています。

---

## 3. ディレクトリ構成

```text
machica/
├── index.html          # 公開ポータルのメイン画面（カード一覧・検索・詳細モーダル）
├── map.html            # 地図用画面
├── styles.css          # 全体・公開画面のスタイル定義
├── app.js              # 公開ポータルのメインロジック (DOM操作、検索、IndexedDB読み込み)
├── map-app.js          # 地図画面のロジック
├── admin/              # 管理者用画面・機能
│   ├── index.html      # 管理ダッシュボード
│   ├── cards.html / cards-new.html / cards-edit.html # カード管理 (CRUD)
│   ├── cards-scan.html # 新機能: カード画像からのOCR自動入力
│   ├── areas.html / categories.html # エリア、ジャンルのマスタ管理
│   ├── db.js           # [重要] IndexedDBの非同期ラッパー (machicaDBオブジェクト)
│   ├── migration.js    # [重要] 旧 LocalStorage からのデータ移行スクリプト
│   ├── image-utils.js  # 画像圧縮処理 (Canvas利用)
│   └── admin.css / admin-modal.css # 管理画面用スタイル
├── data/               # 初期設定用モックデータ (初回起動時にIndexedDBへ投入)
│   ├── cards.js / areas.js / categories.js
└── CLAUDE.md           # 本ファイル
```

---

## 4. 主な機能と仕様

### 公開ポータル (`index.html`, `app.js`)
- **カードの表示**: Masonry風グリッド表示。カードには「表面 (image_url)」と「裏面 (back_image_url)」の概念がある。
- **モーダル**: カードクリックで詳細表示。Google Mapsの動的埋め込み、画像のフリップ（表・裏 切り替え）。
- **多言語対応**: 日本語 (`ja`) と 英語 (`en`) の切り替え。英語用データ (`title_en`, `description_en`) が空の場合は MyMemory API による動的自動翻訳（フォールバック）が走る仕様になっている。

### 管理画面 (`admin/`)
- **画像の取り扱い**: アップロードされた写真は `admin/image-utils.js` によってリサイズとWebP圧縮が行われ、Base64/DataURL 形式で IndexedDB に保存される。
- **OCRスキャン (`cards-scan.html`)**: Tesseract.js (ブラウザ用) をオンデマンドで読み込み、日本語言語モデル (`jpn`) で画像を解析。正規表現でスポット名、住所、経度・緯度を抽出し、入力フォームに自動反映させる。

---

## 5. 最近のアップデート履歴 (2026年4月)
1. **IndexedDB化**: Base64画像による LocalStorage の容量制限(5MB) を回避するため、データ保存基盤を IndexedDB へリファクタリング完了 (`admin/db.js`)。
2. **OCR連動**: `cards-scan.html` で画像から直接テキスト・位置情報を抽出できる「スキャン機能」を追加。
3. **リファクタと公開準備**: `.gemini` 内部の作業フォルダから通常フォルダへ移動させ、GitHub Desktop 経由で GitHub (`haraki-oss/machica-collection`) へプッシュし、Vercel へデプロイを完了。

---

## 6. AI への指示・ガイドライン
新しい変更（特に機能追加など）を行う際、以下の点に注意して提案・実装してください：

1. **Vanilla制約の維持**: npm (`package.json`)、webpack/Vite、Babel、React 等のモダンツール・フレームワークを勝手に導入しないでください。CDN経由でのライブラリ追加 (`<script src="https://...">`) は許可されます。
2. **デザインのトンマナ維持**: Vanilla CSS でリッチな UI（Glassmorphism、ホバー時のマイクロインタラクションなど）が実装されています。新要素のデザインは既存の `styles.css` または `admin.css` のトーン＆マナーに必ず合わせてください。
3. **バックエンド非依存の維持**: バックエンド実装（Supabase等）の指示が出ない限りは、データのCRUDはすべて `admin/db.js` (`machicaDB`) を通じてローカルブラウザ上で行うこと。
