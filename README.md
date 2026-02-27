# Quiz_v2

授業連動型の日本語クイズアプリ（Teacher/User画面 + Student画面）です。

## 役割定義

- `Admin = Owner`: システム管理権限（ユーザー追加/削除）
- `Teacher = User`: クイズ作成・編集・配布を行う運用ユーザー
- `Student`: クイズ受験者

## 主な機能

- クイズ作成・編集・削除（管理画面）
- Student向けクイズ表示と回答フロー
- QRコード生成
- 画像アップロード / AI画像生成
- AIシステムプロンプトのYAML編集（管理画面）
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

Googleログイン認証を使う場合（推奨）は以下を設定してください。

```env
ADMIN_AUTH_MODE=google
ADMIN_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
ADMIN_GOOGLE_EMAILS=teacher1@example.com,teacher2@example.com
# optional
ADMIN_GOOGLE_DOMAIN=example.com
ADMIN_OWNER_EMAILS=kojitani3@gmail.com,okantani@gmail.com
```

補足:
- `ADMIN_OWNER_EMAILS` はLPの「教師追加」機能を使えるオーナーです。
- 既定値は `kojitani3@gmail.com,okantani@gmail.com` です。

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

接続拒否を避けるために、バックグラウンド常駐起動も使えます。

```bash
npm run dev:daemon
npm run dev:status
npm run dev:stop
```

## Nodeバージョン注意（重要）

- `better-sqlite3` を `12.6.2+` に更新済みで、`Node 24` を正式サポートしています。
- 依存更新後は再ビルドが必要な場合があります:

```bash
npm rebuild better-sqlite3
```

## 常駐運用（推奨）

`nohup` より `pm2` 監視を推奨します（再起動・状態確認が安定）。

```bash
npm run dev:pm2:start
npm run dev:pm2:status
npm run dev:pm2:logs
npm run dev:pm2:restart
npm run dev:pm2:stop
```

- Student画面: `http://localhost:3000/`
- Teacher/User画面: `http://localhost:3000/admin`
  - 初回アクセス時に管理者トークン入力が必要です
  - 共有リンク方式: `http://localhost:3000/admin?token=<ADMIN_TOKEN>` でも初回設定できます（入力を省略）
- Teacher/User・Admin/Owner ログイン導線: `http://localhost:3000/teacher-login`
  - Google認証後、Teacher/Userは`/admin`へ移動
  - Admin/Ownerは`/admin`または`/owner-admin`を選択

## AIシステムプロンプト編集（YAML）

- 管理画面の「AI設定」セクションで編集できます。
- `画像生成用` と `設問生成用` を切り替えて、それぞれ別のYAMLを保存できます。
- 保存後、次のAI生成リクエストから即時反映されます。
- YAMLは `type` と `template` が必須です。

## LPからのユーザー管理導線

- Teacher/User・Admin/Owner 入口はトップの「Teacher / User・Admin / Ownerはこちら」→`/teacher-login`です。
- Admin/Owner（`ADMIN_OWNER_EMAILS`）は`/owner-admin`でTeacher/Userメールを追加/削除できます。
- 追加されたTeacher/Userは `/admin` にログイン可能になります。

## Student識別の現状（V2）

- V2ではStudentの内部ID（`student_id` / `user_id`）は保持していません。
- 保存しているのは表示名`learnerName`（DB列: `quiz_logs.learner_name`）と、クイズ単位のプレイ統計です。
- V3で学習履歴を厳密管理する場合は、`students`テーブルと永続IDの導入を前提に設計してください。

## セキュリティメモ

- 管理系APIは `Authorization: Bearer <ADMIN_TOKEN>` が必須です
- `ADMIN_AUTH_MODE=google` の場合は Google IDトークン認証に切り替わります
- AI生成APIと画像アップロードAPIには簡易レート制限があります

## テスト

```bash
node --check server.js public/admin.js public/quiz.js
ADMIN_TOKEN=your-token node test_api.js
APP_URL=http://localhost:3000 ADMIN_TOKEN=your-token npm run test:e2e
```

## ローカルSQLiteから本番Cloudへ移行

ローカルで作成したクイズを本番環境へコピーするコマンドです。

```bash
APP_URL=https://quiz-v2-590826073638.us-central1.run.app \\
ADMIN_TOKEN=your-admin-token \\
npm run migrate:to-cloud
```

補足:
- 既定では同名タイトルはスキップされます（重複作成を避けるため）。
- `E2E Smoke` で始まるタイトルは既定で除外されます。
- これは**手動の一時移行用**です。通常のアプリ更新（Cloud Run再デプロイ）では実行しません。
- 今後の運用では、ユーザー作成データ保護のため、`migrate:to-cloud` は「明示的に必要なときだけ」実行してください。
