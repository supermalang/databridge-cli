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


def test_ask_charts_prompt_resolves_offline():
    msgs = lf_client.get_prompt("ask_charts", {
        "question": "How many people by region?",
        "catalog": "{}",
        "chart_types": "bar: >=1 categorical",
    })
    assert isinstance(msgs, list) and msgs
    blob = " ".join(m["content"] for m in msgs)
    assert "How many people by region?" in blob


def test_ask_caption_prompt_resolves_offline():
    msgs = lf_client.get_prompt("ask_caption", {"charts_block": "chart_a — Region: N=5"})
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


def test_propose_charts_parses_llm_json(monkeypatch):
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: [{"role": "user", "content": "x"}])
    monkeypatch.setattr(ask_engine.lf_client, "chat",
                        lambda *a, **k: '{"charts": [{"name": "by_region", "type": "bar", "questions": ["Region"]}]}')
    ai_cfg = {"provider": "openai", "api_key": "sk-x", "model": "gpt-4o"}
    out = ask_engine.propose_charts("q", {"tables": []}, ai_cfg)
    assert out == [{"name": "by_region", "type": "bar", "questions": ["Region"]}]


def test_propose_charts_malformed_returns_empty(monkeypatch):
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: [])
    monkeypatch.setattr(ask_engine.lf_client, "chat", lambda *a, **k: "not json at all")
    out = ask_engine.propose_charts("q", {"tables": []}, {"provider": "openai", "api_key": "sk-x"})
    assert out == []


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
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: [{"role": "user", "content": "x"}])
    monkeypatch.setattr(ask_engine.lf_client, "chat",
                        lambda *a, **k: '{"captions": {"by_region": "Region E leads with 3."}}')
    items = [{"name": "by_region", "title": "By region", "summary": "Region: E=3, N=2, S=1"}]
    caps = ask_engine.ground_captions(items, {"provider": "openai", "api_key": "sk-x"})
    assert caps["by_region"] == "Region E leads with 3."


def test_ground_captions_falls_back_to_title_on_failure(monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("no ai")
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: [])
    monkeypatch.setattr(ask_engine.lf_client, "chat", _boom)
    items = [{"name": "c1", "title": "Fallback Title", "summary": "x"}]
    caps = ask_engine.ground_captions(items, {"provider": "openai", "api_key": "sk-x"})
    assert caps["c1"] == "Fallback Title"


def test_ask_end_to_end(monkeypatch):
    monkeypatch.setattr(ask_engine, "propose_charts",
                        lambda q, cat, ai: [{"name": "by_region", "title": "By region", "type": "bar", "questions": ["Region"]}])
    monkeypatch.setattr(ask_engine, "ground_captions",
                        lambda items, ai: {it["name"]: "Region E leads." for it in items})
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"}, "questions": [
        {"export_label": "Region", "category": "categorical"}]}
    df = pd.DataFrame({"_id": [1, 2, 3, 4], "Region": ["N", "E", "E", "E"]})
    out = ask_engine.ask("by region?", cfg, df, {})
    assert len(out["proposals"]) == 1
    p = out["proposals"][0]
    assert p["image"].startswith("data:image/png;base64,")
    assert p["caption"] == "Region E leads."
    assert out["skipped"] == []


def test_ask_no_ai_returns_message():
    cfg = {"ai": {"provider": "openai", "api_key": "env:OPENAI_API_KEY"}}
    out = ask_engine.ask("q", cfg, pd.DataFrame({"_id": [1]}), {})
    assert out["proposals"] == [] and "AI" in out["message"]


def test_ask_disambiguates_duplicate_recipe_names(monkeypatch):
    monkeypatch.setattr(ask_engine, "propose_charts", lambda q, cat, ai: [
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


def test_save_recipe_appends_to_config():
    cfg = {"charts": [{"name": "existing"}]}
    name = ask_engine.save_recipe({"name": "by_region", "type": "bar", "questions": ["Region"]}, cfg)
    assert name == "by_region"
    assert [c["name"] for c in cfg["charts"]] == ["existing", "by_region"]


def test_save_recipe_dedupes_name():
    cfg = {"charts": [{"name": "by_region"}]}
    name = ask_engine.save_recipe({"name": "by_region", "type": "bar", "questions": ["Region"]}, cfg)
    assert name == "by_region_2"
    assert [c["name"] for c in cfg["charts"]] == ["by_region", "by_region_2"]
