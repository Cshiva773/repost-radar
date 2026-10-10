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
- [x] Scores for 10 originals × 8 edits recorded in [`docs/notes/phase1-scores.md`](notes/phase1-scores.md) (automated by `phase1_check`).
- [x] `make seed`: 20 CC0 images registered and fingerprinted.
- [x] **Gate (re-scoped 2026-10-10, passed in CI):** seed < 2 min; near-copy edits (resize, JPEG, filter) ≥ 0.90; unrelated pairs < 0.80 review threshold; bank search 10/10.

## Phase 2 — Crawl

Goal: name a subreddit, watch posts flow in, see matches logged.

- [ ] Reddit "script" app registered; OAuth client-credentials token with refresh. **Needs you:** create the app at reddit.com/prefs/apps and put the id/secret in `.env`. The OAuth client code is done (`apps/crawler/src/reddit/redditClient.ts`).
- [x] Offline mode: `fake-reddit` compose service + `REDDIT_MODE=fixture` (default), so dev and CI need no network or credentials. `make_fixtures` plants copies in a Reddit-shaped listing.
- [x] `watch_targets` CRUD (`GET/POST/PATCH/DELETE /watch-targets`) with status (last crawled, posts seen, candidates found, last error); rejects a total rate over 50 req/min; soft delete keeps found candidates.
- [x] Poll loop: due targets least-recently-crawled first, newest-first paging until the last-seen post (by id or timestamp), image + gallery posts only, 5 MB cap, idempotent insert, match job per new image; ticks never overlap.
- [x] Backfill for new targets (≤ 1,000 posts or 7 days).
- [x] Global token bucket at 55 req/min, exponential backoff with jitter on 429/5xx, per-request status logging and Redis counters.
- [x] Python `match` job (same worker, second queue, shared CLIP model): fingerprint, Hamming + vector lookups, confidence, skip legitimate posts, `pending` ≥ review threshold (0.80 at the time; 0.70 since phase 3) / `suppressed` ≥ 0.60 / dropped below.
- [x] `/metrics` JSON: crawl requests (last minute, last hour by status), queue depths, candidates last hour by status, target errors.
- [x] Retention: unmatched crawled images deleted after 7 days (row + S3 object).
- [x] Platform adapters: shared `@repost-radar/platforms` definitions + crawler adapter registry, `ENABLED_PLATFORMS`, per-platform budgets and metrics, platform-agnostic schema (migration 004). Guide: [ADDING_A_PLATFORM.md](ADDING_A_PLATFORM.md).
- [x] Bluesky adapter: `#hashtag` / `@handle` targets via the public AppView (no credentials), optional app-password session, adult-labelled posts skipped by default, shared retry with Retry-After; live smoke test passed 2026-10-10.
- [ ] Honour deletions for matched posts: before review (and before evidence export), re-check that the source post still exists and mark the candidate `source_deleted` if not. Bluesky's guidelines expect deletions to be respected.
- [x] **Gate (fixture, passed in CI):** 5 planted copies → 5 `pending` candidates on the right originals; 3 synthetic negatives and the text/video posts produce nothing. `make gate2`, runs in CI.
- [ ] **Live soak:** 1 h against two busy subreddits, zero 429s, flat match queue. `make soak`. **Needs you:** Reddit credentials.

## Phase 3 — Evaluate

Goal: a precision/recall table you would put your name on. This phase is the portfolio; do not skip or shorten it.

- [x] 200 CC0 originals across 20 themes, recorded with author and Commons page in `eval/manifest.json` (built by `eval/build_manifest.py`).
- [x] Probes: each original × the 8 edits in `transforms.py` = 1,600 positives, generated in memory; `eval/results/labels.csv` records ground truth.
- [x] 2,000 negatives: same-theme CC0 photos from Commons (stand-in for subreddit negatives while Reddit API access is pending).
- [x] `make eval`: production `Fingerprinter` on every probe, fingerprint cache (`eval/data/*.npz`), raw signals per probe × original (PDQ, flip-aware PDQ, CLIP).
- [x] Report: per-rule operating point at precision ≥ 0.95, recall per edit, threshold sweep CSV, precision/recall chart. CI workflow **Evaluation** (on demand + matcher PRs).
- [x] Tune: compare `blend_v1` (today), `blend_dihedral`, `clip_led`, `clip_led_dihedral`; adopt the simplest rule meeting the bar; log runs in `docs/notes/phase3-tuning.md`. Kept `blend_v1`, `REVIEW_THRESHOLD` 0.80 → 0.70.
- [x] Hard cases: crop, flip, rotate, screenshot and meme scored below 0.80 in phase 1. The rules above target flips (dihedral PDQ) and heavy edits (CLIP-led); a tiled-crop probe only if crop recall stays low. Flip/rotate/screenshot now 0.98–1.00; crop 0.91 and meme 0.84 held-out; tiled crop deferred.
- [x] Final table in README.
- [x] **Gate:** reproducible within ±0.01; P ≥ 0.95, R ≥ 0.90 overall, ≥ 0.98 on resize and re-encode. Passed on the held-out half: P 0.962, R 0.966, resize and re-encode 1.00.

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
