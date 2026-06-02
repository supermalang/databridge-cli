# Storage Foundation (Minio/S3) — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — ready for implementation plan
**Slice:** 3a (the first sub-slice of Slice 3) of the multi-tenant SaaS re-platforming

---

## Context

databridge-cli is being re-platformed into a multi-tenant SaaS: Postgres (app state —
**Slice 2, done**), Zitadel (identity — **Slice 1, done**), Minio (object storage — **Slice 3**).

Slice 3 was split into two sub-slices:
- **3a (this spec)** — a self-contained object-storage abstraction (Minio/S3 backend +
  per-project key prefixes), with NO run-path wiring.
- **3b (later)** — the per-job temp-workspace runner (hydrate→run→dehydrate), session/run
  metadata in the DB, relaxing single-flight to allow concurrent per-project runs, and
  migrating the Reports/Sessions UI to read from Minio. 3b consumes 3a.

Today the CLI reads/writes **cwd-relative** paths (`config.yml`, `data/processed`, `reports`,
`data/processed/charts`, `templates/`); `web/main.py` spawns `python src/data/make.py` with
`cwd=BASE_DIR`. Slice 2 keeps the active project's config mirrored to `config.yml`. There is
no object-storage code yet. This sub-slice adds the storage primitive that 3b's runner will
use to hydrate inputs into a temp workspace and ship outputs back.

---

## Goal

Provide a small, well-tested `web/storage/` package: a `Storage` interface with two
interchangeable backends — **S3/Minio** (real use) and **local-filesystem** (tests) — plus a
per-project key-builder and a lazy, env-driven, test-resettable factory. Nothing in the run
path, DB, or UI changes in this sub-slice.

### Non-goals (→ Slice 3b)
- The hydrate→run→dehydrate per-job runner; retiring the `config.yml` run-time mirror.
- Session/run metadata tables; migrating `list_sessions`/reports listing off the disk.
- Concurrency / relaxing single-flight.
- Reports/Sessions download UI on Minio (presigned URLs, streaming).
- Any change to `src/` CLI code or existing `web/main.py` endpoints.

---

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | Storage abstraction only, no wiring | Small, isolated, safe first sub-slice |
| Dev/prod backend | **Minio/S3 required everywhere** (no silent local fallback) | Consistent with Slice 2's "Postgres required everywhere" |
| Test backend | **Local-filesystem**, selected via explicit `STORAGE_BACKEND=local` | No Minio in CI; explicit opt-in avoids accidental prod fallback |
| SDK | **boto3** | S3-compatible; one client works against Minio (`endpoint_url`), AWS, any S3 |
| Key identity | **IDs (UUIDs)**, not slugs | Stable across renames |
| DB coupling | **None** — key helper takes plain strings | Storage stays pure infrastructure |

---

## Package layout

```
web/storage/
├── __init__.py
├── base.py       # Storage ABC + storage_key() helper + CATEGORIES
├── local.py      # LocalStorage(base_dir)
├── s3.py         # S3Storage (boto3)
└── factory.py    # get_storage() (lazy singleton) + reset_storage()
```

### `base.py`
- `class Storage(ABC)` declaring the interface (below).
- `storage_key(org_id: str, project_id: str, category: str, name: str) -> str` →
  `"orgs/{org_id}/projects/{project_id}/{category}/{name}"`. Pure string building; **no
  `web.db` import**. `org_id`/`project_id` are stringified UUIDs passed by the caller (3b's
  runner). `name` may itself contain `/` for nested paths (e.g. `charts/foo.png`).
- `CATEGORIES = ("raw", "processed", "charts", "reports", "templates")` — documented
  conventional categories. Not enforced (free string) — YAGNI on validation.

### Interface (implemented identically by both backends)

| Method | Behavior |
|---|---|
| `put_bytes(key: str, data: bytes) -> None` | Write bytes at key (overwrite). |
| `put_file(key: str, local_path) -> None` | Upload a local file to key. |
| `get_bytes(key: str) -> bytes` | Read bytes; raise `KeyError` if absent. |
| `get_file(key: str, dest_path) -> None` | Download key to a local path (creating parent dirs); raise `KeyError` if absent. |
| `list(prefix: str) -> list[str]` | All keys under prefix (sorted). |
| `exists(key: str) -> bool` | Whether key exists. |
| `delete(key: str) -> None` | Delete one key (no error if absent). |
| `delete_prefix(prefix: str) -> None` | Delete every key under prefix (e.g. a whole project subtree). |

`get_bytes`/`get_file` raise `KeyError` for a missing key (a single, backend-agnostic error
the runner can catch); other operations are idempotent where noted.

### `local.py` — `LocalStorage(base_dir)`
Keys map to files under `base_dir` (`base_dir / key`). `put_*` creates parent dirs; `list`
walks the tree and returns POSIX-style keys relative to `base_dir`; `delete_prefix` removes
the matching files (and prunes now-empty dirs). Used by tests and isolated unit tests.

### `s3.py` — `S3Storage(client, bucket)`
Wraps a boto3 S3 client + bucket name. `put_bytes`→`put_object`, `put_file`→`upload_file`,
`get_bytes`→`get_object` (translate `ClientError`/`NoSuchKey` → `KeyError`),
`get_file`→`download_file` (translate 404 → `KeyError`), `list`→`list_objects_v2` paginated
(returns the `Key`s), `exists`→`head_object` (404 → False), `delete`→`delete_object`,
`delete_prefix`→`list_objects_v2` + batched `delete_objects`. The client is built in the
factory from env.

### `factory.py`
```
get_storage() -> Storage    # lazy singleton
reset_storage() -> None     # drop the singleton (tests)
```
Selection (explicit, no silent fallback):
1. `STORAGE_BACKEND == "local"` → `LocalStorage(os.environ["STORAGE_LOCAL_DIR"])`.
2. else if `S3_ENDPOINT_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` all set →
   build a boto3 client (`endpoint_url`, `aws_access_key_id`, `aws_secret_access_key`,
   `region_name=S3_REGION or "us-east-1"`) and return `S3Storage(client, bucket)`.
3. else → raise `RuntimeError("storage not configured: set S3_* env or STORAGE_BACKEND=local")`.

---

## Configuration (env vars)

Added to `.env.example`:

| Variable | Purpose |
|---|---|
| `S3_ENDPOINT_URL` | Minio/S3 endpoint, e.g. `http://localhost:9000` |
| `S3_ACCESS_KEY` | Access key |
| `S3_SECRET_KEY` | Secret key |
| `S3_BUCKET` | Bucket name, e.g. `databridge` |
| `S3_REGION` | Optional; defaults to `us-east-1` |

Dev note (documented): run a local Minio, e.g.
`docker run --rm -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=minio -e MINIO_ROOT_PASSWORD=minio12345 minio/minio server /data --console-address ":9001"`,
create the bucket, and set the `S3_*` vars. `boto3` added to `requirements.txt`.

---

## Testing (TDD)

No Minio in CI — the suite uses `LocalStorage`. A conftest fixture sets
`STORAGE_BACKEND=local` + a temp `STORAGE_LOCAL_DIR` (mirroring Slice 2's session-wide DB
fixture) so any future code calling `get_storage()` works in tests.

- **`LocalStorage`** (full interface): `put_bytes`/`get_bytes` round-trip; `put_file`/`get_file`
  round-trip (and `get_file` creates parent dirs); `get_bytes` on a missing key raises
  `KeyError`; `list(prefix)` returns only scoped keys, sorted; `exists` true/false;
  `delete` removes one key (no error if absent); `delete_prefix` removes a whole project
  subtree and leaves sibling projects intact.
- **`storage_key`**: builds `orgs/<o>/projects/<p>/<category>/<name>`; nested `name` preserved.
- **Factory**: `STORAGE_BACKEND=local` → `LocalStorage`; nothing configured → `RuntimeError`;
  S3 env set → `S3Storage` (assert type + bucket; client built but not called).
- **`S3Storage`** (mocked boto3 client, monkeypatched — no live Minio, no `moto`): each method
  calls the right client method with the expected `Bucket`/`Key`; `get_bytes` on a
  `ClientError`/404 maps to `KeyError`; `delete_prefix` lists then batch-deletes.

---

## Risks / open points

- **Backend parity:** `LocalStorage` (tests) and `S3Storage` (prod) must behave identically
  at the interface boundary; the shared interface tests plus the S3 mock tests guard this,
  but a thin real-Minio smoke test is worthwhile during 3b integration (out of scope here).
- **`list` cost / pagination:** `S3Storage.list` and `delete_prefix` must paginate
  (`list_objects_v2` caps at 1000 keys) — covered in the implementation.
- **Key charset:** `name` may contain `/`; callers must not pass leading slashes or `..`
  (the runner controls these). No traversal sanitization here — documented assumption.
