"""Prompt override resolution for the five AI features.

Admins/developers customize prompts via the `prompts:` block in config.yml:

    prompts:
      narrator:
        system: |        # optional — replaces the in-code system prompt
          You are ...
        extra: |         # optional — appended to the user prompt as ADDITIONAL GUIDANCE
          Always disaggregate by gender.

Feature keys: narrator, summaries, chart_suggester, template_generator, classifier.

Two functions, two fields per feature. Callers pass `cfg.get("prompts", {})` (or {}).
"""
from typing import Dict, Optional


def system_prompt(feature: str, prompts_cfg: Optional[Dict], default: str) -> str:
    """Return the configured system prompt for `feature`, or `default` if none.

    Warning to admins: when overriding a system prompt that enforces a JSON
    output contract (narrator, chart_suggester, template_generator), keep the
    JSON-format instruction — the parser silently falls back to empty output
    if it can't parse the response.
    """
    override = ((prompts_cfg or {}).get(feature) or {}).get("system")
    if isinstance(override, str) and override.strip():
        return override.strip()
    return default


def extra_instructions(feature: str, prompts_cfg: Optional[Dict]) -> Optional[str]:
    """Return admin-supplied extra guidance for `feature`, or None.

    Callers should append this to the user prompt under an ADDITIONAL GUIDANCE
    header so it's clearly separated from the data-shaped scaffolding.
    """
    override = ((prompts_cfg or {}).get(feature) or {}).get("extra")
    if isinstance(override, str) and override.strip():
        return override.strip()
    return None


def append_extra(user_prompt: str, feature: str, prompts_cfg: Optional[Dict]) -> str:
    """Convenience: append ADDITIONAL GUIDANCE block to user_prompt if configured."""
    extra = extra_instructions(feature, prompts_cfg)
    if not extra:
        return user_prompt
    return f"{user_prompt}\n\nADDITIONAL GUIDANCE (apply on top of the instructions above):\n{extra}"
