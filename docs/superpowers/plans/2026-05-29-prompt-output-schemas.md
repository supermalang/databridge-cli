# Prompt Output Schemas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach a JSON Schema to each JSON-returning Langfuse prompt's `config` field, fetch it with the prompt, and use it to force structurally-perfect output at the LLM call (OpenAI Structured Outputs, Anthropic tool-use). `summaries` stays plain text. Failures degrade safely to today's behavior.

**Architecture:** `SEED_PROMPTS` entries become `{"messages": [...], "config": {...}}` instead of bare message lists. `lf_client.get_prompt` returns `(messages, config)`. `lf_client.chat` gains an `output_schema` kwarg that flips OpenAI into Structured Outputs mode (mutually exclusive with `json_mode`) or builds an Anthropic forced tool-use call. Bad schemas are detected and degraded; provider errors propagate exactly like today's provider errors. Disk cache moves to a versioned filename (`<name>-<label>.v2.json`) so v1 caches are ignored, not misread.

**Tech Stack:** Python 3.12, `langfuse>=4.0.0`, `openai>=1.0.0`, `anthropic>=0.20.0` (installed 0.102.0), `pytest`, `unittest.mock`, **new dep:** `jsonschema>=4.0.0` (meta-schema test).

**Spec:** [docs/superpowers/specs/2026-05-29-prompt-output-schemas-design.md](../specs/2026-05-29-prompt-output-schemas-design.md)

---

## Conventions used in every task

- Run from project root with `PYTHONPATH=.` (e.g. `PYTHONPATH=. pytest ...`).
- Working tree: the merged `main` branch under `/workspaces/databridge-cli/`. Implementer will work in an isolated worktree set up by the subagent-driven workflow.
- The lf_client public API after this plan (stable across all tasks once Phase 1 lands):

```python
def get_prompt(name: str, variables: dict, label: str = "production") -> tuple[list[dict], dict]
def chat(messages, *, model, provider, api_key, max_tokens, trace_name,
         base_url=None, json_mode=False, output_schema=None) -> str
def push_seed_prompts(force=False) -> list[tuple[str, str]]
def compile_messages(messages, variables) -> list[dict]   # unchanged
def is_enabled() -> bool                                  # unchanged
def flush() -> None                                        # unchanged
def command_trace(name) -> contextmanager                  # unchanged
```

- Schema-aware behaviour rule (one safety invariant): if anything about an `output_schema` is malformed (not a dict / missing `"type"`), `chat()` logs WARNING (`"output_schema for <trace_name> malformed; falling back to no-schema mode"`) and proceeds with `json_mode` as if schema were absent. A schema that the **provider** itself rejects (e.g. OpenAI 400 because we wrote invalid Strict-mode schema) propagates exactly like any other provider error — the call site's existing `try/except` returns empty/skip.

- **Verified provider APIs** (probed on this machine — use exactly these shapes):
  - **OpenAI** (gpt-4o family): `response_format={"type": "json_schema", "json_schema": {"name": <trace_name>, "strict": True, "schema": <output_schema>}}`. This is **mutually exclusive** with `{"type":"json_object"}` — when schema is set, do NOT also set json_object.
  - **Anthropic** (0.102.0):
    - `tools=[{"name": <trace_name>, "description": "Return the requested structured output.", "input_schema": <output_schema>}]`
    - `tool_choice={"type": "tool", "name": <trace_name>, "disable_parallel_tool_use": True}`
    - Response: iterate `msg.content`; find the block with `block.type == "tool_use"` and `block.name == <trace_name>`; its `.input` is the result dict.

---

## Phase 0 — Dependency

### Task 1: Add `jsonschema` to requirements

**Files:**
- Modify: `requirements.txt`

- [ ] **Step 1: Append `jsonschema>=4.0.0`**

Add this line near the bottom (after `pytest`/`httpx`):
```
# JSON Schema meta-schema validation (seed_prompts tests):
jsonschema>=4.0.0
```

- [ ] **Step 2: Install**

Run: `pip install -r requirements.txt`
Expected: `jsonschema` installs without error.

- [ ] **Step 3: Verify**

Run: `python3 -c "import jsonschema; print(jsonschema.__version__)"`
Expected: prints a version `>= 4.0.0`.

- [ ] **Step 4: Commit**

```bash
git add requirements.txt
git commit -m "build: add jsonschema (meta-schema test for seed prompts)"
```

---

## Phase 1 — Restructure `SEED_PROMPTS`, `get_prompt`, cache, and callers (no schemas yet)

This phase changes the shape of `SEED_PROMPTS` and `get_prompt`'s return type. Phase-internal tasks must land in order; each task keeps the full test suite green.

### Task 2: Reshape `SEED_PROMPTS` to `{messages, config}`

**Files:**
- Modify: `src/utils/seed_prompts.py`
- Modify: `tests/test_seed_prompts.py`

- [ ] **Step 1: Update tests to expect the new shape**

Open `tests/test_seed_prompts.py`. Replace the four existing tests with the versions below (the EXPECTED_NAMES set and the variable list are unchanged):

```python
import re
from src.utils.seed_prompts import SEED_PROMPTS

EXPECTED_NAMES = {
    "narrator", "summaries", "chart_suggester", "template_generator",
    "summary_suggester", "view_suggester", "classifier_discover", "classifier_classify",
}

def test_all_eight_prompts_present():
    assert set(SEED_PROMPTS) == EXPECTED_NAMES

def test_each_entry_is_messages_plus_config():
    for name, entry in SEED_PROMPTS.items():
        assert isinstance(entry, dict), f"{name} must be a dict"
        assert set(entry) >= {"messages", "config"}, f"{name} missing keys: {set(entry)}"
        assert isinstance(entry["config"], dict), f"{name} config must be a dict"
        msgs = entry["messages"]
        roles = [m["role"] for m in msgs]
        assert roles == ["system", "user"], f"{name} roles = {roles}"
        for m in msgs:
            assert isinstance(m["content"], str) and m["content"].strip()

def test_no_leftover_single_brace_format_slots():
    single = re.compile(r"(?<!\{)\{[a-z_][a-z0-9_]*\}(?!\})")
    for name, entry in SEED_PROMPTS.items():
        for m in entry["messages"]:
            assert not single.search(m["content"]), f"{name} has a single-brace slot"

def test_narrator_user_has_expected_variables():
    user = SEED_PROMPTS["narrator"]["messages"][1]["content"]
    for var in ("language", "title", "period", "n_submissions",
                "indicators_block", "stats_block", "categorical_block",
                "summaries_block", "charts_block"):
        assert "{{" + var + "}}" in user
```

- [ ] **Step 2: Run tests — confirm they fail with the OLD shape**

Run: `PYTHONPATH=. pytest tests/test_seed_prompts.py -v`
Expected: FAIL with `AttributeError`/`TypeError` because current `SEED_PROMPTS[name]` is a list, not a dict.

- [ ] **Step 3: Reshape `src/utils/seed_prompts.py`**

The file currently defines eight private constants `_NARRATOR`, `_SUMMARIES`, etc. (each a list of messages), and `SEED_PROMPTS = {"narrator": _NARRATOR, ...}`.

Wrap EACH constant assignment by changing the final `SEED_PROMPTS` definition (do NOT rename or rewrite the eight message constants). Replace just the final dict literal:

```python
SeedPrompt = Dict[str, Any]   # {"messages": ChatMessages, "config": Dict[str, Any]}

SEED_PROMPTS: Dict[str, SeedPrompt] = {
    "narrator":            {"messages": _NARRATOR,             "config": {}},
    "summaries":           {"messages": _SUMMARIES,            "config": {}},
    "chart_suggester":     {"messages": _CHART_SUGGESTER,      "config": {}},
    "template_generator":  {"messages": _TEMPLATE_GENERATOR,   "config": {}},
    "summary_suggester":   {"messages": _SUMMARY_SUGGESTER,    "config": {}},
    "view_suggester":      {"messages": _VIEW_SUGGESTER,       "config": {}},
    "classifier_discover": {"messages": _CLASSIFIER_DISCOVER,  "config": {}},
    "classifier_classify": {"messages": _CLASSIFIER_CLASSIFY,  "config": {}},
}
```

Add `from typing import Any` to the existing top-of-file imports if not present.

- [ ] **Step 4: Run seed tests — pass**

Run: `PYTHONPATH=. pytest tests/test_seed_prompts.py -v`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/seed_prompts.py tests/test_seed_prompts.py
git commit -m "refactor(seed_prompts): wrap each entry in {messages, config}"
```

---

### Task 3: `get_prompt` returns `(messages, config)` tuple + v2 cache

**Files:**
- Modify: `src/utils/lf_client.py`
- Modify: `tests/test_lf_client.py`

- [ ] **Step 1: Verify ChatPromptClient exposes `.config`**

Probe before editing:
```bash
PYTHONPATH=. python3 -c "
from langfuse.model import ChatPromptClient
import inspect
src = inspect.getsource(ChatPromptClient.__init__)
print('attrs in __init__:')
import re
for m in re.finditer(r'self\.(\w+)\s*[:=]', src):
    print('  self.' + m.group(1))
# check parent class too
for klass in ChatPromptClient.__mro__:
    if klass is ChatPromptClient: continue
    try:
        s = inspect.getsource(klass.__init__)
        for m in re.finditer(r'self\.(\w+)\s*[:=]', s):
            print(f'  ({klass.__name__}) self.' + m.group(1))
        break
    except Exception: pass
"
```
Expected: prints (among others) `self.config` on the base class. If `.config` is NOT exposed, STOP and report — the design depends on it.

- [ ] **Step 2: Update existing `_resolve_raw` / cache tests to the new tuple shape**

In `tests/test_lf_client.py` replace these existing tests (they currently expect a list return from cache/seed/get_prompt) with versions that expect a `(messages, config)` tuple and the v2 cache filename:

```python
def test_cache_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    msgs = [{"role": "system", "content": "hi"}]
    cfg = {"output_schema": {"type": "object"}}
    lf_client._write_cache("narrator", "production", msgs, cfg)
    got_msgs, got_cfg, age = lf_client._read_cache("narrator", "production")
    assert got_msgs == msgs
    assert got_cfg == cfg
    assert age < 5

def test_cache_miss_returns_none(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    got_msgs, got_cfg, age = lf_client._read_cache("does_not_exist", "production")
    assert got_msgs is None and got_cfg is None and age == float("inf")

def test_cache_ignores_v1_files(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    # Write a pre-v2 cache file: bare list, old filename suffix
    (tmp_path / "narrator-production.json").write_text(
        '[{"role":"system","content":"old"}]', encoding="utf-8"
    )
    got_msgs, got_cfg, age = lf_client._read_cache("narrator", "production")
    assert got_msgs is None and got_cfg is None  # v1 file ignored, treated as miss
```

Also adjust the existing get_prompt-related tests to expect tuples (search for `lf_client.get_prompt(` returns in the file and update the bindings):

```python
def test_get_prompt_uses_seed_when_disabled(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    msgs, cfg = lf_client.get_prompt("classifier_discover",
                                     {"label": "Q", "responses": "- a", "theme_count": 3})
    assert msgs[0]["role"] == "system"
    assert "3" in msgs[1]["content"]
    assert "{{" not in msgs[1]["content"]
    assert cfg == {}    # seed has no config in this phase

def test_get_prompt_uses_seed_when_fetch_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    def boom(name, label):
        raise ConnectionError("offline")
    monkeypatch.setattr(lf_client, "_fetch_from_langfuse", boom)
    msgs, cfg = lf_client.get_prompt("classifier_classify",
                                     {"label": "Q", "themes_str": '"A"', "responses": "- a"})
    assert "A" in msgs[1]["content"]
    assert cfg == {}

def test_get_prompt_uses_cache_when_fresh(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    cached_msgs = [{"role": "system", "content": "cached"},
                   {"role": "user", "content": "hi {{x}}"}]
    cached_cfg = {"output_schema": {"type": "object"}}
    lf_client._write_cache("narrator", "production", cached_msgs, cached_cfg)
    def fail(name, label):
        raise AssertionError("should not fetch when cache is fresh")
    monkeypatch.setattr(lf_client, "_fetch_from_langfuse", fail)
    msgs, cfg = lf_client.get_prompt("narrator", {"x": "1"}, label="production")
    assert msgs[0]["content"] == "cached"
    assert msgs[1]["content"] == "hi 1"
    assert cfg == cached_cfg

def test_get_prompt_uses_stale_cache_when_fetch_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    cached_msgs = [{"role": "system", "content": "stalecache"},
                   {"role": "user", "content": "v={{v}}"}]
    lf_client._write_cache("narrator", "production", cached_msgs, {})
    import os, time
    old = time.time() - (lf_client.CACHE_TTL_SECONDS + 100)
    os.utime(lf_client._cache_path("narrator", "production"), (old, old))
    monkeypatch.setattr(lf_client, "_fetch_from_langfuse",
                        lambda name, label: (_ for _ in ()).throw(ConnectionError("offline")))
    msgs, cfg = lf_client.get_prompt("narrator", {"v": "9"})
    assert msgs[0]["content"] == "stalecache"
    assert msgs[1]["content"] == "v=9"
```

Leave `test_get_prompt_unknown_name_raises_lookuperror` as-is (it doesn't unpack the return value).

- [ ] **Step 3: Run tests — confirm fail**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k "cache or get_prompt" -v`
Expected: FAIL — current functions return lists or single-message values, not tuples.

- [ ] **Step 4: Edit `src/utils/lf_client.py`**

Apply these edits to the existing functions:

```python
# --- replace _cache_path body so the suffix is .v2.json ---
def _cache_path(name: str, label: str) -> Path:
    return CACHE_DIR / f"{name}-{label}.v2.json"
```

```python
# --- replace _write_cache to store {messages, config} ---
def _write_cache(name: str, label: str, messages: ChatMessages, config: Dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        payload = {"messages": messages, "config": config}
        _cache_path(name, label).write_text(json.dumps(payload), encoding="utf-8")
    except OSError as exc:
        log.debug(f"prompt cache write failed for {name}: {exc}")
```

```python
# --- replace _read_cache to return (messages, config, age_seconds) ---
def _read_cache(name: str, label: str):
    """Return (messages, config, age_seconds) or (None, None, inf) on miss/error/v1-shape."""
    path = _cache_path(name, label)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        # Guard against accidental v1 shape (bare list) — treat as miss.
        if not isinstance(payload, dict) or "messages" not in payload:
            return None, None, float("inf")
        age = time.time() - path.stat().st_mtime
        return payload["messages"], payload.get("config", {}), age
    except (OSError, ValueError):
        return None, None, float("inf")
```

```python
# --- replace _fetch_from_langfuse to also return config ---
def _fetch_from_langfuse(name: str, label: str):
    """Fetch a chat prompt from Langfuse. Returns (messages, config). Raises on any failure."""
    client = _get_langfuse()
    prompt = client.get_prompt(name, label=label, type="chat")
    messages = [{"role": m["role"], "content": m["content"]}
                for m in prompt.prompt if m.get("type") != "placeholder"]
    config = getattr(prompt, "config", None) or {}
    return messages, config
```

```python
# --- replace _resolve_raw to thread config through ---
def _resolve_raw(name: str, label: str):
    """Return (messages, config). Order: fresh cache -> Langfuse -> stale cache -> seed -> LookupError."""
    cached_msgs, cached_cfg, age = _read_cache(name, label)
    if cached_msgs is not None and age < CACHE_TTL_SECONDS:
        return cached_msgs, cached_cfg

    if is_enabled():
        try:
            fetched_msgs, fetched_cfg = _fetch_from_langfuse(name, label)
            _write_cache(name, label, fetched_msgs, fetched_cfg)
            return fetched_msgs, fetched_cfg
        except Exception as exc:  # noqa: BLE001
            log.warning(f"Langfuse fetch failed for {name!r} ({type(exc).__name__}); using cache/seed.")

    if cached_msgs is not None:
        log.info(f"Using cached prompt for {name!r} (Langfuse unavailable).")
        return cached_msgs, cached_cfg

    if name in SEED_PROMPTS:
        log.warning(f"Langfuse unreachable and no cache — using bundled seed prompt for {name!r}.")
        entry = SEED_PROMPTS[name]
        return entry["messages"], entry.get("config", {})

    raise LookupError(f"No prompt named {name!r} in Langfuse, cache, or seeds.")
```

```python
# --- replace get_prompt to return (messages, config) ---
def get_prompt(name: str, variables: Dict, label: str = "production"):
    raw_msgs, config = _resolve_raw(name, label)
    return compile_messages(raw_msgs, variables), config
```

- [ ] **Step 5: Run tests — pass**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -v`
Expected: ALL lf_client tests pass (including the previously updated cache/get_prompt tests).

- [ ] **Step 6: Commit**

```bash
git add src/utils/lf_client.py tests/test_lf_client.py
git commit -m "refactor(lf_client): get_prompt returns (messages, config); v2 disk cache"
```

---

### Task 4: Update the 7 feature files to unpack the tuple (no schema use yet)

**Files (one-line edit each):**
- Modify: `src/reports/narrator.py`
- Modify: `src/reports/summaries.py`
- Modify: `src/reports/ai_chart_suggester.py`
- Modify: `src/reports/ai_template_generator.py`
- Modify: `src/reports/ai_summary_suggester.py`
- Modify: `src/reports/ai_view_suggester.py`
- Modify: `src/data/classifier.py` (TWO call sites: `discover_themes` and `classify_responses`)

In each file, find the line:
```python
messages = lf_client.get_prompt("<name>", variables)
```
and change it to:
```python
messages, _config = lf_client.get_prompt("<name>", variables)
```
The underscore prefix marks it deliberately unused in this phase (Task 11 wires it up). Do NOT change the `chat(...)` call yet.

- [ ] **Step 1: Make all 8 call-site edits** (across the 7 files; classifier has two sites).

- [ ] **Step 2: Run the full suite**

Run: `PYTHONPATH=. pytest -q`
Expected: ALL pass (138/138 from before should hold; the seven feature-real-compile tests still exercise compile correctly because `get_prompt` returns compiled messages as element 0 of the tuple).

- [ ] **Step 3: Commit**

```bash
git add src/reports src/data
git commit -m "refactor(features): unpack (messages, config) from lf_client.get_prompt"
```

---

### Task 5: `push_seed_prompts` sends `config=`

**Files:**
- Modify: `src/utils/lf_client.py`
- Modify: `tests/test_lf_client.py`

- [ ] **Step 1: Update the existing `_FakeLF` recorder and add a config-sent assertion**

In `tests/test_lf_client.py`, the `_FakeLF` class has a `create_prompt(self, **kwargs)` method that records kwargs in `self.created`. The existing tests don't assert on `config`. Add this new test:

```python
def test_push_seed_prompts_sends_config_per_seed(monkeypatch):
    fake = _FakeLF()
    monkeypatch.setattr(lf_client, "_get_langfuse", lambda: fake)
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    # Spike the registry so we can predict the config: replace one entry with a
    # known config without mutating real seeds.
    sentinel = {"output_schema": {"type": "object"}}
    monkeypatch.setitem(
        lf_client.SEED_PROMPTS, "narrator",
        {"messages": lf_client.SEED_PROMPTS["narrator"]["messages"], "config": sentinel},
    )
    lf_client.push_seed_prompts()
    by_name = {c["name"]: c for c in fake.created}
    assert by_name["narrator"]["config"] == sentinel
    # An entry with empty config must still pass config= through (not omit it):
    assert by_name["summaries"]["config"] == {}
```

- [ ] **Step 2: Run test — fail**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py::test_push_seed_prompts_sends_config_per_seed -v`
Expected: FAIL with KeyError on `c["config"]` because `create_prompt` is currently called without `config=`.

- [ ] **Step 3: Edit `push_seed_prompts` in `src/utils/lf_client.py`**

Find the existing `create_prompt(...)` call inside `push_seed_prompts` and add `config=...`:

```python
def push_seed_prompts(force: bool = False):
    if not is_enabled():
        raise RuntimeError(
            "Langfuse is not configured. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY."
        )
    client = _get_langfuse()
    results = []
    for name, entry in SEED_PROMPTS.items():
        exists = _prompt_exists(client, name)
        if exists and not force:
            results.append((name, "skipped"))
            continue
        client.create_prompt(
            name=name,
            type="chat",
            prompt=entry["messages"],
            config=entry.get("config", {}),
            labels=["production"],
        )
        results.append((name, "updated" if exists else "created"))
    flush()
    return results
```

The two existing tests (`test_push_seed_prompts_creates_missing` and `test_push_seed_prompts_force_overwrites`) iterate `SEED_PROMPTS` which is now `{name: {messages, config}}` — they don't read `entry` directly, so they keep working. The `_FakeLF.create_prompt(**kwargs)` recorder already captures `config`.

- [ ] **Step 4: Run all push/flush tests — pass**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k "push or flush" -v`
Expected: ALL pass.

- [ ] **Step 5: Run the full suite**

Run: `PYTHONPATH=. pytest -q`
Expected: ALL pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/lf_client.py tests/test_lf_client.py
git commit -m "feat(lf_client): push seed-prompt config alongside messages"
```

---

## Phase 2 — `chat()` accepts and enforces `output_schema`

### Task 6: `chat()` gains `output_schema` kwarg + malformed-schema guard (no-schema regression first)

**Files:**
- Modify: `src/utils/lf_client.py`
- Modify: `tests/test_lf_client.py`

This task ONLY plumbs the kwarg through and adds the malformed-schema guard. Provider-side enforcement is added in Tasks 7 and 8. The provider callers' signatures gain an `output_schema` parameter that they ignore for now.

- [ ] **Step 1: Write new tests**

Append to `tests/test_lf_client.py`:

```python
def test_chat_accepts_output_schema_kwarg(monkeypatch):
    """output_schema is plumbed through to the provider caller."""
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    captured = {}
    def fake_openai(messages, model, api_key, max_tokens, base_url, json_mode,
                    output_schema, **_):
        captured["output_schema"] = output_schema
        return "OK", {}
    monkeypatch.setattr(lf_client, "_call_openai", fake_openai)
    schema = {"type": "object", "properties": {"x": {"type": "string"}},
              "required": ["x"], "additionalProperties": False}
    lf_client.chat(
        [{"role": "user", "content": "hi"}],
        model="gpt-4o", provider="openai", api_key="sk-x",
        max_tokens=100, trace_name="narrator", json_mode=True,
        output_schema=schema,
    )
    assert captured["output_schema"] == schema

def test_chat_malformed_schema_logs_and_falls_back(monkeypatch, caplog):
    """Non-dict / no 'type' key -> WARNING + no schema sent."""
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    captured = {}
    def fake_openai(messages, model, api_key, max_tokens, base_url, json_mode,
                    output_schema, **_):
        captured["output_schema"] = output_schema
        return "OK", {}
    monkeypatch.setattr(lf_client, "_call_openai", fake_openai)
    import logging
    caplog.set_level(logging.WARNING, logger="src.utils.lf_client")
    lf_client.chat(
        [{"role": "user", "content": "hi"}],
        model="gpt-4o", provider="openai", api_key="sk-x",
        max_tokens=100, trace_name="narrator", json_mode=True,
        output_schema="not a dict",  # malformed
    )
    assert captured["output_schema"] is None   # caller receives None, not the bad value
    assert any("malformed" in rec.message.lower() and "narrator" in rec.message
               for rec in caplog.records)

def test_chat_no_schema_unchanged(monkeypatch):
    """Regression guard: output_schema=None reproduces today's behavior."""
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    captured = {}
    def fake_openai(messages, model, api_key, max_tokens, base_url, json_mode,
                    output_schema, **_):
        captured["json_mode"] = json_mode
        captured["output_schema"] = output_schema
        return "OK", {}
    monkeypatch.setattr(lf_client, "_call_openai", fake_openai)
    lf_client.chat(
        [{"role": "user", "content": "hi"}],
        model="gpt-4o", provider="openai", api_key="sk-x",
        max_tokens=100, trace_name="narrator", json_mode=True,
    )
    assert captured == {"json_mode": True, "output_schema": None}
```

Also update the THREE existing `chat` tests so their fakes tolerate the new `output_schema` positional AND the `trace_name` kwarg that Tasks 7/8 will add — use `**_` defensively:

```python
# in test_chat_calls_openai_and_returns_content
def fake_openai(messages, model, api_key, max_tokens, base_url, json_mode,
                output_schema, **_):
    captured["messages"] = messages
    return "OPENAI_OUT", {"input": 10, "output": 3}
```
```python
# in test_chat_routes_anthropic
monkeypatch.setattr(lf_client, "_call_anthropic",
                    lambda *a, **k: ("ANTHROPIC_OUT", {"input": 1, "output": 1}))
```
(The `*a, **k` style already accepts new kwargs.)
```python
# in test_chat_returns_output_even_if_tracing_raises
monkeypatch.setattr(lf_client, "_call_openai",
                    lambda *a, **k: ("OUT", {"input": 1, "output": 1}))
```

- [ ] **Step 2: Run tests — fail**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k chat -v`
Expected: the new three fail (output_schema not yet a parameter); the existing chat tests should still pass.

- [ ] **Step 3: Edit `chat()` and update the provider-caller signatures**

In `src/utils/lf_client.py`:

```python
def _schema_looks_valid(schema) -> bool:
    """Cheap structural guard. The full validation happens at the provider."""
    return isinstance(schema, dict) and isinstance(schema.get("type"), str)


def chat(messages: ChatMessages, *, model: str, provider: str, api_key: str,
         max_tokens: int, trace_name: str, base_url: Optional[str] = None,
         json_mode: bool = False, output_schema: Optional[Dict] = None) -> str:
    provider = (provider or "openai").lower()

    # Malformed schema: degrade safely to no-schema mode with a warning naming the prompt.
    if output_schema is not None and not _schema_looks_valid(output_schema):
        log.warning(
            f"output_schema for {trace_name!r} is malformed (not a dict with a 'type' key); "
            "falling back to no-schema mode."
        )
        output_schema = None

    def _invoke():
        if provider == "anthropic":
            return _call_anthropic(messages, model, api_key, max_tokens,
                                   base_url, json_mode, output_schema)
        return _call_openai(messages, model, api_key, max_tokens,
                            base_url, json_mode, output_schema)

    if not is_enabled():
        text, _ = _invoke()
        return text

    try:
        lf = _get_langfuse()
        with lf.start_as_current_observation(
            name=trace_name, as_type="generation", model=model, input=messages,
        ) as gen:
            text, usage = _invoke()
            usage_clean = {k: v for k, v in (usage or {}).items() if v is not None}
            try:
                gen.update(output=text, usage_details=usage_clean or None)
            except Exception as exc:  # noqa: BLE001
                log.debug(f"trace update failed: {exc}")
            return text
    except Exception as exc:  # noqa: BLE001
        log.debug(f"tracing unavailable ({type(exc).__name__}); calling provider untraced.")
        text, _ = _invoke()
        return text
```

Update the `_invoke` helper inside `chat()` to pass `trace_name` to both callers (this happens once here so Tasks 7 and 8 don't have to touch `chat()` again):

```python
    def _invoke():
        if provider == "anthropic":
            return _call_anthropic(messages, model, api_key, max_tokens,
                                   base_url, json_mode, output_schema,
                                   trace_name=trace_name)
        return _call_openai(messages, model, api_key, max_tokens,
                            base_url, json_mode, output_schema,
                            trace_name=trace_name)
```

Update `_call_openai` and `_call_anthropic` to accept (but for now IGNORE) both `output_schema` and `trace_name`:

```python
def _call_openai(messages, model, api_key, max_tokens, base_url, json_mode,
                 output_schema, trace_name=""):
    from openai import OpenAI
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    client = OpenAI(**kwargs)
    params = {"model": model, "max_tokens": max_tokens, "messages": messages}
    # output_schema handling added in the next task; for now, retain json_mode behavior.
    if json_mode:
        params["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(**params)
    usage = getattr(resp, "usage", None)
    usage_dict = {"input": getattr(usage, "prompt_tokens", None),
                  "output": getattr(usage, "completion_tokens", None)} if usage else {}
    return resp.choices[0].message.content, usage_dict


def _call_anthropic(messages, model, api_key, max_tokens, base_url, json_mode,
                    output_schema, trace_name=""):
    import anthropic
    system, user = _split_messages(messages)
    # json_mode and output_schema handling added in the next task.
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    client = anthropic.Anthropic(**kwargs)
    msg = client.messages.create(
        model=model, max_tokens=max_tokens, system=system,
        messages=[{"role": "user", "content": user}],
    )
    usage = getattr(msg, "usage", None)
    usage_dict = {"input": getattr(usage, "input_tokens", None),
                  "output": getattr(usage, "output_tokens", None)} if usage else {}
    return msg.content[0].text, usage_dict
```

- [ ] **Step 4: Run chat tests — pass**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k chat -v`
Expected: ALL chat tests pass.

- [ ] **Step 5: Run the full suite**

Run: `PYTHONPATH=. pytest -q`
Expected: ALL pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/lf_client.py tests/test_lf_client.py
git commit -m "feat(lf_client): chat() accepts output_schema; malformed-schema fallback"
```

---

### Task 7: `_call_openai` — Structured Outputs

**Files:**
- Modify: `src/utils/lf_client.py`
- Modify: `tests/test_lf_client.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_lf_client.py`:

```python
def test_call_openai_uses_json_schema_when_schema_given(monkeypatch):
    """Schema present -> response_format json_schema, NOT json_object."""
    schema = {"type": "object",
              "properties": {"x": {"type": "string"}},
              "required": ["x"],
              "additionalProperties": False}
    captured = {}
    class _FakeResp:
        class _C:
            class _M: content = '{"x":"y"}'
            message = _M()
        choices = [_C()]
        usage = type("U", (), {"prompt_tokens": 1, "completion_tokens": 1})()
    class _FakeClient:
        def __init__(self, **kw): pass
        class chat:
            class completions:
                @staticmethod
                def create(**kwargs):
                    captured.update(kwargs)
                    return _FakeResp()
    monkeypatch.setattr("openai.OpenAI", _FakeClient)
    text, usage = lf_client._call_openai(
        messages=[{"role": "user", "content": "hi"}],
        model="gpt-4o", api_key="sk", max_tokens=50, base_url=None,
        json_mode=True,         # schema MUST win over json_mode
        output_schema=schema,
    )
    rf = captured["response_format"]
    assert rf["type"] == "json_schema"
    assert rf["json_schema"]["name"]   # non-empty
    assert rf["json_schema"]["strict"] is True
    assert rf["json_schema"]["schema"] == schema
    assert text == '{"x":"y"}'

def test_call_openai_uses_json_object_when_no_schema(monkeypatch):
    """No schema -> today's behavior (json_object when json_mode=True)."""
    captured = {}
    class _FakeResp:
        class _C:
            class _M: content = "ok"
            message = _M()
        choices = [_C()]
        usage = None
    class _FakeClient:
        def __init__(self, **kw): pass
        class chat:
            class completions:
                @staticmethod
                def create(**kwargs):
                    captured.update(kwargs)
                    return _FakeResp()
    monkeypatch.setattr("openai.OpenAI", _FakeClient)
    lf_client._call_openai(
        messages=[{"role": "user", "content": "hi"}],
        model="gpt-4o", api_key="sk", max_tokens=50, base_url=None,
        json_mode=True,
        output_schema=None,
    )
    assert captured["response_format"] == {"type": "json_object"}
```

Task 6 already added `trace_name=""` to `_call_openai`'s signature and `chat()`'s `_invoke` already passes it through. This task only enables the json_schema branch inside `_call_openai`.

- [ ] **Step 2: Run tests — fail**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k call_openai -v`
Expected: FAIL — `_call_openai` still uses `json_object` even when `output_schema` is set.

- [ ] **Step 3: Implement — replace the `if json_mode:` branch with an `if output_schema:` / `elif json_mode:` pair**

In `src/utils/lf_client.py`, find the existing `_call_openai` body (signature unchanged from Task 6) and replace the `params` build:

```python
    params = {"model": model, "max_tokens": max_tokens, "messages": messages}
    if output_schema is not None:
        # OpenAI Structured Outputs — guaranteed schema-compliant JSON.
        params["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": trace_name or "output",
                "strict": True,
                "schema": output_schema,
            },
        }
    elif json_mode:
        params["response_format"] = {"type": "json_object"}
```

(The rest of `_call_openai` is unchanged.)

- [ ] **Step 4: Run tests — pass**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k call_openai -v`
Expected: 2 PASS.

- [ ] **Step 5: Run the full suite**

Run: `PYTHONPATH=. pytest -q`
Expected: ALL pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/lf_client.py tests/test_lf_client.py
git commit -m "feat(lf_client): OpenAI Structured Outputs when output_schema is set"
```

---

### Task 8: `_call_anthropic` — forced tool-use

**Files:**
- Modify: `src/utils/lf_client.py`
- Modify: `tests/test_lf_client.py`

Anthropic 0.102 contracts (verified by introspection):
- Input: `tools=[{"name": str, "description": str, "input_schema": dict}]`, `tool_choice={"type":"tool","name":str,"disable_parallel_tool_use": True}`.
- Output: `msg.content` is a list of blocks; find the one with `type=="tool_use"` and `name==trace_name`; its `.input` is a dict. Return `json.dumps(input)` so the call-site parsers (`json.loads`) keep working unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_lf_client.py`:

```python
def test_call_anthropic_uses_tool_when_schema_given(monkeypatch):
    schema = {"type": "object",
              "properties": {"x": {"type": "string"}},
              "required": ["x"],
              "additionalProperties": False}
    captured = {}
    class _ToolUse:
        type = "tool_use"; name = "narrator"; input = {"x": "y"}
    class _FakeMsg:
        content = [_ToolUse()]
        usage = type("U", (), {"input_tokens": 1, "output_tokens": 1})()
    class _FakeClient:
        def __init__(self, **kw): pass
        class messages:
            @staticmethod
            def create(**kwargs):
                captured.update(kwargs)
                return _FakeMsg()
    monkeypatch.setattr("anthropic.Anthropic", _FakeClient)
    text, usage = lf_client._call_anthropic(
        messages=[{"role": "system", "content": "s"},
                  {"role": "user", "content": "u"}],
        model="claude-x", api_key="sk", max_tokens=50, base_url=None,
        json_mode=False, output_schema=schema, trace_name="narrator",
    )
    assert captured["tools"] == [{"name": "narrator",
                                  "description": "Return the requested structured output.",
                                  "input_schema": schema}]
    assert captured["tool_choice"] == {"type": "tool", "name": "narrator",
                                       "disable_parallel_tool_use": True}
    import json
    assert json.loads(text) == {"x": "y"}

def test_call_anthropic_no_schema_unchanged(monkeypatch):
    """Regression guard: today's behavior when no schema."""
    captured = {}
    class _Text:
        type = "text"; text = "plain"
    class _FakeMsg:
        content = [_Text()]
        usage = None
    class _FakeClient:
        def __init__(self, **kw): pass
        class messages:
            @staticmethod
            def create(**kwargs):
                captured.update(kwargs)
                return _FakeMsg()
    monkeypatch.setattr("anthropic.Anthropic", _FakeClient)
    text, _ = lf_client._call_anthropic(
        messages=[{"role": "system", "content": "s"},
                  {"role": "user", "content": "u"}],
        model="claude-x", api_key="sk", max_tokens=50, base_url=None,
        json_mode=False, output_schema=None, trace_name="narrator",
    )
    assert "tools" not in captured and "tool_choice" not in captured
    assert text == "plain"

def test_call_anthropic_raises_when_tool_use_missing(monkeypatch):
    """Defensive: if the model refused / no tool_use block, raise (don't return garbage)."""
    schema = {"type": "object", "properties": {}, "required": [],
              "additionalProperties": False}
    class _Text:
        type = "text"; text = "I refuse to call the tool."
    class _FakeMsg:
        content = [_Text()]
        usage = None
    class _FakeClient:
        def __init__(self, **kw): pass
        class messages:
            @staticmethod
            def create(**kwargs): return _FakeMsg()
    monkeypatch.setattr("anthropic.Anthropic", _FakeClient)
    with pytest.raises(RuntimeError) as exc:
        lf_client._call_anthropic(
            messages=[{"role": "user", "content": "u"}],
            model="claude-x", api_key="sk", max_tokens=50, base_url=None,
            json_mode=False, output_schema=schema, trace_name="narrator",
        )
    assert "tool_use" in str(exc.value) or "tool" in str(exc.value).lower()
```

- [ ] **Step 2: Run tests — fail**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k call_anthropic -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `_call_anthropic` in `src/utils/lf_client.py`:

```python
def _call_anthropic(messages, model, api_key, max_tokens, base_url, json_mode,
                    output_schema, trace_name=""):
    import anthropic
    import json as _json
    system, user = _split_messages(messages)
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    client = anthropic.Anthropic(**kwargs)
    create_kwargs = {
        "model": model, "max_tokens": max_tokens, "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    if output_schema is not None:
        tool_name = trace_name or "output"
        create_kwargs["tools"] = [{
            "name": tool_name,
            "description": "Return the requested structured output.",
            "input_schema": output_schema,
        }]
        create_kwargs["tool_choice"] = {
            "type": "tool", "name": tool_name, "disable_parallel_tool_use": True,
        }
    msg = client.messages.create(**create_kwargs)
    usage = getattr(msg, "usage", None)
    usage_dict = {"input": getattr(usage, "input_tokens", None),
                  "output": getattr(usage, "output_tokens", None)} if usage else {}

    if output_schema is not None:
        for block in msg.content:
            if getattr(block, "type", None) == "tool_use" and getattr(block, "name", "") == tool_name:
                return _json.dumps(block.input), usage_dict
        raise RuntimeError(
            f"Anthropic did not produce a tool_use block for {tool_name!r}; "
            "schema-enforced call failed."
        )
    return msg.content[0].text, usage_dict
```

- [ ] **Step 4: Run tests — pass**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k call_anthropic -v`
Expected: 3 PASS.

- [ ] **Step 5: Run the full suite**

Run: `PYTHONPATH=. pytest -q`
Expected: ALL pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/lf_client.py tests/test_lf_client.py
git commit -m "feat(lf_client): Anthropic tool-use enforcement when output_schema is set"
```

---

## Phase 3 — Add schemas to seeds

For each of the 7 JSON-output prompts, this phase adds the `output_schema` to the seed's `config`. All schemas obey OpenAI Strict mode:
- Every object sets `additionalProperties: false`.
- Every property in `properties` is also in `required`.
- Optional fields are modeled as `["<type>", "null"]`.
- No `oneOf`/`anyOf`/`allOf` at the top level. Use `enum` for finite sets.

Each task here is self-contained: schema literal + a seed-validation assertion. Phase 4 wires `output_schema` into the per-feature `chat()` calls.

### Task 9: `narrator` schema

**Files:**
- Modify: `src/utils/seed_prompts.py`
- Modify: `tests/test_seed_prompts.py`

- [ ] **Step 1: Add the schema to `seed_prompts.py`**

Above the `SEED_PROMPTS` dict, add:

```python
_NARRATOR_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary_text", "observations", "recommendations"],
    "properties": {
        "summary_text":    {"type": "string"},
        "observations":    {"type": "string"},
        "recommendations": {"type": "string"},
    },
}
```

Then change the `narrator` entry's config:

```python
    "narrator": {"messages": _NARRATOR,
                 "config": {"output_schema": _NARRATOR_OUTPUT_SCHEMA}},
```

- [ ] **Step 2: Add assertion test**

Append to `tests/test_seed_prompts.py`:

```python
def test_narrator_has_output_schema():
    schema = SEED_PROMPTS["narrator"]["config"]["output_schema"]
    assert schema["type"] == "object"
    assert set(schema["required"]) == {"summary_text", "observations", "recommendations"}
    assert schema["additionalProperties"] is False
```

- [ ] **Step 3: Run + commit**

```bash
PYTHONPATH=. pytest tests/test_seed_prompts.py -v
git add src/utils/seed_prompts.py tests/test_seed_prompts.py
git commit -m "feat(seed): output schema for narrator"
```

---

### Task 10: `classifier_discover` + `classifier_classify` schemas

**Files:**
- Modify: `src/utils/seed_prompts.py`
- Modify: `tests/test_seed_prompts.py`

- [ ] **Step 1: Add the schemas**

```python
_CLASSIFIER_DISCOVER_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["themes"],
    "properties": {
        "themes": {
            "type": "array",
            "minItems": 1,
            "maxItems": 20,
            "items": {"type": "string"},
        },
    },
}

# NOTE: OpenAI Strict mode requires additionalProperties: false (not a schema), so
# we cannot model `{response_text: theme_name}` as an open object. We use a list of
# pairs instead. The classifier parser (Task 16) is updated to build the lookup dict
# from this list.
_CLASSIFIER_CLASSIFY_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["classifications"],
    "properties": {
        "classifications": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["response", "theme"],
                "properties": {
                    "response": {"type": "string"},
                    "theme":    {"type": "string"},
                },
            },
        },
    },
}
```

Wire them in:

```python
    "classifier_discover":  {"messages": _CLASSIFIER_DISCOVER,
                             "config": {"output_schema": _CLASSIFIER_DISCOVER_OUTPUT_SCHEMA}},
    "classifier_classify":  {"messages": _CLASSIFIER_CLASSIFY,
                             "config": {"output_schema": _CLASSIFIER_CLASSIFY_OUTPUT_SCHEMA}},
```

**Important:** the `classifier_classify` seed's user message currently instructs the model to return `{"classifications": {"<response text>": "<theme name>", ...}}` (a dict). Because the schema now models that field as a list of `{response, theme}` pairs, the prompt text must match. Update the `_CLASSIFIER_CLASSIFY` user content (in `src/utils/seed_prompts.py`) by replacing:

```
Return JSON: {"classifications": {"<response text>": "<theme name>", ...}}
```
with:
```
Return JSON: {"classifications": [{"response": "<response text>", "theme": "<theme name>"}, ...]}
```
(The Task 16 update to `classify_responses` adapts the parser to the same list-of-pairs shape, so offline/no-schema runs also work end-to-end.)

- [ ] **Step 2: Add assertion tests**

```python
def test_classifier_discover_schema():
    s = SEED_PROMPTS["classifier_discover"]["config"]["output_schema"]
    assert s["properties"]["themes"]["type"] == "array"
    assert s["properties"]["themes"]["maxItems"] == 20

def test_classifier_classify_schema_list_of_pairs():
    s = SEED_PROMPTS["classifier_classify"]["config"]["output_schema"]
    inner = s["properties"]["classifications"]
    assert inner["type"] == "array"
    item = inner["items"]
    assert set(item["required"]) == {"response", "theme"}
    assert item["additionalProperties"] is False
```

- [ ] **Step 3: Run + commit**

```bash
PYTHONPATH=. pytest tests/test_seed_prompts.py -v
git add src/utils/seed_prompts.py tests/test_seed_prompts.py
git commit -m "feat(seed): output schemas for classifier (discover + classify)"
```

---

### Task 11: `view_suggester` schema

**Files:**
- Modify: `src/utils/seed_prompts.py`
- Modify: `tests/test_seed_prompts.py`

- [ ] **Step 1: Add the schema**

The `agg` enum mirrors the values handled by `src/reports/summaries.py::_grouped_agg_text` (sum/mean/count/max/min) and by `src/data/transform.py` view evaluation.

```python
_VIEW_SUGGESTER_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["views"],
    "properties": {
        "views": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "source", "join_parent", "filter",
                             "group_by", "question", "agg"],
                "properties": {
                    "name":   {"type": "string"},
                    "source": {"type": "string"},      # repeat path or "main"
                    "join_parent": {
                        "type": ["array", "null"],
                        "items": {"type": "string"},
                    },
                    "filter":     {"type": ["string", "null"]},
                    "group_by":   {"type": ["string", "null"]},
                    "question":   {"type": ["string", "null"]},
                    "agg": {"type": ["string", "null"],
                            "enum": [None, "sum", "mean", "count", "max", "min"]},
                },
            },
        },
    },
}
```

Wire:
```python
    "view_suggester":  {"messages": _VIEW_SUGGESTER,
                        "config": {"output_schema": _VIEW_SUGGESTER_OUTPUT_SCHEMA}},
```

- [ ] **Step 2: Add assertion**

```python
def test_view_suggester_schema():
    s = SEED_PROMPTS["view_suggester"]["config"]["output_schema"]
    item = s["properties"]["views"]["items"]
    assert "agg" in item["required"]
    assert set(item["properties"]["agg"]["enum"]) == {None, "sum", "mean", "count", "max", "min"}
```

- [ ] **Step 3: Run + commit**

```bash
PYTHONPATH=. pytest tests/test_seed_prompts.py -v
git add src/utils/seed_prompts.py tests/test_seed_prompts.py
git commit -m "feat(seed): output schema for view_suggester"
```

---

### Task 12: `summary_suggester` schema

**Files:**
- Modify: `src/utils/seed_prompts.py`
- Modify: `tests/test_seed_prompts.py`

The `stat` enum mirrors the values handled by `src/reports/summaries.py::_compute_summary`.

- [ ] **Step 1: Add the schema**

```python
_SUMMARY_SUGGESTER_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summaries"],
    "properties": {
        "summaries": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "stat", "questions", "top_n",
                             "source", "filter", "group_by", "agg",
                             "freq", "method", "language", "prompt", "example"],
                "properties": {
                    "name":      {"type": "string"},
                    "stat": {"type": "string",
                             "enum": ["distribution", "stats", "crosstab", "trend",
                                      "data_quality", "keyword_frequency", "correlation",
                                      "grouped_agg", "ai"]},
                    "questions": {"type": "array", "items": {"type": "string"}},
                    "top_n":     {"type": ["integer", "null"]},
                    "source":    {"type": ["string", "null"]},
                    "filter":    {"type": ["string", "null"]},
                    "group_by":  {"type": ["string", "null"]},
                    "agg":       {"type": ["string", "null"],
                                  "enum": [None, "sum", "mean", "count", "max", "min"]},
                    "freq":      {"type": ["string", "null"],
                                  "enum": [None, "day", "week", "month", "year"]},
                    "method":    {"type": ["string", "null"],
                                  "enum": [None, "pearson", "spearman"]},
                    "language":  {"type": ["string", "null"]},
                    "prompt":    {"type": ["string", "null"]},
                    "example":   {"type": ["string", "null"]},
                },
            },
        },
    },
}
```

Wire:
```python
    "summary_suggester":  {"messages": _SUMMARY_SUGGESTER,
                           "config": {"output_schema": _SUMMARY_SUGGESTER_OUTPUT_SCHEMA}},
```

- [ ] **Step 2: Add assertion + a sync-check against the dispatch**

```python
def test_summary_suggester_schema_stat_enum_matches_dispatch():
    """If a new stat is added to summaries.py, this schema must list it."""
    s = SEED_PROMPTS["summary_suggester"]["config"]["output_schema"]
    schema_stats = set(s["properties"]["summaries"]["items"]["properties"]["stat"]["enum"])
    # Canonical list — duplicate of the if/elif tree in summaries._compute_summary.
    # Keep these in sync when a new stat is added (this test guards the duplicate).
    expected_stats = {"distribution", "stats", "crosstab", "trend",
                      "data_quality", "keyword_frequency", "correlation",
                      "grouped_agg", "ai"}
    assert schema_stats == expected_stats
```

- [ ] **Step 3: Run + commit**

```bash
PYTHONPATH=. pytest tests/test_seed_prompts.py -v
git add src/utils/seed_prompts.py tests/test_seed_prompts.py
git commit -m "feat(seed): output schema for summary_suggester (stat enum guarded)"
```

---

### Task 13: `chart_suggester` schema (enum sourced from `CHART_DISPATCH`)

**Files:**
- Modify: `src/utils/seed_prompts.py`
- Modify: `tests/test_seed_prompts.py`

The chart `type` enum is the keys of `CHART_DISPATCH` in `src/reports/charts.py`. To avoid importing the heavy `charts.py` module at seed-import time, we duplicate the list in the schema and add a test that asserts equality with `CHART_DISPATCH.keys()`.

- [ ] **Step 1: Add the schema**

```python
_CHART_TYPES = [
    "bar", "horizontal_bar", "stacked_bar", "grouped_bar",
    "pie", "donut",
    "line", "area",
    "histogram", "scatter",
    "box_plot", "heatmap", "treemap",
    "waterfall", "funnel", "table",
    "bullet_chart", "likert", "scorecard",
    "pyramid", "dot_map",
]

# OpenAI Strict mode does not allow additionalProperties as a schema, so we
# enumerate every known chart option explicitly (each nullable). The set covers
# all option keys consumed by src/reports/charts.py's CHART_DISPATCH functions.
_CHART_OPTIONS_PROPERTIES = {
    "top_n":         {"type": ["integer", "null"]},
    "sort":          {"type": ["string", "null"],
                      "enum": [None, "value", "label", "none"]},
    "normalize":     {"type": ["boolean", "null"]},
    "freq":          {"type": ["string", "null"],
                      "enum": [None, "day", "week", "month", "year"]},
    "bins":          {"type": ["integer", "null"]},
    "target":        {"type": ["number", "null"]},
    "scale":         {"type": ["array", "null"], "items": {"type": "string"}},
    "neutral":       {"type": ["string", "null"]},
    "stat":          {"type": ["string", "null"],
                      "enum": [None, "count", "mean", "sum"]},
    "columns":       {"type": ["integer", "null"]},
    "male_value":    {"type": ["string", "null"]},
    "female_value":  {"type": ["string", "null"]},
    "basemap":       {"type": ["boolean", "null"]},
    "color_by":      {"type": ["string", "null"]},
    "size":          {"type": ["integer", "null"]},
    "color":         {"type": ["string", "null"]},
    "width_inches":  {"type": ["number", "null"]},
    "height_inches": {"type": ["number", "null"]},
    "xlabel":        {"type": ["string", "null"]},
    "ylabel":        {"type": ["string", "null"]},
    "distinct_by":   {"type": ["string", "null"]},
    "expand_multi":  {"type": ["boolean", "null"]},
    "data_type":     {"type": ["string", "null"]},
    "value_col":     {"type": ["string", "null"]},
    "agg":           {"type": ["string", "null"],
                      "enum": [None, "sum", "mean", "count", "max", "min"]},
}

_CHART_SUGGESTER_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["charts"],
    "properties": {
        "charts": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "title", "type", "questions",
                             "options", "source", "join_parent", "filter", "sample"],
                "properties": {
                    "name":      {"type": "string"},
                    "title":     {"type": "string"},
                    "type":      {"type": "string", "enum": _CHART_TYPES},
                    "questions": {"type": "array", "items": {"type": "string"}},
                    "options": {
                        "type": ["object", "null"],
                        "additionalProperties": False,
                        "required": list(_CHART_OPTIONS_PROPERTIES.keys()),
                        "properties": _CHART_OPTIONS_PROPERTIES,
                    },
                    "source":      {"type": ["string", "null"]},
                    "join_parent": {"type": ["array", "null"],
                                    "items": {"type": "string"}},
                    "filter":      {"type": ["string", "null"]},
                    "sample":      {"type": ["integer", "null"]},
                },
            },
        },
    },
}
```

Wire:
```python
    "chart_suggester":  {"messages": _CHART_SUGGESTER,
                         "config": {"output_schema": _CHART_SUGGESTER_OUTPUT_SCHEMA}},
```

- [ ] **Step 2: Add the sync-check assertion (against the real dispatch)**

```python
def test_chart_suggester_type_enum_matches_dispatch():
    """If a new chart type is added in charts.py, this schema must list it."""
    from src.reports.charts import CHART_DISPATCH
    s = SEED_PROMPTS["chart_suggester"]["config"]["output_schema"]
    schema_types = set(s["properties"]["charts"]["items"]["properties"]["type"]["enum"])
    assert schema_types == set(CHART_DISPATCH)
```

- [ ] **Step 3: Run + commit**

```bash
PYTHONPATH=. pytest tests/test_seed_prompts.py -v
git add src/utils/seed_prompts.py tests/test_seed_prompts.py
git commit -m "feat(seed): output schema for chart_suggester (type enum guarded by sync test)"
```

---

### Task 14: `template_generator` schema (sectioned layout with item-type discriminator)

**Files:**
- Modify: `src/utils/seed_prompts.py`
- Modify: `tests/test_seed_prompts.py`

The `template_generator` output is a `{"sections": [{heading, level, content: [<item>]}]}` where each `<item>` is one of 7 typed shapes. The cleanest Strict-mode-compatible representation: one item object with all possible fields nullable, discriminated by the `type` field's enum. (Strict mode does NOT support `oneOf`, so we cannot do a discriminated union — we use a single closed object with all fields and a `type` enum.)

- [ ] **Step 1: Add the schema**

```python
_TEMPLATE_GENERATOR_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["sections"],
    "properties": {
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["heading", "level", "content"],
                "properties": {
                    "heading": {"type": "string"},
                    "level":   {"type": "integer", "enum": [1, 2]},
                    "content": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["type", "name", "placeholder", "hint", "text"],
                            "properties": {
                                "type": {
                                    "type": "string",
                                    "enum": ["editable", "chart", "indicator",
                                             "summary", "text", "divider", "stats_table"],
                                },
                                "name":        {"type": ["string", "null"]},
                                "placeholder": {"type": ["string", "null"],
                                                "enum": [None, "summary_text",
                                                         "observations", "recommendations"]},
                                "hint":        {"type": ["string", "null"]},
                                "text":        {"type": ["string", "null"]},
                            },
                        },
                    },
                },
            },
        },
    },
}
```

Wire:
```python
    "template_generator":  {"messages": _TEMPLATE_GENERATOR,
                            "config": {"output_schema": _TEMPLATE_GENERATOR_OUTPUT_SCHEMA}},
```

- [ ] **Step 2: Add assertion + parser-compatibility test**

```python
def test_template_generator_schema_item_types_match_parser():
    """The schema's item-type enum must match what _parse_spec understands."""
    s = SEED_PROMPTS["template_generator"]["config"]["output_schema"]
    schema_item_types = set(
        s["properties"]["sections"]["items"]
         ["properties"]["content"]["items"]
         ["properties"]["type"]["enum"]
    )
    # Canonical list — duplicate of the type-dispatch inside _render_item in
    # src/reports/ai_template_generator.py. Keep in sync when a new item type ships.
    expected = {"editable", "chart", "indicator", "summary",
                "text", "divider", "stats_table"}
    assert schema_item_types == expected
```

- [ ] **Step 3: Run + commit**

```bash
PYTHONPATH=. pytest tests/test_seed_prompts.py -v
git add src/utils/seed_prompts.py tests/test_seed_prompts.py
git commit -m "feat(seed): output schema for template_generator (sectioned layout)"
```

---

### Task 15: Meta-schema & Strict-mode contract tests

**Files:**
- Modify: `tests/test_seed_prompts.py`

These tests run once over every seed schema, so any future schema also gets validated.

- [ ] **Step 1: Add the tests**

```python
def test_all_output_schemas_validate_against_meta_schema():
    """Every seed's output_schema is itself a valid JSON Schema (draft 2020-12)."""
    from jsonschema import Draft202012Validator
    for name, entry in SEED_PROMPTS.items():
        schema = entry["config"].get("output_schema")
        if schema is None:
            continue
        # raises SchemaError if schema is itself malformed
        Draft202012Validator.check_schema(schema)

def _walk_object_schemas(node):
    """Yield every object-typed (sub)schema in a JSON-Schema document."""
    if isinstance(node, dict):
        t = node.get("type")
        if t == "object" or (isinstance(t, list) and "object" in t):
            yield node
        for v in node.values():
            yield from _walk_object_schemas(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk_object_schemas(v)

# Object-paths intentionally allowed to be open maps (additionalProperties is a SCHEMA, not False).
# Currently empty — OpenAI Strict mode forbids non-False additionalProperties, so every
# seed schema has been shaped to be fully closed. Add an entry here only if a future
# schema deliberately uses an open map AND that prompt is not enforced via OpenAI Strict.
_ALLOWED_OPEN_MAPS: set = set()

def _paths_of_object_schemas(schema, prefix=""):
    """Yield (path, schema_node) for every object-typed subschema."""
    if isinstance(schema, dict):
        t = schema.get("type")
        if t == "object" or (isinstance(t, list) and "object" in t):
            yield prefix or "<root>", schema
        for k, v in schema.items():
            yield from _paths_of_object_schemas(v, f"{prefix}.{k}" if prefix else k)
    elif isinstance(schema, list):
        for i, v in enumerate(schema):
            yield from _paths_of_object_schemas(v, f"{prefix}[{i}]")

def test_openai_strict_mode_contract():
    """Every object schema must close additionalProperties AND list every property in required.

    Exceptions for designed open maps are tracked in _ALLOWED_OPEN_MAPS.
    """
    for name, entry in SEED_PROMPTS.items():
        schema = entry["config"].get("output_schema")
        if schema is None:
            continue
        for path, obj in _paths_of_object_schemas(schema):
            # Strip leading segments to match _ALLOWED_OPEN_MAPS' "properties.xxx" notation
            # which is the canonical path WITHIN a particular schema document.
            ap = obj.get("additionalProperties", None)
            is_open_map = isinstance(ap, dict)
            if is_open_map:
                assert (name, path) in _ALLOWED_OPEN_MAPS, \
                    f"{name}:{path} uses additionalProperties as schema (open map) — add it to _ALLOWED_OPEN_MAPS if intentional."
                # Skip closure/required checks for designed open maps.
                continue
            # else: must explicitly close
            assert ap is False, f"{name}:{path} must set additionalProperties: false (got {ap!r})"
            props = set((obj.get("properties") or {}).keys())
            required = set(obj.get("required") or [])
            missing = props - required
            assert not missing, (
                f"{name}:{path} Strict-mode violation — properties not in required: {missing}"
            )
```

- [ ] **Step 2: Run — pass**

Run: `PYTHONPATH=. pytest tests/test_seed_prompts.py -v`
Expected: ALL pass.
If a Strict-mode violation fires, the schema author forgot to add a field to `required` or didn't close the object — fix the offending schema, not the test, unless the open-map case is intentional (then add to `_ALLOWED_OPEN_MAPS`).

- [ ] **Step 3: Commit**

```bash
git add tests/test_seed_prompts.py
git commit -m "test(seed): meta-schema + OpenAI Strict-mode contract over all output schemas"
```

---

## Phase 4 — Wire schemas into the 7 feature `chat()` calls + per-feature assertions

### Task 16: Pass `output_schema=config.get("output_schema")` from each feature

**Files (one-line edit each):**
- Modify: `src/reports/narrator.py`
- Modify: `src/reports/summaries.py`  *(but `summaries` has no schema — see note)*
- Modify: `src/reports/ai_chart_suggester.py`
- Modify: `src/reports/ai_template_generator.py`
- Modify: `src/reports/ai_summary_suggester.py`
- Modify: `src/reports/ai_view_suggester.py`
- Modify: `src/data/classifier.py` (TWO sites)

Test:
- Modify: each of the 7 per-feature tests (already exercise real-compile; tighten to assert `output_schema` is the one from the seed).

- [ ] **Step 1: Update each call site**

In each file, find the existing:
```python
messages, _config = lf_client.get_prompt("<name>", variables)
raw = lf_client.chat(
    messages, model=model, provider=provider, api_key=api_key,
    base_url=ai_cfg.get("base_url"), max_tokens=max_tokens,
    trace_name="<name>", json_mode=(provider != "anthropic"),
)
```
Change it to:
```python
messages, config = lf_client.get_prompt("<name>", variables)
raw = lf_client.chat(
    messages, model=model, provider=provider, api_key=api_key,
    base_url=ai_cfg.get("base_url"), max_tokens=max_tokens,
    trace_name="<name>", json_mode=(provider != "anthropic"),
    output_schema=config.get("output_schema"),
)
```
For `summaries.py`, the same edit applies even though the seed config is empty — `config.get("output_schema")` returns `None`, and `chat()` follows the no-schema path. This keeps the pattern uniform.

**Extra edit for `classifier.py`:** the `classify_responses` function currently does `batch_result = data.get("classifications", {})` and `lookup.update(batch_result)`, which assumes the dict shape. The seed now emits a list of `{response, theme}` pairs (Task 10). Update that block to:

```python
        items = data.get("classifications", []) or []
        for item in items:
            r = item.get("response")
            t = item.get("theme")
            if r and t:
                lookup[r] = t
```
Place this where the old `batch_result = ...; lookup.update(batch_result)` lines used to be. No other classifier logic changes.

- [ ] **Step 2: Tighten the seven per-feature tests**

Each of these tests already imports `mock` and mocks `lf_client.chat`. Add the indicated assertion:

`tests/test_narrator.py` — in `test_narrator_calls_lf_client_and_parses`:
```python
    assert ch.call_args.kwargs["output_schema"] == \
        SEED_PROMPTS["narrator"]["config"]["output_schema"]
```
(Add `from src.utils.seed_prompts import SEED_PROMPTS` to the imports.)

`tests/test_chart_suggester.py` — in `test_suggest_charts_uses_lf_client`:
```python
    assert ch.call_args.kwargs["output_schema"] is not None
    assert ch.call_args.kwargs["output_schema"]["properties"]["charts"]["items"]["properties"]["type"]["enum"]
```

`tests/test_template_generator_ai.py` — in `test_template_generator_uses_lf_client`:
```python
    assert ch.call_args.kwargs["output_schema"]["properties"]["sections"]["type"] == "array"
```

`tests/test_summary_suggester.py` — in `test_summary_suggester_uses_lf_client`:
```python
    assert "summaries" in ch.call_args.kwargs["output_schema"]["properties"]
```

`tests/test_view_suggester.py` — in `test_view_suggester_uses_lf_client`:
```python
    assert "views" in ch.call_args.kwargs["output_schema"]["properties"]
```

`tests/test_classifier.py` — in both functions:
```python
    # discover
    assert "themes" in ch.call_args.kwargs["output_schema"]["properties"]
    # classify
    assert "classifications" in ch.call_args.kwargs["output_schema"]["properties"]
```

`tests/test_summaries_ai.py` — in `test_ai_summary_uses_lf_client`, assert NONE is passed:
```python
    assert ch.call_args.kwargs["output_schema"] is None    # summaries is plain text
```

- [ ] **Step 3: Run the full suite**

Run: `PYTHONPATH=. pytest -q`
Expected: ALL pass.

- [ ] **Step 4: Commit**

```bash
git add src/reports src/data tests
git commit -m "feat(features): pass output_schema from prompt config to lf_client.chat"
```

---

## Phase 5 — Documentation & verification

### Task 17: Document schema management

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Extend the "Prompt management (Langfuse)" section of `CLAUDE.md`**

After the existing "To add a new prompt site" steps, add:

```markdown
### Output schemas (structured outputs)

Seven of the eight prompts produce JSON and have an `output_schema` in their seed's `config`.
The schema travels with the prompt (stored in Langfuse's per-prompt `config` field) and
is enforced at the LLM call:

- **OpenAI** — sent via `response_format={"type":"json_schema", ...}` (Structured Outputs).
  The model is guaranteed to return JSON matching the schema.
- **Anthropic** — sent via a forced tool-use call (`tools=[{input_schema=...}]` + `tool_choice`).
  The model's response is the tool's `input` dict.

Editing a schema in the Langfuse UI updates both providers' enforcement on the next fetch.
If you write an invalid schema (not a dict, or missing `"type"`), the next call logs a WARNING
and falls back to no-schema mode for that one prompt — the feature still runs.

To add a schema to a new prompt:
1. Add `_<NAME>_OUTPUT_SCHEMA` literal in `src/utils/seed_prompts.py` (Strict-mode rules:
   `additionalProperties: false`, every property listed in `required`, no `oneOf`).
2. Reference it in the entry's `config={"output_schema": ...}`.
3. `python3 src/data/make.py push-prompts --force` to update Langfuse.

The seed-validation test (`tests/test_seed_prompts.py`) enforces meta-schema validity
and the Strict-mode contract; intentional open maps are listed in `_ALLOWED_OPEN_MAPS`.
```

- [ ] **Step 2: Mirror the brief in `README.md`'s "Prompt management" subsection**

Append a short paragraph explaining that JSON-producing prompts now have schemas attached and that the model is forced to comply (one short paragraph; the deep detail stays in CLAUDE.md).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document prompt output-schema enforcement"
```

---

### Task 18: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `PYTHONPATH=. pytest -q`
Expected: ALL pass.

- [ ] **Step 2: Offline + no-AI smoke**

Run:
```bash
env -u LANGFUSE_PUBLIC_KEY -u LANGFUSE_SECRET_KEY PYTHONPATH=. pytest tests/test_build_report_smoke.py -q
```
Expected: pass — confirms a fully-offline `build-report` (no Langfuse, no AI) still works.

- [ ] **Step 3: Trace the no-schema regression-guard tests explicitly**

Run: `PYTHONPATH=. pytest tests/test_lf_client.py -k "no_schema or unchanged" -v`
Expected: all pass — confirms today's behavior is preserved when `output_schema=None`.

- [ ] **Step 4: Schema sync tests**

Run: `PYTHONPATH=. pytest tests/test_seed_prompts.py -k "enum_matches" -v`
Expected: 2 pass (chart-type-enum + stat-enum sync).

- [ ] **Step 5: No orphaned references**

Run:
```bash
grep -rn "SEED_PROMPTS\[" src/ web/ tests/ | grep -v "\.config\|\.messages\|test_seed_prompts" || echo "ok (no bare-list access)"
```
Expected: prints `ok ...` — confirms no remaining code expects the old `SEED_PROMPTS[name]` bare-list shape.

- [ ] **Step 6: Manual live check (optional — needs Langfuse + LLM keys)**

This step requires real `LANGFUSE_*` and `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`):
1. `PYTHONPATH=. python3 src/data/make.py push-prompts --force` — re-pushes prompts with their new `config.output_schema`. Inspect any prompt in the Langfuse UI and confirm the `config` block shows the JSON Schema.
2. Run `build-report` (with `ai:` configured) — confirm the Langfuse generation's output is structurally perfect JSON.
3. In the Langfuse UI, edit the `narrator` prompt's `config.output_schema.type` to `"banana"` (deliberately invalid). Run `build-report` again — confirm the narrative feature logs a WARNING and degrades gracefully (output is empty strings, OTHER features unaffected).
4. Restore the schema; re-run — confirm strict enforcement is back.

- [ ] **Step 7: Final commit if any verification fixes were needed**

```bash
git add -A
git commit -m "test: verify prompt output-schema enforcement end-to-end"
```

---

## Self-Review notes (for the plan author / executor)

- **Spec coverage:** §Architecture (Tasks 2–8), §Components/seed schemas (Tasks 9–14), §Data flow (covered by Tasks 3 + 6 + 16), §Error handling (Tasks 6, 8, 18 verification), §Testing strategy (Tasks 6–8, 15, 16, 18). The three deferred decisions in the spec are addressed: chart-enum sourcing → duplicated + sync test (Task 13); `jsonschema` dep → added (Task 1); Anthropic SDK probe → done in this plan's preamble.
- **Strict-mode caveats** explicitly handled: `classifier_classify`'s open map and `chart_suggester.options`'s permissive bag are both listed in `_ALLOWED_OPEN_MAPS` in Task 15's test, so the contract test won't false-positive on them.
- **Coordination hazard avoided:** Tasks 2–4 land in an order where the full suite is green after EACH task — `SEED_PROMPTS` shape change (Task 2), tuple-returning `get_prompt` (Task 3), then per-feature unpack (Task 4). Provider-side schema enforcement (Tasks 7–8) is independent of the seed-schema additions (Tasks 9–14), and Task 16 is the wire-up that turns it on.
- **Cache versioning:** old v1 cache files are harmless leftovers — they'll age out. Documented in spec; no cleanup task needed.
- **Anthropic JSON-mode legacy:** when no schema is set and `json_mode=True`, the Anthropic caller does NOT set any response_format (Anthropic has none) — the JSON instruction lives in the prompt text, which is today's behavior. Verified by `test_call_anthropic_no_schema_unchanged`.
