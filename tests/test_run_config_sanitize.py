"""Security: project config is user-editable but, in a web run, is materialized
into an isolated tempdir whose outputs are pushed back from fixed dirs. An
attacker-set export.output_dir / report.output_dir (absolute or ../ traversal) or
a traversal form.alias must not let a run write outside the sandbox. Audit #4."""
import copy

from web.storage.workspace import sanitize_run_config


BASE = {
    "form": {"uid": "X", "alias": "survey"},
    "export": {"format": "csv", "output_dir": "data/processed"},
    "report": {"output_dir": "reports", "title": "T"},
    "filters": ["Age > 0"],
}


def test_legitimate_config_unchanged():
    cfg = copy.deepcopy(BASE)
    out = sanitize_run_config(cfg)
    assert out["export"]["output_dir"] == "data/processed"
    assert out["report"]["output_dir"] == "reports"
    assert out["form"]["alias"] == "survey"
    assert out["filters"] == ["Age > 0"]          # untouched
    assert out["export"]["format"] == "csv"       # untouched


def test_absolute_export_dir_forced_to_canonical():
    cfg = copy.deepcopy(BASE)
    cfg["export"]["output_dir"] = "/etc"
    out = sanitize_run_config(cfg)
    assert out["export"]["output_dir"] == "data/processed"


def test_traversal_export_dir_forced_to_canonical():
    cfg = copy.deepcopy(BASE)
    cfg["export"]["output_dir"] = "../../../../tmp/evil"
    out = sanitize_run_config(cfg)
    assert out["export"]["output_dir"] == "data/processed"


def test_absolute_report_dir_forced_to_canonical():
    cfg = copy.deepcopy(BASE)
    cfg["report"]["output_dir"] = "/workspaces/databridge-cli/frontend/dist"
    out = sanitize_run_config(cfg)
    assert out["report"]["output_dir"] == "reports"


def test_traversal_alias_is_made_safe():
    cfg = copy.deepcopy(BASE)
    cfg["form"]["alias"] = "../../../tmp/x"
    out = sanitize_run_config(cfg)
    alias = out["form"]["alias"]
    assert "/" not in alias and ".." not in alias and "\\" not in alias
    assert alias  # non-empty fallback


def test_does_not_mutate_input():
    cfg = copy.deepcopy(BASE)
    cfg["export"]["output_dir"] = "/etc"
    sanitize_run_config(cfg)
    assert cfg["export"]["output_dir"] == "/etc"  # original dict untouched
