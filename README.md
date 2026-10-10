# Repost Radar

Find where a creator's images have been re-uploaded on Reddit — even cropped, filtered, re-encoded or screenshotted — review each match side by side, and export a DMCA-ready evidence pack. A human approves every match; nothing is ever sent to a platform automatically.

> **Status:** early build. Phase 0 (scaffolding) in progress. See [docs/BUILD_TASKS.md](docs/BUILD_TASKS.md).

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

## Quick start

_Coming with the end of Phase 0._
