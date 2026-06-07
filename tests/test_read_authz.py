"""Security: file/data read & download endpoints must require a role on the
caller's active project. Without gating, any authenticated user — including one
who is a member of nothing and has no active project — can read whatever is in
the shared BASE_DIR mirror (another tenant's reports/data/profile). Audit #5."""
import time

import pytest
from fastapi.testclient import TestClient

from web import auth


@pytest.fixture
def stranger_client(monkeypatch):
    """An auth-enabled client carrying a valid session for a brand-new user who
    is a member of nothing and has no active project."""
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t-for-tests")
    auth._oauth = None
    from web.main import app
    token = auth.session_codec().encode({
        "sub": "stranger-sub", "email": "stranger@x.io", "name": "Stranger",
        "sess_exp": time.time() + 3600, "access_exp": time.time() + 3600,
        "refresh_token": "rt",
    })
    with TestClient(app) as c:
        c.cookies.set(auth.SESSION_COOKIE, token)
        yield c
    auth._oauth = None


# Each of these served the shared mirror with no authorization. A member-of-nothing
# user must be refused (400 no active project / 403), never 200.
READ_ENDPOINTS = [
    ("GET", "/api/reports"),
    ("GET", "/api/reports/download/x.docx"),
    ("GET", "/api/reports/download-zip"),
    ("GET", "/api/data"),
    ("GET", "/api/data/sessions"),
    ("GET", "/api/data/sessions/abc/download"),
    ("GET", "/api/data/download/x.csv"),
    ("GET", "/api/templates"),
    ("GET", "/api/templates/download/x.docx"),
    ("GET", "/api/base-tables"),
    ("GET", "/api/profile"),
    ("GET", "/api/data-quality"),
    ("POST", "/api/validate"),
]


@pytest.mark.parametrize("method,path", READ_ENDPOINTS)
def test_stranger_cannot_read_mirror(stranger_client, method, path):
    r = stranger_client.request(method, path, json={} if method == "POST" else None)
    assert r.status_code != 200, f"{method} {path} should be gated, got {r.status_code}"
    assert r.status_code in (400, 403), f"{method} {path} -> {r.status_code}"
