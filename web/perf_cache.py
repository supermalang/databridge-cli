"""Server-side cache for the heavy read-only endpoints (PERF-1 + PERF-2).

The three heavy read-only endpoints (``/api/profile`` → ``profile_dataset``,
``/api/data-quality`` → ``compute_data_quality``, ``/api/base-tables`` →
``load_processed_data``) recompute everything on each call: re-reading
CSV/parquet off disk, reflattening repeat groups, then running full pandas EDA.
When a user navigates back and forth between tabs the same request repeats with
identical inputs. This module memoizes those results on a fingerprint of the
active project's **(data-session identity + config hash)**, namespaced per
(org, project), so identical repeat reads skip the recompute.

Surface (unchanged since PERF-1):
- ``fingerprint(org_id, project_id, cfg, session_id) -> str`` — deterministic;
  stable for identical inputs, changes when the config hash OR the session_id
  changes; the returned key embeds the (org, project) namespace so
  ``invalidate`` can drop a project's entries.
- ``get_or_compute(key, compute_fn)`` — first call invokes ``compute_fn`` once
  and stores the result; a repeated key returns the memoized value without
  re-invoking.
- ``invalidate(org_id, project_id)`` — drops that project's entries (no-op when
  nothing is cached).

PERF-2 makes the storage behind that surface **pluggable** without changing the
surface. The default backend is the PERF-1 in-process dict — selected when no
shared-store URL is configured, so single-worker deployments need zero new
infrastructure and behave byte-for-byte as PERF-1. When ``PERF_CACHE_URL`` (or,
failing that, ``REDIS_URL``) is set, a shared Redis backend is selected so all
uvicorn workers share one store: a view warmed by one worker is hot for the
rest, and ``invalidate`` clears the entry globally.

Graceful degradation: a configured-but-unreachable shared store never takes the
endpoints down — every store op is guarded so ``get_or_compute`` falls back to
computing directly and ``invalidate`` no-ops on a connection failure.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from typing import Any, Callable

# Sentinel separating the (org, project) namespace prefix from the body of a
# fingerprint key. Chosen to be vanishingly unlikely to appear in a sha256 hex
# digest or in the namespace tokens themselves.
_SEP = "::"


def _namespace(org_id: Any, project_id: Any) -> str:
    """Stable string prefix identifying the (org, project) namespace."""
    return f"{org_id}{_SEP}{project_id}"


def fingerprint(org_id: Any, project_id: Any, cfg: Any, session_id: Any) -> str:
    """Deterministic cache key for the active project's data session + config.

    The config is hashed with a stable serialization so logically-identical
    configs map to the same digest. The returned key embeds the (org, project)
    namespace as a prefix so ``invalidate`` can drop a project's entries.

    Encoding is byte-for-byte identical to PERF-1 and must not change — it
    defines what counts as a cache hit across both backends.
    """
    cfg_blob = json.dumps(cfg, sort_keys=True, default=str)
    cfg_hash = hashlib.sha256(cfg_blob.encode("utf-8")).hexdigest()
    body = hashlib.sha256(
        f"{cfg_hash}{_SEP}{session_id}".encode("utf-8")
    ).hexdigest()
    return f"{_namespace(org_id, project_id)}{_SEP}{body}"


# --------------------------------------------------------------------------- #
# Backends
# --------------------------------------------------------------------------- #
class _InProcessBackend:
    """PERF-1 behavior: a module-private dict guarded by a lock.

    In-process only — the app may run multiple workers, each keeping its own
    cache. That is correct for this scope: entries are keyed on a fingerprint
    that already changes on config save / new download, so stale entries are
    simply never looked up again.
    """

    def __init__(self) -> None:
        self._store: dict[str, Any] = {}
        self._lock = threading.Lock()

    def get_or_compute(self, key: str, compute_fn: Callable[[], Any]) -> Any:
        with self._lock:
            if key in self._store:
                return self._store[key]
        # Compute outside the lock so a slow heavy function does not serialize
        # all readers. A concurrent duplicate compute is harmless (idempotent).
        value = compute_fn()
        with self._lock:
            self._store.setdefault(key, value)
            return self._store[key]

    def invalidate(self, org_id: Any, project_id: Any) -> None:
        prefix = f"{_namespace(org_id, project_id)}{_SEP}"
        with self._lock:
            stale = [k for k in self._store if k.startswith(prefix)]
            for k in stale:
                del self._store[k]


class _SharedBackend:
    """Cross-worker cache over a Redis-compatible store.

    Values are JSON-serialized (the endpoints return JSON-able dicts/lists).
    Keys are the fingerprint() output verbatim, so the namespace prefix is
    preserved and ``invalidate`` can drop a project's entries with a prefix
    scan. Every store op is wrapped: a ``redis.exceptions.ConnectionError``
    (configured-but-unreachable store) degrades to compute-directly / no-op so
    a cache outage never breaks the endpoints.
    """

    def __init__(self, client: Any = None, url: str | None = None) -> None:
        if client is None:
            # Lazy import so the app runs with redis installed but no server,
            # and (combined with make_backend's guard) so a missing redis lib
            # never breaks the default in-process path.
            import redis  # noqa: PLC0415

            client = redis.Redis.from_url(url)
        self._client = client

    @staticmethod
    def _store_error():
        """The BASE redis error type — covers ConnectionError, TimeoutError,
        AuthenticationError, ReadOnlyError, pool exhaustion, etc. Imported lazily
        so the module does not hard-depend on redis being importable. ANY
        operational store failure must degrade gracefully (compute / no-op) and
        never surface as a 500 on the read-only endpoints."""
        try:
            from redis.exceptions import RedisError
            return RedisError
        except Exception:  # pragma: no cover - redis always present here
            return ()

    def get_or_compute(self, key: str, compute_fn: Callable[[], Any]) -> Any:
        store_error = self._store_error()
        try:
            cached = self._client.get(key)
        except store_error:
            cached = None  # store down/erroring → treat as a miss, compute below
        if cached is not None:
            try:
                return json.loads(cached)
            except (ValueError, TypeError):
                pass  # corrupt entry → recompute and overwrite
        value = compute_fn()
        try:
            # 1h TTL: a safety net bounding stale-entry accumulation + memory
            # growth if an invalidate() is ever missed (e.g. a worker dies between
            # a data write and its invalidate). Correctness still rests on the
            # fingerprint key rotating on config/data changes, not on the TTL.
            self._client.set(key, json.dumps(value, default=str), ex=3600)
        except store_error:
            pass  # store down/erroring → cache write is a no-op
        return value

    def invalidate(self, org_id: Any, project_id: Any) -> None:
        store_error = self._store_error()
        prefix = f"{_namespace(org_id, project_id)}{_SEP}"
        try:
            keys = [
                k.decode("utf-8") if isinstance(k, (bytes, bytearray)) else k
                for k in self._client.scan_iter(match=f"{prefix}*")
            ]
            if keys:
                self._client.delete(*keys)
        except store_error:
            pass  # store down/erroring → invalidation is a safe no-op


def make_backend(client: Any = None):
    """Construct the cache backend.

    - ``make_backend(client=<redis-like client>)`` → a shared backend using that
      client object directly. Two backends built with the SAME client share one
      store (models two workers on one Redis).
    - ``make_backend()`` → selected from the environment: ``PERF_CACHE_URL``
      first, then ``REDIS_URL``. Unset → the in-process dict backend (PERF-1).
      Set → a shared Redis backend dialing that URL. If redis cannot be imported
      the default in-process backend is used so the app keeps running.
    """
    if client is not None:
        return _SharedBackend(client=client)

    url = os.environ.get("PERF_CACHE_URL") or os.environ.get("REDIS_URL")
    if not url:
        return _InProcessBackend()
    try:
        return _SharedBackend(url=url)
    except Exception:
        # redis missing / URL unusable at construction → never break the app;
        # fall back to the in-process backend.
        return _InProcessBackend()


# Selected once at import from the environment. With no URL set this is the
# PERF-1 in-process dict, so the module-level functions below are byte-for-byte
# PERF-1 behavior.
_BACKEND = make_backend()


def get_or_compute(key: str, compute_fn: Callable[[], Any]) -> Any:
    """Return the memoized value for ``key`` or compute, store, and return it.

    Delegates to the selected backend. ``compute_fn`` is invoked at most once
    per stored key on a healthy backend; on an unreachable shared store the
    cache no-ops and ``compute_fn`` runs (the endpoint still serves correctly).
    """
    return _BACKEND.get_or_compute(key, compute_fn)


def invalidate(org_id: Any, project_id: Any) -> None:
    """Drop all cached entries for the (org, project) namespace.

    Delegates to the selected backend. Safe to call when nothing is cached
    (no-op, no exception), including against an unreachable shared store.
    """
    _BACKEND.invalidate(org_id, project_id)
