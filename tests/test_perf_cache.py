"""Unit tests for the server-side perf cache (PERF-1).

These are the spec for ``web/perf_cache.py`` (does not exist yet — the import is
the first, correct red). The cache sits in front of the three heavy read-only
endpoints (``/api/profile`` → ``profile_dataset``, ``/api/data-quality`` →
``compute_data_quality``, ``/api/base-tables`` → ``load_processed_data``) and
memoizes their result on a fingerprint of the active project's
**(data-session identity + config hash)**, namespaced per (org, project).

Expected surface (built to by the implementer):
- ``fingerprint(org_id, project_id, cfg, session_id) -> str`` — stable for the
  same inputs; changes when the config hash OR the data-session identity changes.
- ``get_or_compute(key, compute_fn)`` — returns the memoized value for a repeated
  key WITHOUT calling ``compute_fn`` again; the first call invokes it exactly once.
- ``invalidate(org_id, project_id)`` — drops cached entries for that project so the
  next ``get_or_compute`` recomputes.

Every assertion is derived from the PERF-1 Acceptance criteria + Unit-tests fields.
These are pure in-memory unit tests (no HTTP / Postgres / Minio) — the suite's
self-provisioning conftest is sufficient. ``get_or_compute`` is exercised with
real fixture data run through the underlying heavy functions so the cold-path
result is asserted byte-identical to the un-cached computation.
"""
import pandas as pd
import pytest

# The module under test does not exist yet — this import is the first, expected red.
import web.perf_cache as perf_cache


# --------------------------------------------------------------------------- #
# Fixtures: an in-memory (cfg, main_df, repeat_tables) "data session"
# --------------------------------------------------------------------------- #
def _cfg():
    return {"questions": [
        {"export_label": "Region", "category": "categorical"},
        {"export_label": "Age", "category": "quantitative"},
        {"export_label": "Phone", "category": "qualitative"},
    ]}


def _main_df():
    return pd.DataFrame({
        "_id":    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        "Region": ["N", "N", "S", "S", "N", "N", "S", "S", "N", "S"],
        "Age":    [20, 21, 22, 23, 24, 25, 26, 27, 28, 9999],
        "Phone":  ["x", None, "y", "z", "w", None, "v", "u", "t", "s"],
    })


def _repeats():
    return {"household_members": pd.DataFrame({
        "_parent_index": [1, 1, 2],
        "_row_id": ["1.0", "1.1", "2.0"],
        "Name": ["A", "B", "C"],
    })}


@pytest.fixture(autouse=True)
def _clean_cache():
    """Each test starts from an empty cache so call-counts are unambiguous.

    Uses the public invalidate() seam for the (org, project) pairs the tests touch;
    if the module exposes a broader reset hook the implementer may add one, but the
    tests must not depend on private internals.
    """
    for org, proj in (("orgA", "projA"), ("orgB", "projB"), ("org", "project")):
        try:
            perf_cache.invalidate(org, proj)
        except Exception:
            pass
    yield


# --------------------------------------------------------------------------- #
# (1) fingerprint: stable for identical inputs, changes on config OR session
# --------------------------------------------------------------------------- #
def test_fingerprint_stable_then_changes():
    """AC: fingerprint from (data-session identity + config hash); identical for the
    same (session, config), changes when the config hash or the session identity
    changes."""
    cfg = _cfg()
    fp = perf_cache.fingerprint("orgA", "projA", cfg, "20260101_000000")

    # Stable: same inputs → identical fingerprint.
    assert perf_cache.fingerprint("orgA", "projA", cfg, "20260101_000000") == fp

    # Config change → different fingerprint.
    cfg2 = _cfg()
    cfg2["questions"][0]["category"] = "qualitative"
    assert perf_cache.fingerprint("orgA", "projA", cfg2, "20260101_000000") != fp

    # Data-session identity change → different fingerprint.
    assert perf_cache.fingerprint("orgA", "projA", cfg, "20260102_111111") != fp


# --------------------------------------------------------------------------- #
# (2) warm call skips recompute
# --------------------------------------------------------------------------- #
def test_warm_call_skips_recompute():
    """AC: a warm second call with an unchanged key returns the memoized value and
    does NOT invoke the heavy compute fn again (call count == 1)."""
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"value": 42}

    key = perf_cache.fingerprint("orgA", "projA", _cfg(), "20260101_000000")

    first = perf_cache.get_or_compute(key, compute)
    second = perf_cache.get_or_compute(key, compute)

    assert calls["n"] == 1                 # compute ran exactly once
    assert first == {"value": 42}
    assert second == first                 # warm call returned the memoized value


# --------------------------------------------------------------------------- #
# (3) cold result is byte-identical to the un-cached computation
# --------------------------------------------------------------------------- #
def test_cold_result_matches_uncached():
    """AC: on a cold cache, the cached path returns a value byte-identical to calling
    the underlying function directly — for profile / data-quality / base-tables."""
    from src.data.profile import profile_dataset
    from src.reports.data_quality import compute_data_quality

    cfg = _cfg()
    df, repeats = _main_df(), _repeats()

    # profile_dataset
    expected_profile = profile_dataset(cfg, _main_df(), _repeats())
    key_p = perf_cache.fingerprint("orgA", "projA", cfg, "prof")
    got_profile = perf_cache.get_or_compute(key_p, lambda: profile_dataset(cfg, df, repeats))
    assert got_profile == expected_profile

    # compute_data_quality
    expected_dq = compute_data_quality(cfg, _main_df(), _repeats())
    key_dq = perf_cache.fingerprint("orgA", "projA", cfg, "dq")
    got_dq = perf_cache.get_or_compute(key_dq, lambda: compute_data_quality(cfg, df, repeats))
    assert got_dq == expected_dq

    # base-tables shape (the catalog the /api/base-tables endpoint builds from
    # load_processed_data's (df, repeats)); the cache must return it unchanged.
    def _catalog():
        return {"main_rows": int(len(df)),
                "tables": sorted(repeats.keys())}
    expected_cat = _catalog()
    key_bt = perf_cache.fingerprint("orgA", "projA", cfg, "bt")
    got_cat = perf_cache.get_or_compute(key_bt, _catalog)
    assert got_cat == expected_cat


# --------------------------------------------------------------------------- #
# (4) config save invalidates → next get_or_compute recomputes
# --------------------------------------------------------------------------- #
def test_config_save_invalidates():
    """AC: saving config via POST /api/config invalidates the project's cache (the
    save handler calls invalidate(org, project)); the next read recomputes rather
    than serving the pre-save result. Tested at the invalidate() seam."""
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"value": calls["n"]}

    key = perf_cache.fingerprint("orgA", "projA", _cfg(), "20260101_000000")

    assert perf_cache.get_or_compute(key, compute) == {"value": 1}
    assert perf_cache.get_or_compute(key, compute) == {"value": 1}   # warm: no recompute
    assert calls["n"] == 1

    # The hook POST /api/config invokes on save:
    perf_cache.invalidate("orgA", "projA")

    # Next read must recompute (cache dropped) → compute fn runs again.
    assert perf_cache.get_or_compute(key, compute) == {"value": 2}
    assert calls["n"] == 2


# --------------------------------------------------------------------------- #
# (5) download completion invalidates → post-download reads recompute
# --------------------------------------------------------------------------- #
def test_download_invalidates():
    """AC: completing a download invalidates the project's cache so post-download
    reads reflect the new data, never the pre-download cached result. The
    download-completion path calls invalidate(org, project)."""
    from src.reports.data_quality import compute_data_quality

    cfg = _cfg()
    before_df = _main_df()
    key = perf_cache.fingerprint("orgA", "projA", cfg, "session-1")

    cold = perf_cache.get_or_compute(key, lambda: compute_data_quality(cfg, before_df, None))
    warm = perf_cache.get_or_compute(key, lambda: compute_data_quality(cfg, before_df, None))
    assert warm == cold                     # served from cache pre-download

    # New data arrives; the download-completion hook invalidates the project cache.
    perf_cache.invalidate("orgA", "projA")

    after_df = _main_df()
    after_df.loc[0, "Region"] = "ZZZ"       # materially different data
    fresh = perf_cache.get_or_compute(key, lambda: compute_data_quality(cfg, after_df, None))

    # Post-download read reflects the new data, not the stale cached result.
    assert fresh != cold


# --------------------------------------------------------------------------- #
# (6) per-project isolation
# --------------------------------------------------------------------------- #
def test_per_project_isolation():
    """AC: a value cached for project A is never returned for a request scoped to
    project B; B misses and computes its own (namespaced by org+project)."""
    cfg = _cfg()
    session = "20260101_000000"

    # Distinct fingerprints across (org, project).
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

    a_val = perf_cache.get_or_compute(fp_a, compute_a)
    b_val = perf_cache.get_or_compute(fp_b, compute_b)

    assert a_val == {"owner": "A"}
    assert b_val == {"owner": "B"}          # B did not get A's cached value
    assert calls["n"] == 2                  # both computed independently
