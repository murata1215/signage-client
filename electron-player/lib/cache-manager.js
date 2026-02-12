/**
 * キャッシュ管理モジュール
 *
 * 目的:
 *   スケジュールデータと PDF ファイルをローカルにキャッシュし、
 *   オフライン時のフォールバックとバージョン管理を提供する。
 *
 * キャッシュディレクトリ構造:
 *   {userData}/
 *     cache/
 *       schedule.json              — スケジュール全体のキャッシュ（version含む）
 *       pdf/
 *         content-{contentId}.pdf  — PDF ファイル本体
 *
 * バージョン管理:
 *   schedule.json 内の version 番号を使用して、サーバー側の変更を検知する。
 *   ポーリング時に version が変わっていたらスケジュールを再取得し、
 *   新しい PDF があればダウンロードする。
 *
 * 使用方法:
 *   const cacheManager = require('./cache-manager');
 *   cacheManager.ensureCacheDir();
 *   await cacheManager.saveScheduleCache(scheduleData);
 *   const cached = cacheManager.loadScheduleCache();
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const serverClient = require('./server-client');

// =====================================================
// 定数
// =====================================================

/** @type {string} キャッシュディレクトリ名 */
const CACHE_DIR = 'cache';

/** @type {string} PDFキャッシュサブディレクトリ名 */
const PDF_DIR = 'pdf';

/** @type {string} スケジュールキャッシュファイル名 */
const SCHEDULE_CACHE_FILENAME = 'schedule.json';

// =====================================================
// パス取得ヘルパー
// =====================================================

/**
 * キャッシュルートディレクトリのパスを返す
 * @returns {string} キャッシュディレクトリの絶対パス
 */
function getCacheDir() {
  return path.join(app.getPath('userData'), CACHE_DIR);
}

/**
 * PDF キャッシュディレクトリのパスを返す
 * @returns {string} PDF キャッシュディレクトリの絶対パス
 */
function getPdfDir() {
  return path.join(getCacheDir(), PDF_DIR);
}

/**
 * スケジュールキャッシュファイルのパスを返す
 * @returns {string} schedule.json の絶対パス
 */
function getScheduleCachePath() {
  return path.join(getCacheDir(), SCHEDULE_CACHE_FILENAME);
}

/**
 * 指定コンテンツID の PDF キャッシュファイルパスを返す
 *
 * @param {number} contentId - コンテンツ ID
 * @returns {string} PDF ファイルの絶対パス
 */
function getPdfCachePath(contentId) {
  return path.join(getPdfDir(), `content-${contentId}.pdf`);
}

// =====================================================
// ディレクトリ管理
// =====================================================

/**
 * キャッシュディレクトリを作成する
 *
 * cache/ と cache/pdf/ ディレクトリが存在しない場合に作成する。
 * recursive: true を指定して親ディレクトリも含めて自動作成。
 */
function ensureCacheDir() {
  const pdfDir = getPdfDir();
  if (!fs.existsSync(pdfDir)) {
    fs.mkdirSync(pdfDir, { recursive: true });
    console.log('[cache] キャッシュディレクトリ作成:', pdfDir);
  }
}

// =====================================================
// スケジュールキャッシュ
// =====================================================

/**
 * スケジュールデータをキャッシュに保存する
 *
 * サーバーから取得したスケジュール全体（version, play_start_time, play_end_time, playlist）
 * を JSON ファイルとして保存する。
 *
 * @param {Object} scheduleData - サーバーから取得したスケジュールデータ
 */
function saveScheduleCache(scheduleData) {
  ensureCacheDir();
  const cachePath = getScheduleCachePath();
  fs.writeFileSync(cachePath, JSON.stringify(scheduleData, null, 2), 'utf-8');
  console.log(`[cache] スケジュールキャッシュ保存: version=${scheduleData.version}`);
}

/**
 * キャッシュからスケジュールデータを読み込む
 *
 * キャッシュが存在しない場合や読み込みに失敗した場合は null を返す。
 * オフライン時のフォールバックとして使用する。
 *
 * @returns {Object|null} スケジュールデータ、またはキャッシュなし時 null
 */
function loadScheduleCache() {
  const cachePath = getScheduleCachePath();

  if (!fs.existsSync(cachePath)) {
    console.log('[cache] スケジュールキャッシュが見つかりません');
    return null;
  }

  try {
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const data = JSON.parse(raw);
    console.log(`[cache] スケジュールキャッシュ読み込み: version=${data.version}`);
    return data;
  } catch (err) {
    console.error('[cache] スケジュールキャッシュ読み込みエラー:', err.message);
    return null;
  }
}

/**
 * キャッシュ済みスケジュールの version 番号を返す
 *
 * ポーリング時にサーバーから取得した version と比較して、
 * スケジュールの変更を検知するために使用する。
 *
 * @returns {number|null} キャッシュされた version 番号、またはキャッシュなし時 null
 */
function getCachedVersion() {
  const data = loadScheduleCache();
  return data ? data.version : null;
}

// =====================================================
// PDF キャッシュ
// =====================================================

/**
 * 指定コンテンツの PDF がキャッシュ済みかどうかを確認する
 *
 * @param {number} contentId - コンテンツ ID
 * @returns {boolean} キャッシュ済みなら true
 */
function isPdfCached(contentId) {
  return fs.existsSync(getPdfCachePath(contentId));
}

/**
 * PDF ファイルをサーバーからダウンロードしてキャッシュに保存する
 *
 * server-client.js の downloadPdf を呼び出し、
 * cache/pdf/content-{contentId}.pdf に保存する。
 *
 * @param {string} serverUrl - signage-server のベースURL
 * @param {string} clientKey - 端末識別用のUUID
 * @param {number} contentId - コンテンツ ID
 * @returns {Promise<boolean>} ダウンロード＆保存成功なら true
 */
async function downloadAndCachePdf(serverUrl, clientKey, contentId) {
  ensureCacheDir();
  const destPath = getPdfCachePath(contentId);
  console.log(`[cache] PDF ダウンロード開始: contentId=${contentId}`);

  const success = await serverClient.downloadPdf(serverUrl, clientKey, contentId, destPath);
  if (success) {
    console.log(`[cache] PDF キャッシュ完了: contentId=${contentId}`);
  }
  return success;
}

/**
 * 現在のプレイリストに含まれない PDF キャッシュを削除する
 *
 * スケジュール更新時に呼び出し、不要になった PDF ファイルを
 * 削除してディスク使用量を節約する。
 *
 * @param {number[]} currentContentIds - 現在のプレイリストに含まれる PDF コンテンツの ID 配列
 */
function cleanupUnusedPdfs(currentContentIds) {
  const pdfDir = getPdfDir();

  // PDF ディレクトリが存在しない場合は何もしない
  if (!fs.existsSync(pdfDir)) return;

  const files = fs.readdirSync(pdfDir);
  let removedCount = 0;

  files.forEach((filename) => {
    // ファイル名から contentId を抽出（content-{id}.pdf の形式）
    const match = filename.match(/^content-(\d+)\.pdf$/);
    if (!match) return;

    const cachedContentId = parseInt(match[1], 10);

    // 現在のプレイリストに含まれないファイルを削除
    if (!currentContentIds.includes(cachedContentId)) {
      const filePath = path.join(pdfDir, filename);
      fs.unlinkSync(filePath);
      removedCount++;
      console.log(`[cache] 不要な PDF を削除: ${filename}`);
    }
  });

  if (removedCount > 0) {
    console.log(`[cache] ${removedCount} 件の不要な PDF を削除しました`);
  }
}

// =====================================================
// エクスポート
// =====================================================

module.exports = {
  ensureCacheDir,
  getCacheDir,
  getPdfDir,
  getPdfCachePath,
  saveScheduleCache,
  loadScheduleCache,
  getCachedVersion,
  isPdfCached,
  downloadAndCachePdf,
  cleanupUnusedPdfs
};
