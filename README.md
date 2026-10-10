# Repost Radar

Find where a creator's images have been re-uploaded on Reddit or Bluesky — even cropped, filtered, re-encoded or screenshotted — review each match side by side, and export a DMCA-ready evidence pack. A human approves every match; nothing is ever sent to a platform automatically.

> **Status:** phases 0–3 done: ingest, crawl (Reddit and Bluesky adapters), matching, and a measured evaluation. Next is phase 4, the review UI. See [docs/BUILD_TASKS.md](docs/BUILD_TASKS.md).

## How it works

1. **Register** your originals. Each one gets three fingerprints: pHash, PDQ (Meta's perceptual hash) and a CLIP embedding.
2. **Crawl** the communities you name: Bluesky hashtags and accounts, Reddit subreddits, or any platform added as an adapter. Every new image post is fingerprinted and compared against your bank: a cheap Hamming-distance check on the hash first, then a pgvector similarity search on the embedding.
3. **Review** candidates above the confidence threshold. Approve, dismiss, mark as legitimate reuse, or escalate.
4. **Export** an evidence pack (both images, side-by-side, metadata, PDF) and a pre-filled notice, then file it yourself.

## Stack

Node/TypeScript (API, crawler) · Python (fingerprint, matcher, evidence workers) · BullMQ on Redis · Postgres 16 + pgvector · SeaweedFS (S3) · Docker Compose.

## Docs

- [Product requirements](docs/PRD.md)
- [Architecture and sequence diagram](docs/ARCHITECTURE.md)
- [Build tasks](docs/BUILD_TASKS.md)
- [Adding a platform](docs/ADDING_A_PLATFORM.md)

## Results

Measured on 200 CC0 originals × 8 reposter edits (1,600 copies) against 2,000 same-theme CC0 photos, so the negatives are a different beach for a beach, not random noise. Threshold 0.70 was picked on one half of the originals and measured on the other, unseen half:

| | Precision | Recall |
| --- | --- | --- |
| Held-out half | **0.962** | **0.966** |
| Full set | 0.964 | 0.963 |

| Edit | resize 50% | JPEG q40 | warm filter | screenshot | flip | rotate 10° | crop 20% | meme caption |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Recall (held-out) | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.98 | 0.91 | 0.84 |

The first guess at the threshold (0.80) had perfect precision but found only 60% of copies. Three alternative scoring rules were compared and none beat the simple one by more than a recall point. Method, every run and known limits: [docs/notes/phase3-tuning.md](docs/notes/phase3-tuning.md). Reproduce with `make eval` ([eval/README.md](eval/README.md)).

## Quick start

Needs Docker, Node 22+ with pnpm, and [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env
pnpm install
docker compose up -d --build --wait postgres redis s3 api crawler fingerprint-worker fake-reddit
docker compose run --rm s3-init
pnpm run migrate
pnpm run seed        # registers 20 CC0 sample originals
```

The crawler runs against a local fixture feed by default. To crawl Bluesky (no account needed), set `ENABLED_PLATFORMS=reddit,bluesky` in `.env`, restart, then add a target:

```bash
curl -c cookies.txt -X POST localhost:8080/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"<ADMIN_PASSWORD from .env>"}'
curl -b cookies.txt -X POST localhost:8080/watch-targets -H 'content-type: application/json' -d '{"platform":"bluesky","target":"#photography"}'
```

Every route except `/health` needs a session; the admin account comes from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env`.

`make gate2` runs the end-to-end check CI runs: planted copies in the fixture feed must land in the review queue.
