#!/usr/bin/env bash
# Phase 2 gate (fixture mode): phases 0-1, then plant copies in a fake Reddit listing,
# watch it through the API, and check the crawler + matcher turn every copy into a
# pending candidate for the right original. The 1 h live soak needs Reddit credentials
# and is run separately (scripts/phase2-soak.sh).
set -euo pipefail

if [ -f .env ]; then set -a; . ./.env; set +a; fi
export GATE_CRAWLER_TICK_SECONDS="${GATE_CRAWLER_TICK_SECONDS:-10}"
export GATE_REDDIT_MODE=fixture
API_URL="${API_URL:-http://localhost:8080}"
FIXTURE_SUBREDDIT="repostradar_fixture"
REPORT_PATH="${REPORT_PATH:-phase2-report.md}"

REPORT_PATH=phase1-report.md bash scripts/phase1-gate.sh
. scripts/lib/api-session.sh
api_login

echo "Step 8: building the fake Reddit listing"
docker compose exec -T fingerprint-worker python -m fingerprint_worker.make_fixtures --subreddit "$FIXTURE_SUBREDDIT"

echo "Step 9: watching r/$FIXTURE_SUBREDDIT through the API"
api_curl -X POST -H 'content-type: application/json' \
  -d "{\"platform\":\"reddit\",\"target\":\"$FIXTURE_SUBREDDIT\",\"pollIntervalSeconds\":60}" /watch-targets
echo

echo "Step 10: waiting for crawl + match and checking candidates"
set +e
docker compose exec -T fingerprint-worker python -m fingerprint_worker.phase2_check --timeout 90 | tee "$REPORT_PATH"
check_exit_code=${PIPESTATUS[0]}
set -e

echo "Step 11: watch target status and metrics"
api_curl /watch-targets | tee -a "$REPORT_PATH"; echo
api_curl /metrics | tee -a "$REPORT_PATH"; echo
exit "$check_exit_code"
