"""Ask-tab starter questions: AI-generated when available, schema-derived otherwise."""
import yaml
from fastapi.testclient import TestClient

import web.main as wm
from src.reports import ai_ask_examples as aae


def _cfg(with_ai=False):
    cfg = {
        "form": {"alias": "survey"},
        "questions": [
            {"kobo_key": "region", "label": "Region", "category": "categorical", "export_label": "Region"},
            {"kobo_key": "site", "label": "Site", "category": "categorical", "export_label": "Site"},
            {"kobo_key": "age", "label": "Age", "category": "quantitative", "export_label": "Age"},
            {"kobo_key": "sd", "label": "Submission date", "category": "date", "export_label": "Submission date"},
        ],
    }
    if with_ai:
        cfg["ai"] = {"provider": "openai", "model": "gpt-4o", "api_key": "sk-real"}
    return cfg


def test_schema_examples_reference_real_columns():
    ex = aae.schema_examples(_cfg())
    assert ex and len(ex) <= 5
    joined = " ".join(ex)
    assert "Region" in joined          # categorical → count + ranking
    assert "Age" in joined             # quantitative → distribution / average
    assert any("over time" in e for e in ex)   # a date column exists
    assert len(set(ex)) == len(ex)     # no duplicates


def test_schema_examples_handles_no_questions():
    ex = aae.schema_examples({"questions": []})
    assert isinstance(ex, list) and len(ex) >= 1


def test_suggest_examples_falls_back_to_schema_without_ai():
    out = aae.suggest_examples(_cfg(with_ai=False))
    assert out["source"] == "schema"
    assert out["examples"]


def test_suggest_examples_uses_ai_when_available(monkeypatch):
    from src.utils import lf_client
    monkeypatch.setattr(lf_client, "get_prompt", lambda name, vars: ([{"role": "user", "content": "x"}], {}))
    monkeypatch.setattr(lf_client, "chat", lambda *a, **k: '{"questions": ["Count by Region", "Avg Age by Site"]}')
    out = aae.suggest_examples(_cfg(with_ai=True))
    assert out["source"] == "ai"
    assert out["examples"] == ["Count by Region", "Avg Age by Site"]


def test_suggest_examples_ai_failure_degrades_to_schema(monkeypatch):
    from src.utils import lf_client
    def _boom(*a, **k):
        raise RuntimeError("401 bad key")
    monkeypatch.setattr(lf_client, "get_prompt", lambda name, vars: ([{"role": "user", "content": "x"}], {}))
    monkeypatch.setattr(lf_client, "chat", _boom)
    out = aae.suggest_examples(_cfg(with_ai=True))
    assert out["source"] == "schema"
    assert out["examples"]


def test_endpoint_returns_examples(tmp_path, monkeypatch):
    monkeypatch.setattr(wm, "BASE_DIR", tmp_path)
    for sub in ("data/processed", "reports", "templates"):
        (tmp_path / sub).mkdir(parents=True, exist_ok=True)
    with TestClient(wm.app) as c:
        r = c.get("/api/ask/examples")
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body.get("examples"), list)
        assert body.get("source") in ("ai", "schema", "none")
