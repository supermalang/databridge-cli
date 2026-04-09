"""
kobo-reporter CLI — four commands:
  fetch-questions    Download form schema → writes into config.yml
  generate-template  Build starter Word template from config charts
  download           Extract + filter + export data (+ auto-classify if configured)
  build-report       Generate Word report from downloaded data
"""
import sys, logging
from pathlib import Path
import click
from dotenv import load_dotenv
from src.utils.config import load_config, CONFIG_PATH

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger(__name__)

@click.group()
def cli():
    """kobo-reporter — Extract Kobo/Ona data and generate Word reports."""
    pass

@cli.command("fetch-questions")
def cmd_fetch_questions():
    """Fetch form schema from Kobo/Ona and write questions into config.yml."""
    from src.data.extract import get_client
    from src.data.questions import fetch_and_write_questions
    cfg = load_config(CONFIG_PATH)
    fetch_and_write_questions(get_client(cfg), cfg, CONFIG_PATH)

@cli.command("generate-template")
@click.option("--out", default=None, help="Output path. Defaults to report.template in config.yml.")
@click.option("--context", default=None, help="Background and context shown at the top of the template.")
@click.option("--summary-prompt", default=None, help="Prompt/guidance shown in the executive summary section.")
def cmd_generate_template(out, context, summary_prompt):
    """Auto-generate a starter Word template from config.yml."""
    from src.reports.template_generator import generate_template
    cfg = load_config(CONFIG_PATH)
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
def cmd_ai_generate_template(description, pages, language, context, summary_prompt, out):
    """AI-generate a structured Word template based on project description and config."""
    from src.reports.ai_template_generator import ai_generate_template
    cfg = load_config(CONFIG_PATH)
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
    ai_generate_template(cfg, out_path, effective_description, pages, language, summary_prompt=summary_prompt)

@cli.command("suggest-charts")
@click.option("--out", default=None, help="Write YAML to this file instead of printing to stdout.")
def cmd_suggest_charts(out):
    """Ask AI to suggest a charts: config block from your questions."""
    from src.reports.ai_chart_suggester import suggest_charts
    cfg = load_config(CONFIG_PATH)
    if not cfg.get("ai"):
        click.echo("No ai: section in config.yml. Configure AI in the web UI first.", err=True)
        sys.exit(1)
    if not cfg.get("questions"):
        click.echo("No questions in config.yml. Run fetch-questions first.", err=True)
        sys.exit(1)
    suggest_charts(cfg, out_path=out)


def _run_classify(cfg, sample=None, rediscover=False):
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
        write_config(cfg, CONFIG_PATH)
        log.info("Themes saved to config.yml.")

    log.info("Saving classified data ...")
    export_data(df, cfg)
    log.info("Classification complete.")


@cli.command("download")
@click.option("--sample", default=None, type=int, help="Limit to first N submissions.")
def cmd_download(sample):
    """Download submissions, apply filters, export to configured destination."""
    from src.data.extract import get_client
    from src.data.transform import load_data, apply_filters, apply_computed_columns, export_data
    cfg = load_config(CONFIG_PATH)
    if not cfg.get("questions"):
        click.echo("No questions in config.yml. Run fetch-questions first.", err=True)
        sys.exit(1)
    client = get_client(cfg)
    log.info("Downloading submissions ...")
    raw = client.get_submissions(sample_size=sample)
    log.info("Transforming data ...")
    df, repeat_tables = load_data(raw, cfg)
    df, repeat_tables = apply_filters(df, cfg, repeat_tables)
    df = apply_computed_columns(df, cfg, repeat_tables)
    log.info(f"Exporting {len(df)} rows ...")
    export_data(df, cfg, repeat_tables)
    _run_classify(cfg, sample=sample)


@cli.command("list-sessions")
def cmd_list_sessions():
    """List available downloaded data sessions."""
    from src.data.transform import list_sessions
    cfg = load_config(CONFIG_PATH)
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
def cmd_build_report(sample, random_sample, split_by, split_sample, session):
    """Build a Word report from previously downloaded data."""
    cfg = load_config(CONFIG_PATH)
    if not cfg.get("charts"):
        click.echo("No charts in config.yml. Add chart configs first.", err=True)
        sys.exit(1)
    from src.reports.builder import ReportBuilder
    ReportBuilder(cfg).build(sample_size=sample, split_by=split_by, random_sample=random_sample, split_sample=split_sample, session=session)

if __name__ == "__main__":
    cli()
