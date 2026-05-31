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
