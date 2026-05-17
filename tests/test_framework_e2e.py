"""End-to-end: build a report with a framework configured, assert the
logframe text appears in the rendered docx."""
import os, subprocess, sys, zipfile
from pathlib import Path

import pandas as pd
import pytest
import yaml


@pytest.fixture
def tmp_framework_workspace(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    (ws / "data" / "processed").mkdir(parents=True)
    (ws / "templates").mkdir()
    (ws / "reports").mkdir()

    pd.DataFrame({"Age": [10, 11, 12, 13]}).to_csv(
        ws / "data" / "processed" / "fwsmoke_data_20260101_120000.csv", index=False)

    cfg = {
        "api":  {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "fwsmoke", "uid": "x"},
        "questions": [
            {"kobo_key": "Age", "label": "Age", "type": "integer",
             "category": "quantitative", "group": "", "export_label": "Age"},
        ],
        "filters": [],
        "charts": [{"name": "h", "title": "Age", "type": "histogram", "questions": ["Age"]}],
        "indicators": [
            {"name": "total_respondents", "stat": "count", "question": "Age", "framework_ref": "OP1.1"},
        ],
        "framework": {
            "goal":     {"id": "GOAL", "label": "Improve survey coverage"},
            "outcomes": [{"id": "OC1", "label": "Reach all target villages", "parent": "GOAL"}],
            "outputs":  [{"id": "OP1.1", "label": "Conduct village survey", "parent": "OC1"}],
        },
        "report": {
            "template":   str(ws / "templates" / "t.docx"),
            "output_dir": str(ws / "reports"),
            "title": "Framework smoke", "period": "Q1 2026",
        },
        "export": {"format": "csv", "output_dir": str(ws / "data" / "processed")},
    }
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    yield ws


def _docx_text(path):
    with zipfile.ZipFile(path) as z:
        return z.read("word/document.xml").decode("utf-8", errors="replace")


def _run_cli(*args):
    project_root = Path(__file__).resolve().parent.parent
    env = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(project_root)}
    return subprocess.run(
        [sys.executable, str(project_root / "src" / "data" / "make.py"), *args],
        env=env, capture_output=True, text=True,
    )


def test_build_report_renders_logframe(tmp_framework_workspace):
    r = _run_cli("generate-template", "--out", str(tmp_framework_workspace / "templates" / "t.docx"))
    assert r.returncode == 0, f"generate-template failed:\n{r.stderr}"
    r = _run_cli("build-report")
    assert r.returncode == 0, f"build-report failed:\n{r.stderr}"
    docs = list((tmp_framework_workspace / "reports").glob("fwsmoke_report_*.docx"))
    assert len(docs) == 1, f"expected one docx, got {[d.name for d in docs]}"
    text = _docx_text(docs[0])
    assert "Improve survey coverage" in text, "goal label missing from docx"
    assert "Reach all target villages" in text, "outcome label missing from docx"
    assert "Conduct village survey" in text, "output label missing from docx"
    # The indicator's value should be embedded in the output row
    assert "total_respondents" in text, "indicator name missing from logframe row"
