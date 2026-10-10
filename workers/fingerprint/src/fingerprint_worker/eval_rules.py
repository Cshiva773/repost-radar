"""Candidate scoring rules and the metrics used to compare them (phase 3). Pure numpy, no I/O.

Every rule maps the raw signals for (probe x original) pairs to a confidence in [0, 1]:
  pdq_distance           PDQ Hamming distance, probe as-is                      (int, 0-256)
  pdq_dihedral_distance  min PDQ distance over the probe's 8 flips/rotations   (int, 0-256)
  clip_similarity        cosine similarity of CLIP embeddings                  (float, -1..1)

A probe's prediction is its best-scoring original. It counts as a true positive only if that
original is the right one and the confidence clears the threshold; a confident wrong original,
or any confident negative, is a false positive.
"""

from dataclasses import dataclass
from typing import Callable

import numpy as np

from fingerprint_worker.scoring import EMBED_WEIGHT, HASH_WEIGHT, PDQ_BIT_COUNT, PDQ_SAME_IMAGE_MAX_DISTANCE

NEGATIVE_TRUTH = -1


def _hash_score(pdq_distance: np.ndarray) -> np.ndarray:
    return 1.0 - pdq_distance / PDQ_BIT_COUNT


def _blend(pdq_distance: np.ndarray, clip_similarity: np.ndarray) -> np.ndarray:
    return EMBED_WEIGHT * np.clip(clip_similarity, 0.0, None) + HASH_WEIGHT * _hash_score(pdq_distance)


def _hash_or(pdq_distance: np.ndarray, fallback_score: np.ndarray, clip_similarity: np.ndarray) -> np.ndarray:
    """PDQ near-copy -> max(hash, blend); otherwise the rule's fallback."""
    near_copy_score = np.maximum(_hash_score(pdq_distance), _blend(pdq_distance, clip_similarity))
    return np.clip(np.where(pdq_distance <= PDQ_SAME_IMAGE_MAX_DISTANCE, near_copy_score, fallback_score), 0.0, 1.0)


def rule_blend_v1(pdq_distance, pdq_dihedral_distance, clip_similarity):
    """Production formula today (scoring.compute_confidence)."""
    return np.round(_hash_or(pdq_distance, _blend(pdq_distance, clip_similarity), clip_similarity), 4)


def rule_blend_dihedral(pdq_distance, pdq_dihedral_distance, clip_similarity):
    """Same blend, but a flipped/rotated copy can still count as a PDQ near-copy."""
    return np.round(_hash_or(pdq_dihedral_distance, _blend(pdq_dihedral_distance, clip_similarity), clip_similarity), 4)


def rule_clip_led(pdq_distance, pdq_dihedral_distance, clip_similarity):
    """When PDQ misses, trust CLIP alone instead of letting a ~0.5 hash score drag it down."""
    return np.round(_hash_or(pdq_distance, np.clip(clip_similarity, 0.0, 1.0), clip_similarity), 4)


def rule_clip_led_dihedral(pdq_distance, pdq_dihedral_distance, clip_similarity):
    """CLIP-led, with flip-aware PDQ for the near-copy check."""
    return np.round(_hash_or(pdq_dihedral_distance, np.clip(clip_similarity, 0.0, 1.0), clip_similarity), 4)


RULE_BY_NAME: dict[str, Callable[..., np.ndarray]] = {
    "blend_v1": rule_blend_v1,
    "blend_dihedral": rule_blend_dihedral,
    "clip_led": rule_clip_led,
    "clip_led_dihedral": rule_clip_led_dihedral,
}


@dataclass(frozen=True)
class OperatingPointDetails:
    threshold: float
    precision: float
    recall: float
    true_positive_count: int
    false_positive_count: int
    positive_count: int


def best_matches(confidence_matrix: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """For each probe (row): index of its best original and that confidence."""
    best_index = confidence_matrix.argmax(axis=1)
    return best_index, confidence_matrix[np.arange(confidence_matrix.shape[0]), best_index]


def score_at_threshold(best_index: np.ndarray, best_confidence: np.ndarray, truth_index: np.ndarray, threshold: float) -> OperatingPointDetails:
    is_flagged = best_confidence >= threshold
    is_positive = truth_index != NEGATIVE_TRUTH
    true_positive_count = int(np.sum(is_flagged & is_positive & (best_index == truth_index)))
    false_positive_count = int(np.sum(is_flagged)) - true_positive_count
    positive_count = int(np.sum(is_positive))
    flagged_count = true_positive_count + false_positive_count
    return OperatingPointDetails(
        threshold=round(float(threshold), 4),
        precision=true_positive_count / flagged_count if flagged_count else 1.0,
        recall=true_positive_count / positive_count if positive_count else 0.0,
        true_positive_count=true_positive_count,
        false_positive_count=false_positive_count,
        positive_count=positive_count,
    )


def sweep_thresholds(best_index, best_confidence, truth_index, threshold_list) -> list[OperatingPointDetails]:
    return [score_at_threshold(best_index, best_confidence, truth_index, threshold) for threshold in threshold_list]


def pick_operating_point(sweep_list: list[OperatingPointDetails], min_precision: float) -> OperatingPointDetails | None:
    """Highest recall among thresholds that keep precision >= min_precision (ties -> higher threshold)."""
    eligible_list = [point for point in sweep_list if point.precision >= min_precision and point.true_positive_count > 0]
    if not eligible_list:
        return None
    return max(eligible_list, key=lambda point: (point.recall, point.threshold))


def recall_by_group(best_index, best_confidence, truth_index, group_labels: np.ndarray, threshold: float) -> dict[str, float]:
    """Recall per transform (positives only)."""
    recall_by_label = {}
    for group_label in sorted(set(group_labels[truth_index != NEGATIVE_TRUTH])):
        in_group = group_labels == group_label
        found = (best_confidence[in_group] >= threshold) & (best_index[in_group] == truth_index[in_group])
        recall_by_label[str(group_label)] = float(found.mean())
    return recall_by_label
