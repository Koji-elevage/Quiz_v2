#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Please run as a normal user (this script uses sudo where needed)." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y \
  build-essential \
  ca-certificates \
  curl \
  git \
  nginx \
  python3 \
  lsof

# Node.js 24 (project supports Node 24). If you prefer Node 22 LTS, change `setup_24.x` to `setup_22.x`.
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo npm i -g pm2

# nginx reverse proxy to the local node server on 127.0.0.1:3000
sudo tee /etc/nginx/sites-available/quiz-v2.conf >/dev/null <<'NGINX'
server {
  listen 80 default_server;
  listen [::]:80 default_server;

  server_name _;

  client_max_body_size 25m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
  }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/quiz-v2.conf /etc/nginx/sites-enabled/quiz-v2.conf
sudo rm -f /etc/nginx/sites-enabled/default || true
sudo nginx -t
sudo systemctl restart nginx

echo "bootstrap OK"
