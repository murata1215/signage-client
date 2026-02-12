/**
 * プリロードスクリプト（オーバーレイBrowserView用）
 *
 * 目的:
 *   メインプロセスとオーバーレイレンダラー間のIPC通信ブリッジを提供する。
 *   contextIsolation を有効にした状態で、安全にIPCチャネルを公開する。
 *
 * 公開API（window.signageAPI）:
 *
 *   --- オーバーレイ用（既存） ---
 *   - onStatusUpdate(callback): ステータスバー更新通知を受信
 *   - onFadeIn(callback): フェードイン通知を受信
 *   - onFadeOut(callback): フェードアウト通知を受信
 *   - onToggleStatus(callback): ステータスバー表示切替通知を受信
 *   - fadeComplete(): フェードアニメーション完了をメインプロセスに通知
 *
 *   --- セットアップ画面用（新規） ---
 *   - testConnection(serverUrl, clientKey): 接続テストをメインプロセスに依頼
 *   - onTestConnectionResult(callback): テスト結果を受信
 *   - saveConfig(config): 設定保存をメインプロセスに依頼
 *   - onConfigSaved(callback): 保存完了通知を受信
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('signageAPI', {
  // =========================================================
  // オーバーレイ用 IPC（既存）
  // =========================================================

  /**
   * ステータスバー更新通知を受信する
   * @param {function({name: string, remaining: number}): void} callback - 更新データを受け取るコールバック
   */
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (_event, data) => callback(data));
  },

  /**
   * フェードイン（黒画面への遷移）通知を受信する
   * @param {function(): void} callback - フェードイン開始時に呼ばれるコールバック
   */
  onFadeIn: (callback) => {
    ipcRenderer.on('fade-in', () => callback());
  },

  /**
   * フェードアウト（黒画面からの復帰）通知を受信する
   * @param {function(): void} callback - フェードアウト開始時に呼ばれるコールバック
   */
  onFadeOut: (callback) => {
    ipcRenderer.on('fade-out', () => callback());
  },

  /**
   * ステータスバー表示切替通知を受信する
   * @param {function(): void} callback - 切替時に呼ばれるコールバック
   */
  onToggleStatus: (callback) => {
    ipcRenderer.on('toggle-status', () => callback());
  },

  /**
   * フェードアニメーション完了をメインプロセスに通知する
   * オーバーレイのフェードイン完了後に呼び出す
   */
  fadeComplete: () => {
    ipcRenderer.send('fade-complete');
  },

  // =========================================================
  // セットアップ画面用 IPC（新規）
  // =========================================================

  /**
   * 接続テストをメインプロセスに依頼する
   *
   * メインプロセスは server-client.js の testConnection() を実行し、
   * 結果を 'test-connection-result' チャネルで返す。
   *
   * @param {string} serverUrl - テスト対象のサーバーURL
   * @param {string} clientKey - テスト対象のクライアントキー
   */
  testConnection: (serverUrl, clientKey) => {
    ipcRenderer.send('test-connection', { serverUrl, clientKey });
  },

  /**
   * 接続テスト結果を受信する
   *
   * @param {function({success: boolean, message: string}): void} callback - テスト結果を受け取るコールバック
   */
  onTestConnectionResult: (callback) => {
    ipcRenderer.on('test-connection-result', (_event, result) => callback(result));
  },

  /**
   * 設定保存をメインプロセスに依頼する
   *
   * メインプロセスは config-manager.js の saveConfig() を実行し、
   * 完了後に 'config-saved' チャネルで通知する。
   *
   * @param {Object} config - 保存する設定データ
   * @param {string} config.serverUrl - サーバーURL
   * @param {string} config.clientKey - クライアントキー
   * @param {number} config.pollingIntervalSec - ポーリング間隔（秒）
   */
  saveConfig: (config) => {
    ipcRenderer.send('save-config', config);
  },

  /**
   * 設定保存完了通知を受信する
   *
   * メインプロセスが config.json の保存を完了し、
   * コンテンツ再生を開始する準備ができた時に呼ばれる。
   *
   * @param {function(): void} callback - 保存完了時に呼ばれるコールバック
   */
  onConfigSaved: (callback) => {
    ipcRenderer.on('config-saved', () => callback());
  }
});
