/**
 * 設定管理モジュール
 *
 * 目的:
 *   サイネージクライアントの接続設定（サーバーURL、クライアントキー等）を
 *   config.json ファイルで永続化する。
 *
 * 保存先:
 *   Electron の app.getPath('userData') 配下に config.json を保存。
 *   Linux の場合: ~/.config/signage-client/config.json
 *   これにより、アプリ更新時にも設定が維持される。
 *
 * 使用方法:
 *   const configManager = require('./config-manager');
 *   const config = configManager.loadConfig();
 *   configManager.saveConfig({ serverUrl: '...', clientKey: '...' });
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// =====================================================
// 定数
// =====================================================

/** @type {string} 設定ファイル名 */
const CONFIG_FILENAME = 'config.json';

/** @type {number} デフォルトのポーリング間隔（秒） */
const DEFAULT_POLLING_INTERVAL_SEC = 60;

// =====================================================
// 設定ファイルパス取得
// =====================================================

/**
 * config.json の絶対パスを返す
 *
 * app.getPath('userData') を使用して OS に依存しない保存先を取得する。
 * Linux: ~/.config/signage-client/config.json
 * Windows: %APPDATA%/signage-client/config.json
 * macOS: ~/Library/Application Support/signage-client/config.json
 *
 * @returns {string} config.json の絶対パス
 */
function getConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

// =====================================================
// 設定の読み込み
// =====================================================

/**
 * config.json を読み込んで設定オブジェクトを返す
 *
 * ファイルが存在しない場合や JSON パースに失敗した場合は null を返す。
 * null が返った場合、呼び出し元は初回セットアップ画面を表示する。
 *
 * @returns {ConfigData|null} 設定データ、または未設定/エラー時は null
 *
 * @typedef {Object} ConfigData
 * @property {string} serverUrl - signage-server のベースURL（例: http://192.168.1.100:3000）
 * @property {string} clientKey - 端末識別用のUUID
 * @property {number} pollingIntervalSec - ポーリング間隔（秒、デフォルト: 60）
 */
function loadConfig() {
  const configPath = getConfigPath();

  // ファイルが存在しない場合は null を返す（初回起動時）
  if (!fs.existsSync(configPath)) {
    console.log('[config] config.json が見つかりません（初回起動）');
    return null;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // 必須フィールドのバリデーション
    if (!config.serverUrl || !config.clientKey) {
      console.warn('[config] config.json に必須フィールドがありません');
      return null;
    }

    // デフォルト値の補完
    if (!config.pollingIntervalSec) {
      config.pollingIntervalSec = DEFAULT_POLLING_INTERVAL_SEC;
    }

    console.log('[config] 設定読み込み完了:', {
      serverUrl: config.serverUrl,
      clientKey: config.clientKey.substring(0, 8) + '...',  // セキュリティのため一部のみ表示
      pollingIntervalSec: config.pollingIntervalSec
    });

    return config;
  } catch (err) {
    // JSON パースエラーやファイル読み込みエラー
    console.error('[config] config.json の読み込みに失敗:', err.message);
    return null;
  }
}

// =====================================================
// 設定の保存
// =====================================================

/**
 * 設定データを config.json に保存する
 *
 * 保存先ディレクトリが存在しない場合は自動的に作成する。
 * 保存後のファイルは JSON のインデント付きで可読性を確保。
 *
 * @param {Object} config - 保存する設定データ
 * @param {string} config.serverUrl - signage-server のベースURL
 * @param {string} config.clientKey - 端末識別用のUUID
 * @param {number} [config.pollingIntervalSec=60] - ポーリング間隔（秒）
 */
function saveConfig(config) {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);

  // 保存先ディレクトリが存在しない場合は作成（recursive: true で親ディレクトリも作成）
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // デフォルト値の補完
  const dataToSave = {
    serverUrl: config.serverUrl,
    clientKey: config.clientKey,
    pollingIntervalSec: config.pollingIntervalSec || DEFAULT_POLLING_INTERVAL_SEC
  };

  // JSON 形式で保存（インデント2スペース）
  fs.writeFileSync(configPath, JSON.stringify(dataToSave, null, 2), 'utf-8');
  console.log('[config] 設定を保存しました:', configPath);
}

// =====================================================
// エクスポート
// =====================================================

module.exports = {
  loadConfig,
  saveConfig,
  getConfigPath,
  DEFAULT_POLLING_INTERVAL_SEC
};
