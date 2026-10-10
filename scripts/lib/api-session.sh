# Sourced by the gate scripts: signs in once and keeps the session cookie in a temp jar.
# Needs API_URL, ADMIN_PASSWORD and optionally ADMIN_USERNAME (all from .env).
API_COOKIE_JAR="$(mktemp)"
trap 'rm -f "$API_COOKIE_JAR"' EXIT

api_login() {
  local login_body
  login_body="$(printf '{"username":"%s","password":"%s"}' "${ADMIN_USERNAME:-admin}" "${ADMIN_PASSWORD:?ADMIN_PASSWORD is not set}")"
  curl -fsS -o /dev/null -c "$API_COOKIE_JAR" -X POST "$API_URL/auth/login" -H 'content-type: application/json' -d "$login_body"
}

# curl with the session cookie: api_curl [curl args...] <path>
api_curl() {
  local request_path="${*: -1}"
  curl -fsS -b "$API_COOKIE_JAR" "${@:1:$#-1}" "$API_URL$request_path"
}
