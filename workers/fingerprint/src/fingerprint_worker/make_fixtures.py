"""Builds a fake Reddit listing for the phase 2 gate (served by the `fake-reddit` compose service).

Plants transformed copies of seeded originals, a few synthetic images that must NOT match,
and one text + one video post the crawler must skip. Writes `expected.json` with the answer key.

`--copies N` plants more than the gate's 5 copies (one per seeded original, up to 20) for hand testing;
the extras use every edit, so the review queue gets a realistic spread of confidences.
"""

import argparse
import json
import os
import random
import time
from pathlib import Path

import psycopg
from PIL import Image, ImageDraw

from fingerprint_worker.config import load_database_url, load_object_storage_config
from fingerprint_worker.fingerprinting import normalise_image
from fingerprint_worker.storage import ObjectStorage
from fingerprint_worker.transforms import apply_transform

# Edits that score well above the review threshold (docs/notes/phase1-scores.md); phase 2 tests the pipeline, not recall
GATE_TRANSFORM_LIST = ["resize_50", "jpeg_q40", "filter_warm", "resize_50", "jpeg_q40"]
# Copies beyond the gate's cycle through every edit, hard ones first: crops, flips and captions score near the
# 0.70 threshold (docs/notes/phase3-tuning.md), and an occasional miss or wrong original is a realistic review case
EXTRA_TRANSFORM_LIST = ["crop_20", "flip_h", "screenshot", "meme_caption", "rotate_10", "filter_warm", "resize_50", "jpeg_q40"]
# Varied posters and titles so the queue, the notices and the "newest" sort look like a real feed
PLANTED_AUTHOR_LIST = ["throwaway_8812", "pixel_hoarder", "daily_views_bot", "wanderlust_jen", "repost_king99", "quiet_lurker"]
PLANTED_TITLE_LIST = ["Look at this view I found", "Not my photo but wow", "[OC] Took this last weekend", "Saw this and had to share",
                      "Found on my phone, no idea who took it", "This deserves more upvotes"]
DEFAULT_COPY_COUNT = len(GATE_TRANSFORM_LIST)
# Planted posts sit close together, so a re-run with more copies stays newer than the crawler's last-seen cursor
PLANTED_SPACING_SECONDS = 5
NEGATIVE_IMAGE_COUNT = 3
RANDOM_SEED = 20261010


def synthetic_negative_image(image_index: int) -> Image.Image:
    random_source = random.Random(RANDOM_SEED + image_index)
    canvas = Image.new("RGB", (900, 600), tuple(random_source.randrange(256) for _ in range(3)))
    draw = ImageDraw.Draw(canvas)
    for _ in range(25):
        x0, y0 = random_source.randrange(900), random_source.randrange(600)
        box = [x0, y0, x0 + random_source.randrange(40, 300), y0 + random_source.randrange(40, 300)]
        draw.ellipse(box, fill=tuple(random_source.randrange(256) for _ in range(3)))
    return canvas


CROSSPOST_SUBREDDIT = "repostradar_elsewhere"


def listing_post(post_id: str, created_utc: int, **post_fields) -> dict:
    return {"kind": "t3", "data": {"id": post_id, "name": f"t3_{post_id}", "author": "fixture_bot",
                                   "title": f"fixture {post_id}", "permalink": f"/r/fixture/comments/{post_id}/",
                                   "created_utc": created_utc, **post_fields}}


def place_in_subreddit(listing_children: list[dict], subreddit: str) -> None:
    """Gives every fixture post the subreddit it is served under, so permalinks (and notices built from them)
    read /r/<subreddit>/comments/<id>/ like real Reddit posts."""
    for listing_child in listing_children:
        post_data = listing_child["data"]
        post_data["subreddit"] = subreddit
        post_data["permalink"] = f"/r/{subreddit}/comments/{post_data['id']}/"


def planted_transform_list(copy_count: int) -> list[str]:
    """The gate's edits first, so `--copies 5` (the default) plants exactly what the phase 2 gate expects."""
    extra_count = max(0, copy_count - len(GATE_TRANSFORM_LIST))
    extra_list = [EXTRA_TRANSFORM_LIST[extra_index % len(EXTRA_TRANSFORM_LIST)] for extra_index in range(extra_count)]
    return GATE_TRANSFORM_LIST[:copy_count] + extra_list


def planted_post_fields(post_index: int, transform_name: str) -> dict:
    return {"author": PLANTED_AUTHOR_LIST[post_index % len(PLANTED_AUTHOR_LIST)],
            "title": f"{PLANTED_TITLE_LIST[post_index % len(PLANTED_TITLE_LIST)]} ({transform_name})"}


def write_planted_images(output_directory: Path, base_url: str, created_utc: int, copy_count: int) -> tuple[list[dict], list[dict]]:
    object_storage = ObjectStorage(load_object_storage_config(os.environ))
    transform_list = planted_transform_list(copy_count)
    with psycopg.connect(load_database_url(os.environ)) as connection:
        asset_rows = connection.execute(
            "SELECT id, storage_key FROM assets WHERE fingerprinted_at IS NOT NULL ORDER BY id LIMIT %s",
            (len(transform_list),),
        ).fetchall()
    if len(asset_rows) < len(transform_list):
        print(f"Only {len(asset_rows)} fingerprinted originals, so only {len(asset_rows)} of {len(transform_list)} copies are planted")
    listing_children, expected_list = [], []
    for post_index, ((asset_id, storage_key), transform_name) in enumerate(zip(asset_rows, transform_list)):
        post_id = f"planted{post_index + 1}"
        rgb_original = normalise_image(object_storage.read_object(storage_key))
        (output_directory / "img" / f"{post_id}.jpg").write_bytes(apply_transform(transform_name, rgb_original))
        # Every planted copy was also crossposted from one other subreddit, which the API should then suggest watching
        listing_children.append(listing_post(post_id, created_utc - post_index * PLANTED_SPACING_SECONDS, post_hint="image", url=f"{base_url}/img/{post_id}.jpg",
                                             crosspost_parent_list=[{"subreddit": CROSSPOST_SUBREDDIT}],
                                             **planted_post_fields(post_index, transform_name)))
        expected_list.append({"platformPostId": post_id, "expectedAssetId": int(asset_id), "transform": transform_name})
    return listing_children, expected_list


def write_negative_images(output_directory: Path, base_url: str, created_utc: int) -> tuple[list[dict], list[dict]]:
    listing_children, expected_list = [], []
    for image_index in range(NEGATIVE_IMAGE_COUNT):
        post_id = f"negative{image_index + 1}"
        synthetic_negative_image(image_index).save(output_directory / "img" / f"{post_id}.jpg", format="JPEG", quality=90)
        listing_children.append(listing_post(post_id, created_utc - image_index * 60, post_hint="image", url=f"{base_url}/img/{post_id}.jpg"))
        expected_list.append({"platformPostId": post_id, "expectedAssetId": None, "transform": "synthetic"})
    return listing_children, expected_list


def main() -> None:
    argument_parser = argparse.ArgumentParser()
    argument_parser.add_argument("--out", type=Path, default=Path("/fixtures"))
    argument_parser.add_argument("--subreddit", default="repostradar_fixture")
    argument_parser.add_argument("--base-url", default="http://fake-reddit:8090")
    argument_parser.add_argument("--copies", type=int, default=DEFAULT_COPY_COUNT,
                                 help="edited copies to plant, one per fingerprinted original (the phase 2 gate expects 5)")
    parsed_arguments = argument_parser.parse_args()

    (parsed_arguments.out / "img").mkdir(parents=True, exist_ok=True)
    now_utc = int(time.time())
    planted_children, planted_expected = write_planted_images(parsed_arguments.out, parsed_arguments.base_url, now_utc - 60,
                                                              parsed_arguments.copies)
    negative_children, negative_expected = write_negative_images(parsed_arguments.out, parsed_arguments.base_url, now_utc - 600)
    skipped_children = [
        listing_post("textpost1", now_utc - 30, is_self=True),
        listing_post("videopost1", now_utc - 45, is_video=True, url="https://v.redd.it/fixture"),
    ]
    listing_directory = parsed_arguments.out / "r" / parsed_arguments.subreddit
    listing_directory.mkdir(parents=True, exist_ok=True)
    listing_children = sorted(skipped_children + planted_children + negative_children, key=lambda child: -child["data"]["created_utc"])
    place_in_subreddit(listing_children, parsed_arguments.subreddit)
    (listing_directory / "new.json").write_text(json.dumps({"kind": "Listing", "data": {"children": listing_children, "after": None}}))
    (parsed_arguments.out / "expected.json").write_text(json.dumps(planted_expected + negative_expected, indent=2))
    print(f"Wrote {len(listing_children)} posts for r/{parsed_arguments.subreddit} ({len(planted_expected)} planted, {len(negative_expected)} negatives)")


if __name__ == "__main__":
    main()
