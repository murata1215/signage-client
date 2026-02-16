#!/bin/bash
# =============================================================================
# サイネージ Electron プレーヤー起動スクリプト
#
# 目的:
#   Electron ベースのサイネージプレーヤーをキオスクモードで起動する。
#   画面省電力設定を無効化し、フルスクリーンで動作させる。
#
# 使用方法:
#   chmod +x start-electron.sh
#   ./start-electron.sh            # キオスクモード（本番）
#   ./start-electron.sh --dev      # 開発モード（ウィンドウ表示、DevTools有効）
#
# 前提条件:
#   - Node.js がインストール済み
#   - npm install が実行済み（electron がインストール済み）
#   - X11 環境（DISPLAY が設定済み）
#
# 終了方法:
#   - 開発モード: Ctrl+Q
#   - キオスクモード: プロセスを kill するか、systemd で管理
# =============================================================================

# --- スクリプトのディレクトリを基準にパスを設定 ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- プロジェクトルートディレクトリ（electron-player/scripts/ の2つ上） ---
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# --- 起動モード判定 ---
# --dev が指定されていれば開発モード、なければキオスクモード
MODE="--kiosk"
if [ "$1" = "--dev" ]; then
  MODE="--dev"
  echo "[start-electron] 開発モードで起動します"
else
  echo "[start-electron] キオスクモードで起動します"
fi

# --- 画面省電力設定を無効化（キオスクモード時のみ） ---
if [ "$MODE" = "--kiosk" ]; then
  echo "[start-electron] 画面省電力設定を無効化..."
  xset s off          2>/dev/null  # スクリーンセーバーを無効化
  xset -dpms          2>/dev/null  # DPMSによる画面オフを無効化
  xset s noblank      2>/dev/null  # 画面ブランクを無効化
fi

# --- node_modules の存在確認 ---
if [ ! -d "${PROJECT_DIR}/node_modules/electron" ]; then
  echo "[start-electron] エラー: electron がインストールされていません"
  echo "[start-electron] 以下のコマンドを実行してください:"
  echo "  cd ${PROJECT_DIR} && npm install"
  exit 1
fi

echo "[start-electron] プロジェクトディレクトリ: ${PROJECT_DIR}"

# --- ディスプレイ解像度を検出してスケールファクターを決定 ---
# 4K（横幅2560以上）ディスプレイの場合、コンテンツが小さく表示されるのを防ぐため
# Chromium の --force-device-scale-factor=2 で2倍スケーリングを適用する。
# フルHD（1920×1080）以下では スケーリングなし（デフォルト1倍）。
# xrandr が使えない環境（Wayland等）では検出をスキップし、スケーリングなしで起動する。
SCALE_FACTOR=""
if command -v xrandr &>/dev/null; then
  # プライマリディスプレイの現在の解像度を取得（例: "3840x2160"）
  RESOLUTION=$(xrandr 2>/dev/null | grep ' connected primary' | grep -oP '\d+x\d+' | head -1)
  if [ -n "$RESOLUTION" ]; then
    # 横幅を抽出して判定
    WIDTH=$(echo "$RESOLUTION" | cut -d'x' -f1)
    echo "[start-electron] ディスプレイ解像度: ${RESOLUTION}"
    if [ "$WIDTH" -ge 2560 ]; then
      SCALE_FACTOR="--force-device-scale-factor=2"
      echo "[start-electron] 高解像度ディスプレイ検出 → スケールファクター 2x を適用"
    else
      echo "[start-electron] 標準解像度ディスプレイ → スケーリングなし"
    fi
  else
    echo "[start-electron] プライマリディスプレイの解像度を検出できませんでした"
  fi
else
  echo "[start-electron] xrandr が見つかりません（Wayland環境？）→ スケーリングなし"
fi

echo "[start-electron] Electron プレーヤーを起動します..."

# --- Electron アプリを起動 ---
# SCALE_FACTOR: 高解像度ディスプレイ時のみ --force-device-scale-factor=2 が設定される
cd "${PROJECT_DIR}"
npx electron electron-player/main.js --no-sandbox ${SCALE_FACTOR} ${MODE}

echo "[start-electron] Electron プレーヤーが終了しました"
