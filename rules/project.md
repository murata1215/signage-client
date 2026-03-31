# プロジェクト固有ルール

## デプロイ構成（標準）

サイネージクライアントの自動起動は以下の構成を標準とする。

| 項目 | 方式 |
|------|------|
| 自動ログイン | LightDM（`autologin-user` 設定） |
| クライアント起動 | systemd ユーザーサービス（`~/.config/systemd/user/signage-client.service`） |
| サーバー起動 | systemd システムサービス（`/etc/systemd/system/signage-server.service`） |
| Linger | 有効（`loginctl enable-linger`） |

### 理由

- Electron は GUI アプリのため `DISPLAY=:0` が必要 → ユーザーレベル systemd が適切
- サーバーは CUI アプリのため → システムレベル systemd が適切
- サービスファイルは `scripts/signage-client.service` でバージョン管理
- デプロイ手順は `doc/client-deploy.md` を参照
