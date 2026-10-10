#!/usr/bin/env bash
# Brings up the full stack with test data, for Codespaces (or any machine with ~6 GB free for Docker).
# Idempotent: safe to re-run; images are cached after the first build (~8 minutes, mostly the worker's torch).
#   - 20 CC0 sample originals
#   - 5 edited copies planted in the local fixture feed, so the review queue has matches straight away
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env
set -a; . ./.env; set +a
API_URL="${API_URL:-http://localhost:8080}"
# Bluesky is the live platform; make sure it is on even with an older .env
case ",${ENABLED_PLATFORMS:-reddit}," in *,bluesky,*) ;; *) export ENABLED_PLATFORMS="bluesky,${ENABLED_PLATFORMS:-reddit}" ;; esac
FIXTURE_SUBREDDIT="repostradar_fixture"

echo "Step 1/5: building and starting the stack (first run takes a while)"
docker compose up -d --build --wait postgres redis s3 api crawler fingerprint-worker fake-reddit
docker compose run --rm s3-init
echo "Step 2/5: database migrations"
pnpm run migrate
echo "Step 3/5: seeding 20 sample originals"
pnpm run seed
echo "Step 4/5: planting 5 known copies in the fixture feed"
docker compose exec -T fingerprint-worker python -m fingerprint_worker.make_fixtures --subreddit "$FIXTURE_SUBREDDIT" > /dev/null
. scripts/lib/api-session.sh
api_login
api_curl -X POST -H 'content-type: application/json' \
  -d "{\"platform\":\"reddit\",\"target\":\"$FIXTURE_SUBREDDIT\",\"pollIntervalSeconds\":300}" /watch-targets > /dev/null 2>&1 || true
echo "Step 5/5: the review UI"
docker compose up -d --build --wait web

cat <<MESSAGE

Repost Radar is up.
  UI:        port 3000 (in Codespaces: the Ports tab, "Repost Radar UI")
  Sign in:   ${ADMIN_USERNAME:-admin} / the ADMIN_PASSWORD in .env
  Test plan: docs/TESTING.md
The 5 planted copies reach the Review queue within a minute.
MESSAGE
