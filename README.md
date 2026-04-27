# 🗾 machica - 地域を旅するコレクションカード・ポータル

地域のスポット情報をカードで集める・探す・行くことができるWebアプリケーションです。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

---

## 🌟 主な機能

- **カード一覧**: 登録されたスポットをカード形式で閲覧
- **詳細モーダル**: カードのクリックで詳細情報・地図・複数画像を表示
- **カードのフリップ**: 表面・裏面の2画像に対応
- **検索・フィルタ**: キーワード、ジャンル、エリアで絞り込み
- **多言語対応**: 日本語/英語の切り替え（英語データがない場合は自動翻訳）
- **地図連携**: Google Maps でスポット位置の確認・ルート検索
- **管理画面**: カード・エリア・カテゴリの追加・編集・削除
- **スキャン登録**: カード写真を撮影するとOCRで情報を自動抽出

---

## 📁 ディレクトリ構成

```
machica/
├── index.html          # メインページ（カード一覧）
├── map.html            # 地図ページ
├── styles.css          # メインスタイル
├── app.js              # メインアプリロジック
├── map-app.js          # 地図アプリロジック
├── admin/              # 管理者専用ページ群
│   ├── index.html      # 管理ダッシュボード
│   ├── cards.html      # カード管理
│   ├── cards-new.html  # カード新規登録
│   ├── cards-edit.html # カード編集
│   ├── cards-scan.html # スキャン登録
│   ├── areas.html      # エリア管理
│   ├── categories.html # カテゴリ管理
│   ├── db.js           # IndexedDB ラッパー
│   ├── migration.js    # データ移行スクリプト
│   └── image-utils.js  # 画像ユーティリティ
└── data/               # 初期データ（モックデータ）
    ├── cards.js
    ├── areas.js
    └── categories.js
```

---

## 🚀 ローカルでの起動方法

このアプリはサーバー不要でブラウザで直接開くことが可能ですが、  
IndexedDB や画像の読み込みの関係で **ローカルサーバー経由** での起動を推奨します。

### 方法1: PowerShell スクリプトを使う
```powershell
.\serve.ps1
```

### 方法2: VS Code の Live Server を使う
VSCode の「Live Server」拡張機能を使って `index.html` を開きます。

---

## 🛠️ 技術スタック

- **フロントエンド**: HTML5, Vanilla JavaScript (ES2020+), CSS3
- **データ保存**: IndexedDB（ブラウザローカル保存）
- **OCR**: Tesseract.js
- **地図**: Google Maps JavaScript API / Google Maps Embed
- **フォント**: Google Fonts（Noto Sans JP, Playfair Display）
- **ホスティング**: Vercel

---

## 📝 データについて

カードデータは各ユーザーのブラウザの **IndexedDB** に保存されます。  
異なるブラウザ・デバイス間でデータを共有するには、将来的に外部データベースとの連携が必要です。

---

## 📜 ライセンス

© 2026 machica. All rights reserved.
