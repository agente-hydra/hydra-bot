#!/usr/bin/env bash
set -euo pipefail

mkdir -p /home/operacional/hydra-data/logs

LOCK_FILE="/tmp/hydra-data-refresh.lock"
exec 9>"$LOCK_FILE"

if ! flock -n 9; then
  echo "$(date --iso-8601=seconds) daily skipped: another data refresh is running (lock held at $LOCK_FILE)" >> /home/operacional/hydra-data/logs/daily-crawl.log
  exit 0
fi

ROOT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$ROOT_DIR"

echo "$(date --iso-8601=seconds) starting daily deep crawler" >> /home/operacional/hydra-data/logs/daily-crawl.log
timeout 55m /usr/bin/node "$ROOT_DIR/node_modules/tsx/dist/cli.mjs" src/hydra-sync/deep-crawler.ts >> /home/operacional/hydra-data/logs/daily-crawl.log 2>&1
