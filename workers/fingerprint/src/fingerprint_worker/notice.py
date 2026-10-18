"""Fills a notice template. Refuses to produce a notice while any placeholder is unresolved, so an
incomplete notice can never be exported (PRD: every placeholder must resolve before export). The one
exception is an optional placeholder: with no value, a line holding only it is left out."""

import re

# Must match NOTICE_PLACEHOLDER_LIST in apps/api/src/noticeTemplates/noticePlaceholders.ts (a test checks)
NOTICE_PLACEHOLDER_NAMES = (
    "infringing_url", "post_author", "post_title", "target_name", "posted_at", "platform_name",
    "original_sha256", "original_extension", "creator_name", "legal_name", "mailing_address", "contact_email",
    "candidate_id", "confidence", "detected_at", "today", "ownership_proof",
)
# May be empty: the proof of ownership is only there when the creator added some or the file carries metadata
OPTIONAL_PLACEHOLDER_NAMES = frozenset({"ownership_proof"})

PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([^{}]*?)\s*\}\}")


class UnresolvedPlaceholderError(ValueError):
    def __init__(self, placeholder_names: list[str]) -> None:
        self.placeholder_names = placeholder_names
        super().__init__("Unresolved placeholder(s): " + ", ".join(f"{{{{{name}}}}}" for name in placeholder_names))


def find_placeholder_names(template_text: str) -> list[str]:
    return list(dict.fromkeys(PLACEHOLDER_PATTERN.findall(template_text)))


def _has_value(placeholder_values: dict[str, str | None], placeholder_name: str) -> bool:
    return bool((placeholder_values.get(placeholder_name) or "").strip())


def _is_empty_optional_line(template_line: str, placeholder_values: dict[str, str | None]) -> bool:
    line_names = find_placeholder_names(template_line)
    is_only_placeholders = not PLACEHOLDER_PATTERN.sub("", template_line).strip()
    return bool(line_names) and is_only_placeholders and all(
        name in OPTIONAL_PLACEHOLDER_NAMES and not _has_value(placeholder_values, name) for name in line_names)


def render_notice(template_text: str, placeholder_values: dict[str, str | None]) -> str:
    """Raises UnresolvedPlaceholderError naming every required placeholder that is unknown or has no value."""
    template_line_list = template_text.split("\n")
    kept_text = "\n".join(template_line for template_line in template_line_list if not _is_empty_optional_line(template_line, placeholder_values))
    unresolved_names = [name for name in find_placeholder_names(kept_text)
                        if name not in OPTIONAL_PLACEHOLDER_NAMES and not _has_value(placeholder_values, name)]
    if unresolved_names:
        raise UnresolvedPlaceholderError(unresolved_names)
    return PLACEHOLDER_PATTERN.sub(lambda placeholder_match: str(placeholder_values.get(placeholder_match.group(1)) or "").strip(), kept_text)
