#!/usr/bin/env bash
# Test area T (test sheet, 10 Nov): an install running v1 (single creator) is upgraded to the code checked out
# now, and its data must carry on. Starts v1 from OLD_REF in a git worktree, gives it history (an edited
# template, an approved pack, crawled posts), then rebuilds the same compose project from this checkout.
# Every case ends in "RESULT <id> <PASS|FAIL> <what was seen>", also in journey-results.tsv.
#   OLD_REF=ad2c1fc bash scripts/upgrade-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
NEW_DIR="$PWD"
OLD_REF="${OLD_REF:-ad2c1fc}"
OLD_DIR="$(mktemp -d)/repost-radar-v1"
RESULTS_FILE="${RESULTS_FILE:-$NEW_DIR/journey-results.tsv}"
BASE_URL="http://localhost:3000/api"
OLD_TEMPLATE_MARK="OLD-TEMPLATE-V1"
export COMPOSE_PROJECT_NAME=repost-radar
JAR="$(mktemp)"

record() {
  echo "RESULT $1 $2 $3"
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$RESULTS_FILE"
}

api() {
  local httpMethod="$1" requestPath="$2" requestBody="${3:-}"
  local bodyArgs=()
  [ -n "$requestBody" ] && bodyArgs=(-H 'content-type: application/json' -d "$requestBody")
  curl -s -b "$JAR" -c "$JAR" -X "$httpMethod" "${bodyArgs[@]}" "$BASE_URL$requestPath"
}

sign_in_operator() {
  local attemptNumber
  for attemptNumber in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -H 'content-type: application/json' \
      -d "$(jq -nc --arg password "$ADMIN_PASSWORD" '{username: "admin", password: $password}')" "$BASE_URL/auth/login")" = 200 ] && return 0
    sleep 3
  done
  return 1
}

sql() { docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1" 2> /dev/null | tr -d '[:space:]'; }

wait_until() {
  local attemptLimit="$1"; shift
  local attemptNumber
  for ((attemptNumber = 1; attemptNumber <= attemptLimit; attemptNumber++)); do "$@" && return 0; sleep 5; done
  return 1
}

# ---------- v1 with history ----------
git worktree add --force --detach "$OLD_DIR" "$OLD_REF" > /dev/null
cp .env.example "$OLD_DIR/.env"
(cd "$OLD_DIR" && pnpm install --frozen-lockfile > /dev/null && bash scripts/codespace-up.sh) || { record T1 FAIL "v1 at $OLD_REF did not start"; exit 0; }
set -a; . "$OLD_DIR/.env"; set +a
sign_in_operator || { record T1 FAIL "could not sign in to v1"; exit 0; }
api PUT /creator '{"name":"Olivia","legalName":"Olivia Operator","contactEmail":"olivia@example.com","mailingAddress":"1 Operator Road"}' > /dev/null
redditTemplate="$(api GET /notice-templates | jq -c '[.noticeTemplateList[] | select(.platform=="reddit")][0]')"
api PUT "/notice-templates/$(jq -r .templateId <<< "$redditTemplate")" "$(jq -c --arg mark "$OLD_TEMPLATE_MARK" '{platform, name, subject, body: (.body + "\n" + $mark)}' <<< "$redditTemplate")" > /dev/null
wait_until 36 bash -c "curl -s -b '$JAR' '$BASE_URL/candidates?status=pending' | jq -e '.totalCount >= 3' > /dev/null"
approvedId="$(api GET '/candidates?status=pending' | jq -r '.candidateList[0].candidateId')"
api POST "/candidates/$approvedId/decision" '{"action":"approve","goodFaith":true,"note":"before the upgrade"}' > /dev/null
wait_until 24 bash -c "curl -s -b '$JAR' '$BASE_URL/candidates/$approvedId/notice' | jq -e '.noticeText' > /dev/null"
beforeCounts="$(sql "SELECT (SELECT count(*) FROM assets) || '/' || (SELECT count(*) FROM watch_targets WHERE deleted_at IS NULL) || '/' || (SELECT count(*) FROM candidates) || '/' || (SELECT count(*) FROM decisions)")"
crawledBefore="$(sql "SELECT count(*) FROM crawled_posts")"
echo "v1 state: assets/sources/candidates/decisions = $beforeCounts, crawled posts $crawledBefore, approved candidate $approvedId"

# ---------- Upgrade: same compose project, current code ----------
(cd "$OLD_DIR" && docker compose stop api crawler fingerprint-worker web > /dev/null 2>&1)
cp "$OLD_DIR/.env" "$NEW_DIR/.env"
# A real upgrade happens in place: keep v1's fixture feed and image cache (bind-mounted data/)
mkdir -p "$NEW_DIR/data" && cp -r "$OLD_DIR/data/." "$NEW_DIR/data/"
echo "SIGNUP_ENABLED=true" >> "$NEW_DIR/.env"
set -a; . "$NEW_DIR/.env"; set +a
docker compose up -d --build --wait postgres redis s3 api crawler fingerprint-worker fake-reddit > /dev/null
pnpm run migrate > /dev/null
docker compose up -d --build --wait web > /dev/null
rm -f "$JAR"; JAR="$(mktemp)"
sign_in_operator; signInStatus=$?
afterCounts="$(sql "SELECT (SELECT count(*) FROM assets) || '/' || (SELECT count(*) FROM watch_targets WHERE deleted_at IS NULL) || '/' || (SELECT count(*) FROM candidates) || '/' || (SELECT count(*) FROM decisions)")"
approvedStatus="$(api GET "/candidates/$approvedId" | jq -r .status)"
packStatus="$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE_URL/candidates/$approvedId/pack")"
api POST "/candidates/$approvedId/pack" > /dev/null
sleep 3
wait_until 24 bash -c "curl -s -b '$JAR' '$BASE_URL/candidates/$approvedId/notice' | jq -e '.noticeText' > /dev/null"
rebuiltHasMark="$(api GET "/candidates/$approvedId/notice" | jq -r --arg mark "$OLD_TEMPLATE_MARK" '.noticeText | contains($mark)')"
if [ "$signInStatus" = 0 ] && [ "$afterCounts" = "$beforeCounts" ] && [ "$approvedStatus" = approved ] && [ "$packStatus" = 200 ] && [ "$rebuiltHasMark" = true ]; then
  record T1 PASS "operator signs in; assets/sources/candidates/decisions $beforeCounts → $afterCounts; approved pack downloads (200); rebuilt notice still uses the edited template"
else
  record T1 FAIL "sign-in ok: $([ "$signInStatus" = 0 ] && echo yes || echo no); counts $beforeCounts → $afterCounts; candidate $approvedId $approvedStatus; pack $packStatus; rebuilt notice has $OLD_TEMPLATE_MARK: $rebuiltHasMark"
fi

newJar="$(mktemp)"
signupStatus="$(curl -s -o /dev/null -w '%{http_code}' -c "$newJar" -H 'content-type: application/json' -d '{"email":"after-upgrade@example.com","password":"after-upgrade-12345"}' "$BASE_URL/auth/signup")"
newTemplates="$(curl -s -b "$newJar" "$BASE_URL/notice-templates")"
newHasOldMark="$(jq --arg mark "$OLD_TEMPLATE_MARK" '[.noticeTemplateList[].body | select(contains($mark))] | length' <<< "$newTemplates")"
newHasProofLine="$(jq '[.noticeTemplateList[].body | select(contains("{{ownership_proof}}"))] | length' <<< "$newTemplates")"
[ "$signupStatus" = 201 ] && [ "$newHasOldMark" = 0 ] && [ "$newHasProofLine" = 2 ] \
  && record T2 PASS "new creator after the upgrade gets clean defaults (with the proof line), none of the operator's edits" \
  || record T2 FAIL "sign-up $signupStatus; templates with the operator's edit $newHasOldMark; with the proof line $newHasProofLine"

sleep 150
crawledAfter="$(sql "SELECT count(*) FROM crawled_posts")"
duplicatePosts="$(sql "SELECT count(*) FROM (SELECT creator_id, platform, platform_post_id FROM crawled_posts GROUP BY 1, 2, 3 HAVING count(*) > 1) duplicates")"
duplicateCandidates="$(sql "SELECT count(*) FROM (SELECT asset_id, crawled_post_id FROM candidates GROUP BY 1, 2 HAVING count(*) > 1) duplicates")"
[ "$duplicatePosts" = 0 ] && [ "$duplicateCandidates" = 0 ] && [ "$crawledAfter" -ge "$crawledBefore" ] \
  && record T3 PASS "after two crawler ticks: crawled posts $crawledBefore → $crawledAfter, no duplicate posts or matches" \
  || record T3 FAIL "crawled posts $crawledBefore → $crawledAfter; duplicate posts $duplicatePosts; duplicate matches $duplicateCandidates"
git worktree remove --force "$OLD_DIR" > /dev/null 2>&1 || true
