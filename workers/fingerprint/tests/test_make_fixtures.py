from fingerprint_worker.make_fixtures import GATE_TRANSFORM_LIST, planted_post_fields, planted_transform_list
from fingerprint_worker.transforms import TRANSFORM_BY_NAME


def test_default_copy_count_plants_exactly_the_gate_edits():
    assert planted_transform_list(5) == GATE_TRANSFORM_LIST


def test_fewer_copies_keep_the_gate_order():
    assert planted_transform_list(2) == GATE_TRANSFORM_LIST[:2]


def test_extra_copies_cover_every_edit():
    transform_list = planted_transform_list(20)
    assert len(transform_list) == 20
    assert transform_list[:5] == GATE_TRANSFORM_LIST
    assert set(transform_list) == set(TRANSFORM_BY_NAME)


def test_planted_posts_get_varied_authors_and_titles():
    first_fields, second_fields = planted_post_fields(0, "resize_50"), planted_post_fields(1, "crop_20")
    assert first_fields["author"] != second_fields["author"]
    assert second_fields["title"].endswith("(crop_20)")
