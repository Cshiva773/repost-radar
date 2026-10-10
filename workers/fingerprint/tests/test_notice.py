import re
from pathlib import Path

import pytest

from fingerprint_worker.notice import NOTICE_PLACEHOLDER_NAMES, UnresolvedPlaceholderError, find_placeholder_names, render_notice

API_PLACEHOLDER_FILE = Path(__file__).resolve().parents[3] / "apps" / "api" / "src" / "noticeTemplates" / "noticePlaceholders.ts"
SEED_MIGRATION_FILE = Path(__file__).resolve().parents[3] / "packages" / "db" / "migrations" / "005_review.sql"


def test_renders_every_placeholder_with_or_without_inner_spaces():
    rendered_text = render_notice("Hi {{legal_name}}, see {{ infringing_url }}.", {"legal_name": "Dana", "infringing_url": "https://x/1"})
    assert rendered_text == "Hi Dana, see https://x/1."


def test_refuses_to_render_while_any_placeholder_is_empty_or_unknown():
    with pytest.raises(UnresolvedPlaceholderError) as raised_error:
        render_notice("{{legal_name}} {{post_title}} {{ signature }} {{post_title}}", {"legal_name": "Dana", "post_title": "  "})
    assert raised_error.value.placeholder_names == ["post_title", "signature"]
    assert "{{post_title}}" in str(raised_error.value)


def test_placeholder_list_matches_the_api():
    api_source = API_PLACEHOLDER_FILE.read_text(encoding="utf-8")
    api_placeholder_names = tuple(re.findall(r"\{ name: '([a-z0-9_]+)'", api_source))
    assert api_placeholder_names == NOTICE_PLACEHOLDER_NAMES


def test_seeded_templates_only_use_known_placeholders():
    seeded_names = set(find_placeholder_names(SEED_MIGRATION_FILE.read_text(encoding="utf-8")))
    assert seeded_names and seeded_names <= set(NOTICE_PLACEHOLDER_NAMES)
