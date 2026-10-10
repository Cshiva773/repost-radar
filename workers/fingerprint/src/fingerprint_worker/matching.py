"""Turns bank search results for one crawled image into candidate rows (pure; no I/O).

confidence >= review threshold (0.70) -> `pending` (shown to the reviewer)
suppressed floor <= confidence  -> `suppressed` (kept for evaluation, never shown)
below the floor                 -> dropped (no row), so unrelated posts don't flood the table
"""

from dataclasses import dataclass
from typing import Iterable, Mapping

from fingerprint_worker.database import BankMatchDetails
from fingerprint_worker.scoring import compute_confidence

# 0.70 chosen in phase 3: precision 0.964 / recall 0.963 on 1,568 edited copies + 1,956 negatives (docs/notes/phase3-tuning.md)
DEFAULT_REVIEW_THRESHOLD = 0.70
DEFAULT_SUPPRESSED_FLOOR = 0.60


@dataclass(frozen=True)
class MatchThresholdDetails:
    review_threshold: float
    suppressed_floor: float


@dataclass(frozen=True)
class CandidateDetails:
    asset_id: int
    pdq_distance: int
    embed_similarity: float
    confidence: float
    status: str


def load_match_thresholds(environment_details: Mapping[str, str]) -> MatchThresholdDetails:
    review_threshold = float(environment_details.get("REVIEW_THRESHOLD", DEFAULT_REVIEW_THRESHOLD))
    suppressed_floor = float(environment_details.get("SUPPRESSED_FLOOR", DEFAULT_SUPPRESSED_FLOOR))
    if not 0 <= suppressed_floor <= review_threshold <= 1:
        raise ValueError("need 0 <= SUPPRESSED_FLOOR <= REVIEW_THRESHOLD <= 1")
    return MatchThresholdDetails(review_threshold=review_threshold, suppressed_floor=suppressed_floor)


def build_candidates(match_list: Iterable[BankMatchDetails], match_thresholds: MatchThresholdDetails) -> list[CandidateDetails]:
    candidate_list = []
    for bank_match in match_list:
        confidence = compute_confidence(bank_match.pdq_distance, bank_match.embed_similarity)
        if confidence < match_thresholds.suppressed_floor:
            continue
        status = "pending" if confidence >= match_thresholds.review_threshold else "suppressed"
        candidate_list.append(CandidateDetails(
            asset_id=bank_match.asset_id,
            pdq_distance=bank_match.pdq_distance,
            embed_similarity=round(bank_match.embed_similarity, 4),
            confidence=confidence,
            status=status,
        ))
    return sorted(candidate_list, key=lambda candidate: candidate.confidence, reverse=True)


DEFAULT_CHECK_LIMIT = 5


def rank_check_matches(match_list: Iterable[BankMatchDetails], match_thresholds: MatchThresholdDetails,
                       check_limit: int = DEFAULT_CHECK_LIMIT) -> list[dict]:
    """For an on-demand check (browser extension): the closest originals, best first, whether or not they
    clear the threshold, so the answer can say "closest is 0.41, not a match" as well as "match"."""
    ranked_list = sorted(
        ({"assetId": bank_match.asset_id, "pdqDistance": bank_match.pdq_distance, "embedSimilarity": round(bank_match.embed_similarity, 4),
          "confidence": compute_confidence(bank_match.pdq_distance, bank_match.embed_similarity)} for bank_match in match_list),
        key=lambda ranked_match: ranked_match["confidence"], reverse=True,
    )[:check_limit]
    return [{**ranked_match, "isMatch": ranked_match["confidence"] >= match_thresholds.review_threshold} for ranked_match in ranked_list]
