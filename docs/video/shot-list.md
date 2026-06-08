# Hyperframe shot list — Databridge demo

A ~75–90s product video for **prospective users**. Each scene: the screenshot to frame, a suggested
voiceover (VO) line, and a hyperframe motion/annotation hint. Timings are a starting point — tighten
to taste. All assets live in `screenshots/` and `output-assets/`.

**Tone:** confident, calm, "this just works." Brand color is the teal/green in the app — match
annotation accents to it. Keep cuts on the beat of each VO line.

---

### 0:00 — Hook / title (00:00–00:06)
- **Frame:** `screenshots/01-home-pipeline.png`
- **VO:** "Survey data in. Finished report out. No code."
- **Hyperframe:** Open on the home screen in a browser frame. Slow push-in toward the five pipeline
  cards. Title card overlays: **Databridge** — *Kobo & Ona to Word, in minutes.*

### 0:06 — The pipeline (00:06–00:16)
- **Frame:** `screenshots/01-home-pipeline.png`
- **VO:** "Five stages take you from raw submissions to a polished report — Extract, Transform,
  Model, Analyze, Deliver."
- **Hyperframe:** Sequentially highlight each of the 5 cards left-to-right (pulse/underline in brand
  teal) as the stage names are spoken. Animate a left-to-right arrow connecting them.

### 0:16 — Extract / connect (00:16–00:26)
- **Frame:** `screenshots/02-extract-connection.png`
- **VO:** "Point it at your Kobo, Ona or INFORM form. Connection tested, three-hundred-fifty-five
  questions loaded automatically."
- **Hyperframe:** Zoom to the **Platform** cards, then pan to the right-hand **STATUS** panel.
  Annotate the green checks: *connection tested · 355 questions · AI key set.*

### 0:26 — Extract / AI voice (00:26–00:32)
- **Frame:** `screenshots/03-extract-ai-config.png`
- **VO:** "Pick the AI that will write your narrative."
- **Hyperframe:** Quick zoom to the Provider/Model dropdowns. Callout on **AI Narrative** card.
  *(Note: API key field is masked — safe to show.)*

### 0:32 — Transform / questions (00:32–00:42)
- **Frame:** `screenshots/04-transform-questions.png`
- **VO:** "Rename what shows up in the report, hide the noise, flag personal data — no spreadsheets,
  no YAML."
- **Hyperframe:** Zoom on the group accordions; highlight an inline **export label**, then the
  **PII** chips and the `All / Renamed / Hidden / PII` filter. Annotate *355 fields · 21 groups · 8 PII.*

### 0:42 — Transform / validate (00:42–00:52)
- **Frame:** `screenshots/06-transform-validate.png`
- **VO:** "It checks your data for you — missing values, duplicates, outliers — before anything ships."
- **Hyperframe:** Punch in on the STATUS panel: *140 rows scanned · 7 errors · 16 warnings.* Pulse the
  red "7 errors" count. Optionally cross-dissolve from `05-transform-profile.png` (the table profile)
  for a half-beat to show the completeness view.

### 0:52 — Analyze / charts (00:52–1:02)
- **Frame:** `screenshots/08-analyze-charts.png`
- **VO:** "Compose your charts and indicators — or let AI suggest a whole set from your questions."
- **Hyperframe:** Zoom across the chart list (show the type badges: grouped bar, donut, horizontal
  bar). Highlight the **STATUS** *8 charts · 2 indicators · 6 tables*, then the **Suggest charts**
  quick action and the `{{ chart_<name> }}` **Token anatomy** card.

### 1:02 — Analyze / ask (the wow) (1:02–1:14)
- **Frame:** `screenshots/09-analyze-ask.png`
- **VO:** "Or just ask. In plain language. And get an answer computed from your real data."
- **Hyperframe:** Zoom to the question box; animate one example chip being "clicked"
  (*"How many villages are recorded per Wilaya?"*). This is the emotional peak — give it room.

### 1:14 — Deliver / output (1:14–1:22)
- **Frame:** `screenshots/10-deliver-output.png`
- **VO:** "Choose your format, your reporting period, even one report per region."
- **Hyperframe:** Highlight the format chips (CSV / XLSX / JSON / MySQL / PostgreSQL), then the
  **Year / Quarter / Month / Custom** period control and the **Split by** field.

### 1:22 — The payoff: the report (1:22–1:32)
- **Frame:** `screenshots/11-deliver-reports.png` → then `output-assets/sample-report.docx` (open it
  in Word and screen-record / screenshot a page or two for this beat).
- **VO:** "And there's your report — a real Word document, charts and narrative already in place."
- **Hyperframe:** Show the Reports tab with the generated `.docx` row (annotate *1 report generated*),
  then cut to the opened document scrolling past an embedded chart and a paragraph of AI prose.

### 1:32 — Chart montage + close (1:32–1:40)
- **Frame:** the four charts in `output-assets/` (age-by-gender, vaccination coverage, food diversity,
  seasonal shock).
- **VO:** "From messy submissions to decision-ready insight — every cycle, one click."
- **Hyperframe:** Fast 4-up montage of the real charts, then return to `01-home-pipeline.png` and
  end on a logo/CTA card.

---

## Asset index

| Scene | File |
|---|---|
| Hook / pipeline / close | `screenshots/01-home-pipeline.png` |
| Extract — connection | `screenshots/02-extract-connection.png` |
| Extract — AI config | `screenshots/03-extract-ai-config.png` |
| Transform — questions | `screenshots/04-transform-questions.png` |
| Transform — profile | `screenshots/05-transform-profile.png` |
| Transform — validate | `screenshots/06-transform-validate.png` |
| Model — views (optional) | `screenshots/07-model-views.png` |
| Analyze — charts | `screenshots/08-analyze-charts.png` |
| Analyze — ask | `screenshots/09-analyze-ask.png` |
| Deliver — output | `screenshots/10-deliver-output.png` |
| Deliver — reports | `screenshots/11-deliver-reports.png` |
| Deliver — templates | `screenshots/12-deliver-templates.png` |
| Sample report (open in Word) | `output-assets/sample-report.docx` |
| Real charts (montage) | `output-assets/*.png` |

## Notes for the editor

- **Resolution:** screenshots are 1440×900 @2× (2880×1800) — crisp for 1080p/4K device frames.
- **Privacy:** API token and AI key fields are masked in the captures. The data shown (Mauritania
  survey) was cleared for use. The project name `pcp_mauritanie_v1` appears in the top bar — relabel to
  *"Demo Project"* in post if you'd rather genericize it.
- **Cosmetic:** the charts tab includes two placeholder rows (`svc_chart`, `svc_chart_2`) that aren't
  fully configured — frame the zoom on the rows above them, or crop them out.
- **Re-capture:** `node scripts/capture.cjs` against a dev-mode instance on `:8010` regenerates every
  screenshot identically (see `walkthrough.md` → *Reproducing the screenshots*).
