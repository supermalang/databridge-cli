"""In-process server-side cache for the heavy read-only endpoints (PERF-1).

The three heavy read-only endpoints (``/api/profile`` → ``profile_dataset``,
``/api/data-quality`` → ``compute_data_quality``, ``/api/base-tables`` →
``load_processed_data``) recompute everything on each call: re-reading
CSV/parquet off disk, reflattening repeat groups, then running full pandas EDA.
When a user navigates back and forth between tabs the same request repeats with
identical inputs. This module memoizes those results on a fingerprint of the
active project's **(data-session identity + config hash)**, namespaced per
(org, project), so identical repeat reads skip the recompute.

Surface:
- ``fingerprint(org_id, project_id, cfg, session_id) -> str`` — deterministic;
  stable for identical inputs, changes when the config hash OR the session_id
  changes; the returned key embeds the (org, project) namespace so
  ``invalidate`` can drop a project's entries.
- ``get_or_compute(key, compute_fn)`` — first call invokes ``compute_fn`` once
  and stores the result; a repeated key returns the memoized value without
  re-invoking.
- ``invalidate(org_id, project_id)`` — drops that project's entries (no-op when
  nothing is cached).

In-process only (a module-level dict). The app may run multiple workers; each
keeps its own cache, which is correct for this scope — entries are keyed on a
fingerprint that already changes on config save / new download, and a simple
lock guards the dict against concurrent mutation within a worker.
"""
from __future__ import annotations

import hashlib
import json
import threading
from typing import Any, Callable

# key -> stored value
_STORE: dict[str, Any] = {}
_LOCK = threading.Lock()

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
    """
    cfg_blob = json.dumps(cfg, sort_keys=True, default=str)
    cfg_hash = hashlib.sha256(cfg_blob.encode("utf-8")).hexdigest()
    body = hashlib.sha256(
        f"{cfg_hash}{_SEP}{session_id}".encode("utf-8")
    ).hexdigest()
    return f"{_namespace(org_id, project_id)}{_SEP}{body}"


def get_or_compute(key: str, compute_fn: Callable[[], Any]) -> Any:
    """Return the memoized value for ``key`` or compute, store, and return it.

    ``compute_fn`` is invoked at most once per stored key: the first call for a
    cold key runs it; subsequent calls with the same key return the memoized
    value without re-invoking.
    """
    with _LOCK:
        if key in _STORE:
            return _STORE[key]
    # Compute outside the lock so a slow heavy function does not serialize all
    # readers. A concurrent duplicate compute is harmless (idempotent result).
    value = compute_fn()
    with _LOCK:
        _STORE.setdefault(key, value)
        return _STORE[key]


def invalidate(org_id: Any, project_id: Any) -> None:
    """Drop all cached entries for the (org, project) namespace.

    Safe to call when nothing is cached for the project (no-op, no exception).
    """
    prefix = f"{_namespace(org_id, project_id)}{_SEP}"
    with _LOCK:
        stale = [k for k in _STORE if k.startswith(prefix)]
        for k in stale:
            del _STORE[k]
