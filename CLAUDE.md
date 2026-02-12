<!-- DevRelay Agreement v3 -->
【重要】ユーザーに渡すファイルを作成する場合は、必ず `.devrelay-output/` ディレクトリに保存してください。このディレクトリに置かれたファイルは自動的にユーザーに送信されます。

【プランモード】
現在はプランモードです。コードの書き換えや新規ファイルの作成は行わず、以下のみを行ってください：
- 調査・分析
- 実装プランの立案
- 質問や確認

プランが完成したら、最後に必ず以下のように伝えてください：
「このプランでよければ `e` または `exec` を送信してください。実装を開始します。」

ユーザーが `exec` を送信するまで、コードの変更は行わないでください。

【プランの説明】
プランを立案したら、必ずテキストで概要を説明してください。
ファイルに書き込むだけでなく、ユーザーが Discord/Telegram で内容を確認できるようにしてください。

【ユーザーへの質問】
AskUserQuestion ツールは使用しないでください（DevRelay 経由では応答を返せないため）。
ユーザーに質問や確認が必要な場合は、テキストで質問を書いてください。
ユーザーは Discord/Telegram 経由でテキストで回答します。

【コーディングスタイル】
ソースコードを書く際は、詳細な日本語コメントを必ず残してください。
以下のルールに従ってください：

1. **関数・メソッド**: 必ず JSDoc 形式で目的・引数・戻り値を説明
2. **クラス**: クラスの責務と使用方法を説明
3. **複雑なロジック**: 処理の流れを段階的に説明
4. **条件分岐**: なぜその条件が必要かを説明
5. **重要な変数**: 変数の用途を説明
6. **TODO・FIXME**: 将来の改善点を明記

コメントがないコードは不完全です。他の開発者が読んで理解できるレベルのコメントを心がけてください。
<!-- /DevRelay Agreement -->

## プロジェクト概要

**signage-client** — 企業向けデジタルサイネージ配信システム。本社から複数拠点のディスプレイを一元管理。

## 現在のステータス

- **Electron プレーヤー（サーバー連携済み）**: 完了・動作確認済み（`electron-player/`）
  - サーバーからのスケジュール取得・ポーリング
  - ハートビート送信
  - PDF コンテンツ表示（PDF.js）
  - 初回セットアップ画面
  - 再生時間帯外の待機画面
  - キャッシュ管理（オフラインフォールバック）
  - フェード切替 + コンテンツ先読みによるスムーズな遷移
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

### コンテンツ先読み（プリロード）戦略
- `_showContent()`: コンテンツ表示直後に次のコンテンツをスタンバイ View に先読み開始
- `_onFadeComplete()`: フェード完了後にも次のコンテンツを先読み開始
- フェードアウト前に `preloadPromise` の完了を待つことで、古いコンテンツが一瞬見える問題を防止
- **2箇所両方に先読みロジックが必要**（片方だけだと2ページ交互表示バグが発生する）
