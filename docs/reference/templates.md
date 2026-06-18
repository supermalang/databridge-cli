# Word template placeholders (docxtpl / Jinja2)

Templates use Jinja2 syntax via `docxtpl`. See also `TEMPLATE_GUIDE.md` for the manual
authoring walkthrough. Available placeholders:

```
{{ report_title }}
{{ period }}
{{ n_submissions }}
{{ generated_at }}
{{ summary_text }}         ← AI-filled if ai: is configured, else left blank
{{ observations }}
{{ recommendations }}

{{ ind_<name> }}        ← one per indicator in config.yml indicators section
{{ ind_<name>_breakdown }}  ← list of {group,value,formatted} when the indicator sets disaggregate_by (loop in the template)
{{ ind_<name>_table }}      ← plain-text "group: value" fallback for the same breakdown
{{ summary_<name> }}    ← one per summary in config.yml summaries section
{{ chart_<n> }}         ← one per chart in config.yml
{{ split_value }}       ← when --split-by is set, the current group's value
{{ data_quality }}      ← auto DQ overview (has_data / rows of {column, completeness, outlier_rate, duplicate_rate}) for the main table, plus tables: [{name, rows}] — one entry per non-empty repeat table. Rendered in the auto-template and the web Validate-tab panel.
{{ logframe }}          ← results framework hierarchy (has_framework / rows); present only when framework: is configured.
                          Each row's indicators carry {name, value, baseline, target, pct_achievement} (latter three "" when not set);
                          rows also carry primary_indicator + node_value/node_target/node_pct_achievement from the indicator flagged primary: true
{{ provenance.footer }}  ← one-line audit footer; includes "pii: consent=<col>, <N> columns redacted" when pii: rules are configured
```

## Critical rule

Each `{{ chart_... }}` must be a **single unbroken XML run** in the `.docx`. Word silently
splits a run when you change formatting mid-word, which breaks the placeholder. Use
`generate-template` to auto-generate correct placeholders — **never type them manually**.
