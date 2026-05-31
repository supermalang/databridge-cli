"""
kobo-reporter CLI — four commands:
  fetch-questions    Download form schema → writes into config.yml
  generate-template  Build starter Word template from config charts
  download           Extract + filter + export data (+ auto-classify if configured)
  build-report       Generate Word report from downloaded data
"""
import sys, logging
from datetime import datetime
from pathlib import Path
import click
from dotenv import load_dotenv
from src.utils.config import load_config

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

@click.group()
@click.option(
    "--config", "config_path",
    default="config.yml",
    type=click.Path(dir_okay=False),
    help="Path to config.yml. Defaults to ./config.yml.",
)
@click.option(
    "--strict",
    is_flag=True,
    default=False,
    help="Fail on any filter / computed_column / view / schema-drift warning instead of skipping.",
)
@click.pass_context
def cli(ctx, config_path, strict):
    """kobo-reporter — Extract Kobo/Ona data and generate Word reports."""
    ctx.ensure_object(dict)
    ctx.obj["config_path"] = Path(config_path)
    ctx.obj["strict"] = strict

@cli.command("fetch-questions")
@click.pass_context
def cmd_fetch_questions(ctx):
    """Fetch form schema from Kobo/Ona and write questions into config.yml."""
    from src.data.extract import get_client
    from src.data.questions import fetch_and_write_questions
    config_path = ctx.obj["config_path"]
    cfg = load_config(config_path)
    fetch_and_write_questions(get_client(cfg), cfg, config_path)

@cli.command("generate-template")
@click.option("--out", default=None, help="Output path. Defaults to report.template in config.yml.")
@click.option("--context", default=None, help="Background and context shown at the top of the template.")
@click.option("--summary-prompt", default=None, help="Prompt/guidance shown in the executive summary section.")
@click.pass_context
def cmd_generate_template(ctx, out, context, summary_prompt):
    """Auto-generate a starter Word template from config.yml."""
    from src.reports.template_generator import generate_template
    config_path = ctx.obj["config_path"]
    cfg = load_config(config_path)
    if not cfg.get("charts"):
        click.echo("Warning: no charts in config.yml — template will have no chart placeholders.", err=True)
    out_path = Path(out) if out else Path(cfg.get("report",{}).get("template","templates/report_template.docx"))
    generate_template(cfg, out_path, context=context, summary_prompt=summary_prompt)

@cli.command("ai-generate-template")
@click.option("--description", required=True, help="Project/report background and context for the AI.")
@click.option("--pages", default=10, type=int, help="Target number of pages.")
@click.option("--language", default="English", help="Report language.")
@click.option("--context", default=None, help="Background and context (alias for --description if provided separately).")
@click.option("--summary-prompt", default=None, help="Guidance for the executive summary section.")
@click.option("--out", default=None, help="Output path. Defaults to ai_<template> from config.yml.")
@click.pass_context
def cmd_ai_generate_template(ctx, description, pages, language, context, summary_prompt, out):
    """AI-generate a structured Word template based on project description and config."""
    from src.reports.ai_template_generator import ai_generate_template
    from src.utils import lf_client
    config_path = ctx.obj["config_path"]
    cfg = load_config(config_path)
    if not cfg.get("ai"):
        click.echo("No ai: section in config.yml. Configure AI in the web UI first.", err=True)
        sys.exit(1)
    if not out:
        base = Path(cfg.get("report", {}).get("template", "templates/report_template.docx"))
        out_path = base.with_name(f"ai_{base.stem}.docx")
    else:
        out_path = Path(out)
    # --context overrides --description if both are passed; otherwise use description
    effective_description = context or description
    with lf_client.command_trace("ai-generate-template"):
        ai_generate_template(cfg, out_path, effective_description, pages, language, summary_prompt=summary_prompt)

@cli.command("suggest-charts")
@click.option("--out", default=None, help="Write YAML to this file instead of printing to stdout.")
@click.option("--user-request", default="", help="Free-text guidance for what charts the user wants (e.g. 'focus on geographic distribution').")
@click.pass_context
def cmd_suggest_charts(ctx, out, user_request):
    """Ask AI to suggest a charts: config block from your questions."""
    from src.reports.ai_chart_suggester import suggest_charts
    from src.utils import lf_client
    config_path = ctx.obj["config_path"]
    cfg = load_config(config_path)
    if not cfg.get("ai"):
        click.echo("No ai: section in config.yml. Configure AI in the web UI first.", err=True)
        sys.exit(1)
    if not cfg.get("questions"):
        click.echo("No questions in config.yml. Run fetch-questions first.", err=True)
        sys.exit(1)
    with lf_client.command_trace("suggest-charts"):
        suggest_charts(cfg, out_path=out, user_request=user_request)


@cli.command("suggest-views")
@click.option("--out", default=None, help="Write YAML to this file instead of printing to stdout.")
@click.option("--user-request", default="", help="Free-text guidance for what views the user wants.")
@click.pass_context
def cmd_suggest_views(ctx, out, user_request):
    """Ask AI to suggest a views: config block — virtual tables charts can use as source."""
    from src.reports.ai_view_suggester import suggest_views
    from src.utils import lf_client
    config_path = ctx.obj["config_path"]
    cfg = load_config(config_path)
    if not cfg.get("ai"):
        click.echo("No ai: section in config.yml. Configure AI in the web UI first.", err=True)
        sys.exit(1)
    if not cfg.get("questions"):
        click.echo("No questions in config.yml. Run fetch-questions first.", err=True)
        sys.exit(1)
    with lf_client.command_trace("suggest-views"):
        suggest_views(cfg, out_path=out, user_request=user_request)


@cli.command("suggest-summaries")
@click.option("--out", default=None, help="Write YAML to this file instead of printing to stdout.")
@click.option("--user-request", default="", help="Free-text guidance for what summaries the user wants.")
@click.pass_context
def cmd_suggest_summaries(ctx, out, user_request):
    """Ask AI to suggest a summaries: config block — text paragraphs for the report."""
    from src.reports.ai_summary_suggester import suggest_summaries
    from src.utils import lf_client
    config_path = ctx.obj["config_path"]
    cfg = load_config(config_path)
    if not cfg.get("ai"):
        click.echo("No ai: section in config.yml. Configure AI in the web UI first.", err=True)
        sys.exit(1)
    if not cfg.get("questions"):
        click.echo("No questions in config.yml. Run fetch-questions first.", err=True)
        sys.exit(1)
    with lf_client.command_trace("suggest-summaries"):
        suggest_summaries(cfg, out_path=out, user_request=user_request)


def _run_classify(cfg, config_path, sample=None, rediscover=False):
    """Run text classification for any questions with classify.enabled: true.

    Called automatically at the end of download. Silently skips if no AI config
    or no classify-enabled questions are present.
    """
    from src.data.classifier import discover_themes, classify_responses
    from src.data.transform import load_processed_data, export_data
    from src.utils.config import write_config

    ai_cfg = cfg.get("ai")
    if not ai_cfg:
        return
    api_key = ai_cfg.get("api_key", "")
    if not api_key or str(api_key).startswith("env:"):
        return

    fmt = cfg.get("export", {}).get("format", "csv")
    if fmt not in ("csv", "json", "xlsx"):
        return

    questions = cfg.get("questions", [])
    target_qs = [q for q in questions if q.get("classify", {}).get("enabled")]
    if not target_qs:
        return

    log.info("Running text classification ...")
    df, _repeat_tables = load_processed_data(cfg, sample_size=sample)

    changed = False
    for q in target_qs:
        col = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
        if not col or col not in df.columns:
            log.warning(f"Column '{col}' not found in processed data — skipping.")
            continue

        classify_cfg = q.get("classify", {})
        theme_count = int(classify_cfg.get("theme_count", 5))
        themes = classify_cfg.get("themes") or []
        label = q.get("label") or col

        if not themes or rediscover:
            log.info(f"Discovering themes for '{col}' ...")
            themes = discover_themes(df[col], label, theme_count, ai_cfg)
            q["classify"]["themes"] = themes
            changed = True

        cluster_col = f"{col}_cluster"
        log.info(f"Classifying '{col}' → '{cluster_col}' using themes: {themes}")
        df[cluster_col] = classify_responses(df[col], themes, label, ai_cfg)
        n_classified = df[cluster_col].notna().sum()
        log.info(f"  Done — {n_classified}/{len(df)} rows classified.")

    if changed:
        write_config(cfg, config_path)
        log.info("Themes saved to config.yml.")

    log.info("Saving classified data ...")
    export_data(df, cfg, redact=False)   # data was already PII-gated at the primary export
    log.info("Classification complete.")


@cli.command("download")
@click.option("--sample", default=None, type=int, help="Limit to first N submissions.")
@click.option("--period", default=None, help="Period label to tag this download (overrides periods.current).")
@click.option("--no-redact", is_flag=True, default=False,
              help="RAW export: skip PII redaction & consent gating (internal/secure use only).")
@click.pass_context
def cmd_download(ctx, sample, period, no_redact):
    """Download submissions, apply filters, export to configured destination."""
    from src.data.extract import get_client
    from src.data.transform import load_data, apply_filters, apply_computed_columns, export_data
    from src.utils.pii import PIIConfigError
    from src.utils import lf_client
    config_path = ctx.obj["config_path"]
    strict = ctx.obj["strict"]
    cfg = load_config(config_path)
    if not cfg.get("questions"):
        click.echo("No questions in config.yml. Run fetch-questions first.", err=True)
        sys.exit(1)
    if period:
        from src.utils.periods import slugify
        cfg.setdefault("periods", {})
        cfg["periods"]["current"] = period
        registry = cfg["periods"].setdefault("registry", [])
        if not any(e.get("label") == period for e in registry):
            registry.append({"label": period, "slug": slugify(period)})
    with lf_client.command_trace("download"):
        client = get_client(cfg)
        log.info("Downloading submissions ...")
        raw = client.get_submissions(sample_size=sample)
        log.info("Transforming data ...")
        df, repeat_tables = load_data(raw, cfg, strict=strict)
        df, repeat_tables = apply_filters(df, cfg, repeat_tables, strict=strict)
        df = apply_computed_columns(df, cfg, repeat_tables, strict=strict)
        log.info(f"Exporting {len(df)} rows ...")
        if no_redact:
            log.warning("⚠ RAW export: PII redaction & consent gating SKIPPED (--no-redact).")
        try:
            export_data(df, cfg, repeat_tables, redact=not no_redact)
        except PIIConfigError as e:
            click.echo(f"PII config error — export aborted: {e}", err=True)
            sys.exit(1)
        if period:
            from src.utils.config import write_config
            write_config(cfg, config_path)
        _run_classify(cfg, config_path, sample=sample)


@cli.command("list-sessions")
@click.pass_context
def cmd_list_sessions(ctx):
    """List available downloaded data sessions."""
    from src.data.transform import list_sessions
    config_path = ctx.obj["config_path"]
    cfg = load_config(config_path)
    sessions = list_sessions(cfg)
    if not sessions:
        click.echo("No sessions found. Run 'download' first.")
        return
    for i, s in enumerate(sessions):
        marker = "  ← latest" if i == 0 else ""
        files_str = ", ".join(s["files"])
        click.echo(f"  {s['session_id']}  ({s['label']}){marker}")
        click.echo(f"    files: {files_str}")


@cli.command("build-report")
@click.option("--sample", default=None, type=int, help="Use only N rows.")
@click.option("--random-sample", "random_sample", is_flag=True, default=False,
              help="Use random sampling instead of first-N when --sample is set.")
@click.option("--split-by", default=None, help="Column (export_label) to split reports by — one report per unique value.")
@click.option("--split-sample", "split_sample", default=None, type=int,
              help="When splitting, generate reports for only the first N split values.")
@click.option("--session", default=None, help="Session ID (YYYYMMDD_HHMMSS) to use. Defaults to latest.")
@click.option("--period", default=None, help="Period label to build from (overrides periods.current).")
@click.option("--compare", default=None, help='Comma-separated period labels to compare (e.g. "Q1 2026,Q2 2026").')
@click.pass_context
def cmd_build_report(ctx, sample, random_sample, split_by, split_sample, session, period, compare):
    """Build a Word report from previously downloaded data."""
    from src.utils import lf_client
    config_path = ctx.obj["config_path"]
    strict = ctx.obj["strict"]
    cfg = load_config(config_path)
    if not cfg.get("charts"):
        click.echo("No charts in config.yml. Add chart configs first.", err=True)
        sys.exit(1)
    from src.reports.builder import ReportBuilder
    compare_labels = [s.strip() for s in (compare or "").split(",") if s.strip()] or None
    with lf_client.command_trace("build-report"):
        ReportBuilder(cfg, strict=strict).build(sample_size=sample, split_by=split_by, random_sample=random_sample, split_sample=split_sample, session=session, period=period, compare=compare_labels)

def _invoke(ctx, command, **params):
    """Indirection over Click's ctx.invoke so run-all's sequencing is unit-testable
    (tests monkeypatch this to record stage order / simulate a stage failure)."""
    return ctx.invoke(command, **params)


@cli.command("run-all")
@click.option("--sample", default=None, type=int, help="Limit the download to first N submissions.")
@click.option("--period", default=None, help="Period label for this run (passed to download + build-report).")
@click.option("--force", is_flag=True, default=False, help="Rebuild the report even if data + config are unchanged.")
@click.pass_context
def cmd_run_all(ctx, sample, period, force):
    """Run the core pipeline in order: download -> (generate-template if missing) -> build-report."""
    from src.utils import lf_client
    config_path = ctx.obj["config_path"]
    cfg = load_config(config_path)
    if not cfg.get("questions"):
        click.echo("No questions configured — run fetch-questions first.", err=True)
        sys.exit(1)
    if not cfg.get("charts"):
        click.echo("No charts configured — add charts (or use the Ask tab) before building a report.", err=True)
        sys.exit(1)

    with lf_client.command_trace("run-all"):
        log.info("▶ download")
        try:
            _invoke(ctx, cmd_download, sample=sample, period=period, no_redact=False)
        except SystemExit:
            raise
        except Exception as e:  # noqa: BLE001
            click.echo(f"✗ download failed: {e}", err=True)
            sys.exit(1)
        log.info("✓ download")

        template = Path(cfg.get("report", {}).get("template", "templates/report_template.docx"))
        if not template.exists():
            log.info("▶ generate-template (none found)")
            try:
                _invoke(ctx, cmd_generate_template, out=None, context=None, summary_prompt=None)
            except SystemExit:
                raise
            except Exception as e:  # noqa: BLE001
                click.echo(f"✗ generate-template failed: {e}", err=True)
                sys.exit(1)

        from src.data import run_state
        if not force and run_state.report_is_current(cfg):
            click.echo("✓ report up-to-date — skipping build-report (use --force to rebuild).")
        else:
            log.info("▶ build-report")
            try:
                # sample=None on purpose: build-report reads the already-downloaded session
                # (the --sample on run-all limited the download, not the report).
                _invoke(ctx, cmd_build_report, sample=None, random_sample=False, split_by=None,
                        split_sample=None, session=None, period=period, compare=None)
            except SystemExit:
                raise
            except Exception as e:  # noqa: BLE001
                click.echo(f"✗ build-report failed: {e}", err=True)
                sys.exit(1)
            run_state.save_state(cfg, run_state.data_fingerprint(cfg),
                                 run_state.config_fingerprint(cfg),
                                 built_at=datetime.now().isoformat(timespec="seconds"))
            log.info("✓ build-report")
        log.info("✓ Pipeline complete.")


@cli.command("set-period")
@click.argument("label")
@click.option("--baseline", is_flag=True, default=False, help="Also set this period as the baseline.")
@click.pass_context
def cmd_set_period(ctx, label, baseline):
    """Set the current period. Auto-registers it if not already in the registry."""
    from src.utils.periods import slugify
    config_path = ctx.obj["config_path"]
    cfg = load_config(config_path)
    cfg.setdefault("periods", {})
    cfg["periods"]["current"] = label
    if baseline:
        cfg["periods"]["baseline"] = label
    registry = cfg["periods"].setdefault("registry", [])
    if not any(e.get("label") == label for e in registry):
        registry.append({"label": label, "slug": slugify(label)})
    from src.utils.config import write_config
    write_config(cfg, config_path)
    click.echo(f"Current period set to: {label}")
    if baseline:
        click.echo(f"Baseline period set to: {label}")

@cli.command("push-prompts")
@click.option("--force", is_flag=True, default=False,
              help="Overwrite prompts that already exist in Langfuse.")
@click.pass_context
def cmd_push_prompts(ctx, force):
    """Push bundled seed prompts to Langfuse (create-if-missing; --force overwrites)."""
    from src.utils import lf_client
    try:
        results = lf_client.push_seed_prompts(force=force)
    except RuntimeError as exc:
        click.echo(str(exc), err=True)
        sys.exit(1)
    for name, action in results:
        click.echo(f"  {action:8} {name}")
    click.echo(f"Done — {len(results)} prompt(s) processed.")


if __name__ == "__main__":
    cli()
