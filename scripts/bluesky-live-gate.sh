#!/usr/bin/env bash
# Live Bluesky gate: the stack against real Bluesky (read-only, public AppView, no account).
#  1. phase 0 bring-up, with Bluesky enabled
#  2. live end-to-end: a real #photography post is registered as an original; watching its author, the
#     crawler must find and queue it
#  3. soak: watch two active accounts for SOAK_MINUTES (default 60): zero 429s, no target errors, queue keeps up
set -euo pipefail

if [ -f .env ]; then set -a; . ./.env; set +a; fi
export ENABLED_PLATFORMS=bluesky,reddit
export GATE_CRAWLER_TICK_SECONDS="${GATE_CRAWLER_TICK_SECONDS:-15}"
REPORT_PATH="${REPORT_PATH:-bluesky-live-report.md}"

bash scripts/phase0-gate.sh

echo "Step L1: live end-to-end against Bluesky"
set +e
pnpm --silent --filter @repost-radar/api bluesky-live-check | tee "$REPORT_PATH"
check_exit_code=${PIPESTATUS[0]}
set -e
[ "$check_exit_code" -eq 0 ] || exit "$check_exit_code"

echo "Step L2: soak"
bash scripts/bluesky-soak.sh | tee -a "$REPORT_PATH"
