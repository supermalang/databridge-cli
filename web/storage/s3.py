"""S3/Minio-backed Storage via a boto3 client. get_* map missing keys to KeyError."""
from datetime import datetime
from pathlib import Path
from typing import List

from botocore.exceptions import ClientError

from web.storage.base import Storage

_MISSING_CODES = {"NoSuchKey", "404", "NoSuchBucket"}


def _is_missing(err: ClientError) -> bool:
    return err.response.get("Error", {}).get("Code") in _MISSING_CODES


class S3Storage(Storage):
    def __init__(self, client, bucket: str):
        self.client = client
        self.bucket = bucket

    def put_bytes(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data)

    def put_file(self, key: str, local_path) -> None:
        self.client.upload_file(Filename=str(local_path), Bucket=self.bucket, Key=key)

    def get_bytes(self, key: str) -> bytes:
        try:
            resp = self.client.get_object(Bucket=self.bucket, Key=key)
        except ClientError as e:
            if _is_missing(e):
                raise KeyError(key) from e
            raise
        return resp["Body"].read()

    def get_file(self, key: str, dest_path) -> None:
        dest = Path(dest_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.client.download_file(Bucket=self.bucket, Key=key, Filename=str(dest))
        except ClientError as e:
            if _is_missing(e):
                raise KeyError(key) from e
            raise

    def last_modified(self, key: str) -> datetime:
        try:
            resp = self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as e:
            if _is_missing(e):
                raise KeyError(key) from e
            raise
        lm = resp["LastModified"]
        # Normalize the tz-aware UTC LastModified to a naive local datetime so the
        # rendered "modified" string matches the local backend (datetime.fromtimestamp).
        if lm.tzinfo is not None:
            lm = datetime.fromtimestamp(lm.timestamp())
        return lm

    def list(self, prefix: str) -> List[str]:
        keys: List[str] = []
        for page in self.client.get_paginator("list_objects_v2").paginate(
                Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                keys.append(obj["Key"])
        return sorted(keys)

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as e:
            if _is_missing(e):
                return False
            raise

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def delete_prefix(self, prefix: str) -> None:
        keys = self.list(prefix)
        for i in range(0, len(keys), 1000):
            batch = keys[i:i + 1000]
            self.client.delete_objects(
                Bucket=self.bucket, Delete={"Objects": [{"Key": k} for k in batch]})
