"""Lazy, env-driven Storage selection. No silent fallback: real use requires S3_*;
tests opt into the local backend with STORAGE_BACKEND=local."""
import os

from web.storage.base import Storage

_storage = None


def reset_storage() -> None:
    global _storage
    _storage = None


def get_storage() -> Storage:
    global _storage
    if _storage is not None:
        return _storage
    if os.environ.get("STORAGE_BACKEND") == "local":
        from web.storage.local import LocalStorage
        local_dir = os.environ.get("STORAGE_LOCAL_DIR")
        if not local_dir:
            raise RuntimeError("STORAGE_BACKEND=local requires STORAGE_LOCAL_DIR to be set")
        _storage = LocalStorage(local_dir)
        return _storage
    needed = ("S3_ENDPOINT_URL", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET")
    if all(os.environ.get(k) for k in needed):
        import boto3
        from web.storage.s3 import S3Storage
        client = boto3.client(
            "s3",
            endpoint_url=os.environ["S3_ENDPOINT_URL"],
            aws_access_key_id=os.environ["S3_ACCESS_KEY"],
            aws_secret_access_key=os.environ["S3_SECRET_KEY"],
            region_name=os.environ.get("S3_REGION", "us-east-1"),
        )
        _storage = S3Storage(client, os.environ["S3_BUCKET"])
        return _storage
    raise RuntimeError("storage not configured: set S3_* env or STORAGE_BACKEND=local")
