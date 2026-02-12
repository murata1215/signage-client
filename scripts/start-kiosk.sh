#!/bin/bash
# =============================================================================
# サイネージ キオスクモード起動スクリプト
#
# 目的:
#   Google Chrome をキオスクモード（フルスクリーン・操作不可）で起動し、
#   サイネージプレーヤーを表示する。
#
# 使用方法:
#   chmod +x start-kiosk.sh
#   ./start-kiosk.sh
#
# 前提条件:
#   - Google Chrome (deb版) がインストール済み
#   - X11 環境（DISPLAY が設定済み）
#   - proxy.pac が同ディレクトリに存在
#
# 終了方法:
#   Alt+F4 または Ctrl+Alt+Delete（OS依存）
# =============================================================================

# --- スクリプトのディレクトリを基準にパスを設定 ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- プロジェクトルートディレクトリ ---
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# --- PAC ファイルのパス ---
PAC_FILE="${SCRIPT_DIR}/proxy.pac"

# --- プレーヤーHTMLのパス ---
PLAYER_URL="file://${PROJECT_DIR}/public/player/index.html"

# --- 画面省電力設定を無効化（スクリーンセーバー・画面オフを防止） ---
echo "[kiosk] 画面省電力設定を無効化..."
xset s off          2>/dev/null  # スクリーンセーバーを無効化
xset -dpms          2>/dev/null  # DPMSによる画面オフを無効化
xset s noblank      2>/dev/null  # 画面ブランクを無効化

# --- PAC ファイルの存在確認 ---
if [ ! -f "$PAC_FILE" ]; then
  echo "[kiosk] エラー: PAC ファイルが見つかりません: ${PAC_FILE}"
  exit 1
fi

echo "[kiosk] プロジェクトディレクトリ: ${PROJECT_DIR}"
echo "[kiosk] PAC ファイル: ${PAC_FILE}"
echo "[kiosk] プレーヤーURL: ${PLAYER_URL}"
echo "[kiosk] Chrome をキオスクモードで起動します..."

# --- Google Chrome をキオスクモードで起動 ---
# 各オプションの説明:
#   --kiosk                          : フルスクリーン・アドレスバー非表示・操作制限
#   --no-first-run                   : 初回起動ウィザードをスキップ
#   --disable-translate              : 翻訳ダイアログを無効化
#   --disable-infobars               : 情報バー（上部の通知）を無効化
#   --disable-session-crashed-bubble : 異常終了後の復元ダイアログを無効化
#   --disable-features=TranslateUI   : 翻訳UIを無効化
#   --autoplay-policy=...            : 自動再生を許可（動画コンテンツ対応）
#   --proxy-pac-url=...              : PACファイルでプロキシを自動設定
#   --disable-background-networking  : バックグラウンド通信を抑制
#   --disable-sync                   : Google同期を無効化
#   --disable-default-apps           : デフォルトアプリを無効化
#   --no-default-browser-check       : デフォルトブラウザ確認を無効化
google-chrome-stable \
  --kiosk \
  --no-first-run \
  --disable-translate \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --autoplay-policy=no-user-gesture-required \
  --proxy-pac-url="file://${PAC_FILE}" \
  --disable-background-networking \
  --disable-sync \
  --disable-default-apps \
  --no-default-browser-check \
  "${PLAYER_URL}"

echo "[kiosk] Chrome が終了しました。"
