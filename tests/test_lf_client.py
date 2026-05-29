import os
import time

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
    (tmp_path / "narrator-production.json").write_text(
        '[{"role":"system","content":"old"}]', encoding="utf-8"
    )
    got_msgs, got_cfg, age = lf_client._read_cache("narrator", "production")
    assert got_msgs is None and got_cfg is None


def test_is_enabled_false_without_keys(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    assert lf_client.is_enabled() is False


def test_get_prompt_uses_seed_when_disabled(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    msgs, cfg = lf_client.get_prompt("classifier_discover",
                                     {"label": "Q", "responses": "- a", "theme_count": 3})
    assert msgs[0]["role"] == "system"
    assert "3" in msgs[1]["content"]
    assert "{{" not in msgs[1]["content"]
    assert cfg == {}


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


def test_get_prompt_unknown_name_raises_lookuperror(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    with pytest.raises(LookupError):
        lf_client.get_prompt("not_a_real_prompt", {})


def test_chat_calls_openai_and_returns_content(monkeypatch):
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    captured = {}
    def fake_openai(messages, model, api_key, max_tokens, base_url, json_mode,
                    output_schema, **_):
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
    fake = _FakeLF(existing=["narrator"])
    monkeypatch.setattr(lf_client, "_get_langfuse", lambda: fake)
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    results = lf_client.push_seed_prompts()
    actions = dict(results)
    assert actions["narrator"] == "skipped"
    assert actions["classifier_discover"] == "created"
    assert len([a for a in actions.values() if a == "created"]) == 7
    assert fake.flushed  # flush() must run so created prompts are ingested


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


def test_push_seed_prompts_sends_config_per_seed(monkeypatch):
    fake = _FakeLF()
    monkeypatch.setattr(lf_client, "_get_langfuse", lambda: fake)
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    sentinel = {"output_schema": {"type": "object"}}
    monkeypatch.setitem(
        lf_client.SEED_PROMPTS, "narrator",
        {"messages": lf_client.SEED_PROMPTS["narrator"]["messages"], "config": sentinel},
    )
    lf_client.push_seed_prompts()
    by_name = {c["name"]: c for c in fake.created}
    assert by_name["narrator"]["config"] == sentinel
    assert by_name["summaries"]["config"] == {}


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
        def start_as_current_observation(self, *, name, as_type):
            events.append(("obs", name, as_type)); return _Span()
        def flush(self):
            events.append("flush")
    monkeypatch.setattr(lf_client, "is_enabled", lambda: True)
    monkeypatch.setattr(lf_client, "_get_langfuse", lambda: _LF())
    with lf_client.command_trace("download"):
        pass
    assert ("obs", "download", "span") in events
    assert "exit" in events and "flush" in events


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


# ── _get_langfuse host resolution: LANGFUSE_HOST > LANGFUSE_BASE_URL > default ──

def _patch_langfuse_constructor(monkeypatch):
    """Replace langfuse.Langfuse with a recorder; return the dict it writes to."""
    import langfuse
    captured = {}
    class _Fake:
        def __init__(self, **kwargs):
            captured.update(kwargs)
    monkeypatch.setattr(langfuse, "Langfuse", _Fake)
    # ensure singleton starts empty AND is restored on teardown
    monkeypatch.setattr(lf_client, "_LF", None)
    return captured


def test_get_langfuse_uses_LANGFUSE_HOST_when_set(monkeypatch):
    captured = _patch_langfuse_constructor(monkeypatch)
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk")
    monkeypatch.setenv("LANGFUSE_HOST", "https://primary.example")
    monkeypatch.setenv("LANGFUSE_BASE_URL", "https://should-be-ignored.example")
    lf_client._get_langfuse()
    assert captured["host"] == "https://primary.example"


def test_get_langfuse_falls_back_to_LANGFUSE_BASE_URL(monkeypatch):
    captured = _patch_langfuse_constructor(monkeypatch)
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk")
    monkeypatch.delenv("LANGFUSE_HOST", raising=False)
    monkeypatch.setenv("LANGFUSE_BASE_URL", "https://alias.example")
    lf_client._get_langfuse()
    assert captured["host"] == "https://alias.example"


def test_get_langfuse_defaults_to_cloud_langfuse(monkeypatch):
    captured = _patch_langfuse_constructor(monkeypatch)
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk")
    monkeypatch.delenv("LANGFUSE_HOST", raising=False)
    monkeypatch.delenv("LANGFUSE_BASE_URL", raising=False)
    lf_client._get_langfuse()
    assert captured["host"] == "https://cloud.langfuse.com"


# ── Task 6: chat() accepts output_schema + malformed-schema guard ──

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
        output_schema="not a dict",
    )
    assert captured["output_schema"] is None
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


# ── Task 7: _call_openai uses Structured Outputs when schema is set ──

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
        trace_name="narrator",
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
        trace_name="narrator",
    )
    assert captured["response_format"] == {"type": "json_object"}


# ── Task 8: _call_anthropic uses forced tool-use when schema is set ──

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
