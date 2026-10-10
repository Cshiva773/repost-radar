# Evidence worker

Phase 4. Consumes `evidence { candidateId }` jobs for approved candidates: renders the side-by-side PNG, `metadata.json`, a one-page PDF and the notice from its template, zips them to MinIO and inserts `evidence_packs`. See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) steps 16–18.
