# Databridge — Product Walkthrough (video companion)

> Marketing-oriented walkthrough for the hyperframe video. Written for **prospective users** —
> M&E officers, NGO data teams, and analysts who collect survey data in **Kobo / Ona / INFORM**
> and have to turn it into reports. All screenshots are real captures of the running app against a
> live dataset (a Mauritania protection/nutrition survey, `pcp_mauritanie_v1`, 140 submissions,
> 355 questions).

---

## The one-sentence pitch

**Databridge turns raw Kobo/Ona survey submissions into a finished, chart-filled Word report —
without writing code, and with AI doing the heavy lifting on narrative, charts, and data quality.**

---

## Who it's for & the pain it removes

If you run field surveys, you know the after-collection grind:

- Export a messy CSV, wrestle column names, copy-paste into Excel.
- Hand-build the same charts every quarter.
- Re-type findings into a Word template, re-paste every figure, re-check every number.
- Worry about PII and consent every time you share data.

Databridge collapses that into a **five-stage pipeline you drive from a browser**. Connect once,
configure once, and every reporting cycle becomes a single "run the pipeline" click.

| Without Databridge | With Databridge |
|---|---|
| Manual CSV export + cleanup | One-click download, flattened + filtered automatically |
| Charts rebuilt by hand each cycle | 21 chart types rendered from config, reused every run |
| Findings re-typed into Word | AI writes the narrative; figures auto-fill placeholders |
| PII handled ad-hoc | Consent-gating + redaction built into export |
| "Is this number right?" | Profiling + validation flag issues before you ship |

---

## The pipeline logic — five stages

The home screen is the mental model: **Extract → Transform → Model → Analyze → Deliver.**
Each stage is a tab; you can jump to any stage, or run the whole thing end to end.

![Home — the pipeline](screenshots/01-home-pipeline.png)

```
  EXTRACT          TRANSFORM            MODEL          ANALYZE              DELIVER
  ───────          ─────────            ─────          ───────              ───────
  Connect a   →    Clean & label   →    Build      →   Charts,         →    Export to files/DB,
  Kobo/Ona/        questions, hide      derived        indicators,          set output + period,
  INFORM form,     non-data fields,     virtual        or just ask          generate the Word
  pick the AI      profile & validate   tables         a question           report
  provider         the dataset
```

Numbers shown in the rail ("Step 1 of 5", etc.) reinforce the linear story for a first-time user,
but the tabs are non-blocking — power users skip straight to what they need.

---

### ① Extract — *"Connect your data source."*

Pick the platform (Ona / INFORM or Kobo Toolbox), point at the form (API URL, token, form UID),
and choose the **AI voice** that will later write the report narrative. The right-hand status panel
gives instant, reassuring feedback: *connection tested · 355 questions configured · AI key set.*

![Extract — connection](screenshots/02-extract-connection.png)

Tokens are stored encrypted and shown masked; an `env:VAR` convention lets teams keep secrets out
of the config entirely. The **AI configuration** sub-tab selects the provider/model that fills
`{{ summary_text }}`, `{{ observations }}`, and `{{ recommendations }}` in the report.

![Extract — AI configuration](screenshots/03-extract-ai-config.png)

---

### ② Transform — *"Rename what shows up in the report."*

This is where a survey schema becomes report-ready. Every question is a row, grouped by section.
Inline-edit the **export label** (the column/figure name that will appear downstream), hide
non-analytical fields, and flag PII — no YAML required. Here: **355 fields, 21 groups, 8 flagged PII.**

![Transform — questions](screenshots/04-transform-questions.png)

**Profile** gives a read-only snapshot of every table — completeness, outlier and duplicate rates
(color-coded), distinct counts and ranges — so you understand the data before you chart it.

![Transform — profile](screenshots/05-transform-profile.png)

**Validate** scans the downloaded submissions for missingness, duplicates, outliers and type
problems, grouped and triaged into *errors / warnings / notes*. In this dataset: **140 rows scanned,
7 errors, 16 warnings.** Fix issues at the source before they reach the report.

![Transform — validate](screenshots/06-transform-validate.png)

---

### ③ Model — *"Build your views."* *(optional, for richer analysis)*

Define virtual data tables — joins and aggregates across repeat groups — that are computed once and
reused by charts, summaries, and indicators. Most simple reports skip this; it's the power-user lever
for "students per district" or "households per village" style rollups.

![Model — views](screenshots/07-model-views.png)

---

### ④ Analyze — *"Shape your composition"* & *"Ask your data."*

**Charts & indicators** is the composition canvas: build the charts (21 types — bar, grouped bar,
donut, pyramid, heatmap, dot map…), the headline **indicators**, and tabular breakdowns that will
land in the report. Each one maps to a `{{ chart_<name> }}` / `{{ ind_<name> }}` token. Don't want to
build them by hand? **AI can suggest a full set** from your questions.

![Analyze — charts & indicators](screenshots/08-analyze-charts.png)

**Ask** is the showpiece: type a question in plain language — *"How many villages are recorded per
Wilaya?"* — and get an answer **computed from your actual data**, as a chart or a big-number
indicator, with a caption grounded in the real figures. Save any answer into the report with one click.

![Analyze — ask](screenshots/09-analyze-ask.png)

---

### ⑤ Deliver — *"Choose your output"* → the finished report

Pick the export format (CSV, XLSX, JSON, MySQL, PostgreSQL), set the **reporting period**
(Year / Quarter / Month / custom range), optionally **split** one report per region/site, and name
the output.

![Deliver — output](screenshots/10-deliver-output.png)

Manage the **Word templates** that build-report fills — each placeholder is replaced at render time,
so your branding and prose stay put while the numbers refresh every cycle.

![Deliver — templates](screenshots/12-deliver-templates.png)

And the payoff — **generated reports** appear here, downloadable as `.docx` (individually or as a zip),
alongside the raw data sessions each was built from.

![Deliver — reports](screenshots/11-deliver-reports.png)

---

## The output

The finished artifact is a real, editable Word document with embedded charts and AI-written prose.
A copy of the generated report is bundled at [`output-assets/sample-report.docx`](output-assets/sample-report.docx),
and a few of the charts it renders — straight from the chart engine, on-brand — are in
[`output-assets/`](output-assets/):

| | |
|---|---|
| ![Age by gender](output-assets/age_distribution_by_gender.png) | ![Vaccination coverage](output-assets/vaccination_coverage_by_village.png) |
| ![Food diversity](output-assets/food_diversity_households.png) | ![Seasonal shock severity](output-assets/seasonal_shock_severity.png) |

---

## Benefits to lead with (for the video)

1. **No code.** A browser, a form URL, a token — that's the whole setup.
2. **AI does the boring parts.** Narrative, chart suggestions, plain-language Q&A — all grounded in *your* numbers.
3. **Kobo/Ona → Word in minutes.** The same config powers every reporting cycle; reruns are one click.
4. **Trustworthy by default.** Built-in profiling, validation, PII consent-gating and redaction.
5. **Built for M&E.** Indicators, results-framework / logframe, disaggregation, multi-period comparison.
6. **Flexible delivery.** Files or databases; one report or one-per-site; any reporting window.

---

## Reproducing the screenshots

All shots were captured from the running app via Playwright (`scripts/capture.cjs`) against a
dev-mode instance on `:8010`. See [`shot-list.md`](shot-list.md) for the scene-by-scene video plan.
