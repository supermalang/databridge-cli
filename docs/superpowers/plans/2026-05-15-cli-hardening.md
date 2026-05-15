# CLI Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the weak spots in the Python CLI surface (no tests, no packaging, fragile HTTP, silent data-pipeline failures, opaque SQL writes, no `--config` flag) without breaking any existing user-facing behavior.

**Architecture:** Add a `pyproject.toml` + `tests/` foundation, then layer in defensive improvements one at a time — HTTP retries via a `requests.Session`, an opt-in `strict` mode that converts silent warnings into errors for filters / computed columns / views / schema drift, a `--config` flag, and an explicit `if_exists` option on SQL exports. Each change is TDD-driven and back-compat by default — opt-in to the stricter behavior.

**Tech Stack:** Python 3.11+, click, pandas, pytest, responses (HTTP mocking), sqlalchemy (sqlite for SQL tests), urllib3 Retry adapter.

---

## File Structure

**New files:**
- `pyproject.toml` — packaging, console_script entry, pytest config
- `tests/__init__.py`
- `tests/conftest.py` — shared fixtures (sample asset schema, sample submissions, sample questions config)
- `tests/data/__init__.py`
- `tests/data/test_transform.py` — covers load_data, apply_filters, apply_computed_columns, build_views, strict-mode behaviors, schema-drift report
- `tests/data/test_extract.py` — covers HTTP Session, retry/backoff
- `tests/data/test_export.py` — covers SQL `if_exists` option
- `tests/cli/__init__.py`
- `tests/cli/test_config_flag.py` — covers `--config` CLI flag

**Modified files:**
- `src/data/extract.py` — replace per-request `requests.get` with a Session + Retry adapter
- `src/data/transform.py` — add `strict` arg to `apply_filters`, `apply_computed_columns`, `build_views`; `load_data` attaches a schema-match report dict to `df.attrs`
- `src/data/make.py` — add global `--config` and `--strict` options; thread them via Click context
- `src/utils/config.py` — keep `CONFIG_PATH` constant; `load_config(path)` already accepts a path arg, no change needed beyond callers
- `requirements.txt` — leave intact (back-compat); pyproject.toml is the canonical source going forward

---

## Conventions used in this plan

- **Commits per task.** Each task ends with a single commit. Message style: `feat:`, `test:`, `chore:`, `fix:` prefix.
- **Run from project root.** All paths and shell commands assume cwd is `/workspaces/databridge-cli`.
- **Python invocation.** Use `pytest` directly after Task 1 (the editable install puts the package on `sys.path`). Until Task 1 lands, the project uses `PYTHONPATH=. python3 src/data/make.py …`.
- **Existing CLI behavior must not regress.** Every new flag/option defaults to today's behavior. Strict mode is opt-in.

---

## Task 1: Bootstrap packaging + test infrastructure

**Files:**
- Create: `pyproject.toml`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`
- Create: `tests/data/__init__.py`
- Create: `tests/cli/__init__.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "kobo-reporter"
version = "0.1.0"
description = "CLI + web tool to fetch Kobo/Ona survey data and generate Word reports."
requires-python = ">=3.11"
dependencies = [
    "requests>=2.31.0",
    "pyyaml>=6.0",
    "python-dotenv>=1.0.0",
    "pandas>=2.0.0",
    "numpy>=1.25.0",
    "openpyxl>=3.1.0",
    "matplotlib>=3.8.0",
    "squarify>=0.4.3",
    "python-docx>=1.1.0",
    "docxtpl>=0.16.0",
    "click>=8.1.0",
    "fastapi>=0.111.0",
    "uvicorn[standard]>=0.29.0",
    "python-multipart>=0.0.9",
    "aiofiles>=23.2.1",
    "anthropic>=0.20.0",
]

[project.optional-dependencies]
db = ["sqlalchemy>=2.0.0", "psycopg2-binary>=2.9.0", "pymysql>=1.1.0", "supabase>=2.0.0"]
maps = ["contextily>=1.6.0", "pyproj>=3.6.0"]
ai-openai = ["openai>=1.0.0"]
dev = ["pytest>=8.0", "responses>=0.25.0", "sqlalchemy>=2.0.0"]

[project.scripts]
kobo-reporter = "src.data.make:cli"

[tool.setuptools.packages.find]
include = ["src*", "web*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
addopts = "-ra --strict-markers"
```

- [ ] **Step 2: Create empty `tests/__init__.py`, `tests/data/__init__.py`, `tests/cli/__init__.py`**

All three files: empty (zero bytes).

- [ ] **Step 3: Create `tests/conftest.py` with shared fixtures**

```python
"""Shared fixtures for kobo-reporter tests."""
from copy import deepcopy
import pytest


@pytest.fixture
def kobo_asset():
    """A small but realistic Kobo asset schema: 1 main group + 1 repeat group."""
    return {
        "content": {
            "survey": [
                {"type": "text", "name": "respondent_name", "label": "Respondent name"},
                {"type": "begin_group", "name": "demographics"},
                {"type": "select_one regions", "name": "region", "label": "Region"},
                {"type": "integer", "name": "age", "label": "Age"},
                {"type": "end_group"},
                {"type": "begin_repeat", "name": "household_members"},
                {"type": "text", "name": "member_name", "label": "Name"},
                {"type": "select_multiple skills", "name": "skills", "label": "Skills"},
                {"type": "end_repeat"},
            ],
            "choices": [
                {"list_name": "regions", "name": "north", "label": "North"},
                {"list_name": "regions", "name": "south", "label": "South"},
                {"list_name": "skills", "name": "cook", "label": "Cooking"},
                {"list_name": "skills", "name": "farm", "label": "Farming"},
            ],
        }
    }


@pytest.fixture
def submissions():
    """Sample submissions matching kobo_asset: 2 respondents with repeat-group rows."""
    return [
        {
            "_id": 1,
            "respondent_name": "Alice",
            "demographics/region": "north",
            "demographics/age": 30,
            "household_members": [
                {"household_members/member_name": "Bob", "household_members/skills": "cook farm"},
                {"household_members/member_name": "Carol", "household_members/skills": "cook"},
            ],
        },
        {
            "_id": 2,
            "respondent_name": "Dave",
            "demographics/region": "south",
            "demographics/age": 45,
            "household_members": [
                {"household_members/member_name": "Eve", "household_members/skills": "farm"},
            ],
        },
    ]


@pytest.fixture
def config():
    """Sample config matching the asset + submissions fixtures.

    Tests can deepcopy and mutate.
    """
    return deepcopy({
        "api": {"platform": "kobo", "url": "https://example.test/api/v2", "token": "test-token"},
        "form": {"uid": "TESTFORM", "alias": "test"},
        "questions": [
            {"kobo_key": "respondent_name", "label": "Respondent name", "type": "text",
             "category": "qualitative", "group": "", "choice_list": None,
             "export_label": "Respondent", "repeat_group": None, "choices": None},
            {"kobo_key": "demographics/region", "label": "Region", "type": "select_one",
             "category": "categorical", "group": "demographics", "choice_list": "regions",
             "export_label": "Region", "repeat_group": None,
             "choices": {"north": "North", "south": "South"}},
            {"kobo_key": "demographics/age", "label": "Age", "type": "integer",
             "category": "quantitative", "group": "demographics", "choice_list": None,
             "export_label": "Age", "repeat_group": None, "choices": None},
            {"kobo_key": "household_members/member_name", "label": "Name", "type": "text",
             "category": "qualitative", "group": "household_members", "choice_list": None,
             "export_label": "Member name", "repeat_group": "household_members", "choices": None},
            {"kobo_key": "household_members/skills", "label": "Skills", "type": "select_multiple",
             "category": "categorical", "group": "household_members", "choice_list": "skills",
             "export_label": "Skills", "repeat_group": "household_members",
             "choices": {"cook": "Cooking", "farm": "Farming"}},
        ],
        "filters": [],
        "computed_columns": [],
        "views": [],
        "export": {"format": "csv", "output_dir": "data/processed"},
    })
```

- [ ] **Step 4: Install dev deps**

Run: `pip install -e '.[dev]'`
Expected: ends with `Successfully installed kobo-reporter-0.1.0`. The new console script `kobo-reporter` is now on PATH.

- [ ] **Step 5: Verify pytest discovers an empty test suite**

Run: `pytest`
Expected: exit code 5 (no tests collected) with message `no tests ran in …s`. This confirms config is wired.

- [ ] **Step 6: Verify the console script works**

Run: `kobo-reporter --help`
Expected: prints `Usage: kobo-reporter [OPTIONS] COMMAND [ARGS]…` and lists the existing 5 commands (`fetch-questions`, `generate-template`, `ai-generate-template`, `suggest-charts`, `download`, `list-sessions`, `build-report`).

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml tests/
git commit -m "chore: add pyproject.toml, console_script, and pytest scaffolding"
```

---

## Task 2: Baseline integration tests for the transform pipeline

Locks in current behavior before we refactor anything. If any of these later fail, it's a regression.

**Files:**
- Create: `tests/data/test_transform.py`

- [ ] **Step 1: Write failing tests for `load_data`**

```python
"""Tests for src.data.transform — load_data / filters / computed_columns / views."""
import pandas as pd
import pytest

from src.data.transform import (
    apply_computed_columns,
    apply_filters,
    build_views,
    load_data,
)


def test_load_data_returns_main_df_and_repeat_tables(config, submissions):
    df, repeats = load_data(submissions, config)
    # Main table: 2 rows, columns include _id + export_labels
    assert len(df) == 2
    assert set(df.columns) >= {"_id", "Respondent", "Region", "Age"}
    # Repeat table is keyed by the full slash-path
    assert "household_members" in repeats
    assert len(repeats["household_members"]) == 3


def test_load_data_decodes_select_one_choice_labels(config, submissions):
    df, _ = load_data(submissions, config)
    assert sorted(df["Region"].tolist()) == ["North", "South"]


def test_load_data_decodes_select_multiple_with_pipe_separator(config, submissions):
    _, repeats = load_data(submissions, config)
    skills = repeats["household_members"]["Skills"].tolist()
    # "cook farm" → "Cooking | Farming"; "cook" → "Cooking"; "farm" → "Farming"
    assert "Cooking | Farming" in skills
    assert "Cooking" in skills
    assert "Farming" in skills


def test_load_data_casts_quantitative_columns_to_numeric(config, submissions):
    df, _ = load_data(submissions, config)
    assert pd.api.types.is_numeric_dtype(df["Age"])
```

- [ ] **Step 2: Run tests to verify they pass against current code**

Run: `pytest tests/data/test_transform.py -v`
Expected: 4 passed. (These cover current behavior — they exist as a safety net for later refactors.)

- [ ] **Step 3: Add filter + computed-column + view tests**

Append to `tests/data/test_transform.py`:

```python
def test_apply_filters_with_valid_expression(config, submissions):
    df, repeats = load_data(submissions, config)
    config["filters"] = ["Age >= 35"]
    df2, _ = apply_filters(df, config, repeats)
    assert len(df2) == 1
    assert df2.iloc[0]["Respondent"] == "Dave"


def test_apply_filters_removes_orphan_repeat_rows(config, submissions):
    df, repeats = load_data(submissions, config)
    config["filters"] = ["Age >= 35"]
    _, filtered_repeats = apply_filters(df, config, repeats)
    # Only Dave (id 2) survives; his single household member is kept; Alice's 2 are dropped
    assert len(filtered_repeats["household_members"]) == 1


def test_apply_computed_columns_repeat_aggregation_sum(config, submissions):
    df, repeats = load_data(submissions, config)
    config["computed_columns"] = [
        {"name": "household_size", "from_repeat": "household_members", "question": "count"},
    ]
    out = apply_computed_columns(df, config, repeats)
    # Alice has 2 household members, Dave has 1
    assert out.set_index("Respondent")["household_size"].to_dict() == {"Alice": 2, "Dave": 1}


def test_build_views_filter_and_group(config, submissions):
    df, repeats = load_data(submissions, config)
    config["views"] = [
        {
            "name": "members_per_region",
            "source": "household_members",
            "join_parent": ["Region"],
            "group_by": "Region",
            "question": "Member name",
            "agg": "count",
        }
    ]
    views = build_views(config, df, repeats)
    assert "members_per_region" in views
    out = views["members_per_region"].set_index("Region")["Member name"].to_dict()
    assert out == {"North": 2, "South": 1}
```

- [ ] **Step 4: Run the new tests**

Run: `pytest tests/data/test_transform.py -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add tests/data/test_transform.py
git commit -m "test: add baseline integration tests for transform pipeline"
```

---

## Task 3: HTTP Session + retry/backoff in DataClient

**Files:**
- Create: `tests/data/test_extract.py`
- Modify: `src/data/extract.py`

- [ ] **Step 1: Write failing test for retry behavior**

```python
"""Tests for src.data.extract — HTTP retry, Session reuse, pagination."""
import pytest
import responses

from src.data.extract import KoboClient


@pytest.fixture
def kobo_cfg():
    return {
        "api": {"platform": "kobo", "url": "https://example.test/api/v2", "token": "test"},
        "form": {"uid": "FORM1"},
    }


@responses.activate
def test_get_retries_on_503_then_succeeds(kobo_cfg):
    url = "https://example.test/api/v2/assets/FORM1/data/"
    # Two 503s, then 200 — retry logic should follow through.
    responses.add(responses.GET, url, status=503)
    responses.add(responses.GET, url, status=503)
    responses.add(responses.GET, url, json={"results": [], "count": 0, "next": None}, status=200)

    client = KoboClient(kobo_cfg)
    result = client.get_submissions()

    assert result == []
    assert len(responses.calls) == 3


@responses.activate
def test_get_gives_up_after_max_retries(kobo_cfg):
    url = "https://example.test/api/v2/assets/FORM1/data/"
    for _ in range(10):
        responses.add(responses.GET, url, status=503)

    client = KoboClient(kobo_cfg)
    with pytest.raises(Exception):  # urllib3 raises MaxRetryError wrapped as RetryError
        client.get_submissions()


@responses.activate
def test_session_is_reused_across_pages(kobo_cfg):
    url = "https://example.test/api/v2/assets/FORM1/data/"
    responses.add(responses.GET, url, json={"results": [{"_id": 1}], "count": 2, "next": "x"}, status=200)
    responses.add(responses.GET, url, json={"results": [{"_id": 2}], "count": 2, "next": None}, status=200)

    client = KoboClient(kobo_cfg)
    client.get_submissions()

    # Same Session object should have been used for both requests
    assert client.session is not None
    assert len(responses.calls) == 2
```

- [ ] **Step 2: Run test, verify failure**

Run: `pytest tests/data/test_extract.py -v`
Expected: failures — current code has no `.session` attribute, no retry on 503 (a single 503 would raise immediately).

- [ ] **Step 3: Modify `DataClient` to use a Session + Retry adapter**

Replace [src/data/extract.py:11-41](src/data/extract.py#L11-L41) (the `DataClient` class body up to and including `_get`) with:

```python
class DataClient:
    """Base class for Kobo / Ona API clients."""

    RETRY_STATUSES = (429, 500, 502, 503, 504)
    RETRY_TOTAL = 5
    RETRY_BACKOFF = 1.0  # 1s, 2s, 4s, 8s, 16s

    def __init__(self, cfg: Dict):
        api = cfg.get("api", {})
        self.platform = api.get("platform", "kobo").lower()
        if self.platform not in SUPPORTED_PLATFORMS:
            raise ValueError(
                f"api.platform must be one of {SUPPORTED_PLATFORMS}, got '{self.platform}'"
            )
        self.base_url = api.get("url", "").rstrip("/")
        self.token = api.get("token", "")
        if not self.base_url or not self.token:
            raise ValueError("api.url and api.token must be set in config.yml")
        self.headers = {"Authorization": f"Token {self.token}"}
        self.timeout = api.get("timeout", DEFAULT_TIMEOUT)
        self.form_uid = cfg.get("form", {}).get("uid", "")
        if not self.form_uid:
            raise ValueError("form.uid must be set in config.yml")
        self.session = self._build_session()

    def _build_session(self) -> requests.Session:
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry

        retry = Retry(
            total=self.RETRY_TOTAL,
            backoff_factor=self.RETRY_BACKOFF,
            status_forcelist=self.RETRY_STATUSES,
            allowed_methods=frozenset(["GET"]),
            raise_on_status=True,
        )
        adapter = HTTPAdapter(max_retries=retry)
        s = requests.Session()
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        s.headers.update(self.headers)
        return s

    def get_form_schema(self) -> Dict:
        raise NotImplementedError

    def get_submissions(self, sample_size: Optional[int] = None) -> List[Dict]:
        raise NotImplementedError

    def _get(self, endpoint: str, params: Dict = None) -> Any:
        url = f"{self.base_url}/{endpoint}"
        resp = self.session.get(url, params=params or {}, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()
```

Also update the imports at the top of [src/data/extract.py:1-3](src/data/extract.py#L1-L3):

```python
import logging
from typing import Any, Dict, List, Optional
import requests
```

(adds `Any` to the typing import — the `-> any` annotation in current code is a bug; should be `Any`).

- [ ] **Step 4: Run tests, verify pass**

Run: `pytest tests/data/test_extract.py -v`
Expected: 3 passed.

Also re-run transform tests to confirm no regression: `pytest tests/data/test_transform.py -v` → 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/data/extract.py tests/data/test_extract.py
git commit -m "feat(extract): use requests.Session with retry/backoff on 5xx and 429"
```

---

## Task 4: Strict mode for filters

Add an opt-in `strict` flag. When `strict=True`, a failing filter raises instead of logging a warning. Default behavior unchanged.

**Files:**
- Modify: `src/data/transform.py` — `apply_filters` gains a `strict` kwarg
- Modify: `tests/data/test_transform.py` — add strict-mode tests

- [ ] **Step 1: Write failing tests**

Append to `tests/data/test_transform.py`:

```python
def test_apply_filters_lenient_mode_warns_on_bad_filter(config, submissions, caplog):
    df, repeats = load_data(submissions, config)
    config["filters"] = ["NonexistentColumn > 0"]
    import logging
    with caplog.at_level(logging.WARNING):
        df2, _ = apply_filters(df, config, repeats)  # default: strict=False
    assert len(df2) == 2  # filter silently skipped
    assert any("NonexistentColumn" in r.message for r in caplog.records)


def test_apply_filters_strict_mode_raises_on_bad_filter(config, submissions):
    df, repeats = load_data(submissions, config)
    config["filters"] = ["NonexistentColumn > 0"]
    with pytest.raises(ValueError, match="NonexistentColumn"):
        apply_filters(df, config, repeats, strict=True)
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/data/test_transform.py::test_apply_filters_strict_mode_raises_on_bad_filter -v`
Expected: FAIL — `apply_filters` doesn't accept a `strict` kwarg yet.

- [ ] **Step 3: Modify `apply_filters` to accept `strict`**

Replace [src/data/transform.py:227-257](src/data/transform.py#L227-L257) with:

```python
def apply_filters(
    df: pd.DataFrame,
    cfg: Dict,
    repeat_tables: Dict[str, pd.DataFrame] = None,
    *,
    strict: bool = False,
) -> Tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
    """Apply filters to main table and remove orphaned repeat rows.

    Args:
        strict: When True, a filter that fails to evaluate (bad column, syntax,
                etc.) raises ValueError. When False (default), the failure is
                logged as a warning and the filter is skipped.
    """
    if repeat_tables is None:
        repeat_tables = {}
    filters: List[str] = cfg.get("filters", [])
    if not filters:
        return df, repeat_tables
    original = len(df)
    for condition in filters:
        try:
            df = df.query(condition)
            log.info(f"  Filter '{condition}' → {len(df)} rows")
        except Exception as e:
            msg = f"Filter '{condition}' failed: {e}"
            if strict:
                raise ValueError(msg) from e
            log.warning(f"  {msg} — skipped")
    log.info(f"Filters applied: {original} → {len(df)} rows")
    # Remove orphaned repeat rows whose parent was filtered out
    id_col = None
    for candidate in ("_id", "_index", "_uuid"):
        if candidate in df.columns:
            id_col = candidate
            break
    if id_col and repeat_tables:
        surviving_ids = set(df[id_col])
        for name, rdf in repeat_tables.items():
            before = len(rdf)
            rdf = rdf[rdf["_parent_index"].isin(surviving_ids)]
            repeat_tables[name] = rdf
            if before != len(rdf):
                log.info(f"  Repeat '{name}': {before} → {len(rdf)} rows (orphans removed)")
    return df, repeat_tables
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/data/test_transform.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/data/transform.py tests/data/test_transform.py
git commit -m "feat(transform): add strict mode to apply_filters"
```

---

## Task 5: Strict mode for computed_columns and views

Same pattern as Task 4 — opt-in `strict` kwarg. Default behavior unchanged.

**Files:**
- Modify: `src/data/transform.py` — `apply_computed_columns` and `build_views` gain `strict` kwargs
- Modify: `tests/data/test_transform.py` — add strict-mode tests

- [ ] **Step 1: Write failing tests**

Append to `tests/data/test_transform.py`:

```python
def test_apply_computed_columns_strict_raises_on_missing_column(config, submissions):
    df, repeats = load_data(submissions, config)
    config["computed_columns"] = [
        {"name": "bad", "questions": ["Nonexistent"], "combine": "sum"},
    ]
    with pytest.raises(ValueError, match="Nonexistent"):
        apply_computed_columns(df, config, repeats, strict=True)


def test_apply_computed_columns_strict_raises_on_missing_repeat(config, submissions):
    df, repeats = load_data(submissions, config)
    config["computed_columns"] = [
        {"name": "bad", "from_repeat": "no_such_table", "question": "count"},
    ]
    with pytest.raises(ValueError, match="no_such_table"):
        apply_computed_columns(df, config, repeats, strict=True)


def test_build_views_strict_raises_on_missing_source(config, submissions):
    df, repeats = load_data(submissions, config)
    config["views"] = [{"name": "bad", "source": "no_such_source"}]
    with pytest.raises(ValueError, match="no_such_source"):
        build_views(config, df, repeats, strict=True)
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/data/test_transform.py -v -k "strict"`
Expected: 3 new failures plus the 1 passing strict-filter test from Task 4.

- [ ] **Step 3: Modify `apply_computed_columns`**

Replace [src/data/transform.py:260-315](src/data/transform.py#L260-L315) with:

```python
def apply_computed_columns(
    df: pd.DataFrame,
    cfg: Dict,
    repeat_tables: Dict[str, pd.DataFrame] = None,
    *,
    strict: bool = False,
) -> pd.DataFrame:
    """Append derived columns defined in config computed_columns.

    Two modes:
      - questions + combine : row-wise combination of main-table columns (fixed nested group)
      - from_repeat + stat  : per-submission aggregation of a repeat-group table (no row explosion)

    Args:
        strict: When True, any missing column / repeat table / bad combine raises
                ValueError. When False (default), the issue is logged as a warning
                and the computed column is skipped.
    """
    def _fail(msg: str):
        if strict:
            raise ValueError(msg)
        log.warning(msg)

    for col in cfg.get("computed_columns", []):
        name = col.get("name")
        if not name:
            continue
        try:
            if col.get("from_repeat"):
                repeat_name = col["from_repeat"]
                rdf = (repeat_tables or {}).get(repeat_name)
                if rdf is None:
                    _fail(f"computed_column '{name}': repeat table '{repeat_name}' not found — skipped")
                    continue
                question = col.get("question")
                stat = col.get("stat", "sum")
                if not question or question == "count":
                    aggregated = rdf.groupby("_parent_index").size()
                else:
                    if question not in rdf.columns:
                        _fail(f"computed_column '{name}': column '{question}' not in repeat table — skipped")
                        continue
                    aggregated = rdf.groupby("_parent_index")[question].agg(stat)
                id_col = next((c for c in ("_id", "_index", "_uuid") if c in df.columns), None)
                if not id_col:
                    _fail(f"computed_column '{name}': no id column in main table — skipped")
                    continue
                df[name] = df[id_col].map(aggregated).fillna(0)
                log.info(f"Computed column '{name}' = {stat}({repeat_name}.{question or 'rows'})")
            else:
                questions = col.get("questions", [])
                combine = col.get("combine", "sum")
                if not questions:
                    continue
                missing = [q for q in questions if q not in df.columns]
                if missing:
                    _fail(f"computed_column '{name}': columns not found: {missing} — skipped")
                    continue
                ops = {"sum": "sum", "mean": "mean", "min": "min", "max": "max"}
                if combine not in ops:
                    _fail(f"computed_column '{name}': unknown combine '{combine}' — skipped")
                    continue
                numeric_cols = df[questions].apply(pd.to_numeric, errors="coerce")
                df[name] = getattr(numeric_cols, combine)(axis=1)
                log.info(f"Computed column '{name}' = {combine}({questions})")
        except ValueError:
            raise
        except Exception as e:
            _fail(f"computed_column '{name}' failed: {e} — skipped")
    return df
```

- [ ] **Step 4: Modify `build_views`**

Replace [src/data/transform.py:318-404](src/data/transform.py#L318-L404) with:

```python
def build_views(
    cfg: Dict,
    main_df: pd.DataFrame,
    repeat_tables: Dict[str, pd.DataFrame],
    *,
    strict: bool = False,
) -> Dict[str, pd.DataFrame]:
    """Compute named virtual tables defined in config views: section.

    Args:
        strict: When True, a view whose source/columns/filter can't resolve raises
                ValueError. When False (default), the view is skipped with a warning.
    """
    def _fail(msg: str):
        if strict:
            raise ValueError(msg)
        log.warning(msg)

    views: Dict[str, pd.DataFrame] = {}
    for v in cfg.get("views", []):
        name = v.get("name")
        if not name:
            continue
        try:
            source = v.get("source", "main")
            if source == "main":
                df = main_df.copy()
            else:
                base = repeat_tables.get(source)
                if base is None:
                    _fail(f"View '{name}': source '{source}' not found — skipped")
                    continue
                df = base.copy()

            join_cols = v.get("join_parent")
            if join_cols and source != "main":
                df = join_repeat_to_main(df, main_df, join_cols)

            filter_expr = v.get("filter")
            if filter_expr:
                try:
                    df = df.query(filter_expr)
                except Exception as e:
                    _fail(f"View '{name}': filter '{filter_expr}' failed: {e} — skipped")
                    continue

            group_by = v.get("group_by")
            question = v.get("question")
            if group_by and question:
                agg_fn = v.get("agg", "sum")
                if group_by not in df.columns:
                    _fail(f"View '{name}': group_by column '{group_by}' not found — skipped aggregation")
                elif question not in df.columns:
                    _fail(f"View '{name}': question column '{question}' not found — skipped aggregation")
                else:
                    numeric = pd.to_numeric(df[question], errors="coerce")
                    agg_result = numeric.groupby(df[group_by]).agg(agg_fn).reset_index()
                    agg_result.columns = [group_by, question]
                    df = agg_result

            col_specs = v.get("columns", [])
            if col_specs:
                rename_map = {}
                for cs in col_specs:
                    original = cs.get("name")
                    renamed  = cs.get("rename")
                    col_type = cs.get("type")
                    if not original or original not in df.columns:
                        continue
                    if col_type:
                        try:
                            if col_type in ("number", "numeric"):
                                df[original] = pd.to_numeric(df[original], errors="coerce")
                            elif col_type == "date":
                                df[original] = pd.to_datetime(df[original], errors="coerce")
                            elif col_type in ("text", "string"):
                                df[original] = df[original].astype(str).replace("nan", pd.NA)
                        except Exception as te:
                            log.warning(f"View '{name}': type cast '{original}' → {col_type} failed: {te}")
                    if renamed and renamed != original:
                        rename_map[original] = renamed
                if rename_map:
                    df = df.rename(columns=rename_map)

            views[name] = df
            log.info(f"View '{name}' computed: {len(df)} rows, {len(df.columns)} columns")
        except ValueError:
            raise
        except Exception as e:
            _fail(f"View '{name}' failed: {e} — skipped")
    return views
```

- [ ] **Step 5: Run tests**

Run: `pytest tests/data/test_transform.py -v`
Expected: 13 passed.

- [ ] **Step 6: Commit**

```bash
git add src/data/transform.py tests/data/test_transform.py
git commit -m "feat(transform): add strict mode to apply_computed_columns and build_views"
```

---

## Task 6: Schema-drift visibility — collect fuzzy matches into a report

Today `load_data` logs a warning each time it falls back to field-name or unicode-normalized matching, but those warnings can scroll past and be missed. Replace the bare warnings with a structured report attached to the returned object, and surface a summary line at the end of `load_data`. Add an opt-in strict failure mode.

**Files:**
- Modify: `src/data/transform.py` — attach a report dict to `df.attrs["schema_match_report"]`, optionally raise
- Modify: `tests/data/test_transform.py` — tests for the report

- [ ] **Step 1: Write failing tests**

Append to `tests/data/test_transform.py`:

```python
def test_load_data_reports_fuzzy_match_when_kobo_key_differs(config, submissions):
    # Mangle the config so age has a slightly different kobo_key — but the field
    # name still matches the submission column "demographics.age" (json_normalize form).
    for q in config["questions"]:
        if q["kobo_key"] == "demographics/age":
            q["kobo_key"] = "wrong_group/age"
    df, _ = load_data(submissions, config)
    report = df.attrs.get("schema_match_report", {})
    assert report.get("fuzzy_matches"), "expected at least one fuzzy match to be reported"
    assert any("age" in m["matched_to"] for m in report["fuzzy_matches"])


def test_load_data_strict_raises_on_fuzzy_match(config, submissions):
    for q in config["questions"]:
        if q["kobo_key"] == "demographics/age":
            q["kobo_key"] = "wrong_group/age"
    with pytest.raises(ValueError, match="fuzzy"):
        load_data(submissions, config, strict=True)
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/data/test_transform.py -v -k "fuzzy or strict_raises_on_fuzzy"`
Expected: failures — `load_data` doesn't accept `strict`, doesn't set `df.attrs["schema_match_report"]`.

- [ ] **Step 3: Modify `load_data` to track fuzzy matches and accept `strict`**

In [src/data/transform.py:72](src/data/transform.py#L72), change the signature:

```python
def load_data(
    submissions: List[Dict],
    cfg: Dict,
    *,
    strict: bool = False,
) -> Tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
```

Inside `load_data`, around the column-matching block ([src/data/transform.py:96-146](src/data/transform.py#L96-L146)), track fuzzy matches in a local list. Replace that whole block with:

```python
    fuzzy_matches: List[Dict[str, str]] = []
    for q in main_questions:
        key = q["kobo_key"]
        flat_key = key.replace("/", ".")
        label = q.get("export_label") or q.get("label") or key
        if label in used_labels:
            used_labels[label] += 1
            label = f"{label}_{used_labels[label]}"
        else:
            used_labels[label] = 0
        if flat_key in flat.columns:
            col_map[flat_key] = label
        elif key in flat.columns:
            col_map[key] = label
        else:
            field_name = key.split("/")[-1]
            candidates = [
                c for c in flat.columns
                if c == field_name
                or c.endswith(f"/{field_name}")
                or c.endswith(f".{field_name}")
            ]
            if len(candidates) == 1:
                fuzzy_matches.append({"kobo_key": key, "matched_to": candidates[0], "via": "field-name"})
                col_map[candidates[0]] = label
            else:
                norm_field = _norm(field_name)
                candidates_norm = [
                    c for c in flat.columns
                    if _norm(c) == norm_field
                    or _norm(c.split("/")[-1]) == norm_field
                    or _norm(c.split(".")[-1]) == norm_field
                ]
                if len(candidates_norm) == 1:
                    fuzzy_matches.append({"kobo_key": key, "matched_to": candidates_norm[0], "via": "normalised"})
                    col_map[candidates_norm[0]] = label
                else:
                    missing.append(key)

    if fuzzy_matches:
        for fm in fuzzy_matches:
            log.warning(f"kobo_key '{fm['kobo_key']}' matched by {fm['via']} to '{fm['matched_to']}'")
        log.warning(
            f"{len(fuzzy_matches)} question(s) matched by fallback — verify these are the columns you expect."
        )
        if strict:
            raise ValueError(
                f"Strict mode: {len(fuzzy_matches)} fuzzy schema match(es) detected — refusing to proceed. "
                f"Fix kobo_key paths in config.yml or re-run without --strict."
            )

    if missing:
        raw_cols = sorted(flat.columns.tolist())
        log.warning(f"Keys not found in submissions: {missing}")
        log.warning(f"Available raw submission columns ({len(raw_cols)}): {raw_cols}")
```

Then near the end of `load_data`, just before `return df, repeat_tables`, attach the report:

```python
    df.attrs["schema_match_report"] = {
        "fuzzy_matches": fuzzy_matches,
        "missing": missing,
    }
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/data/test_transform.py -v`
Expected: 15 passed.

- [ ] **Step 5: Commit**

```bash
git add src/data/transform.py tests/data/test_transform.py
git commit -m "feat(transform): collect fuzzy schema matches into a report; opt-in strict mode"
```

---

## Task 7: Global `--config` flag + `--strict` flag

Thread the config path and strict mode through Click context so every CLI command honors them. Today `CONFIG_PATH = Path("config.yml")` is hardcoded.

**Files:**
- Create: `tests/cli/test_config_flag.py`
- Modify: `src/data/make.py` — add `@click.group()` options, use `ctx.obj`

- [ ] **Step 1: Write failing test**

```python
"""Tests for src.data.make — CLI flag plumbing."""
from pathlib import Path
from click.testing import CliRunner

from src.data.make import cli


def test_config_flag_overrides_default_path(tmp_path, monkeypatch):
    # Build a minimal valid config in a temp location
    cfg = tmp_path / "alt.yml"
    cfg.write_text(
        "api:\n"
        "  platform: kobo\n"
        "  url: https://example.test/api/v2\n"
        "  token: test\n"
        "form:\n"
        "  uid: ABC\n"
        "  alias: alt\n"
        "questions: []\n"
    )
    runner = CliRunner()
    # `download` should fail with 'No questions in config.yml. Run fetch-questions first.'
    # because our alt config has empty questions: []. If --config is not respected,
    # it would instead complain about the missing default config.yml in cwd.
    monkeypatch.chdir(tmp_path)
    result = runner.invoke(cli, ["--config", str(cfg), "download"])
    assert "No questions" in result.output, result.output


def test_strict_flag_is_in_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["--help"])
    assert "--strict" in result.output
    assert "--config" in result.output
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/cli/test_config_flag.py -v`
Expected: failures — current group has no `--config` or `--strict` options.

- [ ] **Step 3: Modify `src/data/make.py`**

Replace [src/data/make.py:18-21](src/data/make.py#L18-L21) (the `@click.group()` block) with:

```python
@click.group()
@click.option(
    "--config", "config_path",
    default="config.yml",
    type=click.Path(dir_okay=False),
    help="Path to config.yml. Defaults to ./config.yml.",
)
@click.option(
    "--strict",
    is_flag=True,
    default=False,
    help="Fail on any filter / computed_column / view / schema-drift warning instead of skipping.",
)
@click.pass_context
def cli(ctx, config_path, strict):
    """kobo-reporter — Extract Kobo/Ona data and generate Word reports."""
    ctx.ensure_object(dict)
    ctx.obj["config_path"] = Path(config_path)
    ctx.obj["strict"] = strict
```

Then update every command that calls `load_config(CONFIG_PATH)` to use the ctx-supplied path. For each `@cli.command(...)` function, add `@click.pass_context` and replace the load_config line. Concretely:

For [src/data/make.py:23-29](src/data/make.py#L23-L29) (`fetch-questions`):

```python
@cli.command("fetch-questions")
@click.pass_context
def cmd_fetch_questions(ctx):
    """Fetch form schema from Kobo/Ona and write questions into config.yml."""
    from src.data.extract import get_client
    from src.data.questions import fetch_and_write_questions
    config_path = ctx.obj["config_path"]
    cfg = load_config(config_path)
    fetch_and_write_questions(get_client(cfg), cfg, config_path)
```

Apply the same pattern (`@click.pass_context`, `config_path = ctx.obj["config_path"]`, `cfg = load_config(config_path)`) to:
- `cmd_generate_template` ([src/data/make.py:35-42](src/data/make.py#L35-L42))
- `cmd_ai_generate_template` ([src/data/make.py:51-65](src/data/make.py#L51-L65))
- `cmd_suggest_charts` ([src/data/make.py:69-79](src/data/make.py#L69-L79))
- `cmd_download` ([src/data/make.py:146-163](src/data/make.py#L146-L163))
- `cmd_list_sessions` ([src/data/make.py:167-179](src/data/make.py#L167-L179))
- `cmd_build_report` ([src/data/make.py:190-197](src/data/make.py#L190-L197))

For `cmd_download`, also thread `strict` through to `apply_filters`, `apply_computed_columns`, and `load_data`, and pass `config_path` into `_run_classify` so classification's write-back honors `--config`:

```python
@cli.command("download")
@click.option("--sample", default=None, type=int, help="Limit to first N submissions.")
@click.pass_context
def cmd_download(ctx, sample):
    """Download submissions, apply filters, export to configured destination."""
    from src.data.extract import get_client
    from src.data.transform import load_data, apply_filters, apply_computed_columns, export_data
    config_path = ctx.obj["config_path"]
    strict = ctx.obj["strict"]
    cfg = load_config(config_path)
    if not cfg.get("questions"):
        click.echo("No questions in config.yml. Run fetch-questions first.", err=True)
        sys.exit(1)
    client = get_client(cfg)
    log.info("Downloading submissions ...")
    raw = client.get_submissions(sample_size=sample)
    log.info("Transforming data ...")
    df, repeat_tables = load_data(raw, cfg, strict=strict)
    df, repeat_tables = apply_filters(df, cfg, repeat_tables, strict=strict)
    df = apply_computed_columns(df, cfg, repeat_tables, strict=strict)
    log.info(f"Exporting {len(df)} rows ...")
    export_data(df, cfg, repeat_tables)
    _run_classify(cfg, config_path, sample=sample)
```

Update `_run_classify`'s signature at [src/data/make.py:82](src/data/make.py#L82) to accept the path:

```python
def _run_classify(cfg, config_path, sample=None, rediscover=False):
```

And replace the one `write_config(cfg, CONFIG_PATH)` call inside `_run_classify` with `write_config(cfg, config_path)`.

- [ ] **Step 4: Run all tests**

Run: `pytest -v`
Expected: 17 passed (15 transform + 2 cli).

- [ ] **Step 5: Smoke-test the help output**

Run: `kobo-reporter --help`
Expected: shows `--config FILE` and `--strict` in the Options section above the commands list.

- [ ] **Step 6: Commit**

```bash
git add src/data/make.py tests/cli/test_config_flag.py
git commit -m "feat(cli): add global --config and --strict flags"
```

---

## Task 8: SQL export `if_exists` option

Make the destructive `if_exists="replace"` behavior explicit and configurable. Default remains `replace` for back-compat, but log a clear notice when it's used implicitly.

**Files:**
- Create: `tests/data/test_export.py`
- Modify: `src/data/transform.py` — `_export_sql` reads `database.if_exists`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for src.data.transform._export_sql — if_exists option."""
from unittest.mock import patch, MagicMock
import pandas as pd

from src.data.transform import _export_sql


def _cfg(if_exists=None):
    db = {
        "host": "localhost", "port": 5432, "name": "test",
        "user": "u", "password": "p", "table": "submissions",
    }
    if if_exists is not None:
        db["if_exists"] = if_exists
    return {"export": {"format": "postgres", "database": db}}


def test_export_sql_default_uses_replace_for_back_compat():
    df = pd.DataFrame({"a": [1, 2]})
    with patch("src.data.transform.create_engine") as mock_engine, \
         patch.object(pd.DataFrame, "to_sql") as mock_to_sql:
        mock_engine.return_value = MagicMock()
        _export_sql(df, _cfg(), "postgres", None)
    assert mock_to_sql.call_args.kwargs.get("if_exists") == "replace"


def test_export_sql_respects_append():
    df = pd.DataFrame({"a": [1, 2]})
    with patch("src.data.transform.create_engine") as mock_engine, \
         patch.object(pd.DataFrame, "to_sql") as mock_to_sql:
        mock_engine.return_value = MagicMock()
        _export_sql(df, _cfg(if_exists="append"), "postgres", None)
    assert mock_to_sql.call_args.kwargs.get("if_exists") == "append"


def test_export_sql_rejects_invalid_if_exists():
    import pytest
    df = pd.DataFrame({"a": [1, 2]})
    with pytest.raises(ValueError, match="if_exists"):
        _export_sql(df, _cfg(if_exists="upsert_or_whatever"), "postgres", None)
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/data/test_export.py -v`
Expected: import errors / failures — `create_engine` is currently imported inside `_export_sql` and `if_exists` isn't read from config.

- [ ] **Step 3: Modify `_export_sql`**

Move the `from sqlalchemy import create_engine` to module-level (top of [src/data/transform.py:1-6](src/data/transform.py#L1-L6)). It's only optional for users who don't export to SQL — but since sqlalchemy is in the `dev` deps from Task 1, tests can import it, and runtime users who don't have it will get a clear ImportError at module load. To keep that runtime opt-in, do the import inside `_export_sql` but expose it under a module-level name so tests can patch it:

Top of `src/data/transform.py`, after the imports, add:

```python
# Lazy-imported in _export_sql so users without sqlalchemy installed can still
# use file exports. Exposed at module level so tests can monkeypatch.
create_engine = None  # set on first use
```

Replace [src/data/transform.py:457-471](src/data/transform.py#L457-L471) (the `_export_sql` function) with:

```python
VALID_IF_EXISTS = ("fail", "replace", "append")

def _export_sql(df: pd.DataFrame, cfg: Dict, dialect: str, repeat_tables: Dict[str, pd.DataFrame] = None) -> None:
    global create_engine
    if create_engine is None:
        from sqlalchemy import create_engine as _ce
        create_engine = _ce

    db = cfg.get("export", {}).get("database", {})
    if_exists = db.get("if_exists", "replace")
    if if_exists not in VALID_IF_EXISTS:
        raise ValueError(
            f"export.database.if_exists must be one of {VALID_IF_EXISTS}, got '{if_exists}'"
        )
    if "if_exists" not in db:
        log.warning(
            "export.database.if_exists not set — defaulting to 'replace', which DROPS the target table on every run. "
            "Set it explicitly (replace|append|fail) in config.yml to silence this warning."
        )

    h, p = db.get("host", "localhost"), int(db.get("port", 5432 if dialect == "postgres" else 3306))
    n, u, pw, t = db.get("name"), db.get("user"), db.get("password", ""), db.get("table", "submissions")
    url = (f"postgresql+psycopg2://{u}:{pw}@{h}:{p}/{n}" if dialect == "postgres"
           else f"mysql+pymysql://{u}:{pw}@{h}:{p}/{n}?charset=utf8mb4")
    engine = create_engine(url)
    df.to_sql(t, engine, if_exists=if_exists, index=False)
    log.info(f"Data exported → {dialect}://{h}:{p}/{n}.{t} (if_exists={if_exists})")
    if repeat_tables:
        for name, rdf in repeat_tables.items():
            safe_name = name.replace("/", "_")
            rdf.to_sql(f"{t}_{safe_name}", engine, if_exists=if_exists, index=False)
            log.info(f"Repeat group exported → {dialect}://{h}:{p}/{n}.{t}_{safe_name} (if_exists={if_exists})")
```

- [ ] **Step 4: Update `sample.config.yml` to document the new option**

Find the `database:` block in `sample.config.yml` and add the `if_exists` line. Open the file, locate the existing database section, and update it to include:

```yaml
export:
  format: csv   # csv | json | xlsx | mysql | postgres | supabase
  output_dir: data/processed
  database:
    host: localhost
    port: 5432
    name: kobo_reports
    user: env:DB_USER
    password: env:DB_PASSWORD
    table: submissions
    if_exists: replace   # replace (drop+recreate) | append | fail
```

If `sample.config.yml` doesn't currently have a `database:` block, leave that file as-is and instead document the option in `CLAUDE.md` under the SQL export section.

- [ ] **Step 5: Run all tests**

Run: `pytest -v`
Expected: 20 passed.

- [ ] **Step 6: Commit**

```bash
git add src/data/transform.py tests/data/test_export.py sample.config.yml
git commit -m "feat(export): add explicit if_exists option for SQL exports; warn on implicit replace"
```

---

## Wrap-up

After Task 8 you should have:
- A working `kobo-reporter` console script installed via `pip install -e .`
- 20+ tests covering the transform pipeline, HTTP retry behavior, the new CLI flags, and SQL export options
- Opt-in strict mode that fails loudly on bad filters, missing computed-column sources, broken views, and fuzzy schema matches
- HTTP requests that survive transient 5xx responses
- Explicit, configurable SQL write semantics

What's deliberately not in this plan:
- Migrating `requirements.txt` away (would force web/CI changes; do separately)
- Upsert support for SQL exports (separate feature, not a fix)
- Auth-token redaction in logs (worth doing but lower-impact than the above)
- Async / parallel pagination of large downloads (perf, not correctness)

Final sanity check:

```bash
pytest -v && kobo-reporter --help
```

Expected: 20+ passed and the help output lists `--config` and `--strict` at the group level.
