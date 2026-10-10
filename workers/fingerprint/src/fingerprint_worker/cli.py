"""Developer CLI.

  python -m fingerprint_worker.cli is-copy A.jpg B.jpg   # no database needed
  python -m fingerprint_worker.cli search probe.jpg       # top matches in the creator's bank
"""

import argparse
import json
import os
from pathlib import Path

import psycopg

from fingerprint_worker.config import load_database_url
from fingerprint_worker.database import search_bank
from fingerprint_worker.fingerprinting import Fingerprinter
from fingerprint_worker.scoring import compute_confidence, cosine_similarity, hamming_distance


def compare_images(fingerprinter: Fingerprinter, image_path_a: Path, image_path_b: Path) -> dict:
    fingerprint_a = fingerprinter.fingerprint(image_path_a.read_bytes())
    fingerprint_b = fingerprinter.fingerprint(image_path_b.read_bytes())
    pdq_distance = hamming_distance(fingerprint_a.pdq_bits, fingerprint_b.pdq_bits)
    embed_similarity = cosine_similarity(fingerprint_a.embedding, fingerprint_b.embedding)
    return {
        "pdqDistance": pdq_distance,
        "phashDistance": hamming_distance(fingerprint_a.phash_bits, fingerprint_b.phash_bits),
        "embedSimilarity": round(embed_similarity, 4),
        "confidence": compute_confidence(pdq_distance, embed_similarity),
    }


def search_probe(fingerprinter: Fingerprinter, probe_path: Path, creator_id: int) -> list[dict]:
    probe_fingerprint = fingerprinter.fingerprint(probe_path.read_bytes())
    with psycopg.connect(load_database_url(os.environ)) as connection:
        match_list = search_bank(connection, creator_id, probe_fingerprint)
    scored_match_list = [
        {"assetId": match.asset_id, "pdqDistance": match.pdq_distance, "embedSimilarity": round(match.embed_similarity, 4),
         "confidence": compute_confidence(match.pdq_distance, match.embed_similarity)}
        for match in match_list
    ]
    return sorted(scored_match_list, key=lambda match: match["confidence"], reverse=True)


def main() -> None:
    argument_parser = argparse.ArgumentParser(prog="fingerprint_worker.cli")
    subcommand_parsers = argument_parser.add_subparsers(dest="command", required=True)
    is_copy_parser = subcommand_parsers.add_parser("is-copy", help="score image B as a copy of image A")
    is_copy_parser.add_argument("image_a", type=Path)
    is_copy_parser.add_argument("image_b", type=Path)
    search_parser = subcommand_parsers.add_parser("search", help="find the closest registered originals")
    search_parser.add_argument("probe", type=Path)
    search_parser.add_argument("--creator-id", type=int, default=1)
    parsed_arguments = argument_parser.parse_args()

    fingerprinter = Fingerprinter()
    if parsed_arguments.command == "is-copy":
        command_result = compare_images(fingerprinter, parsed_arguments.image_a, parsed_arguments.image_b)
    else:
        command_result = search_probe(fingerprinter, parsed_arguments.probe, parsed_arguments.creator_id)
    print(json.dumps(command_result, indent=2))


if __name__ == "__main__":
    main()
