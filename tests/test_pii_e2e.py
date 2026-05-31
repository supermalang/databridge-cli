"""End-to-end: build a report with PII config; assert raw values are absent from the rendered docx."""
import os, subprocess, sys, zipfile
from pathlib import Path

import pandas as pd
import pytest
import yaml


@pytest.fixture
def tmp_pii_workspace(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    (ws / "data" / "processed").mkdir(parents=True)
    (ws / "templates").mkdir()
    (ws / "reports").mkdir()

    # Two rows, only one consents
    pd.DataFrame({
        "Consent":         ["yes", "no"],
        "Respondent_name": ["Alice_Sharp_Knife", "Bob_Easy_Target"],
        "Phone_number":    ["555-CONSENTING", "555-DECLINED"],
        "Age":             [10, 11],
    }).to_csv(ws / "data" / "processed" / "piismoke_data_20260101_120000.csv", index=False)

    cfg = {
        "api":  {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "piismoke", "uid": "x"},
        "questions": [
            {"kobo_key": "Age", "label": "Age", "type": "integer",
             "category": "quantitative", "group": "", "export_label": "Age"},
            {"kobo_key": "Consent", "label": "Consent", "type": "select_one",
             "category": "categorical", "group": "", "export_label": "Consent"},
        ],
        "filters": [],
        "charts":  [{"name": "h", "title": "Age", "type": "histogram", "questions": ["Age"]}],
        "indicators": [{"name": "n", "stat": "count", "question": "Age"}],
        "pii": {
            "consent_column": "Consent",
            "consent_value":  "yes",
            "redact": [
                {"column": "Respondent_name", "strategy": "drop"},
                {"column": "Phone_number",    "strategy": "hash"},
            ],
        },
        "report": {
            "template":   str(ws / "templates" / "t.docx"),
            "output_dir": str(ws / "reports"),
            "title": "PII smoke",
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


def test_build_report_with_pii_does_not_expose_raw_pii(tmp_pii_workspace):
    r = _run_cli("generate-template", "--out", str(tmp_pii_workspace / "templates" / "t.docx"))
    assert r.returncode == 0, f"generate-template failed:\n{r.stderr}"
    r = _run_cli("build-report")
    assert r.returncode == 0, f"build-report failed:\n{r.stderr}"
    docs = list((tmp_pii_workspace / "reports").glob("piismoke_report_*.docx"))
    assert len(docs) == 1
    text = _docx_text(docs[0])
    # Raw values must NOT appear anywhere in the rendered XML.
    assert "Alice_Sharp_Knife" not in text,    "raw name leaked"
    assert "Bob_Easy_Target"   not in text,    "raw name leaked"
    assert "555-CONSENTING"    not in text,    "raw phone leaked"
    assert "555-DECLINED"      not in text,    "raw phone leaked"
    # Provenance should mention PII applied
    assert "pii" in text.lower(), "provenance footer should mention pii"
