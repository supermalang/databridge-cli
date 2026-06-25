"""Unit tests for the PERF-2 shared (cross-worker) cache backend.

PERF-1 shipped an in-process dict cache in ``web/perf_cache.py`` fronting the
three heavy read-only endpoints, with the public surface:

    fingerprint(org_id, project_id, cfg, session_id) -> str
    get_or_compute(key, compute_fn) -> Any
    invalidate(org_id, project_id) -> None
    _namespace(org_id, project_id) -> str

PERF-2 makes the *storage behind that surface* pluggable: the in-process dict
stays the default; a shared out-of-process store (Redis) is used when a
connection URL is configured via ``REDIS_URL`` / ``PERF_CACHE_URL``; and a
configured-but-unreachable store degrades gracefully to a no-op (compute
directly, never raise). The public surface above must stay UNCHANGED.

================================================================================
BACKEND-SELECTION CONTRACT (what the implementer must expose)
================================================================================
These tests only touch the existing public surface PLUS one minimal seam used
to construct/select a backend deterministically in tests. The implementer is
free to choose internal names, but must satisfy this contract:

1. ``perf_cache.make_backend()`` — a zero-arg factory that inspects the
   environment (``PERF_CACHE_URL`` first, then ``REDIS_URL``) and returns the
   backend object the module's ``get_or_compute`` / ``invalidate`` use:
     * env var UNSET  -> the in-process dict backend (PERF-1 behavior).
     * env var SET    -> a shared backend connected to that URL.
   The module-level ``get_or_compute`` / ``invalidate`` must route through the
   currently-selected backend (selected from the env at import and/or via this
   factory), so that with no env var set behavior is byte-for-byte PERF-1.

2. A backend object exposes the storage operations behind the public surface.
   The tests drive it through the module functions where possible. To simulate
   "two workers sharing one store" and an "unreachable store" WITHOUT a real
   Redis, the contract is:

     * ``perf_cache.make_backend(client=<redis-like client>)`` — when a
       redis-like client object is passed, the shared backend uses it as its
       connection instead of opening a socket from the URL. Two backends
       constructed with the SAME client object therefore share one store
       (this is how we model two uvicorn workers hitting one Redis).

     * The shared backend object exposes ``get_or_compute(key, compute_fn)``
       and ``invalidate(org_id, project_id)`` methods with the SAME semantics
       as the module-level functions (the module functions delegate to the
       selected backend's methods). Tests call these per-instance methods to
       prove cross-instance sharing.

     * Unreachable store: a client whose operations raise a redis
       ``ConnectionError`` models an unreachable Redis. ``get_or_compute`` on
       such a backend must compute the value and return it WITHOUT raising
       (cache no-ops); it must not propagate the connection error.

This is intentionally minimal: ``make_backend([client=...])`` for construction +
the same ``get_or_compute`` / ``invalidate`` names on the instance. Everything
else (key encoding, value serialization) is the implementer's choice, as long
as the namespacing + fingerprint key remain byte-identical to PERF-1.
================================================================================

Self-provisioning suite: pure in-memory unit tests, run with
``PYTHONPATH=. MPLBACKEND=Agg``. ``fakeredis`` is a dev-only dependency standing
in for a real Redis server.
"""
import importlib

import pytest

import web.perf_cache as perf_cache

# fakeredis is the in-memory Redis double. Required to be importable for the
# shared-backend tests; if it is somehow absent the import error here would be
# the WRONG red, so we surface it as a clear hard failure rather than a vacuous
# pass. (It is pinned in requirements-dev.txt by PERF-2.)
import fakeredis


# --------------------------------------------------------------------------- #
# Fixtures / helpers
# --------------------------------------------------------------------------- #
def _cfg():
    return {"questions": [
        {"export_label": "Region", "category": "categorical"},
        {"export_label": "Age", "category": "quantitative"},
        {"export_label": "Phone", "category": "qualitative"},
    ]}


@pytest.fixture(autouse=True)
def _clean_env_and_cache(monkeypatch):
    """Each test starts from a clean env (no shared-store URL) and an empty
    in-process cache, so behavior + call counts are unambiguous."""
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("PERF_CACHE_URL", raising=False)
    for org, proj in (("orgA", "projA"), ("orgB", "projB"), ("org", "project")):
        try:
            perf_cache.invalidate(org, proj)
        except Exception:
            pass
    yield
    for org, proj in (("orgA", "projA"), ("orgB", "projB"), ("org", "project")):
        try:
            perf_cache.invalidate(org, proj)
        except Exception:
            pass


def _fresh_client():
    """A standalone fakeredis client = one shared out-of-process store."""
    return fakeredis.FakeStrictRedis()


class _UnreachableClient:
    """A redis-like client whose every operation raises ConnectionError,
    modelling a configured-but-unreachable Redis."""

    def __init__(self):
        from redis.exceptions import ConnectionError as RedisConnectionError
        self._err = RedisConnectionError

    def _boom(self, *a, **k):
        raise self._err("simulated unreachable redis")

    # Cover the common redis client surface a backend might call.
    get = set = setex = delete = scan = scan_iter = keys = mget = _boom
    ping = _boom

    def __getattr__(self, _name):  # any other op also fails
        return self._boom


# --------------------------------------------------------------------------- #
# (1) Default backend == PERF-1 behavior (no URL set)
# --------------------------------------------------------------------------- #
def test_default_backend_matches_perf1(monkeypatch):
    """AC: with no URL env var set, get_or_compute / invalidate / fingerprint
    behave identically to PERF-1 (in-process dict). Warm call skips recompute;
    fingerprint stable-then-changes."""
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("PERF_CACHE_URL", raising=False)
    # Re-select the backend from the (now URL-free) environment.
    importlib.reload(perf_cache)

    # fingerprint: stable for identical inputs, changes on config OR session.
    cfg = _cfg()
    fp = perf_cache.fingerprint("orgA", "projA", cfg, "20260101_000000")
    assert perf_cache.fingerprint("orgA", "projA", cfg, "20260101_000000") == fp
    cfg2 = _cfg()
    cfg2["questions"][0]["category"] = "qualitative"
    assert perf_cache.fingerprint("orgA", "projA", cfg2, "20260101_000000") != fp
    assert perf_cache.fingerprint("orgA", "projA", cfg, "20260102_111111") != fp

    # warm call skips recompute (call count == 1).
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"value": 42}

    key = perf_cache.fingerprint("orgA", "projA", cfg, "20260101_000000")
    first = perf_cache.get_or_compute(key, compute)
    second = perf_cache.get_or_compute(key, compute)
    assert calls["n"] == 1
    assert first == {"value": 42}
    assert second == first

    # invalidate drops the entry -> next read recomputes.
    perf_cache.invalidate("orgA", "projA")
    assert perf_cache.get_or_compute(key, compute) == {"value": 42}
    assert calls["n"] == 2


# --------------------------------------------------------------------------- #
# (2) Shared backend: cross-worker hit over one fake store
# --------------------------------------------------------------------------- #
def test_shared_backend_cross_worker_hit():
    """AC: with the shared backend configured, a value cached by one worker is
    readable by another. Modelled by two backend instances over ONE fakeredis
    client: a value written via instance A is returned to instance B WITHOUT
    recomputing (spy call count stays 1)."""
    store = _fresh_client()
    backend_a = perf_cache.make_backend(client=store)
    backend_b = perf_cache.make_backend(client=store)

    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"value": "shared-101"}

    key = perf_cache.fingerprint("orgA", "projA", _cfg(), "session-1")

    # Worker A: cold compute, writes to the shared store.
    a_val = backend_a.get_or_compute(key, compute)
    assert a_val == {"value": "shared-101"}
    assert calls["n"] == 1

    # Worker B: same key, different instance, SAME store -> hit, no recompute.
    b_val = backend_b.get_or_compute(key, compute)
    assert b_val == {"value": "shared-101"}
    assert calls["n"] == 1, "instance B should read A's value from the shared store"


# --------------------------------------------------------------------------- #
# (3) Shared invalidate clears the entry for ALL instances
# --------------------------------------------------------------------------- #
def test_shared_invalidate_clears_all():
    """AC: invalidate(org, project) on one instance clears the entry seen by the
    other instance/worker (global invalidation across the shared store)."""
    store = _fresh_client()
    backend_a = perf_cache.make_backend(client=store)
    backend_b = perf_cache.make_backend(client=store)

    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"value": calls["n"]}

    key = perf_cache.fingerprint("orgA", "projA", _cfg(), "session-1")

    assert backend_a.get_or_compute(key, compute) == {"value": 1}
    assert backend_b.get_or_compute(key, compute) == {"value": 1}  # shared hit
    assert calls["n"] == 1

    # Invalidate on instance A; instance B must see the entry gone.
    backend_a.invalidate("orgA", "projA")

    assert backend_b.get_or_compute(key, compute) == {"value": 2}
    assert calls["n"] == 2, "invalidate on A must clear the entry B reads"


# --------------------------------------------------------------------------- #
# (4) Namespacing + fingerprint key byte-for-byte unchanged from PERF-1
# --------------------------------------------------------------------------- #
def test_namespacing_and_fingerprint_unchanged():
    """AC: per-project namespacing + the config+data fingerprint key are
    byte-for-byte identical to PERF-1; a different project / changed fingerprint
    misses (in the shared backend too)."""
    cfg = _cfg()
    session = "20260101_000000"

    # Fingerprint + namespace are pure functions on the public surface and must
    # be EXACTLY the PERF-1 encoding: namespace is the prefix of the key, the
    # body is sha256(sha256(cfg)::session).
    import hashlib
    import json

    sep = "::"
    expected_ns = f"orgA{sep}projA"
    assert perf_cache._namespace("orgA", "projA") == expected_ns

    cfg_hash = hashlib.sha256(
        json.dumps(cfg, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    expected_body = hashlib.sha256(
        f"{cfg_hash}{sep}{session}".encode("utf-8")
    ).hexdigest()
    expected_key = f"{expected_ns}{sep}{expected_body}"
    assert perf_cache.fingerprint("orgA", "projA", cfg, session) == expected_key

    # Different project / changed fingerprint => different key => a MISS in the
    # shared backend (each computes its own value).
    store = _fresh_client()
    backend = perf_cache.make_backend(client=store)

    fp_a = perf_cache.fingerprint("orgA", "projA", cfg, session)
    fp_b = perf_cache.fingerprint("orgB", "projB", cfg, session)
    assert fp_a != fp_b

    calls = {"n": 0}

    def compute_a():
        calls["n"] += 1
        return {"owner": "A"}

    def compute_b():
        calls["n"] += 1
        return {"owner": "B"}

    assert backend.get_or_compute(fp_a, compute_a) == {"owner": "A"}
    assert backend.get_or_compute(fp_b, compute_b) == {"owner": "B"}
    assert calls["n"] == 2  # different namespaced keys => both compute (no cross-hit)

    # Changed fingerprint (config edit) => miss => recompute.
    cfg2 = _cfg()
    cfg2["questions"][0]["category"] = "qualitative"
    fp_a2 = perf_cache.fingerprint("orgA", "projA", cfg2, session)
    assert fp_a2 != fp_a
    assert backend.get_or_compute(fp_a2, compute_a) == {"owner": "A"}
    assert calls["n"] == 3


# --------------------------------------------------------------------------- #
# (5) Configured-but-unreachable store degrades to a no-op
# --------------------------------------------------------------------------- #
def test_shared_store_unreachable_falls_back():
    """AC graceful degradation: with the shared store configured but UNREACHABLE,
    get_or_compute computes directly and returns the correct value WITHOUT
    raising — a cache outage must never take down the endpoints."""
    backend = perf_cache.make_backend(client=_UnreachableClient())

    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"value": "computed-despite-outage"}

    key = perf_cache.fingerprint("orgA", "projA", _cfg(), "session-1")

    # Must not raise even though every store op fails.
    got = backend.get_or_compute(key, compute)
    assert got == {"value": "computed-despite-outage"}
    assert calls["n"] == 1

    # A second call may recompute (cache is inert/no-op) but must still return
    # the correct value and never raise.
    got2 = backend.get_or_compute(key, compute)
    assert got2 == {"value": "computed-despite-outage"}

    # invalidate against an unreachable store must also be a safe no-op.
    backend.invalidate("orgA", "projA")  # must not raise
