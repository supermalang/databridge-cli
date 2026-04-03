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
import asyncio, json, os, sys
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
    "fetch-questions":   [],
    "generate-template": [],
    "download":          ["--sample"],
    "build-report":      ["--sample", "--split-by"],
}

class RunPayload(BaseModel):
    sample: Optional[int] = None
    split_by: Optional[str] = None

class QuestionsPayload(BaseModel):
    questions: list

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

@app.post("/api/run/{command}")
async def run_command(command: str, payload: RunPayload):
    if command not in ALLOWED_COMMANDS:
        raise HTTPException(status_code=400, detail=f"Unknown command '{command}'")
    cmd = [sys.executable, "src/data/make.py", command]
    if payload.sample and "--sample" in ALLOWED_COMMANDS[command]:
        cmd += ["--sample", str(payload.sample)]
    if payload.split_by and "--split-by" in ALLOWED_COMMANDS[command]:
        cmd += ["--split-by", payload.split_by]
    return StreamingResponse(
        _stream(command, cmd),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

async def _stream(command: str, cmd: list) -> AsyncGenerator[str, None]:
    global _last_status
    _last_status = {"command": command, "status": "running", "finished_at": None}
    yield _sse("status", {"status": "running", "command": command})
    yield _sse("log", {"line": f"$ {' '.join(cmd)}", "level": "cmd"})
    env = {**os.environ, "PYTHONPATH": str(BASE_DIR), "PYTHONUNBUFFERED": "1"}
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT, cwd=str(BASE_DIR), env=env,
        )
        async for raw in proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip()
            yield _sse("log", {"line": line, "level": _classify(line)})
        await proc.wait()
        status = "success" if proc.returncode == 0 else "error"
    except Exception as e:
        yield _sse("log", {"line": f"Error: {e}", "level": "error"})
        status = "error"
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
.tab-content{display:none;height:100%;overflow:auto}.tab-content.active{display:flex;flex-direction:column}
.dashboard{padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:16px;height:100%;overflow:hidden}
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
.log-panel{background:#1a1a18;border-radius:var(--radius);display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--shadow)}
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
.terminal-pane{height:100%;display:flex;flex-direction:column}
.terminal-pane iframe{flex:1;border:none}
.terminal-note{padding:8px 16px;background:#1a1a18;color:#888;font-size:11px;font-family:monospace}
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
  <div style="display:flex;flex-direction:column;overflow:hidden;">
    <div class="tabs-bar">
      <div class="tab active" data-tab="dashboard">Dashboard</div>
      <div class="tab" data-tab="config">Config</div>
      <div class="tab" data-tab="questions">Questions</div>
      <div class="tab" data-tab="reports">Reports</div>
      <div class="tab" data-tab="templates">Templates</div>
      <div class="tab" data-tab="terminal">Terminal</div>
    </div>
    <div class="tab-content active" id="tab-dashboard" style="overflow:hidden;">
      <div class="dashboard">
        <div class="commands-grid">
          <div class="cmd-card">
            <h3>1 · Fetch questions</h3>
            <p>Download form schema from Kobo/Ona and write questions into config.yml, auto-categorized.</p>
            <button class="btn btn-primary" onclick="runCmd('fetch-questions')">▶ Run</button>
          </div>
          <div class="cmd-card">
            <h3>2 · Generate template</h3>
            <p>Build a starter Word template from charts in config.yml. Overwrites existing.</p>
            <button class="btn btn-primary" onclick="runCmd('generate-template')">▶ Run</button>
          </div>
          <div class="cmd-card">
            <h3>3 · Download data</h3>
            <p>Extract submissions, apply filters, export to configured destination.</p>
            <div class="sample-row">
              <label>Sample</label>
              <input type="number" id="sample-download" placeholder="all" min="1">
              <span style="font-size:11px;color:var(--muted)">rows</span>
            </div>
            <button class="btn btn-primary" onclick="runCmd('download',{sample:getSample('sample-download')})">▶ Run</button>
          </div>
          <div class="cmd-card">
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
            <button class="btn btn-primary" onclick="runCmd('build-report',{sample:getSample('sample-report'),split_by:getSplitBy()})">▶ Run</button>
          </div>
        </div>
        <div class="log-panel">
          <div class="log-header">
            <span id="log-title">Logs</span>
            <button class="btn btn-ghost btn-sm" onclick="clearLog()">Clear</button>
          </div>
          <div class="log-body" id="log-body"><span class="log-empty">No commands run yet.</span></div>
        </div>
      </div>
    </div>
    <div class="tab-content" id="tab-questions">
      <div class="reports-pane">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <h2>Questions</h2>
          <span style="color:var(--muted);font-size:12px;">Edit Export label to rename columns used in charts and templates.</span>
          <span style="margin-left:auto;display:flex;gap:8px;">
            <button class="btn btn-ghost btn-sm" onclick="loadQuestions()">↺ Refresh</button>
            <button class="btn btn-primary btn-sm" onclick="saveQuestions()">Save changes</button>
          </span>
        </div>
        <div id="questions-msg" style="display:none;margin:4px 0;font-size:12px;"></div>
        <div id="questions-container"><p class="empty-state">Loading…</p></div>
      </div>
    </div>
    <div class="tab-content" id="tab-config">
      <div class="config-pane">
        <div class="config-toolbar">
          <strong style="font-size:14px;">config.yml</strong>
          <span class="info">Edit directly — saved to the mounted volume.</span>
          <span id="config-msg" class="config-msg" style="display:none;"></span>
          <button class="btn btn-primary btn-sm" onclick="saveConfig()">Save</button>
          <button class="btn btn-ghost btn-sm" onclick="loadConfig()">Reload</button>
        </div>
        <div class="editor-wrap"><textarea id="config-editor"></textarea></div>
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
            <button class="btn btn-ghost btn-sm" id="btn-generate-tpl" onclick="generateTemplate()">⚙ Generate template</button>
            <label class="btn btn-primary btn-sm" style="cursor:pointer;">
              ↑ Upload .docx
              <input type="file" accept=".docx" style="display:none" onchange="uploadTemplate(this)">
            </label>
          </span>
        </div>
        <div id="templates-container"><p class="empty-state">Loading…</p></div>
      </div>
    </div>
    <div class="tab-content" id="tab-terminal">
      <div class="terminal-pane">
        <div class="terminal-note">Web terminal · /app · python3 src/data/make.py --help</div>
        <iframe id="terminal-frame" src="" allowfullscreen></iframe>
      </div>
    </div>
  </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/yaml/yaml.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js"></script>
<script>
let terminalLoaded=false,running=false;
loadSplitByOptions();
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.tab,.tab-content').forEach(el=>el.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    if(tab.dataset.tab==='config'&&!editor.getValue())loadConfig();
    if(tab.dataset.tab==='questions')loadQuestions();
    if(tab.dataset.tab==='reports'){loadReports();loadDataFiles();}
    if(tab.dataset.tab==='templates')loadTemplates();
    if(tab.dataset.tab==='terminal'&&!terminalLoaded){
      document.getElementById('terminal-frame').src='/terminal/';
      terminalLoaded=true;
    }
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
function getSample(id){const v=parseInt(document.getElementById(id).value);return isNaN(v)?null:v;}
function getSplitBy(){const v=document.getElementById('split-by-report').value;return v||null;}
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
async function loadQuestions(){
  const c=document.getElementById('questions-container');
  c.innerHTML='<p class="empty-state">Loading…</p>';
  const data=await(await fetch('/api/questions')).json();
  _questions=data.questions||[];
  if(!_questions.length){c.innerHTML='<p class="empty-state">No questions yet. Run Fetch questions first.</p>';return;}
  c.innerHTML='<table class="file-table"><thead><tr><th>kobo_key</th><th>Label</th><th>Type</th><th>Category</th><th style="min-width:180px;">Export label <span style="font-weight:normal;color:var(--muted)">(editable)</span></th></tr></thead><tbody>'+
    _questions.map((q,i)=>`<tr>
      <td style="color:var(--muted);font-size:11px;font-family:monospace;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${q.kobo_key||''}">${q.kobo_key||''}</td>
      <td style="font-size:12px;">${q.label||''}</td>
      <td style="color:var(--muted);font-size:11px;">${q.type||''}</td>
      <td><span class="badge-cat badge-cat-${q.category||'undefined'}">${q.category||''}</span></td>
      <td><input class="export-label-input" data-idx="${i}" value="${(q.export_label||'').replace(/"/g,'&quot;')}" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:12px;" oninput="markDirty(this)"></td>
    </tr>`).join('')+
    '</tbody></table>';
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
  document.getElementById('status-label').textContent=command;
  document.getElementById('log-body').innerHTML='';
  document.getElementById('log-title').textContent='Running: '+command;
  const body={};if(opts.sample)body.sample=opts.sample;if(opts.split_by)body.split_by=opts.split_by;
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
        if(p.status==='success'&&command==='build-report')loadReports();
        if(p.status==='success'&&command==='download')loadDataFiles();
        if(p.status==='success'&&command==='fetch-questions'){loadQuestions();loadSplitByOptions();}
      }
      else if(ev==='done')running=false;
    }
  }
  running=false;
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
  c.innerHTML='<table class="file-table"><thead><tr><th>File</th><th>Size</th><th>Generated</th><th></th></tr></thead><tbody>'+
    data.files.map(f=>`<tr><td><span class="file-name">${f.name}</span></td><td style="color:var(--muted)">${f.size_kb} KB</td><td style="color:var(--muted)">${f.modified}</td><td style="text-align:right;display:flex;gap:6px;justify-content:flex-end;"><a href="/api/reports/download/${encodeURIComponent(f.name)}" download><button class="btn btn-primary btn-sm">↓ Download</button></a><button class="btn btn-danger btn-sm" onclick="deleteReport('${f.name}')">Delete</button></td></tr>`).join('')+
    '</tbody></table>';
}
async function deleteReport(name){
  if(!confirm('Delete '+name+'?'))return;
  await fetch('/api/reports/'+encodeURIComponent(name),{method:'DELETE'});loadReports();
}
async function loadDataFiles(){
  const c=document.getElementById('data-container');c.innerHTML='<p class="empty-state">Loading…</p>';
  const data=await(await fetch('/api/data')).json();
  if(!data.files.length){c.innerHTML='<p class="empty-state">No data files yet. Run Download data first.</p>';return;}
  c.innerHTML='<table class="file-table"><thead><tr><th>File</th><th>Size</th><th>Generated</th><th></th></tr></thead><tbody>'+
    data.files.map(f=>`<tr><td><span class="file-name">${f.name}</span></td><td style="color:var(--muted)">${f.size_kb} KB</td><td style="color:var(--muted)">${f.modified}</td><td style="text-align:right;"><a href="/api/data/download/${encodeURIComponent(f.name)}" download><button class="btn btn-primary btn-sm">↓ Download</button></a></td></tr>`).join('')+
    '</tbody></table>';
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
async function generateTemplate(){
  if(running){toast('A command is already running','err');return;}
  const btn=document.getElementById('btn-generate-tpl');
  if(btn){btn.disabled=true;btn.textContent='⚙ Generating…';}
  running=true;setDot('running');
  document.getElementById('status-label').textContent='generate-template';
  const res=await fetch('/api/run/generate-template',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
  const reader=res.body.getReader();const dec=new TextDecoder();let buf='',ok=false;
  while(true){
    const{done,value}=await reader.read();if(done)break;
    buf+=dec.decode(value,{stream:true});
    const parts=buf.split('\n\n');buf=parts.pop();
    for(const part of parts){
      const lines=part.trim().split('\n');let ev='message',data='';
      for(const l of lines){if(l.startsWith('event: '))ev=l.slice(7);if(l.startsWith('data: '))data=l.slice(6);}
      if(!data)continue;const p=JSON.parse(data);
      if(ev==='status'&&p.status!=='running'){
        ok=p.status==='success';setDot(p.status);
        document.getElementById('status-label').textContent=ok?'✓ done':'✗ error';
        running=false;
      }
    }
  }
  running=false;
  if(btn){btn.disabled=false;btn.textContent='⚙ Generate template';}
  if(ok){toast('Template generated','ok');loadTemplates();}
  else{toast('Generation failed — check logs on Dashboard','err');}
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
loadConfig();
</script>
</body>
</html>
HTMLEOF

RUN mkdir -p data/raw data/processed data/processed/charts reports templates references

COPY sample.config.yml ./sample.config.yml

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
EXPOSE 8000

CMD ["sh", "-c", "if [ ! -f config.yml ]; then cp sample.config.yml config.yml; fi && exec uvicorn web.main:app --host 0.0.0.0 --port 8000"]