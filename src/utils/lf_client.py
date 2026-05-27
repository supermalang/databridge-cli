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
import json
import logging
import os
import re
import time
from pathlib import Path
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


from src.utils.seed_prompts import SEED_PROMPTS

_LF = None  # cached Langfuse SDK instance


def is_enabled() -> bool:
    return bool(os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY"))


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


def _fetch_from_langfuse(name: str, label: str) -> ChatMessages:
    """Fetch a chat prompt's raw messages from Langfuse. Raises on any failure."""
    client = _get_langfuse()
    prompt = client.get_prompt(name, label=label, type="chat")
    return [{"role": m["role"], "content": m["content"]}
            for m in prompt.prompt if m.get("type") != "placeholder"]


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
        except Exception as exc:  # noqa: BLE001
            log.warning(f"Langfuse fetch failed for {name!r} ({type(exc).__name__}); using cache/seed.")

    if cached is not None:
        log.info(f"Using cached prompt for {name!r} (Langfuse unavailable).")
        return cached

    if name in SEED_PROMPTS:
        log.warning(f"Langfuse unreachable and no cache — using bundled seed prompt for {name!r}.")
        return SEED_PROMPTS[name]

    raise LookupError(f"No prompt named {name!r} in Langfuse, cache, or seeds.")
