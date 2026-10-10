# Thin wrapper over the root package.json scripts, so `make` and `pnpm run` stay in sync.
# Windows without make: use `pnpm run <target>` instead.
.PHONY: up down logs migrate ping seed eval test typecheck gate

up:
	pnpm run up

down:
	pnpm run down

logs:
	pnpm run logs

migrate:
	pnpm run migrate

ping:
	pnpm run ping

seed:
	pnpm run seed

eval:
	pnpm run eval

typecheck:
	pnpm run typecheck

test:
	pnpm run test

# Phase 0 gate: everything up, schema applied, health green, ping reaches the Python worker
gate:
	bash scripts/phase0-gate.sh
