#!/usr/bin/env bash
# Turns this Codespace into a public demo with an HTTPS link anyone can open (docs/TESTING.md, "Public demo"):
#   bash scripts/codespace-demo.sh            demo on: sign-up off, strong operator password, link public
#   bash scripts/codespace-demo.sh --private  link private again (only you, signed in to GitHub)
# The settings stay in .env, so every later start of this Codespace comes up as the demo by itself.
# The link works only while the Codespace is running; it stops after the idle timeout.
set -euo pipefail
cd "$(dirname "$0")/.."
UI_PORT=3000
DEMO_COMPOSE_FILE="docker-compose.yml:docker-compose.demo.yml"
EXAMPLE_ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' .env.example | cut -d= -f2-)"

[ -n "${CODESPACE_NAME:-}" ] || { echo "Run this inside a GitHub Codespace (CODESPACE_NAME is not set)" >&2; exit 1; }
DEMO_URL="https://${CODESPACE_NAME}-${UI_PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"

set_env() {
  local envKey="$1" envValue="$2"
  if grep -q "^$envKey=" .env; then sed -i "s|^$envKey=.*|$envKey=$envValue|" .env; else echo "$envKey=$envValue" >> .env; fi
}

# Returns non-zero when GitHub refuses: the Codespace's own token often lacks the permission
set_port_visibility() {
  local portVisibility="$1"
  if gh codespace ports visibility "$UI_PORT:$portVisibility" -c "$CODESPACE_NAME" > /dev/null 2>&1; then
    echo "Port $UI_PORT is now $portVisibility"
    return 0
  fi
  cat >&2 <<HELP
Could not make port $UI_PORT $portVisibility from inside the Codespace. Do it one of these ways:
  - PORTS tab: right-click port $UI_PORT > Port Visibility > ${portVisibility^}
  - On your own computer: gh codespace ports visibility $UI_PORT:$portVisibility -c $CODESPACE_NAME
HELP
  return 1
}

if [ "${1:-}" = "--private" ]; then
  set_port_visibility private
  exit $?
fi

[ -f .env ] || cp .env.example .env
echo "Step 1/3: demo settings in .env (sign-up off, HTTPS cookies, restart after crashes)"
set_env COMPOSE_FILE "$DEMO_COMPOSE_FILE"
set_env SIGNUP_ENABLED false
# The example password is public in this repo: replace it before the link goes public. Not printed.
if [ "$(grep -E '^ADMIN_PASSWORD=' .env | cut -d= -f2-)" = "$EXAMPLE_ADMIN_PASSWORD" ]; then
  set_env ADMIN_PASSWORD "$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 24)"
  echo "  new operator password written to .env (see it with: grep ^ADMIN_PASSWORD .env)"
fi
chmod 600 .env

echo "Step 2/3: starting the stack with those settings"
bash scripts/codespace-up.sh

echo "Step 3/3: making the link public"
if set_port_visibility public; then
  echo
  echo "Public demo: $DEMO_URL"
else
  echo
  echo "Demo is running, but the link is NOT public yet (see above). Once port $UI_PORT is public: $DEMO_URL"
fi
cat <<MESSAGE
  Sign-up is off. Give someone an account:
    docker compose exec api node dist/cli/addUser.js friend@example.com "Their name"
  Make the link private again: bash scripts/codespace-demo.sh --private
MESSAGE
