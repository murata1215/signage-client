# signage-server 実装ガイド（引き渡しドキュメント）

## 1. プロジェクト全体像

### システム概要
企業向けデジタルサイネージ配信システム。本社から複数拠点（10〜50台）のディスプレイを一元管理する。

### 2つのプロジェクト構成

```
signage-client/     ← Electron クライアント（PoC 完了・動作確認済み）
signage-server/     ← Express.js サーバー（★ このプロジェクトで実装する）
```

### 通信フロー

```
┌─────────────────┐        HTTP API         ┌─────────────────────┐
│ signage-client   │ ◄────────────────────► │ signage-server       │
│ (Electron)       │  /api/player/schedule   │ (Express.js)         │
│                  │  /api/player/content    │                      │
│ BrowserView で   │  /api/player/heartbeat  │ SQLite3 DB           │
│ コンテンツ表示   │                         │ PDF アップロード     │
└─────────────────┘                         │ 管理画面 (HTML/JS)   │
                                            └─────────────────────┘
                    ┌──────────────────┐          ▲
                    │ 管理者ブラウザ    │──────────┘
                    │ (Chrome等)       │  /admin/*
                    └──────────────────┘
```

### Electron クライアント側の現状

**完成しているもの:**
- BrowserView によるコンテンツ表示（X-Frame-Options 回避）
- 2つの BrowserView を交互に使ったフェード切替（800ms）
- プロキシ設定（`session.setProxy()` でURL別に自動切替）
- ステータスバー（コンテンツ名 + カウントダウン）
- キオスク / 通常 / 開発モード

**サーバーAPIに期待していること:**
- `GET /api/player/schedule?key={client_key}` でプレイリストを取得
- `GET /api/player/content/:id/file?key={client_key}` で PDF をダウンロード
- `POST /api/player/heartbeat?key={client_key}` でハートビート送信
- クライアントは `lib/playlist.js` の `fetchPlaylistFromServer()` スタブを実装に置き換える

---

## 2. サーバー側 実装タスクリスト

### フェーズ1: 基盤

- [ ] プロジェクト初期化（`package.json`, `npm install`）
- [ ] `server.js`（Express エントリーポイント）
- [ ] `config.js`（設定値管理）
- [ ] DB スキーマ作成（`db/schema.sql`）
- [ ] DB 初期化スクリプト（`db/init.js`）
- [ ] 初期データ投入（`db/seed.sql` — admin ユーザー）
- [ ] 認証ミドルウェア（`middleware/auth.js`）
- [ ] RBAC ミドルウェア（`middleware/rbac.js`）

### フェーズ2: API

- [ ] 認証 API（`routes/auth.js` — login / logout / me）
- [ ] ユーザー管理 API（`routes/users.js` — CRUD）
- [ ] 拠点管理 API（`routes/offices.js` — CRUD）
- [ ] クライアント端末管理 API（`routes/clients.js` — CRUD）
- [ ] コンテンツ管理 API（`routes/contents.js` — CRUD + PDF アップロード）
- [ ] スケジュール管理 API（`routes/schedules.js` — 全社共通 + 拠点別）
- [ ] プレーヤー API（`routes/player.js` — スケジュール取得・コンテンツDL・ハートビート・プロキシ）

### フェーズ3: 管理画面

- [ ] ログイン画面（`public/admin/login.html`）
- [ ] ダッシュボード（`public/admin/index.html` — 端末稼働状況）
- [ ] ユーザー管理画面（`public/admin/users.html`）
- [ ] 拠点管理画面（`public/admin/offices.html`）
- [ ] 端末管理画面（`public/admin/clients.html`）
- [ ] コンテンツ管理画面（`public/admin/contents.html`）
- [ ] スケジュール編集画面（`public/admin/schedule.html`）
- [ ] 共通 API クライアント（`public/admin/js/api.js`）

### フェーズ4: デプロイ

- [ ] systemd サービスファイル作成
- [ ] セットアップスクリプト（`scripts/setup.sh`）
- [ ] 本番環境テスト

---

## 3. 技術スタック

| コンポーネント | 技術 | バージョン | 用途 |
|--------------|------|-----------|------|
| ランタイム | Node.js | 20 LTS | Ubuntu 24 apt 対応 |
| Web フレームワーク | Express.js | ^4.x | REST API + 静的ファイル配信 |
| データベース | better-sqlite3 | ^11.x | SQLite3 バインディング |
| 認証 | express-session | ^1.x | セッション管理 |
| パスワード | bcrypt | ^5.x | ハッシュ化 |
| ファイルアップロード | multer | ^1.x | PDF アップロード |
| スケジュール | node-cron | ^3.x | 定期タスク（将来用） |
| フロントエンド | Vanilla HTML/CSS/JS | — | ビルドツール不要 |

### package.json

```json
{
  "name": "signage-server",
  "version": "0.1.0",
  "description": "デジタルサイネージ管理サーバー",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "db:init": "node db/init.js"
  },
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

## 4. データベーススキーマ

### テーブル一覧

```
users ─────────────┐
                    │ office_id
offices ◄──────────┤
                    │ office_id
clients ◄──────────┘
    ▲
    │ client_id
schedules
    ▲
    │ schedule_id
schedule_contents
    │ content_id
    ▼
contents
```

### users

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | INTEGER | PK, AUTO INCREMENT | |
| username | TEXT | UNIQUE, NOT NULL | ログインID |
| password_hash | TEXT | NOT NULL | bcrypt ハッシュ |
| display_name | TEXT | NOT NULL | 表示名 |
| role | TEXT | NOT NULL | `'admin'` / `'hq'` / `'branch'` |
| office_id | INTEGER | FK → offices.id, NULL | branch の場合は必須 |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

### offices

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | INTEGER | PK, AUTO INCREMENT | |
| name | TEXT | NOT NULL | 拠点名（例: 名古屋営業所） |
| code | TEXT | UNIQUE, NOT NULL | 拠点コード（例: NGY） |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

### clients

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | INTEGER | PK, AUTO INCREMENT | |
| name | TEXT | NOT NULL | 端末名（例: 受付ディスプレイA） |
| client_key | TEXT | UNIQUE, NOT NULL | UUID（API認証用） |
| office_id | INTEGER | FK → offices.id, NOT NULL | 所属拠点 |
| is_active | BOOLEAN | DEFAULT 1 | 有効/無効 |
| last_seen_at | DATETIME | NULL | 最終通信日時 |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

### contents

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | INTEGER | PK, AUTO INCREMENT | |
| name | TEXT | NOT NULL | コンテンツ名 |
| type | TEXT | NOT NULL | `'pdf'` / `'web'` |
| url | TEXT | NULL | Web コンテンツの URL |
| file_path | TEXT | NULL | PDF ファイルのサーバー上パス |
| pdf_page_duration | INTEGER | NULL | PDF 1ページあたりの表示秒数（デフォルト: 10） |
| use_proxy | BOOLEAN | DEFAULT 0 | プロキシ使用フラグ |
| proxy_url | TEXT | NULL | プロキシ URL |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

### schedules

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | INTEGER | PK, AUTO INCREMENT | |
| scope | TEXT | NOT NULL | `'global'`（全社） / `'client'`（個別） |
| client_id | INTEGER | FK → clients.id, NULL | scope='client' の場合のみ |
| play_start_time | TEXT | NOT NULL | 再生開始時刻（例: `"07:00"`） |
| play_end_time | TEXT | NOT NULL | 再生終了時刻（例: `"20:00"`） |
| is_active | BOOLEAN | DEFAULT 1 | 有効/無効 |
| version | INTEGER | DEFAULT 1 | 変更検知用バージョン番号 |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | |

### schedule_contents

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | INTEGER | PK, AUTO INCREMENT | |
| schedule_id | INTEGER | FK → schedules.id, NOT NULL | |
| content_id | INTEGER | FK → contents.id, NOT NULL | |
| display_order | INTEGER | NOT NULL | 表示順（1, 2, 3...） |
| duration_seconds | INTEGER | NOT NULL | 表示時間（秒） |

---

## 5. 全 API エンドポイント

### 5.1 認証 API

| メソッド | パス | 認証 | リクエスト | レスポンス |
|---------|------|------|-----------|-----------|
| POST | `/api/auth/login` | 不要 | `{"username": "...", "password": "..."}` | `{"user": {id, username, display_name, role, office_id}}` |
| POST | `/api/auth/logout` | 必要 | — | `{"status": "ok"}` |
| GET | `/api/auth/me` | 必要 | — | `{"user": {id, username, display_name, role, office_id}}` |

### 5.2 ユーザー管理 API（admin のみ）

| メソッド | パス | リクエスト | レスポンス |
|---------|------|-----------|-----------|
| GET | `/api/users` | — | `{"users": [{id, username, display_name, role, office_id, created_at}]}` |
| POST | `/api/users` | `{username, password, display_name, role, office_id?}` | `{"user": {...}}` |
| PUT | `/api/users/:id` | `{display_name?, role?, office_id?}` | `{"user": {...}}` |
| DELETE | `/api/users/:id` | — | `{"status": "ok"}` |

### 5.3 拠点管理 API（admin のみ）

| メソッド | パス | リクエスト | レスポンス |
|---------|------|-----------|-----------|
| GET | `/api/offices` | — | `{"offices": [{id, name, code, created_at}]}` |
| POST | `/api/offices` | `{name, code}` | `{"office": {...}}` |
| PUT | `/api/offices/:id` | `{name?, code?}` | `{"office": {...}}` |
| DELETE | `/api/offices/:id` | — | `{"status": "ok"}` |

### 5.4 端末管理 API

| メソッド | パス | 権限 | リクエスト | レスポンス |
|---------|------|------|-----------|-----------|
| GET | `/api/clients` | admin/hq: 全件, branch: 自拠点のみ | — | `{"clients": [{id, name, client_key, office_id, is_active, last_seen_at, created_at}]}` |
| POST | `/api/clients` | admin/hq/branch（branch: 自拠点のみ） | `{name, office_id, is_active?}` | `{"client": {..., client_key: "UUID"}}` |
| PUT | `/api/clients/:id` | 同上 | `{name?, is_active?}` | `{"client": {...}}` |
| DELETE | `/api/clients/:id` | 同上 | — | `{"status": "ok"}` |

### 5.5 コンテンツ管理 API

| メソッド | パス | リクエスト | レスポンス |
|---------|------|-----------|-----------|
| GET | `/api/contents` | — | `{"contents": [{id, name, type, url?, file_path?, pdf_page_duration?, use_proxy, proxy_url?, created_at, updated_at}]}` |
| POST | `/api/contents` | Multipart: `{name, type, file?, url?, pdf_page_duration?, use_proxy, proxy_url?}` | `{"content": {...}}` |
| PUT | `/api/contents/:id` | `{name?, pdf_page_duration?, use_proxy?, proxy_url?}` | `{"content": {...}}` |
| DELETE | `/api/contents/:id` | — | `{"status": "ok"}` |
| GET | `/api/contents/:id/file` | — | PDF バイナリ |

**PDF アップロード仕様:**
- Multipart form data
- PDF のみ許可（MIME タイプ + 拡張子バリデーション）
- 保存先: `./uploads/`
- ファイル名: `{id}-{timestamp}-{originalname}` でリネーム

### 5.6 スケジュール管理 API

| メソッド | パス | 権限 | リクエスト | レスポンス |
|---------|------|------|-----------|-----------|
| GET | `/api/schedules/global` | admin/hq | — | `{"schedule": {id, scope, play_start_time, play_end_time, is_active, version, contents: [...]}}` |
| PUT | `/api/schedules/global` | admin/hq | `{play_start_time, play_end_time, is_active, contents: [{content_id, display_order, duration_seconds}]}` | `{"schedule": {..., version: (自動インクリメント)}}` |
| GET | `/api/schedules/client/:clientId` | admin/hq/branch（branch: 自拠点のみ） | — | 同上（scope="client"） |
| PUT | `/api/schedules/client/:clientId` | 同上 | 同上 | 同上 |

### 5.7 プレーヤー API（★ Electron クライアントが呼び出す）

**認証**: セッションではなく `client_key`（UUID）をクエリパラメータで送信

| メソッド | パス | パラメータ | レスポンス | 説明 |
|---------|------|-----------|-----------|------|
| GET | `/api/player/schedule` | `?key={client_key}` | 下記参照 | 全社 + 個別のマージ済みスケジュール |
| GET | `/api/player/content/:id/file` | `?key={client_key}` | PDF バイナリ | PDF ダウンロード |
| POST | `/api/player/heartbeat` | `?key={client_key}` | `{"status": "ok"}` | `last_seen_at` を更新 |
| GET | `/api/player/proxy` | `?url={target_url}&key={client_key}` | プロキシ先の HTML/JSON | サーバー側でURLをフェッチして返す |

**スケジュールレスポンス形式:**

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

**マージ順序**: global コンテンツ（display_order順） → client コンテンツ（display_order順）

---

## 6. RBAC（ロールベースアクセス制御）

### ロール定義

| ロール | 説明 | スコープ |
|--------|------|---------|
| `admin` | システム管理者。全機能にアクセス可能 | システム全体 |
| `hq` | 本部権限。全社スケジュール・全端末を管理 | システム全体 |
| `branch` | 拠点管理者。自拠点の端末・個別スケジュールのみ | 自拠点のみ |

### 権限マトリクス

| 機能 | admin | hq | branch |
|------|:-----:|:--:|:------:|
| ユーザー管理 | ✅ | ❌ | ❌ |
| 拠点管理 | ✅ | ❌ | ❌ |
| 端末管理（全拠点） | ✅ | ✅ | ❌ |
| 端末管理（自拠点） | ✅ | ✅ | ✅ |
| コンテンツ登録 | ✅ | ✅ | ✅ |
| 全社スケジュール設定 | ✅ | ✅ | ❌ |
| 個別スケジュール（全端末） | ✅ | ✅ | ❌ |
| 個別スケジュール（自拠点端末） | ✅ | ✅ | ✅ |
| ダッシュボード閲覧 | ✅ | ✅ | ✅ |

### ミドルウェア実装パターン

```javascript
// middleware/auth.js — セッション認証
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// middleware/rbac.js — ロール制限
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// 使用例
router.get('/api/users', requireAuth, requireRole('admin'), usersController.list);
```

---

## 7. 設定値・環境変数

### config.js

```javascript
module.exports = {
  port: process.env.PORT || 3000,
  dbPath: './db/database.sqlite',
  uploadDir: './uploads',

  session: {
    secret: process.env.SESSION_SECRET || 'change-this-in-production',
    maxAge: 86400000  // 24時間（ミリ秒）
  },

  polling: {
    intervalSeconds: 60  // クライアントのポーリング間隔
  },

  defaults: {
    playStartTime: '07:00',
    playEndTime: '20:00',
    pdfPageDuration: 10,   // PDF 1ページあたりの秒数
    webDuration: 30        // Web コンテンツの表示秒数
  }
};
```

### 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `PORT` | `3000` | サーバーポート |
| `NODE_ENV` | — | `production` で本番モード |
| `SESSION_SECRET` | `'change-this-in-production'` | セッション暗号化キー（本番は必ず変更） |

### npm install 時のプロキシ設定

社内ネットワークでは以下が必要:
```bash
HTTPS_PROXY=http://210.175.128.100:8080 HTTP_PROXY=http://210.175.128.100:8080 npm install
```

---

## 8. ディレクトリ構成

```
signage-server/
├── package.json
├── server.js                     # Express エントリーポイント
├── config.js                     # 設定値
├── db/
│   ├── schema.sql                # テーブル定義（DDL）
│   ├── seed.sql                  # 初期データ（admin ユーザー）
│   ├── init.js                   # DB 初期化スクリプト
│   └── database.sqlite           # SQLite ファイル（初回起動時に生成）
├── routes/
│   ├── auth.js                   # /api/auth/*
│   ├── users.js                  # /api/users/*
│   ├── offices.js                # /api/offices/*
│   ├── clients.js                # /api/clients/*
│   ├── contents.js               # /api/contents/*
│   ├── schedules.js              # /api/schedules/*
│   └── player.js                 # /api/player/*（Electron 用）
├── middleware/
│   ├── auth.js                   # セッション認証
│   └── rbac.js                   # ロールベースアクセス制御
├── uploads/                      # PDF ファイル保存先（要書き込み権限）
├── public/
│   └── admin/                    # 管理画面（静的ファイル）
│       ├── index.html            # ダッシュボード
│       ├── login.html            # ログイン
│       ├── users.html            # ユーザー管理
│       ├── offices.html          # 拠点管理
│       ├── clients.html          # 端末管理
│       ├── contents.html         # コンテンツ管理
│       ├── schedule.html         # スケジュール編集
│       ├── css/admin.css         # スタイル
│       └── js/
│           ├── api.js            # 共通 API クライアント
│           ├── auth.js           # 認証処理
│           └── *.js              # 各画面用 JS
├── lib/
│   └── pdfjs/                    # PDF.js ライブラリ（ローカル配置）
└── scripts/
    ├── setup.sh                  # 初期セットアップ
    └── signage-server.service    # systemd サービスファイル
```

---

## 9. 管理画面仕様

### 9.1 ログイン画面（`/admin/login`）

- ユーザー名・パスワード入力フォーム
- `POST /api/auth/login` を呼び出し
- 成功時: ダッシュボードにリダイレクト
- 失敗時: エラーメッセージ表示

### 9.2 ダッシュボード（`/admin/`）

端末稼働状況を一覧表示:

```
┌──────────┬──────────┬──────────┬──────────┐
│ 端末名   │ 営業所   │ 状態     │ 最終通信 │
├──────────┼──────────┼──────────┼──────────┤
│ 受付A    │ 名古屋   │ ● 稼働   │ 1分前    │
│ 受付B    │ 東京     │ ● 稼働   │ 2分前    │
│ 会議室   │ 大阪     │ ○ 停止   │ 3時間前  │
└──────────┴──────────┴──────────┴──────────┘
```

- 状態判定: `last_seen_at` が5分以内なら「稼働」、それ以外は「停止」
- branch ユーザーは自拠点の端末のみ表示

### 9.3 ユーザー管理（`/admin/users`）— admin のみ

- 一覧表示（ユーザー名、表示名、ロール、所属拠点）
- 新規作成フォーム
- 編集・削除

### 9.4 拠点管理（`/admin/offices`）— admin のみ

- 一覧表示（拠点名、コード）
- 新規作成・編集・削除

### 9.5 端末管理（`/admin/clients`）

- 一覧表示（端末名、client_key、拠点、有効/無効、最終通信）
- 新規作成時に UUID を自動生成
- branch は自拠点のみ

### 9.6 コンテンツ管理（`/admin/contents`）

- 一覧表示（コンテンツ名、種別、プロキシ）
- 新規登録フォーム:
  - 種別: PDF / Web URL（ラジオボタン）
  - PDF: ファイルアップロード（.pdf のみ）
  - Web: URL テキスト入力
  - PDF ページ表示秒数（デフォルト: 10）
  - プロキシ使用チェックボックス
- 編集・削除

### 9.7 スケジュール編集（`/admin/schedule`）

```
再生時間帯: [07:00] 〜 [20:00]

コンテンツ一覧（ドラッグで順序変更）
┌──┬──────────────────┬────┬────────┬────┐
│順│ コンテンツ名     │種別│表示秒数│操作│
├──┼──────────────────┼────┼────────┼────┤
│1 │ 全社お知らせ     │PDF │  60秒  │[↑↓✕]│
│2 │ 社内ポータル     │Web │  30秒  │[↑↓✕]│
│3 │ 安全標語         │PDF │  45秒  │[↑↓✕]│
└──┴──────────────────┴────┴────────┴────┘

[+ コンテンツ追加]  [保存]
```

- 全社スケジュール: admin/hq のみ
- 個別スケジュール: 端末選択 → 設定
- 保存時に `version` を自動インクリメント

---

## 10. セキュリティ

| 項目 | 実装方法 |
|------|---------|
| パスワード | bcrypt ハッシュ（平文保存禁止） |
| セッション | express-session, HttpOnly cookie |
| API 認証（管理画面） | セッションベース |
| API 認証（プレーヤー） | client_key（UUID）クエリパラメータ |
| RBAC | ミドルウェアでロール検証 |
| ファイルアップロード | PDF MIME タイプ + 拡張子検証 |
| XSS 対策 | ユーザー入力のエスケープ |
| CSRF 対策 | セッショントークン検証 |

### 初期アカウント

- ユーザー名: `admin`
- パスワード: `admin`（bcrypt ハッシュで保存）
- ロール: `admin`
- 初回ログイン時にパスワード変更を推奨

---

## 11. デプロイ

### systemd サービスファイル

```ini
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

### 初期セットアップ手順

```bash
# 1. システムパッケージ
sudo apt update
sudo apt install -y nodejs npm build-essential sqlite3

# 2. アプリケーション配置
sudo mkdir -p /opt/signage-system
sudo cp -r . /opt/signage-system/
cd /opt/signage-system

# 3. 依存関係インストール（プロキシ環境の場合）
HTTPS_PROXY=http://210.175.128.100:8080 npm install --production

# 4. データベース初期化
node db/init.js

# 5. systemd サービス登録
sudo cp scripts/signage-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable signage-server
sudo systemctl start signage-server

# 6. 確認
sudo systemctl status signage-server
curl http://localhost:3000/api/auth/me
```

---

## 12. 参照ドキュメント

- `doc/signage-system-design.md` — 詳細なシステム設計ドキュメント（659行）
  - このファイルを signage-server プロジェクトの `doc/` にコピーすること
  - DB スキーマ、API 仕様、画面仕様、デプロイ手順等の全詳細を含む

---

## 13. 重要な注意事項

1. **プロキシ環境**: 社内ネットワークでは `npm install` 時にプロキシ設定が必要
2. **Electron クライアントとの連携**: プレーヤー API（`/api/player/*`）は Electron クライアントが直接呼び出す。レスポンス形式は「5.7 プレーヤー API」の通りに厳密に実装すること
3. **バージョン番号**: スケジュール保存時に `version` をインクリメントすること。クライアントはこの値でキャッシュの有効性を判定する
4. **client_key**: UUID 形式で自動生成。端末作成時に生成し、以降変更不可
5. **PDF 保存先**: `./uploads/` ディレクトリは起動時に自動作成する。書き込み権限を確認すること
