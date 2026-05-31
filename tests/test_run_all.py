import yaml
from click.testing import CliRunner
from src.data import make
from src.data import run_state as _run_state


_API = {"platform": "kobo", "url": "https://x.example.com/api/v2", "token": "t"}
_FORM = {"uid": "aaa", "alias": "test"}


def _write_cfg(tmp_path, *, questions=True, charts=True, template_exists):
    template = tmp_path / "t.docx"
    if template_exists:
        template.write_text("x")
    cfg = {
        "api": _API,
        "form": _FORM,
        "questions": [{"export_label": "Region", "category": "categorical"}] if questions else [],
        "charts": [{"name": "c", "type": "bar", "questions": ["Region"]}] if charts else [],
        "report": {"template": str(template)},
    }
    p = tmp_path / "config.yml"
    p.write_text(yaml.safe_dump(cfg))
    return p


def test_run_all_aborts_without_questions(tmp_path):
    p = tmp_path / "config.yml"
    p.write_text(yaml.safe_dump({"api": _API, "form": _FORM, "questions": [], "charts": []}))
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 1 and "fetch-questions" in res.output


def test_run_all_aborts_without_charts(tmp_path):
    p = _write_cfg(tmp_path, charts=False, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 1 and "charts" in res.output.lower()


def test_run_all_order_download_then_build(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(make, "_invoke", lambda ctx, command, **kw: calls.append(command.name))
    p = _write_cfg(tmp_path, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 0
    assert calls == ["download", "build-report"]


def test_run_all_generates_template_when_missing(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(make, "_invoke", lambda ctx, command, **kw: calls.append(command.name))
    p = _write_cfg(tmp_path, template_exists=False)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 0
    assert calls == ["download", "generate-template", "build-report"]


def test_run_all_stops_on_download_failure(tmp_path, monkeypatch):
    calls = []
    def rec(ctx, command, **kw):
        calls.append(command.name)
        if command.name == "download":
            raise RuntimeError("boom")
    monkeypatch.setattr(make, "_invoke", rec)
    p = _write_cfg(tmp_path, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 1
    assert "build-report" not in calls


def test_run_all_skips_build_when_current(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(make, "_invoke", lambda ctx, command, **kw: calls.append(command.name))
    monkeypatch.setattr(_run_state, "report_is_current", lambda cfg: True)
    p = _write_cfg(tmp_path, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 0
    assert "download" in calls and "build-report" not in calls     # skipped
    assert "up-to-date" in res.output.lower()


def test_run_all_force_rebuilds_even_when_current(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(make, "_invoke", lambda ctx, command, **kw: calls.append(command.name))
    monkeypatch.setattr(_run_state, "report_is_current", lambda cfg: True)
    monkeypatch.setattr(_run_state, "save_state", lambda *a, **k: None)
    p = _write_cfg(tmp_path, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all", "--force"])
    assert res.exit_code == 0 and "build-report" in calls


def test_run_all_builds_and_records_when_stale(tmp_path, monkeypatch):
    calls = []
    saved = {}
    monkeypatch.setattr(make, "_invoke", lambda ctx, command, **kw: calls.append(command.name))
    monkeypatch.setattr(_run_state, "report_is_current", lambda cfg: False)
    monkeypatch.setattr(_run_state, "data_fingerprint", lambda cfg: "d")
    monkeypatch.setattr(_run_state, "config_fingerprint", lambda cfg: "c")
    monkeypatch.setattr(_run_state, "save_state", lambda cfg, d, c, built_at: saved.update({"d": d, "c": c}))
    p = _write_cfg(tmp_path, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 0 and "build-report" in calls
    assert saved == {"d": "d", "c": "c"}     # state recorded after building
