#!/usr/bin/env bash
# Phase 2 live soak: watch two busy real subreddits for an hour and confirm the crawler keeps up.
# Needs a Reddit "script" app: REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET / REDDIT_USER_AGENT in .env.
# Pass: no HTTP 429s, and the match queue's waiting count is not growing at the end.
set -euo pipefail

if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${REDDIT_CLIENT_ID:?set REDDIT_CLIENT_ID in .env (register an app at https://www.reddit.com/prefs/apps)}"
: "${REDDIT_CLIENT_SECRET:?set REDDIT_CLIENT_SECRET in .env}"
API_URL="${API_URL:-http://localhost:8080}"
SOAK_SUBREDDITS="${SOAK_SUBREDDITS:-pics EarthPorn}"
SOAK_MINUTES="${SOAK_MINUTES:-60}"
SAMPLE_EVERY_SECONDS=300

echo "Step 1: starting the stack in live mode"
GATE_REDDIT_MODE=live GATE_CRAWLER_TICK_SECONDS=30 docker compose up -d --build --wait postgres redis s3 api crawler fingerprint-worker
pnpm run migrate
. scripts/lib/api-session.sh
api_login

echo "Step 2: watching: $SOAK_SUBREDDITS"
for subreddit in $SOAK_SUBREDDITS; do
  api_curl -X POST -H 'content-type: application/json' \
    -d "{\"platform\":\"reddit\",\"target\":\"$subreddit\",\"pollIntervalSeconds\":60}" /watch-targets || true
  echo
done

echo "Step 3: sampling /metrics every ${SAMPLE_EVERY_SECONDS}s for ${SOAK_MINUTES} minutes"
first_waiting=""
for ((elapsed = 0; elapsed <= SOAK_MINUTES * 60; elapsed += SAMPLE_EVERY_SECONDS)); do
  metrics_json="$(api_curl /metrics)"
  waiting_count="$(echo "$metrics_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);console.log(m.queueDepths?.match?.waiting ?? 0)})')"
  first_waiting="${first_waiting:-$waiting_count}"
  echo "t+$((elapsed / 60))m match queue waiting=$waiting_count  $metrics_json"
  [ "$elapsed" -lt $((SOAK_MINUTES * 60)) ] && sleep "$SAMPLE_EVERY_SECONDS"
done

throttled_count="$(echo "$metrics_json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);console.log(m.crawlRequestsLastHourByStatus?.["429"] ?? 0)})')"
echo "429 responses in the last hour: $throttled_count; match queue waiting: start $first_waiting, end $waiting_count"
if [ "$throttled_count" -gt 0 ] || [ "$waiting_count" -gt $((first_waiting + 50)) ]; then
  echo "Soak FAILED"; exit 1
fi
echo "Soak passed"
