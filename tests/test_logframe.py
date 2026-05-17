from src.reports.logframe import build_logframe


def _sample_cfg_with_indicators():
    return {
        "framework": {
            "goal":     {"id": "GOAL", "label": "Reduce X"},
            "outcomes": [{"id": "OC1", "label": "Outcome 1", "parent": "GOAL"}],
            "outputs":  [
                {"id": "OP1.1", "label": "Output 1.1", "parent": "OC1"},
                {"id": "OP1.2", "label": "Output 1.2", "parent": "OC1"},
            ],
        },
        "indicators": [
            {"name": "a", "framework_ref": "OP1.1"},
            {"name": "b", "framework_ref": "OP1.2"},
            {"name": "c", "framework_ref": "OC1"},
            {"name": "no_ref"},
        ],
    }


def test_build_logframe_empty_when_no_framework():
    assert build_logframe({}, {}) == {"rows": [], "has_framework": False}


def test_build_logframe_returns_one_row_per_node():
    cfg = _sample_cfg_with_indicators()
    indicators_context = {"ind_a": "100", "ind_b": "50", "ind_c": "75"}
    lf = build_logframe(cfg, indicators_context)
    assert lf["has_framework"] is True
    # 1 goal + 1 outcome + 2 outputs = 4 rows
    assert len(lf["rows"]) == 4
    assert lf["rows"][0]["level"] == "goal"
    assert lf["rows"][1]["level"] == "outcome"
    assert lf["rows"][2]["level"] == "output"
    assert lf["rows"][3]["level"] == "output"


def test_build_logframe_attaches_indicator_values_to_nodes():
    cfg = _sample_cfg_with_indicators()
    indicators_context = {"ind_a": "100", "ind_b": "50", "ind_c": "75"}
    lf = build_logframe(cfg, indicators_context)
    by_id = {r["id"]: r for r in lf["rows"]}
    assert by_id["OP1.1"]["indicators"] == [{"name": "a", "value": "100"}]
    assert by_id["OP1.2"]["indicators"] == [{"name": "b", "value": "50"}]
    assert by_id["OC1"]["indicators"]   == [{"name": "c", "value": "75"}]


def test_build_logframe_handles_indicators_with_no_ref():
    cfg = _sample_cfg_with_indicators()
    lf = build_logframe(cfg, {"ind_no_ref": "999"})
    for row in lf["rows"]:
        for ind in row["indicators"]:
            assert ind["name"] != "no_ref"
