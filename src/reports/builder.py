import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import pandas as pd
from docx.shared import Inches
from docxtpl import DocxTemplate, InlineImage
from src.data.transform import load_processed_data, apply_local_scope, aggregate_repeat
from src.reports.charts import generate_chart, CHART_DIR
from src.reports.indicators import compute_indicators
from src.reports.narrator import generate_narrative
from src.reports.summaries import compute_summaries

log = logging.getLogger(__name__)


def _pick_df(
    questions: List[str],
    main_df: "pd.DataFrame",
    repeat_tables: Dict,
    source: Optional[str] = None,
) -> "pd.DataFrame":
    """Return the DataFrame that contains the requested question columns.

    When *source* is provided it takes precedence:
      - "main"      → always return main_df
      - other str   → look up repeat_tables[source], fall back to main_df if missing

    Without a source, falls back to the auto-heuristic: pick the DataFrame that
    contains the most of the requested columns (main first, then repeat tables).
    """
    if source:
        if source == "main":
            return main_df
        rdf = repeat_tables.get(source)
        if rdf is not None:
            return rdf
        log.warning(f"source '{source}' not found in repeat_tables — falling back to auto-select")

    if not repeat_tables:
        return main_df
    best_df = main_df
    best_hits = sum(1 for q in questions if q in main_df.columns)
    for rdf in repeat_tables.values():
        hits = sum(1 for q in questions if q in rdf.columns)
        if hits > best_hits:
            best_hits = hits
            best_df = rdf
    return best_df


def _filter_repeat_tables_by_split(
    df: "pd.DataFrame",
    repeat_tables: Dict,
    split_col: str,
    val,
) -> Dict:
    """When splitting reports, keep only repeat rows whose parent submission is in the split."""
    if not repeat_tables:
        return {}
    id_col = next((c for c in ("_id", "_index", "_uuid") if c in df.columns), None)
    if not id_col:
        return repeat_tables
    surviving_ids = set(df[df[split_col] == val][id_col])
    return {
        name: rdf[rdf["_parent_index"].isin(surviving_ids)]
        for name, rdf in repeat_tables.items()
    }


class ReportBuilder:
    def __init__(self, cfg: Dict):
        self.cfg = cfg
        self.report_cfg = cfg.get("report", {})
        self.charts_cfg: List[Dict] = cfg.get("charts", [])

    def build(self, sample_size: Optional[int] = None, split_by: Optional[str] = None, random_sample: bool = False) -> List[Path]:
        df, repeat_tables = load_processed_data(self.cfg, sample_size=sample_size, random_sample=random_sample)
        split_col = split_by or self.report_cfg.get("split_by")
        if split_col:
            if split_col not in df.columns:
                log.warning(f"split_by column '{split_col}' not found — building single report")
                return [self._render(df, repeat_tables, suffix="")]
            unique_vals = sorted(df[split_col].dropna().unique())
            log.info(f"Split by '{split_col}': {len(unique_vals)} value(s) → {len(unique_vals)} report(s)")
            paths = []
            for val in unique_vals:
                safe = str(val).replace("/", "_").replace(" ", "_")
                # Filter repeat tables to rows whose parent submission survived the split
                filtered_repeats = _filter_repeat_tables_by_split(df, repeat_tables, split_col, val)
                paths.append(self._render(df[df[split_col] == val], filtered_repeats, suffix=f"_{safe}"))
            return paths
        suffix = f"_sample{sample_size}" if sample_size else ""
        return [self._render(df, repeat_tables, suffix=suffix)]

    def _render(self, df: "pd.DataFrame", repeat_tables: Dict, suffix: str = "") -> Path:
        template_path = Path(self.report_cfg.get("template","templates/report_template.docx"))
        if not template_path.exists():
            raise FileNotFoundError(f"Template not found: {template_path}\nRun generate-template or see TEMPLATE_GUIDE.md")
        tpl = DocxTemplate(template_path)
        stats_table = self._stats_table(df)
        indicators  = compute_indicators(self.cfg.get("indicators", []), df, repeat_tables)
        summaries   = compute_summaries(self.cfg.get("summaries", []), df, self.cfg.get("ai"), repeat_tables)

        narrative = generate_narrative(
            ai_cfg     = self.cfg.get("ai"),
            report_cfg = self.report_cfg,
            df         = df,
            stats_table= stats_table,
            indicators = indicators,
            charts_cfg = self.charts_cfg,
        )

        context = {
            "report_title":  self.report_cfg.get("title", "Report"),
            "period":        self.report_cfg.get("period", datetime.today().strftime("%B %Y")),
            "n_submissions": len(df),
            "generated_at":  datetime.today().strftime("%d/%m/%Y %H:%M"),
            **narrative,
            "stats_table":   stats_table,
            **indicators,
            **summaries,
            **self._generate_charts(tpl, df, repeat_tables),
        }
        tpl.render(context)
        out_dir = Path(self.report_cfg.get("output_dir","reports"))
        out_dir.mkdir(parents=True, exist_ok=True)
        alias = self.cfg.get("form",{}).get("alias","form")
        out_path = out_dir / f"{alias}_report{suffix}_{datetime.today().strftime('%Y%m%d')}.docx"
        tpl.save(out_path)
        log.info(f"Report saved → {out_path}")
        return out_path

    def _generate_charts(self, tpl, df, repeat_tables: Dict):
        CHART_DIR.mkdir(parents=True, exist_ok=True)
        key_to_label = {
            q["kobo_key"]: q.get("export_label") or q.get("label") or q["kobo_key"]
            for q in self.cfg.get("questions", [])
        }
        images = {}
        for c in self.charts_cfg:
            name = c.get("name")
            if not name:
                continue

            # Resolve question names (kobo_key → export_label)
            resolved_questions = [
                key_to_label.get(q, q) if q not in df.columns else q
                for q in c.get("questions", [])
            ]
            resolved = {**c, "questions": resolved_questions}

            # 1. Select explicit source or auto-pick
            source = c.get("source")
            chart_df = _pick_df(resolved_questions, df, repeat_tables, source=source)

            # 2. Apply per-chart filter and sample
            filter_expr = c.get("filter")
            sample_n = c.get("sample")
            if filter_expr or sample_n:
                chart_df = apply_local_scope(
                    chart_df, {}, filter_expr=filter_expr, sample_n=sample_n
                )

            # 3. Apply repeat-group aggregation if requested
            agg_spec = c.get("aggregate")
            if agg_spec and source and source != "main":
                chart_df = aggregate_repeat(chart_df, agg_spec)

            png = generate_chart(resolved, chart_df)
            width = Inches(c.get("options", {}).get("width_inches", 5.5))
            images[f"chart_{name}"] = InlineImage(tpl, str(png), width=width) if png and png.exists() else ""
        return images

    def _stats_table(self, df):
        rows = []
        for q in self.cfg.get("questions",[]):
            if q.get("category") != "quantitative": continue
            label = q.get("export_label") or q.get("label") or q["kobo_key"]
            if label not in df.columns: continue
            s = pd.to_numeric(df[label], errors="coerce").dropna()
            if s.empty: continue
            rows.append({"label":label,"n":len(s),"mean":round(s.mean(),2),
                         "median":round(s.median(),2),"min":round(s.min(),2),"max":round(s.max(),2)})
        return rows
