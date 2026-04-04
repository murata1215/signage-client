# サイネージクライアント デプロイ手順書

新規端末（2号機以降）にサイネージクライアントをセットアップする手順。
1号機（tisa-MPro-M600）の構成を再現する。

---

## 1. 前提条件

| 項目 | 要件 |
|------|------|
| OS | Linux Mint 22.x（Ubuntu 24.04 ベース） |
| デスクトップ | Xfce（LightDM） |
| Node.js | v20.x 以上 |
| npm | v10.x 以上 |
| ネットワーク | 社内LAN（サーバーへのアクセス + インターネット用プロキシ） |

### Node.js のインストール（未インストールの場合）

```bash
# NodeSource リポジトリから Node.js 20.x をインストール
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## 2. リポジトリの取得と依存パッケージのインストール

```bash
# リポジトリをクローン
cd ~
git clone <リポジトリURL> signage-client

# 社内プロキシ経由で npm install
cd ~/signage-client
HTTPS_PROXY=http://210.175.128.100:8080 HTTP_PROXY=http://210.175.128.100:8080 npm install
```

---

## 3. 初回セットアップ（サーバー接続設定）

```bash
# 一度手動で起動し、セットアップ画面でサーバー情報を入力する
cd ~/signage-client
npm start
```

セットアップ画面が表示されたら：
1. **サーバー URL** を入力（例: `http://10.20.171.181:3000`）
2. **接続テスト** をクリックして通信を確認
3. **保存** をクリック

設定は `~/.config/signage-client/config.json` に保存される。

確認後、Ctrl+Q で終了する。

---

## 4. LightDM 自動ログイン設定

端末の電源投入時に自動でデスクトップにログインさせる。

```bash
# /etc/lightdm/lightdm.conf を編集
sudo nano /etc/lightdm/lightdm.conf
```

以下の内容を設定する：

```ini
[Seat:*]
greeter-show-manual-login=false
autologin-user=tisa
autologin-user-timeout=10
```

> **注意**: `autologin-user` は実際のユーザー名に合わせること。

---

## 5. systemd ユーザーサービスの設定

### 5.1 サービスファイルの配置

```bash
# ユーザーサービスディレクトリを作成（なければ）
mkdir -p ~/.config/systemd/user

# サービスファイルをコピー
cp ~/signage-client/scripts/signage-client.service ~/.config/systemd/user/

# サービスファイルの WorkingDirectory を確認・修正
# デフォルトは /home/tisa/signage-client になっている
# ユーザー名やパスが異なる場合は編集する
nano ~/.config/systemd/user/signage-client.service
```

### 5.2 サービスの有効化・起動

```bash
# systemd にサービスファイルを認識させる
systemctl --user daemon-reload

# OS 起動時に自動起動するよう有効化
systemctl --user enable signage-client

# Linger を有効化（ユーザーがログインしていなくてもサービスを起動可能にする）
sudo loginctl enable-linger $(whoami)

# サービスを起動
systemctl --user start signage-client
```

### 5.3 サービスファイルの内容

```ini
[Unit]
Description=Signage Client - Electron Player
After=graphical-session.target

[Service]
Type=simple
WorkingDirectory=/home/tisa/signage-client
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/tisa/.Xauthority
ExecStartPre=/bin/sleep 30
ExecStartPre=-/usr/bin/killall xfce4-power-manager
ExecStartPre=/usr/bin/xset s off
ExecStartPre=/usr/bin/xset s noblank
ExecStartPre=/usr/bin/xset -dpms
ExecStart=/usr/bin/npm run start:kiosk
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

| 設定 | 説明 |
|------|------|
| `After=graphical-session.target` | GUI セッション起動後に開始 |
| `Environment=DISPLAY=:0` | X11 ディスプレイを指定 |
| `Environment=XAUTHORITY=...` | X11 認証情報（xset コマンドに必要） |
| `ExecStartPre=/bin/sleep 30` | GUI が安定するまで30秒待機 |
| `ExecStartPre=xset ...` | スクリーンセーバー/DPMS を無効化 |
| `ExecStart` | キオスクモードで Electron を起動 |
| `Restart=on-failure` | クラッシュ時に自動再起動 |
| `RestartSec=10` | 再起動まで10秒待機 |

> **重要**: `XAUTHORITY` がないと `xset` が X サーバーに接続できず、スクリーンセーバーが無効化されない。
> 初回セットアップ時は `doc/disable-display-powersave.md` の手順も実行すること（gsettings 等の永続設定）。

---

## 6. 動作確認

### サービスのステータス確認

```bash
systemctl --user status signage-client
```

`active (running)` と表示されれば正常。

### ログの確認

```bash
# リアルタイムログ
journalctl --user -u signage-client -f

# 直近100行
journalctl --user -u signage-client -n 100
```

正常時のログ例：
```
[schedule] ポーリング実行中...
[server-client] スケジュール取得成功: version=XX, コンテンツ数=XX
[heartbeat] ハートビート送信成功
[ViewManager] フェード開始: 次のコンテンツ [X] タイトル
```

### 再起動テスト

```bash
# 端末を再起動して自動起動を確認
sudo reboot
```

再起動後、約30秒でサイネージが全画面表示されることを確認する。

---

## 7. 運用コマンド

```bash
# サービスの再起動
systemctl --user restart signage-client

# サービスの停止
systemctl --user stop signage-client

# サービスの自動起動を無効化
systemctl --user disable signage-client

# サービスファイルを編集した後
systemctl --user daemon-reload
systemctl --user restart signage-client
```

---

## 8. トラブルシューティング

### 画面が表示されない

1. **サービスが起動しているか確認**
   ```bash
   systemctl --user status signage-client
   ```

2. **DISPLAY 環境変数を確認**
   ```bash
   echo $DISPLAY
   # :0 が返るはず。異なる場合はサービスファイルを修正
   ```

3. **手動起動で動作確認**
   ```bash
   cd ~/signage-client
   npm run start:kiosk
   ```

### サーバーに接続できない

1. **ネットワーク疎通を確認**
   ```bash
   ping 10.20.171.181
   curl http://10.20.171.181:3000/api/health
   ```

2. **設定ファイルを確認**
   ```bash
   cat ~/.config/signage-client/config.json
   ```

### npm install が失敗する

社内プロキシが必要：
```bash
HTTPS_PROXY=http://210.175.128.100:8080 HTTP_PROXY=http://210.175.128.100:8080 npm install
```

### 4K ディスプレイで文字が小さい

`start-electron.sh` を使えば自動検出されるが、systemd サービスでは `npm run start:kiosk` を直接実行している。
4K 端末の場合、サービスファイルの `ExecStart` を以下に変更する：

```ini
ExecStart=/home/tisa/signage-client/electron-player/scripts/start-electron.sh --kiosk
```

または `ExecStart` に `--force-device-scale-factor=2` を追加する：

```ini
ExecStart=/usr/bin/npx electron electron-player/main.js --no-sandbox --force-device-scale-factor=2 --kiosk
```

---

## 参考: 1号機の構成

| 項目 | 値 |
|------|-----|
| ホスト名 | tisa-MPro-M600 |
| OS | Linux Mint 22.3 (Zena) / x86_64 |
| Node.js | v20.20.0 / npm 10.8.2 |
| サーバーURL | http://10.20.171.181:3000 |
| 社内プロキシ | 210.175.128.100:8080 |
| 稼働開始 | 2026-03-02 |
