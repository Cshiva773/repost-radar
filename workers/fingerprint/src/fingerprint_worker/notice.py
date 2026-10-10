"""Fills a notice template. Refuses to produce a notice while any placeholder is unresolved, so an
incomplete notice can never be exported (PRD: every placeholder must resolve before export)."""

import re

# Must match NOTICE_PLACEHOLDER_LIST in apps/api/src/noticeTemplates/noticePlaceholders.ts (a test checks)
NOTICE_PLACEHOLDER_NAMES = (
    "infringing_url", "post_author", "post_title", "target_name", "posted_at", "platform_name",
    "original_sha256", "original_extension", "creator_name", "legal_name", "mailing_address", "contact_email",
    "candidate_id", "confidence", "detected_at", "today",
)

PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([^{}]*?)\s*\}\}")


class UnresolvedPlaceholderError(ValueError):
    def __init__(self, placeholder_names: list[str]) -> None:
        self.placeholder_names = placeholder_names
        super().__init__("Unresolved placeholder(s): " + ", ".join(f"{{{{{name}}}}}" for name in placeholder_names))


def find_placeholder_names(template_text: str) -> list[str]:
    return list(dict.fromkeys(PLACEHOLDER_PATTERN.findall(template_text)))


def render_notice(template_text: str, placeholder_values: dict[str, str | None]) -> str:
    """Raises UnresolvedPlaceholderError naming every placeholder that is unknown or has no value."""
    unresolved_names = [name for name in find_placeholder_names(template_text) if not (placeholder_values.get(name) or "").strip()]
    if unresolved_names:
        raise UnresolvedPlaceholderError(unresolved_names)
    return PLACEHOLDER_PATTERN.sub(lambda placeholder_match: str(placeholder_values[placeholder_match.group(1)]).strip(), template_text)
