#!/usr/bin/env python3
"""Live smoke-test for every seed prompt: compile -> call provider -> validate.

For each prompt in src/utils/seed_prompts.py this fills its {{variables}} with
realistic dummy values, calls the AI provider configured in config.yml with the
prompt's output_schema enforced, and checks the result:

  - schema prompts  -> output is valid JSON and validates against the schema
  - ask_* (no schema) -> output parses as JSON via the same fence-tolerant path
                         the real consumer uses
  - summaries        -> non-empty text

This is an OPERATIONAL check, not a unit test — it makes real, billable API
calls, so it deliberately lives in scripts/ (not tests/) and is never collected
by pytest.

Usage (from project root):
    PYTHONPATH=. python3 scripts/smoke_prompts.py
    PYTHONPATH=. python3 scripts/smoke_prompts.py --only ask_caption,narrator
    PYTHONPATH=. python3 scripts/smoke_prompts.py --max-tokens 1200

Requires: a working AI provider (config.yml `ai:` + its API key in the env).
Exit code: 0 if all selected prompts pass, 1 if any fail, 2 if no API key.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:  # noqa: BLE001
    pass

from src.utils import lf_client
from src.utils.config import load_config
from src.utils.seed_prompts import SEED_PROMPTS

try:
    import jsonschema
    _HAVE_JSONSCHEMA = True
except Exception:  # noqa: BLE001
    _HAVE_JSONSCHEMA = False

_VAR = re.compile(r"{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}")

# Prompts that emit JSON but carry no enforced schema (the ask_* family). Their
# real consumers parse them tolerantly, so we do the same here.
JSON_NO_SCHEMA = {"ask_propose", "ask_caption", "ask_refine"}

# Realistic fill values for every placeholder used across all seed prompts.
# Keep this in sync if a new prompt introduces a new {{variable}}.
VALUES = {
    "language": "English",
    "n_submissions": "128",
    "period": "Q2 2026",
    "title": "Monitoring Report",
    "form_alias": "monitoring_survey",
    "description": "Quarterly monitoring report for the PCP Mauritania program.",
    "generated_at": "2026-06-01",
    "pages": "6",
    "theme_count": "5",
    "themes_str": "access, quality, cost, staff, wait_time",
    "label": "What did you like least about the service?",
    "responses": (
        "1. The waiting time was too long.\n"
        "2. Staff were friendly but rushed.\n"
        "3. Too expensive for what I received.\n"
        "4. Clean facility and good care overall.\n"
        "5. Hard to find parking near the clinic."
    ),
    "question": "How does satisfaction vary by region?",
    "instruction": "make it a line chart split by sex",
    "current_kind": "chart",
    "current_recipe": '{"name": "satisfaction_by_region", "type": "bar", "questions": ["Satisfaction"]}',
    "chart_types": "bar, horizontal_bar, pie, line, histogram, scatter, stacked_bar, grouped_bar",
    "indicator_stats": "count, count_distinct, sum, mean, median, min, max, percent, most_common",
    "catalog": (
        "main: Region(categorical: North,South,East,West), "
        "Satisfaction(categorical: low,med,high), Age(numeric 18-80), Sex(categorical: M,F)\n"
        "repeat villages: Number_of_Students(numeric 0-500)"
    ),
    "scope_line": "This report covers all submissions for Q2 2026.",
    "categorical_block": (
        "Region: North 40%, South 30%, East 20%, West 10%\n"
        "Satisfaction: high 55%, med 30%, low 15%"
    ),
    # Includes ACTUAL computed values: ask_caption refuses (returns prose) without
    # them, and narrator/ask_caption both read this block. Format mirrors what
    # ask_engine.ground_captions builds: "name — title: summary".
    "charts_block": (
        "satisfaction_overview — Overall satisfaction: high 55%, medium 30%, low 15% (n=128)\n"
        "satisfaction_by_region — Satisfaction by region: North highest at 62%, West lowest at 38%"
    ),
    "indicators_block": "vaccinations_administered (sum of Number of doses) = 12,450",
    "stats_block": "Age: mean 34.2, median 33, min 18, max 79\nStudents: sum 8,420",
    "summaries_block": "Most respondents reported high satisfaction, concentrated in the North region.",
    "data_block": "Region: North 40%, South 30%, East 20%, West 10%",
    "example_block": 'Example: "Satisfaction was highest in the North (62%)."',
    "focus_line": "Focus on regional differences in satisfaction.",
    "columns_block": "Region (categorical), Satisfaction (categorical), Age (numeric), Sex (categorical), Submission_date (date)",
    "existing_block": "(none configured yet)",
    "header_line": "You are configuring a monitoring report for monitoring_survey.",
    "pii_block": "Respondent_name (drop), Phone_number (hash)",
    "repeat_groups_block": "villages: Departement, Region, Number_of_Students",
    "user_request_line": "Show how satisfaction varies across regions.",
    "views_block": "dept_student_totals (sum of Number_of_Students by Departement)",
    "summary_prompt_line": "Summarize key findings in one paragraph.",
    "existing_charts_block": "chart_1: Overall satisfaction (bar)",
    "existing_summaries_block": "(none configured yet)",
    "existing_views_block": "(none configured yet)",
    "main_cols_block": "Region (categorical), Satisfaction (categorical), Age (numeric)",
    "questions_block": (
        "Region (select_one), Satisfaction (select_one), Age (integer), "
        "Respondent_name (text), Phone_number (text), GPS (gps)"
    ),
}


def _build_vars(messages):
    needed = set()
    for m in messages:
        needed |= set(_VAR.findall(m["content"]))
    missing = sorted(v for v in needed if v not in VALUES)
    if missing:
        raise KeyError(f"no fill value for {missing} — add it to VALUES in this script")
    return {k: VALUES[k] for k in needed}


def _loads_lenient(raw: str):
    """Parse JSON, tolerating ```json fences / prose — mirrors the ask_* consumers."""
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        m = re.search(r"\{.*\}", raw or "", re.DOTALL)
        if not m:
            return None
        try:
            return json.loads(m.group(0))
        except (ValueError, TypeError):
            return None


def _resolve_provider():
    ai = (load_config() or {}).get("ai", {}) or {}
    provider = (ai.get("provider") or "anthropic").lower()
    model = ai.get("model") or "claude-sonnet-4-6"
    api_key = ai.get("api_key", "")
    if isinstance(api_key, str) and api_key.startswith("env:"):
        api_key = os.environ.get(api_key[4:], "")
    if not api_key:
        api_key = os.environ.get("ANTHROPIC_API_KEY", "") or os.environ.get("OPENAI_API_KEY", "")
    return provider, model, api_key, (ai.get("base_url") or None)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", default="", help="comma-separated prompt names to test (default: all)")
    parser.add_argument("--max-tokens", type=int, default=2000, help="max_tokens per call (default 2000)")
    args = parser.parse_args(argv)

    provider, model, api_key, base_url = _resolve_provider()
    if not api_key:
        print("No AI api_key resolved (config.yml ai: + env). Cannot run live test.")
        return 2

    selected = [n.strip() for n in args.only.split(",") if n.strip()] or list(SEED_PROMPTS)
    unknown = [n for n in selected if n not in SEED_PROMPTS]
    if unknown:
        print(f"Unknown prompt(s): {unknown}\nKnown: {', '.join(SEED_PROMPTS)}")
        return 2

    print(f"provider={provider} model={model} jsonschema={'yes' if _HAVE_JSONSCHEMA else 'no'} "
          f"max_tokens={args.max_tokens}\n")

    results = []
    for name in selected:
        entry = SEED_PROMPTS[name]
        schema = (entry.get("config") or {}).get("output_schema")
        messages = lf_client.compile_messages(entry["messages"], _build_vars(entry["messages"]))
        # Schema prompts get one retry: under soft tool-schema enforcement the
        # model occasionally returns {} / a partial object. Consumers tolerate
        # this (`.get(key, [])`), so a retry tells us whether the prompt can
        # reliably produce valid content vs. is genuinely broken.
        attempts = 2 if schema is not None else 1
        ok, detail, note = False, "", ""
        for attempt in range(1, attempts + 1):
            try:
                out = lf_client.chat(
                    messages, model=model, provider=provider, api_key=api_key,
                    max_tokens=args.max_tokens, trace_name=name, base_url=base_url,
                    output_schema=schema,
                )
                if schema is not None:
                    obj = json.loads(out)
                    if _HAVE_JSONSCHEMA:
                        jsonschema.validate(obj, schema)
                    detail = f"schema-valid; keys={list(obj.keys()) if isinstance(obj, dict) else type(obj).__name__}"
                elif name in JSON_NO_SCHEMA:
                    obj = _loads_lenient(out)
                    if not isinstance(obj, dict):
                        raise ValueError("response did not parse to a JSON object (even leniently)")
                    detail = f"json ok; keys={list(obj.keys())}"
                else:
                    if not (out or "").strip():
                        raise ValueError("empty response")
                    detail = f"text ok; {len(out)} chars"
                ok = True
                if attempt > 1:
                    note = f" (passed on retry {attempt})"
                break
            except Exception as e:  # noqa: BLE001
                detail = f"{type(e).__name__}: {e}".splitlines()[0][:120]
                if attempt < attempts:
                    continue
        results.append((name, ok))
        print(f"  {'PASS' if ok else 'FAIL'}  {name:22} {detail}{note}")

    lf_client.flush()
    passed = sum(1 for _, ok in results if ok)
    print(f"\n{passed}/{len(results)} prompts passed.")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
