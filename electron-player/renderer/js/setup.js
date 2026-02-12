/**
 * 初回セットアップ画面 レンダラースクリプト
 *
 * 目的:
 *   サーバーURLとクライアントキーの入力フォームを制御する。
 *   接続テストと設定保存をメインプロセスに IPC で依頼する。
 *
 * IPC通信:
 *   - signageAPI.testConnection(serverUrl, clientKey)
 *     → メインプロセスに接続テストを依頼
 *   - signageAPI.onTestConnectionResult({ success, message })
 *     → テスト結果を受信してUIを更新
 *   - signageAPI.saveConfig({ serverUrl, clientKey, pollingIntervalSec })
 *     → 設定をメインプロセスに保存依頼
 *   - signageAPI.onConfigSaved()
 *     → 保存完了通知を受信（メインプロセスが再生を開始する）
 */

'use strict';

// =====================================================
// DOM 要素の参照
// =====================================================

/** @type {HTMLInputElement} サーバーURL入力欄 */
const serverUrlInput = document.getElementById('server-url');

/** @type {HTMLInputElement} クライアントキー入力欄 */
const clientKeyInput = document.getElementById('client-key');

/** @type {HTMLButtonElement} 接続テストボタン */
const btnTest = document.getElementById('btn-test');

/** @type {HTMLButtonElement} 保存して開始ボタン */
const btnSave = document.getElementById('btn-save');

/** @type {HTMLElement} テスト結果表示エリア */
const resultArea = document.getElementById('result-area');

/** @type {HTMLElement} テスト結果アイコン */
const resultIcon = document.getElementById('result-icon');

/** @type {HTMLElement} テスト結果メッセージ */
const resultMessage = document.getElementById('result-message');

/** @type {boolean} 接続テスト成功フラグ（保存ボタンの有効化制御に使用） */
let connectionTested = false;

// =====================================================
// イベントハンドラ
// =====================================================

/**
 * 接続テストボタンのクリックハンドラ
 *
 * フォームのバリデーションを行い、メインプロセスに接続テストを依頼する。
 * テスト中はUIをローディング状態にする。
 */
btnTest.addEventListener('click', () => {
  const serverUrl = serverUrlInput.value.trim();
  const clientKey = clientKeyInput.value.trim();

  // --- バリデーション ---
  if (!serverUrl) {
    showResult('error', 'サーバー URL を入力してください');
    return;
  }
  if (!clientKey) {
    showResult('error', 'Client Key を入力してください');
    return;
  }

  // サーバーURLの末尾スラッシュを除去（二重スラッシュ防止）
  const normalizedUrl = serverUrl.replace(/\/+$/, '');

  // --- ローディング状態を表示 ---
  showResult('loading', '接続テスト中...');
  btnTest.disabled = true;

  // --- メインプロセスに接続テストを依頼 ---
  window.signageAPI.testConnection(normalizedUrl, clientKey);
});

/**
 * 接続テスト結果の受信ハンドラ
 *
 * メインプロセスから送信された接続テスト結果をUIに反映する。
 * 成功時は「保存して開始」ボタンを有効化する。
 */
window.signageAPI.onTestConnectionResult((result) => {
  btnTest.disabled = false;

  if (result.success) {
    // 接続成功
    connectionTested = true;
    btnSave.disabled = false;
    showResult('success', result.message);
  } else {
    // 接続失敗
    connectionTested = false;
    btnSave.disabled = true;
    showResult('error', result.message);
  }
});

/**
 * 「保存して開始」ボタンのクリックハンドラ
 *
 * 接続テスト成功後に有効になる。
 * フォームの値をメインプロセスに送信して config.json に保存する。
 */
btnSave.addEventListener('click', () => {
  if (!connectionTested) return;

  const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
  const clientKey = clientKeyInput.value.trim();

  // メインプロセスに設定保存を依頼
  window.signageAPI.saveConfig({
    serverUrl,
    clientKey,
    pollingIntervalSec: 60  // デフォルトのポーリング間隔
  });

  // UIをローディング状態に
  showResult('loading', '設定を保存しています...');
  btnSave.disabled = true;
  btnTest.disabled = true;
});

/**
 * 設定保存完了の通知を受信
 *
 * メインプロセスが config.json への保存を完了した後に呼ばれる。
 * この後、メインプロセスが overlayView を index.html に切り替えて再生を開始する。
 */
window.signageAPI.onConfigSaved(() => {
  showResult('success', '設定を保存しました。再生を開始します...');
});

// =====================================================
// UI ヘルパー関数
// =====================================================

/**
 * テスト結果表示エリアを更新する
 *
 * @param {'success' | 'error' | 'loading'} type - 結果の種類
 * @param {string} message - 表示するメッセージ
 */
function showResult(type, message) {
  resultArea.style.display = 'flex';
  resultArea.className = 'result-area ' + type;

  // アイコンを種類に応じて設定
  const icons = {
    success: '\u2714',   // チェックマーク
    error: '\u2716',     // バツマーク
    loading: '\u25CF'    // 丸（ローディング）
  };
  resultIcon.textContent = icons[type] || '';
  resultMessage.textContent = message;
}

// =====================================================
// 初期化
// =====================================================

// サーバーURL入力欄にフォーカスを当てる
serverUrlInput.focus();

console.log('[setup] セットアップ画面 初期化完了');
