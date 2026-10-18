"""Reads what an original's own file says about it: the camera's "date taken", and the Artist and Copyright
fields. Shown to the creator as ownership evidence and carried into the evidence pack, always labelled as
read from the file: EXIF can be edited, so Repost Radar never treats it as verified. Pure; no I/O."""

import io
from dataclasses import dataclass
from datetime import datetime

from PIL import Image

EXIF_IFD_POINTER = 0x8769
DATE_TIME_ORIGINAL_TAG = 0x9003
ARTIST_TAG = 0x013B
COPYRIGHT_TAG = 0x8298
EXIF_DATE_FORMAT = "%Y:%m:%d %H:%M:%S"
# Cameras with an unset clock write 0000:00:00 or 1970; neither says anything about who made the photo
EARLIEST_PLAUSIBLE_YEAR = 1980
MAX_TEXT_LENGTH = 200


@dataclass(frozen=True)
class FileMetadataDetails:
    taken_at: datetime | None
    artist: str | None
    copyright: str | None


EMPTY_FILE_METADATA = FileMetadataDetails(taken_at=None, artist=None, copyright=None)


def parse_exif_datetime(raw_value: object) -> datetime | None:
    if not isinstance(raw_value, str):
        return None
    try:
        taken_at = datetime.strptime(raw_value.strip().rstrip("\x00"), EXIF_DATE_FORMAT)
    except ValueError:
        return None
    return taken_at if taken_at.year >= EARLIEST_PLAUSIBLE_YEAR else None


def clean_exif_text(raw_value: object) -> str | None:
    if isinstance(raw_value, bytes):
        raw_value = raw_value.decode("utf-8", "replace")
    if not isinstance(raw_value, str):
        return None
    cleaned_text = " ".join(raw_value.replace("\x00", " ").split())
    return cleaned_text[:MAX_TEXT_LENGTH] or None


def read_file_metadata(image_bytes: bytes) -> FileMetadataDetails:
    """Never raises: a file with no EXIF, or EXIF Pillow cannot parse, simply has no metadata."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as source_image:
            exif_details = source_image.getexif()
            exif_ifd = exif_details.get_ifd(EXIF_IFD_POINTER)
            return FileMetadataDetails(
                taken_at=parse_exif_datetime(exif_ifd.get(DATE_TIME_ORIGINAL_TAG)),
                artist=clean_exif_text(exif_details.get(ARTIST_TAG)),
                copyright=clean_exif_text(exif_details.get(COPYRIGHT_TAG)),
            )
    except (OSError, ValueError, SyntaxError, KeyError, TypeError):
        return EMPTY_FILE_METADATA
