"""ME-4 — Multi-form / longitudinal linkage (data layer).

These tests are the SPEC for the multi-form feature. They are written against a
*proposed, backward-compatible* multi-form surface that the implementer must add.
They are RED until that surface exists.

==============================================================================
PROPOSED MULTI-FORM CONTRACT (the AC encoded below)
==============================================================================

1. CONFIG SHAPE (backward compatible)
   Single-form (today, must keep working):
       form: {uid: ABC, alias: survey}

   Multi-form (new) — `api:` lists multiple aliased forms via a `forms:` list:
       api:
         forms:
           - {alias: baseline, uid: AAA111}
           - {alias: endline,  uid: BBB222}

   Enumeration helper (extract.py):
       iter_forms(cfg) -> List[Tuple[alias, uid]]
         - multi-form: one (alias, uid) per `api.forms` entry, order preserved
         - single-form: exactly [(form.alias, form.uid)] (back-compat)

2. fetch-questions — per-alias question lists
   When multi-form, the schema of EACH form is fetched and questions are written
   keyed by alias:
       cfg["forms_questions"] = {"baseline": [...], "endline": [...]}
   Single-form keeps writing the flat cfg["questions"] list (unchanged).

3. download — per-alias DataFrames / output files
   download writes a SEPARATE data file per alias, prefixed by the alias:
       data/processed/baseline_data_*.csv
       data/processed/endline_data_*.csv
   Single-form keeps writing one {alias}_data_*.csv (unchanged).

4. Indicators/charts — `form:` selector
   compute_indicators accepts a per-form bundle and an indicator may name the
   form it reads from:
       compute_indicators(indicators, df, per_form={
           "baseline": {"df": base_df, "repeat_tables": {}},
           "endline":  {"df": end_df,  "repeat_tables": {}},
       })
   An indicator `{name, stat, question, form: baseline}` computes against the
   baseline DataFrame; `form: endline` against the endline one. This enables
   pre/post and difference-in-differences.

All Kobo HTTP access is mocked at the client boundary (KoboClient methods) — no
live calls.
==============================================================================
"""
from copy import deepcopy
from pathlib import Path

import pandas as pd
import pytest
import yaml


# --------------------------------------------------------------------------- #
# Fixtures: two distinct forms (baseline + endline) with distinct UIDs.
# --------------------------------------------------------------------------- #

BASELINE_UID = "AAA111"
ENDLINE_UID = "BBB222"


def _asset(question_name: str, label: str) -> dict:
    """A minimal Kobo asset whose single question is unique per form, so we can
    tell the two forms' question lists apart by content."""
    return {
        "content": {
            "survey": [
                {"type": "integer", "name": question_name, "label": label},
            ],
            "choices": [],
        }
    }


def _submission(qkey: str, value: int) -> list:
    return [{"_id": 1, qkey: value}, {"_id": 2, qkey: value + 10}]


@pytest.fixture
def multiform_config():
    """A multi-form config: api.forms lists baseline + endline (distinct UIDs)."""
    return deepcopy({
        "api": {
            "platform": "kobo",
            "url": "https://example.test/api/v2",
            "token": "test-token",
            "forms": [
                {"alias": "baseline", "uid": BASELINE_UID},
                {"alias": "endline", "uid": ENDLINE_UID},
            ],
        },
        "export": {"format": "csv", "output_dir": "data/processed"},
    })


@pytest.fixture
def singleform_config():
    """The legacy single-form config shape — must keep working unchanged."""
    return deepcopy({
        "api": {"platform": "kobo", "url": "https://example.test/api/v2", "token": "t"},
        "form": {"uid": "ONLYONE", "alias": "solo"},
        "questions": [
            {"kobo_key": "age", "label": "Age", "type": "integer",
             "category": "quantitative", "group": "", "choice_list": None,
             "export_label": "Age", "repeat_group": None, "choices": None},
        ],
        "export": {"format": "csv", "output_dir": "data/processed"},
    })


# --------------------------------------------------------------------------- #
# AC: enumeration helper — iter_forms (back-compat foundation)
# --------------------------------------------------------------------------- #

def test_iter_forms_lists_each_aliased_form_multiform(multiform_config):
    """AC: `api:` lists multiple aliased forms → iter_forms yields one
    (alias, uid) per form, preserving order and distinct UIDs."""
    from src.data.extract import iter_forms

    forms = list(iter_forms(multiform_config))

    assert forms == [("baseline", BASELINE_UID), ("endline", ENDLINE_UID)]


def test_iter_forms_backward_compatible_single_form(singleform_config):
    """Back-compat: a legacy `form: {uid, alias}` config yields exactly one
    (alias, uid) pair via the same helper."""
    from src.data.extract import iter_forms

    forms = list(iter_forms(singleform_config))

    assert forms == [("solo", "ONLYONE")]


# --------------------------------------------------------------------------- #
# AC: fetch-questions produces separate question lists keyed by alias.
# --------------------------------------------------------------------------- #

def test_fetch_questions_writes_separate_lists_keyed_by_alias(
    tmp_path, monkeypatch, multiform_config
):
    """AC: `fetch-questions` produces named question lists per form alias.

    Mock the Kobo API to return TWO forms with distinct UIDs and distinct
    schemas; assert the written config carries a per-alias mapping
    forms_questions == {"baseline": [...], "endline": [...]} where each list
    holds that form's own question.
    """
    from src.data import make

    config_path = tmp_path / "config.yml"
    config_path.write_text(yaml.safe_dump(multiform_config), encoding="utf-8")

    # Map each UID to its own schema so we can prove the lists are not shared.
    schema_by_uid = {
        BASELINE_UID: _asset("income_before", "Income before"),
        ENDLINE_UID: _asset("income_after", "Income after"),
    }

    def fake_get_form_schema(self):
        return schema_by_uid[self.form_uid]

    monkeypatch.setattr(
        "src.data.extract.KoboClient.get_form_schema", fake_get_form_schema
    )

    from click.testing import CliRunner

    result = CliRunner().invoke(
        make.cli, ["--config", str(config_path), "fetch-questions"]
    )
    assert result.exit_code == 0, result.output

    written = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    fq = written.get("forms_questions")
    assert fq is not None, "expected per-alias forms_questions mapping in config"
    assert set(fq.keys()) == {"baseline", "endline"}

    base_keys = {q["kobo_key"] for q in fq["baseline"]}
    end_keys = {q["kobo_key"] for q in fq["endline"]}
    assert base_keys == {"income_before"}
    assert end_keys == {"income_after"}


def test_fetch_questions_single_form_still_writes_flat_questions(
    tmp_path, monkeypatch, singleform_config
):
    """Back-compat: a single-form config still writes the flat cfg["questions"]
    list (no per-alias mapping required)."""
    from src.data import make

    config_path = tmp_path / "config.yml"
    config_path.write_text(yaml.safe_dump(singleform_config), encoding="utf-8")

    monkeypatch.setattr(
        "src.data.extract.KoboClient.get_form_schema",
        lambda self: _asset("age", "Age"),
    )

    from click.testing import CliRunner

    result = CliRunner().invoke(
        make.cli, ["--config", str(config_path), "fetch-questions"]
    )
    assert result.exit_code == 0, result.output

    written = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    assert isinstance(written.get("questions"), list)
    assert {q["kobo_key"] for q in written["questions"]} == {"age"}


# --------------------------------------------------------------------------- #
# AC: download writes separate DataFrames / files for baseline and endline.
# --------------------------------------------------------------------------- #

def test_download_writes_per_alias_files(tmp_path, monkeypatch, multiform_config):
    """AC: `download` writes separate DataFrames for `baseline` and `endline`.

    Mock both schema + submissions per UID; assert one data file per alias lands
    in the output dir, prefixed by the alias.
    """
    from src.data import make

    out_dir = tmp_path / "processed"
    cfg = deepcopy(multiform_config)
    cfg["export"]["output_dir"] = str(out_dir)
    # download requires questions to be present per form.
    cfg["forms_questions"] = {
        "baseline": [{
            "kobo_key": "income_before", "label": "Income before", "type": "integer",
            "category": "quantitative", "group": "", "choice_list": None,
            "export_label": "income_before", "repeat_group": None, "choices": None,
        }],
        "endline": [{
            "kobo_key": "income_after", "label": "Income after", "type": "integer",
            "category": "quantitative", "group": "", "choice_list": None,
            "export_label": "income_after", "repeat_group": None, "choices": None,
        }],
    }

    config_path = tmp_path / "config.yml"
    config_path.write_text(yaml.safe_dump(cfg), encoding="utf-8")

    schema_by_uid = {
        BASELINE_UID: _asset("income_before", "Income before"),
        ENDLINE_UID: _asset("income_after", "Income after"),
    }
    subs_by_uid = {
        BASELINE_UID: _submission("income_before", 100),
        ENDLINE_UID: _submission("income_after", 200),
    }

    monkeypatch.setattr(
        "src.data.extract.KoboClient.get_form_schema",
        lambda self: schema_by_uid[self.form_uid],
    )
    monkeypatch.setattr(
        "src.data.extract.KoboClient.get_submissions",
        lambda self, sample_size=None: subs_by_uid[self.form_uid],
    )

    from click.testing import CliRunner

    result = CliRunner().invoke(
        make.cli, ["--config", str(config_path), "download"]
    )
    assert result.exit_code == 0, result.output

    base_files = list(out_dir.glob("baseline_data_*.csv"))
    end_files = list(out_dir.glob("endline_data_*.csv"))
    assert base_files, f"expected a baseline_data_*.csv file, dir held: {list(out_dir.glob('*'))}"
    assert end_files, f"expected an endline_data_*.csv file, dir held: {list(out_dir.glob('*'))}"

    # And each per-alias file must hold THAT form's own column (not shared).
    base_df = pd.read_csv(base_files[0])
    end_df = pd.read_csv(end_files[0])
    assert "income_before" in base_df.columns
    assert "income_after" in end_df.columns
    assert "income_after" not in base_df.columns


def test_download_single_form_unchanged(tmp_path, monkeypatch, singleform_config):
    """Back-compat: single-form download still writes one {alias}_data_*.csv."""
    from src.data import make

    out_dir = tmp_path / "processed"
    cfg = deepcopy(singleform_config)
    cfg["export"]["output_dir"] = str(out_dir)
    config_path = tmp_path / "config.yml"
    config_path.write_text(yaml.safe_dump(cfg), encoding="utf-8")

    monkeypatch.setattr(
        "src.data.extract.KoboClient.get_submissions",
        lambda self, sample_size=None: _submission("age", 30),
    )

    from click.testing import CliRunner

    result = CliRunner().invoke(
        make.cli, ["--config", str(config_path), "download"]
    )
    assert result.exit_code == 0, result.output

    solo_files = list(out_dir.glob("solo_data_*.csv"))
    assert solo_files, f"expected one solo_data_*.csv, dir held: {list(out_dir.glob('*'))}"


# --------------------------------------------------------------------------- #
# AC: an indicator referencing `form: baseline` reads from the baseline DataFrame.
# --------------------------------------------------------------------------- #

def test_indicator_form_selector_reads_correct_dataframe():
    """AC: Indicators can reference `form: baseline` vs `form: endline`.

    With a per-form bundle whose baseline and endline DataFrames hold clearly
    different means, an indicator tagged `form: baseline` must produce the
    baseline mean and `form: endline` the endline mean.
    """
    from src.reports.indicators import compute_indicators

    base_df = pd.DataFrame({"income": [100, 100, 100]})   # mean 100
    end_df = pd.DataFrame({"income": [300, 300, 300]})    # mean 300

    per_form = {
        "baseline": {"df": base_df, "repeat_tables": {}},
        "endline": {"df": end_df, "repeat_tables": {}},
    }

    indicators = [
        {"name": "avg_income_base", "stat": "mean", "question": "income", "form": "baseline"},
        {"name": "avg_income_end", "stat": "mean", "question": "income", "form": "endline"},
    ]

    ctx = compute_indicators(indicators, base_df, per_form=per_form)

    # baseline indicator pulls from baseline (100), endline from endline (300).
    assert ctx["ind_avg_income_base"] == "100" or ctx["ind_avg_income_base"] == "100.0" \
        or str(ctx["ind_avg_income_base"]).startswith("100")
    assert str(ctx["ind_avg_income_end"]).startswith("300")


def test_indicator_form_endline_does_not_read_baseline():
    """AC sharpener: a `form: endline` indicator must NOT silently fall back to
    the baseline/default frame — it reads the endline frame's value."""
    from src.reports.indicators import compute_indicators

    base_df = pd.DataFrame({"income": [0, 0, 0]})      # mean 0
    end_df = pd.DataFrame({"income": [50, 50, 50]})    # mean 50

    per_form = {
        "baseline": {"df": base_df, "repeat_tables": {}},
        "endline": {"df": end_df, "repeat_tables": {}},
    }

    indicators = [
        {"name": "endline_income", "stat": "mean", "question": "income", "form": "endline"},
    ]

    # Pass baseline as the positional default df to prove the selector overrides it.
    ctx = compute_indicators(indicators, base_df, per_form=per_form)

    assert str(ctx["ind_endline_income"]).startswith("50"), (
        "form: endline indicator must read the endline DataFrame, not the "
        f"default/baseline frame (got {ctx['ind_endline_income']})"
    )
