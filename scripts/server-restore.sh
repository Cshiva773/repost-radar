#!/usr/bin/env bash
# Puts a backup back (docs/DEPLOYING.md). Replaces the current database and image bucket:
#   bash scripts/server-restore.sh backups/db/2026-11-09.dump
# The app services are stopped while it runs and started again afterwards.
set -euo pipefail
DUMP_FILE="${1:-}"
[ -f "$DUMP_FILE" ] || { echo "Usage: bash scripts/server-restore.sh backups/db/<date>.dump" >&2; exit 1; }
DUMP_FILE="$(cd "$(dirname "$DUMP_FILE")" && pwd)/$(basename "$DUMP_FILE")"
# shellcheck source=lib/server-env.sh
. "$(dirname "$0")/lib/server-env.sh"
load_env
APP_SERVICE_LIST=(api crawler fingerprint-worker)

echo "Step 1/4: stopping ${APP_SERVICE_LIST[*]}"
compose stop "${APP_SERVICE_LIST[@]}"
compose up -d --wait postgres s3 > /dev/null
echo "Step 2/4: restoring the database from $DUMP_FILE"
compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner < "$DUMP_FILE"
echo "Step 3/4: restoring images from backups/images"
retry 6 compose run --rm --no-deps -v "$REPO_DIR/backups/images:/backup:ro" --entrypoint aws s3-init \
  --endpoint-url http://s3:8333 s3 sync /backup "s3://$S3_BUCKET" --only-show-errors
echo "Step 4/4: starting ${APP_SERVICE_LIST[*]}"
compose up -d --wait "${APP_SERVICE_LIST[@]}"
echo "Restored. Check: bash scripts/server-status.sh"
