# Repost Radar — Architecture

_As of 2026-10-10 · Shivansh_

Five services, two stores and one external API, joined only by a job queue and Postgres. Companion to [PRD.md](PRD.md).

## Components

```mermaid
flowchart TB
  subgraph External
    R[Reddit API - OAuth]
    B[Reviewer's browser]
  end
  subgraph Compose[docker compose]
    C[Crawler - Node/TS]
    A[API + review UI - Node/TS]
    Q[(Job queue - BullMQ on Redis)]
    F[Fingerprint worker - Python]
    M[Matcher worker - Python]
    E[Evidence worker - Python]
    P[(Postgres 16 + pgvector)]
    S[(SeaweedFS - S3 compatible)]
  end
  R --> C
  B --> A
  C --> Q
  A --> Q
  Q --> F
  Q --> M
  Q --> E
  F --> P
  M --> P
  E --> S
  C --> S
  A --> P
```

| Component | Language | Responsibility |
| --- | --- | --- |
| API + review UI | Node/TypeScript, React | Fastify API: auth, uploads, watch targets, review queue, decisions, downloads; enqueues jobs. `apps/web`: the review UI, served by nginx, which also proxies `/api` so the session cookie stays same-origin |
| Crawler | Node/TypeScript | Polls enabled watch targets, downloads image posts, records them, enqueues match jobs |
| Fingerprint worker | Python | PDQ, pHash and CLIP embedding for a registered original |
| Matcher worker | Python | Fingerprints a crawled image, Hamming + pgvector lookups, writes a scored candidate |
| Evidence worker | Python | Side-by-side PNG, PDF, `metadata.json`, ZIP and notice for an approved candidate |
| Job queue | BullMQ on Redis | Hands jobs to workers with retries; carries ids only, never image data |
| Postgres 16 + pgvector | — | All rows; HNSW index on embeddings; Hamming lookup on PDQ |
| S3 store | — | Originals, crawled images, evidence packs |

## Sequence

```mermaid
sequenceDiagram
  autonumber
  actor U as Creator / Reviewer
  participant API as API + UI
  participant Q as Job queue
  participant CR as Crawler
  participant W as Python workers
  participant DB as Postgres + S3 store
  participant RD as Reddit API

  Note over U,RD: A. Register originals (once per image)
  U->>API: upload original
  API->>DB: store file, insert asset row
  API->>Q: fingerprint job {assetId}
  Q->>W: run job (retry x3)
  W->>DB: write PDQ, pHash, CLIP embedding

  Note over U,RD: B. Crawl and match (every poll interval, per watch target)
  CR->>RD: GET /r/sub/new after last_seen_post_id
  RD-->>CR: new image posts
  CR->>DB: save image + crawled_post row
  CR->>Q: match job {crawledPostId}
  Q->>W: run job
  W->>DB: PDQ Hamming ≤ 31, pgvector top-5
  W->>DB: candidate: pending or suppressed

  Note over U,RD: C. Review and evidence (human decision)
  U->>API: open queue
  U->>API: approve + note
  API->>DB: decision row, status = approved
  API->>Q: evidence job {candidateId}
  Q->>W: run job
  W->>DB: ZIP, PDF, notice saved
  API-->>U: download link
```

The three flows run on different clocks and never call each other; the queue and the stores are all they share.

### Walkthrough

**A. Register originals**

1. The creator uploads an original through the API or CLI.
2. The API writes the file to the S3 store and inserts an `assets` row with its SHA-256; a duplicate is rejected before any work is queued.
3. The API enqueues a `fingerprint` job carrying only the asset id.
4. A Python worker picks it up; BullMQ retries up to three times on failure.
5. The worker normalises the image, computes PDQ, pHash and the CLIP embedding, and upserts them onto the asset row.

**B. Crawl and match**

6. The crawler asks Reddit for posts after the stored `last_seen_post_id`; a new target backfills recent posts first.
7. It keeps image and gallery posts and advances `last_seen_post_id` once they are stored.
8. Each image goes to the S3 store with a `crawled_posts` row; a unique `(platform, platform_post_id)` makes re-crawls no-ops.
9. One `match` job per crawled post.
10. A Python worker picks it up.
11. It fingerprints the image and runs PDQ Hamming (≤ 31 is a near-certain copy) and a pgvector top-5 cosine search.
12. It writes `candidates`: `pending` at or above the threshold, `suppressed` below. Posts marked `legitimate` are skipped.

**C. Review and evidence**

13. The reviewer opens the queue sorted by confidence.
14. They approve, dismiss, dismiss-as-legitimate or escalate, with an optional note.
15. The API writes an immutable `decisions` row and updates status — the only code path that can set `approved`.
16. On approve only, the API enqueues an `evidence` job.
17. A worker picks it up.
18. It renders the side-by-side PNG, `metadata.json`, PDF and notice, stores them and inserts `evidence_packs`.
19. The reviewer downloads the pack and files manually. Nothing is ever sent automatically.

## Review API

All routes except `/health` and `/auth/login` need a session. v1 has one admin (`ADMIN_USERNAME` / `ADMIN_PASSWORD`), created when the API starts.

| Route | Purpose |
| --- | --- |
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Session cookie (HTTP-only, SameSite=Strict); only the token's SHA-256 is stored in `sessions` |
| `GET /candidates?status=&platform=&watchTargetId=&postedAfter=&postedBefore=&sort=&pageSize=&pageOffset=` | The queue; defaults to `pending` by confidence |
| `GET /candidates/:id` | One candidate with its `decisions` history |
| `GET /candidates/:id/images/original\|candidate` | Image bytes, streamed from the S3 store behind the session |
| `POST /candidates/:id/decision` | `{action: approve\|dismiss\|legitimate\|escalate, note?, goodFaith?}`; 409 once closed |
| `GET /candidates/:id/pack` | The evidence ZIP; 202 while the worker builds it, 409 with what to fix (e.g. an unresolved placeholder) |
| `POST /candidates/:id/pack` | Rebuild after fixing a template or the profile (replaces notice edits) |
| `GET/PUT /candidates/:id/notice` | The generated notice; edits are saved but may not contain `{{placeholders}}` |
| `GET/POST/PUT/DELETE /notice-templates` | Templates per platform; unknown `{{placeholders}}` are rejected on save |
| `GET /watch-target-suggestions` | Places matched posts point to (crosspost subreddits, hashtags) that you don't watch yet; suggestions only |
| `POST /checks` | "Is this image mine?" for the browser extension: the worker ranks the closest originals; the image is deleted afterwards |
| `GET/POST/DELETE /api-tokens` | Personal access tokens (session only). A token may only check images and read matches |
| `GET/PUT /creator` | Display name plus the legal name, email and address a notice must carry |

**Evidence pack** (`evidence/<candidateId>/pack.zip`): `original.<ext>`, `copy.<ext>`, `side_by_side.png`, `metadata.json` (scores, post details, SHA-256 of both files, the decision log), `summary.pdf` (one page) and `notice.txt`, rendered from the most recently updated template for the copy's platform.

Statuses: `pending` and `escalated` are open; `approved`, `dismissed`, `legitimate` and `removed` are closed (`removed`: the crawler found the copy taken down, recorded as a `system` decision, and deleted the stored copy unless an approved candidate needs it); `suppressed` never reaches the queue. Approving needs the good-faith confirmation and a complete creator profile.

## Platform adapters

The crawler reaches each platform through an adapter registered under the platform's name; see [ADDING_A_PLATFORM.md](ADDING_A_PLATFORM.md).

- **`packages/platforms`** (shared by API and crawler): one `PlatformDefinition` per platform with its target rules (what a valid subreddit, hashtag or account looks like) and its request budget.
- **`apps/crawler/src/platforms/<name>/`**: the adapter. It fetches a newest-first page for a target and maps it to platform-neutral posts (`sourcePostId`, `postedAt`, `permalinkUrl`, `mediaList`).
- **Registry**: `ENABLED_PLATFORMS=reddit,bluesky` decides which adapters start. Each gets its own token bucket. Startup fails on an unknown name, or on a platform with a definition but no adapter.
- **Storage**: `watch_targets.platform` and `crawled_posts.platform` are plain text validated by the registry (migration 004), so a new platform needs no schema change.

Adapters today:

| Platform | Targets | Access | Notes |
| --- | --- | --- | --- |
| Reddit | `r/subreddit` | Live mode needs approved API credentials (self-service closed Nov 2025; this project's request was declined 2026-10-10). Fixture mode uses the local `fake-reddit` service and runs in every CI gate | OAuth client credentials |
| Bluesky | `#hashtag` (searchPosts, newest first) or `@handle` (author's media posts) | No credentials: public AppView; optional app password | Uses `indexedAt` for ordering; skips reposts; skips adult-labelled posts by default |

## Design decisions

| Decision | Why | Cost |
| --- | --- | --- |
| All cross-service work goes through the queue | A slow model or Reddit outage never blocks the API or UI; workers restart and scale alone | One more container |
| Jobs carry ids, never image data | Safe retries, small queue, worker always reads current state | One extra read per job |
| Every write is idempotent | A crash can redo work but never duplicate it | Unique indexes and upserts |
| Node for API/crawler, Python for ML workers | PDQ, imagehash and open_clip are Python; CRUD and scheduling are fastest in TS | Two toolchains; the queue is the contract |
| Hash first, embedding second | Microsecond exact check gates the slower fuzzy one | Second lookup when the hash misses |
| Human decision between matching and evidence | Wrong notices carry §512(f) liability | Throughput bounded by reviewer time |
| S3-compatible store (SeaweedFS) rather than local disk | S3-compatible; swap to a cloud bucket by config | One more container |
| pgvector rather than a vector DB | One store, one backup, one transaction | Revisit past ~1M vectors |

## Data model

| Table | Written in | Important columns |
| --- | --- | --- |
| `creators` | setup | `id`, `name`, `contact_email`, `created_at` |
| `assets` | A2, A5 | `id`, `creator_id`, `sha256` (unique), `storage_key`, `width`, `height`, `phash` bit(64), `pdq` bit(256), `embedding` vector(512), `fingerprinted_at` |
| `watch_targets` | setup, B7 | `id`, `creator_id`, `platform`, `target_name`, `poll_interval_s`, `last_seen_post_id`, `enabled`, `deleted_at` |
| `crawled_posts` | B8, B11 | `id`, `watch_target_id`, `platform`, `platform_post_id`, `source_post_id`, `author`, `url`, `posted_at`, `storage_key`, `phash`, `pdq`, `embedding`, `is_legitimate`, `crawled_at` |
| `candidates` | B12, C15 | `id`, `asset_id`, `crawled_post_id`, `hash_distance`, `embed_similarity`, `confidence`, `status`, `created_at` |
| `decisions` | C15 | `id`, `candidate_id`, `actor`, `from_status`, `to_status`, `note`, `decided_at` |
| `evidence_packs` | C18 | `id`, `candidate_id`, `zip_key`, `pdf_key`, `notice_text`, `template_id`, `generated_at` |
| `notice_templates` | setup | `id`, `platform`, `name`, `subject`, `body`, `updated_at` |
| `eval_labels` | eval | `asset_id`, `probe_storage_key`, `transform`, `is_match` |

Indexes: HNSW on `assets.embedding` (cosine); unique `(platform, platform_post_id)` on `crawled_posts`; `(status, confidence desc)` on `candidates`. Hamming search on `pdq` uses `bit_count(pdq # $1)`; at portfolio scale (≤ 10k assets) a sequential scan is fast enough.
