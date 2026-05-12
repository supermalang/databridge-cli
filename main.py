"""
kobo-reporter web interface — FastAPI backend.

Endpoints:
  GET  /                          → serve UI
  GET  /api/config                → read config.yml
  POST /api/config                → write config.yml
  POST /api/run/{command}         → run CLI command, stream logs via SSE
  GET  /api/reports               → list generated reports
  GET  /api/reports/download/{f}  → download a report file
  DELETE /api/reports/{f}         → delete a report file
  GET  /api/status                → last run status
"""

import asyncio
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, Dict, Optional

import aiofiles
import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR = Path("/app")
CONFIG_PATH = BASE_DIR / "config.yml"
REPORTS_DIR = BASE_DIR / "reports"
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="kobo-reporter", docs_url=None, redoc_url=None)

# ── In-memory state ────────────────────────────────────────────────────────────
_last_status: Dict = {"command": None, "status": "idle", "finished_at": None}


# ── Static files & UI ─────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    index = STATIC_DIR / "index.html"
    return index.read_text(encoding="utf-8")


# ── Config endpoints ───────────────────────────────────────────────────────────

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
    # Validate YAML before saving
    try:
        yaml.safe_load(payload.content)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

    async with aiofiles.open(CONFIG_PATH, "w", encoding="utf-8") as f:
        await f.write(payload.content)

    return {"ok": True, "saved_at": datetime.now().isoformat()}


# ── Command runner with SSE log streaming ──────────────────────────────────────

ALLOWED_COMMANDS = {
    "fetch-questions":   [],
    "generate-template": [],
    "download":          ["--sample"],
    "build-report":      ["--sample"],
}


class RunPayload(BaseModel):
    sample: Optional[int] = None


@app.post("/api/run/{command}")
async def run_command(command: str, payload: RunPayload, request: Request):
    if command not in ALLOWED_COMMANDS:
        raise HTTPException(status_code=400, detail=f"Unknown command '{command}'")

    cmd = [sys.executable, "src/data/make.py", command]
    if payload.sample and "--sample" in ALLOWED_COMMANDS[command]:
        cmd += ["--sample", str(payload.sample)]

    return StreamingResponse(
        _stream_command(command, cmd),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disable Nginx/Traefik buffering
        },
    )


async def _stream_command(command: str, cmd: list) -> AsyncGenerator[str, None]:
    global _last_status
    _last_status = {"command": command, "status": "running", "finished_at": None}

    yield _sse("status", {"status": "running", "command": command})
    yield _sse("log", {"line": f"$ {' '.join(cmd)}", "level": "cmd"})

    env = {**os.environ, "PYTHONPATH": str(BASE_DIR), "PYTHONUNBUFFERED": "1"}

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=str(BASE_DIR),
            env=env,
        )

        async for raw_line in proc.stdout:
            line = raw_line.decode("utf-8", errors="replace").rstrip()
            level = _classify_line(line)
            yield _sse("log", {"line": line, "level": level})

        await proc.wait()
        success = proc.returncode == 0
        status = "success" if success else "error"

    except Exception as e:
        yield _sse("log", {"line": f"Internal error: {e}", "level": "error"})
        status = "error"

    _last_status = {
        "command": command,
        "status": status,
        "finished_at": datetime.now().isoformat(),
    }
    yield _sse("status", {**_last_status})
    yield _sse("done", {})


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _classify_line(line: str) -> str:
    ll = line.lower()
    if "error" in ll or "exception" in ll or "traceback" in ll:
        return "error"
    if "warning" in ll or "warn" in ll:
        return "warning"
    if line.startswith("$"):
        return "cmd"
    if "→" in line or "saved" in line or "exported" in line or "generated" in line:
        return "success"
    return "info"


# ── Status ─────────────────────────────────────────────────────────────────────

@app.get("/api/status")
async def get_status():
    return _last_status


# ── Reports file browser ───────────────────────────────────────────────────────

@app.get("/api/reports")
async def list_reports():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for f in sorted(REPORTS_DIR.glob("*.docx"), key=lambda x: x.stat().st_mtime, reverse=True):
        stat = f.stat()
        files.append({
            "name": f.name,
            "size_kb": round(stat.st_size / 1024, 1),
            "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
        })
    return {"files": files}


@app.get("/api/reports/download/{filename}")
async def download_report(filename: str):
    # Sanitize — no path traversal
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = REPORTS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path=path,
        filename=filename,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )


@app.delete("/api/reports/{filename}")
async def delete_report(filename: str):
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = REPORTS_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    path.unlink()
    return {"ok": True}
