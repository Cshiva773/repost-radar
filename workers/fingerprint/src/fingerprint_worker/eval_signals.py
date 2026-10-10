"""Fingerprints originals and probes with the production Fingerprinter, then builds the raw
signal matrices (probe x original): PDQ distance, flip-aware PDQ distance, CLIP similarity.
Fingerprints are cached in an .npz so re-scoring with new rules costs seconds, not minutes.
"""

import logging
import time
from pathlib import Path

import numpy as np

from fingerprint_worker.eval_dataset import EvalImageDetails, ProbeDetails
from fingerprint_worker.fingerprinting import Fingerprinter, normalise_image
from fingerprint_worker.transforms import apply_transform

logger = logging.getLogger("eval.signals")

POPCOUNT_TABLE = np.array([bin(byte_value).count("1") for byte_value in range(256)], dtype=np.uint8)
PROGRESS_EVERY = 200


def _pack_bits(bit_string: str) -> np.ndarray:
    return np.packbits(np.frombuffer(bit_string.encode("ascii"), dtype=np.uint8) - ord("0"))


def _dihedral_pdq(image_bytes: bytes) -> np.ndarray:
    import pdqhash

    hash_vector_list, _quality = pdqhash.compute_dihedral(np.asarray(normalise_image(image_bytes)))
    return np.stack([np.packbits(np.asarray(hash_vector, dtype=np.uint8)) for hash_vector in hash_vector_list])


def fingerprint_originals(fingerprinter: Fingerprinter, original_list: list[EvalImageDetails]) -> dict[str, np.ndarray]:
    pdq_list, embedding_list = [], []
    for original in original_list:
        fingerprint_details = fingerprinter.fingerprint(original.image_path.read_bytes())
        pdq_list.append(_pack_bits(fingerprint_details.pdq_bits))
        embedding_list.append(fingerprint_details.embedding)
    return {"ids": np.array([original.eval_id for original in original_list]), "pdq": np.stack(pdq_list),
            "embedding": np.asarray(embedding_list, dtype=np.float32)}


def _probe_bytes(probe: ProbeDetails, image_path_by_id: dict[str, Path], normalised_cache: dict) -> bytes:
    source_bytes = image_path_by_id[probe.source_eval_id].read_bytes()
    if probe.transform == "negative":
        return source_bytes
    if probe.source_eval_id not in normalised_cache:
        normalised_cache.clear()  # probes arrive grouped by original; keep one decoded image at a time
        normalised_cache[probe.source_eval_id] = normalise_image(source_bytes)
    return apply_transform(probe.transform, normalised_cache[probe.source_eval_id])


def fingerprint_probes(fingerprinter: Fingerprinter, probe_list: list[ProbeDetails], image_path_by_id: dict[str, Path]) -> dict[str, np.ndarray]:
    pdq_list, dihedral_list, embedding_list, normalised_cache = [], [], [], {}
    started_at = time.monotonic()
    for probe_index, probe in enumerate(probe_list, start=1):
        probe_bytes = _probe_bytes(probe, image_path_by_id, normalised_cache)
        fingerprint_details = fingerprinter.fingerprint(probe_bytes)
        pdq_list.append(_pack_bits(fingerprint_details.pdq_bits))
        dihedral_list.append(_dihedral_pdq(probe_bytes))
        embedding_list.append(fingerprint_details.embedding)
        if probe_index % PROGRESS_EVERY == 0:
            logger.info("fingerprinted %d/%d probes (%.0fs)", probe_index, len(probe_list), time.monotonic() - started_at)
    return {"ids": np.array([probe.probe_id for probe in probe_list]), "pdq": np.stack(pdq_list),
            "pdq_dihedral": np.stack(dihedral_list), "embedding": np.asarray(embedding_list, dtype=np.float32)}


def load_or_compute(cache_path: Path, expected_id_list: list[str], compute) -> dict[str, np.ndarray]:
    if cache_path.exists():
        cached_arrays = dict(np.load(cache_path))
        if cached_arrays["ids"].tolist() == expected_id_list:
            logger.info("using cached fingerprints %s", cache_path.name)
            return cached_arrays
    computed_arrays = compute()
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache_path, **computed_arrays)
    return computed_arrays


def hamming_matrix(probe_pdq: np.ndarray, original_pdq: np.ndarray) -> np.ndarray:
    return POPCOUNT_TABLE[probe_pdq[:, None, :] ^ original_pdq[None, :, :]].sum(axis=2, dtype=np.int32)


def build_signal_matrices(probe_arrays: dict, original_arrays: dict) -> dict[str, np.ndarray]:
    pdq_distance = hamming_matrix(probe_arrays["pdq"], original_arrays["pdq"])
    dihedral_distance = np.min(
        [hamming_matrix(probe_arrays["pdq_dihedral"][:, orientation, :], original_arrays["pdq"]) for orientation in range(8)], axis=0)
    clip_similarity = probe_arrays["embedding"] @ original_arrays["embedding"].T
    return {"pdq_distance": pdq_distance, "pdq_dihedral_distance": np.minimum(dihedral_distance, pdq_distance), "clip_similarity": clip_similarity}
