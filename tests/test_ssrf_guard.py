"""Security: server-side connectivity probes (/api/sources/test, /api/ai/test)
accept a user-controlled URL/base_url and must not be usable to reach internal
or link-local hosts (SSRF). Audit finding #3."""
import pytest

from web.netguard import validate_public_url, SSRFError


# ---- the guard allows real public targets ---------------------------------

@pytest.mark.parametrize("url", [
    "https://kf.kobotoolbox.org/api/v2",
    "https://api.ona.io/api/v1",
    "http://8.8.8.8/assets",          # public literal IP, no DNS needed
])
def test_public_urls_allowed(url):
    validate_public_url(url)  # must not raise


# ---- the guard blocks internal / metadata / bad-scheme targets ------------

@pytest.mark.parametrize("url", [
    "http://169.254.169.254/latest/meta-data",  # cloud metadata (link-local)
    "http://127.0.0.1:8000/api",                # loopback
    "http://localhost/",                        # resolves to loopback
    "http://10.0.0.5/",                         # private
    "http://192.168.1.1/",                      # private
    "http://172.16.0.1/",                       # private
    "http://[::1]/",                            # ipv6 loopback
    "http://0.0.0.0/",                          # unspecified
])
def test_internal_urls_blocked(url):
    with pytest.raises(SSRFError):
        validate_public_url(url)


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "gopher://127.0.0.1/",
    "ftp://example.com/",
    "",
    "not-a-url",
])
def test_bad_scheme_or_garbage_blocked(url):
    with pytest.raises(SSRFError):
        validate_public_url(url)


# ---- endpoints reject SSRF attempts before making a request ----------------

def test_sources_test_blocks_metadata(api_client):
    r = api_client.post("/api/sources/test", json={
        "platform": "kobo",
        "url": "http://169.254.169.254/latest/meta-data",
        "token": "anything",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert "not allowed" in body["message"].lower() or "blocked" in body["message"].lower()


def test_ai_test_blocks_internal_base_url(api_client):
    r = api_client.post("/api/ai/test", json={
        "provider": "openai",
        "base_url": "http://169.254.169.254/v1",
        "api_key": "sk-test",
        "model": "gpt-4o",
    })
    # rejected cleanly (400) rather than performing the outbound request
    assert r.status_code == 400
    assert "not allowed" in r.json()["detail"].lower() or "blocked" in r.json()["detail"].lower()
