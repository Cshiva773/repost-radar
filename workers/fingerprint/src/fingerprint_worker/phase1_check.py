"""Phase 1 gate check, run inside the worker container after `pnpm seed`.

For the first N seeded originals: apply the 8 transforms, score each against its original,
score each original against an unrelated one, and confirm a bank search for the resized copy
returns the right asset. Prints a Markdown table and exits non-zero if the gate fails.
"""

import os
import statistics
import sys

import psycopg

from fingerprint_worker.config import load_database_url, load_object_storage_config
from fingerprint_worker.database import search_bank
from fingerprint_worker.fingerprinting import Fingerprinter, FingerprintDetails, normalise_image
from fingerprint_worker.scoring import compute_confidence, cosine_similarity, hamming_distance
from fingerprint_worker.storage import ObjectStorage
from fingerprint_worker.transforms import TRANSFORM_BY_NAME, apply_transform

SAMPLE_ASSET_COUNT = 10
RESIZE_MIN_CONFIDENCE = 0.95
UNRELATED_MAX_CONFIDENCE = 0.60


def score_pair(fingerprint_a: FingerprintDetails, fingerprint_b: FingerprintDetails) -> tuple[int, float, float]:
    pdq_distance = hamming_distance(fingerprint_a.pdq_bits, fingerprint_b.pdq_bits)
    embed_similarity = cosine_similarity(fingerprint_a.embedding, fingerprint_b.embedding)
    return pdq_distance, embed_similarity, compute_confidence(pdq_distance, embed_similarity)


def load_sample_assets(connection: psycopg.Connection) -> list[tuple[int, int, str]]:
    return connection.execute(
        "SELECT id, creator_id, storage_key FROM assets WHERE fingerprinted_at IS NOT NULL ORDER BY id LIMIT %s",
        (SAMPLE_ASSET_COUNT,),
    ).fetchall()


def top_search_hit(connection: psycopg.Connection, creator_id: int, probe_fingerprint: FingerprintDetails) -> int | None:
    match_list = search_bank(connection, creator_id, probe_fingerprint)
    if not match_list:
        return None
    best_match = max(match_list, key=lambda match: compute_confidence(match.pdq_distance, match.embed_similarity))
    return best_match.asset_id


def collect_scores(fingerprinter, object_storage, connection, sample_asset_list):
    """Returns {transform_name: [(distance, similarity, confidence), ...]} and the search hit count."""
    score_rows_by_transform = {transform_name: [] for transform_name in [*TRANSFORM_BY_NAME, "unrelated"]}
    original_fingerprint_list, search_hit_count = [], 0
    for asset_id, creator_id, storage_key in sample_asset_list:
        original_bytes = object_storage.read_object(storage_key)
        original_fingerprint = fingerprinter.fingerprint(original_bytes)
        original_fingerprint_list.append(original_fingerprint)
        rgb_original = normalise_image(original_bytes)
        for transform_name in TRANSFORM_BY_NAME:
            probe_fingerprint = fingerprinter.fingerprint(apply_transform(transform_name, rgb_original))
            score_rows_by_transform[transform_name].append(score_pair(original_fingerprint, probe_fingerprint))
            if transform_name == "resize_50":
                search_hit_count += int(top_search_hit(connection, creator_id, probe_fingerprint) == asset_id)
    for index, original_fingerprint in enumerate(original_fingerprint_list):
        unrelated_fingerprint = original_fingerprint_list[(index + 1) % len(original_fingerprint_list)]
        score_rows_by_transform["unrelated"].append(score_pair(original_fingerprint, unrelated_fingerprint))
    return score_rows_by_transform, search_hit_count


def render_table(score_rows_by_transform: dict) -> str:
    table_lines = ["| Pair | PDQ distance (median) | CLIP similarity (median) | Confidence min | Confidence median | Confidence max |",
                   "| --- | --- | --- | --- | --- | --- |"]
    for transform_name, score_rows in score_rows_by_transform.items():
        distance_list, similarity_list, confidence_list = zip(*score_rows)
        table_lines.append(
            f"| {transform_name} | {statistics.median(distance_list):.0f} | {statistics.median(similarity_list):.3f} | "
            f"{min(confidence_list):.3f} | {statistics.median(confidence_list):.3f} | {max(confidence_list):.3f} |")
    return "\n".join(table_lines)


def main() -> int:
    fingerprinter = Fingerprinter()
    object_storage = ObjectStorage(load_object_storage_config(os.environ))
    with psycopg.connect(load_database_url(os.environ)) as connection:
        sample_asset_list = load_sample_assets(connection)
        if len(sample_asset_list) < 2:
            print("Gate failed: need at least 2 fingerprinted assets; run `pnpm seed` first")
            return 1
        score_rows_by_transform, search_hit_count = collect_scores(fingerprinter, object_storage, connection, sample_asset_list)

    print(f"Phase 1 check over {len(sample_asset_list)} originals\n")
    print(render_table(score_rows_by_transform))
    resize_min = min(row[2] for row in score_rows_by_transform["resize_50"])
    unrelated_max = max(row[2] for row in score_rows_by_transform["unrelated"])
    gate_result_list = [
        (f"resize_50 min confidence {resize_min:.3f} >= {RESIZE_MIN_CONFIDENCE}", resize_min >= RESIZE_MIN_CONFIDENCE),
        (f"unrelated max confidence {unrelated_max:.3f} <= {UNRELATED_MAX_CONFIDENCE}", unrelated_max <= UNRELATED_MAX_CONFIDENCE),
        (f"bank search found the right asset {search_hit_count}/{len(sample_asset_list)}", search_hit_count == len(sample_asset_list)),
    ]
    print()
    for gate_description, is_passing in gate_result_list:
        print(f"{'PASS' if is_passing else 'FAIL'}  {gate_description}")
    return 0 if all(is_passing for _, is_passing in gate_result_list) else 1


if __name__ == "__main__":
    sys.exit(main())
