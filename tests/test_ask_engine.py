import pandas as pd
from src.utils import lf_client
from src.reports.ask_engine import build_catalog


def _profile_fixture():
    return {
        "main": {
            "name": "main", "rows": 3,
            "columns": [
                {"name": "_id", "role": "linkage", "distinct": 3, "missing_pct": 0.0},
                {"name": "Region", "role": "categorical", "distinct": 2, "missing_pct": 0.0,
                 "high_cardinality": False, "top_values": [{"value": "N", "count": 2}, {"value": "S", "count": 1}]},
                {"name": "Age", "role": "quantitative", "distinct": 3, "missing_pct": 0.0,
                 "min": 10.0, "max": 30.0, "mean": 20.0, "median": 20.0},
                {"name": "Story", "role": "qualitative", "distinct": 3, "missing_pct": 0.0,
                 "high_cardinality": True},
            ],
            "correlations": [], "duplicates": None,
        }
    }


def test_build_catalog_condenses_and_excludes_linkage():
    cat = build_catalog(_profile_fixture())
    main = next(t for t in cat["tables"] if t["name"] == "main")
    names = {c["name"]: c for c in main["columns"]}
    assert "_id" not in names
    assert names["Region"]["role"] == "categorical"
    assert names["Region"]["top_values"] == ["N", "S"]
    assert names["Age"]["min"] == 10.0 and names["Age"]["max"] == 30.0
    assert "top_values" not in names["Story"]
    assert main["rows"] == 3


def test_ask_propose_prompt_resolves_offline():
    msgs, _cfg = lf_client.get_prompt("ask_propose", {
        "question": "How many people by region?",
        "catalog": "{}",
        "chart_types": "bar: >=1 categorical",
        "indicator_stats": "count: rows",
    })
    assert isinstance(msgs, list) and msgs
    blob = " ".join(m["content"] for m in msgs)
    assert "How many people by region?" in blob


def test_ask_caption_prompt_resolves_offline():
    msgs, _cfg = lf_client.get_prompt("ask_caption", {"charts_block": "chart_a — Region: N=5"})
    blob = " ".join(m["content"] for m in msgs)
    assert "chart_a" in blob


from src.reports.ask_engine import validate_recipe


def test_validate_recipe_accepts_valid_bar():
    ok, reason = validate_recipe({"type": "bar", "questions": ["Region"]}, _profile_fixture())
    assert ok and reason == ""


def test_validate_recipe_rejects_missing_column():
    ok, reason = validate_recipe({"type": "bar", "questions": ["Nope"]}, _profile_fixture())
    assert not ok and "Nope" in reason


def test_validate_recipe_rejects_scatter_without_two_quant():
    ok, reason = validate_recipe({"type": "scatter", "questions": ["Age", "Region"]}, _profile_fixture())
    assert not ok and "quantitative" in reason


def test_validate_recipe_rejects_unknown_type():
    ok, reason = validate_recipe({"type": "radar", "questions": ["Region"]}, _profile_fixture())
    assert not ok and "type" in reason


def test_validate_recipe_unknown_source():
    ok, reason = validate_recipe({"type": "bar", "questions": ["X"], "source": "ghost"}, _profile_fixture())
    assert not ok and "source" in reason


from src.reports import ask_engine


def test_propose_items_parses_mixed(monkeypatch):
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: ([{"role": "user", "content": "x"}], {}))
    monkeypatch.setattr(ask_engine.lf_client, "chat",
                        lambda *a, **k: '{"items": [{"kind": "chart", "name": "by_region", "type": "bar", "questions": ["Region"]}, {"kind": "indicator", "name": "n", "stat": "count"}]}')
    out = ask_engine.propose_items("q", {"tables": []}, {"provider": "openai", "api_key": "sk-x"})
    assert [i["kind"] for i in out] == ["chart", "indicator"]


def test_propose_items_defaults_kind_chart(monkeypatch):
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: ([], {}))
    monkeypatch.setattr(ask_engine.lf_client, "chat",
                        lambda *a, **k: '{"items": [{"name": "x", "type": "bar", "questions": ["Region"]}]}')
    out = ask_engine.propose_items("q", {"tables": []}, {"provider": "openai", "api_key": "sk-x"})
    assert out[0]["kind"] == "chart"


def test_propose_items_malformed_returns_empty(monkeypatch):
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: ([], {}))
    monkeypatch.setattr(ask_engine.lf_client, "chat", lambda *a, **k: "not json at all")
    assert ask_engine.propose_items("q", {"tables": []}, {"provider": "openai", "api_key": "sk-x"}) == []


from src.reports.ask_engine import render_recipe


def test_render_recipe_produces_png_and_summary():
    df = pd.DataFrame({"Region": ["N", "N", "S", "E", "E", "E"]})
    recipe = {"name": "by_region", "title": "By region", "type": "bar", "questions": ["Region"]}
    result = render_recipe(recipe, df, {})
    assert result is not None
    png, summary = result
    assert png.exists() and png.suffix == ".png"
    assert "Region" in summary and "E" in summary


def test_render_recipe_returns_none_on_bad_column():
    df = pd.DataFrame({"Region": ["N", "S"]})
    result = render_recipe({"name": "x", "type": "bar", "questions": ["Ghost"]}, df, {})
    assert result is None


def test_ground_captions_uses_llm(monkeypatch):
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: ([{"role": "user", "content": "x"}], {}))
    monkeypatch.setattr(ask_engine.lf_client, "chat",
                        lambda *a, **k: '{"captions": {"by_region": "Region E leads with 3."}}')
    items = [{"name": "by_region", "title": "By region", "summary": "Region: E=3, N=2, S=1"}]
    caps = ask_engine.ground_captions(items, {"provider": "openai", "api_key": "sk-x"})
    assert caps["by_region"] == "Region E leads with 3."


def test_ground_captions_falls_back_to_title_on_failure(monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("no ai")
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: ([], {}))
    monkeypatch.setattr(ask_engine.lf_client, "chat", _boom)
    items = [{"name": "c1", "title": "Fallback Title", "summary": "x"}]
    caps = ask_engine.ground_captions(items, {"provider": "openai", "api_key": "sk-x"})
    assert caps["c1"] == "Fallback Title"


def test_ask_mixed_chart_and_indicator(monkeypatch):
    monkeypatch.setattr(ask_engine, "propose_items", lambda q, cat, ai: [
        {"kind": "chart", "name": "by_region", "title": "By region", "type": "bar", "questions": ["Region"]},
        {"kind": "indicator", "name": "n_rows", "title": "Total", "stat": "count"},
    ])
    monkeypatch.setattr(ask_engine, "ground_captions", lambda items, ai: {it["name"]: f"cap-{it['name']}" for it in items})
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"},
           "questions": [{"export_label": "Region", "category": "categorical"}]}
    df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "E", "E"]})
    out = ask_engine.ask("q", cfg, df, {})
    kinds = sorted(p["kind"] for p in out["proposals"])
    assert kinds == ["chart", "indicator"]
    chart = next(p for p in out["proposals"] if p["kind"] == "chart")
    ind = next(p for p in out["proposals"] if p["kind"] == "indicator")
    assert chart["image"].startswith("data:image/png;base64,")
    assert ind["value"] == "3"
    assert ind["caption"] == "cap-n_rows"


def test_ask_no_ai_returns_message():
    cfg = {"ai": {"provider": "openai", "api_key": "env:OPENAI_API_KEY"}}
    out = ask_engine.ask("q", cfg, pd.DataFrame({"_id": [1]}), {})
    assert out["proposals"] == [] and "AI" in out["message"]


def test_ask_disambiguates_duplicate_recipe_names(monkeypatch):
    monkeypatch.setattr(ask_engine, "propose_items", lambda q, cat, ai: [
        {"name": "dup", "title": "A", "type": "bar", "questions": ["Region"]},
        {"name": "dup", "title": "B", "type": "bar", "questions": ["Region"]},
    ])
    # captions keyed by the (now unique) names the engine assigns
    monkeypatch.setattr(ask_engine, "ground_captions",
                        lambda items, ai: {it["name"]: f"cap-{it['name']}" for it in items})
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"},
           "questions": [{"export_label": "Region", "category": "categorical"}]}
    df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "E", "E"]})
    out = ask_engine.ask("q", cfg, df, {})
    names = [p["recipe"]["name"] for p in out["proposals"]]
    assert names == ["dup", "dup_2"]                     # disambiguated
    caps = [p["caption"] for p in out["proposals"]]
    assert caps == ["cap-dup", "cap-dup_2"]              # captions map 1:1, no collision


def test_save_recipe_chart_to_charts():
    cfg = {}
    name = ask_engine.save_recipe({"name": "by_region", "type": "bar", "questions": ["Region"]}, cfg, "chart")
    assert name == "by_region" and [c["name"] for c in cfg["charts"]] == ["by_region"]


def test_save_recipe_indicator_to_indicators():
    cfg = {}
    name = ask_engine.save_recipe({"name": "n_rows", "stat": "count", "kind": "indicator"}, cfg, "indicator")
    assert name == "n_rows"
    assert [i["name"] for i in cfg["indicators"]] == ["n_rows"]
    assert "kind" not in cfg["indicators"][0]


def test_save_recipe_dedupes_name():
    cfg = {"charts": [{"name": "by_region"}]}
    name = ask_engine.save_recipe({"name": "by_region", "type": "bar"}, cfg, "chart")
    assert name == "by_region_2"


def test_save_recipe_table_to_tables():
    cfg = {}
    name = ask_engine.save_recipe(
        {"name": "region_breakdown", "questions": ["Region"], "kind": "table"}, cfg, "table"
    )
    assert name == "region_breakdown"
    assert [t["name"] for t in cfg["tables"]] == ["region_breakdown"]
    saved = cfg["tables"][0]
    assert saved["type"] == "table"      # forced
    assert "kind" not in saved
    assert "charts" not in cfg and "indicators" not in cfg


def test_validate_recipe_table_needs_categorical():
    ok, reason = validate_recipe({"kind": "table", "questions": ["Region"]}, _profile_fixture())
    assert ok and reason == ""
    ok2, reason2 = validate_recipe({"kind": "table", "questions": ["Age"]}, _profile_fixture())
    assert not ok2 and "categorical" in reason2


def test_validate_indicator_count_ok():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "count"}, _profile_fixture())
    assert ok and reason == ""


def test_validate_indicator_sum_needs_quantitative():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "sum", "question": "Region"}, _profile_fixture())
    assert not ok and "quantitative" in reason


def test_validate_indicator_sum_ok_on_quant():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "sum", "question": "Age"}, _profile_fixture())
    assert ok and reason == ""


def test_validate_indicator_percent_needs_filter_value():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "percent", "question": "Region"}, _profile_fixture())
    assert not ok and "filter_value" in reason


def test_validate_indicator_unknown_stat():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "wat", "question": "Age"}, _profile_fixture())
    assert not ok and "stat" in reason


def test_validate_indicator_missing_column():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "sum", "question": "Ghost"}, _profile_fixture())
    assert not ok and "Ghost" in reason


def test_validate_indicator_completeness_ok_on_any_column():
    # completeness applies to any column (not just quantitative) but needs a question
    ok, reason = validate_recipe({"kind": "indicator", "stat": "completeness", "question": "Region"}, _profile_fixture())
    assert ok and reason == ""


def test_validate_indicator_completeness_needs_question():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "completeness"}, _profile_fixture())
    assert not ok and "question" in reason


def test_validate_indicator_outlier_rate_needs_quantitative():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "outlier_rate", "question": "Region"}, _profile_fixture())
    assert not ok and "quantitative" in reason


def test_validate_indicator_outlier_rate_ok_on_quant():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "outlier_rate", "question": "Age"}, _profile_fixture())
    assert ok and reason == ""


def test_validate_indicator_duplicate_rate_ok_on_any_column():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "duplicate_rate", "question": "Region"}, _profile_fixture())
    assert ok and reason == ""


def test_validate_indicator_duplicate_rate_needs_question():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "duplicate_rate"}, _profile_fixture())
    assert not ok and "question" in reason


def test_validate_chart_still_works_without_kind():
    ok, reason = validate_recipe({"type": "bar", "questions": ["Region"]}, _profile_fixture())
    assert ok and reason == ""


from src.reports.ask_engine import compute_indicator


def test_compute_indicator_count():
    df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "E", "E"]})
    val = compute_indicator({"name": "n", "stat": "count"}, df, {})
    assert val == "3"


def test_compute_indicator_sum():
    df = pd.DataFrame({"Age": [10, 20, 30]})
    val = compute_indicator({"name": "total_age", "stat": "sum", "question": "Age"}, df, {})
    assert val == "60"


def test_compute_indicator_bad_returns_none():
    df = pd.DataFrame({"Region": ["N"]})
    assert compute_indicator({"name": "x", "stat": "sum", "question": "Ghost"}, df, {}) is None


def test_compute_indicator_percent_formats_with_pct():
    # 2 of 4 rows are "N" -> 50%; percent stat should render with a trailing %
    df = pd.DataFrame({"Region": ["N", "N", "S", "S"]})
    val = compute_indicator(
        {"name": "pct_n", "stat": "percent", "question": "Region", "filter_value": "N"}, df, {}
    )
    assert val is not None and val.endswith("%")


def test_ask_skips_chart_when_image_unreadable(monkeypatch):
    monkeypatch.setattr(ask_engine, "propose_items", lambda q, cat, ai: [
        {"kind": "chart", "name": "by_region", "title": "By region", "type": "bar", "questions": ["Region"]},
    ])
    monkeypatch.setattr(ask_engine, "ground_captions", lambda items, ai: {it["name"]: "cap" for it in items})
    def _boom(path):
        raise FileNotFoundError("evicted")
    monkeypatch.setattr(ask_engine, "_b64_png", _boom)
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"},
           "questions": [{"export_label": "Region", "category": "categorical"}]}
    df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "E", "E"]})
    out = ask_engine.ask("q", cfg, df, {})
    assert out["proposals"] == []
    assert any(s["reason"] == "chart image unavailable" for s in out["skipped"])


def test_ask_indicator_summary_includes_stat(monkeypatch):
    captured = {}
    monkeypatch.setattr(ask_engine, "propose_items", lambda q, cat, ai: [
        {"kind": "indicator", "name": "total_age", "title": "Total age", "stat": "sum", "question": "Age"},
    ])
    def _capture(items, ai):
        captured["items"] = items
        return {it["name"]: "cap" for it in items}
    monkeypatch.setattr(ask_engine, "ground_captions", _capture)
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"},
           "questions": [{"export_label": "Age", "category": "quantitative"}]}
    df = pd.DataFrame({"_id": [1, 2, 3], "Age": [10, 20, 30]})
    out = ask_engine.ask("q", cfg, df, {})
    summary = captured["items"][0]["summary"]
    assert "sum" in summary and "Age" in summary and "60" in summary


def test_ask_refine_prompt_resolves_offline():
    msgs, _cfg = lf_client.get_prompt("ask_refine", {
        "current_kind": "chart",
        "current_recipe": "{}",
        "instruction": "make it a line chart",
        "catalog": "{}",
        "chart_types": "line: >=1 date",
        "indicator_stats": "count: rows",
    })
    assert isinstance(msgs, list) and msgs
    blob = " ".join(m["content"] for m in msgs)
    assert "make it a line chart" in blob


from src.reports.ask_engine import _execute_item


def test_execute_item_chart_returns_entry():
    profile = _profile_fixture()
    df = pd.DataFrame({"Region": ["N", "E", "E"]})
    out = _execute_item({"kind": "chart", "name": "c", "title": "C", "type": "bar", "questions": ["Region"]}, profile, df, {})
    assert "skip" not in out and out["kind"] == "chart" and "png" in out


def test_execute_item_indicator_returns_entry():
    profile = _profile_fixture()
    df = pd.DataFrame({"_id": [1, 2, 3]})
    out = _execute_item({"kind": "indicator", "name": "n", "title": "N", "stat": "count"}, profile, df, {})
    assert "skip" not in out and out["kind"] == "indicator" and out["value"] == "3"


def test_execute_item_invalid_returns_skip():
    profile = _profile_fixture()
    out = _execute_item({"kind": "chart", "name": "c", "type": "bar", "questions": ["Ghost"]}, profile, pd.DataFrame({"Region": ["N"]}), {})
    assert "skip" in out and "Ghost" in out["skip"]


def test_refine_item_chart_to_line(monkeypatch):
    monkeypatch.setattr(ask_engine, "_propose_refinement",
                        lambda recipe, kind, instr, cat, ai: {"kind": "chart", "name": "trend", "title": "Trend", "type": "line", "questions": ["When"]})
    monkeypatch.setattr(ask_engine, "ground_captions", lambda items, ai: {it["name"]: "cap" for it in items})
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"},
           "questions": [{"export_label": "When", "category": "date"}]}
    df = pd.DataFrame({"_id": [1, 2], "When": ["2026-01-01", "2026-02-01"]})
    out = ask_engine.refine_item({"kind": "chart", "name": "trend", "type": "bar", "questions": ["When"]},
                                 "chart", "make it a line chart", cfg, df, {})
    assert out["proposal"]["kind"] == "chart"
    assert out["proposal"]["recipe"]["type"] == "line"
    assert out["proposal"]["image"].startswith("data:image/png;base64,")
    assert out["skipped"] is None


def test_refine_item_kind_switch_to_indicator(monkeypatch):
    monkeypatch.setattr(ask_engine, "_propose_refinement",
                        lambda recipe, kind, instr, cat, ai: {"kind": "indicator", "name": "n", "title": "N", "stat": "count"})
    monkeypatch.setattr(ask_engine, "ground_captions", lambda items, ai: {it["name"]: "cap" for it in items})
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"}, "questions": []}
    df = pd.DataFrame({"_id": [1, 2, 3]})
    out = ask_engine.refine_item({"kind": "chart", "name": "x", "type": "bar", "questions": ["Region"]},
                                 "chart", "just give me the number", cfg, df, {})
    assert out["proposal"]["kind"] == "indicator" and out["proposal"]["value"] == "3"


def test_refine_item_invalid_returns_skipped(monkeypatch):
    monkeypatch.setattr(ask_engine, "_propose_refinement",
                        lambda recipe, kind, instr, cat, ai: {"kind": "chart", "name": "x", "type": "bar", "questions": ["Ghost"]})
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"}, "questions": []}
    out = ask_engine.refine_item({"kind": "chart", "name": "x", "type": "bar", "questions": ["Region"]},
                                 "chart", "bad", cfg, pd.DataFrame({"Region": ["N"]}), {})
    assert out["proposal"] is None and out["skipped"]["reason"]


def test_refine_item_no_ai_message():
    cfg = {"ai": {"provider": "openai", "api_key": "env:OPENAI_API_KEY"}}
    out = ask_engine.refine_item({"kind": "chart"}, "chart", "x", cfg, pd.DataFrame({"_id": [1]}), {})
    assert out["proposal"] is None and "AI" in out["message"]
