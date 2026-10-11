"""Postgres access for fingerprints and bank lookups. Model-layer functions return None on failure."""

import logging
from dataclasses import dataclass

import psycopg

from fingerprint_worker.fingerprinting import FingerprintDetails

logger = logging.getLogger("fingerprint-worker.database")

DEFAULT_SEARCH_LIMIT = 5
# A new original is compared with the closest held crawled images; PDQ near-copies are always included
DEFAULT_RETRO_SEARCH_LIMIT = 50


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


def find_asset_creator_id(connection: psycopg.Connection, asset_id: int) -> int | None:
    try:
        asset_row = connection.execute("SELECT creator_id FROM assets WHERE id = %s", (asset_id,)).fetchone()
        return int(asset_row[0]) if asset_row else None
    except psycopg.Error:
        logger.exception("find_asset_creator_id failed for asset %s", asset_id)
        return None


@dataclass(frozen=True)
class CrawledImageMatchDetails:
    crawled_post_id: int
    pdq_distance: int
    embed_similarity: float


def search_crawled_images(connection: psycopg.Connection, creator_id: int, fingerprint_details: FingerprintDetails,
                          search_limit: int = DEFAULT_RETRO_SEARCH_LIMIT) -> list[CrawledImageMatchDetails]:
    """The reverse of search_bank: crawled images still held for this creator's sources that resemble a newly
    registered original. Top matches by embedding plus any PDQ near-copies; legitimate and taken-down posts excluded."""
    try:
        match_rows = connection.execute(
            """WITH probe AS (SELECT %s::bit(256) AS pdq, %s::vector AS embedding),
               held AS (
                 SELECT cp.id, cp.pdq, cp.embedding FROM crawled_posts cp JOIN watch_targets wt ON wt.id = cp.watch_target_id
                 WHERE wt.creator_id = %s AND cp.embedding IS NOT NULL AND cp.pdq IS NOT NULL AND cp.storage_key IS NOT NULL
                   AND NOT cp.is_legitimate AND cp.source_removed_at IS NULL
               )
               SELECT DISTINCT ON (crawled_post_id) crawled_post_id, pdq_distance, embed_similarity FROM (
                 (SELECT h.id AS crawled_post_id, bit_count(h.pdq # p.pdq)::int AS pdq_distance,
                         1 - (h.embedding <=> p.embedding) AS embed_similarity
                  FROM held h, probe p ORDER BY h.embedding <=> p.embedding LIMIT %s)
                 UNION ALL
                 (SELECT h.id, bit_count(h.pdq # p.pdq)::int, 1 - (h.embedding <=> p.embedding)
                  FROM held h, probe p WHERE bit_count(h.pdq # p.pdq) <= 31)
               ) candidate_rows ORDER BY crawled_post_id""",
            (fingerprint_details.pdq_bits, _vector_literal(fingerprint_details.embedding), creator_id, search_limit),
        ).fetchall()
        return [CrawledImageMatchDetails(int(row[0]), int(row[1]), float(row[2])) for row in match_rows]
    except psycopg.Error:
        logger.exception("search_crawled_images failed for creator %s", creator_id)
        return []


@dataclass(frozen=True)
class CrawledPostDetails:
    crawled_post_id: int
    storage_key: str
    creator_id: int
    is_legitimate: bool


def find_crawled_post(connection: psycopg.Connection, crawled_post_id: int) -> CrawledPostDetails | None:
    try:
        post_row = connection.execute(
            """SELECT cp.id, cp.storage_key, wt.creator_id, cp.is_legitimate
               FROM crawled_posts cp JOIN watch_targets wt ON wt.id = cp.watch_target_id WHERE cp.id = %s""",
            (crawled_post_id,),
        ).fetchone()
        return CrawledPostDetails(int(post_row[0]), post_row[1], int(post_row[2]), bool(post_row[3])) if post_row else None
    except psycopg.Error:
        logger.exception("find_crawled_post failed for crawled post %s", crawled_post_id)
        return None


def save_crawled_fingerprints(connection: psycopg.Connection, crawled_post_id: int, fingerprint_details: FingerprintDetails) -> bool:
    try:
        connection.execute(
            "UPDATE crawled_posts SET phash = %s::bit(64), pdq = %s::bit(256), embedding = %s::vector WHERE id = %s",
            (fingerprint_details.phash_bits, fingerprint_details.pdq_bits, _vector_literal(fingerprint_details.embedding), crawled_post_id),
        )
        connection.commit()
        return True
    except psycopg.Error:
        connection.rollback()
        logger.exception("save_crawled_fingerprints failed for crawled post %s", crawled_post_id)
        return False


def insert_candidates(connection: psycopg.Connection, crawled_post_id: int, candidate_list: list) -> int:
    """Idempotent on (asset_id, crawled_post_id): a retried match job never duplicates rows. Returns rows inserted.
    Re-checks is_legitimate in the same statement, so a reviewer marking the image legitimate mid-job still wins."""
    try:
        inserted_count = 0
        for candidate in candidate_list:
            insert_cursor = connection.execute(
                """INSERT INTO candidates (asset_id, crawled_post_id, hash_distance, embed_similarity, confidence, status)
                   SELECT %s, cp.id, %s, %s, %s, %s::candidate_status FROM crawled_posts cp WHERE cp.id = %s AND NOT cp.is_legitimate
                   ON CONFLICT (asset_id, crawled_post_id) DO NOTHING""",
                (candidate.asset_id, candidate.pdq_distance, candidate.embed_similarity, candidate.confidence, candidate.status, crawled_post_id),
            )
            inserted_count += insert_cursor.rowcount
        connection.commit()
        return inserted_count
    except psycopg.Error:
        connection.rollback()
        logger.exception("insert_candidates failed for crawled post %s", crawled_post_id)
        return 0
