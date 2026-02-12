/**
 * サイネージ オーバーレイ レンダラースクリプト
 *
 * 目的:
 *   メインプロセスからのIPC通知を受け取り、
 *   ステータスバーの更新とフェードアニメーションを制御する。
 *
 * IPC通信:
 *   - 'status-update': ステータスバーの内容を更新（コンテンツ名・残り秒数）
 *   - 'fade-in': フェードオーバーレイを黒にフェードイン
 *   - 'fade-out': フェードオーバーレイを透明にフェードアウト
 *   - 'toggle-status': ステータスバーの表示/非表示を切替
 */

'use strict';

// =====================================================
// DOM要素の参照
// =====================================================

/** @type {HTMLElement} フェードオーバーレイ要素 */
const fadeOverlay = document.getElementById('fade-overlay');

/** @type {HTMLElement} ステータスバー要素 */
const statusBar = document.getElementById('status-bar');

/** @type {HTMLElement} コンテンツ名表示要素 */
const statusName = document.getElementById('status-name');

/** @type {HTMLElement} カウントダウン表示要素 */
const statusTimer = document.getElementById('status-timer');

/** @type {boolean} ステータスバー表示状態 */
let statusVisible = true;

// =====================================================
// IPC イベントハンドラ
// =====================================================

/**
 * ステータスバー更新イベント
 * メインプロセスからコンテンツ名と残り秒数を受信して表示を更新
 */
window.signageAPI.onStatusUpdate((data) => {
  // コンテンツ名を更新
  if (data.name !== undefined) {
    statusName.textContent = data.name;
  }
  // 残り秒数を更新
  if (data.remaining !== undefined) {
    statusTimer.textContent = `次の切替まで: ${data.remaining}秒`;
  }
});

/**
 * フェードインイベント
 * コンテンツ切替前にオーバーレイを黒にフェードイン（400ms）
 * アニメーション完了後にメインプロセスに通知
 */
window.signageAPI.onFadeIn(() => {
  fadeOverlay.classList.add('active');

  // CSSトランジション完了を待ってメインプロセスに通知
  // 400ms + 50ms のバッファを設けて確実にアニメーション完了を待つ
  setTimeout(() => {
    window.signageAPI.fadeComplete();
  }, 450);
});

/**
 * フェードアウトイベント
 * コンテンツ切替後にオーバーレイを透明にフェードアウト（400ms）
 */
window.signageAPI.onFadeOut(() => {
  fadeOverlay.classList.remove('active');
});

/**
 * ステータスバー表示切替イベント
 * Sキー押下時にメインプロセスから通知される
 */
window.signageAPI.onToggleStatus(() => {
  statusVisible = !statusVisible;
  statusBar.classList.toggle('hidden', !statusVisible);
});

// =====================================================
// 初期化ログ
// =====================================================
console.log('[overlay] オーバーレイ レンダラー初期化完了');
