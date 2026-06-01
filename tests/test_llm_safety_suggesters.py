"""Tests for the PII suggester, hidden-suggester candidate filtering, and the
shared llm_safe_questions gate (privacy: LLM features see only safe metadata)."""
from unittest import mock

from src.reports import ai_pii_suggester as aps
from src.reports import ai_hidden_suggester as ahs
from src.utils.config import (
    llm_safe_questions, is_effective_hidden, is_pii,
)


# ── Deliverable 1: PII suggester graceful no-AI ─────────────────────────────────

def test_suggest_pii_graceful_when_ai_unconfigured():
    cfg = {"questions": [{"kobo_key": "name", "label": "Full name", "type": "text"}]}
    out = aps.suggest_pii(cfg)
    assert out == {"suggestions": [], "message": "AI not configured"}


def test_suggest_pii_graceful_when_api_key_is_env_placeholder():
    cfg = {
        "ai": {"provider": "openai", "api_key": "env:OPENAI_API_KEY"},
        "questions": [{"kobo_key": "name", "label": "Full name", "type": "text"}],
    }
    out = aps.suggest_pii(cfg)
    assert out == {"suggestions": [], "message": "AI not configured"}


def test_suggest_pii_reshapes_into_suggestions_and_reasons():
    cfg = {
        "ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o"},
        "questions": [
            {"kobo_key": "name", "label": "Full name", "type": "text"},
            {"kobo_key": "phone", "label": "Phone", "type": "text"},
            {"kobo_key": "region", "label": "Region", "type": "select_one"},
        ],
    }
    raw = ('{"suggestions": ['
           '{"kobo_key": "name", "reason": "personal name"},'
           '{"kobo_key": "phone", "reason": "phone number"},'
           '{"kobo_key": "ghost", "reason": "not in list"}]}')
    with mock.patch("src.utils.lf_client.chat", return_value=raw) as ch:
        out = aps.suggest_pii(cfg)
    assert out["suggestions"] == ["name", "phone"]   # unknown key dropped
    assert out["reasons"]["name"] == "personal name"
    assert ch.call_args.kwargs["trace_name"] == "pii_suggester"
    # ONLY metadata reaches the LLM — no answer values / choices.
    sent_blob = " ".join(m["content"] for m in ch.call_args.args[0])
    assert "Full name" in sent_blob and "region" in sent_blob


# ── Deliverable 2: hidden-suggester candidate pool ──────────────────────────────

def test_candidates_excludes_analytical_and_hidden():
    questions = [
        {"kobo_key": "q_cat", "category": "categorical", "type": "select_one"},
        {"kobo_key": "q_qual", "category": "qualitative", "type": "text"},
        {"kobo_key": "q_quant", "category": "quantitative", "type": "integer"},
        {"kobo_key": "q_geo", "category": "geographical", "type": "gps"},
        {"kobo_key": "q_hidden", "category": "categorical", "hidden": True},
        {"kobo_key": "q_note", "category": "undefined", "type": "note"},
    ]
    keys = {q["kobo_key"] for q in ahs._candidates(questions)}
    assert keys == {"q_cat", "q_geo"}


def test_suggest_hidden_returns_nothing_to_review_when_no_candidates():
    cfg = {
        "ai": {"provider": "openai", "api_key": "sk-real"},
        "questions": [
            {"kobo_key": "q_qual", "category": "qualitative", "type": "text"},
            {"kobo_key": "q_note", "category": "undefined", "type": "note"},
        ],
    }
    with mock.patch("src.utils.lf_client.chat") as ch:
        out = ahs.suggest_hidden(cfg)
    assert out == {"suggestions": [], "message": "Nothing to review"}
    ch.assert_not_called()


def test_suggest_hidden_only_offers_candidate_keys_to_llm():
    cfg = {
        "ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o"},
        "questions": [
            {"kobo_key": "q_cat", "label": "Category", "category": "categorical", "type": "select_one"},
            {"kobo_key": "q_qual", "label": "Story", "category": "qualitative", "type": "text"},
            {"kobo_key": "q_hidden", "label": "Hid", "category": "categorical", "hidden": True},
        ],
    }
    with mock.patch("src.utils.lf_client.chat",
                    return_value='{"suggestions": []}') as ch:
        ahs.suggest_hidden(cfg)
    sent_blob = " ".join(m["content"] for m in ch.call_args.args[0])
    assert "q_cat" in sent_blob
    assert "q_qual" not in sent_blob   # analytical category excluded
    assert "q_hidden" not in sent_blob  # already hidden excluded


# ── Deliverable 3: shared safety gate ───────────────────────────────────────────

def test_llm_safe_questions_drops_hidden_and_pii():
    cfg = {"questions": [
        {"kobo_key": "ok", "category": "categorical"},
        {"kobo_key": "hid", "category": "categorical", "hidden": True},
        {"kobo_key": "note", "type": "note"},
        {"kobo_key": "secret", "category": "qualitative", "pii": True},
    ]}
    safe = {q["kobo_key"] for q in llm_safe_questions(cfg)}
    assert safe == {"ok"}


def test_is_effective_hidden_and_is_pii():
    assert is_effective_hidden({"type": "note"}) is True
    assert is_effective_hidden({"type": "text"}) is False
    assert is_effective_hidden({"type": "text", "hidden": True}) is True
    assert is_pii({"pii": True}) is True
    assert is_pii({}) is False
