#!/usr/bin/env bash
# Proves a live install works end to end, after `bash scripts/server-setup.sh <address>` (CI runs it on an
# ARM machine like Oracle's free Ampere server, with SITE_ADDRESS=localhost and CURL_INSECURE=1):
#   1 HTTPS health, 2 only 80/443 open, 3 operator sign-in, 4 sign-up refused, 5 add-user + their sign-in,
#   6 an upload fingerprinted by the image model, 7 everything back after a Docker restart, 8 backup + restore.
set -euo pipefail
# shellcheck source=lib/server-env.sh
. "$(dirname "$0")/lib/server-env.sh"
load_env
BASE_URL="https://$SITE_ADDRESS/api"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
TEST_USER_EMAIL="smoke-test@example.com"
TEST_USER_PASSWORD="smoke-test-$(openssl rand -hex 8)"
PRIVATE_PORT_LIST=(5432 6379 8333 8080 3000 8090)

https_call() {
  local cookieJar="$1"; shift
  curl -sS ${CURL_INSECURE:+-k} -b "$cookieJar" -c "$cookieJar" "$@"
}

sign_in() {
  local cookieJar="$1" username="$2" password="$3"
  https_call "$cookieJar" -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/auth/login" -H 'content-type: application/json' \
    -d "$(jq -n --arg username "$username" --arg password "$password" '{username: $username, password: $password}')"
}

must() {
  local checkLabel="$1"; shift
  "$@" || { echo "FAIL $checkLabel" >&2; exit 1; }
  echo "PASS $checkLabel"
}

expect_equal() {
  [ "$2" = "$3" ] || { echo "FAIL $1: expected $3, got $2" >&2; exit 1; }
  echo "PASS $1"
}

wait_for_health() {
  local attemptNumber
  for attemptNumber in $(seq 1 60); do
    curl -fsS ${CURL_INSECURE:+-k} --max-time 5 "$BASE_URL/health" > /dev/null 2>&1 && return 0
    sleep 3
  done
  return 1
}

wait_for_fingerprint() {
  local cookieJar="$1" assetId="$2" attemptNumber
  for attemptNumber in $(seq 1 90); do
    [ "$(https_call "$cookieJar" "$BASE_URL/assets/$assetId" | jq -r .isFingerprinted)" = true ] && return 0
    sleep 4
  done
  return 1
}

echo "Step 1: HTTPS health"
must "1 https://$SITE_ADDRESS answers" wait_for_health

echo "Step 2: only Caddy is reachable from outside"
for privatePort in "${PRIVATE_PORT_LIST[@]}"; do
  expect_equal "2 port $privatePort closed" "$(ss -ltnH "( sport = :$privatePort )" | wc -l)" 0
done

echo "Step 3: operator sign-in"
expect_equal "3 operator signs in" "$(sign_in "$WORK_DIR/operator.jar" "$ADMIN_USERNAME" "$ADMIN_PASSWORD")" 200

echo "Step 4: public sign-up is off"
signupStatus="$(https_call "$WORK_DIR/stranger.jar" -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/auth/signup" -H 'content-type: application/json' \
  -d '{"email":"stranger@example.com","password":"a-long-enough-password"}')"
expect_equal "4 sign-up refused" "$signupStatus" 403

echo "Step 5: add-user, then that person signs in"
ADD_USER_PASSWORD="$TEST_USER_PASSWORD" bash scripts/server-add-user.sh "$TEST_USER_EMAIL" "Smoke Test"
expect_equal "5 added user signs in" "$(sign_in "$WORK_DIR/user.jar" "$TEST_USER_EMAIL" "$TEST_USER_PASSWORD")" 200

echo "Step 6: an upload is fingerprinted by the image model"
compose run --rm --no-deps -v "$WORK_DIR:/out" fingerprint-worker python -c \
  "import numpy, PIL.Image; PIL.Image.fromarray(numpy.random.default_rng(7).integers(0, 255, (384, 512, 3), dtype=numpy.uint8)).save('/out/original.png')"
assetId="$(https_call "$WORK_DIR/user.jar" -X POST "$BASE_URL/assets" -F "file=@$WORK_DIR/original.png" | jq -r .assetId)"
must "6 asset $assetId fingerprinted" wait_for_fingerprint "$WORK_DIR/user.jar" "$assetId"

echo "Step 7: everything comes back after Docker restarts (as after a reboot)"
sudo systemctl restart docker
must "7a HTTPS back" wait_for_health
expect_equal "7b session survived" "$(https_call "$WORK_DIR/user.jar" -o /dev/null -w '%{http_code}' "$BASE_URL/auth/me")" 200

echo "Step 8: backup, then restore"
bash scripts/server-backup.sh
dumpFile="$(ls -1t backups/db/*.dump | head -1)"
bash scripts/server-restore.sh "$dumpFile"
must "8 HTTPS back after restore" wait_for_health
expect_equal "8a user still signs in" "$(sign_in "$WORK_DIR/user-again.jar" "$TEST_USER_EMAIL" "$TEST_USER_PASSWORD")" 200
expect_equal "8b original still there" "$(https_call "$WORK_DIR/user-again.jar" "$BASE_URL/assets/$assetId" | jq -r .isFingerprinted)" true
expect_equal "8c original image readable" "$(https_call "$WORK_DIR/user-again.jar" -o /dev/null -w '%{http_code}' "$BASE_URL/assets/$assetId/image")" 200

echo "All deploy smoke checks passed"
