# Azure VM (B1s) + MySQL Flexible Server デプロイ手順（$0優先）

目的: `Azure for Students` の無料枠を最大限活用して、`Quiz_v2` を Azure へ移植する。

前提:
- OS: Ubuntu 22.04 LTS（推奨）
- 実行方式: VM + nginx(80/443) + Node(内部3000) + MySQL Flexible Server
- DB: `Azure Database for MySQL Flexible Server (Burstable)`
- 認証: Googleログイン（`ADMIN_AUTH_MODE=google`）

注意:
- 「完全に $0」を保証するものではありません。無料枠外になりやすい要因: 外向き通信、バックアップ/ログ増、ストレージ増、DNS/証明書運用。
- Container Apps は周辺課金が出やすいので、$0優先なら VM ルートが堅いです。

---

## 1. Azure 側で作るもの（Portal）

### 1) リソースグループ
- 例: `rg-quiz-v2`
- リージョン: 近い場所（例: `Japan East`）

### 2) VM (B1s)
- サイズ: `B1s`（無料枠 750h/月 に寄せる）
- OS: `Ubuntu Server 22.04 LTS`
- 認証: SSH 公開鍵
- ネットワーク: Public IP あり
- NSG (受信許可):
  - 22/tcp（SSH）
  - 80/tcp（HTTP）
  - 443/tcp（HTTPS; 使う場合）

### 3) MySQL Flexible Server (Burstable)
- Compute: Burstable 最小（無料枠に寄せる）
- Storage: 最小（無料枠に寄せる）
- ネットワーク:
  - VM から接続できるよう、MySQL 側のファイアウォールに VM の Public IP か VNet を許可
- DB:
  - DB名: `quizv2`（既定）
  - ユーザー: 任意（例: `quizapp`）

---

## 2. データ移行（GCP Cloud SQL → Azure MySQL）

推奨: `mysqldump` → `mysql` で取り込み。

1) GCP Cloud SQL から dump を作る
- `mysqldump` で `quizzes` / `prompt_configs` / `admin_users` / `user_feedback` / `quiz_logs` / `image_assets` を含める

2) Azure MySQL へ import
- 取り込み後に `SELECT COUNT(*)` などで件数チェック

補足:
- データが少ない間は「一度完全上書き」でもOK。運用中は差分移行が必要になります。

---

## 3. VM 上のセットアップ（SSH）

このリポジトリには、Ubuntu向けのセットアップスクリプトを用意しています。

- `scripts/azure-vm/bootstrap-ubuntu.sh`
  - OSパッケージ、Node.js、nginx、pm2 をセットアップ
- `scripts/azure-vm/deploy-app.sh`
  - リポジトリを取得し、`.env.production` を読み込んで起動

### 3.1 最初の1回（OSセットアップ）

VM に SSH してから:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/Koji-elevage/Quiz_v2.git
cd Quiz_v2
bash scripts/azure-vm/bootstrap-ubuntu.sh
```

### 3.2 アプリ用の環境変数ファイルを用意

VM 上で `Quiz_v2/.env.production` を作成（値は自分の環境に合わせる）:

```bash
DB_DRIVER=mysql
MYSQL_HOST=<azure-mysql-hostname>
MYSQL_PORT=3306
MYSQL_DB=quizv2
MYSQL_USER=<mysql-user>
MYSQL_PASSWORD=<mysql-password>

ADMIN_AUTH_MODE=google
ADMIN_GOOGLE_CLIENT_ID=<google-client-id>
ADMIN_OWNER_EMAILS=kojitani3@gmail.com,okantani@gmail.com

# 画像/設問生成を使う場合
GEMINI_API_KEY=<key>
DASHSCOPE_API_KEY=<key>

# アプリ署名に使う（未設定なら ADMIN_TOKEN にフォールバック）
ADMIN_SESSION_SECRET=<random-long-secret>
```

### 3.3 デプロイ（取得→起動）

```bash
cd ~/Quiz_v2
bash scripts/azure-vm/deploy-app.sh
```

---

## 4. nginx（HTTP/HTTPS）

この手順では Node は `127.0.0.1:3000` で待受し、外部は nginx が `80/443` を受けます。

設定ファイルはスクリプトが投入します:
- `/etc/nginx/sites-available/quiz-v2.conf`

HTTPS を使う場合:
- ドメインを用意して A レコードを VM の Public IP に向ける
- `certbot` か `caddy` で Let’s Encrypt を設定

---

## 5. Google OAuth の設定（重要）

Google OAuth の「承認済みの JavaScript 生成元」に以下を追加:
- `https://<your-domain>`（推奨）
- `http://<vm-public-ip>`（HTTP運用なら）

nginx で 80/443 を受けるので、ポート付き生成元は不要にできます。

---

## 6. 動作確認チェック

- 学習者:
  - `GET /` 表示
  - `GET /quiz/<id>` 開始できる
- 教師:
  - `GET /teacher-login` で Googleログイン
  - `/admin` に入れる
- 管理者:
  - Owner のみ `/owner-admin` に入れる
  - フィードバック一覧が見える
- DB:
  - `quizzes` 保存・読み出し
  - `prompt_configs` 取得・更新

