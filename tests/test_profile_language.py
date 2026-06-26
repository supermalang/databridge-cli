"""I18N-1 — persisted per-user interface-language preference (profile API).

These tests encode the card's ACCEPTANCE CRITERIA for the Python web endpoint +
app-DB side of the feature — NOT any particular implementation:

  - The profile GET endpoint (`/api/me`) returns the caller's `language`.
  - A new user with no stored preference defaults to English (`"en"`).
  - The profile update endpoint (`PATCH /api/me`) accepts + persists `language`,
    surviving a GET round-trip.
  - It rejects any value other than `en`/`fr` with a 4xx validation error and
    leaves the stored value unchanged.
  - The write is scoped to the authenticated caller: a user can only set their
    own language, never another user's row.

They mirror the existing profile/auth fixtures: the dev-user path on the real
app (see `tests/test_profile_api.py::test_patch_me_updates_db_name_*`) for the
single-user cases, and the auth-enabled session-cookie path on the real app
(see `tests/test_auth.py`) for the cross-user scoping case.

RED until the `language` column + GET/PATCH wiring exist.
"""
import time
import uuid

import pytest
from fastapi.testclient import TestClient

import web.main as wm
from web import auth


# --- single-user cases: dev mode (auth disabled), real app ------------------

@pytest.fixture
def _isolated_base(tmp_path, monkeypatch):
    """Point BASE_DIR at a throwaway dir so a profile write can't touch the
    developer's real mirror (mirrors tests/test_profile_api.py)."""
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return tmp_path


def test_profile_returns_language_default_en(_isolated_base):
    """AC: when a user has no saved preference the profile GET reports English."""
    with TestClient(wm.app) as c:
        body = c.get("/api/me").json()
        assert body.get("language") == "en", (
            f"profile GET must default language to 'en' for a user with no stored "
            f"preference; got {body.get('language')!r}"
        )


def test_update_profile_language_persists(_isolated_base):
    """AC: PATCH language='fr' as the authed user persists across a GET round-trip."""
    with TestClient(wm.app) as c:
        r = c.patch("/api/me", json={"language": "fr"})
        assert r.status_code == 200, r.text
        assert r.json().get("language") == "fr", (
            f"PATCH response must echo the saved language; got {r.json().get('language')!r}"
        )
        # Persisted: a fresh GET reports the stored value.
        assert c.get("/api/me").json().get("language") == "fr", (
            "the language set via PATCH must survive and be returned by a later GET"
        )


def test_update_profile_language_rejects_unknown(_isolated_base):
    """AC: any value other than en/fr is a 4xx validation error and is NOT stored."""
    with TestClient(wm.app) as c:
        # Establish a known-good baseline first.
        assert c.patch("/api/me", json={"language": "fr"}).status_code == 200
        # An unsupported language must be rejected.
        r = c.patch("/api/me", json={"language": "de"})
        assert 400 <= r.status_code < 500, (
            f"PATCH with an unsupported language must return a 4xx validation error; "
            f"got {r.status_code}"
        )
        # And it must not have clobbered the previously-stored valid value.
        assert c.get("/api/me").json().get("language") == "fr", (
            "a rejected language value must leave the stored preference unchanged"
        )


# --- cross-user scoping: auth enabled, real app -----------------------------

def _enable_auth(monkeypatch):
    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "cid")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("SESSION_SECRET", "s3cr3t")
    monkeypatch.setenv("APP_BASE_URL", "http://testserver")


def _session_cookie(sub, email):
    """A valid signed session for a distinct user (mirrors tests/test_auth.py)."""
    now = time.time()
    return auth.session_codec().encode({
        "sub": sub, "email": email, "name": email.split("@")[0],
        "sess_exp": now + 3600, "access_exp": now + 3600, "refresh_token": "rt",
    })


def test_update_profile_language_scoped_to_caller(monkeypatch):
    """AC: the update writes ONLY the authenticated caller's row — a caller cannot
    set another user's language."""
    _enable_auth(monkeypatch)
    sub_a = f"user-a-{uuid.uuid4()}"
    sub_b = f"user-b-{uuid.uuid4()}"
    email_a = f"{sub_a}@x.test"
    email_b = f"{sub_b}@x.test"

    with TestClient(wm.app) as c:
        # User A authenticates and sets their language to French.
        c.cookies.set(auth.SESSION_COOKIE, _session_cookie(sub_a, email_a))
        ra = c.patch("/api/me", json={"language": "fr"})
        assert ra.status_code == 200, ra.text

        # User B authenticates (fresh provision) — their preference must be the
        # default, untouched by A's write.
        c.cookies.set(auth.SESSION_COOKIE, _session_cookie(sub_b, email_b))
        assert c.get("/api/me").json().get("language") == "en", (
            "one user's language write must not leak into another user's profile"
        )
        # User B sets English explicitly; A's value must remain French.
        assert c.patch("/api/me", json={"language": "en"}).status_code == 200

        c.cookies.set(auth.SESSION_COOKIE, _session_cookie(sub_a, email_a))
        assert c.get("/api/me").json().get("language") == "fr", (
            "the authenticated caller's own language must be unaffected by another "
            "user's update — the write is scoped to the caller's row"
        )
