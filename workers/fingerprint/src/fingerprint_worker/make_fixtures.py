"""Builds a fake Reddit listing for the phase 2 gate (served by the `fake-reddit` compose service).

Plants transformed copies of seeded originals, a few synthetic images that must NOT match,
and one text + one video post the crawler must skip. Writes `expected.json` with the answer key.
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
PLANTED_TRANSFORM_LIST = ["resize_50", "jpeg_q40", "filter_warm", "resize_50", "jpeg_q40"]
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


def write_planted_images(output_directory: Path, base_url: str, created_utc: int) -> tuple[list[dict], list[dict]]:
    object_storage = ObjectStorage(load_object_storage_config(os.environ))
    with psycopg.connect(load_database_url(os.environ)) as connection:
        asset_rows = connection.execute(
            "SELECT id, storage_key FROM assets WHERE fingerprinted_at IS NOT NULL ORDER BY id LIMIT %s",
            (len(PLANTED_TRANSFORM_LIST),),
        ).fetchall()
    listing_children, expected_list = [], []
    for post_index, ((asset_id, storage_key), transform_name) in enumerate(zip(asset_rows, PLANTED_TRANSFORM_LIST)):
        post_id = f"planted{post_index + 1}"
        rgb_original = normalise_image(object_storage.read_object(storage_key))
        (output_directory / "img" / f"{post_id}.jpg").write_bytes(apply_transform(transform_name, rgb_original))
        # Every planted copy was also crossposted from one other subreddit, which the API should then suggest watching
        listing_children.append(listing_post(post_id, created_utc - post_index * 60, post_hint="image", url=f"{base_url}/img/{post_id}.jpg",
                                             crosspost_parent_list=[{"subreddit": CROSSPOST_SUBREDDIT}]))
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
    parsed_arguments = argument_parser.parse_args()

    (parsed_arguments.out / "img").mkdir(parents=True, exist_ok=True)
    now_utc = int(time.time())
    planted_children, planted_expected = write_planted_images(parsed_arguments.out, parsed_arguments.base_url, now_utc - 60)
    negative_children, negative_expected = write_negative_images(parsed_arguments.out, parsed_arguments.base_url, now_utc - 600)
    skipped_children = [
        listing_post("textpost1", now_utc - 30, is_self=True),
        listing_post("videopost1", now_utc - 45, is_video=True, url="https://v.redd.it/fixture"),
    ]
    listing_directory = parsed_arguments.out / "r" / parsed_arguments.subreddit
    listing_directory.mkdir(parents=True, exist_ok=True)
    listing_children = sorted(skipped_children + planted_children + negative_children, key=lambda child: -child["data"]["created_utc"])
    (listing_directory / "new.json").write_text(json.dumps({"kind": "Listing", "data": {"children": listing_children, "after": None}}))
    (parsed_arguments.out / "expected.json").write_text(json.dumps(planted_expected + negative_expected, indent=2))
    print(f"Wrote {len(listing_children)} posts for r/{parsed_arguments.subreddit} ({len(planted_expected)} planted, {len(negative_expected)} negatives)")


if __name__ == "__main__":
    main()
