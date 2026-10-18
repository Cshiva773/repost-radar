"""`evidence` queue: builds and stores the pack for an approved candidate (docs/ARCHITECTURE.md steps 16-18).

Problems the creator has to fix (no template, an unresolved placeholder, the copy no longer stored) are
written to candidates.evidence_error and the job completes, because retrying cannot help. Infrastructure
errors raise, so BullMQ retries them."""

import logging
from datetime import datetime, timezone

import psycopg
from botocore.exceptions import ClientError

from fingerprint_worker.evidence import EvidenceContextDetails, build_notice_values, build_pack_files, build_zip, image_extension
from fingerprint_worker.evidence_database import find_notice_template, load_evidence_context, save_evidence_error, save_evidence_pack
from fingerprint_worker.notice import UnresolvedPlaceholderError, render_notice
from fingerprint_worker.storage import ObjectStorage

logger = logging.getLogger("fingerprint-worker.evidence")

MISSING_KEY_ERROR_CODES = {"NoSuchKey", "404"}


class CreatorFixableError(Exception):
    """A pack cannot be built until the creator changes something; the message tells them what."""


def evidence_storage_keys(candidate_id: int) -> tuple[str, str]:
    return f"evidence/{candidate_id}/pack.zip", f"evidence/{candidate_id}/summary.pdf"


class EvidenceJobHandler:
    def __init__(self, object_storage: ObjectStorage, database_url: str) -> None:
        self._object_storage = object_storage
        self._database_url = database_url

    def _read_image(self, storage_key: str | None, missing_message: str) -> bytes:
        if not storage_key:
            raise CreatorFixableError(missing_message)
        try:
            return self._object_storage.read_object(storage_key)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") in MISSING_KEY_ERROR_CODES:
                raise CreatorFixableError(missing_message) from error
            raise

    def _render_notice(self, connection: psycopg.Connection, context: EvidenceContextDetails, original_bytes: bytes,
                       generated_at: datetime) -> tuple[str, int]:
        notice_template = find_notice_template(connection, context.platform)
        if notice_template is None:
            raise CreatorFixableError(f"No notice template for {context.platform}. Add one under Templates, then regenerate the pack.")
        notice_values = build_notice_values(context, image_extension(original_bytes), generated_at)
        try:
            notice_text = render_notice(f"Subject: {notice_template.subject}\n\n{notice_template.body}", notice_values)
        except UnresolvedPlaceholderError as error:
            raise CreatorFixableError(f"{error}. Fill them in under Settings or edit the {context.platform} template, then regenerate the pack.") from error
        return notice_text, notice_template.template_id

    def _store_pack(self, connection: psycopg.Connection, context: EvidenceContextDetails) -> dict:
        generated_at = datetime.now(timezone.utc)
        original_bytes = self._read_image(context.original_storage_key, "The original image is no longer stored.")
        candidate_bytes = self._read_image(context.candidate_storage_key, "The copied image is no longer stored, so the pack cannot include it.")
        notice_text, template_id = self._render_notice(connection, context, original_bytes, generated_at)
        pack_file_map = build_pack_files(context, original_bytes, candidate_bytes, notice_text, generated_at)
        zip_key, pdf_key = evidence_storage_keys(context.candidate_id)
        self._object_storage.write_object(pdf_key, pack_file_map["summary.pdf"], "application/pdf")
        self._object_storage.write_object(zip_key, build_zip(pack_file_map), "application/zip")
        if not save_evidence_pack(connection, context.candidate_id, zip_key, pdf_key, notice_text, template_id):
            raise RuntimeError(f"could not save evidence pack for candidate {context.candidate_id}")
        return {"candidateId": context.candidate_id, "zipKey": zip_key, "fileNames": sorted(pack_file_map)}

    def build_pack(self, candidate_id: int) -> dict:
        with psycopg.connect(self._database_url) as connection:
            context = load_evidence_context(connection, candidate_id)
            if context is None:
                raise ValueError(f"candidate {candidate_id} not found")
            # Only approval leads to a notice; a stale or replayed job for any other status does nothing
            if context.status != "approved":
                return {"candidateId": candidate_id, "skipped": context.status}
            try:
                return self._store_pack(connection, context)
            except CreatorFixableError as error:
                save_evidence_error(connection, candidate_id, str(error))
                return {"candidateId": candidate_id, "evidenceError": str(error)}
