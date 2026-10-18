import pytest

from fingerprint_worker.scoring import (
    bits_to_string,
    compute_confidence,
    cosine_similarity,
    hamming_distance,
    hash_score,
)


def test_bits_to_string_accepts_bools_and_ints():
    assert bits_to_string([True, 0, 1, False]) == "1010"


def test_hamming_distance_counts_differing_bits():
    assert hamming_distance("1010", "1001") == 2
    assert hamming_distance("1111", "1111") == 0


def test_hamming_distance_rejects_mismatched_lengths():
    with pytest.raises(ValueError):
        hamming_distance("101", "1010")


def test_cosine_similarity_of_identical_and_orthogonal_vectors():
    assert cosine_similarity([1.0, 2.0], [1.0, 2.0]) == pytest.approx(1.0)
    assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)
    assert cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_hash_score_maps_distance_to_unit_interval():
    assert hash_score(0) == 1.0
    assert hash_score(128) == 0.5


def test_near_copy_uses_hash_score_when_it_wins():
    # distance 8 -> hash_score 0.96875, blended with a weak embedding is lower, so hash wins
    assert compute_confidence(8, 0.70) == pytest.approx(0.9688, abs=1e-4)


def test_edited_copy_relies_on_the_blend():
    # distance 100 (no hash hit) but CLIP says 0.95 -> 0.6*0.95 + 0.4*0.609 = 0.8137
    assert compute_confidence(100, 0.95) == pytest.approx(0.8137, abs=1e-4)


def test_unrelated_image_scores_low():
    assert compute_confidence(128, 0.45) == pytest.approx(0.47, abs=1e-4)


def test_negative_similarity_is_floored_at_zero():
    assert compute_confidence(128, -0.3) == pytest.approx(0.2, abs=1e-4)
