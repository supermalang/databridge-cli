# Storage Foundation (Minio/S3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-contained `web/storage/` package — a `Storage` interface with an S3/Minio backend (real use) and a local-filesystem backend (tests), per-project key helper, and a lazy env-driven factory — with NO run-path/DB/UI wiring.

**Architecture:** Mirrors `web/db/session.py`'s lazy, env-driven, test-resettable shape. `base.py` defines the `Storage` ABC + a pure `storage_key()` builder (no `web.db` import). `local.py`/`s3.py` implement the interface identically; `factory.py` selects the backend from env (`STORAGE_BACKEND=local` for tests, else `S3_*`, else raise). Tests run against `LocalStorage`; `S3Storage` is tested with a mocked boto3 client.

**Tech Stack:** boto3, Python stdlib (pathlib/shutil), pytest.

Spec: [docs/superpowers/specs/2026-06-02-storage-foundation-design.md](../specs/2026-06-02-storage-foundation-design.md)

---

## File Structure

- **Create** `web/storage/__init__.py` — package marker.
- **Create** `web/storage/base.py` — `Storage` ABC, `storage_key()`, `CATEGORIES`.
- **Create** `web/storage/local.py` — `LocalStorage(base_dir)`.
- **Create** `web/storage/s3.py` — `S3Storage(client, bucket)`.
- **Create** `web/storage/factory.py` — `get_storage()`, `reset_storage()`.
- **Modify** `requirements.txt` — add `boto3`.
- **Modify** `.env.example` — add `S3_*` vars.
- **Modify** `tests/conftest.py` — session fixture setting `STORAGE_BACKEND=local` + temp dir.
- **Create** `tests/test_storage_key.py`, `tests/test_local_storage.py`, `tests/test_storage_factory.py`, `tests/test_s3_storage.py`.

**Interface contract (used across tasks):** every backend implements `put_bytes(key, data)`, `put_file(key, local_path)`, `get_bytes(key)->bytes`, `get_file(key, dest_path)`, `list(prefix)->list[str]`, `exists(key)->bool`, `delete(key)`, `delete_prefix(prefix)`. `get_bytes`/`get_file` raise `KeyError` for a missing key. `storage_key(org_id, project_id, category, name)` → `"orgs/{org_id}/projects/{project_id}/{category}/{name}"`.

---

## Task 1: Dependencies and env

**Files:** Modify `requirements.txt`, `.env.example`

- [ ] **Step 1: Add boto3**

In `requirements.txt`, after the `alembic>=1.13.0` line (added in Slice 2), add:
```
# Object storage (Minio/S3)
boto3>=1.34.0
```

- [ ] **Step 2: Install**

Run: `pip install -r requirements.txt`
Expected: installs `boto3` (+ botocore/s3transfer); no errors.

- [ ] **Step 3: Add S3 env to `.env.example`**

After the `DATABASE_URL=...` block (added in Slice 2), add:
```
# Object storage (Minio/S3). Required. Example local Minio:
#   docker run --rm -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=minio \
#     -e MINIO_ROOT_PASSWORD=minio12345 minio/minio server /data --console-address ":9001"
S3_ENDPOINT_URL=http://localhost:9000
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio12345
S3_BUCKET=databridge
S3_REGION=us-east-1
```

- [ ] **Step 4: Commit**

```bash
git add requirements.txt .env.example
git commit -m "chore(storage): add boto3 dep and S3_* env"
```

---

## Task 2: base.py — Storage interface + key helper

**Files:** Create `web/storage/__init__.py`, `web/storage/base.py`; Test `tests/test_storage_key.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_storage_key.py`:
```python
from web.storage.base import storage_key, CATEGORIES, Storage


def test_storage_key_layout():
    assert storage_key("org1", "proj1", "reports", "r.docx") == \
        "orgs/org1/projects/proj1/reports/r.docx"


def test_storage_key_preserves_nested_name():
    assert storage_key("o", "p", "charts", "sub/c.png") == \
        "orgs/o/projects/p/charts/sub/c.png"


def test_categories_present():
    assert {"raw", "processed", "charts", "reports", "templates"} <= set(CATEGORIES)


def test_storage_is_abstract():
    import pytest
    with pytest.raises(TypeError):
        Storage()        # abstract — cannot instantiate
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_storage_key.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.storage'`.

- [ ] **Step 3: Implement**

Create `web/storage/__init__.py` (empty).

Create `web/storage/base.py`:
```python
"""Object-storage abstraction: a backend-agnostic interface + per-project key helper.

No web.db import — keys are built from plain string IDs so storage stays decoupled
from the data model."""
from abc import ABC, abstractmethod
from pathlib import Path
from typing import List

CATEGORIES = ("raw", "processed", "charts", "reports", "templates")


def storage_key(org_id: str, project_id: str, category: str, name: str) -> str:
    """Per-project object key: orgs/<org_id>/projects/<project_id>/<category>/<name>.
    `name` may contain '/' for nested paths (e.g. 'charts/foo.png')."""
    return f"orgs/{org_id}/projects/{project_id}/{category}/{name}"


class Storage(ABC):
    """A flat key→bytes object store. get_bytes/get_file raise KeyError if absent."""

    @abstractmethod
    def put_bytes(self, key: str, data: bytes) -> None: ...

    @abstractmethod
    def put_file(self, key: str, local_path) -> None: ...

    @abstractmethod
    def get_bytes(self, key: str) -> bytes: ...

    @abstractmethod
    def get_file(self, key: str, dest_path) -> None: ...

    @abstractmethod
    def list(self, prefix: str) -> List[str]: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def delete_prefix(self, prefix: str) -> None: ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_storage_key.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add web/storage/__init__.py web/storage/base.py tests/test_storage_key.py
git commit -m "feat(storage): Storage interface + per-project key helper"
```

---

## Task 3: LocalStorage backend

**Files:** Create `web/storage/local.py`; Test `tests/test_local_storage.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_local_storage.py`:
```python
import pytest
from web.storage.local import LocalStorage


@pytest.fixture
def store(tmp_path):
    return LocalStorage(tmp_path)


def test_put_get_bytes_roundtrip(store):
    store.put_bytes("orgs/o/projects/p/raw/a.txt", b"hello")
    assert store.get_bytes("orgs/o/projects/p/raw/a.txt") == b"hello"


def test_put_get_file_roundtrip(store, tmp_path):
    src = tmp_path / "src.bin"; src.write_bytes(b"\x00\x01\x02")
    store.put_file("k/deep/x.bin", src)
    dest = tmp_path / "out" / "x.bin"        # parent does not exist yet
    store.get_file("k/deep/x.bin", dest)
    assert dest.read_bytes() == b"\x00\x01\x02"


def test_get_missing_raises_keyerror(store):
    with pytest.raises(KeyError):
        store.get_bytes("nope")
    with pytest.raises(KeyError):
        store.get_file("nope", "/tmp/whatever")


def test_list_returns_scoped_sorted_keys(store):
    store.put_bytes("orgs/o/projects/p/raw/b.txt", b"1")
    store.put_bytes("orgs/o/projects/p/raw/a.txt", b"1")
    store.put_bytes("orgs/o/projects/q/raw/c.txt", b"1")
    assert store.list("orgs/o/projects/p/") == [
        "orgs/o/projects/p/raw/a.txt", "orgs/o/projects/p/raw/b.txt"]


def test_exists(store):
    store.put_bytes("k", b"x")
    assert store.exists("k") is True
    assert store.exists("missing") is False


def test_delete_is_idempotent(store):
    store.put_bytes("k", b"x")
    store.delete("k")
    assert store.exists("k") is False
    store.delete("k")           # no error on absent


def test_delete_prefix_removes_subtree_only(store):
    store.put_bytes("orgs/o/projects/p/raw/a.txt", b"1")
    store.put_bytes("orgs/o/projects/p/reports/r.docx", b"1")
    store.put_bytes("orgs/o/projects/q/raw/c.txt", b"1")
    store.delete_prefix("orgs/o/projects/p/")
    assert store.list("orgs/o/projects/p/") == []
    assert store.list("orgs/o/projects/q/") == ["orgs/o/projects/q/raw/c.txt"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_local_storage.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.storage.local'`.

- [ ] **Step 3: Implement**

Create `web/storage/local.py`:
```python
"""Filesystem-backed Storage — keys map to files under a base directory. For tests
and isolated unit testing."""
import shutil
from pathlib import Path
from typing import List

from web.storage.base import Storage


class LocalStorage(Storage):
    def __init__(self, base_dir):
        self._base = Path(base_dir)

    def _path(self, key: str) -> Path:
        return self._base / key

    def put_bytes(self, key: str, data: bytes) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def put_file(self, key: str, local_path) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local_path, p)

    def get_bytes(self, key: str) -> bytes:
        p = self._path(key)
        if not p.is_file():
            raise KeyError(key)
        return p.read_bytes()

    def get_file(self, key: str, dest_path) -> None:
        p = self._path(key)
        if not p.is_file():
            raise KeyError(key)
        dest = Path(dest_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(p, dest)

    def list(self, prefix: str) -> List[str]:
        keys = []
        for f in self._base.rglob("*"):
            if f.is_file():
                rel = f.relative_to(self._base).as_posix()
                if rel.startswith(prefix):
                    keys.append(rel)
        return sorted(keys)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def delete_prefix(self, prefix: str) -> None:
        for key in self.list(prefix):
            self._path(key).unlink(missing_ok=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_local_storage.py -v`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add web/storage/local.py tests/test_local_storage.py
git commit -m "feat(storage): local-filesystem backend"
```

---

## Task 4: Factory (backend selection)

**Files:** Create `web/storage/factory.py`; Test `tests/test_storage_factory.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_storage_factory.py`:
```python
import pytest
from web.storage import factory
from web.storage.local import LocalStorage


def test_local_backend_selected(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path))
    factory.reset_storage()
    s = factory.get_storage()
    assert isinstance(s, LocalStorage)
    assert factory.get_storage() is s          # singleton
    factory.reset_storage()


def test_unconfigured_raises(monkeypatch):
    for k in ("STORAGE_BACKEND", "S3_ENDPOINT_URL", "S3_ACCESS_KEY",
              "S3_SECRET_KEY", "S3_BUCKET"):
        monkeypatch.delenv(k, raising=False)
    factory.reset_storage()
    with pytest.raises(RuntimeError):
        factory.get_storage()
    factory.reset_storage()


def test_s3_backend_selected(monkeypatch):
    monkeypatch.delenv("STORAGE_BACKEND", raising=False)
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://localhost:9000")
    monkeypatch.setenv("S3_ACCESS_KEY", "ak")
    monkeypatch.setenv("S3_SECRET_KEY", "sk")
    monkeypatch.setenv("S3_BUCKET", "bkt")
    factory.reset_storage()
    from web.storage.s3 import S3Storage
    s = factory.get_storage()
    assert isinstance(s, S3Storage)
    assert s.bucket == "bkt"
    factory.reset_storage()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_storage_factory.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.storage.factory'` (and `web.storage.s3`).

- [ ] **Step 3: Implement**

Create `web/storage/factory.py`:
```python
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
        _storage = LocalStorage(os.environ["STORAGE_LOCAL_DIR"])
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
```

(Task 5 creates `web/storage/s3.py`; this factory imports it lazily, so the `test_local_backend_selected` and `test_unconfigured_raises` tests pass now, and `test_s3_backend_selected` passes once Task 5 lands. Run the full factory test file after Task 5.)

- [ ] **Step 4: Run the local + unconfigured tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_storage_factory.py::test_local_backend_selected tests/test_storage_factory.py::test_unconfigured_raises -v`
Expected: PASS (2 passed). (`test_s3_backend_selected` will error on the `web.storage.s3` import until Task 5 — that's expected; do not run it yet.)

- [ ] **Step 5: Commit**

```bash
git add web/storage/factory.py tests/test_storage_factory.py
git commit -m "feat(storage): lazy env-driven backend factory"
```

---

## Task 5: S3Storage backend (mocked boto3)

**Files:** Create `web/storage/s3.py`; Test `tests/test_s3_storage.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_s3_storage.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_s3_storage.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.storage.s3'`.

- [ ] **Step 3: Implement**

Create `web/storage/s3.py`:
```python
"""S3/Minio-backed Storage via a boto3 client. get_* map missing keys to KeyError."""
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
```

- [ ] **Step 4: Run the S3 + full factory tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_s3_storage.py tests/test_storage_factory.py -v`
Expected: PASS (S3 tests + all 3 factory tests, including `test_s3_backend_selected`).

- [ ] **Step 5: Commit**

```bash
git add web/storage/s3.py tests/test_s3_storage.py
git commit -m "feat(storage): S3/Minio backend (boto3)"
```

---

## Task 6: Test harness fixture + full-suite check

**Files:** Modify `tests/conftest.py`

So future code (3b) that calls `get_storage()` works under tests, add a session-wide
local-storage fixture (mirroring Slice 2's `_app_database` fixture).

- [ ] **Step 1: Add the fixture**

In `tests/conftest.py`, add (alongside `_app_database`):
```python
@pytest.fixture(scope="session", autouse=True)
def _app_storage(tmp_path_factory):
    """Session-wide local-filesystem Storage backend so get_storage() works in tests
    (real use requires S3_*)."""
    storage_dir = tmp_path_factory.mktemp("appstorage")
    _os.environ["STORAGE_BACKEND"] = "local"
    _os.environ["STORAGE_LOCAL_DIR"] = str(storage_dir)
    from web.storage import factory
    factory.reset_storage()
    yield
    factory.reset_storage()
```
(`_os` and `pytest` are already imported in conftest from Slice 2.)

- [ ] **Step 2: Run the full suite**

Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS — all prior tests plus the new storage tests. Record the count.

- [ ] **Step 3: Commit**

```bash
git add tests/conftest.py
git commit -m "test(storage): session-wide local Storage fixture"
```

---

## Self-Review notes

- **Spec coverage:** package layout (T2–T5) · `Storage` interface + `storage_key` + `CATEGORIES` (T2) · `LocalStorage` full interface (T3) · `S3Storage` via boto3, mocked (T5) · factory with explicit selection + no silent fallback + RuntimeError (T4) · `KeyError` on missing get (T3,T5) · pagination in `list`/`delete_prefix` (T5) · S3 required everywhere, local opt-in for tests (T4,T6) · env vars + boto3 dep (T1) · conftest fixture (T6). No run-path/DB/UI wiring (correctly absent — that's 3b).
- **Interface consistency:** all eight methods + `KeyError` contract are identical across `base.py` (abstract), `local.py`, and `s3.py`; the `FakeS3` mock matches the boto3 calls `S3Storage` actually makes (`put_object`/`upload_file`/`get_object`/`download_file`/`head_object`/`delete_object`/`delete_objects`/`get_paginator`).
- **Task 4/5 ordering:** the factory (T4) lazily imports `web.storage.s3`, so T4 lands with only its local+unconfigured tests run; the S3-selection test is run after T5. Called out explicitly in T4 Step 4.
- **No placeholders**; every code step is complete.
