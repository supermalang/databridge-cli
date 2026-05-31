# Trust Hardening (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every fake/mocked value and "coming next" stub from the Composition tab; embed audit-trail provenance into generated `.docx` reports so users can trace where each number came from. Stand up a minimal pytest harness in the process.

**Architecture:** Replace `Math.random()` placeholders in the React UI with lazy-fetched values from existing `/api/indicators/preview` and `/api/views/preview` endpoints (cache per session). Add a `src/utils/provenance.py` helper that the `ReportBuilder` injects into the Jinja context, exposing `provenance.{generated_at, data_downloaded_at, n_submissions, filters, config_hash, period}` placeholders. Auto-templates and AI templates append a small provenance footer.

**Tech Stack:** Python 3.12, FastAPI, pytest + httpx (new), docxtpl, React + Vite (no new FE test framework).

**Non-goals:**
- New backend endpoints (we reuse existing preview endpoints)
- Browser-level UI tests (manual verification + curl smoke tests for the API)
- Validation/outlier detection (Phase B)
- Localization / undo (Phase D)

**Scope note:** Phase B (validation view, multi-period, results framework, PII), Phase C (distribution / no-terminal install), and Phase D (polish) follow as separate plans.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `requirements.txt` | modify | add `pytest>=8`, `httpx>=0.27` |
| `tests/__init__.py` | create | mark tests package |
| `tests/conftest.py` | create | shared fixtures: temp cwd, FastAPI ASGI client |
| `tests/test_smoke.py` | create | one bootstrap test that `/api/status` returns 200 |
| `src/utils/provenance.py` | create | `build_provenance(cfg, df, data_dir)` → dict |
| `tests/test_provenance.py` | create | unit tests for the helper |
| `src/reports/builder.py:139-149` | modify | include `provenance` in template context |
| `src/reports/template_generator.py` | modify | append provenance section to auto-templates |
| `src/reports/ai_template_generator.py` | modify | system prompt mentions provenance placeholders |
| `tests/test_build_report_smoke.py` | create | end-to-end: render a tiny report, assert provenance text appears |
| `frontend/src/pages/Composition.jsx` | modify | replace mocks; wire summary Preview; trim "Preview composition" button |
| `README.md` | modify | brief note on trust changes |

---

## Task 1: Set up pytest

**Files:**
- Modify: `requirements.txt`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`
- Create: `tests/test_smoke.py`

- [ ] **Step 1: Add test dependencies**

Edit `requirements.txt` to append:

```
pytest>=8.0
httpx>=0.27
```

Run:
```bash
pip install -r requirements.txt
```

- [ ] **Step 2: Create the tests package**

Create `tests/__init__.py` (empty file):
```bash
mkdir -p tests && : > tests/__init__.py
```

- [ ] **Step 3: Write conftest.py**

Create `tests/conftest.py`:

```python
"""Shared pytest fixtures."""
import os
import sys
from pathlib import Path
import pytest

# Ensure project root is importable
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture
def project_root() -> Path:
    return ROOT


@pytest.fixture
def api_client():
    """Synchronous httpx client wired to the FastAPI ASGI app in-process."""
    from httpx import ASGITransport, Client
    from web.main import app
    transport = ASGITransport(app=app)
    with Client(transport=transport, base_url="http://test") as c:
        yield c
```

- [ ] **Step 4: Write the failing smoke test**

Create `tests/test_smoke.py`:

```python
def test_api_status_returns_200(api_client):
    r = api_client.get("/api/status")
    assert r.status_code == 200
    body = r.json()
    assert "status" in body
```

- [ ] **Step 5: Run the test — expect PASS**

```bash
pytest tests/test_smoke.py -v
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add requirements.txt tests/
git commit -m "test: add pytest harness with FastAPI ASGI fixture"
```

---

## Task 2: Provenance helper module (TDD)

**Files:**
- Create: `src/utils/provenance.py`
- Create: `tests/test_provenance.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_provenance.py`:

```python
import hashlib
import pandas as pd
import pytest
from src.utils.provenance import build_provenance


def test_build_provenance_basic_fields():
    cfg = {
        "form": {"alias": "monitoring"},
        "filters": ["Age > 0", "Region != 'Test'"],
        "report": {"period": "Q1 2026"},
    }
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5]})
    prov = build_provenance(cfg, df, data_downloaded_at=None)
    assert prov["n_submissions"] == 5
    assert prov["filters"] == ["Age > 0", "Region != 'Test'"]
    assert prov["period"] == "Q1 2026"
    assert isinstance(prov["generated_at"], str) and len(prov["generated_at"]) >= 10
    assert isinstance(prov["config_hash"], str) and len(prov["config_hash"]) == 12


def test_build_provenance_empty_optional_fields():
    cfg = {"form": {"alias": "x"}}
    df = pd.DataFrame()
    prov = build_provenance(cfg, df, data_downloaded_at=None)
    assert prov["n_submissions"] == 0
    assert prov["filters"] == []
    assert prov["period"] == ""
    assert prov["data_downloaded_at"] == ""


def test_build_provenance_hash_stable_for_same_input():
    cfg = {"form": {"alias": "x"}, "filters": ["a > 1"], "questions": [{"kobo_key": "x"}]}
    df = pd.DataFrame()
    h1 = build_provenance(cfg, df, data_downloaded_at=None)["config_hash"]
    h2 = build_provenance(cfg, df, data_downloaded_at=None)["config_hash"]
    assert h1 == h2


def test_build_provenance_hash_changes_when_config_changes():
    cfg_a = {"form": {"alias": "x"}, "filters": ["a > 1"]}
    cfg_b = {"form": {"alias": "x"}, "filters": ["a > 2"]}
    df = pd.DataFrame()
    h_a = build_provenance(cfg_a, df, data_downloaded_at=None)["config_hash"]
    h_b = build_provenance(cfg_b, df, data_downloaded_at=None)["config_hash"]
    assert h_a != h_b


def test_provenance_footer_oneliner_present():
    cfg = {"form": {"alias": "m"}, "filters": [], "report": {"period": "Q1"}}
    df = pd.DataFrame({"a": [1, 2]})
    prov = build_provenance(cfg, df, data_downloaded_at=None)
    assert "footer" in prov and "Q1" in prov["footer"] and "2" in prov["footer"]
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
pytest tests/test_provenance.py -v
```

Expected: ImportError (module not found) or collection error.

- [ ] **Step 3: Implement the helper**

Create `src/utils/provenance.py`:

```python
"""Build a provenance dict for the Word template.

Exposes the audit trail: when the report was generated, when the data was
downloaded, how many submissions were used, which filters were applied,
and a short hash of the config so two reports can be compared.
"""
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import pandas as pd


def build_provenance(
    cfg: Dict,
    df: pd.DataFrame,
    data_downloaded_at: Optional[str] = None,
) -> Dict:
    """Return a dict with provenance fields for Jinja rendering.

    Args:
        cfg: full config.yml dict
        df: the main DataFrame the report was rendered from
        data_downloaded_at: ISO timestamp of the data file's mtime, or None

    Returns dict with keys:
        generated_at, data_downloaded_at, n_submissions, filters,
        config_hash, period, footer
    """
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    n = int(len(df)) if df is not None else 0
    filters = list(cfg.get("filters") or [])
    period = (cfg.get("report") or {}).get("period", "") or ""

    # Stable hash of the config — excludes anything time-varying or secret.
    cfg_for_hash = {
        "form":      cfg.get("form", {}),
        "questions": [q.get("kobo_key") for q in (cfg.get("questions") or [])],
        "filters":   filters,
        "charts":    [c.get("name") for c in (cfg.get("charts") or [])],
        "indicators":[i.get("name") for i in (cfg.get("indicators") or [])],
        "summaries": [s.get("name") for s in (cfg.get("summaries") or [])],
        "views":     [v.get("name") for v in (cfg.get("views") or [])],
    }
    blob = json.dumps(cfg_for_hash, sort_keys=True, ensure_ascii=False).encode("utf-8")
    config_hash = hashlib.sha256(blob).hexdigest()[:12]

    parts = [f"Generated {generated_at}", f"n={n}"]
    if period:              parts.append(f"period={period}")
    if data_downloaded_at:  parts.append(f"data {data_downloaded_at}")
    parts.append(f"cfg {config_hash}")
    footer = " · ".join(parts)

    return {
        "generated_at":      generated_at,
        "data_downloaded_at": data_downloaded_at or "",
        "n_submissions":     n,
        "filters":           filters,
        "config_hash":       config_hash,
        "period":            period,
        "footer":            footer,
    }


def data_mtime(data_dir: Path, alias: str) -> Optional[str]:
    """Find the latest main data file for the given form alias and return its
    mtime as an ISO string, or None if not found."""
    candidates = sorted(
        Path(data_dir).glob(f"{alias}_data_*.csv"),
        key=lambda p: p.stat().st_mtime, reverse=True,
    )
    if not candidates:
        return None
    ts = datetime.fromtimestamp(candidates[0].stat().st_mtime)
    return ts.strftime("%Y-%m-%d %H:%M")
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
pytest tests/test_provenance.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/utils/provenance.py tests/test_provenance.py
git commit -m "feat(reports): provenance helper for audit-trail context"
```

---

## Task 3: Wire provenance into the report builder

**Files:**
- Modify: `src/reports/builder.py` (around lines 139–149)

- [ ] **Step 1: Add the import + provenance call**

Open `src/reports/builder.py`. Near the other report-building imports at the top, add:

```python
from src.utils.provenance import build_provenance, data_mtime
```

- [ ] **Step 2: Inject provenance into the context**

Replace the `context = { ... }` block (around line 139) with:

```python
        provenance = build_provenance(
            self.cfg,
            df,
            data_downloaded_at=data_mtime(
                Path(self.cfg.get("export", {}).get("output_dir", "data/processed")),
                self.cfg.get("form", {}).get("alias", "form"),
            ),
        )
        context = {
            "report_title":  self.report_cfg.get("title", "Report"),
            "period":        self.report_cfg.get("period", datetime.today().strftime("%B %Y")),
            "n_submissions": len(df),
            "generated_at":  datetime.today().strftime("%d/%m/%Y %H:%M"),
            "provenance":    provenance,
            **narrative,
            "stats_table":   stats_table,
            **indicators,
            **summaries,
            **self._generate_charts(tpl, df, repeat_tables),
        }
```

(The existing `generated_at` and `n_submissions` keys are preserved so old templates keep working; `provenance` is additive.)

- [ ] **Step 3: Verify the existing report pipeline still runs**

If you have a downloaded dataset locally:

```bash
PYTHONPATH=. python3 src/data/make.py build-report --sample 20
```

Expected: completes without error; a `.docx` is produced under `reports/`.

- [ ] **Step 4: Commit**

```bash
git add src/reports/builder.py
git commit -m "feat(reports): inject provenance dict into Word template context"
```

---

## Task 4: Auto-template generators include a provenance footer

**Files:**
- Modify: `src/reports/template_generator.py`
- Modify: `src/reports/ai_template_generator.py`

- [ ] **Step 1: Find where the auto-generator writes the closing paragraph**

```bash
grep -n "doc.add_paragraph\|generated_at\|n_submissions" src/reports/template_generator.py | head
```

- [ ] **Step 2: Append a provenance footer paragraph**

In `src/reports/template_generator.py`, locate the end of the template body (just before `doc.save(...)`) and add:

```python
    # Provenance footer — single Jinja line; ReportBuilder fills it in.
    p = doc.add_paragraph()
    p.style = doc.styles["Normal"]
    run = p.add_run("{{ provenance.footer }}")
    run.italic = True
    run.font.size = Pt(8)
```

Make sure `from docx.shared import Pt` is imported at the top of the file (it almost certainly already is).

- [ ] **Step 3: Update the AI template generator system prompt**

Open `src/reports/ai_template_generator.py`. Find the system prompt (look for `"You are"` near the top of the file). Append to the placeholder list documentation:

```
Additional optional placeholders (use sparingly, typically once at the report's end):
  {{ provenance.footer }}              one-line audit footer (recommended)
  {{ provenance.generated_at }}        ISO timestamp the report was generated
  {{ provenance.data_downloaded_at }}  ISO timestamp the underlying data file was downloaded
  {{ provenance.n_submissions }}       int — number of submissions used
  {{ provenance.config_hash }}         12-char hash of the config used
```

- [ ] **Step 4: Generate a template + visually inspect**

```bash
PYTHONPATH=. python3 src/data/make.py generate-template --out /tmp/test_template.docx
```

Open `/tmp/test_template.docx` and confirm the provenance footer placeholder is present at the bottom.

- [ ] **Step 5: Commit**

```bash
git add src/reports/template_generator.py src/reports/ai_template_generator.py
git commit -m "feat(templates): auto-generated templates include provenance footer"
```

---

## Task 5: End-to-end provenance smoke test

**Files:**
- Create: `tests/test_build_report_smoke.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_build_report_smoke.py`:

```python
"""Smoke test: build a minimal report and verify provenance text is in the docx."""
import shutil
import zipfile
from pathlib import Path

import pandas as pd
import pytest
import yaml


@pytest.fixture
def tmp_report_dir(tmp_path, project_root, monkeypatch):
    """Stage a self-contained workspace with a tiny CSV + minimal config."""
    workspace = tmp_path / "ws"
    (workspace / "data" / "processed").mkdir(parents=True)
    (workspace / "templates").mkdir()
    (workspace / "reports").mkdir()

    # Tiny CSV that looks like a Kobo export
    csv_path = workspace / "data" / "processed" / "smoke_data_20260101_120000.csv"
    pd.DataFrame({"Region": ["A", "B", "A"], "Age": [10, 20, 30]}).to_csv(csv_path, index=False)

    # Minimal config
    cfg = {
        "form":  {"alias": "smoke", "uid": "x"},
        "questions": [
            {"kobo_key": "Region", "label": "Region", "type": "select_one", "category": "categorical", "group": "", "export_label": "Region"},
            {"kobo_key": "Age",    "label": "Age",    "type": "integer",    "category": "quantitative","group": "", "export_label": "Age"},
        ],
        "filters": ["Age > 0"],
        "charts": [],
        "report": {"template": str(workspace / "templates" / "t.docx"),
                   "output_dir": str(workspace / "reports"),
                   "title": "Smoke", "period": "Q1 2026"},
        "export": {"format": "csv", "output_dir": str(workspace / "data" / "processed")},
    }
    cfg_path = workspace / "config.yml"
    cfg_path.write_text(yaml.dump(cfg, allow_unicode=True))

    monkeypatch.chdir(workspace)
    yield workspace


def _docx_text(path: Path) -> str:
    """Pull all visible text out of a .docx by reading word/document.xml."""
    with zipfile.ZipFile(path) as z:
        return z.read("word/document.xml").decode("utf-8", errors="replace")


def test_build_report_writes_provenance_footer(tmp_report_dir):
    import subprocess, sys
    project_root = Path(__file__).resolve().parent.parent

    # Generate a template that includes the provenance placeholder
    r = subprocess.run(
        [sys.executable, str(project_root / "src" / "data" / "make.py"),
         "generate-template", "--out", str(tmp_report_dir / "templates" / "t.docx")],
        env={"PYTHONPATH": str(project_root), "PATH": __import__("os").environ.get("PATH", "")},
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr

    # Build the report
    r = subprocess.run(
        [sys.executable, str(project_root / "src" / "data" / "make.py"), "build-report"],
        env={"PYTHONPATH": str(project_root), "PATH": __import__("os").environ.get("PATH", "")},
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr

    # Find the generated .docx and assert provenance is in the text
    docs = list((tmp_report_dir / "reports").glob("smoke_report_*.docx"))
    assert len(docs) == 1, f"expected one .docx, got {docs}"
    text = _docx_text(docs[0])
    assert "Generated " in text
    assert "cfg " in text          # short hash signature
    assert "Q1 2026" in text       # period
```

- [ ] **Step 2: Run the test — expect PASS (or fail with a clear message)**

```bash
pytest tests/test_build_report_smoke.py -v -s
```

If it fails because the auto-template doesn't include the placeholder, go back to Task 4 step 2 and verify the edit landed.

- [ ] **Step 3: Commit**

```bash
git add tests/test_build_report_smoke.py
git commit -m "test: end-to-end smoke test for provenance in generated docx"
```

---

## Task 6: IndicatorsCard — replace `mockLatest` with real values

**Files:**
- Modify: `frontend/src/pages/Composition.jsx` (around lines 583–632)

- [ ] **Step 1: Remove `mockLatest`**

In `frontend/src/pages/Composition.jsx`, find the `mockLatest` function (around line 589) and delete it. Also delete the comment immediately above explaining it.

- [ ] **Step 2: Add a fetcher hook inside the component**

Inside `IndicatorsCard({ indicators, ... })`, before the `return (`, add:

```jsx
  const [latest, setLatest] = useState({}); // { [indicator.name]: { value, error } }

  useEffect(() => {
    let cancelled = false;
    async function loadOne(ind) {
      try {
        const r = await fetch('/api/indicators/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ indicator: ind }),
        });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setLatest(prev => ({ ...prev, [ind.name]: { error: data.detail || 'error' } }));
        } else {
          // Endpoint returns { value, n_rows }; value may be string or number.
          setLatest(prev => ({ ...prev, [ind.name]: { value: data.value } }));
        }
      } catch {
        if (!cancelled) setLatest(prev => ({ ...prev, [ind.name]: { error: 'network' } }));
      }
    }
    for (const ind of indicators) {
      if (ind?.name && !(ind.name in latest)) loadOne(ind);
    }
    return () => { cancelled = true; };
  }, [indicators]); // re-runs when indicator list changes
```

- [ ] **Step 3: Render the real value (with honest placeholders)**

In the same component, replace the `<div><span className="value-tag">{mockLatest(ind)}</span></div>` line with:

```jsx
            <div>
              <span className="value-tag" title={latest[ind.name]?.error ? `Error: ${latest[ind.name].error}` : ''}>
                {latest[ind.name]?.value ?? (latest[ind.name]?.error ? '—' : '…')}
              </span>
            </div>
```

(`…` = still loading, `—` = error or no data, real value otherwise.)

- [ ] **Step 4: Render the value defensively**

In step 3 above the modal shows `latest[ind.name]?.value ?? (latest[ind.name]?.error ? '—' : '…')`. `value` is `0` when count is 0, which `??` correctly preserves (only `null`/`undefined` trigger the fallback). If `value` is a number, it renders as-is; if it's a string like `"12.3%"`, also as-is. No further change needed.

- [ ] **Step 5: Manually verify in the browser**

1. Start the dev server: `./scripts/dev.sh start`
2. Open `http://localhost:51730`, go to Composition
3. Confirm: each indicator briefly shows `…` then a real number / `—`. No two reloads produce different placeholder numbers (the old `Math.random()` would).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Composition.jsx
git commit -m "fix(ui): IndicatorsCard fetches real values instead of Math.random()"
```

---

## Task 7: ViewsCard — replace `dims` placeholder with real row/column counts

**Files:**
- Modify: `frontend/src/pages/Composition.jsx` (around line 722)

- [ ] **Step 1: Remove the `dims` placeholder line**

Find the line in `ViewsCard` near line 722 that reads:

```jsx
          const dims = `${Math.floor(Math.random() * 30000 + 100).toLocaleString()} rows · ${Math.floor(Math.random() * 10 + 3)} cols`;
```

Delete it.

- [ ] **Step 2: Add a fetcher pattern (same shape as Task 6)**

Inside `ViewsCard({ views, ... })`, before the `return (`, add:

```jsx
  const [dims, setDims] = useState({}); // { [view.name]: { rows, cols, error } }

  useEffect(() => {
    let cancelled = false;
    async function loadOne(v) {
      try {
        const r = await fetch('/api/views/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ view: v }),
        });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) setDims(prev => ({ ...prev, [v.name]: { error: data.detail || 'error' } }));
        else setDims(prev => ({ ...prev, [v.name]: { rows: data.n_rows, cols: (data.columns || []).length } }));
      } catch {
        if (!cancelled) setDims(prev => ({ ...prev, [v.name]: { error: 'network' } }));
      }
    }
    for (const v of views) {
      if (v?.name && !(v.name in dims)) loadOne(v);
    }
    return () => { cancelled = true; };
  }, [views]);
```

- [ ] **Step 3: Render real dimensions**

Replace the `{dims}` JSX expression (the variable that used to interpolate the random string) with:

```jsx
                  {(() => {
                    const d = dims[v.name];
                    if (!d) return '…';
                    if (d.error) return '—';
                    return `${d.rows?.toLocaleString() ?? '?'} rows · ${d.cols ?? '?'} cols`;
                  })()}
```

- [ ] **Step 4: Manually verify**

Reload the Composition tab; each view row should briefly show `…` then a real `N rows · M cols`. Refreshing the page twice should produce the same numbers (proves it's not random).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Composition.jsx
git commit -m "fix(ui): ViewsCard shows real row/column counts instead of Math.random()"
```

---

## Task 8: Wire the per-summary Preview button

**Files:**
- Modify: `frontend/src/pages/Composition.jsx` (the `<button className="btn btn-ghost">Preview</button>` inside `SummariesCard`, around line 495; also the parent `Composition` component)

- [ ] **Step 1: Add `summaryPreview` state in the parent `Composition`**

In the main `Composition` function (next to the existing `preview` and `viewPreview` state), add:

```jsx
  const [summaryPreview, setSummaryPreview] = useState(null); // null | { summary, loading?, text?, n_rows?, error? }
```

- [ ] **Step 2: Add the handler**

Below `openViewPreview`, add:

```jsx
  const openSummaryPreview = async (i) => {
    const summary = summaries[i];
    if (!summary) return;
    setSummaryPreview({ summary, loading: true });
    try {
      const resp = await fetch('/api/summaries/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) setSummaryPreview({ summary, error: data.detail || `Request failed (${resp.status})` });
      else setSummaryPreview({ summary, text: data.text || '', n_rows: data.n_rows });
    } catch (e) {
      setSummaryPreview({ summary, error: e.message || 'Network error' });
    }
  };
```

- [ ] **Step 3: Pass `onPreview` down to `SummariesCard`**

In the JSX where `SummariesCard` is rendered (around line 224), add `onPreview={openSummaryPreview}`.

- [ ] **Step 4: Wire the button inside `SummariesCard`**

Change the SummariesCard signature to `function SummariesCard({ summaries, onAdd, onEdit, onRemove, onSuggest, suggesting, onPreview })` and replace `<button className="btn btn-ghost">Preview</button>` with:

```jsx
              <button className="btn btn-ghost" onClick={() => onPreview(i)}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
                Preview
              </button>
```

- [ ] **Step 5: Add the modal next to the other previews**

Right after the existing `{viewPreview && (<Modal …>)}` block, add:

```jsx
      {summaryPreview && (
        <Modal
          title={`Preview · ${summaryPreview.summary?.name || 'summary'}`}
          onClose={() => setSummaryPreview(null)}
          width={720}
        >
          <div style={{ minHeight: 160 }}>
            {summaryPreview.loading && <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 30 }}>Computing summary…</div>}
            {summaryPreview.error && (
              <div style={{ color: 'var(--danger, #b91c1c)', whiteSpace: 'pre-wrap' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Couldn’t compute this summary</div>
                <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }}>{summaryPreview.error}</div>
              </div>
            )}
            {summaryPreview.text && (
              <>
                {summaryPreview.n_rows !== undefined && (
                  <div style={{ color: 'var(--ink-3)', fontSize: 12, marginBottom: 8 }}>
                    From {summaryPreview.n_rows.toLocaleString()} row{summaryPreview.n_rows === 1 ? '' : 's'}
                  </div>
                )}
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{summaryPreview.text}</div>
              </>
            )}
          </div>
        </Modal>
      )}
```

- [ ] **Step 6: Manually verify**

Open Composition, click Preview on a summary row → modal renders the computed text.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Composition.jsx
git commit -m "feat(ui): wire summary Preview button to /api/summaries/preview"
```

---

## Task 9: Replace the "Preview composition" stub with inline counters

**Files:**
- Modify: `frontend/src/pages/Composition.jsx` (the `Header` component around lines 517–520)

This button promised more than it could deliver. Replace it with a passive, honest summary of what's configured.

- [ ] **Step 1: Update the `Header` function signature to accept counts**

Change `function Header({ questionCount, onSave })` to:

```jsx
function Header({ questionCount, counts, onSave }) {
```

- [ ] **Step 2: Replace the "Preview composition" button with a counter strip**

Find the line that renders the toast'd button (around line 517–520) and replace the whole `<button className="btn" onClick={() => toast('Preview coming next', 'err')}>…</button>` element with:

```jsx
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', color: 'var(--ink-3)', fontSize: 12.5, marginRight: 12 }}>
          <span>{counts.charts} charts</span>
          <span>·</span>
          <span>{counts.indicators} indicators</span>
          <span>·</span>
          <span>{counts.summaries} summaries</span>
          <span>·</span>
          <span>{counts.views} views</span>
        </div>
```

- [ ] **Step 3: Pass counts in from the parent**

In the parent `Composition`'s `return (`, change `<Header questionCount={questionCount} onSave={saveAll} />` to:

```jsx
      <Header
        questionCount={questionCount}
        counts={{ charts: charts.length, indicators: indicators.length, summaries: summaries.length, views: views.length }}
        onSave={saveAll}
      />
```

- [ ] **Step 4: Manually verify**

Reload Composition. The header should now show `12 charts · 4 indicators · 6 summaries · 3 views` (or whatever the user actually has) instead of the "Preview composition" button. The button-shaped affordance that lied is gone.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Composition.jsx
git commit -m "fix(ui): replace dead 'Preview composition' button with live counters"
```

---

## Task 10: README — document the trust changes

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a short "Trust & audit" section near the feature list**

After the existing feature bullets, add:

```markdown
### Trust & audit

- Every value shown in the Composition tab — indicator "Latest", view dimensions — is computed live from your downloaded data. No placeholders.
- Generated `.docx` reports include a provenance footer: when the report was generated, when the underlying data was downloaded, the number of submissions, the active filters, and a short hash of the config that produced the report. Two reports from the same config and data set have the same hash; if they differ, something in the inputs changed.
- A pytest suite under `tests/` covers the provenance helper and a build-report smoke path. Run `pytest -v` to verify.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README section on trust signals and provenance"
```

---

## Self-review checklist

After all tasks land:

- [ ] `grep -rn "Math.random" frontend/src/pages/` returns no Composition.jsx hits (only legitimate uses elsewhere, if any).
- [ ] `grep -n "coming next" frontend/src/pages/Composition.jsx` returns no hits.
- [ ] `pytest -v` reports all tests passing.
- [ ] A freshly generated `.docx` contains `Generated 20XX-XX-XX` and `cfg <hash>` text in its body.
- [ ] Composition tab shows real numbers; reloading the page twice produces identical values.

---

## What's deferred to Phase B / C / D

| Item | Phase |
|---|---|
| Validation view (outliers, missingness, duplicates) | B |
| Multi-period (baseline → midline → endline) primitive | B |
| Results-framework hierarchy (Output → Outcome → Impact) | B |
| PII / consent redaction step | B |
| One-click Codespaces button + Docker image | C |
| No-terminal install path | C |
| Localization manager (FR/EN UI strings) | D |
| Undo / config version history | D |
| Scheduled refresh (cron) | D |
