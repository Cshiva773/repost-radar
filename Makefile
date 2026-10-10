# Thin wrapper over the root package.json scripts, so `make` and `pnpm run` stay in sync.
# Windows without make: use `pnpm run <target>` instead.
.PHONY: up down logs migrate ping seed eval test typecheck gate gate1 gate2 gate4 soak is-copy search

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

# Phase 1 gate: phase 0 + seed 20 CC0 images + transform scores + bank search
gate1:
	bash scripts/phase1-gate.sh

# Phase 2 gate (fixture mode): phases 0-1 + planted copies found by crawler and matcher
gate2:
	bash scripts/phase2-gate.sh

# Phase 4 gate: phase 2 + the review API end to end (sign-in, queue, decisions, templates)
gate4:
	bash scripts/phase4-gate.sh

# Phase 2 live soak: 1 hour against real subreddits (needs REDDIT_CLIENT_ID/SECRET in .env)
soak:
	bash scripts/phase2-soak.sh

# Score image B as a copy of image A (paths relative to the repo root):
#   make is-copy A=data/seed-cache/seed-01.jpg B=my-crop.jpg
is-copy:
	docker compose run --rm -v "$(CURDIR)":/work fingerprint-worker python -m fingerprint_worker.cli is-copy /work/$(A) /work/$(B)

# Closest registered originals for a probe image:  make search P=my-crop.jpg
search:
	docker compose run --rm -v "$(CURDIR)":/work fingerprint-worker python -m fingerprint_worker.cli search /work/$(P)
