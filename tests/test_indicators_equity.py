"""ME-1 — Equity / inclusion lens.

Contract under test (derived from the ME-1 acceptance criteria):

- Config gains a top-level optional ``equity_dimensions:`` list of cross-cutting
  variables (e.g. ``["gender", "age_group", "location"]``).
- ``build-report`` auto-generates one disaggregation chart spec (a stacked or
  grouped bar) per indicator x equity dimension.
- A single config line (the ``equity_dimensions`` list) yields a full
  disaggregation section; when ``equity_dimensions`` is absent, NO disaggregation
  chart specs are produced.

The spec-producing function is expected to be
``src.reports.indicators.build_equity_charts(cfg) -> List[Dict]``, returning chart
specs shaped like the rest of the chart engine
(``{"name", "title", "type", "questions"}``) — mirroring
``default_charts.default_charts_from_questions``.
"""
import pandas as pd  # noqa: F401  (kept for parity with sibling indicator tests)

import src.reports.indicators as _indicators


def build_equity_charts(cfg):
    """Resolve the spec-producing function the implementer must add (ME-1).

    Until ``src.reports.indicators.build_equity_charts`` exists, this falls back
    to "no specs produced", so the count / chart-type assertions fail for the
    RIGHT reason — equity_dimensions is not yet consumed — rather than blowing up
    the collection with an ImportError.
    """
    fn = getattr(_indicators, "build_equity_charts", None)
    if fn is None:
        return []
    return fn(cfg)


_STACKED_OR_GROUPED = {"stacked_bar", "grouped_bar"}


def _cfg(indicators, equity_dimensions=None):
    cfg = {"indicators": indicators}
    if equity_dimensions is not None:
        cfg["equity_dimensions"] = equity_dimensions
    return cfg


# --- AC: two dimensions -> two specs per indicator ---------------------------

def test_two_dimensions_one_indicator_yields_two_specs():
    cfg = _cfg(
        indicators=[{"name": "doses", "stat": "sum", "question": "Doses"}],
        equity_dimensions=["gender", "age_group"],
    )
    charts = build_equity_charts(cfg)
    # 1 indicator x 2 dimensions = 2 disaggregation chart specs
    assert len(charts) == 2


def test_count_is_n_indicators_times_n_dimensions():
    cfg = _cfg(
        indicators=[
            {"name": "doses", "stat": "sum", "question": "Doses"},
            {"name": "reached", "stat": "count", "question": "ID"},
            {"name": "coverage", "stat": "percent", "question": "Vaccinated",
             "filter_value": "yes"},
        ],
        equity_dimensions=["gender", "age_group"],
    )
    charts = build_equity_charts(cfg)
    assert len(charts) == 3 * 2  # n_indicators x n_dimensions


# --- AC: chart type is stacked or grouped bar --------------------------------

def test_chart_type_is_stacked_or_grouped_bar():
    cfg = _cfg(
        indicators=[{"name": "doses", "stat": "sum", "question": "Doses"}],
        equity_dimensions=["gender", "age_group"],
    )
    charts = build_equity_charts(cfg)
    assert charts, "expected equity chart specs to be produced"
    assert all(c["type"] in _STACKED_OR_GROUPED for c in charts), (
        f"expected every equity chart type in {_STACKED_OR_GROUPED}, "
        f"got {[c['type'] for c in charts]}"
    )


def test_specs_are_well_formed_chart_dicts():
    cfg = _cfg(
        indicators=[{"name": "doses", "stat": "sum", "question": "Doses"}],
        equity_dimensions=["gender", "age_group"],
    )
    charts = build_equity_charts(cfg)
    assert charts, "expected equity chart specs to be produced"
    for c in charts:
        assert set(c) >= {"name", "title", "type", "questions"}
    # spec names must be unique so build-report placeholders don't collide
    names = [c["name"] for c in charts]
    assert len(set(names)) == len(names)


def test_each_dimension_covered_for_indicator():
    cfg = _cfg(
        indicators=[{"name": "doses", "stat": "sum", "question": "Doses"}],
        equity_dimensions=["gender", "age_group"],
    )
    charts = build_equity_charts(cfg)
    # The two dimensions must each be referenced by a produced spec.
    referenced = set()
    for c in charts:
        referenced.update(c.get("questions", []))
    assert {"gender", "age_group"} <= referenced


# --- AC: absent equity_dimensions -> no specs --------------------------------

def test_no_specs_when_equity_dimensions_absent():
    cfg = _cfg(
        indicators=[{"name": "doses", "stat": "sum", "question": "Doses"}],
        equity_dimensions=None,  # key omitted entirely
    )
    assert build_equity_charts(cfg) == []


def test_no_specs_when_equity_dimensions_empty():
    cfg = _cfg(
        indicators=[{"name": "doses", "stat": "sum", "question": "Doses"}],
        equity_dimensions=[],
    )
    assert build_equity_charts(cfg) == []


def test_no_specs_when_no_indicators():
    cfg = _cfg(indicators=[], equity_dimensions=["gender", "age_group"])
    assert build_equity_charts(cfg) == []
