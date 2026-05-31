# Data Quality web panel — Design

**Date:** 2026-05-31
**Status:** Approved (brainstorming) — ready for implementation plan
**Track:** Analyst pipeline / data quality (Option A from STATUS.md). Closes the
"Web surface for the DQ overview" item in
[`../plans/STATUS.md`](../plans/STATUS.md).

---

## Goal

Mirror the report's Data Quality overview (`{{ data_quality }}`) into the web UI:
a per-column completeness / outlier-rate / duplicate-rate scorecard, surfaced as a
panel at the top of the **Validate** tab, backed by a new read-only
`GET /api/data-quality` endpoint.

This is web-first parity for an already-shipped report section — it adds **no new
analysis**, only a web surface for numbers `src/reports/data_quality.py` already
computes.

## Non-goals (explicitly deferred — see STATUS.md "Left")

- **Per-repeat-table DQ.** Main table only, consistent with the report today.
- **Table-level metrics** (% fully-complete rows, per-table duplicate rate).
- **Inter-enumerator variance.**
- Any change to the `{{ data_quality }}` report section's output contract.

---

## Architecture

Three changes, each independently testable.

### 1. Refactor `src/reports/data_quality.py` — compute numerics, format separately

Today `build_data_quality` returns **pre-formatted strings** (`"95.0%"`, `"—"`).
The web panel needs raw numbers to threshold-color and sort. Split the concerns:

- **New `compute_data_quality(cfg, main_df, repeat_tables) -> Dict`** — the
  numeric core. Same row selection (`_columns`) and per-column math (`_column_row`)
  as today, but each row is:

  ```python
  {"column": str,
   "completeness":   float | None,   # 0–100, None only if column has 0 rows
   "outlier_rate":   float | None,   # 0–100, None for non-numeric columns
   "duplicate_rate": float | None}   # 0–100, None if 0 rows
  ```

  Shape: `{"has_data": bool, "rows": [...]}`. A column that errors still yields a
  row with all three metrics `None` (current log-and-continue behavior preserved).

- **`build_data_quality` becomes a thin formatter** over `compute_data_quality`:
  maps each numeric → `"95.0%"` (one decimal) and `None` → `"—"` (`_DASH`). The
  `{{ data_quality }}` template contract and every existing report test stay
  byte-for-byte identical.

**Why:** one source of truth for the numbers; the report and the web differ only in
presentation. No duplicated per-column math.

### 2. New endpoint `GET /api/data-quality` (`web/main.py`)

Read-only. Same load path as the neighboring endpoints:

```
_load_cfg()  →  load_processed_data(cfg)  →  apply_pii(df, repeats, cfg)
             →  compute_data_quality(cfg, df, repeats)
```

- **Data present:** returns `compute_data_quality(...)` → `{has_data: true, rows: [...]}`.
- **No downloaded data** (`FileNotFoundError`): returns
  `{has_data: false, rows: [], message: "No downloaded data. Run download first."}`
  — graceful body, HTTP 200, mirroring `/api/profile` rather than the
  400 that `/api/validate` raises (a GET read of "current quality" should be
  empty-but-OK, not an error).
- PII redaction applied first, so the panel reflects the post-redaction view the
  user actually exports (no-op when `pii:` absent), matching `/api/validate`.

### 3. Validate tab panel — `frontend/src/components/DataQualityPanel.jsx`

- Rendered at the **top of [`Validate.jsx`](../../frontend/src/pages/Validate.jsx),
  before the findings list**. "Overview → then specific issues" reading order.
- **Independent fetch + state** — its own `useEffect` hitting `/api/data-quality`,
  with its own loading / empty / error states, so it never blocks or is blocked by
  the findings `POST /api/validate`.
- Renders a compact table: one row per column, three metric cells, **threshold-colored**:

  | metric | green | amber | red |
  |---|---|---|---|
  | completeness | ≥ 95% | 80–95% | < 80% |
  | outlier_rate | < 5% | 5–15% | > 15% |
  | duplicate_rate | < 5% | 5–15% | > 15% |

  `null` renders as a muted `—` (no color judgment).
- Columns **sortable by any metric**; default sort is worst-completeness-first (the
  useful triage order). Header click cycles asc/desc.
- `has_data: false` → a quiet "No downloaded data — run Download first" placeholder,
  not an error banner.
- Styles added to [`styles.css`](../../frontend/src/styles.css) following the
  existing `validate-finding` design-token style (`--danger`, `--warn`, `--ink-3`).

---

## Data flow

```
download → data/processed/*           (existing)
                │
   GET /api/data-quality
                │  _load_cfg → load_processed_data → apply_pii
                ▼
   compute_data_quality(cfg, df, repeats)   ← numeric core (new)
                │
                ▼
   { has_data, rows:[{column, completeness, outlier_rate, duplicate_rate}] }
                │
                ▼
   DataQualityPanel.jsx  → threshold-colored, sortable table
```

The report path is unchanged: `build_report` → `build_data_quality` (now a
formatter wrapping the same core) → `{{ data_quality }}`.

## Error handling

- One bad column never sinks the section: caught, logged, emitted as an all-`None`
  row (preserves today's behavior).
- No downloaded data: graceful `has_data:false` body (200), not an exception.
- Frontend fetch failure: panel shows its own inline error; findings list still
  renders.

## Testing

- **`compute_data_quality` unit tests:** numeric values returned; `outlier_rate is
  None` for a non-numeric column; `has_data:false` + `rows:[]` for empty/`None`
  frame; a column that raises yields an all-`None` row.
- **Regression test:** `build_data_quality` still emits the old string format
  (`"95.0%"` / `"—"`) — guards the template contract.
- **Endpoint test:** `200` with `has_data:true` + rows when processed data exists
  (existing fixtures); `has_data:false` + message when no data. Reuse the
  chdir-to-tmp + fixture pattern from the validate/profile endpoint tests.
- Follows the repo's TDD cycle (write failing test → implement → green).

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/reports/data_quality.py` | modify | Add `compute_data_quality` (numeric core); reduce `build_data_quality` to a formatter |
| `tests/test_data_quality.py` | modify/create | Numeric-core tests + string-format regression test |
| `web/main.py` | modify | Add `GET /api/data-quality` |
| `tests/` (endpoint test) | create/modify | Endpoint data-present / no-data tests |
| `frontend/src/components/DataQualityPanel.jsx` | create | Threshold-colored, sortable DQ table |
| `frontend/src/pages/Validate.jsx` | modify | Render panel above findings |
| `frontend/src/styles.css` | modify | Panel + threshold-cell styles |
| `CLAUDE.md` | modify | Note `/api/data-quality` + the Validate-tab panel |
