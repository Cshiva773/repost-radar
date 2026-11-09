#!/usr/bin/env bash
# Brings a live install up to date with main (docs/DEPLOYING.md):
#   bash scripts/server-update.sh
# Pulls, rebuilds, applies new migrations, restarts what changed, and removes old images.
set -euo pipefail
# shellcheck source=lib/server-env.sh
. "$(dirname "$0")/lib/server-env.sh"
load_env
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

echo "Step 1/4: pulling $DEPLOY_BRANCH"
git fetch --quiet origin "$DEPLOY_BRANCH"
git checkout --quiet "$DEPLOY_BRANCH"
git pull --quiet --ff-only origin "$DEPLOY_BRANCH"
git log -1 --format='  now at %h %s'
echo "Step 2/4: building images"
compose --profile tools build
echo "Step 3/4: applying migrations"
compose run --rm migrate
echo "Step 4/4: restarting changed services"
compose up -d --wait --remove-orphans "${LIVE_SERVICE_LIST[@]}"
"${DOCKER_COMMAND[@]}" image prune -f > /dev/null
echo "Updated. Check: bash scripts/server-status.sh"
