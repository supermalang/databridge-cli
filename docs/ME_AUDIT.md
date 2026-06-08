# M&E Audit — databridge-cli

_Audited: 2026-04-07_

---

## What the platform does well

| Capability | Status | Notes |
|---|---|---|
| Data extraction from KoboToolbox / Ona | Strong | Pagination, Kobo + Ona schema, choice labels |
| Survey question auto-categorization | Good | 6 types; preserves user edits on re-run |
| Disaggregation charts | Good | Stacked/grouped bar, crosstab summary, heatmap |
| Beneficiary deduplication | Good | `dedup_by` in indicators, `distinct_by` in charts |
| Target vs achievement | Partial | `bullet_chart` only — no logframe structure |
| Time-series tracking | Good | Line/area/trend, configurable freq |
| Repeat group support | Good | Auto-split into linked tables, parent-child filtering |
| Geographic mapping | Good | `dot_map` with optional OSM basemap |
| AI narrative generation | Good | OpenAI + Anthropic, multi-language |
| Qualitative classification | Good | LLM-powered theme discovery + tagging |
| Split-by reports | Good | One report per region/site/partner |
| Word report automation | Strong | docxtpl + Jinja2, AI template generation |
| Export flexibility | Good | CSV, XLSX, JSON, PostgreSQL, MySQL, Supabase |

---

## Critical M&E gaps

### 1. No logframe / results chain structure
The platform has no concept of outcomes, outputs, activities, or impact. Every indicator lives flat in a list — there's no hierarchy, no level (impact/outcome/output/process), and no linkage between indicators and program objectives.

**Impact:** You cannot structure a report around a results framework, cannot auto-populate a logframe table, and cannot track whether a portfolio of indicators is on-track at outcome level.

---

### 2. Baseline, target, and milestone tracking
Only the `bullet_chart` accepts a `target` — and only one hard-coded value. There is no support for:
- Baselines per indicator
- Milestones (e.g., 40% by Q2, 80% by Q4)
- Multi-period targets (annual vs cumulative)
- Baseline data stored separately from endline

**Impact:** You cannot produce standard M&E dashboards showing baseline → current → target progression. The most common M&E table (Indicator | Baseline | Target | Actual | % Achievement) cannot be auto-generated.

---

### 3. No data quality framework
There are no outlier flags, completeness checks, response rate calculations, inter-enumerator reliability metrics, or data validation rules beyond pandas `.query()` filters.

**Impact:** Data quality validation is entirely manual. In field surveys this is where most M&E effort is lost.

---

### 4. Equity and inclusion analysis
Gender, age, disability, and geographic disaggregation require manually configuring separate charts per variable. There is no built-in equity lens — no automatic comparison of indicator values across population sub-groups with significance.

**Impact:** Disaggregated reporting meets minimum requirements (chart exists) but doesn't surface inequities, convergence, or exclusion patterns without heavy manual chart configuration.

---

### 5. Variance and progress analysis
There is no planned vs actual tracking, no calculation of % achievement per period, and no flag when indicators fall below threshold. The `scorecard` chart shows raw values but not deviation from plan.

**Impact:** The platform cannot generate standard M&E progress tables or traffic-light dashboards without manually pre-computing values in the data.

---

### 6. Multi-form / longitudinal linkage
The platform connects to exactly one form. Many M&E frameworks require linking across:
- Baseline survey ↔ endline survey (matching on beneficiary ID)
- Monitoring visits ↔ registration data
- Activity data ↔ outcome data

**Impact:** Causal inference, difference-in-differences, and pre/post comparisons are impossible within the platform.

---

### 7. Indicator metadata catalog
There is no indicator library — no labels, units, disaggregation requirements, data sources, collection frequency, or responsible party stored alongside each indicator. The config holds only the computation parameters.

**Impact:** Cannot auto-generate the indicator reference sheet that donors require. Teams must maintain a separate spreadsheet.

---

### 8. Sampling and weighting
There is no support for survey weights, stratification, design effects, or confidence intervals. The `--sample N` option is for testing only (first N rows), not statistical sampling.

**Impact:** For population-representative surveys, all aggregated statistics will be biased if sampling is unequal. No way to weight results to population.

---

## Prioritized recommendations

### Priority 1 — High value, relatively contained

**A. Add baseline/target fields to indicators**

In `src/reports/indicators.py`, extend the indicator schema to accept `baseline`, `target`, and `milestone` fields. Compute `pct_achievement` and `change_from_baseline`. Expose `{{ ind_<name>_target }}`, `{{ ind_<name>_pct }}`, `{{ ind_<name>_baseline }}` as additional template placeholders. This unlocks the standard M&E achievement table with minimal rework.

**B. Add a `logframe` config section**

Add an optional `logframe:` key in `sample.config.yml` that groups indicators by level (impact, outcome, output, activity). The `build-report` command can then render a structured logframe table template. No change to the computation engine — just grouping metadata.

**C. Add a `data_quality` summary type**

In `src/reports/summaries.py`, add a `data_quality` stat type that computes: total submissions, completeness per column, duplicates found, outliers (IQR method) per numeric column. Auto-generates a QA narrative. Very high M&E value, low implementation cost.

---

### Priority 2 — Medium complexity, high M&E impact

**D. Multi-period tracking**

Add a `period_column` option to indicators and charts — a date column used to slice data by reporting period. Auto-compute period-over-period change (absolute and %). This enables progress dashboards without the user pre-aggregating data.

**E. Equity disaggregation template**

Add an `equity_dimensions` config section listing cross-cutting variables (gender, age_group, location). Automatically generate one `stacked_bar` or `grouped_bar` per indicator × dimension. This turns a single config line into a full disaggregation section in the report.

**F. Indicator metadata fields**

Extend each indicator in config to carry: `unit`, `direction` (higher_is_better|lower_is_better), `source`, `frequency`, `responsible`, `disaggregated_by`. The `generate-template` command can use these to build the indicator reference annex automatically.

---

### Priority 3 — Structural, longer-term

**G. Multi-form linkage**

Allow `api:` to list multiple forms, each with an alias. `fetch-questions` and `download` would produce named DataFrames. Indicators and charts could reference `form: baseline` or `form: endline`. This is the largest architectural change but enables longitudinal analysis.

**H. Sampling weights**

Add a `weight_column` option to charts and indicators. When present, use `numpy.average` with weights instead of simple aggregation. Requires no change to the data pipeline — just weighted computation in the indicators and chart functions.

---

## Summary scorecard

| M&E dimension | Current rating | Gap severity |
|---|---|---|
| Data collection integration | ★★★★★ | None |
| Visualization & reporting | ★★★★☆ | Low |
| Indicator tracking | ★★☆☆☆ | High |
| Results framework | ★☆☆☆☆ | Critical |
| Baseline / target / variance | ★★☆☆☆ | High |
| Disaggregation / equity | ★★★☆☆ | Medium |
| Data quality | ★☆☆☆☆ | High |
| Longitudinal / multi-form | ★☆☆☆☆ | High |
| Sampling / weighting | ★☆☆☆☆ | Medium |
| AI narrative | ★★★★☆ | Low |

The platform is production-ready as a **reporting automation tool** but is better described as a survey-to-report pipeline than an M&E system. The highest-leverage improvements are: baseline/target fields on indicators, a logframe grouping structure, and a data quality summary type — all achievable without architectural changes.
