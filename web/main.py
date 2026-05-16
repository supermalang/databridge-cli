import asyncio, base64, io, json, os, sys, tempfile, zipfile
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, Dict, Optional

import aiofiles, yaml
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR      = Path(__file__).resolve().parent.parent
CONFIG_PATH   = BASE_DIR / "config.yml"
REPORTS_DIR   = BASE_DIR / "reports"
TEMPLATES_DIR = BASE_DIR / "templates"
DATA_DIR      = BASE_DIR / "data" / "processed"
# In dev mode Vite serves the UI at :51730 and proxies /api/* here, so STATIC_DIR
# isn't read. In prod-like mode the React app is built into frontend/dist/ and we
# serve it directly from FastAPI (see scripts/serve.sh).
STATIC_DIR    = BASE_DIR / "frontend" / "dist"
ASSETS_DIR    = STATIC_DIR / "assets"

app = FastAPI(title="databridge-cli", docs_url=None, redoc_url=None)
_last_status: Dict = {"command": None, "status": "idle", "finished_at": None}
_proc: Optional[asyncio.subprocess.Process] = None

if ASSETS_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    index = STATIC_DIR / "index.html"
    if not index.exists():
        return HTMLResponse(
            "<h1>Databridge API</h1>"
            "<p>FastAPI is running. To get the frontend up: "
            "<code>./scripts/dev.sh</code> (dev with HMR) "
            "or <code>./scripts/serve.sh</code> (built React app, single-port).</p>",
            status_code=200,
        )
    return index.read_text(encoding="utf-8")

@app.get("/api/config")
async def get_config():
    if not CONFIG_PATH.exists():
        return {"content": "", "exists": False}
    async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as f:
        content = await f.read()
    return {"content": content, "exists": True}

class ConfigPayload(BaseModel):
    content: str

@app.post("/api/config")
async def save_config(payload: ConfigPayload):
    try:
        yaml.safe_load(payload.content)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")
    async with aiofiles.open(CONFIG_PATH, "w", encoding="utf-8") as f:
        await f.write(payload.content)
    return {"ok": True, "saved_at": datetime.now().isoformat()}

ALLOWED_COMMANDS = {
    "fetch-questions":      [],
    "generate-template":    ["--context", "--summary-prompt"],
    "ai-generate-template": ["--description", "--pages", "--language", "--context", "--summary-prompt"],
    "suggest-charts":       ["--user-request"],
    "suggest-views":        ["--user-request"],
    "suggest-summaries":    ["--user-request"],
    "download":             ["--sample"],
    "build-report":         ["--sample", "--split-by", "--session"],
}

class RunPayload(BaseModel):
    sample: Optional[int] = None
    split_by: Optional[str] = None
    session: Optional[str] = None
    description: Optional[str] = None
    pages: Optional[int] = None
    language: Optional[str] = None
    rediscover: Optional[bool] = None
    context: Optional[str] = None
    summary_prompt: Optional[str] = None
    user_request: Optional[str] = None

class QuestionsPayload(BaseModel):
    questions: list

class AITestPayload(BaseModel):
    provider: str = "openai"
    api_key: str = ""
    model: str = "gpt-4o"
    base_url: Optional[str] = None

class AISuggestPayload(BaseModel):
    kind: str          # "chart" | "indicator"
    prompt: str
    questions: list = []

@app.get("/api/questions")
async def get_questions():
    if not CONFIG_PATH.exists(): return {"questions": []}
    async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as f:
        content = await f.read()
    cfg = yaml.safe_load(content) or {}
    return {"questions": cfg.get("questions", [])}

@app.post("/api/questions")
async def save_questions(payload: QuestionsPayload):
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=400, detail="config.yml not found")
    async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as f:
        content = await f.read()
    cfg = yaml.safe_load(content) or {}
    cfg["questions"] = payload.questions
    async with aiofiles.open(CONFIG_PATH, "w", encoding="utf-8") as f:
        await f.write(yaml.dump(cfg, allow_unicode=True, default_flow_style=False, sort_keys=False))
    return {"ok": True, "saved": len(payload.questions)}

@app.post("/api/ai/test")
async def test_ai(payload: AITestPayload):
    api_key = payload.api_key.strip()
    if api_key.startswith("env:"):
        api_key = os.environ.get(api_key[4:].strip(), "")
    if not api_key:
        raise HTTPException(status_code=400, detail="API key not set or not resolved.")
    provider = payload.provider.lower()
    result = {"ok": False, "tokens_used": None, "quota": None, "message": ""}
    try:
        if provider == "anthropic":
            try:
                import anthropic
            except ImportError:
                raise HTTPException(status_code=400, detail="anthropic package not installed. Run: pip install anthropic>=0.20.0")
            client = anthropic.Anthropic(api_key=api_key)
            msg = client.messages.create(
                model=payload.model,
                max_tokens=10,
                messages=[{"role": "user", "content": "Reply with OK"}],
            )
            used = getattr(msg.usage, "input_tokens", 0) + getattr(msg.usage, "output_tokens", 0)
            result = {"ok": True, "tokens_used": used, "quota": None, "message": f"Connection OK · {used} tokens used · Quota info not available for Anthropic API"}
        else:
            try:
                from openai import OpenAI
            except ImportError:
                raise HTTPException(status_code=400, detail="openai package not installed. Run: pip install openai>=1.0.0")
            kwargs = {"api_key": api_key}
            if payload.base_url:
                kwargs["base_url"] = payload.base_url
            client = OpenAI(**kwargs)
            resp = client.chat.completions.create(
                model=payload.model,
                max_tokens=10,
                messages=[{"role": "user", "content": "Reply with OK"}],
            )
            used = resp.usage.total_tokens if resp.usage else None
            quota_msg = None
            try:
                import urllib.request
                req = urllib.request.Request(
                    "https://api.openai.com/v1/organization/usage/completions?start_time=0&limit=1",
                    headers={"Authorization": f"Bearer {api_key}"}
                )
                with urllib.request.urlopen(req, timeout=4) as r:
                    json.loads(r.read())
                    quota_msg = "Quota endpoint reachable"
            except Exception:
                quota_msg = "Quota info not available for this provider/key"
            result = {"ok": True, "tokens_used": used, "quota": quota_msg,
                      "message": f"Connection OK · {used} tokens used · {quota_msg}"}
    except HTTPException:
        raise
    except Exception as e:
        result = {"ok": False, "tokens_used": None, "quota": None, "message": str(e)}
    return result

def _build_suggest_prompts(kind: str, prompt: str, questions: list):
    col_parts = []
    for i, q in enumerate(questions):
        if not q:
            continue
        label = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
        category = q.get("category", "")
        col_parts.append(f'{i+1}. "{label}" ({category})' if category else f'{i+1}. "{label}"')
    labels = "\n".join(col_parts) or "unknown"
    if kind == "chart":
        system = (
            "You are a data visualization expert. Given available survey columns with their categories and a description, "
            "return a single chart config as JSON with keys: name, title, type, questions (array), options (object). "
            "Valid types: bar|horizontal_bar|stacked_bar|grouped_bar|pie|donut|line|area|histogram|scatter|"
            "box_plot|heatmap|treemap|waterfall|funnel|table|bullet_chart|likert|scorecard|pyramid|dot_map. "
            "width_inches applies to all types. Per-type valid options — "
            "color (hex string) applies to ALL types — for single-series it sets the bar/line color; "
            "for multi-series (stacked_bar, grouped_bar, etc.) it overrides the first segment color. "
            "Per-type additional options — "
            "bar: top_n,sort,xlabel(category axis),ylabel(value axis); "
            "horizontal_bar: top_n,sort,xlabel(value axis — counts),ylabel(category axis — the column name); "
            "stacked_bar: normalize,xlabel,ylabel; "
            "grouped_bar: sort,xlabel,ylabel; "
            "pie/donut: top_n; "
            "line/area: freq,xlabel,ylabel; "
            "histogram: bins,xlabel,ylabel; "
            "scatter/box_plot: xlabel,ylabel; "
            "heatmap: xlabel,ylabel; "
            "treemap/table: top_n; "
            "waterfall: top_n,sort,xlabel,ylabel; "
            "funnel: top_n; "
            "bullet_chart: target,xlabel,ylabel; "
            "likert: top_n; "
            "scorecard: stat,columns; "
            "pyramid: male_value,female_value; "
            "dot_map: color_by. "
            "Three special options apply to all chart types: "
            "distinct_by (string): column name to deduplicate rows before charting — use when the user wants to count unique entities (e.g. unique beneficiaries, unique communes) rather than total submissions; "
            "expand_multi (boolean): set true for select_multiple columns where answers are stored as space-separated strings — expands 'choice1 choice2' into separate rows so each choice is counted individually; valid for bar/horizontal_bar/pie/donut/treemap/waterfall/funnel/table/likert types only; "
            "data_type (string): override how the column's values are interpreted — valid values are categorical, quantitative, date, qualitative — omit to auto-detect from the column's category. "
            "Only include options relevant to the chosen type. "
            "CRITICAL: the questions array must contain ONLY exact column names copied verbatim from the "
            "provided numbered list — never choice/answer values, never descriptions, never translated text. "
            "Question count per chart type: bar/horizontal_bar/pie/donut/treemap/waterfall/funnel/table/"
            "histogram/line/area/bullet_chart/likert: exactly 1 question; "
            "stacked_bar/grouped_bar/scatter/box_plot/heatmap/pyramid/dot_map: exactly 2 questions; "
            "scorecard: 1 to 3 questions. "
            "Return JSON only, no markdown fences."
        )
        user = f"Available columns:\n{labels}\n\nRequest: {prompt}\n\nRemember: questions array values must be exact column names from the numbered list above — never the answer/choice values of those columns."
    elif kind == "summary":
        system = (
            "You are a data analyst. Given survey columns with their categories and a description, return a single summary "
            "config as JSON with keys: name, label, questions (array), stat, "
            "top_n (optional), freq (optional), prompt (optional). "
            "Valid stat values: distribution|stats|crosstab|trend|ai. "
            "Use distribution for one categorical column (top-N breakdown). "
            "Use stats for one numeric column (mean, median, range). "
            "Use crosstab for two categorical columns (row x column breakdown). "
            "Use trend for a date column, optionally with a numeric column. "
            "Use ai only when the user explicitly wants an AI-generated paragraph. "
            "top_n (integer, default 5): applies to distribution and crosstab. "
            "freq (string: day|week|month|year): applies to trend only. "
            "prompt (string): focus instruction for ai stat only. "
            "CRITICAL: values in the questions array must be exact column names copied verbatim from the provided numbered list. "
            "distribution and stats require exactly 1 question. crosstab and trend require 1-2 questions. ai allows 1 or more. "
            "Return JSON only, no markdown fences."
        )
        user = f"Available columns:\n{labels}\n\nRequest: {prompt}\n\nRemember: questions array values must be exact column names from the numbered list above."
    elif kind == "view":
        # Also collect repeat group info from questions
        repeat_groups: dict = {}
        for q in questions:
            rg = q.get("repeat_group") if q else None
            if rg:
                label = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
                repeat_groups.setdefault(rg, []).append(label)
        repeat_info = ""
        if repeat_groups:
            parts = [f"{rg}: {', '.join(cols)}" for rg, cols in repeat_groups.items()]
            repeat_info = "\n\nRepeat groups (use source: 'group/path'):\n" + "\n".join(parts)
        system = (
            "You are a data engineer. Given survey columns and a description, return a single view "
            "config as JSON with keys: name, source, join_parent (array, optional), filter (string, optional), "
            "group_by (string, optional), question (string, optional), agg (string, optional), columns (array, optional). "
            "A view is a named virtual table: it starts from a source (main table or a repeat group path), "
            "optionally joins parent columns into repeat rows, optionally filters rows, and optionally collapses "
            "to one row per group via group_by + question + agg. "
            "source: use 'main' for the submissions table, or a repeat group path string (e.g. 'household/members'). "
            "join_parent: array of main-table column names to bring into a repeat-group source. Only valid when source != 'main'. "
            "filter: pandas .query() expression applied after the join (e.g. 'NumStudents > 0'). "
            "group_by + question + agg: optional aggregation — group_by is the column to group on, question is the numeric column to aggregate, agg is sum|mean|count|max|min (default sum). "
            "columns: optional array of {name, rename, type} objects to rename or cast columns. type: text|number|date. "
            "name must be snake_case. "
            "CRITICAL: join_parent values, group_by, and question must be exact column names from the provided list. "
            "Return JSON only, no markdown fences."
        )
        user = f"Available columns:\n{labels}{repeat_info}\n\nRequest: {prompt}\n\nRemember: join_parent, group_by, and question must be exact column names from the lists above."
    else:
        system = (
            "You are a data analyst. Given survey columns with their categories and a description, return a single indicator "
            "config as JSON with keys: name, label, question, stat, format, "
            "filter_value (optional), decimals (optional). "
            "Valid stat values: count|count_distinct|sum|mean|median|min|max|percent|most_common. "
            "Use count_distinct when the user wants the number of unique values in a column (e.g. how many communes, how many distinct regions). "
            "Use count when the user wants the total number of non-null rows. "
            "The optional dedup_by field (string) deduplicates rows by a key column before computing any stat — use it when the user wants to measure something per unique entity (e.g. dedup_by: Beneficiary_ID to count each beneficiary once). "
            "Valid format values: number|decimal|percent|text. "
            "CRITICAL: the question field must be an exact column name copied verbatim from the provided numbered list — never invent, translate, or paraphrase column names. "
            "Similarly, dedup_by must be an exact column name from the list if used. "
            "Return JSON only, no markdown fences."
        )
        user = f"Available columns:\n{labels}\n\nRequest: {prompt}\n\nRemember: question (and dedup_by if used) must be exact column names from the numbered list above."
    return system, user

@app.post("/api/ai/suggest")
async def ai_suggest(payload: AISuggestPayload):
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=400, detail="config.yml not found")
    async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as f:
        content = await f.read()
    cfg = yaml.safe_load(content) or {}
    ai_cfg = cfg.get("ai")
    if not ai_cfg:
        raise HTTPException(status_code=400, detail="No ai: section in config.yml. Configure AI first.")
    api_key = ai_cfg.get("api_key", "")
    if str(api_key).startswith("env:"):
        api_key = os.environ.get(str(api_key)[4:].strip(), "")
    if not api_key:
        raise HTTPException(status_code=400, detail="AI api_key not resolved.")
    provider = ai_cfg.get("provider", "openai").lower()
    model = ai_cfg.get("model", "gpt-4o")
    max_tokens = int(ai_cfg.get("max_tokens", 1000))
    base_url = ai_cfg.get("base_url")
    system_prompt, user_prompt = _build_suggest_prompts(payload.kind, payload.prompt, payload.questions)
    try:
        if provider == "anthropic":
            import anthropic
            client = anthropic.Anthropic(api_key=api_key)
            msg = client.messages.create(model=model, max_tokens=max_tokens, system=system_prompt,
                                         messages=[{"role": "user", "content": user_prompt}])
            raw = msg.content[0].text
        else:
            from openai import OpenAI
            kwargs = {"api_key": api_key}
            if base_url:
                kwargs["base_url"] = base_url
            client = OpenAI(**kwargs)
            resp = client.chat.completions.create(
                model=model, max_tokens=max_tokens,
                messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
                response_format={"type": "json_object"},
            )
            raw = resp.choices[0].message.content
        import re as _re
        try:
            result = json.loads(raw)
        except Exception:
            m = _re.search(r'\{.*\}', raw, _re.DOTALL)
            result = json.loads(m.group()) if m else {}
        valid_labels = [
            (q.get("export_label") or q.get("label") or q.get("kobo_key", "")).strip()
            for q in payload.questions if q
        ]
        col_warnings = []
        for col in result.get("questions", []):
            if col.strip() not in valid_labels:
                closest = next((l for l in valid_labels if col.lower() in l.lower() or l.lower() in col.lower()), None)
                msg = f"'{col}' is not a known column name"
                if closest:
                    msg += f' — did you mean "{closest}"?'
                col_warnings.append(msg)
        if col_warnings:
            result["_warnings"] = col_warnings
        return {"ok": True, "result": result}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def _pick_preview_df(df, questions_needed, _questions_cfg=None):
    """If any requested columns are missing from df, scan DATA_DIR for a repeat table file that has them.

    Returns the best-matching DataFrame (most columns found).
    """
    import pandas as pd
    missing = [q for q in questions_needed if q not in df.columns]
    if not missing:
        return df
    best_df = df
    best_hits = sum(1 for q in questions_needed if q in df.columns)
    for alt in sorted(DATA_DIR.glob("*.csv"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            alt_df = pd.read_csv(alt)
            if _questions_cfg:
                try:
                    from src.data.transform import apply_choice_labels
                    alt_df = apply_choice_labels(alt_df, _questions_cfg)
                except Exception:
                    pass
            hits = sum(1 for q in questions_needed if q in alt_df.columns)
            if hits > best_hits:
                best_hits = hits
                best_df = alt_df
        except Exception:
            continue
    return best_df


class ChartPreviewPayload(BaseModel):
    chart: dict
    data_file: Optional[str] = None
    sample_n: Optional[int] = None
    split_filters: Optional[list] = None  # [{"col": "Region", "val": "North"}, ...]

@app.post("/api/charts/preview")
async def preview_chart(payload: ChartPreviewPayload):
    import pandas as pd
    from src.reports.charts import generate_chart
    from src.data.transform import apply_choice_labels, join_repeat_to_main

    chart = payload.chart or {}
    questions = chart.get("questions", [])
    opts = chart.get("options", {}) or {}
    # Scoping keys live at the chart top level in the canonical schema (matches builder.py),
    # but AI-suggested charts sometimes nest them under options:. Accept either location.
    source      = chart.get("source")      or opts.get("source")
    join_parent = chart.get("join_parent") or opts.get("join_parent")
    filter_expr = chart.get("filter")      or opts.get("filter")

    _cfg = {}
    _questions = []
    try:
        async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as _f:
            _cfg = yaml.safe_load(await _f.read()) or {}
        _questions = _cfg.get("questions", [])
    except Exception:
        pass

    main_df: Optional["pd.DataFrame"] = None
    repeat_tables: Dict[str, "pd.DataFrame"] = {}

    if payload.data_file:
        # Caller pinned a specific file — use it as the only table, no repeat resolution.
        if "/" in payload.data_file or ".." in payload.data_file:
            raise HTTPException(status_code=400, detail="Invalid filename")
        data_path = DATA_DIR / payload.data_file
        if not data_path.exists():
            raise HTTPException(status_code=404, detail=f"Data file not found: {payload.data_file}")
        ext = data_path.suffix.lower()
        if   ext == ".csv":  main_df = pd.read_csv(data_path)
        elif ext == ".json": main_df = pd.read_json(data_path)
        elif ext == ".xlsx": main_df = pd.read_excel(data_path)
        else: raise HTTPException(status_code=400, detail="Unsupported file type")
        if _questions:
            try:    main_df = apply_choice_labels(main_df, _questions)
            except Exception: pass
    else:
        # Default path: mirror builder.py's data resolution so previews match production.
        try:
            from src.data.transform import load_processed_data
            main_df, repeat_tables = load_processed_data(_cfg)
        except Exception as e:
            raise HTTPException(
                status_code=400,
                detail=f"No downloaded data found in data/processed/. Run Download first. ({e})",
            )
        # load_processed_data applies choice labels to main_df only; do the same for repeats
        # so categorical labels render correctly in previews.
        if _questions:
            for name, rdf in list(repeat_tables.items()):
                try:    repeat_tables[name] = apply_choice_labels(rdf, _questions)
                except Exception: pass

    # Resolve which DataFrame this chart targets — same priorities as builder._pick_df.
    # Also accept leaf repeat-group names (e.g. "group_foo_repeat") as a stand-in for
    # the canonical underscored-full-path key ("group_parent_group_foo_repeat") since
    # AI-suggested charts use the leaf form.
    resolved_source_key = None  # canonical repeat_tables key, for error messages
    def _resolve_df() -> "pd.DataFrame":
        nonlocal resolved_source_key
        if source == "main" or main_df is None:
            return main_df
        if source:
            rdf = repeat_tables.get(source)
            if rdf is not None:
                resolved_source_key = source
                return rdf
            matches = [k for k in repeat_tables if k.endswith(f"_{source}") or k == source]
            if len(matches) == 1:
                resolved_source_key = matches[0]
                return repeat_tables[matches[0]]
            # Ambiguous or no match → fall through to auto-pick
        best = main_df
        best_hits = sum(1 for q in questions if q in main_df.columns)
        for k, rdf in repeat_tables.items():
            hits = sum(1 for q in questions if q in rdf.columns)
            if hits > best_hits:
                best_hits = hits
                best = rdf
                resolved_source_key = k
        return best

    df = _resolve_df()

    # Join parent-table columns into a repeat table when join_parent is set (builder.py:191).
    if join_parent and source and source != "main" and main_df is not None and df is not main_df:
        try:
            df = join_repeat_to_main(df, main_df, list(join_parent))
        except Exception as e:
            # Non-fatal — fall through, missing columns will be reported below.
            pass

    if payload.sample_n and payload.sample_n > 0:
        df = df.head(payload.sample_n)

    if payload.split_filters:
        for sf in payload.split_filters:
            col = (sf.get("col") or "").strip()
            val = (sf.get("val") or "").strip()
            if not col or not val:
                continue
            if col not in df.columns and main_df is not None and col in main_df.columns:
                # Filter column lives in main but chart uses a repeat/view — join it in.
                try:    df = join_repeat_to_main(df, main_df, [col])
                except Exception: pass
            if col in df.columns:
                df = df[df[col].astype(str).str.strip() == val.strip()]

    if filter_expr:
        try:    df = df.query(filter_expr)
        except Exception: pass  # don't fail preview on a bad filter

    missing = [q for q in questions if q not in df.columns]
    if missing:
        # Actionable error: tell the user which table(s) each missing column lives in.
        col_homes: Dict[str, list] = {}
        for q in missing:
            homes = []
            if main_df is not None and q in main_df.columns:
                homes.append("main")
            for rname, rdf in repeat_tables.items():
                if q in rdf.columns:
                    homes.append(rname)
            col_homes[q] = homes
        lines = []
        target = source or "(auto-picked)"
        lines.append(f"This chart targets source: {target}, but the following column(s) aren't there:")
        for q, homes in col_homes.items():
            if homes:
                lines.append(f"  • {q!r} — found in: {', '.join(homes)}")
            else:
                lines.append(f"  • {q!r} — not found in any table")
        used_sources = {h for hs in col_homes.values() for h in hs}
        used_sources.discard("main")
        if source and used_sources and any(s != source for s in used_sources):
            lines.append("")
            lines.append(
                "This chart's columns span multiple repeat groups, which can't be combined "
                "in a single chart. Split it into per-source charts, or define a view that "
                "joins/aggregates them first and use that view as source:."
            )
        raise HTTPException(status_code=400, detail="\n".join(lines))

    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp)
        cfg = {**chart, "name": chart.get("name") or "preview"}
        try:
            png_path = generate_chart(cfg, df, out_dir=out_dir)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Chart error: {e}")
        if not png_path or not png_path.exists():
            raise HTTPException(status_code=400, detail="Chart generation failed — check column names and chart type")
        img_b64 = base64.b64encode(png_path.read_bytes()).decode()
    return {"image": img_b64}

@app.get("/api/data/column-values")
async def get_column_values(col: str, file: Optional[str] = None):
    import pandas as pd
    if file:
        if "/" in file or ".." in file:
            raise HTTPException(status_code=400, detail="Invalid filename")
        data_path = DATA_DIR / file
        if not data_path.exists():
            raise HTTPException(status_code=404, detail=f"Data file not found: {file}")
        ext = data_path.suffix.lower()
        if ext == ".csv": df = pd.read_csv(data_path)
        elif ext == ".json": df = pd.read_json(data_path)
        elif ext == ".xlsx": df = pd.read_excel(data_path)
        else: raise HTTPException(status_code=400, detail="Unsupported file type")
    else:
        candidates = sorted(DATA_DIR.glob("*_data*.csv"), key=lambda x: x.stat().st_mtime, reverse=True)
        if not candidates:
            candidates = sorted(DATA_DIR.glob("*.csv"), key=lambda x: x.stat().st_mtime, reverse=True)
        if not candidates:
            raise HTTPException(status_code=400, detail="No data file found.")
        df = pd.read_csv(candidates[0])
    try:
        async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as _f:
            _cfg = yaml.safe_load(await _f.read()) or {}
        _questions_cfg = _cfg.get("questions", [])
        if _questions_cfg:
            from src.data.transform import apply_choice_labels
            df = apply_choice_labels(df, _questions_cfg)
    except Exception:
        pass
    if col not in df.columns:
        raise HTTPException(status_code=400, detail=f"Column '{col}' not found")
    values = sorted(df[col].dropna().astype(str).unique().tolist())
    return {"values": values}

class IndicatorPreviewPayload(BaseModel):
    indicator: dict
    data_file: Optional[str] = None
    sample_n: Optional[int] = None

@app.post("/api/indicators/preview")
async def preview_indicator(payload: IndicatorPreviewPayload):
    import pandas as pd
    from src.reports.indicators import compute_indicators
    _questions = []
    if payload.data_file:
        data_path = DATA_DIR / payload.data_file
        if "/" in payload.data_file or ".." in payload.data_file:
            raise HTTPException(status_code=400, detail="Invalid filename")
        if not data_path.exists():
            raise HTTPException(status_code=404, detail=f"Data file not found: {payload.data_file}")
        ext = data_path.suffix.lower()
        if ext == ".csv": df = pd.read_csv(data_path)
        elif ext == ".json": df = pd.read_json(data_path)
        elif ext == ".xlsx": df = pd.read_excel(data_path)
        else: raise HTTPException(status_code=400, detail="Unsupported file type")
    else:
        candidates = sorted(DATA_DIR.glob("*_data*.csv"), key=lambda x: x.stat().st_mtime, reverse=True)
        if not candidates:
            candidates = sorted(DATA_DIR.glob("*.csv"), key=lambda x: x.stat().st_mtime, reverse=True)
        if not candidates:
            raise HTTPException(status_code=400, detail="No data file found. Run Download first.")
        df = pd.read_csv(candidates[0])
    try:
        async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as _f:
            _cfg = yaml.safe_load(await _f.read()) or {}
        _questions = _cfg.get("questions", [])
        if _questions:
            from src.data.transform import apply_choice_labels
            df = apply_choice_labels(df, _questions)
    except Exception:
        pass
    if payload.sample_n and payload.sample_n > 0:
        df = df.head(payload.sample_n)
    ind = payload.indicator
    question = ind.get("question")
    if question:
        df = _pick_preview_df(df, [question], _questions)
    if question and question not in df.columns:
        available = sorted(df.columns.tolist())
        raise HTTPException(status_code=400, detail=f"Column '{question}' not found in data. Available: {available}")
    try:
        result = compute_indicators([ind], df)
        key = f"ind_{ind.get('name', 'preview')}"
        value = result.get(key, "N/A")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Indicator error: {e}")
    return {"value": value, "n_rows": len(df)}

class SummaryPreviewPayload(BaseModel):
    summary: dict
    data_file: Optional[str] = None
    sample_n: Optional[int] = None

@app.post("/api/summaries/preview")
async def preview_summary(payload: SummaryPreviewPayload):
    import pandas as pd
    from src.reports.summaries import _compute_summary
    _questions = []
    if payload.data_file:
        data_path = DATA_DIR / payload.data_file
        if "/" in payload.data_file or ".." in payload.data_file:
            raise HTTPException(status_code=400, detail="Invalid filename")
        if not data_path.exists():
            raise HTTPException(status_code=404, detail=f"Data file not found: {payload.data_file}")
        ext = data_path.suffix.lower()
        if ext == ".csv": df = pd.read_csv(data_path)
        elif ext == ".json": df = pd.read_json(data_path)
        elif ext == ".xlsx": df = pd.read_excel(data_path)
        else: raise HTTPException(status_code=400, detail="Unsupported file type")
    else:
        candidates = sorted(DATA_DIR.glob("*_data*.csv"), key=lambda x: x.stat().st_mtime, reverse=True)
        if not candidates:
            candidates = sorted(DATA_DIR.glob("*.csv"), key=lambda x: x.stat().st_mtime, reverse=True)
        if not candidates:
            raise HTTPException(status_code=400, detail="No data file found. Run Download first.")
        df = pd.read_csv(candidates[0])
    ai_cfg = None
    prompts_cfg = None
    try:
        async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as _f:
            _cfg = yaml.safe_load(await _f.read()) or {}
        _questions = _cfg.get("questions", [])
        if _questions:
            from src.data.transform import apply_choice_labels
            df = apply_choice_labels(df, _questions)
        raw_ai = _cfg.get("ai")
        if raw_ai:
            from src.utils.config import _resolve_env
            ai_cfg = _resolve_env(raw_ai)
        prompts_cfg = _cfg.get("prompts", {})
    except Exception:
        pass
    if payload.sample_n and payload.sample_n > 0:
        df = df.head(payload.sample_n)
    s = payload.summary
    questions = s.get("questions", [])
    df = _pick_preview_df(df, questions, _questions)
    missing = [q for q in questions if q not in df.columns]
    if missing:
        available = sorted(df.columns.tolist())
        raise HTTPException(status_code=400, detail=f"Column(s) {missing} not found. Available: {available}")
    try:
        text = _compute_summary(s, df, ai_cfg, prompts_cfg)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Summary error: {e}")
    return {"text": text, "n_rows": len(df)}

class ViewPreviewPayload(BaseModel):
    view: dict
    data_file: Optional[str] = None
    sample_n: Optional[int] = None

@app.post("/api/views/preview")
async def preview_view(payload: ViewPreviewPayload):
    import pandas as pd
    from src.data.transform import join_repeat_to_main, apply_choice_labels
    _questions_cfg = []
    if payload.data_file:
        data_path = DATA_DIR / payload.data_file
        if "/" in payload.data_file or ".." in payload.data_file:
            raise HTTPException(status_code=400, detail="Invalid filename")
        if not data_path.exists():
            raise HTTPException(status_code=404, detail=f"Data file not found: {payload.data_file}")
        ext = data_path.suffix.lower()
        if ext == ".csv": main_df = pd.read_csv(data_path)
        elif ext == ".json": main_df = pd.read_json(data_path)
        elif ext == ".xlsx": main_df = pd.read_excel(data_path)
        else: raise HTTPException(status_code=400, detail="Unsupported file type")
    else:
        candidates = sorted(DATA_DIR.glob("*_data*.csv"), key=lambda x: x.stat().st_mtime, reverse=True)
        if not candidates:
            candidates = sorted(DATA_DIR.glob("*.csv"), key=lambda x: x.stat().st_mtime, reverse=True)
        if not candidates:
            raise HTTPException(status_code=400, detail="No data file found. Run Download first.")
        main_df = pd.read_csv(candidates[0])
    try:
        async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as _f:
            _cfg = yaml.safe_load(await _f.read()) or {}
        _questions_cfg = _cfg.get("questions", [])
        if _questions_cfg:
            main_df = apply_choice_labels(main_df, _questions_cfg)
    except Exception:
        pass
    if payload.sample_n and payload.sample_n > 0:
        main_df = main_df.head(payload.sample_n)
    v = payload.view
    source = v.get("source", "main")
    # Resolve source: main or a repeat table file
    if source == "main":
        df = main_df.copy()
    else:
        safe_source = source.replace("/", "_")
        repeat_candidates = sorted(
            list(DATA_DIR.glob(f"*_{safe_source}_*.csv")) + list(DATA_DIR.glob(f"*_{safe_source}.csv")),
            key=lambda x: x.stat().st_mtime, reverse=True
        )
        if not repeat_candidates:
            raise HTTPException(status_code=400, detail=f"Repeat table file for source '{source}' not found. Run Download first.")
        df = pd.read_csv(repeat_candidates[0])
        if _questions_cfg:
            try: df = apply_choice_labels(df, _questions_cfg)
            except Exception: pass
        # Join parent columns into repeat df
        join_cols = v.get("join_parent")
        if join_cols:
            df = join_repeat_to_main(df, main_df, join_cols)
    # Apply filter
    filter_expr = v.get("filter")
    if filter_expr:
        try: df = df.query(filter_expr)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Filter error: {e}")
    # Apply group aggregation
    group_by = v.get("group_by")
    question = v.get("question")
    if group_by and question:
        agg_fn = v.get("agg", "sum")
        if group_by not in df.columns:
            raise HTTPException(status_code=400, detail=f"group_by column '{group_by}' not found")
        if question not in df.columns:
            raise HTTPException(status_code=400, detail=f"question column '{question}' not found")
        numeric = pd.to_numeric(df[question], errors="coerce")
        agg_result = numeric.groupby(df[group_by]).agg(agg_fn).reset_index()
        agg_result.columns = [group_by, question]
        df = agg_result
    # Apply column renames and type overrides
    # Drop unwanted columns FIRST (references original column names — matches
    # what users select in the preview before any renames are applied).
    drop_cols = v.get("drop_columns", []) or []
    if drop_cols:
        df = df.drop(columns=[c for c in drop_cols if c in df.columns], errors="ignore")
    # Apply renames and type overrides AFTER drops.
    col_specs = v.get("columns", [])
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
                    df[original] = pd.to_datetime(df[original], errors="coerce").astype(str)
                elif col_type in ("text", "string"):
                    df[original] = df[original].fillna("").astype(str)
            except Exception: pass
        if renamed and renamed != original:
            rename_map[original] = renamed
    if rename_map:
        df = df.rename(columns=rename_map)
    # Auto-detect column types for UI
    col_info = []
    for col in df.columns:
        numeric = pd.to_numeric(df[col], errors="coerce")
        if numeric.notna().sum() > len(df) * 0.5:
            detected = "number"
        else:
            sample = df[col].dropna().astype(str).head(5)
            try:
                import re as _re
                if sample.apply(lambda x: bool(_re.match(r'\d{4}-\d{2}-\d{2}', x))).any():
                    detected = "date"
                else:
                    detected = "text"
            except Exception:
                detected = "text"
        col_info.append({"name": col, "detected_type": detected})
    n_rows = len(df)
    preview_rows = df.head(50)
    # Serialize safely (NaN → None)
    import math
    def _safe(v):
        if v is None: return None
        if isinstance(v, float) and math.isnan(v): return None
        return v
    rows = [{col: _safe(row[col]) for col in preview_rows.columns} for _, row in preview_rows.iterrows()]
    return {"columns": col_info, "data": rows, "n_rows": n_rows}

@app.post("/api/run/{command}")
async def run_command(command: str, payload: RunPayload):
    if command not in ALLOWED_COMMANDS:
        raise HTTPException(status_code=400, detail=f"Unknown command '{command}'")
    cmd = [sys.executable, "src/data/make.py", command]
    if payload.sample and "--sample" in ALLOWED_COMMANDS[command]:
        cmd += ["--sample", str(payload.sample)]
    if payload.split_by and "--split-by" in ALLOWED_COMMANDS[command]:
        cmd += ["--split-by", payload.split_by]
    if payload.description and "--description" in ALLOWED_COMMANDS[command]:
        cmd += ["--description", payload.description]
    if payload.pages and "--pages" in ALLOWED_COMMANDS[command]:
        cmd += ["--pages", str(payload.pages)]
    if payload.language and "--language" in ALLOWED_COMMANDS[command]:
        cmd += ["--language", payload.language]
    if payload.rediscover and "--rediscover" in ALLOWED_COMMANDS[command]:
        cmd += ["--rediscover"]
    if payload.context and "--context" in ALLOWED_COMMANDS[command]:
        cmd += ["--context", payload.context]
    if payload.summary_prompt and "--summary-prompt" in ALLOWED_COMMANDS[command]:
        cmd += ["--summary-prompt", payload.summary_prompt]
    if payload.session and "--session" in ALLOWED_COMMANDS[command]:
        cmd += ["--session", payload.session]
    if payload.user_request and "--user-request" in ALLOWED_COMMANDS[command]:
        cmd += ["--user-request", payload.user_request]
    return StreamingResponse(
        _stream(command, cmd),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

async def _stream(command: str, cmd: list) -> AsyncGenerator[str, None]:
    global _last_status, _proc
    _last_status = {"command": command, "status": "running", "finished_at": None}
    yield _sse("status", {"status": "running", "command": command})
    yield _sse("log", {"line": f"$ {' '.join(cmd)}", "level": "cmd"})
    env = {**os.environ, "PYTHONPATH": str(BASE_DIR), "PYTHONUNBUFFERED": "1"}
    try:
        _proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT, cwd=str(BASE_DIR), env=env,
        )
        async for raw in _proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip()
            yield _sse("log", {"line": line, "level": _classify(line)})
        await _proc.wait()
        status = "success" if _proc.returncode == 0 else "error"
    except Exception as e:
        yield _sse("log", {"line": f"Error: {e}", "level": "error"})
        status = "error"
    finally:
        _proc = None
    _last_status = {"command": command, "status": status, "finished_at": datetime.now().isoformat()}
    yield _sse("status", {**_last_status})
    yield _sse("done", {})

def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"

def _classify(line: str) -> str:
    ll = line.lower()
    if any(w in ll for w in ("error","exception","traceback")): return "error"
    if any(w in ll for w in ("warning","warn")): return "warning"
    if line.startswith("$"): return "cmd"
    if any(w in ll for w in ("→","saved","exported","generated","written")): return "success"
    return "info"

@app.get("/api/status")
async def get_status():
    return _last_status

@app.post("/api/stop")
async def stop_command():
    global _proc
    if _proc is None:
        return {"ok": False, "detail": "no running process"}
    try:
        _proc.terminate()
        try:
            await asyncio.wait_for(_proc.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            _proc.kill()
    except ProcessLookupError:
        pass
    return {"ok": True}

@app.get("/api/state")
async def get_state():
    has_questions = False
    if CONFIG_PATH.exists():
        try:
            import aiofiles as _af
            async with _af.open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(await f.read()) or {}
            has_questions = bool(cfg.get("questions"))
        except Exception:
            pass
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    has_data = any(
        f.suffix.lower() in {".csv", ".json", ".xlsx"}
        for f in DATA_DIR.iterdir() if f.is_file()
    ) if DATA_DIR.exists() else False
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    has_templates = any(TEMPLATES_DIR.glob("*.docx"))
    has_ai = False
    if CONFIG_PATH.exists():
        try:
            async with _af.open(CONFIG_PATH, "r", encoding="utf-8") as f:
                _cfg2 = yaml.safe_load(await f.read()) or {}
            ai_sec = _cfg2.get("ai", {})
            api_key = str(ai_sec.get("api_key", ""))
            if api_key and not api_key.startswith("env:"):
                has_ai = True
            elif api_key.startswith("env:"):
                has_ai = bool(os.environ.get(api_key[4:].strip()))
        except Exception:
            pass
    return {"has_questions": has_questions, "has_data": has_data, "has_templates": has_templates, "has_ai": has_ai}

@app.get("/api/reports")
async def list_reports():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for f in sorted(REPORTS_DIR.glob("*.docx"), key=lambda x: x.stat().st_mtime, reverse=True):
        s = f.stat()
        files.append({"name": f.name, "size_kb": round(s.st_size/1024,1),
                       "modified": datetime.fromtimestamp(s.st_mtime).strftime("%Y-%m-%d %H:%M")})
    return {"files": files}

@app.get("/api/reports/download/{filename}")
async def download_report(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = REPORTS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=path, filename=filename,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")

@app.delete("/api/reports/{filename}")
async def delete_report(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = REPORTS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    path.unlink()
    return {"ok": True}

@app.get("/api/reports/download-zip")
async def download_reports_zip():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    docx_files = list(REPORTS_DIR.glob("*.docx"))
    if not docx_files:
        raise HTTPException(status_code=404, detail="No reports to zip")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in docx_files:
            zf.write(f, f.name)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=reports.zip"},
    )

# ── Data files ──────────────────────────────────────────────
@app.get("/api/data")
async def list_data_files():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for f in sorted(DATA_DIR.glob("*"), key=lambda x: x.stat().st_mtime, reverse=True):
        if f.suffix.lower() in {".csv", ".json", ".xlsx"} and f.is_file():
            s = f.stat()
            files.append({"name": f.name, "size_kb": round(s.st_size/1024,1),
                           "modified": datetime.fromtimestamp(s.st_mtime).strftime("%Y-%m-%d %H:%M")})
    return {"files": files}

@app.get("/api/data/sessions")
async def list_data_sessions():
    from src.data.transform import list_sessions
    from src.utils.config import load_config
    if not CONFIG_PATH.exists():
        return {"sessions": []}
    cfg = load_config(CONFIG_PATH)
    sessions = list_sessions(cfg)
    return {"sessions": sessions}

@app.get("/api/data/sessions/{session_id}/download")
async def download_session_zip(session_id: str):
    from src.data.transform import list_sessions
    from src.utils.config import load_config
    if "/" in session_id or ".." in session_id:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    cfg = load_config(CONFIG_PATH)
    sessions = list_sessions(cfg)
    session = next((s for s in sessions if s["session_id"] == session_id), None)
    if not session or not session["files"]:
        raise HTTPException(status_code=404, detail="Session not found")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in session["files"]:
            fpath = DATA_DIR / fname
            if fpath.exists():
                zf.write(fpath, fname)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=session_{session_id}.zip"},
    )

@app.delete("/api/data/sessions/{session_id}")
async def delete_session_files(session_id: str):
    from src.data.transform import list_sessions
    from src.utils.config import load_config
    if "/" in session_id or ".." in session_id:
        raise HTTPException(status_code=400, detail="Invalid session ID")
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=404, detail="Session not found")
    cfg = load_config(CONFIG_PATH)
    sessions = list_sessions(cfg)
    session = next((s for s in sessions if s["session_id"] == session_id), None)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    deleted = []
    for fname in session["files"]:
        fpath = DATA_DIR / fname
        if fpath.exists():
            fpath.unlink()
            deleted.append(fname)
    return {"ok": True, "deleted": deleted}

@app.get("/api/debug/raw-columns")
async def debug_raw_columns():
    """Fetch 1 submission and show raw API columns vs config kobo_keys."""
    try:
        import pandas as pd
        from src.utils.config import load_config
        from src.data.extract import get_client
        cfg = load_config(CONFIG_PATH)
        client = get_client(cfg)
        raw = client.get_submissions(sample_size=1)
        if not raw:
            return {"error": "No submissions returned by API"}
        flat = pd.json_normalize(raw)
        raw_cols = sorted(flat.columns.tolist())
        questions = cfg.get("questions", [])
        mapping = []
        for q in questions:
            key = q.get("kobo_key", "")
            flat_key = key.replace("/", ".")
            field_name = key.split("/")[-1]
            candidates = [c for c in flat.columns if c == field_name or c.endswith(f"/{field_name}") or c.endswith(f".{field_name}")]
            if flat_key in flat.columns or key in flat.columns:
                status = "ok"
            elif len(candidates) == 1:
                status = "field_match"
            elif len(candidates) > 1:
                status = "ambiguous"
            else:
                status = "MISSING"
            mapping.append({
                "export_label": q.get("export_label") or q.get("label", ""),
                "kobo_key": key,
                "repeat_group": q.get("repeat_group"),
                "status": status,
                "field_match": candidates[0] if len(candidates) == 1 else (candidates if len(candidates) > 1 else None),
            })
        return {"raw_columns": raw_cols, "mapping": mapping}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/data/download/{filename}")
async def download_data_file(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = DATA_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    ext = path.suffix.lower()
    mime = {"csv":"text/csv","json":"application/json","xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}.get(ext[1:],"application/octet-stream")
    return FileResponse(path=path, filename=filename, media_type=mime)

@app.delete("/api/data/{filename}")
async def delete_data_file(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = DATA_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    path.unlink()
    return {"ok": True}

# ── Templates ──────────────────────────────────────────────
@app.get("/api/templates")
async def list_templates():
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for f in sorted(TEMPLATES_DIR.glob("*.docx"), key=lambda x: x.stat().st_mtime, reverse=True):
        s = f.stat()
        files.append({"name": f.name, "size_kb": round(s.st_size/1024,1),
                       "modified": datetime.fromtimestamp(s.st_mtime).strftime("%Y-%m-%d %H:%M")})
    return {"files": files}

@app.get("/api/templates/download/{filename}")
async def download_template(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = TEMPLATES_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=path, filename=filename,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")

@app.post("/api/templates/upload")
async def upload_template(file: UploadFile):
    if not file.filename or not file.filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Only .docx files are allowed")
    safe_name = Path(file.filename).name
    if "/" in safe_name or ".." in safe_name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    dest = TEMPLATES_DIR / safe_name
    content = await file.read()
    async with aiofiles.open(dest, "wb") as f:
        await f.write(content)
    return {"ok": True, "name": safe_name, "size_kb": round(len(content)/1024,1)}

@app.delete("/api/templates/{filename}")
async def delete_template(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = TEMPLATES_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    path.unlink()
    return {"ok": True}

@app.get("/api/templates/active")
async def get_active_template():
    if not CONFIG_PATH.exists():
        return {"active": None}
    async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as f:
        content = await f.read()
    cfg = yaml.safe_load(content) or {}
    tpl = cfg.get("report", {}).get("template", "")
    return {"active": Path(tpl).name if tpl else None}

@app.post("/api/templates/set-active/{filename}")
async def set_active_template(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = TEMPLATES_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Template file not found")
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=400, detail="config.yml not found")
    async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as f:
        content = await f.read()
    cfg = yaml.safe_load(content) or {}
    if "report" not in cfg:
        cfg["report"] = {}
    cfg["report"]["template"] = f"templates/{filename}"
    async with aiofiles.open(CONFIG_PATH, "w", encoding="utf-8") as f:
        await f.write(yaml.dump(cfg, allow_unicode=True, default_flow_style=False, sort_keys=False))
    return {"ok": True, "template": filename}

@app.get("/api/templates/preview/{filename}")
async def preview_template(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = TEMPLATES_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        from docxtpl import DocxTemplate
        tpl = DocxTemplate(str(path))
        placeholders = sorted(tpl.get_undeclared_template_variables())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse template: {e}")
    charts = [p for p in placeholders if p.startswith("chart_")]
    variables = [p for p in placeholders if not p.startswith("chart_")]
    return {"filename": filename, "variables": variables, "charts": charts}
