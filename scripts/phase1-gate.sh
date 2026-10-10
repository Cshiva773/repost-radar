#!/usr/bin/env bash
# Phase 1 gate: Phase 0 gate, then seed 20 CC0 originals in under 2 minutes, then score
# 8 transforms + unrelated pairs and check bank search inside the worker container.
set -euo pipefail

SEED_MAX_SECONDS="${SEED_MAX_SECONDS:-120}"
REPORT_PATH="${REPORT_PATH:-phase1-report.md}"

bash scripts/phase0-gate.sh

echo "Step 6: seeding CC0 originals"
seed_started_at=$(date +%s)
pnpm run seed
seed_seconds=$(( $(date +%s) - seed_started_at ))
echo "Seed took ${seed_seconds}s (limit ${SEED_MAX_SECONDS}s)"

echo "Step 7: scoring transforms and checking bank search"
set +e
docker compose exec -T fingerprint-worker python -m fingerprint_worker.phase1_check | tee "$REPORT_PATH"
check_exit_code=${PIPESTATUS[0]}
set -e

echo "Seed time: ${seed_seconds}s" >> "$REPORT_PATH"
if [ "$seed_seconds" -gt "$SEED_MAX_SECONDS" ]; then
  echo "FAIL  seed took ${seed_seconds}s > ${SEED_MAX_SECONDS}s" | tee -a "$REPORT_PATH"
  exit 1
fi
exit "$check_exit_code"
