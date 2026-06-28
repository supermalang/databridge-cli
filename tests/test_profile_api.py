import pandas as pd
import pytest
from fastapi.testclient import TestClient
import web.main as wm


@pytest.fixture
def _isolated_base(tmp_path, monkeypatch):
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    return tmp_path


def test_profile_endpoint_returns_per_table_profiles(monkeypatch):
    cfg = {"questions": [
        {"export_label": "Region", "category": "categorical"},
        {"export_label": "Age", "category": "quantitative"},
    ]}
    main_df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "S", "N"], "Age": [10, 20, 30]})
    repeats = {"household_members": pd.DataFrame({
        "_parent_index": [1], "_row_id": ["1.0"], "Name": ["A"],
    })}
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *_a, **_k: (main_df, repeats))

    client = TestClient(wm.app)
    resp = client.get("/api/profile")
    assert resp.status_code == 200
    profiles = {p["name"]: p for p in resp.json()["profiles"]}
    assert "main" in profiles and "household_members" in profiles
    assert profiles["main"]["rows"] == 3
    age = next(c for c in profiles["main"]["columns"] if c["name"] == "Age")
    assert age["role"] == "quantitative" and "median" in age


def test_profile_endpoint_no_data(monkeypatch):
    def _raise(*_a, **_k):
        raise FileNotFoundError("no data")
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: {})
    monkeypatch.setattr(wm, "load_processed_data", _raise)
    client = TestClient(wm.app)
    body = client.get("/api/profile").json()
    assert body["profiles"] == [] and "message" in body


def test_patch_me_updates_db_name_when_zitadel_disabled(_isolated_base):
    with TestClient(wm.app) as c:
        r = c.patch("/api/me", json={"given_name": "Ada", "family_name": "Lovelace"})
        assert r.status_code == 200
        assert r.json()["name"] == "Ada Lovelace"
        # /api/me reflects the updated name on the next read
        assert c.get("/api/me").json()["name"] == "Ada Lovelace"


def test_set_user_language_does_not_commit_internally():
    """set_user_language must only set the attribute — not commit — so that patch_me
    owns the single commit site. Without this, a language PATCH commits twice."""
    from web.db import repository as repo
    from web.db.models import User

    committed = []

    class _FakeDb:
        def commit(self):
            committed.append(1)
        def refresh(self, obj):
            pass

    user = User(zitadel_sub="test-sub", email="t@test.test", name="Test", language="en")
    repo.set_user_language(_FakeDb(), user, "fr")
    assert user.language == "fr", "language must be set"
    assert committed == [], "set_user_language must not call db.commit() — the caller owns the commit"


def test_patch_me_sanitizes_zitadel_error(_isolated_base, monkeypatch):
    """A Zitadel sync error must not echo the raw exception (which can embed internal URLs)."""
    import web.zitadel_admin as za

    def _raise(sub, given, family):
        raise Exception("https://internal.zitadel.corp/error?trace=secret-abc123")

    monkeypatch.setattr(za, "enabled", lambda: True)
    monkeypatch.setattr(za, "update_human_user", _raise)

    # Simulate a non-dev user (zitadel_sub != "dev-local") so the sync path fires.
    import web.auth as wa
    monkeypatch.setattr(wa, "DEV_USER", {"sub": "real-zitadel-id", "email": "real@test.test", "name": "Real User"})

    with TestClient(wm.app) as c:
        r = c.patch("/api/me", json={"given_name": "Ada", "family_name": "Lovelace"})
        assert r.status_code == 200, "Zitadel error must not fail the local save"
        z = r.json().get("zitadel", "")
        assert "internal.zitadel.corp" not in z, "raw exception must not appear in response"
        assert "secret-abc123" not in z, "internal trace id must not appear in response"
        assert z, "zitadel field must still be present (error indicator)"
