#!/usr/bin/env bash
set -euo pipefail

mkdir -p /home/operacional/hydra-data/logs

LOCK_FILE="/tmp/hydra-data-refresh.lock"
exec 9>"$LOCK_FILE"

if ! flock -w 3600 9; then
  echo "$(date --iso-8601=seconds) hourly lock timeout after 3600s: another data refresh held lock at $LOCK_FILE" >> /home/operacional/hydra-data/logs/hourly-finance.log
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
cd "$ROOT_DIR"

echo "$(date --iso-8601=seconds) starting hourly finance worker" >> /home/operacional/hydra-data/logs/hourly-finance.log
timeout 20m /usr/bin/node "$ROOT_DIR/node_modules/tsx/dist/cli.mjs" src/hydra-sync/hourly_finance_worker.ts >> /home/operacional/hydra-data/logs/hourly-finance.log 2>&1
