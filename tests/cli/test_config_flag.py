"""Tests for src.data.make — CLI flag plumbing."""
from pathlib import Path
from click.testing import CliRunner

from src.data.make import cli


def test_config_flag_overrides_default_path(tmp_path, monkeypatch):
    # Build a minimal valid config in a temp location
    cfg = tmp_path / "alt.yml"
    cfg.write_text(
        "api:\n"
        "  platform: kobo\n"
        "  url: https://example.test/api/v2\n"
        "  token: test\n"
        "form:\n"
        "  uid: ABC\n"
        "  alias: alt\n"
        "questions: []\n"
    )
    runner = CliRunner()
    # `download` should fail with 'No questions in config.yml. Run fetch-questions first.'
    # because our alt config has empty questions: []. If --config is not respected,
    # it would instead complain about the missing default config.yml in cwd.
    monkeypatch.chdir(tmp_path)
    result = runner.invoke(cli, ["--config", str(cfg), "download"])
    assert "No questions" in result.output, result.output


def test_strict_flag_is_in_help():
    runner = CliRunner()
    result = runner.invoke(cli, ["--help"])
    assert "--strict" in result.output
    assert "--config" in result.output
