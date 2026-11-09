#!/usr/bin/env bash
# Test cases S2, S3 and S7 (test sheet, 10 Nov) for scripts/codespace-demo.sh, on a machine where the demo
# script already ran once and its output is in DEMO_OUTPUT_FILE. Each case ends in "RESULT <id> <PASS|FAIL> ...",
# also appended to journey-results.tsv.
#   DEMO_OUTPUT_FILE=demo-first-run.log bash scripts/demo-journeys.sh
set -uo pipefail
cd "$(dirname "$0")/.."
RESULTS_FILE="${RESULTS_FILE:-journey-results.tsv}"
DEMO_OUTPUT_FILE="${DEMO_OUTPUT_FILE:?set it to the output of the first demo run}"

record() {
  echo "RESULT $1 $2 $3"
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$RESULTS_FILE"
}

sql() {
  set -a; . ./.env; set +a
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$1" | tr -d '[:space:]'
}

# S3: in CI, as inside a Codespace without the permission, the port can't be made public
if grep -qE "Could not (change|make) (the )?port" "$DEMO_OUTPUT_FILE" && grep -q "^Public demo:" "$DEMO_OUTPUT_FILE"; then
  record S3 FAIL "the port could not be made public, yet the script ends with \"$(grep '^Public demo:' "$DEMO_OUTPUT_FILE")\" as if the link worked"
elif grep -qE "Could not (change|make) (the )?port" "$DEMO_OUTPUT_FILE"; then
  record S3 PASS "says the link is not public yet: $(grep -iE 'not public|private' "$DEMO_OUTPUT_FILE" | head -1)"
else
  record S3 FAIL "could not observe the failure path (no port message in the output)"
fi

# S2: a second run keeps the password and the data
passwordBefore="$(grep -E '^ADMIN_PASSWORD=' .env | sha256sum)"
assetsBefore="$(sql 'SELECT count(*) FROM assets')"
bash scripts/codespace-demo.sh > demo-second-run.log 2>&1; secondExit=$?
passwordAfter="$(grep -E '^ADMIN_PASSWORD=' .env | sha256sum)"
assetsAfter="$(sql 'SELECT count(*) FROM assets')"
[ "$secondExit" = 0 ] && [ "$passwordBefore" = "$passwordAfter" ] && [ "$assetsAfter" = "$assetsBefore" ] \
  && record S2 PASS "second run exit 0; operator password unchanged; $assetsAfter originals kept" \
  || record S2 FAIL "second run exit $secondExit; password changed: $([ "$passwordBefore" = "$passwordAfter" ] && echo no || echo yes); originals $assetsBefore → $assetsAfter"

# S7: a plain compose command afterwards (README habit) keeps the demo settings
docker compose up -d --wait api > /dev/null 2>&1
apiContainer="$(docker compose ps -q api)"
restartPolicy="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$apiContainer")"
cookieSecure="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$apiContainer" | grep '^COOKIE_SECURE=' | cut -d= -f2)"
[ "$restartPolicy" = unless-stopped ] && [ "$cookieSecure" = true ] \
  && record S7 PASS "after a plain docker compose up -d api: restart $restartPolicy, COOKIE_SECURE=$cookieSecure" \
  || record S7 FAIL "after a plain docker compose up -d api: restart '$restartPolicy', COOKIE_SECURE='$cookieSecure'"
