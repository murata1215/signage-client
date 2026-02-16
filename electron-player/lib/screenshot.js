/**
 * スクリーンショット撮影・サーバー送信モジュール
 *
 * 目的:
 *   管理画面のダッシュボードで、各クライアント端末が「今何を表示しているか」を
 *   サムネイルで確認できるようにするため、定期的に画面をキャプチャしてサーバーに送信する。
 *
 * 動作:
 *   - startScreenshotTimer() を呼び出すと、初回は30秒後に送信し、
 *     その後は5分間隔で繰り返す
 *   - BrowserView の webContents.capturePage() で画面をキャプチャ
 *   - NativeImage → JPEG Buffer に変換（品質80%、1280px幅にリサイズ）
 *   - multipart/form-data で POST /api/player/screenshot に送信
 *   - 送信失敗はログ出力のみ（リトライ不要、次回の定期送信で再試行される）
 *   - 待機中（時間帯外）やフェード遷移中はキャプチャをスキップ
 *
 * サーバー側 API:
 *   POST /api/player/screenshot?key={client_key}
 *   Content-Type: multipart/form-data
 *   フィールド名: screenshot（JPEG/PNG/WebP、最大2MB）
 *
 * 使用方法:
 *   const screenshot = require('./screenshot');
 *   screenshot.startScreenshotTimer(viewManager, serverUrl, clientKey);
 *   // アプリ終了時:
 *   screenshot.stopScreenshotTimer();
 */

'use strict';

const { net } = require('electron');

// =====================================================
// 定数
// =====================================================

/** @type {number} スクリーンショット送信間隔（ミリ秒）: 5分 */
const SCREENSHOT_INTERVAL = 5 * 60 * 1000;

/** @type {number} 初回送信までの待機時間（ミリ秒）: 30秒
 * アプリ起動直後はコンテンツがまだ読み込まれていない可能性があるため */
const INITIAL_DELAY = 30 * 1000;

/** @type {number} JPEG 変換品質（0〜100）: 80% で視認性と容量のバランスを取る */
const JPEG_QUALITY = 80;

/** @type {number} リサイズ後の最大幅（ピクセル）: フル解像度は不要なので転送量を削減 */
const RESIZE_WIDTH = 1280;

// =====================================================
// タイマー管理
// =====================================================

/** @type {NodeJS.Timeout|null} 初回送信用の遅延タイマー */
let initialTimer = null;

/** @type {NodeJS.Timeout|null} 定期送信用のインターバルタイマー */
let intervalTimer = null;

// =====================================================
// キャプチャ処理
// =====================================================

/**
 * 現在表示中の BrowserView の画面をキャプチャして JPEG Buffer を返す
 *
 * ViewManager から現在アクティブな BrowserView を取得し、
 * webContents.capturePage() で画面をキャプチャする。
 * キャプチャ結果は JPEG に変換し、幅が RESIZE_WIDTH を超える場合はリサイズする。
 *
 * @param {Object} viewManager - ViewManager インスタンス
 * @returns {Promise<Buffer|null>} JPEG 画像の Buffer。失敗時やスキップ時は null
 */
async function captureScreen(viewManager) {
  try {
    // 待機中（再生時間帯外）はキャプチャ不要
    if (viewManager.isStandby) {
      console.log('[screenshot] 待機中のためキャプチャをスキップ');
      return null;
    }

    // フェード遷移中は黒画面なのでキャプチャしても意味がない
    if (viewManager.isTransitioning) {
      console.log('[screenshot] フェード遷移中のためキャプチャをスキップ');
      return null;
    }

    // 現在アクティブな BrowserView を取得
    const activeView = viewManager.activeView;
    if (!activeView || !activeView.webContents) {
      console.warn('[screenshot] アクティブなBrowserViewが見つかりません');
      return null;
    }

    // BrowserView の webContents から画面をキャプチャ
    // capturePage() は NativeImage を返す Promise
    const nativeImage = await activeView.webContents.capturePage();

    if (nativeImage.isEmpty()) {
      console.log('[screenshot] キャプチャ結果が空です');
      return null;
    }

    // リサイズ: フル解像度は不要なので RESIZE_WIDTH 幅に縮小
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
    console.log(`[screenshot] キャプチャ成功: ${size.width}x${size.height} → JPEG ${jpegBuffer.length} bytes`);
    return jpegBuffer;

  } catch (err) {
    console.error('[screenshot] キャプチャ失敗:', err.message);
    return null;
  }
}

// =====================================================
// サーバー送信
// =====================================================

/**
 * JPEG 画像をサーバーに multipart/form-data で送信する
 *
 * Electron の net.fetch() を使用するため、session に設定されたプロキシが自動適用される。
 * multipart/form-data のボディは手動で構築する（外部ライブラリ不要）。
 *
 * @param {string} serverUrl - サーバーのベースURL（例: "http://192.168.1.100:3000"）
 * @param {string} clientKey - このクライアントの client_key（UUID）
 * @param {Buffer} jpegBuffer - 送信する JPEG 画像データ
 * @returns {Promise<boolean>} 送信成功なら true
 */
async function sendScreenshot(serverUrl, clientKey, jpegBuffer) {
  const url = `${serverUrl}/api/player/screenshot?key=${encodeURIComponent(clientKey)}`;

  try {
    // multipart/form-data を手動で構築
    // Node.js / Electron の標準ライブラリのみで実装（外部依存なし）
    const boundary = '----ScreenshotBoundary' + Date.now();

    // multipart ボディのヘッダー部分（Content-Disposition + Content-Type）
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="screenshot"; filename="screenshot.jpg"\r\n` +
      `Content-Type: image/jpeg\r\n` +
      `\r\n`
    );
    // multipart ボディのフッター部分（終了境界）
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);

    // ヘッダー + JPEG データ + フッターを結合
    const body = Buffer.concat([header, jpegBuffer, footer]);

    // Electron の net.fetch() で送信（プロキシ設定が自動適用される）
    const response = await net.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(body.length)
      },
      body: body
    });

    if (response.ok) {
      console.log('[screenshot] サーバー送信成功');
      return true;
    } else {
      const text = await response.text();
      console.warn(`[screenshot] サーバー送信失敗 (HTTP ${response.status}): ${text}`);
      return false;
    }

  } catch (err) {
    // ネットワークエラーは警告のみ（次回の定期送信で自動リトライ）
    console.warn('[screenshot] サーバー送信エラー:', err.message);
    return false;
  }
}

// =====================================================
// タイマー制御
// =====================================================

/**
 * スクリーンショット定期送信を開始する
 *
 * 初回は INITIAL_DELAY（30秒）後に送信し、
 * その後は SCREENSHOT_INTERVAL（5分）間隔で繰り返す。
 * 既にタイマーが動作中の場合は一度停止してから再開する。
 *
 * @param {Object} viewManager - ViewManager インスタンス（activeView を動的に参照）
 * @param {string} serverUrl - signage-server のベースURL
 * @param {string} clientKey - 端末識別用のUUID
 */
function startScreenshotTimer(viewManager, serverUrl, clientKey) {
  // 既存のタイマーがあれば停止（二重起動防止）
  stopScreenshotTimer();

  console.log(`[screenshot] スクリーンショット送信開始（初回: ${INITIAL_DELAY / 1000}秒後、間隔: ${SCREENSHOT_INTERVAL / 1000}秒）`);

  /**
   * キャプチャ→送信を実行する内部関数
   * 失敗してもエラーを投げず、次の送信タイミングで自動リトライ
   */
  async function captureAndSend() {
    const buffer = await captureScreen(viewManager);
    if (buffer) {
      await sendScreenshot(serverUrl, clientKey, buffer);
    }
  }

  // 初回は少し待ってから送信（コンテンツの読み込みを待つ）
  initialTimer = setTimeout(() => {
    // 初回送信
    captureAndSend();

    // 以降は SCREENSHOT_INTERVAL 間隔で繰り返し
    intervalTimer = setInterval(captureAndSend, SCREENSHOT_INTERVAL);
  }, INITIAL_DELAY);
}

/**
 * スクリーンショット定期送信を停止する
 *
 * アプリ終了時やサーバー接続先変更時に呼び出す。
 * 初回遅延タイマーとインターバルタイマーの両方を停止する。
 */
function stopScreenshotTimer() {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  console.log('[screenshot] スクリーンショット送信停止');
}

// =====================================================
// エクスポート
// =====================================================

module.exports = {
  startScreenshotTimer,
  stopScreenshotTimer
};
