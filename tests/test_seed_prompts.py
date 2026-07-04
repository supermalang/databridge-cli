import re
from src.utils.seed_prompts import SEED_PROMPTS

EXPECTED_NAMES = {
    "narrator", "summaries", "chart_suggester", "template_generator",
    "summary_suggester", "view_suggester", "table_suggester", "indicator_suggester",
    "classifier_discover", "classifier_classify",
    "ask_propose", "ask_caption", "ask_refine", "ask_examples",
    "hidden_suggester", "pii_suggester",
    "template_inference",
}

def test_all_prompts_present():
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

def test_narrator_has_output_schema():
    schema = SEED_PROMPTS["narrator"]["config"]["output_schema"]
    assert schema["type"] == "object"
    assert set(schema["required"]) == {"summary_text", "observations", "recommendations"}
    assert schema["additionalProperties"] is False

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

def test_view_suggester_schema():
    s = SEED_PROMPTS["view_suggester"]["config"]["output_schema"]
    item = s["properties"]["views"]["items"]
    assert "agg" in item["required"]
    assert set(item["properties"]["agg"]["enum"]) == {None, "sum", "mean", "count", "max", "min"}

def test_template_generator_schema_item_types_match_parser():
    """The schema's item-type enum must match what _parse_spec understands."""
    s = SEED_PROMPTS["template_generator"]["config"]["output_schema"]
    schema_item_types = set(
        s["properties"]["sections"]["items"]
         ["properties"]["content"]["items"]
         ["properties"]["type"]["enum"]
    )
    expected = {"editable", "chart", "indicator", "summary",
                "text", "divider", "stats_table"}
    assert schema_item_types == expected

def test_chart_suggester_type_enum_matches_dispatch():
    """If a new chart type is added in charts.py, this schema must list it."""
    from src.reports.charts import CHART_DISPATCH
    s = SEED_PROMPTS["chart_suggester"]["config"]["output_schema"]
    schema_types = set(s["properties"]["charts"]["items"]["properties"]["type"]["enum"])
    assert schema_types == set(CHART_DISPATCH)

def test_summary_suggester_schema_stat_enum_matches_dispatch():
    """If a new stat is added to summaries.py, this schema must list it."""
    s = SEED_PROMPTS["summary_suggester"]["config"]["output_schema"]
    schema_stats = set(s["properties"]["summaries"]["items"]["properties"]["stat"]["enum"])
    expected_stats = {"distribution", "stats", "crosstab", "trend",
                      "data_quality", "keyword_frequency", "correlation",
                      "grouped_agg", "ai"}
    assert schema_stats == expected_stats


def test_all_output_schemas_validate_against_meta_schema():
    """Every seed's output_schema is itself a valid JSON Schema (draft 2020-12)."""
    from jsonschema import Draft202012Validator
    for name, entry in SEED_PROMPTS.items():
        schema = entry["config"].get("output_schema")
        if schema is None:
            continue
        Draft202012Validator.check_schema(schema)


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


# Object-paths intentionally allowed to be open maps (additionalProperties is a SCHEMA, not False).
# Currently empty — OpenAI Strict mode forbids non-False additionalProperties, so every
# seed schema has been shaped to be fully closed. Add an entry here only if a future
# schema deliberately uses an open map AND that prompt is not enforced via OpenAI Strict.
_ALLOWED_OPEN_MAPS: set = set()


def test_openai_strict_mode_contract():
    """Every object schema must close additionalProperties AND list every property in required.

    Exceptions for designed open maps are tracked in _ALLOWED_OPEN_MAPS.
    """
    for name, entry in SEED_PROMPTS.items():
        schema = entry["config"].get("output_schema")
        if schema is None:
            continue
        for path, obj in _paths_of_object_schemas(schema):
            ap = obj.get("additionalProperties", None)
            is_open_map = isinstance(ap, dict)
            if is_open_map:
                assert (name, path) in _ALLOWED_OPEN_MAPS, \
                    f"{name}:{path} uses additionalProperties as schema (open map) — add it to _ALLOWED_OPEN_MAPS if intentional."
                continue
            assert ap is False, f"{name}:{path} must set additionalProperties: false (got {ap!r})"
            props = set((obj.get("properties") or {}).keys())
            required = set(obj.get("required") or [])
            missing = props - required
            assert not missing, (
                f"{name}:{path} Strict-mode violation — properties not in required: {missing}"
            )


def test_template_inference_explains_bullet_list_over_table():
    """MNT-20: the LLM must be steered toward `bullet_list` instead of `table`
    when a table's "≥1 categorical column" requirement can't be met.

    AC1: the system message explicitly states bullet_list is not a real
         chart/graph, and should be preferred over table when there's no
         categorical column.
    AC2: the user message's `table` bullet explicitly redirects to
         kind="chart" + type="bullet_list" when there's no categorical column.
    """
    system = SEED_PROMPTS["template_inference"]["messages"][0]["content"]
    user = SEED_PROMPTS["template_inference"]["messages"][1]["content"]

    assert "bullet_list" in system, "system message never mentions bullet_list"

    not_real_chart = re.search(
        r"bullet_list[^.]{0,200}\bnot\b[^.]{0,80}\b(a real|an actual)\b[^.]{0,40}\b(chart|graph)\b",
        system, re.IGNORECASE | re.DOTALL,
    ) or re.search(
        r"\bnot\b[^.]{0,80}\b(a real|an actual)\b[^.]{0,40}\b(chart|graph)\b[^.]{0,200}bullet_list",
        system, re.IGNORECASE | re.DOTALL,
    )
    assert not_real_chart, (
        "system message must explain that bullet_list is not a real chart/graph type"
    )

    prefer_over_table = re.search(
        r"bullet_list[^.]{0,300}\bno\b[^.]{0,40}categorical[^.]{0,200}\btable\b",
        system, re.IGNORECASE | re.DOTALL,
    ) or re.search(
        r"\btable\b[^.]{0,300}\bno\b[^.]{0,40}categorical[^.]{0,200}bullet_list",
        system, re.IGNORECASE | re.DOTALL,
    )
    assert prefer_over_table, (
        "system message must say bullet_list is preferred over table "
        "when there's no categorical column"
    )

    table_bullet_match = re.search(r"-\s*table:.*?(?=\n-\s|\Z)", user, re.IGNORECASE | re.DOTALL)
    assert table_bullet_match, "user message must contain a `table:` bullet"
    table_bullet = table_bullet_match.group(0)

    assert "no categorical" in table_bullet.lower() or "without a categorical" in table_bullet.lower(), (
        "table bullet must mention the no-categorical-column case"
    )
    assert 'kind="chart"' in table_bullet, (
        'table bullet must redirect to kind="chart" when there is no categorical column'
    )
    assert "bullet_list" in table_bullet, (
        "table bullet must mention bullet_list as the redirect target"
    )
