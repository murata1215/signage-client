# sinagecli クライアント 追加開発要件

## 1. 概要

signage-server（Express.js バックエンド）の Player API 実装が完了し、以下のエンドポイントが稼働可能な状態です。
Electron クライアント（sinagecli）側で、サーバーとの連携機能を実装する必要があります。

### サーバー側で実装済みの Player API

| メソッド | エンドポイント | 用途 |
|---------|-------------|------|
| GET | `/api/player/schedule?key={client_key}` | マージ済みプレイリスト取得 |
| GET | `/api/player/content/:id/file?key={client_key}` | PDF ファイルダウンロード |
| POST | `/api/player/heartbeat?key={client_key}` | ハートビート送信（稼働監視用） |
| GET | `/api/player/proxy?url={target_url}&key={client_key}` | Web コンテンツプロキシ |

### 認証方式

Player API はセッション認証ではなく、**クエリパラメータ `key`** に `client_key`（UUID）を付与する方式です。
管理画面で端末を登録すると UUID が自動生成されます。

---

## 2. サーバー接続設定

### 必要な設定値

Electron クライアントが保持すべき設定は以下の2つです：

| 設定項目 | 説明 | 例 |
|---------|------|-----|
| `serverUrl` | signage-server のベース URL | `http://192.168.1.100:3000` |
| `clientKey` | 端末識別用の UUID（サーバー側で自動生成） | `550e8400-e29b-41d4-a716-446655440000` |

### 設定の保存方法（推奨）

```
sinagecli/
├── config.json          ← 接続設定ファイル
└── ...
```

**config.json の例：**

```json
{
  "serverUrl": "http://192.168.1.100:3000",
  "clientKey": "550e8400-e29b-41d4-a716-446655440000",
  "pollingIntervalSec": 60
}
```

### 設定の読み込み方法

```javascript
const fs = require('fs');
const path = require('path');

// アプリケーションのユーザーデータディレクトリに config.json を保存
// Electron: app.getPath('userData') を使うとOS依存しない
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  return null; // 未設定 → 初回セットアップ画面を表示
}

function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}
```

---

## 3. 初回セットアップフロー

### 端末登録〜紐づけの流れ

```
┌─────────────────────────────────────────────────────────────┐
│ 管理者の操作（ブラウザ）                                      │
│                                                              │
│  1. 管理画面 → 端末管理 → 「+ 新規端末」をクリック            │
│  2. 端末名と所属拠点を入力して「保存」                        │
│  3. client_key（UUID）が自動生成される                        │
│  4. 一覧画面に表示される client_key をコピー                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ コピー
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 端末での操作（Electron クライアント）                         │
│                                                              │
│  5. sinagecli を初回起動 → 設定画面が表示される               │
│  6. サーバー URL と client_key を入力                         │
│  7. 「接続テスト」ボタンで疎通確認                            │
│  8. 成功したら config.json に保存 → 再生開始                  │
└─────────────────────────────────────────────────────────────┘
```

### 初回セットアップ画面の実装（推奨）

sinagecli の初回起動時（config.json が存在しない場合）に、以下の入力画面を表示する：

```
┌──────────────────────────────────────┐
│    サイネージクライアント 初期設定      │
│                                       │
│  サーバー URL:                         │
│  [ http://192.168.1.100:3000      ]   │
│                                       │
│  Client Key:                          │
│  [ 550e8400-e29b-41d4-a716-...    ]   │
│                                       │
│  [ 接続テスト ]  [ 保存して開始 ]       │
└──────────────────────────────────────┘
```

**接続テストの実装：**

```javascript
async function testConnection(serverUrl, clientKey) {
  try {
    const response = await fetch(
      `${serverUrl}/api/player/schedule?key=${clientKey}`
    );
    if (response.ok) {
      return { success: true, message: '接続成功' };
    }
    if (response.status === 401) {
      return { success: false, message: 'Client Key が無効です' };
    }
    return { success: false, message: `サーバーエラー (${response.status})` };
  } catch (err) {
    return { success: false, message: `接続失敗: ${err.message}` };
  }
}
```

---

## 4. fetchPlaylistFromServer() の実装

現在 `lib/playlist.js` にスタブとして存在する `fetchPlaylistFromServer()` を、実際のサーバー API 呼び出しに置き換えます。

### API 仕様

```
GET /api/player/schedule?key={client_key}
```

### レスポンス形式

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

### レスポンスの各フィールド

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `version` | number | スケジュールの変更バージョン番号（キャッシュ無効化に使用） |
| `play_start_time` | string | 再生開始時刻（例: `"07:00"`） |
| `play_end_time` | string | 再生終了時刻（例: `"20:00"`） |
| `playlist` | array | 再生コンテンツの配列（global → client の順） |

### playlist 配列の各アイテム

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `id` | number | schedule_contents テーブルの ID |
| `scope` | string | `"global"`（全社）または `"client"`（個別） |
| `content_id` | number | コンテンツ ID |
| `name` | string | コンテンツ名 |
| `type` | string | `"pdf"` または `"web"` |
| `file_url` | string | PDF ダウンロード URL（type=pdf の場合のみ） |
| `url` | string | Web コンテンツの URL（type=web の場合のみ） |
| `pdf_page_duration` | number | PDF 1ページの表示秒数（type=pdf の場合のみ） |
| `duration_seconds` | number | コンテンツ全体の表示秒数 |
| `display_order` | number | 表示順 |
| `use_proxy` | boolean | プロキシ使用フラグ |
| `proxy_url` | string\|null | プロキシ URL |

### 再生順序

1. `scope: "global"` のコンテンツが `display_order` 順に再生
2. 次に `scope: "client"` のコンテンツが `display_order` 順に再生
3. 全コンテンツ再生後、1 に戻ってループ

### 実装例

```javascript
const config = loadConfig();

/**
 * サーバーからプレイリストを取得する
 * @returns {Promise<Object|null>} スケジュールデータ、またはエラー時 null
 */
async function fetchPlaylistFromServer() {
  try {
    const response = await fetch(
      `${config.serverUrl}/api/player/schedule?key=${config.clientKey}`
    );

    if (!response.ok) {
      console.error(`スケジュール取得失敗: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('スケジュール取得エラー:', err.message);
    return null; // オフライン時はキャッシュにフォールバック
  }
}
```

---

## 5. ハートビート送信

### 目的

管理画面のダッシュボードで端末の稼働状況を監視するため、定期的にハートビートを送信します。
サーバーは `last_seen_at` を更新し、5分以内の通信があれば「稼働中」と判定します。

### API 仕様

```
POST /api/player/heartbeat?key={client_key}
```

レスポンス: `{ "status": "ok" }`

### 実装例

```javascript
/**
 * ハートビート送信ループを開始する
 * 60秒ごとにサーバーへ POST を送信し、端末の稼働状態を通知する
 */
function startHeartbeat() {
  const intervalMs = (config.pollingIntervalSec || 60) * 1000;

  async function sendHeartbeat() {
    try {
      await fetch(
        `${config.serverUrl}/api/player/heartbeat?key=${config.clientKey}`,
        { method: 'POST' }
      );
    } catch (err) {
      // ネットワークエラーは無視（サーバー復帰後に自動的に再開される）
      console.warn('ハートビート送信失敗:', err.message);
    }
  }

  // 即座に1回送信してからインターバル開始
  sendHeartbeat();
  setInterval(sendHeartbeat, intervalMs);
}
```

---

## 6. PDF キャッシュとバージョン管理

### キャッシュ戦略

1. PDF ファイルは **IndexedDB**（または Electron の userData ディレクトリ）にキャッシュ
2. スケジュールの `version` 番号を **localStorage** に保存
3. ポーリング時に `version` が変わっていたらスケジュールを再取得し、PDF を再ダウンロード
4. サーバーに接続できない場合はキャッシュされたデータで再生を継続

### バージョンチェックの流れ

```
[ポーリング（60秒ごと）]
    │
    ├─ GET /api/player/schedule?key=...
    │
    ├─ レスポンスの version をチェック
    │   │
    │   ├─ キャッシュと同じ version → 何もしない
    │   │
    │   └─ version が変わった →
    │       ├─ 新しいスケジュールを適用
    │       ├─ 新しい PDF があればダウンロード
    │       └─ 不要になった PDF キャッシュを削除
    │
    └─ 接続失敗 → キャッシュで再生を継続
```

### PDF ダウンロード

```javascript
/**
 * PDF ファイルをサーバーからダウンロードしてキャッシュする
 * @param {number} contentId - コンテンツ ID
 * @returns {Promise<ArrayBuffer>} PDF バイナリデータ
 */
async function downloadPdf(contentId) {
  const url = `${config.serverUrl}/api/player/content/${contentId}/file?key=${config.clientKey}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`PDF ダウンロード失敗: HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  // IndexedDB または ファイルシステムにキャッシュ
  await cachePdf(contentId, buffer);
  return buffer;
}
```

---

## 7. プロキシ連携

### 概要

Web コンテンツの中には、クライアント端末から直接アクセスできない URL（社内イントラネット等）がある場合があります。
`use_proxy: true` のコンテンツは、サーバーのプロキシ API を経由してアクセスします。

### 判定ロジック

```javascript
playlist.forEach(item => {
  if (item.type === 'web') {
    if (item.use_proxy && item.proxy_url) {
      // Electron の session.setProxy() でプロキシを設定
      // または サーバーのプロキシ API 経由でアクセス
    }
  }
});
```

### サーバープロキシ API

```
GET /api/player/proxy?url={target_url}&key={client_key}
```

レスポンス: プロキシ先の HTML/JSON がそのまま返される

### 使い方の選択肢

**方法 A: サーバープロキシ API を使用（推奨）**
```javascript
// BrowserView で表示する URL をプロキシ API 経由に書き換える
const proxyUrl = `${config.serverUrl}/api/player/proxy?url=${encodeURIComponent(item.url)}&key=${config.clientKey}`;
browserView.webContents.loadURL(proxyUrl);
```

**方法 B: Electron の session.setProxy() を使用**
```javascript
// sinagecli に既に実装済みの session.setProxy() を利用
await session.defaultSession.setProxy({
  proxyRules: item.proxy_url
});
browserView.webContents.loadURL(item.url);
```

---

## 8. 全体の起動フロー

```
sinagecli 起動
    │
    ├─ config.json を読み込み
    │   │
    │   ├─ 存在しない → 初回セットアップ画面を表示
    │   │                ユーザーが serverUrl + clientKey を入力
    │   │                接続テスト → 成功したら config.json に保存
    │   │
    │   └─ 存在する → 接続設定を読み込み
    │
    ├─ ハートビート送信ループを開始（60秒間隔）
    │
    ├─ fetchPlaylistFromServer() でスケジュール取得
    │   │
    │   ├─ 成功 → スケジュール + PDF をキャッシュに保存
    │   │         version 番号を記録
    │   │
    │   └─ 失敗 → キャッシュからスケジュールを読み込み
    │
    ├─ 現在時刻 vs play_start_time / play_end_time を判定
    │   │
    │   ├─ 時間帯内 → コンテンツ再生開始（ループ）
    │   │
    │   └─ 時間帯外 → 待機画面（黒画面）表示
    │
    └─ バックグラウンドポーリング（60秒ごと）
        └─ スケジュール version チェック → 変更あれば再読み込み
```

---

## 9. 実装タスクチェックリスト

### 必須タスク

- [ ] `config.json` の読み込み・保存機能
- [ ] 初回セットアップ画面（serverUrl + clientKey 入力）
- [ ] 接続テスト機能
- [ ] `fetchPlaylistFromServer()` の実装（`lib/playlist.js` のスタブ置き換え）
- [ ] ハートビート送信ループ（60秒間隔）
- [ ] PDF ダウンロード・キャッシュ機能
- [ ] version ベースのキャッシュ無効化ロジック
- [ ] 再生時間帯の判定（play_start_time / play_end_time）
- [ ] バックグラウンドポーリング（スケジュール変更検知）
- [ ] オフライン時のキャッシュフォールバック

### オプションタスク

- [ ] プロキシ連携（use_proxy / proxy_url 対応）
- [ ] エラー通知 UI（接続エラー時の画面表示）
- [ ] 設定画面からの再設定機能（キーボードショートカット等で呼び出し）
- [ ] ログ出力（接続状況・エラーのファイルログ）

---

## 10. サーバー情報

| 項目 | 値 |
|------|-----|
| デフォルトポート | 3000 |
| 管理画面 URL | `http://{server}:3000/admin/` |
| 初期管理者アカウント | `admin` / `admin` |
| API ベースパス | `/api/player/*` |
| 認証方式 | クエリパラメータ `?key={client_key}` |
| ポーリング推奨間隔 | 60秒 |
| 稼働判定しきい値 | last_seen_at が 5分以内 |
