# Zitadel Login Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the existing single-config app behind Zitadel OIDC login using a server-side BFF pattern with a stateless encrypted session cookie, while keeping local dev frictionless when Zitadel is unconfigured.

**Architecture:** A new `web/auth.py` module owns OIDC config detection, an encrypted-cookie session codec (Fernet), thin testable wrappers around Authlib's login handshake, four `/auth` + `/api/me` routes, and an HTTP middleware that enforces login on `/api/*` and `/terminal` (returning `401` JSON) while letting the SPA shell load. When Zitadel env vars are absent, auth is disabled and every request resolves to a fixed dev user. The frontend intercepts `401` at its two fetch chokepoints and redirects to `/auth/login`.

**Tech Stack:** FastAPI/Starlette, Authlib (OIDC code+PKCE), `cryptography` (Fernet), React, Vite.

Spec: [docs/superpowers/specs/2026-06-02-zitadel-login-gate-design.md](../specs/2026-06-02-zitadel-login-gate-design.md)

---

## File Structure

- **Create** `web/auth.py` — all auth logic: env config, `SessionCodec`, dev user, Authlib wrappers (`build_login_redirect`, `exchange_token`, `end_session_url`), `current_user`, the middleware, and `register_auth(app)`.
- **Modify** `web/main.py` — call `register_auth(app)` once after `app` is created.
- **Modify** `requirements.txt` — add `authlib`, `cryptography`, `itsdangerous`.
- **Modify** `.env.example` — add the five OIDC env vars; remove the stale `BASIC_AUTH_USERS` line.
- **Modify** `frontend/vite.config.js` — proxy `/auth` to `:8000`.
- **Create** `frontend/src/lib/auth.js` — `handle401(res)` redirect helper + `fetchMe()`.
- **Modify** `frontend/src/hooks/useCommand.js` and `frontend/src/lib/config.js` — call `handle401` on non-OK responses.
- **Modify** `frontend/src/App.jsx` — bootstrap `fetchMe()`, show signed-in user + logout button.
- **Create** `tests/test_auth.py` — all backend auth tests.

Session cookie name: `db_session`. Payload (JSON, Fernet-encrypted): `{"sub","email","name","sess_exp","access_exp","refresh_token"}`. `sess_exp` = absolute session lifetime (12h); `access_exp` = access-token expiry (drives transparent refresh). Auth env vars: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_SECRET`, `APP_BASE_URL`.

---

## Task 1: Dependencies and env template

**Files:**
- Modify: `requirements.txt`
- Modify: `.env.example`

- [ ] **Step 1: Add Python deps**

In `requirements.txt`, after the `aiofiles>=23.2.1` line, add:

```
# Auth — OIDC login gate (BFF + encrypted cookie session)
authlib>=1.3.0
cryptography>=42.0.0
itsdangerous>=2.1.0
```

- [ ] **Step 2: Install them**

Run: `pip install -r requirements.txt`
Expected: installs `authlib`, `cryptography`, `itsdangerous` with no errors.

- [ ] **Step 3: Update `.env.example`**

In `.env.example`, replace the line `BASIC_AUTH_USERS=admin:$$apr1$$xyz...` with:

```
# Auth — Zitadel OIDC login gate. Leave OIDC_* empty to run with auth DISABLED
# (local dev: every request resolves to a built-in dev user).
OIDC_ISSUER=                     # e.g. https://your-instance.zitadel.cloud
OIDC_CLIENT_ID=
OIDC_CLIENT_SECRET=
SESSION_SECRET=                  # any long random string; used to encrypt the session cookie
APP_BASE_URL=http://localhost:8000   # public base URL; drives the OIDC redirect URI
```

- [ ] **Step 4: Commit**

```bash
git add requirements.txt .env.example
git commit -m "chore(auth): add OIDC deps and env template for login gate"
```

---

## Task 2: SessionCodec (encrypted cookie)

**Files:**
- Create: `web/auth.py`
- Test: `tests/test_auth.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_auth.py`:

```python
import time
import pytest
from web import auth


def test_session_codec_roundtrip():
    codec = auth.SessionCodec("a-very-secret-key")
    token = codec.encode({"sub": "u1", "email": "u1@x.io"})
    assert isinstance(token, str)
    out = codec.decode(token)
    assert out["sub"] == "u1"
    assert out["email"] == "u1@x.io"


def test_session_codec_rejects_tampered():
    codec = auth.SessionCodec("a-very-secret-key")
    token = codec.encode({"sub": "u1"})
    assert codec.decode(token[:-2] + "xy") is None


def test_session_codec_rejects_wrong_key():
    token = auth.SessionCodec("key-one").encode({"sub": "u1"})
    assert auth.SessionCodec("key-two").decode(token) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_auth.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.auth'` (or `AttributeError: SessionCodec`).

- [ ] **Step 3: Write minimal implementation**

Create `web/auth.py`:

```python
"""Authentication: Zitadel OIDC login gate (BFF + encrypted cookie session)."""
import base64
import hashlib
import json
from cryptography.fernet import Fernet, InvalidToken


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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_auth.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add web/auth.py tests/test_auth.py
git commit -m "feat(auth): encrypted-cookie SessionCodec"
```

---

## Task 3: Config detection, dev user, current_user

**Files:**
- Modify: `web/auth.py`
- Test: `tests/test_auth.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_auth.py`:

```python
def test_auth_disabled_when_no_oidc(monkeypatch):
    for k in ("OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"):
        monkeypatch.delenv(k, raising=False)
    assert auth.auth_enabled() is False


def test_auth_enabled_when_oidc_present(monkeypatch):
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    assert auth.auth_enabled() is True


def test_current_user_returns_dev_user_when_disabled(monkeypatch):
    monkeypatch.delenv("OIDC_ISSUER", raising=False)
    assert auth.current_user(cookie_value=None) == auth.DEV_USER


def test_current_user_decodes_valid_session(monkeypatch):
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")
    token = auth.session_codec().encode({
        "sub": "u9", "email": "u9@x.io", "name": "Niner",
        "sess_exp": time.time() + 3600, "access_exp": time.time() + 3600,
        "refresh_token": "rt",
    })
    user = auth.current_user(cookie_value=token)
    assert user == {"sub": "u9", "email": "u9@x.io", "name": "Niner"}


def test_current_user_rejects_expired_session(monkeypatch):
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")
    token = auth.session_codec().encode({
        "sub": "u9", "email": "u9@x.io", "name": "Niner",
        "sess_exp": time.time() - 1, "access_exp": time.time() - 1,
        "refresh_token": "rt",
    })
    assert auth.current_user(cookie_value=token) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_auth.py -v`
Expected: FAIL — `AttributeError: module 'web.auth' has no attribute 'auth_enabled'`.

- [ ] **Step 3: Write minimal implementation**

Add to `web/auth.py` (after `SessionCodec`):

```python
import os
import time

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_auth.py -v`
Expected: PASS (all tests so far).

- [ ] **Step 5: Commit**

```bash
git add web/auth.py tests/test_auth.py
git commit -m "feat(auth): config detection, dev-user fallback, current_user"
```

---

## Task 4: Enforcement middleware + register_auth wiring

**Files:**
- Modify: `web/auth.py`
- Modify: `web/main.py`
- Test: `tests/test_auth.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_auth.py`:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _app_with_auth():
    app = FastAPI()

    @app.get("/api/ping")
    async def ping(): return {"ok": True}

    @app.get("/api/health")
    async def health(): return {"status": "ok"}

    @app.get("/")
    async def root(): return {"shell": True}

    auth.register_auth(app)
    return app


def test_middleware_allows_all_when_disabled(monkeypatch):
    monkeypatch.delenv("OIDC_ISSUER", raising=False)
    client = TestClient(_app_with_auth())
    assert client.get("/api/ping").status_code == 200


def test_middleware_blocks_api_when_enabled_no_session(monkeypatch):
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")
    client = TestClient(_app_with_auth())
    r = client.get("/api/ping")
    assert r.status_code == 401
    assert r.json()["detail"] == "Not authenticated"


def test_middleware_whitelists_health_and_shell(monkeypatch):
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")
    client = TestClient(_app_with_auth())
    assert client.get("/api/health").status_code == 200   # whitelisted
    assert client.get("/").status_code == 200             # SPA shell loads freely


def test_middleware_allows_api_with_valid_session(monkeypatch):
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")
    token = auth.session_codec().encode({
        "sub": "u1", "email": "u1@x.io", "name": "One",
        "sess_exp": time.time() + 3600, "access_exp": time.time() + 3600,
        "refresh_token": "rt",
    })
    client = TestClient(_app_with_auth())
    client.cookies.set(auth.SESSION_COOKIE, token)
    assert client.get("/api/ping").status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_auth.py -v`
Expected: FAIL — `AttributeError: module 'web.auth' has no attribute 'register_auth'`.

- [ ] **Step 3: Write minimal implementation**

Add to `web/auth.py`:

```python
import logging
from fastapi.responses import JSONResponse

log = logging.getLogger("databridge.auth")

# Paths reachable without a session. Everything else under these prefixes is gated.
_PROTECTED_PREFIXES = ("/api/", "/terminal")
_WHITELIST = ("/auth/", "/api/health")


def _needs_auth(path: str) -> bool:
    if any(path.startswith(w) for w in _WHITELIST):
        return False
    return any(path.startswith(p) for p in _PROTECTED_PREFIXES)


def register_auth(app) -> None:
    """Install the enforcement middleware (and, in a later task, the /auth routes)."""
    if auth_enabled():
        log.info("AUTH ENABLED — Zitadel OIDC (issuer=%s)", os.environ.get("OIDC_ISSUER"))
    else:
        log.warning("AUTH DISABLED — no OIDC config; all requests run as dev user")

    @app.middleware("http")
    async def _auth_mw(request, call_next):
        user = current_user(request.cookies.get(SESSION_COOKIE))
        request.state.user = user
        if user is None and _needs_auth(request.url.path):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        return await call_next(request)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_auth.py -v`
Expected: PASS (all tests).

- [ ] **Step 5: Wire into the real app**

In `web/main.py`, add the import near the other `from src...`/local imports (line ~14):

```python
from web import auth
```

Then immediately after the `app = FastAPI(...)` line (currently line 27), add:

```python
auth.register_auth(app)
```

- [ ] **Step 6: Verify the existing suite still passes with auth disabled**

Run: `pytest tests/ -q`
Expected: PASS — existing API tests run because no OIDC env is set in CI, so auth is disabled and every request resolves to the dev user.

- [ ] **Step 7: Commit**

```bash
git add web/auth.py web/main.py tests/test_auth.py
git commit -m "feat(auth): enforcement middleware gating /api and /terminal"
```

---

## Task 5: OIDC routes — login, callback, logout, /api/me

**Files:**
- Modify: `web/auth.py`
- Test: `tests/test_auth.py`

This task adds thin, individually-mockable wrappers around Authlib so the routes are testable without a live Zitadel. The Authlib registry is built lazily inside the wrappers.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_auth.py`:

```python
def _enable(monkeypatch):
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")
    monkeypatch.setenv("APP_BASE_URL", "http://testserver")


def test_login_redirects_to_idp(monkeypatch):
    _enable(monkeypatch)

    async def fake_redirect(request, redirect_uri):
        from starlette.responses import RedirectResponse
        return RedirectResponse(f"https://z.example/authorize?redirect_uri={redirect_uri}")

    monkeypatch.setattr(auth, "build_login_redirect", fake_redirect)
    client = TestClient(_app_with_auth(), follow_redirects=False)
    r = client.get("/auth/login")
    assert r.status_code in (302, 307)
    assert "z.example/authorize" in r.headers["location"]


def test_callback_sets_session_and_redirects(monkeypatch):
    _enable(monkeypatch)

    async def fake_exchange(request):
        return {"sub": "abc", "email": "abc@x.io", "name": "Abc",
                "refresh_token": "rt", "expires_in": 3600}

    monkeypatch.setattr(auth, "exchange_token", fake_exchange)
    client = TestClient(_app_with_auth(), follow_redirects=False)
    r = client.get("/auth/callback?code=xyz&state=s")
    assert r.status_code in (302, 307)
    assert r.headers["location"] == "/"
    assert auth.SESSION_COOKIE in r.cookies
    # the freshly-set cookie authenticates a follow-up request
    client.cookies.set(auth.SESSION_COOKIE, r.cookies[auth.SESSION_COOKIE])
    me = client.get("/api/me")
    assert me.status_code == 200 and me.json()["email"] == "abc@x.io"


def test_me_returns_401_without_session(monkeypatch):
    _enable(monkeypatch)
    client = TestClient(_app_with_auth())
    assert client.get("/api/me").status_code == 401


def test_logout_clears_cookie(monkeypatch):
    _enable(monkeypatch)
    monkeypatch.setattr(auth, "end_session_url", lambda: "https://z.example/logout")
    token = auth.session_codec().encode({
        "sub": "u1", "email": "u1@x.io", "name": "One",
        "sess_exp": time.time() + 3600, "access_exp": time.time() + 3600,
        "refresh_token": "rt",
    })
    client = TestClient(_app_with_auth(), follow_redirects=False)
    client.cookies.set(auth.SESSION_COOKIE, token)
    r = client.post("/auth/logout")
    assert r.status_code in (302, 307)
    assert "z.example/logout" in r.headers["location"]
```

Note: `_app_with_auth` from Task 4 must also register the routes — Step 3 makes `register_auth` add them, so no test-helper change is needed.

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_auth.py -v`
Expected: FAIL — `/auth/login` returns 404 (routes not registered yet) / `AttributeError: build_login_redirect`.

- [ ] **Step 3: Write minimal implementation**

Add to `web/auth.py` (imports at top): `from starlette.responses import RedirectResponse`. Add the SessionMiddleware import: `from starlette.middleware.sessions import SessionMiddleware`. Then add the Authlib wrappers and routes:

```python
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


def end_session_url() -> str:
    meta = _get_oauth().zitadel.load_server_metadata()
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
```

Then, inside `register_auth(app)`, **after** the `_auth_mw` definition, add the SessionMiddleware (handshake-only) and the routes:

```python
    if auth_enabled():
        app.add_middleware(SessionMiddleware,
                           secret_key=os.environ.get("SESSION_SECRET", "dev-insecure-secret"),
                           same_site="lax", https_only=False)

    @app.get("/auth/login")
    async def auth_login(request):
        return await build_login_redirect(request, _redirect_uri())

    @app.get("/auth/callback")
    async def auth_callback(request):
        claims = await exchange_token(request)
        resp = RedirectResponse("/", status_code=302)
        resp.set_cookie(SESSION_COOKIE, _build_session_cookie(claims),
                        httponly=True, secure=False, samesite="lax", path="/")
        return resp

    @app.post("/auth/logout")
    async def auth_logout(request):
        resp = RedirectResponse(end_session_url(), status_code=302)
        resp.delete_cookie(SESSION_COOKIE, path="/")
        return resp

    @app.get("/api/me")
    async def auth_me(request):
        return request.state.user
```

Note on `secure=False`: cookies are set without the Secure flag so the flow works over plain HTTP in dev/dev-container. Behind TLS in prod, set it via a follow-up (a `COOKIE_SECURE` env toggle) — tracked as a deployment hardening item, out of scope for this slice.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_auth.py -v`
Expected: PASS (all auth tests).

- [ ] **Step 5: Run the full suite**

Run: `pytest tests/ -q`
Expected: PASS — existing tests still green (auth disabled in CI).

- [ ] **Step 6: Commit**

```bash
git add web/auth.py tests/test_auth.py
git commit -m "feat(auth): /auth login+callback+logout and /api/me routes"
```

---

## Task 6: Transparent access-token refresh

**Files:**
- Modify: `web/auth.py`
- Test: `tests/test_auth.py`

When the access token is expired but the session is still within its 12h window, refresh silently instead of forcing re-login.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_auth.py`:

```python
def test_refresh_renews_expired_access_token(monkeypatch):
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")

    def fake_refresh(refresh_token):
        assert refresh_token == "rt"
        return {"refresh_token": "rt2", "expires_in": 3600}

    monkeypatch.setattr(auth, "refresh_access_token", fake_refresh)
    now = time.time()
    token = auth.session_codec().encode({
        "sub": "u1", "email": "u1@x.io", "name": "One",
        "sess_exp": now + 3600, "access_exp": now - 1,   # access expired, session valid
        "refresh_token": "rt",
    })
    user, new_cookie = auth.resolve_session(token)
    assert user["sub"] == "u1"
    assert new_cookie is not None                       # a refreshed cookie was minted
    refreshed = auth.session_codec().decode(new_cookie)
    assert refreshed["refresh_token"] == "rt2"
    assert refreshed["access_exp"] > now


def test_refresh_failure_invalidates_session(monkeypatch):
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")

    def fake_refresh(refresh_token):
        raise RuntimeError("refresh rejected")

    monkeypatch.setattr(auth, "refresh_access_token", fake_refresh)
    now = time.time()
    token = auth.session_codec().encode({
        "sub": "u1", "email": "u1@x.io", "name": "One",
        "sess_exp": now + 3600, "access_exp": now - 1,
        "refresh_token": "rt",
    })
    user, new_cookie = auth.resolve_session(token)
    assert user is None and new_cookie is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_auth.py -v`
Expected: FAIL — `AttributeError: module 'web.auth' has no attribute 'resolve_session'`.

- [ ] **Step 3: Write minimal implementation**

Add to `web/auth.py`:

```python
def refresh_access_token(refresh_token: str) -> dict:
    """Exchange a refresh token for a new one at the IdP. Returns the new token dict."""
    return _get_oauth().zitadel.fetch_access_token(
        refresh_token=refresh_token, grant_type="refresh_token")


def resolve_session(cookie_value: str | None):
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
        tok = refresh_access_token(payload.get("refresh_token", ""))
    except Exception:
        return None, None
    now = time.time()
    payload["refresh_token"] = tok.get("refresh_token", payload.get("refresh_token", ""))
    payload["access_exp"] = now + tok.get("expires_in", 3600)
    return _public_user(payload), session_codec().encode(payload)
```

Now route the middleware through `resolve_session` so refreshed cookies are written back. In `register_auth`, replace the body of `_auth_mw` with:

```python
    @app.middleware("http")
    async def _auth_mw(request, call_next):
        user, new_cookie = resolve_session(request.cookies.get(SESSION_COOKIE))
        request.state.user = user
        if user is None and _needs_auth(request.url.path):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        response = await call_next(request)
        if new_cookie:
            response.set_cookie(SESSION_COOKIE, new_cookie,
                                httponly=True, secure=False, samesite="lax", path="/")
        return response
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_auth.py -v`
Expected: PASS (all auth tests including the two refresh tests).

- [ ] **Step 5: Run the full suite**

Run: `pytest tests/ -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/auth.py tests/test_auth.py
git commit -m "feat(auth): transparent access-token refresh in middleware"
```

---

## Task 7: Frontend — 401 redirect, proxy, user menu

**Files:**
- Modify: `frontend/vite.config.js`
- Create: `frontend/src/lib/auth.js`
- Modify: `frontend/src/lib/config.js`
- Modify: `frontend/src/hooks/useCommand.js`
- Modify: `frontend/src/App.jsx`

These are UI-glue changes verified by manual run (no JS test harness exists in this repo).

- [ ] **Step 1: Proxy `/auth` in dev**

In `frontend/vite.config.js`, add `/auth` to the `proxy` block so it sits beside `/api` and `/terminal`:

```js
    proxy: {
      '/api': 'http://localhost:8000',
      '/auth': 'http://localhost:8000',
      '/terminal': { target: 'http://localhost:8000', ws: true },
    },
```

- [ ] **Step 2: Create the auth helper**

Create `frontend/src/lib/auth.js`:

```js
// On a 401 from any API call, the session is gone/expired — bounce to the IdP login.
// Returns true if it handled (redirected), so callers can stop processing.
export function handle401(res) {
  if (res && res.status === 401) {
    window.location.href = '/auth/login';
    return true;
  }
  return false;
}

// Who am I? Returns the user object, or null if not signed in.
export async function fetchMe() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Hook 401 into the config fetch helpers**

In `frontend/src/lib/config.js`, add the import at the top:

```js
import { handle401 } from './auth.js';
```

In `saveConfigPatch` and `saveConfigText`, change the `if (!res.ok) {` blocks to redirect on 401 first. For each, insert as the first line inside the block:

```js
    if (handle401(res)) return;
```

(So each becomes `if (!res.ok) { if (handle401(res)) return; const data = ...; throw new Error(...); }`.)

- [ ] **Step 4: Hook 401 into the command runner**

In `frontend/src/hooks/useCommand.js`, add the import at the top:

```js
import { handle401 } from '../lib/auth.js';
```

Inside `run`, in the `if (!res.ok) {` block, insert as the first line:

```js
        if (handle401(res)) return;
```

- [ ] **Step 5: Bootstrap user + logout in App**

In `frontend/src/App.jsx`, import the helper and add a signed-in indicator. Add near the top imports:

```jsx
import { fetchMe } from './lib/auth.js';
```

Inside the `App` component, add state + effect (place beside the other `useState`/`useEffect` hooks):

```jsx
  const [me, setMe] = useState(null);
  useEffect(() => { fetchMe().then(setMe); }, []);
```

In the Topbar JSX (next to the project switcher), render the user + logout when signed in:

```jsx
  {me && me.email && me.sub !== 'dev-local' && (
    <form method="POST" action="/auth/logout" style={{ display: 'inline' }}>
      <span className="topbar-user">{me.email}</span>
      <button type="submit" className="topbar-logout">Sign out</button>
    </form>
  )}
```

(If `useState`/`useEffect` aren't already imported in `App.jsx`, add them to the existing `react` import.)

- [ ] **Step 6: Manual verification — auth disabled (default dev)**

Run: `./scripts/dev.sh`
Open the forwarded `:51730` URL. Expected: the app loads and works exactly as before; no "Sign out" button appears (dev user has `sub === 'dev-local'`). The uvicorn log shows `AUTH DISABLED — no OIDC config`.

- [ ] **Step 7: Manual verification — auth enabled**

Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `SESSION_SECRET`, `APP_BASE_URL` in `.env` against a Zitadel app whose registered redirect URI is `<APP_BASE_URL>/auth/callback`. Run `./scripts/serve.sh`. Expected: visiting the app issues a `401` on the first `/api/*` call, the frontend redirects to `/auth/login` → Zitadel → back to `/auth/callback`, the session cookie is set, the app loads, and the Topbar shows your email + a working "Sign out".

- [ ] **Step 8: Commit**

```bash
git add frontend/vite.config.js frontend/src/lib/auth.js frontend/src/lib/config.js frontend/src/hooks/useCommand.js frontend/src/App.jsx
git commit -m "feat(auth): frontend 401->login redirect, /auth proxy, user menu"
```

---

## Self-Review notes

- **Spec coverage:** library/Authlib (T1,T5) · encrypted cookie + refresh token (T2,T5,T6) · routes login/callback/logout/me (T5) · middleware gating `/api/*`+`/terminal`, whitelist `/auth/*`+`/api/health`, SPA shell loads (T4) · 401→`/auth/login` at both fetch chokepoints (T7) · transparent refresh (T6) · dev fallback + loud log (T3,T4) · Vite `/auth` proxy (T7) · env vars (T1) · TDD for dependency/callback/codec/me/logout (T2–T6). All spec sections map to a task.
- **Cookie `secure` flag:** intentionally `False` in this slice for HTTP dev; hardening to a `COOKIE_SECURE` env toggle is called out inline as a deployment item (out of scope), consistent with the spec's risk notes.
- **Naming consistency:** `SESSION_COOKIE`, `session_codec()`, `current_user`, `resolve_session`, `build_login_redirect`, `exchange_token`, `refresh_access_token`, `end_session_url`, `register_auth` are used identically across tasks.
- **Note:** `current_user` (Task 3) is superseded by `resolve_session` in the middleware (Task 6); it is retained because `resolve_session` delegates the same decode/expiry logic and Task 3's unit tests still pin that behavior. No dead-code removal needed within this slice.
