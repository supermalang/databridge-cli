"""ME-4 — Path-traversal hardening for multi-form `api.forms[].alias` (security).

Security-audit (High) found that a multi-form ``api.forms[].alias`` like
``"../../evil"`` flows UNSANITIZED through:

    src/data/make.py  _download_multiform
        run_cfg["form"]["alias"] = <raw alias>
    -> src/data/transform.py  _export_file
        out_dir / f"{prefix}_data_{ts}.csv"     (prefix == raw alias)

so a traversal alias escapes the ``data/processed`` output dir. The web sandbox
guard ``web/storage/workspace.py:sanitize_run_config`` only slugifies the
single-form ``cfg["form"]["alias"]`` — it never touches
``cfg["api"]["forms"][*]["alias"]``.

These tests are the SPEC for the fix (implementer makes them pass). They are RED
on today's code, for the right reason: the traversal alias survives unsanitized.

The expected safe form mirrors ``src/utils/periods.slugify`` (the same helper the
single-form alias already uses): a ``[a-z0-9_]`` token with no slashes / dots /
backslashes.

All Kobo HTTP access is mocked at the KoboClient boundary (same as the other
multiform tests) — no live calls.
"""
from copy import deepcopy
import re

import pytest
import yaml

from src.utils.periods import slugify


# Distinct UIDs so the two forms are independent (mirrors test_extract_multiform).
BASELINE_UID = "AAA111"
ENDLINE_UID = "BBB222"

# A traversal alias that, unsanitized, would walk out of the output dir.
EVIL_ALIAS = "../../evil"


def _asset(question_name: str, label: str) -> dict:
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


# --------------------------------------------------------------------------- #
# AC 1: sanitize_run_config slugifies every api.forms[].alias
# (mirrors test_run_config_sanitize.test_traversal_alias_is_made_safe, which
#  asserts the SINGLE-form alias is made safe).
# --------------------------------------------------------------------------- #

def test_sanitize_run_config_slugifies_multiform_alias():
    """A traversal ``api.forms[].alias`` is reduced to a filesystem-safe slug:
    no slashes, no ``..``, no backslashes — a ``[a-z0-9_]`` token like the
    single-form alias already produces."""
    from web.storage.workspace import sanitize_run_config

    cfg = {
        "api": {
            "platform": "kobo",
            "url": "https://example.test/api/v2",
            "token": "t",
            "forms": [
                {"alias": EVIL_ALIAS, "uid": BASELINE_UID},
                {"alias": "endline", "uid": ENDLINE_UID},
            ],
        },
        "export": {"format": "csv", "output_dir": "data/processed"},
    }

    out = sanitize_run_config(cfg)

    evil = out["api"]["forms"][0]["alias"]
    assert "/" not in evil and ".." not in evil and "\\" not in evil
    assert re.fullmatch(r"[a-z0-9_]+", evil), (
        f"alias must be a safe [a-z0-9_] slug, got {evil!r}"
    )
    # Matches the slugify contract the single-form alias already uses.
    assert evil == (slugify(EVIL_ALIAS) or "form")


def test_sanitize_run_config_preserves_clean_multiform_alias():
    """A legitimate multi-form alias is left as a clean slug (no corruption of
    valid configs)."""
    from web.storage.workspace import sanitize_run_config

    cfg = {
        "api": {
            "forms": [
                {"alias": "baseline", "uid": BASELINE_UID},
                {"alias": "endline", "uid": ENDLINE_UID},
            ],
        },
        "export": {"format": "csv", "output_dir": "data/processed"},
    }

    out = sanitize_run_config(cfg)

    assert out["api"]["forms"][0]["alias"] == "baseline"
    assert out["api"]["forms"][1]["alias"] == "endline"


def test_sanitize_run_config_does_not_mutate_input_forms():
    """The input config is not mutated (mirrors test_does_not_mutate_input)."""
    from web.storage.workspace import sanitize_run_config

    cfg = {
        "api": {"forms": [{"alias": EVIL_ALIAS, "uid": BASELINE_UID}]},
        "export": {"format": "csv", "output_dir": "data/processed"},
    }
    sanitize_run_config(cfg)
    assert cfg["api"]["forms"][0]["alias"] == EVIL_ALIAS


# --------------------------------------------------------------------------- #
# AC 2: traversal neutralization at the download/export layer.
# A multi-form alias with path separators must NOT write a data file outside the
# configured output dir. Same mock boundary as test_download_writes_per_alias_files.
# --------------------------------------------------------------------------- #

def test_download_multiform_traversal_alias_stays_inside_output_dir(
    tmp_path, monkeypatch
):
    """With a traversal ``api.forms[].alias`` (``../../evil``), ``download`` must
    keep every written data file INSIDE the configured output dir — the resolved
    path is_relative_to ``out_dir`` and nothing lands outside it."""
    from src.data import make

    out_dir = tmp_path / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)

    cfg = {
        "api": {
            "platform": "kobo",
            "url": "https://example.test/api/v2",
            "token": "t",
            "forms": [
                {"alias": EVIL_ALIAS, "uid": BASELINE_UID},
                {"alias": "endline", "uid": ENDLINE_UID},
            ],
        },
        "export": {"format": "csv", "output_dir": str(out_dir)},
        "forms_questions": {
            # Keyed by alias; the evil form's questions are keyed by the raw alias
            # since that is how _download_multiform looks them up today.
            EVIL_ALIAS: [{
                "kobo_key": "income_before", "label": "Income before",
                "type": "integer", "category": "quantitative", "group": "",
                "choice_list": None, "export_label": "income_before",
                "repeat_group": None, "choices": None,
            }],
            "endline": [{
                "kobo_key": "income_after", "label": "Income after",
                "type": "integer", "category": "quantitative", "group": "",
                "choice_list": None, "export_label": "income_after",
                "repeat_group": None, "choices": None,
            }],
        },
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

    out_resolved = out_dir.resolve()

    # The traversal alias "../../evil" would resolve a write of
    # out_dir/"<alias>_data_*.csv" to a sibling of tmp_path (escaping the
    # sandbox entirely), so scan the whole search tree from tmp_path's PARENT
    # and snapshot pre-existing files there before the run.
    search_root = tmp_path.parent
    before = {p for p in search_root.rglob("*") if p.is_file()}

    result = CliRunner().invoke(
        make.cli, ["--config", str(config_path), "download"]
    )
    assert result.exit_code == 0, result.output

    # Every file produced by the run must resolve INSIDE the output dir.
    created_files = {p for p in search_root.rglob("*") if p.is_file()} - before
    escaped = [
        p for p in created_files
        if not p.resolve().is_relative_to(out_resolved)
    ]
    assert not escaped, (
        "traversal alias escaped the output dir; files written outside "
        f"{out_resolved}: {[str(p) for p in escaped]}"
    )

    # And the legitimately-written CSV(s) must all live under the output dir.
    csvs = list(out_dir.glob("*_data_*.csv"))
    assert csvs, (
        "expected at least one *_data_*.csv inside the output dir, dir held: "
        f"{[p.name for p in out_dir.iterdir()]}"
    )
    for csv in csvs:
        assert csv.resolve().is_relative_to(out_resolved)
