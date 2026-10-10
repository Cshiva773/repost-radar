# Sourced by the gate scripts: signs in once and keeps the session cookie in a temp jar.
# Needs API_URL, ADMIN_PASSWORD and optionally ADMIN_USERNAME (all from .env).
API_COOKIE_JAR="$(mktemp)"
trap 'rm -f "$API_COOKIE_JAR"' EXIT
LOGIN_ATTEMPTS=15

# Retries only on 503: right after `pnpm run migrate` the API may still be creating the admin account.
# Any other failure stops at once, so a wrong password never runs into the login lockout.
api_login() {
  local login_body login_status attempt
  login_body="$(printf '{"username":"%s","password":"%s"}' "${ADMIN_USERNAME:-admin}" "${ADMIN_PASSWORD:?ADMIN_PASSWORD is not set}")"
  for ((attempt = 1; attempt <= LOGIN_ATTEMPTS; attempt++)); do
    login_status="$(curl -s -o /dev/null -w '%{http_code}' -c "$API_COOKIE_JAR" -X POST "$API_URL/auth/login" -H 'content-type: application/json' -d "$login_body")"
    [ "$login_status" = 200 ] && return 0
    [ "$login_status" = 503 ] || break
    sleep 2
  done
  echo "Could not sign in to $API_URL as ${ADMIN_USERNAME:-admin} (HTTP $login_status)" >&2
  return 1
}

# curl with the session cookie: api_curl [curl args...] <path>
api_curl() {
  local request_path="${*: -1}"
  curl -fsS -b "$API_COOKIE_JAR" "${@:1:$#-1}" "$API_URL$request_path"
}
