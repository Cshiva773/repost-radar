# Repost Radar — Build tasks

Every task is sized for one evening and ends in something runnable. Each phase closes with a gate that must pass before the next phase starts. Companion to [PRD.md](PRD.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Phase 0 — Repo and scaffolding

Goal: `docker compose up` starts every container, each answers a health check, nothing does real work yet.

- [x] Repo created (private, `Cshiva773/repost-radar`); docs in `docs/`.
- [x] Monorepo layout: `apps/api`, `apps/crawler`, `workers/fingerprint`, `workers/matcher`, `workers/evidence`, `packages/db`, `eval/`.
- [x] `docker-compose.yml`: Postgres 16 + pgvector, Redis 7, SeaweedFS (S3) + bucket init; volumes; `.env.example`.
- [x] `packages/db`: SQL migrations for the nine tables and indexes; `migrate` applies them to a fresh database.
- [x] `apps/api`: Fastify + TypeScript strict, `/health` reporting DB and Redis, pino logging, Dockerfile.
- [x] `apps/crawler`: TypeScript process that connects to Postgres and Redis, logs a tick every 60 s, exits cleanly on SIGTERM. Dockerfile.
- [x] `workers/fingerprint`: Python 3.11 BullMQ consumer that logs any job. Dockerfile with `pdqhash`, `imagehash`, `open_clip_torch` (CPU torch).
- [x] `Makefile` + root scripts: `up`, `down`, `migrate`, `seed` (stub), `eval` (stub), `test`. GitHub Actions builds and tests on push.
- [x] **Gate:** fresh clone, `make up && make migrate`, all containers healthy, `/health` green, an API-side ping job appears in the Python worker log.

## Phase 1 — Fingerprint

- [x] `POST /assets`: validate type/size, SHA-256, 409 on duplicate, store in the S3 bucket, insert row, enqueue `fingerprint`, return 202.
- [x] Python `fingerprint` job: normalise, pHash, PDQ, CLIP (model loaded once), upsert.
- [x] Shared `fingerprint(image_bytes) -> (phash, pdq, embedding)` module reused by the matcher.
- [x] Hamming (`bit_count(pdq # $1)`) and pgvector top-5 queries (Python `search_bank`, exercised by the phase 1 check).
- [x] `make is-copy A=… B=…` CLI printing distance, similarity, confidence.
- [ ] Hand-test 10 pairs; record scores in `docs/notes/phase1-scores.md`.
- [x] `make seed`: 20 CC0 images registered and fingerprinted.
- [ ] **Gate:** seed < 2 min on CPU; resize ≥ 0.95, unrelated ≤ 0.60; queries return the right asset.

## Phase 2 — Crawl

- [ ] Reddit "script" app registered; OAuth client-credentials token with refresh. **(needs you: Reddit account)**
- [ ] Fixture feed + `REDDIT_MODE=fixture` so CI and dev work offline.
- [ ] `watch_targets` CRUD + status view; reject total rate > 50 req/min.
- [ ] Poll loop with round-robin, `after=last_seen_post_id`, image filter, S3 upload, idempotent insert, match enqueue.
- [ ] Backfill rule for new targets (≤ 1,000 posts or 7 days).
- [ ] Token bucket at 55 req/min, backoff with jitter on 429/5xx, request logging.
- [ ] Python `match` job: fingerprint, Hamming + vector lookups, confidence, skip legitimate, insert candidates.
- [ ] `/metrics` JSON endpoint.
- [ ] Retention job (7 days for unmatched).
- [ ] **Gate:** 5 planted copies found within one interval; 1 h soak, flat queue, zero 429s.

## Phase 3 — Evaluate

- [ ] 200 CC0 originals with `eval/SOURCES.md`.
- [ ] `eval/transform.py`: 8 transforms → 1,600 probes + `labels.csv`.
- [ ] 2,000 negatives, 50 hand-checked.
- [ ] `make eval` with fingerprint cache and `results.csv`.
- [ ] `eval/report.py`: P/R/F1 overall and per transform; threshold sweep; PNG.
- [ ] Tune thresholds; log runs in `docs/notes/phase3-tuning.md`.
- [ ] Hard cases: PDQ dihedral variants, tiled-crop probe.
- [ ] Final table in README.
- [ ] **Gate:** reproducible within ±0.01; P ≥ 0.95, R ≥ 0.90, ≥ 0.98 on resize/re-encode.

## Phase 4 — Review

- [ ] Auth (Argon2, session cookie, protected routes).
- [ ] `GET /candidates` paginated with presigned image URLs.
- [ ] Queue page (React + shadcn).
- [ ] Compare view with four actions and note box.
- [ ] `POST /candidates/:id/decision` transactional, 409 on closed candidate.
- [ ] Approve confirmation with §512(f) warning and good-faith checkbox.
- [ ] Python `evidence` job (PNG, JSON, PDF, ZIP, notice).
- [ ] Template CRUD + renderer that fails on unresolved placeholders; seed Reddit template.
- [ ] `GET /candidates/:id/pack` download.
- [ ] Escalated list tab.
- [ ] Integration test: fixture crawl → match → approve → pack.
- [ ] **Gate:** all PRD acceptance criteria pass; kill-and-restart loses nothing.

## Phase 5 — Stretch

- [ ] README with diagrams, eval table, quick start, non-goals.
- [ ] 60-second demo GIF.
- [ ] Public release: MIT licence, CONTRIBUTING, issue templates.
- [ ] Chrome extension: "Check against Repost Radar" + "File on Reddit" pre-fill.
- [ ] Subreddit discovery suggestions.
- [ ] Video via vPDQ.
- [ ] Second platform.
