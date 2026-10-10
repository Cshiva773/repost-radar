#!/usr/bin/env bash
# Phase 4 gate, second half: the UI behind nginx, "kill-and-restart loses nothing", and takedowns
# closing open candidates (simulated through the fixture service's /api/info.json).
# Runs after phase4Check.ts, which leaves 2 pending candidates and 1 marked legitimate.
set -euo pipefail

if [ -f .env ]; then set -a; . ./.env; set +a; fi
# Same values the earlier gates started the stack with, so `docker compose up` never recreates a service
export CRAWLER_TICK_SECONDS="${GATE_CRAWLER_TICK_SECONDS:-10}"
export REDDIT_MODE=fixture
API_URL="${API_URL:-http://localhost:8080}"
WEB_URL="${WEB_URL:-http://localhost:${WEB_PORT:-3000}}"
PACK_TIMEOUT_SECONDS=90
# The crawler re-checks every 5 ticks (10 s each in the gate)
RECHECK_TIMEOUT_SECONDS=120
. scripts/lib/api-session.sh
failure_count=0

check() { if [ "$2" = "true" ]; then echo "PASS  $1"; else echo "FAIL  $1  ($3)"; failure_count=$((failure_count + 1)); fi; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log($1)})"; }
http_status() { curl -s -o /dev/null -w '%{http_code}' -b "$API_COOKIE_JAR" "$@"; }

echo "Step R1: review UI through nginx"
docker compose up -d --build --no-deps --wait web
index_html="$(curl -fsS "$WEB_URL/")"
check "UI index is served" "$([[ "$index_html" == *"<title>Repost Radar</title>"* ]] && echo true)" "no title"
check "client-side route falls back to index.html" "$([ "$(curl -s -o /dev/null -w '%{http_code}' "$WEB_URL/queue/pending")" = 200 ] && echo true)" "deep link"
check "/api is proxied and still needs a session" "$([ "$(curl -s -o /dev/null -w '%{http_code}' "$WEB_URL/api/candidates")" = 401 ] && echo true)" "proxy"
API_URL="$WEB_URL/api" api_login
check "sign-in through the proxy sets a working cookie" "$([ "$(http_status "$WEB_URL/api/candidates")" = 200 ] && echo true)" "cookie"

echo "Step R2: approve while the worker is dead, then restart the API"
pending_id="$(api_curl "/candidates?status=pending&pageSize=1" | json 'o.candidateList[0]?.candidateId ?? ""')"
legitimate_id="$(api_curl "/candidates?status=legitimate&pageSize=1" | json 'o.candidateList[0]?.candidateId ?? ""')"
[ -n "$pending_id" ] && [ -n "$legitimate_id" ] || { echo "FAIL  need a pending and a legitimate candidate from phase4Check"; exit 1; }
docker compose kill fingerprint-worker
api_curl -X POST -H 'content-type: application/json' -d '{"action":"approve","goodFaith":true,"note":"resilience check"}' "/candidates/$pending_id/decision" > /dev/null
check "pack is pending while no worker runs" "$([ "$(http_status "$WEB_URL/api/candidates/$pending_id/pack")" = 202 ] && echo true)" "expected 202"
docker compose restart api && docker compose up -d --wait api
check "session survives an API restart" "$([ "$(http_status "$WEB_URL/api/auth/me")" = 200 ] && echo true)" "signed out"

echo "Step R3: bring the worker back; the queued evidence job must still run"
docker compose up -d --wait fingerprint-worker
pack_status=000
for ((waited = 0; waited < PACK_TIMEOUT_SECONDS; waited += 3)); do
  pack_status="$(http_status "$WEB_URL/api/candidates/$pending_id/pack")"
  [ "$pack_status" = 200 ] && break
  sleep 3
done
check "evidence job queued during the outage completes" "$([ "$pack_status" = 200 ] && echo true)" "HTTP $pack_status"

echo "Step R4: restart the crawler; the legitimate image stays closed"
docker compose restart crawler
sleep "${GATE_CRAWLER_TICK_SECONDS:-10}"
legitimate_status="$(api_curl "/candidates/$legitimate_id" | json 'o.status')"
check "legitimate candidate is still legitimate after a crawler restart" "$([ "$legitimate_status" = legitimate ] && echo true)" "$legitimate_status"

echo "Step R5: a copy taken down on the platform closes its open candidate"
removed_target_id="$(api_curl "/candidates?status=pending&pageSize=1" | json 'o.candidateList[0]?.candidateId ?? ""')"
[ -n "$removed_target_id" ] || { echo "FAIL  need one pending candidate left for the takedown check"; exit 1; }
# An empty /api/info answer: every post the crawler asks about is gone
echo '{"data":{"children":[]}}' | docker compose exec -T fingerprint-worker sh -c 'mkdir -p /fixtures/api && cat > /fixtures/api/info.json'
removed_status=pending
for ((waited = 0; waited < RECHECK_TIMEOUT_SECONDS; waited += 5)); do
  removed_status="$(api_curl "/candidates/$removed_target_id" | json 'o.status')"
  [ "$removed_status" = removed ] && break
  sleep 5
done
check "taken-down copy closes as removed" "$([ "$removed_status" = removed ] && echo true)" "$removed_status"
check "the closure is audited as a system decision" "$([ "$(api_curl "/candidates/$removed_target_id" | json 'o.decisionList.at(-1)?.actor')" = system ] && echo true)" "actor"
check "its stored copy is deleted" "$([ "$(http_status "$API_URL/candidates/$removed_target_id/images/candidate")" = 404 ] && echo true)" "image still served"

[ "$failure_count" -eq 0 ] && echo "Phase 4 resilience check passed" || { echo "Phase 4 resilience check FAILED: $failure_count step(s)"; exit 1; }
