# Orchestrator — Auto-Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `run-all --auto-charts` deterministically creates a starter chart set from saved questions (when none configured), persists it to config, and proceeds — reachable from CLI and web.

**Architecture:** A pure `default_charts_from_questions(cfg)` (categorical→bar, quantitative→histogram, capped at 25). `run-all` calls it on opt-in, writes config, then runs the chain. API whitelists/forwards the flag; the hook forwards it; a Dashboard checkbox surfaces it.

**Tech Stack:** Python (Click, pytest), FastAPI, React/Vite.

**Spec:** `docs/superpowers/specs/2026-05-31-orchestrator-auto-charts-design.md`. On `main`: orchestrator Slice 1, Slice 2, single-flight merged; suite 305.

## File structure
- **Create:** `src/reports/default_charts.py`; `tests/test_default_charts.py`.
- **Modify:** `src/data/make.py` (`run-all`: `--auto-charts`); `tests/test_run_all.py`.
- **Modify:** `web/main.py` (whitelist + payload + forward); `tests/test_run_all_api.py`.
- **Modify:** `frontend/src/hooks/useCommand.js`; `frontend/src/pages/Dashboard.jsx`.
- **Modify:** `CLAUDE.md`.

---

## Task 1: `default_charts_from_questions`

**Files:** Create `src/reports/default_charts.py`; Test `tests/test_default_charts.py`.

- [ ] **Step 1: Write failing tests** in `tests/test_default_charts.py`:

```python
from src.reports.default_charts import default_charts_from_questions, MAX_DEFAULT_CHARTS


def test_maps_categorical_and_quantitative():
    cfg = {"questions": [
        {"export_label": "Region", "category": "categorical"},
        {"export_label": "Age", "category": "quantitative"},
    ]}
    charts = default_charts_from_questions(cfg)
    by_q = {c["questions"][0]: c["type"] for c in charts}
    assert by_q == {"Region": "bar", "Age": "histogram"}
    assert all(set(c) >= {"name", "title", "type", "questions"} for c in charts)


def test_skips_non_chartable_categories():
    cfg = {"questions": [
        {"export_label": "Comments", "category": "qualitative"},
        {"export_label": "GPS", "category": "geographical"},
        {"export_label": "When", "category": "date"},
        {"export_label": "X", "category": "undefined"},
    ]}
    assert default_charts_from_questions(cfg) == []


def test_column_fallback_and_unique_names():
    cfg = {"questions": [
        {"label": "Region", "category": "categorical"},                 # no export_label -> label
        {"kobo_key": "region2", "category": "categorical"},             # -> kobo_key
        {"export_label": "Region", "category": "categorical"},          # dup title -> unique name
        {"category": "categorical"},                                     # no usable column -> skipped
    ]}
    charts = default_charts_from_questions(cfg)
    assert len(charts) == 3
    names = [c["name"] for c in charts]
    assert len(set(names)) == 3           # all unique
    assert charts[0]["questions"] == ["Region"]
    assert charts[1]["questions"] == ["region2"]


def test_caps_at_max_and_warns(caplog):
    cfg = {"questions": [
        {"export_label": f"Q{i}", "category": "quantitative"} for i in range(MAX_DEFAULT_CHARTS + 5)
    ]}
    import logging
    with caplog.at_level(logging.WARNING):
        charts = default_charts_from_questions(cfg)
    assert len(charts) == MAX_DEFAULT_CHARTS
    assert any("skipp" in r.message.lower() or "cap" in r.message.lower() for r in caplog.records)


def test_empty_when_no_questions():
    assert default_charts_from_questions({}) == []
    assert default_charts_from_questions({"questions": []}) == []
```

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_default_charts.py -v` — expect FAIL (ModuleNotFoundError).

- [ ] **Step 3: Create `src/reports/default_charts.py`:**

```python
"""Deterministic starter charts from saved questions (no LLM).

Used by `run-all --auto-charts` so the pipeline can produce a report on a fresh
config. One chart per chartable question; other categories are skipped.
"""
from __future__ import annotations
import logging
from typing import Dict, List

from src.utils.periods import slugify

log = logging.getLogger(__name__)

# question category -> single-question chart type
DEFAULT_CHART_BY_CATEGORY = {
    "categorical": "bar",
    "quantitative": "histogram",
}
MAX_DEFAULT_CHARTS = 25


def default_charts_from_questions(cfg: Dict) -> List[Dict]:
    """Return a deterministic list of chart dicts derived from cfg['questions'].
    Empty when there are no chartable (categorical/quantitative) questions."""
    questions = cfg.get("questions") or []
    charts: List[Dict] = []
    used_names = set()
    eligible = 0
    for q in questions:
        ctype = DEFAULT_CHART_BY_CATEGORY.get((q or {}).get("category"))
        if not ctype:
            continue
        col = q.get("export_label") or q.get("label") or q.get("kobo_key")
        if not col:
            continue
        eligible += 1
        if len(charts) >= MAX_DEFAULT_CHARTS:
            continue
        name = slugify(col) or f"chart_{len(charts) + 1}"
        base, i = name, 2
        while name in used_names:
            name = f"{base}_{i}"
            i += 1
        used_names.add(name)
        charts.append({"name": name, "title": col, "type": ctype, "questions": [col]})
    if eligible > len(charts):
        log.warning(
            f"default_charts: {eligible} chartable questions but capped at "
            f"{MAX_DEFAULT_CHARTS}; skipped {eligible - len(charts)}."
        )
    return charts
```

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_default_charts.py -v` (5 passed). Full suite `PYTHONPATH=. python -m pytest tests/ -q`.

- [ ] **Step 5: Commit**
```bash
git add src/reports/default_charts.py tests/test_default_charts.py
git commit -m "feat(charts): deterministic default_charts_from_questions (capped, fail-soft)"
```

---

## Task 2: `run-all --auto-charts`

**Files:** Modify `src/data/make.py`; Test `tests/test_run_all.py`.

- [ ] **Step 1: Append tests** to `tests/test_run_all.py` (reuse `_write_cfg`, `make`, `CliRunner`, `yaml`):

```python
def test_run_all_auto_charts_generates_and_proceeds(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(make, "_invoke", lambda ctx, command, **kw: calls.append(command.name))
    # questions present (categorical), charts empty, template exists (skip generate-template)
    p = _write_cfg(tmp_path, charts=False, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all", "--auto-charts"])
    assert res.exit_code == 0, res.output
    assert "build-report" in calls
    # charts persisted to config
    cfg = yaml.safe_load(p.read_text())
    assert cfg["charts"] and cfg["charts"][0]["type"] == "bar"
    assert cfg["charts"][0]["questions"] == ["Region"]


def test_run_all_auto_charts_errors_when_no_chartable_questions(tmp_path, monkeypatch):
    monkeypatch.setattr(make, "_invoke", lambda ctx, command, **kw: None)
    # one qualitative question -> nothing chartable
    import yaml as _y
    cfg = {"api": _API, "form": _FORM,
           "questions": [{"export_label": "Notes", "category": "qualitative"}],
           "charts": [], "report": {"template": str(tmp_path / "t.docx")}}
    (tmp_path / "t.docx").write_text("x")
    p = tmp_path / "config.yml"; p.write_text(_y.safe_dump(cfg))
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all", "--auto-charts"])
    assert res.exit_code == 1 and "chartable" in res.output.lower()


def test_run_all_no_flag_still_aborts_with_hint(tmp_path):
    p = _write_cfg(tmp_path, charts=False, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 1 and "auto-charts" in res.output.lower()


def test_run_all_generate_template_failure_stops_chain(tmp_path, monkeypatch):
    # template MISSING -> generate-template runs; make it fail -> chain stops at exit 1
    def _fake_invoke(ctx, command, **kw):
        if command.name == "generate-template":
            raise RuntimeError("boom")
    monkeypatch.setattr(make, "_invoke", _fake_invoke)
    p = _write_cfg(tmp_path, template_exists=False)   # questions+charts present
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 1 and "generate-template failed" in res.output.lower()
```

NOTE: the `_invoke` monkeypatch records `command.name`; download is invoked too (recorded/ignored). In `test_run_all_auto_charts_generates_and_proceeds`, since `_invoke` is stubbed, `report_is_current` runs for real — with no actual data on disk it returns False (stale) so build-report is invoked. If `save_state` runs after, that's fine (it writes a sidecar in a tmp report dir or default `reports/`); if it causes noise, the test only asserts `build-report in calls`. (Existing Slice-2 tests already exercise this path.)

- [ ] **Step 2: Run** the first new test — expect FAIL (no `--auto-charts` option).

- [ ] **Step 3: Edit `cmd_run_all` in `src/data/make.py`:**
  (a) Add the option (after `--force`):
  ```python
  @click.option("--auto-charts", is_flag=True, default=False, help="If no charts are configured, auto-create a deterministic starter set from the saved questions.")
  ```
  and signature `def cmd_run_all(ctx, sample, period, force, auto_charts):`.
  (b) Replace the existing empty-charts precondition block:
  ```python
      if not cfg.get("charts"):
          click.echo("No charts configured — add charts (or use the Ask tab) before building a report.", err=True)
          sys.exit(1)
  ```
  with:
  ```python
      if not cfg.get("charts"):
          if auto_charts:
              from src.reports.default_charts import default_charts_from_questions
              from src.utils.config import write_config
              new_charts = default_charts_from_questions(cfg)
              if not new_charts:
                  click.echo("No charts configured and --auto-charts found no chartable questions "
                             "(need categorical or quantitative questions).", err=True)
                  sys.exit(1)
              cfg["charts"] = new_charts
              write_config(cfg, config_path)
              log.info(f"✓ auto-created {len(new_charts)} chart(s) from questions.")
          else:
              click.echo("No charts configured — add charts (or use the Ask tab), or pass --auto-charts "
                         "to generate a starter set before building a report.", err=True)
              sys.exit(1)
  ```
  (`config_path = ctx.obj["config_path"]` is already bound at the top of `cmd_run_all`. The `default_charts_from_questions`/`write_config` imports are local, matching the file's convention.)

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_run_all.py -v` (all pass incl. existing `test_run_all_aborts_without_charts`). Full suite `PYTHONPATH=. python -m pytest tests/ -q`. Confirm `run-all --help` shows `--auto-charts`.

- [ ] **Step 5: Commit**
```bash
git add src/data/make.py tests/test_run_all.py
git commit -m "feat(run-all): --auto-charts generates starter charts from questions; +generate-template-failure test"
```

---

## Task 3: API plumbing + hook forwarding

**Files:** Modify `web/main.py`, `frontend/src/hooks/useCommand.js`; Test `tests/test_run_all_api.py`.

- [ ] **Step 1: Append tests** to `tests/test_run_all_api.py`:

```python
def test_run_all_allows_auto_charts_flag():
    assert "--auto-charts" in wm.ALLOWED_COMMANDS["run-all"]


def test_run_all_endpoint_forwards_auto_charts(monkeypatch):
    captured = {}
    async def _fake_stream(command, cmd):
        captured["cmd"] = cmd
        if False:
            yield ""
    monkeypatch.setattr(wm, "_stream", _fake_stream)
    client = TestClient(wm.app)
    resp = client.post("/api/run/run-all", json={"auto_charts": True})
    assert resp.status_code == 200
    assert "--auto-charts" in captured["cmd"]
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Edit `web/main.py`:**
  - `ALLOWED_COMMANDS["run-all"]`: change `["--sample", "--period"]` → `["--sample", "--period", "--auto-charts"]`.
  - `RunPayload`: add `auto_charts: Optional[bool] = None`.
  - In `run_command`, after the `--compare` block, add:
    ```python
    if payload.auto_charts and "--auto-charts" in ALLOWED_COMMANDS[command]:
        cmd += ["--auto-charts"]
    ```

- [ ] **Step 4: Edit `frontend/src/hooks/useCommand.js`** — in the `body` assembly (after the existing `if (opts.user_request)` line), add:
  ```javascript
      if (opts.period) body.period = opts.period;
      if (opts.auto_charts) body.auto_charts = opts.auto_charts;
  ```

- [ ] **Step 5: Run** — `PYTHONPATH=. python -m pytest tests/test_run_all_api.py -v` (pass). Full suite green.

- [ ] **Step 6: Commit**
```bash
git add web/main.py frontend/src/hooks/useCommand.js tests/test_run_all_api.py
git commit -m "feat(web): whitelist+forward run-all --auto-charts; hook forwards period & auto_charts"
```

---

## Task 4: Dashboard checkbox

**Files:** Modify `frontend/src/pages/Dashboard.jsx`.

- [ ] **Step 1: Read** the Run-pipeline button region (~line 130) and the component's `useState` block (~line 76) to match existing style.

- [ ] **Step 2:** Add state near the other `useState` calls:
  ```javascript
  const [autoCharts, setAutoCharts] = useState(false);
  ```
  Change the Run-pipeline button's onClick from `run('run-all')` to `run('run-all', { auto_charts: autoCharts })`. Add a small checkbox label next to the button (match existing markup/classes), e.g.:
  ```jsx
  <label className="checkbox-inline" title="If no charts are configured, auto-create a starter set from your questions">
    <input type="checkbox" checked={autoCharts} onChange={(e) => setAutoCharts(e.target.checked)} disabled={running} />
    Auto-create charts
  </label>
  ```
  (Use whatever class/markup pattern the surrounding buttons use; if there's no `checkbox-inline` class, a plain `<label>` with the input is fine — the styling can be minimal.)

- [ ] **Step 3: Verify build** — `cd frontend && npm run build` (clean build). If `node_modules` missing, `npm install` first.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/pages/Dashboard.jsx
git commit -m "feat(web-ui): Auto-create charts checkbox on the Run pipeline button"
```

---

## Task 5: Docs

**Files:** Modify `CLAUDE.md`.

- [ ] **Step 1:** Add to the `run-all` bash block:
  ```bash
  python3 src/data/make.py run-all --auto-charts   # if no charts configured, derive a starter set from questions
  ```
  And append to the `run-all` prose paragraph:
  > With `--auto-charts`, an empty `charts:` config is filled with a **deterministic** starter set derived from the saved questions (`categorical → bar`, `quantitative → histogram`, capped at 25; via `src/reports/default_charts.py`), persisted to `config.yml` before the template/build stages. Other categories are skipped; if nothing is chartable the run stops with a clear message. (An *existing* template won't gain placeholders for the new charts — auto-charts targets fresh configs where `generate-template` still runs.)

- [ ] **Step 2: Verify** — `PYTHONPATH=. python -m pytest tests/ -q` (green).

- [ ] **Step 3: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: document run-all --auto-charts"
```

---

## Self-review notes
- **Spec coverage:** deterministic mapping + cap + skip + fail-soft (T1) ✓; `run-all --auto-charts` opt-in + persist + updated hard-stop + gen-template-failure test (T2) ✓; API whitelist/forward + hook period & auto_charts (T3) ✓; Dashboard checkbox (T4) ✓; docs (T5) ✓.
- **Type/name consistency:** `default_charts_from_questions(cfg) -> List[Dict]`, `MAX_DEFAULT_CHARTS`, `DEFAULT_CHART_BY_CATEGORY`; chart dict keys `{name,title,type,questions}` match the project's chart schema; `RunPayload.auto_charts`; flag string `--auto-charts` consistent across CLI/ALLOWED_COMMANDS/forward/test; opts key `auto_charts` consistent across hook/Dashboard.
- **Safety:** auto-charts is opt-in; pure generator never raises on malformed questions; cap logged; default behavior preserved (existing `test_run_all_aborts_without_charts` still passes — it doesn't pass the flag, and the new message still contains "charts").
- **No placeholders:** complete code/commands throughout.
