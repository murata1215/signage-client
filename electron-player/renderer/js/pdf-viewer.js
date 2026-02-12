/**
 * PDF スライドショー制御スクリプト
 *
 * 目的:
 *   PDF.js を使用して PDF ファイルをスライドショー形式で表示する。
 *   ページごとに自動送りを行い、最終ページ到達後は先頭にループする。
 *
 * 動作フロー:
 *   1. URL パラメータから PDF ファイルパスとページ表示秒数を取得
 *   2. PDF.js で PDF ファイルを読み込み
 *   3. 最初のページを canvas に描画
 *   4. pageDuration 秒ごとに次のページへ自動切替
 *   5. 最終ページ → 先頭ページにループ
 *
 * URL パラメータ:
 *   - file: PDF ファイルのローカル絶対パス（encodeURIComponent 済み）
 *   - pageDuration: 1ページあたりの表示秒数（デフォルト: 10）
 */

'use strict';

// =====================================================
// PDF.js のインポートと初期設定
// =====================================================

// pdfjs-dist の ESM ビルドを動的にインポート
// Electron の BrowserView 内で file:// プロトコルで動作するため、
// 相対パスで node_modules 内のファイルを参照する
const pdfjsLib = await import('../../node_modules/pdfjs-dist/build/pdf.mjs');

// PDF.js の Worker を設定
// Worker を使うことで PDF のパース処理がメインスレッドをブロックしない
pdfjsLib.GlobalWorkerOptions.workerSrc = '../../node_modules/pdfjs-dist/build/pdf.worker.mjs';

// =====================================================
// DOM 要素の参照
// =====================================================

/** @type {HTMLCanvasElement} PDF 描画用 canvas */
const canvas = document.getElementById('pdf-canvas');

/** @type {CanvasRenderingContext2D} canvas の 2D コンテキスト */
const ctx = canvas.getContext('2d');

/** @type {HTMLElement} 読み込み中オーバーレイ */
const loadingOverlay = document.getElementById('loading-overlay');

/** @type {HTMLElement} エラー表示オーバーレイ */
const errorOverlay = document.getElementById('error-overlay');

/** @type {HTMLElement} エラーメッセージテキスト */
const errorMessage = document.getElementById('error-message');

// =====================================================
// URL パラメータの解析
// =====================================================

/** @type {URLSearchParams} URL パラメータ */
const params = new URLSearchParams(window.location.search);

/** @type {string} PDF ファイルのローカルパス */
const pdfFilePath = decodeURIComponent(params.get('file') || '');

/** @type {number} 1ページあたりの表示秒数（デフォルト: 10秒） */
const pageDuration = parseInt(params.get('pageDuration') || '10', 10);

console.log(`[pdf-viewer] PDF パス: ${pdfFilePath}`);
console.log(`[pdf-viewer] ページ表示秒数: ${pageDuration}秒`);

// =====================================================
// PDF 表示ロジック
// =====================================================

/** @type {Object|null} PDF.js のドキュメントオブジェクト */
let pdfDoc = null;

/** @type {number} 現在表示中のページ番号（1始まり） */
let currentPage = 1;

/** @type {number} PDF の総ページ数 */
let totalPages = 0;

/** @type {NodeJS.Timeout|null} ページ送りタイマー */
let pageTimer = null;

/**
 * 指定ページを canvas に描画する
 *
 * PDF.js の render API を使用して、ページの内容を canvas に描画する。
 * 画面サイズに合わせてスケーリングし、フルスクリーンで表示する。
 *
 * @param {number} pageNum - 描画するページ番号（1始まり）
 */
async function renderPage(pageNum) {
  try {
    // PDF.js からページオブジェクトを取得
    const page = await pdfDoc.getPage(pageNum);

    // 画面サイズに合わせたスケール計算
    // PDF のオリジナルサイズと画面サイズの比率を計算し、
    // 画面に収まる最大スケールを適用する
    const viewport = page.getViewport({ scale: 1.0 });
    const scaleX = window.innerWidth / viewport.width;
    const scaleY = window.innerHeight / viewport.height;
    const scale = Math.min(scaleX, scaleY);  // アスペクト比を維持して画面に収める

    const scaledViewport = page.getViewport({ scale });

    // canvas のサイズを描画サイズに合わせる
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    // PDF ページを canvas に描画
    const renderContext = {
      canvasContext: ctx,
      viewport: scaledViewport
    };

    await page.render(renderContext).promise;
    console.log(`[pdf-viewer] ページ ${pageNum}/${totalPages} を描画`);
  } catch (err) {
    console.error(`[pdf-viewer] ページ ${pageNum} の描画エラー:`, err.message);
  }
}

/**
 * 次のページに自動送りする
 *
 * 最終ページに到達した場合は先頭ページに戻る（ループ）。
 */
function nextPage() {
  // 次のページ番号を計算（ループ）
  currentPage = (currentPage % totalPages) + 1;
  renderPage(currentPage);
}

/**
 * ページ自動送りタイマーを開始する
 *
 * pageDuration 秒ごとに次のページに切り替える。
 * 既存のタイマーがあれば停止してから再開する。
 */
function startPageTimer() {
  // 既存タイマーがあればクリア
  if (pageTimer) {
    clearInterval(pageTimer);
  }

  // 1ページのみの場合はタイマー不要
  if (totalPages <= 1) {
    console.log('[pdf-viewer] 1ページのみ、自動送りなし');
    return;
  }

  // pageDuration 秒ごとに次のページへ
  pageTimer = setInterval(nextPage, pageDuration * 1000);
  console.log(`[pdf-viewer] ページ自動送り開始: ${pageDuration}秒間隔`);
}

/**
 * PDF ファイルを読み込んで表示を開始する
 *
 * PDF.js の getDocument API で PDF を読み込み、
 * 最初のページを描画してからページ送りタイマーを開始する。
 */
async function loadPdf() {
  if (!pdfFilePath) {
    showError('PDF ファイルパスが指定されていません');
    return;
  }

  try {
    console.log('[pdf-viewer] PDF 読み込み開始...');

    // PDF.js で PDF ファイルを読み込み
    // file:// プロトコルのローカルファイルを読み込むため、
    // url パラメータにファイルパスを直接指定
    const loadingTask = pdfjsLib.getDocument(`file://${pdfFilePath}`);
    pdfDoc = await loadingTask.promise;

    totalPages = pdfDoc.numPages;
    console.log(`[pdf-viewer] PDF 読み込み完了: ${totalPages} ページ`);

    // 最初のページを描画
    currentPage = 1;
    await renderPage(currentPage);

    // 読み込みオーバーレイを非表示
    loadingOverlay.classList.add('hidden');

    // ページ自動送りタイマーを開始
    startPageTimer();
  } catch (err) {
    console.error('[pdf-viewer] PDF 読み込みエラー:', err.message);
    showError(`PDF の読み込みに失敗しました: ${err.message}`);
  }
}

/**
 * エラーメッセージを表示する
 *
 * @param {string} message - 表示するエラーメッセージ
 */
function showError(message) {
  loadingOverlay.style.display = 'none';
  errorMessage.textContent = message;
  errorOverlay.style.display = 'flex';
}

// =====================================================
// ウィンドウリサイズ対応
// =====================================================

/**
 * ウィンドウリサイズ時に現在のページを再描画する
 * フルスクリーンへの切り替え等に対応
 */
window.addEventListener('resize', () => {
  if (pdfDoc) {
    renderPage(currentPage);
  }
});

// =====================================================
// 初期化
// =====================================================

// PDF の読み込みを開始
loadPdf();
