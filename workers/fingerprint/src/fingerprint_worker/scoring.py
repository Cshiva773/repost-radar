"""Pure scoring functions shared by the fingerprint CLI, the matcher (phase 2) and eval (phase 3).

Formula from docs/PRD.md#detection-approach:
  hash_score  = 1 - pdq_distance / 256
  confidence  = max(hash_score, blended) when pdq_distance <= 31 (Meta's "same image" threshold)
              = blended                  otherwise
  blended     = 0.6 * embed_similarity + 0.4 * hash_score
"""

import math
from typing import Sequence

PDQ_BIT_COUNT = 256
PDQ_SAME_IMAGE_MAX_DISTANCE = 31
EMBED_WEIGHT = 0.6
HASH_WEIGHT = 0.4


def bits_to_string(bit_values: Sequence[int | bool]) -> str:
    return "".join("1" if bit_value else "0" for bit_value in bit_values)


def hamming_distance(bit_string_a: str, bit_string_b: str) -> int:
    if len(bit_string_a) != len(bit_string_b):
        raise ValueError("bit strings must be the same length")
    return sum(bit_a != bit_b for bit_a, bit_b in zip(bit_string_a, bit_string_b))


def cosine_similarity(vector_a: Sequence[float], vector_b: Sequence[float]) -> float:
    dot_product = sum(value_a * value_b for value_a, value_b in zip(vector_a, vector_b))
    norm_product = math.sqrt(sum(v * v for v in vector_a)) * math.sqrt(sum(v * v for v in vector_b))
    return dot_product / norm_product if norm_product else 0.0


def hash_score(pdq_distance: int) -> float:
    return 1.0 - pdq_distance / PDQ_BIT_COUNT


def compute_confidence(pdq_distance: int, embed_similarity: float) -> float:
    pdq_hash_score = hash_score(pdq_distance)
    blended_score = EMBED_WEIGHT * max(0.0, embed_similarity) + HASH_WEIGHT * pdq_hash_score
    confidence = max(pdq_hash_score, blended_score) if pdq_distance <= PDQ_SAME_IMAGE_MAX_DISTANCE else blended_score
    return round(min(1.0, max(0.0, confidence)), 4)
