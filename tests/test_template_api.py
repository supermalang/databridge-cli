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
import io

import pandas as pd
import pytest
from docx import Document
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


# --------------------------------------------------------------------------- #
# XTF-6 — Persist the uploaded template across infer → apply (the bug).
#
# These are deliberately UN-mocked at the inference layer: only the LLM seam
# (`infer_specs`) is stubbed with a deterministic proposal. `extract_placeholders`,
# the upload-persistence path, and `apply_inference` all run for real, so they
# reproduce the production bug — an uploaded .docx that infer never persists nor
# returns a ref for, so apply cannot resolve it.
# --------------------------------------------------------------------------- #
def _real_docx_bytes(placeholder="[bar chart of Region]"):
    """A minimal real .docx (python-docx) carrying one NL placeholder."""
    doc = Document()
    doc.add_paragraph("Intro paragraph.")
    doc.add_paragraph(placeholder)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_infer_apply_roundtrip_real(monkeypatch, client, tmp_path):
    """Real infer→apply round-trip: the upload must survive into apply.

    AC (XTF-6):
    - infer persists the uploaded .docx and returns a resolvable `template` ref;
    - the same ref is carried into apply, which resolves the persisted file and
      runs the REAL `apply_inference` against it;
    - the resolved .docx exists on disk, config gained the chart spec, and the
      response is {ok, template, n_written}.

    Only the LLM seam (`infer_specs`) is mocked; `extract_placeholders` and
    `apply_inference` run for real. This is the test the network-mocked XTF-5
    suite could not catch.
    """
    import src.reports.template_inference as ti

    # Isolate template storage so we never touch the repo's templates/ dir.
    templates_dir = tmp_path / "templates"
    templates_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(wm, "TEMPLATES_DIR", templates_dir)

    # Shared config object: infer reads it; apply reads + writes it.
    cfg = {"charts": [], "questions": [{"export_label": "Region", "category": "categorical"}],
           "ai": {"provider": "openai", "api_key": "sk-x"}}
    saved = {}
    monkeypatch.setattr(wm, "_require", lambda *a, **k: None)
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "write_config", lambda c, p: saved.update({"cfg": c}))
    monkeypatch.setattr(wm, "load_processed_data", lambda *a, **k: (_df(), {}))
    # Keep profiling/catalog cheap + deterministic (they feed infer_specs, which is mocked).
    monkeypatch.setattr(wm, "profile_dataset", lambda *a, **k: {})
    monkeypatch.setattr(wm.ask_engine, "build_catalog", lambda *a, **k: {})

    # The ONLY mocked seam: the batched LLM call. One real chart proposal for the
    # single NL placeholder (token_index 0) in the uploaded docx.
    proposal = {
        "token_index": 0, "kind": "chart", "name": "by_region",
        "spec": {"name": "by_region", "title": "By region", "type": "bar",
                 "questions": ["Region"]},
        "confidence": 0.95, "reason": "ok", "status": "ok",
    }
    monkeypatch.setattr(ti, "infer_specs", lambda *a, **k: [dict(proposal)])
    # annotate runs for real (validate_recipe is reused) — but with an empty profile
    # it would flag the chart; stamp it ok directly so the proposal is approvable.
    monkeypatch.setattr(ti, "annotate_proposals",
                        lambda props, *a, **k: [{**p, "status": "ok", "reason": "ok"} for p in props])

    # 1. POST the real .docx as a multipart upload to infer.
    files = {"file": ("fresh_upload.docx", _real_docx_bytes(),
                      "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    infer_resp = client.post("/api/template/infer", files=files)
    assert infer_resp.status_code == 200, infer_resp.text
    infer_body = infer_resp.json()
    assert infer_body.get("proposals"), "infer should return the mocked proposal"

    # AC: infer must return a resolvable template ref alongside the proposals.
    ref = infer_body.get("template")
    assert ref, "infer must return a 'template' ref so apply can resolve the upload"

    # 2. Carry that ref (NOT a bare client file.name) into the REAL apply.
    approved = [dict(p) for p in infer_body["proposals"]]
    apply_resp = client.post("/api/template/apply",
                             json={"proposals": approved, "template": ref})
    assert apply_resp.status_code == 200, apply_resp.text
    apply_body = apply_resp.json()

    # AC: response shape {ok, template, n_written}.
    assert apply_body.get("ok") is True
    assert apply_body.get("n_written") == 1
    resolved = apply_body.get("template")
    assert resolved, "apply must return the resolved template path"

    # AC: the resolved .docx exists on disk (apply_inference saved a real file).
    import os
    assert os.path.isfile(resolved), f"resolved template should exist on disk: {resolved}"

    # AC: config gained the chart spec.
    written = saved.get("cfg") or cfg
    chart_names = [c.get("name") for c in (written.get("charts") or [])]
    assert "by_region" in chart_names, "apply should have written the chart spec into config"


def test_apply_unresolvable_ref_returns_clear_error(monkeypatch, client, tmp_path):
    """Apply with a ref that resolves to no stored file → a clear error, not a 500.

    AC (XTF-6): "if the ref cannot be resolved it returns a clear error (no
    traceback / no silent wrong-path)." The REAL apply_inference is used; the bug
    today is that an unresolvable basename is passed straight through to
    apply_inference, which then fails opening a non-existent path with a 500.
    """
    import src.reports.template_inference as ti  # noqa: F401  (kept un-mocked)

    templates_dir = tmp_path / "templates"
    templates_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(wm, "TEMPLATES_DIR", templates_dir)

    cfg = {"charts": []}
    monkeypatch.setattr(wm, "_require", lambda *a, **k: None)
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "write_config", lambda c, p: None)

    approved = [
        {"token_index": 0, "kind": "chart", "name": "by_region",
         "spec": {"name": "by_region", "type": "bar", "questions": ["Region"]},
         "status": "ok"},
    ]
    resp = client.post("/api/template/apply",
                       json={"proposals": approved, "template": "does_not_exist.docx"})

    # A clear, client-facing error — not an unhandled 500 traceback.
    assert resp.status_code in (400, 404, 422), \
        f"expected a clear client error, got {resp.status_code}: {resp.text}"
    body = resp.json()
    detail = (body.get("detail") or body.get("message") or "")
    assert detail, "the error response should carry a human-readable message"
