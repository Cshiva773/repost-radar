#!/usr/bin/env bash
# Test area R plus case P5 behind Caddy (test sheet, 10 Nov), on a machine set up with scripts/server-setup.sh.
# CI runs it on fresh ARM and x86 runners. Never stops at a failure: each case ends in
# "RESULT <id> <PASS|FAIL> <what was seen>", also appended to journey-results.tsv.
#   bash scripts/deploy-journeys.sh fresh     right after setup (before any backup): R1, R6, R7, R15, P5
#   bash scripts/deploy-journeys.sh existing  after scripts/deploy-smoke.sh: R3, R5, R10-R14, R16
#   bash scripts/deploy-journeys.sh example-env  after `cp .env.example .env` + setup: R4
set -uo pipefail
PHASE_NAME="${1:?fresh, existing or example-env}"
# shellcheck source=lib/server-env.sh
. "$(dirname "$0")/lib/server-env.sh"
load_env
RESULTS_FILE="${RESULTS_FILE:-$REPO_DIR/journey-results.tsv}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
CURL_FLAGS=(-s ${CURL_INSECURE:+-k} --max-time 30)

record() {
  echo "RESULT $1 $2 $3"
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$RESULTS_FILE"
}

base_url() { echo "https://$SITE_ADDRESS/api"; }

sign_in_status() {
  curl "${CURL_FLAGS[@]}" -o /dev/null -w '%{http_code}' -c "$1" -H 'content-type: application/json' \
    -d "$(jq -nc --arg username "$2" --arg password "$3" '{username: $username, password: $password}')" "$(base_url)/auth/login"
}

wait_for_health() {
  local attemptNumber
  for attemptNumber in $(seq 1 60); do curl "${CURL_FLAGS[@]}" -f "$(base_url)/health" > /dev/null 2>&1 && return 0; sleep 3; done
  return 1
}

secrets_fingerprint() { grep -E '^(POSTGRES_PASSWORD|S3_ACCESS_KEY|S3_SECRET_KEY|ADMIN_PASSWORD)=' .env | sha256sum | cut -c1-12; }

phase_fresh() {
  if wait_for_health && [ -f /etc/cron.d/repost-radar-backup ]; then
    record R1 PASS "$(uname -m): setup finished, https://$SITE_ADDRESS/api/health answers, backup cron installed"
  else
    record R1 FAIL "$(uname -m): health $(curl "${CURL_FLAGS[@]}" -o /dev/null -w '%{http_code}' "$(base_url)/health"); cron file present: $([ -f /etc/cron.d/repost-radar-backup ] && echo yes || echo no)"
  fi
  local statusOutput statusExit
  statusOutput="$(bash scripts/server-status.sh 2>&1)"; statusExit=$?
  if [ "$statusExit" = 0 ] && grep -q '"status":"ok"' <<< "$statusOutput" && grep -qi "no backup" <<< "$statusOutput"; then
    record R15 PASS "status runs on a new install: services, HTTPS ok, sources table, says no backup yet"
  else
    record R15 FAIL "exit $statusExit; last lines: $(tail -3 <<< "$statusOutput" | tr '\n' ' ')"
  fi
  local redirectInfo
  redirectInfo="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "http://$SITE_ADDRESS/review?x=1")"
  [[ "$redirectInfo" == 30[178]\ https://$SITE_ADDRESS/review?x=1 ]] && record R6 PASS "http → $redirectInfo" || record R6 FAIL "http answered: $redirectInfo"
  local openPortList
  openPortList="$(ss -ltnH | awk '{print $4}' | sed -E 's/.*:([0-9]+)$/\1/' | sort -un | tr '\n' ' ')"
  local leakedPorts=""
  for privatePort in 5432 6379 8333 8080 3000 8090 9333; do grep -qw "$privatePort" <<< "$openPortList" && leakedPorts+="$privatePort "; done
  [ -z "$leakedPorts" ] && record R7 PASS "listening: $openPortList(no app ports)" || record R7 FAIL "app ports reachable: $leakedPorts"
  local blockedAt=""
  for attemptNumber in $(seq 1 40); do
    local attemptStatus
    attemptStatus="$(curl "${CURL_FLAGS[@]}" -o /dev/null -w '%{http_code}' -H "x-forwarded-for: 203.0.113.$attemptNumber" -H 'content-type: application/json' \
      -d "{\"username\":\"forged-$attemptNumber@example.com\",\"password\":\"wrong-password-1\"}" "$(base_url)/auth/login")"
    [ "$attemptStatus" = 429 ] && { blockedAt="$attemptNumber"; break; }
  done
  [ -n "$blockedAt" ] && [ "$blockedAt" -le 31 ] && record P5 PASS "behind Caddy + nginx: forged X-Forwarded-For ignored, blocked at attempt $blockedAt" \
    || record P5 FAIL "behind Caddy + nginx: forged X-Forwarded-For got around the limit (blocked at: ${blockedAt:-never in 40})"
  compose exec -T redis sh -c "redis-cli --scan --pattern 'login-failures*' | xargs -r redis-cli del" > /dev/null
}

phase_existing() {
  local operatorJar="$WORK_DIR/operator.jar"
  sign_in_status "$operatorJar" "$ADMIN_USERNAME" "$ADMIN_PASSWORD" > /dev/null
  # R3: setup again on a live install
  local secretsBefore rulesBefore cronBefore assetsBefore
  secretsBefore="$(secrets_fingerprint)"; rulesBefore="$(sudo iptables -S INPUT | grep -c 'dport 443')"; cronBefore="$(sudo cat /etc/cron.d/repost-radar-backup | wc -l)"
  assetsBefore="$(compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT count(*) FROM assets' | tr -d '[:space:]')"
  local rerunExit
  bash scripts/server-setup.sh "$SITE_ADDRESS" > "$WORK_DIR/rerun.log" 2>&1; rerunExit=$?
  load_env
  local sessionStatus assetsAfter
  sessionStatus="$(curl "${CURL_FLAGS[@]}" -o /dev/null -w '%{http_code}' -b "$operatorJar" "$(base_url)/auth/me")"
  assetsAfter="$(compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT count(*) FROM assets' | tr -d '[:space:]')"
  local rulesAfter cronAfter
  rulesAfter="$(sudo iptables -S INPUT | grep -c 'dport 443')"; cronAfter="$(sudo cat /etc/cron.d/repost-radar-backup | wc -l)"
  if [ "$rerunExit" = 0 ] && [ "$(secrets_fingerprint)" = "$secretsBefore" ] && [ "$sessionStatus" = 200 ] && [ "$assetsAfter" = "$assetsBefore" ] && [ "$rulesAfter" = "$rulesBefore" ] && [ "$cronAfter" = "$cronBefore" ]; then
    record R3 PASS "re-run exit 0; secrets unchanged; session still valid; $assetsAfter originals kept; firewall rules $rulesAfter, cron lines $cronAfter (no duplicates)"
  else
    record R3 FAIL "exit $rerunExit; secrets changed: $([ "$(secrets_fingerprint)" = "$secretsBefore" ] && echo no || echo yes); session $sessionStatus; originals $assetsBefore → $assetsAfter; port-443 rules $rulesBefore → $rulesAfter; cron lines $cronBefore → $cronAfter"
  fi
  # R10: update with nothing new
  local updateExit
  bash scripts/server-update.sh > "$WORK_DIR/update.log" 2>&1; updateExit=$?
  wait_for_health
  local appliedLine
  appliedLine="$(grep -E 'migration\(s\) applied' "$WORK_DIR/update.log" | tail -1)"
  [ "$updateExit" = 0 ] && grep -q "0 migration(s) applied" <<< "$appliedLine" && record R10 PASS "update exit 0, \"$appliedLine\", site up" \
    || record R10 FAIL "update exit $updateExit; ${appliedLine:-no migration line}; last lines: $(tail -3 "$WORK_DIR/update.log" | tr '\n' ' ')"
  # R11: a hand edit to a file the update is about to change: the pull must refuse before anything restarts
  git fetch --quiet --deepen=1 origin "$DEPLOY_BRANCH" 2> /dev/null
  local headCommit changedFile
  headCommit="$(git rev-parse HEAD)"
  changedFile="$(git diff --name-only HEAD~1 HEAD 2> /dev/null | grep -vE '^(scripts|\.github)/' | head -1)"
  if [ -z "$changedFile" ]; then
    record R11 FAIL "not exercised: the last commit changes no file outside scripts/ and .github/"
  else
    git reset --quiet --hard HEAD~1
    echo "local edit on the server" >> "$changedFile"
    local editedExit containersBefore containersAfter stillUp
    containersBefore="$(compose ps -q | sort | sha256sum)"
    bash scripts/server-update.sh > "$WORK_DIR/update-edited.log" 2>&1; editedExit=$?
    containersAfter="$(compose ps -q | sort | sha256sum)"
    stillUp="$(curl "${CURL_FLAGS[@]}" -o /dev/null -w '%{http_code}' "$(base_url)/health")"
    git checkout -- "$changedFile"; git reset --quiet --hard "$headCommit"
    if [ "$editedExit" != 0 ] && [ "$containersBefore" = "$containersAfter" ] && [ "$stillUp" = 200 ]; then
      record R11 PASS "edit to $changedFile, which the update changes: stopped (exit $editedExit) with \"$(grep -iE 'overwritten|aborting|error' "$WORK_DIR/update-edited.log" | head -1)\"; services untouched; site up"
    else
      record R11 FAIL "edit to $changedFile: exit $editedExit; services recreated: $([ "$containersBefore" = "$containersAfter" ] && echo no || echo yes); health $stillUp; output: $(tail -2 "$WORK_DIR/update-edited.log" | tr '
' ' ')"
    fi
  fi
  # R12: change the operator password
  local oldPassword="$ADMIN_PASSWORD" newPassword
  newPassword="rotated$(openssl rand -hex 8)"
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$newPassword|" .env
  bash scripts/server-update.sh > /dev/null 2>&1
  load_env; wait_for_health; sleep 5
  local oldSession newStatus oldStatus
  oldSession="$(curl "${CURL_FLAGS[@]}" -o /dev/null -w '%{http_code}' -b "$operatorJar" "$(base_url)/auth/me")"
  newStatus="$(sign_in_status "$WORK_DIR/new.jar" "$ADMIN_USERNAME" "$newPassword")"
  oldStatus="$(sign_in_status "$WORK_DIR/old.jar" "$ADMIN_USERNAME" "$oldPassword")"
  [ "$newStatus" = 200 ] && [ "$oldStatus" = 401 ] && [ "$oldSession" = 401 ] \
    && record R12 PASS "new password 200, old 401, old session signed out (401)" \
    || record R12 FAIL "new password $newStatus, old password $oldStatus, old session $oldSession"
  # R13: sign-up on later
  sed -i "s|^SIGNUP_ENABLED=.*|SIGNUP_ENABLED=true|" .env
  bash scripts/server-update.sh > /dev/null 2>&1
  load_env; wait_for_health
  local signupHeaders signupStatus
  signupHeaders="$(curl "${CURL_FLAGS[@]}" -D - -o /dev/null -H 'content-type: application/json' -d '{"email":"later@example.com","password":"later-password-1234"}' "$(base_url)/auth/signup")"
  signupStatus="$(head -1 <<< "$signupHeaders" | awk '{print $2}')"
  grep -qi '^set-cookie: rr_session=.*secure' <<< "$signupHeaders" && local cookieSecure=yes || local cookieSecure=no
  [ "$signupStatus" = 201 ] && [ "$cookieSecure" = yes ] && record R13 PASS "sign-up 201 over HTTPS with a Secure session cookie" \
    || record R13 FAIL "sign-up $signupStatus, Secure cookie: $cookieSecure"
  sed -i "s|^SIGNUP_ENABLED=.*|SIGNUP_ENABLED=false|" .env
  bash scripts/server-update.sh > /dev/null 2>&1; load_env; wait_for_health
  # R14: big uploads
  local creatorJar="$WORK_DIR/creator.jar"
  sign_in_status "$creatorJar" later@example.com later-password-1234 > /dev/null
  compose run --rm --no-deps -v "$WORK_DIR:/out" fingerprint-worker python -c \
    "import numpy, PIL.Image; generator = numpy.random.default_rng(3)
PIL.Image.fromarray(generator.integers(0, 255, (2500, 2500, 3), dtype=numpy.uint8)).save('/out/big.png')
PIL.Image.fromarray(generator.integers(0, 255, (3000, 3000, 3), dtype=numpy.uint8)).save('/out/huge.png')" > /dev/null 2>&1
  local bigResult hugeResult
  bigResult="$(curl "${CURL_FLAGS[@]}" --max-time 120 -o "$WORK_DIR/big.json" -w '%{http_code}' -b "$creatorJar" -F "file=@$WORK_DIR/big.png" "$(base_url)/assets")"
  hugeResult="$(curl "${CURL_FLAGS[@]}" --max-time 120 -o "$WORK_DIR/huge.out" -w '%{http_code} %{content_type}' -b "$creatorJar" -F "file=@$WORK_DIR/huge.png" "$(base_url)/assets")"
  local hugeMessage
  hugeMessage="$(jq -r '.message // empty' "$WORK_DIR/huge.out" 2> /dev/null)"
  if [ "$bigResult" = 202 ] && [ -n "$hugeMessage" ]; then
    record R14 PASS "$(du -m "$WORK_DIR/big.png" | cut -f1) MB accepted (202); $(du -m "$WORK_DIR/huge.png" | cut -f1) MB refused with \"$hugeMessage\""
  else
    record R14 FAIL "$(du -m "$WORK_DIR/big.png" | cut -f1) MB → $bigResult; $(du -m "$WORK_DIR/huge.png" | cut -f1) MB → $hugeResult, no JSON message (the app would show \"Something went wrong\")"
  fi
  # R16: the exact cron line
  local cronCommand dumpsBefore
  cronCommand="$(sudo sed -E 's/^([^ ]+ ){5}root //' /etc/cron.d/repost-radar-backup)"
  dumpsBefore="$(ls backups/db/*.dump 2> /dev/null | wc -l)"
  sudo rm -f backups/db/"$(date -u +%F)".dump
  sudo bash -c "$cronCommand"
  if [ -f "backups/db/$(date -u +%F).dump" ] && tail -1 backups/backup.log | grep -q "backup done"; then
    record R16 PASS "cron line as root wrote backups/db/$(date -u +%F).dump; log: $(tail -1 backups/backup.log)"
  else
    record R16 FAIL "after the cron line: today's dump $([ -f "backups/db/$(date -u +%F).dump" ] && echo present || echo missing); log tail: $(sudo tail -2 backups/backup.log 2> /dev/null | tr '\n' ' ')"
  fi
  # R5 last: move to another address
  local secretsBeforeMove
  secretsBeforeMove="$(secrets_fingerprint)"
  # A second name for the same machine, as when moving from <ip>.sslip.io to your own domain
  local newAddress=radar.localhost moveExit movedHealth
  bash scripts/server-setup.sh "$newAddress" > "$WORK_DIR/move.log" 2>&1; moveExit=$?
  load_env
  movedHealth="$(curl "${CURL_FLAGS[@]}" -o /dev/null -w '%{http_code}' "https://$newAddress/api/health")"
  [ "$SITE_ADDRESS" = "$newAddress" ] && [ "$movedHealth" = 200 ] && [ "$(secrets_fingerprint)" = "$secretsBeforeMove" ] \
    && record R5 PASS "now served at https://$newAddress (200), secrets unchanged" \
    || record R5 FAIL "setup exit $moveExit; SITE_ADDRESS=$SITE_ADDRESS; https://$newAddress → $movedHealth; secrets changed: $([ "$(secrets_fingerprint)" = "$secretsBeforeMove" ] && echo no || echo yes); log: $(tail -2 "$WORK_DIR/move.log" | tr '\n' ' ')"
}

phase_example_env() {
  local leakedList=""
  local exampleValue
  for envKey in ADMIN_PASSWORD POSTGRES_PASSWORD S3_ACCESS_KEY S3_SECRET_KEY; do
    exampleValue="$(grep -E "^$envKey=" .env.example | cut -d= -f2-)"
    [ "$(grep -E "^$envKey=" .env | tail -1 | cut -d= -f2-)" = "$exampleValue" ] && leakedList+="$envKey "
  done
  local signupSetting
  signupSetting="$(grep -E '^SIGNUP_ENABLED=' .env | tail -1 | cut -d= -f2-)"
  local exampleLogin
  exampleLogin="$(sign_in_status "$WORK_DIR/example.jar" admin "$(grep -E '^ADMIN_PASSWORD=' .env.example | cut -d= -f2-)")"
  [ -z "$leakedList" ] && [ "$signupSetting" = false ] && [ "$exampleLogin" != 200 ] \
    && record R4 PASS "example values replaced, sign-up off, the published password doesn't sign in" \
    || record R4 FAIL "still the published example value: ${leakedList:-none}; SIGNUP_ENABLED=$signupSetting; signing in with the example password: $exampleLogin"
}

case "$PHASE_NAME" in
  fresh) phase_fresh ;;
  existing) phase_existing ;;
  example-env) phase_example_env ;;
  *) echo "Unknown phase $PHASE_NAME" >&2; exit 1 ;;
esac
