# Layer 2 — Data Profiling Design

**Date:** 2026-05-30
**Status:** Design (approved) — precedes the implementation plan
**Roadmap:** Layer 2 of [the analyst-pipeline architecture](2026-05-30-analyst-pipeline-architecture.md). Builds on Layer 1 (base tables). The load-bearing prerequisite for the question engine (Layer 4) — the LLM's analysis quality is capped by the quality of this profile.

---

## 1. Goal

A deterministic profiling engine that computes structured, machine-readable EDA signals for every base table — the raw numbers that (a) the validation findings and report summaries already need and (b) the future LLM question-engine will consume to reason about real data shape (cardinality, nulls, skew, correlations) instead of column labels alone.

**No LLM. No I/O. Pure computation.**

---

## 2. Scope

**In scope**
- A `profile` module computing per-column and per-table profiles for **all base tables** (main + every repeat level from Layer 1).
- Convergence: `profile` becomes the single source of truth for the shared signals; `validate.py` and `summaries.py` are refactored to consume it (fixes the dual-IQR inconsistency — see §6).
- Web-first surface: `GET /api/profile` + a read-only "Profile" UI panel.

**Out of scope (deferred, separate specs)**
- LLM-driven cleaning suggestions + human-approval flow (the next piece after this).
- The PII gate (Layer 3).
- The question engine (Layer 4) that will consume this profile.

---

## 3. Architecture (Approach A — `profile.py` owns the numbers)

```
src/data/profile.py   (NEW)  — computes signals + assembles structured profiles
        ▲                ▲
        │                │
src/data/validate.py    src/reports/summaries.py   (refactored to consume primitives)
   findings + severity      narrative text
```

`profile.py` is pure and deterministic. `validate.py` keeps producing findings (severity/kind/message) but derives its **numbers** (missingness counts, 3×IQR outlier bounds) from `profile.py`. `summaries.py`'s `_data_quality_text` and `_correlation_text` likewise derive from `profile.py`. Output contracts of validate/summaries are preserved; only the internal source of the numbers changes.

### File structure
- **Create:** `src/data/profile.py` — primitives + structured profile (pure, no I/O, no LLM).
- **Modify:** `src/data/validate.py` — `compute_missingness` and `find_numeric_outliers` derive from `profile` primitives.
- **Modify:** `src/reports/summaries.py` — `_data_quality_text` and `_correlation_text` derive from `profile` primitives.
- **Modify:** `web/main.py` — add `GET /api/profile`.
- **Create:** `frontend/src/pages/Profile.jsx` — read-only EDA panel; wire a "Profile" tab into `App.jsx`; styles in `styles.css`.
- **Tests:** `tests/test_profile.py`, `tests/test_profile_api.py`, plus updates to the affected validate/summaries tests.

---

## 4. Structured profile schema

`profile_dataset(cfg, main_df, repeat_tables) -> Dict[str, TableProfile]` (keyed by table name: `"main"` + each base-table path).

```
TableProfile = {
    "name": str,
    "rows": int,
    "columns": [ColumnProfile, ...],
    "correlations": [ {"a": str, "b": str, "method": "pearson", "r": float}, ... ],  # numeric pairs, |r| >= threshold, capped
    "duplicates": { "id_col": str, "duplicate_rows": int, "groups": int } | None,    # when an id column exists
}

ColumnProfile = {
    "name": str,
    "role": str,            # from question category: categorical|quantitative|qualitative|date|geographical|undefined; linkage columns flagged "linkage"
    "count": int,           # non-null, non-blank
    "missing": int,
    "missing_pct": float,
    "distinct": int,        # cardinality
    "type_issue_count": int,# non-coercible values for the declared role
    # role-specific (present only when applicable):
    # quantitative: "min","max","mean","median","std","q1","q3","outlier_count","outlier_bounds":[lo,hi]  (3×IQR)
    # categorical/qualitative: "top_values":[{"value","count","pct"}], "high_cardinality": bool   (top_values only when low-cardinality)
    # date: "min_date","max_date","span_days"
}
```

### Public functions (units)
- `profile_column(series, role) -> ColumnProfile` — one column; role drives which role-specific fields are computed.
- `profile_table(df, questions) -> TableProfile` — one table: all columns + numeric correlations + duplicate info. Linkage columns (`_`-prefixed) get role `"linkage"` and minimal stats.
- `profile_dataset(cfg, main_df, repeat_tables) -> {name: TableProfile}` — main + every base table.
- Shared primitives reused by validate/summaries: `null_stats(series)`, `iqr_bounds(series, k=3.0)`, `numeric_outliers(series)`, `correlations(df, threshold)`.

---

## 5. Privacy-aware default

`top_values` is computed **only for low-cardinality columns** (≤ `LOW_CARDINALITY_MAX`, default **20** distinct). High-cardinality columns (free text, names, ids) get `high_cardinality: true` and **no** value samples. So the deterministic profile never surfaces individual PII values, consistent with the architecture's "PII before value-level exposure" principle. (The PII gate itself is Layer 3.)

---

## 6. The 3×IQR convergence (one intentional behavior change)

`validate.py` uses 3×IQR (documented: M&E surveys are legitimately skewed; 1.5× is too noisy). `summaries.py`'s `_data_quality_text` uses 1.5×. After convergence **both** route through `profile.iqr_bounds(k=3.0)`. This changes the outlier count reported in the `data_quality` summary block; the corresponding summaries test is updated to the 3× expectation. All other validate/summaries outputs are unchanged.

---

## 7. Web surface

- **`GET /api/profile`** — returns `{ "profiles": [TableProfile, ...] }` for the latest download session (read-only). On `FileNotFoundError` → `{ "profiles": [], "message": "No downloaded data. Run download first." }` (mirrors `/api/base-tables`). `load_config`/`load_processed_data` are already module-level in `web.main` (from the Layer 1 work).
- **Profile.jsx** — a dedicated, self-contained read-only "Profile" tab: one collapsible section per base table showing a column table (name, role, % missing, distinct, range or top-values, outlier count) and a small correlations list. No editing controls. *(Kept separate from the Validate tab for isolation/testability; the two are conceptually adjacent and may be merged in a later UI pass.)*

---

## 8. Error handling

Fail-soft, matching existing M&E-code convention. A column that cannot be fully profiled (all-null, type error, empty table) yields a partial `ColumnProfile` with the computable fields and skips the rest — it never aborts the table or dataset profile. `profile_dataset` always returns an entry for every base table (empty tables → `rows: 0`, empty `columns`).

---

## 9. Testing (TDD)

- `tests/test_profile.py` — `profile_column` per role (quantitative stats + 3×IQR outliers; categorical top_values + high-cardinality suppression; date min/max/span; undefined/linkage); `profile_table` (correlations, duplicates); `profile_dataset` over a multi-level base-table fixture; edge cases (all-null column, empty table, low- vs high-cardinality boundary at 20).
- Validate regression — after refactor, all existing `validate` tests stay green; add a test asserting `find_numeric_outliers` and `profile` agree on the bounds.
- Summaries — update the `data_quality` test to the 3×IQR expectation; confirm `_correlation_text` still narrates correctly off the shared primitive.
- `tests/test_profile_api.py` — `GET /api/profile` via monkeypatch (returns per-table profiles; no-data path returns empty + message).
- Full suite green (currently 156).

---

## 10. Risks & open questions

- **Behavior change visibility:** the 3×IQR convergence changes one summary block's numbers — intended and tested, but worth calling out in the PR.
- **Correlation cost** on wide numeric tables — cap to numeric columns and a sane pair limit; profile only, not per-render.
- **Cardinality threshold (20)** is a default; revisit if real forms have meaningful categoricals above it.
- **Frontend tab placement** — standalone "Profile" tab now; possible later merge with Validate.
