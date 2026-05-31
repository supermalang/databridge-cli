"""Smoke test: build a minimal report and verify provenance text is in the docx."""
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pandas as pd
import pytest
import yaml


@pytest.fixture
def tmp_report_dir(tmp_path, monkeypatch):
    """Stage a self-contained workspace with a tiny CSV + minimal config."""
    workspace = tmp_path / "ws"
    (workspace / "data" / "processed").mkdir(parents=True)
    (workspace / "templates").mkdir()
    (workspace / "reports").mkdir()

    # Tiny CSV that looks like a Kobo export. The filename must match the
    # {alias}_data_{ts}.csv convention so load_processed_data finds it.
    csv_path = workspace / "data" / "processed" / "smoke_data_20260101_120000.csv"
    pd.DataFrame({"Region": ["A", "B", "A"], "Age": [10, 20, 30]}).to_csv(csv_path, index=False)

    # Minimal config — no `ai:` section so the narrator no-ops.
    # `api:` key is required by load_config; platform must be 'kobo' or 'ona'.
    # `charts:` must be non-empty or build-report exits 1 before rendering.
    cfg = {
        "api":  {"url": "https://kf.kobotoolbox.org/api/v2", "token": "dummy", "platform": "kobo"},
        "form":  {"alias": "smoke", "uid": "x"},
        "questions": [
            {"kobo_key": "Region", "label": "Region", "type": "select_one",
             "category": "categorical", "group": "", "export_label": "Region"},
            {"kobo_key": "Age",    "label": "Age",    "type": "integer",
             "category": "quantitative", "group": "", "export_label": "Age"},
        ],
        "filters": ["Age > 0"],
        "charts": [
            {"name": "age_dist", "title": "Age Distribution", "type": "histogram",
             "questions": ["Age"], "options": {}},
        ],
        "report": {
            "template":   str(workspace / "templates" / "t.docx"),
            "output_dir": str(workspace / "reports"),
            "title": "Smoke", "period": "Q1 2026",
        },
        "export": {"format": "csv", "output_dir": str(workspace / "data" / "processed")},
    }
    (workspace / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))

    monkeypatch.chdir(workspace)
    yield workspace


def _docx_text(path: Path) -> str:
    """Return all visible text by reading word/document.xml from the .docx."""
    with zipfile.ZipFile(path) as z:
        return z.read("word/document.xml").decode("utf-8", errors="replace")


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    """Run the project's CLI as a subprocess with PYTHONPATH set."""
    project_root = Path(__file__).resolve().parent.parent
    env = {
        "PATH": os.environ.get("PATH", ""),
        "PYTHONPATH": str(project_root),
        # Pass through anything an LLM client might inspect, in case narrator
        # tries to short-circuit on a missing key — should be a no-op since
        # we don't configure ai: at all.
    }
    return subprocess.run(
        [sys.executable, str(project_root / "src" / "data" / "make.py"), *args],
        env=env, capture_output=True, text=True,
    )


def test_build_report_writes_provenance_footer(tmp_report_dir):
    # Generate a starter template that includes the provenance placeholder.
    template_path = tmp_report_dir / "templates" / "t.docx"
    r = _run_cli("generate-template", "--out", str(template_path))
    assert r.returncode == 0, f"generate-template failed:\nSTDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}"
    assert template_path.exists()

    # Build the report.
    r = _run_cli("build-report")
    assert r.returncode == 0, f"build-report failed:\nSTDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}"

    # Find the produced .docx and assert provenance markers are present.
    docs = list((tmp_report_dir / "reports").glob("smoke_report_*.docx"))
    assert len(docs) == 1, f"expected one .docx, got {[d.name for d in docs]}"
    text = _docx_text(docs[0])
    assert "Generated " in text,           f"missing 'Generated ' marker. Body sample: {text[:500]}"
    assert "cfg " in text,                 f"missing 'cfg <hash>' marker. Body sample: {text[:500]}"
    assert "Q1 2026" in text,              f"missing period 'Q1 2026'. Body sample: {text[:500]}"
