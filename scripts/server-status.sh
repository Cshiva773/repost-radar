#!/usr/bin/env bash
# Is the live install healthy? Services, the public HTTPS check, each source's last crawl, and the last backup.
#   bash scripts/server-status.sh
set -euo pipefail
# shellcheck source=lib/server-env.sh
. "$(dirname "$0")/lib/server-env.sh"
load_env

echo "== Services"
compose ps --format 'table {{.Service}}\t{{.Status}}'
echo
echo "== https://$SITE_ADDRESS/api/health"
curl -fsS --max-time 10 ${CURL_INSECURE:+-k} "https://$SITE_ADDRESS/api/health" || echo "NOT REACHABLE"
echo
echo
echo "== Sources (newest crawl first)"
compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT platform, target_name, enabled, last_crawled_at, posts_seen_count, left(coalesce(last_error, ''), 60) AS last_error
     FROM watch_targets WHERE deleted_at IS NULL ORDER BY last_crawled_at DESC NULLS LAST"
echo "== Last backup"
ls -1t "$REPO_DIR/backups/db" 2> /dev/null | head -1 || true
tail -1 "$REPO_DIR/backups/backup.log" 2> /dev/null || echo "no backup log yet"
