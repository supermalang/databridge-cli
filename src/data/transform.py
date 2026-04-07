import json, logging, unicodedata, re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import pandas as pd

log = logging.getLogger(__name__)


def _norm(s: str) -> str:
    """Lowercase, strip accents, collapse all non-alphanumeric to empty string."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _decode_multi(value, choices: dict) -> str:
    """Decode space-separated select_multiple codes to human-readable labels."""
    if not value or str(value).strip() in ("", "nan"):
        return value
    parts = str(value).strip().split()
    return " ".join(choices.get(p, p) for p in parts)


def apply_choice_labels(df: pd.DataFrame, questions: list) -> pd.DataFrame:
    """Map raw numeric/code values to human-readable labels for select questions.

    Works on any DataFrame whose column names match questions' export_label values.
    Safe to call on pre-exported CSVs or live submission data alike.
    """
    for q in questions:
        choices = q.get("choices")
        if not choices:
            continue
        col = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
        if not col or col not in df.columns:
            continue
        if q.get("type") == "select_multiple":
            df[col] = df[col].apply(lambda v, ch=choices: _decode_multi(v, ch))
        else:
            df[col] = df[col].apply(
                lambda v, ch=choices: ch.get(str(v).strip(), v)
                if pd.notna(v) and str(v).strip() not in ("", "nan") else v
            )
    return df


def load_data(submissions: List[Dict], cfg: Dict) -> Tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
    """Load submissions into a main DataFrame + separate DataFrames for repeat groups.

    Returns:
        (main_df, repeat_tables) where repeat_tables is {group_name: DataFrame}
    """
    questions = cfg.get("questions", [])
    if not questions:
        raise ValueError("No questions in config.yml. Run fetch-questions first.")

    # Separate main questions from repeat-group questions
    main_questions = [q for q in questions if not q.get("repeat_group")]
    repeat_groups: Dict[str, List[Dict]] = {}
    for q in questions:
        rg = q.get("repeat_group")
        if rg:
            repeat_groups.setdefault(rg, []).append(q)

    # --- Main table ---
    flat = pd.json_normalize(submissions)
    col_map: Dict[str, str] = {}
    used_labels: Dict[str, int] = {}
    missing: List[str] = []
    for q in main_questions:
        key = q["kobo_key"]
        # json_normalize uses "." as separator; kobo_keys use "/" for group paths
        flat_key = key.replace("/", ".")
        label = q.get("export_label") or q.get("label") or key
        # Deduplicate labels to avoid column collisions
        if label in used_labels:
            used_labels[label] += 1
            label = f"{label}_{used_labels[label]}"
        else:
            used_labels[label] = 0
        if flat_key in flat.columns:
            col_map[flat_key] = label
        elif key in flat.columns:
            col_map[key] = label
        else:
            # Fallback: match by field name only (last path segment), ignoring group prefix.
            # Handles cases where config group path differs from what the API returns.
            field_name = key.split("/")[-1]
            candidates = [
                c for c in flat.columns
                if c == field_name
                or c.endswith(f"/{field_name}")
                or c.endswith(f".{field_name}")
            ]
            if len(candidates) == 1:
                log.warning(
                    f"kobo_key '{key}' not found; matched by field name to '{candidates[0]}'"
                )
                col_map[candidates[0]] = label
            else:
                # Final fallback: unicode-normalize both sides, compare by field name.
                # Catches e.g. kobo_key "groupe_socio-économique" vs API "groupe_socioeconomique".
                norm_field = _norm(field_name)
                candidates_norm = [
                    c for c in flat.columns
                    if _norm(c) == norm_field
                    or _norm(c.split("/")[-1]) == norm_field
                    or _norm(c.split(".")[-1]) == norm_field
                ]
                if len(candidates_norm) == 1:
                    log.warning(
                        f"kobo_key '{key}' matched by normalisation to '{candidates_norm[0]}'"
                    )
                    col_map[candidates_norm[0]] = label
                else:
                    missing.append(key)
    if missing:
        raw_cols = sorted(flat.columns.tolist())
        log.warning(f"Keys not found in submissions: {missing}")
        log.warning(f"Available raw submission columns ({len(raw_cols)}): {raw_cols}")

    # Include _id / _index for joining repeat tables
    id_col = None
    for candidate in ("_id", "_index", "_uuid"):
        if candidate in flat.columns:
            id_col = candidate
            break

    main_cols = list(col_map.keys())
    if id_col and id_col not in main_cols:
        main_cols.insert(0, id_col)
        col_map[id_col] = id_col

    df = flat[main_cols].rename(columns=col_map)
    for q in main_questions:
        label = q.get("export_label") or q.get("label") or q["kobo_key"]
        if label in df.columns:
            df[label] = _cast(df[label], q.get("category", "undefined"))

    df = apply_choice_labels(df, main_questions)
    log.info(f"Loaded {len(df)} submissions, {len(df.columns)} columns (main table)")

    # --- Repeat tables ---
    repeat_tables: Dict[str, pd.DataFrame] = {}
    for group_name, group_questions in repeat_groups.items():
        rows = []
        for i, submission in enumerate(submissions):
            parent_id = submission.get("_id", submission.get("_index", i))
            repeat_data = _resolve_nested(submission, group_name)
            if not isinstance(repeat_data, list):
                continue
            for row_idx, entry in enumerate(repeat_data):
                row = {"_parent_index": parent_id, "_row_index": row_idx}
                for q in group_questions:
                    # Try: full path within repeat, path relative to group, then just field name
                    field_name = q["kobo_key"].split("/")[-1]
                    full_key = q["kobo_key"]
                    relative_key = "/".join(q["kobo_key"].split("/")[1:]) if "/" in q["kobo_key"] else field_name
                    value = entry.get(full_key, entry.get(relative_key, entry.get(field_name)))
                    label = q.get("export_label") or q.get("label") or q["kobo_key"]
                    row[label] = value
                rows.append(row)
        if rows:
            rdf = pd.DataFrame(rows)
            for q in group_questions:
                label = q.get("export_label") or q.get("label") or q["kobo_key"]
                if label in rdf.columns:
                    rdf[label] = _cast(rdf[label], q.get("category", "undefined"))
            rdf = apply_choice_labels(rdf, group_questions)
            repeat_tables[group_name] = rdf
            log.info(f"Loaded {len(rdf)} rows for repeat group '{group_name}'")
        else:
            log.info(f"No data for repeat group '{group_name}'")

    return df, repeat_tables


def _resolve_nested(data: Dict, key: str) -> any:
    """Look up a key that may be top-level or nested (e.g., 'household/members').
    Tries the flat key first, then walks nested dicts."""
    if key in data:
        return data[key]
    parts = key.split("/")
    obj = data
    for part in parts:
        if isinstance(obj, dict) and part in obj:
            obj = obj[part]
        else:
            return []
    return obj


def _cast(series: pd.Series, category: str) -> pd.Series:
    if category == "quantitative":
        return pd.to_numeric(series, errors="coerce")
    if category == "date":
        return pd.to_datetime(series, errors="coerce")
    return series.astype(str).replace("nan", None)


def apply_filters(df: pd.DataFrame, cfg: Dict,
                   repeat_tables: Dict[str, pd.DataFrame] = None) -> Tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
    """Apply filters to main table and remove orphaned repeat rows."""
    if repeat_tables is None:
        repeat_tables = {}
    filters: List[str] = cfg.get("filters", [])
    if not filters:
        return df, repeat_tables
    original = len(df)
    for condition in filters:
        try:
            df = df.query(condition)
            log.info(f"  Filter '{condition}' → {len(df)} rows")
        except Exception as e:
            log.warning(f"  Filter '{condition}' failed: {e} — skipped")
    log.info(f"Filters applied: {original} → {len(df)} rows")
    # Remove orphaned repeat rows whose parent was filtered out
    id_col = None
    for candidate in ("_id", "_index", "_uuid"):
        if candidate in df.columns:
            id_col = candidate
            break
    if id_col and repeat_tables:
        surviving_ids = set(df[id_col])
        for name, rdf in repeat_tables.items():
            before = len(rdf)
            rdf = rdf[rdf["_parent_index"].isin(surviving_ids)]
            repeat_tables[name] = rdf
            if before != len(rdf):
                log.info(f"  Repeat '{name}': {before} → {len(rdf)} rows (orphans removed)")
    return df, repeat_tables


def export_data(df: pd.DataFrame, cfg: Dict, repeat_tables: Dict[str, pd.DataFrame] = None) -> None:
    fmt = cfg.get("export", {}).get("format", "csv")
    if fmt in ("csv", "json", "xlsx"):
        _export_file(df, cfg, fmt, repeat_tables)
    elif fmt in ("mysql", "postgres"):
        _export_sql(df, cfg, fmt, repeat_tables)
    elif fmt == "supabase":
        _export_supabase(df, cfg, repeat_tables)
    else:
        raise ValueError(f"Unknown export format '{fmt}'.")


def _export_file(df: pd.DataFrame, cfg: Dict, fmt: str, repeat_tables: Dict[str, pd.DataFrame] = None) -> None:
    out_dir = Path(cfg.get("export", {}).get("output_dir", "data/processed"))
    out_dir.mkdir(parents=True, exist_ok=True)
    alias = cfg.get("form", {}).get("alias", "form")
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    if fmt == "xlsx":
        # XLSX: multiple sheets in one file
        out = out_dir / f"{alias}_data_{ts}.xlsx"
        with pd.ExcelWriter(out, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="main", index=False)
            if repeat_tables:
                for name, rdf in repeat_tables.items():
                    sheet_name = name[:31]  # Excel sheet name limit
                    rdf.to_excel(writer, sheet_name=sheet_name, index=False)
        log.info(f"Data exported → {out}")
    else:
        # CSV / JSON: one file per table
        if fmt == "csv":
            out = out_dir / f"{alias}_data_{ts}.csv"
            df.to_csv(out, index=False, encoding="utf-8-sig")
        elif fmt == "json":
            out = out_dir / f"{alias}_data_{ts}.json"
            df.to_json(out, orient="records", force_ascii=False, indent=2, date_format="iso")
        log.info(f"Data exported → {out}")

        if repeat_tables:
            for name, rdf in repeat_tables.items():
                if fmt == "csv":
                    rout = out_dir / f"{alias}_{name}_{ts}.csv"
                    rdf.to_csv(rout, index=False, encoding="utf-8-sig")
                elif fmt == "json":
                    rout = out_dir / f"{alias}_{name}_{ts}.json"
                    rdf.to_json(rout, orient="records", force_ascii=False, indent=2, date_format="iso")
                log.info(f"Repeat group exported → {rout}")


def _export_sql(df: pd.DataFrame, cfg: Dict, dialect: str, repeat_tables: Dict[str, pd.DataFrame] = None) -> None:
    from sqlalchemy import create_engine
    db = cfg.get("export", {}).get("database", {})
    h, p = db.get("host", "localhost"), int(db.get("port", 5432 if dialect == "postgres" else 3306))
    n, u, pw, t = db.get("name"), db.get("user"), db.get("password", ""), db.get("table", "submissions")
    url = (f"postgresql+psycopg2://{u}:{pw}@{h}:{p}/{n}" if dialect == "postgres"
           else f"mysql+pymysql://{u}:{pw}@{h}:{p}/{n}?charset=utf8mb4")
    engine = create_engine(url)
    df.to_sql(t, engine, if_exists="replace", index=False)
    log.info(f"Data exported → {dialect}://{h}:{p}/{n}.{t}")
    if repeat_tables:
        for name, rdf in repeat_tables.items():
            rdf.to_sql(f"{t}_{name}", engine, if_exists="replace", index=False)
            log.info(f"Repeat group exported → {dialect}://{h}:{p}/{n}.{t}_{name}")


def _export_supabase(df: pd.DataFrame, cfg: Dict, repeat_tables: Dict[str, pd.DataFrame] = None) -> None:
    from supabase import create_client
    db = cfg.get("export", {}).get("database", {})
    url, key, table = db.get("supabase_url"), db.get("supabase_key"), db.get("table", "submissions")
    if not url or not key:
        raise ValueError("supabase_url and supabase_key must be set.")
    client = create_client(url, key)
    records = json.loads(df.to_json(orient="records", date_format="iso", force_ascii=False))
    for i in range(0, len(records), 500):
        client.table(table).upsert(records[i:i + 500]).execute()
    log.info(f"Data exported → Supabase '{table}' ({len(records)} rows)")
    if repeat_tables:
        for name, rdf in repeat_tables.items():
            recs = json.loads(rdf.to_json(orient="records", date_format="iso", force_ascii=False))
            for i in range(0, len(recs), 500):
                client.table(f"{table}_{name}").upsert(recs[i:i + 500]).execute()
            log.info(f"Repeat group exported → Supabase '{table}_{name}' ({len(recs)} rows)")


def load_processed_data(cfg: Dict, sample_size: Optional[int] = None) -> pd.DataFrame:
    fmt = cfg.get("export", {}).get("format", "csv")
    out_dir = Path(cfg.get("export", {}).get("output_dir", "data/processed"))
    alias = cfg.get("form", {}).get("alias", "form")
    def _latest(pattern):
        matches = sorted(out_dir.glob(pattern), key=lambda x: x.stat().st_mtime, reverse=True)
        if not matches:
            raise FileNotFoundError(f"No data matching {out_dir}/{pattern}. Run 'download' first.")
        return matches[0]

    if fmt == "csv":
        df = pd.read_csv(_latest(f"{alias}_data*.csv"))
    elif fmt == "json":
        df = pd.read_json(_latest(f"{alias}_data*.json"), orient="records")
    elif fmt == "xlsx":
        df = pd.read_excel(_latest(f"{alias}_data*.xlsx"), sheet_name="main")
    else:
        df = pd.read_csv(_latest(f"{alias}_data*.csv"))
    if sample_size:
        df = df.head(sample_size)
        log.info(f"Sample mode: {len(df)} rows")
    questions = cfg.get("questions", [])
    if questions:
        df = apply_choice_labels(df, questions)
    return df
