from dataclasses import dataclass
from typing import Mapping

DEFAULT_LOG_LEVEL = "INFO"


@dataclass(frozen=True)
class WorkerConfigDetails:
    redis_url: str
    log_level: str


def load_worker_config(environment_details: Mapping[str, str]) -> WorkerConfigDetails:
    redis_url = environment_details.get("REDIS_URL")
    if not redis_url:
        raise ValueError("REDIS_URL is not set")
    log_level = environment_details.get("LOG_LEVEL", DEFAULT_LOG_LEVEL).upper()
    return WorkerConfigDetails(redis_url=redis_url, log_level=log_level)
