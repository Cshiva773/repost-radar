#!/usr/bin/env bash
# Nightly backup of a live install (cron, set up by scripts/server-setup.sh), or run by hand:
#   bash scripts/server-backup.sh
# backups/db/<date>.dump  = the whole database (pg_dump custom format), the last KEEP_DAYS days kept
# backups/images/         = a mirror of the image bucket (originals, crawled images, evidence), as of the last run
# Both live on this server: they undo mistakes, not the loss of the server. Copy backups/ elsewhere for that.
set -euo pipefail
# shellcheck source=lib/server-env.sh
. "$(dirname "$0")/lib/server-env.sh"
load_env
KEEP_DAYS="${KEEP_DAYS:-7}"
BACKUP_DIR="$REPO_DIR/backups"
BACKUP_DAY="$(date -u +%F)"
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/images"

echo "$(date -u +%FT%TZ) Step 1/3: database dump"
compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$BACKUP_DIR/db/$BACKUP_DAY.dump.partial"
mv "$BACKUP_DIR/db/$BACKUP_DAY.dump.partial" "$BACKUP_DIR/db/$BACKUP_DAY.dump"
echo "$(date -u +%FT%TZ) Step 2/3: image bucket mirror"
compose run --rm --no-deps -v "$BACKUP_DIR/images:/backup" --entrypoint aws s3-init \
  --endpoint-url http://s3:8333 s3 sync "s3://$S3_BUCKET" /backup --delete --only-show-errors
echo "$(date -u +%FT%TZ) Step 3/3: removing dumps older than $KEEP_DAYS days"
find "$BACKUP_DIR/db" -name '*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) backup done: $(du -sh "$BACKUP_DIR" | cut -f1) in $BACKUP_DIR"
