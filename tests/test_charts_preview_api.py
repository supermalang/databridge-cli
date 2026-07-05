"""MNT-21 — POST /api/charts/preview must handle bullet_list as a text response.

bullet_list is a text-injection render type (src/reports/charts.py:build_bullet_list_text)
that deliberately bypasses CHART_DISPATCH/generate_chart's matplotlib pipeline — mirroring
the special-case builder.py already has at report-build time (builder.py:450-453). Today the
preview endpoint has no equivalent special-case, so it always falls through to
generate_chart -> CHART_DISPATCH.get("bullet_list") (which has no entry) and returns the
generic "Chart generation failed" 400 error instead of the bulleted text.
"""
import pandas as pd
from fastapi.testclient import TestClient

import web.main as wm
from src.reports.charts import build_bullet_list_text


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(wm, "DATA_DIR", tmp_path)
    # Point at a config.yml that doesn't exist so the endpoint's best-effort config load
    # yields an empty config (caught internally) — keeps the test isolated from the repo's
    # real config.yml.
    monkeypatch.setattr(wm, "CONFIG_PATH", tmp_path / "config.yml")
    return TestClient(wm.app)


def test_preview_bullet_list_returns_text(tmp_path, monkeypatch):
    df = pd.DataFrame({"Comment": ["Good service", "Needs improvement", "Great job"]})
    df.to_csv(tmp_path / "survey_data.csv", index=False)
    client = _client(tmp_path, monkeypatch)

    resp = client.post("/api/charts/preview", json={
        "chart": {"name": "comments", "type": "bullet_list", "questions": ["Comment"], "options": {}},
        "data_file": "survey_data.csv",
    })

    assert resp.status_code == 200, resp.text
    body = resp.json()
    expected = build_bullet_list_text(df, ["Comment"], {})
    assert body["text"] == expected
    assert body["text"] == "• Good service\n• Needs improvement\n• Great job"
    # Must not have attempted the matplotlib/image pipeline for this type.
    assert "image" not in body


def test_preview_bullet_list_respects_top_n(tmp_path, monkeypatch):
    df = pd.DataFrame({"Feedback": [f"Entry {i}" for i in range(10)]})
    df.to_csv(tmp_path / "survey_data.csv", index=False)
    client = _client(tmp_path, monkeypatch)

    resp = client.post("/api/charts/preview", json={
        "chart": {
            "name": "feedback",
            "type": "bullet_list",
            "questions": ["Feedback"],
            "options": {"top_n": 3},
        },
        "data_file": "survey_data.csv",
    })

    assert resp.status_code == 200, resp.text
    text = resp.json()["text"]
    bullets = [line for line in text.split("\n") if line.strip()]
    assert len(bullets) == 3
    expected = build_bullet_list_text(df, ["Feedback"], {"top_n": 3})
    assert text == expected


def test_preview_bar_chart_still_returns_image(tmp_path, monkeypatch):
    """Regression guard: ordinary image-producing chart types must be unaffected."""
    df = pd.DataFrame({"Region": ["North", "South", "North", "East"]})
    df.to_csv(tmp_path / "survey_data.csv", index=False)
    client = _client(tmp_path, monkeypatch)

    resp = client.post("/api/charts/preview", json={
        "chart": {"name": "region_bar", "type": "bar", "questions": ["Region"], "options": {}},
        "data_file": "survey_data.csv",
    })

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "image" in body
    assert isinstance(body["image"], str) and len(body["image"]) > 0
    assert "text" not in body
