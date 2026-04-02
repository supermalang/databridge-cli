import json, logging
from pathlib import Path
from typing import Dict, List, Optional
import pandas as pd

log = logging.getLogger(__name__)

def load_data(submissions: List[Dict], cfg: Dict) -> pd.DataFrame:
    questions = cfg.get("questions", [])
    if not questions:
        raise ValueError("No questions in config.yml. Run fetch-questions first.")
    flat = pd.json_normalize(submissions)
    col_map: Dict[str,str] = {}
    missing: List[str] = []
    for q in questions:
        key = q["kobo_key"]
        label = q.get("export_label") or q.get("label") or key
        if key in flat.columns: col_map[key] = label
        else: missing.append(key)
    if missing: log.warning(f"Keys not found in submissions: {missing}")
    df = flat[list(col_map.keys())].rename(columns=col_map)
    for q in questions:
        label = q.get("export_label") or q.get("label") or q["kobo_key"]
        if label in df.columns:
            df[label] = _cast(df[label], q.get("category","undefined"))
    log.info(f"Loaded {len(df)} submissions, {len(df.columns)} columns")
    return df

def _cast(series: pd.Series, category: str) -> pd.Series:
    if category == "quantitative": return pd.to_numeric(series, errors="coerce")
    if category == "date": return pd.to_datetime(series, errors="coerce")
    return series.astype(str).replace("nan", None)

def apply_filters(df: pd.DataFrame, cfg: Dict) -> pd.DataFrame:
    filters: List[str] = cfg.get("filters", [])
    if not filters: return df
    original = len(df)
    for condition in filters:
        try:
            df = df.query(condition)
            log.info(f"  Filter '{condition}' → {len(df)} rows")
        except Exception as e:
            log.warning(f"  Filter '{condition}' failed: {e} — skipped")
    log.info(f"Filters applied: {original} → {len(df)} rows")
    return df

def export_data(df: pd.DataFrame, cfg: Dict) -> None:
    fmt = cfg.get("export", {}).get("format", "csv")
    if fmt in ("csv","json","xlsx"): _export_file(df, cfg, fmt)
    elif fmt in ("mysql","postgres"): _export_sql(df, cfg, fmt)
    elif fmt == "supabase": _export_supabase(df, cfg)
    else: raise ValueError(f"Unknown export format '{fmt}'.")

def _export_file(df: pd.DataFrame, cfg: Dict, fmt: str) -> None:
    out_dir = Path(cfg.get("export",{}).get("output_dir","data/processed"))
    out_dir.mkdir(parents=True, exist_ok=True)
    alias = cfg.get("form",{}).get("alias","form")
    out = out_dir / f"{alias}_data.{fmt}"
    if fmt == "csv": df.to_csv(out, index=False, encoding="utf-8-sig")
    elif fmt == "json": df.to_json(out, orient="records", force_ascii=False, indent=2, date_format="iso")
    elif fmt == "xlsx": df.to_excel(out, index=False, engine="openpyxl")
    log.info(f"Data exported → {out}")

def _export_sql(df: pd.DataFrame, cfg: Dict, dialect: str) -> None:
    from sqlalchemy import create_engine
    db = cfg.get("export",{}).get("database",{})
    h,p = db.get("host","localhost"), db.get("port", 5432 if dialect=="postgres" else 3306)
    n,u,pw,t = db.get("name"), db.get("user"), db.get("password",""), db.get("table","submissions")
    url = f"postgresql+psycopg2://{u}:{pw}@{h}:{p}/{n}" if dialect=="postgres" else f"mysql+pymysql://{u}:{pw}@{h}:{p}/{n}?charset=utf8mb4"
    df.to_sql(t, create_engine(url), if_exists="replace", index=False)
    log.info(f"Data exported → {dialect}://{h}:{p}/{n}.{t}")

def _export_supabase(df: pd.DataFrame, cfg: Dict) -> None:
    from supabase import create_client
    db = cfg.get("export",{}).get("database",{})
    url,key,table = db.get("supabase_url"), db.get("supabase_key"), db.get("table","submissions")
    if not url or not key: raise ValueError("supabase_url and supabase_key must be set.")
    client = create_client(url, key)
    records = json.loads(df.to_json(orient="records", date_format="iso", force_ascii=False))
    for i in range(0, len(records), 500):
        client.table(table).upsert(records[i:i+500]).execute()
    log.info(f"Data exported → Supabase '{table}' ({len(records)} rows)")

def load_processed_data(cfg: Dict, sample_size: Optional[int] = None) -> pd.DataFrame:
    fmt = cfg.get("export",{}).get("format","csv")
    out_dir = Path(cfg.get("export",{}).get("output_dir","data/processed"))
    alias = cfg.get("form",{}).get("alias","form")
    if fmt == "csv": df = pd.read_csv(out_dir / f"{alias}_data.csv")
    elif fmt == "json": df = pd.read_json(out_dir / f"{alias}_data.json", orient="records")
    elif fmt == "xlsx": df = pd.read_excel(out_dir / f"{alias}_data.xlsx")
    else:
        p = out_dir / f"{alias}_data.csv"
        if not p.exists(): raise FileNotFoundError(f"No data at {p}. Run 'download' first.")
        df = pd.read_csv(p)
    if sample_size:
        df = df.head(sample_size)
        log.info(f"Sample mode: {len(df)} rows")
    return df
