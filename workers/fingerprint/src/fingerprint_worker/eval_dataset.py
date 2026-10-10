"""Phase 3 dataset: download the CC0 images in eval/manifest.json (cached) and describe every probe.

Positive probes = each original x each of the 8 transforms. Negative probes = the unrelated
same-theme photos, used as-is. Probes are generated in memory at fingerprint time, not stored.
"""

import json
import logging
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from fingerprint_worker.transforms import TRANSFORM_BY_NAME

logger = logging.getLogger("eval.dataset")

USER_AGENT = "repost-radar/0.1 (https://github.com/Cshiva773/repost-radar; evaluation set download)"
DOWNLOAD_WORKERS = 4
DOWNLOAD_ATTEMPTS = 3


@dataclass(frozen=True)
class EvalImageDetails:
    eval_id: str
    theme: str
    download_url: str
    image_path: Path


@dataclass(frozen=True)
class ProbeDetails:
    probe_id: str
    source_eval_id: str
    transform: str          # transform name, or "negative"
    truth_eval_id: str | None


def load_manifest(manifest_path: Path, image_directory: Path, limit_originals: int | None, limit_negatives: int | None):
    manifest_details = json.loads(manifest_path.read_text(encoding="utf-8"))

    def to_images(entry_list):
        return [EvalImageDetails(entry["evalId"], entry["theme"], entry["downloadUrl"], image_directory / f"{entry['evalId']}.jpg") for entry in entry_list]

    return to_images(manifest_details["originals"][:limit_originals]), to_images(manifest_details["negatives"][:limit_negatives])


def _download_one(eval_image: EvalImageDetails) -> bool:
    if eval_image.image_path.exists() and eval_image.image_path.stat().st_size > 0:
        return True
    for attempt_number in range(DOWNLOAD_ATTEMPTS):
        try:
            request = urllib.request.Request(eval_image.download_url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=30) as response:
                eval_image.image_path.write_bytes(response.read())
            return True
        except Exception as download_error:  # network errors, HTTP 429/5xx
            logger.warning("download %s attempt %d failed: %s", eval_image.eval_id, attempt_number + 1, download_error)
            time.sleep(2 ** attempt_number)
    return False


def download_images(eval_image_list: list[EvalImageDetails]) -> list[EvalImageDetails]:
    """Downloads missing images; returns only those available on disk."""
    if eval_image_list:
        eval_image_list[0].image_path.parent.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as executor:
        is_available_list = list(executor.map(_download_one, eval_image_list))
    missing_count = is_available_list.count(False)
    if missing_count:
        logger.warning("%d of %d images could not be downloaded and are excluded", missing_count, len(eval_image_list))
    return [eval_image for eval_image, is_available in zip(eval_image_list, is_available_list) if is_available]


def build_probes(original_list: list[EvalImageDetails], negative_list: list[EvalImageDetails]) -> list[ProbeDetails]:
    positive_probe_list = [
        ProbeDetails(f"{original.eval_id}__{transform_name}", original.eval_id, transform_name, original.eval_id)
        for original in original_list for transform_name in TRANSFORM_BY_NAME
    ]
    negative_probe_list = [ProbeDetails(negative.eval_id, negative.eval_id, "negative", None) for negative in negative_list]
    return positive_probe_list + negative_probe_list


def write_labels(probe_list: list[ProbeDetails], labels_path: Path) -> None:
    labels_path.parent.mkdir(parents=True, exist_ok=True)
    label_lines = ["probe_id,source_eval_id,transform,is_match,truth_eval_id"]
    label_lines += [f"{probe.probe_id},{probe.source_eval_id},{probe.transform},{int(probe.truth_eval_id is not None)},{probe.truth_eval_id or ''}"
                    for probe in probe_list]
    labels_path.write_text("\n".join(label_lines) + "\n", encoding="utf-8")
