import pytest

from fingerprint_worker.config import load_worker_config


def test_reads_redis_url_and_uppercases_log_level():
    worker_config = load_worker_config({"REDIS_URL": "redis://x:6379", "LOG_LEVEL": "debug"})
    assert worker_config.redis_url == "redis://x:6379"
    assert worker_config.log_level == "DEBUG"


def test_defaults_log_level_to_info():
    assert load_worker_config({"REDIS_URL": "redis://x"}).log_level == "INFO"


def test_raises_when_redis_url_missing():
    with pytest.raises(ValueError, match="REDIS_URL is not set"):
        load_worker_config({})
