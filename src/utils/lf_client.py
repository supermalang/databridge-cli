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
