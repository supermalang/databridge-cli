"""
test_generation_language.py — PLANG-3 regression tests.

Every AI generation site must thread the configured `ai.language` into its LLM
prompt variables, so generated text comes out in the project language. Scope is
AI-generated text only; user-typed titles / axis labels are unchanged.

These tests capture the prompt variables (by faking lf_client.get_prompt) or the
stop-word language code (by faking the keyword-frequency worker) and assert the
configured language reaches them. No live LLM call is made.

AC mapping is documented per-test in its docstring.
"""
import re
import pandas as pd
import pytest

from src.utils import lf_client


# ── shared fakes ────────────────────────────────────────────────────────────────

def _capture_get_prompt(store):
    """Return a fake lf_client.get_prompt that records the variables dict and
    returns a trivially-resolvable message list."""
    def _fake(name, variables=None, *a, **k):
        store["name"] = name
        store["variables"] = dict(variables or {})
        return ([{"role": "user", "content": "x"}], {})
    return _fake


def _french_blob(variables):
    """Join every variable value into one searchable string."""
    return " ".join(str(v) for v in variables.values())


# ── Narrator ────────────────────────────────────────────────────────────────────

def test_narrator_threads_language_into_prompt_vars(monkeypatch):
    """AC: the narrator includes the configured ai.language as the output-language
    instruction in its prompt variables (French → 'French' reaches the vars)."""
    from src.reports import narrator
    cap = {}
    monkeypatch.setattr(lf_client, "get_prompt", _capture_get_prompt(cap))
    monkeypatch.setattr(lf_client, "chat",
                        lambda *a, **k: '{"summary_text":"x","observations":"y","recommendations":"z"}')

    ai_cfg = {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o",
              "language": "French"}
    df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "E", "E"]})
    narrator.generate_narrative(ai_cfg, {"title": "T"}, df, [], {}, [])

    assert cap.get("variables"), "narrator never called get_prompt with variables"
    assert "French" in _french_blob(cap["variables"]), \
        f"narrator prompt vars carry no French language instruction: {cap['variables']}"


def test_narrator_defaults_to_english_when_language_missing(monkeypatch):
    """AC: a missing/empty ai.language defaults deterministically to English."""
    from src.reports import narrator
    cap = {}
    monkeypatch.setattr(lf_client, "get_prompt", _capture_get_prompt(cap))
    monkeypatch.setattr(lf_client, "chat",
                        lambda *a, **k: '{"summary_text":"x","observations":"y","recommendations":"z"}')

    ai_cfg = {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o"}  # no language
    df = pd.DataFrame({"_id": [1, 2, 3]})
    narrator.generate_narrative(ai_cfg, {"title": "T"}, df, [], {}, [])

    assert "English" in _french_blob(cap["variables"]), \
        f"narrator did not default language to English: {cap['variables']}"


def test_narrator_no_ai_key_noops(monkeypatch):
    """AC: AI features remain no-ops when no AI key is configured."""
    from src.reports import narrator
    # Fail loudly if any LLM call is attempted on the no-key path.
    monkeypatch.setattr(lf_client, "get_prompt",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("LLM called on no-key path")))
    ai_cfg = {"provider": "openai", "api_key": "env:OPENAI_API_KEY", "language": "French"}
    out = narrator.generate_narrative(ai_cfg, {"title": "T"}, pd.DataFrame({"_id": [1]}), [], {}, [])
    assert out == {"summary_text": "", "observations": "", "recommendations": ""}


# ── AI summaries ─────────────────────────────────────────────────────────────────

def test_ai_summary_threads_language_into_prompt_vars(monkeypatch):
    """AC: AI summaries include the configured ai.language in their prompt variables."""
    from src.reports import summaries
    cap = {}
    monkeypatch.setattr(lf_client, "get_prompt", _capture_get_prompt(cap))
    monkeypatch.setattr(lf_client, "chat", lambda *a, **k: "résumé généré")

    ai_cfg = {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o",
              "language": "French"}
    df = pd.DataFrame({"Story": ["abc def", "ghi jkl", "mno pqr"]})
    out = summaries.compute_summaries(
        [{"name": "s1", "stat": "ai", "questions": ["Story"], "prompt": "summarise"}],
        df, ai_cfg,
    )
    assert out.get("summary_s1") != "N/A", "AI summary errored unexpectedly"
    assert "French" in _french_blob(cap["variables"]), \
        f"AI summary prompt vars carry no French language: {cap['variables']}"


def test_ai_summary_no_ai_key_noops(monkeypatch):
    """AC: no AI key → the AI summary degrades without crashing (no LLM call)."""
    from src.reports import summaries
    monkeypatch.setattr(lf_client, "get_prompt",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("LLM called on no-key path")))
    ai_cfg = {"provider": "openai", "api_key": "env:OPENAI_API_KEY", "language": "French"}
    df = pd.DataFrame({"Story": ["abc def"]})
    out = summaries.compute_summaries(
        [{"name": "s1", "stat": "ai", "questions": ["Story"], "prompt": "x"}], df, ai_cfg,
    )
    # Worker raises (no key) → compute_summaries catches → "N/A", never an LLM call.
    assert out["summary_s1"] == "N/A"


def test_keyword_frequency_stopwords_follow_ai_language(monkeypatch):
    """AC: the keyword-frequency stop-word language follows ai.language mapped to its
    code (French → 'fr') rather than the hardcoded 'en' default, when the summary
    does not specify its own language."""
    from src.reports import summaries
    seen = {}

    def _fake_kw(series, top_n, language="en"):
        seen["language"] = language
        return "ok"

    monkeypatch.setattr(summaries, "_keyword_frequency_text", _fake_kw)
    ai_cfg = {"provider": "openai", "api_key": "sk-real", "language": "French"}
    df = pd.DataFrame({"Story": ["alpha beta gamma", "delta epsilon"]})
    summaries.compute_summaries(
        [{"name": "kw", "stat": "keyword_frequency", "questions": ["Story"]}],
        df, ai_cfg,
    )
    assert seen.get("language") == "fr", \
        f"keyword_frequency stop-word code did not follow ai.language=French: {seen}"


def test_keyword_frequency_unknown_language_degrades(monkeypatch):
    """AC: an unknown/unsupported language degrades gracefully (no crash)."""
    from src.reports import summaries
    ai_cfg = {"provider": "openai", "api_key": "sk-real", "language": "Klingon"}
    df = pd.DataFrame({"Story": ["alpha beta gamma alpha", "delta alpha"]})
    # Must not raise; produces some text (real stop-word worker, falls back to en).
    out = summaries.compute_summaries(
        [{"name": "kw", "stat": "keyword_frequency", "questions": ["Story"]}],
        df, ai_cfg,
    )
    assert out["summary_kw"] != "N/A", f"unknown language crashed keyword_frequency: {out}"


# ── Ask engine: proposals ────────────────────────────────────────────────────────

def test_ask_propose_threads_language_into_prompt_vars(monkeypatch):
    """AC: the Ask engine proposal prompt carries the configured ai.language."""
    from src.reports import ask_engine
    cap = {}
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", _capture_get_prompt(cap))
    monkeypatch.setattr(ask_engine.lf_client, "chat",
                        lambda *a, **k: '{"items":[{"kind":"chart","name":"c","type":"bar","questions":["Region"]}]}')

    ai_cfg = {"provider": "openai", "api_key": "sk-real", "language": "French"}
    ask_engine.propose_items("combien par région ?", {"tables": []}, ai_cfg)

    assert cap.get("variables"), "propose_items never called get_prompt"
    assert "French" in _french_blob(cap["variables"]), \
        f"Ask proposal prompt vars carry no French language: {cap['variables']}"


# ── Ask engine: captions ─────────────────────────────────────────────────────────

def test_ask_caption_threads_language_into_prompt_vars(monkeypatch):
    """AC: the Ask engine caption prompt carries the configured ai.language."""
    from src.reports import ask_engine
    cap = {}
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", _capture_get_prompt(cap))
    monkeypatch.setattr(ask_engine.lf_client, "chat",
                        lambda *a, **k: '{"captions":{"by_region":"légende"}}')

    ai_cfg = {"provider": "openai", "api_key": "sk-real", "language": "French"}
    items = [{"name": "by_region", "title": "Par région", "summary": "Region: E=3"}]
    ask_engine.ground_captions(items, ai_cfg)

    assert cap.get("variables"), "ground_captions never called get_prompt"
    assert "French" in _french_blob(cap["variables"]), \
        f"Ask caption prompt vars carry no French language: {cap['variables']}"


# ── AI suggester (chart) ─────────────────────────────────────────────────────────

def test_chart_suggester_threads_language_into_prompt_vars(monkeypatch):
    """AC: the AI suggester includes the configured ai.language in its prompt vars."""
    from src.reports import ai_chart_suggester as acs
    cap = {}
    monkeypatch.setattr(lf_client, "get_prompt", _capture_get_prompt(cap))
    monkeypatch.setattr(lf_client, "chat",
                        lambda *a, **k: '{"charts":[{"name":"r","type":"bar","questions":["Region"]}]}')

    cfg = {
        "ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o",
               "language": "French"},
        "form": {"alias": "survey"},
        "questions": [{"export_label": "Region", "category": "categorical"}],
    }
    acs.suggest_charts(cfg)

    assert cap.get("variables"), "suggest_charts never called get_prompt"
    assert "French" in _french_blob(cap["variables"]), \
        f"chart suggester prompt vars carry no French language: {cap['variables']}"
