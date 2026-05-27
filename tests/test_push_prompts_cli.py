from unittest import mock
from click.testing import CliRunner
from src.data.make import cli

def test_push_prompts_invokes_client():
    runner = CliRunner()
    with mock.patch("src.utils.lf_client.push_seed_prompts",
                    return_value=[("narrator", "created"), ("summaries", "skipped")]) as p:
        result = runner.invoke(cli, ["push-prompts"])
    assert result.exit_code == 0, result.output
    p.assert_called_once_with(force=False)
    assert "narrator" in result.output and "created" in result.output

def test_push_prompts_force_flag():
    runner = CliRunner()
    with mock.patch("src.utils.lf_client.push_seed_prompts",
                    return_value=[("narrator", "updated")]) as p:
        result = runner.invoke(cli, ["push-prompts", "--force"])
    assert result.exit_code == 0, result.output
    p.assert_called_once_with(force=True)

def test_push_prompts_reports_misconfig():
    runner = CliRunner()
    with mock.patch("src.utils.lf_client.push_seed_prompts",
                    side_effect=RuntimeError("Langfuse is not configured.")):
        result = runner.invoke(cli, ["push-prompts"])
    assert result.exit_code != 0
    assert "not configured" in result.output
