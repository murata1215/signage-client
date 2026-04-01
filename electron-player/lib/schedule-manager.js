/**
 * スケジュール管理モジュール（中核モジュール）
 *
 * 目的:
 *   サーバーからのスケジュール取得、バージョン比較、プレイリスト変換、
 *   再生時間帯判定、バックグラウンドポーリングを統合的に管理する。
 *
 * 責務:
 *   - ポーリング制御（定期的なスケジュール取得）
 *   - version 比較によるスケジュール変更検知
 *   - サーバーレスポンス → PlaylistItem[] への変換
 *   - 再生時間帯の判定（play_start_time / play_end_time）
 *   - PDF ダウンロード・不要キャッシュの削除
 *
 * イベント:
 *   - 'schedule-updated': プレイリストが更新された時に emit（引数: newPlaylist）
 *   - 'play-time-changed': 再生時間帯の状態が変化した時に emit（引数: isPlayTime）
 *
 * 使用方法:
 *   const ScheduleManager = require('./schedule-manager');
 *   const sm = new ScheduleManager(config);
 *   sm.on('schedule-updated', (playlist) => { ... });
 *   sm.startPolling();
 */

'use strict';

const EventEmitter = require('events');
const path = require('path');
const serverClient = require('./server-client');
const cacheManager = require('./cache-manager');

/**
 * ScheduleManager クラス
 *
 * EventEmitter を継承し、スケジュール変更や時間帯変化をイベントとして通知する。
 * main.js がこのクラスのイベントを監視し、ViewManager を制御する。
 */
class ScheduleManager extends EventEmitter {
  /**
   * コンストラクタ
   *
   * @param {Object} config - 接続設定
   * @param {string} config.serverUrl - signage-server のベースURL
   * @param {string} config.clientKey - 端末識別用のUUID
   * @param {number} [config.pollingIntervalSec=60] - ポーリング間隔（秒）
   */
  constructor(config) {
    super();

    /** @type {string} サーバーURL */
    this.serverUrl = config.serverUrl;

    /** @type {string} クライアントキー */
    this.clientKey = config.clientKey;

    /** @type {number} ポーリング間隔（ミリ秒） */
    this.pollingIntervalMs = (config.pollingIntervalSec || 60) * 1000;

    /** @type {NodeJS.Timeout|null} ポーリングタイマー */
    this.pollingTimer = null;

    /** @type {NodeJS.Timeout|null} 再生時間帯チェックタイマー（毎分チェック） */
    this.playTimeCheckTimer = null;

    /** @type {boolean|null} 前回の再生時間帯状態（変化検知用） */
    this.lastPlayTimeState = null;

    /** @type {string|null} 現在のスケジュールの再生開始時刻 */
    this.playStartTime = null;

    /** @type {string|null} 現在のスケジュールの再生終了時刻 */
    this.playEndTime = null;

    /** @type {string} PDF ビューア HTML のパス */
    this.pdfViewerPath = path.join(__dirname, '..', 'renderer', 'pdf-viewer.html');
  }

  // =====================================================
  // ポーリング制御
  // =====================================================

  /**
   * バックグラウンドポーリングを開始する
   *
   * pollingIntervalMs ごとに pollOnce() を呼び出し、
   * スケジュールの変更を検知する。
   */
  startPolling() {
    // 既存タイマーがあれば停止
    this.stopPolling();

    console.log(`[schedule] ポーリング開始（間隔: ${this.pollingIntervalMs / 1000}秒）`);

    // インターバルでポーリング（初回は startPlayback で別途取得するのでスキップ）
    this.pollingTimer = setInterval(() => {
      this.pollOnce();
    }, this.pollingIntervalMs);
  }

  /**
   * ポーリングタイマーのみを停止する
   *
   * 注意: playTimeCheckTimer は停止しない。
   * 両方停止したい場合は stopAll() を使用すること。
   */
  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    console.log('[schedule] ポーリング停止');
  }

  /**
   * 再生時間帯チェックタイマーを停止する
   */
  stopPlayTimeCheck() {
    if (this.playTimeCheckTimer) {
      clearInterval(this.playTimeCheckTimer);
      this.playTimeCheckTimer = null;
    }
  }

  /**
   * 全タイマー（ポーリング + 再生時間帯チェック）を停止する
   *
   * アプリケーション終了時に使用する。
   */
  stopAll() {
    this.stopPolling();
    this.stopPlayTimeCheck();
    console.log('[schedule] 全タイマー停止');
  }

  /**
   * 1回分のポーリング処理を実行する
   *
   * サーバーからスケジュールを取得し、version が変わっていたら
   * キャッシュを更新して schedule-updated イベントを emit する。
   *
   * @returns {Promise<void>}
   */
  async pollOnce() {
    console.log('[schedule] ポーリング実行中...');

    // サーバーからスケジュール取得
    const scheduleData = await serverClient.fetchSchedule(this.serverUrl, this.clientKey);

    if (!scheduleData) {
      // サーバー接続失敗 → 何もしない（キャッシュで再生を継続）
      console.warn('[schedule] ポーリング: サーバー接続失敗、キャッシュで継続');
      return;
    }

    // version 比較
    const cachedVersion = cacheManager.getCachedVersion();

    if (cachedVersion !== null && scheduleData.version === cachedVersion) {
      // version 変更なし → 何もしない
      console.log(`[schedule] version 変更なし (v${cachedVersion})`);
      return;
    }

    console.log(`[schedule] version 変更検知: v${cachedVersion} → v${scheduleData.version}`);

    // キャッシュを更新
    cacheManager.saveScheduleCache(scheduleData);

    // 新しい PDF をダウンロード
    const pdfItems = scheduleData.playlist.filter((item) => item.type === 'pdf');
    console.log(`[schedule] PDF コンテンツ数: ${pdfItems.length}`);
    for (const item of pdfItems) {
      const isCached = cacheManager.isPdfCached(item.content_id);
      const cachePath = cacheManager.getPdfCachePath(item.content_id);
      console.log(`[schedule] PDF キャッシュ確認: contentId=${item.content_id}, name="${item.name}", キャッシュ済み=${isCached}, パス=${cachePath}`);
      if (!isCached) {
        await cacheManager.downloadAndCachePdf(this.serverUrl, this.clientKey, item.content_id);
      }
    }

    // 不要な PDF キャッシュを削除
    const currentPdfIds = pdfItems.map((item) => item.content_id);
    cacheManager.cleanupUnusedPdfs(currentPdfIds);

    // 再生時間帯を更新し、チェックタイマーにも反映する
    // サーバー側で再生時間帯が変更された場合、タイマーの参照値も即座に更新される
    this.startPlayTimeCheck(scheduleData.play_start_time, scheduleData.play_end_time);

    // PlaylistItem[] に変換して schedule-updated イベントを emit
    const playlist = this.convertToPlaylistItems(scheduleData);
    this.emit('schedule-updated', playlist);

    console.log(`[schedule] スケジュール更新完了: ${playlist.length} 件のコンテンツ`);
  }

  // =====================================================
  // プレイリスト変換
  // =====================================================

  /**
   * サーバーレスポンスを PlaylistItem[] 形式に変換する
   *
   * 既存の ViewManager が受け取るプレイリスト形式 { name, url, duration } に
   * サーバーのスケジュールデータを変換する。
   *
   * 変換ルール:
   *   - type="web": url をそのまま使用（use_proxy=true の場合はプロキシAPI経由に変換）
   *   - type="pdf": PDF ビューアの file:// URL を生成
   *
   * @param {Object} scheduleData - サーバーから取得したスケジュールデータ
   * @returns {Array<{name: string, url: string, duration: number, type: string, contentId?: number}>}
   */
  convertToPlaylistItems(scheduleData) {
    if (!scheduleData || !scheduleData.playlist || scheduleData.playlist.length === 0) {
      console.warn('[schedule] プレイリストが空です');
      return [];
    }

    return scheduleData.playlist.map((item) => {
      if (item.type === 'web') {
        // --- Web コンテンツ ---
        // サーバーの proxy API は使わず、元の URL をそのまま使用する。
        // Electron の session.setProxy()（proxy-rules.js）が既にプロキシ振り分けを
        // 正しく処理しているため：
        //   - 外部サイト（yahoo.co.jp 等）→ 社内プロキシ経由
        //   - 社内ネットワーク（10.x.x.x 等）→ 直接接続（バイパス）
        return {
          name: item.name,
          url: item.url,
          duration: item.duration_seconds,
          type: 'web'
        };
      } else if (item.type === 'pdf') {
        // --- PDF コンテンツ ---
        // pdfapp:// カスタムプロトコルで PDF ビューア HTML を配信する。
        // file:// プロトコルでは ESM（.mjs）の動的 import がブロックされるため、
        // カスタムプロトコルを使用して HTTP と同等のセキュリティコンテキストで読み込む。
        // クエリパラメータで PDF ファイルパスとページ表示秒数を渡す。
        const pdfCachePath = cacheManager.getPdfCachePath(item.content_id);
        const pdfViewerUrl = `pdfapp://local${this.pdfViewerPath}?file=${encodeURIComponent(pdfCachePath)}&pageDuration=${item.pdf_page_duration || 10}`;

        return {
          name: item.name,
          url: pdfViewerUrl,
          duration: item.duration_seconds,
          type: 'pdf',
          contentId: item.content_id
        };
      } else {
        // 不明な type の場合（将来の拡張に備えて）
        console.warn(`[schedule] 不明なコンテンツタイプ: ${item.type}`, item.name);
        return {
          name: item.name,
          url: 'about:blank',
          duration: item.duration_seconds,
          type: item.type
        };
      }
    });
  }

  // =====================================================
  // 再生時間帯判定
  // =====================================================

  /**
   * 現在時刻が再生時間帯内かどうかを判定する
   *
   * play_start_time 〜 play_end_time の間であれば true を返す。
   * 時刻は "HH:MM" 形式の文字列。
   *
   * @param {string} startTime - 再生開始時刻（例: "07:00"）
   * @param {string} endTime - 再生終了時刻（例: "20:00"）
   * @returns {boolean} 再生時間帯内なら true
   */
  isWithinPlayTime(startTime, endTime) {
    if (!startTime || !endTime) return true; // 時間帯未設定なら常に再生

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // "HH:MM" を分単位に変換
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    // 日をまたがない場合（例: 07:00 〜 20:00）
    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    // 日をまたぐ場合（例: 22:00 〜 06:00）
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  /**
   * 再生時間帯の定期チェックを開始する
   *
   * 毎分チェックし、再生時間帯の状態が変化した場合に
   * play-time-changed イベントを emit する。
   *
   * @param {string} startTime - 再生開始時刻
   * @param {string} endTime - 再生終了時刻
   */
  startPlayTimeCheck(startTime, endTime) {
    this.playStartTime = startTime;
    this.playEndTime = endTime;

    // 既存タイマーがあれば停止
    if (this.playTimeCheckTimer) {
      clearInterval(this.playTimeCheckTimer);
    }

    // 初回チェック
    this.lastPlayTimeState = this.isWithinPlayTime(startTime, endTime);

    // 毎分チェック（60秒間隔）
    this.playTimeCheckTimer = setInterval(() => {
      const isPlayTime = this.isWithinPlayTime(this.playStartTime, this.playEndTime);

      // 状態が変化した場合のみイベントを emit
      if (isPlayTime !== this.lastPlayTimeState) {
        console.log(`[schedule] 再生時間帯 変化: ${this.lastPlayTimeState} → ${isPlayTime}`);
        this.lastPlayTimeState = isPlayTime;
        this.emit('play-time-changed', isPlayTime);
      }
    }, 60000);
  }

  // =====================================================
  // 初回ロード
  // =====================================================

  /**
   * 初回のスケジュール取得とセットアップを行う
   *
   * サーバーから取得できた場合はキャッシュに保存し、
   * 失敗した場合はキャッシュからフォールバックする。
   *
   * @returns {Promise<{playlist: Array, scheduleData: Object|null}>}
   *   playlist: 変換済みの PlaylistItem 配列
   *   scheduleData: 元のスケジュールデータ（時間帯判定用）
   */
  async initialLoad() {
    console.log('[schedule] 初回スケジュール取得中...');

    // サーバーからスケジュール取得を試行
    const scheduleData = await serverClient.fetchSchedule(this.serverUrl, this.clientKey);

    if (scheduleData) {
      // --- サーバーから取得成功 ---
      console.log(`[schedule] サーバーから取得成功: version=${scheduleData.version}`);

      // キャッシュに保存
      cacheManager.saveScheduleCache(scheduleData);

      // PDF コンテンツをダウンロード
      const pdfItems = scheduleData.playlist.filter((item) => item.type === 'pdf');
      console.log(`[schedule] 初回ロード: PDF コンテンツ数=${pdfItems.length}`);
      for (const item of pdfItems) {
        const isCached = cacheManager.isPdfCached(item.content_id);
        const cachePath = cacheManager.getPdfCachePath(item.content_id);
        console.log(`[schedule] PDF キャッシュ確認: contentId=${item.content_id}, name="${item.name}", キャッシュ済み=${isCached}, パス=${cachePath}`);
        if (!isCached) {
          await cacheManager.downloadAndCachePdf(this.serverUrl, this.clientKey, item.content_id);
        }
      }

      // 再生時間帯を記録
      this.playStartTime = scheduleData.play_start_time;
      this.playEndTime = scheduleData.play_end_time;

      // PlaylistItem[] に変換
      const playlist = this.convertToPlaylistItems(scheduleData);
      return { playlist, scheduleData };
    }

    // --- サーバー接続失敗: キャッシュフォールバック ---
    console.warn('[schedule] サーバー接続失敗、キャッシュをチェック中...');
    const cachedData = cacheManager.loadScheduleCache();

    if (cachedData) {
      console.log(`[schedule] キャッシュから復元: version=${cachedData.version}`);
      this.playStartTime = cachedData.play_start_time;
      this.playEndTime = cachedData.play_end_time;

      const playlist = this.convertToPlaylistItems(cachedData);
      return { playlist, scheduleData: cachedData };
    }

    // --- キャッシュもない場合: 空のプレイリスト ---
    console.warn('[schedule] サーバーもキャッシュも利用不可');
    return { playlist: [], scheduleData: null };
  }
}

module.exports = ScheduleManager;
