<!-- DevRelay Agreement v6 -->
See `rules/devrelay.md` for DevRelay rules.
<!-- /DevRelay Agreement -->

---

## プロジェクト概要

**signage-client** — 企業向けデジタルサイネージ配信システム。本社から複数拠点のディスプレイを一元管理。

## 現在のステータス

- **Electron プレーヤー（サーバー連携済み）**: 完了・動作確認済み（`electron-player/`）
  - サーバーからのスケジュール取得・ポーリング
  - ハートビート送信
  - スクリーンショット定期送信（5分間隔、管理画面ダッシュボード用）
  - PDF コンテンツ表示（PDF.js + pdfapp:// カスタムプロトコル）
  - 日本語フォント対応（CMap 設定済み）
  - 初回セットアップ画面
  - 再生時間帯外の待機画面
  - キャッシュ管理（オフラインフォールバック）
  - フェード切替 + コンテンツ先読みによるスムーズな遷移
  - 4Kディスプレイ自動スケーリング（起動スクリプトで解像度検出）
  - キオスクモードでの全画面表示対応
  - ステータスバーとコンテンツの重なり防止
- **システム設計ドキュメント**: 完成（`doc/signage-system-design.md`, 659行）
- **サーバー側（Express.js + SQLite3）**: 別リポジトリで実装済み（signage-server）
- **管理画面**: 未実装

## ディレクトリ構成

```
electron-player/          # Electron プレーヤー（メイン開発対象）
├── main.js               # メインプロセス（起動フロー・IPC・キーボードショートカット）
├── preload.js            # IPC ブリッジ（contextBridge）
├── lib/                  # ビジネスロジック
│   ├── view-manager.js   # BrowserView 管理・フェード切替・先読み制御
│   ├── schedule-manager.js # スケジュール取得・ポーリング・時間帯判定
│   ├── server-client.js  # サーバーAPI通信（Electron net モジュール）
│   ├── config-manager.js # 設定ファイル管理（config.json）
│   ├── cache-manager.js  # PDFキャッシュ管理
│   ├── heartbeat.js      # ハートビート定期送信
│   ├── screenshot.js     # スクリーンショット定期送信（管理画面サムネイル用）
│   ├── playlist.js       # デフォルトプレイリスト（フォールバック用）
│   └── proxy-rules.js    # プロキシ設定
├── renderer/             # レンダラー（UI）
│   ├── index.html        # オーバーレイUI（ステータスバー + フェード）
│   ├── setup.html        # 初回セットアップ画面
│   ├── standby.html      # 待機画面（再生時間帯外）
│   ├── pdf-viewer.html   # PDF 表示用
│   ├── css/
│   │   ├── overlay.css   # オーバーレイスタイル
│   │   ├── setup.css     # セットアップ画面スタイル
│   │   └── pdf-viewer.css # PDF ビューアスタイル
│   └── js/
│       ├── overlay.js    # ステータスバー制御・フェードアニメーション
│       ├── setup.js      # セットアップ画面ロジック（接続テスト・保存）
│       └── pdf-viewer.js # PDF 表示ロジック（pdfjs-dist）
└── scripts/
    └── start-electron.sh # 起動スクリプト

public/player/            # Chrome PoC（旧版・参考用）
scripts/                  # Chrome用スクリプト（旧版）
doc/                      # 設計ドキュメント
```

## 重要な設定値

| 項目 | 値 |
|------|-----|
| 社内プロキシ | `210.175.128.100:8080`（認証なし） |
| 社内サイネージURL | `http://10.20.249.224/aisignage/gnewsxgeminiapi/index.html` |
| プロキシバイパス | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `localhost` |
| Electron 起動 | `--no-sandbox` 必須（Linux SUID sandbox 回避） |
| 設定ファイル | `~/.config/signage-client/config.json` |

## npm install 時の注意

社内ネットワークでは以下のようにプロキシを指定する:
```bash
HTTPS_PROXY=http://210.175.128.100:8080 HTTP_PROXY=http://210.175.128.100:8080 npm install
```

## 技術的な注意点（開発で判明した重要事項）

### BrowserView の透明性
- `overlayView.setBackgroundColor('#00000000')` は必ず `loadFile()` の **前** に呼ぶこと
- `loadFile()` の後に呼ぶとデフォルトの不透明背景でレンダリングされ、下のコンテンツが見えなくなる
- `BrowserWindow` に `transparent: true` は **使わない**（ウィンドウ全体が透明になりデスクトップが透ける）

### プロキシの扱い
- サーバーの proxy API（`/api/player/proxy?url=...`）は使わない。動的サイト（Yahoo等）は相対パスの書き換えができないため正しく表示されない
- Electron の `session.setProxy()` がプロキシルーティングを自動処理する（外部→プロキシ経由、10.x.x.x→直接接続）
- `schedule-manager.js` では元の URL をそのまま使用する

### User-Agent 設定
- Electron のデフォルト UA には `Electron/xxx` が含まれる
- ヨドバシ等のボット検知サイトでブロックされるため、Chrome UA を `setUserAgent()` で設定済み

### PDF 表示（pdfapp:// カスタムプロトコル）
- `file://` プロトコルでは ESM（.mjs）の動的 import がブロックされるため、`pdfapp://` カスタムプロトコルを使用
- `protocol.registerSchemesAsPrivileged()` は `app.whenReady()` の **前** に呼ぶ必要がある
- `protocol.handle('pdfapp', ...)` で `pdfapp://local/絶対パス` → `file:///絶対パス` に変換
- pdfjs-dist は **v4.x 系**（v4.10.38）を使用。v5.x は `Uint8Array.prototype.toHex()` を使い、Electron 33（Chromium 130）では未対応
- 日本語フォント表示には `getDocument()` に `cMapUrl`（cmaps/）と `cMapPacked: true` の設定が必須
- `standardFontDataUrl`（standard_fonts/）も指定して標準フォントの代替表示に対応
- Worker パスは `window.location.href`（pdf-viewer.html）基準で `../..` がプロジェクトルート

### コンテンツ先読み（プリロード）戦略
- `_showContent()`: コンテンツ表示直後に次のコンテンツをスタンバイ View に先読み開始
- `_onFadeComplete()`: フェード完了後にも次のコンテンツを先読み開始
- フェードアウト前に `preloadPromise` の完了を待つことで、古いコンテンツが一瞬見える問題を防止
- **2箇所両方に先読みロジックが必要**（片方だけだと2ページ交互表示バグが発生する）

### 4Kディスプレイ対応
- `start-electron.sh` で `xrandr` を使いプライマリディスプレイの解像度を検出
- 横幅 2560px 以上なら `--force-device-scale-factor=2` を付けて Electron を起動
- フルHD（1920×1080）以下ではスケーリングなし
- `xrandr` が使えない環境（Wayland等）ではスキップしてスケーリングなしで起動

### スクリーンショット送信
- `screenshot.js` が 5分間隔でアクティブ BrowserView の画面をキャプチャ
- `webContents.capturePage()` → JPEG（品質80%、1280px幅にリサイズ）→ multipart/form-data で送信
- `net.fetch()` を使用するためプロキシ設定が自動適用される
- 待機中（時間帯外）やフェード遷移中はキャプチャをスキップ
- 送信失敗時はログ出力のみ（リトライ不要、次回の定期送信で再試行）

### BrowserView のレイアウト
- コンテンツView（A/B）の高さはステータスバー分（32px）を引いた値に設定
- これによりステータスバーとコンテンツが重ならない
- コンテンツViewの背景色は黒（`#000000`）に設定し、幅いっぱいに表示しないサイトの余白から前のコンテンツが透けて見える問題を防止
- キオスクモード/フルスクリーン遷移後に `enter-full-screen` イベントで View をリサイズ（初期サイズ問題の回避）
