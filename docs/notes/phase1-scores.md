# Phase 1 scores

First real run of `fingerprint_worker.phase1_check`, CI run 38027410883 (2026-10-10). 10 CC0 originals from the seed set, each scored against its 8 edits; "unrelated" pairs each original with the next one in the seed list, which is usually the other photo of the same theme (two beaches, two dogs), so it is a deliberately hard negative.

Confidence formula: `max(hash, 0.6·CLIP + 0.4·hash)` when PDQ distance ≤ 31, else `0.6·CLIP + 0.4·hash` (hash = 1 − distance/256). Review threshold 0.80.

| Pair | PDQ distance (median) | CLIP similarity (median) | Confidence min | Confidence median | Confidence max |
| --- | --- | --- | --- | --- | --- |
| resize_50 | 9 | 0.941 | 0.945 | 0.969 | 0.987 |
| jpeg_q40 | 1 | 0.938 | 0.977 | 0.996 | 1.000 |
| crop_20 | 125 | 0.880 | 0.673 | 0.730 | 0.782 |
| flip_h | 126 | 0.975 | 0.771 | 0.786 | 0.798 |
| filter_warm | 6 | 0.954 | 0.966 | 0.977 | 0.992 |
| screenshot | 79 | 0.930 | 0.782 | 0.839 | 0.858 |
| meme_caption | 25 | 0.612 | 0.659 | 0.914 | 0.949 |
| rotate_10 | 118 | 0.894 | 0.710 | 0.749 | 0.813 |
| unrelated | 133 | 0.425 | 0.334 | 0.450 | 0.633 |

Bank search returned the right original for 10/10 resized probes. Seeding 20 images took 6 s.

## What this says

- **Near-copies are solved by PDQ.** Resize, JPEG q40 and the warm filter keep PDQ distance under 10, so confidence sits at 0.95–1.00.
- **Heavy edits are missed at 0.80.** Crop, flip and rotation push PDQ to "unrelated" (≈125) while CLIP still says 0.88–0.98. The 0.4 weight on a 0.5 hash score caps them around 0.73–0.80.
- **CLIP alone separates better than the blend.** Unrelated pairs top out at CLIP ≈ 0.6 while flips sit at 0.975 and crops at 0.88. Phase 3 should test a CLIP-led rule (for example, confidence = CLIP when PDQ misses) and PDQ dihedral variants for flips.
- **Meme captions are bimodal.** The median is 0.91 because PDQ often survives the text, but CLIP drops to 0.61 on the worst case, where the caption dominates a small image.

## Gate decision

The original gate (resize ≥ 0.95, unrelated ≤ 0.60) was set before any data. Re-scoped with the owner on 2026-10-10: phase 1 proves the pipeline, so the gate is near-copy edits ≥ 0.90, unrelated pairs below the 0.80 review threshold, and bank search 10/10. Recall on crop, flip, rotation, screenshot and meme edits is the explicit phase 3 target.
