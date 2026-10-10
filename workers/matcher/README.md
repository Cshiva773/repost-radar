# Matcher

The matcher runs inside the fingerprint worker (`workers/fingerprint`) as a second BullMQ consumer on the `match` queue, so both queues share one loaded CLIP model. See `fingerprint_worker/main.py` (`match_crawled_post`) and `fingerprint_worker/matching.py` for the candidate rules, and [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) steps 10-12.
