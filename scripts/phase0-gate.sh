#!/usr/bin/env bash
# Phase 0 gate: fresh stack up, migrations applied, /health green, a ping job
# enqueued from Node shows up in the Python fingerprint worker's log.
set -euo pipefail

API_URL="${API_URL:-http://localhost:8080}"
export DATABASE_URL="${DATABASE_URL:-postgres://repost_radar:repost_radar_local@localhost:5432/repost_radar}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

echo "Step 1: starting the stack"
docker compose up -d --build --wait postgres redis s3 api crawler fingerprint-worker
docker compose run --rm s3-init

echo "Step 2: applying migrations"
pnpm run migrate

echo "Step 3: checking /health"
health_response="$(curl -fsS "$API_URL/health")"
echo "$health_response"
echo "$health_response" | grep -q '"status":"ok"'

echo "Step 4: enqueueing a ping job"
pnpm run ping

echo "Step 5: waiting for the fingerprint worker to log it"
for attempt in $(seq 1 30); do
  if docker compose logs fingerprint-worker 2>/dev/null | grep -q '"jobName": "ping"'; then
    echo "Gate passed: ping job reached the Python worker"
    exit 0
  fi
  sleep 2
done

echo "Gate failed: ping job never appeared in fingerprint-worker logs"
docker compose logs fingerprint-worker | tail -50
exit 1
