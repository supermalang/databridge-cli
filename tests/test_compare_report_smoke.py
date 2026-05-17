"""Smoke: build a comparison report across two periods and assert both appear in the docx."""
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pandas as pd
import pytest
import yaml


@pytest.fixture
def tmp_compare_workspace(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    (ws / "data" / "processed").mkdir(parents=True)
    (ws / "templates").mkdir()
    (ws / "reports").mkdir()

    # Two period datasets, same schema, different values
    pd.DataFrame({"Age": [10, 11, 12]}).to_csv(
        ws / "data" / "processed" / "cmpsmoke_q1_2026_data_20260101_120000.csv", index=False)
    pd.DataFrame({"Age": [15, 16, 17]}).to_csv(
        ws / "data" / "processed" / "cmpsmoke_q2_2026_data_20260101_120000.csv", index=False)

    cfg = {
        "api":  {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "cmpsmoke", "uid": "x"},
        "questions": [
            {"kobo_key": "Age", "label": "Age", "type": "integer",
             "category": "quantitative", "group": "", "export_label": "Age"},
        ],
        "filters": [],
        "charts": [{"name": "h", "title": "Age", "type": "histogram", "questions": ["Age"]}],
        "report": {
            "template":   str(ws / "templates" / "t.docx"),
            "output_dir": str(ws / "reports"),
            "title": "Compare", "period": "Q2 2026",
        },
        "export": {"format": "csv", "output_dir": str(ws / "data" / "processed")},
        "periods": {
            "current":  "Q2 2026",
            "baseline": "Q1 2026",
            "registry": [
                {"label": "Q1 2026", "slug": "q1_2026"},
                {"label": "Q2 2026", "slug": "q2_2026"},
            ],
        },
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


def test_build_compare_report_includes_both_periods(tmp_compare_workspace):
    # Generate a starter template
    r = _run_cli("generate-template", "--out", str(tmp_compare_workspace / "templates" / "t.docx"))
    assert r.returncode == 0, f"generate-template failed:\nSTDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}"
    # Build comparison report
    r = _run_cli("build-report", "--compare", "Q1 2026,Q2 2026")
    assert r.returncode == 0, f"build-report --compare failed:\nSTDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}"
    # Find the produced docx and verify provenance text mentions both periods
    docs = list((tmp_compare_workspace / "reports").glob("cmpsmoke_report_*.docx"))
    assert len(docs) == 1, f"expected one .docx, got {[d.name for d in docs]}"
    text = _docx_text(docs[0])
    assert "Q1 2026" in text, "Q1 2026 missing from docx text"
    assert "Q2 2026" in text, "Q2 2026 missing from docx text"
    assert "compare" in text.lower(), "expected 'compare' marker in footer (provenance.footer)"
