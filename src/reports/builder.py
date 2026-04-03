import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import pandas as pd
from docx.shared import Inches
from docxtpl import DocxTemplate, InlineImage
from src.data.transform import load_processed_data
from src.reports.charts import generate_chart, CHART_DIR

log = logging.getLogger(__name__)

class ReportBuilder:
    def __init__(self, cfg: Dict):
        self.cfg = cfg
        self.report_cfg = cfg.get("report", {})
        self.charts_cfg: List[Dict] = cfg.get("charts", [])

    def build(self, sample_size: Optional[int] = None, split_by: Optional[str] = None) -> List[Path]:
        df = load_processed_data(self.cfg, sample_size=sample_size)
        split_col = split_by or self.report_cfg.get("split_by")
        if split_col:
            if split_col not in df.columns:
                log.warning(f"split_by column '{split_col}' not found — building single report")
                return [self._render(df, suffix="")]
            unique_vals = sorted(df[split_col].dropna().unique())
            log.info(f"Split by '{split_col}': {len(unique_vals)} value(s) → {len(unique_vals)} report(s)")
            paths = []
            for val in unique_vals:
                safe = str(val).replace("/", "_").replace(" ", "_")
                paths.append(self._render(df[df[split_col] == val], suffix=f"_{safe}"))
            return paths
        suffix = f"_sample{sample_size}" if sample_size else ""
        return [self._render(df, suffix=suffix)]

    def _render(self, df: "pd.DataFrame", suffix: str = "") -> Path:
        template_path = Path(self.report_cfg.get("template","templates/report_template.docx"))
        if not template_path.exists():
            raise FileNotFoundError(f"Template not found: {template_path}\nRun generate-template or see TEMPLATE_GUIDE.md")
        tpl = DocxTemplate(template_path)
        context = {
            "report_title": self.report_cfg.get("title","Report"),
            "period": self.report_cfg.get("period", datetime.today().strftime("%B %Y")),
            "n_submissions": len(df),
            "generated_at": datetime.today().strftime("%d/%m/%Y %H:%M"),
            "summary_text": "", "observations": "", "recommendations": "",
            "stats_table": self._stats_table(df),
            **self._generate_charts(tpl, df),
        }
        tpl.render(context)
        out_dir = Path(self.report_cfg.get("output_dir","reports"))
        out_dir.mkdir(parents=True, exist_ok=True)
        alias = self.cfg.get("form",{}).get("alias","form")
        out_path = out_dir / f"{alias}_report{suffix}_{datetime.today().strftime('%Y%m%d')}.docx"
        tpl.save(out_path)
        log.info(f"Report saved → {out_path}")
        return out_path

    def _generate_charts(self, tpl, df):
        CHART_DIR.mkdir(parents=True, exist_ok=True)
        key_to_label = {
            q["kobo_key"]: q.get("export_label") or q.get("label") or q["kobo_key"]
            for q in self.cfg.get("questions", [])
        }
        images = {}
        for c in self.charts_cfg:
            name = c.get("name")
            if not name: continue
            resolved = {**c, "questions": [
                key_to_label.get(q, q) if q not in df.columns else q
                for q in c.get("questions", [])
            ]}
            png = generate_chart(resolved, df)
            width = Inches(c.get("options",{}).get("width_inches",5.5))
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
