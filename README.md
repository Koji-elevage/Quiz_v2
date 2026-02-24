# Quiz_v2

授業連動型の日本語クイズアプリ（管理画面 + 学習者画面）です。

## 主な機能

- クイズ作成・編集・削除（管理画面）
- 学習者向けクイズ表示と回答フロー
- QRコード生成
- 画像アップロード / AI画像生成
- 学習ログの保存と閲覧

## セットアップ

```bash
npm install
cp .env.example .env.local
```

`.env.local` に最低限以下を設定してください。

```env
ADMIN_TOKEN=your-strong-random-token
PORT=3000
```

Cloud SQL(MySQL)を使う場合は、以下も設定します。

```env
DB_DRIVER=mysql
CLOUD_SQL_CONNECTION_NAME=your-project:us-central1:quiz-v2-db
MYSQL_DB=quizv2
MYSQL_USER=quizapp
MYSQL_PASSWORD=your-password
```

AI機能を使う場合は、いずれかのAPIキーも設定します。

```env
GEMINI_API_KEY=...
# or
GOOGLE_API_KEY=...
# optional (Qwen)
DASHSCOPE_API_KEY=...
```

## 起動

```bash
npm run dev
```

- 学習者画面: `http://localhost:3000/`
- 管理画面: `http://localhost:3000/admin`
  - 初回アクセス時に管理者トークン入力が必要です
  - 共有リンク方式: `http://localhost:3000/admin?token=<ADMIN_TOKEN>` でも初回設定できます（入力を省略）

## セキュリティメモ

- 管理系APIは `Authorization: Bearer <ADMIN_TOKEN>` が必須です
- AI生成APIと画像アップロードAPIには簡易レート制限があります

## テスト

```bash
node --check server.js public/admin.js public/quiz.js
ADMIN_TOKEN=your-token node test_api.js
APP_URL=http://localhost:3000 ADMIN_TOKEN=your-token npm run test:e2e
```
