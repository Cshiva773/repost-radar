import hashlib
import io
import json
import zipfile
from datetime import date, datetime, timezone

from PIL import Image

from fingerprint_worker.evidence import (
    DecisionRecordDetails, EvidenceContextDetails, OwnershipProofDetails, build_claim_timeline, build_notice_values, build_ownership_proof_text,
    build_pack_files, build_side_by_side, build_zip, earliest_proof, image_extension,
)

FULL_PROOF = OwnershipProofDetails(
    first_published_url="https://dana.photo/lighthouse", first_published_on=date(2024, 5, 1), note="RAW file available on request",
    file_taken_at=datetime(2024, 4, 28, 18, 42), file_artist="Dana Example", file_copyright="© Dana Example 2024",
)

GENERATED_AT = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)


def make_image_bytes(image_size: tuple[int, int], image_format: str, colour=(200, 40, 40)) -> bytes:
    output_buffer = io.BytesIO()
    Image.new("RGB", image_size, colour).save(output_buffer, format=image_format)
    return output_buffer.getvalue()


def make_context(**overrides) -> EvidenceContextDetails:
    context_fields = dict(
        candidate_id=42, status="approved", confidence=0.953, hash_distance=12, embed_similarity=0.97,
        detected_at=datetime(2026, 10, 9, 8, 30, tzinfo=timezone.utc), platform="reddit", target_name="pics",
        post_author="reposter", post_title="Sunset I took 🌅", post_url="https://www.reddit.com/r/pics/comments/abc/x/",
        posted_at=datetime(2026, 10, 9, 8, 0, tzinfo=timezone.utc), original_storage_key="originals/1", original_sha256="ab" * 32,
        candidate_storage_key="crawled/reddit/t3_abc", creator_name="Demo", legal_name="Dana Example", contact_email="dana@example.com",
        mailing_address="1 Example Street",
        decision_list=(DecisionRecordDetails("admin", "pending", "approved", "my photo", datetime(2026, 10, 10, 9, 0, tzinfo=timezone.utc)),),
    )
    context_fields.update(overrides)
    return EvidenceContextDetails(**context_fields)


def test_side_by_side_fits_both_images_at_panel_height():
    side_by_side_png = build_side_by_side(make_image_bytes((1600, 1200), "JPEG"), make_image_bytes((400, 800), "PNG"), "Found on Reddit", "Confidence 0.95")
    with Image.open(io.BytesIO(side_by_side_png)) as side_by_side_image:
        assert side_by_side_image.format == "PNG"
        assert side_by_side_image.height == 56 + 640 + 44
        assert side_by_side_image.width == round(1600 * 640 / 1200) + round(400 * 640 / 800) + 24 * 3


def test_notice_values_format_dates_and_leave_missing_fields_empty():
    notice_values = build_notice_values(make_context(post_title=None, platform="bluesky"), "jpg", GENERATED_AT)
    assert notice_values["posted_at"] == "2026-10-09 08:00 UTC"
    assert notice_values["today"] == "2026-10-10"
    assert notice_values["platform_name"] == "Bluesky"
    assert notice_values["post_title"] is None


def test_pack_holds_every_file_with_hashes_of_what_it_ships():
    original_bytes, candidate_bytes = make_image_bytes((800, 600), "JPEG"), make_image_bytes((640, 480), "WEBP")
    pack_file_map = build_pack_files(make_context(), original_bytes, candidate_bytes, "Subject: notice\n\nbody", GENERATED_AT)
    assert sorted(pack_file_map) == ["copy.webp", "metadata.json", "notice.txt", "original.jpg", "side_by_side.png", "summary.pdf"]
    assert pack_file_map["summary.pdf"].startswith(b"%PDF")
    metadata_details = json.loads(pack_file_map["metadata.json"])
    assert metadata_details["copy"]["sha256OfFileInPack"] == hashlib.sha256(candidate_bytes).hexdigest()
    assert metadata_details["copy"]["title"] == "Sunset I took 🌅"  # exact text survives even though the PDF is Latin-1
    assert metadata_details["decisions"][0]["actor"] == "admin"


def test_zip_round_trips_and_extension_follows_content():
    assert image_extension(make_image_bytes((10, 10), "PNG")) == "png"
    with zipfile.ZipFile(io.BytesIO(build_zip({"a.txt": b"one", "b.bin": b"two"}))) as pack_zip:
        assert pack_zip.read("b.bin") == b"two"


def test_notice_dates_use_the_creator_time_zone():
    # 23:56 UTC on the 10th is already 05:26 on the 11th in India: the signed notice must say the 11th
    late_evening_utc = datetime(2026, 10, 10, 23, 56, tzinfo=timezone.utc)
    notice_values = build_notice_values(make_context(time_zone="Asia/Kolkata"), "jpg", late_evening_utc)
    assert notice_values["today"] == "2026-10-11"
    assert notice_values["posted_at"] == "2026-10-09 13:30 IST"


def test_unknown_time_zone_falls_back_to_utc():
    notice_values = build_notice_values(make_context(time_zone="Mars/Olympus_Mons"), "jpg", GENERATED_AT)
    assert notice_values["today"] == "2026-10-10" and notice_values["posted_at"].endswith("UTC")


def test_ownership_proof_sentence_attributes_each_value_to_its_source():
    assert build_ownership_proof_text(FULL_PROOF) == (
        "I first published this photograph at https://dana.photo/lighthouse on 2024-05-01. "
        "The metadata in the original file records it as taken on 2024-04-28 by Dana Example."
    )
    assert build_ownership_proof_text(OwnershipProofDetails(first_published_on=date(2024, 5, 1))) == "I first published this photograph on 2024-05-01."
    assert build_ownership_proof_text(OwnershipProofDetails(file_artist="Dana Example")) == "The metadata in the original file names Dana Example as its author."
    assert build_ownership_proof_text(OwnershipProofDetails(note="only a note")) == ""


def test_notice_values_carry_the_proof_sentence_or_nothing():
    assert build_notice_values(make_context(), "jpg", GENERATED_AT)["ownership_proof"] == ""
    proof_text = build_notice_values(make_context(ownership_proof=FULL_PROOF), "jpg", GENERATED_AT)["ownership_proof"]
    assert proof_text.startswith("I first published this photograph at https://dana.photo/lighthouse")


def test_metadata_records_the_proof_by_source_and_never_as_verified():
    pack_file_map = build_pack_files(make_context(ownership_proof=FULL_PROOF), make_image_bytes((80, 60), "JPEG"), make_image_bytes((80, 60), "PNG"),
                                     "Subject: notice\n\nbody", GENERATED_AT)
    ownership_details = json.loads(pack_file_map["metadata.json"])["original"]["ownershipProof"]
    assert ownership_details["verified"] is False
    assert ownership_details["statedByCreator"] == {"firstPublishedUrl": "https://dana.photo/lighthouse", "firstPublishedOn": "2024-05-01",
                                                   "note": "RAW file available on request"}
    assert ownership_details["fromOriginalFile"] == {"exifDateTimeOriginal": "2024-04-28T18:42:00", "exifArtist": "Dana Example",
                                                    "exifCopyright": "© Dana Example 2024"}
    assert pack_file_map["summary.pdf"].startswith(b"%PDF")


def test_metadata_without_proof_keeps_every_key_empty():
    pack_file_map = build_pack_files(make_context(), make_image_bytes((80, 60), "JPEG"), make_image_bytes((80, 60), "PNG"), "n", GENERATED_AT)
    ownership_details = json.loads(pack_file_map["metadata.json"])["original"]["ownershipProof"]
    assert ownership_details["statedByCreator"]["firstPublishedUrl"] is None
    assert ownership_details["fromOriginalFile"]["exifDateTimeOriginal"] is None


def test_timeline_flags_a_copy_posted_before_any_proof():
    uploaded_late = OwnershipProofDetails(uploaded_at=datetime(2026, 10, 16, 9, 0, tzinfo=timezone.utc))
    timeline = build_claim_timeline(make_context(posted_at=datetime(2025, 3, 12, 8, 0, tzinfo=timezone.utc), ownership_proof=uploaded_late))
    assert timeline == {"copyPostedOn": "2025-03-12", "earliestProofOn": "2026-10-16", "earliestProofSource": "added to Repost Radar",
                        "copyPostedBeforeEarliestProof": True}


def test_timeline_uses_the_earliest_proof_and_clears_the_flag():
    proof_with_dates = OwnershipProofDetails(first_published_on=date(2024, 5, 1), file_taken_at=datetime(2024, 4, 28, 18, 42),
                                             uploaded_at=datetime(2026, 10, 16, 9, 0, tzinfo=timezone.utc))
    assert earliest_proof(proof_with_dates) == (date(2024, 4, 28), "date taken (from the file's metadata)")
    timeline = build_claim_timeline(make_context(posted_at=datetime(2025, 3, 12, 8, 0, tzinfo=timezone.utc), ownership_proof=proof_with_dates))
    assert timeline["copyPostedBeforeEarliestProof"] is False


def test_timeline_without_dates_flags_nothing():
    assert build_claim_timeline(make_context(posted_at=None))["copyPostedBeforeEarliestProof"] is False
    assert earliest_proof(OwnershipProofDetails()) is None
