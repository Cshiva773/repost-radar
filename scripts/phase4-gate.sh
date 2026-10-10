#!/usr/bin/env bash
# Phase 4 gate (API half): phases 0-2 in fixture mode, then the review API end to end against the
# planted candidates: auth, queue, images, every decision path, templates (apps/api/scripts/phase4Check.ts).
set -euo pipefail

if [ -f .env ]; then set -a; . ./.env; set +a; fi
REPORT_PATH="${REPORT_PATH:-phase4-report.md}"

REPORT_PATH=phase2-report.md bash scripts/phase2-gate.sh

echo "Step 12: phase 4 review API check"
set +e
pnpm --silent --filter @repost-radar/api phase4-check | tee "$REPORT_PATH"
check_exit_code=${PIPESTATUS[0]}
set -e
exit "$check_exit_code"
