"""Phase 2 gate check: after the crawler polls the fake listing, every planted copy must be a
`pending` candidate for its own original, and nothing else (negatives, wrong assets) may be pending."""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import psycopg

from fingerprint_worker.config import load_database_url

POLL_SECONDS = 3


def wait_for_matching(connection: psycopg.Connection, platform_post_id_list: list[str], timeout_seconds: int) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        matched_count = connection.execute(
            "SELECT count(*) FROM crawled_posts WHERE platform_post_id = ANY(%s) AND embedding IS NOT NULL",
            (platform_post_id_list,),
        ).fetchone()[0]
        print(f"  {matched_count}/{len(platform_post_id_list)} fixture images crawled and matched")
        if matched_count == len(platform_post_id_list):
            return True
        time.sleep(POLL_SECONDS)
    return False


def pending_asset_ids(connection: psycopg.Connection, platform_post_id: str) -> list[tuple[int, float]]:
    return connection.execute(
        """SELECT c.asset_id, c.confidence FROM candidates c JOIN crawled_posts cp ON cp.id = c.crawled_post_id
           WHERE cp.platform_post_id = %s AND c.status = 'pending' ORDER BY c.confidence DESC""",
        (platform_post_id,),
    ).fetchall()


def evaluate(connection: psycopg.Connection, expected_list: list[dict]) -> list[tuple[str, bool]]:
    result_list = []
    for expected in expected_list:
        pending_list = pending_asset_ids(connection, expected["platformPostId"])
        pending_ids = [int(asset_id) for asset_id, _ in pending_list]
        expected_asset_id = expected["expectedAssetId"]
        if expected_asset_id is None:
            is_passing = not pending_ids
        else:
            is_passing = pending_ids == [expected_asset_id]
        scores = ", ".join(f"asset {asset_id}: {confidence:.3f}" for asset_id, confidence in pending_list) or "no pending candidate"
        result_list.append((f"{expected['platformPostId']} ({expected['transform']}) expected {expected_asset_id} -> {scores}", is_passing))
    return result_list


def main() -> int:
    argument_parser = argparse.ArgumentParser()
    argument_parser.add_argument("--fixtures", type=Path, default=Path("/fixtures"))
    argument_parser.add_argument("--timeout", type=int, default=90)
    parsed_arguments = argument_parser.parse_args()
    expected_list = json.loads((parsed_arguments.fixtures / "expected.json").read_text())

    with psycopg.connect(load_database_url(os.environ), autocommit=True) as connection:
        print("Waiting for the crawler and matcher:")
        is_complete = wait_for_matching(connection, [expected["platformPostId"] for expected in expected_list], parsed_arguments.timeout)
        skipped_count = connection.execute(
            "SELECT count(*) FROM crawled_posts WHERE platform_post_id IN ('textpost1', 'videopost1')").fetchone()[0]
        result_list = evaluate(connection, expected_list)

    result_list.append((f"all fixture images matched within {parsed_arguments.timeout}s", is_complete))
    result_list.append((f"text and video posts skipped ({skipped_count} stored)", skipped_count == 0))
    print()
    for description, is_passing in result_list:
        print(f"{'PASS' if is_passing else 'FAIL'}  {description}")
    return 0 if all(is_passing for _, is_passing in result_list) else 1


if __name__ == "__main__":
    sys.exit(main())
