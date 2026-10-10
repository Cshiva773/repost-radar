#!/usr/bin/env bash
# Bluesky soak: watch active accounts (or SOAK_TARGETS) on a running stack and confirm the crawler keeps up within its
# request budget. Pass: no HTTP 429 from Bluesky, no watch-target errors, Bluesky requests keep
# succeeding, and the match queue is not growing at the end.
set -euo pipefail

if [ -f .env ]; then set -a; . ./.env; set +a; fi
API_URL="${API_URL:-http://localhost:8080}"
# Default: the authors of two recent #photography posts. Account feeds, not hashtag search: Bluesky's
# search endpoint refuses some cloud networks (CI included). Override with e.g. SOAK_TARGETS="#art @someone.bsky.social".
SOAK_TARGETS="${SOAK_TARGETS:-$(node -e "fetch('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=%23photography&sort=latest&limit=100',{headers:{'User-Agent':'repost-radar/0.1 (soak)'}}).then(r=>r.json()).then(b=>{const h=[...new Set((b.posts||[]).filter(p=>p.embed&&p.author&&p.author.handle&&!p.author.handle.endsWith('.brid.gy')).map(p=>p.author.handle))];console.log(h.slice(0,2).map(x=>'@'+x).join(' '))})")}"
[ -n "$SOAK_TARGETS" ] || { echo "Could not pick soak accounts; set SOAK_TARGETS"; exit 1; }
SOAK_MINUTES="${SOAK_MINUTES:-60}"
SAMPLE_EVERY_SECONDS="${SAMPLE_EVERY_SECONDS:-300}"
. scripts/lib/api-session.sh
api_login
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log($1)})"; }

echo "Soak: watching $SOAK_TARGETS for ${SOAK_MINUTES} min"
for soak_target in $SOAK_TARGETS; do
  api_curl -X POST -H 'content-type: application/json' -d "{\"platform\":\"bluesky\",\"target\":\"$soak_target\",\"pollIntervalSeconds\":60}" /watch-targets > /dev/null 2>&1 || true
done

first_waiting=""
for ((elapsed = 0; elapsed <= SOAK_MINUTES * 60; elapsed += SAMPLE_EVERY_SECONDS)); do
  metrics_json="$(api_curl /metrics)"
  waiting_count="$(echo "$metrics_json" | json 'o.queueDepths?.match?.waiting ?? 0')"
  bluesky_ok="$(echo "$metrics_json" | json 'o.crawlRequestsLastHourByPlatform?.bluesky?.["200"] ?? 0')"
  bluesky_throttled="$(echo "$metrics_json" | json 'o.crawlRequestsLastHourByPlatform?.bluesky?.["429"] ?? 0')"
  target_errors="$(echo "$metrics_json" | json '(o.watchTargetErrors ?? []).length')"
  first_waiting="${first_waiting:-$waiting_count}"
  echo "t+$((elapsed / 60))m  bluesky 200s=$bluesky_ok 429s=$bluesky_throttled  match waiting=$waiting_count  target errors=$target_errors"
  [ "$elapsed" -lt $((SOAK_MINUTES * 60)) ] && sleep "$SAMPLE_EVERY_SECONDS"
done

echo "Watch targets:"
api_curl /watch-targets | json 'o.watchTargetList.map(t => `  ${t.targetName}: ${t.postsSeenCount} images seen, ${t.candidatesFoundCount} matches, last error ${t.lastError ?? "none"}`).join("\n")'

failure_count=0
[ "$bluesky_throttled" -eq 0 ] || { echo "FAIL  Bluesky answered 429 $bluesky_throttled time(s)"; failure_count=$((failure_count + 1)); }
[ "$bluesky_ok" -gt 0 ] || { echo "FAIL  no successful Bluesky requests in the last hour"; failure_count=$((failure_count + 1)); }
[ "$target_errors" -eq 0 ] || { echo "FAIL  $target_errors watch target(s) report an error"; failure_count=$((failure_count + 1)); }
# A first-crawl backfill can leave a burst at the start; what matters is that it drains
[ "$waiting_count" -le $((first_waiting + 50)) ] || { echo "FAIL  match queue grew from $first_waiting to $waiting_count"; failure_count=$((failure_count + 1)); }
[ "$failure_count" -eq 0 ] && echo "Bluesky soak passed" || { echo "Bluesky soak FAILED"; exit 1; }
