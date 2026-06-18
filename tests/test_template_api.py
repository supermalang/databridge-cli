"""API tests for the Express Template Fill web surface (XTF-5).

These exercise the two endpoints the Templates review/approve panel calls:
``POST /api/template/infer`` and ``POST /api/template/apply``. They mirror the
conventions in ``tests/test_ask_api.py`` — a synchronous ``TestClient`` over the
FastAPI app, auth disabled by default (the dev user has an active project via the
session-scoped conftest fixtures), and the LLM / inference seam monkeypatched so
no network or real provider is touched.

Every assertion is derived from the XTF-5 acceptance criteria + spec §6:
- infer returns the no-AI message payload when no provider/key is configured;
- infer returns the "run Download first" payload when there is no downloaded data;
- infer returns ``{proposals: [...]}`` (inference mocked) when AI + data are present;
- infer resolves an existing-template ref (not just a multipart upload);
- apply runs ``apply_inference``, writes config, and returns
  ``{ok, template, n_written}`` with the resolved template path.
"""
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import web.main as wm


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _df():
    return pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "E", "E"]})


def _ai_cfg():
    # provider + resolved api_key → AI is "configured" per spec §6 / ai_status.
    return {"ai": {"provider": "openai", "api_key": "sk-x"},
            "questions": [{"export_label": "Region", "category": "categorical"}]}


@pytest.fixture
def client():
    return TestClient(wm.app)


# --------------------------------------------------------------------------- #
# Precondition payloads (AC: friendly messages, never a crash)
# --------------------------------------------------------------------------- #
def test_infer_no_ai_provider_returns_configure_message(monkeypatch, client):
    """No AI provider/key configured → friendly "Configure an AI provider" payload.

    AC: "no AI provider/key → 'Configure an AI provider to use Express fill.'"
    """
    cfg = {"questions": []}  # no ai section at all
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *a, **k: (_df(), {}))

    resp = client.post("/api/template/infer", json={"template": "report.docx"})
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("proposals") in (None, [])
    assert "Configure an AI provider" in (body.get("message") or "")


def test_infer_no_data_returns_download_first_message(monkeypatch, client):
    """No downloaded data → friendly "run Download first" payload.

    AC: "no downloaded data → 'No data yet — run Download first.'"
    """
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: _ai_cfg())

    def _raise(*a, **k):
        raise FileNotFoundError("no data")

    monkeypatch.setattr(wm, "load_processed_data", _raise)

    resp = client.post("/api/template/infer", json={"template": "report.docx"})
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("proposals") in (None, [])
    assert "Download" in (body.get("message") or "")


# --------------------------------------------------------------------------- #
# Happy path (AC: parse → infer → annotate → {proposals})
# --------------------------------------------------------------------------- #
def test_infer_returns_proposals_when_ai_and_data_present(monkeypatch, client, tmp_path):
    """AI configured + data present → {proposals: [...]} from parse→infer→annotate.

    AC: "returns {proposals: [...]} (LLM mocked) when AI + data are present."
    The inference seam (extract/infer/annotate in template_inference) is mocked so
    no network/provider is touched, mirroring the suggester-style mocks.
    """
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: _ai_cfg())
    monkeypatch.setattr(wm, "load_processed_data", lambda *a, **k: (_df(), {}))

    proposals = [
        {"token_index": 0, "kind": "chart", "name": "by_region",
         "spec": {"name": "by_region", "type": "bar", "questions": ["Region"]},
         "confidence": 0.9, "reason": "", "status": "ok"},
        {"token_index": 1, "kind": "indicator", "name": "n_rows",
         "spec": {"name": "n_rows", "stat": "count"},
         "confidence": 0.3, "reason": "low confidence", "status": "needs_attention"},
    ]

    import src.reports.template_inference as ti
    # Make a real (but trivial) template path resolvable; extract is mocked anyway.
    tpl = tmp_path / "report.docx"
    tpl.write_bytes(b"PK")  # contents irrelevant — extract is patched

    monkeypatch.setattr(ti, "extract_placeholders",
                        lambda *a, **k: [object(), object()])
    monkeypatch.setattr(ti, "infer_specs", lambda *a, **k: proposals)
    monkeypatch.setattr(ti, "annotate_proposals", lambda props, *a, **k: props)

    resp = client.post("/api/template/infer", json={"template": "report.docx"})
    assert resp.status_code == 200
    body = resp.json()
    names = [p["name"] for p in body["proposals"]]
    assert names == ["by_region", "n_rows"]
    assert body["proposals"][1]["status"] == "needs_attention"


def test_infer_resolves_existing_template_ref(monkeypatch, client, tmp_path):
    """An existing-template *ref* (not a multipart upload) resolves to the stored file.

    AC / Unit tests: "resolves an existing-template ref (not just a multipart upload)
    to the correct stored template." The endpoint must pass the resolved path of the
    named stored template into extract_placeholders.
    """
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: _ai_cfg())
    monkeypatch.setattr(wm, "load_processed_data", lambda *a, **k: (_df(), {}))

    # Stage a stored template under a throwaway templates dir the API serves from
    # (monkeypatched so the test never pollutes the repo's templates/ directory).
    templates_dir = tmp_path / "templates"
    templates_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(wm, "TEMPLATES_DIR", templates_dir)
    stored = templates_dir / "annual_report.docx"
    stored.write_bytes(b"PK")

    seen = {}
    import src.reports.template_inference as ti

    def _extract(path, *a, **k):
        seen["path"] = str(path)
        return []

    monkeypatch.setattr(ti, "extract_placeholders", _extract)
    monkeypatch.setattr(ti, "infer_specs", lambda *a, **k: [])
    monkeypatch.setattr(ti, "annotate_proposals", lambda props, *a, **k: props)

    resp = client.post("/api/template/infer", json={"template": "annual_report.docx"})
    assert resp.status_code == 200
    # The endpoint must have resolved the ref to the actual stored file path.
    assert seen.get("path") == str(stored)


# --------------------------------------------------------------------------- #
# Apply (AC: writes config + returns {ok, template, n_written})
# --------------------------------------------------------------------------- #
def test_apply_writes_config_and_returns_resolved_template(monkeypatch, client, tmp_path):
    """Approved proposals → apply_inference writes config and returns the resolved path.

    AC: "POST /api/template/apply {proposals} runs apply_inference and returns
    {ok, template, n_written}; ... (resolved template path)."
    """
    cfg = {"charts": []}
    saved = {}
    # /api/template/apply is a config mutation and gates on _require("editor") like
    # every other config-writing endpoint. RBAC enforcement is covered by the shared
    # require_role / config tests; here we isolate the endpoint's behavior from the
    # (order-dependent) active-project setup so this unit test is deterministic.
    monkeypatch.setattr(wm, "_require", lambda *a, **k: None)
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "write_config", lambda c, p: saved.update(c))

    resolved = str(tmp_path / "report.resolved.docx")
    approved = [
        {"token_index": 0, "kind": "chart", "name": "by_region",
         "spec": {"name": "by_region", "type": "bar", "questions": ["Region"]},
         "status": "ok"},
    ]

    import src.reports.template_inference as ti

    def _apply(approved_props, cfg_in, template_path):
        cfg_in.setdefault("charts", []).append(approved_props[0]["spec"])
        return cfg_in, resolved

    monkeypatch.setattr(ti, "apply_inference", _apply)

    resp = client.post("/api/template/apply",
                       json={"proposals": approved, "template": "report.docx"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["template"] == resolved
    assert body["n_written"] == 1
    # Config was persisted with the approved chart spec.
    assert saved["charts"][0]["name"] == "by_region"
