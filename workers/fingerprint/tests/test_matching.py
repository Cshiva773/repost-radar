import pytest

from fingerprint_worker.database import BankMatchDetails
from fingerprint_worker.matching import MatchThresholdDetails, build_candidates, load_match_thresholds

THRESHOLDS = MatchThresholdDetails(review_threshold=0.80, suppressed_floor=0.60)


def test_near_copy_is_pending_weak_match_suppressed_noise_dropped():
    candidate_list = build_candidates([
        BankMatchDetails(asset_id=1, pdq_distance=4, embed_similarity=0.97),   # near copy -> ~0.98
        BankMatchDetails(asset_id=2, pdq_distance=120, embed_similarity=0.85),  # same subject -> 0.6*0.85+0.4*0.53=0.72
        BankMatchDetails(asset_id=3, pdq_distance=130, embed_similarity=0.40),  # unrelated -> ~0.44
    ], THRESHOLDS)
    assert [(candidate.asset_id, candidate.status) for candidate in candidate_list] == [(1, "pending"), (2, "suppressed")]


def test_candidates_are_sorted_by_confidence():
    candidate_list = build_candidates([
        BankMatchDetails(asset_id=1, pdq_distance=110, embed_similarity=0.90),
        BankMatchDetails(asset_id=2, pdq_distance=2, embed_similarity=0.99),
    ], THRESHOLDS)
    assert [candidate.asset_id for candidate in candidate_list] == [2, 1]


def test_load_match_thresholds_defaults_and_validation():
    assert load_match_thresholds({}) == MatchThresholdDetails(review_threshold=0.70, suppressed_floor=0.60)
    assert load_match_thresholds({"REVIEW_THRESHOLD": "0.9"}).review_threshold == 0.9
    with pytest.raises(ValueError):
        load_match_thresholds({"REVIEW_THRESHOLD": "0.5", "SUPPRESSED_FLOOR": "0.7"})


def test_rank_check_matches_keeps_near_misses_and_flags_matches():
    from fingerprint_worker.database import BankMatchDetails
    from fingerprint_worker.matching import MatchThresholdDetails, rank_check_matches

    thresholds = MatchThresholdDetails(review_threshold=0.70, suppressed_floor=0.60)
    ranked_list = rank_check_matches([BankMatchDetails(1, 120, 0.40), BankMatchDetails(2, 8, 0.97), BankMatchDetails(3, 118, 0.55)], thresholds, check_limit=2)
    assert [ranked["assetId"] for ranked in ranked_list] == [2, 3]
    assert [ranked["isMatch"] for ranked in ranked_list] == [True, False]



def test_new_original_is_scored_against_held_crawled_images_with_the_crawl_rules():
    from fingerprint_worker.database import CrawledImageMatchDetails
    from fingerprint_worker.matching import MatchThresholdDetails, candidates_for_new_original

    thresholds = MatchThresholdDetails(review_threshold=0.70, suppressed_floor=0.60)
    held_match_list = [CrawledImageMatchDetails(11, 4, 0.97), CrawledImageMatchDetails(12, 118, 0.66), CrawledImageMatchDetails(13, 120, 0.30)]
    crawled_candidate_list = candidates_for_new_original(7, held_match_list, thresholds)
    assert [crawled_post_id for crawled_post_id, _ in crawled_candidate_list] == [11, 12]
    first_post_candidates = crawled_candidate_list[0][1]
    assert first_post_candidates[0].asset_id == 7 and first_post_candidates[0].status == "pending"
    assert crawled_candidate_list[1][1][0].status == "suppressed"
