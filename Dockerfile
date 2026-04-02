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
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

BASE_DIR    = Path("/app")
CONFIG_PATH = BASE_DIR / "config.yml"
REPORTS_DIR = BASE_DIR / "reports"
STATIC_DIR  = Path(__file__).parent / "static"

app = FastAPI(title="kobo-reporter", docs_url=None, redoc_url=None)
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
    "build-report":      ["--sample"],
}

class RunPayload(BaseModel):
    sample: Optional[int] = None

@app.post("/api/run/{command}")
async def run_command(command: str, payload: RunPayload):
    if command not in ALLOWED_COMMANDS:
        raise HTTPException(status_code=400, detail=f"Unknown command '{command}'")
    cmd = [sys.executable, "src/data/make.py", command]
    if payload.sample and "--sample" in ALLOWED_COMMANDS[command]:
        cmd += ["--sample", str(payload.sample)]
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
PYEOF

COPY <<'HTMLEOF' web/static/index.html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>kobo-reporter</title>
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
    <h1>kobo-reporter</h1><span class="badge">v1.0</span>
    <span id="status-label" style="font-size:12px;color:rgba(255,255,255,.7);margin-left:8px;"></span>
    <div class="status-dot" id="status-dot"></div>
  </header>
  <div style="display:flex;flex-direction:column;overflow:hidden;">
    <div class="tabs-bar">
      <div class="tab active" data-tab="dashboard">Dashboard</div>
      <div class="tab" data-tab="config">Config</div>
      <div class="tab" data-tab="reports">Reports</div>
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
            <button class="btn btn-primary" onclick="runCmd('build-report',{sample:getSample('sample-report')})">▶ Run</button>
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
          <h2>Generated reports</h2>
          <button class="btn btn-ghost btn-sm" onclick="loadReports()">↺ Refresh</button>
        </div>
        <div id="reports-container"><p class="empty-state">Loading…</p></div>
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
<script>
let terminalLoaded=false,running=false;
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.tab,.tab-content').forEach(el=>el.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    if(tab.dataset.tab==='config'&&!editor.getValue())loadConfig();
    if(tab.dataset.tab==='reports')loadReports();
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
}
function showMsg(t,type){const el=document.getElementById('config-msg');el.textContent=t;el.className='config-msg '+type;el.style.display='inline-block';setTimeout(()=>el.style.display='none',3000);}
function getSample(id){const v=parseInt(document.getElementById(id).value);return isNaN(v)?null:v;}
async function runCmd(command,opts={}){
  if(running){toast('Already running','err');return;}
  running=true;setDot('running');
  document.getElementById('status-label').textContent=command;
  document.getElementById('log-body').innerHTML='';
  document.getElementById('log-title').textContent='Running: '+command;
  const body={};if(opts.sample)body.sample=opts.sample;
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
function toast(msg,type='ok'){const el=document.createElement('div');el.className='toast '+type;el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.remove(),3000);}
loadConfig();
</script>
</body>
</html>
HTMLEOF

RUN mkdir -p data/raw data/processed data/processed/charts reports templates references

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
EXPOSE 8000

CMD ["uvicorn", "web.main:app", "--host", "0.0.0.0", "--port", "8000"]
