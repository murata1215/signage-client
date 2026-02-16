# sinagecli スクリーンショット送信機能 実装仕様書

## 1. 概要

### 目的
管理画面のダッシュボードで、各クライアント端末が「今何を表示しているか」をサムネイルで確認できるようにする。

### 動作フロー
```
sinagecli (Electron)                    signage-server (Express)
        │                                        │
        │  5分ごとに画面キャプチャ                │
        │  ↓                                      │
        │  JPEG に変換・圧縮                      │
        │  ↓                                      │
        │  POST /api/player/screenshot ──────────►│  uploads/screenshots/{id}.jpg に保存
        │  ?key={client_key}                      │  clients.screenshot_path を更新
        │                                         │
        │  ◄────────── { "status": "ok" } ────────│
        │                                         │
        │                  管理者ブラウザ          │
        │                  ダッシュボードで        │
        │                  サムネイル表示          │
```

---

## 2. サーバー側 API 仕様（実装済み）

### エンドポイント

```
POST /api/player/screenshot?key={client_key}
```

### 認証
- クエリパラメータ `key` に `client_key`（UUID）を指定
- 既存のハートビートやスケジュール取得と同じ認証方式

### リクエスト

| 項目 | 値 |
|------|-----|
| メソッド | `POST` |
| Content-Type | `multipart/form-data` |
| フィールド名 | `screenshot` |
| 対応 MIME タイプ | `image/jpeg`, `image/png`, `image/webp` |
| 最大ファイルサイズ | **2MB**（超過すると 500 エラー） |

### レスポンス

**成功時 (200)**
```json
{
  "status": "ok",
  "path": "screenshots/1.jpg"
}
```

**認証エラー (401)**
```json
{
  "error": "client_key が必要です"
}
```
または
```json
{
  "error": "無効な client_key です"
}
```

**画像なしエラー (400)**
```json
{
  "error": "スクリーンショット画像が必要です"
}
```

**サーバーエラー (500)**
```json
{
  "error": "サーバーエラー"
}
```

---

## 3. Electron 側の実装手順

### 3.1 全体の流れ

1. BrowserView の `webContents.capturePage()` で画面をキャプチャ
2. `NativeImage` → JPEG `Buffer` に変換（品質 80%、リサイズ推奨）
3. `FormData` で `multipart/form-data` として POST 送信
4. 5分（300,000ms）間隔で繰り返し

### 3.2 キャプチャ対象

- コンテンツを表示している **BrowserView** の `webContents` をキャプチャする
- ステータスバーやメインウィンドウのフレームは含めなくてよい
- `capturePage()` はキャプチャ範囲を指定可能だが、省略すれば BrowserView 全体をキャプチャする

### 3.3 画像サイズの推奨値

| 項目 | 推奨値 | 備考 |
|------|--------|------|
| 解像度 | **1280 x 720** | フル解像度は不要。リサイズで転送量を削減 |
| JPEG 品質 | **80%** | 視認性と容量のバランス |
| 想定ファイルサイズ | 100KB〜500KB | 2MB 以内に収まること |

### 3.4 送信タイミング

| 項目 | 値 |
|------|-----|
| 送信間隔 | **5分（300,000ms）** |
| 初回送信 | アプリ起動後、プレイリスト再生開始から **30秒後** |
| 送信失敗時 | ログ出力のみ。リトライ不要（次の5分で再送信される） |

---

## 4. サンプルコード

### 4.1 スクリーンショット モジュール全体

以下のコードを `lib/screenshot.js` などとして配置する想定です。

```javascript
/**
 * @file lib/screenshot.js
 * @description スクリーンショット撮影・サーバー送信モジュール
 * 5分間隔で BrowserView の画面をキャプチャし、管理サーバーに送信する。
 * ダッシュボードのサムネイル表示に使用される。
 */

const http = require('http');
const https = require('https');
const path = require('path');

// スクリーンショット送信間隔（ミリ秒）: 5分
const SCREENSHOT_INTERVAL = 5 * 60 * 1000;

// 初回送信までの待機時間（ミリ秒）: 30秒
// アプリ起動直後はコンテンツがまだ読み込まれていない可能性があるため
const INITIAL_DELAY = 30 * 1000;

// JPEG 変換品質（0〜100）
const JPEG_QUALITY = 80;

// リサイズ後の最大幅（ピクセル）
const RESIZE_WIDTH = 1280;

// タイマー ID（停止用に保持）
let intervalId = null;

/**
 * BrowserView の画面をキャプチャして JPEG Buffer を返す
 *
 * @param {Electron.BrowserView} browserView - キャプチャ対象の BrowserView
 * @returns {Promise<Buffer|null>} JPEG 画像の Buffer。失敗時は null
 */
async function captureScreen(browserView) {
  try {
    // BrowserView の webContents から画面をキャプチャ
    // capturePage() は NativeImage を返す Promise
    const nativeImage = await browserView.webContents.capturePage();

    if (nativeImage.isEmpty()) {
      console.log('[Screenshot] キャプチャ結果が空です');
      return null;
    }

    // リサイズ: フル解像度は不要なので 1280px 幅に縮小
    // アスペクト比は自動維持される
    const size = nativeImage.getSize();
    let resized = nativeImage;
    if (size.width > RESIZE_WIDTH) {
      const scale = RESIZE_WIDTH / size.width;
      resized = nativeImage.resize({
        width: RESIZE_WIDTH,
        height: Math.round(size.height * scale)
      });
    }

    // NativeImage → JPEG Buffer に変換
    const jpegBuffer = resized.toJPEG(JPEG_QUALITY);
    console.log(`[Screenshot] キャプチャ成功: ${jpegBuffer.length} bytes`);
    return jpegBuffer;

  } catch (err) {
    console.error('[Screenshot] キャプチャ失敗:', err.message);
    return null;
  }
}

/**
 * JPEG 画像をサーバーに multipart/form-data で送信する
 *
 * @param {string} serverUrl - サーバーのベース URL（例: "http://192.168.1.100:3000"）
 * @param {string} clientKey - このクライアントの client_key（UUID）
 * @param {Buffer} jpegBuffer - 送信する JPEG 画像データ
 * @returns {Promise<boolean>} 送信成功なら true
 */
async function sendScreenshot(serverUrl, clientKey, jpegBuffer) {
  return new Promise((resolve) => {
    try {
      // multipart/form-data を手動で構築
      // Node.js 標準ライブラリのみで実装（外部依存なし）
      const boundary = '----ScreenshotBoundary' + Date.now();
      const fileName = 'screenshot.jpg';

      // multipart ボディを構築
      const header = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="screenshot"; filename="${fileName}"\r\n` +
        `Content-Type: image/jpeg\r\n` +
        `\r\n`
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([header, jpegBuffer, footer]);

      // URL をパース
      const url = new URL(`/api/player/screenshot?key=${clientKey}`, serverUrl);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      // HTTP リクエストを送信
      const req = httpModule.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        },
        // タイムアウト: 30秒
        timeout: 30000
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('[Screenshot] 送信成功');
            resolve(true);
          } else {
            console.warn(`[Screenshot] 送信失敗 (HTTP ${res.statusCode}): ${data}`);
            resolve(false);
          }
        });
      });

      req.on('error', (err) => {
        console.error('[Screenshot] 送信エラー:', err.message);
        resolve(false);
      });

      req.on('timeout', () => {
        console.warn('[Screenshot] 送信タイムアウト');
        req.destroy();
        resolve(false);
      });

      req.write(body);
      req.end();

    } catch (err) {
      console.error('[Screenshot] 送信準備エラー:', err.message);
      resolve(false);
    }
  });
}

/**
 * スクリーンショット定期送信を開始する
 * アプリの main プロセスから呼び出す。
 *
 * @param {Electron.BrowserView} browserView - キャプチャ対象の BrowserView
 * @param {string} serverUrl - サーバーの URL（例: "http://192.168.1.100:3000"）
 * @param {string} clientKey - client_key（UUID）
 */
function startScreenshotTimer(browserView, serverUrl, clientKey) {
  console.log(`[Screenshot] ${SCREENSHOT_INTERVAL / 1000}秒間隔で送信開始（初回は${INITIAL_DELAY / 1000}秒後）`);

  /**
   * キャプチャ→送信を実行する内部関数
   */
  async function captureAndSend() {
    const buffer = await captureScreen(browserView);
    if (buffer) {
      await sendScreenshot(serverUrl, clientKey, buffer);
    }
  }

  // 初回は少し待ってから送信（コンテンツの読み込みを待つ）
  setTimeout(() => {
    // 初回送信
    captureAndSend();

    // 以降は5分間隔で繰り返し
    intervalId = setInterval(captureAndSend, SCREENSHOT_INTERVAL);
  }, INITIAL_DELAY);
}

/**
 * スクリーンショット定期送信を停止する
 * アプリ終了時に呼び出す。
 */
function stopScreenshotTimer() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Screenshot] 送信停止');
  }
}

module.exports = {
  startScreenshotTimer,
  stopScreenshotTimer
};
```

### 4.2 main.js からの呼び出し例

```javascript
const { startScreenshotTimer, stopScreenshotTimer } = require('./lib/screenshot');

// BrowserView の作成後、プレイリスト再生開始時に呼び出す
// browserView: コンテンツ表示用の BrowserView インスタンス
// SERVER_URL: サーバーの URL（config から取得）
// CLIENT_KEY: この端末の client_key（config から取得）
startScreenshotTimer(browserView, SERVER_URL, CLIENT_KEY);

// アプリ終了時にタイマーを停止
app.on('before-quit', () => {
  stopScreenshotTimer();
});
```

---

## 5. 注意事項

### 画像サイズ制限
- サーバー側の制限は **2MB**
- 1280x720 + JPEG 品質 80% なら通常 100KB〜500KB に収まる
- 万が一 2MB を超える場合は品質を下げるか、さらにリサイズする

### エラー時の動作
- 送信失敗時はログ出力のみ。**リトライは不要**
- 次の5分後の定期送信で自動的に再試行される
- ネットワーク障害時にリトライループに入るのを防ぐため

### BrowserView が非表示の場合
- 再生時間外（`play_end_time` を過ぎた場合）は BrowserView が非表示の可能性がある
- `capturePage()` は非表示でも動作するが、空の画像が返る場合がある
- `nativeImage.isEmpty()` チェックで空画像の送信を防止している

### 外部依存
- このサンプルコードは **外部ライブラリ不要**（Node.js 標準の `http`/`https` のみ使用）
- `form-data` パッケージを使う場合はそちらでも OK（multipart 構築が簡単になる）

---

## 6. テスト方法

### curl で API の動作確認

```bash
# 1. テスト画像を送信
curl -X POST \
  "http://localhost:3000/api/player/screenshot?key={your_client_key}" \
  -F "screenshot=@test-image.jpg"

# 期待レスポンス:
# {"status":"ok","path":"screenshots/1.jpg"}

# 2. 保存された画像を確認（ブラウザでログイン後）
# http://localhost:3000/api/screenshots/1
```

### Electron での動作確認

1. `lib/screenshot.js` を配置
2. `main.js` から `startScreenshotTimer()` を呼び出し
3. コンソールログで以下を確認:
   - `[Screenshot] 300秒間隔で送信開始（初回は30秒後）`
   - `[Screenshot] キャプチャ成功: XXXXX bytes`
   - `[Screenshot] 送信成功`
4. 管理画面のダッシュボード（`http://サーバー/admin/`）でサムネイルが表示されることを確認

---

## 7. サーバー側の変更点まとめ（参考）

今回のサーバー側変更で追加されたもの:

| 項目 | 内容 |
|------|------|
| DB カラム | `clients.screenshot_path TEXT` |
| 受信 API | `POST /api/player/screenshot?key={client_key}` |
| 配信 API | `GET /api/screenshots/:clientId`（管理画面用、セッション認証） |
| 保存先 | `uploads/screenshots/{client_id}.jpg`（常に上書き） |
| ダッシュボード | サムネイル列追加、クリック拡大、60秒自動更新 |
