"""MNT-7 — API-level test for the Express Template Fill infer endpoint.

Acceptance criterion: POST /api/template/infer returns HTTP 500 with a non-null
`detail` when `infer_specs` raises RuntimeError.

Buggy behaviour: the `except Exception` in the endpoint never fired because
`infer_specs` was silently returning `[]` instead of raising. The fix in
`infer_specs` raises RuntimeError, which the endpoint's outer `except Exception`
then re-raises as HTTPException(500, detail=...).

Uses the same TestClient + monkeypatch convention as tests/test_template_api.py
(XTF-5). Auth is disabled by the session-scoped `_auth_disabled_by_default`
conftest fixture.
"""
import pytest
from fastapi.testclient import TestClient

import web.main as wm


@pytest.fixture
def client():
    return TestClient(wm.app)


def test_infer_endpoint_returns_500_when_infer_specs_raises(monkeypatch, client):
    """MNT-7 AC: /api/template/infer returns HTTP 500 with a non-null `detail`
    when `infer_specs` raises RuntimeError("LLM response malformed").

    Arrange: stub load_config (AI configured), load_processed_data (data present),
    extract_placeholders (one NL token so infer_specs is called), and patch
    infer_specs to raise RuntimeError — reproducing the post-fix code path where
    the LLM returns garbage that no longer silently returns [].

    Assert: response status is 500 and detail is non-null (non-empty string).
    """
    import pandas as pd
    import src.reports.template_inference as ti

    # Minimal AI-configured config so the endpoint proceeds past the AI check.
    cfg = {
        "ai": {"provider": "openai", "api_key": "sk-test"},
        "questions": [{"export_label": "Region", "category": "categorical"}],
    }
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)

    # Data present so the endpoint proceeds past the data check.
    df = pd.DataFrame({"_id": [1, 2], "Region": ["N", "S"]})
    monkeypatch.setattr(wm, "load_processed_data", lambda *a, **k: (df, {}))

    # One NL token so the endpoint calls infer_specs.
    nl_token = ti.Token(
        raw="[Total beneficiaries]",
        inner="Total beneficiaries",
        delimiter="[",
        kind="nl",
        location=ti.Location(),
    )
    monkeypatch.setattr(ti, "extract_placeholders", lambda *a, **k: [nl_token])

    # Patch profile_dataset and build_catalog to avoid real I/O.
    monkeypatch.setattr(wm, "profile_dataset", lambda *a, **k: {}, raising=False)
    import src.reports.ask_engine as _ae
    monkeypatch.setattr(_ae, "build_catalog", lambda *a, **k: {}, raising=False)

    # The core fix under test: infer_specs raises RuntimeError (not returns []).
    def _raise(*a, **k):
        raise RuntimeError("LLM response malformed: proposals key absent")

    monkeypatch.setattr(ti, "infer_specs", _raise)

    resp = client.post("/api/template/infer", json={"template": "report.docx"})

    # AC: the endpoint must return HTTP 500 (not 200) when infer_specs raises.
    assert resp.status_code == 500, (
        f"expected HTTP 500, got {resp.status_code}. body={resp.text!r}\n"
        "This fails when infer_specs silently returns [] instead of raising — "
        "the endpoint then returns 200 with empty proposals."
    )

    body = resp.json()
    detail = body.get("detail")
    assert detail, (
        f"expected a non-null 'detail' field in the 500 response, got {body!r}"
    )
