"""BullMQ consumers sharing one CLIP model:

- `fingerprint` queue: `ping` jobs are logged; `fingerprint` jobs store the three fingerprints of an original
- `match` queue: fingerprint a crawled image, search the creator's bank, write scored candidates
- `evidence` queue: build the evidence pack and notice for an approved candidate (no model needed)
"""

import asyncio
import json
import logging
import os
import signal

import psycopg
from bullmq import Worker

from fingerprint_worker.config import load_database_url, load_object_storage_config, load_worker_config
from fingerprint_worker.database import (
    find_asset_creator_id, find_asset_storage_key, find_crawled_post, insert_candidates, save_asset_fingerprints,
    save_crawled_fingerprints, search_bank, search_crawled_images,
)
from fingerprint_worker.evidence_job import EvidenceJobHandler
from fingerprint_worker.fingerprinting import Fingerprinter
from fingerprint_worker.matching import build_candidates, candidates_for_new_original, load_match_thresholds, rank_check_matches
from fingerprint_worker.storage import ObjectStorage

FINGERPRINT_QUEUE_NAME = "fingerprint"
MATCH_QUEUE_NAME = "match"
EVIDENCE_QUEUE_NAME = "evidence"
SHUTDOWN_SIGNAL_LIST = (signal.SIGINT, signal.SIGTERM)

logger = logging.getLogger("fingerprint-worker")


def log_event(message: str, **event_fields) -> None:
    logger.info(json.dumps({"msg": message, **event_fields}))


class VisionJobHandler:
    def __init__(self) -> None:
        self._fingerprinter = Fingerprinter()
        self._object_storage = ObjectStorage(load_object_storage_config(os.environ))
        self._database_url = load_database_url(os.environ)
        self._match_thresholds = load_match_thresholds(os.environ)
        # One model, two queues: serialise inference so the two workers never run CLIP concurrently
        self._model_lock = asyncio.Lock()
        self._evidence_handler = EvidenceJobHandler(self._object_storage, self._database_url)

    def fingerprint_asset(self, asset_id: int) -> dict:
        # A connection per job: cheap at this volume, and a dropped connection can't wedge the worker
        with psycopg.connect(self._database_url) as connection:
            storage_key = find_asset_storage_key(connection, asset_id)
            if storage_key is None:
                raise ValueError(f"asset {asset_id} not found")
            fingerprint_details = self._fingerprinter.fingerprint(self._object_storage.read_object(storage_key))
            if not save_asset_fingerprints(connection, asset_id, fingerprint_details):
                raise RuntimeError(f"could not save fingerprints for asset {asset_id}")
            matched_post_count = self.match_held_crawled_images(connection, asset_id, fingerprint_details)
        return {"assetId": asset_id, "pdqQuality": fingerprint_details.pdq_quality, "heldImagesMatched": matched_post_count}

    def match_held_crawled_images(self, connection: psycopg.Connection, asset_id: int, fingerprint_details) -> int:
        """A new original is also compared with crawled images already held (up to the retention window), so a copy
        crawled before the original was uploaded is still found. Idempotent: candidates are unique per pair."""
        creator_id = find_asset_creator_id(connection, asset_id)
        if creator_id is None:
            return 0
        crawled_match_list = search_crawled_images(connection, creator_id, fingerprint_details)
        crawled_candidate_list = candidates_for_new_original(asset_id, crawled_match_list, self._match_thresholds)
        for crawled_post_id, candidate_list in crawled_candidate_list:
            insert_candidates(connection, crawled_post_id, candidate_list)
        return len(crawled_candidate_list)

    def match_crawled_post(self, crawled_post_id: int) -> dict:
        with psycopg.connect(self._database_url) as connection:
            crawled_post = find_crawled_post(connection, crawled_post_id)
            if crawled_post is None:
                raise ValueError(f"crawled post {crawled_post_id} not found")
            if crawled_post.is_legitimate:
                return {"crawledPostId": crawled_post_id, "skipped": "legitimate"}
            fingerprint_details = self._fingerprinter.fingerprint(self._object_storage.read_object(crawled_post.storage_key))
            if not save_crawled_fingerprints(connection, crawled_post_id, fingerprint_details):
                raise RuntimeError(f"could not save fingerprints for crawled post {crawled_post_id}")
            candidate_list = build_candidates(search_bank(connection, crawled_post.creator_id, fingerprint_details), self._match_thresholds)
            inserted_count = insert_candidates(connection, crawled_post_id, candidate_list)
        return {
            "crawledPostId": crawled_post_id,
            "candidatesInserted": inserted_count,
            "pendingAssetIds": [candidate.asset_id for candidate in candidate_list if candidate.status == "pending"],
        }

    def check_image(self, storage_key: str, creator_id: int) -> dict:
        """On-demand check from the browser extension: nothing is stored, the API deletes the image afterwards."""
        fingerprint_details = self._fingerprinter.fingerprint(self._object_storage.read_object(storage_key))
        with psycopg.connect(self._database_url) as connection:
            match_list = search_bank(connection, creator_id, fingerprint_details)
        return {"matchList": rank_check_matches(match_list, self._match_thresholds), "reviewThreshold": self._match_thresholds.review_threshold}

    async def process_fingerprint_job(self, job, job_token):
        log_event("Step 2: job received", queue=FINGERPRINT_QUEUE_NAME, jobName=job.name, jobId=job.id)
        if job.name == "ping":
            return {"status": "logged"}
        if job.name == "check":
            async with self._model_lock:
                return await asyncio.to_thread(self.check_image, str(job.data["storageKey"]), int(job.data["creatorId"]))
        async with self._model_lock:
            # CPU-bound: run off the event loop so BullMQ can keep renewing the job lock
            job_result = await asyncio.to_thread(self.fingerprint_asset, int(job.data["assetId"]))
        log_event("Step 3: asset fingerprinted", **job_result)
        return job_result

    async def process_match_job(self, job, job_token):
        async with self._model_lock:
            job_result = await asyncio.to_thread(self.match_crawled_post, int(job.data["crawledPostId"]))
        log_event("Step 3: crawled post matched", **job_result)
        return job_result

    async def process_evidence_job(self, job, job_token):
        # Pillow and fpdf only: no model lock, so packs are not held up behind CLIP inference
        job_result = await asyncio.to_thread(self._evidence_handler.build_pack, int(job.data["candidateId"]))
        log_event("Step 3: evidence job finished", **job_result)
        return job_result


def register_shutdown_handlers(shutdown_event: asyncio.Event) -> None:
    event_loop = asyncio.get_running_loop()
    for shutdown_signal in SHUTDOWN_SIGNAL_LIST:
        try:
            event_loop.add_signal_handler(shutdown_signal, shutdown_event.set)
        except NotImplementedError:
            pass  # Windows event loops have no signal handlers; Ctrl+C still raises KeyboardInterrupt


async def run_worker() -> None:
    worker_config = load_worker_config(os.environ)
    logging.basicConfig(level=worker_config.log_level, format="%(message)s")
    shutdown_event = asyncio.Event()
    register_shutdown_handlers(shutdown_event)

    log_event("Step 1: loading CLIP model")
    job_handler = VisionJobHandler()
    worker_options = {"connection": worker_config.redis_url}
    worker_list = [
        Worker(FINGERPRINT_QUEUE_NAME, job_handler.process_fingerprint_job, worker_options),
        Worker(MATCH_QUEUE_NAME, job_handler.process_match_job, worker_options),
        Worker(EVIDENCE_QUEUE_NAME, job_handler.process_evidence_job, worker_options),
    ]
    log_event("Step 1: worker listening", queues=[FINGERPRINT_QUEUE_NAME, MATCH_QUEUE_NAME, EVIDENCE_QUEUE_NAME])
    await shutdown_event.wait()

    log_event("Step 4: shutting down worker")
    for worker in worker_list:
        await worker.close()


if __name__ == "__main__":
    asyncio.run(run_worker())
