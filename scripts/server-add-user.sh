#!/usr/bin/env bash
# Gives someone their own private space on a live install while public sign-up is off:
#   bash scripts/server-add-user.sh friend@example.com "Their name"
# Prints a random password once; pass it on privately. To choose it instead: ADD_USER_PASSWORD=... bash scripts/...
set -euo pipefail
[ -n "${1:-}" ] || { echo 'Usage: bash scripts/server-add-user.sh <email> ["display name"]' >&2; exit 1; }
# shellcheck source=lib/server-env.sh
. "$(dirname "$0")/lib/server-env.sh"
load_env
compose exec -T -e ADD_USER_PASSWORD="${ADD_USER_PASSWORD:-}" api node dist/cli/addUser.js "$@"
