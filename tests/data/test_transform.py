"""Tests for src.data.transform — load_data / filters / computed_columns / views."""
import pandas as pd
import pytest

from src.data.transform import (
    apply_computed_columns,
    apply_filters,
    build_views,
    load_data,
)


def test_load_data_returns_main_df_and_repeat_tables(config, submissions):
    df, repeats = load_data(submissions, config)
    # Main table: 2 rows, columns include _id + export_labels
    assert len(df) == 2
    assert set(df.columns) >= {"_id", "Respondent", "Region", "Age"}
    # Repeat table is keyed by the full slash-path
    assert "household_members" in repeats
    assert len(repeats["household_members"]) == 3


def test_load_data_decodes_select_one_choice_labels(config, submissions):
    df, _ = load_data(submissions, config)
    assert sorted(df["Region"].tolist()) == ["North", "South"]


def test_load_data_decodes_select_multiple_with_pipe_separator(config, submissions):
    _, repeats = load_data(submissions, config)
    skills = repeats["household_members"]["Skills"].tolist()
    # "cook farm" → "Cooking | Farming"; "cook" → "Cooking"; "farm" → "Farming"
    assert "Cooking | Farming" in skills
    assert "Cooking" in skills
    assert "Farming" in skills


def test_load_data_casts_quantitative_columns_to_numeric(config, submissions):
    df, _ = load_data(submissions, config)
    assert pd.api.types.is_numeric_dtype(df["Age"])


def test_apply_filters_with_valid_expression(config, submissions):
    df, repeats = load_data(submissions, config)
    config["filters"] = ["Age >= 35"]
    df2, _ = apply_filters(df, config, repeats)
    assert len(df2) == 1
    assert df2.iloc[0]["Respondent"] == "Dave"


def test_apply_filters_removes_orphan_repeat_rows(config, submissions):
    df, repeats = load_data(submissions, config)
    config["filters"] = ["Age >= 35"]
    _, filtered_repeats = apply_filters(df, config, repeats)
    # Only Dave (id 2) survives; his single household member is kept; Alice's 2 are dropped
    assert len(filtered_repeats["household_members"]) == 1


def test_apply_computed_columns_repeat_count(config, submissions):
    df, repeats = load_data(submissions, config)
    config["computed_columns"] = [
        {"name": "household_size", "from_repeat": "household_members", "question": "count"},
    ]
    out = apply_computed_columns(df, config, repeats)
    # Alice has 2 household members, Dave has 1
    assert out.set_index("Respondent")["household_size"].to_dict() == {"Alice": 2, "Dave": 1}


def test_build_views_joins_parent_and_filters(config, submissions):
    """Exercises build_views with source/join_parent/filter (no aggregation).

    The aggregation path in build_views has a known bug (pd.to_numeric is forced
    on the question column even for agg='count'), so it's not tested here. The
    fix is tracked separately.
    """
    df, repeats = load_data(submissions, config)
    config["views"] = [
        {
            "name": "north_members",
            "source": "household_members",
            "join_parent": ["Region"],
            "filter": "Region == 'North'",
        }
    ]
    views = build_views(config, df, repeats)
    assert "north_members" in views
    view = views["north_members"]
    # Only Alice's 2 household members are from the North region.
    assert len(view) == 2
    assert set(view["Member name"].tolist()) == {"Bob", "Carol"}
    assert (view["Region"] == "North").all()


def test_apply_filters_lenient_mode_warns_on_bad_filter(config, submissions, caplog):
    df, repeats = load_data(submissions, config)
    config["filters"] = ["NonexistentColumn > 0"]
    import logging
    with caplog.at_level(logging.WARNING):
        df2, _ = apply_filters(df, config, repeats)  # default: strict=False
    assert len(df2) == 2  # filter silently skipped
    assert any("NonexistentColumn" in r.message for r in caplog.records)


def test_apply_filters_strict_mode_raises_on_bad_filter(config, submissions):
    df, repeats = load_data(submissions, config)
    config["filters"] = ["NonexistentColumn > 0"]
    with pytest.raises(ValueError, match="NonexistentColumn"):
        apply_filters(df, config, repeats, strict=True)


def test_apply_computed_columns_strict_raises_on_missing_column(config, submissions):
    df, repeats = load_data(submissions, config)
    config["computed_columns"] = [
        {"name": "bad", "questions": ["Nonexistent"], "combine": "sum"},
    ]
    with pytest.raises(ValueError, match="Nonexistent"):
        apply_computed_columns(df, config, repeats, strict=True)


def test_apply_computed_columns_strict_raises_on_missing_repeat(config, submissions):
    df, repeats = load_data(submissions, config)
    config["computed_columns"] = [
        {"name": "bad", "from_repeat": "no_such_table", "question": "count"},
    ]
    with pytest.raises(ValueError, match="no_such_table"):
        apply_computed_columns(df, config, repeats, strict=True)


def test_build_views_strict_raises_on_missing_source(config, submissions):
    df, repeats = load_data(submissions, config)
    config["views"] = [{"name": "bad", "source": "no_such_source"}]
    with pytest.raises(ValueError, match="no_such_source"):
        build_views(config, df, repeats, strict=True)


def test_apply_computed_columns_lenient_mode_warns_on_missing_column(config, submissions, caplog):
    df, repeats = load_data(submissions, config)
    config["computed_columns"] = [
        {"name": "bad", "questions": ["Nonexistent"], "combine": "sum"},
    ]
    import logging
    with caplog.at_level(logging.WARNING):
        out = apply_computed_columns(df, config, repeats)  # default: strict=False
    # The computed column should not have been added — warning logged, skipped.
    assert "bad" not in out.columns
    assert any("Nonexistent" in r.message for r in caplog.records)


def test_build_views_lenient_mode_warns_on_missing_source(config, submissions, caplog):
    df, repeats = load_data(submissions, config)
    config["views"] = [{"name": "ghost", "source": "no_such_source"}]
    import logging
    with caplog.at_level(logging.WARNING):
        views = build_views(config, df, repeats)  # default: strict=False
    # The view should not exist — warning logged, skipped.
    assert "ghost" not in views
    assert any("no_such_source" in r.message for r in caplog.records)
