/**
 * BrowserView 管理モジュール
 *
 * 目的:
 *   2つのコンテンツ用 BrowserView と1つのオーバーレイ用 BrowserView を管理し、
 *   プレイリストに基づくコンテンツのローテーション表示とフェード切替を制御する。
 *
 * アーキテクチャ:
 *   - contentViewA: コンテンツ表示用（フルスクリーン）
 *   - contentViewB: コンテンツ表示用（フルスクリーン）
 *   - overlayView:  ステータスバー + フェード用（透明背景、最前面）
 *
 *   2つのコンテンツViewを交互に使い、フェードアニメーションで切り替える。
 *   overlayView は常に最前面に配置し、ステータスバーとフェード効果を表示する。
 *
 * フェード切替シーケンス（800ms）:
 *   1. overlay を黒にフェードイン（400ms）
 *   2. 待機中の BrowserView を前面に移動
 *   3. overlay を透明にフェードアウト（400ms）
 *
 * 追加機能（サーバー連携対応）:
 *   - updatePlaylist(): 次ループ開始時にプレイリストを差し替え
 *   - showStandby(): 再生時間帯外の待機画面を表示
 *   - resumeFromStandby(): 待機画面から再生モードに復帰
 *   - showSetup(): 初回セットアップ画面を表示
 *   - showOverlay(): 通常のオーバーレイUIに切り替え
 *
 * 使用方法:
 *   const viewManager = new ViewManager(mainWindow);
 *   viewManager.startRotation(playlist);
 *
 * TODO: Electron 30+ で BrowserView が完全に廃止された場合、
 *       WebContentsView に移行する。このモジュールを書き換えるだけで対応可能。
 */

'use strict';

const path = require('path');
const { BrowserView, ipcMain } = require('electron');

/**
 * ViewManager クラス
 *
 * 責務:
 *   - BrowserView の作成・配置・z-order管理
 *   - プレイリストのローテーション制御
 *   - フェード切替のオーケストレーション
 *   - カウントダウンタイマーの管理
 */
class ViewManager {
  /**
   * コンストラクタ
   *
   * @param {Electron.BrowserWindow} mainWindow - メインウィンドウ
   */
  constructor(mainWindow) {
    /** @type {Electron.BrowserWindow} メインウィンドウ参照 */
    this.mainWindow = mainWindow;

    /** @type {Electron.BrowserView|null} コンテンツ表示用View A */
    this.contentViewA = null;

    /** @type {Electron.BrowserView|null} コンテンツ表示用View B */
    this.contentViewB = null;

    /** @type {Electron.BrowserView|null} オーバーレイ用View（ステータスバー + フェード） */
    this.overlayView = null;

    /** @type {Electron.BrowserView|null} 現在表示中のView */
    this.activeView = null;

    /** @type {Electron.BrowserView|null} 裏で待機中のView */
    this.standbyView = null;

    /** @type {Array} プレイリスト */
    this.playlist = [];

    /** @type {number} 現在のプレイリストインデックス */
    this.currentIndex = 0;

    /** @type {NodeJS.Timeout|null} コンテンツ切替タイマー */
    this.switchTimer = null;

    /** @type {NodeJS.Timeout|null} カウントダウン更新タイマー */
    this.countdownTimer = null;

    /** @type {number} 残り秒数 */
    this.remainingSeconds = 0;

    /** @type {boolean} フェード遷移中フラグ（二重切替防止） */
    this.isTransitioning = false;

    /** @type {Array|null} 次ループで適用する新プレイリスト（ポーリング更新用） */
    this.pendingPlaylist = null;

    /** @type {boolean} 待機モード（再生時間帯外）かどうか */
    this.isStandby = false;

    /** @type {Promise|null} 先読み中の loadURL の Promise（フェードアウト前に完了を待つ） */
    this.preloadPromise = null;
  }

  /**
   * 全ての BrowserView を初期化する
   * コンテンツ用2つ + オーバーレイ用1つ を作成してウィンドウに配置
   */
  async initialize() {
    console.log('[ViewManager] BrowserView を初期化中...');

    // --- コンテンツ用 BrowserView A を作成 ---
    this.contentViewA = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,       // コンテンツの自由な読み込みを許可
        webSecurity: false    // file:// プロトコルでの ESM import（PDF.js）を許可
      }
    });

    // --- コンテンツ用 BrowserView B を作成 ---
    this.contentViewB = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: false    // file:// プロトコルでの ESM import（PDF.js）を許可
      }
    });

    // --- オーバーレイ用 BrowserView を作成 ---
    // preload スクリプトを指定してIPC通信を有効化
    this.overlayView = new BrowserView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '..', 'preload.js'),
        transparent: true   // 背景を透明に
      }
    });

    // コンテンツ用 BrowserView の User-Agent を通常の Chrome ブラウザに設定
    // Electron のデフォルト UA には "Electron/xxx" が含まれるため、
    // ヨドバシ等のボット検知を行うサイトでアクセスがブロックされる問題を回避する
    const chromeUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.contentViewA.webContents.setUserAgent(chromeUA);
    this.contentViewB.webContents.setUserAgent(chromeUA);

    // ウィンドウに3つのViewを追加
    // 追加順がz-orderに影響: 後から追加したものが前面
    this.mainWindow.addBrowserView(this.contentViewA);
    this.mainWindow.addBrowserView(this.contentViewB);
    this.mainWindow.addBrowserView(this.overlayView);

    // 全Viewをフルスクリーンサイズに設定
    this._resizeAllViews();

    // ウィンドウリサイズ時にViewもリサイズ
    this.mainWindow.on('resize', () => {
      this._resizeAllViews();
    });

    // オーバーレイの背景を透明に設定（loadFile の前に設定する必要がある）
    // loadFile の後に設定すると、デフォルトの不透明背景でレンダリングされてしまい
    // 下のコンテンツ用 BrowserView が見えなくなる
    this.overlayView.setBackgroundColor('#00000000');

    // オーバーレイHTMLを読み込み
    const overlayHtmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
    await this.overlayView.webContents.loadFile(overlayHtmlPath);

    // オーバーレイを常に最前面に
    this.mainWindow.setTopBrowserView(this.overlayView);

    // フェード完了通知のIPCハンドラを登録
    ipcMain.on('fade-complete', () => {
      this._onFadeComplete();
    });

    // 初期状態: A がアクティブ、B がスタンバイ
    this.activeView = this.contentViewA;
    this.standbyView = this.contentViewB;

    console.log('[ViewManager] BrowserView 初期化完了');
  }

  /**
   * プレイリストのローテーション表示を開始する
   *
   * @param {Array<{name: string, url: string, duration: number}>} playlist - プレイリスト
   */
  startRotation(playlist) {
    if (!playlist || playlist.length === 0) {
      console.error('[ViewManager] プレイリストが空です');
      return;
    }

    this.playlist = playlist;
    this.currentIndex = 0;

    console.log('[ViewManager] ローテーション開始:', playlist.length, '件のコンテンツ');

    // 最初のコンテンツを表示
    this._showContent(this.currentIndex);
  }

  /**
   * ステータスバーの表示/非表示を切替する
   * メインプロセスからSキー押下時に呼び出される
   */
  toggleStatusBar() {
    if (this.overlayView) {
      this.overlayView.webContents.send('toggle-status');
    }
  }

  /**
   * 指定インデックスのコンテンツをアクティブViewに読み込んで表示する
   *
   * @param {number} index - プレイリストのインデックス
   * @private
   */
  _showContent(index) {
    const content = this.playlist[index];
    console.log(`[ViewManager] コンテンツ表示: [${index}] ${content.name} (${content.duration}秒)`);
    console.log(`[ViewManager] URL: ${content.url}`);

    // アクティブViewにURLを読み込み
    this.activeView.webContents.loadURL(content.url)
      .then(() => {
        console.log(`[ViewManager] URL読み込み成功: ${content.name}`);
      })
      .catch((err) => {
        // 読み込みエラー時もローテーションは継続
        console.error(`[ViewManager] URL読み込みエラー: ${content.url}`, err.message);
      });

    // アクティブViewを前面に（オーバーレイの下）
    this.mainWindow.setTopBrowserView(this.activeView);
    this.mainWindow.setTopBrowserView(this.overlayView);

    // 次のコンテンツをスタンバイViewに即座に先読みする
    // フェード開始時には既にロード完了しているため、黒画面の時間がほぼゼロになる
    const nextIndex = (index + 1) % this.playlist.length;
    const nextContent = this.playlist[nextIndex];
    console.log(`[ViewManager] 先読み開始: [${nextIndex}] ${nextContent.name}`);
    this.preloadPromise = this.standbyView.webContents.loadURL(nextContent.url)
      .then(() => {
        console.log(`[ViewManager] 先読み完了: ${nextContent.name}`);
      })
      .catch((err) => {
        console.error(`[ViewManager] 先読みエラー: ${nextContent.url}`, err.message);
      });

    // ステータスバーを更新
    this._sendStatusUpdate(content.name, content.duration);

    // カウントダウン開始
    this.remainingSeconds = content.duration;
    this._startCountdown();

    // 前回のタイマーをクリア
    if (this.switchTimer) {
      clearTimeout(this.switchTimer);
    }

    // 指定秒数後に次のコンテンツへフェード切替
    this.switchTimer = setTimeout(() => {
      this._startFadeTransition();
    }, content.duration * 1000);
  }

  /**
   * フェード切替を開始する
   * オーバーレイを黒にフェードインし、完了通知を待つ
   *
   * @private
   */
  _startFadeTransition() {
    // 二重切替を防止
    if (this.isTransitioning) {
      console.log('[ViewManager] フェード遷移中のため切替をスキップ');
      return;
    }
    this.isTransitioning = true;

    // カウントダウンを停止
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }

    // 次のコンテンツのインデックスを計算（末尾→先頭にループ）
    const nextIndex = (this.currentIndex + 1) % this.playlist.length;
    const nextContent = this.playlist[nextIndex];

    console.log(`[ViewManager] フェード開始: 次のコンテンツ [${nextIndex}] ${nextContent.name}`);

    // 先読みは _showContent() で既に開始済み
    // preloadPromise は _onFadeComplete() でフェードアウト前に完了を待つ

    // オーバーレイにフェードイン指示を送信
    this.overlayView.webContents.send('fade-in');
  }

  /**
   * フェードイン完了通知を受信した時の処理
   * 先読みの完了を待ち、スタンバイViewを前面に移動してフェードアウトする
   *
   * 先読み（loadURL）が未完了のままフェードアウトすると、
   * スタンバイViewに前回のコンテンツが残っており一瞬見えてしまう問題を防止する
   *
   * @private
   */
  async _onFadeComplete() {
    // 先読みの完了を待つ（黒画面の状態で待機）
    if (this.preloadPromise) {
      await this.preloadPromise;
      this.preloadPromise = null;
    }

    // インデックスを進める
    this.currentIndex = (this.currentIndex + 1) % this.playlist.length;

    // プレイリスト末尾に到達した場合、保留中の新プレイリストに差し替え
    // 再生中のコンテンツが途中で消えることを防ぐため、ループ境界で切り替える
    if (this.currentIndex === 0 && this.pendingPlaylist) {
      console.log(`[ViewManager] プレイリスト差し替え: ${this.playlist.length}件 → ${this.pendingPlaylist.length}件`);
      this.playlist = this.pendingPlaylist;
      this.pendingPlaylist = null;
    }

    // View のアクティブ/スタンバイを入れ替え
    const temp = this.activeView;
    this.activeView = this.standbyView;
    this.standbyView = temp;

    // 新しいアクティブViewを前面に（オーバーレイの下）
    this.mainWindow.setTopBrowserView(this.activeView);
    this.mainWindow.setTopBrowserView(this.overlayView);

    // フェードアウト指示を送信
    this.overlayView.webContents.send('fade-out');

    // フェード遷移完了
    this.isTransitioning = false;

    const content = this.playlist[this.currentIndex];
    console.log(`[ViewManager] フェード完了: [${this.currentIndex}] ${content.name}`);

    // ステータスバーを更新
    this._sendStatusUpdate(content.name, content.duration);

    // カウントダウン開始
    this.remainingSeconds = content.duration;
    this._startCountdown();

    // 次のコンテンツをスタンバイViewに先読みする
    // フェード完了直後に開始するので、次のフェード開始時には既にロード完了済み
    const nextIndex = (this.currentIndex + 1) % this.playlist.length;
    const nextContent = this.playlist[nextIndex];
    console.log(`[ViewManager] 先読み開始: [${nextIndex}] ${nextContent.name}`);
    this.preloadPromise = this.standbyView.webContents.loadURL(nextContent.url)
      .then(() => {
        console.log(`[ViewManager] 先読み完了: ${nextContent.name}`);
      })
      .catch((err) => {
        console.error(`[ViewManager] 先読みエラー: ${nextContent.url}`, err.message);
      });

    // 次の切替タイマーをセット
    if (this.switchTimer) {
      clearTimeout(this.switchTimer);
    }
    this.switchTimer = setTimeout(() => {
      this._startFadeTransition();
    }, content.duration * 1000);
  }

  /**
   * ステータスバーの内容を更新するIPCメッセージを送信する
   *
   * @param {string} name - コンテンツ名
   * @param {number} remaining - 残り秒数
   * @private
   */
  _sendStatusUpdate(name, remaining) {
    if (this.overlayView) {
      this.overlayView.webContents.send('status-update', {
        name: name,
        remaining: remaining
      });
    }
  }

  /**
   * カウントダウンタイマーを開始する
   * 1秒ごとに残り秒数を更新してオーバーレイに送信
   *
   * @private
   */
  _startCountdown() {
    // 既存タイマーがあればクリア
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }

    // 1秒ごとに更新
    this.countdownTimer = setInterval(() => {
      this.remainingSeconds--;
      if (this.remainingSeconds < 0) {
        this.remainingSeconds = 0;
      }

      // オーバーレイに残り秒数を送信
      if (this.overlayView) {
        this.overlayView.webContents.send('status-update', {
          remaining: this.remainingSeconds
        });
      }
    }, 1000);
  }

  /**
   * 全ての BrowserView をウィンドウサイズに合わせてリサイズする
   *
   * @private
   */
  _resizeAllViews() {
    const bounds = this.mainWindow.getContentBounds();
    const viewBounds = { x: 0, y: 0, width: bounds.width, height: bounds.height };

    // 3つのViewすべてを同じサイズに設定
    if (this.contentViewA) this.contentViewA.setBounds(viewBounds);
    if (this.contentViewB) this.contentViewB.setBounds(viewBounds);
    if (this.overlayView) this.overlayView.setBounds(viewBounds);
  }

  // =====================================================
  // サーバー連携用メソッド（新規）
  // =====================================================

  /**
   * プレイリストの更新を予約する
   *
   * 即座に差し替えるのではなく、現在のプレイリストのループが
   * 末尾に到達した時点で新しいプレイリストに切り替える。
   * これにより再生中のコンテンツが途中で途切れることを防ぐ。
   *
   * @param {Array<{name: string, url: string, duration: number}>} newPlaylist - 新しいプレイリスト
   */
  updatePlaylist(newPlaylist) {
    if (!newPlaylist || newPlaylist.length === 0) {
      console.warn('[ViewManager] 空のプレイリストは無視します');
      return;
    }
    this.pendingPlaylist = newPlaylist;
    console.log('[ViewManager] プレイリスト更新予約:', newPlaylist.length, '件');
  }

  /**
   * 待機画面（時間帯外）を表示する
   *
   * ローテーションを停止し、コンテンツViewに standby.html を読み込む。
   * ScheduleManager の play-time-changed イベントで呼び出される。
   */
  showStandby() {
    this.isStandby = true;
    this._stopTimers();

    // アクティブViewに待機画面を読み込み
    const standbyPath = path.join(__dirname, '..', 'renderer', 'standby.html');
    this.activeView.webContents.loadFile(standbyPath);

    // ステータスバーを更新
    this._sendStatusUpdate('待機中（時間帯外）', 0);

    console.log('[ViewManager] 待機画面を表示');
  }

  /**
   * 待機画面から再生モードに復帰する
   *
   * 保留中のプレイリストがあればそちらを使い、
   * なければ現在のプレイリストでローテーションを再開する。
   */
  resumeFromStandby() {
    this.isStandby = false;

    // 保留中のプレイリストがあれば適用
    if (this.pendingPlaylist) {
      this.playlist = this.pendingPlaylist;
      this.pendingPlaylist = null;
    }

    // ローテーション再開
    if (this.playlist.length > 0) {
      this.startRotation(this.playlist);
    }

    console.log('[ViewManager] 待機画面から再生モードに復帰');
  }

  /**
   * 初回セットアップ画面を overlayView に表示する
   *
   * config.json が存在しない初回起動時に呼び出される。
   * overlayView に setup.html を読み込み、不透明な背景で全画面を覆う。
   */
  async showSetup() {
    const setupPath = path.join(__dirname, '..', 'renderer', 'setup.html');
    await this.overlayView.webContents.loadFile(setupPath);
    // セットアップ画面は不透明な背景なので、透明設定を一時的に無効化
    this.overlayView.setBackgroundColor('#1a1a2e');
    console.log('[ViewManager] セットアップ画面を表示');
  }

  /**
   * 通常のオーバーレイUI（index.html）に切り替える
   *
   * セットアップ完了後に呼び出され、ステータスバー + フェード用の
   * 通常のオーバーレイに戻す。
   */
  async showOverlay() {
    // 背景を透明に戻す（loadFile の前に設定する必要がある）
    // loadFile の後に設定すると、一瞬不透明な背景が表示されてしまう
    this.overlayView.setBackgroundColor('#00000000');
    const overlayPath = path.join(__dirname, '..', 'renderer', 'index.html');
    await this.overlayView.webContents.loadFile(overlayPath);
    console.log('[ViewManager] オーバーレイUIに切り替え');
  }

  /**
   * 全タイマーを停止する
   *
   * 待機画面表示時やローテーション停止時に使用。
   *
   * @private
   */
  _stopTimers() {
    if (this.switchTimer) {
      clearTimeout(this.switchTimer);
      this.switchTimer = null;
    }
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  /**
   * リソースを解放してローテーションを停止する
   */
  destroy() {
    console.log('[ViewManager] リソース解放中...');

    // タイマーを停止
    if (this.switchTimer) clearTimeout(this.switchTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);

    // IPCハンドラを解除
    ipcMain.removeAllListeners('fade-complete');

    console.log('[ViewManager] リソース解放完了');
  }
}

module.exports = ViewManager;
