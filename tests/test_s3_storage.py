import io
import pytest
from botocore.exceptions import ClientError
from web.storage.s3 import S3Storage


class FakeS3:
    """Minimal in-memory stand-in for a boto3 S3 client."""
    def __init__(self):
        self.objects = {}                       # (Bucket, Key) -> bytes
        self.calls = []

    def put_object(self, Bucket, Key, Body):
        self.calls.append(("put_object", Bucket, Key))
        self.objects[(Bucket, Key)] = Body if isinstance(Body, bytes) else Body.read()

    def upload_file(self, Filename, Bucket, Key):
        self.calls.append(("upload_file", Bucket, Key))
        with open(Filename, "rb") as f:
            self.objects[(Bucket, Key)] = f.read()

    def get_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}

    def download_file(self, Bucket, Key, Filename):
        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        with open(Filename, "wb") as f:
            f.write(self.objects[(Bucket, Key)])

    def head_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {}

    def delete_object(self, Bucket, Key):
        self.calls.append(("delete_object", Bucket, Key))
        self.objects.pop((Bucket, Key), None)

    def delete_objects(self, Bucket, Delete):
        self.calls.append(("delete_objects", Bucket, len(Delete["Objects"])))
        for o in Delete["Objects"]:
            self.objects.pop((Bucket, o["Key"]), None)

    def get_paginator(self, op):
        client = self
        class _P:
            def paginate(self, Bucket, Prefix):
                keys = sorted(k for (b, k) in client.objects if b == Bucket and k.startswith(Prefix))
                yield {"Contents": [{"Key": k} for k in keys]} if keys else {}
        return _P()


@pytest.fixture
def store():
    return S3Storage(FakeS3(), "bkt")


def test_put_get_bytes(store):
    store.put_bytes("a/b.txt", b"hi")
    assert store.get_bytes("a/b.txt") == b"hi"


def test_put_get_file(store, tmp_path):
    src = tmp_path / "s"; src.write_bytes(b"xyz")
    store.put_file("k.bin", src)
    dest = tmp_path / "d" / "k.bin"
    store.get_file("k.bin", dest)
    assert dest.read_bytes() == b"xyz"


def test_get_missing_raises_keyerror(store):
    with pytest.raises(KeyError):
        store.get_bytes("missing")
    with pytest.raises(KeyError):
        store.get_file("missing", "/tmp/whatever")


def test_exists(store):
    store.put_bytes("k", b"x")
    assert store.exists("k") is True
    assert store.exists("nope") is False


def test_list_paginated_prefix(store):
    store.put_bytes("p/a", b"1"); store.put_bytes("p/b", b"1"); store.put_bytes("q/c", b"1")
    assert store.list("p/") == ["p/a", "p/b"]


def test_delete_and_delete_prefix(store):
    store.put_bytes("p/a", b"1"); store.put_bytes("p/b", b"1"); store.put_bytes("q/c", b"1")
    store.delete("p/a")
    assert store.exists("p/a") is False
    store.delete_prefix("p/")
    assert store.list("p/") == []
    assert store.list("q/") == ["q/c"]
