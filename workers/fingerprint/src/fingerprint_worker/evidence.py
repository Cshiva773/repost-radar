"""Builds the evidence pack for an approved candidate: side-by-side PNG, metadata.json, a one-page PDF
summary, the notice text, and a ZIP holding all of them plus both images. Pure functions over bytes;
storage and database access live in main.py and database.py."""

import hashlib
import io
import json
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone

from fpdf import FPDF
from PIL import Image, ImageDraw, ImageFont, ImageOps

PANEL_HEIGHT = 640
MAX_PANEL_WIDTH = 900
PANEL_GAP = 24
HEADER_HEIGHT = 56
FOOTER_HEIGHT = 44
LABEL_FONT_SIZE = 22
BACKGROUND_COLOUR = (255, 255, 255)
TEXT_COLOUR = (20, 20, 20)
EXTENSION_BY_FORMAT = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
# Display names for the PDF and notices; the API's platform registry (packages/platforms) is the source
PLATFORM_DISPLAY_NAMES = {"reddit": "Reddit", "bluesky": "Bluesky"}
DATE_FORMAT = "%Y-%m-%d %H:%M UTC"
PDF_TEXT_WIDTH_MM = 180


@dataclass(frozen=True)
class DecisionRecordDetails:
    actor: str
    from_status: str
    to_status: str
    note: str | None
    decided_at: datetime


@dataclass(frozen=True)
class EvidenceContextDetails:
    candidate_id: int
    status: str
    confidence: float
    hash_distance: int | None
    embed_similarity: float | None
    detected_at: datetime
    platform: str
    target_name: str
    post_author: str | None
    post_title: str | None
    post_url: str
    posted_at: datetime | None
    original_storage_key: str
    original_sha256: str
    candidate_storage_key: str | None
    creator_name: str
    legal_name: str | None
    contact_email: str | None
    mailing_address: str | None
    decision_list: tuple[DecisionRecordDetails, ...]


def platform_display_name(platform: str) -> str:
    return PLATFORM_DISPLAY_NAMES.get(platform, platform.title())


def format_timestamp(timestamp: datetime | None) -> str | None:
    return timestamp.astimezone(timezone.utc).strftime(DATE_FORMAT) if timestamp else None


def image_extension(image_bytes: bytes) -> str:
    with Image.open(io.BytesIO(image_bytes)) as image:
        return EXTENSION_BY_FORMAT.get(image.format or "", "bin")


def build_notice_values(context: EvidenceContextDetails, original_extension: str, generated_at: datetime) -> dict[str, str | None]:
    return {
        "infringing_url": context.post_url, "post_author": context.post_author, "post_title": context.post_title,
        "target_name": context.target_name, "posted_at": format_timestamp(context.posted_at),
        "platform_name": platform_display_name(context.platform), "original_sha256": context.original_sha256,
        "original_extension": original_extension, "creator_name": context.creator_name, "legal_name": context.legal_name,
        "mailing_address": context.mailing_address, "contact_email": context.contact_email,
        "candidate_id": str(context.candidate_id), "confidence": f"{context.confidence:.3f}",
        "detected_at": format_timestamp(context.detected_at), "today": generated_at.astimezone(timezone.utc).strftime("%Y-%m-%d"),
    }


def _fit_panel(image_bytes: bytes) -> Image.Image:
    with Image.open(io.BytesIO(image_bytes)) as source_image:
        panel_image = ImageOps.exif_transpose(source_image).convert("RGB")
    scale = min(PANEL_HEIGHT / panel_image.height, MAX_PANEL_WIDTH / panel_image.width)
    return panel_image.resize((max(1, round(panel_image.width * scale)), max(1, round(panel_image.height * scale))), Image.LANCZOS)


def build_side_by_side(original_bytes: bytes, candidate_bytes: bytes, candidate_label: str, score_line: str) -> bytes:
    original_panel, candidate_panel = _fit_panel(original_bytes), _fit_panel(candidate_bytes)
    canvas_width = original_panel.width + candidate_panel.width + PANEL_GAP * 3
    canvas = Image.new("RGB", (canvas_width, HEADER_HEIGHT + PANEL_HEIGHT + FOOTER_HEIGHT), BACKGROUND_COLOUR)
    label_font = ImageFont.load_default(size=LABEL_FONT_SIZE)
    drawing = ImageDraw.Draw(canvas)
    candidate_left = PANEL_GAP * 2 + original_panel.width
    for panel_image, panel_left, panel_label in ((original_panel, PANEL_GAP, "Original"), (candidate_panel, candidate_left, candidate_label)):
        canvas.paste(panel_image, (panel_left, HEADER_HEIGHT + (PANEL_HEIGHT - panel_image.height) // 2))
        drawing.text((panel_left, HEADER_HEIGHT // 2), panel_label, fill=TEXT_COLOUR, font=label_font, anchor="lm")
    drawing.text((PANEL_GAP, HEADER_HEIGHT + PANEL_HEIGHT + FOOTER_HEIGHT // 2), score_line, fill=TEXT_COLOUR, font=label_font, anchor="lm")
    output_buffer = io.BytesIO()
    canvas.save(output_buffer, format="PNG", optimize=True)
    return output_buffer.getvalue()


def score_line(context: EvidenceContextDetails) -> str:
    distance_text = f"PDQ distance {context.hash_distance}/256" if context.hash_distance is not None else "PDQ distance n/a"
    similarity_text = f"CLIP similarity {context.embed_similarity:.3f}" if context.embed_similarity is not None else "CLIP similarity n/a"
    return f"Confidence {context.confidence:.3f}   {distance_text}   {similarity_text}"


def build_metadata(context: EvidenceContextDetails, original_bytes: bytes, candidate_bytes: bytes, generated_at: datetime) -> dict:
    return {
        "candidateId": context.candidate_id,
        "generatedAt": generated_at.astimezone(timezone.utc).isoformat(),
        "match": {"confidence": context.confidence, "pdqHammingDistance": context.hash_distance, "clipCosineSimilarity": context.embed_similarity,
                  "detectedAt": context.detected_at.astimezone(timezone.utc).isoformat(), "scoring": "docs/PRD.md#detection-approach"},
        "original": {"sha256": context.original_sha256, "sha256OfFileInPack": hashlib.sha256(original_bytes).hexdigest()},
        "copy": {"platform": context.platform, "where": context.target_name, "postUrl": context.post_url, "author": context.post_author,
                 "title": context.post_title, "postedAt": context.posted_at.astimezone(timezone.utc).isoformat() if context.posted_at else None,
                 "sha256OfFileInPack": hashlib.sha256(candidate_bytes).hexdigest()},
        "decisions": [{"actor": decision.actor, "from": decision.from_status, "to": decision.to_status, "note": decision.note,
                       "at": decision.decided_at.astimezone(timezone.utc).isoformat()} for decision in context.decision_list],
    }


def _pdf_text(text_value: str | None) -> str:
    # Core PDF fonts are Latin-1 only; metadata.json keeps the exact text
    return (text_value or "-").encode("latin-1", "replace").decode("latin-1")


def _summary_rows(context: EvidenceContextDetails) -> list[tuple[str, str | None]]:
    approval = next((decision for decision in reversed(context.decision_list) if decision.to_status == "approved"), None)
    return [
        ("Copy found at", context.post_url), ("Platform", f"{platform_display_name(context.platform)} ({context.target_name})"),
        ("Posted by", context.post_author), ("Posted at", format_timestamp(context.posted_at)), ("Post title", context.post_title),
        ("Original SHA-256", context.original_sha256), ("Match", score_line(context)), ("Detected at", format_timestamp(context.detected_at)),
        ("Approved by", f"{approval.actor} at {format_timestamp(approval.decided_at)}" if approval else None),
        ("Reviewer note", approval.note if approval else None),
    ]


def build_summary_pdf(context: EvidenceContextDetails, side_by_side_png: bytes, generated_at: datetime) -> bytes:
    pdf_document = FPDF(format="A4")
    pdf_document.set_auto_page_break(auto=True, margin=12)
    pdf_document.add_page()
    pdf_document.set_font("Helvetica", "B", 15)
    pdf_document.cell(PDF_TEXT_WIDTH_MM, 9, f"Evidence summary: candidate #{context.candidate_id}", new_x="LMARGIN", new_y="NEXT")
    pdf_document.set_font("Helvetica", size=9)
    for row_label, row_value in _summary_rows(context):
        pdf_document.set_font("Helvetica", "B", 9)
        pdf_document.cell(38, 5.5, _pdf_text(row_label))
        pdf_document.set_font("Helvetica", size=9)
        pdf_document.multi_cell(PDF_TEXT_WIDTH_MM - 38, 5.5, _pdf_text(row_value), new_x="LMARGIN", new_y="NEXT")
    pdf_document.ln(3)
    pdf_document.image(io.BytesIO(side_by_side_png), w=PDF_TEXT_WIDTH_MM)
    pdf_document.ln(3)
    pdf_document.set_font("Helvetica", "I", 8)
    pdf_document.multi_cell(PDF_TEXT_WIDTH_MM, 4.5, _pdf_text(
        f"Generated by Repost Radar on {format_timestamp(generated_at)}. A human reviewer approved this match and confirmed a good-faith "
        "belief that the use is not authorised. Nothing has been sent to the platform; the creator files the notice themselves."))
    return bytes(pdf_document.output())


def build_zip(pack_file_map: dict[str, bytes]) -> bytes:
    output_buffer = io.BytesIO()
    with zipfile.ZipFile(output_buffer, "w", compression=zipfile.ZIP_DEFLATED) as pack_zip:
        for file_name, file_bytes in pack_file_map.items():
            pack_zip.writestr(file_name, file_bytes)
    return output_buffer.getvalue()


def build_pack_files(context: EvidenceContextDetails, original_bytes: bytes, candidate_bytes: bytes, notice_text: str,
                     generated_at: datetime) -> dict[str, bytes]:
    side_by_side_png = build_side_by_side(original_bytes, candidate_bytes, f"Found on {platform_display_name(context.platform)}", score_line(context))
    metadata_details = build_metadata(context, original_bytes, candidate_bytes, generated_at)
    return {
        f"original.{image_extension(original_bytes)}": original_bytes,
        f"copy.{image_extension(candidate_bytes)}": candidate_bytes,
        "side_by_side.png": side_by_side_png,
        "metadata.json": json.dumps(metadata_details, indent=2).encode("utf-8"),
        "summary.pdf": build_summary_pdf(context, side_by_side_png, generated_at),
        "notice.txt": notice_text.encode("utf-8"),
    }
