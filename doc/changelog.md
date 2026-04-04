# Changelog

## 2026-04-04

### xfce4-power-manager 対策を追加

- **原因**: `xfce4-power-manager` が xset の設定を定期的に上書きし、`timeout: 600`（10分）に戻していた
- **修正**: systemd サービスの ExecStartPre に `killall xfce4-power-manager` を追加
- xfce4-power-manager の自動起動を `Hidden=true` で無効化
- `doc/disable-display-powersave.md` に手順を追記

### ディスプレイ省電力の完全無効化

- systemd サービスに `ExecStartPre` で `xset s off / s noblank / -dpms` を追加（再起動時も自動適用）
- GNOME 省電力設定（idle-delay, screensaver, suspend）を全無効化（gsettings、永続化）
- xscreensaver / light-locker の自動起動を無効化
- `doc/disable-display-powersave.md` を追加（手順書）

### プレイリスト更新の即時反映

- **変更前**: スケジュール更新時、古いプレイリストのローテーション末尾（最大40分後）まで待って差し替え
- **変更後**: 現在のコンテンツ再生完了後、次のコンテンツから即座に新プレイリストに切り替え
- `view-manager.js` の `_onFadeComplete()` 内のプレイリスト差し替え条件を変更

## 2026-04-03

### systemd サービスに XAUTHORITY 環境変数を追加

- **原因**: systemd 経由で起動すると XAUTHORITY が未設定のため、起動スクリプトの `xset s off` 等が X サーバーに接続できずサイレントに失敗（`2>/dev/null` でエラーが隠れていた）
- **症状**: 10分でスクリーンセーバーが画面をブランク（真っ黒）にする
- **修正**: `scripts/signage-client.service` に `Environment=XAUTHORITY=/home/tisa/.Xauthority` を追加
- `doc/client-deploy.md` に XAUTHORITY の説明を追記

## 2026-04-01

### 再生時間帯チェックタイマーが停止するバグを修正

- **原因**: `startPlayback()` で `startPlayTimeCheck()` → `startPolling()` の順に呼び出すが、`startPolling()` 内の `stopPolling()` が `playTimeCheckTimer` も一緒に消していた
- **症状**: 再生時間帯外に起動すると、翌朝の再生開始時刻を過ぎても待機画面のまま
- **修正**: `stopPolling()` からタイマー停止の責務を分離
  - `stopPolling()` → ポーリングタイマーのみ停止
  - `stopPlayTimeCheck()` を新設
  - `stopAll()` を新設（終了処理用）
  - `pollOnce()` で version 変更時に `startPlayTimeCheck()` を再呼出し

## 2026-03-31

### クライアント自動起動のドキュメント化

- `scripts/signage-client.service` を新規作成（systemd ユーザーサービスファイル）
- `doc/client-deploy.md` を新規作成（2号機以降のデプロイ手順書）
- 1号機の構成（LightDM 自動ログイン + systemd ユーザーサービス + Linger）を標準構成として文書化
- `rules/project.md` にデプロイ構成の設計判断を記録
- `rules/devrelay.md` を DevRelay Agreement v6 に更新
- `doc/issues.md` を新規作成（Issue 管理用）
- README.md にデプロイ手順とドキュメント参照を追加
