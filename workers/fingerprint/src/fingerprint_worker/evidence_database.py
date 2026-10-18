"""Postgres access for the evidence job. Model-layer functions return None (or False) on failure."""

import logging
from dataclasses import dataclass

import psycopg

from fingerprint_worker.evidence import DecisionRecordDetails, EvidenceContextDetails, OwnershipProofDetails

logger = logging.getLogger("fingerprint-worker.evidence-database")

MAX_ERROR_LENGTH = 1000


@dataclass(frozen=True)
class NoticeTemplateDetails:
    template_id: int
    subject: str
    body: str


CONTEXT_SQL = """SELECT c.id, c.status, c.confidence, c.hash_distance, c.embed_similarity, c.created_at,
       cp.platform, wt.target_name, cp.author, cp.title, cp.url, cp.posted_at,
       a.storage_key, a.sha256, cp.storage_key, cr.name, cr.legal_name, cr.contact_email, cr.mailing_address, cr.time_zone,
       a.first_published_url, a.first_published_on, a.ownership_note, a.exif_taken_at, a.exif_artist, a.exif_copyright, a.created_at
  FROM candidates c
  JOIN assets a ON a.id = c.asset_id
  JOIN creators cr ON cr.id = a.creator_id
  JOIN crawled_posts cp ON cp.id = c.crawled_post_id
  JOIN watch_targets wt ON wt.id = cp.watch_target_id
 WHERE c.id = %s"""


def _load_decisions(connection: psycopg.Connection, candidate_id: int) -> tuple[DecisionRecordDetails, ...]:
    decision_rows = connection.execute(
        "SELECT actor, from_status::text, to_status::text, note, decided_at FROM decisions WHERE candidate_id = %s ORDER BY decided_at, id",
        (candidate_id,),
    ).fetchall()
    return tuple(DecisionRecordDetails(*decision_row) for decision_row in decision_rows)


def load_evidence_context(connection: psycopg.Connection, candidate_id: int) -> EvidenceContextDetails | None:
    try:
        context_row = connection.execute(CONTEXT_SQL, (candidate_id,)).fetchone()
        if context_row is None:
            return None
        (row_id, status, confidence, hash_distance, embed_similarity, detected_at, platform, target_name, post_author, post_title,
         post_url, posted_at, original_key, original_sha256, candidate_key, creator_name, legal_name, contact_email, mailing_address,
         time_zone, *ownership_columns) = context_row
        return EvidenceContextDetails(
            candidate_id=int(row_id), status=str(status), confidence=float(confidence), hash_distance=hash_distance,
            embed_similarity=float(embed_similarity) if embed_similarity is not None else None, detected_at=detected_at,
            platform=platform, target_name=target_name, post_author=post_author, post_title=post_title, post_url=post_url,
            posted_at=posted_at, original_storage_key=original_key, original_sha256=original_sha256.strip(),
            candidate_storage_key=candidate_key, creator_name=creator_name, legal_name=legal_name, contact_email=contact_email,
            mailing_address=mailing_address, decision_list=_load_decisions(connection, candidate_id), time_zone=time_zone or "UTC",
            ownership_proof=OwnershipProofDetails(*ownership_columns),
        )
    except psycopg.Error:
        logger.exception("load_evidence_context failed for candidate %s", candidate_id)
        return None


def find_notice_template(connection: psycopg.Connection, platform: str) -> NoticeTemplateDetails | None:
    """The most recently updated template for the platform (docs/ARCHITECTURE.md#review-api)."""
    try:
        template_row = connection.execute(
            "SELECT id, subject, body FROM notice_templates WHERE platform = %s ORDER BY updated_at DESC, id DESC LIMIT 1", (platform,),
        ).fetchone()
        return NoticeTemplateDetails(int(template_row[0]), template_row[1], template_row[2]) if template_row else None
    except psycopg.Error:
        logger.exception("find_notice_template failed for platform %s", platform)
        return None


def save_evidence_pack(connection: psycopg.Connection, candidate_id: int, zip_key: str, pdf_key: str, notice_text: str, template_id: int) -> bool:
    """Upsert: a retried or regenerated job replaces the previous pack instead of failing on the unique candidate_id."""
    try:
        connection.execute(
            """INSERT INTO evidence_packs (candidate_id, zip_key, pdf_key, notice_text, template_id) VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (candidate_id) DO UPDATE SET zip_key = EXCLUDED.zip_key, pdf_key = EXCLUDED.pdf_key,
                 notice_text = EXCLUDED.notice_text, template_id = EXCLUDED.template_id, generated_at = now()""",
            (candidate_id, zip_key, pdf_key, notice_text, template_id),
        )
        connection.execute("UPDATE candidates SET evidence_error = NULL WHERE id = %s", (candidate_id,))
        connection.commit()
        return True
    except psycopg.Error:
        connection.rollback()
        logger.exception("save_evidence_pack failed for candidate %s", candidate_id)
        return False


def save_evidence_error(connection: psycopg.Connection, candidate_id: int, error_message: str) -> bool:
    try:
        connection.execute("UPDATE candidates SET evidence_error = %s WHERE id = %s", (error_message[:MAX_ERROR_LENGTH], candidate_id))
        connection.commit()
        return True
    except psycopg.Error:
        connection.rollback()
        logger.exception("save_evidence_error failed for candidate %s", candidate_id)
        return False
