# syntax=docker/dockerfile:1
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

RUN printf 'fastapi>=0.111.0\nuvicorn[standard]>=0.29.0\npython-multipart>=0.0.9\naiofiles>=23.2.1\n' \
    > requirements.web.txt

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements.web.txt

COPY src/ ./src/

RUN mkdir -p web/static && touch web/__init__.py

COPY <<'PYEOF' web/main.py
import asyncio, base64, io, json, os, sys, tempfile, zipfile
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, Dict, Optional

import aiofiles, yaml
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR      = Path("/app")
CONFIG_PATH   = BASE_DIR / "config.yml"
REPORTS_DIR   = BASE_DIR / "reports"
TEMPLATES_DIR = BASE_DIR / "templates"
DATA_DIR      = BASE_DIR / "data" / "processed"
STATIC_DIR    = Path(__file__).parent / "static"

app = FastAPI(title="databridge-cli", docs_url=None, redoc_url=None)
_last_status: Dict = {"command": None, "status": "idle", "finished_at": None}
_proc: Optional[asyncio.subprocess.Process] = None

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")

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
    "suggest-charts":       [],
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

@app.post("/api/charts/preview")
async def preview_chart(payload: ChartPreviewPayload):
    import pandas as pd
    from src.reports.charts import generate_chart
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
    questions = payload.chart.get("questions", [])
    df = _pick_preview_df(df, questions, _questions)
    missing = [q for q in questions if q not in df.columns]
    if missing:
        available = sorted(df.columns.tolist())
        raise HTTPException(status_code=400, detail=f"Column(s) not found in data: {missing}. Available columns: {available}")
    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp)
        cfg = {**payload.chart, "name": payload.chart.get("name") or "preview"}
        try:
            png_path = generate_chart(cfg, df, out_dir=out_dir)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Chart error: {e}")
        if not png_path or not png_path.exists():
            raise HTTPException(status_code=400, detail="Chart generation failed — check column names and chart type")
        img_b64 = base64.b64encode(png_path.read_bytes()).decode()
    return {"image": img_b64}

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
        text = _compute_summary(s, df, ai_cfg)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Summary error: {e}")
    return {"text": text, "n_rows": len(df)}

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
    cfg = load_config(CONFIG_PATH)
    sessions = list_sessions(cfg)
    return {"sessions": sessions}

@app.get("/api/data/sessions/{session_id}/download")
async def download_session_zip(session_id: str):
    from src.data.transform import list_sessions
    from src.utils.config import load_config
    if "/" in session_id or ".." in session_id:
        raise HTTPException(status_code=400, detail="Invalid session ID")
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
PYEOF

COPY <<'HTMLEOF' web/static/index.html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>databridge-cli</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/material-darker.min.css">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#f8f7f4;--surface:#fff;--border:#e2e0d8;--text:#1a1a18;--muted:#6b6a64;--teal:#1d9e75;--teal-dark:#0f6e56;--red:#d85a30;--radius:8px;--shadow:0 1px 3px rgba(0,0,0,.08)}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.6}
.layout{display:grid;grid-template-rows:52px 1fr;height:100vh}
header{background:var(--teal-dark);color:#fff;display:flex;align-items:center;padding:0 20px;gap:16px}
header h1{font-size:16px;font-weight:600}
.badge{background:rgba(255,255,255,.15);border-radius:4px;padding:2px 8px;font-size:11px}
.status-dot{width:8px;height:8px;border-radius:50%;background:#aaa;margin-left:auto;transition:background .3s}
.status-dot.running{background:#fbbf24;animation:pulse 1s infinite}
.status-dot.success{background:#4ade80}.status-dot.error{background:#f87171}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.tabs-bar{background:var(--surface);border-bottom:1px solid var(--border);display:flex;padding:0 20px}
.tab{padding:12px 18px;cursor:pointer;border-bottom:2px solid transparent;font-size:13px;color:var(--muted);transition:all .15s;user-select:none}
.tab:hover{color:var(--text)}.tab.active{color:var(--teal-dark);border-bottom-color:var(--teal);font-weight:500}
.tab-content{display:none;overflow:hidden}.tab-content.active{display:flex;flex-direction:column;flex:1;min-height:0}
.dashboard{padding:20px;display:grid;grid-template-columns:2fr 3fr;gap:16px;flex:1;min-height:0;overflow:hidden}
.dashboard-right{display:flex;flex-direction:column;gap:16px;min-height:0;overflow:hidden}
.dashboard-terminal{background:#1a1a18;border-radius:var(--radius);display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--shadow);flex-shrink:0}
.dashboard-terminal-toggle{padding:8px 14px;background:#111;color:#888;font-size:11px;font-family:monospace;border-bottom:1px solid #333;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none}
.dashboard-terminal-toggle:hover{color:#bbb}
.dashboard-terminal-toggle .toggle-icon{font-size:10px;transition:transform .2s}
.dashboard-terminal.open .toggle-icon{transform:rotate(90deg)}
.dashboard-terminal-body{display:none;flex:1;flex-direction:column;min-height:0}
.dashboard-terminal.open .dashboard-terminal-body{display:flex}
.dashboard-terminal.open{flex-shrink:1;min-height:0}
.dashboard-terminal iframe{flex:1;border:none;min-height:0}
.commands-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-content:start}
.cmd-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:var(--shadow)}
.cmd-card h3{font-size:13px;font-weight:600;margin-bottom:4px}
.cmd-card p{font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5}
.sample-row{display:flex;gap:8px;align-items:center;margin-bottom:10px}
.sample-row label{font-size:11px;color:var(--muted);white-space:nowrap}
.sample-row input{width:70px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:var(--radius);font-size:13px;font-weight:500;cursor:pointer;border:none;transition:all .15s}
.btn-primary{background:var(--teal);color:#fff}.btn-primary:hover{background:var(--teal-dark)}
.btn-sm{padding:5px 10px;font-size:12px}
.btn-danger{background:#fee2e2;color:var(--red)}.btn-danger:hover{background:#fecaca}
.btn-ghost{background:transparent;color:var(--muted);border:1px solid var(--border)}.btn-ghost:hover{background:var(--bg)}
.btn-row{display:flex;gap:8px;align-items:center}
.cmd-card.disabled{opacity:.4;pointer-events:none;border-color:var(--border)}
.cmd-card .btn-stop{display:none}
.cmd-card.running .btn-run{display:none}
.cmd-card.running .btn-stop{display:inline-flex}
.log-panel{background:#1a1a18;border-radius:var(--radius);display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--shadow);flex:1;min-height:0}
.log-header{padding:10px 14px;background:#111;display:flex;align-items:center;gap:8px;border-bottom:1px solid #333}
.log-header span{font-size:12px;color:#888;flex:1}
.log-body{flex:1;overflow-y:auto;padding:12px 14px;font-family:'Menlo','Monaco',monospace;font-size:12px;line-height:1.7}
.log-body::-webkit-scrollbar{width:6px}.log-body::-webkit-scrollbar-thumb{background:#444;border-radius:3px}
.log-line{white-space:pre-wrap;word-break:break-all}
.log-line.cmd{color:#7dd3fc}.log-line.info{color:#d4d4d0}.log-line.success{color:#4ade80}
.log-line.warning{color:#fbbf24}.log-line.error{color:#f87171}
.log-empty{color:#555;font-style:italic}
.config-pane{padding:20px;display:flex;flex-direction:column;gap:12px;height:100%;overflow:hidden}
.config-toolbar{display:flex;align-items:center;gap:10px;flex-shrink:0}
.config-toolbar .info{font-size:12px;color:var(--muted);flex:1}
.editor-wrap{flex:1;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.CodeMirror{height:100%!important;font-size:13px!important;font-family:'Menlo','Monaco',monospace!important}
.config-msg{font-size:12px;padding:6px 10px;border-radius:4px}
.config-msg.ok{background:#d1fae5;color:#065f46}.config-msg.err{background:#fee2e2;color:#991b1b}
.config-view-toggle{display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;}
.view-btn{padding:4px 16px;font-size:12px;font-weight:500;border:none;background:transparent;cursor:pointer;color:var(--muted);}
.view-btn.active{background:var(--teal);color:#fff;}
.form-section{border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:14px;}
.form-section-title{font-size:13px;font-weight:600;margin-bottom:12px;color:var(--text);display:flex;align-items:center;gap:10px;}
.form-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
.form-row label{min-width:90px;font-size:12px;color:var(--muted);font-weight:500;}
.form-row input,.form-row select{flex:1;padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;}
.filter-row{display:flex;gap:6px;align-items:center;margin-bottom:6px;}
.filter-row input{flex:1;padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:monospace;}
.filter-row button{padding:4px 8px;border:none;background:#fee2e2;color:#991b1b;border-radius:4px;cursor:pointer;font-size:12px;}
.chart-card{border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;display:flex;align-items:center;gap:10px;margin-bottom:8px;background:var(--bg);}
.chart-card-info{flex:1;font-size:13px;}
.chart-card-name{font-weight:600;color:var(--teal-dark);}
.chart-card-meta{font-size:11px;color:var(--muted);margin-top:2px;}
.type-badge{display:inline-block;background:#e0f2fe;color:#0369a1;font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;margin-right:4px;}
.ind-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;}
.ind-row:last-child{border-bottom:none;}
.ind-name{font-weight:600;color:var(--teal-dark);min-width:140px;font-size:12px;}
.ind-meta{flex:1;font-size:11px;color:var(--muted);}
.reports-pane{padding:20px;display:flex;flex-direction:column;gap:14px}
.reports-pane h2{font-size:15px;font-weight:600}
.file-table{width:100%;border-collapse:collapse}
.file-table th{text-align:left;font-size:12px;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--border);font-weight:500}
.file-table td{padding:10px;border-bottom:1px solid var(--border);font-size:13px;vertical-align:middle}
.file-table tr:last-child td{border-bottom:none}.file-table tr:hover td{background:var(--bg)}
.file-name{font-weight:500;color:var(--teal-dark)}
.empty-state{text-align:center;color:var(--muted);padding:40px;font-size:13px}
.badge-active{display:inline-block;background:#d1fae5;color:#065f46;font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;margin-left:8px;vertical-align:middle}
.badge-cat{display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:500}
.badge-cat-categorical{background:#dbeafe;color:#1e40af}.badge-cat-quantitative{background:#dcfce7;color:#166534}
.badge-cat-qualitative{background:#fef9c3;color:#854d0e}.badge-cat-geographical{background:#f3e8ff;color:#6b21a8}
.badge-cat-date{background:#ffedd5;color:#9a3412}.badge-cat-undefined{background:#f1f5f9;color:#64748b}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:1000}
.modal{background:var(--surface);border-radius:var(--radius);box-shadow:0 8px 30px rgba(0,0,0,.2);width:480px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column}
.modal-header{display:flex;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border)}
.modal-header h3{font-size:14px;flex:1}
.modal-header button{background:none;border:none;font-size:18px;cursor:pointer;color:var(--muted);padding:0 4px}
.modal-body{padding:18px;overflow-y:auto;font-size:13px;line-height:1.8}
.modal-body h4{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 6px}
.modal-body h4:first-child{margin-top:0}
.placeholder-list{list-style:none;padding:0}
.placeholder-list li{font-family:'Menlo','Monaco',monospace;font-size:12px;padding:3px 8px;background:var(--bg);border-radius:4px;margin-bottom:4px;color:var(--teal-dark)}
.var-tag{font-family:'Menlo','Monaco',monospace;font-size:10px;padding:2px 6px;border-radius:3px;white-space:nowrap}
.var-tag.used{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}
.var-tag.unused{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
.toast{position:fixed;bottom:20px;right:20px;padding:10px 16px;border-radius:var(--radius);font-size:13px;font-weight:500;z-index:999;animation:slide-in .2s ease;box-shadow:0 4px 12px rgba(0,0,0,.15)}
.toast.ok{background:#d1fae5;color:#065f46}.toast.err{background:#fee2e2;color:#991b1b}
@keyframes slide-in{from{transform:translateY(10px);opacity:0}}
</style>
</head>
<body>
<div class="layout">
  <header>
    <h1>databridge-cli</h1><span class="badge">v1.0</span>
    <span id="status-label" style="font-size:12px;color:rgba(255,255,255,.7);margin-left:8px;"></span>
    <div class="status-dot" id="status-dot"></div>
  </header>
  <div style="display:flex;flex-direction:column;overflow:hidden;flex:1;min-height:0;">
    <div class="tabs-bar">
      <div class="tab active" data-tab="dashboard">Dashboard</div>
      <div class="tab" data-tab="config">Config</div>
      <div class="tab" data-tab="reports">Reports</div>
      <div class="tab" data-tab="templates">Templates</div>
    </div>
    <div class="tab-content active" id="tab-dashboard" style="overflow:hidden;">
      <div class="dashboard">
        <div class="commands-grid">
          <div class="cmd-card" data-cmd="fetch-questions">
            <h3>1 · Fetch questions</h3>
            <p>Download form schema from Kobo/Ona and write questions into config.yml, auto-categorized.</p>
            <div class="btn-row">
              <button class="btn btn-primary btn-run" onclick="runCmd('fetch-questions')">▶ Run</button>
              <button class="btn btn-danger btn-stop" onclick="stopCmd()">■ Stop</button>
            </div>
          </div>
          <div class="cmd-card" data-cmd="download">
            <h3>2 · Download data</h3>
            <p>Extract submissions, apply filters, export to configured destination.</p>
            <div class="sample-row">
              <label>Sample</label>
              <input type="number" id="sample-download" placeholder="all" min="1">
              <span style="font-size:11px;color:var(--muted)">rows</span>
            </div>
            <div class="btn-row">
              <button class="btn btn-primary btn-run" onclick="runCmd('download',{sample:getSample('sample-download')})">▶ Run</button>
              <button class="btn btn-danger btn-stop" onclick="stopCmd()">■ Stop</button>
            </div>
          </div>
          <div class="cmd-card" data-cmd="generate-template">
            <h3>3 · Generate template</h3>
            <p>Build a starter Word template from charts in config.yml. Overwrites existing.</p>
            <div class="btn-row">
              <button class="btn btn-primary btn-run" onclick="openGenTplModal()">▶ Run</button>
              <button class="btn btn-danger btn-stop" onclick="stopCmd()">■ Stop</button>
            </div>
          </div>
          <div class="cmd-card" data-cmd="build-report">
            <h3>4 · Build report</h3>
            <p>Generate Word report with embedded charts from downloaded data.</p>
            <div class="sample-row">
              <label>Sample</label>
              <input type="number" id="sample-report" placeholder="all" min="1">
              <span style="font-size:11px;color:var(--muted)">rows</span>
            </div>
            <div class="sample-row" style="margin-top:6px;">
              <label>Split by</label>
              <select id="split-by-report" style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:var(--radius);font-size:12px;background:white;">
                <option value="">— no split —</option>
              </select>
            </div>
            <div class="sample-row" style="margin-top:6px;">
              <label>Session</label>
              <select id="session-report" style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:var(--radius);font-size:12px;background:white;">
                <option value="">— latest —</option>
              </select>
            </div>
            <div class="btn-row">
              <button class="btn btn-primary btn-run" onclick="runCmd('build-report',{sample:getSample('sample-report'),split_by:getSplitBy(),session:getSession()})">▶ Run</button>
              <button class="btn btn-danger btn-stop" onclick="stopCmd()">■ Stop</button>
            </div>
          </div>
          <div class="cmd-card cmd-accordion collapsed" data-cmd="suggest-charts" style="grid-column:1/-1">
            <h3 class="accordion-toggle" onclick="toggleAccordion(this)" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;margin-bottom:0;user-select:none;">
              <span>3b · AI suggest charts</span>
              <span class="accordion-arrow" style="font-size:10px;color:var(--muted);transition:transform .2s;">▶</span>
            </h3>
            <div class="accordion-body" style="display:none;margin-top:10px;">
              <p>Ask AI to propose a charts: config block from your questions. Output printed to logs — paste into config.</p>
              <div class="btn-row">
                <button class="btn btn-primary btn-run" onclick="runCmd('suggest-charts')">▶ Run</button>
                <button class="btn btn-danger btn-stop" onclick="stopCmd()">■ Stop</button>
              </div>
            </div>
          </div>
        </div>
        <div class="dashboard-right">
          <div class="log-panel">
            <div class="log-header">
              <span id="log-title">Logs</span>
              <button class="btn btn-ghost btn-sm" onclick="clearLog()">Clear</button>
            </div>
            <div class="log-body" id="log-body"><span class="log-empty">No commands run yet.</span></div>
          </div>
          <div class="dashboard-terminal" id="dashboard-terminal">
            <div class="dashboard-terminal-toggle" onclick="toggleDashboardTerminal()">
              <span>Terminal · /app</span>
              <span class="toggle-icon">▶</span>
            </div>
            <div class="dashboard-terminal-body">
              <iframe id="dashboard-terminal-frame" src="" allowfullscreen></iframe>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="tab-content" id="tab-config">
      <div class="config-pane">
        <div class="config-toolbar">
          <div class="config-view-toggle">
            <button class="view-btn active" id="btn-view-form" onclick="switchView('form')">Form</button>
            <button class="view-btn" id="btn-view-yaml" onclick="switchView('yaml')">YAML</button>
          </div>
          <span id="config-msg" class="config-msg" style="display:none;"></span>
          <span id="yaml-toolbar" style="display:none;gap:8px;margin-left:auto;">
            <button class="btn btn-ghost btn-sm" onclick="loadConfig()">↺ Reload</button>
            <button class="btn btn-primary btn-sm" onclick="saveConfig()">Save YAML</button>
          </span>
        </div>
        <div id="config-form-view" style="display:flex;flex-direction:column;flex:1;overflow-y:auto;padding:4px 0 20px;">
          <div class="form-section">
            <div class="form-section-title">API &amp; Form</div>
            <div class="form-row"><label>Platform</label><select id="cfg-platform"><option value="kobo">Kobo Toolbox</option><option value="ona">Ona</option></select></div>
            <div class="form-row"><label>API URL</label><input id="cfg-url" type="text" placeholder="https://kf.kobotoolbox.org/api/v2"></div>
            <div class="form-row"><label>Token</label><input id="cfg-token" type="text" placeholder="env:KOBO_TOKEN"></div>
            <div class="form-row"><label>Form UID</label><input id="cfg-uid" type="text" placeholder="aAbBcCdDeEfFgGhH"></div>
            <div class="form-row"><label>Alias</label><input id="cfg-alias" type="text" placeholder="monitoring_survey"></div>
            <div style="margin-top:8px;"><button class="btn btn-primary btn-sm" onclick="saveFormSection('api')">Save</button></div>
          </div>
          <div class="form-section">
            <div class="form-section-title">
              AI Narrative
              <span style="font-weight:normal;font-size:11px;color:var(--muted);">Fills &#123;&#123; summary_text &#125;&#125;, &#123;&#123; observations &#125;&#125;, &#123;&#123; recommendations &#125;&#125; in Word reports</span>
            </div>
            <div class="form-row"><label>Provider</label><select id="cfg-ai-provider" onchange="updateAiProviderUI()"><option value="openai">OpenAI-compatible</option><option value="anthropic">Anthropic</option></select></div>
            <div class="form-row"><label>Model</label><input id="cfg-ai-model" type="text" placeholder="gpt-4o"></div>
            <div class="form-row"><label>API Key</label><input id="cfg-ai-key" type="text" placeholder="env:OPENAI_API_KEY"></div>
            <div class="form-row" id="ai-base-url-row"><label>Base URL</label><input id="cfg-ai-baseurl" type="text" placeholder="optional — Azure, Groq, Mistral, Ollama…"></div>
            <div class="form-row"><label>Language</label><input id="cfg-ai-language" type="text" placeholder="English"></div>
            <div class="form-row"><label>Max tokens</label><input id="cfg-ai-maxtokens" type="number" placeholder="1500" min="100" max="8000"></div>
            <div style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <button class="btn btn-primary btn-sm" onclick="saveFormSection('ai')">Save</button>
              <button class="btn btn-ghost btn-sm" id="btn-ai-test" onclick="testAiConnection()">▶ Test connection</button>
              <span id="ai-test-result" style="font-size:12px;"></span>
            </div>
          </div>
          <div class="form-section">
            <div class="form-section-title">
              Questions
              <span style="font-weight:normal;font-size:11px;color:var(--muted);">Edit Export label to rename columns used in charts and templates.</span>
              <span style="margin-left:auto;display:flex;gap:8px;align-items:center;">
                <span id="q-sel-count" style="display:none;font-size:11px;font-weight:normal;color:var(--muted);"></span>
                <button id="btn-keep-sel" class="btn btn-ghost btn-sm" style="display:none;" onclick="keepSelected()">Keep selected</button>
                <button id="btn-del-sel" class="btn btn-danger btn-sm" style="display:none;" onclick="deleteSelected()">Delete selected</button>
                <button class="btn btn-ghost btn-sm" onclick="loadQuestions()">↺ Refresh</button>
                <button class="btn btn-primary btn-sm" onclick="saveQuestions()">Save changes</button>
              </span>
            </div>
            <div id="questions-msg" style="display:none;margin:4px 0;font-size:12px;"></div>
            <div id="questions-container"><p class="empty-state">No questions yet. Run Fetch questions first.</p></div>
          </div>
          <div class="form-section">
            <div class="form-section-title">
              Filters
              <span style="font-weight:normal;font-size:11px;color:var(--muted);">pandas .query() syntax — applied before export and chart generation</span>
              <button class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="addFilter()">+ Add filter</button>
            </div>
            <div id="filters-container"></div>
            <div style="margin-top:8px;"><button class="btn btn-primary btn-sm" onclick="saveFormSection('filters')">Save</button></div>
          </div>
          <div class="form-section">
            <div class="form-section-title">Export</div>
            <div class="form-row"><label>Format</label><select id="cfg-export-format" onchange="toggleDbFields()"><option value="csv">CSV</option><option value="json">JSON</option><option value="xlsx">XLSX</option><option value="mysql">MySQL</option><option value="postgres">PostgreSQL</option><option value="supabase">Supabase</option></select></div>
            <div class="form-row"><label>Output dir</label><input id="cfg-export-dir" type="text" placeholder="data/processed"></div>
            <div id="db-fields" style="display:none;">
              <div class="form-row"><label>Host</label><input id="cfg-db-host" type="text" placeholder="localhost"></div>
              <div class="form-row"><label>Port</label><input id="cfg-db-port" type="text" placeholder="5432"></div>
              <div class="form-row"><label>Database</label><input id="cfg-db-name" type="text" placeholder="kobo_reports"></div>
              <div class="form-row"><label>User</label><input id="cfg-db-user" type="text" placeholder="env:DB_USER"></div>
              <div class="form-row"><label>Password</label><input id="cfg-db-pass" type="text" placeholder="env:DB_PASSWORD"></div>
              <div class="form-row"><label>Table</label><input id="cfg-db-table" type="text" placeholder="submissions"></div>
            </div>
            <div style="margin-top:8px;"><button class="btn btn-primary btn-sm" onclick="saveFormSection('export')">Save</button></div>
          </div>
          <div class="form-section">
            <div class="form-section-title">Report</div>
            <div class="form-row"><label>Title</label><input id="cfg-report-title" type="text" placeholder="Monitoring Report"></div>
            <div class="form-row"><label>Period</label><input id="cfg-report-period" type="text" placeholder="Q1 2025"></div>
            <div class="form-row"><label>Template</label><input id="cfg-report-template" type="text" placeholder="templates/report_template.docx"></div>
            <div class="form-row"><label>Output dir</label><input id="cfg-report-outdir" type="text" placeholder="reports"></div>
            <div class="form-row"><label>Split by</label><input id="cfg-report-splitby" type="text" placeholder="leave empty or enter column name"></div>
            <div style="margin-top:8px;"><button class="btn btn-primary btn-sm" onclick="saveFormSection('report')">Save</button></div>
          </div>
          <div class="form-section" id="section-charts">
            <div class="form-section-title">
              Charts
              <span style="font-weight:normal;font-size:11px;color:var(--muted);">Each chart → &#123;&#123; chart_&lt;name&gt; &#125;&#125; placeholder in Word template</span>
              <button class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="openChartModal(null)">+ Add chart</button>
            </div>
            <div id="charts-list"><p class="empty-state" style="padding:12px 0 4px;">No charts configured.</p></div>
            <div style="margin-top:8px;"><button class="btn btn-primary btn-sm" onclick="saveFormSection('charts')">Save</button></div>
          </div>
          <div class="form-section" id="section-indicators">
            <div class="form-section-title">
              Indicators
              <span style="font-weight:normal;font-size:11px;color:var(--muted);">Text/number values → &#123;&#123; ind_&lt;name&gt; &#125;&#125; placeholders in template</span>
              <button class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="openIndicatorModal(null)">+ Add indicator</button>
            </div>
            <div id="indicators-list"><p class="empty-state" style="padding:12px 0 4px;">No indicators configured.</p></div>
            <div style="margin-top:8px;"><button class="btn btn-primary btn-sm" onclick="saveFormSection('indicators')">Save</button></div>
          </div>
          <div class="form-section" id="section-summaries">
            <div class="form-section-title">
              Summaries
              <span style="font-weight:normal;font-size:11px;color:var(--muted);">Text paragraphs → &#123;&#123; summary_&lt;name&gt; &#125;&#125; placeholders in template</span>
              <button class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="openSummaryModal(null)">+ Add summary</button>
            </div>
            <div id="summaries-list"><p class="empty-state" style="padding:12px 0 4px;">No summaries configured.</p></div>
            <div style="margin-top:8px;"><button class="btn btn-primary btn-sm" onclick="saveFormSection('summaries')">Save</button></div>
          </div>
        </div>
        <div id="config-yaml-view" style="display:none;flex:1;overflow:hidden;">
          <div class="editor-wrap"><textarea id="config-editor"></textarea></div>
        </div>
      </div>
    </div>
    <div class="tab-content" id="tab-reports">
      <div class="reports-pane">
        <div style="display:flex;align-items:center;gap:12px;">
          <h2>Reports</h2>
          <button class="btn btn-ghost btn-sm" onclick="loadReports()">↺ Refresh</button>
        </div>
        <div id="reports-container"><p class="empty-state">Loading…</p></div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:24px;">
          <h2>Data files</h2>
          <button class="btn btn-ghost btn-sm" onclick="loadDataFiles()">↺ Refresh</button>
        </div>
        <div id="data-container"><p class="empty-state">Loading…</p></div>
      </div>
    </div>
    <div class="tab-content" id="tab-templates">
      <div class="reports-pane">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <h2>Word templates</h2>
          <button class="btn btn-ghost btn-sm" onclick="loadTemplates()">↺ Refresh</button>
          <span style="margin-left:auto;display:flex;gap:8px;">
            <button class="btn btn-ghost btn-sm" id="btn-generate-tpl" onclick="openGenTplModal()">⚙ Generate template</button>
            <button class="btn btn-primary btn-sm" id="btn-ai-generate-tpl" onclick="openAiTemplateModal()">✦ AI Generate</button>
            <label class="btn btn-primary btn-sm" style="cursor:pointer;">
              ↑ Upload .docx
              <input type="file" accept=".docx" style="display:none" onchange="uploadTemplate(this)">
            </label>
          </span>
        </div>
        <div id="templates-container"><p class="empty-state">Loading…</p></div>
      </div>
    </div>
  </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/yaml/yaml.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js"></script>
<script>
let running=false;
function toggleDashboardTerminal(){
  const el=document.getElementById('dashboard-terminal');
  const wasOpen=el.classList.contains('open');
  el.classList.toggle('open');
  if(!wasOpen){
    const iframe=document.getElementById('dashboard-terminal-frame');
    if(!iframe.src||iframe.src==='about:blank'||iframe.src===window.location.href)iframe.src='/terminal/';
  }
}
loadSplitByOptions();
loadSessions();
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.tab,.tab-content').forEach(el=>el.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    if(tab.dataset.tab==='config')switchView('form');
    if(tab.dataset.tab==='reports'){loadReports();loadDataFiles();}
    if(tab.dataset.tab==='templates')loadTemplates();
  });
});
const editor=CodeMirror.fromTextArea(document.getElementById('config-editor'),{
  mode:'yaml',theme:'material-darker',lineNumbers:true,indentUnit:2,tabSize:2,indentWithTabs:false
});
async function loadConfig(){
  const res=await fetch('/api/config');const data=await res.json();
  editor.setValue(data.content||'# config.yml not found — copy sample.config.yml');
  showMsg('Loaded','ok');
}
async function saveConfig(){
  const res=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:editor.getValue()})});
  const data=await res.json();
  showMsg(res.ok?'Saved ✓':(data.detail||'Failed'),res.ok?'ok':'err');
  if(res.ok)loadSplitByOptions();
}
function showMsg(t,type){const el=document.getElementById('config-msg');el.textContent=t;el.className='config-msg '+type;el.style.display='inline-block';setTimeout(()=>el.style.display='none',3000);}
function switchView(view){
  document.getElementById('config-form-view').style.display=view==='form'?'flex':'none';
  document.getElementById('config-yaml-view').style.display=view==='yaml'?'flex':'none';
  document.getElementById('yaml-toolbar').style.display=view==='yaml'?'flex':'none';
  document.getElementById('btn-view-form').classList.toggle('active',view==='form');
  document.getElementById('btn-view-yaml').classList.toggle('active',view==='yaml');
  if(view==='form')loadFormValues();
  if(view==='yaml'&&!editor.getValue())loadConfig();
}
let _filters=[];
function renderFilters(){
  const c=document.getElementById('filters-container');
  c.innerHTML=_filters.map((f,i)=>`<div class="filter-row"><input value="${(f||'').replace(/"/g,'&quot;')}" oninput="_filters[${i}]=this.value" placeholder="e.g. Age > 0"><button onclick="_filters.splice(${i},1);renderFilters()">✕</button></div>`).join('');
}
function addFilter(){_filters.push('');renderFilters();const inputs=document.querySelectorAll('.filter-row input');if(inputs.length)inputs[inputs.length-1].focus();}
function toggleDbFields(){
  const fmt=document.getElementById('cfg-export-format').value;
  document.getElementById('db-fields').style.display=['mysql','postgres','supabase'].includes(fmt)?'block':'none';
}
function updateAiProviderUI(){
  const p=document.getElementById('cfg-ai-provider').value;
  document.getElementById('ai-base-url-row').style.display=p==='anthropic'?'none':'flex';
  document.getElementById('cfg-ai-model').placeholder=p==='anthropic'?'claude-sonnet-4-6':'gpt-4o';
  document.getElementById('cfg-ai-key').placeholder=p==='anthropic'?'env:ANTHROPIC_API_KEY':'env:OPENAI_API_KEY';
}
async function testAiConnection(){
  const btn=document.getElementById('btn-ai-test');
  const resultEl=document.getElementById('ai-test-result');
  btn.disabled=true;btn.textContent='Testing…';
  resultEl.textContent='';resultEl.style.color='';
  const payload={
    provider:document.getElementById('cfg-ai-provider').value,
    api_key:document.getElementById('cfg-ai-key').value.trim(),
    model:document.getElementById('cfg-ai-model').value.trim()||(document.getElementById('cfg-ai-provider').value==='anthropic'?'claude-sonnet-4-6':'gpt-4o'),
    base_url:document.getElementById('cfg-ai-baseurl').value.trim()||null,
  };
  try{
    const res=await fetch('/api/ai/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await res.json();
    if(res.ok&&data.ok){
      resultEl.textContent='✓ '+data.message;
      resultEl.style.color='#065f46';
    }else{
      resultEl.textContent='✗ '+(data.detail||data.message||'Failed');
      resultEl.style.color='#991b1b';
    }
  }catch(e){
    resultEl.textContent='✗ '+e.message;
    resultEl.style.color='#991b1b';
  }
  btn.disabled=false;btn.textContent='▶ Test connection';
}
async function loadFormValues(){
  const res=await fetch('/api/config');const data=await res.json();
  const cfg=jsyaml.load(data.content||'')||{};
  const api=cfg.api||{},form=cfg.form||{},exp=cfg.export||{},rep=cfg.report||{};
  document.getElementById('cfg-platform').value=api.platform||'kobo';
  document.getElementById('cfg-url').value=api.url||'';
  document.getElementById('cfg-token').value=api.token||'';
  document.getElementById('cfg-uid').value=form.uid||'';
  document.getElementById('cfg-alias').value=form.alias||'';
  document.getElementById('cfg-export-format').value=exp.format||'csv';
  document.getElementById('cfg-export-dir').value=exp.output_dir||'data/processed';
  const db=exp.database||{};
  document.getElementById('cfg-db-host').value=db.host||'localhost';
  document.getElementById('cfg-db-port').value=String(db.port||'5432');
  document.getElementById('cfg-db-name').value=db.name||'';
  document.getElementById('cfg-db-user').value=db.user||'';
  document.getElementById('cfg-db-pass').value=db.password||'';
  document.getElementById('cfg-db-table').value=db.table||'submissions';
  document.getElementById('cfg-report-title').value=rep.title||'';
  document.getElementById('cfg-report-period').value=rep.period||'';
  document.getElementById('cfg-report-template').value=rep.template||'templates/report_template.docx';
  document.getElementById('cfg-report-outdir').value=rep.output_dir||'reports';
  document.getElementById('cfg-report-splitby').value=rep.split_by||'';
  const ai=cfg.ai||{};
  document.getElementById('cfg-ai-provider').value=ai.provider||'openai';
  document.getElementById('cfg-ai-model').value=ai.model||'';
  document.getElementById('cfg-ai-key').value=ai.api_key||'';
  document.getElementById('cfg-ai-baseurl').value=ai.base_url||'';
  document.getElementById('cfg-ai-language').value=ai.language||'';
  document.getElementById('cfg-ai-maxtokens').value=ai.max_tokens||'';
  updateAiProviderUI();
  _filters=Array.isArray(cfg.filters)?cfg.filters:[];
  _charts=Array.isArray(cfg.charts)?cfg.charts:[];
  _indicators=Array.isArray(cfg.indicators)?cfg.indicators:[];
  _summaries=Array.isArray(cfg.summaries)?cfg.summaries:[];
  renderFilters();
  renderChartsList();
  renderIndicatorsList();
  renderSummariesList();
  toggleDbFields();
  loadQuestions();
}
async function saveFormSection(section){
  const res=await fetch('/api/config');const data=await res.json();
  let cfg=jsyaml.load(data.content||'')||{};
  if(section==='api'){
    cfg.api=cfg.api||{};
    cfg.api.platform=document.getElementById('cfg-platform').value;
    cfg.api.url=document.getElementById('cfg-url').value;
    cfg.api.token=document.getElementById('cfg-token').value;
    cfg.form=cfg.form||{};
    cfg.form.uid=document.getElementById('cfg-uid').value;
    cfg.form.alias=document.getElementById('cfg-alias').value;
  }else if(section==='filters'){
    cfg.filters=_filters.filter(f=>f.trim());
  }else if(section==='export'){
    const fmt=document.getElementById('cfg-export-format').value;
    cfg.export=cfg.export||{};
    cfg.export.format=fmt;
    cfg.export.output_dir=document.getElementById('cfg-export-dir').value;
    if(['mysql','postgres','supabase'].includes(fmt)){
      cfg.export.database=cfg.export.database||{};
      cfg.export.database.host=document.getElementById('cfg-db-host').value;
      cfg.export.database.port=document.getElementById('cfg-db-port').value;
      cfg.export.database.name=document.getElementById('cfg-db-name').value;
      cfg.export.database.user=document.getElementById('cfg-db-user').value;
      cfg.export.database.password=document.getElementById('cfg-db-pass').value;
      cfg.export.database.table=document.getElementById('cfg-db-table').value;
    }
  }else if(section==='report'){
    cfg.report=cfg.report||{};
    cfg.report.title=document.getElementById('cfg-report-title').value;
    cfg.report.period=document.getElementById('cfg-report-period').value;
    cfg.report.template=document.getElementById('cfg-report-template').value;
    cfg.report.output_dir=document.getElementById('cfg-report-outdir').value;
    const sb=document.getElementById('cfg-report-splitby').value.trim();
    if(sb)cfg.report.split_by=sb;else delete cfg.report.split_by;
  }else if(section==='charts'){
    cfg.charts=_charts.map(ch=>{const c={...ch};if(c.options&&!Object.keys(c.options).length)delete c.options;return c;});
  }else if(section==='indicators'){
    cfg.indicators=_indicators;
  }else if(section==='summaries'){
    cfg.summaries=_summaries;
  }else if(section==='ai'){
    const provider=document.getElementById('cfg-ai-provider').value;
    const key=document.getElementById('cfg-ai-key').value.trim();
    const model=document.getElementById('cfg-ai-model').value.trim();
    const baseurl=document.getElementById('cfg-ai-baseurl').value.trim();
    const lang=document.getElementById('cfg-ai-language').value.trim();
    const maxtok=parseInt(document.getElementById('cfg-ai-maxtokens').value);
    if(!key&&!model){delete cfg.ai;}else{
      cfg.ai={provider};
      if(model)cfg.ai.model=model;
      if(key)cfg.ai.api_key=key;
      if(baseurl)cfg.ai.base_url=baseurl;
      if(lang)cfg.ai.language=lang;
      if(!isNaN(maxtok))cfg.ai.max_tokens=maxtok;
    }
  }
  const newYaml=jsyaml.dump(cfg,{indent:2,lineWidth:-1});
  const saveRes=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:newYaml})});
  const saveData=await saveRes.json();
  showMsg(saveRes.ok?'Saved ✓':(saveData.detail||'Failed'),saveRes.ok?'ok':'err');
  if(saveRes.ok)loadSplitByOptions();
}
function toggleAccordion(h3){const card=h3.closest('.cmd-accordion');const body=card.querySelector('.accordion-body');const arrow=h3.querySelector('.accordion-arrow');const open=body.style.display==='none';body.style.display=open?'block':'none';arrow.style.transform=open?'rotate(90deg)':'rotate(0deg)';card.classList.toggle('collapsed',!open);}
function getSample(id){const v=parseInt(document.getElementById(id).value);return isNaN(v)?null:v;}
function getSplitBy(){const v=document.getElementById('split-by-report').value;return v||null;}
function getSession(){const v=document.getElementById('session-report').value;return v||null;}
let _sessions=[];let _previewSessions=[];
async function loadSessions(){
  try{
    const res=await fetch('/api/data/sessions');const data=await res.json();
    _sessions=data.sessions||[];
    const sel=document.getElementById('session-report');
    const current=sel.value;
    sel.innerHTML='<option value="">— latest —</option>';
    _sessions.forEach((s,i)=>{const o=document.createElement('option');o.value=s.session_id;o.textContent=s.label+(i===0?' (latest)':'');sel.appendChild(o);});
    if(current)sel.value=current;
  }catch(e){}
}
async function loadSplitByOptions(){
  try{
    const res=await fetch('/api/config');const data=await res.json();
    const cfg=jsyaml.load(data.content||'');
    const sel=document.getElementById('split-by-report');
    const current=sel.value;
    sel.innerHTML='<option value="">— no split —</option>';
    const qs=(cfg&&cfg.questions)||[];
    qs.forEach(q=>{const lbl=q.export_label||q.label||q.kobo_key;if(lbl){const o=document.createElement('option');o.value=lbl;o.textContent=lbl;sel.appendChild(o);}});
    const configSplit=cfg&&cfg.report&&cfg.report.split_by;
    sel.value=configSplit||current||'';
  }catch(e){}
}
let _questions=[];
function renderQuestions(){
  const c=document.getElementById('questions-container');
  updateSelectionUI();
  if(!_questions.length){c.innerHTML='<p class="empty-state">No questions yet. Run Fetch questions first.</p>';return;}
  c.innerHTML='<table class="file-table"><thead><tr>'+
    '<th style="width:32px;"><input type="checkbox" id="q-check-all" onchange="toggleAllQuestions(this.checked)" title="Select all"></th>'+
    '<th>kobo_key</th><th>Label</th><th>Type</th><th>Category</th>'+
    '<th style="min-width:180px;">Export label <span style="font-weight:normal;color:var(--muted)">(editable)</span></th>'+
    '<th>Choices</th>'+
    '</tr></thead><tbody>'+
    _questions.map((q,i)=>{
      const choices=q.choices&&Object.keys(q.choices).length?q.choices:null;
      const choicesHtml=choices
        ?`<details style="cursor:pointer;"><summary style="font-size:11px;color:var(--muted);list-style:none;user-select:none;">${Object.keys(choices).length} values ▾</summary><div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px;">`+
          Object.entries(choices).map(([k,v])=>`<span title="${k}" style="display:inline-block;background:var(--bg2,#f0f0f0);border:1px solid var(--border);border-radius:3px;padding:1px 5px;font-size:10px;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis;">${v}</span>`).join('')+
          `</div></details>`
        :`<span style="color:var(--muted);font-size:11px;">—</span>`;
      return `<tr id="qrow-${i}">
      <td><input type="checkbox" class="q-check" data-idx="${i}" onchange="updateSelectionUI()"></td>
      <td style="color:var(--muted);font-size:11px;font-family:monospace;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${q.kobo_key||''}">${q.kobo_key||''}</td>
      <td style="font-size:12px;">${q.label||''}</td>
      <td style="color:var(--muted);font-size:11px;">${q.type||''}</td>
      <td><span class="badge-cat badge-cat-${q.category||'undefined'}">${q.category||''}</span></td>
      <td><input class="export-label-input" data-idx="${i}" value="${(q.export_label||'').replace(/"/g,'&quot;')}" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;" oninput="markDirty(this)"></td>
      <td style="max-width:200px;">${choicesHtml}</td>
    </tr>`;}).join('')+
    '</tbody></table>';
}
async function loadQuestions(){
  const c=document.getElementById('questions-container');
  c.innerHTML='<p class="empty-state">Loading…</p>';
  const data=await(await fetch('/api/questions')).json();
  _questions=data.questions||[];
  renderQuestions();
}
function toggleAllQuestions(checked){
  document.querySelectorAll('.q-check').forEach(cb=>cb.checked=checked);
  updateSelectionUI();
}
function updateSelectionUI(){
  const checked=document.querySelectorAll('.q-check:checked');
  const n=checked.length;
  const countEl=document.getElementById('q-sel-count');
  const keepBtn=document.getElementById('btn-keep-sel');
  const delBtn=document.getElementById('btn-del-sel');
  if(!countEl)return;
  if(n>0){
    countEl.textContent=n+' selected';countEl.style.display='inline';
    keepBtn.style.display='inline-block';delBtn.style.display='inline-block';
  }else{
    countEl.style.display='none';keepBtn.style.display='none';delBtn.style.display='none';
  }
}
function getSelectedIndices(){
  return Array.from(document.querySelectorAll('.q-check:checked')).map(cb=>parseInt(cb.dataset.idx));
}
function deleteSelected(){
  const indices=new Set(getSelectedIndices());
  if(!indices.size)return;
  if(!confirm(`Delete ${indices.size} question(s)? This will be applied when you click Save changes.`))return;
  _questions=_questions.filter((_,i)=>!indices.has(i));
  renderQuestions();
  showMsg(`${indices.size} question(s) removed — click Save changes to persist`,'ok');
}
function keepSelected(){
  const indices=new Set(getSelectedIndices());
  if(!indices.size)return;
  const remove=_questions.length-indices.size;
  if(!confirm(`Keep only ${indices.size} selected question(s) and remove the other ${remove}? This will be applied when you click Save changes.`))return;
  _questions=_questions.filter((_,i)=>indices.has(i));
  renderQuestions();
  showMsg(`Kept ${indices.size} question(s), removed ${remove} — click Save changes to persist`,'ok');
}
function markDirty(input){
  const i=parseInt(input.dataset.idx);
  _questions[i].export_label=input.value;
  input.style.borderColor='#f59e0b';
}
async function saveQuestions(){
  const res=await fetch('/api/questions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questions:_questions})});
  const data=await res.json();
  const msg=document.getElementById('questions-msg');
  if(res.ok){
    msg.textContent=`Saved ${data.saved} questions.`;msg.style.color='var(--teal)';msg.style.display='block';
    document.querySelectorAll('.export-label-input').forEach(el=>el.style.borderColor='');
    loadSplitByOptions();
  }else{msg.textContent=data.detail||'Save failed';msg.style.color='#dc2626';msg.style.display='block';}
  setTimeout(()=>msg.style.display='none',3000);
}
async function runCmd(command,opts={}){
  if(running){toast('Already running','err');return;}
  running=true;setDot('running');
  const activeCard=document.querySelector(`.cmd-card[data-cmd="${command}"]`);
  if(activeCard)activeCard.classList.add('running');
  document.getElementById('status-label').textContent=command;
  document.getElementById('log-body').innerHTML='';
  document.getElementById('log-title').textContent='Running: '+command;
  const body={};if(opts.sample)body.sample=opts.sample;if(opts.split_by)body.split_by=opts.split_by;
  try{
    const res=await fetch('/api/run/'+command,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const reader=res.body.getReader();const dec=new TextDecoder();let buf='';
    while(true){
      const{done,value}=await reader.read();if(done)break;
      buf+=dec.decode(value,{stream:true});
      const parts=buf.split('\n\n');buf=parts.pop();
      for(const part of parts){
        const lines=part.trim().split('\n');let ev='message',data='';
        for(const l of lines){if(l.startsWith('event: '))ev=l.slice(7);if(l.startsWith('data: '))data=l.slice(6);}
        if(!data)continue;
        const p=JSON.parse(data);
        if(ev==='log')appendLog(p.line,p.level);
        else if(ev==='status'&&p.status!=='running'){
          setDot(p.status);
          document.getElementById('log-title').textContent=command+' — '+p.status;
          document.getElementById('status-label').textContent=p.status==='success'?'✓ done':'✗ error';
          running=false;
          if(p.status==='success'&&command==='build-report'){loadReports();loadDashboardState();}
          if(p.status==='success'&&command==='download'){loadDataFiles();loadSessions();loadDashboardState();}
          if(p.status==='success'&&command==='fetch-questions'){loadQuestions();loadSplitByOptions();loadDashboardState();}
          if(p.status==='success'&&command==='generate-template')loadDashboardState();
        }
        else if(ev==='done')running=false;
      }
    }
  }catch(e){}
  running=false;
  if(activeCard)activeCard.classList.remove('running');
}
function appendLog(line,level='info'){
  const b=document.getElementById('log-body');
  const d=document.createElement('div');d.className='log-line '+level;d.textContent=line;
  b.appendChild(d);b.scrollTop=b.scrollHeight;
}
function clearLog(){document.getElementById('log-body').innerHTML='<span class="log-empty">Cleared.</span>';}
function setDot(s){document.getElementById('status-dot').className='status-dot '+s;}
async function loadReports(){
  const c=document.getElementById('reports-container');c.innerHTML='<p class="empty-state">Loading…</p>';
  const data=await(await fetch('/api/reports')).json();
  if(!data.files.length){c.innerHTML='<p class="empty-state">No reports yet.</p>';return;}
  const zipBtn=data.files.length>1?`<div style="margin-bottom:10px;"><a href="/api/reports/download-zip" download="reports.zip"><button class="btn btn-primary btn-sm">↓ Download all as ZIP (${data.files.length} files)</button></a></div>`:'';
  c.innerHTML=zipBtn+'<table class="file-table"><thead><tr><th>File</th><th>Size</th><th>Generated</th><th></th></tr></thead><tbody>'+
    data.files.map(f=>`<tr><td><span class="file-name">${f.name}</span></td><td style="color:var(--muted)">${f.size_kb} KB</td><td style="color:var(--muted)">${f.modified}</td><td style="text-align:right;display:flex;gap:6px;justify-content:flex-end;"><a href="/api/reports/download/${encodeURIComponent(f.name)}" download><button class="btn btn-primary btn-sm">↓ Download</button></a><button class="btn btn-danger btn-sm" onclick="deleteReport('${f.name}')">Delete</button></td></tr>`).join('')+
    '</tbody></table>';
}
async function deleteReport(name){
  if(!confirm('Delete '+name+'?'))return;
  await fetch('/api/reports/'+encodeURIComponent(name),{method:'DELETE'});loadReports();
}
async function loadDataFiles(){
  const c=document.getElementById('data-container');c.innerHTML='<p class="empty-state">Loading…</p>';
  const data=await(await fetch('/api/data/sessions')).json();
  const sessions=data.sessions||[];
  if(!sessions.length){c.innerHTML='<p class="empty-state">No data files yet. Run Download data first.</p>';return;}
  c.innerHTML='<table class="file-table"><thead><tr><th>Session</th><th>Files</th><th></th></tr></thead><tbody>'+
    sessions.map((s,i)=>{
      const label=s.label+(i===0?' <span style="font-size:10px;color:var(--teal)">(latest)</span>':'');
      const fileCount=s.files.length+' file'+(s.files.length!==1?'s':'');
      return `<tr><td><span class="file-name">${label}</span></td><td style="color:var(--muted);font-size:12px;">${fileCount}</td><td style="text-align:right;display:flex;gap:6px;justify-content:flex-end;"><a href="/api/data/sessions/${encodeURIComponent(s.session_id)}/download" download><button class="btn btn-primary btn-sm">↓ Download ZIP</button></a><button class="btn btn-danger btn-sm" onclick="deleteSession('${s.session_id}')">Delete</button></td></tr>`;
    }).join('')+
    '</tbody></table>';
}
async function deleteSession(sid){
  if(!confirm('Delete all files from session '+sid+'?'))return;
  await fetch('/api/data/sessions/'+encodeURIComponent(sid),{method:'DELETE'});
  loadDataFiles();loadSessions();
}
async function loadTemplates(){
  const c=document.getElementById('templates-container');c.innerHTML='<p class="empty-state">Loading…</p>';
  const [data,activeData]=await Promise.all([fetch('/api/templates').then(r=>r.json()),fetch('/api/templates/active').then(r=>r.json())]);
  const active=activeData.active||'';
  if(!data.files.length){c.innerHTML='<div class="empty-state"><p>No templates yet.</p><p style="margin-top:8px">Generate a starter template from your config, then download and customize it in Word.</p><button class="btn btn-primary" style="margin-top:12px" onclick="generateTemplate()">⚙ Generate template</button></div>';return;}
  c.innerHTML='<table class="file-table"><thead><tr><th>File</th><th>Size</th><th>Modified</th><th></th></tr></thead><tbody>'+
    data.files.map(f=>{
      const isActive=f.name===active;
      const badge=isActive?'<span class="badge-active">Active</span>':'';
      const activeBtn=isActive?'<button class="btn btn-ghost btn-sm" disabled style="opacity:.5">✓ Active</button>':`<button class="btn btn-ghost btn-sm" onclick="setActiveTemplate('${f.name}')">Set as active</button>`;
      return `<tr><td><span class="file-name">${f.name}</span>${badge}</td><td style="color:var(--muted)">${f.size_kb} KB</td><td style="color:var(--muted)">${f.modified}</td><td style="text-align:right;display:flex;gap:6px;justify-content:flex-end;">${activeBtn}<button class="btn btn-ghost btn-sm" onclick="previewTemplate('${f.name}')">Preview</button><a href="/api/templates/download/${encodeURIComponent(f.name)}" download><button class="btn btn-primary btn-sm">↓ Download</button></a><button class="btn btn-danger btn-sm" onclick="deleteTemplate('${f.name}')">Delete</button></td></tr>`;
    }).join('')+
    '</tbody></table>';
}
async function uploadTemplate(input){
  if(!input.files.length)return;
  const form=new FormData();form.append('file',input.files[0]);
  const res=await fetch('/api/templates/upload',{method:'POST',body:form});
  const data=await res.json();
  input.value='';
  if(res.ok){toast('Uploaded '+data.name,'ok');loadTemplates();}
  else{toast(data.detail||'Upload failed','err');}
}
async function openGenTplModal(){
  const modal=document.getElementById('gen-tpl-modal');
  modal.style.display='flex';
  // load config to populate variables panel
  try{
    const res=await fetch('/api/config');
    const data=await res.json();
    const cfg=data.exists?jsyaml.load(data.content)||{}:{};
    _renderGenTplVars(cfg);
  }catch(e){
    document.getElementById('gen-tpl-vars').innerHTML='<span style="color:var(--muted);font-size:11px;">Could not load config.</span>';
  }
}
function closeGenTplModal(){document.getElementById('gen-tpl-modal').style.display='none';}
function _renderGenTplVars(cfg){
  const charts=(cfg.charts||[]);
  const summaries=(cfg.summaries||[]);
  const indicators=(cfg.indicators||[]);
  const container=document.getElementById('gen-tpl-vars');
  const std=['report_title','period','n_submissions','generated_at','summary_text','observations','recommendations'];
  let html='';
  html+='<div style="margin-bottom:10px;">';
  html+='<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Standard (always included)</div>';
  html+='<div style="display:flex;flex-wrap:wrap;gap:4px;">'+std.map(v=>`<span class="var-tag used">{{ ${v} }}</span>`).join('')+'</div>';
  html+='</div>';
  if(charts.length){
    html+='<div style="margin-bottom:10px;">';
    html+='<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Charts ('+charts.length+')</div>';
    html+='<div style="display:flex;flex-wrap:wrap;gap:4px;">'+charts.map(c=>`<span class="var-tag used" title="${c.title||''}">{{ chart_${c.name} }}</span>`).join('')+'</div>';
    html+='</div>';
  }else{
    html+='<div style="margin-bottom:10px;"><div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Charts</div>';
    html+='<span style="font-size:11px;color:#dc2626;">None configured — add charts to config.yml first.</span></div>';
  }
  if(summaries.length){
    html+='<div style="margin-bottom:10px;">';
    html+='<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Summaries ('+summaries.length+')</div>';
    html+='<div style="display:flex;flex-wrap:wrap;gap:4px;">'+summaries.map(s=>`<span class="var-tag used" title="${s.label||''}">{{ summary_${s.name} }}</span>`).join('')+'</div>';
    html+='</div>';
  }
  if(indicators.length){
    html+='<div style="margin-bottom:10px;">';
    html+='<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Indicators ('+indicators.length+')</div>';
    html+='<div style="display:flex;flex-wrap:wrap;gap:4px;">'+indicators.map(i=>`<span class="var-tag used" title="${i.label||''}">{{ ind_${i.name} }}</span>`).join('')+'</div>';
    html+='</div>';
  }
  container.innerHTML=html;
}
async function runGenTpl(){
  if(running){toast('A command is already running','err');return;}
  const context=document.getElementById('gen-tpl-context').value.trim();
  const summaryPrompt=document.getElementById('gen-tpl-summary-prompt').value.trim();
  closeGenTplModal();
  const btn=document.getElementById('btn-generate-tpl');
  if(btn){btn.disabled=true;btn.textContent='⚙ Generating…';}
  running=true;setDot('running');
  const activeCard=document.querySelector('.cmd-card[data-cmd="generate-template"]');
  if(activeCard)activeCard.classList.add('running');
  document.getElementById('status-label').textContent='generate-template';
  document.getElementById('log-body').innerHTML='';
  document.getElementById('log-title').textContent='Running: generate-template';
  const body={};
  if(context)body.context=context;
  if(summaryPrompt)body.summary_prompt=summaryPrompt;
  let ok=false;
  try{
    const res=await fetch('/api/run/generate-template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const reader=res.body.getReader();const dec=new TextDecoder();let buf='';
    while(true){
      const{done,value}=await reader.read();if(done)break;
      buf+=dec.decode(value,{stream:true});
      const parts=buf.split('\n\n');buf=parts.pop();
      for(const part of parts){
        const lines=part.trim().split('\n');let ev='message',data='';
        for(const l of lines){if(l.startsWith('event: '))ev=l.slice(7);if(l.startsWith('data: '))data=l.slice(6);}
        if(!data)continue;const p=JSON.parse(data);
        if(ev==='log')appendLog(p.line,p.level);
        else if(ev==='status'&&p.status!=='running'){
          ok=p.status==='success';setDot(p.status);
          document.getElementById('log-title').textContent='generate-template — '+p.status;
          document.getElementById('status-label').textContent=ok?'✓ done':'✗ error';
          running=false;
          if(ok){loadTemplates();loadDashboardState();}
        }
        else if(ev==='done')running=false;
      }
    }
  }catch(e){}
  running=false;
  if(activeCard)activeCard.classList.remove('running');
  if(btn){btn.disabled=false;btn.textContent='⚙ Generate template';}
  if(ok)toast('Template generated','ok');
  else toast('Generation failed — check logs','err');
}
async function previewTemplate(name){
  const res=await fetch('/api/templates/preview/'+encodeURIComponent(name));
  const data=await res.json();
  if(!res.ok){toast(data.detail||'Preview failed','err');return;}
  let body='';
  if(data.variables.length){
    body+='<h4>Variables</h4><ul class="placeholder-list">'+data.variables.map(v=>`<li>{{ ${v} }}</li>`).join('')+'</ul>';
  }
  if(data.charts.length){
    body+='<h4>Charts</h4><ul class="placeholder-list">'+data.charts.map(v=>`<li>{{ ${v} }}</li>`).join('')+'</ul>';
  }
  if(!data.variables.length&&!data.charts.length) body='<p class="empty-state">No placeholders found in this template.</p>';
  const overlay=document.createElement('div');overlay.className='modal-overlay';
  overlay.innerHTML=`<div class="modal"><div class="modal-header"><h3>${name}</h3><button onclick="this.closest('.modal-overlay').remove()">✕</button></div><div class="modal-body">${body}</div></div>`;
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  document.body.appendChild(overlay);
}
async function setActiveTemplate(name){
  const res=await fetch('/api/templates/set-active/'+encodeURIComponent(name),{method:'POST'});
  const data=await res.json();
  if(res.ok){toast('Template "'+name+'" set as active','ok');loadTemplates();}
  else{toast(data.detail||'Failed to set active','err');}
}
async function deleteTemplate(name){
  if(!confirm('Delete template '+name+'?'))return;
  await fetch('/api/templates/'+encodeURIComponent(name),{method:'DELETE'});loadTemplates();
}
function toast(msg,type='ok'){const el=document.createElement('div');el.className='toast '+type;el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.remove(),3000);}
// ── Charts & Indicators ───────────────────────────────────────────────
let _charts=[],_indicators=[],_summaries=[],_editChartIdx=null,_editIndIdx=null,_editSumIdx=null;
const CHART_META={
  bar:{q:['categorical'],hint:'1 categorical column'},
  horizontal_bar:{q:['categorical'],hint:'1 categorical column'},
  pie:{q:['categorical'],hint:'1 categorical column'},
  donut:{q:['categorical'],hint:'1 categorical column'},
  treemap:{q:['categorical'],hint:'1 categorical column'},
  waterfall:{q:['categorical'],hint:'1 categorical column'},
  funnel:{q:['categorical'],hint:'1 categorical column'},
  table:{q:['categorical'],hint:'1 categorical column'},
  histogram:{q:['numeric'],hint:'1 numeric column'},
  line:{q:['date/numeric'],hint:'1 date or numeric column'},
  area:{q:['date/numeric'],hint:'1 date or numeric column'},
  stacked_bar:{q:['x_axis','stack_by'],hint:'[x_axis, stack_by]'},
  grouped_bar:{q:['category','group_by'],hint:'[category, group_by]'},
  scatter:{q:['x_column','y_column'],hint:'[x_column, y_column]'},
  box_plot:{q:['category','numeric'],hint:'[category, numeric]'},
  heatmap:{q:['row_cat','col_cat'],hint:'[row_category, col_category]'},
  bullet_chart:{q:['numeric'],hint:'1 numeric column — target option required'},
  likert:{q:['scale_column'],hint:'1 column with scale responses'},
  scorecard:{q:['col1','col2','col3'],hint:'one KPI card per column listed'},
  pyramid:{q:['age_group','gender'],hint:'[age_group_col, gender_col]'},
  dot_map:{q:['latitude','longitude'],hint:'[latitude_col, longitude_col]'},
};
const CHART_OPT_ROWS={
  'cm-topn-row':['bar','horizontal_bar','pie','donut','treemap','waterfall','funnel','table','likert'],
  'cm-color-row':['bar','horizontal_bar','stacked_bar','grouped_bar','pie','donut','line','area','histogram','scatter','box_plot','heatmap','treemap','waterfall','funnel','table','bullet_chart','likert','scorecard','pyramid','dot_map'],
  'cm-sort-row':['bar','horizontal_bar','grouped_bar','waterfall'],
  'cm-normalize-row':['stacked_bar'],
  'cm-freq-row':['line','area'],
  'cm-bins-row':['histogram'],
  'cm-target-row':['bullet_chart'],
  'cm-stat-row':['scorecard'],
  'cm-columns-row':['scorecard'],
  'cm-male-row':['pyramid'],
  'cm-female-row':['pyramid'],
  'cm-colorby-row':['dot_map'],
  'cm-xlabel-row':['bar','horizontal_bar','stacked_bar','grouped_bar','line','area','histogram','scatter','box_plot','waterfall','bullet_chart','heatmap'],
  'cm-ylabel-row':['bar','horizontal_bar','stacked_bar','grouped_bar','line','area','histogram','scatter','box_plot','waterfall','bullet_chart','heatmap'],
  'cm-distinct-by-row':['bar','horizontal_bar','stacked_bar','grouped_bar','pie','donut','treemap','waterfall','funnel','table','likert','line','area','histogram','scatter','box_plot','heatmap','bullet_chart','scorecard','pyramid'],
  'cm-expand-multi-row':['bar','horizontal_bar','pie','donut','treemap','waterfall','funnel','table','likert'],
  'cm-data-type-row':['bar','horizontal_bar','stacked_bar','grouped_bar','pie','donut','line','area','histogram','scatter','box_plot','heatmap','treemap','waterfall','funnel','table','bullet_chart','likert','scorecard','pyramid','dot_map'],
};
function renderChartsList(){
  const c=document.getElementById('charts-list');
  if(!_charts.length){c.innerHTML='<p class="empty-state" style="padding:12px 0 4px;">No charts configured.</p>';return;}
  c.innerHTML=_charts.map((ch,i)=>`<div class="chart-card">
    <div class="chart-card-info">
      <div class="chart-card-name"><span class="type-badge">${ch.type||''}</span>${ch.name||''}</div>
      <div class="chart-card-meta">${ch.title||''} · columns: ${(ch.questions||[]).join(', ')||'—'}</div>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="previewChartQuick(${i})">Preview</button>
    <button class="btn btn-ghost btn-sm" onclick="openChartModal(${i})">Edit</button>
    <button class="btn btn-danger btn-sm" onclick="deleteChart(${i})">Delete</button>
  </div>`).join('');
}
function deleteChart(i){if(!confirm('Delete chart "'+(_charts[i]||{}).name+'"?'))return;_charts.splice(i,1);renderChartsList();}
async function previewChartQuick(i){
  const ch=_charts[i];if(!ch)return;
  const modal=document.getElementById('quick-preview-modal');
  document.getElementById('qp-title').textContent=(ch.name||'chart')+' — '+(ch.type||'');
  document.getElementById('qp-area').innerHTML='<span style="color:var(--muted);">Generating preview…</span>';
  modal.style.display='flex';
  const sessionId=document.getElementById('session-report').value||null;
  const sessionInfo=sessionId?_sessions.find(s=>s.session_id===sessionId):null;
  const dataFile=sessionInfo&&sessionInfo.main_file?sessionInfo.main_file:null;
  try{
    const res=await fetch('/api/charts/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chart:ch,data_file:dataFile})});
    const data=await res.json();
    if(res.ok){
      document.getElementById('qp-area').innerHTML=`<img src="data:image/png;base64,${data.image}" style="max-width:100%;max-height:70vh;border-radius:4px;border:1px solid var(--border);">`;
    }else{
      document.getElementById('qp-area').innerHTML=`<span style="color:#dc2626;">${data.detail||'Preview failed'}</span>`;
    }
  }catch(e){document.getElementById('qp-area').innerHTML=`<span style="color:#dc2626;">Error: ${e.message}</span>`;}
}
function renderIndicatorsList(){
  const c=document.getElementById('indicators-list');
  if(!_indicators.length){c.innerHTML='<p class="empty-state" style="padding:12px 0 4px;">No indicators configured.</p>';return;}
  c.innerHTML=_indicators.map((ind,i)=>`<div class="ind-row">
    <span class="ind-name">${ind.name||''}</span>
    <span class="ind-meta">${ind.label||''} · ${ind.stat||''} of ${ind.question||''} · format: ${ind.format||''}</span>
    <button class="btn btn-ghost btn-sm" onclick="openIndicatorModal(${i})">Edit</button>
    <button class="btn btn-danger btn-sm" onclick="deleteIndicator(${i})">Delete</button>
  </div>`).join('');
}
function deleteIndicator(i){if(!confirm('Delete indicator "'+(_indicators[i]||{}).name+'"?'))return;_indicators.splice(i,1);renderIndicatorsList();}
function _choicesForColumn(colName){
  if(!colName||!_questions)return null;
  const q=_questions.find(q=>(q.export_label||q.label||q.kobo_key)===colName);
  return(q&&q.choices&&Object.keys(q.choices).length)?q.choices:null;
}
function showColumnChoices(input){
  const hint=input.parentElement.querySelector('.cm-choices-hint');
  if(!hint)return;
  const val=input.value.trim();
  const colNames=(_questions||[]).map(q=>q.export_label||q.label||q.kobo_key).filter(Boolean);
  if(val&&!colNames.includes(val)){
    input.style.borderColor='#f59e0b';
    hint.innerHTML='<span style="color:#b45309;font-size:10px;">⚠ column not found in config</span>';
    hint.style.display='flex';
    return;
  }
  input.style.borderColor='';
  const choices=_choicesForColumn(val);
  if(!choices){hint.innerHTML='';hint.style.display='none';return;}
  const labels=Object.values(choices);
  hint.innerHTML='<span style="color:var(--muted);font-size:10px;margin-right:4px;">segments:</span>'+
    labels.map(v=>`<span style="display:inline-block;background:var(--bg2,#f0f0f0);border:1px solid var(--border);border-radius:3px;padding:1px 5px;font-size:10px;white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;" title="${v.replace(/"/g,'&quot;')}">${v}</span>`).join(' ');
  hint.style.display='flex';
}
function updateChartForm(){
  const type=document.getElementById('cm-type').value;
  const meta=CHART_META[type]||{q:['column'],hint:''};
  document.getElementById('cm-type-hint').textContent=meta.hint||'';
  // question inputs
  const wrap=document.getElementById('cm-questions-wrap');
  const colNames=(_questions||[]).map(q=>q.export_label||q.label||q.kobo_key).filter(Boolean);
  const dlId='cm-col-datalist';
  let dl=document.getElementById(dlId);
  if(!dl){dl=document.createElement('datalist');dl.id=dlId;document.body.appendChild(dl);}
  dl.innerHTML=colNames.map(n=>`<option value="${n.replace(/"/g,'&quot;')}">`).join('');
  wrap.innerHTML=meta.q.map((lbl,i)=>`<div class="form-row"><label>${lbl}</label><div style="flex:1;display:flex;flex-direction:column;gap:4px;"><input class="cm-q-input" data-qi="${i}" placeholder="column name" list="${dlId}" oninput="showColumnChoices(this)"><div class="cm-choices-hint" style="display:none;flex-wrap:wrap;gap:3px;align-items:center;padding:2px 0;"></div></div></div>`).join('');
  // option rows visibility
  Object.entries(CHART_OPT_ROWS).forEach(([rowId,types])=>{
    const el=document.getElementById(rowId);
    if(el)el.style.display=types.includes(type)?'flex':'none';
  });
}
async function loadPreviewFileOptions(){
  try{
    const res=await fetch('/api/data/sessions');const data=await res.json();
    _previewSessions=data.sessions||[];
    const sel=document.getElementById('cm-preview-file');
    sel.innerHTML='<option value="">— auto-detect —</option>';
    _previewSessions.forEach((s,i)=>{const o=document.createElement('option');o.value=s.session_id;o.textContent=s.label+(i===0?' (latest)':'');sel.appendChild(o);});
  }catch(e){}
}
async function openChartModal(idx){
  if(!_questions.length){const d=await(await fetch('/api/questions')).json();_questions=d.questions||[];}
  _editChartIdx=idx;
  switchChartView('form');
  document.getElementById('cm-ai-prompt').value='';
  document.getElementById('cm-ai-result').style.display='none';
  document.getElementById('chart-modal-title').textContent=idx===null?'Add chart':'Edit chart';
  updateChartForm();
  loadPreviewFileOptions();
  // clear fields
  ['cm-name','cm-title','cm-width','cm-color','cm-topn','cm-bins','cm-target','cm-columns','cm-male','cm-female','cm-colorby','cm-xlabel','cm-ylabel','cm-distinct-by','cm-sample-n'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('cm-color-picker').value='#1D9E75';
  ['cm-sort','cm-normalize','cm-freq','cm-stat-scorecard','cm-expand-multi','cm-data-type'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('cm-preview-area').innerHTML='Select a data file (or leave blank for auto-detect) and click Preview.';
  document.getElementById('cm-preview-area').style.color='var(--muted)';
  if(idx!==null){
    const ch=_charts[idx];
    document.getElementById('cm-type').value=ch.type||'bar';
    updateChartForm();
    document.getElementById('cm-name').value=ch.name||'';
    document.getElementById('cm-title').value=ch.title||'';
    // populate question inputs
    const qInputs=document.querySelectorAll('.cm-q-input');
    (ch.questions||[]).forEach((q,i)=>{if(qInputs[i]){qInputs[i].value=q;showColumnChoices(qInputs[i]);}});
    const o=ch.options||{};
    if(o.width_inches)document.getElementById('cm-width').value=o.width_inches;
    if(o.color){document.getElementById('cm-color').value=o.color;if(/^#[0-9A-Fa-f]{6}$/.test(o.color))document.getElementById('cm-color-picker').value=o.color;}
    if(o.top_n)document.getElementById('cm-topn').value=o.top_n;
    if(o.sort)document.getElementById('cm-sort').value=o.sort;
    if(o.normalize)document.getElementById('cm-normalize').value=String(o.normalize);
    if(o.freq)document.getElementById('cm-freq').value=o.freq;
    if(o.bins)document.getElementById('cm-bins').value=o.bins;
    if(o.target)document.getElementById('cm-target').value=o.target;
    if(o.stat)document.getElementById('cm-stat-scorecard').value=o.stat;
    if(o.columns)document.getElementById('cm-columns').value=o.columns;
    if(o.male_value)document.getElementById('cm-male').value=o.male_value;
    if(o.female_value)document.getElementById('cm-female').value=o.female_value;
    if(o.color_by)document.getElementById('cm-colorby').value=o.color_by;
    if(o.xlabel)document.getElementById('cm-xlabel').value=o.xlabel;
    if(o.xlabel)document.getElementById('cm-xlabel').value=o.xlabel;
    if(o.ylabel)document.getElementById('cm-ylabel').value=o.ylabel;
    if(o.distinct_by)document.getElementById('cm-distinct-by').value=o.distinct_by;
    if(o.expand_multi!==undefined)document.getElementById('cm-expand-multi').value=String(o.expand_multi);
    if(o.data_type)document.getElementById('cm-data-type').value=o.data_type;
  }
  document.getElementById('chart-modal').style.display='flex';
}
function closeChartModal(){document.getElementById('chart-modal').style.display='none';}
function buildChartFromModal(){
  const type=document.getElementById('cm-type').value;
  const questions=Array.from(document.querySelectorAll('.cm-q-input')).map(i=>i.value.trim()).filter(Boolean);
  const opts={};
  const w=document.getElementById('cm-width').value;if(w)opts.width_inches=parseFloat(w);
  const col=document.getElementById('cm-color').value;if(col)opts.color=col;
  const tn=document.getElementById('cm-topn').value;if(tn)opts.top_n=parseInt(tn);
  const sort=document.getElementById('cm-sort').value;if(sort)opts.sort=sort;
  const norm=document.getElementById('cm-normalize').value;if(norm)opts.normalize=(norm==='true');
  const freq=document.getElementById('cm-freq').value;if(freq)opts.freq=freq;
  const bins=document.getElementById('cm-bins').value;if(bins)opts.bins=parseInt(bins);
  const tgt=document.getElementById('cm-target').value;if(tgt)opts.target=parseInt(tgt);
  const stat=document.getElementById('cm-stat-scorecard').value;if(stat)opts.stat=stat;
  const cols=document.getElementById('cm-columns').value;if(cols)opts.columns=parseInt(cols);
  const male=document.getElementById('cm-male').value;if(male)opts.male_value=male;
  const female=document.getElementById('cm-female').value;if(female)opts.female_value=female;
  const cby=document.getElementById('cm-colorby').value;if(cby)opts.color_by=cby;
  const xl=document.getElementById('cm-xlabel').value;if(xl)opts.xlabel=xl;
  const yl=document.getElementById('cm-ylabel').value;if(yl)opts.ylabel=yl;
  const dby=document.getElementById('cm-distinct-by').value.trim();if(dby)opts.distinct_by=dby;
  const exm=document.getElementById('cm-expand-multi').value;if(exm)opts.expand_multi=(exm==='true');
  const dt=document.getElementById('cm-data-type').value;if(dt)opts.data_type=dt;
  return{name:document.getElementById('cm-name').value.trim(),title:document.getElementById('cm-title').value.trim(),type,questions,options:Object.keys(opts).length?opts:undefined};
}
async function previewChart(){
  const chart=buildChartFromModal();
  if(!chart.name||!chart.questions.length){document.getElementById('cm-preview-area').innerHTML='<span style="color:#dc2626;">Enter a name and at least one column name first.</span>';return;}
  const parea=document.getElementById('cm-preview-area');
  parea.innerHTML='<span style="color:var(--muted);">Generating preview…</span>';
  const selSessionId=document.getElementById('cm-preview-file').value||null;
  const selSessionInfo=selSessionId?_previewSessions.find(s=>s.session_id===selSessionId):null;
  const dataFile=selSessionInfo&&selSessionInfo.main_file?selSessionInfo.main_file:null;
  const sampleN=parseInt(document.getElementById('cm-sample-n').value)||null;
  try{
    const res=await fetch('/api/charts/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chart,data_file:dataFile,sample_n:sampleN})});
    const data=await res.json();
    if(res.ok){
      parea.innerHTML=`<img src="data:image/png;base64,${data.image}" style="max-width:100%;border-radius:4px;border:1px solid var(--border);">`;
    }else{
      parea.innerHTML=`<span style="color:#dc2626;">${data.detail||'Preview failed'}</span>`;
    }
  }catch(e){parea.innerHTML=`<span style="color:#dc2626;">Error: ${e.message}</span>`;}
}
function saveChartFromModal(){
  const ch=buildChartFromModal();
  if(!ch.name){alert('Chart name is required');return;}
  if(_editChartIdx===null)_charts.push(ch);
  else _charts[_editChartIdx]=ch;
  renderChartsList();
  closeChartModal();
}
function updateIndicatorForm(){
  const stat=document.getElementById('im-stat').value;
  document.getElementById('im-filterval-row').style.display=stat==='percent'?'flex':'none';
}
function openIndicatorModal(idx){
  _editIndIdx=idx;
  switchIndicatorView('form');
  document.getElementById('im-ai-prompt').value='';
  document.getElementById('im-ai-result').style.display='none';
  document.getElementById('ind-modal-title').textContent=idx===null?'Add indicator':'Edit indicator';
  ['im-name','im-label','im-question','im-filterval','im-decimals','im-dedup-by'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('im-stat').value='count';
  document.getElementById('im-format').value='number';
  document.getElementById('im-preview-area').innerHTML='Click Preview to compute the indicator value.';
  document.getElementById('im-preview-area').style.color='var(--muted)';
  loadIndicatorPreviewFileOptions();
  updateIndicatorForm();
  if(idx!==null){
    const ind=_indicators[idx];
    document.getElementById('im-name').value=ind.name||'';
    document.getElementById('im-label').value=ind.label||'';
    document.getElementById('im-question').value=ind.question||'';
    document.getElementById('im-stat').value=ind.stat||'count';
    document.getElementById('im-filterval').value=ind.filter_value||'';
    document.getElementById('im-format').value=ind.format||'number';
    document.getElementById("im-decimals").value=ind.decimals||"";
    document.getElementById("im-dedup-by").value=ind.dedup_by||"";
    updateIndicatorForm();
  }
  document.getElementById('indicator-modal').style.display='flex';
}
function closeIndicatorModal(){document.getElementById('indicator-modal').style.display='none';}
function saveIndicatorFromModal(){
  const name=document.getElementById('im-name').value.trim();
  if(!name){alert('Indicator name is required');return;}
  const stat=document.getElementById('im-stat').value;
  const ind={name,label:document.getElementById('im-label').value.trim(),question:document.getElementById('im-question').value.trim(),stat,format:document.getElementById('im-format').value};
  const fv=document.getElementById('im-filterval').value.trim();if(fv)ind.filter_value=fv;
  const dec=document.getElementById('im-decimals').value;if(dec!=='')ind.decimals=parseInt(dec);
  const dby=document.getElementById('im-dedup-by').value.trim();if(dby)ind.dedup_by=dby;
  if(_editIndIdx===null)_indicators.push(ind);
  else _indicators[_editIndIdx]=ind;
  renderIndicatorsList();
  closeIndicatorModal();
}
async function loadIndicatorPreviewFileOptions(){
  try{
    const res=await fetch('/api/data/sessions');const data=await res.json();
    _previewSessions=data.sessions||[];
    const sel=document.getElementById('im-preview-file');
    sel.innerHTML='<option value="">— auto-detect —</option>';
    _previewSessions.forEach((s,i)=>{const o=document.createElement('option');o.value=s.session_id;o.textContent=s.label+(i===0?' (latest)':'');sel.appendChild(o);});
  }catch(e){}
}
async function previewIndicator(){
  const name=document.getElementById('im-name').value.trim();
  const question=document.getElementById('im-question').value.trim();
  const stat=document.getElementById('im-stat').value;
  const parea=document.getElementById('im-preview-area');
  if(!name){parea.innerHTML='<span style="color:#dc2626;">Enter a name first.</span>';parea.style.color='';return;}
  const ind={name,stat,format:document.getElementById('im-format').value};
  if(question)ind.question=question;
  const fv=document.getElementById('im-filterval').value.trim();if(fv)ind.filter_value=fv;
  const dec=document.getElementById('im-decimals').value;if(dec!=='')ind.decimals=parseInt(dec);
  const dby=document.getElementById('im-dedup-by').value.trim();if(dby)ind.dedup_by=dby;
  parea.innerHTML='<span style="color:var(--muted);">Computing…</span>';parea.style.color='';
  const selSessionId=document.getElementById('im-preview-file').value||null;
  const selSessionInfo=selSessionId?_previewSessions.find(s=>s.session_id===selSessionId):null;
  const dataFile=selSessionInfo&&selSessionInfo.main_file?selSessionInfo.main_file:null;
  const sampleN=parseInt(document.getElementById('im-sample-n').value)||null;
  try{
    const res=await fetch('/api/indicators/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({indicator:ind,data_file:dataFile,sample_n:sampleN})});
    const data=await res.json();
    if(res.ok){
      const label=document.getElementById('im-label').value.trim()||name;
      parea.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;gap:4px;"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;">${label}</div><div style="font-size:28px;font-weight:700;color:var(--teal-dark);">${data.value}</div><div style="font-size:11px;color:var(--muted);">${data.n_rows.toLocaleString()} rows</div></div>`;
    }else{
      parea.innerHTML=`<span style="color:#dc2626;">${data.detail||'Preview failed'}</span>`;
    }
  }catch(e){parea.innerHTML=`<span style="color:#dc2626;">Error: ${e.message}</span>`;}
}
loadConfig();
loadDashboardState();
async function loadDashboardState(){
  try{
    const s=await(await fetch('/api/state')).json();
    applyCardState(s);
  }catch(e){}
}
function applyCardState(s){
  const rules={
    'fetch-questions': true,
    'download':        s.has_questions,
    'generate-template': s.has_questions && s.has_data,
    'suggest-charts':  s.has_questions && s.has_data,
    'build-report':    s.has_questions && s.has_data && s.has_templates,
  };
  document.querySelectorAll('.cmd-card[data-cmd]').forEach(card=>{
    const cmd=card.dataset.cmd;
    const enabled=rules[cmd]!==undefined?rules[cmd]:true;
    card.classList.toggle('disabled',!enabled);
  });
  // Mirror state to Templates tab action buttons
  const canGenTpl=!!(s.has_questions && s.has_data);
  const canAiTpl=!!(s.has_questions && s.has_data && s.has_ai);
  const btnGenTpl=document.getElementById('btn-generate-tpl');
  const btnAiTpl=document.getElementById('btn-ai-generate-tpl');
  if(btnGenTpl){
    btnGenTpl.disabled=!canGenTpl;
    btnGenTpl.title=canGenTpl?'':'Requires questions and downloaded data';
  }
  if(btnAiTpl){
    btnAiTpl.disabled=!canAiTpl;
    btnAiTpl.title=canAiTpl?'':'Requires questions, data, and AI configured';
  }
}
async function stopCmd(){
  try{
    await fetch('/api/stop',{method:'POST'});
    appendLog('■ Stopped by user','warning');
  }catch(e){}
}
function switchChartView(v){
  document.getElementById('cm-form-view').style.display=v==='form'?'block':'none';
  document.getElementById('cm-ai-view').style.display=v==='ai'?'block':'none';
  document.getElementById('cm-btn-form').classList.toggle('active',v==='form');
  document.getElementById('cm-btn-ai').classList.toggle('active',v==='ai');
}
async function askAiChart(){
  const prompt=document.getElementById('cm-ai-prompt').value.trim();
  if(!prompt){alert('Please describe the chart you want.');return;}
  const btn=document.getElementById('cm-ai-btn');
  const statusEl=document.getElementById('cm-ai-status');
  btn.disabled=true;statusEl.textContent='Thinking…';statusEl.style.color='var(--muted)';
  document.getElementById('cm-ai-result').style.display='none';
  try{
    const res=await fetch('/api/ai/suggest',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({kind:'chart',prompt,questions:_questions})});
    const data=await res.json();
    if(res.ok&&data.ok){
      document.getElementById('cm-ai-result-pre').textContent=JSON.stringify(data.result,null,2);
      document.getElementById('cm-ai-result').style.display='block';
      statusEl.textContent='';window._aiChartSuggestion=data.result;
      const warnEl=document.getElementById('cm-ai-warnings');
      if(data.result._warnings&&data.result._warnings.length){
        warnEl.innerHTML=data.result._warnings.map(w=>`<div>⚠ ${w}</div>`).join('');
        warnEl.style.display='block';
      }else{warnEl.style.display='none';}
    }else{statusEl.textContent='✗ '+(data.detail||'Failed');statusEl.style.color='#991b1b';}
  }catch(e){statusEl.textContent='✗ '+e.message;statusEl.style.color='#991b1b';}
  btn.disabled=false;
}
function acceptAiChart(){
  const s=window._aiChartSuggestion||{};
  if(s.type){document.getElementById('cm-type').value=s.type;updateChartForm();}
  if(s.name)document.getElementById('cm-name').value=s.name;
  if(s.title)document.getElementById('cm-title').value=s.title;
  if(s.questions){const inputs=document.querySelectorAll('.cm-q-input');s.questions.forEach((q,i)=>{if(inputs[i]){inputs[i].value=q;showColumnChoices(inputs[i]);}});}
  const o=s.options||{};
  if(o.width_inches)document.getElementById('cm-width').value=o.width_inches;
  if(o.color)document.getElementById('cm-color').value=o.color;
  if(o.top_n)document.getElementById('cm-topn').value=o.top_n;
  if(o.sort)document.getElementById('cm-sort').value=o.sort;
  if(o.normalize!==undefined)document.getElementById('cm-normalize').value=String(o.normalize);
  if(o.freq)document.getElementById('cm-freq').value=o.freq;
  if(o.bins)document.getElementById('cm-bins').value=o.bins;
  if(o.target)document.getElementById('cm-target').value=o.target;
  if(o.stat)document.getElementById('cm-stat-scorecard').value=o.stat;
  if(o.columns)document.getElementById('cm-columns').value=o.columns;
  if(o.male_value)document.getElementById('cm-male').value=o.male_value;
  if(o.female_value)document.getElementById('cm-female').value=o.female_value;
  if(o.color_by)document.getElementById('cm-colorby').value=o.color_by;
  if(o.xlabel)document.getElementById('cm-xlabel').value=o.xlabel;
  if(o.ylabel)document.getElementById('cm-ylabel').value=o.ylabel;
  if(o.distinct_by)document.getElementById('cm-distinct-by').value=o.distinct_by;
  if(o.expand_multi!==undefined)document.getElementById('cm-expand-multi').value=String(o.expand_multi);
  if(o.data_type)document.getElementById('cm-data-type').value=o.data_type;
  switchChartView('form');
  previewChart();
}
function switchIndicatorView(v){
  document.getElementById('im-form-view').style.display=v==='form'?'block':'none';
  document.getElementById('im-ai-view').style.display=v==='ai'?'block':'none';
  document.getElementById('im-btn-form').classList.toggle('active',v==='form');
  document.getElementById('im-btn-ai').classList.toggle('active',v==='ai');
}
async function askAiIndicator(){
  const prompt=document.getElementById('im-ai-prompt').value.trim();
  if(!prompt){alert('Please describe the indicator you want.');return;}
  const btn=document.getElementById('im-ai-btn');
  const statusEl=document.getElementById('im-ai-status');
  btn.disabled=true;statusEl.textContent='Thinking…';statusEl.style.color='var(--muted)';
  document.getElementById('im-ai-result').style.display='none';
  try{
    const res=await fetch('/api/ai/suggest',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({kind:'indicator',prompt,questions:_questions})});
    const data=await res.json();
    if(res.ok&&data.ok){
      document.getElementById('im-ai-result-pre').textContent=JSON.stringify(data.result,null,2);
      document.getElementById('im-ai-result').style.display='block';
      statusEl.textContent='';window._aiIndicatorSuggestion=data.result;
    }else{statusEl.textContent='✗ '+(data.detail||'Failed');statusEl.style.color='#991b1b';}
  }catch(e){statusEl.textContent='✗ '+e.message;statusEl.style.color='#991b1b';}
  btn.disabled=false;
}
function acceptAiIndicator(){
  const s=window._aiIndicatorSuggestion||{};
  if(s.name)document.getElementById('im-name').value=s.name;
  if(s.label)document.getElementById('im-label').value=s.label;
  if(s.question)document.getElementById('im-question').value=s.question;
  if(s.stat){document.getElementById('im-stat').value=s.stat;updateIndicatorForm();}
  if(s.filter_value)document.getElementById('im-filterval').value=s.filter_value;
  if(s.format)document.getElementById('im-format').value=s.format;
  if(s.decimals!==undefined)document.getElementById('im-decimals').value=s.decimals;
  if(s.dedup_by)document.getElementById('im-dedup-by').value=s.dedup_by;
  switchIndicatorView('form');
}
// ── Summaries ─────────────────────────────────────────────────────────────────
function renderSummariesList(){
  const c=document.getElementById('summaries-list');
  if(!_summaries.length){c.innerHTML='<p class="empty-state" style="padding:12px 0 4px;">No summaries configured.</p>';return;}
  c.innerHTML=_summaries.map((s,i)=>`<div class="ind-row">
    <span class="ind-name">${s.name||''}</span>
    <span class="ind-meta">${s.label||''} · ${s.stat||''} of ${(s.questions||[]).join(', ')}</span>
    <button class="btn btn-ghost btn-sm" onclick="openSummaryModal(${i})">Edit</button>
    <button class="btn btn-danger btn-sm" onclick="deleteSummary(${i})">Delete</button>
  </div>`).join('');
}
function deleteSummary(i){if(!confirm('Delete summary "'+(_summaries[i]||{}).name+'"?'))return;_summaries.splice(i,1);renderSummariesList();}
function updateSummaryForm(){
  const stat=document.getElementById('sm-stat').value;
  document.getElementById('sm-question2-row').style.display=(stat==='crosstab'||stat==='trend')?'flex':'none';
  document.getElementById('sm-topn-row').style.display=(stat==='distribution'||stat==='crosstab')?'flex':'none';
  document.getElementById('sm-freq-row').style.display=stat==='trend'?'flex':'none';
  document.getElementById('sm-prompt-row').style.display=stat==='ai'?'flex':'none';
  document.getElementById('sm-example-row').style.display=stat==='ai'?'flex':'none';
  document.getElementById('sm-language-row').style.display=stat==='ai'?'flex':'none';
}
async function loadSummaryPreviewFileOptions(){
  try{
    const res=await fetch('/api/data/sessions');const data=await res.json();
    _previewSessions=data.sessions||[];
    const sel=document.getElementById('sm-preview-file');
    sel.innerHTML='<option value="">— auto-detect —</option>';
    _previewSessions.forEach((s,i)=>{const o=document.createElement('option');o.value=s.session_id;o.textContent=s.label+(i===0?' (latest)':'');sel.appendChild(o);});
  }catch(e){}
}
function openSummaryModal(idx){
  _editSumIdx=idx;
  switchSummaryView('form');
  document.getElementById('sm-ai-prompt').value='';
  document.getElementById('sm-ai-result').style.display='none';
  ['sm-name','sm-label','sm-question1','sm-question2','sm-topn','sm-language'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('sm-prompt').value='';
  document.getElementById('sm-example').value='';
  document.getElementById('sm-stat').value='distribution';
  document.getElementById('sm-freq').value='month';
  document.getElementById('sm-modal-title').textContent=idx===null?'Add summary':'Edit summary';
  document.getElementById('sm-preview-area').textContent='Click Preview to compute the summary text.';
  document.getElementById('sm-preview-area').style.color='var(--muted)';
  loadSummaryPreviewFileOptions();
  updateSummaryForm();
  if(idx!==null){
    const s=_summaries[idx];
    document.getElementById('sm-name').value=s.name||'';
    document.getElementById('sm-label').value=s.label||'';
    document.getElementById('sm-stat').value=s.stat||'distribution';
    const qs=s.questions||[];
    document.getElementById('sm-question1').value=qs[0]||'';
    document.getElementById('sm-question2').value=qs[1]||'';
    document.getElementById('sm-topn').value=s.top_n||'';
    document.getElementById('sm-freq').value=s.freq||'month';
    document.getElementById('sm-prompt').value=s.prompt||'';
    document.getElementById('sm-example').value=s.example||'';
    document.getElementById('sm-language').value=s.language||'';
    updateSummaryForm();
  }
  document.getElementById('summary-modal').style.display='flex';
}
function closeSummaryModal(){document.getElementById('summary-modal').style.display='none';}
function saveSummaryFromModal(){
  const name=document.getElementById('sm-name').value.trim();
  if(!name){alert('Summary name is required');return;}
  const stat=document.getElementById('sm-stat').value;
  const q1=document.getElementById('sm-question1').value.trim();
  const q2=document.getElementById('sm-question2').value.trim();
  const questions=q2?[q1,q2]:(q1?[q1]:[]);
  const s={name,stat,questions};
  const lbl=document.getElementById('sm-label').value.trim();if(lbl)s.label=lbl;
  const topn=document.getElementById('sm-topn').value;if(topn!=='')s.top_n=parseInt(topn);
  if(stat==='trend')s.freq=document.getElementById('sm-freq').value;
  if(stat==='ai'){
    const pr=document.getElementById('sm-prompt').value.trim();if(pr)s.prompt=pr;
    const ex=document.getElementById('sm-example').value.trim();if(ex)s.example=ex;
    const lg=document.getElementById('sm-language').value.trim();if(lg)s.language=lg;
  }
  if(_editSumIdx===null)_summaries.push(s);
  else _summaries[_editSumIdx]=s;
  renderSummariesList();
  closeSummaryModal();
}
function switchSummaryView(v){
  document.getElementById('sm-form-view').style.display=v==='form'?'block':'none';
  document.getElementById('sm-ai-view').style.display=v==='ai'?'block':'none';
  document.getElementById('sm-btn-form').classList.toggle('active',v==='form');
  document.getElementById('sm-btn-ai').classList.toggle('active',v==='ai');
}
async function askAiSummary(){
  const prompt=document.getElementById('sm-ai-prompt').value.trim();
  if(!prompt){alert('Please describe the summary you want.');return;}
  const btn=document.getElementById('sm-ai-btn');
  const statusEl=document.getElementById('sm-ai-status');
  btn.disabled=true;statusEl.textContent='Thinking…';statusEl.style.color='var(--muted)';
  document.getElementById('sm-ai-result').style.display='none';
  try{
    const res=await fetch('/api/ai/suggest',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({kind:'summary',prompt,questions:_questions})});
    const data=await res.json();
    if(res.ok&&data.ok){
      document.getElementById('sm-ai-result-pre').textContent=JSON.stringify(data.result,null,2);
      document.getElementById('sm-ai-result').style.display='block';
      statusEl.textContent='';window._aiSummarySuggestion=data.result;
    }else{statusEl.textContent='✗ '+(data.detail||'Failed');statusEl.style.color='#991b1b';}
  }catch(e){statusEl.textContent='✗ '+e.message;statusEl.style.color='#991b1b';}
  btn.disabled=false;
}
function acceptAiSummary(){
  const s=window._aiSummarySuggestion||{};
  if(s.name)document.getElementById('sm-name').value=s.name;
  if(s.label)document.getElementById('sm-label').value=s.label;
  if(s.stat){document.getElementById('sm-stat').value=s.stat;updateSummaryForm();}
  const qs=s.questions||[];
  document.getElementById('sm-question1').value=qs[0]||'';
  document.getElementById('sm-question2').value=qs[1]||'';
  if(s.top_n!==undefined)document.getElementById('sm-topn').value=s.top_n;
  if(s.freq)document.getElementById('sm-freq').value=s.freq;
  if(s.prompt)document.getElementById('sm-prompt').value=s.prompt;
  if(s.language)document.getElementById('sm-language').value=s.language;
  switchSummaryView('form');
}
async function previewSummary(){
  const name=document.getElementById('sm-name').value.trim();
  const parea=document.getElementById('sm-preview-area');
  if(!name){parea.style.color='#dc2626';parea.textContent='Enter a name first.';return;}
  const stat=document.getElementById('sm-stat').value;
  const q1=document.getElementById('sm-question1').value.trim();
  const q2=document.getElementById('sm-question2').value.trim();
  const questions=q2?[q1,q2]:(q1?[q1]:[]);
  const s={name,stat,questions};
  const topn=document.getElementById('sm-topn').value;if(topn!=='')s.top_n=parseInt(topn);
  if(stat==='trend')s.freq=document.getElementById('sm-freq').value;
  if(stat==='ai'){
    const pr=document.getElementById('sm-prompt').value.trim();if(pr)s.prompt=pr;
    const ex=document.getElementById('sm-example').value.trim();if(ex)s.example=ex;
    const lg=document.getElementById('sm-language').value.trim();if(lg)s.language=lg;
  }
  parea.style.color='var(--muted)';parea.textContent='Computing…';
  const selSessionId=document.getElementById('sm-preview-file').value||null;
  const selSessionInfo=selSessionId?_previewSessions.find(s=>s.session_id===selSessionId):null;
  const dataFile=selSessionInfo&&selSessionInfo.main_file?selSessionInfo.main_file:null;
  const sampleN=parseInt(document.getElementById('sm-sample-n').value)||null;
  try{
    const res=await fetch('/api/summaries/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({summary:s,data_file:dataFile,sample_n:sampleN})});
    const data=await res.json();
    if(res.ok){
      parea.style.color='var(--text)';
      parea.textContent=data.text;
    }else{
      parea.style.color='#dc2626';parea.textContent=data.detail||'Preview failed';
    }
  }catch(e){parea.style.color='#dc2626';parea.textContent='Error: '+e.message;}
}
async function openAiTemplateModal(){
  if(running){toast('A command is already running','err');return;}
  document.getElementById('ai-tpl-modal').style.display='flex';
  try{
    const res=await fetch('/api/config');
    const data=await res.json();
    const cfg=data.exists?jsyaml.load(data.content)||{}:{};
    _renderAiTplVars(cfg);
    // Pre-fill context from gen-tpl modal if already filled there
    const existingCtx=document.getElementById('gen-tpl-context')?.value||'';
    const existingSmry=document.getElementById('gen-tpl-summary-prompt')?.value||'';
    if(existingCtx&&!document.getElementById('ai-tpl-context').value)
      document.getElementById('ai-tpl-context').value=existingCtx;
    if(existingSmry&&!document.getElementById('ai-tpl-summary-prompt').value)
      document.getElementById('ai-tpl-summary-prompt').value=existingSmry;
  }catch(e){
    document.getElementById('ai-tpl-vars').innerHTML='<span style="color:var(--muted);font-size:11px;">Could not load config.</span>';
  }
}
function _renderAiTplVars(cfg){
  // Reuse same render logic as gen-tpl modal but target ai-tpl-vars
  const charts=(cfg.charts||[]);
  const summaries=(cfg.summaries||[]);
  const indicators=(cfg.indicators||[]);
  const container=document.getElementById('ai-tpl-vars');
  let html='';
  if(!charts.length&&!summaries.length&&!indicators.length){
    html='<span style="color:#dc2626;font-size:11px;">No charts, summaries, or indicators configured. Add them in Config for a richer AI template.</span>';
    container.innerHTML=html;return;
  }
  if(charts.length){
    html+='<div style="margin-bottom:8px;">';
    html+='<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Charts ('+charts.length+')</div>';
    html+='<div style="display:flex;flex-wrap:wrap;gap:4px;">'+charts.map(c=>`<span class="var-tag used" title="${c.title||''}">${c.name} <span style="opacity:.6">(${c.type||''})</span></span>`).join('')+'</div>';
    html+='</div>';
  }
  if(summaries.length){
    html+='<div style="margin-bottom:8px;">';
    html+='<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Summaries ('+summaries.length+')</div>';
    html+='<div style="display:flex;flex-wrap:wrap;gap:4px;">'+summaries.map(s=>`<span class="var-tag used" title="${s.label||''}">${s.name}</span>`).join('')+'</div>';
    html+='</div>';
  }
  if(indicators.length){
    html+='<div style="margin-bottom:8px;">';
    html+='<div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px;">Indicators ('+indicators.length+')</div>';
    html+='<div style="display:flex;flex-wrap:wrap;gap:4px;">'+indicators.map(i=>`<span class="var-tag used" title="${i.label||''}">${i.name}</span>`).join('')+'</div>';
    html+='</div>';
  }
  container.innerHTML=html;
}
function closeAiTemplateModal(){document.getElementById('ai-tpl-modal').style.display='none';}
async function runAiGenerateTemplate(){
  if(running){toast('A command is already running','err');return;}
  const context=document.getElementById('ai-tpl-context').value.trim();
  if(!context){alert('Please enter a background & context description for the report.');return;}
  const summaryPrompt=document.getElementById('ai-tpl-summary-prompt').value.trim();
  const pages=parseInt(document.getElementById('ai-tpl-pages').value)||10;
  const language=document.getElementById('ai-tpl-lang').value.trim()||'English';
  closeAiTemplateModal();
  running=true;setDot('running');
  const activeCard=document.querySelector('.cmd-card[data-cmd="ai-generate-template"]');
  if(activeCard)activeCard.classList.add('running');
  document.getElementById('status-label').textContent='ai-generate-template';
  document.getElementById('log-body').innerHTML='';
  document.getElementById('log-title').textContent='Running: ai-generate-template';
  document.querySelectorAll('.tab,.tab-content').forEach(el=>el.classList.remove('active'));
  document.querySelector('[data-tab="dashboard"]').classList.add('active');
  document.getElementById('tab-dashboard').classList.add('active');
  const body={description:context,pages,language,context};
  if(summaryPrompt)body.summary_prompt=summaryPrompt;
  try{
    const res=await fetch('/api/run/ai-generate-template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const reader=res.body.getReader();const dec=new TextDecoder();let buf='';
    while(true){
      const{done,value}=await reader.read();if(done)break;
      buf+=dec.decode(value,{stream:true});
      const parts=buf.split('\n\n');buf=parts.pop();
      for(const part of parts){
        const lines=part.trim().split('\n');let ev='message',data='';
        for(const l of lines){if(l.startsWith('event: '))ev=l.slice(7);if(l.startsWith('data: '))data=l.slice(6);}
        if(!data)continue;const p=JSON.parse(data);
        if(ev==='log')appendLog(p.line,p.level||'info');
        if(ev==='status'&&p.status!=='running'){
          setDot(p.status);
          document.getElementById('log-title').textContent='ai-generate-template — '+p.status;
          document.getElementById('status-label').textContent=p.status==='success'?'✓ done':'✗ error';
          running=false;
          if(p.status==='success'){toast('AI template generated — check Templates tab','ok');loadDashboardState();}
          else toast('Generation failed — check logs','err');
        }
        else if(ev==='done')running=false;
      }
    }
  }catch(e){}
  running=false;
  if(activeCard)activeCard.classList.remove('running');
}
</script>
<!-- Chart modal -->
<div id="chart-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)closeChartModal()">
  <div class="modal" style="width:660px;max-height:92vh;display:flex;flex-direction:column;">
    <div class="modal-header">
      <h3 id="chart-modal-title">Add chart</h3>
      <div class="config-view-toggle" style="margin-right:8px;">
        <button class="view-btn active" id="cm-btn-form" onclick="switchChartView('form')">Form</button>
        <button class="view-btn" id="cm-btn-ai" onclick="switchChartView('ai')">AI</button>
      </div>
      <button onclick="closeChartModal()">✕</button>
    </div>
    <div id="cm-form-view" style="overflow-y:auto;flex:1;padding:18px;">
      <div class="form-row"><label>Name</label><input id="cm-name" placeholder="e.g. satisfaction_overview"></div>
      <div class="form-row"><label>Title</label><input id="cm-title" placeholder="e.g. Overall satisfaction"></div>
      <div class="form-row"><label>Type</label>
        <select id="cm-type" onchange="updateChartForm()">
          <option value="bar">bar</option><option value="horizontal_bar">horizontal_bar</option>
          <option value="stacked_bar">stacked_bar</option><option value="grouped_bar">grouped_bar</option>
          <option value="pie">pie</option><option value="donut">donut</option>
          <option value="line">line</option><option value="area">area</option>
          <option value="histogram">histogram</option><option value="scatter">scatter</option>
          <option value="box_plot">box_plot</option><option value="heatmap">heatmap</option>
          <option value="treemap">treemap</option><option value="waterfall">waterfall</option>
          <option value="funnel">funnel</option><option value="table">table</option>
          <option value="bullet_chart">bullet_chart</option><option value="likert">likert</option>
          <option value="scorecard">scorecard</option><option value="pyramid">pyramid</option>
          <option value="dot_map">dot_map</option>
        </select>
      </div>
      <div id="cm-type-hint" style="font-size:11px;color:var(--muted);margin:-4px 0 10px 100px;font-style:italic;"></div>
      <div id="cm-questions-wrap"></div>
      <div class="modal-body"><h4>Options</h4></div>
      <div class="form-row"><label>Width (in)</label><input id="cm-width" type="number" step="0.5" placeholder="5.5 (default)"></div>
      <div class="form-row" id="cm-color-row"><label>Color</label><div style="display:flex;gap:6px;align-items:center;flex:1;"><input type="color" id="cm-color-picker" value="#1D9E75" oninput="document.getElementById('cm-color').value=this.value" style="width:36px;height:28px;padding:2px;border:1px solid var(--border);border-radius:4px;cursor:pointer;flex-shrink:0;"><input id="cm-color" type="text" placeholder="#1D9E75" style="flex:1;" oninput="if(/^#[0-9A-Fa-f]{6}$/.test(this.value))document.getElementById('cm-color-picker').value=this.value"></div></div>
      <div class="form-row" id="cm-topn-row"><label>top_n</label><input id="cm-topn" type="number" placeholder="15 (default)"></div>
      <div class="form-row" id="cm-sort-row"><label>Sort</label><select id="cm-sort"><option value="">default (value)</option><option value="value">value</option><option value="label">label</option><option value="none">none</option></select></div>
      <div class="form-row" id="cm-normalize-row"><label>Normalize</label><select id="cm-normalize"><option value="">no</option><option value="true">yes (100% stacked)</option></select></div>
      <div class="form-row" id="cm-freq-row"><label>Freq</label><select id="cm-freq"><option value="">auto</option><option value="day">day</option><option value="week">week</option><option value="month">month</option><option value="year">year</option></select></div>
      <div class="form-row" id="cm-bins-row"><label>Bins</label><input id="cm-bins" type="number" placeholder="15"></div>
      <div class="form-row" id="cm-target-row"><label>Target *</label><input id="cm-target" type="number" placeholder="required — your indicator target"></div>
      <div class="form-row" id="cm-stat-row"><label>Stat</label><select id="cm-stat-scorecard"><option value="count">count</option><option value="mean">mean</option><option value="sum">sum</option></select></div>
      <div class="form-row" id="cm-columns-row"><label>Columns</label><input id="cm-columns" type="number" placeholder="3 (cards per row)"></div>
      <div class="form-row" id="cm-male-row"><label>Male value</label><input id="cm-male" placeholder="e.g. Male"></div>
      <div class="form-row" id="cm-female-row"><label>Female value</label><input id="cm-female" placeholder="e.g. Female"></div>
      <div class="form-row" id="cm-colorby-row"><label>Color by</label><input id="cm-colorby" placeholder="column name (optional)"></div>
      <div class="form-row" id="cm-xlabel-row"><label>xlabel</label><input id="cm-xlabel" placeholder="optional axis label"></div>
      <div class="form-row" id="cm-ylabel-row"><label>ylabel</label><input id="cm-ylabel" placeholder="optional axis label"></div>
      <div class="form-row" id="cm-distinct-by-row"><label>Distinct by</label><input id="cm-distinct-by" placeholder="column to deduplicate rows (optional)"></div>
      <div class="form-row" id="cm-expand-multi-row"><label>Expand multi</label><select id="cm-expand-multi"><option value="">no</option><option value="true">yes — split multi-select choices</option></select></div>
      <div class="form-row" id="cm-data-type-row"><label>Data type</label><select id="cm-data-type"><option value="">auto-detect</option><option value="categorical">categorical</option><option value="quantitative">quantitative</option><option value="date">date</option><option value="qualitative">qualitative</option></select></div>
      <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          <span style="font-size:12px;font-weight:600;">Preview</span>
          <select id="cm-preview-file" style="font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;flex:1;max-width:220px;"><option value="">— auto-detect —</option></select>
          <input id="cm-sample-n" type="number" min="1" placeholder="rows" title="Sample N rows for preview" style="width:70px;font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;">
          <button class="btn btn-ghost btn-sm" onclick="previewChart()">▶ Preview</button>
        </div>
        <div id="cm-preview-area" style="text-align:center;color:var(--muted);font-size:12px;min-height:40px;">Select a data file (or leave blank for auto-detect) and click Preview.</div>
      </div>
    </div>
    <div id="cm-ai-view" style="display:none;padding:18px;overflow-y:auto;flex:1;">
      <p style="font-size:12px;color:var(--muted);margin-bottom:10px;">Describe the chart you want in plain language. The AI will suggest a configuration based on your available columns.</p>
      <textarea id="cm-ai-prompt" rows="4" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:4px;font-size:12px;resize:vertical;" placeholder="e.g. Show satisfaction responses by region, horizontal bar, top 10, sorted by value"></textarea>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
        <button class="btn btn-primary btn-sm" id="cm-ai-btn" onclick="askAiChart()">✦ Ask AI</button>
        <span id="cm-ai-status" style="font-size:12px;color:var(--muted);"></span>
      </div>
      <div id="cm-ai-result" style="display:none;margin-top:14px;border:1px solid var(--border);border-radius:var(--radius);padding:12px;background:var(--bg);font-size:12px;">
        <div style="font-weight:600;margin-bottom:6px;color:var(--teal-dark);">AI suggestion — review then accept</div>
        <pre id="cm-ai-result-pre" style="font-size:11px;color:var(--muted);white-space:pre-wrap;word-break:break-all;margin-bottom:10px;"></pre>
        <div id="cm-ai-warnings" style="display:none;margin-bottom:10px;padding:8px 10px;background:#fffbeb;border:1px solid #fcd34d;border-radius:4px;font-size:11px;color:#b45309;line-height:1.6;"></div>
        <button class="btn btn-primary btn-sm" onclick="acceptAiChart()">✓ Accept &amp; populate form</button>
      </div>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;">
      <button class="btn btn-ghost btn-sm" onclick="closeChartModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="saveChartFromModal()">Save chart</button>
    </div>
  </div>
</div>
<!-- Quick preview modal -->
<div id="quick-preview-modal" class="modal-overlay" style="display:none;align-items:center;justify-content:center;" onclick="if(event.target===this)this.style.display='none'">
  <div class="modal" style="width:700px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;">
    <div class="modal-header">
      <h3 id="qp-title" style="font-size:14px;"></h3>
      <button onclick="document.getElementById('quick-preview-modal').style.display='none'">✕</button>
    </div>
    <div style="padding:16px;overflow-y:auto;text-align:center;" id="qp-area">
      <span style="color:var(--muted);">Loading…</span>
    </div>
  </div>
</div>
<!-- Indicator modal -->
<div id="indicator-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)closeIndicatorModal()">
  <div class="modal" style="width:480px;">
    <div class="modal-header">
      <h3 id="ind-modal-title">Add indicator</h3>
      <div class="config-view-toggle" style="margin-right:8px;">
        <button class="view-btn active" id="im-btn-form" onclick="switchIndicatorView('form')">Form</button>
        <button class="view-btn" id="im-btn-ai" onclick="switchIndicatorView('ai')">AI</button>
      </div>
      <button onclick="closeIndicatorModal()">✕</button>
    </div>
    <div id="im-form-view" class="modal-body">
      <div class="form-row"><label>Name</label><input id="im-name" placeholder="e.g. total_beneficiaries"></div>
      <div class="form-row"><label>Label</label><input id="im-label" placeholder="e.g. Total beneficiaries"></div>
      <div class="form-row"><label>Question</label><input id="im-question" placeholder="export_label of column"></div>
      <div class="form-row"><label>Stat</label>
        <select id="im-stat" onchange="updateIndicatorForm()">
          <option value="count">count — non-null rows</option>
          <option value="sum">sum</option><option value="mean">mean</option>
          <option value="median">median</option><option value="min">min</option>
          <option value="max">max</option>
          <option value="percent">percent — % where value = filter</option>
          <option value="most_common">most_common — top value</option>
          <option value="count_distinct">count_distinct — unique values (e.g. 20 communes)</option>
        </select>
      </div>
      <div class="form-row" id="im-filterval-row" style="display:none;"><label>Filter value</label><input id="im-filterval" placeholder="e.g. Female (required for percent)"></div>
      <div class="form-row"><label>Format</label>
        <select id="im-format">
          <option value="number">number → 4,832</option>
          <option value="decimal">decimal → 4.2</option>
          <option value="percent">percent → 58.3%</option>
          <option value="text">text</option>
        </select>
      </div>
      <div class="form-row"><label>Decimals</label><input id="im-decimals" type="number" placeholder="1" min="0" max="6" style="max-width:80px;"></div>
      <div class="form-row"><label>Dedup by</label><input id="im-dedup-by" placeholder="column to deduplicate rows (optional)"></div>
      <div class="form-row" style="align-items:center;"><label>Data file</label><select id="im-preview-file" style="flex:1;padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;"><option value="">— auto-detect —</option></select><input id="im-sample-n" type="number" min="1" placeholder="rows" title="Sample N rows for preview" style="width:70px;margin-left:6px;padding:5px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;"></div>
      <div id="im-preview-area" style="margin-top:8px;min-height:48px;display:flex;align-items:center;justify-content:center;border:1px dashed var(--border);border-radius:6px;padding:12px;font-size:13px;color:var(--muted);text-align:center;">Click Preview to compute the indicator value.</div>
    </div>
    <div id="im-ai-view" style="display:none;padding:18px;">
      <p style="font-size:12px;color:var(--muted);margin-bottom:10px;">Describe the indicator you need. The AI will suggest a configuration using your available columns.</p>
      <textarea id="im-ai-prompt" rows="3" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:4px;font-size:12px;resize:vertical;" placeholder="e.g. Percentage of female respondents, or most common region, or total count of beneficiaries"></textarea>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
        <button class="btn btn-primary btn-sm" id="im-ai-btn" onclick="askAiIndicator()">✦ Ask AI</button>
        <span id="im-ai-status" style="font-size:12px;color:var(--muted);"></span>
      </div>
      <div id="im-ai-result" style="display:none;margin-top:14px;border:1px solid var(--border);border-radius:var(--radius);padding:12px;background:var(--bg);font-size:12px;">
        <div style="font-weight:600;margin-bottom:6px;color:var(--teal-dark);">AI suggestion — review then accept</div>
        <pre id="im-ai-result-pre" style="font-size:11px;color:var(--muted);white-space:pre-wrap;word-break:break-all;margin-bottom:10px;"></pre>
        <button class="btn btn-primary btn-sm" onclick="acceptAiIndicator()">✓ Accept &amp; populate form</button>
      </div>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;">
      <button class="btn btn-ghost btn-sm" onclick="closeIndicatorModal()">Cancel</button>
      <button class="btn btn-ghost btn-sm" onclick="previewIndicator()">Preview</button>
      <button class="btn btn-primary btn-sm" onclick="saveIndicatorFromModal()">Save indicator</button>
    </div>
  </div>
</div>
<div id="summary-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)closeSummaryModal()">
  <div class="modal" style="width:480px;">
    <div class="modal-header">
      <h3 id="sm-modal-title">Add summary</h3>
      <div class="config-view-toggle" style="margin-right:8px;">
        <button class="view-btn active" id="sm-btn-form" onclick="switchSummaryView('form')">Form</button>
        <button class="view-btn" id="sm-btn-ai" onclick="switchSummaryView('ai')">AI</button>
      </div>
      <button onclick="closeSummaryModal()">✕</button>
    </div>
    <div id="sm-form-view" class="modal-body">
      <div class="form-row"><label>Name</label><input id="sm-name" placeholder="e.g. region_breakdown"></div>
      <div class="form-row"><label>Label</label><input id="sm-label" placeholder="e.g. Region breakdown (optional)"></div>
      <div class="form-row"><label>Stat</label>
        <select id="sm-stat" onchange="updateSummaryForm()">
          <option value="distribution">distribution — top-N breakdown of one categorical column</option>
          <option value="stats">stats — descriptive stats for one numeric column</option>
          <option value="crosstab">crosstab — row × column breakdown (two categoricals)</option>
          <option value="trend">trend — time-series count/sum over a date column</option>
          <option value="ai">ai — AI-generated paragraph</option>
        </select>
      </div>
      <div class="form-row"><label>Column 1</label><input id="sm-question1" placeholder="export_label of column"></div>
      <div class="form-row" id="sm-question2-row" style="display:none;"><label>Column 2</label><input id="sm-question2" placeholder="second column (export_label)"></div>
      <div class="form-row" id="sm-topn-row"><label>Top N</label><input id="sm-topn" type="number" placeholder="5" min="1" max="50" style="max-width:80px;"></div>
      <div class="form-row" id="sm-freq-row" style="display:none;"><label>Frequency</label>
        <select id="sm-freq">
          <option value="month">month</option>
          <option value="week">week</option>
          <option value="day">day</option>
          <option value="year">year</option>
        </select>
      </div>
      <div class="form-row" id="sm-prompt-row" style="display:none;align-items:flex-start;"><label style="padding-top:4px;">Prompt</label><textarea id="sm-prompt" rows="3" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;resize:vertical;" placeholder="e.g. Focus on gender gaps and regional disparities"></textarea></div>
      <div class="form-row" id="sm-example-row" style="display:none;align-items:flex-start;"><label style="padding-top:4px;">Example</label><textarea id="sm-example" rows="3" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;resize:vertical;" placeholder="Paste an example paragraph to guide the AI tone and structure (numbers will not be copied)"></textarea></div>
      <div class="form-row" id="sm-language-row" style="display:none;"><label>Language</label><input id="sm-language" placeholder="e.g. English, French (optional)"></div>
      <div style="margin-top:8px;display:flex;align-items:center;gap:8px;"><label style="font-size:11px;color:var(--muted);">Data file</label><select id="sm-preview-file" style="flex:1;padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;"><option value="">— auto-detect —</option></select><input id="sm-sample-n" type="number" min="1" placeholder="rows" title="Sample N rows for preview" style="width:70px;padding:5px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;"></div>
      <div id="sm-preview-area" style="margin-top:10px;min-height:48px;display:flex;align-items:center;justify-content:center;border:1px dashed var(--border);border-radius:6px;padding:12px;font-size:13px;color:var(--muted);text-align:center;">Click Preview to compute the summary text.</div>
    </div>
    <div id="sm-ai-view" style="display:none;padding:18px;">
      <p style="font-size:12px;color:var(--muted);margin-bottom:10px;">Describe the summary you need. The AI will suggest a configuration using your available columns.</p>
      <textarea id="sm-ai-prompt" rows="3" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:4px;font-size:12px;resize:vertical;" placeholder="e.g. Distribution of regions, or trend of submissions per month, or crosstab of region vs gender"></textarea>
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center;">
        <button class="btn btn-primary btn-sm" id="sm-ai-btn" onclick="askAiSummary()">✦ Ask AI</button>
        <span id="sm-ai-status" style="font-size:12px;color:var(--muted);"></span>
      </div>
      <div id="sm-ai-result" style="display:none;margin-top:14px;border:1px solid var(--border);border-radius:var(--radius);padding:12px;background:var(--bg);font-size:12px;">
        <div style="font-weight:600;margin-bottom:6px;color:var(--teal-dark);">AI suggestion — review then accept</div>
        <pre id="sm-ai-result-pre" style="font-size:11px;color:var(--muted);white-space:pre-wrap;word-break:break-all;margin-bottom:10px;"></pre>
        <button class="btn btn-primary btn-sm" onclick="acceptAiSummary()">✓ Accept &amp; populate form</button>
      </div>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;">
      <button class="btn btn-ghost btn-sm" onclick="closeSummaryModal()">Cancel</button>
      <button class="btn btn-ghost btn-sm" onclick="previewSummary()">Preview</button>
      <button class="btn btn-primary btn-sm" onclick="saveSummaryFromModal()">Save summary</button>
    </div>
  </div>
</div>
<div id="gen-tpl-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)closeGenTplModal()">
  <div class="modal" style="width:560px;max-height:90vh;display:flex;flex-direction:column;">
    <div class="modal-header"><h3>Generate Template</h3><button onclick="closeGenTplModal()">✕</button></div>
    <div class="modal-body" style="overflow-y:auto;flex:1;">
      <div class="form-row" style="align-items:flex-start;">
        <label style="padding-top:4px;min-width:130px;">Background &amp; context</label>
        <textarea id="gen-tpl-context" rows="3" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;resize:vertical;" placeholder="Humanitarian monitoring report for a nutrition program in the Sahel region. Covers beneficiary reach, food security, and geographic distribution across three target zones."></textarea>
      </div>
      <div class="form-row" style="align-items:flex-start;margin-top:10px;">
        <label style="padding-top:4px;min-width:130px;">Executive summary prompt</label>
        <textarea id="gen-tpl-summary-prompt" rows="2" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;resize:vertical;" placeholder="Summarize key findings, coverage rates, and any critical gaps observed this quarter."></textarea>
      </div>
      <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;">
        <div style="font-size:11px;font-weight:600;color:var(--fg);margin-bottom:8px;">Variables included in this template</div>
        <div id="gen-tpl-vars" style="font-size:11px;"><span style="color:var(--muted);">Loading…</span></div>
        <p style="font-size:10px;color:var(--muted);margin-top:8px;">All variables from your config will be placed as placeholders in the generated .docx. Edit charts, summaries, or indicators in Config to change this list.</p>
      </div>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;">
      <button class="btn btn-ghost btn-sm" onclick="closeGenTplModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="runGenTpl()">▶ Generate</button>
    </div>
  </div>
</div>
<div id="ai-tpl-modal" class="modal-overlay" style="display:none;" onclick="if(event.target===this)closeAiTemplateModal()">
  <div class="modal" style="width:580px;max-height:90vh;display:flex;flex-direction:column;">
    <div class="modal-header"><h3>✦ AI Generate Template</h3><button onclick="closeAiTemplateModal()">✕</button></div>
    <div class="modal-body" style="overflow-y:auto;flex:1;">
      <div class="form-row" style="align-items:flex-start;">
        <label style="padding-top:4px;min-width:140px;">Background &amp; context</label>
        <textarea id="ai-tpl-context" rows="3" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;resize:vertical;" placeholder="Humanitarian monitoring report for a nutrition program in the Sahel region. Covers beneficiary reach, food security, and geographic distribution across three target zones."></textarea>
      </div>
      <div class="form-row" style="align-items:flex-start;margin-top:8px;">
        <label style="padding-top:4px;min-width:140px;">Executive summary prompt</label>
        <textarea id="ai-tpl-summary-prompt" rows="2" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;resize:vertical;" placeholder="Summarize key findings, coverage rates, and any critical gaps observed this quarter."></textarea>
      </div>
      <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px;">
        <div style="font-size:11px;font-weight:600;color:var(--fg);margin-bottom:8px;">Variables the AI will use</div>
        <div id="ai-tpl-vars" style="font-size:11px;"><span style="color:var(--muted);">Loading…</span></div>
        <p style="font-size:10px;color:var(--muted);margin-top:6px;">The AI will place each of these into a contextually appropriate section. Add or edit charts, summaries, and indicators in Config first.</p>
      </div>
      <div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px;display:flex;gap:16px;flex-wrap:wrap;">
        <div class="form-row" style="margin:0;flex:0 0 auto;gap:6px;">
          <label style="min-width:unset;">Pages</label>
          <input id="ai-tpl-pages" type="number" min="2" max="50" value="10" style="width:64px;">
          <span style="font-size:11px;color:var(--muted);">target</span>
        </div>
        <div class="form-row" style="margin:0;flex:0 0 auto;gap:6px;">
          <label style="min-width:unset;">Language</label>
          <input id="ai-tpl-lang" type="text" value="English" placeholder="English" style="width:100px;">
        </div>
      </div>
      <p style="font-size:10px;color:var(--muted);margin-top:10px;">Output saved as <code>ai_report_template.docx</code>. Requires <code>ai:</code> section in config.yml.</p>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;">
      <button class="btn btn-ghost btn-sm" onclick="closeAiTemplateModal()">Cancel</button>
      <button class="btn btn-primary btn-sm" onclick="runAiGenerateTemplate()">✦ Generate</button>
    </div>
  </div>
</div>
</body>
</html>
HTMLEOF

RUN mkdir -p data/raw data/processed data/processed/charts reports templates references

COPY sample.config.yml ./sample.config.yml

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
EXPOSE 8000

CMD ["sh", "-c", "if [ ! -f config.yml ]; then cp sample.config.yml config.yml; fi && exec uvicorn web.main:app --host 0.0.0.0 --port 8000"]