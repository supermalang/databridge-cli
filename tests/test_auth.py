import asyncio
import time
import pytest
from web import auth


@pytest.fixture(autouse=True)
def _reset_oauth():
    auth._oauth = None
    yield
    auth._oauth = None


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


def test_secure_cookies_follow_app_base_url(monkeypatch):
    monkeypatch.delenv("SESSION_COOKIE_SECURE", raising=False)
    monkeypatch.setenv("APP_BASE_URL", "https://app.example.com")
    assert auth._secure_cookies() is True       # https in prod → Secure cookies
    monkeypatch.setenv("APP_BASE_URL", "http://localhost:8000")
    assert auth._secure_cookies() is False      # http dev → not Secure
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "false")
    monkeypatch.setenv("APP_BASE_URL", "https://app.example.com")
    assert auth._secure_cookies() is False      # explicit override wins


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
    client.cookies.set(auth.SESSION_COOKIE, r.cookies[auth.SESSION_COOKIE])
    me = client.get("/api/me")
    assert me.status_code == 200 and me.json()["email"] == "abc@x.io"


def test_me_returns_401_without_session(monkeypatch):
    _enable(monkeypatch)
    client = TestClient(_app_with_auth())
    assert client.get("/api/me").status_code == 401


def test_logout_clears_cookie(monkeypatch):
    _enable(monkeypatch)
    async def fake_end_session():
        return "https://z.example/logout"
    monkeypatch.setattr(auth, "end_session_url", fake_end_session)
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


def test_refresh_renews_expired_access_token(monkeypatch):
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")

    async def fake_refresh(refresh_token):
        assert refresh_token == "rt"
        return {"refresh_token": "rt2", "expires_in": 3600}

    monkeypatch.setattr(auth, "refresh_access_token", fake_refresh)
    now = time.time()
    token = auth.session_codec().encode({
        "sub": "u1", "email": "u1@x.io", "name": "One",
        "sess_exp": now + 3600, "access_exp": now - 1,   # access expired, session valid
        "refresh_token": "rt",
    })
    user, new_cookie = asyncio.run(auth.resolve_session(token))
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

    async def fake_refresh(refresh_token):
        raise RuntimeError("refresh rejected")

    monkeypatch.setattr(auth, "refresh_access_token", fake_refresh)
    now = time.time()
    token = auth.session_codec().encode({
        "sub": "u1", "email": "u1@x.io", "name": "One",
        "sess_exp": now + 3600, "access_exp": now - 1,
        "refresh_token": "rt",
    })
    user, new_cookie = asyncio.run(auth.resolve_session(token))
    assert user is None and new_cookie is None


class _FakeZitadel:
    """Stand-in for the Authlib OIDC client used by exchange_token."""
    def __init__(self, token, userinfo):
        self._token = token
        self._userinfo = userinfo
        self.userinfo_calls = 0

    async def authorize_access_token(self, request):
        return self._token

    async def userinfo(self, token=None):
        self.userinfo_calls += 1
        return self._userinfo


class _FakeOAuth:
    def __init__(self, zitadel):
        self.zitadel = zitadel


def test_exchange_token_fetches_userinfo_when_id_token_lacks_claims(monkeypatch):
    """Zitadel's id_token omits email/profile by default — exchange_token must
    fall back to the userinfo endpoint so the stored user row isn't blank."""
    fake = _FakeZitadel(
        token={"userinfo": {"sub": "abc"}, "refresh_token": "rt", "expires_in": 3600},
        userinfo={"sub": "abc", "email": "real@x.io", "name": "Real Name"},
    )
    monkeypatch.setattr(auth, "_get_oauth", lambda: _FakeOAuth(fake))
    claims = asyncio.run(auth.exchange_token(request=None))
    assert claims["email"] == "real@x.io"
    assert claims["name"] == "Real Name"
    assert claims["sub"] == "abc"
    assert fake.userinfo_calls == 1


def test_exchange_token_skips_userinfo_when_id_token_has_claims(monkeypatch):
    """When the id_token already carries email+name, no extra userinfo call."""
    fake = _FakeZitadel(
        token={"userinfo": {"sub": "abc", "email": "in@token.io", "name": "In Token"},
               "refresh_token": "rt", "expires_in": 3600},
        userinfo={"sub": "abc", "email": "should@not.use", "name": "Unused"},
    )
    monkeypatch.setattr(auth, "_get_oauth", lambda: _FakeOAuth(fake))
    claims = asyncio.run(auth.exchange_token(request=None))
    assert claims["email"] == "in@token.io"
    assert claims["name"] == "In Token"
    assert fake.userinfo_calls == 0


def test_exchange_token_survives_userinfo_failure(monkeypatch):
    """A failing userinfo call must not break login — fall back to id_token claims."""
    fake = _FakeZitadel(
        token={"userinfo": {"sub": "abc"}, "refresh_token": "rt", "expires_in": 3600},
        userinfo={},
    )
    async def boom(token=None):
        raise RuntimeError("userinfo endpoint down")
    fake.userinfo = boom
    monkeypatch.setattr(auth, "_get_oauth", lambda: _FakeOAuth(fake))
    claims = asyncio.run(auth.exchange_token(request=None))
    assert claims["sub"] == "abc"
    assert claims["email"] == ""
    assert claims["name"] == ""


def test_real_app_health_endpoint_ok():
    """The real app exposes an unauthenticated /api/health liveness probe
    (whitelisted by the auth middleware)."""
    from fastapi.testclient import TestClient
    from web.main import app as real_app
    r = TestClient(real_app).get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
