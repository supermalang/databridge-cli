# Layer 3 — PII Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PII redaction + consent-gating a fail-closed property of every data export, so `download` never writes raw or non-consented data while a `pii:` block is configured.

**Architecture:** Two-tier. A strict, fail-closed gate (`enforce_pii`) runs inside `export_data` — it `validate`s the PII config against the actual columns (global, multi-table aware), consent-gates the main table, prunes orphaned repeat rows, then applies redaction via the existing lenient `apply_redaction`. The 7 render-time `apply_pii` sites stay untouched as a defense-in-depth net. A `--no-redact` CLI flag opts out for secure internal use.

**Tech Stack:** Python 3, pandas, pytest, Click.

**Spec:** `docs/superpowers/specs/2026-05-30-layer3-pii-gate-design.md`. On `main`: Layers 1–2 merged; current suite 178 passing.

> **Refinement vs spec §5:** the spec listed strict `enforce_consent`/`enforce_redaction` helpers. This plan instead uses a strict global validator (`validate_pii_config`) + `enforce_pii` that reuses the existing lenient `apply_redaction` for per-table application. Same two-tier behavior and contracts; this decomposition correctly handles redact rules whose target column lives in only one table (main *or* a single repeat) without falsely aborting on the other tables.

---

## Backward-compatibility contract

- The lenient `apply_consent`, `apply_redaction`, `apply_pii`, `pii_summary` keep their current signatures and behavior. The 7 render/preview call sites and the existing PII tests (`test_pii.py`, `test_pii_e2e.py`, `test_pii_endpoint.py`, `test_provenance.py`) stay green **unchanged**.
- `export_data` gains a keyword-only-style `redact=True` default; existing positional calls keep working.
- When `cfg` has no `pii:` block, every new function is a no-op and export output is byte-identical to today.

---

## File structure

- **Modify:** `src/utils/pii.py` — add `PIIConfigError`, `validate_pii_config`, `enforce_pii`. Leave lenient functions untouched.
- **Modify:** `src/data/transform.py` — `export_data` gains `redact=True`; gates via `enforce_pii` at entry.
- **Modify:** `src/data/make.py` — `download` gains `--no-redact`; passes `redact` to the primary export; the `_run_classify` re-export passes `redact=False`; fail-closed abort surfaced.
- **Create:** `tests/test_pii_enforce.py`, `tests/test_export_pii.py`.
- **Modify:** `CLAUDE.md` — document the gate.

---

## Task 1: `PIIConfigError` + `validate_pii_config`

**Files:**
- Modify: `src/utils/pii.py`
- Test: `tests/test_pii_enforce.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pii_enforce.py
import pandas as pd
import pytest
from src.utils.pii import PIIConfigError, validate_pii_config


def _cfg(**pii):
    return {"pii": pii} if pii else {}


def test_validate_ok_when_columns_present():
    main = pd.DataFrame({"Consent": ["yes"], "Phone": ["123"]})
    cfg = _cfg(consent_column="Consent", redact=[{"column": "Phone", "strategy": "hash"}])
    assert validate_pii_config(main, {}, cfg) is None  # no raise


def test_validate_missing_consent_column_raises():
    main = pd.DataFrame({"Phone": ["123"]})
    cfg = _cfg(consent_column="Consent")
    with pytest.raises(PIIConfigError, match="consent_column 'Consent'"):
        validate_pii_config(main, {}, cfg)


def test_validate_missing_redact_column_everywhere_raises():
    main = pd.DataFrame({"Region": ["N"]})
    cfg = _cfg(redact=[{"column": "Phone", "strategy": "hash"}])
    with pytest.raises(PIIConfigError, match="redact column 'Phone'"):
        validate_pii_config(main, {}, cfg)


def test_validate_redact_column_in_repeat_is_ok():
    main = pd.DataFrame({"Region": ["N"]})
    repeats = {"household/members": pd.DataFrame({"MemberPhone": ["1"]})}
    cfg = _cfg(redact=[{"column": "MemberPhone", "strategy": "hash"}])
    assert validate_pii_config(main, repeats, cfg) is None  # present in a repeat → ok


def test_validate_unknown_strategy_raises():
    main = pd.DataFrame({"Phone": ["1"]})
    cfg = _cfg(redact=[{"column": "Phone", "strategy": "encrypt"}])
    with pytest.raises(PIIConfigError, match="unknown strategy 'encrypt'"):
        validate_pii_config(main, {}, cfg)


def test_validate_no_pii_block_is_noop():
    assert validate_pii_config(pd.DataFrame({"X": [1]}), {}, {}) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_pii_enforce.py -v`
Expected: FAIL — `ImportError: cannot import name 'PIIConfigError'`

- [ ] **Step 3: Write minimal implementation**

Add to `src/utils/pii.py` (after the existing imports / module constants, before `apply_consent`):

```python
class PIIConfigError(ValueError):
    """Raised by the strict PII gate when a configured consent/redact column is
    missing from the data, or a redaction strategy is unknown."""


_KNOWN_STRATEGIES = {"drop", "hash", "mask", "generalize_geo", "generalize_date"}


def validate_pii_config(df: pd.DataFrame, repeat_tables: Dict[str, pd.DataFrame], cfg: Dict) -> None:
    """Strict, fail-closed validation of the pii block against actual columns.

    Raises PIIConfigError when:
      - a configured consent_column is absent from the main table, or
      - a redact-target column is absent from BOTH the main table and every
        repeat table, or
      - a redact rule uses an unknown strategy.
    No-op when cfg has no pii block.
    """
    pii_cfg = cfg.get("pii") or {}
    if not pii_cfg:
        return None
    consent_col = pii_cfg.get("consent_column")
    if consent_col and consent_col not in df.columns:
        raise PIIConfigError(f"pii.consent_column '{consent_col}' not found in data")
    # A redact column may live in the main table or any repeat table.
    available = set(df.columns)
    for rdf in (repeat_tables or {}).values():
        available.update(rdf.columns)
    for rule in pii_cfg.get("redact") or []:
        col = rule.get("column")
        strategy = rule.get("strategy")
        if not col or col not in available:
            raise PIIConfigError(f"pii.redact column '{col}' not found in data")
        if strategy not in _KNOWN_STRATEGIES:
            raise PIIConfigError(f"pii.redact unknown strategy '{strategy}' for column '{col}'")
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_pii_enforce.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add src/utils/pii.py tests/test_pii_enforce.py
git commit -m "feat(pii): add PIIConfigError + strict validate_pii_config"
```

---

## Task 2: `enforce_pii` (strict gate orchestrator)

**Files:**
- Modify: `src/utils/pii.py`
- Test: `tests/test_pii_enforce.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_pii_enforce.py
from src.utils.pii import enforce_pii


def test_enforce_pii_consent_filters_and_redacts():
    main = pd.DataFrame({
        "_id": [1, 2, 3],
        "Consent": ["yes", "no", "yes"],
        "Name": ["A", "B", "C"],
        "Region": ["N", "S", "E"],
    })
    cfg = {"pii": {"consent_column": "Consent",
                   "redact": [{"column": "Name", "strategy": "drop"}]}}
    out, _ = enforce_pii(main, {}, cfg)
    assert list(out["_id"]) == [1, 3]          # non-consented row dropped
    assert "Name" not in out.columns            # dropped
    assert "Consent" in out.columns             # consent column retained


def test_enforce_pii_prunes_orphaned_repeat_rows():
    main = pd.DataFrame({"_id": [1, 2], "Consent": ["yes", "no"]})
    repeats = {"household/members": pd.DataFrame({
        "_parent_index": [1, 1, 2], "Member": ["a", "b", "c"],
    })}
    cfg = {"pii": {"consent_column": "Consent"}}
    _, out_repeats = enforce_pii(main, repeats, cfg)
    members = out_repeats["household/members"]
    # parent _id=2 was non-consented → its repeat row removed
    assert list(members["_parent_index"]) == [1, 1]


def test_enforce_pii_no_block_returns_inputs_unchanged():
    main = pd.DataFrame({"_id": [1, 2], "Name": ["A", "B"]})
    repeats = {"r": pd.DataFrame({"_parent_index": [1], "X": [9]})}
    out, out_r = enforce_pii(main, repeats, {})
    assert list(out["Name"]) == ["A", "B"]
    assert list(out_r["r"]["X"]) == [9]


def test_enforce_pii_misconfig_raises():
    main = pd.DataFrame({"_id": [1], "Region": ["N"]})
    cfg = {"pii": {"consent_column": "Consent"}}  # Consent not present
    with pytest.raises(PIIConfigError):
        enforce_pii(main, {}, cfg)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_pii_enforce.py::test_enforce_pii_consent_filters_and_redacts -v`
Expected: FAIL — `ImportError: cannot import name 'enforce_pii'`

- [ ] **Step 3: Write minimal implementation**

Add to `src/utils/pii.py` (after `validate_pii_config`; it reuses the existing lenient `apply_redaction`):

```python
def enforce_pii(df: pd.DataFrame, repeat_tables: Dict[str, pd.DataFrame], cfg: Dict) -> Tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
    """Strict, fail-closed PII gate for the EXPORT boundary.

    Order: validate config (raises PIIConfigError on misconfig) → consent-gate
    the main table → prune orphaned repeat rows whose parent was filtered out →
    apply redaction (via the lenient per-table apply_redaction). No-op when cfg
    has no pii block.
    """
    repeat_tables = repeat_tables or {}
    if not (cfg.get("pii") or {}):
        return df, repeat_tables
    validate_pii_config(df, repeat_tables, cfg)

    pii_cfg = cfg["pii"]
    consent_col = pii_cfg.get("consent_column")
    gated = df
    if consent_col:
        expected = pii_cfg.get("consent_value", _DEFAULT_CONSENT_VALUE)
        mask = df[consent_col].astype(str).str.strip() == str(expected)
        gated = df[mask].reset_index(drop=True)

    # Prune orphaned repeat rows (parent submission filtered out by consent).
    id_col = next((c for c in ("_id", "_index", "_uuid") if c in gated.columns), None)
    pruned: Dict[str, pd.DataFrame] = {}
    surviving = set(gated[id_col]) if id_col is not None else None
    for name, rdf in repeat_tables.items():
        if surviving is not None and "_parent_index" in rdf.columns:
            rdf = rdf[rdf["_parent_index"].isin(surviving)]
        pruned[name] = rdf

    out_df = apply_redaction(gated, cfg)
    out_repeats = {name: apply_redaction(rdf, cfg) for name, rdf in pruned.items()}
    return out_df, out_repeats
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_pii_enforce.py -v`
Expected: PASS (10 passed)

- [ ] **Step 5: Commit**

```bash
git add src/utils/pii.py tests/test_pii_enforce.py
git commit -m "feat(pii): add fail-closed enforce_pii gate (consent + orphan pruning + redaction)"
```

---

## Task 3: Gate inside `export_data`

**Files:**
- Modify: `src/data/transform.py` (`export_data`, line ~384)
- Test: `tests/test_export_pii.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_export_pii.py
import pandas as pd
import pytest
from src.data.transform import export_data, load_processed_data
from src.utils.pii import PIIConfigError


def _cfg(tmp_path, **pii):
    cfg = {"form": {"alias": "survey"},
           "export": {"format": "csv", "output_dir": str(tmp_path)}}
    if pii:
        cfg["pii"] = pii
    return cfg


def test_export_redacts_and_consent_gates_by_default(tmp_path):
    df = pd.DataFrame({
        "_id": [1, 2, 3],
        "Consent": ["yes", "no", "yes"],
        "Name": ["A", "B", "C"],
        "Region": ["N", "S", "E"],
    })
    cfg = _cfg(tmp_path, consent_column="Consent",
               redact=[{"column": "Name", "strategy": "drop"}])
    export_data(df, cfg)                      # redact defaults True
    reloaded, _ = load_processed_data(cfg)
    assert len(reloaded) == 2                  # non-consented row gone
    assert "Name" not in reloaded.columns      # dropped


def test_export_raw_when_redact_false(tmp_path):
    df = pd.DataFrame({"_id": [1, 2], "Consent": ["yes", "no"], "Name": ["A", "B"]})
    cfg = _cfg(tmp_path, consent_column="Consent",
               redact=[{"column": "Name", "strategy": "drop"}])
    export_data(df, cfg, redact=False)
    reloaded, _ = load_processed_data(cfg)
    assert len(reloaded) == 2                  # not consent-gated
    assert "Name" in reloaded.columns          # not dropped


def test_export_no_pii_block_unchanged(tmp_path):
    df = pd.DataFrame({"_id": [1, 2], "Region": ["N", "S"]})
    cfg = _cfg(tmp_path)
    export_data(df, cfg)
    reloaded, _ = load_processed_data(cfg)
    assert len(reloaded) == 2 and "Region" in reloaded.columns


def test_export_fail_closed_on_missing_column(tmp_path):
    df = pd.DataFrame({"_id": [1], "Region": ["N"]})
    cfg = _cfg(tmp_path, consent_column="Consent")   # Consent absent
    with pytest.raises(PIIConfigError):
        export_data(df, cfg)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_export_pii.py -v`
Expected: FAIL — `TypeError: export_data() got an unexpected keyword argument 'redact'` (and the default-redaction assertions fail).

- [ ] **Step 3: Modify `export_data`**

In `src/data/transform.py`, change the `export_data` signature and add the gate at entry. Current:
```python
def export_data(df: pd.DataFrame, cfg: Dict, repeat_tables: Dict[str, pd.DataFrame] = None) -> None:
    fmt = cfg.get("export", {}).get("format", "csv")
```
becomes:
```python
def export_data(df: pd.DataFrame, cfg: Dict, repeat_tables: Dict[str, pd.DataFrame] = None, redact: bool = True) -> None:
    # PII gate: redact + consent-gate at the export boundary (fail-closed).
    # redact=False is the explicit raw escape hatch (download --no-redact) and is
    # also used when re-exporting already-gated data (e.g. after classification).
    if redact:
        from src.utils.pii import enforce_pii
        df, repeat_tables = enforce_pii(df, repeat_tables, cfg)
    fmt = cfg.get("export", {}).get("format", "csv")
```
Leave the rest of `export_data` (the `_export_file`/`_export_sql`/`_export_supabase` routing) unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_export_pii.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `PYTHONPATH=. python -m pytest tests/ -q`
Expected: all pass (was 178; now 178 + new pii_enforce/export_pii tests). Existing PII render tests stay green (lenient path untouched). Report the count.

- [ ] **Step 6: Commit**

```bash
git add src/data/transform.py tests/test_export_pii.py
git commit -m "feat(transform): gate export_data with fail-closed PII enforcement (redact=True default)"
```

---

## Task 4: Wire `--no-redact` into `download`; keep classify re-export ungated; surface abort

**Files:**
- Modify: `src/data/make.py` (`cmd_download` ~line 185-217; `_run_classify` export call ~line 181)
- Test: `tests/test_export_pii.py` (add a re-gate-safety test)

- [ ] **Step 1: Write the failing test** (proves re-exporting already-gated data with `redact=False` does not abort, mirroring the classify re-export)

```python
# add to tests/test_export_pii.py
def test_reexport_already_gated_data_with_redact_false_is_safe(tmp_path):
    # Simulates _run_classify re-exporting data whose 'Name' column was already
    # dropped at the primary gated export. A strict re-gate would raise; redact=False must not.
    cfg = _cfg(tmp_path, consent_column="Consent",
               redact=[{"column": "Name", "strategy": "drop"}])
    already_gated = pd.DataFrame({"_id": [1], "Consent": ["yes"], "Region": ["N"]})  # Name already gone
    export_data(already_gated, cfg, redact=False)   # must NOT raise PIIConfigError
    reloaded, _ = load_processed_data(cfg)
    assert "Region" in reloaded.columns
```

- [ ] **Step 2: Run test to verify it passes (contract pin)**

Run: `PYTHONPATH=. python -m pytest tests/test_export_pii.py::test_reexport_already_gated_data_with_redact_false_is_safe -v`
Expected: PASS already (Task 3's `redact=False` skips the gate). This pins the behavior the make.py change below depends on.

- [ ] **Step 3: Edit `cmd_download` in `src/data/make.py`**

Add the flag to the command decorator block (after the `--period` option):
```python
@click.option("--no-redact", is_flag=True, default=False,
              help="RAW export: skip PII redaction & consent gating (internal/secure use only).")
```
Change the function signature `def cmd_download(sample, period):` to:
```python
def cmd_download(sample, period, no_redact):
```
Replace the primary export call (currently `export_data(df, cfg, repeat_tables)`) with:
```python
        if no_redact:
            log.warning("⚠ RAW export: PII redaction & consent gating SKIPPED (--no-redact).")
        try:
            export_data(df, cfg, repeat_tables, redact=not no_redact)
        except PIIConfigError as e:
            click.echo(f"PII config error — export aborted: {e}", err=True)
            sys.exit(1)
```
Add the import for `PIIConfigError` to the function's local import line. Current:
```python
    from src.data.transform import load_data, apply_filters, apply_computed_columns, export_data
```
becomes:
```python
    from src.data.transform import load_data, apply_filters, apply_computed_columns, export_data
    from src.utils.pii import PIIConfigError
```

- [ ] **Step 4: Make the classify re-export ungated**

In `_run_classify` (`src/data/make.py`), the data it reloads from disk was already gated by the primary export, so it must not be re-gated. Change its export call (currently `export_data(df, cfg)`, ~line 181) to:
```python
    export_data(df, cfg, redact=False)   # data was already PII-gated at the primary export
```

- [ ] **Step 5: Run the full suite**

Run: `PYTHONPATH=. python -m pytest tests/ -q`
Expected: all pass. The `cmd_download` wiring is thin glue; the gate behavior is covered by `tests/test_export_pii.py`. Confirm no regressions and report the count.

- [ ] **Step 6: Sanity-check the CLI flag parses**

Run: `PYTHONPATH=. python src/data/make.py download --help`
Expected: the help text lists `--no-redact` with its description (confirms the Click wiring is valid). No download is performed.

- [ ] **Step 7: Commit**

```bash
git add src/data/make.py tests/test_export_pii.py
git commit -m "feat(download): --no-redact escape hatch; keep classify re-export ungated; abort on PII misconfig"
```

---

## Task 5: Document the PII gate

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the PII section in CLAUDE.md**

Find the `pii:` documentation (the config-annotated section and/or any "PII redaction" note). Add this subsection in the "Key implementation details" area (after the `### Data profiling` subsection added in Layer 2):

```markdown
### PII gate (src/utils/pii.py)
PII has two tiers:
- **Strict export gate** — `enforce_pii` runs inside `export_data` (default `redact=True`).
  It `validate_pii_config` (fail-closed: a configured `consent_column` or `redact`
  column missing from the data, or an unknown strategy, raises `PIIConfigError` and
  aborts the download), consent-gates the main table, prunes orphaned repeat rows
  (parents filtered out by consent, via `_parent_index`), then applies redaction.
  So `data/processed` + DB/Supabase are always redacted + consent-gated.
- **Lenient render net** — the existing `apply_pii` still runs at report/preview time
  as defense-in-depth (log-and-skip on missing columns); it operates on already-gated data.

`download --no-redact` is an explicit, off-by-default escape hatch that writes RAW data
(internal/secure use only) and logs a warning; it is CLI-only (not exposed in the web UI).
Reports built from a raw session are still redacted by the lenient render net.
```

- [ ] **Step 2: Verify the documented behavior matches the code**

Run: `PYTHONPATH=. python -m pytest tests/ -q`
Expected: full suite green.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the two-tier PII gate and --no-redact"
```

---

## Self-review notes

- **Spec coverage:** redact-at-export (Task 3) ✓; fail-closed abort (Tasks 1–4, `PIIConfigError`) ✓; two-tier — strict gate added, lenient render net untouched (no edits to the 7 `apply_pii` sites) ✓; repeat-orphan pruning (Task 2) ✓; `--no-redact` escape hatch + CLI-only + classify re-export ungated (Task 4) ✓; abort surfaces in run-log via non-zero exit (Task 4) ✓; docs (Task 5) ✓. Deferred items (hashing hardening, auto-detection) are correctly **not** in any task.
- **Type/name consistency:** `PIIConfigError`, `validate_pii_config(df, repeat_tables, cfg)`, `enforce_pii(df, repeat_tables, cfg) -> (df, repeats)`, `_KNOWN_STRATEGIES`, and `export_data(..., redact=True)` are used identically across tasks. `enforce_pii` reuses the existing `apply_redaction` and `_DEFAULT_CONSENT_VALUE`.
- **No placeholders:** every code/command step is complete.
- **Behavior change:** `export_data` now redacts by default — its only callers are in `make.py`, both updated (primary gated; classify re-export `redact=False`).
