"""XTF-16 — build-report clears the reports output_dir so each build is the
current set.

These tests encode the acceptance criteria for the bug fix: at the start of a
build run, prior ``*.docx`` reports in the reports ``output_dir`` must be removed
so the resulting set reflects ONLY the current build (default, split-by, and
``--split-sample`` alike). Today ``ReportBuilder.build()`` only ``mkdir``s the
output_dir and writes one report per split value, so reports ACCUMULATE.

We call ``ReportBuilder.build()`` in-process (offline, MPLBACKEND=Agg) and count
``*.docx`` files in the reports ``output_dir``. We reuse the smoke-test
conventions: a tiny ``{alias}_data_{ts}.csv`` under ``export.output_dir`` and a
minimal config with no ``ai:`` section, plus a real template produced by
``generate_template`` so ``build()`` renders without network or LLM access.
"""
from pathlib import Path

import pandas as pd
import pytest
import yaml

from src.reports.builder import ReportBuilder
from src.reports.template_generator import generate_template


def _docx_files(out_dir: Path):
    """Reports counted by the contract: only ``*.docx`` directly in output_dir."""
    return sorted(out_dir.glob("*.docx"))


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    """Self-contained workspace: tiny CSV + minimal config + a real template.

    ``Region`` has THREE distinct values (A, B, C) so split-by / split-sample
    behaviour is exercised. ``build()`` runs entirely offline.
    """
    ws = tmp_path / "ws"
    (ws / "data" / "processed").mkdir(parents=True)
    (ws / "templates").mkdir()
    (ws / "reports").mkdir()

    csv_path = ws / "data" / "processed" / "outsmoke_data_20260101_120000.csv"
    pd.DataFrame(
        {
            "Region": ["A", "B", "C", "A", "B", "C"],
            "Age":    [10, 20, 30, 40, 50, 60],
        }
    ).to_csv(csv_path, index=False)

    template_path = ws / "templates" / "t.docx"
    out_dir = ws / "reports"

    cfg = {
        "api":  {"url": "https://kf.kobotoolbox.org/api/v2", "token": "dummy", "platform": "kobo"},
        "form": {"alias": "outsmoke", "uid": "x"},
        "questions": [
            {"kobo_key": "Region", "label": "Region", "type": "select_one",
             "category": "categorical", "group": "", "export_label": "Region"},
            {"kobo_key": "Age", "label": "Age", "type": "integer",
             "category": "quantitative", "group": "", "export_label": "Age"},
        ],
        "filters": [],
        "charts": [
            {"name": "age_dist", "title": "Age Distribution", "type": "histogram",
             "questions": ["Age"], "options": {}},
        ],
        "report": {
            "template":   str(template_path),
            "output_dir": str(out_dir),
            "title": "Out Smoke", "period": "Q1 2026",
        },
        "export": {"format": "csv", "output_dir": str(ws / "data" / "processed")},
    }
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))

    # A real template so DocxTemplate.render/save works offline.
    generate_template(cfg, template_path)

    monkeypatch.chdir(ws)
    return {"ws": ws, "cfg": cfg, "out_dir": out_dir}


def test_build_clears_stale_reports_single(workspace):
    """AC: a non-split build removes prior *.docx; exactly one report remains.

    Seed output_dir with two stale reports, then run a single (non-split)
    build(). The two stale files must be gone and exactly one report .docx
    must exist afterwards.
    """
    out_dir = workspace["out_dir"]
    stale_a = out_dir / "outsmoke_report_20250101.docx"
    stale_b = out_dir / "outsmoke_report_Region_X_20250101.docx"
    stale_a.write_bytes(b"stale-a")
    stale_b.write_bytes(b"stale-b")
    # A non-.docx file must survive: only reports `*.docx` are cleared.
    keep = out_dir / "notes.txt"
    keep.write_text("keep me")

    ReportBuilder(workspace["cfg"]).build()

    assert not stale_a.exists(), "stale report A should have been cleared before the build"
    assert not stale_b.exists(), "stale report B should have been cleared before the build"
    assert keep.exists() and keep.read_text() == "keep me", \
        "non-.docx files in output_dir must not be cleared (only reports *.docx)"
    docs = _docx_files(out_dir)
    assert len(docs) == 1, f"expected exactly one report after a single build, got {[d.name for d in docs]}"


def test_build_split_sample_yields_exactly_n(workspace):
    """AC: split build with split_sample=2 over a 3-value column yields exactly 2.

    Pre-seed the dir with a stale report from a 'prior full build' to prove the
    preview build does not leave leftovers behind.
    """
    out_dir = workspace["out_dir"]
    (out_dir / "outsmoke_report_Region_OLD_20250101.docx").write_bytes(b"stale")

    paths = ReportBuilder(workspace["cfg"]).build(split_by="Region", split_sample=2)

    assert len(paths) == 2, f"build() should return 2 paths for split_sample=2, got {paths}"
    docs = _docx_files(out_dir)
    assert len(docs) == 2, (
        f"expected EXACTLY 2 report .docx for split_sample=2 (no leftovers), "
        f"got {[d.name for d in docs]}"
    )


def test_build_full_replaces_preview(workspace):
    """AC: a full split build after a split_sample=2 build replaces the 2 with 3.

    The prior 2 preview files must not linger as a 4th/5th report. We stand in
    for a real prior build by seeding two reports carrying an *older* date suffix
    (the build-date suffix differs day-to-day, so without a clear they survive
    the new run rather than being overwritten by the same-named fresh files).
    """
    out_dir = workspace["out_dir"]
    (out_dir / "outsmoke_report_A_20250101.docx").write_bytes(b"stale-preview-A")
    (out_dir / "outsmoke_report_B_20250101.docx").write_bytes(b"stale-preview-B")
    assert len(_docx_files(out_dir)) == 2, "precondition: two prior preview reports present"

    paths = ReportBuilder(workspace["cfg"]).build(split_by="Region", split_sample=None)

    assert len(paths) == 3, f"full split over 3 values should return 3 paths, got {paths}"
    docs = _docx_files(out_dir)
    assert len(docs) == 3, (
        f"expected EXACTLY 3 report .docx after the full build (preview's 2 must not linger), "
        f"got {[d.name for d in docs]}"
    )
