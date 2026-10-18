#!/usr/bin/env bash
# Phase 4 gate: phases 0-2 in fixture mode, then the review API end to end against the
# planted candidates (apps/api/scripts/phase4Check.ts), then the UI behind nginx and kill-and-restart
# (scripts/phase4-resilience.sh).
set -euo pipefail

if [ -f .env ]; then set -a; . ./.env; set +a; fi
REPORT_PATH="${REPORT_PATH:-phase4-report.md}"

REPORT_PATH=phase2-report.md bash scripts/phase2-gate.sh

echo "Step 12: phase 4 review API check"
set +e
pnpm --silent --filter @repost-radar/api phase4-check | tee "$REPORT_PATH"
check_exit_code=${PIPESTATUS[0]}
set -e
[ "$check_exit_code" -eq 0 ] || exit "$check_exit_code"

echo "Step 13: review UI and kill-and-restart"
set +e
bash scripts/phase4-resilience.sh | tee -a "$REPORT_PATH"
resilience_exit_code=${PIPESTATUS[0]}
set -e
exit "$resilience_exit_code"
