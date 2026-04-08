"""
classifier.py — LLM-powered text classification for qualitative survey responses.

For each qualitative question with classify.enabled: true in config.yml,
this module:
  1. Discovers themes from a sample of unique responses (if not already defined)
  2. Classifies every row into one of those themes
  3. Returns a new Series with the theme labels

The classified column is written back to the processed data file as
{export_label}_cluster, making it suitable for bar charts and indicators.

Pre-defined codebook:
  If classify.themes is already set in config.yml, theme discovery is skipped
  entirely and the LLM goes straight to classification. This is the recommended
  approach when a validated codebook already exists (e.g., from a prior run or
  designed by the M&E team). Example config:

    questions:
      - kobo_key: satisfaction_text
        classify:
          enabled: true
          themes: ["Very satisfied", "Satisfied", "Neutral", "Dissatisfied", "Other"]
          # theme_count is ignored when themes are pre-defined
"""
import json
import logging
import re
from typing import Dict, List, Optional

import pandas as pd

log = logging.getLogger(__name__)

BATCH_SIZE = 50   # unique responses per LLM call
SAMPLE_SIZE = 100  # max unique responses sent for theme discovery


def discover_themes(
    series: pd.Series,
    label: str,
    theme_count: int,
    ai_cfg: Dict,
) -> List[str]:
    """Sample unique responses and ask the LLM to propose theme names.

    Args:
        series: raw response column from the processed DataFrame
        label: human-readable question label (used in the prompt)
        theme_count: how many themes to request
        ai_cfg: the ai: section from config.yml

    Returns:
        List of theme name strings (e.g. ["Water Access", "Food Security", "Other"])
    """
    unique = series.dropna().astype(str).str.strip()
    unique = unique[unique != ""].drop_duplicates()
    if unique.empty:
        raise ValueError(f"Column for '{label}' has no non-empty responses to discover themes from.")

    sample = unique.sample(min(SAMPLE_SIZE, len(unique)), random_state=42).tolist()

    system = (
        "You are a survey data analyst. When given free-text survey responses, "
        "you identify concise, mutually-exclusive themes that cover most answers. "
        "Always return valid JSON only — no markdown fences, no commentary."
    )
    user = (
        f'Free-text responses to the survey question: "{label}"\n\n'
        f"Responses:\n" + "\n".join(f"- {r}" for r in sample) + "\n\n"
        f"Propose exactly {theme_count} concise theme names (2–5 words each) that "
        f"cover the majority of these responses. Add an \"Other\" theme only if a "
        f"significant share of responses clearly don't fit the others.\n"
        f'Return JSON: {{"themes": ["Theme A", "Theme B", ...]}}'
    )

    raw = _call_llm(system, user, ai_cfg)
    data = _parse_json(raw)
    themes = data.get("themes", [])
    if not themes:
        raise ValueError(f"LLM returned no themes for question '{label}'. Raw response: {raw[:300]}")
    themes = [str(t).strip() for t in themes]
    log.info(f"  Discovered themes for '{label}': {themes}")
    return themes


def classify_responses(
    series: pd.Series,
    themes: List[str],
    label: str,
    ai_cfg: Dict,
) -> pd.Series:
    """Classify every response in series into one of the given themes.

    Batches unique values (BATCH_SIZE at a time) to keep prompts bounded,
    builds a lookup dict, then maps the full series in one pass.

    Args:
        series: raw response column from the processed DataFrame
        themes: list of theme names returned by discover_themes (or from config)
        label: human-readable question label (used in the prompt)
        ai_cfg: the ai: section from config.yml

    Returns:
        New Series of the same length with theme labels; None for null rows.
    """
    unique_vals = series.dropna().astype(str).str.strip()
    unique_vals = unique_vals[unique_vals != ""].drop_duplicates().tolist()

    if not unique_vals:
        log.warning(f"  No responses to classify for '{label}' — returning empty column.")
        return pd.Series([None] * len(series), index=series.index)

    themes_str = ", ".join(f'"{t}"' for t in themes)
    system = (
        "You are a survey data analyst. Classify free-text survey responses into "
        "predefined themes. Always return valid JSON only — no markdown, no commentary."
    )

    lookup: Dict[str, str] = {}
    n_batches = (len(unique_vals) - 1) // BATCH_SIZE + 1
    for i in range(0, len(unique_vals), BATCH_SIZE):
        batch = unique_vals[i: i + BATCH_SIZE]
        user = (
            f'Classify each response to the question "{label}" into exactly one of '
            f"these themes: [{themes_str}]\n\n"
            f'For responses that clearly don\'t fit any theme, use "Other".\n\n'
            f"Responses to classify:\n" + "\n".join(f"- {r}" for r in batch) + "\n\n"
            f'Return JSON: {{"classifications": {{"<response text>": "<theme name>", ...}}}}\n'
            f"Include every response from the list, even if only one word."
        )
        raw = _call_llm(system, user, ai_cfg)
        data = _parse_json(raw)
        batch_result = data.get("classifications", {})
        lookup.update(batch_result)
        log.info(f"  Classified batch {i // BATCH_SIZE + 1}/{n_batches} for '{label}'")

    def _map(val):
        if pd.isna(val):
            return None
        key = str(val).strip()
        return lookup.get(key, "Other")

    return series.apply(_map)


def _call_llm(system_prompt: str, user_prompt: str, ai_cfg: Dict) -> str:
    """Route LLM call to the correct provider based on ai_cfg."""
    from src.reports.narrator import _call_openai, _call_anthropic

    provider = ai_cfg.get("provider", "openai").lower()
    api_key = ai_cfg.get("api_key", "")
    model = ai_cfg.get("model", "gpt-4o")
    max_tokens = int(ai_cfg.get("max_tokens", 1500))

    if not api_key or str(api_key).startswith("env:"):
        raise ValueError("AI api_key is not resolved — check your ai: section in config.yml.")

    if provider == "anthropic":
        return _call_anthropic(api_key, model, system_prompt, user_prompt, max_tokens)
    return _call_openai(
        api_key, model, system_prompt, user_prompt, max_tokens,
        base_url=ai_cfg.get("base_url"),
    )


def _parse_json(raw: str) -> Dict:
    """Parse JSON from LLM response, stripping markdown fences if present."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
    log.warning(f"Could not parse JSON from LLM response: {raw[:300]}")
    return {}
