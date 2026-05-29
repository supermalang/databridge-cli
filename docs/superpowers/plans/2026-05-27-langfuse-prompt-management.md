# Langfuse Prompt Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Langfuse Cloud the single source of truth for the project's eight AI prompts (across seven feature files) and capture every LLM call as a trace with cost/latency/tokens, while keeping the CLI fully functional offline.

**Architecture:** A single new module `src/utils/lf_client.py` owns prompt resolution (Langfuse → disk cache → in-code seed), traced LLM calls (OpenAI/Anthropic), and a bootstrap helper. The seven AI feature files stop building prompts with Python `.format()` and instead build a `variables` dict, fetch a `{{mustache}}` chat prompt via `lf_client.get_prompt`, and call `lf_client.chat`. Seed prompts live in `src/utils/seed_prompts.py`; the old `prompts:` config block and `src/utils/prompts.py` are removed.

**Tech Stack:** Python 3, `langfuse` SDK (new), `openai` / `anthropic` SDKs, `click` CLI, `pytest` + `unittest.mock` (note: `respx` is NOT a dependency — do not add it).

**Spec:** `docs/superpowers/specs/2026-05-27-langfuse-prompt-management-design.md`

---

## Conventions used in every task

- Run all commands from the project root with `PYTHONPATH=.` set (e.g. `PYTHONPATH=. pytest ...`).
- The `lf_client` public API, fixed in Phase 1 and used unchanged everywhere after:

```python
def is_enabled() -> bool
def get_prompt(name: str, variables: dict, label: str = "production") -> list[dict]   # -> [{"role","content"}, ...]
def compile_messages(messages: list[dict], variables: dict) -> list[dict]
def chat(messages: list[dict], *, model: str, provider: str, api_key: str,
         max_tokens: int, trace_name: str, base_url: str | None = None,
         json_mode: bool = False) -> str
def push_seed_prompts(force: bool = False) -> list[tuple[str, str]]   # (name, "created"|"skipped"|"updated")
def flush() -> None
```

- Chat-message shape everywhere: `[{"role": "system", "content": "..."}, {"role": "user", "content": "..."}]`.
- Prompt names (Langfuse + `SEED_PROMPTS` keys): `narrator`, `summaries`, `chart_suggester`, `template_generator`, `summary_suggester`, `view_suggester`, `classifier_discover`, `classifier_classify` (8 total).

---

## Phase 0 — Dependencies & config scaffolding

### Task 1: Add dependencies and environment variables

**Files:**
- Modify: `requirements.txt`
- Modify: `.env.example`

- [ ] **Step 1: Add `langfuse` and enable `openai` in `requirements.txt`**

Find the AI section (currently):
```
# Uncomment for AI narrative generation (OpenAI-compatible: OpenAI, Azure, Groq, Mistral, Ollama):
# openai>=1.0.0
# Uncomment for AI narrative generation (Anthropic Claude):
anthropic>=0.20.0
```
Replace with:
```
# AI narrative generation (OpenAI-compatible: OpenAI, Azure, Groq, Mistral, Ollama):
openai>=1.0.0
# AI narrative generation (Anthropic Claude):
anthropic>=0.20.0
# Prompt management + LLM tracing:
langfuse>=2.53.0
```

- [ ] **Step 2: Add Langfuse env vars to `.env.example`**

Append:
```
# Langfuse — prompt management + LLM tracing (https://cloud.langfuse.com)
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=https://cloud.langfuse.com
```

- [ ] **Step 3: Install**

Run: `pip install -r requirements.txt`
Expected: `langfuse`, `openai`, `anthropic` installed without error.

- [ ] **Step 4: Verify import works**

Run: `python3 -c "import langfuse; print(langfuse.__version__)"`
Expected: prints a version `>= 2.53.0`.

- [ ] **Step 5: Commit**

```bash
git add requirements.txt .env.example
git commit -m "build: add langfuse + openai deps and Langfuse env vars"
```

---

## Phase 1 — Core client (`lf_client.py`)

### Task 2: Create `seed_prompts.py` with all 8 seed prompts

**Files:**
- Create: `src/utils/seed_prompts.py`
- Test: `tests/test_seed_prompts.py`

> **Porting rule (from spec):** Convert `.format()` slots `{var}` → `{{var}}`. Convert escaped literal JSON braces `{{`/`}}` → single `{`/`}`. Copy the exact prompt strings from each source file (line refs given) — do not paraphrase.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_seed_prompts.py
import re
from src.utils.seed_prompts import SEED_PROMPTS

EXPECTED_NAMES = {
    "narrator", "summaries", "chart_suggester", "template_generator",
    "summary_suggester", "view_suggester", "classifier_discover", "classifier_classify",
}

def test_all_eight_prompts_present():
    assert set(SEED_PROMPTS) == EXPECTED_NAMES

def test_each_prompt_is_system_then_user():
    for name, msgs in SEED_PROMPTS.items():
        roles = [m["role"] for m in msgs]
        assert roles == ["system", "user"], f"{name} roles = {roles}"
        for m in msgs:
            assert isinstance(m["content"], str) and m["content"].strip()

def test_no_leftover_single_brace_format_slots():
    # After porting, dynamic slots must be {{double}}; stray single-brace
    # tokens like {language} would be a bad port. Allow {{...}} only.
    single = re.compile(r"(?<!\{)\{[a-z_][a-z0-9_]*\}(?!\})")
    for name, msgs in SEED_PROMPTS.items():
        for m in msgs:
            assert not single.search(m["content"]), f"{name} has a single-brace slot"

def test_narrator_user_has_expected_variables():
    user = SEED_PROMPTS["narrator"][1]["content"]
    for var in ("language", "title", "period", "n_submissions",
                "indicators_block", "stats_block", "categorical_block",
                "summaries_block", "charts_block"):
        assert "{{" + var + "}}" in user
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_seed_prompts.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.utils.seed_prompts'`.

- [ ] **Step 3: Create `src/utils/seed_prompts.py`**

Create the file with this exact header and the four SHORT prompts fully written out, then the four LONG prompts ported from their source files per the rule above.

```python
"""Bundled default prompts — the offline fallback and the source for `push-prompts`.

Each entry is a chat template: a list of {"role", "content"} messages using
Langfuse {{mustache}} placeholders. These are pushed to Langfuse by the
`push-prompts` CLI command and used verbatim when Langfuse is unreachable.

Names map 1:1 to Langfuse prompt names. See the design spec for the porting rule
(`.format()` {var} -> {{var}}; escaped {{ }} -> single { }).
"""
from typing import Dict, List

ChatMessages = List[Dict[str, str]]

# ── narrator (was src/reports/narrator.py SYSTEM_PROMPT / USER_PROMPT_TEMPLATE) ──
_NARRATOR: ChatMessages = [
    {"role": "system", "content": (
        "You are an expert humanitarian data analyst and report writer. "
        "You will receive structured survey data and must produce clear, professional "
        "narrative text for a Word report. "
        "Always respond with valid JSON only — no markdown fences, no extra commentary. "
        'Return exactly: {"summary_text": "...", "observations": "...", "recommendations": "..."}'
    )},
    {"role": "user", "content": (
        "Write narrative sections for a monitoring report in {{language}}.\n"
        "Report title: {{title}}\n"
        "Period: {{period}}\n"
        "Total submissions: {{n_submissions}}\n"
        "{{scope_line}}\n"
        "{{indicators_block}}{{stats_block}}{{categorical_block}}{{summaries_block}}{{charts_block}}"
        "Based on the data above, write three sections:\n"
        "  1. summary_text: A 2–3 sentence executive summary.\n"
        "  2. observations: 3–5 bullet observations (use \\n• as bullet separator).\n"
        "  3. recommendations: 2–4 actionable recommendations (use \\n• as bullet separator).\n\n"
        'Return ONLY a JSON object with keys "summary_text", "observations", "recommendations".'
    )},
]

# ── summaries (was src/reports/summaries.py AI_SUMMARY_SYSTEM_PROMPT / AI_SUMMARY_USER_TEMPLATE) ──
# NOTE: the old example-mode addenda (AI_SUMMARY_EXAMPLE_ADDENDUM / _USER_BLOCK) are
# folded into the variables {{example_block}} (user) — the system prompt stays static.
_SUMMARIES: ChatMessages = [
    {"role": "system", "content": (
        "You are a humanitarian data analyst. Write clear, professional text "
        "for a monitoring report. Be concise and data-driven. "
        "When an example format is provided, it overrides all default style choices — match it exactly."
    )},
    {"role": "user", "content": (
        "Write a summary in {{language}} of the following data.\n"
        "{{focus_line}}\n"
        "DATA:\n"
        "{{data_block}}{{example_block}}\n\n"
        "Return only the output text — no headers, no JSON, no markdown."
    )},
]

# ── classifier_discover (was src/data/classifier.py DISCOVER_SYSTEM_PROMPT / DISCOVER_USER_TEMPLATE) ──
_CLASSIFIER_DISCOVER: ChatMessages = [
    {"role": "system", "content": (
        "You are a survey data analyst. When given free-text survey responses, "
        "you identify concise, mutually-exclusive themes that cover most answers. "
        "Always return valid JSON only — no markdown fences, no commentary."
    )},
    {"role": "user", "content": (
        'Free-text responses to the survey question: "{{label}}"\n\n'
        "Responses:\n"
        "{{responses}}\n\n"
        "Propose exactly {{theme_count}} concise theme names (2–5 words each) that cover the "
        'majority of these responses. Add an "Other" theme only if a significant share of '
        "responses clearly don't fit the others.\n"
        'Return JSON: {"themes": ["Theme A", "Theme B", ...]}'
    )},
]

# ── classifier_classify (was src/data/classifier.py CLASSIFY_SYSTEM_PROMPT / CLASSIFY_USER_TEMPLATE) ──
_CLASSIFIER_CLASSIFY: ChatMessages = [
    {"role": "system", "content": (
        "You are a survey data analyst. Classify free-text survey responses into "
        "predefined themes. Always return valid JSON only — no markdown, no commentary."
    )},
    {"role": "user", "content": (
        'Classify each response to the question "{{label}}" into exactly one of these themes: [{{themes_str}}]\n\n'
        'For responses that clearly don\'t fit any theme, use "Other".\n\n'
        "Responses to classify:\n"
        "{{responses}}\n\n"
        'Return JSON: {"classifications": {"<response text>": "<theme name>", ...}}\n'
        "Include every response from the list, even if only one word."
    )},
]
```

- [ ] **Step 4: Port the four LONG suggester prompts into the same file**

Append these four entries. For each, copy the `SYSTEM_PROMPT` string and `USER_PROMPT_TEMPLATE` string **verbatim** from the named source file, applying the porting rule (convert each `.format()` slot to `{{...}}`; the suggester user templates use slots like `{header_line}`, `{form_alias}`, etc. — wrap each in double braces). The system prompts contain no `.format()` slots, so copy them unchanged (but verify there are no stray `{`/`}` that would be read as mustache — the chart catalog uses none).

```python
# ── chart_suggester — copy from src/reports/ai_chart_suggester.py:61-107
#    system = SYSTEM_PROMPT (lines 61-99, includes _CHART_CATALOG), unchanged
#    user   = USER_PROMPT_TEMPLATE (lines 104-107) with slots ->
#             {{header_line}} {{form_alias}} {{user_request_line}} {{columns_block}}
#             {{repeat_groups_block}} {{views_block}} {{pii_block}} {{existing_block}}
_CHART_SUGGESTER: ChatMessages = [
    {"role": "system", "content": (
        # PASTE ai_chart_suggester.SYSTEM_PROMPT verbatim here
        ...
    )},
    {"role": "user", "content": (
        "{{header_line}}Form: {{form_alias}}\n\n"
        "{{user_request_line}}{{columns_block}}{{repeat_groups_block}}{{views_block}}"
        "{{pii_block}}{{existing_block}}Suggest a charts: configuration block. Return JSON only."
    )},
]

# ── template_generator — copy from src/reports/ai_template_generator.py:29-95
#    user slots -> {{description}} {{pages}} {{language}} {{summary_prompt_line}}
#                  {{charts_block}} {{indicators_block}} {{summaries_block}}
#                  {{views_block}} {{questions_block}}
_TEMPLATE_GENERATOR: ChatMessages = [
    {"role": "system", "content": ( ... )},   # PASTE ai_template_generator.SYSTEM_PROMPT (lines 29-78)
    {"role": "user", "content": ( ... )},      # PASTE USER_PROMPT_TEMPLATE (lines 80-95) with {{...}} slots
]

# ── summary_suggester — copy from src/reports/ai_summary_suggester.py:23-56
#    user slots -> {{header_line}} {{form_alias}} {{user_request_line}} {{columns_block}}
#                  {{repeat_groups_block}} {{existing_summaries_block}} {{existing_charts_block}}
_SUMMARY_SUGGESTER: ChatMessages = [
    {"role": "system", "content": ( ... )},   # PASTE ai_summary_suggester.SYSTEM_PROMPT
    {"role": "user", "content": ( ... )},      # PASTE USER_PROMPT_TEMPLATE with {{...}} slots
]

# ── view_suggester — copy from src/reports/ai_view_suggester.py:23-56
#    user slots -> {{header_line}} {{form_alias}} {{user_request_line}} {{main_cols_block}}
#                  {{repeat_groups_block}} {{existing_views_block}} {{existing_charts_block}}
_VIEW_SUGGESTER: ChatMessages = [
    {"role": "system", "content": ( ... )},   # PASTE ai_view_suggester.SYSTEM_PROMPT
    {"role": "user", "content": ( ... )},      # PASTE USER_PROMPT_TEMPLATE with {{...}} slots
]

SEED_PROMPTS: Dict[str, ChatMessages] = {
    "narrator": _NARRATOR,
    "summaries": _SUMMARIES,
    "chart_suggester": _CHART_SUGGESTER,
    "template_generator": _TEMPLATE_GENERATOR,
    "summary_suggester": _SUMMARY_SUGGESTER,
    "view_suggester": _VIEW_SUGGESTER,
    "classifier_discover": _CLASSIFIER_DISCOVER,
    "classifier_classify": _CLASSIFIER_CLASSIFY,
}
```

> Replace every `...` above with the verbatim, brace-ported prompt text from the cited source lines. The `test_no_leftover_single_brace_format_slots` test will catch a slot you forgot to convert.

- [ ] **Step 5: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_seed_prompts.py -v`
Expected: all 4 tests PASS. If `test_no_leftover_single_brace_format_slots` fails, you left a `{slot}` un-doubled — fix it.

- [ ] **Step 6: Commit**

```bash
git add src/utils/seed_prompts.py tests/test_seed_prompts.py
git commit -m "feat(prompts): add seed_prompts.py with 8 chat-format seed prompts"
```

---

### Task 3: `lf_client.compile_messages` — pure mustache compiler

**Files:**
- Create: `src/utils/lf_client.py`
- Test: `tests/test_lf_client.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_lf_client.py
import pytest
from src.utils import lf_client

def test_compile_substitutes_variables():
    msgs = [{"role": "user", "content": "Hello {{name}}, {{n}} rows"}]
    out = lf_client.compile_messages(msgs, {"name": "World", "n": 5})
    assert out == [{"role": "user", "content": "Hello World, 5 rows"}]

def test_compile_missing_variable_raises_keyerror():
    msgs = [{"role": "user", "content": "Hello {{name}}"}]
    with pytest.raises(KeyError) as exc:
        lf_client.compile_messages(msgs, {})
    assert "name" in str(exc.value)

def test_compile_leaves_literal_json_braces_untouched():
    msgs = [{"role": "user", "content": 'Return {"k": "v"} for {{who}}'}]
    out = lf_client.compile_messages(msgs, {"who": "me"})
    assert out[0]["content"] == 'Return {"k": "v"} for me'

def test_compile_handles_whitespace_in_braces():
    msgs = [{"role": "user", "content": "{{ name }}"}]
    out = lf_client.compile_messages(msgs, {"name": "X"})
    assert out[0]["content"] == "X"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.utils.lf_client'`.

- [ ] **Step 3: Create `src/utils/lf_client.py` with the compiler**

```python
"""Langfuse client: prompt resolution (cache + seed fallback) and traced LLM calls.

Public API (stable):
    is_enabled() -> bool
    get_prompt(name, variables, label="production") -> list[dict]
    compile_messages(messages, variables) -> list[dict]
    chat(messages, *, model, provider, api_key, max_tokens, trace_name,
         base_url=None, json_mode=False) -> str
    push_seed_prompts(force=False) -> list[tuple[str, str]]
    flush() -> None
"""
import logging
import re
from typing import Dict, List, Optional

log = logging.getLogger(__name__)

ChatMessages = List[Dict[str, str]]

_VAR_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")


def compile_messages(messages: ChatMessages, variables: Dict) -> ChatMessages:
    """Substitute {{var}} placeholders. Raise KeyError if a referenced var is absent.

    Literal single braces (e.g. JSON examples like {"k": "v"}) are left untouched —
    only {{double}} braces are treated as variables.
    """
    out: ChatMessages = []
    for m in messages:
        content = m["content"]

        def _sub(match):
            key = match.group(1)
            if key not in variables:
                raise KeyError(f"missing prompt variable: {key!r}")
            return str(variables[key])

        out.append({"role": m["role"], "content": _VAR_RE.sub(_sub, content)})
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -v`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/lf_client.py tests/test_lf_client.py
git commit -m "feat(lf_client): pure {{mustache}} compiler with strict missing-var KeyError"
```

---

### Task 4: Disk cache read/write helpers

**Files:**
- Modify: `src/utils/lf_client.py`
- Test: `tests/test_lf_client.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_lf_client.py
import time

def test_cache_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    msgs = [{"role": "system", "content": "hi"}]
    lf_client._write_cache("narrator", "production", msgs)
    got, age = lf_client._read_cache("narrator", "production")
    assert got == msgs
    assert age < 5  # seconds

def test_cache_miss_returns_none(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    got, age = lf_client._read_cache("does_not_exist", "production")
    assert got is None and age == float("inf")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k cache -v`
Expected: FAIL — `_write_cache` / `_read_cache` / `CACHE_DIR` not defined.

- [ ] **Step 3: Add cache helpers to `src/utils/lf_client.py`**

```python
import json
import os
import time
from pathlib import Path

CACHE_DIR = Path(os.path.expanduser("~/.cache/databridge/prompts"))
CACHE_TTL_SECONDS = 3600


def _cache_path(name: str, label: str) -> Path:
    return CACHE_DIR / f"{name}-{label}.json"


def _write_cache(name: str, label: str, messages: ChatMessages) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(name, label).write_text(json.dumps(messages), encoding="utf-8")
    except OSError as exc:
        log.debug(f"prompt cache write failed for {name}: {exc}")


def _read_cache(name: str, label: str):
    """Return (messages, age_seconds) or (None, inf) on miss/error."""
    path = _cache_path(name, label)
    try:
        messages = json.loads(path.read_text(encoding="utf-8"))
        age = time.time() - path.stat().st_mtime
        return messages, age
    except (OSError, ValueError):
        return None, float("inf")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k cache -v`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/lf_client.py tests/test_lf_client.py
git commit -m "feat(lf_client): disk cache read/write helpers with age tracking"
```

---

### Task 5: `is_enabled` + `get_prompt` resolution & fallback

**Files:**
- Modify: `src/utils/lf_client.py`
- Test: `tests/test_lf_client.py`

Resolution order (cache-first to avoid a network call on every prompt): fresh cache (<TTL) → Langfuse fetch (if enabled) → stale cache → seed → `LookupError`.

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/test_lf_client.py
def test_is_enabled_false_without_keys(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    assert lf_client.is_enabled() is False

def test_get_prompt_uses_seed_when_disabled(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    msgs = lf_client.get_prompt("classifier_discover",
                                {"label": "Q", "responses": "- a", "theme_count": 3})
    assert msgs[0]["role"] == "system"
    assert "3" in msgs[1]["content"]          # theme_count compiled
    assert "{{" not in msgs[1]["content"]     # fully compiled

def test_get_prompt_uses_seed_when_fetch_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    def boom(name, label):
        raise ConnectionError("offline")
    monkeypatch.setattr(lf_client, "_fetch_from_langfuse", boom)
    msgs = lf_client.get_prompt("classifier_classify",
                                {"label": "Q", "themes_str": '"A"', "responses": "- a"})
    assert "A" in msgs[1]["content"]

def test_get_prompt_uses_cache_when_fresh(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    cached = [{"role": "system", "content": "cached"},
              {"role": "user", "content": "hi {{x}}"}]
    lf_client._write_cache("narrator", "production", cached)
    def fail(name, label):
        raise AssertionError("should not fetch when cache is fresh")
    monkeypatch.setattr(lf_client, "_fetch_from_langfuse", fail)
    msgs = lf_client.get_prompt("narrator", {"x": "1"}, label="production")
    assert msgs[0]["content"] == "cached"
    assert msgs[1]["content"] == "hi 1"

def test_get_prompt_unknown_name_raises_lookuperror(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    with pytest.raises(LookupError):
        lf_client.get_prompt("not_a_real_prompt", {})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k "get_prompt or is_enabled" -v`
Expected: FAIL — `is_enabled` / `get_prompt` / `_fetch_from_langfuse` not defined.

- [ ] **Step 3: Implement in `src/utils/lf_client.py`**

```python
from src.utils.seed_prompts import SEED_PROMPTS


def is_enabled() -> bool:
    return bool(os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY"))


def _fetch_from_langfuse(name: str, label: str) -> ChatMessages:
    """Fetch a chat prompt's raw messages from Langfuse. Raises on any failure."""
    client = _get_langfuse()
    prompt = client.get_prompt(name, label=label, type="chat")
    # Langfuse chat prompt .prompt is a list of {"role","content"} dicts.
    return [{"role": m["role"], "content": m["content"]} for m in prompt.prompt]


def get_prompt(name: str, variables: Dict, label: str = "production") -> ChatMessages:
    raw = _resolve_raw(name, label)
    return compile_messages(raw, variables)


def _resolve_raw(name: str, label: str) -> ChatMessages:
    cached, age = _read_cache(name, label)
    if cached is not None and age < CACHE_TTL_SECONDS:
        return cached

    if is_enabled():
        try:
            fetched = _fetch_from_langfuse(name, label)
            _write_cache(name, label, fetched)
            return fetched
        except Exception as exc:  # noqa: BLE001 — any failure falls back
            log.warning(f"Langfuse fetch failed for {name!r} ({type(exc).__name__}); using cache/seed.")

    if cached is not None:
        log.info(f"Using cached prompt for {name!r} (Langfuse unavailable).")
        return cached

    if name in SEED_PROMPTS:
        log.warning(f"Langfuse unreachable and no cache — using bundled seed prompt for {name!r}.")
        return SEED_PROMPTS[name]

    raise LookupError(f"No prompt named {name!r} in Langfuse, cache, or seeds.")
```

Add a lazily-initialised Langfuse handle accessor (used by `_fetch_from_langfuse`, `push_seed_prompts`, `chat`, `flush`):

```python
_LF = None  # cached Langfuse SDK instance


def _get_langfuse():
    global _LF
    if _LF is None:
        from langfuse import Langfuse
        _LF = Langfuse(
            public_key=os.environ["LANGFUSE_PUBLIC_KEY"],
            secret_key=os.environ["LANGFUSE_SECRET_KEY"],
            host=os.environ.get("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        )
    return _LF
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -v`
Expected: all tests so far PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/lf_client.py tests/test_lf_client.py
git commit -m "feat(lf_client): get_prompt with cache-first resolution and seed fallback"
```

---

### Task 6: `chat` — provider dispatch + tracing that never fails the command

**Files:**
- Modify: `src/utils/lf_client.py`
- Test: `tests/test_lf_client.py`

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/test_lf_client.py
def test_chat_calls_openai_and_returns_content(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    captured = {}
    def fake_openai(messages, model, api_key, max_tokens, base_url, json_mode):
        captured["messages"] = messages
        return "OPENAI_OUT", {"input": 10, "output": 3}
    monkeypatch.setattr(lf_client, "_call_openai", fake_openai)
    out = lf_client.chat(
        [{"role": "user", "content": "hi"}],
        model="gpt-4o", provider="openai", api_key="sk-x",
        max_tokens=100, trace_name="narrator", json_mode=True,
    )
    assert out == "OPENAI_OUT"
    assert captured["messages"][0]["content"] == "hi"

def test_chat_routes_anthropic(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    monkeypatch.setattr(lf_client, "_call_anthropic",
                        lambda *a, **k: ("ANTHROPIC_OUT", {"input": 1, "output": 1}))
    out = lf_client.chat([{"role": "user", "content": "hi"}],
                         model="claude-x", provider="anthropic", api_key="k",
                         max_tokens=50, trace_name="classifier_discover")
    assert out == "ANTHROPIC_OUT"

def test_chat_returns_output_even_if_tracing_raises(monkeypatch):
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    monkeypatch.setattr(lf_client, "_call_openai",
                        lambda *a, **k: ("OUT", {"input": 1, "output": 1}))
    def boom():
        raise ConnectionError("trace server down")
    monkeypatch.setattr(lf_client, "_get_langfuse", boom)
    out = lf_client.chat([{"role": "user", "content": "hi"}],
                         model="gpt-4o", provider="openai", api_key="k",
                         max_tokens=10, trace_name="narrator")
    assert out == "OUT"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k chat -v`
Expected: FAIL — `chat` / `_call_openai` / `_call_anthropic` not defined.

- [ ] **Step 3: Implement `chat` and the provider callers**

```python
def _split_messages(messages: ChatMessages):
    """Return (system_str, user_str) from a [system, user] message list."""
    system = next((m["content"] for m in messages if m["role"] == "system"), "")
    user = "\n\n".join(m["content"] for m in messages if m["role"] == "user")
    return system, user


def _call_openai(messages, model, api_key, max_tokens, base_url, json_mode):
    from openai import OpenAI
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    client = OpenAI(**kwargs)
    params = {"model": model, "max_tokens": max_tokens, "messages": messages}
    if json_mode:
        params["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**params)
    usage = getattr(resp, "usage", None)
    usage_dict = {"input": getattr(usage, "prompt_tokens", None),
                  "output": getattr(usage, "completion_tokens", None)} if usage else {}
    return resp.choices[0].message.content, usage_dict


def _call_anthropic(messages, model, api_key, max_tokens, base_url, json_mode):
    import anthropic
    system, user = _split_messages(messages)
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=model, max_tokens=max_tokens, system=system,
        messages=[{"role": "user", "content": user}],
    )
    usage = getattr(msg, "usage", None)
    usage_dict = {"input": getattr(usage, "input_tokens", None),
                  "output": getattr(usage, "output_tokens", None)} if usage else {}
    return msg.content[0].text, usage_dict


def chat(messages: ChatMessages, *, model: str, provider: str, api_key: str,
         max_tokens: int, trace_name: str, base_url: Optional[str] = None,
         json_mode: bool = False) -> str:
    provider = (provider or "openai").lower()

    def _invoke():
        if provider == "anthropic":
            return _call_anthropic(messages, model, api_key, max_tokens, base_url, json_mode)
        return _call_openai(messages, model, api_key, max_tokens, base_url, json_mode)

    if not is_enabled():
        text, _ = _invoke()
        return text

    # Traced path — tracing failures must never break the call.
    try:
        lf = _get_langfuse()
        with lf.start_as_current_generation(name=trace_name, model=model, input=messages) as gen:
            text, usage = _invoke()
            try:
                gen.update(output=text, usage_details=usage or None)
            except Exception as exc:  # noqa: BLE001
                log.debug(f"trace update failed: {exc}")
            return text
    except Exception as exc:  # noqa: BLE001 — includes _get_langfuse / span failures
        log.debug(f"tracing unavailable ({type(exc).__name__}); calling provider untraced.")
        text, _ = _invoke()
        return text
```

> **Note on the Langfuse SDK tracing call:** `start_as_current_generation(...)` is the v2.x/v3 context-manager API. If the installed SDK version differs, adapt the *traced path* only — the untraced fallback and the provider callers are version-independent. Verify against `python3 -c "import langfuse, inspect; print([m for m in dir(langfuse.Langfuse) if 'gener' in m.lower()])"` and the SDK docs before implementing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k chat -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/lf_client.py tests/test_lf_client.py
git commit -m "feat(lf_client): traced chat() with provider dispatch and safe tracing fallback"
```

---

### Task 7: `push_seed_prompts` + `flush`

**Files:**
- Modify: `src/utils/lf_client.py`
- Test: `tests/test_lf_client.py`

- [ ] **Step 1: Write the failing tests**

```python
# append to tests/test_lf_client.py
class _FakeLF:
    def __init__(self, existing=()):
        self.existing = set(existing)
        self.created = []
        self.flushed = False
    def get_prompt(self, name, label=None, type=None):
        if name not in self.existing:
            raise ValueError("not found")
        return object()
    def create_prompt(self, **kwargs):
        self.created.append(kwargs)
        self.existing.add(kwargs["name"])
    def flush(self):
        self.flushed = True

def test_push_seed_prompts_creates_missing(monkeypatch):
    fake = _FakeLF(existing=["narrator"])  # 1 exists, 7 missing
    monkeypatch.setattr(lf_client, "_get_langfuse", lambda: fake)
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    results = lf_client.push_seed_prompts()
    actions = dict(results)
    assert actions["narrator"] == "skipped"
    assert actions["classifier_discover"] == "created"
    assert len([a for a in actions.values() if a == "created"]) == 7

def test_push_seed_prompts_force_overwrites(monkeypatch):
    fake = _FakeLF(existing=lf_client.SEED_PROMPTS.keys())
    monkeypatch.setattr(lf_client, "_get_langfuse", lambda: fake)
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    results = dict(lf_client.push_seed_prompts(force=True))
    assert all(a == "updated" for a in results.values())
    assert len(fake.created) == 8

def test_push_seed_prompts_requires_enabled(monkeypatch):
    monkeypatch.setattr(lf_client, "is_enabled", lambda: False)
    with pytest.raises(RuntimeError):
        lf_client.push_seed_prompts()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k "push or flush" -v`
Expected: FAIL — `push_seed_prompts` / `flush` not defined.

- [ ] **Step 3: Implement in `src/utils/lf_client.py`**

```python
def _prompt_exists(client, name: str) -> bool:
    try:
        client.get_prompt(name, label="production", type="chat")
        return True
    except Exception:
        return False


def push_seed_prompts(force: bool = False):
    """Create each seed prompt in Langfuse. Returns [(name, action)].

    action: "created" | "skipped" | "updated"
    """
    if not is_enabled():
        raise RuntimeError(
            "Langfuse is not configured. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY."
        )
    client = _get_langfuse()
    results = []
    for name, messages in SEED_PROMPTS.items():
        exists = _prompt_exists(client, name)
        if exists and not force:
            results.append((name, "skipped"))
            continue
        client.create_prompt(
            name=name,
            type="chat",
            prompt=messages,
            labels=["production"],
        )
        results.append((name, "updated" if exists else "created"))
    flush()
    return results


def flush() -> None:
    """Drain the trace/ingestion queue. Safe to call when disabled."""
    if not is_enabled():
        return
    try:
        _get_langfuse().flush()
    except Exception as exc:  # noqa: BLE001
        log.debug(f"flush failed: {exc}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -v`
Expected: ALL `lf_client` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/lf_client.py tests/test_lf_client.py
git commit -m "feat(lf_client): push_seed_prompts bootstrap + flush"
```

---

## Phase 2 — Bootstrap command

### Task 8: `push-prompts` CLI command + web allowlist

**Files:**
- Modify: `src/data/make.py`
- Modify: `web/main.py` (the `ALLOWED_COMMANDS` mapping)
- Test: `tests/test_push_prompts_cli.py`

- [ ] **Step 1: Inspect the web allowlist**

Run: `grep -n "ALLOWED_COMMANDS" web/main.py`
Read the surrounding dict to match its exact format (key → command spec). You will add a `"push-prompts"` entry mirroring an existing zero-required-arg command like `"suggest-charts"`.

- [ ] **Step 2: Write the failing test**

```python
# tests/test_push_prompts_cli.py
from unittest import mock
from click.testing import CliRunner
from src.data.make import cli

def test_push_prompts_invokes_client():
    runner = CliRunner()
    with mock.patch("src.utils.lf_client.push_seed_prompts",
                    return_value=[("narrator", "created"), ("summaries", "skipped")]) as p:
        result = runner.invoke(cli, ["push-prompts"])
    assert result.exit_code == 0, result.output
    p.assert_called_once_with(force=False)
    assert "narrator" in result.output and "created" in result.output

def test_push_prompts_force_flag():
    runner = CliRunner()
    with mock.patch("src.utils.lf_client.push_seed_prompts",
                    return_value=[("narrator", "updated")]) as p:
        result = runner.invoke(cli, ["push-prompts", "--force"])
    assert result.exit_code == 0, result.output
    p.assert_called_once_with(force=True)

def test_push_prompts_reports_misconfig():
    runner = CliRunner()
    with mock.patch("src.utils.lf_client.push_seed_prompts",
                    side_effect=RuntimeError("Langfuse is not configured.")):
        result = runner.invoke(cli, ["push-prompts"])
    assert result.exit_code != 0
    assert "not configured" in result.output
```

- [ ] **Step 3: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_push_prompts_cli.py -v`
Expected: FAIL — no such command `push-prompts`.

- [ ] **Step 4: Add the command to `src/data/make.py`**

Insert after `cmd_set_period` (before the `if __name__` block):

```python
@cli.command("push-prompts")
@click.option("--force", is_flag=True, default=False,
              help="Overwrite prompts that already exist in Langfuse.")
def cmd_push_prompts(force):
    """Push bundled seed prompts to Langfuse (create-if-missing; --force overwrites)."""
    from src.utils import lf_client
    try:
        results = lf_client.push_seed_prompts(force=force)
    except RuntimeError as exc:
        click.echo(str(exc), err=True)
        sys.exit(1)
    for name, action in results:
        click.echo(f"  {action:8} {name}")
    click.echo(f"Done — {len(results)} prompt(s) processed.")
```

- [ ] **Step 5: Register in `web/main.py` `ALLOWED_COMMANDS`**

Add an entry mirroring the existing no-arg commands' shape (match what Step 1 showed). For example, if entries look like `"suggest-charts": ["suggest-charts"]`, add:
```python
    "push-prompts": ["push-prompts"],
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `PYTHONPATH=. pytest tests/test_push_prompts_cli.py -v`
Expected: 3 PASS.

- [ ] **Step 7: Verify the command is registered**

Run: `PYTHONPATH=. python3 src/data/make.py push-prompts --help`
Expected: help text for `push-prompts` with `--force`.

- [ ] **Step 8: Commit**

```bash
git add src/data/make.py web/main.py tests/test_push_prompts_cli.py
git commit -m "feat(cli): add push-prompts command to seed Langfuse + web allowlist"
```

---

## Phase 3 — Migrate the seven AI call sites

> **General migration pattern** (applied per file; each task spells out its specifics):
> 1. Delete `_call_openai`, `_call_anthropic`, and the JSON `_parse*` helpers ONLY where they're now unused — but keep any parser the file still needs for the response. (Parsers stay; only the provider callers and prompt-resolution move to `lf_client`.)
> 2. Replace the `from src.utils.prompts import system_prompt as _resolve_system, append_extra` import and its two calls with a `lf_client.get_prompt(...)` + `lf_client.chat(...)` pair.
> 3. Turn the `_user_prompt`/`_build_user_prompt` builder so it returns a **variables dict** instead of a formatted string (rename to `_build_variables`), preserving every block-building line verbatim.
> 4. Keep the early-return guards (`if not ai_cfg`, unresolved `api_key`) BEFORE any `lf_client` call so the no-AI smoke path is unchanged.

### Task 9: Migrate `narrator.py`

**Files:**
- Modify: `src/reports/narrator.py`
- Test: `tests/test_narrator.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_narrator.py
from unittest import mock
import pandas as pd
from src.reports import narrator

def test_narrator_no_ai_cfg_returns_empty():
    out = narrator.generate_narrative({}, {}, pd.DataFrame({"a": [1]}), [], {}, [])
    assert out == {"summary_text": "", "observations": "", "recommendations": ""}

def test_narrator_calls_lf_client_and_parses(monkeypatch):
    ai_cfg = {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500}
    df = pd.DataFrame({"Region": ["North", "South", "North"]})
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat",
                    return_value='{"summary_text":"S","observations":"O","recommendations":"R"}') as ch:
        out = narrator.generate_narrative(ai_cfg, {"title": "T", "period": "Q1"}, df, [], {}, [])
    assert out == {"summary_text": "S", "observations": "O", "recommendations": "R"}
    assert gp.call_args.args[0] == "narrator"
    assert ch.call_args.kwargs["trace_name"] == "narrator"
    assert ch.call_args.kwargs["json_mode"] is True
    # variables include the rendered blocks
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert "categorical_block" in variables and "n_submissions" in variables
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_narrator.py -v`
Expected: `test_narrator_calls_lf_client_and_parses` FAILS (still calls old `_call_openai`); the no-ai test passes.

- [ ] **Step 3: Edit `narrator.py`**

a) Delete the module constants `SYSTEM_PROMPT` and `USER_PROMPT_TEMPLATE` (lines ~26-49) and the `system_prompt` / `user_prompt_template` keyword params from `generate_narrative` (they're replaced by Langfuse).

b) Replace the resolution + call block (current lines ~95-115) with:

```python
    from src.utils import lf_client
    variables = _build_variables(
        ai_cfg, report_cfg, df, stats_table, indicators, charts_cfg,
        summaries=summaries, split_value=split_value, questions_cfg=questions_cfg,
    )
    try:
        messages = lf_client.get_prompt("narrator", variables)
        raw = lf_client.chat(
            messages, model=model, provider=provider, api_key=api_key,
            base_url=ai_cfg.get("base_url"), max_tokens=max_tokens,
            trace_name="narrator", json_mode=(provider != "anthropic"),
        )
        return _parse_response(raw)
    except Exception as exc:
        log.warning(f"AI narrative generation failed ({type(exc).__name__}: {exc}) — using empty strings.")
        return _EMPTY
```

c) Rename `_build_user_prompt` → `_build_variables`. Keep every block-building line (scope_line, indicators_block, stats_block, categorical_block, summaries_block, charts_block) verbatim. Replace the final `return template.format(...)` with:

```python
    return {
        "language": language,
        "title": report_cfg.get("title", "Report"),
        "period": report_cfg.get("period", ""),
        "n_submissions": f"{len(df):,}",
        "scope_line": scope_line,
        "indicators_block": indicators_block,
        "stats_block": stats_block,
        "categorical_block": categorical_block,
        "summaries_block": summaries_block,
        "charts_block": charts_block,
    }
```

d) Delete `_call_openai` and `_call_anthropic` from `narrator.py`. **IMPORTANT:** `summaries.py` and `classifier.py` import these from `narrator` today — those imports are removed in Tasks 10 and 15. If you are executing tasks strictly in order, that's fine because this task's tests don't exercise those files; but do NOT run the full suite until Tasks 10 and 15 are done. Keep `_parse_response` (still used).

e) **Update the caller in `builder.py`.** `src/reports/builder.py:178-188` calls `generate_narrative(...)` with a `prompts_cfg = prompts_cfg` keyword (and removed `system_prompt`/`user_prompt_template` if present). Delete the `prompts_cfg = prompts_cfg` line from that call. Leave the local `prompts_cfg = self.cfg.get("prompts", {})` on line 172 for now — Task 10 removes it once `compute_summaries` no longer needs it.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_narrator.py -v`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reports/narrator.py tests/test_narrator.py
git commit -m "refactor(narrator): fetch prompt + call LLM via lf_client"
```

---

### Task 10: Migrate `summaries.py` (`stat: ai`)

**Files:**
- Modify: `src/reports/summaries.py`
- Test: `tests/test_summaries_ai.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_summaries_ai.py
from unittest import mock
import pandas as pd
from src.reports import summaries

def test_ai_summary_uses_lf_client(monkeypatch):
    df = pd.DataFrame({"Age": [10, 20, 30]})
    ai_cfg = {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 500}
    cfg = [{"name": "age_note", "stat": "ai", "questions": ["Age"], "prompt": "summarise age"}]
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat", return_value="Average age is 20.") as ch:
        out = summaries.compute_summaries(cfg, df, ai_cfg=ai_cfg)
    assert out["summary_age_note"] == "Average age is 20."
    assert gp.call_args.args[0] == "summaries"
    assert ch.call_args.kwargs["trace_name"] == "summaries"
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert set(["language", "focus_line", "data_block", "example_block"]) <= set(variables)

def test_non_ai_summary_unaffected():
    df = pd.DataFrame({"Region": ["N", "S", "N"]})
    cfg = [{"name": "reg", "stat": "distribution", "questions": ["Region"]}]
    out = summaries.compute_summaries(cfg, df)
    assert "summary_reg" in out and out["summary_reg"] != "N/A"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_summaries_ai.py -v`
Expected: `test_ai_summary_uses_lf_client` FAILS (old `_call_*` import path). The distribution test passes.

- [ ] **Step 3: Edit `summaries.py`**

a) Delete constants `AI_SUMMARY_SYSTEM_PROMPT`, `AI_SUMMARY_EXAMPLE_ADDENDUM`, `AI_SUMMARY_USER_TEMPLATE`, `AI_SUMMARY_EXAMPLE_USER_BLOCK` (lines ~38-62) and the `system_prompt`/`user_prompt_template` params threaded through `compute_summaries`, `_compute_summary`, `_ai_text`.

b) Rewrite `_ai_text` (lines ~293-362). Keep the data-snippet builder (`data_lines` loop) verbatim. Replace the prompt/format/call tail with:

```python
    focus_line = f"Focus: {prompt}" if prompt else ""
    data_block = "\n".join(data_lines)
    example_block = (
        "\n\nIMPORTANT: Your output must strictly follow this example — same format, "
        "same length, same structure. Only replace the values with those from the data above:\n"
        f"{example}"
    ) if example else ""

    variables = {
        "language": lang,
        "focus_line": focus_line,
        "data_block": data_block,
        "example_block": example_block,
    }

    from src.utils import lf_client
    messages = lf_client.get_prompt("summaries", variables)
    raw = lf_client.chat(
        messages, model=model, provider=provider, api_key=api_key,
        base_url=ai_cfg.get("base_url"), max_tokens=max_tokens,
        trace_name="summaries", json_mode=False,
    )
    return raw.strip()
```

c) Remove `from src.reports.narrator import _call_openai, _call_anthropic`.

d) **Update the caller in `builder.py`.** At `src/reports/builder.py:172-175`, `compute_summaries(...)` is called with `prompts_cfg=prompts_cfg`. Remove that keyword argument, and delete the now-unused local `prompts_cfg = self.cfg.get("prompts", {})` on line 172 (Task 9 already removed the narrator usage of it). After this, `builder.py` no longer references `prompts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_summaries_ai.py -v`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reports/summaries.py tests/test_summaries_ai.py
git commit -m "refactor(summaries): route stat:ai through lf_client"
```

---

### Task 11: Migrate `ai_chart_suggester.py`

**Files:**
- Modify: `src/reports/ai_chart_suggester.py`
- Test: `tests/test_chart_suggester.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_chart_suggester.py
from unittest import mock
from src.reports import ai_chart_suggester as acs

def _cfg():
    return {
        "ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500},
        "form": {"alias": "survey"},
        "questions": [{"export_label": "Region", "category": "categorical"}],
    }

def test_suggest_charts_uses_lf_client():
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat",
                    return_value='{"charts":[{"name":"r","type":"bar","questions":["Region"]}]}') as ch:
        charts = acs.suggest_charts(_cfg())
    assert charts and charts[0]["name"] == "r"
    assert gp.call_args.args[0] == "chart_suggester"
    assert ch.call_args.kwargs["trace_name"] == "chart_suggester"
    assert ch.call_args.kwargs["json_mode"] is True
    # max_tokens still floored at 3000
    assert ch.call_args.kwargs["max_tokens"] >= 3000
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert "columns_block" in variables and "form_alias" in variables
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_chart_suggester.py -v`
Expected: FAIL (old `_call_*`).

- [ ] **Step 3: Edit `ai_chart_suggester.py`**

a) Delete the `SYSTEM_PROMPT`, `USER_PROMPT_TEMPLATE`, and `_CHART_CATALOG` module constants (lines ~21-107) and the `system_prompt`/`user_prompt_template` params on `suggest_charts`.

b) Replace `_get_suggestions` (lines ~157-174) with:

```python
def _get_suggestions(ai_cfg: Dict, cfg: Dict, user_request: str = "") -> List[Dict]:
    from src.utils import lf_client
    variables = _build_variables(cfg, user_request)
    provider   = ai_cfg.get("provider", "openai").lower()
    api_key    = ai_cfg.get("api_key", "")
    model      = ai_cfg.get("model", "gpt-4o")
    max_tokens = max(int(ai_cfg.get("max_tokens", 1500)), 3000)
    messages = lf_client.get_prompt("chart_suggester", variables)
    raw = lf_client.chat(
        messages, model=model, provider=provider, api_key=api_key,
        base_url=ai_cfg.get("base_url"), max_tokens=max_tokens,
        trace_name="chart_suggester", json_mode=(provider != "anthropic"),
    )
    return _parse(raw)
```

Update the one caller inside `suggest_charts` to `charts = _get_suggestions(ai_cfg, cfg, user_request)`.

c) Rename `_user_prompt(cfg, template, user_request)` → `_build_variables(cfg, user_request)`. Keep all block-building code verbatim; replace the final `return template.format(...)` with a dict whose keys are exactly: `header_line, form_alias, user_request_line, columns_block, repeat_groups_block, views_block, pii_block, existing_block`.

d) Delete `_call_openai` and `_call_anthropic`. Keep `_parse`, `_write_yaml`, `_print_yaml`.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_chart_suggester.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reports/ai_chart_suggester.py tests/test_chart_suggester.py
git commit -m "refactor(chart_suggester): route through lf_client"
```

---

### Task 12: Migrate `ai_template_generator.py`

**Files:**
- Modify: `src/reports/ai_template_generator.py`
- Test: `tests/test_template_generator_ai.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_template_generator_ai.py
from unittest import mock
from src.reports import ai_template_generator as atg

def test_template_generator_uses_lf_client(tmp_path):
    cfg = {"ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500},
           "charts": [{"name": "c1", "type": "bar"}], "questions": []}
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    # Return a minimal valid layout JSON the parser accepts (inspect _parse to match shape).
    layout_json = '{"sections": [{"heading": "Intro", "body": "x"}]}'
    out = tmp_path / "tpl.docx"
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat", return_value=layout_json) as ch, \
         mock.patch.object(atg, "_render_docx", create=True) as render:
        atg.ai_generate_template(cfg, out, "desc", 10, "English")
    assert gp.call_args.args[0] == "template_generator"
    assert ch.call_args.kwargs["trace_name"] == "template_generator"
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert {"description", "pages", "language", "questions_block"} <= set(variables)
```

> Before writing, open `ai_template_generator.py` and confirm the actual rendering function name and the parser's expected JSON shape; adjust `layout_json` and the `mock.patch.object(...)` target to match. Do not invent a `_render_docx` name if the file uses another.

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_template_generator_ai.py -v`
Expected: FAIL.

- [ ] **Step 3: Edit `ai_template_generator.py`**

a) Delete `SYSTEM_PROMPT` / `USER_PROMPT_TEMPLATE` constants and the matching params.

b) In the function that currently does `_resolve_system("template_generator", ...)` + `append_extra(...)` + provider call (around lines 218-245), replace with:

```python
    from src.utils import lf_client
    variables = _build_variables(cfg, description, pages, language, summary_prompt=summary_prompt)
    messages = lf_client.get_prompt("template_generator", variables)
    raw = lf_client.chat(
        messages, model=model, provider=provider, api_key=api_key,
        base_url=ai_cfg.get("base_url"), max_tokens=max_tokens,
        trace_name="template_generator", json_mode=(provider != "anthropic"),
    )
```
(Bind `provider`, `api_key`, `model`, `max_tokens` from `ai_cfg` just above, as the other files do.)

c) Rename the user-prompt builder (the function ending in `return template.format(...)` at ~325) to `_build_variables(...)` returning a dict with keys exactly: `description, pages, language, summary_prompt_line, charts_block, indicators_block, summaries_block, views_block, questions_block`.

d) Delete `_call_openai` / `_call_anthropic`. Keep the JSON parser and docx rendering.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_template_generator_ai.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reports/ai_template_generator.py tests/test_template_generator_ai.py
git commit -m "refactor(template_generator): route through lf_client"
```

---

### Task 13: Migrate `ai_summary_suggester.py`

**Files:**
- Modify: `src/reports/ai_summary_suggester.py`
- Test: `tests/test_summary_suggester.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_summary_suggester.py
from unittest import mock
from src.reports import ai_summary_suggester as ass

def _cfg():
    return {"ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500},
            "form": {"alias": "survey"},
            "questions": [{"export_label": "Region", "category": "categorical"}]}

def test_summary_suggester_uses_lf_client():
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat",
                    return_value='{"summaries":[{"name":"s1","stat":"distribution","questions":["Region"]}]}') as ch:
        out = ass.suggest_summaries(_cfg())
    assert out and out[0]["name"] == "s1"
    assert gp.call_args.args[0] == "summary_suggester"
    assert ch.call_args.kwargs["trace_name"] == "summary_suggester"
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert {"header_line", "form_alias", "columns_block",
            "existing_summaries_block", "existing_charts_block"} <= set(variables)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_summary_suggester.py -v`
Expected: FAIL.

- [ ] **Step 3: Edit `ai_summary_suggester.py`**

a) Delete `SYSTEM_PROMPT` / `USER_PROMPT_TEMPLATE` and the matching params.

b) Replace `_get_suggestions` (lines ~94-...) body with the `lf_client` pattern (mirror Task 11's `_get_suggestions`, but with `trace_name="summary_suggester"` and `max_tokens = int(ai_cfg.get("max_tokens", 1500))` — no 3000 floor here unless the original had one; check line ~99-110 and preserve whatever floor exists).

c) Rename `_user_prompt` → `_build_variables(cfg, user_request)`; keep block code verbatim; return a dict with keys exactly: `header_line, form_alias, user_request_line, columns_block, repeat_groups_block, existing_summaries_block, existing_charts_block`.

d) Delete `_call_openai` / `_call_anthropic`; keep `_parse`, `_write_yaml`, `_print_yaml`.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_summary_suggester.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reports/ai_summary_suggester.py tests/test_summary_suggester.py
git commit -m "refactor(summary_suggester): route through lf_client"
```

---

### Task 14: Migrate `ai_view_suggester.py`

**Files:**
- Modify: `src/reports/ai_view_suggester.py`
- Test: `tests/test_view_suggester.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_view_suggester.py
from unittest import mock
from src.reports import ai_view_suggester as avs

def _cfg():
    return {"ai": {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500},
            "form": {"alias": "survey"},
            "questions": [{"export_label": "Region", "category": "categorical"}]}

def test_view_suggester_uses_lf_client():
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat",
                    return_value='{"views":[{"name":"v1","source":"main"}]}') as ch:
        out = avs.suggest_views(_cfg())
    assert out and out[0]["name"] == "v1"
    assert gp.call_args.args[0] == "view_suggester"
    assert ch.call_args.kwargs["trace_name"] == "view_suggester"
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert {"header_line", "form_alias", "main_cols_block",
            "existing_views_block", "existing_charts_block"} <= set(variables)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_view_suggester.py -v`
Expected: FAIL.

- [ ] **Step 3: Edit `ai_view_suggester.py`**

Same shape as Task 13, with `trace_name="view_suggester"` and dict keys exactly: `header_line, form_alias, user_request_line, main_cols_block, repeat_groups_block, existing_views_block, existing_charts_block`. Delete prompt constants, `_call_*`; keep parser/output helpers.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_view_suggester.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reports/ai_view_suggester.py tests/test_view_suggester.py
git commit -m "refactor(view_suggester): route through lf_client"
```

---

### Task 15: Migrate `classifier.py` (two prompts)

**Files:**
- Modify: `src/data/classifier.py`
- Test: `tests/test_classifier.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_classifier.py
from unittest import mock
import pandas as pd
from src.data import classifier

AI = {"provider": "openai", "api_key": "sk-real", "model": "gpt-4o", "max_tokens": 1500}

def test_discover_themes_uses_classifier_discover_prompt():
    s = pd.Series(["water is bad", "no food", "water again"])
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat", return_value='{"themes":["Water","Food"]}') as ch:
        themes = classifier.discover_themes(s, "Issues", 2, AI)
    assert themes == ["Water", "Food"]
    assert gp.call_args.args[0] == "classifier_discover"
    assert ch.call_args.kwargs["trace_name"] == "classifier_discover"
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert {"label", "responses", "theme_count"} <= set(variables)

def test_classify_responses_uses_classifier_classify_prompt():
    s = pd.Series(["water bad", "hungry"])
    fake_msgs = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    with mock.patch("src.utils.lf_client.get_prompt", return_value=fake_msgs) as gp, \
         mock.patch("src.utils.lf_client.chat",
                    return_value='{"classifications":{"water bad":"Water","hungry":"Food"}}') as ch:
        out = classifier.classify_responses(s, ["Water", "Food"], "Issues", AI)
    assert list(out) == ["Water", "Food"]
    assert gp.call_args.args[0] == "classifier_classify"
    assert ch.call_args.kwargs["trace_name"] == "classifier_classify"
    variables = gp.call_args.args[1] if len(gp.call_args.args) > 1 else gp.call_args.kwargs["variables"]
    assert {"label", "themes_str", "responses"} <= set(variables)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_classifier.py -v`
Expected: FAIL.

- [ ] **Step 3: Edit `classifier.py`**

a) Delete the four prompt constants (`DISCOVER_SYSTEM_PROMPT`, `DISCOVER_USER_TEMPLATE`, `CLASSIFY_SYSTEM_PROMPT`, `CLASSIFY_USER_TEMPLATE`) and the `system_prompt`/`user_prompt_template` params from `discover_themes` / `classify_responses`.

b) In `discover_themes`, replace the resolution + `_call_llm` block with:

```python
    from src.utils import lf_client
    provider   = ai_cfg.get("provider", "openai").lower()
    api_key    = ai_cfg.get("api_key", "")
    if not api_key or str(api_key).startswith("env:"):
        raise ValueError("AI api_key is not resolved — check your ai: section in config.yml.")
    model      = ai_cfg.get("model", "gpt-4o")
    max_tokens = int(ai_cfg.get("max_tokens", 1500))

    variables = {
        "label": label,
        "responses": "\n".join(f"- {r}" for r in sample),
        "theme_count": theme_count,
    }
    messages = lf_client.get_prompt("classifier_discover", variables)
    raw = lf_client.chat(
        messages, model=model, provider=provider, api_key=api_key,
        base_url=ai_cfg.get("base_url"), max_tokens=max_tokens,
        trace_name="classifier_discover", json_mode=(provider != "anthropic"),
    )
    data = _parse_json(raw)
```

c) In `classify_responses`, inside the batch loop, replace the `user_prompt_template.format(...)` + `append_extra` + `_call_llm` with:

```python
        variables = {
            "label": label,
            "themes_str": themes_str,
            "responses": "\n".join(f"- {r}" for r in batch),
        }
        from src.utils import lf_client
        messages = lf_client.get_prompt("classifier_classify", variables)
        raw = lf_client.chat(
            messages, model=model, provider=provider, api_key=api_key,
            base_url=ai_cfg.get("base_url"), max_tokens=max_tokens,
            trace_name="classifier_classify", json_mode=(provider != "anthropic"),
        )
        data = _parse_json(raw)
```
Bind `provider`, `api_key`, `model`, `max_tokens` from `ai_cfg` once before the loop (mirror `discover_themes`).

d) Delete `_call_llm` (it imported the now-removed `narrator._call_openai/_call_anthropic`). Keep `_parse_json`.

e) **Update the caller in `make.py`.** In `_run_classify` (`src/data/make.py:156-165`): delete the local `prompts_cfg = cfg.get("prompts", {})` line and remove the `prompts_cfg=prompts_cfg` keyword from both `discover_themes(...)` and `classify_responses(...)` calls.

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_classifier.py -v`
Expected: 2 PASS.

- [ ] **Step 5: Run the FULL suite — narrator's deleted callers are now safe**

Run: `PYTHONPATH=. pytest -q`
Expected: PASS (or pre-existing unrelated failures only). In particular `tests/test_build_report_smoke.py` must pass — it exercises the no-AI narrator path.

- [ ] **Step 6: Commit**

```bash
git add src/data/classifier.py tests/test_classifier.py
git commit -m "refactor(classifier): split into classifier_discover/classify via lf_client"
```

---

## Phase 4 — Cleanup, docs, verification

### Task 16: Remove the old `prompts:` system

**Files:**
- Delete: `src/utils/prompts.py`
- Modify: `sample.config.yml`
- Modify: `config.yml` (if present and untracked — only if it exists)
- Test: full suite

- [ ] **Step 1: Confirm nothing imports `src.utils.prompts` anymore**

Run: `grep -rn "utils.prompts\|from src.utils import prompts" src/ web/ tests/`
Expected: NO matches. If any remain, fix that file before deleting.

- [ ] **Step 2: Delete the module**

Run: `git rm src/utils/prompts.py`

- [ ] **Step 3: Remove the `prompts:` block from `sample.config.yml`**

Open `sample.config.yml`, find the `# Optional prompt overrides …` / `prompts:` block (mirrors the one documented in CLAUDE.md), and delete it. Add a short comment in its place:
```yaml
# Prompts are managed in Langfuse (see README → "Prompt management").
# Run:  python3 src/data/make.py push-prompts   to seed them.
```

- [ ] **Step 4: Remove `prompts:` from `config.yml` if it exists**

Run: `test -f config.yml && grep -n "^prompts:" config.yml || echo "no config.yml prompts block"`
If present, delete the `prompts:` block manually (config.yml is gitignored/local; leave the file otherwise intact).

- [ ] **Step 5: Run the full suite**

Run: `PYTHONPATH=. pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(prompts): remove src/utils/prompts.py and config prompts: block"
```

---

### Task 17: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update `CLAUDE.md` "Prompt customization" section**

Replace the section that documents `src/utils/prompts.py` and the `prompts:` block with a "Prompt management (Langfuse)" section covering:
- The eight prompt names and which file consumes each.
- `python3 src/data/make.py push-prompts [--force]` to seed.
- Env vars `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_HOST`.
- Offline behavior: disk cache (`~/.cache/databridge/prompts/`) → `src/utils/seed_prompts.py` fallback.
- "To add a new prompt site" steps now: add a `SEED_PROMPTS` entry, call `lf_client.get_prompt` + `lf_client.chat`, run `push-prompts`.

- [ ] **Step 2: Update the CLI command list in `CLAUDE.md`**

Add `push-prompts` to the commands section.

- [ ] **Step 3: Update `README.md`**

Add a "Prompt management" subsection mirroring the CLAUDE.md changes (setup: create Langfuse account, copy keys to `.env`, run `push-prompts`). Remove any `prompts:` config references.

- [ ] **Step 4: Verify no stale references remain**

Run: `grep -rn "prompts:" CLAUDE.md README.md sample.config.yml; grep -rn "system_prompt\|append_extra" CLAUDE.md README.md`
Expected: only the new Langfuse-context mentions (no instructions to use the old `prompts:` block).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document Langfuse prompt management, drop prompts: block"
```

---

### Task 18: Per-command trace grouping (parent span)

Gives the spec's trace tree: a parent trace named after the CLI command, with each `chat()` generation nested under it.

**Files:**
- Modify: `src/utils/lf_client.py` (add `command_trace` context manager)
- Modify: `src/data/make.py` (wrap `download`, `build-report`, the four `suggest-*`, `ai-generate-template`)
- Test: `tests/test_lf_client.py`

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_lf_client.py
def test_command_trace_noop_when_disabled(monkeypatch):
    monkeypatch.setattr(lf_client, "is_enabled", lambda: False)
    with lf_client.command_trace("build-report"):
        pass  # must not raise

def test_command_trace_uses_span_when_enabled(monkeypatch):
    events = []
    class _Span:
        def __enter__(self): events.append("enter"); return self
        def __exit__(self, *a): events.append("exit"); return False
    class _LF:
        def start_as_current_span(self, name):
            events.append(("span", name)); return _Span()
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    monkeypatch.setattr(lf_client, "_get_langfuse", lambda: _LF())
    with lf_client.command_trace("download"):
        pass
    assert ("span", "download") in events and events[-1] == "exit"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k command_trace -v`
Expected: FAIL — `command_trace` not defined.

- [ ] **Step 3: Implement `command_trace` in `lf_client.py`**

```python
import contextlib


@contextlib.contextmanager
def command_trace(name: str):
    """Group all chat() generations in this block under one parent trace.

    No-op (and never raises) when Langfuse is disabled or the SDK call fails.
    Always flushes on exit.
    """
    if not is_enabled():
        yield
        return
    try:
        lf = _get_langfuse()
        with lf.start_as_current_span(name=name):
            yield
    except Exception as exc:  # noqa: BLE001
        log.debug(f"command_trace span unavailable ({type(exc).__name__}); continuing untraced.")
        yield
    finally:
        flush()
```

> Confirm the span API name (`start_as_current_span`) against the installed SDK, as in Task 6's note. If unavailable, fall back to `yield` + `flush()` only (the per-call generations still record, just ungrouped).

- [ ] **Step 4: Wrap the AI-bearing commands in `make.py`**

For each of `cmd_download`, `cmd_build_report`, `cmd_suggest_charts`, `cmd_suggest_views`, `cmd_suggest_summaries`, `cmd_ai_generate_template`: import `lf_client` and wrap the body in `with lf_client.command_trace("<command-name>"):`. Example for `suggest-charts`:

```python
def cmd_suggest_charts(out, user_request):
    """Ask AI to suggest a charts: config block from your questions."""
    from src.reports.ai_chart_suggester import suggest_charts
    from src.utils import lf_client
    cfg = load_config(CONFIG_PATH)
    if not cfg.get("ai"):
        click.echo("No ai: section in config.yml. Configure AI in the web UI first.", err=True)
        sys.exit(1)
    if not cfg.get("questions"):
        click.echo("No questions in config.yml. Run fetch-questions first.", err=True)
        sys.exit(1)
    with lf_client.command_trace("suggest-charts"):
        suggest_charts(cfg, out_path=out, user_request=user_request)
```

- [ ] **Step 5: Run tests + a smoke check**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k command_trace -v && PYTHONPATH=. pytest tests/test_build_report_smoke.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/lf_client.py src/data/make.py tests/test_lf_client.py
git commit -m "feat(lf_client): per-command trace grouping for AI CLI commands"
```

---

### Task 19: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `PYTHONPATH=. pytest -q`
Expected: all green (or only pre-existing, unrelated failures — compare against `git stash` baseline if unsure).

- [ ] **Step 2: Confirm offline behavior with no Langfuse keys**

Run:
```bash
env -u LANGFUSE_PUBLIC_KEY -u LANGFUSE_SECRET_KEY PYTHONPATH=. pytest tests/test_build_report_smoke.py -q
```
Expected: PASS — proves the no-AI / disabled path is intact.

- [ ] **Step 3: Confirm `push-prompts` fails cleanly without keys**

Run:
```bash
env -u LANGFUSE_PUBLIC_KEY -u LANGFUSE_SECRET_KEY PYTHONPATH=. python3 src/data/make.py push-prompts
```
Expected: prints "Langfuse is not configured…" and exits non-zero (no traceback).

- [ ] **Step 4: Confirm no orphaned references**

Run: `grep -rn "src.utils.prompts\|_resolve_system\|append_extra\|SYSTEM_PROMPT\|USER_PROMPT_TEMPLATE" src/ web/`
Expected: NO matches (all moved to `seed_prompts.py` / Langfuse).

- [ ] **Step 5: Manual live check (optional — requires real Langfuse keys + an LLM key)**

Follow the manual checklist in the spec: set keys, `push-prompts` (creates 8), re-run (idempotent), edit a prompt in the UI, run `build-report`, confirm the trace tree appears with nested generations.

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test: verify Langfuse integration end-to-end"
```

---

## Self-Review notes (for the plan author / executor)

- **Spec coverage:** prompt fetch+cache+seed (Tasks 3-5), tracing (Task 6, 18), bootstrap (Tasks 7-8), all 8 prompts incl. classifier split (Task 2, 15), config/doc cleanup (Tasks 16-17), offline + fail-loud behaviors (Tasks 5-6, 19). Evals are explicitly out of scope per spec.
- **`max_tokens` floor:** only `chart_suggester` forces `>= 3000` (Task 11); other sites keep their existing defaults — verify each file's original value when editing.
- **`json_mode`:** set `True` for JSON-output features (narrator, all suggesters, template_generator, classifier_*) and `False` for `summaries`. The code uses `provider != "anthropic"` because Anthropic has no `response_format`; the JSON instruction lives in the prompt itself.
- **Do not run the full suite between Task 9 and Task 15** — narrator's `_call_openai/_call_anthropic` are deleted in Task 9 but still imported by summaries/classifier until Tasks 10/15 land. Run per-file tests in that window; the full suite resumes at Task 15 Step 5.
