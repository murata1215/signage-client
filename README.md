# signage-client - デジタルサイネージ配信システム

企業向けデジタルサイネージ配信システム。本社から複数拠点のサイネージディスプレイを一元管理し、全社共通コンテンツと拠点別コンテンツをスケジュール配信する。

## 進捗状況

### ✅ 完了

- [x] **システム設計ドキュメント**（`doc/signage-system-design.md`, 659行）
  - DB スキーマ（7テーブル）、API 設計（43エンドポイント）、画面設計（10画面）
  - RBAC（admin / hq / branch の3ロール）
  - デプロイ設計（systemd サービス化）
- [x] **Chrome キオスクモード PoC**（`public/player/`）
  - iframe 方式で2URLの交互表示を実装
  - 結果: Yahoo/Google News が `X-Frame-Options` で iframe 表示を拒否、sandbox が画像読み込みをブロック → **Electron 方式に移行**
- [x] **Electron プレーヤー PoC**（`electron-player/`）
  - BrowserView 方式で `X-Frame-Options` を完全回避
  - Google News + 社内サイネージの30秒交互表示に成功
  - プロキシ設定（外部: `210.175.128.100:8080` / 社内: 直接接続）
  - フェード切替アニメーション（800ms）
  - ステータスバー（コンテンツ名 + カウントダウン、Sキーで表示切替）
  - 3モード対応（通常 / キオスク / 開発）
- [x] **Electron プレーヤー サーバー連携**（`electron-player/`）✨
  - サーバーからのスケジュール取得（version ベースの差分検知）
  - バックグラウンドポーリング（定期的なスケジュール更新チェック）
  - ハートビート定期送信（端末稼働監視用）
  - スクリーンショット定期送信（5分間隔、管理画面ダッシュボード用サムネイル）
  - 初回セットアップ画面（サーバーURL・クライアントキー設定）
  - PDF コンテンツ表示（pdfjs-dist）
  - PDFファイルのローカルキャッシュ管理
  - 再生時間帯判定と待機画面（営業時間外は自動で待機表示）
  - オフラインフォールバック（サーバー到達不可時はキャッシュ利用）
  - コンテンツ先読み（次コンテンツの事前ロード）によるスムーズな切替
  - Chrome User-Agent 設定（ボット検知対策）
  - 4Kディスプレイ自動スケーリング（起動スクリプトで解像度検出）
  - キオスクモードでの全画面表示対応
  - ステータスバーとコンテンツの重なり防止

### 📋 今後の予定

- [ ] **管理画面**（Web UI）
  - [ ] ログイン画面
  - [ ] ダッシュボード
  - [ ] ユーザー / 拠点 / 端末 / コンテンツ管理画面
  - [ ] スケジュール編集画面
- [ ] **デプロイ**
  - [x] systemd サービス化（サーバー: システムレベル / クライアント: ユーザーレベル）
  - [ ] セットアップスクリプト

## 技術スタック

| コンポーネント | 技術 | 備考 |
|--------------|------|------|
| ランタイム | Node.js 20 LTS | Ubuntu 24 対応 |
| プレーヤー | Electron 33 | BrowserView 方式 |
| PDF 表示 | pdfjs-dist 4.x | Mozilla PDF.js（v5.x は Electron 33 非互換） |
| バックエンド | Express.js | REST API（別リポジトリ: signage-server） |
| データベース | SQLite3 | ファイルベース（サーバー側） |
| 認証 | express-session + bcrypt | セッション認証（サーバー側） |
| プロセス管理 | systemd | クライアント: ユーザーサービス / サーバー: システムサービス |

## ディレクトリ構成

```
signage-client/
├── package.json                    # 依存関係・起動スクリプト
├── README.md                       # このファイル
├── CLAUDE.md                       # 開発ガイドライン
├── doc/
│   ├── signage-system-design.md    # システム設計ドキュメント（659行）
│   └── screenshot-client-spec.md   # スクリーンショット送信機能 仕様書
├── electron-player/                # Electron プレーヤー（メイン）
│   ├── main.js                     # メインプロセス（起動フロー・IPC・ショートカット）
│   ├── preload.js                  # IPC ブリッジ（contextBridge）
│   ├── lib/
│   │   ├── view-manager.js         # BrowserView 管理・フェード切替・先読み制御
│   │   ├── schedule-manager.js     # スケジュール取得・ポーリング・時間帯判定
│   │   ├── server-client.js        # サーバーAPI通信（Electron net モジュール）
│   │   ├── config-manager.js       # 設定ファイル管理（config.json）
│   │   ├── cache-manager.js        # PDFキャッシュ管理
│   │   ├── heartbeat.js            # ハートビート定期送信
│   │   ├── screenshot.js           # スクリーンショット定期送信（管理画面サムネイル用）
│   │   ├── playlist.js             # デフォルトプレイリスト（フォールバック用）
│   │   └── proxy-rules.js          # プロキシ設定
│   ├── renderer/
│   │   ├── index.html              # オーバーレイUI（ステータスバー + フェード）
│   │   ├── setup.html              # 初回セットアップ画面
│   │   ├── standby.html            # 待機画面（再生時間帯外）
│   │   ├── pdf-viewer.html         # PDF 表示用
│   │   ├── css/
│   │   │   ├── overlay.css         # オーバーレイスタイル
│   │   │   ├── setup.css           # セットアップ画面スタイル
│   │   │   └── pdf-viewer.css      # PDF ビューアスタイル
│   │   └── js/
│   │       ├── overlay.js          # ステータスバー制御・フェードアニメーション
│   │       ├── setup.js            # セットアップ画面ロジック（接続テスト・保存）
│   │       └── pdf-viewer.js       # PDF 表示ロジック（pdfjs-dist）
│   └── scripts/
│       └── start-electron.sh       # 起動スクリプト
├── public/player/                  # Chrome PoC（参考・旧版）
│   ├── index.html
│   ├── css/player.css
│   └── js/player.js
└── scripts/
    ├── signage-client.service      # systemd ユーザーサービスファイル
    ├── proxy.pac                   # プロキシ自動設定（Chrome用）
    └── start-kiosk.sh              # Chrome キオスク起動（旧版）
```

## アーキテクチャ

### BrowserView 3層構成

```
┌─────────────────────────────────────┐
│          overlayView (最前面)         │  ← ステータスバー + フェード効果
│          背景: 透明                   │     （index.html）
├─────────────────────────────────────┤
│   contentViewA or contentViewB       │  ← 実際のWebコンテンツ表示
│   (アクティブView)                    │     （Yahoo, 社内サイネージ等）
├─────────────────────────────────────┤
│   contentViewB or contentViewA       │  ← 次のコンテンツを先読み中
│   (スタンバイView)                    │
├─────────────────────────────────────┤
│          BrowserWindow               │  ← 黒背景のコンテナ
└─────────────────────────────────────┘
```

- 2つのコンテンツ View（A/B）を交互に使い、フェードアニメーションで切り替え
- overlayView は常に最前面。透明背景でコンテンツが透けて見える
- コンテンツ表示直後に次のコンテンツをスタンバイ View に先読み開始

### 起動フロー

```
アプリ起動
  ↓
プロキシ設定（session.setProxy）
  ↓
メインウィンドウ + 3つの BrowserView 作成
  ↓
config.json 読み込み
  ├── なし → セットアップ画面表示 → 設定保存 → 再生開始
  └── あり → 再生開始
        ↓
  ハートビート送信開始
        ↓
  スクリーンショット定期送信開始（初回30秒後、以後5分間隔）
        ↓
  スケジュール取得（サーバー → キャッシュ → デフォルト）
        ↓
  時間帯判定
  ├── 時間帯内 → ローテーション再生開始
  └── 時間帯外 → 待機画面表示
        ↓
  バックグラウンドポーリング開始
```

## 起動方法

```bash
cd /home/tisa/signage-client

# 依存関係インストール（初回のみ・プロキシ環境の場合）
HTTPS_PROXY=http://210.175.128.100:8080 HTTP_PROXY=http://210.175.128.100:8080 npm install

# 開発モード（ウィンドウ表示、Ctrl+Q で終了、F12 で DevTools）
npm run start:dev

# 通常モード（フルスクリーン）
npm start

# キオスクモード（本番用・フルスクリーン固定）
npm run start:kiosk
```

## 本番デプロイ（自動起動）

systemd ユーザーサービスで OS 起動時に自動起動する。
詳細な手順は **[`doc/client-deploy.md`](doc/client-deploy.md)** を参照。

```bash
# サービスファイルを配置・有効化
mkdir -p ~/.config/systemd/user
cp scripts/signage-client.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable signage-client
sudo loginctl enable-linger $(whoami)

# サービス起動
systemctl --user start signage-client

# ステータス確認
systemctl --user status signage-client

# ログ確認
journalctl --user -u signage-client -f
```

## 操作方法

| キー | 動作 | モード |
|------|------|--------|
| S | ステータスバー表示/非表示 | 全モード |
| Ctrl+Q | アプリ終了 | 開発モードのみ |
| F12 | DevTools 表示/非表示 | 開発モードのみ |

## 初回セットアップ

1. アプリを起動すると、`config.json` がない場合はセットアップ画面が表示される
2. サーバー URL（例: `http://10.29.17.131:3000`）を入力
3. クライアントキー（サーバー管理画面で発行された UUID）を入力
4. 「接続テスト」で疎通確認
5. 「保存して開始」で設定が `~/.config/signage-client/config.json` に保存され、再生が開始される

## ドキュメント

| ドキュメント | 内容 |
|------------|------|
| [`doc/signage-system-design.md`](doc/signage-system-design.md) | システム設計（DB・API・画面仕様） |
| [`doc/client-deploy.md`](doc/client-deploy.md) | クライアントデプロイ手順書 |
| [`doc/screenshot-client-spec.md`](doc/screenshot-client-spec.md) | スクリーンショット送信機能 仕様書 |
| [`doc/changelog.md`](doc/changelog.md) | 変更履歴 |
