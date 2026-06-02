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
