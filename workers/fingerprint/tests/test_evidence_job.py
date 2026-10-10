from contextlib import contextmanager

from fingerprint_worker import evidence_job
from fingerprint_worker.evidence_database import NoticeTemplateDetails
from fingerprint_worker.evidence_job import EvidenceJobHandler
from test_evidence import make_context, make_image_bytes


class FakeObjectStorage:
    def __init__(self) -> None:
        self.written_keys: list[str] = []

    def read_object(self, storage_key: str) -> bytes:
        return make_image_bytes((320, 240), "JPEG")

    def write_object(self, storage_key: str, object_bytes: bytes, content_type: str) -> None:
        self.written_keys.append(storage_key)


@contextmanager
def fake_connect(_database_url):
    yield object()


def run_job(monkeypatch, context, template_body: str):
    saved_error_list, saved_pack_list = [], []
    monkeypatch.setattr(evidence_job.psycopg, "connect", fake_connect)
    monkeypatch.setattr(evidence_job, "load_evidence_context", lambda _connection, _candidate_id: context)
    monkeypatch.setattr(evidence_job, "find_notice_template", lambda _connection, _platform: NoticeTemplateDetails(7, "Notice {{infringing_url}}", template_body))
    monkeypatch.setattr(evidence_job, "save_evidence_error", lambda _connection, candidate_id, message: saved_error_list.append(message) or True)
    monkeypatch.setattr(evidence_job, "save_evidence_pack", lambda _connection, *pack_fields: saved_pack_list.append(pack_fields) or True)
    object_storage = FakeObjectStorage()
    job_result = EvidenceJobHandler(object_storage, "postgres://unused").build_pack(context.candidate_id)
    return job_result, saved_error_list, saved_pack_list, object_storage


def test_builds_and_stores_a_pack_for_an_approved_candidate(monkeypatch):
    job_result, saved_error_list, saved_pack_list, object_storage = run_job(monkeypatch, make_context(), "Signed {{legal_name}}")
    assert saved_error_list == []
    assert object_storage.written_keys == ["evidence/42/summary.pdf", "evidence/42/pack.zip"]
    candidate_id, zip_key, _pdf_key, notice_text, template_id = saved_pack_list[0]
    assert (candidate_id, zip_key, template_id) == (42, "evidence/42/pack.zip", 7)
    assert notice_text == "Subject: Notice https://www.reddit.com/r/pics/comments/abc/x/\n\nSigned Dana Example"
    assert "notice.txt" in job_result["fileNames"]


def test_unresolved_placeholder_is_recorded_for_the_creator_instead_of_retried(monkeypatch):
    job_result, saved_error_list, saved_pack_list, object_storage = run_job(monkeypatch, make_context(post_title=None), "Title: {{post_title}}")
    assert saved_pack_list == [] and object_storage.written_keys == []
    assert "{{post_title}}" in saved_error_list[0] and job_result["evidenceError"] == saved_error_list[0]


def test_a_missing_copy_is_recorded_and_non_approved_candidates_are_skipped(monkeypatch):
    _job_result, saved_error_list, _saved_pack_list, _storage = run_job(monkeypatch, make_context(candidate_storage_key=None), "x")
    assert "no longer stored" in saved_error_list[0]
    skipped_result, saved_error_list, _saved_pack_list, _storage = run_job(monkeypatch, make_context(status="dismissed"), "x")
    assert skipped_result == {"candidateId": 42, "skipped": "dismissed"} and saved_error_list == []
