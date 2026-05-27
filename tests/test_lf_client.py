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


import time


def test_cache_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    msgs = [{"role": "system", "content": "hi"}]
    lf_client._write_cache("narrator", "production", msgs)
    got, age = lf_client._read_cache("narrator", "production")
    assert got == msgs
    assert age < 5


def test_cache_miss_returns_none(tmp_path, monkeypatch):
    monkeypatch.setattr(lf_client, "CACHE_DIR", tmp_path)
    got, age = lf_client._read_cache("does_not_exist", "production")
    assert got is None and age == float("inf")


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
    assert "3" in msgs[1]["content"]
    assert "{{" not in msgs[1]["content"]


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
