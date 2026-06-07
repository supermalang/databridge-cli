"""Unit tests for the Zitadel Management client's profile update."""
import httpx
import pytest

from web import zitadel_admin


def test_update_human_user_puts_profile(monkeypatch):
    captured = {}

    def fake_put(url, headers=None, timeout=None, json=None):
        captured["url"] = url
        captured["json"] = json
        return httpx.Response(200, json={})

    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("ZITADEL_API_TOKEN", "pat")
    monkeypatch.setattr(zitadel_admin.httpx, "put", fake_put)

    zitadel_admin.update_human_user("user-123", "Ada", "Lovelace")

    assert captured["url"] == "https://z.example/v2/users/human/user-123"
    assert captured["json"] == {"profile": {"givenName": "Ada", "familyName": "Lovelace"}}


def test_update_human_user_raises_on_error(monkeypatch):
    def fake_put(url, headers=None, timeout=None, json=None):
        return httpx.Response(403, text="nope")

    monkeypatch.setenv("OIDC_ISSUER", "https://z.example")
    monkeypatch.setenv("ZITADEL_API_TOKEN", "pat")
    monkeypatch.setattr(zitadel_admin.httpx, "put", fake_put)

    with pytest.raises(zitadel_admin.ZitadelAdminError):
        zitadel_admin.update_human_user("user-123", "Ada", "Lovelace")
