import asyncio, base64, io, json, os, shutil, sys, tempfile, zipfile
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, Dict, List, Optional

import aiofiles, yaml
from fastapi import FastAPI, HTTPException, UploadFile, Depends, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from src.utils.config import load_config, write_config
from src.data.transform import load_processed_data
from src.data.profile import profile_dataset
from src.reports import ask_engine
from sqlalchemy.orm import Session
from web import auth
from web import runs as _runs
from web.db import bootstrap as db_bootstrap
from web.db import session as db_session, repository as db_repo, provision as db_provision
from web.db import bridge as db_bridge
from web.storage import workspace as storage_workspace

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

@asynccontextmanager
async def _lifespan(app):
    db_bootstrap.init_db()
    yield

app = FastAPI(title="databridge-cli", docs_url=None, redoc_url=None, lifespan=_lifespan)
auth.register_auth(app)
_registry = _runs.RunRegistry()

if ASSETS_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


def _current_user(request: Request, db: Session):
    claims = getattr(request.state, "user", None) or {}
    sub = claims.get("sub")
    user = db_repo.get_user_by_sub(db, sub) if sub else None
    if user is None and sub:
        user = db_provision.ensure_user(db, claims)
    return user


def _active_project(request: Request, db: Session):
    user = _current_user(request, db)
    if user is None or user.active_project_id is None:
        return user, None
    return user, db_repo.get_project_for_user(db, user, user.active_project_id)


def _sync_active_project_from_file(request: Request) -> None:
    """After an endpoint mutates config.yml directly, push the file's contents back into
    the active project's DB row so the DB (source of truth) stays in sync and the next
    materialize_config doesn't discard the edit. No-op if there's no active project."""
    if not CONFIG_PATH.exists():
        return
    with db_session.SessionLocal() as db:
        user, project = _active_project(request, db)
        if project is None:
            return
        cfg = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8")) or {}
        db_repo.update_project_config(db, project, cfg)


def require_role(request: Request, db: Session, minimum: str):
    """Resolve the caller's ACTIVE project and assert their role >= `minimum`.
    The BASE_DIR file mirror always reflects the active project, so endpoints that
    operate on the mirror gate on the active project too. Returns (user, project, role).
    Raises 400 if there's no active project, 403 if under-privileged.

    In **dev mode** (auth disabled) there are no roles — a single dev user owns
    everything — so gating is skipped and the caller is treated as superadmin."""
    user, project = _active_project(request, db)
    if project is None:
        raise HTTPException(status_code=400, detail="No active project")
    if not auth.auth_enabled():
        return user, project, "superadmin"   # dev mode: skip role gating, project still required
    role = db_repo.role_for(db, user, project)
    if not db_repo.role_at_least(role, minimum):
        raise HTTPException(status_code=403, detail=f"This action requires the '{minimum}' role")
    return user, project, role


def _require(request: Request, minimum: str):
    """Convenience wrapper for endpoints that don't already hold a db session:
    opens a short-lived session purely to enforce the role gate."""
    with db_session.SessionLocal() as _db:
        require_role(request, _db, minimum)


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

@app.get("/api/health")
async def health():
    # Unauthenticated liveness probe (whitelisted by the auth middleware) for
    # load balancers / container orchestration.
    return {"status": "ok"}

@app.get("/api/config")
def get_config(request: Request, db: Session = Depends(db_session.get_db)):
    _user, project = _active_project(request, db)
    if project is None:
        return {"content": "", "exists": False}
    content = yaml.safe_dump(project.config or {}, allow_unicode=True,
                             default_flow_style=False, sort_keys=False)
    return {"content": content, "exists": True, "version": project.config_version}


class ConfigPayload(BaseModel):
    content: str
    version: Optional[int] = None


@app.post("/api/config")
def save_config(payload: ConfigPayload, request: Request, db: Session = Depends(db_session.get_db)):
    try:
        parsed = yaml.safe_load(payload.content) or {}
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")
    user, project, _role = require_role(request, db, "editor")
    try:
        db_repo.update_project_config(db, project, parsed, expected_version=getattr(payload, "version", None))
    except db_repo.StaleConfigError:
        raise HTTPException(status_code=409, detail="Config changed since you loaded it; reload and retry.")
    db_bridge.materialize_config(project)
    return {"ok": True, "saved_at": datetime.now().isoformat(), "version": project.config_version}


class NewProjectPayload(BaseModel):
    name: str
    org_id: Optional[str] = None


@app.get("/api/projects")
def list_projects(request: Request, db: Session = Depends(db_session.get_db)):
    user = _current_user(request, db)
    if user is None:
        return {"projects": [], "active_id": None}
    projects = db_repo.list_projects_for_user(db, user)
    return {
        "active_id": str(user.active_project_id) if user.active_project_id else None,
        "is_superadmin": bool(user.is_superadmin),
        "projects": [{"id": str(p.id), "name": p.name, "slug": p.slug, "org_id": str(p.org_id),
                      "role": db_repo.role_for(db, user, p),
                      "is_owner": p.owner_id == user.id}
                     for p in projects],
    }


@app.post("/api/projects")
def create_project(payload: NewProjectPayload, request: Request, db: Session = Depends(db_session.get_db)):
    user = _current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    import uuid as _uuid
    try:
        org_id = _uuid.UUID(payload.org_id) if payload.org_id else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid org_id")
    try:
        p = db_repo.create_project(db, user=user, name=payload.name, org_id=org_id)
    except db_repo.AccessError:
        raise HTTPException(status_code=403, detail="Not a member of that org")
    return {"id": str(p.id), "name": p.name, "slug": p.slug}


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str, request: Request, db: Session = Depends(db_session.get_db)):
    import uuid as _uuid
    user = _current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        pid = _uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Project not found")
    project = db_repo.get_project_for_user(db, user, pid)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    role = db_repo.role_for(db, user, project)
    if not db_repo.role_at_least(role, "admin"):
        raise HTTPException(status_code=403, detail="Only an admin or the owner can delete a project")
    org_id = str(project.org_id)
    db_repo.delete_project(db, project)
    # Best-effort object-storage cleanup; never block deletion on storage errors.
    try:
        storage_workspace.delete_project_storage(org_id, project_id)
    except Exception:
        pass
    return {"ok": True}


@app.post("/api/projects/{project_id}/activate")
def activate_project(project_id: str, request: Request, db: Session = Depends(db_session.get_db)):
    import uuid as _uuid
    user = _current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        pid = _uuid.UUID(project_id)
        db_repo.set_active_project(db, user, pid)
    except (db_repo.AccessError, ValueError):
        raise HTTPException(status_code=404, detail="Project not found")
    project = db_repo.get_project_for_user(db, user, pid)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    db_bridge.mirror_active(db, user)
    storage_workspace.pull_workspace(str(project.org_id), str(project.id), base=BASE_DIR)
    return {"ok": True, "active_id": project_id}


# ── Project members + invitations ───────────────────────────

class InviteMemberPayload(BaseModel):
    email: str
    role: str = "viewer"


class RoleChangePayload(BaseModel):
    role: str


class SuperadminPayload(BaseModel):
    email: str
    value: bool = True


def _admin_project(request: Request, db: Session, project_id: str):
    """Resolve a project the caller administers. Returns (user, project, role).
    404 if not found/no access, 403 if the caller isn't admin/owner/superadmin."""
    import uuid as _uuid
    user = _current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        pid = _uuid.UUID(project_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Project not found")
    project = db_repo.get_project_for_user(db, user, pid)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    role = db_repo.role_for(db, user, project)
    if not db_repo.role_at_least(role, "admin"):
        raise HTTPException(status_code=403, detail="Admin role required")
    return user, project, role


@app.get("/api/projects/{project_id}/members")
def list_project_members(project_id: str, request: Request, db: Session = Depends(db_session.get_db)):
    # Any member can view the roster; only admins get the management controls (UI-gated).
    import uuid as _uuid
    user = _current_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        project = db_repo.get_project_for_user(db, user, _uuid.UUID(project_id))
    except ValueError:
        project = None
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    my_role = db_repo.role_for(db, user, project)
    return {
        "my_role": my_role,
        "members": db_repo.list_members(db, project),
        "invitations": [{"email": i.email, "role": i.role, "status": i.status}
                        for i in db_repo.list_invitations(db, project)],
    }


@app.post("/api/projects/{project_id}/members/invite")
def invite_member(project_id: str, payload: InviteMemberPayload, request: Request,
                  db: Session = Depends(db_session.get_db)):
    actor, project, _role = _admin_project(request, db, project_id)
    email = (payload.email or "").strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required")
    if payload.role not in db_repo.ASSIGNABLE_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role: {payload.role}")

    # Create the user in Zitadel (so a brand-new person can sign in) — best-effort.
    from web import zitadel_admin
    zitadel_status, zitadel_user_id = "skipped (not configured)", None
    if zitadel_admin.enabled():
        try:
            res = zitadel_admin.ensure_invited_user(email, app_url=auth._env("APP_BASE_URL", ""))
            zitadel_user_id, zitadel_status = res["zitadel_user_id"], res["status"]
        except Exception as e:  # noqa: BLE001 — surface, don't abort the app-level invite
            zitadel_status = f"error: {e}"

    db_repo.get_or_create_invitation(db, project, email, payload.role, actor, zitadel_user_id)

    # If they already have an app account, attach the membership immediately.
    existing = db_repo.get_user_by_email(db, email)
    attached = False
    if existing is not None:
        db_repo.consume_invitations_for(db, existing)
        attached = True
    return {"ok": True, "email": email, "role": payload.role,
            "attached": attached, "zitadel": zitadel_status}


@app.patch("/api/projects/{project_id}/members/{user_id}")
def change_member_role(project_id: str, user_id: str, payload: RoleChangePayload,
                       request: Request, db: Session = Depends(db_session.get_db)):
    _actor, project, actor_role = _admin_project(request, db, project_id)
    try:
        db_repo.set_member_role(db, project, user_id, payload.role, actor_role)
    except db_repo.AccessError as e:
        raise HTTPException(status_code=403, detail=str(e))
    return {"ok": True}


@app.delete("/api/projects/{project_id}/members/{user_id}")
def remove_project_member(project_id: str, user_id: str, request: Request,
                          db: Session = Depends(db_session.get_db)):
    _actor, project, actor_role = _admin_project(request, db, project_id)
    try:
        db_repo.remove_member(db, project, user_id, actor_role)
    except db_repo.AccessError as e:
        raise HTTPException(status_code=403, detail=str(e))
    return {"ok": True}


@app.post("/api/admin/superadmins")
def set_superadmin(payload: SuperadminPayload, request: Request,
                   db: Session = Depends(db_session.get_db)):
    actor = _current_user(request, db)
    if actor is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not actor.is_superadmin:
        raise HTTPException(status_code=403, detail="Superadmin role required")
    target = db_repo.get_user_by_email(db, (payload.email or "").strip().lower())
    if target is None:
        raise HTTPException(status_code=404, detail="No user with that email (they must log in once first)")
    try:
        db_repo.set_superadmin(db, actor, target, payload.value)
    except db_repo.AccessError as e:
        raise HTTPException(status_code=403, detail=str(e))
    return {"ok": True, "email": target.email, "is_superadmin": target.is_superadmin}


ALLOWED_COMMANDS = {
    "fetch-questions":      [],
    "generate-template":    ["--context", "--summary-prompt"],
    "ai-generate-template": ["--description", "--pages", "--language", "--context", "--summary-prompt"],
    "push-prompts":         [],
    "suggest-charts":       ["--user-request"],
    "suggest-views":        ["--user-request"],
    "suggest-summaries":    ["--user-request"],
    "suggest-tables":       ["--user-request"],
    "suggest-indicators":   ["--user-request"],
    "download":             ["--sample"],
    "build-report":         ["--sample", "--split-by", "--session", "--period", "--compare"],
    "run-all":              ["--sample", "--period", "--auto-charts"],
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
    period:  Optional[str] = None
    compare: Optional[str] = None
    auto_charts: Optional[bool] = None

class QuestionsPayload(BaseModel):
    questions: list

class AITestPayload(BaseModel):
    provider: str = "openai"
    api_key: str = ""
    model: str = "gpt-4o"
    base_url: Optional[str] = None


# AI-connection verification, persisted per project in projects.ai_verified_fingerprint.
# A successful /api/ai/test stores the tested config's fingerprint on the active project;
# /api/ai/status reports verified when the SAVED config matches the stored fingerprint.
# Changing provider/model/base_url/key changes the fingerprint (auto-relock), and an
# AI-call failure clears it (POST /api/ai/invalidate / endpoint-side on failure).
import hashlib as _hashlib


def _ai_fingerprint(provider: str, model: str, base_url, api_key: str) -> str:
    """Stable fingerprint of an AI config, with env: keys resolved so changing the
    underlying secret invalidates a prior verification."""
    key = (api_key or "").strip()
    if key.startswith("env:"):
        key = os.environ.get(key[4:].strip(), "")
    raw = "|".join([(provider or "openai").lower(), model or "", base_url or "", key])
    return _hashlib.sha256(raw.encode()).hexdigest()


def _ai_fingerprint_for(ai: dict) -> str:
    ai = ai or {}
    return _ai_fingerprint(ai.get("provider", "openai"), ai.get("model", ""),
                           ai.get("base_url"), ai.get("api_key", ""))


def _invalidate_ai(request) -> None:
    """Clear the active project's verified AI fingerprint — re-locks all AI buttons
    until the connection is tested working again. Best-effort, never raises."""
    try:
        with db_session.SessionLocal() as _db:
            _user, _project = _active_project(request, _db)
            if _project is not None and _project.ai_verified_fingerprint is not None:
                db_repo.set_ai_verified(_db, _project, None)
    except Exception:  # noqa: BLE001 — invalidation must never break the caller
        pass

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
async def save_questions(payload: QuestionsPayload, request: Request):
    _require(request, "editor")
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=400, detail="config.yml not found")
    async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as f:
        content = await f.read()
    cfg = yaml.safe_load(content) or {}
    cfg["questions"] = payload.questions
    async with aiofiles.open(CONFIG_PATH, "w", encoding="utf-8") as f:
        await f.write(yaml.dump(cfg, allow_unicode=True, default_flow_style=False, sort_keys=False))
    _sync_active_project_from_file(request)
    return {"ok": True, "saved": len(payload.questions)}

@app.post("/api/questions/suggest-hidden")
async def suggest_hidden_questions(request: Request):
    """Ask the configured AI provider which questions are non-analytical
    display-only fields that should be hidden by default.

    Returns {"suggestions": [kobo_key, ...], "reasons": {kobo_key: reason}}.
    When AI is not configured, returns 200 with
    {"suggestions": [], "message": "AI not configured"}.
    """
    from src.reports.ai_hidden_suggester import suggest_hidden
    try:
        cfg = load_config(CONFIG_PATH)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return suggest_hidden(cfg)
    except Exception as e:  # noqa: BLE001 — an AI-call failure re-locks the AI buttons
        _invalidate_ai(request)
        raise HTTPException(status_code=500, detail=f"suggest-hidden failed: {e}")

@app.post("/api/questions/suggest-pii")
async def suggest_pii_questions(request: Request):
    """Ask the configured AI provider which questions likely contain
    personally-identifiable information (PII).

    Returns {"suggestions": [kobo_key, ...], "reasons": {kobo_key: reason}}.
    When AI is not configured, returns 200 with
    {"suggestions": [], "message": "AI not configured"}.
    """
    from src.reports.ai_pii_suggester import suggest_pii
    try:
        cfg = load_config(CONFIG_PATH)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return suggest_pii(cfg)
    except Exception as e:  # noqa: BLE001 — an AI-call failure re-locks the AI buttons
        _invalidate_ai(request)
        raise HTTPException(status_code=500, detail=f"suggest-pii failed: {e}")

@app.post("/api/ai/test")
async def test_ai(payload: AITestPayload, request: Request):
    api_key = payload.api_key.strip()
    if api_key.startswith("env:"):
        api_key = os.environ.get(api_key[4:].strip(), "")
    if not api_key:
        _invalidate_ai(request)   # a failed test must re-lock the AI buttons
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
        _invalidate_ai(request)   # a setup failure (e.g. missing provider package) re-locks too
        raise
    except Exception as e:
        result = {"ok": False, "tokens_used": None, "quota": None, "message": str(e)}
    # Persist the verified fingerprint on the active project (survives restarts). On a
    # failed probe, clear it so the AI buttons stay locked.
    fp = _ai_fingerprint(payload.provider, payload.model, payload.base_url, payload.api_key)
    with db_session.SessionLocal() as _db:
        _user, _project = _active_project(request, _db)
        if _project is not None:
            db_repo.set_ai_verified(_db, _project, fp if result.get("ok") else None)
    return result


class SourceTestPayload(BaseModel):
    platform: str = "kobo"
    url: str = ""
    token: str = ""
    form_uid: Optional[str] = ""


_SCHEMA_GROUP_TYPES = {
    "begin_group", "end_group", "begin_repeat", "end_repeat",
    "begin group", "end group", "begin repeat", "end repeat",
}


def _count_schema_fields(schema: dict) -> int:
    """Count answerable questions in a Kobo asset or Ona form schema.
    Kobo: {"content": {"survey": [...]}}; Ona: {"children": [...]} (nested)."""
    if not isinstance(schema, dict):
        return 0
    content = schema.get("content")
    if isinstance(content, dict) and isinstance(content.get("survey"), list):
        count = 0
        for r in content["survey"]:
            if not isinstance(r, dict):
                continue
            t = (r.get("type") or "").strip().lower()
            if t and t not in _SCHEMA_GROUP_TYPES and r.get("name"):
                count += 1
        return count
    if isinstance(schema.get("children"), list):
        count = 0

        def _walk(children):
            nonlocal count
            for ch in children:
                if not isinstance(ch, dict):
                    continue
                if isinstance(ch.get("children"), list):
                    _walk(ch["children"])
                elif ch.get("name"):
                    count += 1

        _walk(schema["children"])
        return count
    return 0


@app.post("/api/sources/test")
def test_source(payload: SourceTestPayload):
    """Live connectivity probe against the configured Kobo/Ona platform.
    Resolves an env: token, then makes a REAL API call: with a form UID it fetches
    that form's schema and counts its fields; without one it hits an auth-only
    endpoint to verify the token. Returns {ok, message, fields, status}. Ungated
    (a preview-style action), like /api/ai/test."""
    import requests
    from src.data.extract import get_client

    token = (payload.token or "").strip()
    if token.startswith("env:"):
        token = os.environ.get(token[4:].strip(), "")
    url = (payload.url or "").strip().rstrip("/")
    if not url or not token:
        return {"ok": False, "fields": None, "status": None,
                "message": "API URL and token are both required."}
    platform = (payload.platform or "kobo").lower()
    if platform not in ("kobo", "ona"):
        platform = "ona" if "ona" in url else "kobo"
    form_uid = (payload.form_uid or "").strip()

    try:
        if form_uid:
            cfg = {"api": {"platform": platform, "url": url, "token": token, "timeout": 15},
                   "form": {"uid": form_uid}}
            schema = get_client(cfg).get_form_schema()
            fields = _count_schema_fields(schema)
            return {"ok": True, "fields": fields, "status": 200,
                    "message": f"Connected · {fields} field{'' if fields == 1 else 's'} in form"}
        probe = f"{url}/assets/?limit=1" if platform == "kobo" else f"{url}/user.json"
        resp = requests.get(probe, headers={"Authorization": f"Token {token}"}, timeout=15)
        resp.raise_for_status()
        return {"ok": True, "fields": None, "status": resp.status_code,
                "message": "Connected · authentication OK (set a Form UID to count fields)"}
    except requests.HTTPError as e:
        code = e.response.status_code if e.response is not None else None
        if code in (401, 403):
            msg = "Authentication failed — check your API token."
        elif code == 404:
            msg = "Not found — check the API URL" + (" and Form UID." if form_uid else ".")
        else:
            msg = f"Server returned HTTP {code}." if code else str(e)
        return {"ok": False, "fields": None, "status": code, "message": msg}
    except requests.RequestException as e:
        return {"ok": False, "fields": None, "status": None,
                "message": f"Could not reach the server — check the URL and your network. ({e})"}
    except Exception as e:
        return {"ok": False, "fields": None, "status": None, "message": str(e)}


@app.get("/api/ai/status")
def ai_status(request: Request):
    """Whether the SAVED ai config is configured and has passed /api/ai/test for the
    ACTIVE project. Verification is persisted per project (projects.ai_verified_fingerprint),
    so it survives restarts and re-locks when the config changes or an AI call fails."""
    with db_session.SessionLocal() as _db:
        _user, _project = _active_project(request, _db)
        ai = (_project.config or {}).get("ai", {}) if _project is not None else (_load_cfg().get("ai", {}) or {})
        stored = _project.ai_verified_fingerprint if _project is not None else None
    ai = ai or {}
    provider = ai.get("provider", "openai")
    raw_key = (ai.get("api_key", "") or "").strip()
    resolved = os.environ.get(raw_key[4:].strip(), "") if raw_key.startswith("env:") else raw_key
    configured = bool(provider and resolved)
    verified = bool(configured and stored and stored == _ai_fingerprint_for(ai))
    return {"configured": configured, "verified": verified}


@app.post("/api/ai/invalidate")
def ai_invalidate(request: Request):
    """Mark the active project's AI connection unverified (re-locks AI buttons until
    re-tested). Called by the UI when an AI action fails against the provider."""
    _invalidate_ai(request)
    return {"ok": True}

def _build_suggest_prompts(kind: str, prompt: str, questions: list):
    col_parts = []
    for i, q in enumerate(questions):
        if not q:
            continue
        label = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
        category = q.get("category", "")
        col_parts.append(f'{i+1}. "{label}" ({category})' if category else f'{i+1}. "{label}"')
    labels = "\n".join(col_parts) or "unknown"

    # Framework awareness (Task 12): if a framework is configured, list the nodes
    # so the LLM can include a framework_ref in indicator suggestions.
    framework_nodes_block = ""
    try:
        from src.utils.config import load_config
        from src.utils.framework import enumerate_nodes
        cfg = load_config(CONFIG_PATH)
        nodes = enumerate_nodes(cfg)
        if nodes and kind == "indicator":
            lines = [f"  {n['id']} ({n['level']}): {n['breadcrumb']}" for n in nodes]
            framework_nodes_block = "\n\nFRAMEWORK NODES (set framework_ref to one of these ids when the indicator aligns with a node):\n" + "\n".join(lines)
    except Exception:
        framework_nodes_block = ""
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
            "When the user has a results framework configured, the LLM may include a framework_ref field"
            " pointing to a goal/outcome/output id from the FRAMEWORK NODES block in the user prompt."
            " The framework_ref MUST exactly match one of those ids if used."
            " Return JSON only, no markdown fences."
        )
        user = f"Available columns:\n{labels}\n\nRequest: {prompt}\n\nRemember: question (and dedup_by if used) must be exact column names from the numbered list above."
        user = user + framework_nodes_block
    return system, user

@app.post("/api/ai/suggest")
async def ai_suggest(payload: AISuggestPayload, request: Request):
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
    except Exception as e:  # noqa: BLE001 — an AI-call failure re-locks the AI buttons
        _invalidate_ai(request)
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

    # Apply PII redaction before any chart rendering — mirrors builder._render behaviour.
    from src.utils.pii import apply_pii
    main_df, repeat_tables = apply_pii(main_df, repeat_tables, _cfg or {})

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
    _cfg = None
    try:
        async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as _f:
            _cfg = yaml.safe_load(await _f.read()) or {}
        _questions = _cfg.get("questions", [])
        if _questions:
            from src.data.transform import apply_choice_labels
            df = apply_choice_labels(df, _questions)
    except Exception:
        pass
    # Apply PII redaction before the indicator is computed (no-op when pii: absent).
    from src.utils.pii import apply_pii
    df, _ = apply_pii(df, {}, _cfg or {})
    if payload.sample_n and payload.sample_n > 0:
        df = df.head(payload.sample_n)
    ind = payload.indicator
    name = ind.get("name", "preview")
    question = ind.get("question")
    dis = ind.get("disaggregate_by")
    dis_cols = [dis] if isinstance(dis, str) else list(dis or [])
    preview_cols = ([question] if question else []) + dis_cols
    if preview_cols:
        df = _pick_preview_df(df, preview_cols, _questions)
    if question and question not in df.columns:
        available = sorted(df.columns.tolist())
        raise HTTPException(status_code=400, detail=f"Column '{question}' not found in data. Available: {available}")
    try:
        result = compute_indicators([ind], df)
        value = result.get(f"ind_{name}", "N/A")
        raw_breakdown = result.get(f"ind_{name}_breakdown", [])
        breakdown = [
            {**item, "value": float(item["value"]) if hasattr(item.get("value"), "__float__") else item["value"]}
            for item in raw_breakdown
        ]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Indicator error: {e}")
    import logging as _logging
    _log = _logging.getLogger(__name__)
    trend = []
    try:
        from src.utils.periods import all_periods, baseline_period
        registry = all_periods(_cfg) if _cfg else []
        base = baseline_period(_cfg) if _cfg else None
        base_slug = base["slug"] if base else None
        if len(registry) >= 2:
            from src.data.transform import load_processed_data, apply_choice_labels
            for entry in registry:
                try:
                    p_df, _p_repeats = load_processed_data(_cfg, period=entry)
                    if _questions:
                        try:
                            p_df = apply_choice_labels(p_df, _questions)
                        except Exception:
                            pass
                    if question:
                        p_df = _pick_preview_df(p_df, [question], _questions)
                    p_result = compute_indicators([ind], p_df)
                    p_value = p_result.get(f"ind_{ind.get('name', 'preview')}", "N/A")
                    trend.append({
                        "slug": entry["slug"],
                        "label": entry["label"],
                        "value": p_value,
                        "is_baseline": entry["slug"] == base_slug,
                    })
                except FileNotFoundError:
                    continue
                except Exception as e:
                    _log.warning(f"Trend computation for period '{entry['slug']}' failed: {e}")
                    continue
    except Exception as e:
        _log.warning(f"Trend computation failed entirely: {e}")
    return {"value": value, "n_rows": len(df), "trend": trend, "breakdown": breakdown}

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
    _cfg = None
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
    # Apply PII redaction before the summary is computed (no-op when pii: absent).
    from src.utils.pii import apply_pii
    df, _ = apply_pii(df, {}, _cfg or {})
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

def _hidden_view_columns(cfg) -> set:
    """Display-names of questions that are hidden — a view must not consider these."""
    from src.utils.config import is_effective_hidden
    names = set()
    for q in (cfg or {}).get("questions", []) or []:
        if is_effective_hidden(q):
            for k in (q.get("export_label"), q.get("label"), (q.get("kobo_key") or "").split("/")[-1]):
                if k:
                    names.add(str(k))
    return names


async def _compute_view_df(payload):
    """Resolve a view definition to a DataFrame. Shared by preview + CSV export.

    Hidden columns are dropped before renames so the view never considers
    fields the user has hidden. Returns (df, cfg)."""
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
    _cfg = None
    try:
        async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as _f:
            _cfg = yaml.safe_load(await _f.read()) or {}
        _questions_cfg = _cfg.get("questions", [])
        if _questions_cfg:
            main_df = apply_choice_labels(main_df, _questions_cfg)
    except Exception:
        pass
    # Apply PII redaction to source data before view transformations (no-op when pii: absent).
    from src.utils.pii import apply_pii
    main_df, _ = apply_pii(main_df, {}, _cfg or {})
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
        # Apply PII redaction to the repeat table (apply_pii at the top only saw main_df)
        from src.utils.pii import apply_redaction
        df = apply_redaction(df, _cfg or {})
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
    # Exclude hidden columns — the view must not consider hidden fields. Done
    # before renames so matching uses the original (display) column names.
    hidden_names = _hidden_view_columns(_cfg or {})
    if hidden_names:
        df = df.drop(columns=[c for c in df.columns if c in hidden_names], errors="ignore")
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
    return df, _cfg


@app.post("/api/views/preview")
async def preview_view(payload: ViewPreviewPayload):
    import pandas as pd
    df, _cfg = await _compute_view_df(payload)
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


@app.post("/api/views/export-csv")
async def export_view_csv(payload: ViewPreviewPayload):
    """Download the FULL view table as CSV (hidden columns already excluded)."""
    from fastapi.responses import Response
    df, _cfg = await _compute_view_df(payload)
    csv_text = df.to_csv(index=False)
    raw = (payload.view or {}).get("name") or "view"
    safe = "".join(c if (c.isalnum() or c in "_-.") else "_" for c in str(raw)) or "view"
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe}.csv"'},
    )

@app.post("/api/run/{command}")
async def run_command(command: str, payload: RunPayload, request: Request):
    if command not in ALLOWED_COMMANDS:
        raise HTTPException(status_code=400, detail=f"Unknown command '{command}'")
    cmd = [sys.executable, str(BASE_DIR / "src" / "data" / "make.py"), command]
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
    if payload.period and "--period" in ALLOWED_COMMANDS[command]:
        cmd += ["--period", payload.period]
    if payload.compare and "--compare" in ALLOWED_COMMANDS[command]:
        cmd += ["--compare", payload.compare]
    if payload.auto_charts and "--auto-charts" in ALLOWED_COMMANDS[command]:
        cmd += ["--auto-charts"]
    # Resolve the active project (no await — atomic with the registry reservation below).
    run_ctx = None
    lock_key = "__base__"
    with db_session.SessionLocal() as _db:
        _user, _project = _active_project(request, _db)
        if _project is not None:
            if auth.auth_enabled() and not db_repo.role_at_least(db_repo.role_for(_db, _user, _project), "editor"):
                raise HTTPException(status_code=403,
                                    detail="Viewers cannot run the pipeline; an editor or admin role is required.")
            run_ctx = (str(_project.org_id), str(_project.id), dict(_project.config or {}))
            lock_key = str(_project.id)
    try:
        run_id = _registry.start(command, lock_key)
    except _runs.BusyError:
        raise HTTPException(status_code=409,
                            detail="A run is already in progress for this project.")
    except _runs.CapError:
        raise HTTPException(status_code=429,
                            detail="Server is at run capacity; please retry shortly.",
                            headers={"Retry-After": "2"})
    return StreamingResponse(
        _stream(run_id, command, cmd, run_ctx),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

def _persist_run_outputs(org_id: str, project_id: str, dest) -> None:
    """After a successful tempdir run: push outputs to Minio, sync a changed config.yml
    back to the DB, and refresh the active project's BASE_DIR read-mirror."""
    import uuid as _uuid
    storage_workspace.push_outputs(org_id, project_id, base=dest)
    cfg_path = Path(dest) / "config.yml"
    parsed = (yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}) if cfg_path.exists() else {}
    with db_session.SessionLocal() as db:
        project = db.get(db_repo.Project, _uuid.UUID(project_id))
        if project is None:
            return
        if parsed and parsed != project.config:
            db_repo.update_project_config(db, project, parsed)
        db_bridge.materialize_config(project)                              # refresh BASE_DIR/config.yml
        storage_workspace.pull_workspace(org_id, project_id, base=BASE_DIR)  # refresh read mirror


async def _stream(run_id: str, command: str, cmd: list, run_ctx=None) -> AsyncGenerator[str, None]:
    yield _sse("status", {"status": "running", "command": command, "run_id": run_id})

    work_dir = None
    cwd = str(BASE_DIR)
    if run_ctx is not None:
        org_id, project_id, cfg = run_ctx
        work_dir = tempfile.mkdtemp(prefix="dbrun_")
        try:
            storage_workspace.hydrate_run_dir(org_id, project_id, command, work_dir, cfg)
        except Exception as e:
            shutil.rmtree(work_dir, ignore_errors=True)
            _registry.set_status(run_id, "error")
            _registry.finish(run_id)
            yield _sse("log", {"line": f"Error: failed to hydrate run workspace: {e}", "level": "error"})
            yield _sse("status", {"command": command, "status": "error", "run_id": run_id,
                                  "finished_at": datetime.now().isoformat()})
            yield _sse("done", {})
            return
        cwd = work_dir

    yield _sse("log", {"line": f"$ {' '.join(cmd)}", "level": "cmd"})
    env = {**os.environ, "PYTHONPATH": str(BASE_DIR), "PYTHONUNBUFFERED": "1"}
    status = "error"
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT, cwd=cwd, env=env,
        )
        _registry.attach_proc(run_id, proc)
        async for raw in proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip()
            yield _sse("log", {"line": line, "level": _classify(line)})
        await proc.wait()
        status = "success" if proc.returncode == 0 else "error"
    except Exception as e:
        yield _sse("log", {"line": f"Error: {e}", "level": "error"})
        status = "error"
    finally:
        _registry.set_status(run_id, status)
        _registry.finish(run_id)

    if status == "success" and run_ctx is not None:
        try:
            _persist_run_outputs(run_ctx[0], run_ctx[1], work_dir)
        except Exception as e:   # CLI work already succeeded; persistence failure must not crash
            yield _sse("log", {"line": f"Warning: failed to persist outputs to storage: {e}", "level": "error"})
    if work_dir:
        shutil.rmtree(work_dir, ignore_errors=True)

    yield _sse("status", {"command": command, "status": status, "run_id": run_id,
                          "finished_at": datetime.now().isoformat()})
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
    active = _registry.active()
    resp = {"running": len(active) > 0, "runs": [r.public() for r in active]}
    last = _registry.last()
    if last is not None:
        lp = last.public()
        resp.update({"command": lp["command"], "status": lp["status"], "finished_at": lp["finished_at"]})
    return resp


@app.post("/api/stop/{run_id}")
async def stop_run(run_id: str):
    if not await _registry.stop(run_id):
        raise HTTPException(status_code=404, detail="No such active run")
    return {"ok": True}


@app.post("/api/stop")
async def stop_command():
    active = _registry.active()
    if len(active) == 1:
        await _registry.stop(active[0].run_id)
        return {"ok": True}
    if not active:
        return {"ok": False, "detail": "no running process"}
    raise HTTPException(status_code=400, detail="Multiple runs active; specify a run_id (/api/stop/{run_id}).")

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
async def delete_report(filename: str, request: Request):
    _require(request, "editor")
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
async def delete_session_files(session_id: str, request: Request):
    _require(request, "editor")
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
async def delete_data_file(filename: str, request: Request):
    _require(request, "editor")
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
async def upload_template(file: UploadFile, request: Request):
    _require(request, "admin")
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
async def delete_template(filename: str, request: Request):
    _require(request, "admin")
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
async def set_active_template(filename: str, request: Request):
    _require(request, "admin")
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
    _sync_active_project_from_file(request)
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


# ── Periods ─────────────────────────────────────────────────

class PeriodLabelPayload(BaseModel):
    label: str


def _config_path() -> Path:
    """cwd-first config path (matches /api/validate convention)."""
    return Path("config.yml") if Path("config.yml").exists() else CONFIG_PATH


def _load_cfg() -> dict:
    path = _config_path()
    if not path.exists():
        raise HTTPException(status_code=400, detail="config.yml not found")
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f.read()) or {}


def _save_cfg(cfg: dict) -> None:
    path = _config_path()
    with open(path, "w", encoding="utf-8") as f:
        f.write(yaml.dump(cfg, allow_unicode=True, default_flow_style=False, sort_keys=False))


@app.get("/api/periods")
async def get_periods():
    cfg = _load_cfg()
    p = cfg.get("periods") or {}
    return {
        "current":  p.get("current"),
        "baseline": p.get("baseline"),
        "registry": p.get("registry", []) or [],
    }


@app.post("/api/periods/current")
async def set_current_period(payload: PeriodLabelPayload, request: Request):
    _require(request, "editor")
    from src.utils.periods import slugify
    cfg = _load_cfg()
    cfg.setdefault("periods", {})
    cfg["periods"]["current"] = payload.label
    registry = cfg["periods"].setdefault("registry", [])
    if not any(e.get("label") == payload.label for e in registry):
        registry.append({"label": payload.label, "slug": slugify(payload.label)})
    _save_cfg(cfg)
    _sync_active_project_from_file(request)
    return {"current": payload.label, "registry": cfg["periods"]["registry"]}


@app.post("/api/periods/registry")
async def add_registry_period(payload: PeriodLabelPayload, request: Request):
    _require(request, "editor")
    from src.utils.periods import slugify
    cfg = _load_cfg()
    cfg.setdefault("periods", {})
    registry = cfg["periods"].setdefault("registry", [])
    if not any(e.get("label") == payload.label for e in registry):
        registry.append({"label": payload.label, "slug": slugify(payload.label)})
    _save_cfg(cfg)
    _sync_active_project_from_file(request)
    return {"registry": registry}


@app.delete("/api/periods/registry/{slug}")
async def delete_registry_period(slug: str, request: Request):
    _require(request, "admin")
    cfg = _load_cfg()
    p = cfg.setdefault("periods", {})
    registry = p.get("registry", []) or []
    p["registry"] = [e for e in registry if e.get("slug") != slug]
    _save_cfg(cfg)
    _sync_active_project_from_file(request)
    return {"registry": p["registry"]}


# ── Validation ──────────────────────────────────────────────
@app.post("/api/validate")
async def validate():
    """Run all validation detectors against the latest downloaded data."""
    # Prefer cwd-relative config.yml so the endpoint composes with tests that
    # chdir into a temp workspace; fall back to the project's CONFIG_PATH.
    config_path = Path("config.yml") if Path("config.yml").exists() else CONFIG_PATH
    if not config_path.exists():
        raise HTTPException(status_code=400, detail="config.yml not found")
    async with aiofiles.open(config_path, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(await f.read()) or {}
    try:
        from src.data.transform import load_processed_data
        from src.data.validate import validate_dataset
        df, repeat_tables = load_processed_data(cfg)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=f"No downloaded data found. Run Download first. ({e})")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load data: {e}")
    # Apply PII redaction so validation runs against the post-redaction view that
    # users will actually see (no-op when pii: absent).
    from src.utils.pii import apply_pii
    df, repeat_tables = apply_pii(df, repeat_tables, cfg)
    report = validate_dataset(cfg, df, repeat_tables)
    return report


@app.get("/api/base-tables")
async def base_tables():
    """Catalog of the flattened base tables for the latest download session.

    Returns row counts, data columns, linkage columns, and the parent table for
    each repeat level so the UI can show the table hierarchy. Read-only.

    NOTE: parent inference is naming-convention based (longest underscored-prefix
    match). Unrelated tables that happen to share a name prefix could be
    mis-parented; this is acceptable until explicit parent metadata is surfaced.
    """
    cfg = load_config(CONFIG_PATH)
    try:
        df, repeats = load_processed_data(cfg)
    except FileNotFoundError:
        return {"tables": [], "message": "No downloaded data. Run download first."}

    def _entry(name, frame, parent):
        cols = list(frame.columns)
        return {
            "name": name,
            "rows": int(len(frame)),
            "parent": parent,
            "columns": [c for c in cols if not c.startswith("_")],
            "linkage": [c for c in cols if c.startswith("_")],
        }

    # Reloaded repeat tables are keyed by the underscored ("safe") name; derive
    # the parent table by longest underscored-prefix match, falling back to main.
    names = list(repeats.keys())

    def _parent_of(name):
        prefixes = [p for p in names if p != name and name.startswith(p + "_")]
        return max(prefixes, key=lambda p: p.count("_")) if prefixes else "main"

    tables = [_entry("main", df, None)]
    for name, frame in repeats.items():
        tables.append(_entry(name, frame, _parent_of(name)))
    return {"tables": tables}


@app.get("/api/profile")
async def data_profile():
    """Structured EDA profile of every base table for the latest download
    session (row counts, per-column stats, correlations, duplicates). Read-only."""
    cfg = load_config(CONFIG_PATH)
    try:
        df, repeats = load_processed_data(cfg)
    except FileNotFoundError:
        return {"profiles": [], "message": "No downloaded data. Run download first."}
    profiles = profile_dataset(cfg, df, repeats)
    return {"profiles": list(profiles.values())}


@app.get("/api/data-quality")
async def data_quality_overview():
    """Per-column completeness / outlier-rate / duplicate-rate per base table (main
    table in `rows`, each non-empty repeat table in `tables`) for the latest download
    session, post-PII-redaction. Read-only. Mirrors the report's {{ data_quality }} section."""
    from src.reports.data_quality import compute_data_quality
    from src.utils.pii import apply_pii
    cfg = load_config(CONFIG_PATH)
    try:
        df, repeats = load_processed_data(cfg)
    except FileNotFoundError:
        return {"has_data": False, "rows": [], "message": "No downloaded data. Run download first."}
    df, repeats = apply_pii(df, repeats, cfg)
    return compute_data_quality(cfg, df, repeats)


@app.get("/api/periods/date-range")
async def periods_date_range():
    """Min/max submission year in the latest download (UNFILTERED), used to bound
    the Output-tab year picker so it offers only the data's actual span. Returns
    nulls when there's no data or no captured `_submission_time`."""
    import pandas as pd
    cfg = _load_cfg()
    # Strip periods so loading neither date-filters nor slug-prefixes — we want
    # the full span of the latest plain download.
    cfg_unfiltered = {**cfg, "periods": {}}
    try:
        df, _ = load_processed_data(cfg_unfiltered)
    except FileNotFoundError:
        return {"min_year": None, "max_year": None}
    if "_submission_time" not in df.columns:
        return {"min_year": None, "max_year": None}
    ts = pd.to_datetime(df["_submission_time"], errors="coerce").dropna()
    if ts.empty:
        return {"min_year": None, "max_year": None}
    return {"min_year": int(ts.dt.year.min()), "max_year": int(ts.dt.year.max())}


class AskPayload(BaseModel):
    question: str = ""


class AskSavePayload(BaseModel):
    recipe: dict
    kind: str = "chart"


class AskRefinePayload(BaseModel):
    recipe: dict
    kind: str = "chart"
    instruction: str


@app.post("/api/ask")
async def api_ask(payload: AskPayload, request: Request):
    """Answer a natural-language question with 1-3 locally-rendered, grounded charts."""
    question = (payload.question or "").strip()
    if not question:
        return {"proposals": [], "skipped": [], "message": "Type a question to ask."}
    cfg = load_config(CONFIG_PATH)
    try:
        df, repeats = load_processed_data(cfg)
    except FileNotFoundError:
        return {"proposals": [], "skipped": [], "message": "No data yet — run Download first."}
    try:
        return ask_engine.ask(question, cfg, df, repeats)
    except Exception as e:  # noqa: BLE001 — an AI-call failure re-locks the AI buttons
        _invalidate_ai(request)
        raise HTTPException(status_code=500, detail=f"ask failed: {e}")


# Starter-question cache, keyed by (column signature + ai fingerprint). Avoids an
# LLM call on every Ask-tab mount; invalidated automatically when the schema or the
# AI config changes (different key). AI failures that fall back to schema are NOT
# cached, so a transient error retries on the next load.
_ask_examples_cache: dict = {}


@app.get("/api/ask/examples")
def api_ask_examples():
    """Starter questions for the Ask tab: AI-generated from the question schema when
    an AI connection is configured, else deterministic from the schema. Always 200s
    with {"examples": [...], "source": "ai"|"schema"|"none"}; never re-locks AI."""
    from src.reports import ai_ask_examples as aae
    try:
        cfg = load_config(CONFIG_PATH)
    except (FileNotFoundError, ValueError):
        return {"examples": [], "source": "none"}
    qs = [(q.get("export_label") or q.get("label") or q.get("kobo_key") or "",
           q.get("category") or "") for q in (cfg.get("questions") or [])]
    sig = _hashlib.sha256(
        (repr(qs) + "|" + _ai_fingerprint_for(cfg.get("ai") or {})).encode()
    ).hexdigest()
    cached = _ask_examples_cache.get(sig)
    if cached:
        return cached
    result = aae.suggest_examples(cfg)
    # Cache AI successes and genuine schema results; skip caching an AI failure that
    # fell back to schema so it can retry.
    if result.get("source") == "ai" or not aae.ai_available(cfg):
        _ask_examples_cache[sig] = result
    return result


@app.post("/api/ask/save")
async def api_ask_save(payload: AskSavePayload, request: Request):
    """Append a proposed chart recipe to config.charts."""
    _require(request, "editor")
    recipe = payload.recipe
    if not isinstance(recipe, dict):
        return {"ok": False, "error": "missing recipe"}
    cfg = load_config(CONFIG_PATH)
    name = ask_engine.save_recipe(recipe, cfg, payload.kind)
    write_config(cfg, CONFIG_PATH)
    _sync_active_project_from_file(request)
    return {"ok": True, "name": name}


@app.post("/api/ask/refine")
async def api_ask_refine(payload: AskRefinePayload, request: Request):
    """Refine an existing Ask answer with a natural-language instruction."""
    instruction = (payload.instruction or "").strip()
    if not instruction:
        return {"proposal": None, "skipped": None, "message": "Type a refinement instruction."}
    cfg = load_config(CONFIG_PATH)
    try:
        df, repeats = load_processed_data(cfg)
    except FileNotFoundError:
        return {"proposal": None, "skipped": None, "message": "No data yet — run Download first."}
    try:
        return ask_engine.refine_item(payload.recipe, payload.kind, instruction, cfg, df, repeats)
    except Exception as e:  # noqa: BLE001 — an AI-call failure re-locks the AI buttons
        _invalidate_ai(request)
        raise HTTPException(status_code=500, detail=f"refine failed: {e}")


class FrameworkPayload(BaseModel):
    goal:     Optional[Dict] = None
    outcomes: List[Dict] = []
    outputs:  List[Dict] = []


@app.get("/api/framework")
async def get_framework():
    cfg = _load_cfg()
    fw = cfg.get("framework") or {}
    return {
        "goal":     fw.get("goal"),
        "outcomes": fw.get("outcomes", []) or [],
        "outputs":  fw.get("outputs", []) or [],
    }


@app.post("/api/framework")
async def set_framework(payload: FrameworkPayload, request: Request):
    _require(request, "editor")
    cfg = _load_cfg()
    cfg["framework"] = {
        "goal":     payload.goal,
        "outcomes": payload.outcomes,
        "outputs":  payload.outputs,
    }
    _save_cfg(cfg)
    _sync_active_project_from_file(request)
    return {"ok": True}


# ── PII ─────────────────────────────────────────────────────

class PIIPayload(BaseModel):
    consent_column: Optional[str] = None
    consent_value:  str = "yes"
    redact:         List[Dict] = []


@app.get("/api/pii")
async def get_pii():
    cfg = _load_cfg()
    p = cfg.get("pii") or {}
    return {
        "consent_column": p.get("consent_column"),
        "consent_value":  p.get("consent_value", "yes"),
        "redact":         p.get("redact", []) or [],
    }


@app.post("/api/pii")
async def set_pii(payload: PIIPayload, request: Request):
    _require(request, "editor")
    cfg = _load_cfg()
    cfg["pii"] = {
        "consent_column": payload.consent_column,
        "consent_value":  payload.consent_value,
        "redact":         payload.redact,
    }
    _save_cfg(cfg)
    _sync_active_project_from_file(request)
    return {"ok": True}
