import numpy as np
import pytest

from fingerprint_worker.eval_rules import (
    NEGATIVE_TRUTH,
    RULE_BY_NAME,
    best_matches,
    pick_operating_point,
    recall_by_group,
    rule_blend_v1,
    rule_clip_led,
    rule_clip_led_dihedral,
    score_at_threshold,
    sweep_thresholds,
)
from fingerprint_worker.scoring import compute_confidence


def test_blend_v1_matches_the_production_formula():
    pdq_distance = np.array([0, 8, 31, 32, 100, 128])
    clip_similarity = np.array([0.99, 0.70, 0.50, 0.95, 0.95, -0.3])
    expected = [compute_confidence(int(d), float(s)) for d, s in zip(pdq_distance, clip_similarity)]
    assert rule_blend_v1(pdq_distance, pdq_distance, clip_similarity).tolist() == pytest.approx(expected, abs=1e-4)


def test_clip_led_trusts_clip_when_pdq_misses():
    # a flip: PDQ says unrelated (126) but CLIP says 0.975
    assert rule_blend_v1(np.array([126]), np.array([126]), np.array([0.975]))[0] < 0.80
    assert rule_clip_led(np.array([126]), np.array([126]), np.array([0.975]))[0] == pytest.approx(0.975)


def test_dihedral_rule_rescues_a_flip_through_pdq():
    # flipped back, the probe's PDQ is a near-copy (distance 6)
    assert rule_clip_led_dihedral(np.array([126]), np.array([6]), np.array([0.60]))[0] > 0.95


def test_all_rules_stay_in_unit_interval():
    rng = np.random.default_rng(0)
    pdq_distance = rng.integers(0, 257, size=500)
    clip_similarity = rng.uniform(-1, 1, size=500)
    for rule in RULE_BY_NAME.values():
        confidence = rule(pdq_distance, pdq_distance, clip_similarity)
        assert confidence.min() >= 0.0 and confidence.max() <= 1.0


def _toy_problem():
    # 3 probes x 2 originals: probe0 -> orig0 (strong), probe1 -> orig1 (weak), probe2 negative (looks like orig0)
    confidence_matrix = np.array([[0.95, 0.10], [0.20, 0.70], [0.82, 0.30]])
    truth_index = np.array([0, 1, NEGATIVE_TRUTH])
    return (*best_matches(confidence_matrix), truth_index)


def test_score_at_threshold_counts_true_and_false_positives():
    best_index, best_confidence, truth_index = _toy_problem()
    operating_point = score_at_threshold(best_index, best_confidence, truth_index, 0.80)
    assert (operating_point.true_positive_count, operating_point.false_positive_count) == (1, 1)
    assert operating_point.precision == pytest.approx(0.5)
    assert operating_point.recall == pytest.approx(0.5)


def test_confident_wrong_original_is_a_false_positive():
    best_index, best_confidence = np.array([1]), np.array([0.9])
    operating_point = score_at_threshold(best_index, best_confidence, np.array([0]), 0.8)
    assert (operating_point.true_positive_count, operating_point.false_positive_count) == (0, 1)


def test_pick_operating_point_maximises_recall_under_the_precision_floor():
    best_index, best_confidence, truth_index = _toy_problem()
    sweep_list = sweep_thresholds(best_index, best_confidence, truth_index, [0.6, 0.85, 0.9])
    chosen = pick_operating_point(sweep_list, min_precision=0.95)
    assert chosen is not None and chosen.threshold == 0.9 and chosen.recall == pytest.approx(0.5)
    assert pick_operating_point(sweep_list, min_precision=1.01) is None


def test_recall_by_group_ignores_negatives():
    best_index, best_confidence, truth_index = _toy_problem()
    group_labels = np.array(["resize", "crop", "negative"])
    assert recall_by_group(best_index, best_confidence, truth_index, group_labels, 0.8) == {"crop": 0.0, "resize": 1.0}
