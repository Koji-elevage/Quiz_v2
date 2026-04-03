#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/Quiz_v2}"
BRANCH="${BRANCH:-main}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.production}"

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Repo not found at: $APP_DIR" >&2
  echo "Clone it first: git clone <repo> $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

export NODE_ENV=production
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

npm ci --omit=dev

pm2 start server.js --name quiz-v2 --update-env || pm2 restart quiz-v2 --update-env
pm2 save

echo "deploy OK"
