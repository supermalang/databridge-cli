"""Tests for the tables report section + table/indicator AI suggesters."""
import io

import pandas as pd
from docx import Document
from docxtpl import DocxTemplate, InlineImage

from src.reports.builder import ReportBuilder
from src.reports.ai_table_suggester import suggest_tables
from src.reports.ai_indicator_suggester import suggest_indicators


# ── _generate_tables ───────────────────────────────────────────────────────────

def test_generate_tables_produces_table_keys(monkeypatch):
    """MNT-30 native-table contract: each cfg['tables'] entry yields a
    table_<name> context key that resolves to a native Word table, NOT a
    matplotlib PNG / InlineImage — and generate_chart is NOT invoked for a
    table recipe (the opposite of the old chart-engine path)."""
    import src.reports.builder as builder

    # Spy: record any generate_chart call. Under the native-table contract this
    # must never fire for a `tables:` recipe (the opposite of the old PNG path).
    calls = []

    def spy_generate_chart(recipe, df):  # pragma: no cover - must not run
        calls.append(recipe)
        raise AssertionError(
            "generate_chart was invoked for a table recipe — native tables must "
            "not route through the chart/PNG engine."
        )

    monkeypatch.setattr(builder, "generate_chart", spy_generate_chart)

    cfg = {
        "questions": [{"kobo_key": "region", "export_label": "Region", "category": "categorical"}],
        "tables": [{"name": "region_breakdown", "title": "By Region", "questions": ["Region"]}],
    }
    df = pd.DataFrame({"Region": ["N", "S", "N"]})

    rb = ReportBuilder(cfg)

    # A real DocxTemplate so any native-table machinery (subdoc / marker) is
    # built against a genuine docx part — no faking of the docxtpl internals.
    buf = io.BytesIO()
    doc = Document()
    doc.add_paragraph("{{ table_region_breakdown }}")
    doc.save(buf)
    buf.seek(0)
    tpl = DocxTemplate(buf)

    tables = rb._generate_tables(tpl, df, {})

    assert "table_region_breakdown" in tables
    value = tables["table_region_breakdown"]

    # Native table, not a flattened image: the context value must NOT be an
    # InlineImage (the removed PNG path) nor a PNG file path.
    assert not isinstance(value, InlineImage), (
        "table_region_breakdown maps to an InlineImage — the table PNG render "
        "path is exactly what MNT-30 removed; it must render as a native table."
    )
    assert not (isinstance(value, str) and value.lower().endswith(".png")), (
        f"table_region_breakdown maps to a PNG path ({value!r}); a table recipe "
        "must render as a native Word table, not an image."
    )

    # generate_chart must not have been called for the table recipe.
    assert calls == [], (
        "generate_chart was called for a table recipe; native tables must not "
        "emit a chart/PNG."
    )


def test_generate_tables_empty_when_no_tables():
    cfg = {"questions": []}
    rb = ReportBuilder(cfg)
    assert rb._generate_tables(object(), pd.DataFrame(), {}) == {}


# ── suggesters: graceful no-AI ───────────────────────────────────────────────────

def test_suggest_tables_no_ai_returns_empty():
    assert suggest_tables({"questions": [{"kobo_key": "x"}]}) == []
    # env: placeholder key counts as unresolved → []
    cfg = {"ai": {"api_key": "env:OPENAI_API_KEY"}, "questions": [{"kobo_key": "x"}]}
    assert suggest_tables(cfg) == []


def test_suggest_indicators_no_ai_returns_empty():
    assert suggest_indicators({"questions": [{"kobo_key": "x"}]}) == []
    cfg = {"ai": {"api_key": "env:OPENAI_API_KEY"}, "questions": [{"kobo_key": "x"}]}
    assert suggest_indicators(cfg) == []


# ── suggesters: parse + type-forcing with a mocked LLM ────────────────────────────

def test_suggest_tables_forces_table_type(monkeypatch):
    import src.reports.ai_table_suggester as mod
    from src.utils import lf_client

    monkeypatch.setattr(lf_client, "get_prompt", lambda *a, **k: ([{"role": "user", "content": "x"}], {}))
    monkeypatch.setattr(
        lf_client, "chat",
        lambda *a, **k: '{"tables": [{"name": "t1", "title": "T1", "questions": ["Region"]}]}',
    )
    cfg = {
        "ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o"},
        "questions": [{"kobo_key": "region", "export_label": "Region", "category": "categorical"}],
    }
    tables = suggest_tables(cfg)
    assert len(tables) == 1
    assert tables[0]["type"] == "table"
    assert tables[0]["questions"] == ["Region"]


def test_suggest_indicators_parses(monkeypatch):
    from src.utils import lf_client

    monkeypatch.setattr(lf_client, "get_prompt", lambda *a, **k: ([{"role": "user", "content": "x"}], {}))
    monkeypatch.setattr(
        lf_client, "chat",
        lambda *a, **k: '{"indicators": [{"name": "n_rows", "stat": "count"}]}',
    )
    cfg = {
        "ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o"},
        "questions": [{"kobo_key": "region", "export_label": "Region", "category": "categorical"}],
    }
    inds = suggest_indicators(cfg)
    assert inds == [{"name": "n_rows", "stat": "count"}]
