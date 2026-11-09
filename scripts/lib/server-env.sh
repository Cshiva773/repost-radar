# Shared by scripts/server-*.sh: run from the repo root with the production compose files and .env loaded.
# Sourced, not executed.
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
REPO_DIR="$PWD"
export COMPOSE_FILE="docker-compose.yml:docker-compose.prod.yml"
# Long-running services; s3-init (one-shot) and migrate (tools profile) are run separately
LIVE_SERVICE_LIST=(postgres redis s3 api web crawler fingerprint-worker caddy)

# Docker without sudo needs the docker group, which a fresh install only grants from the next login
if docker info > /dev/null 2>&1; then
  DOCKER_COMMAND=(docker)
else
  DOCKER_COMMAND=(sudo docker)
fi

compose() {
  "${DOCKER_COMMAND[@]}" compose "$@"
}

load_env() {
  [ -f .env ] || { echo "No .env in $REPO_DIR; run scripts/server-setup.sh first" >&2; exit 1; }
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  export COMPOSE_FILE="docker-compose.yml:docker-compose.prod.yml"
}
