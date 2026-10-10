import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone

from PIL import Image

from fingerprint_worker.evidence import (
    DecisionRecordDetails, EvidenceContextDetails, build_notice_values, build_pack_files, build_side_by_side, build_zip, image_extension,
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
