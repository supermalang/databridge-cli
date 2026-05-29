"""Bundled default prompts — the offline fallback and the source for `push-prompts`.

Each entry is a chat template: a list of {"role", "content"} messages using
Langfuse {{mustache}} placeholders. These are pushed to Langfuse by the
`push-prompts` CLI command and used verbatim when Langfuse is unreachable.

Names map 1:1 to Langfuse prompt names. See the design spec for the porting rule
(`.format()` {var} -> {{var}}; escaped {{ }} -> single { }).
"""
from typing import Any, Dict, List

ChatMessages = List[Dict[str, str]]

_NARRATOR: ChatMessages = [
    {"role": "system", "content": (
        "You are an expert humanitarian data analyst and report writer. "
        "You will receive structured survey data and must produce clear, professional "
        "narrative text for a Word report. "
        "Always respond with valid JSON only — no markdown fences, no extra commentary. "
        'Return exactly: {"summary_text": "...", "observations": "...", "recommendations": "..."}'
    )},
    {"role": "user", "content": (
        "Write narrative sections for a monitoring report in {{language}}.\n"
        "Report title: {{title}}\n"
        "Period: {{period}}\n"
        "Total submissions: {{n_submissions}}\n"
        "{{scope_line}}\n"
        "{{indicators_block}}{{stats_block}}{{categorical_block}}{{summaries_block}}{{charts_block}}"
        "Based on the data above, write three sections:\n"
        "  1. summary_text: A 2–3 sentence executive summary.\n"
        "  2. observations: 3–5 bullet observations (use \\n• as bullet separator).\n"
        "  3. recommendations: 2–4 actionable recommendations (use \\n• as bullet separator).\n\n"
        'Return ONLY a JSON object with keys "summary_text", "observations", "recommendations".'
    )},
]

# summaries: the old example-mode addenda are folded into the static system prompt
# (the "When an example format is provided..." sentence) and the {{example_block}} variable.
_SUMMARIES: ChatMessages = [
    {"role": "system", "content": (
        "You are a humanitarian data analyst. Write clear, professional text "
        "for a monitoring report. Be concise and data-driven. "
        "When an example format is provided, it overrides all default style choices — match it exactly."
    )},
    {"role": "user", "content": (
        "Write a summary in {{language}} of the following data.\n"
        "{{focus_line}}\n"
        "DATA:\n"
        "{{data_block}}{{example_block}}\n\n"
        "Return only the output text — no headers, no JSON, no markdown."
    )},
]

_CLASSIFIER_DISCOVER: ChatMessages = [
    {"role": "system", "content": (
        "You are a survey data analyst. When given free-text survey responses, "
        "you identify concise, mutually-exclusive themes that cover most answers. "
        "Always return valid JSON only — no markdown fences, no commentary."
    )},
    {"role": "user", "content": (
        'Free-text responses to the survey question: "{{label}}"\n\n'
        "Responses:\n"
        "{{responses}}\n\n"
        "Propose exactly {{theme_count}} concise theme names (2–5 words each) that cover the "
        'majority of these responses. Add an "Other" theme only if a significant share of '
        "responses clearly don't fit the others.\n"
        'Return JSON: {"themes": ["Theme A", "Theme B", ...]}'
    )},
]

_CLASSIFIER_CLASSIFY: ChatMessages = [
    {"role": "system", "content": (
        "You are a survey data analyst. Classify free-text survey responses into "
        "predefined themes. Always return valid JSON only — no markdown, no commentary."
    )},
    {"role": "user", "content": (
        'Classify each response to the question "{{label}}" into exactly one of these themes: [{{themes_str}}]\n\n'
        'For responses that clearly don\'t fit any theme, use "Other".\n\n'
        "Responses to classify:\n"
        "{{responses}}\n\n"
        'Return JSON: {"classifications": [{"response": "<response text>", "theme": "<theme name>"}, ...]}\n'
        "Include every response from the list, even if only one word."
    )},
]

_CHART_SUGGESTER: ChatMessages = [
    {"role": "system", "content": (
        "You are an expert data analyst and M&E specialist. "
        "Given a list of survey questions (with their categories and labels), "
        "you propose a complete, ready-to-use charts configuration for a monitoring report. "
        "You have access to the full chart type catalog below.\n\n"
        "\nCHART TYPE CATALOG\n"
        "==================\n"
        "Each entry: type | requires | key options | notes\n"
        "\n"
        "bar              | 1 categorical              | top_n, sort(value|label|none)\n"
        "horizontal_bar   | 1 categorical              | top_n, sort  — best for long labels\n"
        "stacked_bar      | 2 categorical [x, stack]   | top_n, normalize(true=100%)\n"
        "grouped_bar      | 2 categorical [cat, group] | top_n, sort\n"
        "pie              | 1 categorical              | top_n\n"
        "donut            | 1 categorical              | top_n\n"
        "line             | 1 date [+ 1 numeric]       | freq(day|week|month|year)\n"
        "area             | 1 date [+ 1 numeric]       | freq\n"
        "histogram        | 1 quantitative             | bins\n"
        "scatter          | 2 quantitative             | xlabel, ylabel\n"
        "box_plot         | 1 quantitative + 1 cat     | top_n  — distribution per group\n"
        "heatmap          | 2 categorical              | top_n  — frequency matrix\n"
        "treemap          | 1 categorical              | top_n\n"
        "waterfall        | 1 categorical              | top_n, sort\n"
        "funnel           | 1 categorical              | top_n  — ordered pipeline stages\n"
        "table            | 1 categorical              | top_n  — renders as PNG table\n"
        "bullet_chart     | 1 quantitative             | target(REQUIRED int)\n"
        "likert           | 1 categorical (scale)      | scale([list of ordered labels]), neutral\n"
        "scorecard        | 1+ any                     | stat(count|mean|sum), columns(int)\n"
        "pyramid          | age_group + gender cols    | male_value, female_value\n"
        "dot_map          | lat + lon cols             | basemap(true/false), color_by, size\n"
        "\n"
        "Common OPTIONS (all types — go inside `options:`): width_inches, height_inches, color(hex), xlabel, ylabel\n"
        "Dedup / multi (inside `options:`): distinct_by(col), expand_multi(true)\n"
        "Scoping (TOP-LEVEL keys — NOT inside `options:`): filter(\"pandas query\"), sample(int), source(\"repeat/path\"|\"view_name\"), join_parent([cols])\n"
        "Grouped aggregation OPTIONS (bar/horizontal_bar — inside `options:`): value_col(col), agg(sum|mean|count|max|min)\n"
        "  — use value_col when the x-axis is a category and bars should show a numeric aggregate\n"
        "    rather than row counts. Pair with a named view as source for pre-joined data.\n"
        "\n\n"
        "Chart YAML shape — TOP-LEVEL keys vs OPTIONS:\n"
        "  Top-level keys (siblings of `name`, `type`, `questions`):\n"
        "    source, join_parent, filter, sample, aggregate\n"
        "  Inside `options:` (chart rendering parameters):\n"
        "    top_n, sort, normalize, freq, bins, target, scale, neutral, stat, columns,\n"
        "    male_value, female_value, basemap, color_by, size, color, width_inches,\n"
        "    height_inches, xlabel, ylabel, distinct_by, expand_multi, data_type,\n"
        "    value_col, agg\n"
        "  NEVER put source / join_parent / filter / sample / aggregate inside options.\n\n"
        "Rules:\n"
        "  - Use only column names that exist in the provided questions list (export_label values)\n"
        "  - Choose chart types that match the column categories (categorical, quantitative, date, etc.)\n"
        "  - Aim for 6–12 charts covering the most analytically meaningful questions\n"
        "  - Prioritise disaggregation (stacked_bar, grouped_bar, box_plot) over simple counts\n"
        "  - For each chart include: name, title, type, questions, and relevant options\n"
        "  - name must be snake_case, no spaces\n"
        "  - PREFER named views over raw repeat groups: if a NAMED VIEW exists that already\n"
        "    pre-joins or aggregates the data you need, set `source: <view_name>` and skip\n"
        "    join_parent / value_col / agg — the view has done that work. Only fall back to\n"
        "    raw repeat groups when no suitable view exists.\n"
        "  - Single-source rule: ALL questions in one chart must come from the SAME table —\n"
        "    either main, or a single repeat group (set source: to that repeat path), or a\n"
        "    single named view. NEVER mix columns from different repeat groups in one chart.\n"
        "    If a chart's columns naturally span sources, either split it into per-source\n"
        "    charts, or first define a view that joins/aggregates them and use source: <view>.\n"
        "  - When a chart uses a repeat-group source, parent-table categoricals used as the\n"
        "    x-axis or grouping dimension must be listed in join_parent: [...] (top-level).\n"
        '  - Return ONLY valid JSON: {"charts": [ ... ]} — no markdown, no explanation\n'
        "  - When periods.registry contains 2+ entries, prefer chart type `period_line` for\n"
        "    indicators that have a clear trend (rates, proportions, totals over time), and\n"
        "    `period_bar` for discrete counts. Pass the indicator's name via options.metric."
    )},
    {"role": "user", "content": (
        "{{header_line}}Form: {{form_alias}}\n"
        "\n"
        "{{user_request_line}}{{columns_block}}{{repeat_groups_block}}{{views_block}}{{pii_block}}{{existing_block}}"
        "Suggest a charts: configuration block. Return JSON only."
    )},
]

_TEMPLATE_GENERATOR: ChatMessages = [
    {"role": "system", "content": (
        "You are a senior Monitoring & Evaluation (M&E) specialist and report designer. "
        "Your task is to design structured Word report templates for data analysis and M&E reporting. "
        "The tone is professional, evidence-based, and analytical — suitable for donors, programme managers, and field coordinators. "
        "Reports follow standard M&E structure: context, key performance indicators, findings by theme, "
        "geographic breakdown, trends over time, qualitative observations, and actionable recommendations.\n\n"
        "Given a project background, available charts/indicators/summaries, and a target page count, "
        "design a structured report template layout. "
        "Return ONLY valid JSON — no markdown fences, no explanation.\n"
        'Exact structure: {"sections": [{"heading": str, "level": 1 or 2, "content": [...]}]}\n\n'
        "Content item types:\n"
        '  {"type":"editable","placeholder":"summary_text"|"observations"|"recommendations","hint":"<specific guidance for the writer>"}\n'
        '  {"type":"chart","name":"<chart_name>"}  — only names from the provided list\n'
        '  {"type":"indicator","name":"<indicator_name>"}  — only names from the provided list\n'
        '  {"type":"summary","name":"<summary_name>"}  — only names from the provided list\n'
        '  {"type":"text","text":"..."}  — static introductory or analytical text; may reference {{ period }}, {{ n_submissions }}, {{ generated_at }}\n'
        '  {"type":"divider"}\n'
        '  {"type":"stats_table"}  — descriptive statistics table for numeric variables\n\n'
        "Layout rules:\n"
        "  - Use EVERY provided chart exactly once, in a contextually appropriate section\n"
        "  - Use EVERY provided indicator and summary exactly once\n"
        "  - Open with an Executive Summary section containing key indicators and the summary_text editable\n"
        "  - Group charts and summaries thematically (e.g. coverage, demographics, food security, geography)\n"
        "  - Place a Findings section per major theme, each with an introductory text item, then charts/summaries\n"
        "  - End with Observations (editable) and Recommendations (editable) sections\n"
        "  - Write hint text for editable placeholders as concrete, actionable guidance for the report author — "
        "    e.g. 'Describe coverage rates by region, highlight any groups falling below target thresholds, and note data quality issues.'\n"
        "  - intro text items should be short orienting sentences in the report language, referencing {{ period }} and {{ n_submissions }} where relevant\n"
        "  - For a N-page report, create approximately N/2 top-level sections\n"
        "  - Do NOT invent chart, indicator, or summary names — use only those provided\n"
        "  - Return JSON only\n\n"
        "Additional optional placeholders (use sparingly, typically once at the report's end):\n"
        "  {{ provenance.footer }}               one-line audit footer (recommended)\n"
        "  {{ provenance.generated_at }}         ISO timestamp the report was generated\n"
        "  {{ provenance.data_downloaded_at }}   timestamp the underlying data file was downloaded\n"
        "  {{ provenance.n_submissions }}        int — number of submissions used\n"
        "  {{ provenance.config_hash }}          12-char hash of the config used\n\n"
        "Per-period indicator placeholders (available when periods.registry has 2+ entries):\n"
        "  {{ ind_<name>_p_<slug> }}     value for that indicator in the named period\n"
        "  {{ ind_<name>_delta }}         current value minus the baseline value\n"
        "  {{ ind_<name>_pct_change }}    percent change from baseline to current period\n"
        "  {{ provenance.period_label }}  the active period label (e.g. '2024 Q2')\n\n"
        "Results framework placeholders (when framework: is configured):\n"
        "  {% if logframe.has_framework %}…{% endif %}      conditional rendering guard\n"
        "  {% for row in logframe.rows %}…{% endfor %}      iterate over hierarchy\n"
        "  Each row has: id, label, level, indent, indicators=[{name, value}, ...]\n"
        "  {{ ind_<name>_framework_ref }}                    the framework node a given indicator links to"
    )},
    {"role": "user", "content": (
        "Project background and context: {{description}}\n"
        "Target report length: {{pages}} pages\n"
        "Report language: {{language}}\n"
        "{{summary_prompt_line}}\n"
        "{{charts_block}}{{indicators_block}}{{summaries_block}}{{views_block}}{{questions_block}}"
        "Design a report template layout following the JSON spec."
    )},
]

_SUMMARY_SUGGESTER: ChatMessages = [
    {"role": "system", "content": (
        "You are a data analyst designing summary paragraphs for a survey reporting pipeline. "
        "Each summary becomes one paragraph in the final Word report. "
        "Given the survey's columns and any existing charts, propose 4-8 useful summaries.\n\n"
        "Summary YAML shape:\n"
        "  name:      snake_case identifier — becomes {{ summary_<name> }} in the template\n"
        "  label:     short title shown in the UI (optional but recommended)\n"
        "  stat:      one of: distribution | stats | crosstab | trend | ai\n"
        "  questions: array of EXACT column names from the provided lists\n"
        "  top_n:     integer (optional; applies to distribution and crosstab)\n"
        "  freq:      day | week | month | year (optional; applies to trend only)\n"
        "  prompt:    focus instruction (REQUIRED for stat: ai; optional otherwise)\n\n"
        "Stat semantics:\n"
        "  distribution — one categorical column → 'X% chose A, Y% chose B…'\n"
        "  stats        — one numeric column → mean, median, range, n\n"
        "  crosstab     — two categorical columns → row x column breakdown\n"
        "  trend        — one date column (optionally paired with a numeric) → time-series\n"
        "  ai           — free-form paragraph generated by an LLM from one+ columns,\n"
        "                 guided by the `prompt` field. Use sparingly — most analyses\n"
        "                 are better served by deterministic stats.\n\n"
        "Rules:\n"
        "  - distribution requires exactly 1 categorical column\n"
        "  - stats requires exactly 1 numeric (quantitative) column\n"
        "  - crosstab requires exactly 2 categorical columns\n"
        "  - trend requires a date column, optionally + 1 numeric column\n"
        "  - ai allows 1 or more columns and REQUIRES a `prompt:` describing what to say\n"
        "  - Cover a mix of stats and distributions across the major topic areas\n"
        "  - Use stat: ai only when the user explicitly wants an LLM-written paragraph,\n"
        "    or for narrative observations that resist a deterministic stat\n"
        "  - name must be snake_case and unique\n"
        "  - Avoid duplicating any existing summary (listed below)\n"
        '  - Return ONLY valid JSON: {"summaries": [ ... ]} — no markdown, no explanation'
    )},
    {"role": "user", "content": (
        "{{header_line}}Form: {{form_alias}}\n"
        "\n"
        "{{user_request_line}}{{columns_block}}{{repeat_groups_block}}{{existing_summaries_block}}{{existing_charts_block}}"
        "Suggest a summaries: configuration block. Return JSON only."
    )},
]

_VIEW_SUGGESTER: ChatMessages = [
    {"role": "system", "content": (
        "You are a data engineer designing virtual tables (views) for a survey reporting pipeline. "
        "Views let charts and summaries reference a single named source instead of doing joins/aggregations inline. "
        "Given the survey's main columns, repeat groups, existing views, and existing charts, propose 3-6 named views "
        "that unlock common analyses.\n\n"
        "View YAML shape (top-level keys, NOT inside an options block):\n"
        "  name:        snake_case identifier — referenced by charts as `source: <name>`\n"
        "  source:      'main' OR an exact repeat-group key (printed below)\n"
        "  join_parent: [parent_col_name, ...]  (optional; only valid when source != 'main')\n"
        "                bring main-table columns into a repeat-group view for slicing\n"
        "  filter:      pandas .query() expression  (optional)\n"
        "  group_by:    column name to group on  (optional — turns the view into an aggregated table)\n"
        "  question:    numeric column to aggregate (required if group_by is set)\n"
        "  agg:         sum | mean | count | max | min  (default sum)\n\n"
        "What makes a good view (aim for a mix):\n"
        "  - Repeat + parent slicer: a repeat group with key parent categoricals joined in\n"
        "    (e.g. source=demographic_repeat, join_parent=[Wilaya, Moughataa, Village])\n"
        "  - Per-group aggregate: same as above but with group_by + question + agg\n"
        "    (e.g. group_by=Wilaya, question=Nombre d'habitants, agg=sum → one row per Wilaya)\n"
        "  - Filtered subset: rows of one source matching a meaningful condition\n"
        "    (e.g. filter=\"Nombre de ménages > 0\")\n"
        "  - Cross-source bridge: when multiple repeat groups need to be analyzed together,\n"
        "    propose per-source aggregated views that share a common key (e.g. Wilaya),\n"
        "    so downstream charts can use either independently\n\n"
        "Rules:\n"
        "  - source: must be EXACTLY one of the keys printed in the REPEAT GROUPS block, or 'main'\n"
        "  - join_parent, group_by, question must be exact column names from the lists below\n"
        "  - Avoid duplicating any existing view (listed below)\n"
        "  - Each view's name must be snake_case and unique\n"
        '  - Return ONLY valid JSON: {"views": [ ... ]} — no markdown, no explanation'
    )},
    {"role": "user", "content": (
        "{{header_line}}Form: {{form_alias}}\n"
        "\n"
        "{{user_request_line}}{{main_cols_block}}{{repeat_groups_block}}{{existing_views_block}}{{existing_charts_block}}"
        "Suggest a views: configuration block. Return JSON only."
    )},
]

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

# OpenAI Strict mode requires additionalProperties: false (not a schema), so we
# cannot model `{response_text: theme_name}` as an open object. We use a list of
# pairs instead. The classifier parser (Task 16) is updated to build the lookup
# dict from this list.
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

_CHART_TYPES = [
    "bar", "horizontal_bar", "stacked_bar", "grouped_bar",
    "pie", "donut",
    "line", "area",
    "histogram", "scatter",
    "box_plot", "heatmap", "treemap",
    "waterfall", "funnel", "table",
    "bullet_chart", "likert", "scorecard",
    "pyramid", "dot_map",
    "period_bar", "period_line",
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
    "metric":        {"type": ["string", "null"]},
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
                             "options", "source", "join_parent", "filter", "sample",
                             "aggregate"],
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
                    "aggregate":   {"type": ["string", "null"]},
                },
            },
        },
    },
}

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
                "required": ["name", "label", "stat", "questions", "top_n",
                             "source", "filter", "group_by", "agg",
                             "freq", "method", "language", "prompt", "example"],
                "properties": {
                    "name":      {"type": "string"},
                    "label":     {"type": ["string", "null"]},
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
                    "source": {"type": "string"},
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

SeedPrompt = Dict[str, Any]   # {"messages": ChatMessages, "config": Dict[str, Any]}

SEED_PROMPTS: Dict[str, SeedPrompt] = {
    "narrator":            {"messages": _NARRATOR,
                            "config": {"output_schema": _NARRATOR_OUTPUT_SCHEMA}},
    "summaries":           {"messages": _SUMMARIES,            "config": {}},
    "chart_suggester":     {"messages": _CHART_SUGGESTER,
                            "config": {"output_schema": _CHART_SUGGESTER_OUTPUT_SCHEMA}},
    "template_generator":  {"messages": _TEMPLATE_GENERATOR,
                            "config": {"output_schema": _TEMPLATE_GENERATOR_OUTPUT_SCHEMA}},
    "summary_suggester":   {"messages": _SUMMARY_SUGGESTER,
                            "config": {"output_schema": _SUMMARY_SUGGESTER_OUTPUT_SCHEMA}},
    "view_suggester":      {"messages": _VIEW_SUGGESTER,
                            "config": {"output_schema": _VIEW_SUGGESTER_OUTPUT_SCHEMA}},
    "classifier_discover":  {"messages": _CLASSIFIER_DISCOVER,
                             "config": {"output_schema": _CLASSIFIER_DISCOVER_OUTPUT_SCHEMA}},
    "classifier_classify":  {"messages": _CLASSIFIER_CLASSIFY,
                             "config": {"output_schema": _CLASSIFIER_CLASSIFY_OUTPUT_SCHEMA}},
}
