"""XTF-27 — Express Fill: bullet_list render type for column-value lists.

Acceptance criteria tested here:
  AC1 — A chart config with type: bullet_list and questions: [ColumnName]
        makes build-report inject a `•`-prefixed text paragraph into the
        Word document at the {{ list_<name> }} placeholder position,
        filtered to the current split slice.
  AC2 — generate-template creates a {{ list_<name> }} text-run placeholder
        (not {{ chart_N }}) when a bullet_list chart is configured.
  AC4 — Both main-table and repeat-table `source:` columns are supported.

(AC3 — "bullet_list is a selectable type in the Composition tab's chart
type dropdown" — is covered by the Playwright E2E spec, not here.)
"""
import zipfile
from pathlib import Path

import pandas as pd
import pytest
import yaml
from docxtpl import InlineImage

from src.reports.builder import ReportBuilder
from src.reports.template_generator import generate_template


def _docx_full_text(path: Path) -> str:
    """Return the raw XML text of word/document.xml (includes all run text)."""
    with zipfile.ZipFile(path) as z:
        return z.read("word/document.xml").decode("utf-8", errors="replace")


def _base_cfg(ws: Path, chart_cfg: dict, alias: str = "xtf27") -> dict:
    template_path = ws / "templates" / "t.docx"
    return {
        "api": {
            "url": "https://kf.kobotoolbox.org/api/v2",
            "token": "dummy",
            "platform": "kobo",
        },
        "form": {"alias": alias, "uid": "x"},
        "questions": [
            {
                "kobo_key": "Village",
                "label": "Village",
                "type": "text",
                "category": "qualitative",
                "group": "",
                "export_label": "Village",
            },
            {
                "kobo_key": "Commune",
                "label": "Commune",
                "type": "select_one",
                "category": "categorical",
                "group": "",
                "export_label": "Commune",
            },
        ],
        "filters": [],
        "charts": [chart_cfg],
        "report": {
            "template": str(template_path),
            "output_dir": str(ws / "reports"),
            "title": "XTF-27 Smoke",
            "period": "Q2 2026",
        },
        "export": {
            "format": "csv",
            "output_dir": str(ws / "data" / "processed"),
        },
    }


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    (ws / "data" / "processed").mkdir(parents=True)
    (ws / "templates").mkdir()
    (ws / "reports").mkdir()
    monkeypatch.chdir(ws)
    return ws


def _write_main_csv(ws: Path, alias: str, df: pd.DataFrame) -> None:
    csv_path = ws / "data" / "processed" / f"{alias}_data_20260101_120000.csv"
    df.to_csv(csv_path, index=False)


def _write_cfg(ws: Path, cfg: dict) -> None:
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))


# ---------------------------------------------------------------------------
# AC1a — builder context contains list_<name> as a plain string, not an image
# ---------------------------------------------------------------------------

def test_bullet_list_renders_as_text_not_image(workspace):
    """Given a Village column + a bullet_list chart, the render context's
    list_<name> entry must be a bullet-prefixed string, never an InlineImage."""
    chart_cfg = {
        "name": "villages",
        "title": "Villages",
        "type": "bullet_list",
        "questions": ["Village"],
        "options": {},
    }
    cfg = _base_cfg(workspace, chart_cfg)
    df = pd.DataFrame({
        "Village": ["Alpha", "Beta", "Gamma"],
        "Commune": ["X", "X", "X"],
    })
    _write_main_csv(workspace, "xtf27", df)
    _write_cfg(workspace, cfg)

    generate_template(cfg, Path(cfg["report"]["template"]))

    builder = ReportBuilder(cfg)
    # _generate_charts is the internal hook that returns the per-chart context
    # entries merged into the docxtpl render context (mirrors _generate_tables
    # usage elsewhere in the class).
    context_entries = builder._generate_charts(
        tpl=None, df=df, repeat_tables={},
    )

    assert "list_villages" in context_entries, (
        "Expected a 'list_villages' key in the chart context for a bullet_list "
        f"chart named 'villages'; got keys: {list(context_entries.keys())}"
    )
    value = context_entries["list_villages"]
    assert not isinstance(value, InlineImage), (
        "bullet_list must inject plain text into the docx, not an InlineImage — "
        "the whole point of this render type is to avoid the image pipeline."
    )
    assert isinstance(value, str), (
        f"list_villages must be a string; got {type(value)}"
    )
    for village in ("Alpha", "Beta", "Gamma"):
        assert f"• {village}" in value or f"•{village}" in value, (
            f"Expected a bullet-prefixed entry for '{village}' in: {value!r}"
        )


# ---------------------------------------------------------------------------
# AC1b — split-value filtering: only rows matching the split slice appear
# ---------------------------------------------------------------------------

def test_bullet_list_filters_by_split_value(workspace):
    """When split_by=Commune and split_value=X, only Commune==X rows' Village
    values must appear in the rendered list."""
    chart_cfg = {
        "name": "villages",
        "title": "Villages",
        "type": "bullet_list",
        "questions": ["Village"],
        "options": {},
    }
    cfg = _base_cfg(workspace, chart_cfg)
    cfg["report"]["split_by"] = "Commune"
    df = pd.DataFrame({
        "Village": ["Alpha", "Beta", "Gamma", "Delta"],
        "Commune": ["X", "X", "Y", "Y"],
    })
    _write_main_csv(workspace, "xtf27", df)
    _write_cfg(workspace, cfg)

    generate_template(cfg, Path(cfg["report"]["template"]))

    builder = ReportBuilder(cfg)
    docs = builder.build(split_by="Commune")
    assert docs, "build() with split_by must produce at least one .docx per split value"

    # Filenames follow "<alias>_report_<safe_split_value>_<date>.docx"; find the
    # one built for split value "X".
    matching = [d for d in docs if "_X_" in d.stem]
    assert matching, f"Expected a report file for split value 'X' among: {[d.name for d in docs]}"
    xml = _docx_full_text(matching[0])

    assert "Alpha" in xml and "Beta" in xml, (
        "Rows belonging to split slice 'X' must appear in the rendered bullet list."
    )
    assert "Gamma" not in xml and "Delta" not in xml, (
        "Rows belonging to split slice 'Y' must NOT leak into the 'X' report's "
        "bullet list — the list must be filtered to the current split slice."
    )


# ---------------------------------------------------------------------------
# AC2 — generate_template emits a {{ list_<name> }} text placeholder, not
# {{ chart_<name> }}, for a bullet_list chart.
# ---------------------------------------------------------------------------

def test_template_generator_emits_text_placeholder_for_bullet_list(workspace):
    chart_cfg = {
        "name": "villages",
        "title": "Villages",
        "type": "bullet_list",
        "questions": ["Village"],
        "options": {},
    }
    cfg = _base_cfg(workspace, chart_cfg)
    template_path = Path(cfg["report"]["template"])

    generate_template(cfg, template_path)

    xml = _docx_full_text(template_path)
    assert "list_villages" in xml, (
        "generate_template must emit a '{{ list_villages }}' text-run placeholder "
        f"for a bullet_list chart named 'villages'. XML did not contain it."
    )
    assert "chart_villages" not in xml, (
        "generate_template must NOT emit a '{{ chart_villages }}' image placeholder "
        "for a bullet_list chart — the whole point of this type is a text placeholder."
    )


# ---------------------------------------------------------------------------
# AC4 — repeat-table `source:` columns are supported for bullet_list too.
# ---------------------------------------------------------------------------

def test_bullet_list_repeat_table_source(workspace):
    """Given a repeat-table column configured as `source:`, the builder
    context's list_<name> must be built from the repeat table's rows, not
    the main table."""
    chart_cfg = {
        "name": "members",
        "title": "Household members",
        "type": "bullet_list",
        "questions": ["MemberName"],
        "source": "hh_members",
        "options": {},
    }
    cfg = _base_cfg(workspace, chart_cfg)
    main_df = pd.DataFrame({
        "Village": ["Alpha", "Beta"],
        "Commune": ["X", "X"],
    })
    repeat_df = pd.DataFrame({
        "MemberName": ["Jean", "Awa", "Moussa"],
        "_parent_index": [0, 0, 1],
    })
    _write_main_csv(workspace, "xtf27", main_df)
    _write_cfg(workspace, cfg)

    generate_template(cfg, Path(cfg["report"]["template"]))

    builder = ReportBuilder(cfg)
    context_entries = builder._generate_charts(
        tpl=None, df=main_df, repeat_tables={"hh_members": repeat_df},
    )

    assert "list_members" in context_entries, (
        f"Expected 'list_members' key in chart context; got: {list(context_entries.keys())}"
    )
    value = context_entries["list_members"]
    assert isinstance(value, str), f"list_members must be a string; got {type(value)}"
    for name in ("Jean", "Awa", "Moussa"):
        assert name in value, (
            f"Expected repeat-table member '{name}' in the bullet_list output when "
            f"source: hh_members is configured. Got: {value!r}"
        )
