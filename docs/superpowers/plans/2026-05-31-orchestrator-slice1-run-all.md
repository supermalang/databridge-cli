# Orchestrator Slice 1 — Sequenced `run-all` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `run-all` command that runs the core pipeline in order (download → template-if-missing → build-report) with precondition checks and stop-on-failure, exposed at `/api/run/run-all` and a dashboard "Run pipeline" button.

**Architecture:** `run-all` chains the existing Click commands in-process via `ctx.invoke`, routed through a thin `_invoke` seam for testability. The web reuses the existing `/api/run/{command}` subprocess streamer (just add `run-all` to the whitelist). No stage logic is duplicated.

**Tech Stack:** Python 3, Click, pytest (`click.testing.CliRunner`), FastAPI, React/Vite.

**Spec:** `docs/superpowers/specs/2026-05-31-orchestrator-slice1-design.md`. On `main`: Layers 1–4 + structured outputs + CLI hardening; suite 287 passing.

---

## Verified facts (current `main`)
- `src/data/make.py`: Click group `cli(ctx, config_path, strict)` stores `ctx.obj["config_path"]` (a `Path`) and `ctx.obj["strict"]`. Commands: `cmd_download(ctx, sample, period, no_redact)`, `cmd_generate_template(ctx, out, context, summary_prompt)`, `cmd_build_report(ctx, sample, random_sample, split_by, split_sample, session, period, compare)`. `cmd_download` catches `PIIConfigError` and itself does `sys.exit(1)`. `load_config`, `lf_client`, `Path`, `sys` are imported at module top.
- `web/main.py`: `ALLOWED_COMMANDS` dict; `POST /api/run/{command}` rejects non-whitelisted with 400, builds `cmd = [sys.executable, "src/data/make.py", command]` and appends `--sample`/`--period` (among others) when present in the command's allow-list, then streams via `_stream(command, cmd)`.

## File structure
- **Modify:** `src/data/make.py` — add `_invoke` helper + `run-all` command.
- **Modify:** `web/main.py` — add `"run-all"` to `ALLOWED_COMMANDS`.
- **Modify:** `frontend/src/pages/Dashboard.jsx` — "Run pipeline" button.
- **Create:** `tests/test_run_all.py`; **Modify:** `tests/test_ask_api.py` or a web test for the endpoint (new `tests/test_run_all_api.py`).
- **Modify:** `CLAUDE.md`.

---

## Task 1: `run-all` CLI command

**Files:**
- Modify: `src/data/make.py`
- Test: `tests/test_run_all.py`

- [ ] **Step 1: Write the failing tests** in `tests/test_run_all.py`:

```python
import yaml
from click.testing import CliRunner
from src.data import make


def _write_cfg(tmp_path, *, questions=True, charts=True, template_exists):
    template = tmp_path / "t.docx"
    if template_exists:
        template.write_text("x")
    cfg = {
        "questions": [{"export_label": "Region", "category": "categorical"}] if questions else [],
        "charts": [{"name": "c", "type": "bar", "questions": ["Region"]}] if charts else [],
        "report": {"template": str(template)},
    }
    p = tmp_path / "config.yml"
    p.write_text(yaml.safe_dump(cfg))
    return p


def test_run_all_aborts_without_questions(tmp_path):
    p = tmp_path / "config.yml"
    p.write_text(yaml.safe_dump({"questions": [], "charts": []}))
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 1 and "fetch-questions" in res.output


def test_run_all_aborts_without_charts(tmp_path):
    p = _write_cfg(tmp_path, charts=False, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 1 and "charts" in res.output.lower()


def test_run_all_order_download_then_build(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(make, "_invoke", lambda ctx, command, **kw: calls.append(command.name))
    p = _write_cfg(tmp_path, template_exists=True)   # template present → skip generate-template
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 0
    assert calls == ["download", "build-report"]


def test_run_all_generates_template_when_missing(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(make, "_invoke", lambda ctx, command, **kw: calls.append(command.name))
    p = _write_cfg(tmp_path, template_exists=False)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 0
    assert calls == ["download", "generate-template", "build-report"]


def test_run_all_stops_on_download_failure(tmp_path, monkeypatch):
    calls = []
    def rec(ctx, command, **kw):
        calls.append(command.name)
        if command.name == "download":
            raise RuntimeError("boom")
    monkeypatch.setattr(make, "_invoke", rec)
    p = _write_cfg(tmp_path, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 1
    assert "build-report" not in calls
```

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_run_all.py -v` — expect FAIL (no `run-all` command / `_invoke`).

- [ ] **Step 3: Add `_invoke` + `run-all`** to `src/data/make.py`. Place after `cmd_build_report` (so the command functions it references are defined above it):

```python
def _invoke(ctx, command, **params):
    """Indirection over Click's ctx.invoke so run-all's sequencing is unit-testable
    (tests monkeypatch this to record stage order / simulate a stage failure)."""
    return ctx.invoke(command, **params)


@cli.command("run-all")
@click.option("--sample", default=None, type=int, help="Limit the download to first N submissions.")
@click.option("--period", default=None, help="Period label for this run (passed to download + build-report).")
@click.pass_context
def cmd_run_all(ctx, sample, period):
    """Run the core pipeline in order: download -> (generate-template if missing) -> build-report."""
    config_path = ctx.obj["config_path"]
    cfg = load_config(config_path)
    if not cfg.get("questions"):
        click.echo("No questions configured — run fetch-questions first.", err=True)
        sys.exit(1)
    if not cfg.get("charts"):
        click.echo("No charts configured — add charts (or use the Ask tab) before building a report.", err=True)
        sys.exit(1)

    with lf_client.command_trace("run-all"):
        log.info("▶ download")
        try:
            _invoke(ctx, cmd_download, sample=sample, period=period, no_redact=False)
        except SystemExit:
            raise  # a stage that already exited (e.g. PII config error) — propagate its code
        except Exception as e:  # noqa: BLE001
            click.echo(f"✗ download failed: {e}", err=True)
            sys.exit(1)
        log.info("✓ download")

        template = Path(cfg.get("report", {}).get("template", "templates/report_template.docx"))
        if not template.exists():
            log.info("▶ generate-template (none found)")
            try:
                _invoke(ctx, cmd_generate_template, out=None, context=None, summary_prompt=None)
            except SystemExit:
                raise
            except Exception as e:  # noqa: BLE001
                click.echo(f"✗ generate-template failed: {e}", err=True)
                sys.exit(1)

        log.info("▶ build-report")
        try:
            _invoke(ctx, cmd_build_report, sample=None, random_sample=False, split_by=None,
                    split_sample=None, session=None, period=period, compare=None)
        except SystemExit:
            raise
        except Exception as e:  # noqa: BLE001
            click.echo(f"✗ build-report failed: {e}", err=True)
            sys.exit(1)
        log.info("✓ Pipeline complete.")
```

(Note: the `charts` precondition fails fast before downloading, giving the clean Ask-tab message rather than letting `build-report` hard-fail later. `except SystemExit: raise` ensures a stage's own `sys.exit` — e.g. `cmd_download`'s `PIIConfigError` handler — propagates and halts the chain.)

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_run_all.py -v` — expect PASS (5 passed). Then full suite `PYTHONPATH=. python -m pytest tests/ -q` and confirm `--help` wiring: `PYTHONPATH=. python src/data/make.py run-all --help` lists `--sample`/`--period`.

- [ ] **Step 5: Commit**
```bash
git add src/data/make.py tests/test_run_all.py
git commit -m "feat(cli): add run-all sequencer (download -> template-if-missing -> build-report)"
```

---

## Task 2: Expose `/api/run/run-all`

**Files:**
- Modify: `web/main.py`
- Test: `tests/test_run_all_api.py`

- [ ] **Step 1: Write the failing test** in `tests/test_run_all_api.py`:

```python
import sys
from fastapi.testclient import TestClient
import web.main as wm


def test_run_all_is_whitelisted_with_sample_and_period():
    assert "run-all" in wm.ALLOWED_COMMANDS
    assert "--sample" in wm.ALLOWED_COMMANDS["run-all"]
    assert "--period" in wm.ALLOWED_COMMANDS["run-all"]


def test_run_all_endpoint_builds_argv(monkeypatch):
    captured = {}
    async def _fake_stream(command, cmd):
        captured["command"] = command
        captured["cmd"] = cmd
        if False:
            yield ""  # make it an async generator
    monkeypatch.setattr(wm, "_stream", _fake_stream)
    client = TestClient(wm.app)
    resp = client.post("/api/run/run-all", json={"sample": 5, "period": "Q1 2026"})
    assert resp.status_code == 200
    assert captured["cmd"] == [sys.executable, "src/data/make.py", "run-all", "--sample", "5", "--period", "Q1 2026"]


def test_unknown_command_still_400():
    client = TestClient(wm.app)
    assert client.post("/api/run/bogus", json={}).status_code == 400
```

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_run_all_api.py -v` — expect FAIL (`run-all` not whitelisted → 400; first assertion fails).

- [ ] **Step 3: Add the whitelist entry** in `web/main.py` — in the `ALLOWED_COMMANDS` dict, after the `build-report` line, add:
```python
    "run-all":              ["--sample", "--period"],
```
(No handler change needed — `POST /api/run/{command}` already appends `--sample`/`--period` when present in the command's allow-list, and `RunPayload` already has `sample`/`period`.)

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_run_all_api.py -v` (expect 3 passed) then full suite `PYTHONPATH=. python -m pytest tests/ -q`. Report count.

- [ ] **Step 5: Commit**
```bash
git add web/main.py tests/test_run_all_api.py
git commit -m "feat(api): whitelist run-all for POST /api/run/run-all"
```

---

## Task 3: Dashboard "Run pipeline" button

**Files:**
- Modify: `frontend/src/pages/Dashboard.jsx`

- [ ] **Step 1: Read `frontend/src/pages/Dashboard.jsx` and `frontend/src/hooks/useCommand.js`** to find the existing run mechanism (the hook that POSTs `/api/run/{command}` and streams into the BottomTerminal — used by the per-step wizard).

- [ ] **Step 2: Add a "Run pipeline" button** to the Dashboard that triggers the existing run hook with the command `"run-all"`. Match the existing pattern exactly — if the wizard uses `const { run } = useCommand()` and calls `run(commandId, opts)`, add a button whose handler calls `run('run-all')`. Place it near the pipeline strip / run controls. Use the existing button styling on the page. Keep the per-step wizard buttons unchanged. Concretely, add (adapting to the file's actual hook/handler names):
```jsx
<button className="btn-primary" onClick={() => run('run-all')} disabled={running}
        style={{ padding: '8px 16px', borderRadius: 8 }}>
  Run pipeline
</button>
```
If the page's run hook exposes a different call shape (e.g. `runCommand({ command: 'run-all' })`), use that shape. Report the exact wiring you used.

- [ ] **Step 3: Build** — `cd /workspaces/databridge-cli/frontend && (test -d node_modules || npm install) && npm run build` — expect clean.

- [ ] **Step 4: Backend suite still green** — `cd /workspaces/databridge-cli && PYTHONPATH=. python -m pytest tests/ -q`.

- [ ] **Step 5: Commit**
```bash
cd /workspaces/databridge-cli
git add frontend/src/pages/Dashboard.jsx
git commit -m "feat(ui): Run pipeline button (chained run-all) on the dashboard"
```

---

## Task 4: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `run-all` to the CLI commands section.** In the numbered CLI command list (the bash block), add an entry (renumber as needed or append):
```bash
# Run the whole pipeline in order (download -> template-if-missing -> build-report)
python3 src/data/make.py run-all
python3 src/data/make.py run-all --sample 50 --period "Q3 2026"
```
And add a short note that `run-all` chains the existing commands via `ctx.invoke` with precondition checks (questions + charts configured) and stop-on-failure, and is exposed at `POST /api/run/run-all` + the dashboard "Run pipeline" button.

- [ ] **Step 2: Verify** — `PYTHONPATH=. python -m pytest tests/ -q` (green).

- [ ] **Step 3: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: document the run-all orchestrator command"
```

---

## Self-review notes
- **Spec coverage:** `run-all` sequencer with preconditions + stop-on-failure + staged log (T1) ✓; template-if-missing (T1) ✓; `ctx.invoke` chaining via the `_invoke` seam (T1) ✓; no-charts clear stop (T1 precondition) ✓; `/api/run/run-all` via whitelist reuse (T2) ✓; dashboard button (T3) ✓; docs (T4) ✓. Deferred items (staleness, `_proc` fix, configurable stages, fetch-questions-in-default, scheduling) correctly absent.
- **Type/name consistency:** command name `"run-all"`, function `cmd_run_all`, seam `_invoke(ctx, command, **params)`; `ctx.invoke` params match the verified signatures (`cmd_download(sample, period, no_redact)`, `cmd_generate_template(out, context, summary_prompt)`, `cmd_build_report(sample, random_sample, split_by, split_sample, session, period, compare)`); `ALLOWED_COMMANDS["run-all"] = ["--sample","--period"]` matches the handler's forwarded flags and `RunPayload` fields.
- **No placeholders:** every code/command step complete. Frontend wiring adapts to the file's actual hook shape (Task 3 instructs reading it first); verified via Vite build.
