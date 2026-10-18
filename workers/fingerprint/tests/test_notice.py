import hashlib
import re
from pathlib import Path

import pytest

from fingerprint_worker.notice import NOTICE_PLACEHOLDER_NAMES, UnresolvedPlaceholderError, find_placeholder_names, render_notice

API_PLACEHOLDER_FILE = Path(__file__).resolve().parents[3] / "apps" / "api" / "src" / "noticeTemplates" / "noticePlaceholders.ts"
SEED_MIGRATION_FILE = Path(__file__).resolve().parents[3] / "packages" / "db" / "migrations" / "005_review.sql"
PROOF_MIGRATION_FILE = Path(__file__).resolve().parents[3] / "packages" / "db" / "migrations" / "010_ownership_proof.sql"


def test_renders_every_placeholder_with_or_without_inner_spaces():
    rendered_text = render_notice("Hi {{legal_name}}, see {{ infringing_url }}.", {"legal_name": "Dana", "infringing_url": "https://x/1"})
    assert rendered_text == "Hi Dana, see https://x/1."


def test_refuses_to_render_while_any_placeholder_is_empty_or_unknown():
    with pytest.raises(UnresolvedPlaceholderError) as raised_error:
        render_notice("{{legal_name}} {{post_title}} {{ signature }} {{post_title}}", {"legal_name": "Dana", "post_title": "  "})
    assert raised_error.value.placeholder_names == ["post_title", "signature"]
    assert "{{post_title}}" in str(raised_error.value)


def test_an_empty_optional_placeholder_drops_its_line_instead_of_stopping_the_notice():
    template_text = "Original work: attached.\n{{ownership_proof}}\n\nSigned: {{legal_name}}"
    assert render_notice(template_text, {"legal_name": "Dana", "ownership_proof": ""}) == "Original work: attached.\n\nSigned: Dana"
    filled_text = render_notice(template_text, {"legal_name": "Dana", "ownership_proof": "I first published it on 2024-05-01."})
    assert filled_text == "Original work: attached.\nI first published it on 2024-05-01.\n\nSigned: Dana"


def test_an_empty_optional_placeholder_inside_other_text_becomes_empty():
    assert render_notice("Proof: {{ownership_proof}}.", {"ownership_proof": None}) == "Proof: ."


def test_required_placeholders_are_still_enforced_next_to_an_optional_one():
    with pytest.raises(UnresolvedPlaceholderError) as raised_error:
        render_notice("{{ownership_proof}} {{legal_name}}", {"ownership_proof": "", "legal_name": ""})
    assert raised_error.value.placeholder_names == ["legal_name"]


def test_placeholder_list_matches_the_api():
    api_source = API_PLACEHOLDER_FILE.read_text(encoding="utf-8")
    api_placeholder_names = tuple(re.findall(r"\{ name: '([a-z0-9_]+)'", api_source))
    assert api_placeholder_names == NOTICE_PLACEHOLDER_NAMES


def test_seeded_templates_only_use_known_placeholders():
    seeded_names = set(find_placeholder_names(SEED_MIGRATION_FILE.read_text(encoding="utf-8")))
    assert seeded_names and seeded_names <= set(NOTICE_PLACEHOLDER_NAMES)


def test_proof_migration_only_upgrades_the_untouched_seeded_templates():
    """010 adds {{ownership_proof}} only to templates whose body still hashes to 005's seed text."""
    seed_body_list = re.findall(r"\$\$(.*?)\$\$", SEED_MIGRATION_FILE.read_text(encoding="utf-8"), re.S)
    proof_migration_text = PROOF_MIGRATION_FILE.read_text(encoding="utf-8")
    assert len(seed_body_list) == 2
    for seed_body in seed_body_list:
        assert hashlib.md5(seed_body.encode("utf-8")).hexdigest() in proof_migration_text
        assert seed_body.count("A side-by-side comparison is attached.") == 1
