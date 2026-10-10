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
- [x] Honour deletions for matched posts. The crawler re-checks posts behind open candidates every `SOURCE_RECHECK_HOURS` (Reddit `/api/info`, Bluesky `getPosts`, one small batch per platform per run); a copy taken down closes as `removed` with a `system` audit row and its stored image is deleted unless an approved candidate needs it. Covered in `make gate4` through a planted fixture answer.
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

- [x] Auth (Argon2, session cookie, protected routes). Argon2id; random token in an HTTP-only SameSite=Strict cookie, only its SHA-256 stored; every route but `/health` and `/auth/login` behind the guard; 10 failures per username → 15-minute lockout; admin created from `ADMIN_USERNAME`/`ADMIN_PASSWORD`.
- [x] `GET /candidates` paginated, filtered by status, platform, target and date. Images stream through the API behind the session (`/candidates/:id/images/original|candidate`) instead of presigned URLs, so object storage never has to be reachable from a browser.
- [x] Queue page (React + shadcn). `apps/web`: React 19, Vite, Tailwind, TanStack Query, small hand-written shadcn-style primitives; Pending / Second look / Decided tabs, platform filter, paging.
- [x] Compare view with four actions and note box. Keyboard shortcuts A / D / L / E; after a decision the next candidate in the same queue opens.
- [x] `POST /candidates/:id/decision` transactional, 409 on closed candidate. Row lock (`FOR UPDATE`); `legitimate` flags the crawled image and closes its other candidates with their own audit rows; approve needs `goodFaith: true` and a complete creator profile, then enqueues `evidence` (re-enqueued on API start if lost).
- [x] Approve confirmation with §512(f) warning and good-faith checkbox (the API enforces it too).
- [x] Python `evidence` job (PNG, JSON, PDF, ZIP, notice). Third queue in the worker (no model lock). Problems the creator must fix (no template, unresolved placeholder, copy no longer stored) go to `candidates.evidence_error` instead of being retried; re-runs upsert the pack.
- [x] Template CRUD with placeholder validation on save; Reddit and Bluesky templates seeded (migration 005). Creator profile (`/creator`) holds the notice's legal name, email and address.
- [x] Notice renderer that fails on unresolved placeholders (`notice.py`); a test keeps its placeholder list identical to the API's.
- [x] `GET /candidates/:id/pack` download (202 while building, 409 with the fix needed), `POST` to rebuild, `GET/PUT /candidates/:id/notice` to view and edit the notice (edits may not reintroduce placeholders).
- [x] Escalated list tab ("Second look").
- [x] Integration test: fixture crawl → match → approve → pack. `make gate4`: `phase4Check.ts` (sign-in, queue, images, every decision path, approve → evidence ZIP → notice view/edit/regenerate, templates, logout) then `phase4-resilience.sh` (UI behind nginx, proxied sign-in, approve with the worker killed, API restart, crawler restart).
- [x] **Gate:** all PRD acceptance criteria pass; kill-and-restart loses nothing. Passed in CI (#10): `phase4Check.ts` plus `phase4-resilience.sh` (worker killed with an approval queued, API restarted, crawler restarted).

## Phase 5 — Stretch

- [x] README with diagrams, eval table, quick start, non-goals (plus features, architecture table, responsible use).
- [ ] 60-second demo GIF.
- [ ] Public release: MIT licence, CONTRIBUTING, issue templates. Files added (LICENSE, CONTRIBUTING.md, issue and PR templates); flipping the repo to public is the owner's call.
- [ ] Chrome extension: "Check against Repost Radar" + "File on Reddit" pre-fill.
- [ ] Subreddit discovery suggestions.
- [ ] Video via vPDQ.
- [x] Second platform (Bluesky, PR #6).
- [x] Manage from the UI: Originals (upload, fingerprint status) and Sources (add, pause, remove watch targets).
