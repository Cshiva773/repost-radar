import boto3

from fingerprint_worker.config import ObjectStorageConfigDetails


class ObjectStorage:
    def __init__(self, object_storage_config: ObjectStorageConfigDetails) -> None:
        self._bucket_name = object_storage_config.bucket_name
        self._s3_client = boto3.client(
            "s3",
            endpoint_url=object_storage_config.endpoint,
            aws_access_key_id=object_storage_config.access_key,
            aws_secret_access_key=object_storage_config.secret_key,
            region_name=object_storage_config.region,
        )

    def read_object(self, storage_key: str) -> bytes:
        object_response = self._s3_client.get_object(Bucket=self._bucket_name, Key=storage_key)
        return object_response["Body"].read()

    def write_object(self, storage_key: str, object_bytes: bytes, content_type: str) -> None:
        self._s3_client.put_object(Bucket=self._bucket_name, Key=storage_key, Body=object_bytes, ContentType=content_type)
