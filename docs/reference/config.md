# config.yml — full annotated reference

Everything the tool does is driven by a single `config.yml`. Copy `sample.config.yml`
to `config.yml` to start. CLAUDE.md carries a one-line-per-section skeleton; this is the
full annotated structure.

```yaml
api:
  url: https://kf.kobotoolbox.org/api/v2   # or https://api.ona.io/api/v1
  token: env:KOBO_TOKEN                    # env: prefix reads from environment variable

form:
  uid: aAbBcCdDeEfFgGhH                    # Kobo/Ona asset UID
  alias: monitoring_survey                 # used as filename prefix in exports

# Auto-filled by fetch-questions — user then edits (delete unwanted, fix categories)
questions:
  - kobo_key: region                       # dot-path from Kobo API response
    label: Region                          # label from XLSForm
    type: select_one                       # raw XLSForm type
    category: categorical                  # qualitative|quantitative|categorical|geographical|date|undefined
    group: ""                              # XLSForm group path if nested
    choice_list: regions                   # choice list name for select questions
    export_label: Region                   # column name in export — user can rename

# pandas .query() syntax — applied to all data before export and chart generation
filters:
  - "Age > 0"
  - "Region != 'Test'"
  - "submission_date >= '2025-01-01'"

# Named virtual tables — computed once per render, reused by charts/summaries/indicators.
views:
  - name: villages_with_dept
    source: villages                    # repeat group path (or "main")
    join_parent: [Departement, Region]
    filter: "Number of Students > 0"

  - name: dept_student_totals           # aggregated view
    source: villages
    join_parent: [Departement]
    group_by: Departement
    question: Number of Students
    agg: sum                            # sum | mean | count | max | min

# Each chart → {{ chart_<n> }} placeholder in Word template
charts:
  - name: satisfaction_overview
    title: Overall satisfaction
    type: horizontal_bar
    questions: [Satisfaction]
    options:
      top_n: 10
      width_inches: 5.5

# Each indicator → {{ ind_<name> }} placeholder; framework_ref links it to a framework node
# stat: count | count_distinct | sum | mean | median | min | max | percent | most_common | grouped_agg |
#       completeness (% present, non-blank) | outlier_rate (% beyond 3xIQR) | duplicate_rate (% redundant)
#       — the latter three are data-quality stats; pair with format: percent
# direction: increase (default, higher-is-better → pct_achievement = value/target)
#            | decrease (lower-is-better → target/value). Set on "reduce X" indicators
#            so achievement is correct when the goal is to bring a number down.
indicators:
  - name: vaccinations_administered
    stat: sum
    question: Number of doses
    framework_ref: OP1.1     # optional — links indicator to a results-framework node
    disaggregate_by: [Region, Sex]   # optional — also compute this stat per group;
                                     # adds ind_<name>_breakdown (list) + ind_<name>_table (text)
    primary: true                    # optional — headline indicator for its framework node;
                                     # drives the node's achievement in the logframe rows

# AI narrative (fills {{ summary_text }}, {{ observations }}, {{ recommendations }})
ai:
  provider: openai                      # openai | anthropic
  model: gpt-4o
  api_key: env:OPENAI_API_KEY
  base_url: ""                          # optional — Azure, Groq, Mistral, Ollama
  language: English
  max_tokens: 1500

# Optional — multi-period support. When absent, single-period mode applies.
# A registry entry has two flavors, distinguished by whether it carries dates:
#   • date-range (has started/ended) — set from the Deliver→Output "Reporting
#     period" control (Year/Quarter/Month or a custom range). ONE plain download
#     is sliced at report time: build-report keeps only rows whose
#     `_submission_time` falls in [started, ended] (see filter_to_period in
#     src/data/transform.py). Files are NOT slug-separated.
#   • label-only (no started/ended) — legacy per-period downloads, where each
#     period writes slug-prefixed files `{alias}_{slug}_data_*` and build-report
#     --period loads just that period's files.
periods:
  current:  "Q2 2026"                    # active period
  baseline: "Q1 2026"                    # canonical comparison anchor
  registry:
    - label: "Q1 2026"
      slug:  "q1_2026"                   # filesystem-safe; auto-derived from label
      started: 2026-01-01                # set ⇒ date-range period (filters by _submission_time)
      ended:   2026-03-31
    - label: "Q2 2026"
      slug:  "q2_2026"

# Optional — results framework (logframe). When absent, no framework rendering.
framework:
  goal:
    id:    GOAL
    label: "Reduce child mortality by 25% in target districts by 2030"
  outcomes:
    - id: OC1
      label: "80% of children under 5 fully vaccinated"
      parent: GOAL
  outputs:
    - id: OP1.1
      label: "10,000 vaccination doses administered"
      parent: OC1

# Optional — PII redaction + consent gating. When absent, no redaction.
pii:
  consent_column: "Consent_to_share_data"   # rows must have this == consent_value
  consent_value:  "yes"
  redact:
    - column: "Respondent_name"
      strategy: drop
    - column: "Phone_number"
      strategy: hash
    - column: "GPS"
      strategy: generalize_geo
      decimals: 2

export:
  format: csv                              # csv | json | xlsx | mysql | postgres | supabase
  output_dir: data/processed
  database:
    host: localhost
    port: 5432
    name: kobo_reports
    user: env:DB_USER
    password: env:DB_PASSWORD
    table: submissions

report:
  template: templates/report_template.docx
  output_dir: reports
  title: Monitoring Report
  period: Q1 2025
  filename_pattern: "{form.alias}_{period}_{split}.docx"
  split_by: region                       # optional — generate one .docx per unique value
```

## Auto-categorization rules (src/data/questions.py)

XLSForm question type → category mapping at fetch-questions time:

| XLSForm type | Category |
|---|---|
| `select_one`, `select_multiple` | `categorical` |
| `integer`, `decimal`, `range` | `quantitative` |
| `text`, `note` | `qualitative` |
| `gps`, `geotrace`, `geoshape` | `geographical` |
| `date`, `datetime`, `time` | `date` |
| anything else | `undefined` |

On re-run, user-edited `category` and `export_label` values are preserved. New questions
from the schema are appended with fresh defaults.

## Filter syntax (src/data/transform.py)

Filters use `pandas.DataFrame.query()` — SQL-like expressions. Column names reference
`export_label` values, **not** original `kobo_key` paths.
