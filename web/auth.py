"""Authentication: Zitadel OIDC login gate (BFF + encrypted cookie session)."""
import base64
import hashlib
import json
import logging
import os
import time
from cryptography.fernet import Fernet, InvalidToken
from fastapi.responses import JSONResponse
from starlette.responses import RedirectResponse
from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import Request


def _fernet_key(secret: str) -> bytes:
    """Derive a valid 32-byte url-safe base64 Fernet key from any secret string."""
    return base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())


class SessionCodec:
    """Encrypt/decrypt the session cookie payload. Returns None on any failure."""

    def __init__(self, secret: str):
        self._f = Fernet(_fernet_key(secret))

    def encode(self, payload: dict) -> str:
        return self._f.encrypt(json.dumps(payload).encode()).decode()

    def decode(self, token: str) -> dict | None:
        try:
            return json.loads(self._f.decrypt(token.encode()).decode())
        except (InvalidToken, ValueError, TypeError):
            return None


DEV_USER = {"sub": "dev-local", "email": "dev@localhost", "name": "Local Dev"}
SESSION_COOKIE = "db_session"


def auth_enabled() -> bool:
    return all(os.environ.get(k) for k in ("OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"))


def session_codec() -> SessionCodec:
    return SessionCodec(os.environ.get("SESSION_SECRET", "dev-insecure-secret"))


def _public_user(payload: dict) -> dict:
    return {"sub": payload["sub"], "email": payload.get("email", ""), "name": payload.get("name", "")}


def current_user(cookie_value: str | None) -> dict | None:
    """Resolve the current user. Dev user when auth disabled; else decode the cookie.
    Returns None when auth is enabled and there is no valid, unexpired session."""
    if not auth_enabled():
        return DEV_USER
    if not cookie_value:
        return None
    payload = session_codec().decode(cookie_value)
    if not payload or payload.get("sess_exp", 0) < time.time():
        return None
    return _public_user(payload)


async def refresh_access_token(refresh_token: str) -> dict:
    """Exchange a refresh token for a new one at the IdP. Returns the new token dict."""
    return await _get_oauth().zitadel.fetch_access_token(
        refresh_token=refresh_token, grant_type="refresh_token")


async def resolve_session(cookie_value: str | None):
    """Return (user|None, new_cookie|None). Refreshes transparently when the access
    token is expired but the session window is still open. new_cookie is set only
    when a refresh produced a new payload."""
    if not auth_enabled():
        return DEV_USER, None
    if not cookie_value:
        return None, None
    payload = session_codec().decode(cookie_value)
    if not payload or payload.get("sess_exp", 0) < time.time():
        return None, None
    if payload.get("access_exp", 0) >= time.time():
        return _public_user(payload), None
    # access token expired, session still valid -> try refresh
    try:
        tok = await refresh_access_token(payload.get("refresh_token", ""))
    except Exception:
        return None, None
    now = time.time()
    payload["refresh_token"] = tok.get("refresh_token", payload.get("refresh_token", ""))
    payload["access_exp"] = now + tok.get("expires_in", 3600)
    return _public_user(payload), session_codec().encode(payload)


log = logging.getLogger("databridge.auth")

# Paths reachable without a session. Everything else under these prefixes is gated.
_PROTECTED_PREFIXES = ("/api/", "/terminal")
_WHITELIST = ("/auth/", "/api/health")


def _needs_auth(path: str) -> bool:
    if any(path.startswith(w) for w in _WHITELIST):
        return False
    return any(path.startswith(p) for p in _PROTECTED_PREFIXES)


_oauth = None  # Authlib registry, built lazily once auth is enabled


def _get_oauth():
    global _oauth
    if _oauth is None:
        from authlib.integrations.starlette_client import OAuth
        _oauth = OAuth()
        _oauth.register(
            name="zitadel",
            client_id=os.environ["OIDC_CLIENT_ID"],
            client_secret=os.environ["OIDC_CLIENT_SECRET"],
            server_metadata_url=os.environ["OIDC_ISSUER"].rstrip("/")
            + "/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email profile offline_access"},
        )
    return _oauth


def _redirect_uri() -> str:
    return os.environ.get("APP_BASE_URL", "http://localhost:8000").rstrip("/") + "/auth/callback"


async def build_login_redirect(request, redirect_uri):
    """Authlib: stash PKCE/state/nonce in the handshake session and 302 to the IdP."""
    return await _get_oauth().zitadel.authorize_redirect(request, redirect_uri)


async def exchange_token(request) -> dict:
    """Authlib: exchange the code, validate the id_token, return a flat claims dict."""
    token = await _get_oauth().zitadel.authorize_access_token(request)
    info = token.get("userinfo") or {}
    return {
        "sub": info.get("sub"),
        "email": info.get("email", ""),
        "name": info.get("name", ""),
        "refresh_token": token.get("refresh_token", ""),
        "expires_in": token.get("expires_in", 3600),
    }


async def end_session_url() -> str:
    meta = await _get_oauth().zitadel.load_server_metadata()
    base = meta.get("end_session_endpoint", os.environ["OIDC_ISSUER"].rstrip("/") + "/oidc/v1/end_session")
    redir = os.environ.get("APP_BASE_URL", "http://localhost:8000").rstrip("/")
    return f"{base}?post_logout_redirect_uri={redir}"


def _build_session_cookie(claims: dict) -> str:
    now = time.time()
    return session_codec().encode({
        "sub": claims["sub"], "email": claims["email"], "name": claims["name"],
        "refresh_token": claims["refresh_token"],
        "access_exp": now + claims.get("expires_in", 3600),
        "sess_exp": now + 12 * 3600,
    })


def register_auth(app) -> None:
    """Install the enforcement middleware, /api/me, and (when configured) the /auth OIDC routes."""
    if auth_enabled():
        log.info("AUTH ENABLED — Zitadel OIDC (issuer=%s)", os.environ.get("OIDC_ISSUER"))
    else:
        log.warning("AUTH DISABLED — no OIDC config; all requests run as dev user")

    @app.middleware("http")
    async def _auth_mw(request, call_next):
        user, new_cookie = await resolve_session(request.cookies.get(SESSION_COOKIE))
        request.state.user = user
        if user is None and _needs_auth(request.url.path):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        response = await call_next(request)
        if new_cookie:
            response.set_cookie(SESSION_COOKIE, new_cookie,
                                httponly=True, secure=False, samesite="lax", path="/")
        return response

    @app.get("/api/me")
    async def auth_me(request: Request):
        return request.state.user

    if not auth_enabled():
        return

    app.add_middleware(SessionMiddleware,
                       secret_key=os.environ.get("SESSION_SECRET", "dev-insecure-secret"),
                       same_site="lax", https_only=False)

    @app.get("/auth/login")
    async def auth_login(request: Request):
        return await build_login_redirect(request, _redirect_uri())

    @app.get("/auth/callback")
    async def auth_callback(request: Request):
        claims = await exchange_token(request)
        import asyncio
        from web.db import session as _dbs, provision as _prov
        def _do_provision():
            with _dbs.SessionLocal() as db:
                _prov.ensure_user(db, claims)
        await asyncio.to_thread(_do_provision)
        resp = RedirectResponse("/", status_code=302)
        resp.set_cookie(SESSION_COOKIE, _build_session_cookie(claims),
                        httponly=True, secure=False, samesite="lax", path="/")
        return resp

    @app.post("/auth/logout")
    async def auth_logout(request: Request):
        resp = RedirectResponse(await end_session_url(), status_code=302)
        resp.delete_cookie(SESSION_COOKIE, path="/")
        return resp
