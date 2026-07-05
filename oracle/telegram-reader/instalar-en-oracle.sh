#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/mauex-telegram"
ENV_FILE="$APP_DIR/.env"
SERVICE_FILE="/etc/systemd/system/mauex-telegram-reader.service"

sudo mkdir -p "$APP_DIR"
sudo cp /tmp/mauex-telegram/mauex-telegram-reader.js "$APP_DIR/mauex-telegram-reader.js"
sudo cp /tmp/mauex-telegram/package.json "$APP_DIR/package.json"

if [ ! -f "$ENV_FILE" ]; then
  sudo touch "$ENV_FILE"
fi
sudo chmod 600 "$ENV_FILE"
sudo chown -R ubuntu:ubuntu "$APP_DIR"

cd "$APP_DIR"
npm install --omit=dev

sudo tee "$SERVICE_FILE" >/dev/null <<'EOF'
[Unit]
Description=MAUex Telegram Signal Reader
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/mauex-telegram
EnvironmentFile=/opt/mauex-telegram/.env
ExecStart=/usr/bin/node /opt/mauex-telegram/mauex-telegram-reader.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable mauex-telegram-reader

echo "Instalado MAUex Telegram Reader."
