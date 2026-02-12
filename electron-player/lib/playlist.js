/**
 * プレイリスト定義モジュール
 *
 * 目的:
 *   サイネージプレーヤーで表示するコンテンツのリストを管理する。
 *   サーバーとの連携は ScheduleManager が担当するため、
 *   このモジュールはオフライン時のフォールバック用デフォルトプレイリストを提供する。
 *
 * 使用方法:
 *   const { getPlaylist, DEFAULT_PLAYLIST } = require('./playlist');
 *   const playlist = getPlaylist();  // オフラインフォールバック用
 */

'use strict';

// =====================================================
// プレイリスト型定義
// =====================================================

/**
 * 表示するコンテンツの型定義
 *
 * @typedef {Object} PlaylistItem
 * @property {string} name - コンテンツの表示名（ステータスバーに表示）
 * @property {string} url - 表示するURL
 * @property {number} duration - 表示時間（秒）
 * @property {string} [type] - コンテンツの種類（'web' | 'pdf'）
 * @property {number} [contentId] - コンテンツID（PDF キャッシュ用）
 */

// =====================================================
// デフォルトプレイリスト（フォールバック用固定値）
// =====================================================

/**
 * デフォルトのプレイリスト
 *
 * サーバーにもキャッシュにも接続できない場合のフォールバック用。
 * PoC 段階で使用していた固定コンテンツ。
 *
 * @type {PlaylistItem[]}
 */
const DEFAULT_PLAYLIST = [
  {
    name: 'Google News Japan',
    url: 'https://news.google.com/home?hl=ja&gl=JP&ceid=JP:ja',
    duration: 30,
    type: 'web'
  },
  {
    name: '社内サイネージ',
    url: 'http://10.20.249.224/aisignage/gnewsxgeminiapi/index.html',
    duration: 30,
    type: 'web'
  }
];

/**
 * デフォルトプレイリストを取得する
 *
 * サーバーとキャッシュの両方が利用できない場合の最終フォールバック。
 * PoC 時代の固定コンテンツを返す。
 *
 * @returns {PlaylistItem[]} デフォルトプレイリスト
 */
function getPlaylist() {
  console.log('[playlist] デフォルトプレイリストを使用します（フォールバック）');
  return DEFAULT_PLAYLIST;
}

module.exports = {
  getPlaylist,
  DEFAULT_PLAYLIST
};
