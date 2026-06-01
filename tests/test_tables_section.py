"""Tests for the tables report section + table/indicator AI suggesters."""
import pandas as pd

from src.reports.builder import ReportBuilder
from src.reports.ai_table_suggester import suggest_tables
from src.reports.ai_indicator_suggester import suggest_indicators


# ── _generate_tables ───────────────────────────────────────────────────────────

def test_generate_tables_produces_table_keys(monkeypatch):
    """Each cfg['tables'] entry yields a table_<name> context key, rendered via the
    chart engine with type forced to 'table'."""
    import src.reports.builder as builder

    captured = {}

    def fake_generate_chart(recipe, df):
        captured["recipe"] = recipe
        # Return a real existing file so InlineImage can be constructed.
        from src.reports.charts import CHART_DIR
        CHART_DIR.mkdir(parents=True, exist_ok=True)
        p = CHART_DIR / "fake_table.png"
        # 1x1 PNG bytes
        p.write_bytes(
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00"
            b"\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        return p

    monkeypatch.setattr(builder, "generate_chart", fake_generate_chart)

    cfg = {
        "questions": [{"kobo_key": "region", "export_label": "Region", "category": "categorical"}],
        "tables": [{"name": "region_breakdown", "title": "By Region", "questions": ["Region"]}],
    }
    df = pd.DataFrame({"Region": ["N", "S", "N"]})

    rb = ReportBuilder(cfg)

    class _FakeTpl:  # InlineImage only stores the tpl reference
        pass

    images = rb._generate_tables(_FakeTpl(), df, {})
    assert "table_region_breakdown" in images
    # Type was forced to "table" regardless of what the recipe specified.
    assert captured["recipe"]["type"] == "table"


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
