# Evaluation (phase 3)

Measures how well the matcher finds reposts, and compares candidate scoring rules on the same data.

- **`manifest.json`**: 200 originals and 2,000 negatives, all CC0 photos from Wikimedia Commons, across 20 themes (mountain, beach, dog …). Negatives share themes with the originals on purpose: a different beach photo is the hard case. Each entry records title, author, Commons page and licence. Built once by `build_manifest.py` and committed so results are reproducible.
- **Probes**: each original × the 8 reposter edits (`fingerprint_worker/transforms.py`) = 1,600 positives, plus the 2,000 negatives as-is.
- **Scoring**: every probe is fingerprinted with the production `Fingerprinter`, matched against all 200 originals, and its best match judged correct only if it is the right original above the threshold. Rules compared live in `fingerprint_worker/eval_rules.py`.

The original plan was negatives scraped from the same subreddits. With no Reddit API access, same-theme Commons photos stand in for them.

## Run it

```bash
make eval        # or: pnpm run eval
```

The first run downloads ~2,200 images and fingerprints ~3,800 (about 15 minutes on CPU). Later runs reuse `eval/data/` (ignored by git). For a quick check, add `--limit-originals 20 --limit-negatives 200`.

In CI: **Actions → Evaluation → Run workflow**. It also runs on PRs that touch the matcher or eval code. The report is published to the job summary and as the `eval-results` artifact.

## Outputs (`eval/results/`)

| File | What |
| --- | --- |
| `report.md` | Each rule's best threshold at precision ≥ 0.95, recall there and at 0.80, and recall per edit |
| `sweep.csv` | Precision and recall per rule for thresholds 0.50–0.99 |
| `pr_curve.png` | Precision vs recall per rule |
| `labels.csv` | Every probe with its ground truth |
