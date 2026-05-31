from src.reports.default_charts import default_charts_from_questions, MAX_DEFAULT_CHARTS


def test_maps_categorical_and_quantitative():
    cfg = {"questions": [
        {"export_label": "Region", "category": "categorical"},
        {"export_label": "Age", "category": "quantitative"},
    ]}
    charts = default_charts_from_questions(cfg)
    by_q = {c["questions"][0]: c["type"] for c in charts}
    assert by_q == {"Region": "bar", "Age": "histogram"}
    assert all(set(c) >= {"name", "title", "type", "questions"} for c in charts)


def test_skips_non_chartable_categories():
    cfg = {"questions": [
        {"export_label": "Comments", "category": "qualitative"},
        {"export_label": "GPS", "category": "geographical"},
        {"export_label": "When", "category": "date"},
        {"export_label": "X", "category": "undefined"},
    ]}
    assert default_charts_from_questions(cfg) == []


def test_column_fallback_and_unique_names():
    cfg = {"questions": [
        {"label": "Region", "category": "categorical"},                 # no export_label -> label
        {"kobo_key": "region2", "category": "categorical"},             # -> kobo_key
        {"export_label": "Region", "category": "categorical"},          # dup title -> unique name
        {"category": "categorical"},                                     # no usable column -> skipped
    ]}
    charts = default_charts_from_questions(cfg)
    assert len(charts) == 3
    names = [c["name"] for c in charts]
    assert len(set(names)) == 3           # all unique
    assert charts[0]["questions"] == ["Region"]
    assert charts[1]["questions"] == ["region2"]


def test_caps_at_max_and_warns(caplog):
    cfg = {"questions": [
        {"export_label": f"Q{i}", "category": "quantitative"} for i in range(MAX_DEFAULT_CHARTS + 5)
    ]}
    import logging
    with caplog.at_level(logging.WARNING):
        charts = default_charts_from_questions(cfg)
    assert len(charts) == MAX_DEFAULT_CHARTS
    assert any("skipp" in r.message.lower() or "cap" in r.message.lower() for r in caplog.records)


def test_empty_when_no_questions():
    assert default_charts_from_questions({}) == []
    assert default_charts_from_questions({"questions": []}) == []
