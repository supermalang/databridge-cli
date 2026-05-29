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
import contextlib
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Dict, List, Optional

from src.utils.seed_prompts import SEED_PROMPTS

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


CACHE_DIR = Path(os.path.expanduser("~/.cache/databridge/prompts"))
CACHE_TTL_SECONDS = 3600


def _cache_path(name: str, label: str) -> Path:
    return CACHE_DIR / f"{name}-{label}.v2.json"


def _write_cache(name: str, label: str, messages: ChatMessages, config: Dict) -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        payload = {"messages": messages, "config": config}
        _cache_path(name, label).write_text(json.dumps(payload), encoding="utf-8")
    except OSError as exc:
        log.debug(f"prompt cache write failed for {name}: {exc}")


def _read_cache(name: str, label: str):
    """Return (messages, config, age_seconds) or (None, None, inf) on miss/error/v1-shape."""
    path = _cache_path(name, label)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or "messages" not in payload:
            return None, None, float("inf")
        age = time.time() - path.stat().st_mtime
        return payload["messages"], payload.get("config", {}), age
    except (OSError, ValueError):
        return None, None, float("inf")


_LF = None  # cached Langfuse SDK instance


def is_enabled() -> bool:
    return bool(os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY"))


def _get_langfuse():
    global _LF
    if _LF is None:
        from langfuse import Langfuse
        # Host can be configured via LANGFUSE_HOST (canonical) or LANGFUSE_BASE_URL
        # (alias — matches the SDK's `base_url` kwarg). LANGFUSE_HOST wins if both set.
        host = (os.environ.get("LANGFUSE_HOST")
                or os.environ.get("LANGFUSE_BASE_URL")
                or "https://cloud.langfuse.com")
        _LF = Langfuse(
            public_key=os.environ["LANGFUSE_PUBLIC_KEY"],
            secret_key=os.environ["LANGFUSE_SECRET_KEY"],
            host=host,
        )
    return _LF


def _fetch_from_langfuse(name: str, label: str):
    """Fetch a chat prompt from Langfuse. Returns (messages, config)."""
    client = _get_langfuse()
    prompt = client.get_prompt(name, label=label, type="chat")
    messages = [{"role": m["role"], "content": m["content"]}
                for m in prompt.prompt if m.get("type") != "placeholder"]
    config = getattr(prompt, "config", None) or {}
    return messages, config


def get_prompt(name: str, variables: Dict, label: str = "production"):
    raw_msgs, config = _resolve_raw(name, label)
    return compile_messages(raw_msgs, variables), config


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
    # json_mode intentionally unused: Anthropic has no response_format; the prompt enforces JSON.
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

    # Traced path — tracing failures must never break the call. (langfuse v4 API)
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


def _prompt_exists(client, name: str) -> bool:
    try:
        client.get_prompt(name, label="production", type="chat")
        return True
    except Exception:
        # Treat any fetch failure as "not found". Auth/network problems will then
        # resurface on create_prompt, which is acceptable for a bootstrap command.
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


@contextlib.contextmanager
def command_trace(name: str):
    """Group all chat() generations in this block under one parent trace.

    No-op (and never raises) when Langfuse is disabled or the SDK call fails.
    Always flushes on exit.
    """
    if not is_enabled():
        yield
        return

    # Open the span in a try that does NOT wrap the yield — otherwise a body
    # exception thrown back into this generator would re-enter the except and
    # yield a second time ("generator didn't stop" RuntimeError).
    span_cm = None
    try:
        span_cm = _get_langfuse().start_as_current_observation(name=name, as_type="span")
    except Exception as exc:  # noqa: BLE001
        log.debug(f"command_trace span unavailable ({type(exc).__name__}); continuing untraced.")
        span_cm = None

    try:
        if span_cm is not None:
            with span_cm:
                yield
        else:
            yield
    finally:
        flush()
