# Phase 3 tuning log

Evaluation set: `eval/manifest.json`, 200 CC0 originals × 8 edits + 2,000 same-theme CC0 negatives (Wikimedia Commons). A probe is found only if its best-scoring original is the right one and clears the threshold; a confident wrong original counts as a false positive. Precision floor 0.95.

## Run 1: 2026-10-10, CI run 38033818717

196 originals (4 downloads failed) → 1,568 positive probes; 1,956 negatives (44 failed).

| Rule | Threshold at P ≥ 0.95 | Precision | Recall | False positives | At 0.80: recall (precision) |
| --- | --- | --- | --- | --- | --- |
| blend_v1 (shipped formula) | 0.70 | 0.964 | 0.963 | 56 | 0.602 (1.000) |
| blend_dihedral | 0.71 | 0.956 | 0.969 | 70 | 0.728 (1.000) |
| clip_led | 0.82 | 0.958 | 0.962 | 66 | 0.968 (0.936) |
| clip_led_dihedral | 0.82 | 0.958 | 0.964 | 66 | 0.970 (0.936) |

Recall per edit at each rule's operating point:

| Rule | crop_20 | filter_warm | flip_h | jpeg_q40 | meme_caption | resize_50 | rotate_10 | screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| blend_v1 | 0.89 | 1.00 | 0.98 | 1.00 | 0.85 | 1.00 | 0.98 | 1.00 |
| blend_dihedral | 0.91 | 1.00 | 1.00 | 1.00 | 0.85 | 1.00 | 0.99 | 1.00 |
| clip_led | 0.93 | 1.00 | 0.98 | 1.00 | 0.82 | 1.00 | 0.98 | 0.98 |
| clip_led_dihedral | 0.93 | 1.00 | 1.00 | 1.00 | 0.82 | 1.00 | 0.98 | 0.98 |

**Reading it**

- The threshold, not the formula, was the problem. At the original guess of 0.80 the shipped formula found 60% of edited copies; at 0.70 it finds 96% while keeping precision at 0.96.
- The four rules sit within one recall point of each other at the precision floor, and their precision/recall curves overlap almost entirely. The extra complexity of dihedral PDQ or a CLIP-led rule does not pay for itself here.
- Meme captions (0.85) and 20% crops (0.89) are the weakest edits. A caption covering a small image dominates CLIP's view; a corner crop removes enough structure to break PDQ.

**Decision (agreed with the owner, 2026-10-10):** keep the shipped formula and lower `REVIEW_THRESHOLD` from 0.80 to 0.70. Config only, no change to scoring code. Scores 0.60–0.70 stay `suppressed`, so they can be inspected without reaching the review queue.

## Run 2: held-out check, 2026-10-10, CI runs 38041892851 and 38046542050

The threshold in run 1 was picked on the same probes it was measured on. Run 2 splits originals 50/50 by a stable hash of their id (copies follow their original), picks the threshold on the `tune` half only, and reports the unseen `test` half.

All 2,200 images downloaded this time (200 originals → 1,600 positives; 2,000 negatives). Full set, `blend_v1` at 0.70: precision 0.964, recall 0.963, 57 false positives. Run 1 gave 0.964 / 0.963 on 196 originals, so the result reproduces within ±0.01 even with the dataset grown by 4 originals and 44 negatives.

| Half | Threshold | Precision | Recall | True positives | False positives |
| --- | --- | --- | --- | --- | --- |
| tune | 0.70 | 0.967 | 0.960 | 722 | 25 |
| test (unseen) | 0.70 | 0.962 | 0.966 | 819 | 32 |

Test-half recall per edit: crop_20 0.91, filter_warm 1.00, flip_h 1.00, jpeg_q40 1.00, meme_caption 0.84, resize_50 1.00, rotate_10 0.98, screenshot 1.00.

**Reading it:** tuning on half the data lands on the same 0.70, and the unseen half scores within half a point of the tuned half. The threshold is not overfit to the probes it was picked on.

**Gate (phase 3): passed.** P ≥ 0.95 (0.962 held-out), R ≥ 0.90 overall (0.966 held-out), resize and re-encode ≥ 0.98 (1.00 and 1.00), reproducible within ±0.01.

**Hard cases:** flip and rotate are solved by the threshold change (0.98–1.00). Crop (0.89–0.91) and meme captions (0.84–0.85) remain the weakest edits. A tiled-crop probe was considered and deferred: overall recall already clears the bar, and it would add a second embedding per original. Revisit if live data shows crops being missed.

## Known limits

- Negatives are same-theme Commons photos, standing in for real subreddit or Bluesky posts. Real feeds are mostly unrelated images, so live precision should be at least as good, but that is untested until a live platform runs.
- Edits are synthetic. Real reposts stack several (crop + filter + caption) and add platform recompression.
- 48 of 2,200 images failed to download from Wikimedia in run 1; with fewer workers and longer retries, run 2 downloaded all of them.
