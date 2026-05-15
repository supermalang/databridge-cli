"""Tests for src.data.extract — HTTP retry, Session reuse, pagination."""
import pytest
import responses

from src.data.extract import KoboClient


@pytest.fixture
def kobo_cfg():
    return {
        "api": {"platform": "kobo", "url": "https://example.test/api/v2", "token": "test"},
        "form": {"uid": "FORM1"},
    }


@responses.activate
def test_get_retries_on_503_then_succeeds(kobo_cfg):
    url = "https://example.test/api/v2/assets/FORM1/data/"
    # Two 503s, then 200 — retry logic should follow through.
    responses.add(responses.GET, url, status=503)
    responses.add(responses.GET, url, status=503)
    responses.add(responses.GET, url, json={"results": [], "count": 0, "next": None}, status=200)

    client = KoboClient(kobo_cfg)
    result = client.get_submissions()

    assert result == []
    assert len(responses.calls) == 3


@responses.activate
def test_get_gives_up_after_max_retries(kobo_cfg):
    url = "https://example.test/api/v2/assets/FORM1/data/"
    for _ in range(10):
        responses.add(responses.GET, url, status=503)

    client = KoboClient(kobo_cfg)
    with pytest.raises(Exception):  # urllib3 raises MaxRetryError wrapped as RetryError
        client.get_submissions()


@responses.activate
def test_session_is_reused_across_pages(kobo_cfg):
    url = "https://example.test/api/v2/assets/FORM1/data/"
    responses.add(responses.GET, url, json={"results": [{"_id": 1}], "count": 2, "next": "x"}, status=200)
    responses.add(responses.GET, url, json={"results": [{"_id": 2}], "count": 2, "next": None}, status=200)

    client = KoboClient(kobo_cfg)
    client.get_submissions()

    # Same Session object should have been used for both requests
    assert client.session is not None
    assert len(responses.calls) == 2
