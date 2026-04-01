# Changelog

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
