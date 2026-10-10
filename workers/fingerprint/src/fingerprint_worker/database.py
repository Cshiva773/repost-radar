"""Postgres access for fingerprints and bank lookups. Model-layer functions return None on failure."""

import logging
from dataclasses import dataclass

import psycopg

from fingerprint_worker.fingerprinting import FingerprintDetails

logger = logging.getLogger("fingerprint-worker.database")

DEFAULT_SEARCH_LIMIT = 5


@dataclass(frozen=True)
class BankMatchDetails:
    asset_id: int
    pdq_distance: int
    embed_similarity: float


def _vector_literal(embedding: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in embedding) + "]"


def find_asset_storage_key(connection: psycopg.Connection, asset_id: int) -> str | None:
    try:
        asset_row = connection.execute("SELECT storage_key FROM assets WHERE id = %s", (asset_id,)).fetchone()
        return asset_row[0] if asset_row else None
    except psycopg.Error:
        logger.exception("find_asset_storage_key failed for asset %s", asset_id)
        return None


def save_asset_fingerprints(connection: psycopg.Connection, asset_id: int, fingerprint_details: FingerprintDetails) -> bool:
    try:
        connection.execute(
            """UPDATE assets SET phash = %s::bit(64), pdq = %s::bit(256), embedding = %s::vector,
               width = %s, height = %s, fingerprinted_at = now() WHERE id = %s""",
            (fingerprint_details.phash_bits, fingerprint_details.pdq_bits, _vector_literal(fingerprint_details.embedding),
             fingerprint_details.width, fingerprint_details.height, asset_id),
        )
        connection.commit()
        return True
    except psycopg.Error:
        connection.rollback()
        logger.exception("save_asset_fingerprints failed for asset %s", asset_id)
        return False


def search_bank(connection: psycopg.Connection, creator_id: int, fingerprint_details: FingerprintDetails,
                search_limit: int = DEFAULT_SEARCH_LIMIT) -> list[BankMatchDetails]:
    """Top matches by embedding, each with its PDQ distance, plus any PDQ near-copies the embedding missed."""
    try:
        match_rows = connection.execute(
            """WITH probe AS (SELECT %s::bit(256) AS pdq, %s::vector AS embedding)
               SELECT DISTINCT ON (asset_id) asset_id, pdq_distance, embed_similarity FROM (
                 (SELECT a.id AS asset_id, bit_count(a.pdq # p.pdq)::int AS pdq_distance,
                         1 - (a.embedding <=> p.embedding) AS embed_similarity
                  FROM assets a, probe p WHERE a.creator_id = %s AND a.embedding IS NOT NULL
                  ORDER BY a.embedding <=> p.embedding LIMIT %s)
                 UNION ALL
                 (SELECT a.id, bit_count(a.pdq # p.pdq)::int, 1 - (a.embedding <=> p.embedding)
                  FROM assets a, probe p WHERE a.creator_id = %s AND a.pdq IS NOT NULL
                    AND bit_count(a.pdq # p.pdq) <= 31)
               ) candidate_rows ORDER BY asset_id""",
            (fingerprint_details.pdq_bits, _vector_literal(fingerprint_details.embedding),
             creator_id, search_limit, creator_id),
        ).fetchall()
        return [BankMatchDetails(int(row[0]), int(row[1]), float(row[2])) for row in match_rows]
    except psycopg.Error:
        logger.exception("search_bank failed for creator %s", creator_id)
        return []
