/**
 * サーバーAPI通信クライアントモジュール
 *
 * 目的:
 *   signage-server の Player API との HTTP 通信を一元管理する。
 *   Electron の net モジュールを使用することで、session に設定された
 *   プロキシ設定が自動的に適用される。
 *
 * 対応エンドポイント:
 *   - GET  /api/player/schedule?key={client_key}       — スケジュール取得
 *   - GET  /api/player/content/:id/file?key={client_key} — PDF ダウンロード
 *   - POST /api/player/heartbeat?key={client_key}      — ハートビート送信
 *
 * 使用方法:
 *   const serverClient = require('./server-client');
 *   const schedule = await serverClient.fetchSchedule(serverUrl, clientKey);
 */

'use strict';

const { net } = require('electron');
const fs = require('fs');

// =====================================================
// スケジュール取得
// =====================================================

/**
 * サーバーからマージ済みスケジュール（プレイリスト）を取得する
 *
 * サーバーは global スケジュール と client 個別スケジュールをマージして返す。
 * version 番号を含み、キャッシュ無効化の判定に使用する。
 *
 * @param {string} serverUrl - signage-server のベースURL（例: http://192.168.1.100:3000）
 * @param {string} clientKey - 端末識別用のUUID
 * @returns {Promise<ScheduleData|null>} スケジュールデータ、またはエラー時 null
 *
 * @typedef {Object} ScheduleData
 * @property {number} version - スケジュール変更バージョン番号
 * @property {string} play_start_time - 再生開始時刻（例: "07:00"）
 * @property {string} play_end_time - 再生終了時刻（例: "20:00"）
 * @property {Array<ScheduleItem>} playlist - 再生コンテンツの配列
 *
 * @typedef {Object} ScheduleItem
 * @property {number} id - schedule_contents テーブルの ID
 * @property {string} scope - "global" または "client"
 * @property {number} content_id - コンテンツ ID
 * @property {string} name - コンテンツ名
 * @property {string} type - "pdf" または "web"
 * @property {string} [file_url] - PDF ダウンロード URL（type=pdf のみ）
 * @property {string} [url] - Web コンテンツの URL（type=web のみ）
 * @property {number} [pdf_page_duration] - PDF 1ページの表示秒数（type=pdf のみ）
 * @property {number} duration_seconds - コンテンツ全体の表示秒数
 * @property {number} display_order - 表示順
 * @property {boolean} use_proxy - プロキシ使用フラグ
 * @property {string|null} proxy_url - プロキシ URL
 */
async function fetchSchedule(serverUrl, clientKey) {
  const url = `${serverUrl}/api/player/schedule?key=${encodeURIComponent(clientKey)}`;
  console.log('[server-client] スケジュール取得:', url);

  try {
    const response = await net.fetch(url);

    if (!response.ok) {
      console.error(`[server-client] スケジュール取得失敗: HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[server-client] スケジュール取得成功: version=${data.version}, コンテンツ数=${data.playlist.length}`);
    return data;
  } catch (err) {
    console.error('[server-client] スケジュール取得エラー:', err.message);
    return null;
  }
}

// =====================================================
// ハートビート送信
// =====================================================

/**
 * サーバーにハートビートを送信する
 *
 * 管理画面のダッシュボードで端末の稼働状況を監視するため、
 * 定期的にこの関数を呼び出して last_seen_at を更新する。
 * サーバーは 5分以内の通信があれば「稼働中」と判定する。
 *
 * @param {string} serverUrl - signage-server のベースURL
 * @param {string} clientKey - 端末識別用のUUID
 * @returns {Promise<boolean>} 送信成功なら true、失敗なら false
 */
async function sendHeartbeat(serverUrl, clientKey) {
  const url = `${serverUrl}/api/player/heartbeat?key=${encodeURIComponent(clientKey)}`;

  try {
    const response = await net.fetch(url, { method: 'POST' });

    if (!response.ok) {
      console.warn(`[server-client] ハートビート送信失敗: HTTP ${response.status}`);
      return false;
    }

    return true;
  } catch (err) {
    // ネットワークエラーは警告のみ（サーバー復帰後に自動回復）
    console.warn('[server-client] ハートビート送信エラー:', err.message);
    return false;
  }
}

// =====================================================
// PDF ダウンロード
// =====================================================

/**
 * PDF ファイルをサーバーからダウンロードしてローカルに保存する
 *
 * サーバーの /api/player/content/:id/file エンドポイントから
 * PDF バイナリを取得し、指定パスに書き込む。
 *
 * @param {string} serverUrl - signage-server のベースURL
 * @param {string} clientKey - 端末識別用のUUID
 * @param {number} contentId - コンテンツ ID
 * @param {string} destPath - 保存先のローカルファイルパス
 * @returns {Promise<boolean>} ダウンロード成功なら true、失敗なら false
 */
async function downloadPdf(serverUrl, clientKey, contentId, destPath) {
  const url = `${serverUrl}/api/player/content/${contentId}/file?key=${encodeURIComponent(clientKey)}`;
  console.log(`[server-client] PDF ダウンロード: contentId=${contentId}`);

  try {
    const response = await net.fetch(url);

    if (!response.ok) {
      console.error(`[server-client] PDF ダウンロード失敗: HTTP ${response.status}, contentId=${contentId}`);
      return false;
    }

    // レスポンスボディを ArrayBuffer として取得し、Buffer に変換して保存
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destPath, buffer);

    console.log(`[server-client] PDF 保存完了: ${destPath} (${buffer.length} bytes)`);
    return true;
  } catch (err) {
    console.error(`[server-client] PDF ダウンロードエラー: contentId=${contentId}`, err.message);
    return false;
  }
}

// =====================================================
// 接続テスト
// =====================================================

/**
 * サーバーへの接続をテストする
 *
 * 初回セットアップ画面で「接続テスト」ボタン押下時に呼び出す。
 * fetchSchedule を実行し、結果を成功/失敗メッセージとして返す。
 *
 * @param {string} serverUrl - signage-server のベースURL
 * @param {string} clientKey - 端末識別用のUUID
 * @returns {Promise<{success: boolean, message: string}>} テスト結果
 */
async function testConnection(serverUrl, clientKey) {
  const url = `${serverUrl}/api/player/schedule?key=${encodeURIComponent(clientKey)}`;

  try {
    const response = await net.fetch(url);

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        message: `接続成功（コンテンツ ${data.playlist.length} 件）`
      };
    }

    // HTTP エラーレスポンスの場合
    if (response.status === 401) {
      return { success: false, message: 'Client Key が無効です' };
    }
    if (response.status === 404) {
      return { success: false, message: 'サーバーが見つかりません（URLを確認してください）' };
    }
    return { success: false, message: `サーバーエラー (HTTP ${response.status})` };
  } catch (err) {
    // ネットワーク接続エラー
    return { success: false, message: `接続失敗: ${err.message}` };
  }
}

// =====================================================
// エクスポート
// =====================================================

module.exports = {
  fetchSchedule,
  sendHeartbeat,
  downloadPdf,
  testConnection
};
