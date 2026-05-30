# Layer 3 — PII Gate Design

**Date:** 2026-05-30
**Status:** Design (approved) — precedes the implementation plan
**Roadmap:** Layer 3 of [the analyst-pipeline architecture](2026-05-30-analyst-pipeline-architecture.md). Builds on Layer 1 base tables (uses `_parent_index` linkage for repeat-orphan pruning). Closes the highest-confidence audit finding — flagged independently by the senior-dev, M&E, and pipeline-workflow reviews.

---

## 1. Goal

Make PII redaction and consent-gating a **property of every data export**, enforced **fail-closed**, so the primary data deliverable (CSV/JSON/XLSX/SQL/Supabase in `data/processed` and DB targets) is never raw or non-consented while a `pii:` block is configured.

---

## 2. Problem (current state on `main`)

- `apply_pii` runs only at **report/preview render time** (`builder.py:119` + 6 web endpoints). The `download`/`export_data` path applies **no** PII — so the exported dataset and DB/Supabase tables contain raw names, phones, GPS, and **non-consented** rows.
- `apply_consent` **fails open** ([pii.py:35-37](src/utils/pii.py#L35-L37)): a missing `consent_column` logs a warning and passes **all** rows through.
- `apply_redaction` **silently skips** a missing redact-target column ([pii.py:96](src/utils/pii.py#L96)) — the operator believes a column is redacted when it isn't.
- `apply_consent` filters only the main df; consent-rejected parents leave **orphaned repeat rows**.

## 3. Decisions

- **Redact at export:** `download` writes redacted, consent-gated data to disk/DB. `data/processed` is the clean artifact; reporting reads clean data.
- **Fail-closed at the gate:** a configured consent/redact column missing from the data → **abort with a clear error** (`PIIConfigError`). Nothing leaks while misconfigured.
- **Two-tier enforcement** (see §4): a strict gate at export; the existing lenient net at render stays unchanged.
- **Raw escape hatch:** an explicit, off-by-default `--no-redact` flag on `download` for secure internal use, with a prominent log warning. CLI-only (not exposed in the web UI's command flag whitelist).
- **Scope = enforcement core only.** Deferred to later specs: salted-hash / geo k-anonymity hardening, and PII auto-detection→confirm flow (`validate.find_potential_pii` already surfaces candidates in the Validate tab).

---

## 4. Two-tier architecture

```
                         raw submissions
                                │  (load → filters → computed columns)
                                ▼
   ┌─────────────────────  EXPORT GATE  ─────────────────────┐
   │ enforce_pii(df, repeats, cfg)   STRICT · FAIL-CLOSED      │   ← NEW (this spec)
   │   • enforce_consent (missing consent col → PIIConfigError)│
   │   • prune orphaned repeat rows (consent-rejected parents) │
   │   • enforce_redaction (missing redact col → PIIConfigError)│
   └──────────────────────────────┬──────────────────────────┘
                                   ▼
                 data/processed  +  DB / Supabase   (CLEAN artifact)
                                   │
                                   ▼  load_processed_data
                    report / preview / API consumers
                                   │
                   apply_pii(...)  LENIENT net  (UNCHANGED)            ← defense-in-depth
                                   ▼
                          .docx / preview JSON
```

**Why two tiers.** The export gate makes the at-rest artifact clean (the fix). The lenient render net (`apply_pii`, untouched) stays as defense-in-depth: it harmlessly re-applies to already-clean data (`drop` → skip; `mask`/`generalize_geo`/`generalize_date` are idempotent; only `hash` double-applies — a cosmetic, non-leaking difference across artifacts). Bonus: a `--no-redact` raw data file still gets lenient redaction when a **report** is built from it, so deliverables stay safe regardless. Fail-closed strictness lives at the gate — where raw data first exits — while render stays lenient because it sees already-gated data.

---

## 5. Components (Approach A — extend `src/utils/pii.py`)

### New in `src/utils/pii.py`
- `class PIIConfigError(ValueError)` — raised by the strict functions on a missing/misconfigured PII column.
- `enforce_consent(df, cfg) -> df` — strict. If `consent_column` configured but absent → raise `PIIConfigError`. Else keep rows where the column equals `consent_value` (default `"yes"`), reset index. No-op when no `consent_column`.
- `enforce_redaction(df, cfg) -> df` — strict. For each `redact` rule: if the target column is absent → raise `PIIConfigError`; if the strategy is unknown → raise `PIIConfigError` (an unrecognized strategy means PII is not actually redacted). Else apply the strategy (reusing the existing `_hash_value`/`_mask_value`/`_generalize_*` helpers). Returns a new DataFrame.
- `enforce_pii(df, repeat_tables, cfg) -> (df, repeats)` — orchestrates, in order:
  1. `enforce_consent(df)` on the main table.
  2. **Prune orphaned repeat rows:** resolve the main id column (`_id` → `_index` → `_uuid`); for each repeat table with a `_parent_index` column, keep only rows whose `_parent_index` is in the surviving main ids (leverages Layer 1 linkage).
  3. `enforce_redaction` on the main table and each repeat table.
  No-op (returns inputs unchanged) when `cfg["pii"]` is absent.

### Unchanged (the lenient render net)
- `apply_consent`, `apply_redaction`, `apply_pii`, `pii_summary` keep their current lenient behavior and signatures. All 7 render/preview call sites and their tests are untouched.

### `src/data/transform.py`
- `export_data(df, cfg, repeat_tables=None, redact=True)` — new `redact` param. At entry, when `redact` is true and a `pii:` block is configured: `df, repeat_tables = enforce_pii(df, repeat_tables, cfg)` before any file/SQL/Supabase write. The existing routing is unchanged.

### `src/data/make.py`
- `download` gains `--no-redact` (Click flag, default `False`). Passes `redact=not no_redact` to `export_data`.
- When `no_redact` is set: log a prominent warning (`⚠ RAW export: PII redaction & consent gating SKIPPED`).
- Wrap the export in a `try/except PIIConfigError` → log the actionable message and exit non-zero, so a misconfigured run aborts cleanly and the error surfaces in the web BottomTerminal run-log.

---

## 6. Web-first surfacing

No new UI component is required for the enforcement core. The fail-closed abort is surfaced through the **existing** SSE run-log: running `download` from the dashboard streams the `PIIConfigError` message and a non-zero exit (status=error) into the BottomTerminal. `--no-redact` is deliberately **not** added to `web/main.py`'s command-flag whitelist — raw export is a CLI-only advanced action. (A confirm/status UI belongs to the deferred auto-detection spec.)

---

## 7. Error handling

- The strict gate raises `PIIConfigError` (a `ValueError` subclass) with an actionable message naming the offending key, e.g. `pii.consent_column 'Consent' not found in data` or `pii.redact column 'Phone' not found in data`.
- `cmd_download` catches it, logs the message, and exits non-zero.
- The lenient render net keeps its current log-and-continue behavior (it operates on already-gated data).

---

## 8. Testing (TDD)

- `tests/test_pii_enforce.py` (new):
  - `enforce_consent`: configured-but-missing column → `PIIConfigError`; present → filters to consented rows; no consent col → no-op.
  - `enforce_redaction`: missing target column → `PIIConfigError`; unknown strategy → `PIIConfigError`; each strategy (drop/hash/mask/generalize_geo/generalize_date) applied correctly.
  - `enforce_pii`: prunes orphaned repeat rows for consent-rejected parents (uses `_parent_index`); no `pii:` block → returns inputs unchanged.
- `tests/test_export_pii.py` (new): `export_data(redact=True)` writes CSV that, on reload, has non-consented rows removed and redact columns redacted/dropped; `export_data(redact=False)` writes raw; no `pii:` block → unchanged output. Use `tmp_path`.
- `cmd_download --no-redact`: covered via the `export_data(redact=False)` path test (and a check that a configured-but-missing column with `redact=True` raises).
- **Regression:** the existing `tests/test_pii.py`, `tests/test_pii_e2e.py`, `tests/test_pii_endpoint.py`, `tests/test_provenance.py` stay green unchanged (lenient render net untouched).
- Full suite green.

---

## 9. Risks & open questions

- **Cosmetic double-redaction:** `hash` re-applied at render differs from the exported file's hash (both redacted; not a leak). Documented, accepted.
- **Existing raw sessions on disk:** sessions downloaded before this change remain raw at rest; the render net still redacts reports from them, but for a clean exported artifact they must be re-downloaded. Noted in the PR.
- **`redact=True` default could surprise callers** of `export_data` — but its only callers are in `cmd_download`, both updated here.
- **Computed columns** are derived before the gate (raw inputs), then redacted — correct: analysis-derived columns compute on raw, PII columns redact afterward.
