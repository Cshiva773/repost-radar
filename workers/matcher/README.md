# Matcher worker

Phase 2. Consumes `match { crawledPostId }` jobs: fingerprints the crawled image with the shared fingerprint module, runs the PDQ Hamming lookup and the pgvector top-5 search against the creator's bank, and writes scored `candidates` rows. See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) steps 10–12.
