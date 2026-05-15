import json, logging, unicodedata, re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import pandas as pd

log = logging.getLogger(__name__)


def _repeat_path(q: Dict) -> str:
    """Return the full slash-path to the repeat array for a question.

    repeat_group stores only the leaf name (e.g. 'hh_members'), but the Kobo/Ona
    submission JSON uses the full path as the key (e.g. 'household/hh_members').
    We reconstruct it from the question's group field.
    """
    group = q.get("group", "")
    repeat_name = q.get("repeat_group", "")
    if not repeat_name:
        return ""
    if not group:
        return repeat_name
    parts = group.split("/")
    for i, part in enumerate(parts):
        if part == repeat_name:
            return "/".join(parts[: i + 1])
    return repeat_name


def _norm(s: str) -> str:
    """Lowercase, strip accents, collapse all non-alphanumeric to empty string."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _decode_multi(value, choices: dict) -> str:
    """Decode space-separated select_multiple codes to human-readable labels (pipe-separated).

    Uses " | " as separator so multi-word labels (e.g. "Petit Commerce") are preserved
    when expand_multi splits the column later.
    """
    if not value or str(value).strip() in ("", "nan"):
        return value
    parts = str(value).strip().split()
    return " | ".join(choices.get(p, p) for p in parts)


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
            full_path = _repeat_path(q)
            repeat_groups.setdefault(full_path, []).append(q)

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


def apply_filters(
    df: pd.DataFrame,
    cfg: Dict,
    repeat_tables: Dict[str, pd.DataFrame] = None,
    *,
    strict: bool = False,
) -> Tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
    """Apply filters to main table and remove orphaned repeat rows.

    Args:
        strict: When True, a filter that fails to evaluate (bad column, syntax,
                etc.) raises ValueError. When False (default), the failure is
                logged as a warning and the filter is skipped.
    """
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
            msg = f"Filter '{condition}' failed: {e}"
            if strict:
                raise ValueError(msg) from e
            log.warning(f"  {msg} — skipped")
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


def apply_computed_columns(
    df: pd.DataFrame, cfg: Dict, repeat_tables: Dict[str, pd.DataFrame] = None
) -> pd.DataFrame:
    """Append derived columns defined in config computed_columns.

    Two modes:
      - questions + combine : row-wise combination of main-table columns (fixed nested group)
      - from_repeat + stat  : per-submission aggregation of a repeat-group table (no row explosion)
    """
    for col in cfg.get("computed_columns", []):
        name = col.get("name")
        if not name:
            continue
        try:
            if col.get("from_repeat"):
                # --- Repeat aggregation mode ---
                repeat_name = col["from_repeat"]
                rdf = (repeat_tables or {}).get(repeat_name)
                if rdf is None:
                    log.warning(f"computed_column '{name}': repeat table '{repeat_name}' not found — skipped")
                    continue
                question = col.get("question")
                stat = col.get("stat", "sum")
                if not question or question == "count":
                    aggregated = rdf.groupby("_parent_index").size()
                else:
                    if question not in rdf.columns:
                        log.warning(f"computed_column '{name}': column '{question}' not in repeat table — skipped")
                        continue
                    aggregated = rdf.groupby("_parent_index")[question].agg(stat)
                id_col = next((c for c in ("_id", "_index", "_uuid") if c in df.columns), None)
                if not id_col:
                    log.warning(f"computed_column '{name}': no id column in main table — skipped")
                    continue
                df[name] = df[id_col].map(aggregated).fillna(0)
                log.info(f"Computed column '{name}' = {stat}({repeat_name}.{question or 'rows'})")
            else:
                # --- Main-table row-wise combine mode ---
                questions = col.get("questions", [])
                combine = col.get("combine", "sum")
                if not questions:
                    continue
                missing = [q for q in questions if q not in df.columns]
                if missing:
                    log.warning(f"computed_column '{name}': columns not found: {missing} — skipped")
                    continue
                ops = {"sum": "sum", "mean": "mean", "min": "min", "max": "max"}
                if combine not in ops:
                    log.warning(f"computed_column '{name}': unknown combine '{combine}' — skipped")
                    continue
                numeric_cols = df[questions].apply(pd.to_numeric, errors="coerce")
                df[name] = getattr(numeric_cols, combine)(axis=1)
                log.info(f"Computed column '{name}' = {combine}({questions})")
        except Exception as e:
            log.warning(f"computed_column '{name}' failed: {e} — skipped")
    return df


def build_views(
    cfg: Dict,
    main_df: pd.DataFrame,
    repeat_tables: Dict[str, pd.DataFrame],
) -> Dict[str, pd.DataFrame]:
    """Compute named virtual tables defined in config views: section.

    Each view is derived from a source table via optional join, filter,
    and group aggregation. Results are computed once and reused by any
    chart, summary, or indicator that references the view name as source.

    Returns a dict {view_name: DataFrame} to be merged into repeat_tables.
    """
    views: Dict[str, pd.DataFrame] = {}
    for v in cfg.get("views", []):
        name = v.get("name")
        if not name:
            continue
        try:
            source = v.get("source", "main")
            if source == "main":
                df = main_df.copy()
            else:
                base = repeat_tables.get(source)
                if base is None:
                    log.warning(f"View '{name}': source '{source}' not found — skipped")
                    continue
                df = base.copy()

            # Join parent fields into repeat table
            join_cols = v.get("join_parent")
            if join_cols and source != "main":
                df = join_repeat_to_main(df, main_df, join_cols)

            # Apply filter
            filter_expr = v.get("filter")
            if filter_expr:
                try:
                    df = df.query(filter_expr)
                except Exception as e:
                    log.warning(f"View '{name}': filter '{filter_expr}' failed: {e} — skipped")

            # Optional group aggregation → one row per group value
            group_by = v.get("group_by")
            question = v.get("question")
            if group_by and question:
                agg_fn = v.get("agg", "sum")
                if group_by not in df.columns:
                    log.warning(f"View '{name}': group_by column '{group_by}' not found — skipped aggregation")
                elif question not in df.columns:
                    log.warning(f"View '{name}': question column '{question}' not found — skipped aggregation")
                else:
                    numeric = pd.to_numeric(df[question], errors="coerce")
                    agg_result = numeric.groupby(df[group_by]).agg(agg_fn).reset_index()
                    agg_result.columns = [group_by, question]
                    df = agg_result

            # Apply column renames and type overrides
            col_specs = v.get("columns", [])
            if col_specs:
                rename_map = {}
                for cs in col_specs:
                    original = cs.get("name")
                    renamed  = cs.get("rename")
                    col_type = cs.get("type")
                    if not original or original not in df.columns:
                        continue
                    if col_type:
                        try:
                            if col_type in ("number", "numeric"):
                                df[original] = pd.to_numeric(df[original], errors="coerce")
                            elif col_type == "date":
                                df[original] = pd.to_datetime(df[original], errors="coerce")
                            elif col_type in ("text", "string"):
                                df[original] = df[original].astype(str).replace("nan", pd.NA)
                        except Exception as te:
                            log.warning(f"View '{name}': type cast '{original}' → {col_type} failed: {te}")
                    if renamed and renamed != original:
                        rename_map[original] = renamed
                if rename_map:
                    df = df.rename(columns=rename_map)

            views[name] = df
            log.info(f"View '{name}' computed: {len(df)} rows, {len(df.columns)} columns")
        except Exception as e:
            log.warning(f"View '{name}' failed: {e} — skipped")
    return views


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
                    sheet_name = name.replace("/", "_")[:31]  # Excel sheet name limit
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
                safe_name = name.replace("/", "_")
                if fmt == "csv":
                    rout = out_dir / f"{alias}_{safe_name}_{ts}.csv"
                    rdf.to_csv(rout, index=False, encoding="utf-8-sig")
                elif fmt == "json":
                    rout = out_dir / f"{alias}_{safe_name}_{ts}.json"
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
            safe_name = name.replace("/", "_")
            rdf.to_sql(f"{t}_{safe_name}", engine, if_exists="replace", index=False)
            log.info(f"Repeat group exported → {dialect}://{h}:{p}/{n}.{t}_{safe_name}")


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
            safe_name = name.replace("/", "_")
            recs = json.loads(rdf.to_json(orient="records", date_format="iso", force_ascii=False))
            for i in range(0, len(recs), 500):
                client.table(f"{table}_{safe_name}").upsert(recs[i:i + 500]).execute()
            log.info(f"Repeat group exported → Supabase '{table}_{safe_name}' ({len(recs)} rows)")


def list_sessions(cfg: dict) -> list:
    """Return available download sessions sorted newest-first.

    Each entry is a dict with keys: session_id, label, main_file, files.
    session_id = 'YYYYMMDD_HHMMSS' shared by all files from one download run.
    """
    out_dir = Path(cfg.get("export", {}).get("output_dir", "data/processed"))
    alias   = cfg.get("form", {}).get("alias", "form")
    fmt     = cfg.get("export", {}).get("format", "csv")
    ext     = "xlsx" if fmt == "xlsx" else ("json" if fmt == "json" else "csv")
    sessions: Dict[str, Dict] = {}
    for f in out_dir.glob(f"{alias}_*.{ext}"):
        parts = f.stem.rsplit("_", 2)          # […, YYYYMMDD, HHMMSS]
        if len(parts) < 3:
            continue
        sid = f"{parts[-2]}_{parts[-1]}"       # YYYYMMDD_HHMMSS
        sessions.setdefault(sid, {"session_id": sid, "files": [], "main_file": None})
        sessions[sid]["files"].append(f.name)
        if f.stem.startswith(f"{alias}_data_"):
            sessions[sid]["main_file"] = f.name
    result = []
    for sid, info in sorted(sessions.items(), reverse=True):
        info["label"] = f"{sid[:4]}-{sid[4:6]}-{sid[6:8]} {sid[9:11]}:{sid[11:13]}:{sid[13:15]}"
        result.append(info)
    return result


def apply_local_scope(
    df: pd.DataFrame,
    repeat_tables: Dict[str, pd.DataFrame],
    source: Optional[str] = None,
    filter_expr: Optional[str] = None,
    sample_n: Optional[int] = None,
    random_sample: bool = True,
) -> pd.DataFrame:
    """Select data source, apply a per-item filter, and optionally sample rows.

    Args:
        source:      "main" (or None) → use main df; any other string → look up
                     in repeat_tables by that key.
        filter_expr: pandas .query() expression applied after source selection.
        sample_n:    If set, limit to this many rows (random when random_sample=True).
        random_sample: Use random sampling (seed 42) instead of head().

    Returns a new (possibly smaller) DataFrame scoped to the item.
    """
    if source and source != "main":
        target = repeat_tables.get(source)
        if target is None:
            log.warning(f"source '{source}' not found in repeat_tables — falling back to main df")
            target = df
    else:
        target = df

    if filter_expr:
        try:
            target = target.query(filter_expr)
            log.debug(f"Local filter '{filter_expr}' → {len(target)} rows")
        except Exception as e:
            log.warning(f"Local filter '{filter_expr}' failed: {e} — skipped")

    if sample_n and len(target) > sample_n:
        if random_sample:
            target = target.sample(n=sample_n, random_state=42)
        else:
            target = target.head(sample_n)

    return target


def aggregate_repeat(repeat_df: pd.DataFrame, agg_spec: Dict) -> pd.DataFrame:
    """Aggregate repeat-group rows per parent before charting or computing indicators.

    agg_spec keys:
        group_by  : column to group on (default: '_parent_index')
        count_as  : if set, count rows per group and name the result this column
        sum_col   : if set, sum this column per group
        mean_col  : if set, average this column per group
        min_col   : if set, min of this column per group
        max_col   : if set, max of this column per group

    Returns a new DataFrame with one row per group value.
    """
    group_col = agg_spec.get("group_by", "_parent_index")
    if group_col not in repeat_df.columns:
        log.warning(f"aggregate group_by column '{group_col}' not found — returning repeat_df unchanged")
        return repeat_df

    grouped = repeat_df.groupby(group_col)

    if "count_as" in agg_spec:
        return grouped.size().reset_index(name=agg_spec["count_as"])
    if "sum_col" in agg_spec:
        col = agg_spec["sum_col"]
        return grouped[col].sum().reset_index()
    if "mean_col" in agg_spec:
        col = agg_spec["mean_col"]
        return grouped[col].mean().reset_index()
    if "min_col" in agg_spec:
        col = agg_spec["min_col"]
        return grouped[col].min().reset_index()
    if "max_col" in agg_spec:
        col = agg_spec["max_col"]
        return grouped[col].max().reset_index()

    # Default: count rows per group
    return grouped.size().reset_index(name="count")


def join_repeat_to_main(
    repeat_df: pd.DataFrame,
    main_df: pd.DataFrame,
    join_cols: List[str],
) -> pd.DataFrame:
    """Left-join selected main-table columns into a repeat-group DataFrame.

    Args:
        repeat_df: the repeat table (has _parent_index)
        main_df:   the main submissions table (has _id / _index / _uuid)
        join_cols: list of main_df column names (export_labels) to bring in

    Returns:
        A new DataFrame with repeat rows + the requested parent columns appended.
        If a join column already exists in repeat_df it is suffixed _main on the
        parent side to avoid overwriting repeat data.
    """
    id_col = next((c for c in ("_id", "_index", "_uuid") if c in main_df.columns), None)
    if id_col is None:
        log.warning("join_parent: no id column (_id/_index/_uuid) found in main_df — skipping join")
        return repeat_df

    missing = [c for c in join_cols if c not in main_df.columns]
    if missing:
        log.warning(f"join_parent: columns not found in main_df: {missing} — skipping those")
        join_cols = [c for c in join_cols if c in main_df.columns]
    if not join_cols:
        return repeat_df

    parent_slice = main_df[[id_col] + join_cols].copy()

    # Suffix any column that already exists in repeat_df to avoid silent overwrites
    rename_map = {c: f"{c}_main" for c in join_cols if c in repeat_df.columns}
    if rename_map:
        log.warning(
            f"join_parent: columns {list(rename_map)} already exist in repeat table — "
            f"renaming to {list(rename_map.values())} on the parent side"
        )
        parent_slice = parent_slice.rename(columns=rename_map)

    merged = repeat_df.merge(
        parent_slice,
        left_on="_parent_index",
        right_on=id_col,
        how="left",
    )
    # Drop the redundant id column from the right side (it duplicates _parent_index)
    if id_col != "_parent_index" and id_col in merged.columns:
        merged = merged.drop(columns=[id_col])

    return merged


def load_processed_data(cfg: Dict, sample_size: Optional[int] = None, random_sample: bool = False, session: Optional[str] = None) -> Tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
    """Load the main processed DataFrame plus any repeat-group tables from disk.

    Args:
        session: Optional session ID (YYYYMMDD_HHMMSS) to load a specific download run.
                 Defaults to the latest session when not provided.

    Returns:
        (main_df, repeat_tables) where repeat_tables is {safe_group_name: DataFrame}
    """
    fmt = cfg.get("export", {}).get("format", "csv")
    out_dir = Path(cfg.get("export", {}).get("output_dir", "data/processed"))
    alias = cfg.get("form", {}).get("alias", "form")

    def _latest(pattern, session=session):
        matches = sorted(out_dir.glob(pattern), key=lambda x: x.stat().st_mtime, reverse=True)
        if session:
            matches = [m for m in matches if m.stem.endswith(session)]
        if not matches:
            raise FileNotFoundError(
                f"No data matching {out_dir}/{pattern}"
                + (f" for session {session}" if session else "")
                + ". Run 'download' first."
            )
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
        if random_sample:
            df = df.sample(n=min(sample_size, len(df)), random_state=42)
            log.info(f"Random sample mode: {len(df)} rows")
        else:
            df = df.head(sample_size)
            log.info(f"Sample mode: {len(df)} rows")

    questions = cfg.get("questions", [])
    if questions:
        df = apply_choice_labels(df, questions)

    # --- Load repeat tables ---
    repeat_tables: Dict[str, pd.DataFrame] = {}
    if fmt == "xlsx":
        xl_path = _latest(f"{alias}_data*.xlsx")
        import openpyxl
        wb = openpyxl.load_workbook(xl_path, read_only=True)
        for sheet in wb.sheetnames:
            if sheet != "main":
                repeat_tables[sheet] = pd.read_excel(xl_path, sheet_name=sheet)
        wb.close()
    else:
        # CSV / JSON: repeat files are named {alias}_{safe_group}_{ts}.{ext}
        # Main file is {alias}_data_{ts}.{ext} — skip it
        ext = "csv" if fmt == "csv" else "json"
        main_stem_prefix = f"{alias}_data_"
        candidates = sorted(out_dir.glob(f"{alias}_*.{ext}"), key=lambda x: x.stat().st_mtime, reverse=True)
        if session:
            candidates = [f for f in candidates if f.stem.endswith(session)]
        for f in candidates:
            if f.stem.startswith(main_stem_prefix):
                continue
            # stem = {alias}_{safe_name}_{YYYYMMDD}_{HHMMSS}
            # rsplit on "_" twice to strip the two timestamp segments
            remainder = f.stem[len(f"{alias}_"):]
            parts = remainder.rsplit("_", 2)
            if len(parts) != 3:
                continue
            group_name = parts[0]
            if group_name and group_name not in repeat_tables:
                if fmt == "csv":
                    repeat_tables[group_name] = pd.read_csv(f)
                else:
                    repeat_tables[group_name] = pd.read_json(f, orient="records")
                log.info(f"Loaded repeat table '{group_name}' ({len(repeat_tables[group_name])} rows)")

    return df, repeat_tables
