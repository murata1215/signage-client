# サイネージ端末 ディスプレイ省電力無効化手順

サイネージ用途ではキーボード/マウス操作がないため、OS がアイドル状態と判断して画面を消してしまう。
以下の設定を全て無効化する。

## 1. X11 スクリーンセーバー / DPMS 無効化

```bash
xset s off          # スクリーンセーバー無効化
xset s noblank      # 画面ブランク無効化
xset -dpms          # DPMS（ディスプレイ省電力）無効化
```

> **注意**: `xset` の設定は再起動でリセットされる。
> systemd サービス（`signage-client.service`）の `ExecStartPre` で自動実行する（後述）。

## 2. GNOME 省電力設定の無効化

```bash
# アイドル検出を無効化（デフォルト: 300秒=5分）
gsettings set org.gnome.desktop.session idle-delay 0

# スクリーンセーバー発動を無効化
gsettings set org.gnome.desktop.screensaver idle-activation-enabled false

# 画面ロックを無効化
gsettings set org.gnome.desktop.screensaver lock-enabled false

# アイドル時の画面暗転を無効化
gsettings set org.gnome.settings-daemon.plugins.power idle-dim false

# AC電源時のサスペンドを無効化（デフォルト: 900秒=15分でサスペンド）
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-timeout 0

# バッテリー時のサスペンドも無効化（念のため）
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type 'nothing'
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-timeout 0
```

> `gsettings` の変更は永続化される（再起動後も有効）。

## 3. XFCE 電源管理の DPMS 無効化

```bash
xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/dpms-enabled -s false
```

> `xfconf-query` の変更は永続化される。

## 4. xscreensaver / light-locker の自動起動を無効化

```bash
mkdir -p ~/.config/autostart

# xscreensaver を無効化
cp /etc/xdg/autostart/xscreensaver.desktop ~/.config/autostart/xscreensaver.desktop
echo "Hidden=true" >> ~/.config/autostart/xscreensaver.desktop

# light-locker を無効化
cp /etc/xdg/autostart/light-locker.desktop ~/.config/autostart/light-locker.desktop
echo "Hidden=true" >> ~/.config/autostart/light-locker.desktop
```

## 5. systemd サービスでの xset 自動実行

`~/.config/systemd/user/signage-client.service` の `[Service]` セクション:

```ini
[Service]
Type=simple
WorkingDirectory=/home/tisa/signage-client
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/tisa/.Xauthority
ExecStartPre=/bin/sleep 30
ExecStartPre=/usr/bin/xset s off
ExecStartPre=/usr/bin/xset s noblank
ExecStartPre=/usr/bin/xset -dpms
ExecStart=/usr/bin/npm run start:kiosk
Restart=on-failure
RestartSec=10
```

サービスファイル更新後:
```bash
cp ~/signage-client/scripts/signage-client.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user restart signage-client
```

## 確認コマンド

```bash
# xset 設定確認（timeout: 0, blanking: no, DPMS: Disabled なら OK）
xset q | grep -E "timeout|blanking|DPMS|Enabled|Disabled"

# gsettings 確認
gsettings get org.gnome.desktop.session idle-delay           # → uint32 0
gsettings get org.gnome.desktop.screensaver idle-activation-enabled  # → false
gsettings get org.gnome.settings-daemon.plugins.power idle-dim       # → false
gsettings get org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type  # → 'nothing'
```

## 一括実行（コピペ用）

```bash
# --- xset ---
xset s off && xset s noblank && xset -dpms

# --- gsettings ---
gsettings set org.gnome.desktop.session idle-delay 0
gsettings set org.gnome.desktop.screensaver idle-activation-enabled false
gsettings set org.gnome.desktop.screensaver lock-enabled false
gsettings set org.gnome.settings-daemon.plugins.power idle-dim false
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-timeout 0
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type 'nothing'
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-timeout 0

# --- XFCE ---
xfconf-query -c xfce4-power-manager -p /xfce4-power-manager/dpms-enabled -s false

# --- 自動起動無効化 ---
mkdir -p ~/.config/autostart
cp /etc/xdg/autostart/xscreensaver.desktop ~/.config/autostart/xscreensaver.desktop
echo "Hidden=true" >> ~/.config/autostart/xscreensaver.desktop
cp /etc/xdg/autostart/light-locker.desktop ~/.config/autostart/light-locker.desktop
echo "Hidden=true" >> ~/.config/autostart/light-locker.desktop
```
