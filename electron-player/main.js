/**
 * サイネージプレーヤー Electron メインプロセス
 *
 * 目的:
 *   Electron アプリケーションのエントリーポイント。
 *   ウィンドウの作成、プロキシ設定、BrowserView の管理、
 *   キーボードショートカットの登録を行う。
 *   サーバーとの連携（スケジュール取得、ハートビート、ポーリング）を制御する。
 *
 * 起動モード:
 *   - npm start          : 通常モード（フルスクリーン）
 *   - npm run start:kiosk : キオスクモード（フルスクリーン固定）
 *   - npm run start:dev   : 開発モード（ウィンドウ表示、DevTools有効）
 *
 * 起動フロー:
 *   1. プロキシ設定
 *   2. メインウィンドウ作成
 *   3. ViewManager 初期化
 *   4. config.json 読み込み
 *      → 未設定: セットアップ画面を表示（IPC で設定保存待ち）
 *      → 設定あり: startPlayback() で再生開始
 *   5. 再生開始:
 *      → ハートビート開始
 *      → スケジュール取得（失敗時はキャッシュフォールバック）
 *      → 時間帯判定 → 再生開始 or 待機画面
 *      → ポーリング開始
 *
 * 操作:
 *   - Sキー: ステータスバー表示/非表示
 *   - Ctrl+Q: アプリ終了（devモードのみ）
 *   - F12: DevTools表示（devモードのみ）
 */

'use strict';

const { app, BrowserWindow, globalShortcut, session, ipcMain, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// --- 自作モジュールの読み込み ---
const ViewManager = require('./lib/view-manager');
const { getPlaylist } = require('./lib/playlist');
const { getProxyConfig } = require('./lib/proxy-rules');
const configManager = require('./lib/config-manager');
const serverClient = require('./lib/server-client');
const heartbeat = require('./lib/heartbeat');
const screenshot = require('./lib/screenshot');
const cacheManager = require('./lib/cache-manager');
const ScheduleManager = require('./lib/schedule-manager');

// =====================================================
// コマンドライン引数の解析
// =====================================================

/** @type {boolean} キオスクモードフラグ（--kiosk で有効） */
const isKioskMode = process.argv.includes('--kiosk');

/** @type {boolean} 開発モードフラグ（--dev で有効） */
const isDevMode = process.argv.includes('--dev');

console.log('[main] サイネージプレーヤー Electron 起動');
console.log(`[main] モード: ${isKioskMode ? 'キオスク' : isDevMode ? '開発' : '通常'}`);

// =====================================================
// グローバル参照
// =====================================================

/** @type {ViewManager|null} ViewManager のインスタンス */
let viewManager = null;

/** @type {ScheduleManager|null} ScheduleManager のインスタンス */
let scheduleManager = null;

// =====================================================
// プロキシ設定
// =====================================================

/**
 * Electron セッションのプロキシを設定する
 * 社内ネットワークは直接接続、外部サイトはプロキシ経由
 */
async function setupProxy() {
  const proxyConfig = getProxyConfig();
  console.log('[main] プロキシ設定:', proxyConfig);

  await session.defaultSession.setProxy(proxyConfig);
  console.log('[main] プロキシ設定完了');
}

// =====================================================
// メインウィンドウ作成
// =====================================================

/**
 * メインウィンドウを作成する
 *
 * ウィンドウは純粋なコンテナとして機能し、
 * 実際の表示は BrowserView が担当する。
 *
 * @returns {Electron.BrowserWindow} 作成したウィンドウ
 */
function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: !isDevMode,          // 開発モード以外はフルスクリーン
    frame: isDevMode,                // 開発モードのみウィンドウ枠表示
    kiosk: isKioskMode,              // キオスクモード
    autoHideMenuBar: true,           // メニューバーを非表示
    backgroundColor: '#000000',      // 背景を黒に
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // ウィンドウにはダミーの空ページを読み込み（BrowserViewが上に重なる）
  win.loadURL('about:blank');

  console.log('[main] メインウィンドウ作成完了');
  return win;
}

// =====================================================
// キーボードショートカット登録
// =====================================================

/**
 * グローバルキーボードショートカットを登録する
 *
 * @param {Electron.BrowserWindow} win - メインウィンドウ
 */
function registerShortcuts(win) {
  // --- Sキー: ステータスバー表示切替 ---
  // ウィンドウの keydown イベントで検知（BrowserView上でも動作させるため）
  win.webContents.on('before-input-event', (_event, input) => {
    handleKeyInput(input);
  });

  // 開発モード用のショートカット
  if (isDevMode) {
    // Ctrl+Q: アプリ終了
    globalShortcut.register('Ctrl+Q', () => {
      console.log('[main] Ctrl+Q: アプリを終了します');
      app.quit();
    });

    // F12: DevTools 表示切替
    globalShortcut.register('F12', () => {
      // アクティブな BrowserView の DevTools を開く
      const views = win.getBrowserViews();
      if (views.length > 0) {
        const lastView = views[views.length - 1];
        if (lastView.webContents.isDevToolsOpened()) {
          lastView.webContents.closeDevTools();
        } else {
          lastView.webContents.openDevTools({ mode: 'detach' });
        }
      }
    });
  }

  console.log('[main] キーボードショートカット登録完了');
}

/**
 * キー入力を処理する
 * BrowserView からの入力イベントには対応できないため、
 * 別途 BrowserView の before-input-event も登録する
 *
 * @param {Electron.Input} input - 入力情報
 */
function handleKeyInput(input) {
  if (input.type !== 'keyDown') return;

  // Sキー: ステータスバー表示切替
  if (input.key === 's' || input.key === 'S') {
    if (viewManager) {
      viewManager.toggleStatusBar();
    }
  }
}

// =====================================================
// コンテンツ再生開始
// =====================================================

/**
 * コンテンツ再生を開始する
 *
 * config.json の設定に基づいて以下を実行:
 *   1. オーバーレイを通常のUIに切り替え
 *   2. ハートビート送信開始
 *   3. スケジュール取得（オフラインフォールバック対応）
 *   4. 時間帯判定 → 再生開始 or 待機画面
 *   5. バックグラウンドポーリング開始
 *
 * @param {Object} config - 接続設定
 * @param {string} config.serverUrl - サーバーURL
 * @param {string} config.clientKey - クライアントキー
 * @param {number} config.pollingIntervalSec - ポーリング間隔（秒）
 * @param {boolean} [fromSetup=false] - セットアップ画面からの遷移かどうか
 */
async function startPlayback(config, fromSetup = false) {
  console.log('[main] 再生開始処理を実行中...');

  // 1. セットアップ画面からの遷移時のみ、オーバーレイを通常UIに切り替える
  //    config あり → 直接再生の場合は initialize() で既に index.html が読み込み済みなので不要
  if (fromSetup) {
    await viewManager.showOverlay();
  }

  // 2. ハートビート送信開始
  heartbeat.startHeartbeat(
    config.serverUrl,
    config.clientKey,
    (config.pollingIntervalSec || 60) * 1000
  );

  // 2.5. スクリーンショット定期送信開始
  // viewManager を渡して、その時点のアクティブViewを動的に参照する
  screenshot.startScreenshotTimer(viewManager, config.serverUrl, config.clientKey);

  // 3. ScheduleManager を初期化してスケジュール取得
  scheduleManager = new ScheduleManager(config);

  const { playlist, scheduleData } = await scheduleManager.initialLoad();

  // プレイリストが取得できたかどうかで分岐
  let activePlaylist;

  if (playlist.length > 0) {
    // サーバーまたはキャッシュからプレイリスト取得成功
    activePlaylist = playlist;
  } else {
    // サーバーもキャッシュも利用不可 → デフォルトプレイリストにフォールバック
    console.warn('[main] サーバー/キャッシュ利用不可、デフォルトプレイリストを使用');
    activePlaylist = getPlaylist();
  }

  // 4. 時間帯判定
  if (scheduleData) {
    const isPlayTime = scheduleManager.isWithinPlayTime(
      scheduleData.play_start_time,
      scheduleData.play_end_time
    );

    if (!isPlayTime) {
      // 再生時間帯外 → 待機画面を表示
      console.log('[main] 再生時間帯外 → 待機画面を表示');
      viewManager.showStandby();

      // 現在のプレイリストを保持（再生時間帯に入ったら使用）
      viewManager.playlist = activePlaylist;
    } else {
      // 再生時間帯内 → ローテーション開始
      viewManager.startRotation(activePlaylist);
    }

    // 時間帯チェックタイマーを開始
    scheduleManager.startPlayTimeCheck(
      scheduleData.play_start_time,
      scheduleData.play_end_time
    );

    // 時間帯変化イベントをリッスン
    scheduleManager.on('play-time-changed', (isPlayTime) => {
      if (isPlayTime) {
        // 再生時間帯に入った → 再生開始
        console.log('[main] 再生時間帯に入りました → 再生開始');
        viewManager.resumeFromStandby();
      } else {
        // 再生時間帯を過ぎた → 待機画面
        console.log('[main] 再生時間帯外になりました → 待機画面');
        viewManager.showStandby();
      }
    });
  } else {
    // スケジュールデータなし（時間帯情報なし）→ 常時再生
    viewManager.startRotation(activePlaylist);
  }

  // 5. バックグラウンドポーリング開始
  scheduleManager.startPolling();

  // スケジュール更新イベントをリッスン
  scheduleManager.on('schedule-updated', (newPlaylist) => {
    console.log('[main] スケジュール更新検知 → プレイリスト更新予約');
    if (viewManager.isStandby) {
      // 待機中の場合はプレイリストを直接差し替え（次回再生開始時に使用）
      viewManager.playlist = newPlaylist;
      viewManager.pendingPlaylist = null;
    } else {
      // 再生中の場合はループ末尾で差し替え
      viewManager.updatePlaylist(newPlaylist);
    }
  });

  console.log('[main] 再生開始処理完了');
}

// =====================================================
// セットアップ画面 IPC ハンドラ
// =====================================================

/**
 * セットアップ画面からの IPC メッセージを処理するハンドラを登録する
 *
 * 接続テストと設定保存の2つのチャネルを処理する。
 * 設定保存完了後に startPlayback() を呼び出して再生を開始する。
 */
function registerSetupHandlers() {
  // --- 接続テスト ---
  ipcMain.on('test-connection', async (_event, { serverUrl, clientKey }) => {
    console.log('[main] 接続テスト開始:', serverUrl);
    const result = await serverClient.testConnection(serverUrl, clientKey);

    // 結果をオーバーレイ（セットアップ画面）に送信
    if (viewManager && viewManager.overlayView) {
      viewManager.overlayView.webContents.send('test-connection-result', result);
    }
  });

  // --- 設定保存 ---
  ipcMain.on('save-config', async (_event, configData) => {
    console.log('[main] 設定保存:', configData.serverUrl);

    // config.json に保存
    configManager.saveConfig(configData);

    // 保存完了通知をオーバーレイに送信
    if (viewManager && viewManager.overlayView) {
      viewManager.overlayView.webContents.send('config-saved');
    }

    // 少し待ってから再生開始（UIのフィードバックを表示するため）
    // セットアップ画面からの遷移なので fromSetup=true
    setTimeout(async () => {
      await startPlayback(configData, true);
    }, 1000);
  });
}

// =====================================================
// カスタムプロトコル登録（pdfapp://）
// =====================================================

/**
 * pdfapp:// カスタムプロトコルをスキーム登録する
 *
 * file:// プロトコルでは ESM（.mjs）の動的 import がブロックされるため、
 * HTTP と同等の権限を持つカスタムプロトコルを使用して PDF ビューア関連の
 * ファイルを配信する。
 *
 * 重要: この呼び出しは app.whenReady() の前に行う必要がある（Electron の仕様）
 *
 * 権限設定:
 *   - standard: 標準的なスキーム（相対パスの解決が有効）
 *   - secure: HTTPS と同等のセキュリティコンテキスト
 *   - supportFetchAPI: fetch() API でアクセス可能
 *   - stream: ストリーミング対応
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pdfapp',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

// =====================================================
// アプリケーション起動シーケンス
// =====================================================

app.whenReady().then(async () => {
  try {
    // 1. プロキシ設定
    await setupProxy();

    // 2. pdfapp:// プロトコルハンドラを登録
    //    pdfapp://local/path/to/file → ローカルファイルを返す
    //    これにより file:// の代わりに ESM import が可能になる
    protocol.handle('pdfapp', (request) => {
      // pdfapp://local/path/to/file → /path/to/file にマッピング
      const url = new URL(request.url);
      // ホスト名 "local" を除去し、パス部分をデコードしてローカルファイルパスを取得
      const filePath = decodeURIComponent(url.pathname);
      const fileUrl = pathToFileURL(filePath).href;
      console.log(`[protocol] pdfapp:// リクエスト: ${request.url} → ${fileUrl}`);
      return net.fetch(fileUrl);
    });
    console.log('[main] pdfapp:// プロトコルハンドラ登録完了');

    // 3. メインウィンドウ作成
    const win = createMainWindow();

    // 4. ViewManager 初期化
    viewManager = new ViewManager(win);
    await viewManager.initialize();

    // 5. BrowserView の before-input-event にもキーハンドラを登録
    // （BrowserView がフォーカスを持つと、ウィンドウの before-input-event が発火しないため）
    const views = win.getBrowserViews();
    views.forEach((view) => {
      view.webContents.on('before-input-event', (_event, input) => {
        handleKeyInput(input);
      });
    });

    // 6. キーボードショートカット登録
    registerShortcuts(win);

    // 7. セットアップ画面用の IPC ハンドラを登録
    registerSetupHandlers();

    // 8. config.json を読み込み
    const config = configManager.loadConfig();

    if (!config) {
      // --- 設定なし: 初回セットアップ画面を表示 ---
      console.log('[main] config.json なし → セットアップ画面を表示');
      await viewManager.showSetup();
      // セットアップ完了 → save-config IPC で startPlayback() が呼ばれる
    } else {
      // --- 設定あり: 直接再生開始 ---
      console.log('[main] config.json あり → 再生開始');
      await startPlayback(config);
    }

    console.log('[main] アプリケーション起動完了');

  } catch (err) {
    console.error('[main] 起動エラー:', err);
    app.quit();
  }
});

// =====================================================
// アプリケーション終了処理
// =====================================================

/** 全ウィンドウが閉じられたらアプリを終了 */
app.on('window-all-closed', () => {
  console.log('[main] 全ウィンドウが閉じられました。終了します。');

  // ハートビート停止
  heartbeat.stopHeartbeat();

  // スクリーンショット送信停止
  screenshot.stopScreenshotTimer();

  // ポーリング + 時間帯チェックタイマー停止
  if (scheduleManager) {
    scheduleManager.stopAll();
  }

  // ViewManager リソース解放
  if (viewManager) {
    viewManager.destroy();
  }

  app.quit();
});

/** アプリ終了時にショートカットを解除 */
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  console.log('[main] アプリケーション終了');
});
