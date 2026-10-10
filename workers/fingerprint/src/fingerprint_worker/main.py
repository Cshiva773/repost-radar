"""BullMQ consumer on the `fingerprint` queue: `ping` jobs are logged, `fingerprint` jobs
compute and store the three fingerprints for one asset."""

import asyncio
import json
import logging
import os
import signal

import psycopg
from bullmq import Worker

from fingerprint_worker.config import load_database_url, load_object_storage_config, load_worker_config
from fingerprint_worker.database import find_asset_storage_key, save_asset_fingerprints
from fingerprint_worker.fingerprinting import Fingerprinter
from fingerprint_worker.storage import ObjectStorage

FINGERPRINT_QUEUE_NAME = "fingerprint"
SHUTDOWN_SIGNAL_LIST = (signal.SIGINT, signal.SIGTERM)

logger = logging.getLogger("fingerprint-worker")


def log_event(message: str, **event_fields) -> None:
    logger.info(json.dumps({"msg": message, **event_fields}))


class FingerprintJobHandler:
    def __init__(self) -> None:
        self._fingerprinter = Fingerprinter()
        self._object_storage = ObjectStorage(load_object_storage_config(os.environ))
        self._database_url = load_database_url(os.environ)

    def fingerprint_asset(self, asset_id: int) -> dict:
        # A connection per job: cheap at this volume, and a dropped connection can't wedge the worker
        with psycopg.connect(self._database_url) as connection:
            storage_key = find_asset_storage_key(connection, asset_id)
            if storage_key is None:
                raise ValueError(f"asset {asset_id} not found")
            fingerprint_details = self._fingerprinter.fingerprint(self._object_storage.read_object(storage_key))
            if not save_asset_fingerprints(connection, asset_id, fingerprint_details):
                raise RuntimeError(f"could not save fingerprints for asset {asset_id}")
        return {"assetId": asset_id, "pdqQuality": fingerprint_details.pdq_quality}

    async def process_job(self, job, job_token):
        log_event("Step 2: job received", queue=FINGERPRINT_QUEUE_NAME, jobName=job.name, jobId=job.id, jobData=job.data)
        if job.name == "ping":
            return {"status": "logged"}
        # CPU-bound: run off the event loop so BullMQ can keep renewing the job lock
        job_result = await asyncio.to_thread(self.fingerprint_asset, int(job.data["assetId"]))
        log_event("Step 3: asset fingerprinted", **job_result)
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
    job_handler = FingerprintJobHandler()
    worker = Worker(FINGERPRINT_QUEUE_NAME, job_handler.process_job, {"connection": worker_config.redis_url})
    log_event("Step 1: worker listening", queue=FINGERPRINT_QUEUE_NAME)
    await shutdown_event.wait()

    log_event("Step 4: shutting down worker")
    await worker.close()


if __name__ == "__main__":
    asyncio.run(run_worker())
