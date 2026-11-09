#!/usr/bin/env bash
# One-time setup of a live Repost Radar on a fresh Ubuntu server (docs/DEPLOYING.md). Safe to re-run.
#   bash scripts/server-setup.sh <site address> [operator username]
#   <site address> = your domain (radar.example.com) or <server-ip>.sslip.io; its DNS must point at this server
# Installs Docker, opens ports 80/443, writes .env with fresh secrets (only the first time), builds and
# starts the stack behind Caddy (HTTPS), applies migrations, and adds the nightly backup.
set -euo pipefail
SITE_ADDRESS_ARG="${1:-}"
OPERATOR_USERNAME_ARG="${2:-admin}"
[ -n "$SITE_ADDRESS_ARG" ] || { echo "Usage: bash scripts/server-setup.sh <site address> [operator username]" >&2; exit 1; }
SWAP_FILE=/swapfile
MIN_MEMORY_MB_WITHOUT_SWAP=6000

install_docker() {
  if command -v docker > /dev/null && docker compose version > /dev/null 2>&1; then return; fi
  echo "Step 1/7: installing Docker from Docker's apt repository (docs.docker.com/engine/install/ubuntu)"
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl openssl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  local ubuntuCodename
  ubuntuCodename="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $ubuntuCodename stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
}

# Small servers (e.g. 4 GB) need swap to build the image model's worker; Oracle's 12 GB A1 does not
add_swap_if_small() {
  local memoryMb
  memoryMb="$(free -m | awk '/^Mem:/ {print $2}')"
  if [ "$memoryMb" -ge "$MIN_MEMORY_MB_WITHOUT_SWAP" ] || [ -n "$(swapon --show)" ]; then return; fi
  echo "Step 1b/7: adding a 2 GB swap file ($memoryMb MB memory)"
  sudo fallocate -l 2G "$SWAP_FILE" && sudo chmod 600 "$SWAP_FILE" && sudo mkswap "$SWAP_FILE" > /dev/null && sudo swapon "$SWAP_FILE"
  grep -q "^$SWAP_FILE" /etc/fstab || echo "$SWAP_FILE none swap sw 0 0" | sudo tee -a /etc/fstab > /dev/null
}

# Oracle's Ubuntu images reject everything but SSH in iptables; insert ACCEPTs before that REJECT rule.
# Elsewhere (no REJECT rule) the ACCEPTs are appended and change nothing.
open_port() {
  local protocolName="$1" portNumber="$2" rejectLine
  local ruleList=(-p "$protocolName" --dport "$portNumber" -m conntrack --ctstate NEW -j ACCEPT)
  sudo iptables -C INPUT "${ruleList[@]}" 2> /dev/null && return
  rejectLine="$(sudo iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" {print $1; exit}')"
  if [ -n "$rejectLine" ]; then sudo iptables -I INPUT "$rejectLine" "${ruleList[@]}"; else sudo iptables -A INPUT "${ruleList[@]}"; fi
}

open_firewall() {
  echo "Step 2/7: opening ports 80 and 443 in this server's firewall"
  open_port tcp 80
  open_port tcp 443
  open_port udp 443
  if command -v netfilter-persistent > /dev/null; then sudo netfilter-persistent save > /dev/null 2>&1 || true; fi
}

new_secret() {
  openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"
}

set_env() {
  local envKey="$1" envValue="$2"
  if grep -q "^$envKey=" .env; then sed -i "s|^$envKey=.*|$envKey=$envValue|" .env; else echo "$envKey=$envValue" >> .env; fi
}

read_env_value() {
  grep -E "^$1=" "$2" 2> /dev/null | tail -1 | cut -d= -f2-
}

# A secret that is empty or still the value published in .env.example is replaced; any other value is kept, so a
# re-run leaves a working install alone. Prints the keys it replaced.
replace_example_secrets() {
  local envKey secretLength
  for envKey in POSTGRES_PASSWORD:32 S3_ACCESS_KEY:20 S3_SECRET_KEY:40 ADMIN_PASSWORD:24; do
    secretLength="${envKey#*:}"; envKey="${envKey%%:*}"
    local currentValue
    currentValue="$(read_env_value "$envKey" .env)"
    if [ -z "$currentValue" ] || [ "$currentValue" = "$(read_env_value "$envKey" .env.example)" ]; then
      set_env "$envKey" "$(new_secret "$secretLength")"
      echo "$envKey"
    fi
  done
}

write_env() {
  echo "Step 3/7: writing .env"
  [ -f .env ] || cp .env.example .env
  local postgresPassword
  postgresPassword="$(read_env_value POSTGRES_PASSWORD .env)"
  if [ -z "$postgresPassword" ] || [ "$postgresPassword" = "$(read_env_value POSTGRES_PASSWORD .env.example)" ]; then PREVIOUS_POSTGRES_PASSWORD="$postgresPassword"; fi
  local replacedKeyList
  replacedKeyList="$(replace_example_secrets)"
  if [ -n "$replacedKeyList" ]; then
    echo "  replaced example values: $(echo $replacedKeyList)"
    set_env ADMIN_USERNAME "$OPERATOR_USERNAME_ARG"
    # An install still on example values was never set up for the public: only the operator and people added
    # with server-add-user.sh can sign in until SIGNUP_ENABLED is turned on deliberately
    set_env SIGNUP_ENABLED false
  fi
  set_env SITE_ADDRESS "$SITE_ADDRESS_ARG"
  set_env COMPOSE_FILE "docker-compose.yml:docker-compose.prod.yml"
  set_env COOKIE_SECURE true
  set_env ENABLED_PLATFORMS bluesky
  chmod 600 .env
}

# The database keeps the password it was created with: when .env got a new one for an existing database,
# change it inside Postgres too (the container's local socket needs no password)
rotate_database_password() {
  [ -n "${PREVIOUS_POSTGRES_PASSWORD+set}" ] || return 0
  "${DOCKER_COMMAND[@]}" volume inspect repost-radar_postgres-data > /dev/null 2>&1 || return 0
  echo "  changing the existing database's password to the new one"
  compose up -d --wait postgres
  compose exec -T postgres psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER ROLE \"$POSTGRES_USER\" PASSWORD '$POSTGRES_PASSWORD'"
}

write_storage_keys() {
  printf '{"identities":[{"name":"repost_radar","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","Write","List","Tagging"]}]}\n' \
    "$S3_ACCESS_KEY" "$S3_SECRET_KEY" > infra/seaweedfs/s3.prod.json
  chmod 644 infra/seaweedfs/s3.prod.json
}

install_backup_cron() {
  echo "Step 6/7: nightly backup at 03:30 UTC (scripts/server-backup.sh, keeps 7 days)"
  echo "30 3 * * * root cd $REPO_DIR && bash scripts/server-backup.sh >> $REPO_DIR/backups/backup.log 2>&1" \
    | sudo tee /etc/cron.d/repost-radar-backup > /dev/null
  mkdir -p backups
}

wait_for_https() {
  local attemptNumber
  for attemptNumber in $(seq 1 30); do
    if curl -fsS --max-time 10 ${CURL_INSECURE:+-k} "https://$SITE_ADDRESS/api/health" > /dev/null 2>&1; then return 0; fi
    sleep 5
  done
  echo "HTTPS did not answer yet: check that ports 80/443 are open in the cloud firewall and DNS points here" >&2
  return 1
}

install_docker
add_swap_if_small
open_firewall
# shellcheck source=lib/server-env.sh
. "$(dirname "$0")/lib/server-env.sh"
write_env
load_env
write_storage_keys
rotate_database_password
echo "Step 4/7: building images (the first build takes 10-20 minutes)"
compose --profile tools build
echo "Step 5/7: starting storage, applying migrations, starting everything"
compose up -d --wait postgres redis s3
compose run --rm s3-init
compose run --rm migrate
compose up -d --wait --remove-orphans "${LIVE_SERVICE_LIST[@]}"
install_backup_cron
echo "Step 7/7: checking https://$SITE_ADDRESS"
wait_for_https
cat <<MESSAGE

Repost Radar is live at https://$SITE_ADDRESS
  Sign in as:   $ADMIN_USERNAME  (password: run  grep ^ADMIN_PASSWORD $REPO_DIR/.env  on this server)
  Add someone:  bash scripts/server-add-user.sh friend@example.com "Their name"
  Status:       bash scripts/server-status.sh
  Update:       bash scripts/server-update.sh
MESSAGE
