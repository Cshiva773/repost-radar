"""Phase 0: a BullMQ consumer on the `fingerprint` queue that logs every job it receives."""

import asyncio
import json
import logging
import os
import signal

from bullmq import Worker

from fingerprint_worker.config import load_worker_config

FINGERPRINT_QUEUE_NAME = "fingerprint"
SHUTDOWN_SIGNAL_LIST = (signal.SIGINT, signal.SIGTERM)

logger = logging.getLogger("fingerprint-worker")


async def process_job(job, job_token):
    logger.info(json.dumps({
        "msg": "Step 2: job received",
        "queue": FINGERPRINT_QUEUE_NAME,
        "jobName": job.name,
        "jobId": job.id,
        "jobData": job.data,
    }))
    return {"status": "logged"}


def register_shutdown_handlers(shutdown_event: asyncio.Event) -> None:
    event_loop = asyncio.get_running_loop()
    for shutdown_signal in SHUTDOWN_SIGNAL_LIST:
        try:
            event_loop.add_signal_handler(shutdown_signal, shutdown_event.set)
        except NotImplementedError:
            # Windows event loops do not support signal handlers; Ctrl+C still raises KeyboardInterrupt
            pass


async def run_worker() -> None:
    worker_config = load_worker_config(os.environ)
    logging.basicConfig(level=worker_config.log_level, format="%(message)s")
    shutdown_event = asyncio.Event()
    register_shutdown_handlers(shutdown_event)

    worker = Worker(FINGERPRINT_QUEUE_NAME, process_job, {"connection": worker_config.redis_url})
    logger.info(json.dumps({"msg": "Step 1: worker listening", "queue": FINGERPRINT_QUEUE_NAME}))
    await shutdown_event.wait()

    logger.info(json.dumps({"msg": "Step 3: shutting down worker"}))
    await worker.close()


if __name__ == "__main__":
    asyncio.run(run_worker())
