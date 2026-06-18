# Chart types reference (src/reports/charts.py)

21 types registered in `CHART_DISPATCH`. All functions share the same signature:
`fn(df, questions, title, out_path, opts)`. Charts are saved to
`data/processed/charts/<chart_name>.png` at `build-report` time.

| type | questions needed | notes |
|---|---|---|
| `bar` | 1 categorical | |
| `horizontal_bar` | 1 categorical | best for long labels |
| `stacked_bar` | 2 categorical | `[x_axis, stack_by]`; option: `normalize: true` |
| `grouped_bar` | 2 categorical | `[category, group_by]` — side-by-side groups |
| `pie` | 1 categorical | |
| `donut` | 1 categorical | |
| `line` | 1–2 | date + numeric; option: `freq: month` |
| `area` | 1–2 | date + numeric; option: `freq: month` |
| `histogram` | 1 numeric | option: `bins` |
| `scatter` | 2 numeric | |
| `box_plot` | 1 categorical + 1 numeric | |
| `heatmap` | 2 categorical | |
| `treemap` | 1 categorical | requires `squarify` |
| `waterfall` | 1 categorical | |
| `funnel` | 1 categorical | |
| `table` | 1 categorical | renders as PNG |
| `bullet_chart` | 1 numeric | option: `target` (required) — achieved vs target |
| `likert` | 1 categorical | diverging bar; options: `scale`, `neutral` |
| `scorecard` | 1+ any | KPI cards grid; options: `columns`, `stat: count\|mean\|sum` |
| `pyramid` | age_group + gender | demographic pyramid; options: `male_value`, `female_value` |
| `dot_map` | lat + lon | GPS dot map; options: `basemap`, `color_by`, `size` |

Common options: `top_n`, `width_inches`, `height_inches`, `color`, `xlabel`, `ylabel`
Sort options (`bar`, `horizontal_bar`, `grouped_bar`, `waterfall`): `sort: value|label|none`

## Add a new chart type

1. Add a function with signature `fn(df, questions, title, out_path, opts)` to
   `src/reports/charts.py`.
2. Add it to the `CHART_DISPATCH` dict.
3. Add the type to the `CHART_TYPES` list in `frontend/src/pages/Composition.jsx`.
4. Update the chart-type table here, in CLAUDE.md's Charts section, and in `README.md`.
