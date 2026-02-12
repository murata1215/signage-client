/**
 * ハートビート送信モジュール
 *
 * 目的:
 *   管理画面のダッシュボードで端末の稼働状況を監視するため、
 *   定期的にサーバーへ POST リクエストを送信する。
 *   サーバーは last_seen_at を更新し、5分以内の通信があれば「稼働中」と判定する。
 *
 * 動作:
 *   - startHeartbeat() を呼び出すと即座に1回送信し、その後 intervalMs ごとに繰り返す
 *   - 送信失敗はログ出力のみ（サーバー復帰後に自動的に再開される）
 *   - stopHeartbeat() でループを停止
 *
 * 使用方法:
 *   const heartbeat = require('./heartbeat');
 *   heartbeat.startHeartbeat('http://server:3000', 'uuid-key', 60000);
 *   // アプリ終了時:
 *   heartbeat.stopHeartbeat();
 */

'use strict';

const serverClient = require('./server-client');

// =====================================================
// ハートビートタイマー管理
// =====================================================

/** @type {NodeJS.Timeout|null} ハートビート送信用のインターバルタイマー */
let heartbeatTimer = null;

/**
 * ハートビート送信ループを開始する
 *
 * 即座に1回送信してからインターバルを開始する。
 * 既にループが動作中の場合は一度停止してから再開する。
 *
 * @param {string} serverUrl - signage-server のベースURL
 * @param {string} clientKey - 端末識別用のUUID
 * @param {number} [intervalMs=60000] - 送信間隔（ミリ秒、デフォルト: 60秒）
 */
function startHeartbeat(serverUrl, clientKey, intervalMs = 60000) {
  // 既存のタイマーがあれば停止（二重起動防止）
  stopHeartbeat();

  console.log(`[heartbeat] ハートビート開始（間隔: ${intervalMs / 1000}秒）`);

  /**
   * 1回分のハートビート送信処理
   * 失敗してもエラーを投げず、次の送信タイミングで自動リトライ
   */
  async function sendOnce() {
    const success = await serverClient.sendHeartbeat(serverUrl, clientKey);
    if (success) {
      console.log('[heartbeat] ハートビート送信成功');
    }
    // 失敗時のログは server-client.js 側で出力済み
  }

  // 即座に1回送信（起動直後にサーバーに稼働状態を通知）
  sendOnce();

  // インターバルで定期送信を開始
  heartbeatTimer = setInterval(sendOnce, intervalMs);
}

/**
 * ハートビート送信ループを停止する
 *
 * アプリ終了時やサーバー接続先変更時に呼び出す。
 */
function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log('[heartbeat] ハートビート停止');
  }
}

// =====================================================
// エクスポート
// =====================================================

module.exports = {
  startHeartbeat,
  stopHeartbeat
};
