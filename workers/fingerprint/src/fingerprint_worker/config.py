from dataclasses import dataclass
from typing import Mapping

DEFAULT_LOG_LEVEL = "INFO"
DEFAULT_S3_REGION = "us-east-1"


@dataclass(frozen=True)
class WorkerConfigDetails:
    redis_url: str
    log_level: str


@dataclass(frozen=True)
class ObjectStorageConfigDetails:
    endpoint: str
    access_key: str
    secret_key: str
    bucket_name: str
    region: str


def _read_required(environment_details: Mapping[str, str], variable_name: str) -> str:
    variable_value = environment_details.get(variable_name)
    if not variable_value:
        raise ValueError(f"{variable_name} is not set")
    return variable_value


def load_worker_config(environment_details: Mapping[str, str]) -> WorkerConfigDetails:
    redis_url = _read_required(environment_details, "REDIS_URL")
    log_level = environment_details.get("LOG_LEVEL", DEFAULT_LOG_LEVEL).upper()
    return WorkerConfigDetails(redis_url=redis_url, log_level=log_level)


def load_database_url(environment_details: Mapping[str, str]) -> str:
    return _read_required(environment_details, "DATABASE_URL")


def load_object_storage_config(environment_details: Mapping[str, str]) -> ObjectStorageConfigDetails:
    return ObjectStorageConfigDetails(
        endpoint=_read_required(environment_details, "S3_ENDPOINT"),
        access_key=_read_required(environment_details, "S3_ACCESS_KEY"),
        secret_key=_read_required(environment_details, "S3_SECRET_KEY"),
        bucket_name=_read_required(environment_details, "S3_BUCKET"),
        region=environment_details.get("S3_REGION", DEFAULT_S3_REGION),
    )
