"""
kobo-reporter CLI — four commands:
  fetch-questions    Download form schema → writes into config.yml
  generate-template  Build starter Word template from config charts
  download           Extract + filter + export data
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
def cmd_generate_template(out):
    """Auto-generate a starter Word template from config.yml."""
    from src.reports.template_generator import generate_template
    cfg = load_config(CONFIG_PATH)
    if not cfg.get("charts"):
        click.echo("Warning: no charts in config.yml — template will have no chart placeholders.", err=True)
    out_path = Path(out) if out else Path(cfg.get("report",{}).get("template","templates/report_template.docx"))
    generate_template(cfg, out_path)

@cli.command("download")
@click.option("--sample", default=None, type=int, help="Limit to first N submissions.")
def cmd_download(sample):
    """Download submissions, apply filters, export to configured destination."""
    from src.data.extract import get_client
    from src.data.transform import load_data, apply_filters, export_data
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
    log.info(f"Exporting {len(df)} rows ...")
    export_data(df, cfg, repeat_tables)

@cli.command("build-report")
@click.option("--sample", default=None, type=int, help="Use only first N rows.")
@click.option("--split-by", default=None, help="Column (export_label) to split reports by — one report per unique value.")
def cmd_build_report(sample, split_by):
    """Build a Word report from previously downloaded data."""
    cfg = load_config(CONFIG_PATH)
    if not cfg.get("charts"):
        click.echo("No charts in config.yml. Add chart configs first.", err=True)
        sys.exit(1)
    from src.reports.builder import ReportBuilder
    ReportBuilder(cfg).build(sample_size=sample, split_by=split_by)

if __name__ == "__main__":
    cli()
