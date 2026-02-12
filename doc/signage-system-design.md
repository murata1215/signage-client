# デジタルサイネージ投影システム 設計書

## 1. システム概要

### 1.1 目的
本部から一括管理可能なデジタルサイネージシステムを構築する。各営業所に設置されたクライアント端末が、本部指定および営業所個別指定のコンテンツを順次投影する。

### 1.2 システム構成概要

```
┌─────────────────────────────────────────────────┐
│                  サーバー端末                      │
│  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Webサーバー   │  │  クライアント（投影）      │  │
│  │  (管理画面)    │  │  Chromium キオスクモード   │  │
│  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────┘
         │  HTTP API
         ├──────────────────┐
         │                  │
   ┌─────┴─────┐     ┌─────┴─────┐
   │ クライアント │     │ クライアント │  × 10〜50台
   │  営業所A    │     │  営業所B    │
   └───────────┘     └───────────┘
```

### 1.3 基本動作フロー

1. 管理者/本部権限者が管理画面からコンテンツとスケジュールを設定
2. クライアントが定期ポーリングでスケジュールを取得
3. PDF・Webコンテンツをダウンロード/キャッシュ
4. 本部指定コンテンツ → 営業所個別コンテンツの順に再生
5. 全コンテンツ再生後、先頭に戻りループ再生
6. 全体再生時間外はブラックスクリーン or 待機画面を表示

---

## 2. 技術スタック

### 2.1 選定方針
- Ubuntu 24 素の状態から最小限のインストールで動作
- Claude Codeでの開発に適したシンプルな構成
- 依存関係を少なく、運用しやすい構成

### 2.2 技術スタック一覧

| レイヤー | 技術 | 理由 |
|---------|------|------|
| **ランタイム** | Node.js 20 LTS | Ubuntu 24で `apt` 導入可能。フロント・バックエンド統一 |
| **Webフレームワーク** | Express.js | 軽量・シンプル。API + 静的ファイル配信 |
| **データベース** | SQLite3 | ファイル1つで完結。インストール不要に近い |
| **フロントエンド（管理画面）** | vanilla HTML/CSS/JS | ビルド不要。Claude Codeと相性良好 |
| **フロントエンド（投影画面）** | vanilla HTML/CSS/JS | 同上。Chromiumキオスクモードで動作 |
| **PDF表示** | PDF.js (Mozilla) | ブラウザ内PDF描画のデファクト。CDNまたはローカル配置 |
| **認証** | express-session + bcrypt | シンプルなセッション認証 |
| **プロセス管理** | systemd | OS標準。自動起動・再起動 |
| **ブラウザ（クライアント）** | Google Chrome キオスクモード | deb版で導入。snap不要で社内プロキシ環境に対応 |

### 2.3 初期セットアップに必要なパッケージ

```bash
# Node.js & ビルドツール & SQLiteコマンドラインツール
sudo apt update
sudo apt install -y nodejs npm build-essential sqlite3

# Google Chrome（deb版。snap不要）
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt -f install -y

# npmプロキシ設定（社内プロキシ環境の場合）
npm config set proxy http://210.175.128.100:8080
npm config set https-proxy http://210.175.128.100:8080
```

### 2.4 npmパッケージ（予定）

```json
{
  "dependencies": {
    "express": "^4.x",
    "better-sqlite3": "^11.x",
    "express-session": "^1.x",
    "bcrypt": "^5.x",
    "multer": "^1.x",
    "node-cron": "^3.x"
  }
}
```

---

## 3. データベース設計

### 3.1 ER図

```
users ──┐
        │
offices ─┤──── clients
        │        │
        │    client_contents
        │
schedules
   │
schedule_contents ──── contents
```

### 3.2 テーブル定義

#### users（ユーザー）
| カラム | 型 | 説明 |
|-------|-----|------|
| id | INTEGER PK | 自動採番 |
| username | TEXT UNIQUE | ログインID |
| password_hash | TEXT | bcryptハッシュ |
| display_name | TEXT | 表示名 |
| role | TEXT | `admin` / `hq` / `branch` |
| office_id | INTEGER NULL | 営業所権限者の場合、所属営業所ID |
| created_at | DATETIME | 作成日時 |
| updated_at | DATETIME | 更新日時 |

#### offices（営業所）
| カラム | 型 | 説明 |
|-------|-----|------|
| id | INTEGER PK | 自動採番 |
| name | TEXT | 営業所名 |
| code | TEXT UNIQUE | 営業所コード（識別子） |
| created_at | DATETIME | 作成日時 |

#### clients（クライアント端末）
| カラム | 型 | 説明 |
|-------|-----|------|
| id | INTEGER PK | 自動採番 |
| name | TEXT | 端末名（例：「名古屋営業所 受付」） |
| client_key | TEXT UNIQUE | 端末識別キー（自動生成UUID） |
| office_id | INTEGER FK | 所属営業所 |
| is_active | BOOLEAN | 有効/無効 |
| last_seen_at | DATETIME | 最終ポーリング日時 |
| created_at | DATETIME | 作成日時 |

#### contents（コンテンツ）
| カラム | 型 | 説明 |
|-------|-----|------|
| id | INTEGER PK | 自動採番 |
| name | TEXT | コンテンツ名 |
| type | TEXT | `pdf` / `web` |
| url | TEXT NULL | Webコンテンツの場合のURL |
| file_path | TEXT NULL | PDFの場合のサーバー上パス |
| pdf_page_duration | INTEGER NULL | PDF各ページの表示秒数（デフォルト10秒） |
| use_proxy | BOOLEAN | プロキシ使用有無 |
| proxy_url | TEXT NULL | 使用するプロキシURL |
| created_at | DATETIME | 作成日時 |
| updated_at | DATETIME | 更新日時 |

#### schedules（スケジュール）
| カラム | 型 | 説明 |
|-------|-----|------|
| id | INTEGER PK | 自動採番 |
| scope | TEXT | `global`（本部） / `client`（個別） |
| client_id | INTEGER NULL | 個別の場合のクライアントID |
| play_start_time | TEXT | 再生開始時刻（例：`07:00`） |
| play_end_time | TEXT | 再生終了時刻（例：`20:00`） |
| is_active | BOOLEAN | 有効/無効 |
| version | INTEGER | バージョン番号（更新検知用） |
| updated_at | DATETIME | 更新日時 |

#### schedule_contents（スケジュール内コンテンツ）
| カラム | 型 | 説明 |
|-------|-----|------|
| id | INTEGER PK | 自動採番 |
| schedule_id | INTEGER FK | スケジュールID |
| content_id | INTEGER FK | コンテンツID |
| display_order | INTEGER | 表示順序 |
| duration_seconds | INTEGER | 表示時間（秒）。Webコンテンツの場合のページ全体表示時間 |

---

## 4. API設計

### 4.1 認証API

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/auth/login` | ログイン |
| POST | `/api/auth/logout` | ログアウト |
| GET | `/api/auth/me` | 現在のユーザー情報取得 |

### 4.2 ユーザー管理API（admin権限）

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/users` | ユーザー一覧 |
| POST | `/api/users` | ユーザー作成（role, office_id指定） |
| PUT | `/api/users/:id` | ユーザー更新 |
| DELETE | `/api/users/:id` | ユーザー削除 |

### 4.3 営業所管理API（admin権限）

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/offices` | 営業所一覧 |
| POST | `/api/offices` | 営業所追加 |
| PUT | `/api/offices/:id` | 営業所更新 |
| DELETE | `/api/offices/:id` | 営業所削除 |

### 4.4 クライアント端末管理API

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/clients` | 端末一覧（権限に応じてフィルタ） |
| POST | `/api/clients` | 端末登録 |
| PUT | `/api/clients/:id` | 端末更新 |
| DELETE | `/api/clients/:id` | 端末削除 |

### 4.5 コンテンツ管理API

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/contents` | コンテンツ一覧 |
| POST | `/api/contents` | コンテンツ登録（PDFアップロード or Web URL） |
| PUT | `/api/contents/:id` | コンテンツ更新 |
| DELETE | `/api/contents/:id` | コンテンツ削除 |
| GET | `/api/contents/:id/file` | PDFファイルダウンロード |

### 4.6 スケジュール管理API

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/schedules/global` | 本部スケジュール取得 |
| PUT | `/api/schedules/global` | 本部スケジュール更新（hq/admin権限） |
| GET | `/api/schedules/client/:clientId` | 個別スケジュール取得 |
| PUT | `/api/schedules/client/:clientId` | 個別スケジュール更新 |

### 4.7 クライアント端末用API（端末認証はclient_keyで行う）

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/player/schedule?key={client_key}` | 統合スケジュール取得（本部＋個別） |
| GET | `/api/player/content/:id/file?key={client_key}` | PDFダウンロード |
| POST | `/api/player/heartbeat?key={client_key}` | 死活監視（last_seen_at更新） |

#### `/api/player/schedule` レスポンス例

```json
{
  "version": 5,
  "play_start_time": "07:00",
  "play_end_time": "20:00",
  "playlist": [
    {
      "id": 1,
      "scope": "global",
      "content_id": 10,
      "name": "全社お知らせ",
      "type": "pdf",
      "file_url": "/api/player/content/10/file?key=xxx",
      "pdf_page_duration": 10,
      "duration_seconds": 60,
      "display_order": 1,
      "use_proxy": false,
      "proxy_url": null
    },
    {
      "id": 2,
      "scope": "global",
      "content_id": 11,
      "name": "社内ポータル",
      "type": "web",
      "url": "https://portal.example.com/news",
      "duration_seconds": 30,
      "display_order": 2,
      "use_proxy": false,
      "proxy_url": null
    },
    {
      "id": 3,
      "scope": "client",
      "content_id": 20,
      "name": "名古屋営業所 案内",
      "type": "pdf",
      "file_url": "/api/player/content/20/file?key=xxx",
      "pdf_page_duration": 8,
      "duration_seconds": 40,
      "display_order": 1,
      "use_proxy": false,
      "proxy_url": null
    }
  ]
}
```

---

## 5. 画面設計

### 5.1 画面一覧

| 画面 | パス | 対象ユーザー | 説明 |
|------|------|------------|------|
| ログイン | `/admin/login` | 全ユーザー | ログイン画面 |
| ダッシュボード | `/admin/` | 全ユーザー | 概要。端末稼働状況一覧 |
| ユーザー管理 | `/admin/users` | admin | ユーザーCRUD |
| 営業所管理 | `/admin/offices` | admin | 営業所CRUD |
| 端末管理 | `/admin/clients` | admin, hq, branch※ | 端末CRUD。branch は自営業所のみ |
| コンテンツ管理 | `/admin/contents` | admin, hq, branch | PDF アップロード、Web URL 登録 |
| 本部スケジュール | `/admin/schedule/global` | admin, hq | 全体スケジュール設定 |
| 個別スケジュール | `/admin/schedule/client/:id` | admin, hq, branch※ | 端末別スケジュール設定 |
| 投影画面 | `/player?key={client_key}` | — | クライアント端末用投影画面 |

### 5.2 管理画面ワイヤーフレーム概要

#### ダッシュボード
```
┌─────────────────────────────────────────┐
│  [ロゴ]  サイネージ管理   [ユーザー名▼] │
├────────┬────────────────────────────────┤
│ メニュー │  端末稼働状況                  │
│         │  ┌─────┬──────┬──────┬─────┐ │
│ ダッシュ │  │端末名│営業所 │状態   │最終通信│ │
│ ユーザー │  ├─────┼──────┼──────┼─────┤ │
│ 営業所   │  │受付A │名古屋 │● 稼働 │1分前  │ │
│ 端末    │  │受付B │東京  │● 稼働 │2分前  │ │
│ コンテンツ│  │会議室 │大阪  │○ 停止 │3時間前│ │
│ スケジュール│  └─────┴──────┴──────┴─────┘ │
└────────┴────────────────────────────────┘
```

#### スケジュール設定画面
```
┌──────────────────────────────────────────┐
│  本部スケジュール設定                      │
│                                          │
│  再生時間帯: [07:00] 〜 [20:00]           │
│                                          │
│  コンテンツ一覧（ドラッグで順序変更）        │
│  ┌──┬──────────┬────┬──────┬─────┐      │
│  │順│コンテンツ名  │種別 │表示秒数 │操作  │      │
│  ├──┼──────────┼────┼──────┼─────┤      │
│  │1 │全社お知らせ  │PDF  │60秒   │[↑↓✕]│      │
│  │2 │社内ポータル  │Web  │30秒   │[↑↓✕]│      │
│  │3 │安全標語     │PDF  │45秒   │[↑↓✕]│      │
│  └──┴──────────┴────┴──────┴─────┘      │
│                                          │
│  [＋ コンテンツ追加]        [保存]         │
└──────────────────────────────────────────┘
```

### 5.3 投影画面（プレーヤー）

```
┌──────────────────────────────────────┐
│                                      │
│                                      │
│         コンテンツ全画面表示            │
│         （PDF or iframe）             │
│                                      │
│                                      │
│                                      │
│  ┌──────────────────────────────┐    │
│  │ [非表示] ステータスバー         │    │
│  │ 再生中: 全社お知らせ 2/5ページ  │    │
│  └──────────────────────────────┘    │
└──────────────────────────────────────┘
```

---

## 6. クライアント投影ロジック

### 6.1 再生フロー

```
起動
 │
 ├─ サーバーからスケジュール取得
 │   └─ 取得失敗 → キャッシュがあればキャッシュで再生 / なければ待機画面
 │
 ├─ PDFコンテンツをダウンロード & キャッシュ
 │
 ├─ 現在時刻が再生時間帯内か確認
 │   └─ 時間外 → 待機画面表示 → 1分ごとに時刻チェック
 │
 ├─ 再生開始
 │   ├─ 本部コンテンツを display_order 順に再生
 │   │   ├─ PDF: ページ単位でスライドショー（pdf_page_duration秒/ページ）
 │   │   │       合計 duration_seconds 経過またはページ終了で次へ
 │   │   └─ Web: iframe表示 → duration_seconds 経過で次へ
 │   │
 │   ├─ 営業所個別コンテンツを display_order 順に再生
 │   │   └─ 同上
 │   │
 │   └─ 全コンテンツ再生完了 → 先頭に戻りループ
 │
 └─ ポーリング（バックグラウンド）
     ├─ 60秒ごとにスケジュール version を確認
     ├─ version 変更検知 → 新スケジュール取得 & PDF再ダウンロード
     └─ heartbeat 送信（last_seen_at 更新）
```

### 6.2 Webコンテンツのプロキシ対応

```
コンテンツ表示時
 │
 ├─ use_proxy = false
 │   └─ 直接 iframe で URL を表示
 │
 └─ use_proxy = true
     └─ サーバー側プロキシエンドポイント経由で表示
         GET /api/player/proxy?url=xxx&key=yyy
         サーバーが対象URLを取得し、クライアントへ返却
```

### 6.3 キャッシュ戦略

- PDFファイルはブラウザの IndexedDB にキャッシュ
- スケジュール情報は localStorage にキャッシュ
- サーバー接続不可時はキャッシュから再生を継続
- version 番号でキャッシュの有効性を判定

---

## 7. 権限設計

### 7.1 ロール定義

| ロール | 説明 |
|-------|------|
| `admin` | 管理者。全機能にアクセス可能 |
| `hq` | 本部権限者。全体スケジュール・コンテンツ・全端末を管理 |
| `branch` | 営業所権限者。自営業所の端末・個別スケジュールのみ管理 |

### 7.2 権限マトリクス

| 機能 | admin | hq | branch |
|------|-------|----|--------|
| ユーザー管理 | ✅ | ❌ | ❌ |
| 営業所管理 | ✅ | ❌ | ❌ |
| 端末管理（全営業所） | ✅ | ✅ | ❌ |
| 端末管理（自営業所） | ✅ | ✅ | ✅ |
| コンテンツ登録 | ✅ | ✅ | ✅ |
| 本部スケジュール設定 | ✅ | ✅ | ❌ |
| 個別スケジュール設定（全端末） | ✅ | ✅ | ❌ |
| 個別スケジュール設定（自営業所端末） | ✅ | ✅ | ✅ |

---

## 8. ディレクトリ構成

```
signage-system/
├── package.json
├── server.js                  # エントリポイント
├── config.js                  # 設定ファイル
├── db/
│   ├── schema.sql             # テーブル定義
│   ├── seed.sql               # 初期データ（admin ユーザー等）
│   └── database.sqlite        # SQLiteデータベースファイル
├── routes/
│   ├── auth.js                # 認証API
│   ├── users.js               # ユーザー管理API
│   ├── offices.js             # 営業所管理API
│   ├── clients.js             # 端末管理API
│   ├── contents.js            # コンテンツ管理API
│   ├── schedules.js           # スケジュール管理API
│   └── player.js              # 投影端末用API
├── middleware/
│   ├── auth.js                # 認証ミドルウェア
│   └── rbac.js                # 権限チェックミドルウェア
├── uploads/                   # PDFアップロードディレクトリ
├── public/
│   ├── admin/                 # 管理画面
│   │   ├── index.html         # ダッシュボード
│   │   ├── login.html         # ログイン
│   │   ├── users.html         # ユーザー管理
│   │   ├── offices.html       # 営業所管理
│   │   ├── clients.html       # 端末管理
│   │   ├── contents.html      # コンテンツ管理
│   │   ├── schedule.html      # スケジュール設定
│   │   ├── css/
│   │   │   └── admin.css
│   │   └── js/
│   │       ├── api.js         # API通信共通
│   │       ├── auth.js        # 認証処理
│   │       └── *.js           # 各画面のJS
│   └── player/                # 投影画面
│       ├── index.html         # プレーヤーメイン
│       ├── css/
│       │   └── player.css
│       └── js/
│           ├── player.js      # 再生制御ロジック
│           ├── scheduler.js   # スケジュール管理
│           ├── pdf-viewer.js  # PDF表示（PDF.js利用）
│           ├── web-viewer.js  # Web表示（iframe制御）
│           └── cache.js       # キャッシュ管理
├── lib/
│   └── pdfjs/                 # PDF.js ライブラリ（ローカル配置）
└── scripts/
    ├── setup.sh               # 初期セットアップスクリプト
    └── start-kiosk.sh         # キオスクモード起動スクリプト
```

---

## 9. デプロイ・運用

### 9.1 サーバー起動

```bash
# systemd サービスファイル: /etc/systemd/system/signage-server.service
[Unit]
Description=Signage Server
After=network.target

[Service]
Type=simple
User=signage
WorkingDirectory=/opt/signage-system
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

### 9.2 クライアント端末起動（キオスクモード）

```bash
#!/bin/bash
# scripts/start-kiosk.sh
# 自動ログイン後に実行される想定

# 画面の電源管理を無効化
xset s off
xset -dpms
xset s noblank

# Google Chrome をキオスクモードで起動
google-chrome-stable \
  --kiosk \
  --no-first-run \
  --disable-translate \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --autoplay-policy=no-user-gesture-required \
  "http://{SERVER_IP}:3000/player?key={CLIENT_KEY}"
```

### 9.3 サーバー兼クライアント端末

サーバー端末は以下の2つを同時に実行する：
1. `signage-server.service` — Webサーバー
2. `signage-kiosk.service` — Google Chrome キオスクモード（`http://localhost:3000/player?key={CLIENT_KEY}`）

### 9.4 初期セットアップ手順

```bash
# 1. 必要パッケージのインストール
sudo apt update
sudo apt install -y nodejs npm build-essential sqlite3

# 2. Google Chrome インストール（snap不要のdeb版）
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
sudo apt -f install -y

# 3. npmプロキシ設定（社内プロキシ環境の場合）
npm config set proxy http://210.175.128.100:8080
npm config set https-proxy http://210.175.128.100:8080

# 4. アプリケーション配置
sudo mkdir -p /opt/signage-system
sudo cp -r . /opt/signage-system/
cd /opt/signage-system

# 5. 依存関係インストール
npm install --production

# 6. データベース初期化
node -e "require('./db/init.js')"

# 7. systemd サービス登録・起動
sudo cp scripts/signage-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable signage-server
sudo systemctl start signage-server

# 8. （クライアント端末の場合）キオスクモード設定
# 自動ログイン + start-kiosk.sh を自動起動に設定
```

---

## 10. セキュリティ考慮事項

| 項目 | 対策 |
|------|------|
| 管理画面認証 | セッションベース認証。bcryptによるパスワードハッシュ |
| 端末認証 | client_key（UUID）による簡易認証 |
| API権限制御 | ミドルウェアでロールベースアクセス制御 |
| ファイルアップロード | ファイルタイプ検証（PDFのみ）、サイズ制限 |
| XSS対策 | HTMLエスケープ、CSP ヘッダー設定 |
| CSRF対策 | セッショントークン検証 |

---

## 11. 将来の拡張候補

| 項目 | 説明 |
|------|------|
| 動画コンテンツ対応 | MP4等の動画ファイル再生 |
| 画像スライドショー | JPEG/PNG画像のスライドショー |
| WebSocket通知 | ポーリングからWebSocketへの移行（リアルタイム更新） |
| スケジュールカレンダー | 日付別スケジュール設定 |
| テンプレート機能 | よく使うスケジュール構成の保存・呼び出し |
| 端末モニタリング | スクリーンショット取得、再生ログ |
| 多言語対応 | 管理画面の多言語化 |

---

## 付録A: 設定ファイル

```javascript
// config.js
module.exports = {
  port: process.env.PORT || 3000,
  dbPath: './db/database.sqlite',
  uploadDir: './uploads',
  session: {
    secret: process.env.SESSION_SECRET || 'change-this-in-production',
    maxAge: 24 * 60 * 60 * 1000  // 24時間
  },
  polling: {
    intervalSeconds: 60  // クライアントポーリング間隔
  },
  defaults: {
    playStartTime: '07:00',
    playEndTime: '20:00',
    pdfPageDuration: 10,  // 秒
    webDuration: 30        // 秒
  }
};
```

---

## 付録B: 初期管理者アカウント

| 項目 | 値 |
|------|-----|
| ユーザー名 | `admin` |
| 初期パスワード | `admin`（初回ログイン時に変更を促す） |
| ロール | `admin` |
