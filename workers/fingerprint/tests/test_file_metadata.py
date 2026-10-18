import io
from datetime import datetime

from PIL import Image

from fingerprint_worker.file_metadata import (
    ARTIST_TAG, COPYRIGHT_TAG, DATE_TIME_ORIGINAL_TAG, EMPTY_FILE_METADATA, EXIF_IFD_POINTER, clean_exif_text, parse_exif_datetime,
    read_file_metadata,
)


def make_image_with_exif(image_format: str, **exif_values) -> bytes:
    exif_details = Image.Exif()
    if "artist" in exif_values:
        exif_details[ARTIST_TAG] = exif_values["artist"]
    if "copyright" in exif_values:
        exif_details[COPYRIGHT_TAG] = exif_values["copyright"]
    if "taken_at" in exif_values:
        exif_details.get_ifd(EXIF_IFD_POINTER)[DATE_TIME_ORIGINAL_TAG] = exif_values["taken_at"]
    output_buffer = io.BytesIO()
    Image.new("RGB", (32, 32), (90, 140, 200)).save(output_buffer, format=image_format, exif=exif_details)
    return output_buffer.getvalue()


def test_reads_date_taken_artist_and_copyright_from_jpeg_and_webp():
    for image_format in ("JPEG", "WEBP"):
        image_bytes = make_image_with_exif(image_format, artist="Dana Example", copyright="Copyright 2024 Dana Example", taken_at="2024:04:28 18:42:13")
        file_metadata = read_file_metadata(image_bytes)
        assert file_metadata.taken_at == datetime(2024, 4, 28, 18, 42, 13)
        assert file_metadata.artist == "Dana Example"
        assert file_metadata.copyright == "Copyright 2024 Dana Example"


def test_a_file_without_exif_or_not_an_image_has_no_metadata():
    output_buffer = io.BytesIO()
    Image.new("RGB", (32, 32)).save(output_buffer, format="PNG")
    assert read_file_metadata(output_buffer.getvalue()) == EMPTY_FILE_METADATA
    assert read_file_metadata(b"not an image") == EMPTY_FILE_METADATA


def test_ignores_unset_camera_clocks_and_malformed_dates():
    assert parse_exif_datetime("0000:00:00 00:00:00") is None
    assert parse_exif_datetime("1970:01:01 00:00:00") is None
    assert parse_exif_datetime("2024-04-28 18:42:13") is None
    assert parse_exif_datetime(20240428) is None
    assert parse_exif_datetime("2024:04:28 18:42:13\x00") == datetime(2024, 4, 28, 18, 42, 13)


def test_cleans_padding_and_blank_text_fields():
    assert clean_exif_text("  Dana \x00 Example\x00\x00") == "Dana Example"
    assert clean_exif_text(b"Dana Example") == "Dana Example"
    assert clean_exif_text("   ") is None
    assert clean_exif_text(None) is None
    assert len(clean_exif_text("x" * 500)) == 200
