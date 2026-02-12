/**
 * サイネージプレーヤー メインスクリプト
 *
 * 目的:
 *   固定のプレイリスト（2つのURL）を交互にフルスクリーン表示する。
 *   将来的にはサーバーAPIからスケジュールを取得する形に拡張予定。
 *
 * 動作の流れ:
 *   1. プレイリストの最初のURLをiframe Aに読み込み表示
 *   2. タイマーで指定秒数後にiframe Bに次のURLを読み込み
 *   3. フェードアニメーションで切替
 *   4. 以降ループ
 *
 * 技術ポイント:
 *   - 2つのiframeを交互に使うことで、切替時の白画面を防止
 *   - 次のコンテンツを裏で先読みしてからフェードで切替
 */

// =====================================================
// プレイリスト定義
// =====================================================

/**
 * 表示するコンテンツのリスト
 * 将来的にはAPIから取得するが、PoC段階では固定値
 *
 * @type {Array<{name: string, url: string, duration: number}>}
 * @property {string} name - コンテンツの表示名（ステータスバー用）
 * @property {string} url - 表示するURL
 * @property {number} duration - 表示時間（秒）
 */
const PLAYLIST = [
  {
    name: "Yahoo! JAPAN",
    url: "https://www.yahoo.co.jp",
    duration: 30
  },
  {
    name: "社内サイネージ",
    url: "http://10.20.249.224/aisignage/gnewsxgeminiapi/index.html",
    duration: 30
  }
];

// =====================================================
// プレーヤー本体クラス
// =====================================================

/**
 * SignagePlayer クラス
 *
 * 責務:
 *   プレイリストに基づいてコンテンツを順番に表示する。
 *   2つのiframeを交互に使い、フェード切替で滑らかに遷移する。
 *
 * 使用方法:
 *   const player = new SignagePlayer(playlist);
 *   player.start();
 */
class SignagePlayer {
  /**
   * コンストラクタ
   *
   * @param {Array<{name: string, url: string, duration: number}>} playlist - 表示コンテンツリスト
   */
  constructor(playlist) {
    /** @type {Array} プレイリスト */
    this.playlist = playlist;

    /** @type {number} 現在表示中のプレイリストインデックス */
    this.currentIndex = 0;

    /** @type {HTMLIFrameElement} iframe要素A（交互表示用） */
    this.iframeA = document.getElementById("iframe-a");

    /** @type {HTMLIFrameElement} iframe要素B（交互表示用） */
    this.iframeB = document.getElementById("iframe-b");

    /** @type {HTMLIFrameElement} 現在表示中のiframe */
    this.activeIframe = this.iframeA;

    /** @type {HTMLIFrameElement} 裏で待機中のiframe */
    this.standbyIframe = this.iframeB;

    /** @type {HTMLElement} コンテンツ名表示要素 */
    this.statusName = document.getElementById("status-name");

    /** @type {HTMLElement} カウントダウン表示要素 */
    this.statusTimer = document.getElementById("status-timer");

    /** @type {HTMLElement} ステータスバー要素 */
    this.statusBar = document.getElementById("status-bar");

    /** @type {number|null} 切替タイマーID */
    this.switchTimer = null;

    /** @type {number|null} カウントダウンタイマーID */
    this.countdownTimer = null;

    /** @type {number} 残り秒数 */
    this.remainingSeconds = 0;

    /** @type {boolean} ステータスバー表示フラグ */
    this.statusVisible = true;
  }

  /**
   * プレーヤーを開始する
   * 最初のコンテンツを読み込み、タイマーを開始する
   */
  start() {
    console.log("[SignagePlayer] プレーヤー開始");
    console.log("[SignagePlayer] プレイリスト:", this.playlist);

    // キーボードイベントを登録（ステータスバー表示切替用）
    this._setupKeyboardEvents();

    // 最初のコンテンツを表示
    this._showContent(this.currentIndex);
  }

  /**
   * 指定インデックスのコンテンツを表示する
   *
   * @param {number} index - プレイリストのインデックス
   * @private
   */
  _showContent(index) {
    const content = this.playlist[index];
    console.log(`[SignagePlayer] コンテンツ切替: [${index}] ${content.name} (${content.duration}秒)`);

    // アクティブiframeにURLを読み込み
    this.activeIframe.src = content.url;
    this.activeIframe.classList.remove("hidden");
    this.activeIframe.classList.add("active");

    // スタンバイiframeを非表示に
    this.standbyIframe.classList.remove("active");
    this.standbyIframe.classList.add("hidden");

    // ステータスバーを更新
    this._updateStatus(content);

    // カウントダウン開始
    this.remainingSeconds = content.duration;
    this._startCountdown();

    // 前回のタイマーをクリア
    if (this.switchTimer) {
      clearTimeout(this.switchTimer);
    }

    // 指定秒数後に次のコンテンツへ切替
    this.switchTimer = setTimeout(() => {
      this._switchToNext();
    }, content.duration * 1000);
  }

  /**
   * 次のコンテンツに切り替える
   * iframeのアクティブ/スタンバイを入れ替えてフェード遷移
   *
   * @private
   */
  _switchToNext() {
    // カウントダウンを停止
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }

    // インデックスを次に進める（末尾に達したら先頭に戻る）
    this.currentIndex = (this.currentIndex + 1) % this.playlist.length;

    // iframe のアクティブ/スタンバイを入れ替え
    const temp = this.activeIframe;
    this.activeIframe = this.standbyIframe;
    this.standbyIframe = temp;

    // 次のコンテンツを表示
    this._showContent(this.currentIndex);
  }

  /**
   * ステータスバーの表示を更新する
   *
   * @param {{name: string, url: string, duration: number}} content - 現在のコンテンツ情報
   * @private
   */
  _updateStatus(content) {
    if (this.statusName) {
      this.statusName.textContent = content.name;
    }
  }

  /**
   * カウントダウンタイマーを開始する
   * 1秒ごとに残り秒数を更新してステータスバーに表示
   *
   * @private
   */
  _startCountdown() {
    // 既存タイマーがあればクリア
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }

    // 初期表示
    this._updateCountdown();

    // 1秒ごとに更新
    this.countdownTimer = setInterval(() => {
      this.remainingSeconds--;
      if (this.remainingSeconds < 0) {
        this.remainingSeconds = 0;
      }
      this._updateCountdown();
    }, 1000);
  }

  /**
   * カウントダウン表示を更新する
   *
   * @private
   */
  _updateCountdown() {
    if (this.statusTimer) {
      this.statusTimer.textContent = `次の切替まで: ${this.remainingSeconds}秒`;
    }
  }

  /**
   * キーボードイベントを設定する
   * - Sキー: ステータスバーの表示/非表示を切替
   * - Escキー: プレーヤー停止（デバッグ用）
   *
   * @private
   */
  _setupKeyboardEvents() {
    document.addEventListener("keydown", (e) => {
      // Sキー: ステータスバー表示切替
      if (e.key === "s" || e.key === "S") {
        this.statusVisible = !this.statusVisible;
        if (this.statusBar) {
          this.statusBar.classList.toggle("hidden", !this.statusVisible);
        }
        console.log(`[SignagePlayer] ステータスバー: ${this.statusVisible ? "表示" : "非表示"}`);
      }
    });
  }
}

// =====================================================
// 初期化: ページ読み込み完了後にプレーヤーを起動
// =====================================================
document.addEventListener("DOMContentLoaded", () => {
  console.log("[SignagePlayer] DOMContentLoaded - 初期化開始");

  // プレーヤーインスタンスを作成して開始
  const player = new SignagePlayer(PLAYLIST);
  player.start();
});
